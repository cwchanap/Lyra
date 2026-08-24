use super::helpers::registered_write;
#[cfg(feature = "e2e")]
use crate::game::save::application::FlushOperation;
use crate::game::save::application::{
    ApplicationPersistence, BackgroundRetryTrigger, PersistenceHealthView, ThumbnailActivityView,
    AUTOSAVE_DEBOUNCE, THUMBNAIL_CAPTURE_TIMEOUT,
};
#[cfg(feature = "e2e")]
use crate::game::save::e2e_faults::E2ePersistenceFaultBoundary;
use crate::game::GameError;
use std::time::Duration;

async fn settle_autosave() {
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    for _ in 0..8 {
        tokio::task::yield_now().await;
    }
}

fn set_revision(persistence: &ApplicationPersistence, revision: u64) {
    persistence
        .session
        .lock()
        .unwrap()
        .engine
        .as_mut()
        .unwrap()
        .durable_revision = revision;
}

#[tokio::test(start_paused = true)]
async fn revisions_one_two_three_within_trailing_window_write_only_three() {
    let fixture = application_fixture_at_revision(1);
    for revision in 1..=3 {
        set_revision(&fixture.persistence, revision);
        fixture
            .persistence
            .notify_durable_commit_without_thumbnail(1, revision);
        tokio::time::advance(Duration::from_millis(200)).await;
    }
    settle_autosave().await;

    assert_eq!(
        fixture
            .persistence
            .last_successful_write()
            .unwrap()
            .durable_revision,
        3
    );
}

#[tokio::test(start_paused = true)]
async fn no_thumbnail_analysis_burst_writes_latest_revision_without_thumbnail_activity() {
    let fixture = application_fixture_at_revision(3);
    assert!(fixture
        .persistence
        .notify_durable_commit_without_thumbnail(1, 3)
        .is_none());
    assert_eq!(
        fixture.persistence.thumbnail_activity(),
        ThumbnailActivityView::Idle
    );
    settle_autosave().await;

    assert_eq!(
        fixture
            .persistence
            .last_successful_write()
            .unwrap()
            .durable_revision,
        3
    );
    assert_eq!(
        fixture.persistence.thumbnail_activity(),
        ThumbnailActivityView::Idle
    );
}

#[tokio::test(start_paused = true)]
async fn no_thumbnail_retry_and_supersession_never_issue_capture_request() {
    let fixture = application_fixture_at_revision(1);
    fixture
        .persistence
        .record_background_failure(1, 1, false, GameError::save_write_failed());
    assert!(fixture
        .persistence
        .retry_failed_background(BackgroundRetryTrigger::ManualSave)
        .is_none());
    assert_eq!(
        fixture.persistence.thumbnail_activity(),
        ThumbnailActivityView::Idle
    );
}

#[tokio::test(start_paused = true)]
async fn no_thumbnail_background_failure_retries_without_capture_or_warning_activity() {
    let fixture = application_fixture_at_revision(1);
    fixture
        .persistence
        .record_background_failure(1, 1, false, GameError::save_write_failed());
    fixture
        .persistence
        .retry_failed_background(BackgroundRetryTrigger::Flush);
    assert_eq!(
        fixture.persistence.thumbnail_activity(),
        ThumbnailActivityView::Idle
    );
}

#[tokio::test(start_paused = true)]
async fn in_flight_no_thumbnail_failure_keeps_origin_policy_for_retry_after_supersession() {
    let fixture = application_fixture_at_revision(1);
    fixture
        .persistence
        .record_background_failure(1, 1, false, GameError::save_write_failed());
    set_revision(&fixture.persistence, 2);
    fixture
        .persistence
        .notify_durable_commit_without_thumbnail(1, 2);
    assert!(fixture
        .persistence
        .retry_failed_background(BackgroundRetryTrigger::ManualSave)
        .is_none());
}

#[tokio::test(start_paused = true)]
async fn stale_no_thumbnail_retry_cannot_replace_a_newer_pending_write() {
    let fixture = application_fixture_at_revision(2);
    fixture
        .persistence
        .record_background_failure(1, 1, false, GameError::save_write_failed());
    fixture
        .persistence
        .notify_durable_commit_without_thumbnail(1, 2);
    let pending = fixture
        .persistence
        .state
        .lock()
        .unwrap()
        .pending_autosave
        .clone();
    fixture
        .persistence
        .retry_failed_background(BackgroundRetryTrigger::ManualSave);

    assert_eq!(
        fixture
            .persistence
            .state
            .lock()
            .unwrap()
            .pending_autosave
            .as_ref()
            .map(|value| value.ticket.clone()),
        pending.map(|value| value.ticket)
    );
}

#[tokio::test(start_paused = true)]
async fn no_thumbnail_retry_does_not_supersede_newer_pending_write_after_eligibility() {
    let fixture = application_fixture_at_revision(2);
    fixture
        .persistence
        .record_background_failure(1, 1, false, GameError::save_write_failed());
    fixture
        .persistence
        .notify_durable_commit_without_thumbnail(1, 2);
    let ticket = fixture
        .persistence
        .state
        .lock()
        .unwrap()
        .pending_autosave
        .as_ref()
        .unwrap()
        .ticket
        .clone();
    fixture
        .persistence
        .retry_failed_background(BackgroundRetryTrigger::ManualSave);
    assert_eq!(
        fixture
            .persistence
            .state
            .lock()
            .unwrap()
            .pending_autosave
            .as_ref()
            .unwrap()
            .ticket,
        ticket
    );
}

#[tokio::test(start_paused = true)]
async fn ordinary_retry_does_not_supersede_newer_pending_write_after_eligibility() {
    let fixture = application_fixture_at_revision(2);
    fixture
        .persistence
        .record_background_failure(1, 1, true, GameError::save_write_failed());
    fixture
        .persistence
        .notify_durable_commit_without_thumbnail(1, 2);
    assert!(fixture
        .persistence
        .retry_failed_background(BackgroundRetryTrigger::ManualSave)
        .is_none());
}

#[tokio::test(start_paused = true)]
async fn debounce_spends_the_existing_ticket_deadline() {
    let fixture = application_fixture_at_revision(1);
    let request = fixture.persistence.notify_durable_commit(1, 1).unwrap();
    let _issued = fixture
        .persistence
        .ticket_issued_at(&request.ticket)
        .unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    assert!(
        fixture
            .persistence
            .ticket_deadline(&request.ticket)
            .unwrap()
            .duration_since(tokio::time::Instant::now())
            < THUMBNAIL_CAPTURE_TIMEOUT
    );
    fixture
        .persistence
        .report_thumbnail_failure(&request.ticket)
        .unwrap();
}

#[tokio::test(start_paused = true)]
async fn capture_timeout_writes_unavailable_without_degrading_persistence() {
    let fixture = application_fixture_at_revision(1);
    fixture.persistence.notify_durable_commit(1, 1).unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE + THUMBNAIL_CAPTURE_TIMEOUT).await;
    for _ in 0..8 {
        tokio::task::yield_now().await;
    }

    assert_eq!(
        fixture.persistence.persistence_health(),
        PersistenceHealthView::Healthy
    );
    assert!(fixture.persistence.last_successful_write().is_some());
}

#[tokio::test(start_paused = true)]
async fn revision_during_write_schedules_one_follow_up_for_newest_revision() {
    let fixture = application_fixture_at_revision(1);
    fixture
        .persistence
        .notify_durable_commit_without_thumbnail(1, 1);
    set_revision(&fixture.persistence, 2);
    fixture
        .persistence
        .notify_durable_commit_without_thumbnail(1, 2);
    settle_autosave().await;

    assert_eq!(
        fixture
            .persistence
            .last_successful_write()
            .unwrap()
            .durable_revision,
        2
    );
}

#[tokio::test(start_paused = true)]
async fn first_write_success_keeps_health_pending_while_follow_up_is_outstanding() {
    let fixture = application_fixture_at_revision(1);
    fixture
        .persistence
        .notify_durable_commit_without_thumbnail(1, 1);
    set_revision(&fixture.persistence, 2);
    fixture
        .persistence
        .notify_durable_commit_without_thumbnail(1, 2);
    assert_eq!(
        fixture.persistence.persistence_health(),
        PersistenceHealthView::Pending
    );
}

#[tokio::test(start_paused = true)]
async fn prior_generation_high_revision_never_suppresses_new_generation_low_revision() {
    let fixture = application_fixture_at_revision(1);
    fixture.persistence.next_session_generation().unwrap();
    {
        let mut session = fixture.persistence.session.lock().unwrap();
        session.persistence.generation = 2;
    }
    set_revision(&fixture.persistence, 1);
    fixture
        .persistence
        .notify_durable_commit_without_thumbnail(2, 1);
    settle_autosave().await;
    assert_eq!(
        fixture
            .persistence
            .last_successful_write()
            .unwrap()
            .session_generation,
        2
    );
}

#[tokio::test(start_paused = true)]
async fn failed_revision_does_not_timer_loop_and_explicit_actions_retry_once() {
    let fixture = application_fixture_at_revision(1);
    fixture
        .persistence
        .record_background_failure(1, 1, false, GameError::save_write_failed());
    assert!(fixture
        .persistence
        .retry_failed_background(BackgroundRetryTrigger::ManualSave)
        .is_none());
    assert!(fixture
        .persistence
        .state
        .lock()
        .unwrap()
        .pending_autosave
        .is_some());
}

#[test]
fn superseded_autosave_discard_leaves_health_pending_not_failed() {
    let fixture = application_fixture_at_revision(1);
    let prepared = registered_write(1, 1)
        .prepare(fixture.persistence.fs.as_ref(), &fixture.persistence.root)
        .unwrap();
    set_revision(&fixture.persistence, 2);
    fixture
        .persistence
        .notify_durable_commit_without_thumbnail(1, 2);

    let stale = match fixture.persistence.commit_current(prepared).unwrap() {
        crate::game::save::application::AutosaveCommitOutcome::Stale(prepared) => prepared,
        crate::game::save::application::AutosaveCommitOutcome::Committed(_) => {
            panic!("revision drift must make the staged write stale")
        }
    };
    stale.discard().unwrap();

    let state = fixture.persistence.state.lock().unwrap();
    assert!(state.failed_write.is_none());
    assert!(state.failure_challenges.is_empty());
    assert_eq!(state.persistence_health, PersistenceHealthView::Pending);
}

#[tokio::test(start_paused = true)]
async fn stale_notify_durable_commit_is_rejected_before_mutating_coordinator_state() {
    let fixture = application_fixture_at_revision(1);
    fixture.persistence.next_session_generation().unwrap();
    fixture.persistence.next_session_generation().unwrap();
    let before = fixture.persistence.state.lock().unwrap().tickets.len();
    set_revision(&fixture.persistence, 2);
    assert!(fixture.persistence.notify_durable_commit(1, 2).is_none());
    assert_eq!(
        fixture.persistence.state.lock().unwrap().tickets.len(),
        before
    );
}

#[tokio::test(start_paused = true)]
async fn stale_notify_durable_commit_cannot_supersede_live_replacement_autosave_ticket() {
    let fixture = application_fixture_at_revision(1);
    let live = fixture
        .persistence
        .notify_durable_commit_without_thumbnail(1, 1);
    fixture.persistence.next_session_generation().unwrap();
    fixture.persistence.next_session_generation().unwrap();
    set_revision(&fixture.persistence, 2);
    fixture.persistence.notify_durable_commit(1, 2);
    assert!(fixture
        .persistence
        .state
        .lock()
        .unwrap()
        .pending_autosave
        .is_some());
    assert!(live.is_none());
}

#[cfg(feature = "e2e")]
#[tokio::test]
async fn exit_flush_fault_cancels_pending_autosave_before_failing() {
    let fixture = application_fixture_at_revision(1);
    set_revision(&fixture.persistence, 2);
    fixture
        .session
        .lock()
        .unwrap()
        .persistence
        .exit_flush_requested = true;
    fixture
        .persistence
        .notify_durable_commit_without_thumbnail(1, 2);
    fixture
        .persistence
        .arm_e2e_persistence_fault(E2ePersistenceFaultBoundary::ExitFlush, 1)
        .unwrap();
    let state = crate::AppState {
        session: fixture.session.clone(),
        persistence: fixture.persistence.clone(),
        resources_dir: std::path::PathBuf::new(),
    };

    let error = fixture
        .persistence
        .flush_session(&state, FlushOperation::Exit)
        .await
        .unwrap_err();

    assert_eq!(error.code, "saveWriteFailed");
    assert!(fixture
        .persistence
        .state
        .lock()
        .unwrap()
        .pending_autosave
        .is_none());
}

fn application_fixture_at_revision(revision: u64) -> super::helpers::ApplicationFixture {
    super::helpers::application_fixture_at(1, revision)
}
