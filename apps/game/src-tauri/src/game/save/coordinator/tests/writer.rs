use super::super::{
    CoordinatorTask, CoordinatorTaskScheduler, SaveCoordinator, WriterJobClass, WriterQueueProbe,
};
use crate::game::GameError;
use std::sync::Arc;

struct RejectingTaskScheduler;

impl CoordinatorTaskScheduler for RejectingTaskScheduler {
    fn spawn(&self, _task: CoordinatorTask) -> Result<(), GameError> {
        Err(GameError::save_write_failed())
    }
}

#[test]
fn scheduler_rejection_does_not_retain_an_unstarted_writer_job() {
    let coordinator = SaveCoordinator::new().with_task_scheduler(Arc::new(RejectingTaskScheduler));

    assert_eq!(
        coordinator
            .reserve_manual_writer(Box::pin(async {}))
            .unwrap_err()
            .code,
        "saveWriteFailed"
    );

    let state = coordinator.writer_queue.state.lock().unwrap();
    assert!(!state.running);
    assert!(state.acknowledgements.is_empty());
    assert!(state.ordinary.is_empty());
}

#[tokio::test]
async fn one_writer_runs_at_a_time_and_acknowledgement_is_reserved_next() {
    let coordinator = SaveCoordinator::new();
    let probe = Arc::new(WriterQueueProbe::paused());

    coordinator.enqueue_writer_probe(
        WriterJobClass::Debounced {
            session_generation: 1,
            durable_revision: 1,
        },
        "current",
        probe.clone(),
    );
    probe.wait_until_started("current").await;
    coordinator.enqueue_writer_probe(
        WriterJobClass::Debounced {
            session_generation: 1,
            durable_revision: 2,
        },
        "later-debounce",
        probe.clone(),
    );
    let acknowledgement_probe = probe.clone();
    coordinator
        .reserve_acknowledgement_writer(Box::pin(async move {
            acknowledgement_probe.run("acknowledgement").await;
        }))
        .unwrap();

    probe.release_all();
    probe.wait_for_completions(3).await;

    assert_eq!(
        probe.started_labels(),
        ["current", "acknowledgement", "later-debounce"]
    );
    assert_eq!(probe.max_concurrent(), 1);
}

#[tokio::test]
async fn superseded_debounce_is_removed_before_it_can_enter_writer_turn() {
    let coordinator = SaveCoordinator::new();
    let probe = Arc::new(WriterQueueProbe::paused());

    let current_probe = probe.clone();
    coordinator
        .reserve_acknowledgement_writer(Box::pin(async move {
            current_probe.run("current").await;
        }))
        .unwrap();
    probe.wait_until_started("current").await;
    coordinator.enqueue_writer_probe(
        WriterJobClass::Debounced {
            session_generation: 4,
            durable_revision: 10,
        },
        "superseded",
        probe.clone(),
    );
    coordinator.enqueue_writer_probe(
        WriterJobClass::Debounced {
            session_generation: 4,
            durable_revision: 11,
        },
        "newest",
        probe.clone(),
    );

    probe.release_all();
    probe.wait_for_completions(2).await;

    assert_eq!(probe.started_labels(), ["current", "newest"]);
}

#[tokio::test]
async fn queued_writer_runs_only_after_the_current_writer_completes() {
    let coordinator = SaveCoordinator::new();
    let probe = Arc::new(WriterQueueProbe::paused());

    let current_probe = probe.clone();
    coordinator
        .reserve_acknowledgement_writer(Box::pin(async move {
            current_probe.run("current").await;
        }))
        .unwrap();
    probe.wait_until_started("current").await;
    coordinator.enqueue_writer_probe(
        WriterJobClass::Debounced {
            session_generation: 1,
            durable_revision: 2,
        },
        "waiting",
        probe.clone(),
    );

    // The queued "waiting" writer cannot start until "current" releases its
    // writer turn. The lock-order tests in lock_order.rs cover the real
    // AppState gate/session non-holding; this test covers queue serialization.
    probe.release_all();
    probe.wait_for_completions(2).await;

    assert_eq!(probe.started_labels(), ["current", "waiting"]);
    assert_eq!(probe.max_concurrent(), 1);
}

#[tokio::test]
async fn orphan_cleanup_uses_the_same_serialized_writer_queue() {
    let coordinator = SaveCoordinator::new();
    let probe = Arc::new(WriterQueueProbe::paused());

    coordinator.enqueue_writer_probe(
        WriterJobClass::Debounced {
            session_generation: 1,
            durable_revision: 1,
        },
        "save",
        probe.clone(),
    );
    probe.wait_until_started("save").await;
    coordinator.enqueue_writer_probe(WriterJobClass::OrphanCleanup, "cleanup", probe.clone());

    probe.release_all();
    probe.wait_for_completions(2).await;

    assert_eq!(probe.started_labels(), ["save", "cleanup"]);
    assert_eq!(probe.max_concurrent(), 1);
}
