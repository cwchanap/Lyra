use super::helpers::{application_fixture_at, RecordingExit};
use crate::game::save::application::{
    AppSession, ApplicationExit, ApplicationPersistence, ExitRequestSource, ExitStatusView,
    FailureChallengeIdentity, FailureTokenSource, PersistenceBypassOperation,
    PersistenceFailureChallenge, PersistenceFailureTokenView, AUTOSAVE_DEBOUNCE,
};
use crate::game::GameError;
use std::collections::VecDeque;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, Notify};

struct FailingExit;

impl ApplicationExit for FailingExit {
    fn exit(&self, _code: i32) -> Result<(), GameError> {
        Err(GameError::save_write_failed())
    }
}

struct LockProbeExit {
    persistence: ApplicationPersistence,
    session: Arc<Mutex<AppSession>>,
    called: Notify,
}

impl ApplicationExit for LockProbeExit {
    fn exit(&self, _code: i32) -> Result<(), GameError> {
        assert!(self.persistence.lock_exit_transition().is_ok());
        assert!(self.session.try_lock().is_ok());
        self.called.notify_waiters();
        Ok(())
    }
}

/// An `ApplicationExit` that signals when `exit()` is entered and blocks
/// until the test releases it, holding `exit_without_saving` inside the
/// external-exit window between its two `exit_transition` locks.
struct BlockingExit {
    reached: Arc<Notify>,
    release: Arc<(Mutex<bool>, Condvar)>,
}

impl ApplicationExit for BlockingExit {
    fn exit(&self, _code: i32) -> Result<(), GameError> {
        self.reached.notify_waiters();
        let (lock, cvar) = &*self.release;
        let mut guard = lock.lock().unwrap();
        while !*guard {
            guard = cvar.wait(guard).unwrap();
        }
        Ok(())
    }
}

fn status_receiver(
    persistence: &ApplicationPersistence,
) -> mpsc::UnboundedReceiver<ExitStatusView> {
    let (tx, rx) = mpsc::unbounded_channel();
    persistence.subscribe_exit_status(move |status| {
        let _ = tx.send(status);
    });
    let mut rx = rx;
    assert_eq!(rx.try_recv().unwrap(), ExitStatusView::Idle);
    rx
}

#[test]
fn exit_lifecycle_status_uses_complete_camel_case_tagged_views() {
    assert_eq!(
        serde_json::to_value(ExitStatusView::Idle).unwrap(),
        serde_json::json!({ "type": "idle" })
    );
    assert_eq!(
        serde_json::to_value(ExitStatusView::Saving).unwrap(),
        serde_json::json!({ "type": "saving" })
    );
    assert_eq!(
        serde_json::to_value(ExitStatusView::Failed {
            diagnostic: GameError::save_write_failed(),
            failure_token: PersistenceFailureTokenView::from_error(
                &GameError::save_write_failed()
                    .with_failure_token("00000000-0000-4000-8000-000000000001".into())
            )
            .unwrap(),
        })
        .unwrap(),
        serde_json::json!({
            "type": "failed",
            "diagnostic": {
                "code": "saveWriteFailed",
                "message": "Save could not be written.",
            },
            "failureToken": "00000000-0000-4000-8000-000000000001"
        })
    );
}

#[test]
fn cancel_exit_rejects_while_idle() {
    let persistence = ApplicationPersistence::new();
    let token = PersistenceFailureTokenView::from_error(
        &GameError::save_write_failed()
            .with_failure_token("00000000-0000-4000-8000-000000000001".into()),
    )
    .unwrap();

    assert_eq!(
        persistence.cancel_exit(token).unwrap_err().code,
        "stalePersistenceFailureToken"
    );
    assert_eq!(persistence.exit_status(), ExitStatusView::Idle);
}

#[tokio::test]
async fn exit_lifecycle_failure_publishes_complete_status_and_cancel_consumes_exact_token() {
    let persistence = Arc::new(ApplicationPersistence::new());
    persistence
        .request_exit_flush(Arc::new(FailingExit), ExitRequestSource::WindowClose)
        .unwrap();

    let status = tokio::time::timeout(std::time::Duration::from_secs(1), async {
        loop {
            if let ExitStatusView::Failed { .. } = persistence.exit_status() {
                break persistence.exit_status();
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let ExitStatusView::Failed {
        diagnostic,
        failure_token: token,
    } = status
    else {
        panic!("exit failure must publish a complete status");
    };
    assert_eq!(diagnostic.code, "saveWriteFailed");

    assert_eq!(
        persistence.cancel_exit(token).unwrap(),
        ExitStatusView::Idle
    );
}

#[tokio::test]
async fn exit_lifecycle_cancel_guard_clear_failure_preserves_exact_failed_token() {
    let persistence = ApplicationPersistence::new();
    persistence
        .request_exit_flush(Arc::new(FailingExit), ExitRequestSource::WindowClose)
        .unwrap();
    let token = tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if let ExitStatusView::Failed { failure_token, .. } = persistence.exit_status() {
                break failure_token;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let failed = persistence.exit_status();
    persistence.fail_next_cancel_guard_clear_for_test();
    assert_eq!(
        persistence.cancel_exit(token.clone()).unwrap_err().code,
        "saveWriteFailed"
    );
    assert_eq!(persistence.exit_status(), failed);
    assert_eq!(
        persistence.cancel_exit(token).unwrap(),
        ExitStatusView::Idle
    );
}

#[tokio::test]
async fn exit_lifecycle_without_saving_action_failure_preserves_exact_failed_token() {
    let persistence = ApplicationPersistence::new();
    persistence
        .request_exit_flush(Arc::new(FailingExit), ExitRequestSource::ApplicationQuit)
        .unwrap();
    let token = tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if let ExitStatusView::Failed { failure_token, .. } = persistence.exit_status() {
                break failure_token;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let failed = persistence.exit_status();
    assert_eq!(
        persistence
            .exit_without_saving(Arc::new(FailingExit), token.clone())
            .unwrap_err()
            .code,
        "saveWriteFailed"
    );
    assert_eq!(persistence.exit_status(), failed);

    let exit = Arc::new(RecordingExit::default());
    persistence
        .exit_without_saving(exit.clone(), token.clone())
        .unwrap();
    exit.wait_for_call().await;
    assert!(persistence.consume_programmatic_exit_bypass());
    assert_eq!(
        persistence
            .exit_without_saving(exit, token)
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

#[tokio::test]
async fn exit_lifecycle_challenge_publication_failure_restores_recoverable_idle() {
    let persistence = ApplicationPersistence::new();
    persistence.fail_next_exit_challenge_for_test();
    let mut statuses = status_receiver(&persistence);
    let exit = Arc::new(RecordingExit::default());
    persistence
        .request_exit_flush(Arc::new(FailingExit), ExitRequestSource::WindowClose)
        .unwrap();
    assert_eq!(statuses.recv().await.unwrap(), ExitStatusView::Saving);
    assert_eq!(statuses.recv().await.unwrap(), ExitStatusView::Idle);
    assert!(
        !persistence
            .session
            .lock()
            .unwrap()
            .persistence
            .exit_flush_requested
    );
    assert!(exit.calls.lock().unwrap().is_empty());

    persistence
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();
    assert_eq!(statuses.recv().await.unwrap(), ExitStatusView::Saving);
    exit.wait_for_call().await;
    assert_eq!(*exit.calls.lock().unwrap(), vec![0]);
}

#[tokio::test]
async fn exit_lifecycle_repeated_native_requests_share_one_noop_flush_and_one_exit_bypass() {
    let persistence = ApplicationPersistence::new();
    let exit = Arc::new(RecordingExit::default());

    persistence
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();
    persistence
        .request_exit_flush(exit.clone(), ExitRequestSource::ApplicationQuit)
        .unwrap();
    exit.wait_for_call().await;

    assert_eq!(*exit.calls.lock().unwrap(), vec![0]);
    assert_eq!(persistence.exit_status(), ExitStatusView::Saving);
    assert!(persistence.consume_programmatic_exit_bypass());
    assert!(!persistence.consume_programmatic_exit_bypass());
}

#[tokio::test]
async fn exit_lifecycle_releases_transition_and_session_before_external_exit_action() {
    let persistence = ApplicationPersistence::new();
    let session = persistence.session.clone();
    let exit = Arc::new(LockProbeExit {
        persistence: persistence.clone(),
        session,
        called: Notify::new(),
    });
    let called = exit.called.notified();

    persistence
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();
    tokio::time::timeout(Duration::from_secs(1), called)
        .await
        .unwrap();
}

#[test]
fn exit_lifecycle_prerequisite_failure_does_not_arm_saving() {
    let persistence = ApplicationPersistence::new();
    persistence.fail_next_exit_prerequisite_for_test();
    let exit = Arc::new(RecordingExit::default());

    let error = persistence
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap_err();

    assert_eq!(error.code, "saveWriteFailed");
    assert_eq!(persistence.exit_status(), ExitStatusView::Idle);
    assert!(
        !persistence
            .session
            .lock()
            .unwrap()
            .persistence
            .exit_flush_requested
    );
    assert!(exit.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn exit_lifecycle_retry_and_without_saving_each_consume_one_exact_challenge() {
    let retry_persistence = ApplicationPersistence::new();
    let mut retry_statuses = status_receiver(&retry_persistence);
    retry_persistence
        .request_exit_flush(Arc::new(FailingExit), ExitRequestSource::WindowClose)
        .unwrap();
    assert_eq!(retry_statuses.recv().await.unwrap(), ExitStatusView::Saving);
    let ExitStatusView::Failed {
        failure_token: retry_token,
        ..
    } = retry_statuses.recv().await.unwrap()
    else {
        panic!("first exit flush must fail");
    };

    let retry_exit = Arc::new(RecordingExit::default());
    retry_persistence
        .retry_exit(retry_exit.clone(), retry_token.clone())
        .unwrap();
    assert_eq!(retry_statuses.recv().await.unwrap(), ExitStatusView::Saving);
    retry_exit.wait_for_call().await;
    assert_eq!(*retry_exit.calls.lock().unwrap(), vec![0]);
    assert!(retry_persistence.consume_programmatic_exit_bypass());
    assert_eq!(
        retry_persistence
            .retry_exit(retry_exit, retry_token)
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );

    let bypass_persistence = ApplicationPersistence::new();
    let mut bypass_statuses = status_receiver(&bypass_persistence);
    bypass_persistence
        .request_exit_flush(Arc::new(FailingExit), ExitRequestSource::ApplicationQuit)
        .unwrap();
    assert_eq!(
        bypass_statuses.recv().await.unwrap(),
        ExitStatusView::Saving
    );
    let ExitStatusView::Failed {
        failure_token: bypass_token,
        ..
    } = bypass_statuses.recv().await.unwrap()
    else {
        panic!("exit flush must fail before bypass");
    };

    let bypass_exit = Arc::new(RecordingExit::default());
    bypass_persistence
        .exit_without_saving(bypass_exit.clone(), bypass_token.clone())
        .unwrap();
    bypass_exit.wait_for_call().await;
    assert_eq!(*bypass_exit.calls.lock().unwrap(), vec![0]);
    assert!(bypass_persistence.consume_programmatic_exit_bypass());
    assert_eq!(
        bypass_persistence
            .exit_without_saving(bypass_exit, bypass_token)
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

#[tokio::test]
async fn exit_lifecycle_failure_token_collision_reserves_a_new_matching_challenge() {
    let occupied = uuid::Uuid::parse_str("00000000-0000-4000-8000-000000000001").unwrap();
    let unique = uuid::Uuid::parse_str("00000000-0000-4000-8000-000000000002").unwrap();
    let persistence = ApplicationPersistence::new();
    {
        let mut state = persistence.state.lock().unwrap();
        state.failure_token_source =
            FailureTokenSource::Deterministic(VecDeque::from([occupied, unique]));
        state.failure_challenges.insert(
            occupied,
            PersistenceFailureChallenge {
                token: occupied,
                operation: PersistenceBypassOperation::StartWithoutSaving,
                session_generation: 0,
                discovery_generation: None,
                durable_revision: 0,
                selected_save_id: None,
            },
        );
    }

    let mut statuses = status_receiver(&persistence);
    persistence
        .request_exit_flush(Arc::new(FailingExit), ExitRequestSource::WindowClose)
        .unwrap();
    assert_eq!(statuses.recv().await.unwrap(), ExitStatusView::Saving);
    let ExitStatusView::Failed {
        failure_token: exit_token,
        ..
    } = statuses.recv().await.unwrap()
    else {
        panic!("exit failure must publish a failed status");
    };

    assert_eq!(uuid::Uuid::parse_str(&exit_token.0).unwrap(), unique);
    assert_eq!(
        persistence.state.lock().unwrap().failure_challenges.len(),
        2
    );

    let original: PersistenceFailureTokenView =
        serde_json::from_value(serde_json::json!(occupied.hyphenated().to_string())).unwrap();
    persistence
        .cancel_failure_token(
            &original,
            PersistenceBypassOperation::StartWithoutSaving,
            FailureChallengeIdentity {
                session_generation: 0,
                discovery_generation: None,
                durable_revision: 0,
                selected_save_id: None,
            },
        )
        .unwrap();
    assert_eq!(
        persistence.cancel_exit(exit_token).unwrap(),
        ExitStatusView::Idle
    );
}

#[tokio::test(start_paused = true)]
async fn exit_lifecycle_supersedes_pending_debounce_without_waiting_for_its_deadline() {
    let fixture = application_fixture_at(4, 1);
    fixture
        .session
        .lock()
        .unwrap()
        .engine
        .as_mut()
        .unwrap()
        .durable_revision = 2;
    assert!(fixture.persistence.notify_durable_commit(4, 2).is_some());

    let exit = Arc::new(RecordingExit::default());
    fixture
        .persistence
        .request_exit_flush(exit.clone(), ExitRequestSource::ApplicationQuit)
        .unwrap();
    tokio::time::timeout(Duration::from_secs(1), exit.wait_for_call())
        .await
        .unwrap();

    assert_eq!(fixture.filesystem.installed_count(), 1);
    assert_eq!(*exit.calls.lock().unwrap(), vec![0]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn exit_lifecycle_waits_for_an_active_writer_without_holding_session() {
    let fixture = application_fixture_at(4, 1);
    fixture
        .session
        .lock()
        .unwrap()
        .engine
        .as_mut()
        .unwrap()
        .durable_revision = 2;
    fixture.filesystem.pause_staging();
    fixture
        .persistence
        .notify_durable_commit_without_thumbnail(4, 2);
    // Deliberately a blocking sleep: `pause_staging` leaves a runtime worker
    // blocked mid-poll inside `stage_atomic`'s sync condvar, which starves the
    // time driver — an async `tokio::time::sleep` here deadlocks because its
    // timer never fires. Every `pause_staging` test waits out real time this way.
    std::thread::sleep(AUTOSAVE_DEBOUNCE + Duration::from_millis(50));
    tokio::time::timeout(Duration::from_secs(2), fixture.filesystem.wait_for_stage())
        .await
        .unwrap();

    let exit = Arc::new(RecordingExit::default());
    fixture
        .persistence
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();
    tokio::task::yield_now().await;
    assert!(fixture.session.try_lock().is_ok());
    assert!(fixture.persistence.operation_gate.try_lock().is_err());
    assert!(exit.calls.lock().unwrap().is_empty());

    fixture.filesystem.release_staging();
    tokio::time::timeout(Duration::from_secs(1), exit.wait_for_call())
        .await
        .unwrap();
    assert_eq!(fixture.filesystem.installed_count(), 1);
}

// ---------------------------------------------------------------------------
// request_exit_flush noop when already saving
// ---------------------------------------------------------------------------

#[tokio::test]
async fn request_exit_flush_is_noop_when_already_saving() {
    let persistence = ApplicationPersistence::new();
    let exit = Arc::new(RecordingExit::default());
    // First request starts saving.
    persistence
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();
    // Second request while saving is a noop (returns Ok without scheduling).
    persistence
        .request_exit_flush(exit.clone(), ExitRequestSource::ApplicationQuit)
        .unwrap();
    // Only one exit call should happen.
    exit.wait_for_call().await;
    assert_eq!(*exit.calls.lock().unwrap(), vec![0]);
}

// ---------------------------------------------------------------------------
// retry_exit rejects stale token when status is not Failed
// ---------------------------------------------------------------------------

#[tokio::test]
async fn retry_exit_rejects_when_status_is_saving() {
    let persistence = ApplicationPersistence::new();
    let exit = Arc::new(RecordingExit::default());
    persistence
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();
    // While saving, retry_exit should fail because status is Saving, not Failed.
    let fake_token = PersistenceFailureTokenView::from_error(
        &GameError::save_write_failed()
            .with_failure_token("00000000-0000-4000-8000-000000000001".into()),
    )
    .unwrap();
    assert_eq!(
        persistence.retry_exit(exit, fake_token).unwrap_err().code,
        "stalePersistenceFailureToken"
    );
}

// ---------------------------------------------------------------------------
// exit_without_saving rejects when status is not Failed
// ---------------------------------------------------------------------------

#[tokio::test]
async fn exit_without_saving_rejects_when_status_is_idle() {
    let persistence = ApplicationPersistence::new();
    let exit = Arc::new(RecordingExit::default());
    let fake_token = PersistenceFailureTokenView::from_error(
        &GameError::save_write_failed()
            .with_failure_token("00000000-0000-4000-8000-000000000001".into()),
    )
    .unwrap();
    assert_eq!(
        persistence
            .exit_without_saving(exit, fake_token)
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

// ---------------------------------------------------------------------------
// exit_without_saving rejects when exit_action_in_progress
// ---------------------------------------------------------------------------

#[tokio::test]
async fn exit_without_saving_rejects_when_action_in_progress() {
    let persistence = ApplicationPersistence::new();
    // Force a failed exit first.
    persistence
        .request_exit_flush(Arc::new(FailingExit), ExitRequestSource::WindowClose)
        .unwrap();
    let token = tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if let ExitStatusView::Failed { failure_token, .. } = persistence.exit_status() {
                break failure_token;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    // Set exit_action_in_progress to simulate a concurrent bypass.
    persistence.state.lock().unwrap().exit_action_in_progress = true;
    let exit = Arc::new(RecordingExit::default());
    assert_eq!(
        persistence
            .exit_without_saving(exit, token)
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

// ---------------------------------------------------------------------------
// cancel_exit rejects during an in-progress exit_without_saving
//
// Verifies the end-to-end mutual-exclusion contract: while
// `exit_without_saving` is inside the external `exit()` call (having set
// `exit_action_in_progress = true` and released `exit_transition`),
// `cancel_exit` must not clear the challenge or roll the state back to
// `Idle`. In this scenario the rejection is observed via the preliminary
// `validate_current_exit_token`; the under-`exit_transition` recheck of
// `exit_action_in_progress` is defense-in-depth for the narrower window
// between that preliminary check and the lock acquisition (a few
// instructions with no await point, so not deterministically testable
// from outside).
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancel_exit_rejects_during_in_progress_exit_without_saving() {
    let persistence = ApplicationPersistence::new();
    persistence
        .request_exit_flush(Arc::new(FailingExit), ExitRequestSource::WindowClose)
        .unwrap();
    let token = tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if let ExitStatusView::Failed { failure_token, .. } = persistence.exit_status() {
                break failure_token;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();

    let reached = Arc::new(Notify::new());
    let release = Arc::new((Mutex::new(false), Condvar::new()));
    let blocking_exit = Arc::new(BlockingExit {
        reached: reached.clone(),
        release: release.clone(),
    });
    let persistence_for_task = persistence.clone();
    let token_for_task = token.clone();
    // Register the Notified future before spawning the blocking worker:
    // `notify_waiters()` only wakes `Notified` futures that already exist, so
    // if the worker enters `BlockingExit::exit()` and calls
    // `reached.notify_waiters()` before this future is created, the wakeup is
    // lost and the test hangs. Mirrors the ordering in
    // `TrackingFilesystem::wait_for_stage` and `RecordingExit::wait_for_call`.
    let reached_signal = reached.notified();
    let task = tokio::task::spawn_blocking(move || {
        persistence_for_task.exit_without_saving(blocking_exit, token_for_task)
    });
    reached_signal.await;
    // `exit_without_saving` has set `exit_action_in_progress = true` and is
    // blocked inside the external `exit()` call. `cancel_exit` must not
    // clear the challenge or switch the state back to `Idle` while the
    // external exit is already executing.
    //
    // Capture the observations while the external exit is in-flight, then
    // release/join the blocking worker BEFORE asserting. If a regression
    // makes `cancel_exit` succeed or the state assertions fail, panicking
    // before release would leave the `spawn_blocking` worker blocked on the
    // condvar indefinitely; Tokio cannot abort a started `spawn_blocking`
    // task and runtime shutdown waits forever for it, so the test job would
    // hang instead of reporting the failure.
    let cancel_result = persistence.cancel_exit(token);
    let observed_state = {
        let state = persistence.state.lock().unwrap();
        (
            state.exit_action_in_progress,
            matches!(state.exit_status, ExitStatusView::Failed { .. }),
        )
    };
    // Release the external exit; `exit_without_saving` should complete and
    // clear the flag.
    {
        let (lock, cvar) = &*release;
        let mut guard = lock.lock().unwrap();
        *guard = true;
        cvar.notify_all();
    }
    let outcome = task.await.unwrap();
    assert_eq!(
        cancel_result.unwrap_err().code,
        "stalePersistenceFailureToken"
    );
    assert!(observed_state.0);
    assert!(observed_state.1);
    assert!(outcome.is_ok());
    {
        let state = persistence.state.lock().unwrap();
        assert!(!state.exit_action_in_progress);
    }
}

// ---------------------------------------------------------------------------
// request_exit_flush no-ops when a terminal action is in progress
//
// Covers the `begin_exit_saving` half of the TOCTOU: the preliminary
// `validate_current_exit_token` in `retry_exit` (and the `Idle` check in
// `request_exit_flush`) run before `exit_transition` is acquired, so
// `begin_exit_saving` must recheck `exit_action_in_progress` under the lock
// and refuse to start a second terminal action.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn request_exit_flush_noops_when_action_in_progress() {
    let persistence = ApplicationPersistence::new();
    // Simulate a concurrent in-progress terminal action that has set the
    // mutual-exclusion flag but not yet changed `exit_status` (the window
    // `exit_without_saving` opens between its two `exit_transition` locks).
    persistence.state.lock().unwrap().exit_action_in_progress = true;
    let exit = Arc::new(RecordingExit::default());
    let result = persistence.request_exit_flush(exit.clone(), ExitRequestSource::WindowClose);
    assert!(
        result.is_ok(),
        "request_exit_flush should no-op via begin_exit_saving, got: {result:?}"
    );
    // `begin_exit_saving` must not have transitioned to `Saving` or cleared
    // the flag.
    let state = persistence.state.lock().unwrap();
    assert_eq!(state.exit_status, ExitStatusView::Idle);
    assert!(state.exit_action_in_progress);
    drop(state);
    // The spawned flush task never received a recovery (the oneshot sender
    // was dropped without sending), so the external exit was never called.
    assert!(exit.calls.lock().unwrap().is_empty());
}

// ---------------------------------------------------------------------------
// cancel_exit rejects when challenge doesn't match identity
// ---------------------------------------------------------------------------

#[tokio::test]
async fn cancel_exit_rejects_when_challenge_identity_mismatches() {
    let persistence = ApplicationPersistence::new();
    persistence
        .request_exit_flush(Arc::new(FailingExit), ExitRequestSource::WindowClose)
        .unwrap();
    let token = tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if let ExitStatusView::Failed { failure_token, .. } = persistence.exit_status() {
                break failure_token;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    // Advance the session generation so the challenge identity no longer matches.
    persistence.next_session_generation().unwrap();
    persistence.session.lock().unwrap().persistence.generation = 2;
    assert_eq!(
        persistence.cancel_exit(token).unwrap_err().code,
        "stalePersistenceFailureToken"
    );
}

// ---------------------------------------------------------------------------
// flush_for_exit succeeds when no engine is installed
// ---------------------------------------------------------------------------

#[tokio::test]
async fn flush_for_exit_succeeds_without_engine() {
    let persistence = ApplicationPersistence::new();
    // No engine installed, so flush_for_exit should return Ok(()).
    // We test this indirectly via request_exit_flush with a RecordingExit.
    let exit = Arc::new(RecordingExit::default());
    persistence
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();
    exit.wait_for_call().await;
    assert_eq!(*exit.calls.lock().unwrap(), vec![0]);
}
