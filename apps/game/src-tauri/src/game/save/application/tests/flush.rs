use super::helpers::application_fixture_at;
use crate::game::save::application::{
    session::SessionPersistence, AppSession, ApplicationPersistence, AutosaveWriteReceipt,
    FlushOperation, FlushOutcome, PersistenceHealthView, THUMBNAIL_CAPTURE_TIMEOUT,
};
use crate::game::save::schema::{SaveSlotRef, ThumbnailDescriptorV1};
use crate::game::test_support::{
    empty_engine_with_scene, investigation_scene_with_intro, png_fixture,
};
use crate::AppState;
use std::path::PathBuf;

fn app(fixture: &super::helpers::ApplicationFixture) -> AppState {
    AppState {
        session: fixture.session.clone(),
        persistence: fixture.persistence.clone(),
        resources_dir: PathBuf::new(),
    }
}

#[tokio::test]
async fn fresh_revision_zero_flush_is_a_physical_no_op() {
    let fixture = application_fixture_at(1, 0);
    let state = app(&fixture);
    assert_eq!(
        fixture
            .persistence
            .flush_session(&state, FlushOperation::ManualSave)
            .await
            .unwrap(),
        FlushOutcome::Noop {
            session_generation: 1,
            durable_revision: 0,
        }
    );
}

#[tokio::test]
async fn fresh_revision_zero_flush_never_enters_the_writer() {
    let fixture = application_fixture_at(1, 0);
    let state = app(&fixture);

    assert_eq!(
        fixture
            .persistence
            .flush_session(&state, FlushOperation::ReturnToTitle)
            .await
            .unwrap(),
        FlushOutcome::Noop {
            session_generation: 1,
            durable_revision: 0,
        }
    );
    assert_eq!(fixture.filesystem.installed_count(), 0);
    assert!(fixture.persistence.last_successful_write().is_none());
    assert!(fixture
        .session
        .lock()
        .unwrap()
        .persistence
        .autosave_target
        .is_none());
}

#[tokio::test]
async fn blocking_flush_writes_once_then_becomes_idempotent_without_advancing_revision() {
    let fixture = application_fixture_at(1, 0);
    fixture
        .session
        .lock()
        .unwrap()
        .engine
        .as_mut()
        .unwrap()
        .durable_revision = 1;
    let state = app(&fixture);
    let first = fixture
        .persistence
        .flush_session(&state, FlushOperation::ManualSave)
        .await
        .unwrap();
    assert!(matches!(first, FlushOutcome::Written { .. }));
    let second = fixture
        .persistence
        .flush_session(&state, FlushOperation::ManualSave)
        .await
        .unwrap();
    assert!(matches!(second, FlushOutcome::Noop { .. }));
    assert_eq!(fixture.filesystem.max_concurrent_mutations(), 1);
    assert_eq!(
        fixture.persistence.persistence_health(),
        PersistenceHealthView::Healthy
    );
    assert_eq!(fixture.session.lock().unwrap().durable_revision(), Some(1));
}

#[tokio::test]
async fn loaded_baseline_flushes_only_after_a_newer_revision() {
    let fixture = application_fixture_at(7, 44);
    let state = app(&fixture);
    assert!(matches!(
        fixture
            .persistence
            .flush_session(&state, FlushOperation::InGameLoad)
            .await
            .unwrap(),
        FlushOutcome::Noop {
            session_generation: 7,
            durable_revision: 44,
        }
    ));
    fixture
        .session
        .lock()
        .unwrap()
        .engine
        .as_mut()
        .unwrap()
        .durable_revision = 45;
    assert!(matches!(
        fixture
            .persistence
            .flush_session(&state, FlushOperation::InGameLoad)
            .await
            .unwrap(),
        FlushOutcome::Written {
            session_generation: 7,
            durable_revision: 45,
            ..
        }
    ));
}

#[test]
fn same_generation_baseline_or_written_revision_covers_every_flush_boundary() {
    let mut persistence = SessionPersistence::for_installed_engine(9, 12, None);
    persistence.record_written(&AutosaveWriteReceipt {
        session_generation: 9,
        durable_revision: 18,
        slot: SaveSlotRef::Auto { slot: 2 },
        save_id: "550e8400-e29b-41d4-a716-446655440001".into(),
    });

    for operation in [
        FlushOperation::ManualSave,
        FlushOperation::InGameLoad,
        FlushOperation::ReturnToTitle,
        FlushOperation::Exit,
    ] {
        assert_eq!(persistence.flush_revision(operation, 12), None);
        assert_eq!(persistence.flush_revision(operation, 18), None);
        assert_eq!(persistence.flush_revision(operation, 19), Some(19));
    }
}

#[test]
fn prior_generation_revision_900_cannot_suppress_new_generation_revision_1() {
    let mut persistence = SessionPersistence::for_installed_engine(2, 0, None);
    persistence.record_written(&AutosaveWriteReceipt {
        session_generation: 1,
        durable_revision: 900,
        slot: SaveSlotRef::Auto { slot: 5 },
        save_id: "550e8400-e29b-41d4-a716-446655440002".into(),
    });

    assert!(persistence.written_revision.is_none());
    assert_eq!(
        persistence.flush_revision(FlushOperation::ReturnToTitle, 1),
        Some(1)
    );
    assert!(persistence.autosave_target.is_none());
}

#[test]
fn installed_sessions_receive_monotonic_generations() {
    let persistence = ApplicationPersistence::new();
    assert_eq!(persistence.next_session_generation().unwrap(), 1);
    assert_eq!(persistence.next_session_generation().unwrap(), 2);
    assert_eq!(persistence.next_session_generation().unwrap(), 3);
}

#[test]
fn installed_session_baseline_and_target_come_from_the_installed_engine() {
    let engine = test_engine(44);
    let source = SaveSlotRef::Auto { slot: 4 };
    let session = AppSession::installed(engine, 8, Some(source));

    assert_eq!(session.durable_revision(), Some(44));
    assert_eq!(session.persistence.generation, 8);
    assert_eq!(session.persistence.flush_baseline_revision, 44);
    assert_eq!(session.persistence.autosave_target, Some(source));
}

#[test]
fn flush_and_manual_save_decisions_do_not_advance_durable_revision() {
    let mut durable_revision = 27;
    let persistence = SessionPersistence::for_installed_engine(4, 0, None);

    assert_eq!(
        persistence.flush_revision(FlushOperation::ReturnToTitle, durable_revision),
        Some(27)
    );
    assert_eq!(durable_revision, 27);
    assert_eq!(
        persistence.flush_revision(FlushOperation::ManualSave, durable_revision),
        Some(27)
    );
    assert_eq!(durable_revision, 27);

    durable_revision += 1;
    assert_eq!(durable_revision, 28);
}

#[tokio::test(start_paused = true)]
async fn blocking_flush_cancels_same_revision_debounce_before_it_enters_writer() {
    let fixture = application_fixture_at(3, 0);
    fixture
        .session
        .lock()
        .unwrap()
        .engine
        .as_mut()
        .unwrap()
        .durable_revision = 1;
    let state = app(&fixture);
    assert!(fixture.persistence.notify_durable_commit(3, 1).is_some());

    assert!(matches!(
        fixture
            .persistence
            .flush_session(&state, FlushOperation::ReturnToTitle)
            .await
            .unwrap(),
        FlushOutcome::Written { .. }
    ));
    assert_eq!(fixture.filesystem.installed_count(), 1);

    tokio::time::advance(THUMBNAIL_CAPTURE_TIMEOUT).await;
    for _ in 0..5 {
        tokio::task::yield_now().await;
    }
    assert_eq!(fixture.filesystem.installed_count(), 1);
}

#[tokio::test(start_paused = true)]
async fn blocking_flush_preserves_a_terminal_thumbnail_from_the_covered_autosave() {
    let fixture = application_fixture_at(3, 0);
    fixture
        .session
        .lock()
        .unwrap()
        .engine
        .as_mut()
        .unwrap()
        .durable_revision = 1;
    let state = app(&fixture);
    let request = fixture.persistence.notify_durable_commit(3, 1).unwrap();
    fixture
        .persistence
        .submit_thumbnail(&request.ticket, &png_fixture(320, 180))
        .unwrap();

    assert!(matches!(
        fixture
            .persistence
            .flush_session(&state, FlushOperation::ReturnToTitle)
            .await
            .unwrap(),
        FlushOutcome::Written { .. }
    ));
    let receipt = fixture.persistence.last_successful_write().unwrap();
    let envelope = crate::game::save::storage::read_save_envelope(
        fixture.filesystem.as_ref(),
        &fixture.persistence.root,
        receipt.slot,
        &receipt.save_id,
    )
    .unwrap();
    assert!(matches!(
        envelope.thumbnail,
        ThumbnailDescriptorV1::Available { .. }
    ));
}

#[tokio::test(start_paused = true)]
async fn blocking_flush_discards_an_older_autosave_thumbnail() {
    let fixture = application_fixture_at(3, 0);
    fixture
        .session
        .lock()
        .unwrap()
        .engine
        .as_mut()
        .unwrap()
        .durable_revision = 2;
    let state = app(&fixture);
    let request = fixture.persistence.notify_durable_commit(3, 1).unwrap();
    fixture
        .persistence
        .submit_thumbnail(&request.ticket, &png_fixture(320, 180))
        .unwrap();

    assert!(matches!(
        fixture
            .persistence
            .flush_session(&state, FlushOperation::ReturnToTitle)
            .await
            .unwrap(),
        FlushOutcome::Written { .. }
    ));
    let receipt = fixture.persistence.last_successful_write().unwrap();
    let envelope = crate::game::save::storage::read_save_envelope(
        fixture.filesystem.as_ref(),
        &fixture.persistence.root,
        receipt.slot,
        &receipt.save_id,
    )
    .unwrap();
    assert_eq!(envelope.thumbnail, ThumbnailDescriptorV1::Unavailable);
}

fn test_engine(revision: u64) -> crate::game::GameEngine {
    let mut engine = empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
    engine.durable_revision = revision;
    engine
}
