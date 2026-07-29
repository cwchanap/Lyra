use super::super::{
    AppSession, ApplicationExit, CoordinatorTask, CoordinatorTaskScheduler, ExitRequestSource,
    ExitStatusView, FailureChallengeIdentity, FailureTokenSource, PersistenceBypassOperation,
    PersistenceFailureChallenge, PersistenceFailureTokenView, SaveCoordinator, AUTOSAVE_DEBOUNCE,
};
use super::acknowledgement::{app_with_event, terminal_acknowledgement_ticket};
use super::debounce::{PhasedBackend, RecordingBackend};
use crate::game::test_support::{empty_engine_with_scene, investigation_scene_with_intro};
use crate::AppState;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, Notify};
use uuid::Uuid;

#[derive(Default)]
struct RecordingExit {
    calls: Mutex<Vec<i32>>,
    called: Notify,
}

impl ApplicationExit for RecordingExit {
    fn exit(&self, code: i32) -> Result<(), crate::game::GameError> {
        self.calls.lock().unwrap().push(code);
        self.called.notify_waiters();
        Ok(())
    }
}

struct RejectingApplicationExit;

impl ApplicationExit for RejectingApplicationExit {
    fn exit(&self, _code: i32) -> Result<(), crate::game::GameError> {
        Err(crate::game::GameError::save_write_failed())
    }
}

struct LockProbeApplicationExit {
    coordinator: SaveCoordinator,
    session: Arc<Mutex<AppSession>>,
    called: Notify,
}

impl ApplicationExit for LockProbeApplicationExit {
    fn exit(&self, _code: i32) -> Result<(), crate::game::GameError> {
        assert!(
            self.coordinator.exit_transition.try_lock().is_ok(),
            "external exit action must not run under exit_transition"
        );
        assert!(
            self.session.try_lock().is_ok(),
            "external exit action must not run under S"
        );
        self.called.notify_one();
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

struct RejectingExitScheduler;

impl CoordinatorTaskScheduler for RejectingExitScheduler {
    fn spawn(&self, _task: CoordinatorTask) -> Result<(), crate::game::GameError> {
        Err(crate::game::GameError::save_write_failed())
    }
}

struct DroppingExitScheduler;

impl CoordinatorTaskScheduler for DroppingExitScheduler {
    fn spawn(&self, task: CoordinatorTask) -> Result<(), crate::game::GameError> {
        drop(task);
        Ok(())
    }
}

#[derive(Default)]
struct ControllableExitScheduler {
    worker: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl ControllableExitScheduler {
    fn take_worker(&self) -> tokio::task::JoinHandle<()> {
        self.worker
            .lock()
            .unwrap()
            .take()
            .expect("exit worker must have been scheduled")
    }
}

impl CoordinatorTaskScheduler for ControllableExitScheduler {
    fn spawn(&self, task: CoordinatorTask) -> Result<(), crate::game::GameError> {
        let mut worker = self.worker.lock().unwrap();
        let scheduled = tokio::spawn(task);
        if worker.is_none() {
            *worker = Some(scheduled);
        } else {
            // The generalized coordinator scheduler also receives
            // writer work nested beneath the controlled exit task.
            // Dropping its handle detaches it while retaining the
            // first task for the cancellation assertion.
            drop(scheduled);
        }
        Ok(())
    }
}

fn active_session(revision: u64) -> Arc<Mutex<AppSession>> {
    let mut engine = empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
    engine.durable_revision = revision;
    Arc::new(Mutex::new(AppSession::installed(engine, 4, None)))
}

fn advance_revision(session: &Arc<Mutex<AppSession>>, revision: u64) {
    session
        .lock()
        .unwrap()
        .engine
        .as_mut()
        .unwrap()
        .durable_revision = revision;
}

fn set_failure_tokens(coordinator: &SaveCoordinator, tokens: Vec<Uuid>) {
    coordinator.state.lock().unwrap().failure_token_source =
        FailureTokenSource::Deterministic(tokens.into());
}

fn assert_same_challenge(
    actual: &PersistenceFailureChallenge,
    expected: &PersistenceFailureChallenge,
) {
    assert_eq!(actual.token, expected.token);
    assert_eq!(actual.operation, expected.operation);
    assert_eq!(actual.session_generation, expected.session_generation);
    assert_eq!(actual.discovery_generation, expected.discovery_generation);
    assert_eq!(actual.durable_revision, expected.durable_revision);
    assert_eq!(actual.selected_save_id, expected.selected_save_id);
    assert_eq!(actual.acquisition_event_id, expected.acquisition_event_id);
}

fn status_receiver(coordinator: &SaveCoordinator) -> mpsc::UnboundedReceiver<ExitStatusView> {
    let (tx, rx) = mpsc::unbounded_channel();
    coordinator.subscribe_exit_status(move |status| {
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
}

#[test]
fn exit_lifecycle_request_without_application_context_stays_idle() {
    let coordinator = SaveCoordinator::new();

    assert_eq!(
        coordinator
            .request_exit_flush(
                Arc::new(RecordingExit::default()),
                ExitRequestSource::WindowClose,
            )
            .unwrap_err()
            .code,
        "saveWriteFailed"
    );

    assert_eq!(coordinator.exit_status(), ExitStatusView::Idle);
}

#[tokio::test]
async fn exit_lifecycle_repeated_native_requests_share_one_noop_flush_and_one_exit_bypass() {
    let engine = empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
    let session = Arc::new(Mutex::new(AppSession::installed(engine, 4, None)));
    let replacement_gate = Arc::new(tokio::sync::Mutex::new(()));
    let coordinator = SaveCoordinator::for_application(Arc::clone(&session), replacement_gate);
    let exit = Arc::new(RecordingExit::default());

    coordinator
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();
    coordinator
        .request_exit_flush(exit.clone(), ExitRequestSource::ApplicationQuit)
        .unwrap();
    exit.wait_for_call().await;

    assert_eq!(*exit.calls.lock().unwrap(), vec![0]);
    assert_eq!(coordinator.exit_status(), ExitStatusView::Saving);
    assert!(coordinator.consume_programmatic_exit_bypass());
    assert!(!coordinator.consume_programmatic_exit_bypass());
}

#[tokio::test(flavor = "multi_thread")]
async fn exit_lifecycle_plain_thread_request_still_schedules_and_exits_once() {
    let engine = empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
    let session = Arc::new(Mutex::new(AppSession::installed(engine, 4, None)));
    let replacement_gate = Arc::new(tokio::sync::Mutex::new(()));
    let coordinator = SaveCoordinator::for_application(Arc::clone(&session), replacement_gate);
    let exit = Arc::new(RecordingExit::default());
    let thread_coordinator = coordinator.clone();
    let thread_exit = exit.clone();

    std::thread::spawn(move || {
        thread_coordinator
            .request_exit_flush(thread_exit, ExitRequestSource::WindowClose)
            .unwrap();
    })
    .join()
    .unwrap();

    tokio::time::timeout(Duration::from_secs(1), exit.wait_for_call())
        .await
        .expect("exit flush scheduled outside a caller-local Tokio runtime");
    assert_eq!(*exit.calls.lock().unwrap(), vec![0]);
}

#[tokio::test]
async fn exit_lifecycle_releases_transition_and_session_before_external_exit_action() {
    let engine = empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
    let session = Arc::new(Mutex::new(AppSession::installed(engine, 4, None)));
    let coordinator = SaveCoordinator::for_application(
        Arc::clone(&session),
        Arc::new(tokio::sync::Mutex::new(())),
    );
    let exit = Arc::new(LockProbeApplicationExit {
        coordinator: coordinator.clone(),
        session,
        called: Notify::new(),
    });

    coordinator
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();
    exit.called.notified().await;
}

#[test]
fn exit_lifecycle_scheduler_rejection_restores_idle_and_session_admission() {
    let engine = empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
    let session = Arc::new(Mutex::new(AppSession::installed(engine, 4, None)));
    let replacement_gate = Arc::new(tokio::sync::Mutex::new(()));
    let coordinator = SaveCoordinator::for_application(Arc::clone(&session), replacement_gate)
        .with_task_scheduler(Arc::new(RejectingExitScheduler));

    assert_eq!(
        coordinator
            .request_exit_flush(
                Arc::new(RecordingExit::default()),
                ExitRequestSource::WindowClose,
            )
            .unwrap_err()
            .code,
        "saveWriteFailed"
    );

    assert_eq!(coordinator.exit_status(), ExitStatusView::Idle);
    assert!(!session.lock().unwrap().persistence.exit_flush_requested);
    assert!(session
        .lock()
        .unwrap()
        .ensure_persistence_available()
        .is_ok());
}

#[test]
fn exit_lifecycle_dropped_start_gate_restores_idle_synchronously() {
    let session = active_session(1);
    let coordinator = SaveCoordinator::for_application(
        Arc::clone(&session),
        Arc::new(tokio::sync::Mutex::new(())),
    )
    .with_task_scheduler(Arc::new(DroppingExitScheduler));

    assert_eq!(
        coordinator
            .request_exit_flush(
                Arc::new(RecordingExit::default()),
                ExitRequestSource::WindowClose,
            )
            .unwrap_err()
            .code,
        "saveWriteFailed"
    );
    assert_eq!(coordinator.exit_status(), ExitStatusView::Idle);
    assert!(!session.lock().unwrap().persistence.exit_flush_requested);
    assert!(session
        .lock()
        .unwrap()
        .ensure_persistence_available()
        .is_ok());
}

#[tokio::test]
async fn exit_lifecycle_cancelled_initial_worker_restores_idle_and_session_admission() {
    let backend = Arc::new(PhasedBackend::new(4));
    backend.pause_prepare();
    let session = active_session(1);
    advance_revision(&session, 2);
    let scheduler = Arc::new(ControllableExitScheduler::default());
    let coordinator = SaveCoordinator::with_backend_for_application(
        backend.clone(),
        Arc::clone(&session),
        Arc::new(tokio::sync::Mutex::new(())),
    )
    .with_task_scheduler(scheduler.clone());
    let exit = Arc::new(RecordingExit::default());

    coordinator
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();
    backend.wait_for_prepare().await;

    assert!(
        coordinator.exit_transition.try_lock().is_ok(),
        "blocked exit worker must not hold exit_transition"
    );
    assert!(
        session.try_lock().is_ok(),
        "blocked exit worker must not hold S"
    );
    let worker = scheduler.take_worker();
    worker.abort();
    assert!(worker.await.unwrap_err().is_cancelled());

    assert_eq!(coordinator.exit_status(), ExitStatusView::Idle);
    assert!(!session.lock().unwrap().persistence.exit_flush_requested);
    assert!(session
        .lock()
        .unwrap()
        .ensure_persistence_available()
        .is_ok());
    assert!(exit.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn exit_lifecycle_cancelled_retry_restores_exact_failed_status_and_challenge() {
    let backend = Arc::new(PhasedBackend::new(4));
    backend.fail_next_commit();
    let session = active_session(1);
    advance_revision(&session, 2);
    let coordinator = SaveCoordinator::with_backend_for_application(
        backend.clone(),
        Arc::clone(&session),
        Arc::new(tokio::sync::Mutex::new(())),
    );
    let mut statuses = status_receiver(&coordinator);
    let exit = Arc::new(RecordingExit::default());
    coordinator
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();
    assert_eq!(statuses.recv().await.unwrap(), ExitStatusView::Saving);
    backend.wait_for_failed_commits(1).await;
    let failed = statuses.recv().await.unwrap();
    let ExitStatusView::Failed { failure_token, .. } = &failed else {
        panic!("initial exit attempt must publish a failed token");
    };
    assert_eq!(
        coordinator.state.lock().unwrap().failure_challenges.len(),
        1
    );

    backend.pause_prepare();
    let scheduler = Arc::new(ControllableExitScheduler::default());
    let retrying = coordinator.clone().with_task_scheduler(scheduler.clone());
    retrying
        .retry_exit(exit.clone(), failure_token.clone())
        .unwrap();
    assert_eq!(statuses.recv().await.unwrap(), ExitStatusView::Saving);
    backend.wait_for_prepare_count(2).await;

    assert!(
        retrying.exit_transition.try_lock().is_ok(),
        "blocked retry worker must not hold exit_transition"
    );
    assert!(
        session.try_lock().is_ok(),
        "blocked retry worker must not hold S"
    );
    let worker = scheduler.take_worker();
    worker.abort();
    assert!(worker.await.unwrap_err().is_cancelled());

    assert_eq!(
        serde_json::to_value(retrying.exit_status()).unwrap(),
        serde_json::to_value(&failed).unwrap()
    );
    assert!(session.lock().unwrap().persistence.exit_flush_requested);
    assert_eq!(retrying.state.lock().unwrap().failure_challenges.len(), 1);
    assert_eq!(
        retrying.cancel_exit(failure_token.clone()).unwrap(),
        ExitStatusView::Idle
    );
    assert_eq!(
        retrying
            .cancel_exit(failure_token.clone())
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
    assert!(exit.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn exit_lifecycle_retry_recovery_collision_restores_prior_authority_only() {
    let issued = Uuid::parse_str("00000000-0000-4000-8000-000000000011").unwrap();
    let unrelated = Uuid::parse_str("00000000-0000-4000-8000-000000000012").unwrap();
    let backend = Arc::new(PhasedBackend::new(4));
    backend.fail_next_commit();
    let session = active_session(1);
    advance_revision(&session, 2);
    let coordinator = SaveCoordinator::with_backend_for_application(
        backend.clone(),
        Arc::clone(&session),
        Arc::new(tokio::sync::Mutex::new(())),
    );
    set_failure_tokens(&coordinator, vec![issued]);
    let mut statuses = status_receiver(&coordinator);
    let exit = Arc::new(RecordingExit::default());
    coordinator
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();
    assert_eq!(statuses.recv().await.unwrap(), ExitStatusView::Saving);
    backend.wait_for_failed_commits(1).await;
    let failed = statuses.recv().await.unwrap();
    let ExitStatusView::Failed { failure_token, .. } = &failed else {
        panic!("initial exit attempt must publish a failed token");
    };
    assert_eq!(Uuid::parse_str(&failure_token.0).unwrap(), issued);

    backend.pause_prepare();
    let scheduler = Arc::new(ControllableExitScheduler::default());
    let retrying = coordinator.clone().with_task_scheduler(scheduler.clone());
    retrying
        .retry_exit(exit.clone(), failure_token.clone())
        .unwrap();
    assert_eq!(statuses.recv().await.unwrap(), ExitStatusView::Saving);
    backend.wait_for_prepare_count(2).await;

    let unrelated_challenge = PersistenceFailureChallenge {
        token: unrelated,
        operation: PersistenceBypassOperation::StartWithoutSaving,
        session_generation: 4,
        discovery_generation: None,
        durable_revision: 2,
        selected_save_id: Some("unrelated-save".into()),
        acquisition_event_id: Some("unrelated-event".into()),
    };
    {
        let mut state = retrying.state.lock().unwrap();
        state.failure_challenges.insert(
            issued,
            PersistenceFailureChallenge {
                token: issued,
                operation: PersistenceBypassOperation::ContinueWithoutSaving,
                session_generation: 900,
                discovery_generation: Some(901),
                durable_revision: 902,
                selected_save_id: Some("conflicting-save".into()),
                acquisition_event_id: Some("conflicting-event".into()),
            },
        );
        state
            .failure_challenges
            .insert(unrelated, unrelated_challenge.clone());
    }

    let worker = scheduler.take_worker();
    worker.abort();
    assert!(worker.await.unwrap_err().is_cancelled());

    assert_eq!(
        serde_json::to_value(retrying.exit_status()).unwrap(),
        serde_json::to_value(&failed).unwrap()
    );
    assert!(session.lock().unwrap().persistence.exit_flush_requested);
    let restored = statuses.recv().await.unwrap();
    assert_eq!(
        serde_json::to_value(&restored).unwrap(),
        serde_json::to_value(&failed).unwrap()
    );
    {
        let state = retrying.state.lock().unwrap();
        assert_eq!(state.failure_challenges.len(), 2);
        let restored_issued = state.failure_challenges.get(&issued).unwrap();
        assert_eq!(
            restored_issued.operation,
            PersistenceBypassOperation::ExitWithoutSaving
        );
        assert_eq!(restored_issued.session_generation, 4);
        assert_eq!(restored_issued.discovery_generation, None);
        assert_eq!(restored_issued.durable_revision, 2);
        assert_eq!(restored_issued.selected_save_id, None);
        assert_eq!(restored_issued.acquisition_event_id, None);
        assert_same_challenge(
            state.failure_challenges.get(&unrelated).unwrap(),
            &unrelated_challenge,
        );
    }

    assert_eq!(
        retrying.cancel_exit(failure_token.clone()).unwrap(),
        ExitStatusView::Idle
    );
    assert_eq!(
        retrying
            .cancel_exit(failure_token.clone())
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
    let unrelated_token = PersistenceFailureTokenView(unrelated.hyphenated().to_string());
    retrying
        .cancel_failure_token(
            &unrelated_token,
            PersistenceBypassOperation::StartWithoutSaving,
            FailureChallengeIdentity {
                session_generation: 4,
                discovery_generation: None,
                durable_revision: 2,
                selected_save_id: Some("unrelated-save"),
                acquisition_event_id: Some("unrelated-event"),
            },
        )
        .unwrap();
    assert!(retrying.state.lock().unwrap().failure_challenges.is_empty());
    assert!(exit.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn exit_lifecycle_panicking_initial_worker_unwinds_to_idle_and_can_retry() {
    let session = active_session(1);
    let scheduler = Arc::new(ControllableExitScheduler::default());
    let coordinator = SaveCoordinator::for_application(
        Arc::clone(&session),
        Arc::new(tokio::sync::Mutex::new(())),
    )
    .with_task_scheduler(scheduler.clone());
    coordinator.panic_next_exit_worker_for_test();
    let exit = Arc::new(RecordingExit::default());

    coordinator
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();
    let worker = scheduler.take_worker();
    let panic = worker.await.unwrap_err();
    assert!(panic.is_panic());
    assert!(!panic.is_cancelled());

    assert_eq!(coordinator.exit_status(), ExitStatusView::Idle);
    assert!(!session.lock().unwrap().persistence.exit_flush_requested);
    assert!(session
        .lock()
        .unwrap()
        .ensure_persistence_available()
        .is_ok());

    coordinator
        .request_exit_flush(exit.clone(), ExitRequestSource::ApplicationQuit)
        .unwrap();
    exit.wait_for_call().await;
    scheduler.take_worker().await.unwrap();
    assert_eq!(*exit.calls.lock().unwrap(), vec![0]);
}

#[test]
fn exit_lifecycle_prerequisite_failure_does_not_arm_saving() {
    let engine = empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
    let session = Arc::new(Mutex::new(AppSession::installed(engine, 4, None)));
    let replacement_gate = Arc::new(tokio::sync::Mutex::new(()));
    let coordinator = SaveCoordinator::for_application(Arc::clone(&session), replacement_gate);
    coordinator.fail_next_exit_prerequisite_for_test();
    let exit = Arc::new(RecordingExit::default());

    let error = coordinator
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap_err();

    assert_eq!(error.code, "saveWriteFailed");
    assert_eq!(coordinator.exit_status(), ExitStatusView::Idle);
    assert!(!session.lock().unwrap().persistence.exit_flush_requested);
    assert!(exit.calls.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn exit_lifecycle_waits_for_an_active_writer_without_holding_session_or_gate() {
    let backend = Arc::new(RecordingBackend::paused());
    let session = active_session(1);
    let replacement_gate = Arc::new(tokio::sync::Mutex::new(()));
    let coordinator = SaveCoordinator::with_backend_for_application(
        backend.clone(),
        Arc::clone(&session),
        Arc::clone(&replacement_gate),
    );
    advance_revision(&session, 2);
    let request = coordinator.notify_durable_commit(4, 2).unwrap();
    coordinator
        .report_thumbnail_failure(&request.ticket)
        .unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_until_started().await;

    let exit = Arc::new(RecordingExit::default());
    coordinator
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();

    assert!(session.try_lock().is_ok());
    assert!(replacement_gate.try_lock().is_ok());
    assert_eq!(
        session
            .lock()
            .unwrap()
            .ensure_persistence_available()
            .unwrap_err()
            .code,
        "persistenceOperationInProgress"
    );
    assert!(session
        .lock()
        .unwrap()
        .engine
        .as_ref()
        .unwrap()
        .view()
        .is_ok());
    assert!(exit.calls.lock().unwrap().is_empty());

    backend.release();
    exit.wait_for_call().await;

    assert_eq!(backend.write_count(), 1);
    assert_eq!(*exit.calls.lock().unwrap(), vec![0]);
}

#[tokio::test(start_paused = true)]
async fn exit_lifecycle_supersedes_pending_debounce_without_waiting_for_its_deadline() {
    let backend = Arc::new(RecordingBackend::default());
    let session = active_session(1);
    let coordinator = SaveCoordinator::with_backend_for_application(
        backend.clone(),
        Arc::clone(&session),
        Arc::new(tokio::sync::Mutex::new(())),
    );
    advance_revision(&session, 2);
    let request = coordinator.notify_durable_commit(4, 2).unwrap();
    coordinator
        .report_thumbnail_failure(&request.ticket)
        .unwrap();

    let exit = Arc::new(RecordingExit::default());
    coordinator
        .request_exit_flush(exit.clone(), ExitRequestSource::ApplicationQuit)
        .unwrap();
    exit.wait_for_call().await;

    assert_eq!(backend.write_count(), 1);
    assert_eq!(*exit.calls.lock().unwrap(), vec![0]);
}

#[tokio::test]
async fn exit_lifecycle_failure_publishes_complete_status_and_cancel_consumes_exact_token() {
    let backend = Arc::new(PhasedBackend::new(4));
    backend.fail_next_commit();
    let session = active_session(1);
    advance_revision(&session, 2);
    let replacement_gate = Arc::new(tokio::sync::Mutex::new(()));
    let coordinator = SaveCoordinator::with_backend_for_application(
        backend.clone(),
        Arc::clone(&session),
        Arc::clone(&replacement_gate),
    );
    let app = AppState {
        session,
        replacement_gate,
        coordinator: coordinator.clone(),
        resources_dir: PathBuf::new(),
        save_root: PathBuf::new(),
        persistence: None,
    };
    let mut statuses = status_receiver(&coordinator);
    let exit = Arc::new(RecordingExit::default());

    coordinator
        .request_exit_flush(exit.clone(), ExitRequestSource::ApplicationQuit)
        .unwrap();
    assert_eq!(statuses.recv().await.unwrap(), ExitStatusView::Saving);
    backend.wait_for_failed_commits(1).await;
    let failed = statuses.recv().await.unwrap();
    let ExitStatusView::Failed {
        diagnostic,
        failure_token,
    } = failed
    else {
        panic!("exit failure must publish a complete failed status");
    };
    assert_eq!(diagnostic.code, "saveReplaceFailed");
    assert!(exit.calls.lock().unwrap().is_empty());
    assert_eq!(
        coordinator
            .cancel_persistence_failure(&app, failure_token.clone())
            .await
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
    assert!(matches!(
        coordinator.exit_status(),
        ExitStatusView::Failed {
            failure_token: ref current,
            ..
        } if current == &failure_token
    ));

    let wrong: PersistenceFailureTokenView =
        serde_json::from_value(serde_json::json!("00000000-0000-4000-8000-000000000000")).unwrap();
    assert_eq!(
        coordinator.cancel_exit(wrong).unwrap_err().code,
        "stalePersistenceFailureToken"
    );
    assert_eq!(
        coordinator.cancel_exit(failure_token.clone()).unwrap(),
        ExitStatusView::Idle
    );
    assert_eq!(statuses.recv().await.unwrap(), ExitStatusView::Idle);
    assert_eq!(
        coordinator.cancel_exit(failure_token).unwrap_err().code,
        "stalePersistenceFailureToken"
    );
    assert!(exit.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn exit_lifecycle_failure_token_collision_reserves_a_new_matching_challenge() {
    let occupied = Uuid::parse_str("00000000-0000-4000-8000-000000000001").unwrap();
    let unique = Uuid::parse_str("00000000-0000-4000-8000-000000000002").unwrap();
    let backend = Arc::new(PhasedBackend::new(4));
    backend.fail_next_commit();
    let session = active_session(1);
    advance_revision(&session, 2);
    let coordinator = SaveCoordinator::with_backend_for_application(
        backend.clone(),
        Arc::clone(&session),
        Arc::new(tokio::sync::Mutex::new(())),
    );
    set_failure_tokens(&coordinator, vec![occupied, unique]);
    let identity = FailureChallengeIdentity {
        session_generation: 4,
        discovery_generation: None,
        durable_revision: 2,
        selected_save_id: None,
        acquisition_event_id: None,
    };
    let original_token = PersistenceFailureTokenView(occupied.hyphenated().to_string());
    coordinator.state.lock().unwrap().failure_challenges.insert(
        occupied,
        PersistenceFailureChallenge {
            token: occupied,
            operation: PersistenceBypassOperation::StartWithoutSaving,
            session_generation: identity.session_generation,
            discovery_generation: identity.discovery_generation,
            durable_revision: identity.durable_revision,
            selected_save_id: None,
            acquisition_event_id: None,
        },
    );

    let mut statuses = status_receiver(&coordinator);
    let exit = Arc::new(RecordingExit::default());
    coordinator
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();
    assert_eq!(statuses.recv().await.unwrap(), ExitStatusView::Saving);
    backend.wait_for_failed_commits(1).await;
    let failed = statuses.recv().await.unwrap();
    let ExitStatusView::Failed {
        failure_token: exit_token,
        ..
    } = failed
    else {
        panic!("exit failure must publish a complete failed status");
    };

    assert_eq!(Uuid::parse_str(&exit_token.0).unwrap(), unique);
    assert_eq!(
        coordinator.state.lock().unwrap().failure_challenges.len(),
        2
    );
    coordinator
        .cancel_failure_token(
            &original_token,
            PersistenceBypassOperation::StartWithoutSaving,
            identity,
        )
        .unwrap();
    assert_eq!(
        coordinator
            .cancel_failure_token(
                &original_token,
                PersistenceBypassOperation::StartWithoutSaving,
                identity,
            )
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
    assert_eq!(
        coordinator.cancel_exit(exit_token.clone()).unwrap(),
        ExitStatusView::Idle
    );
    assert_eq!(
        coordinator.cancel_exit(exit_token).unwrap_err().code,
        "stalePersistenceFailureToken"
    );
    assert!(exit.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn exit_lifecycle_retry_start_gate_failure_preserves_exact_failed_token() {
    let backend = Arc::new(PhasedBackend::new(4));
    backend.fail_next_commit();
    let session = active_session(1);
    advance_revision(&session, 2);
    let coordinator = SaveCoordinator::with_backend_for_application(
        backend.clone(),
        session,
        Arc::new(tokio::sync::Mutex::new(())),
    );
    let mut statuses = status_receiver(&coordinator);
    let exit = Arc::new(RecordingExit::default());
    coordinator
        .request_exit_flush(exit.clone(), ExitRequestSource::ApplicationQuit)
        .unwrap();
    assert_eq!(statuses.recv().await.unwrap(), ExitStatusView::Saving);
    backend.wait_for_failed_commits(1).await;
    let failed = statuses.recv().await.unwrap();
    let ExitStatusView::Failed { failure_token, .. } = &failed else {
        panic!("exit flush must publish a failed token");
    };
    let rejecting = coordinator
        .clone()
        .with_task_scheduler(Arc::new(DroppingExitScheduler));

    let error = rejecting
        .retry_exit(exit.clone(), failure_token.clone())
        .unwrap_err();

    assert_eq!(error.code, "saveWriteFailed");
    assert_eq!(
        serde_json::to_value(rejecting.exit_status()).unwrap(),
        serde_json::to_value(&failed).unwrap()
    );
    assert_eq!(
        rejecting.cancel_exit(failure_token.clone()).unwrap(),
        ExitStatusView::Idle
    );
    assert!(exit.calls.lock().unwrap().is_empty());
    assert_eq!(
        rejecting
            .cancel_exit(failure_token.clone())
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

#[tokio::test]
async fn exit_lifecycle_cancel_guard_clear_failure_preserves_exact_failed_token() {
    let backend = Arc::new(PhasedBackend::new(4));
    backend.fail_next_commit();
    let session = active_session(1);
    advance_revision(&session, 2);
    let coordinator = SaveCoordinator::with_backend_for_application(
        backend.clone(),
        session,
        Arc::new(tokio::sync::Mutex::new(())),
    );
    let mut statuses = status_receiver(&coordinator);
    let exit = Arc::new(RecordingExit::default());
    coordinator
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();
    assert_eq!(statuses.recv().await.unwrap(), ExitStatusView::Saving);
    backend.wait_for_failed_commits(1).await;
    let failed = statuses.recv().await.unwrap();
    let ExitStatusView::Failed { failure_token, .. } = &failed else {
        panic!("exit flush must publish a failed token");
    };
    coordinator.fail_next_cancel_guard_clear_for_test();

    let error = coordinator.cancel_exit(failure_token.clone()).unwrap_err();

    assert_eq!(error.code, "saveWriteFailed");
    assert_eq!(
        serde_json::to_value(coordinator.exit_status()).unwrap(),
        serde_json::to_value(&failed).unwrap()
    );
    assert_eq!(
        coordinator.cancel_exit(failure_token.clone()).unwrap(),
        ExitStatusView::Idle
    );
    assert_eq!(
        coordinator
            .cancel_exit(failure_token.clone())
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
    assert!(exit.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn exit_lifecycle_without_saving_action_failure_preserves_exact_failed_token() {
    let backend = Arc::new(PhasedBackend::new(4));
    backend.fail_next_commit();
    let session = active_session(1);
    advance_revision(&session, 2);
    let coordinator = SaveCoordinator::with_backend_for_application(
        backend.clone(),
        session,
        Arc::new(tokio::sync::Mutex::new(())),
    );
    let mut statuses = status_receiver(&coordinator);
    let exit = Arc::new(RecordingExit::default());
    coordinator
        .request_exit_flush(exit.clone(), ExitRequestSource::ApplicationQuit)
        .unwrap();
    assert_eq!(statuses.recv().await.unwrap(), ExitStatusView::Saving);
    backend.wait_for_failed_commits(1).await;
    let failed = statuses.recv().await.unwrap();
    let ExitStatusView::Failed { failure_token, .. } = &failed else {
        panic!("exit flush must publish a failed token");
    };

    let error = coordinator
        .exit_without_saving(Arc::new(RejectingApplicationExit), failure_token.clone())
        .unwrap_err();

    assert_eq!(error.code, "saveWriteFailed");
    assert_eq!(
        serde_json::to_value(coordinator.exit_status()).unwrap(),
        serde_json::to_value(&failed).unwrap()
    );
    assert!(!coordinator.consume_programmatic_exit_bypass());
    coordinator
        .exit_without_saving(exit.clone(), failure_token.clone())
        .unwrap();
    assert_eq!(*exit.calls.lock().unwrap(), vec![0]);
    assert!(coordinator.consume_programmatic_exit_bypass());
    assert_eq!(
        coordinator
            .exit_without_saving(exit, failure_token.clone())
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

#[tokio::test]
async fn exit_lifecycle_challenge_publication_failure_restores_recoverable_idle() {
    let backend = Arc::new(PhasedBackend::new(4));
    backend.fail_next_commit();
    let session = active_session(1);
    advance_revision(&session, 2);
    let coordinator = SaveCoordinator::with_backend_for_application(
        backend.clone(),
        Arc::clone(&session),
        Arc::new(tokio::sync::Mutex::new(())),
    );
    coordinator.fail_next_exit_challenge_for_test();
    let mut statuses = status_receiver(&coordinator);
    let exit = Arc::new(RecordingExit::default());

    coordinator
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();
    assert_eq!(statuses.recv().await.unwrap(), ExitStatusView::Saving);
    backend.wait_for_failed_commits(1).await;
    assert_eq!(statuses.recv().await.unwrap(), ExitStatusView::Idle);
    assert!(!session.lock().unwrap().persistence.exit_flush_requested);
    assert!(exit.calls.lock().unwrap().is_empty());

    coordinator
        .request_exit_flush(exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();
    assert_eq!(statuses.recv().await.unwrap(), ExitStatusView::Saving);
    exit.wait_for_call().await;
    assert_eq!(*exit.calls.lock().unwrap(), vec![0]);
}

#[tokio::test]
async fn exit_lifecycle_retry_and_without_saving_each_consume_one_exact_challenge() {
    let retry_backend = Arc::new(PhasedBackend::new(4));
    retry_backend.fail_next_commit();
    let retry_session = active_session(1);
    advance_revision(&retry_session, 2);
    let retry_coordinator = SaveCoordinator::with_backend_for_application(
        retry_backend.clone(),
        retry_session,
        Arc::new(tokio::sync::Mutex::new(())),
    );
    let mut retry_statuses = status_receiver(&retry_coordinator);
    let retry_exit = Arc::new(RecordingExit::default());
    retry_coordinator
        .request_exit_flush(retry_exit.clone(), ExitRequestSource::WindowClose)
        .unwrap();
    assert_eq!(retry_statuses.recv().await.unwrap(), ExitStatusView::Saving);
    retry_backend.wait_for_failed_commits(1).await;
    let ExitStatusView::Failed {
        failure_token: retry_token,
        ..
    } = retry_statuses.recv().await.unwrap()
    else {
        panic!("first exit flush must fail");
    };

    retry_coordinator
        .retry_exit(retry_exit.clone(), retry_token.clone())
        .unwrap();
    assert_eq!(retry_statuses.recv().await.unwrap(), ExitStatusView::Saving);
    retry_exit.wait_for_call().await;
    assert_eq!(*retry_exit.calls.lock().unwrap(), vec![0]);
    assert_eq!(
        retry_coordinator
            .retry_exit(retry_exit, retry_token)
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );

    let bypass_backend = Arc::new(PhasedBackend::new(4));
    bypass_backend.fail_next_commit();
    let bypass_session = active_session(1);
    advance_revision(&bypass_session, 2);
    let bypass_coordinator = SaveCoordinator::with_backend_for_application(
        bypass_backend.clone(),
        bypass_session,
        Arc::new(tokio::sync::Mutex::new(())),
    );
    let mut bypass_statuses = status_receiver(&bypass_coordinator);
    let bypass_exit = Arc::new(RecordingExit::default());
    bypass_coordinator
        .request_exit_flush(bypass_exit.clone(), ExitRequestSource::ApplicationQuit)
        .unwrap();
    assert_eq!(
        bypass_statuses.recv().await.unwrap(),
        ExitStatusView::Saving
    );
    bypass_backend.wait_for_failed_commits(1).await;
    let ExitStatusView::Failed {
        failure_token: bypass_token,
        ..
    } = bypass_statuses.recv().await.unwrap()
    else {
        panic!("exit flush must fail before bypass");
    };

    bypass_coordinator
        .exit_without_saving(bypass_exit.clone(), bypass_token.clone())
        .unwrap();
    bypass_exit.wait_for_call().await;
    assert_eq!(*bypass_exit.calls.lock().unwrap(), vec![0]);
    assert!(bypass_coordinator.consume_programmatic_exit_bypass());
    assert_eq!(
        bypass_coordinator
            .exit_without_saving(bypass_exit, bypass_token)
            .unwrap_err()
            .code,
        "stalePersistenceFailureToken"
    );
}

#[tokio::test]
async fn exit_lifecycle_waits_for_active_acknowledgement_to_commit_before_flushing() {
    let backend = Arc::new(PhasedBackend::new(4));
    backend.pause_prepare();
    let base = SaveCoordinator::with_backend(backend.clone());
    let event_id = "acq:1:0";
    let app = Arc::new(app_with_event(base.clone(), 4, 1, event_id, None));
    let coordinator =
        base.with_exit_application(Arc::clone(&app.session), Arc::clone(&app.replacement_gate));
    let ticket = terminal_acknowledgement_ticket(&coordinator, 4, 1, event_id);
    let acknowledgement = {
        let coordinator = coordinator.clone();
        let app = Arc::clone(&app);
        tokio::spawn(async move {
            coordinator
                .acknowledge_acquisition(&app, event_id.into(), ticket)
                .await
        })
    };
    backend.wait_for_prepare().await;

    let exit = Arc::new(RecordingExit::default());
    coordinator
        .request_exit_flush(exit.clone(), ExitRequestSource::ApplicationQuit)
        .unwrap();

    assert_eq!(coordinator.exit_status(), ExitStatusView::Saving);
    assert!(app.session.try_lock().is_ok());
    assert!(exit.calls.lock().unwrap().is_empty());

    backend.release_prepare();
    acknowledgement.await.unwrap().unwrap();
    exit.wait_for_call().await;

    assert!(app
        .session
        .lock()
        .unwrap()
        .engine
        .as_ref()
        .unwrap()
        .pending_acquisition_events
        .is_empty());
    assert_eq!(backend.registered_targets().len(), 1);
    assert_eq!(*exit.calls.lock().unwrap(), vec![0]);
}
