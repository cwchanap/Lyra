use super::super::{
    AcknowledgementOutcome, AppSession, FailureChallengeIdentity, PersistenceBypassOperation,
    PersistenceFailureTokenView, PersistenceHealthView, PreparedThumbnailPurpose, SaveCoordinator,
    ThumbnailCapturePurpose, THUMBNAIL_CAPTURE_TIMEOUT,
};
use super::debounce::RecordingBackend;
use crate::game::save::schema::{AcquisitionEventStateV1, RecordKind, SaveSlotRef};
use crate::game::schema::EvidenceJson;
use crate::game::state::EvidenceRecord;
use crate::game::test_support::{empty_engine_with_scene, investigation_scene_with_intro};
use crate::AppState;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub(super) fn app_with_event(
    coordinator: SaveCoordinator,
    generation: u64,
    revision: u64,
    event_id: &str,
    autosave_target: Option<SaveSlotRef>,
) -> AppState {
    let mut scene = investigation_scene_with_intro("scene", vec![]);
    scene.evidence_manifest.push(EvidenceJson {
        id: "evidence-1".into(),
        name: "Evidence One".into(),
        description: "Description".into(),
        details: "Details".into(),
        provenance: crate::game::provenance::CaseRecordProvenance::default(),
        image_asset_id: None,
        on_collect: vec![],
        on_reexamine: None,
    });
    let mut engine = empty_engine_with_scene(scene, 1);
    engine.durable_revision = revision;
    engine.inventory.evidence.push(EvidenceRecord {
        id: "evidence-1".into(),
        name: "Evidence One".into(),
        description: "Description".into(),
        details: "Details".into(),
        provenance: crate::game::provenance::CaseRecordProvenance::default(),
        image_asset_id: None,
        on_reexamine: None,
        collected_in_chapter_id: "chapter_1".into(),
        collected_in_scene_id: "scene".into(),
    });
    engine
        .pending_acquisition_events
        .push(AcquisitionEventStateV1 {
            id: event_id.into(),
            record_kind: RecordKind::Evidence,
            record_id: "evidence-1".into(),
            created_by_command_id: revision,
            ordinal: 0,
        });
    AppState {
        session: Arc::new(Mutex::new(AppSession::installed(
            engine,
            generation,
            autosave_target,
        ))),
        replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
        coordinator,
        resources_dir: PathBuf::new(),
        save_root: PathBuf::new(),
        persistence: None,
    }
}

pub(super) fn terminal_acknowledgement_ticket(
    coordinator: &SaveCoordinator,
    generation: u64,
    source_revision: u64,
    event_id: &str,
) -> String {
    let purpose = ThumbnailCapturePurpose::AcquisitionAcknowledgement {
        session_generation: generation,
        source_revision,
        next_revision: source_revision + 1,
        event_id: event_id.into(),
    };
    let request = coordinator.prepare_thumbnail(purpose).unwrap();
    coordinator
        .report_thumbnail_failure(&request.ticket)
        .unwrap();
    request.ticket
}

fn failure_token(error: &crate::game::GameError) -> PersistenceFailureTokenView {
    serde_json::from_value(serde_json::json!(error
        .failure_token
        .as_deref()
        .expect("authoritative acknowledgement failure must carry a token")))
    .unwrap()
}

#[tokio::test]
async fn application_command_contract_prepares_authoritative_manual_and_acknowledgement_purposes() {
    let coordinator = SaveCoordinator::ticket_only();
    let app = app_with_event(coordinator.clone(), 17, 41, "acq:41:0", None);

    let manual = coordinator
        .prepare_application_thumbnail(&app, PreparedThumbnailPurpose::ManualSave)
        .unwrap();
    coordinator
        .report_thumbnail_failure(&manual.ticket)
        .unwrap();
    coordinator
        .claim_thumbnail(
            &manual.ticket,
            &ThumbnailCapturePurpose::ManualSave {
                session_generation: 17,
                durable_revision: 41,
            },
        )
        .unwrap();

    let acknowledgement = coordinator
        .prepare_application_thumbnail(
            &app,
            PreparedThumbnailPurpose::AcquisitionAcknowledgement {
                event_id: "acq:41:0".into(),
            },
        )
        .unwrap();
    coordinator
        .report_thumbnail_failure(&acknowledgement.ticket)
        .unwrap();
    coordinator
        .claim_thumbnail(
            &acknowledgement.ticket,
            &ThumbnailCapturePurpose::AcquisitionAcknowledgement {
                session_generation: 17,
                source_revision: 41,
                next_revision: 42,
                event_id: "acq:41:0".into(),
            },
        )
        .unwrap();
}

#[tokio::test]
async fn application_command_contract_rejects_acknowledgement_event_drift_before_issuing_ticket() {
    let coordinator = SaveCoordinator::ticket_only();
    let app = app_with_event(coordinator.clone(), 17, 41, "acq:41:0", None);

    let error = coordinator
        .prepare_application_thumbnail(
            &app,
            PreparedThumbnailPurpose::AcquisitionAcknowledgement {
                event_id: "acq:stale".into(),
            },
        )
        .unwrap_err();

    assert_eq!(error.code, "unknownAcquisitionEvent");
    assert!(matches!(
        coordinator.thumbnail_activity(),
        super::super::ThumbnailActivityView::Idle
    ));
}

#[tokio::test]
async fn acknowledgement_commits_without_reacquiring_the_shared_replacement_gate() {
    let backend = Arc::new(super::storage_integration::StorageBackend::new(2, 2));
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let event_id = "acq:1:0";
    let mut app = app_with_event(coordinator.clone(), 2, 1, event_id, None);
    app.replacement_gate = backend.replacement_gate();
    let ticket = terminal_acknowledgement_ticket(&coordinator, 2, 1, event_id);

    let outcome = tokio::time::timeout(
        Duration::from_millis(100),
        coordinator.acknowledge_acquisition(&app, event_id.into(), ticket),
    )
    .await
    .expect("acknowledgement deadlocked by reacquiring its held G")
    .unwrap();

    assert!(outcome.state.pending_acquisition.is_none());
    assert_eq!(backend.normal_commit_calls(), 0);
    assert_eq!(backend.held_gate_commit_calls(), 1);
}

#[tokio::test(start_paused = true)]
async fn pending_revision_is_cancelled_before_acknowledgement_writes_only_n_plus_one() {
    let backend = Arc::new(RecordingBackend::default());
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let event_id = "acq:1:0";
    let app = app_with_event(coordinator.clone(), 3, 1, event_id, None);

    assert!(coordinator.notify_durable_commit(3, 1).is_some());
    let ticket = terminal_acknowledgement_ticket(&coordinator, 3, 1, event_id);

    let AcknowledgementOutcome {
        state,
        cleanup_diagnostic,
    } = coordinator
        .acknowledge_acquisition(&app, event_id.into(), ticket)
        .await
        .unwrap();

    assert!(state.pending_acquisition.is_none());
    assert_eq!(cleanup_diagnostic, None);
    assert_eq!(backend.write_count(), 1);
    assert_eq!(
        coordinator.last_successful_write().map(|receipt| (
            receipt.session_generation,
            receipt.durable_revision,
            receipt.slot
        )),
        Some((3, 2, SaveSlotRef::Auto { slot: 1 }))
    );
    {
        let session = app.session.lock().unwrap();
        assert_eq!(session.durable_revision(), Some(2));
        assert!(session
            .engine
            .as_ref()
            .unwrap()
            .pending_acquisition_events
            .is_empty());
        assert_eq!(session.persistence.written_revision, Some(2));
        assert_eq!(
            session.persistence.autosave_target,
            Some(SaveSlotRef::Auto { slot: 1 })
        );
        assert_eq!(session.persistence.exclusive_intent, None);
    }

    tokio::time::advance(THUMBNAIL_CAPTURE_TIMEOUT).await;
    for _ in 0..5 {
        tokio::task::yield_now().await;
    }
    assert_eq!(backend.write_count(), 1);
}

#[tokio::test(start_paused = true)]
async fn acknowledgement_waits_next_without_locks_and_reuses_inflight_target() {
    let backend = Arc::new(super::debounce::PhasedBackend::new(3));
    backend.pause_prepare();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let event_id = "acq:1:0";
    let app = Arc::new(app_with_event(coordinator.clone(), 3, 1, event_id, None));

    let request = coordinator.notify_durable_commit(3, 1).unwrap();
    coordinator
        .report_thumbnail_failure(&request.ticket)
        .unwrap();
    tokio::time::advance(super::super::AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_prepare().await;

    let ticket = terminal_acknowledgement_ticket(&coordinator, 3, 1, event_id);
    let acknowledge = {
        let coordinator = coordinator.clone();
        let app = Arc::clone(&app);
        let event_id = event_id.to_string();
        tokio::spawn(async move {
            coordinator
                .acknowledge_acquisition(&app, event_id, ticket)
                .await
        })
    };
    for _ in 0..5 {
        tokio::task::yield_now().await;
    }

    assert!(app.replacement_gate.try_lock().is_ok());
    {
        let session = app.session.try_lock().unwrap();
        assert_eq!(
            session.ensure_persistence_available().unwrap_err().code,
            "persistenceOperationInProgress"
        );
    }

    backend.release_prepare();
    let outcome = acknowledge.await.unwrap().unwrap();

    assert!(outcome.state.pending_acquisition.is_none());
    assert_eq!(
        backend.targets(),
        vec![SaveSlotRef::Auto { slot: 1 }, SaveSlotRef::Auto { slot: 1 }]
    );
    assert_eq!(backend.receipt_revisions(), vec![1, 2]);
    assert_eq!(app.session.lock().unwrap().durable_revision(), Some(2));
    assert_eq!(
        app.session.lock().unwrap().persistence.autosave_target,
        Some(SaveSlotRef::Auto { slot: 1 })
    );
}

#[tokio::test(start_paused = true)]
async fn failed_revision_retains_its_registered_target_after_slot_ranking_changes() {
    let backend = Arc::new(super::debounce::PhasedBackend::new(3));
    backend.mark_slot_used(1);
    backend.fail_next_commit();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let event_id = "acq:1:0";
    let app = app_with_event(
        coordinator.clone(),
        3,
        1,
        event_id,
        Some(SaveSlotRef::Auto { slot: 1 }),
    );

    let request = coordinator.notify_durable_commit(3, 1).unwrap();
    coordinator
        .report_thumbnail_failure(&request.ticket)
        .unwrap();
    tokio::time::advance(super::super::AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_failed_commits(1).await;
    backend.mark_slot_used(2);
    assert_eq!(
        backend.probe_selected_target(),
        SaveSlotRef::Auto { slot: 3 }
    );

    let ticket = terminal_acknowledgement_ticket(&coordinator, 3, 1, event_id);
    coordinator
        .acknowledge_acquisition(&app, event_id.into(), ticket)
        .await
        .unwrap();

    assert_eq!(
        backend.registered_targets(),
        [SaveSlotRef::Auto { slot: 2 }, SaveSlotRef::Auto { slot: 2 }]
    );
    assert_eq!(backend.selection_probe_count(), 1);
}

#[test]
fn retained_registration_is_superseded_only_by_newer_revision_or_generation() {
    let coordinator = SaveCoordinator::new();
    coordinator
        .record_registered_autosave_target(3, 8, SaveSlotRef::Auto { slot: 1 })
        .unwrap();
    coordinator
        .record_registered_autosave_target(3, 9, SaveSlotRef::Auto { slot: 2 })
        .unwrap();

    assert_eq!(coordinator.registered_autosave_target(3, 8), None);
    assert_eq!(
        coordinator.registered_autosave_target(3, 9),
        Some(SaveSlotRef::Auto { slot: 2 })
    );

    coordinator
        .record_registered_autosave_target(3, 8, SaveSlotRef::Auto { slot: 5 })
        .unwrap();
    assert_eq!(coordinator.registered_autosave_target(3, 8), None);
    assert_eq!(
        coordinator.registered_autosave_target(3, 9),
        Some(SaveSlotRef::Auto { slot: 2 })
    );

    coordinator
        .record_registered_autosave_target(4, 1, SaveSlotRef::Auto { slot: 3 })
        .unwrap();
    assert_eq!(coordinator.registered_autosave_target(3, 9), None);
    assert_eq!(
        coordinator.registered_autosave_target(4, 1),
        Some(SaveSlotRef::Auto { slot: 3 })
    );
}

#[tokio::test(start_paused = true)]
async fn in_flight_failure_keeps_selected_target_for_acknowledgement_without_follow_up() {
    let backend = Arc::new(super::debounce::PhasedBackend::new(3));
    backend.pause_prepare();
    backend.fail_next_commit();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let event_id = "acq:1:0";
    let app = Arc::new(app_with_event(coordinator.clone(), 3, 1, event_id, None));

    let request = coordinator.notify_durable_commit(3, 1).unwrap();
    coordinator
        .report_thumbnail_failure(&request.ticket)
        .unwrap();
    tokio::time::advance(super::super::AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_prepare().await;

    let ticket = terminal_acknowledgement_ticket(&coordinator, 3, 1, event_id);
    let acknowledge = {
        let coordinator = coordinator.clone();
        let app = Arc::clone(&app);
        let event_id = event_id.to_string();
        tokio::spawn(async move {
            coordinator
                .acknowledge_acquisition(&app, event_id, ticket)
                .await
        })
    };

    backend.release_prepare();
    let outcome = acknowledge.await.unwrap().unwrap();

    assert!(outcome.state.pending_acquisition.is_none());
    assert_eq!(
        backend.registered_targets(),
        vec![SaveSlotRef::Auto { slot: 1 }, SaveSlotRef::Auto { slot: 1 }]
    );
    assert_eq!(backend.receipt_revisions(), vec![2]);
    assert_eq!(backend.targets(), vec![SaveSlotRef::Auto { slot: 1 }]);
    tokio::time::advance(THUMBNAIL_CAPTURE_TIMEOUT).await;
    for _ in 0..5 {
        tokio::task::yield_now().await;
    }
    assert_eq!(backend.receipt_revisions(), vec![2]);
}

#[tokio::test(start_paused = true)]
async fn sequential_acquisition_events_refresh_the_same_autosave_target() {
    let backend = Arc::new(super::debounce::PhasedBackend::new(8));
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let first_event = "acq:4:0";
    let second_event = "acq:4:1";
    let app = app_with_event(coordinator.clone(), 8, 4, first_event, None);
    app.session
        .lock()
        .unwrap()
        .engine
        .as_mut()
        .unwrap()
        .pending_acquisition_events
        .push(AcquisitionEventStateV1 {
            id: second_event.into(),
            record_kind: RecordKind::Evidence,
            record_id: "evidence-1".into(),
            created_by_command_id: 4,
            ordinal: 1,
        });

    let first_ticket = terminal_acknowledgement_ticket(&coordinator, 8, 4, first_event);
    let first = coordinator
        .acknowledge_acquisition(&app, first_event.into(), first_ticket)
        .await
        .unwrap();
    assert_eq!(
        first
            .state
            .pending_acquisition
            .as_ref()
            .map(|event| event.id.as_str()),
        Some(second_event)
    );

    let second_ticket = terminal_acknowledgement_ticket(&coordinator, 8, 5, second_event);
    let second = coordinator
        .acknowledge_acquisition(&app, second_event.into(), second_ticket)
        .await
        .unwrap();

    assert!(second.state.pending_acquisition.is_none());
    assert_eq!(
        backend.targets(),
        vec![SaveSlotRef::Auto { slot: 1 }, SaveSlotRef::Auto { slot: 1 }]
    );
    assert_eq!(backend.receipt_revisions(), vec![5, 6]);
    assert_eq!(
        app.session.lock().unwrap().persistence.autosave_target,
        Some(SaveSlotRef::Auto { slot: 1 })
    );
}

#[tokio::test(start_paused = true)]
async fn loaded_autosave_acknowledgement_refreshes_its_source_slot() {
    let backend = Arc::new(super::debounce::PhasedBackend::new(13));
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let event_id = "acq:9:0";
    let app = app_with_event(
        coordinator.clone(),
        13,
        9,
        event_id,
        Some(SaveSlotRef::Auto { slot: 4 }),
    );
    let ticket = terminal_acknowledgement_ticket(&coordinator, 13, 9, event_id);

    coordinator
        .acknowledge_acquisition(&app, event_id.into(), ticket)
        .await
        .unwrap();

    assert_eq!(backend.targets(), vec![SaveSlotRef::Auto { slot: 4 }]);
    assert_eq!(
        app.session.lock().unwrap().persistence.autosave_target,
        Some(SaveSlotRef::Auto { slot: 4 })
    );
}

#[tokio::test(start_paused = true)]
async fn loaded_manual_acknowledgement_allocates_an_autosave_target() {
    let backend = Arc::new(super::debounce::PhasedBackend::new(21));
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let event_id = "acq:12:0";
    let app = app_with_event(coordinator.clone(), 21, 12, event_id, None);
    let ticket = terminal_acknowledgement_ticket(&coordinator, 21, 12, event_id);

    coordinator
        .acknowledge_acquisition(&app, event_id.into(), ticket)
        .await
        .unwrap();

    assert_eq!(backend.targets(), vec![SaveSlotRef::Auto { slot: 1 }]);
    assert_eq!(
        app.session.lock().unwrap().persistence.autosave_target,
        Some(SaveSlotRef::Auto { slot: 1 })
    );
}

#[tokio::test]
async fn failed_acknowledgement_restores_event_and_preserves_prior_slot_file() {
    let backend = Arc::new(super::storage_integration::StorageBackend::new(34, 2));
    backend.install_old_autosave_with_sidecar();
    let prior_slot = backend.slot_bytes(1);
    backend.fail_next_install();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let event_id = "acq:1:0";
    let mut app = app_with_event(
        coordinator.clone(),
        34,
        1,
        event_id,
        Some(SaveSlotRef::Auto { slot: 1 }),
    );
    app.replacement_gate = backend.replacement_gate();
    let ticket = terminal_acknowledgement_ticket(&coordinator, 34, 1, event_id);

    let error = match coordinator
        .acknowledge_acquisition(&app, event_id.into(), ticket)
        .await
    {
        Ok(_) => panic!("failed acknowledgement unexpectedly committed"),
        Err(error) => error,
    };

    assert_eq!(error.code, "saveReplaceFailed");
    assert_eq!(backend.slot_bytes(1), prior_slot);
    let session = app.session.lock().unwrap();
    assert_eq!(session.durable_revision(), Some(1));
    assert_eq!(session.persistence.exclusive_intent, None);
    assert_eq!(
        session
            .engine
            .as_ref()
            .unwrap()
            .pending_acquisition_events
            .iter()
            .map(|event| event.id.as_str())
            .collect::<Vec<_>>(),
        [event_id]
    );
}

#[tokio::test]
async fn cleanup_only_failure_returns_committed_state_and_typed_diagnostic() {
    let backend = Arc::new(super::storage_integration::StorageBackend::new(55, 2));
    backend.install_old_autosave_with_sidecar();
    backend.fail_next_cleanup_removal();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let event_id = "acq:1:0";
    let mut app = app_with_event(
        coordinator.clone(),
        55,
        1,
        event_id,
        Some(SaveSlotRef::Auto { slot: 1 }),
    );
    app.replacement_gate = backend.replacement_gate();
    let ticket = terminal_acknowledgement_ticket(&coordinator, 55, 1, event_id);

    let outcome = coordinator
        .acknowledge_acquisition(&app, event_id.into(), ticket)
        .await
        .unwrap();

    assert!(outcome.state.pending_acquisition.is_none());
    assert_eq!(
        outcome
            .cleanup_diagnostic
            .as_ref()
            .map(|diagnostic| diagnostic.code.as_str()),
        Some("saveWriteFailed")
    );
    let session = app.session.lock().unwrap();
    assert_eq!(session.durable_revision(), Some(2));
    assert!(session
        .engine
        .as_ref()
        .unwrap()
        .pending_acquisition_events
        .is_empty());
    assert_eq!(session.persistence.written_revision, Some(2));
    assert_eq!(session.persistence.exclusive_intent, None);
}

#[tokio::test]
async fn failed_retry_consumes_old_challenge_and_returns_a_fresh_ticket_and_token() {
    let backend = Arc::new(super::debounce::PhasedBackend::new(71));
    backend.fail_next_commit();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let event_id = "acq:4:0";
    let app = app_with_event(coordinator.clone(), 71, 4, event_id, None);
    let first_ticket = terminal_acknowledgement_ticket(&coordinator, 71, 4, event_id);

    let first_error = match coordinator
        .acknowledge_acquisition(&app, event_id.into(), first_ticket)
        .await
    {
        Ok(_) => panic!("first acknowledgement unexpectedly committed"),
        Err(error) => error,
    };
    let first_token = failure_token(&first_error);
    assert!(matches!(
        coordinator.persistence_health(),
        PersistenceHealthView::Degraded { .. }
    ));
    {
        let session = app.session.lock().unwrap();
        assert_eq!(session.durable_revision(), Some(4));
        assert_eq!(
            session
                .engine
                .as_ref()
                .unwrap()
                .pending_acquisition_events
                .len(),
            1
        );
    }

    let retry = coordinator
        .retry_acquisition_acknowledgement(&app, event_id.into(), first_token.clone())
        .unwrap();
    coordinator.report_thumbnail_failure(&retry.ticket).unwrap();
    backend.fail_next_commit();
    let second_error = match coordinator
        .acknowledge_acquisition(&app, event_id.into(), retry.ticket)
        .await
    {
        Ok(_) => panic!("retried acknowledgement unexpectedly committed"),
        Err(error) => error,
    };
    let second_token = failure_token(&second_error);

    assert_ne!(
        serde_json::to_value(&first_token).unwrap(),
        serde_json::to_value(&second_token).unwrap()
    );
    assert_eq!(
        coordinator
            .consume_failure_token(
                &first_token,
                PersistenceBypassOperation::ContinueWithoutSaving,
                FailureChallengeIdentity {
                    session_generation: 71,
                    discovery_generation: None,
                    durable_revision: 4,
                    selected_save_id: None,
                    acquisition_event_id: Some(event_id),
                },
            )
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

#[tokio::test]
async fn cancel_consumes_acknowledgement_challenge_and_keeps_event_pending() {
    let backend = Arc::new(super::debounce::PhasedBackend::new(72));
    backend.fail_next_commit();
    let coordinator = SaveCoordinator::with_backend(backend);
    let event_id = "acq:5:0";
    let app = app_with_event(coordinator.clone(), 72, 5, event_id, None);
    let ticket = terminal_acknowledgement_ticket(&coordinator, 72, 5, event_id);
    let error = match coordinator
        .acknowledge_acquisition(&app, event_id.into(), ticket)
        .await
    {
        Ok(_) => panic!("acknowledgement unexpectedly committed"),
        Err(error) => error,
    };
    let token = failure_token(&error);

    assert_eq!(
        coordinator
            .cancel_persistence_failure(&app, token.clone())
            .await
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
    let state = coordinator
        .cancel_acquisition_failure(&app, event_id.into(), token.clone())
        .unwrap();

    assert_eq!(
        state
            .pending_acquisition
            .as_ref()
            .map(|event| event.id.as_str()),
        Some(event_id)
    );
    assert_eq!(app.session.lock().unwrap().durable_revision(), Some(5));
    assert!(matches!(
        coordinator.persistence_health(),
        PersistenceHealthView::Degraded { .. }
    ));
    assert_eq!(
        coordinator
            .cancel_acquisition_failure(&app, event_id.into(), token)
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

#[tokio::test(start_paused = true)]
async fn continue_without_saving_removes_event_once_without_scheduling_its_revision() {
    let backend = Arc::new(super::debounce::PhasedBackend::new(73));
    backend.fail_next_commit();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let event_id = "acq:6:0";
    let app = app_with_event(coordinator.clone(), 73, 6, event_id, None);
    let ticket = terminal_acknowledgement_ticket(&coordinator, 73, 6, event_id);
    let error = match coordinator
        .acknowledge_acquisition(&app, event_id.into(), ticket)
        .await
    {
        Ok(_) => panic!("acknowledgement unexpectedly committed"),
        Err(error) => error,
    };
    let token = failure_token(&error);
    let writes_before_bypass = backend.registered_targets().len();

    let state = coordinator
        .confirm_acquisition_without_saving(&app, event_id.into(), token.clone())
        .await
        .unwrap();

    assert!(state.pending_acquisition.is_none());
    {
        let session = app.session.lock().unwrap();
        assert_eq!(session.durable_revision(), Some(7));
        assert!(session
            .engine
            .as_ref()
            .unwrap()
            .pending_acquisition_events
            .is_empty());
    }
    assert!(matches!(
        coordinator.persistence_health(),
        PersistenceHealthView::Degraded { .. }
    ));
    tokio::time::advance(THUMBNAIL_CAPTURE_TIMEOUT).await;
    for _ in 0..5 {
        tokio::task::yield_now().await;
    }
    assert_eq!(backend.registered_targets().len(), writes_before_bypass);
    assert_eq!(
        coordinator
            .confirm_acquisition_without_saving(&app, event_id.into(), token)
            .await
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}
