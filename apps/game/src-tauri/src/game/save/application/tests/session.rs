use super::helpers::{application_fixture, application_fixture_at};
use crate::game::save::application::session::SessionTransitionIdentity;
#[cfg(feature = "e2e")]
use crate::game::save::application::AppSession;
use crate::game::save::application::{ApplicationExit, ExitRequestSource, ExitStatusView};
use crate::game::save::schema::SaveSlotRef;
use crate::game::test_support::{empty_engine_with_scene, investigation_scene_with_intro};
use crate::game::GameError;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Notify;

fn engine(revision: u64) -> crate::game::GameEngine {
    engine_with_scene("scene", revision)
}

fn engine_with_scene(scene_id: &str, revision: u64) -> crate::game::GameEngine {
    let mut engine = empty_engine_with_scene(investigation_scene_with_intro(scene_id, vec![]), 1);
    engine.durable_revision = revision;
    engine
}

#[tokio::test]
async fn install_session_if_current_succeeds_with_matching_identity() {
    let fixture = application_fixture_at(0, 0);
    let expected = SessionTransitionIdentity {
        generation: 0,
        durable_revision: Some(0),
    };
    fixture
        .persistence
        .install_session_if_current(engine(10), None, expected)
        .await
        .unwrap();

    let session = fixture.session.lock().unwrap();
    assert_eq!(session.persistence.generation, 1);
    assert_eq!(session.persistence.flush_baseline_revision, 10);
}

#[tokio::test]
async fn install_session_if_current_mismatch_is_stale_save_selection() {
    let fixture = application_fixture();
    let error = fixture
        .persistence
        .install_session_if_current(
            engine(2),
            None,
            SessionTransitionIdentity {
                generation: 1,
                durable_revision: Some(99),
            },
        )
        .await
        .unwrap_err();

    assert_eq!(error.code, "staleSaveSelection");
}

#[tokio::test]
async fn install_session_if_current_drops_manual_autosave_target() {
    let fixture = application_fixture_at(0, 0);
    let expected = SessionTransitionIdentity {
        generation: 0,
        durable_revision: Some(0),
    };
    fixture
        .persistence
        .install_session_if_current(engine(10), Some(SaveSlotRef::Manual { slot: 2 }), expected)
        .await
        .unwrap();

    assert!(fixture
        .session
        .lock()
        .unwrap()
        .persistence
        .autosave_target
        .is_none());
}

#[tokio::test]
async fn clear_session_if_current_succeeds_with_matching_identity() {
    let fixture = application_fixture_at(0, 5);
    let expected = SessionTransitionIdentity {
        generation: 0,
        durable_revision: Some(5),
    };
    let generation = fixture
        .persistence
        .clear_session_if_current(expected)
        .await
        .unwrap();

    assert_eq!(generation, 1);
    assert!(fixture.session.lock().unwrap().engine.is_none());
}

#[tokio::test]
async fn clear_session_if_current_mismatch_is_stale_persistence_failure_token() {
    let fixture = application_fixture();
    let error = fixture
        .persistence
        .clear_session_if_current(SessionTransitionIdentity {
            generation: 1,
            durable_revision: Some(99),
        })
        .await
        .unwrap_err();

    assert_eq!(error.code, "stalePersistenceFailureToken");
}

#[tokio::test]
async fn install_session_succeeds_and_advances_generation() {
    let fixture = application_fixture_at(0, 0);
    fixture
        .persistence
        .install_session(engine(10), None)
        .await
        .unwrap();

    let session = fixture.session.lock().unwrap();
    assert_eq!(session.persistence.generation, 1);
    assert_eq!(session.persistence.flush_baseline_revision, 10);
}

#[tokio::test]
async fn install_session_with_auto_target_retains_target() {
    let fixture = application_fixture_at(0, 0);
    fixture
        .persistence
        .install_session(engine(10), Some(SaveSlotRef::Auto { slot: 2 }))
        .await
        .unwrap();

    assert_eq!(
        fixture.session.lock().unwrap().persistence.autosave_target,
        Some(SaveSlotRef::Auto { slot: 2 })
    );
}

#[tokio::test]
async fn install_session_with_manual_target_drops_target() {
    let fixture = application_fixture_at(0, 0);
    fixture
        .persistence
        .install_session(engine(10), Some(SaveSlotRef::Manual { slot: 1 }))
        .await
        .unwrap();

    assert!(fixture
        .session
        .lock()
        .unwrap()
        .persistence
        .autosave_target
        .is_none());
}

#[tokio::test]
async fn install_session_rejects_exit_flush_request() {
    let fixture = application_fixture_at(5, 12);
    fixture
        .session
        .lock()
        .unwrap()
        .persistence
        .exit_flush_requested = true;
    assert_eq!(
        fixture
            .persistence
            .install_session(engine(10), None)
            .await
            .unwrap_err()
            .code,
        "persistenceOperationInProgress"
    );
}

#[tokio::test]
async fn install_session_if_current_with_auto_target_retains_target() {
    let fixture = application_fixture_at(0, 0);
    let expected = SessionTransitionIdentity {
        generation: 0,
        durable_revision: Some(0),
    };
    fixture
        .persistence
        .install_session_if_current(engine(10), Some(SaveSlotRef::Auto { slot: 3 }), expected)
        .await
        .unwrap();

    assert_eq!(
        fixture.session.lock().unwrap().persistence.autosave_target,
        Some(SaveSlotRef::Auto { slot: 3 })
    );
}

#[tokio::test]
async fn clear_session_succeeds_and_advances_generation() {
    let fixture = application_fixture_at(5, 10);
    let generation = fixture.persistence.clear_session().await.unwrap();

    assert_eq!(generation, 1);
    let session = fixture.session.lock().unwrap();
    assert_eq!(session.persistence.generation, 1);
    assert!(session.engine.is_none());
}

#[tokio::test]
async fn clear_session_rejects_exit_flush_request() {
    let fixture = application_fixture_at(5, 10);
    fixture
        .session
        .lock()
        .unwrap()
        .persistence
        .exit_flush_requested = true;
    assert_eq!(
        fixture.persistence.clear_session().await.unwrap_err().code,
        "persistenceOperationInProgress"
    );
}

#[tokio::test]
async fn transitions_waiting_for_operation_gate_do_not_hold_session_mutex() {
    for clear in [false, true] {
        let fixture = application_fixture_at(7, 12);
        let gate = fixture
            .persistence
            .operation_gate
            .clone()
            .lock_owned()
            .await;
        let persistence = fixture.persistence.clone();
        let task = tokio::spawn(async move {
            if clear {
                persistence.clear_session().await.map(|_| ())
            } else {
                persistence
                    .install_session(engine(33), None)
                    .await
                    .map(|_| ())
            }
        });

        tokio::task::yield_now().await;
        assert!(fixture.session.try_lock().is_ok());
        drop(gate);
        tokio::time::timeout(Duration::from_millis(250), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
    }
}

#[derive(Default)]
struct RecordingExit {
    calls: Mutex<Vec<i32>>,
    called: Notify,
}

impl ApplicationExit for RecordingExit {
    fn exit(&self, code: i32) -> Result<(), GameError> {
        self.calls.lock().unwrap().push(code);
        self.called.notify_waiters();
        Ok(())
    }
}

impl RecordingExit {
    async fn wait_for_call(&self) {
        loop {
            let notified = self.called.notified();
            if !self.calls.lock().unwrap().is_empty() {
                return;
            }
            notified.await;
        }
    }
}

#[tokio::test]
async fn exit_request_arms_while_operation_gate_is_busy_and_flush_waits_afterward() {
    let fixture = application_fixture();
    let exit = Arc::new(RecordingExit::default());
    let gate = fixture
        .persistence
        .operation_gate
        .clone()
        .lock_owned()
        .await;

    fixture
        .persistence
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();
    assert_eq!(fixture.persistence.exit_status(), ExitStatusView::Saving);
    assert!(exit.calls.lock().unwrap().is_empty());

    drop(gate);
    tokio::time::timeout(Duration::from_secs(1), exit.wait_for_call())
        .await
        .unwrap();
    assert_eq!(*exit.calls.lock().unwrap(), vec![0]);
}

#[cfg(feature = "e2e")]
mod e2e {
    use super::*;
    use crate::game::save::application::{
        AutosaveWriteReceipt, BackgroundWriteFailure, CleanupFailure, PendingAutosave,
        PersistenceHealthView, ThumbnailActivityView, ThumbnailCapturePurpose,
    };
    use crate::game::save::e2e_faults::E2ePersistenceFaultBoundary;
    use crate::game::SceneView;
    use tokio::time::Instant;

    #[tokio::test]
    async fn replacement_atomically_installs_a_fresh_session_and_resets_contaminated_state() {
        let fixture = application_fixture_at(0, 4);
        *fixture.session.lock().unwrap() =
            AppSession::installed(engine_with_scene("old", 4), 0, None);
        let purpose = ThumbnailCapturePurpose::Autosave {
            session_generation: 0,
            durable_revision: 4,
        };
        let capture = fixture
            .persistence
            .prepare_thumbnail(purpose.clone())
            .unwrap();
        {
            let mut state = fixture.persistence.state.lock().unwrap();
            state.pending_autosave = Some(PendingAutosave {
                session_generation: 0,
                durable_revision: 4,
                ticket: capture.ticket,
                purpose,
                thumbnail_capture_required: true,
                debounce_deadline: Instant::now() + Duration::from_secs(10),
                capture_deadline: Instant::now() + Duration::from_secs(10),
            });
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
                diagnostic: GameError::save_sync_failed(),
            });
            state.persistence_health = PersistenceHealthView::Degraded {
                diagnostic: GameError::save_write_failed(),
            };
            state.exit_status = ExitStatusView::Failed {
                diagnostic: GameError::save_write_failed(),
                failure_token:
                    crate::game::save::application::PersistenceFailureTokenView::from_error(
                        &GameError::save_write_failed()
                            .with_failure_token("00000000-0000-4000-8000-000000000001".into()),
                    )
                    .unwrap(),
            };
            state.programmatic_exit_bypass = true;
            state.exit_action_in_progress = true;
        }
        fixture
            .persistence
            .arm_e2e_persistence_fault(E2ePersistenceFaultBoundary::EnvelopeReplace, 1)
            .unwrap();

        let replacement = fixture
            .persistence
            .replace_session_for_e2e(engine_with_scene("checkpoint", 12))
            .await
            .unwrap();

        assert_eq!(replacement.generation, 1);
        assert!(matches!(
            replacement.state.scene,
            SceneView::Investigation { ref id, .. } if id == "checkpoint"
        ));
        let session = fixture.session.lock().unwrap();
        assert_eq!(session.persistence.generation, 1);
        assert_eq!(session.persistence.flush_baseline_revision, 12);
        drop(session);
        let state = fixture.persistence.state.lock().unwrap();
        assert!(state.tickets.is_empty());
        assert!(state.latest_by_intent.is_empty());
        assert!(state.pending_autosave.is_none());
        assert!(state.last_successful_write.is_none());
        assert!(state.failed_write.is_none());
        assert!(state.cleanup_failure.is_none());
        assert_eq!(state.persistence_health, PersistenceHealthView::Healthy);
        assert_eq!(state.thumbnail_activity, ThumbnailActivityView::Idle);
        assert_eq!(state.exit_status, ExitStatusView::Idle);
        assert!(!state.programmatic_exit_bypass);
        assert!(!state.exit_action_in_progress);
        drop(state);
        fixture
            .persistence
            .arm_e2e_persistence_fault(E2ePersistenceFaultBoundary::ThumbnailInstall, 1)
            .unwrap();
    }

    #[tokio::test]
    async fn replacement_rejects_exit_saving_before_waiting_for_the_gate() {
        let fixture = application_fixture_at(0, 4);
        fixture
            .session
            .lock()
            .unwrap()
            .persistence
            .exit_flush_requested = true;
        fixture.persistence.state.lock().unwrap().exit_status = ExitStatusView::Saving;
        let gate = fixture
            .persistence
            .operation_gate
            .clone()
            .lock_owned()
            .await;

        let result = tokio::time::timeout(
            Duration::from_millis(50),
            fixture
                .persistence
                .replace_session_for_e2e(engine_with_scene("checkpoint", 1)),
        )
        .await
        .unwrap();
        let error = result.unwrap_err();

        assert_eq!(error.code, "persistenceOperationInProgress");
        assert_eq!(fixture.session.lock().unwrap().persistence.generation, 0);
        drop(gate);
    }

    #[tokio::test]
    async fn replacement_reserves_monotonic_application_generations() {
        let fixture = application_fixture_at(0, 0);

        let first = fixture
            .persistence
            .replace_session_for_e2e(engine_with_scene("one", 1))
            .await
            .unwrap();
        let second = fixture
            .persistence
            .replace_session_for_e2e(engine_with_scene("two", 2))
            .await
            .unwrap();

        assert_eq!((first.generation, second.generation), (1, 2));
        assert_eq!(fixture.session.lock().unwrap().persistence.generation, 2);
    }

    #[tokio::test]
    async fn replacement_bumps_generation_and_ignores_stale_completion() {
        let fixture = application_fixture_at(0, 4);
        fixture
            .persistence
            .replace_session_for_e2e(engine_with_scene("checkpoint", 1))
            .await
            .unwrap();

        let completed = PendingAutosave {
            session_generation: 0,
            durable_revision: 4,
            ticket: "old-ticket".into(),
            purpose: ThumbnailCapturePurpose::Autosave {
                session_generation: 0,
                durable_revision: 4,
            },
            thumbnail_capture_required: true,
            debounce_deadline: Instant::now(),
            capture_deadline: Instant::now(),
        };
        fixture.persistence.record_background_success(
            &completed,
            AutosaveWriteReceipt {
                session_generation: 0,
                durable_revision: 4,
                slot: SaveSlotRef::Auto { slot: 1 },
                save_id: "stale-save".into(),
            },
            None,
        );
        fixture
            .persistence
            .record_background_failure(0, 4, true, GameError::save_write_failed());
        assert!(fixture.persistence.last_successful_write().is_none());
        assert_eq!(
            fixture.persistence.persistence_health(),
            PersistenceHealthView::Healthy
        );
    }
}
