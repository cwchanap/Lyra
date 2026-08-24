use super::helpers::{application_fixture, registered_write};
use crate::game::save::application::{
    AutosaveCommitOutcome, AutosaveWriteReceipt, PersistenceHealthView, AUTOSAVE_DEBOUNCE,
};
use crate::game::save::schema::SaveSlotRef;
use std::time::Duration;
use tokio::time::Instant;

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn storage_mutations_share_one_operation_gate() {
    let fixture = application_fixture();
    fixture.filesystem.pause_staging();
    assert!(fixture
        .persistence
        .notify_durable_commit_without_thumbnail(1, 1)
        .is_none());
    std::thread::sleep(AUTOSAVE_DEBOUNCE + Duration::from_millis(50));
    fixture.filesystem.wait_for_stage().await;

    let persistence = fixture.persistence.clone();
    let second = tokio::spawn(async move {
        persistence
            .run_storage_write_if_session_current(1, move |fs, root| {
                registered_write(2, 1)
                    .prepare(fs, root)
                    .and_then(|prepared| prepared.discard())
            })
            .await
    });
    let mut overlapped = false;
    for _ in 0..10 {
        if fixture.filesystem.max_concurrent_mutations() >= 2 {
            overlapped = true;
            break;
        }
        tokio::task::yield_now().await;
    }

    fixture.filesystem.release_staging();
    second.await.unwrap().unwrap();
    tokio::task::yield_now().await;

    assert!(
        !overlapped,
        "staged storage mutations must share the operation gate"
    );
    assert_eq!(fixture.filesystem.max_concurrent_mutations(), 1);
    assert_eq!(fixture.filesystem.discarded_count(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn orphan_cleanup_runs_under_operation_gate_and_retries_after_successful_persistence() {
    let fixture = application_fixture();
    fixture.filesystem.fail_next_cleanup();
    let gate = fixture
        .persistence
        .operation_gate
        .clone()
        .lock_owned()
        .await;
    fixture.persistence.enqueue_orphan_cleanup().unwrap();
    tokio::task::yield_now().await;
    assert_eq!(
        fixture.persistence.persistence_health(),
        PersistenceHealthView::Healthy
    );

    drop(gate);
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if matches!(
                fixture.persistence.persistence_health(),
                PersistenceHealthView::Degraded {
                    diagnostic: ref error
                } if error.code == "saveReadFailed"
            ) {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();

    let pending = fixture
        .persistence
        .pending_autosave_for_test("cleanup-retry-ticket".into(), Instant::now())
        .unwrap();
    fixture.persistence.record_background_success(
        &pending,
        AutosaveWriteReceipt {
            session_generation: pending.session_generation,
            durable_revision: pending.durable_revision,
            slot: SaveSlotRef::Auto { slot: 1 },
            save_id: "550e8400-e29b-41d4-a716-446655440101".into(),
        },
        None,
    );
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if fixture.persistence.persistence_health() == PersistenceHealthView::Healthy {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        fixture.persistence.persistence_health(),
        PersistenceHealthView::Healthy
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn real_staged_write_uses_s_w_g_s_and_receipt_from_committed_envelope() {
    let fixture = application_fixture();
    fixture.filesystem.pause_staging();
    fixture
        .persistence
        .notify_durable_commit_without_thumbnail(1, 1);
    std::thread::sleep(AUTOSAVE_DEBOUNCE + Duration::from_millis(50));
    fixture.filesystem.wait_for_stage().await;

    assert!(fixture.persistence.operation_gate.try_lock().is_err());
    assert!(fixture.session.try_lock().is_ok());
    fixture.filesystem.release_staging();

    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if fixture.persistence.last_successful_write().is_some() {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();

    let receipt = fixture.persistence.last_successful_write().unwrap();
    let envelope = crate::game::save::storage::read_save_envelope(
        fixture.filesystem.as_ref(),
        &fixture.persistence.root,
        receipt.slot,
        &receipt.save_id,
    )
    .unwrap();
    assert_eq!(receipt.save_id, envelope.save_id);
    assert_eq!(receipt.durable_revision, envelope.snapshot.durable_revision);
    assert_eq!(
        receipt.slot,
        SaveSlotRef::Auto {
            slot: envelope.slot
        }
    );
}

#[tokio::test]
async fn stale_registered_token_discards_the_exact_real_staged_write() {
    let fixture = application_fixture();
    let prepared = fixture
        .persistence
        .prepare_autosave_write(registered_write(1, 1))
        .await
        .unwrap();

    fixture.session.lock().unwrap().persistence.generation = 2;
    let stale = match fixture
        .persistence
        .commit_prepared_slot_write(prepared)
        .await
        .unwrap()
    {
        AutosaveCommitOutcome::Stale(prepared) => prepared,
        AutosaveCommitOutcome::Committed(_) => panic!("stale generation must not install a save"),
    };
    fixture
        .persistence
        .discard_prepared_slot_write(stale)
        .unwrap();

    assert_eq!(fixture.filesystem.installed_count(), 0);
    assert_eq!(fixture.filesystem.discarded_count(), 1);
    assert!(fixture.persistence.last_successful_write().is_none());
}

#[tokio::test]
async fn stale_discard_io_failure_is_reported_as_a_save_failure() {
    let fixture = application_fixture();
    fixture.filesystem.fail_next_discard();
    let prepared = fixture
        .persistence
        .prepare_autosave_write(registered_write(1, 1))
        .await
        .unwrap();

    fixture.session.lock().unwrap().persistence.generation = 2;
    let stale = match fixture
        .persistence
        .commit_prepared_slot_write(prepared)
        .await
        .unwrap()
    {
        AutosaveCommitOutcome::Stale(prepared) => prepared,
        AutosaveCommitOutcome::Committed(_) => panic!("stale generation must not install a save"),
    };

    assert_eq!(
        fixture
            .persistence
            .discard_prepared_slot_write(stale)
            .unwrap_err()
            .code,
        "saveWriteFailed"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn application_owner_adopts_the_committed_slot_and_save_id() {
    let fixture = application_fixture();
    fixture
        .persistence
        .notify_durable_commit_without_thumbnail(1, 1);
    tokio::time::sleep(AUTOSAVE_DEBOUNCE).await;
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if fixture.persistence.last_successful_write().is_some() {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();

    let receipt = fixture.persistence.last_successful_write().unwrap();
    let envelope = crate::game::save::storage::read_save_envelope(
        fixture.filesystem.as_ref(),
        &fixture.persistence.root,
        receipt.slot,
        &receipt.save_id,
    )
    .unwrap();
    assert_eq!(
        receipt.slot,
        SaveSlotRef::Auto {
            slot: envelope.slot
        }
    );
    assert_eq!(receipt.save_id, envelope.save_id);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn orphan_cleanup_runs_through_writer_after_active_save() {
    let fixture = application_fixture();
    fixture.filesystem.pause_staging();
    fixture
        .persistence
        .notify_durable_commit_without_thumbnail(1, 1);
    std::thread::sleep(AUTOSAVE_DEBOUNCE + Duration::from_millis(50));
    fixture.filesystem.wait_for_stage().await;

    fixture.persistence.enqueue_orphan_cleanup().unwrap();
    assert_eq!(fixture.filesystem.max_concurrent_mutations(), 1);
    fixture.filesystem.release_staging();

    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if fixture.persistence.last_successful_write().is_some() {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(fixture.filesystem.max_concurrent_mutations(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn normal_write_orders_capture_prepare_revalidate_commit_and_keeps_session_responsive() {
    let fixture = application_fixture();
    fixture.filesystem.pause_staging();
    assert!(fixture
        .persistence
        .notify_durable_commit_without_thumbnail(1, 1)
        .is_none());
    std::thread::sleep(AUTOSAVE_DEBOUNCE + Duration::from_millis(50));

    fixture.filesystem.wait_for_stage().await;
    assert!(fixture.session.try_lock().is_ok());

    fixture.filesystem.release_staging();
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if fixture.persistence.last_successful_write().is_some() {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(fixture.filesystem.installed_count(), 1);
}

#[test]
fn real_file_pre_acknowledgement_save_replays_pending_popup_without_duplicate_acquisition() {
    use crate::game::save::capture::capture_checkpoint;
    use crate::game::save::restore::{build_restore_candidate, load_current_definitions};
    use crate::game::save::schema::{
        SaveEnvelope, SaveType, ThumbnailDescriptorV1, SAVE_SCHEMA_VERSION,
    };
    use crate::game::save::storage::{
        commit_prepared_slot_write, ensure_save_layout, prepare_slot_write, read_save_envelope,
        ProductionSaveFilesystem, SlotWriteRequest, ThumbnailWrite,
    };
    use crate::game::test_support::{
        drive_hpa_257_positive_progression, hpa_257_fixture_resources,
    };
    use crate::game::GameEngine;

    const SAVE_ID: &str = "11111111-1111-4111-8111-111111111111";
    let (_guard, resources) = hpa_257_fixture_resources();
    let mut engine = GameEngine::new_started(resources.clone()).unwrap();
    drive_hpa_257_positive_progression(&mut engine);
    assert_eq!(engine.inventory.evidence.len(), 1);
    assert_eq!(engine.pending_acquisition_events.len(), 1);
    let event_id = engine.pending_acquisition_events[0].id.clone();
    let story_before = engine.story_state.snapshot();
    assert!(story_before.facts.contains_key("fact_a"));

    let saves = tempfile::tempdir().unwrap();
    let root = saves.path().join("saves");
    let fs = ProductionSaveFilesystem;
    ensure_save_layout(&fs, &root).unwrap();
    let checkpoint = capture_checkpoint(&engine).unwrap();
    let envelope = SaveEnvelope {
        schema_version: SAVE_SCHEMA_VERSION,
        content_revision: engine.content_revision().into(),
        save_id: SAVE_ID.into(),
        save_type: SaveType::Auto,
        slot: 1,
        saved_at: "2026-07-26T12:34:56Z".into(),
        display_name: "Replay fixture".into(),
        thumbnail: ThumbnailDescriptorV1::Unavailable,
        summary: checkpoint.summary,
        snapshot: checkpoint.snapshot,
    };
    let prepared = prepare_slot_write(
        &fs,
        &root,
        SlotWriteRequest {
            reference: SaveSlotRef::Auto { slot: 1 },
            envelope,
            thumbnail: ThumbnailWrite::Unavailable,
            expected_manual: None,
        },
    )
    .unwrap();
    let outcome = commit_prepared_slot_write(&fs, &root, prepared).unwrap();
    assert_eq!(outcome.committed_envelope.save_id, SAVE_ID);
    assert_eq!(outcome.cleanup_diagnostic, None);

    let live_revision = engine.durable_revision;
    engine.acknowledge_acquisition_event(&event_id).unwrap();
    assert!(engine.pending_acquisition_events.is_empty());
    assert_eq!(engine.durable_revision, live_revision + 1);
    assert_eq!(engine.inventory.evidence.len(), 1);
    assert_eq!(engine.story_state.snapshot(), story_before);

    let saved = read_save_envelope(&fs, &root, SaveSlotRef::Auto { slot: 1 }, SAVE_ID).unwrap();
    let definitions = load_current_definitions(&resources).unwrap();
    let restored = build_restore_candidate(resources, &definitions, saved).unwrap();
    assert_eq!(restored.save_id, SAVE_ID);
    assert_eq!(restored.source, SaveSlotRef::Auto { slot: 1 });

    let mut restored_engine = restored.engine;
    assert_eq!(restored_engine.inventory.evidence.len(), 1);
    assert_eq!(restored_engine.story_state.snapshot(), story_before);
    assert_eq!(restored_engine.pending_acquisition_events.len(), 1);
    assert_eq!(restored_engine.pending_acquisition_events[0].id, event_id);

    let restored_revision = restored_engine.durable_revision;
    restored_engine
        .acknowledge_acquisition_event(&event_id)
        .unwrap();
    assert!(restored_engine.pending_acquisition_events.is_empty());
    assert_eq!(restored_engine.durable_revision, restored_revision + 1);
    assert_eq!(restored_engine.inventory.evidence.len(), 1);
    assert_eq!(restored_engine.story_state.snapshot(), story_before);
}
