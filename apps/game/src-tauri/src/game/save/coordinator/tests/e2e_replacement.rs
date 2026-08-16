use super::super::{
    AppSession, AutosaveWriteReceipt, BackgroundWriteFailure, CleanupFailure, CleanupOwner,
    ExitStatusView, FailureChallengeIdentity, PendingAutosave, PersistenceBypassOperation,
    PersistenceFailureTokenView, PersistenceHealthView, SaveCoordinator, ThumbnailActivityView,
    ThumbnailCapturePurpose, WriterJobClass, WriterQueueProbe,
};
use crate::game::save::e2e_faults::E2ePersistenceFaultBoundary;
use crate::game::save::schema::SaveSlotRef;
use crate::game::test_support::{empty_engine_with_scene, investigation_scene_with_intro};
use crate::game::{GameEngine, GameError, SceneView};
use crate::AppState;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn engine(scene_id: &str, revision: u64) -> GameEngine {
    let mut engine = empty_engine_with_scene(investigation_scene_with_intro(scene_id, vec![]), 1);
    engine.durable_revision = revision;
    engine
}

fn app() -> AppState {
    let session = Arc::new(Mutex::new(AppSession::installed(engine("old", 4), 0, None)));
    let replacement_gate = Arc::new(tokio::sync::Mutex::new(()));
    let coordinator =
        SaveCoordinator::for_application(Arc::clone(&session), Arc::clone(&replacement_gate));
    AppState {
        session,
        replacement_gate,
        coordinator,
        resources_dir: PathBuf::new(),
        save_root: PathBuf::new(),
        persistence: None,
    }
}

#[tokio::test]
async fn replacement_atomically_installs_a_fresh_session_and_resets_contaminated_state() {
    let app = app();
    let health = Arc::new(Mutex::new(Vec::new()));
    let activity = Arc::new(Mutex::new(Vec::new()));
    let exit = Arc::new(Mutex::new(Vec::new()));
    let health_sink = Arc::clone(&health);
    let activity_sink = Arc::clone(&activity);
    let exit_sink = Arc::clone(&exit);
    app.coordinator.subscribe(
        move |view| health_sink.lock().unwrap().push(view),
        move |view| activity_sink.lock().unwrap().push(view),
    );
    app.coordinator
        .subscribe_exit_status(move |view| exit_sink.lock().unwrap().push(view));

    let purpose = ThumbnailCapturePurpose::Autosave {
        session_generation: 0,
        durable_revision: 4,
    };
    let capture = app.coordinator.prepare_thumbnail(purpose.clone()).unwrap();
    {
        let mut state = app.coordinator.state.lock().unwrap();
        state.next_autosave_serial = 7;
        state.pending_autosave = Some(PendingAutosave {
            serial: 7,
            session_generation: 0,
            durable_revision: 4,
            ticket: capture.ticket,
            purpose,
            thumbnail_capture_required: true,
            debounce_deadline: tokio::time::Instant::now() + Duration::from_secs(10),
            capture_deadline: tokio::time::Instant::now() + Duration::from_secs(10),
        });
        state
            .registered_autosave_targets
            .insert((0, 4), SaveSlotRef::Auto { slot: 1 });
        state.last_successful_write = Some(AutosaveWriteReceipt {
            session_generation: 0,
            durable_revision: 3,
            slot: SaveSlotRef::Auto { slot: 1 },
            save_id: "old-save".into(),
        });
        state.failed_write = Some(BackgroundWriteFailure {
            identity: (0, 4),
            diagnostic: GameError::save_write_failed(),
            thumbnail_capture_required: true,
        });
        state.cleanup_failure = Some(CleanupFailure {
            owner: CleanupOwner::Attempt(9),
            diagnostic: GameError::save_sync_failed(),
        });
        state.persistence_health = PersistenceHealthView::Degraded {
            diagnostic: GameError::save_write_failed(),
        };
        let identity = FailureChallengeIdentity {
            session_generation: 0,
            discovery_generation: None,
            durable_revision: 4,
            selected_save_id: None,
        };
        state.reserve_failure_challenge(PersistenceBypassOperation::StartWithoutSaving, identity);
        state.exit_status = ExitStatusView::Failed {
            diagnostic: GameError::save_write_failed(),
            failure_token: PersistenceFailureTokenView(
                "00000000-0000-4000-8000-000000000001".into(),
            ),
        };
        state.programmatic_exit_bypass = true;
        state.exit_action_in_progress = true;
    }
    app.coordinator
        .arm_e2e_persistence_fault(E2ePersistenceFaultBoundary::EnvelopeReplace, 1)
        .unwrap();

    let replacement = app
        .coordinator
        .replace_session_for_e2e(&app, engine("checkpoint", 12))
        .await
        .unwrap();

    assert_eq!(replacement.generation, 1);
    assert!(matches!(
        replacement.state.scene,
        SceneView::Investigation { ref id, .. } if id == "checkpoint"
    ));
    let session = app.session.lock().unwrap();
    assert_eq!(session.persistence.generation, 1);
    assert_eq!(session.persistence.flush_baseline_revision, 12);
    assert_eq!(session.persistence.written_revision, None);
    assert_eq!(session.persistence.autosave_target, None);
    drop(session);
    let state = app.coordinator.state.lock().unwrap();
    assert!(state.tickets.is_empty());
    assert!(state.latest_by_intent.is_empty());
    assert!(state.pending_autosave.is_none());
    assert!(state.registered_autosave_targets.is_empty());
    assert!(state.last_successful_write.is_none());
    assert!(state.failed_write.is_none());
    assert!(state.cleanup_failure.is_none());
    assert!(state.failure_challenges.is_empty());
    assert_eq!(state.persistence_health, PersistenceHealthView::Healthy);
    assert_eq!(state.thumbnail_activity, ThumbnailActivityView::Idle);
    assert_eq!(state.exit_status, ExitStatusView::Idle);
    assert!(!state.programmatic_exit_bypass);
    assert!(!state.exit_action_in_progress);
    drop(state);
    assert!(app
        .coordinator
        .e2e_persistence_faults
        .fire(E2ePersistenceFaultBoundary::EnvelopeReplace)
        .is_ok());
    assert_eq!(
        health.lock().unwrap().last(),
        Some(&PersistenceHealthView::Healthy)
    );
    assert_eq!(
        activity.lock().unwrap().last(),
        Some(&ThumbnailActivityView::Idle)
    );
    assert_eq!(exit.lock().unwrap().last(), Some(&ExitStatusView::Idle));
}

#[tokio::test]
async fn replacement_rejects_exit_saving_before_waiting_for_the_gate() {
    let app = app();
    app.session.lock().unwrap().persistence.exit_flush_requested = true;
    app.coordinator.state.lock().unwrap().exit_status = ExitStatusView::Saving;
    let gate = app.replacement_gate.clone().lock_owned().await;

    let result = tokio::time::timeout(
        Duration::from_millis(50),
        app.coordinator
            .replace_session_for_e2e(&app, engine("checkpoint", 1)),
    )
    .await
    .expect("rejected transition must not wait for the replacement gate");
    let error = match result {
        Ok(_) => panic!("contaminated session replacement unexpectedly succeeded"),
        Err(error) => error,
    };

    assert_eq!(error.code, "persistenceOperationInProgress");
    assert_eq!(app.session.lock().unwrap().persistence.generation, 0);
    drop(gate);
}

#[tokio::test]
async fn replacement_reserves_monotonic_coordinator_generations() {
    let app = app();

    let first = app
        .coordinator
        .replace_session_for_e2e(&app, engine("one", 1))
        .await
        .unwrap();
    let second = app
        .coordinator
        .replace_session_for_e2e(&app, engine("two", 2))
        .await
        .unwrap();

    assert_eq!((first.generation, second.generation), (1, 2));
    assert_eq!(app.session.lock().unwrap().persistence.generation, 2);
}

#[tokio::test]
async fn replacement_drops_queued_writers_and_ignores_an_active_stale_completion() {
    let app = app();
    let probe = Arc::new(WriterQueueProbe::paused());
    app.coordinator.enqueue_writer_probe(
        WriterJobClass::Debounced {
            session_generation: 0,
            durable_revision: 4,
        },
        "active-old",
        Arc::clone(&probe),
    );
    probe.wait_until_started("active-old").await;
    app.coordinator.enqueue_writer_probe(
        WriterJobClass::Debounced {
            session_generation: 0,
            durable_revision: 5,
        },
        "queued-old",
        Arc::clone(&probe),
    );

    app.coordinator
        .replace_session_for_e2e(&app, engine("checkpoint", 1))
        .await
        .unwrap();

    let completed = PendingAutosave {
        serial: 7,
        session_generation: 0,
        durable_revision: 4,
        ticket: "old-ticket".into(),
        purpose: ThumbnailCapturePurpose::Autosave {
            session_generation: 0,
            durable_revision: 4,
        },
        thumbnail_capture_required: true,
        debounce_deadline: tokio::time::Instant::now(),
        capture_deadline: tokio::time::Instant::now(),
    };
    app.coordinator.record_background_success(
        &completed,
        AutosaveWriteReceipt {
            session_generation: 0,
            durable_revision: 4,
            slot: SaveSlotRef::Auto { slot: 1 },
            save_id: "stale-save".into(),
        },
        None,
    );
    app.coordinator
        .record_background_failure(0, 4, true, GameError::save_write_failed());
    app.coordinator
        .record_registered_autosave_target(0, 4, SaveSlotRef::Auto { slot: 2 })
        .unwrap();
    app.coordinator
        .record_schedule_failure(0, 4, None, GameError::save_write_failed());
    app.coordinator.record_cleanup_failure(
        CleanupOwner::Receipt(AutosaveWriteReceipt {
            session_generation: 0,
            durable_revision: 4,
            slot: SaveSlotRef::Auto { slot: 1 },
            save_id: "stale-cleanup".into(),
        }),
        GameError::save_sync_failed(),
    );
    app.coordinator
        .record_cleanup_failure(CleanupOwner::Attempt(0), GameError::save_sync_failed());
    assert!(app.coordinator.last_successful_write().is_none());
    assert!(app
        .coordinator
        .state
        .lock()
        .unwrap()
        .cleanup_failure
        .is_none());
    assert_eq!(
        app.coordinator.persistence_health(),
        PersistenceHealthView::Healthy
    );
    assert!(app
        .coordinator
        .state
        .lock()
        .unwrap()
        .registered_autosave_targets
        .is_empty());

    probe.release_all();
    probe.wait_for_completions(1).await;
    tokio::task::yield_now().await;
    assert_eq!(probe.started_labels(), ["active-old"]);
}
