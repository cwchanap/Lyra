use super::super::{
    AutosaveBackend, AutosaveCapture, AutosaveCommitOutcome, AutosavePreparedWrite,
    AutosaveRegisteredIntent, AutosaveWriteJob, AutosaveWriteReceipt, BackgroundRetryTrigger,
    CaptureIntent, CleanupOwner, CoordinatorFuture, CoordinatorTask, CoordinatorTaskScheduler,
    PersistenceHealthView, SaveCoordinator, ThumbnailActivityView, ThumbnailCapturePurpose,
    AUTOSAVE_DEBOUNCE, THUMBNAIL_CAPTURE_TIMEOUT,
};
use crate::game::save::schema::{
    SaveEnvelope, SaveSlotRef, SaveSlotStatusView, SaveSlotView, SaveType,
};
use crate::game::test_support::representative_save_envelope;
use crate::game::GameError;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Barrier, Condvar, Mutex};
use std::time::Duration;
use std::time::SystemTime;
use tokio::sync::Notify;

#[derive(Debug, Clone, PartialEq, Eq)]
struct WriteObservation {
    generation: u64,
    revision: u64,
    thumbnail_available: bool,
}

#[derive(Default)]
pub(super) struct RecordingBackend {
    writes: Mutex<Vec<WriteObservation>>,
    write_committed: Condvar,
    pause_writes: AtomicBool,
    started: Notify,
    release: Notify,
}

#[derive(Default)]
struct CountingScheduler {
    spawned: AtomicU64,
}

impl CoordinatorTaskScheduler for CountingScheduler {
    fn spawn(&self, task: CoordinatorTask) -> Result<(), GameError> {
        self.spawned.fetch_add(1, Ordering::SeqCst);
        tokio::spawn(task);
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PausePoint {
    Temporary,
    Gate,
    Replacement,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FaultPoint {
    Capture,
    Prepare,
    BeforeGate,
    BeforeReplacement,
}

impl RecordingBackend {
    pub(super) fn paused() -> Self {
        Self {
            pause_writes: AtomicBool::new(true),
            ..Self::default()
        }
    }

    fn observations(&self) -> Vec<WriteObservation> {
        self.writes.lock().unwrap().clone()
    }

    pub(super) fn write_count(&self) -> usize {
        self.writes.lock().unwrap().len()
    }

    pub(super) fn last_thumbnail_available(&self) -> Option<bool> {
        self.writes
            .lock()
            .unwrap()
            .last()
            .map(|write| write.thumbnail_available)
    }

    fn wait_for_write_count_blocking(&self, expected: usize) {
        let mut writes = self.writes.lock().unwrap();
        while writes.len() < expected {
            writes = self.write_committed.wait(writes).unwrap();
        }
    }

    pub(super) async fn wait_until_started(&self) {
        let notified = self.started.notified();
        if self.observations().is_empty() {
            notified.await;
        }
    }

    pub(super) fn release(&self) {
        self.pause_writes.store(false, Ordering::SeqCst);
        self.release.notify_waiters();
    }
}

impl AutosaveBackend for RecordingBackend {
    fn capture(
        &self,
        job: AutosaveWriteJob,
    ) -> CoordinatorFuture<'_, Result<AutosaveCapture, GameError>> {
        Box::pin(async move { Ok(AutosaveCapture::new(job, empty_autosave_slots())) })
    }

    fn register(
        &self,
        capture: AutosaveCapture,
        target: SaveSlotRef,
        save_id: String,
    ) -> CoordinatorFuture<'_, Result<AutosaveRegisteredIntent, GameError>> {
        Box::pin(async move {
            let revision = capture.job.durable_revision;
            capture.register(
                target,
                save_id.clone(),
                autosave_envelope(&save_id, target, revision),
            )
        })
    }

    fn prepare(
        &self,
        registered: AutosaveRegisteredIntent,
    ) -> CoordinatorFuture<'_, Result<AutosavePreparedWrite, GameError>> {
        Box::pin(async move { Ok(registered.prepare_simulated()) })
    }

    fn commit_if_current(
        &self,
        prepared: AutosavePreparedWrite,
    ) -> CoordinatorFuture<'_, Result<AutosaveCommitOutcome, GameError>> {
        Box::pin(async move {
            self.writes.lock().unwrap().push(WriteObservation {
                generation: prepared.session_generation(),
                revision: prepared.durable_revision(),
                thumbnail_available: prepared.thumbnail_available(),
            });
            self.write_committed.notify_all();
            self.started.notify_waiters();
            while self.pause_writes.load(Ordering::SeqCst) {
                self.release.notified().await;
            }
            Ok(AutosaveCommitOutcome::Committed(
                prepared.commit_simulated(),
            ))
        })
    }

    fn commit_with_gate_held(
        &self,
        prepared: AutosavePreparedWrite,
    ) -> CoordinatorFuture<'_, Result<AutosaveCommitOutcome, GameError>> {
        Box::pin(async move {
            self.writes.lock().unwrap().push(WriteObservation {
                generation: prepared.session_generation(),
                revision: prepared.durable_revision(),
                thumbnail_available: prepared.thumbnail_available(),
            });
            self.write_committed.notify_all();
            self.started.notify_waiters();
            while self.pause_writes.load(Ordering::SeqCst) {
                self.release.notified().await;
            }
            Ok(AutosaveCommitOutcome::Committed(
                prepared.commit_simulated(),
            ))
        })
    }
}

pub(super) struct PhasedBackend {
    phases: Mutex<Vec<&'static str>>,
    slots: Mutex<Vec<SaveSlotView>>,
    pause_prepare: AtomicBool,
    prepare_started: Notify,
    release_prepare: Notify,
    current_generation: AtomicU64,
    fail_commit: AtomicBool,
    failed_commits: AtomicU64,
    commit_failed: Notify,
    installed: AtomicBool,
    registered_targets: Mutex<Vec<SaveSlotRef>>,
    receipts: Mutex<Vec<AutosaveWriteReceipt>>,
    committed: Notify,
    selection_probes: AtomicU64,
    fail_cleanup: AtomicBool,
    cleanup_attempts: AtomicU64,
    cleanup_done: Notify,
    gameplay_lock: Mutex<()>,
    pause_point: Mutex<Option<PausePoint>>,
    reached_point: Mutex<Option<PausePoint>>,
    pause_reached: Notify,
    pause_release: Notify,
    fault_point: Mutex<Option<FaultPoint>>,
}

impl PhasedBackend {
    pub(super) fn new(generation: u64) -> Self {
        Self {
            phases: Mutex::new(Vec::new()),
            slots: Mutex::new(empty_autosave_slots()),
            pause_prepare: AtomicBool::new(false),
            prepare_started: Notify::new(),
            release_prepare: Notify::new(),
            current_generation: AtomicU64::new(generation),
            fail_commit: AtomicBool::new(false),
            failed_commits: AtomicU64::new(0),
            commit_failed: Notify::new(),
            installed: AtomicBool::new(false),
            registered_targets: Mutex::new(Vec::new()),
            receipts: Mutex::new(Vec::new()),
            committed: Notify::new(),
            selection_probes: AtomicU64::new(0),
            fail_cleanup: AtomicBool::new(false),
            cleanup_attempts: AtomicU64::new(0),
            cleanup_done: Notify::new(),
            gameplay_lock: Mutex::new(()),
            pause_point: Mutex::new(None),
            reached_point: Mutex::new(None),
            pause_reached: Notify::new(),
            pause_release: Notify::new(),
            fault_point: Mutex::new(None),
        }
    }

    pub(super) fn pause_prepare(&self) {
        self.pause_prepare.store(true, Ordering::SeqCst);
    }

    pub(super) async fn wait_for_prepare(&self) {
        let notified = self.prepare_started.notified();
        if !self.phases.lock().unwrap().contains(&"W:prepare") {
            notified.await;
        }
    }

    pub(super) async fn wait_for_prepare_count(&self, count: usize) {
        loop {
            let notified = self.prepare_started.notified();
            let prepare_count = self
                .phases
                .lock()
                .unwrap()
                .iter()
                .filter(|phase| **phase == "W:prepare")
                .count();
            if prepare_count >= count {
                return;
            }
            notified.await;
        }
    }

    pub(super) fn release_prepare(&self) {
        self.pause_prepare.store(false, Ordering::SeqCst);
        self.release_prepare.notify_waiters();
    }

    pub(super) fn fail_next_commit(&self) {
        self.fail_commit.store(true, Ordering::SeqCst);
    }

    fn pause_at(&self, point: PausePoint) {
        if point == PausePoint::Temporary {
            self.pause_prepare();
        } else {
            *self.pause_point.lock().unwrap() = Some(point);
        }
    }

    async fn wait_at(&self, point: PausePoint) {
        if point == PausePoint::Temporary {
            self.wait_for_prepare().await;
            return;
        }
        loop {
            let notified = self.pause_reached.notified();
            if *self.reached_point.lock().unwrap() == Some(point) {
                return;
            }
            notified.await;
        }
    }

    fn release_at(&self, point: PausePoint) {
        if point == PausePoint::Temporary {
            self.release_prepare();
        } else {
            *self.pause_point.lock().unwrap() = None;
            *self.reached_point.lock().unwrap() = None;
            self.pause_release.notify_waiters();
        }
    }

    fn fail_at(&self, point: FaultPoint) {
        *self.fault_point.lock().unwrap() = Some(point);
    }

    fn take_fault(&self, point: FaultPoint) -> bool {
        let mut fault = self.fault_point.lock().unwrap();
        if *fault == Some(point) {
            *fault = None;
            true
        } else {
            false
        }
    }

    async fn pause_if_requested(&self, point: PausePoint) {
        loop {
            let notified = self.pause_release.notified();
            if *self.pause_point.lock().unwrap() != Some(point) {
                return;
            }
            *self.reached_point.lock().unwrap() = Some(point);
            self.pause_reached.notify_waiters();
            notified.await;
        }
    }

    pub(super) async fn wait_for_receipts(&self, count: usize) {
        loop {
            let notified = self.committed.notified();
            if self.receipts.lock().unwrap().len() >= count {
                return;
            }
            notified.await;
        }
    }

    pub(super) async fn wait_for_failed_commits(&self, count: u64) {
        loop {
            let notified = self.commit_failed.notified();
            if self.failed_commits.load(Ordering::SeqCst) >= count {
                return;
            }
            notified.await;
        }
    }

    pub(super) fn mark_slot_used(&self, slot_number: u8) {
        let mut slots = self.slots.lock().unwrap();
        let slot = slots
            .iter_mut()
            .find(|slot| slot.reference == SaveSlotRef::Auto { slot: slot_number })
            .unwrap();
        slot.status = SaveSlotStatusView::Invalid {
            metadata: None,
            diagnostic: GameError::malformed_save_json(),
        };
        slot.observed_modified_at = Some(SystemTime::UNIX_EPOCH);
    }

    pub(super) fn probe_selected_target(&self) -> SaveSlotRef {
        self.selection_probes.fetch_add(1, Ordering::SeqCst);
        crate::game::save::storage::select_autosave_target(&self.slots.lock().unwrap()).unwrap()
    }

    pub(super) fn selection_probe_count(&self) -> u64 {
        self.selection_probes.load(Ordering::SeqCst)
    }

    async fn wait_for_cleanup_attempts(&self, count: u64) {
        loop {
            if self.cleanup_attempts.load(Ordering::SeqCst) >= count {
                return;
            }
            self.cleanup_done.notified().await;
        }
    }

    pub(super) fn phases(&self) -> Vec<&'static str> {
        self.phases.lock().unwrap().clone()
    }

    pub(super) fn targets(&self) -> Vec<SaveSlotRef> {
        self.receipts
            .lock()
            .unwrap()
            .iter()
            .map(|receipt| receipt.slot)
            .collect()
    }

    pub(super) fn registered_targets(&self) -> Vec<SaveSlotRef> {
        self.registered_targets.lock().unwrap().clone()
    }

    pub(super) fn receipt_revisions(&self) -> Vec<u64> {
        self.receipts
            .lock()
            .unwrap()
            .iter()
            .map(|receipt| receipt.durable_revision)
            .collect()
    }
}

impl AutosaveBackend for PhasedBackend {
    fn capture(
        &self,
        job: AutosaveWriteJob,
    ) -> CoordinatorFuture<'_, Result<AutosaveCapture, GameError>> {
        Box::pin(async move {
            let _session = self.gameplay_lock.lock().unwrap();
            self.phases.lock().unwrap().push("S:capture");
            if self.take_fault(FaultPoint::Capture) {
                return Err(GameError::save_read_failed());
            }
            Ok(AutosaveCapture::new(
                job,
                self.slots.lock().unwrap().clone(),
            ))
        })
    }

    fn register(
        &self,
        capture: AutosaveCapture,
        target: SaveSlotRef,
        save_id: String,
    ) -> CoordinatorFuture<'_, Result<AutosaveRegisteredIntent, GameError>> {
        Box::pin(async move {
            let _session = self.gameplay_lock.lock().unwrap();
            self.phases.lock().unwrap().push("S:register");
            self.registered_targets.lock().unwrap().push(target);
            let revision = capture.job.durable_revision;
            capture.register(
                target,
                save_id.clone(),
                autosave_envelope(&save_id, target, revision),
            )
        })
    }

    fn prepare(
        &self,
        registered: AutosaveRegisteredIntent,
    ) -> CoordinatorFuture<'_, Result<AutosavePreparedWrite, GameError>> {
        Box::pin(async move {
            self.phases.lock().unwrap().push("W:prepare");
            self.prepare_started.notify_waiters();
            while self.pause_prepare.load(Ordering::SeqCst) {
                self.release_prepare.notified().await;
            }
            if self.take_fault(FaultPoint::Prepare) {
                return Err(GameError::save_write_failed());
            }
            Ok(registered.prepare_simulated())
        })
    }

    fn commit_if_current(
        &self,
        prepared: AutosavePreparedWrite,
    ) -> CoordinatorFuture<'_, Result<AutosaveCommitOutcome, GameError>> {
        Box::pin(async move {
            self.pause_if_requested(PausePoint::Gate).await;
            if self.take_fault(FaultPoint::BeforeGate) {
                return Err(GameError::save_sync_failed());
            }
            self.phases.lock().unwrap().push("G");
            let _session = self.gameplay_lock.lock().unwrap();
            self.phases.lock().unwrap().push("G:S:revalidate");
            if prepared.session_generation() != self.current_generation.load(Ordering::SeqCst) {
                return Ok(AutosaveCommitOutcome::Stale(prepared));
            }
            drop(_session);
            self.pause_if_requested(PausePoint::Replacement).await;
            if self.take_fault(FaultPoint::BeforeReplacement) {
                return Err(GameError::save_replace_failed());
            }
            if self.fail_commit.swap(false, Ordering::SeqCst) {
                self.failed_commits.fetch_add(1, Ordering::SeqCst);
                self.commit_failed.notify_waiters();
                return Err(GameError::save_replace_failed());
            }
            self.phases.lock().unwrap().push("W+G:commit");
            self.installed.store(true, Ordering::SeqCst);
            let receipt = prepared.identity.clone();
            let target = receipt.slot;
            let revision = receipt.durable_revision;
            if let Some(slot) = self
                .slots
                .lock()
                .unwrap()
                .iter_mut()
                .find(|slot| slot.reference == target)
            {
                slot.status = SaveSlotStatusView::Invalid {
                    metadata: None,
                    diagnostic: GameError::malformed_save_json(),
                };
                slot.observed_modified_at =
                    Some(SystemTime::UNIX_EPOCH + Duration::from_secs(revision));
            }
            self.receipts.lock().unwrap().push(receipt.clone());
            self.committed.notify_waiters();
            Ok(AutosaveCommitOutcome::Committed(
                prepared.commit_simulated(),
            ))
        })
    }

    fn commit_with_gate_held(
        &self,
        prepared: AutosavePreparedWrite,
    ) -> CoordinatorFuture<'_, Result<AutosaveCommitOutcome, GameError>> {
        Box::pin(async move {
            self.phases.lock().unwrap().push("G");
            let _session = self.gameplay_lock.lock().unwrap();
            self.phases.lock().unwrap().push("G:S:revalidate");
            if prepared.session_generation() != self.current_generation.load(Ordering::SeqCst) {
                return Ok(AutosaveCommitOutcome::Stale(prepared));
            }
            drop(_session);
            self.pause_if_requested(PausePoint::Replacement).await;
            if self.take_fault(FaultPoint::BeforeReplacement) {
                return Err(GameError::save_replace_failed());
            }
            if self.fail_commit.swap(false, Ordering::SeqCst) {
                self.failed_commits.fetch_add(1, Ordering::SeqCst);
                self.commit_failed.notify_waiters();
                return Err(GameError::save_replace_failed());
            }
            self.phases.lock().unwrap().push("W+G:commit");
            self.installed.store(true, Ordering::SeqCst);
            let receipt = prepared.identity.clone();
            let target = receipt.slot;
            let revision = receipt.durable_revision;
            if let Some(slot) = self
                .slots
                .lock()
                .unwrap()
                .iter_mut()
                .find(|slot| slot.reference == target)
            {
                slot.status = SaveSlotStatusView::Invalid {
                    metadata: None,
                    diagnostic: GameError::malformed_save_json(),
                };
                slot.observed_modified_at =
                    Some(SystemTime::UNIX_EPOCH + Duration::from_secs(revision));
            }
            self.receipts.lock().unwrap().push(receipt.clone());
            self.committed.notify_waiters();
            Ok(AutosaveCommitOutcome::Committed(
                prepared.commit_simulated(),
            ))
        })
    }

    fn cleanup_orphans(&self) -> CoordinatorFuture<'_, Result<(), GameError>> {
        Box::pin(async move {
            self.phases.lock().unwrap().push("W:cleanup");
            self.cleanup_attempts.fetch_add(1, Ordering::SeqCst);
            self.cleanup_done.notify_waiters();
            if self.fail_cleanup.swap(false, Ordering::SeqCst) {
                Err(GameError::save_read_failed())
            } else {
                Ok(())
            }
        })
    }
}

fn empty_autosave_slots() -> Vec<SaveSlotView> {
    (1..=5)
        .map(|slot| SaveSlotView {
            reference: SaveSlotRef::Auto { slot },
            modified_at: None,
            status: SaveSlotStatusView::Empty,
            observed_modified_at: None,
            observed_saved_at: None,
        })
        .collect()
}

fn autosave_envelope(save_id: &str, target: SaveSlotRef, durable_revision: u64) -> SaveEnvelope {
    let mut envelope = representative_save_envelope();
    envelope.save_id = save_id.into();
    envelope.snapshot.durable_revision = durable_revision;
    match target {
        SaveSlotRef::Auto { slot } => {
            envelope.save_type = SaveType::Auto;
            envelope.slot = slot;
        }
        SaveSlotRef::Manual { slot } => {
            envelope.save_type = SaveType::Manual;
            envelope.slot = slot;
        }
    }
    envelope
}

#[test]
fn plain_thread_issues_a_ticket_and_eventually_runs_the_debounced_writer() {
    let backend = Arc::new(RecordingBackend::default());
    let coordinator = SaveCoordinator::with_backend(backend.clone());

    let request = coordinator
        .notify_durable_commit(1, 1)
        .expect("a synchronous command must receive its capture ticket");
    coordinator
        .report_thumbnail_failure(&request.ticket)
        .unwrap();

    backend.wait_for_write_count_blocking(1);

    assert_eq!(
        backend.observations(),
        [WriteObservation {
            generation: 1,
            revision: 1,
            thumbnail_available: false,
        }],
        "health={:?} activity={:?}",
        coordinator.persistence_health(),
        coordinator.thumbnail_activity(),
    );
}

#[tokio::test(start_paused = true)]
async fn revisions_one_two_three_within_trailing_window_write_only_three() {
    let backend = Arc::new(RecordingBackend::default());
    let coordinator = SaveCoordinator::with_backend(backend.clone());

    coordinator.notify_durable_commit(1, 1).unwrap();
    tokio::time::advance(Duration::from_millis(200)).await;
    coordinator.notify_durable_commit(1, 2).unwrap();
    tokio::time::advance(Duration::from_millis(200)).await;
    let latest = coordinator.notify_durable_commit(1, 3).unwrap();
    coordinator
        .report_thumbnail_failure(&latest.ticket)
        .unwrap();

    tokio::time::advance(AUTOSAVE_DEBOUNCE - Duration::from_millis(1)).await;
    tokio::task::yield_now().await;
    assert!(backend.observations().is_empty());

    tokio::time::advance(Duration::from_millis(1)).await;
    tokio::task::yield_now().await;
    assert_eq!(
        backend.observations(),
        [WriteObservation {
            generation: 1,
            revision: 3,
            thumbnail_available: false,
        }]
    );
}

#[tokio::test(start_paused = true)]
async fn no_thumbnail_analysis_burst_writes_latest_revision_without_thumbnail_activity() {
    let backend = Arc::new(RecordingBackend::default());
    let scheduler = Arc::new(CountingScheduler::default());
    let coordinator =
        SaveCoordinator::with_backend(backend.clone()).with_task_scheduler(scheduler.clone());
    let activities = Arc::new(Mutex::new(Vec::new()));
    let activity_log = Arc::clone(&activities);
    coordinator.subscribe(
        |_| {},
        move |activity| {
            activity_log.lock().unwrap().push(activity);
        },
    );

    for revision in 1..=50 {
        assert!(coordinator
            .notify_durable_commit_without_thumbnail(1, revision)
            .is_none());
        assert_eq!(
            coordinator.thumbnail_activity(),
            ThumbnailActivityView::Idle
        );
    }
    assert_eq!(scheduler.spawned.load(Ordering::SeqCst), 50);

    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    assert_eq!(
        backend.observations(),
        [WriteObservation {
            generation: 1,
            revision: 50,
            thumbnail_available: false,
        }]
    );
    assert_eq!(
        coordinator.thumbnail_activity(),
        ThumbnailActivityView::Idle
    );
    assert!(activities
        .lock()
        .unwrap()
        .iter()
        .all(|activity| *activity == ThumbnailActivityView::Idle));
}

#[tokio::test(start_paused = true)]
async fn no_thumbnail_retry_and_supersession_never_issue_capture_request() {
    let backend = Arc::new(RecordingBackend::default());
    backend.pause_writes.store(true, Ordering::SeqCst);
    let coordinator = SaveCoordinator::with_backend(backend.clone());

    assert!(coordinator
        .notify_durable_commit_without_thumbnail(1, 1)
        .is_none());
    assert!(coordinator
        .notify_durable_commit_without_thumbnail(1, 2)
        .is_none());
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_until_started().await;
    backend.release();
    tokio::task::yield_now().await;

    assert_eq!(backend.observations()[0].revision, 2);
    assert!(!backend.observations()[0].thumbnail_available);
    assert!(coordinator.state.lock().unwrap().tickets.is_empty());
    assert_eq!(
        coordinator.thumbnail_activity(),
        ThumbnailActivityView::Idle
    );
}

#[tokio::test(start_paused = true)]
async fn no_thumbnail_background_failure_retries_without_capture_or_warning_activity() {
    let backend = Arc::new(PhasedBackend::new(1));
    backend.fail_next_commit();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let activities = Arc::new(Mutex::new(Vec::new()));
    let activity_log = Arc::clone(&activities);
    coordinator.subscribe(
        |_| {},
        move |activity| {
            activity_log.lock().unwrap().push(activity);
        },
    );

    assert!(coordinator
        .notify_durable_commit_without_thumbnail(1, 3)
        .is_none());
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_failed_commits(1).await;
    tokio::task::yield_now().await;

    assert!(matches!(
        coordinator.persistence_health(),
        PersistenceHealthView::Degraded { .. }
    ));
    assert_eq!(
        coordinator.thumbnail_activity(),
        ThumbnailActivityView::Idle
    );
    assert!(
        !coordinator
            .state
            .lock()
            .unwrap()
            .failed_write
            .as_ref()
            .unwrap()
            .thumbnail_capture_required
    );

    assert!(coordinator
        .retry_failed_background(BackgroundRetryTrigger::Flush)
        .is_none());
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_receipts(1).await;

    assert_eq!(backend.receipt_revisions(), [3]);
    assert_eq!(
        coordinator.thumbnail_activity(),
        ThumbnailActivityView::Idle
    );
    assert!(activities
        .lock()
        .unwrap()
        .iter()
        .all(|activity| *activity == ThumbnailActivityView::Idle));
}

#[tokio::test(start_paused = true)]
async fn in_flight_no_thumbnail_failure_keeps_origin_policy_for_retry_after_supersession() {
    let backend = Arc::new(PhasedBackend::new(1));
    backend.pause_at(PausePoint::Replacement);
    let coordinator = SaveCoordinator::with_backend(backend.clone());

    assert!(coordinator
        .notify_durable_commit_without_thumbnail(1, 1)
        .is_none());
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_at(PausePoint::Replacement).await;

    let newer_capture = coordinator.notify_durable_commit(1, 2);
    assert!(newer_capture.is_some());
    backend.fail_next_commit();
    backend.release_at(PausePoint::Replacement);
    backend.wait_for_failed_commits(1).await;
    tokio::task::yield_now().await;

    assert!(coordinator
        .retry_failed_background(BackgroundRetryTrigger::Flush)
        .is_none());
}

#[tokio::test]
async fn no_thumbnail_autosave_does_not_hide_unrelated_live_activity() {
    let coordinator = SaveCoordinator::ticket_only();
    let activities = Arc::new(Mutex::new(Vec::new()));
    let activity_log = Arc::clone(&activities);
    coordinator.subscribe(
        |_| {},
        move |activity| {
            activity_log.lock().unwrap().push(activity);
        },
    );
    let manual = coordinator
        .prepare_thumbnail(ThumbnailCapturePurpose::ManualSave {
            session_generation: 1,
            durable_revision: 1,
        })
        .unwrap();

    assert!(coordinator
        .notify_durable_commit_without_thumbnail(1, 2)
        .is_none());
    assert_eq!(
        coordinator.thumbnail_activity(),
        ThumbnailActivityView::Capturing
    );
    assert!(coordinator
        .state
        .lock()
        .unwrap()
        .tickets
        .contains_key(&manual.ticket));
    assert_eq!(
        activities.lock().unwrap().as_slice(),
        &[
            ThumbnailActivityView::Idle,
            ThumbnailActivityView::Capturing
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn debounce_spends_the_existing_ticket_deadline() {
    let backend = Arc::new(RecordingBackend::default());
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let request = coordinator.notify_durable_commit(2, 10).unwrap();

    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    tokio::task::yield_now().await;

    assert_eq!(request.timeout_ms(), 500);
    assert!(backend.observations().is_empty());
}

#[tokio::test(start_paused = true)]
async fn capture_timeout_writes_unavailable_without_degrading_persistence() {
    let backend = Arc::new(RecordingBackend::default());
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    coordinator.notify_durable_commit(3, 12).unwrap();

    tokio::time::advance(THUMBNAIL_CAPTURE_TIMEOUT).await;
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    assert_eq!(
        backend.observations(),
        [WriteObservation {
            generation: 3,
            revision: 12,
            thumbnail_available: false,
        }]
    );
    assert!(matches!(
        coordinator.thumbnail_activity(),
        ThumbnailActivityView::Unavailable { .. }
    ));
    assert!(!matches!(
        coordinator.persistence_health(),
        PersistenceHealthView::Degraded { .. }
    ));
}

#[tokio::test(start_paused = true)]
async fn revision_during_write_schedules_one_follow_up_for_newest_revision() {
    let backend = Arc::new(RecordingBackend::paused());
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let first = coordinator.notify_durable_commit(5, 20).unwrap();
    coordinator.report_thumbnail_failure(&first.ticket).unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_until_started().await;

    coordinator.notify_durable_commit(5, 21).unwrap();
    tokio::time::advance(Duration::from_millis(100)).await;
    let newest = coordinator.notify_durable_commit(5, 22).unwrap();
    coordinator
        .report_thumbnail_failure(&newest.ticket)
        .unwrap();
    backend.release();
    tokio::task::yield_now().await;
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    tokio::task::yield_now().await;

    assert_eq!(
        backend
            .observations()
            .into_iter()
            .map(|write| write.revision)
            .collect::<Vec<_>>(),
        [20, 22]
    );
}

#[tokio::test(start_paused = true)]
async fn first_write_success_keeps_health_pending_while_follow_up_is_outstanding() {
    let backend = Arc::new(PhasedBackend::new(1));
    backend.pause_prepare();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let first = coordinator.notify_durable_commit(1, 1).unwrap();
    coordinator.report_thumbnail_failure(&first.ticket).unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_prepare().await;

    let follow_up = coordinator.notify_durable_commit(1, 2).unwrap();
    coordinator
        .report_thumbnail_failure(&follow_up.ticket)
        .unwrap();
    backend.release_prepare();
    backend.wait_for_receipts(1).await;

    assert_eq!(
        coordinator.persistence_health(),
        PersistenceHealthView::Pending
    );
}

#[tokio::test(start_paused = true)]
async fn scheduler_failure_preserves_committed_view_and_degrades_health() {
    let backend = Arc::new(RecordingBackend::default());
    let coordinator = SaveCoordinator::with_backend(backend);
    coordinator.fail_next_schedule_for_test();

    let result = coordinator.notify_committed("committed-view", 9, 30);

    assert_eq!(result.committed, "committed-view");
    assert!(result.thumbnail_capture.is_none());
    assert!(matches!(
        coordinator.persistence_health(),
        PersistenceHealthView::Degraded { .. }
    ));
}

#[tokio::test(start_paused = true)]
async fn newer_schedule_failure_survives_older_writer_success_and_retries_exact_revision() {
    let backend = Arc::new(PhasedBackend::new(1));
    backend.pause_prepare();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let older = coordinator.notify_durable_commit(1, 40).unwrap();
    coordinator.report_thumbnail_failure(&older.ticket).unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_prepare().await;

    coordinator.fail_next_schedule_for_test();
    assert!(coordinator.notify_durable_commit(1, 41).is_none());
    assert!(matches!(
        coordinator.persistence_health(),
        PersistenceHealthView::Degraded { .. }
    ));
    assert!(!matches!(
        coordinator.thumbnail_activity(),
        ThumbnailActivityView::Capturing
    ));
    assert!(!coordinator
        .state
        .lock()
        .unwrap()
        .tickets
        .values()
        .any(|record| record.purpose.intent() == CaptureIntent::Autosave));

    backend.release_prepare();
    backend.wait_for_receipts(1).await;
    assert!(matches!(
        coordinator.persistence_health(),
        PersistenceHealthView::Degraded { .. }
    ));
    assert_eq!(
        coordinator
            .state
            .lock()
            .unwrap()
            .failed_write
            .as_ref()
            .map(|failure| failure.identity),
        Some((1, 41))
    );

    let retry = coordinator
        .retry_failed_background(BackgroundRetryTrigger::ManualSave)
        .unwrap();
    assert_eq!(
        coordinator
            .state
            .lock()
            .unwrap()
            .tickets
            .get(&retry.ticket)
            .map(|record| record.purpose.clone()),
        Some(ThumbnailCapturePurpose::Autosave {
            session_generation: 1,
            durable_revision: 41,
        })
    );
    coordinator.report_thumbnail_failure(&retry.ticket).unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_receipts(2).await;

    assert_eq!(
        backend
            .receipts
            .lock()
            .unwrap()
            .iter()
            .map(|receipt| receipt.durable_revision)
            .collect::<Vec<_>>(),
        [40, 41]
    );
}

#[tokio::test(start_paused = true)]
async fn newer_schedule_failure_diagnostic_survives_older_writer_failure() {
    let backend = Arc::new(PhasedBackend::new(1));
    backend.pause_prepare();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let older = coordinator.notify_durable_commit(1, 50).unwrap();
    coordinator.report_thumbnail_failure(&older.ticket).unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_prepare().await;

    coordinator.fail_next_schedule_for_test();
    assert!(coordinator.notify_durable_commit(1, 51).is_none());
    let scheduling_failure = coordinator.persistence_health();
    assert_eq!(
        scheduling_failure,
        PersistenceHealthView::Degraded {
            diagnostic: GameError::save_write_failed(),
        }
    );

    backend.fail_commit.store(true, Ordering::SeqCst);
    backend.release_prepare();
    backend.wait_for_failed_commits(1).await;
    tokio::task::yield_now().await;

    assert_eq!(coordinator.persistence_health(), scheduling_failure);
    assert_eq!(
        coordinator
            .state
            .lock()
            .unwrap()
            .failed_write
            .as_ref()
            .map(|failure| failure.identity),
        Some((1, 51))
    );

    let retry = coordinator
        .retry_failed_background(BackgroundRetryTrigger::Flush)
        .unwrap();
    assert_eq!(
        coordinator
            .state
            .lock()
            .unwrap()
            .tickets
            .get(&retry.ticket)
            .map(|record| record.purpose.clone()),
        Some(ThumbnailCapturePurpose::Autosave {
            session_generation: 1,
            durable_revision: 51,
        })
    );
    coordinator.report_thumbnail_failure(&retry.ticket).unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_receipts(1).await;
    assert_eq!(backend.receipts.lock().unwrap()[0].durable_revision, 51);
}

#[tokio::test(start_paused = true)]
async fn normal_write_orders_capture_prepare_revalidate_commit_and_keeps_session_responsive() {
    let backend = Arc::new(PhasedBackend::new(1));
    backend.pause_prepare();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let request = coordinator.notify_durable_commit(1, 1).unwrap();
    coordinator
        .report_thumbnail_failure(&request.ticket)
        .unwrap();

    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_prepare().await;

    assert!(backend.gameplay_lock.try_lock().is_ok());
    backend.release_prepare();
    backend.wait_for_receipts(1).await;
    assert_eq!(
        backend.phases(),
        [
            "S:capture",
            "S:register",
            "W:prepare",
            "G",
            "G:S:revalidate",
            "W+G:commit"
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn stale_generation_discards_prepared_write_without_installing_it() {
    let backend = Arc::new(PhasedBackend::new(7));
    backend.pause_prepare();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let request = coordinator.notify_durable_commit(7, 4).unwrap();
    coordinator
        .report_thumbnail_failure(&request.ticket)
        .unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_prepare().await;

    backend.current_generation.store(8, Ordering::SeqCst);
    backend.release_prepare();
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    assert!(!backend.installed.load(Ordering::SeqCst));
    assert!(backend.phases().ends_with(&["G", "G:S:revalidate"]));
}

#[tokio::test(start_paused = true)]
async fn ordinary_recovery_points_rotate_and_record_generation_scoped_success() {
    let backend = Arc::new(PhasedBackend::new(2));
    let coordinator = SaveCoordinator::with_backend(backend.clone());

    for revision in [8, 9] {
        let request = coordinator.notify_durable_commit(2, revision).unwrap();
        coordinator
            .report_thumbnail_failure(&request.ticket)
            .unwrap();
        tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
        backend.wait_for_receipts((revision - 7) as usize).await;
    }

    assert_eq!(
        backend.targets(),
        [SaveSlotRef::Auto { slot: 1 }, SaveSlotRef::Auto { slot: 2 }]
    );
    let written = coordinator.last_successful_write().unwrap();
    assert_eq!(
        (written.session_generation, written.durable_revision),
        (2, 9)
    );
    assert_eq!(written.slot, SaveSlotRef::Auto { slot: 2 });
    assert_eq!(
        coordinator.autosave_target(2),
        Some(SaveSlotRef::Auto { slot: 2 })
    );
}

#[tokio::test(start_paused = true)]
async fn prior_generation_target_is_not_visible_to_new_generation_before_first_success() {
    let backend = Arc::new(PhasedBackend::new(1));
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let first = coordinator.notify_durable_commit(1, 1).unwrap();
    coordinator.report_thumbnail_failure(&first.ticket).unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_receipts(1).await;
    assert_eq!(
        coordinator.autosave_target(1),
        Some(SaveSlotRef::Auto { slot: 1 })
    );

    backend.current_generation.store(2, Ordering::SeqCst);
    let next_generation = coordinator.notify_durable_commit(2, 1).unwrap();

    assert!(coordinator.autosave_target(2).is_none());
    assert_eq!(
        coordinator
            .state
            .lock()
            .unwrap()
            .tickets
            .get(&next_generation.ticket)
            .map(|record| record.purpose.clone()),
        Some(ThumbnailCapturePurpose::Autosave {
            session_generation: 2,
            durable_revision: 1,
        })
    );
}

#[tokio::test(start_paused = true)]
async fn prior_generation_high_revision_never_suppresses_new_generation_low_revision() {
    let backend = Arc::new(PhasedBackend::new(1));
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let old = coordinator.notify_durable_commit(1, 900).unwrap();
    coordinator.report_thumbnail_failure(&old.ticket).unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_receipts(1).await;

    backend.current_generation.store(2, Ordering::SeqCst);
    let new = coordinator.notify_durable_commit(2, 1).unwrap();
    coordinator.report_thumbnail_failure(&new.ticket).unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_receipts(2).await;

    assert_eq!(
        backend
            .receipts
            .lock()
            .unwrap()
            .iter()
            .map(|receipt| (receipt.session_generation, receipt.durable_revision))
            .collect::<Vec<_>>(),
        [(1, 900), (2, 1)]
    );
}

#[tokio::test(start_paused = true)]
async fn failed_revision_does_not_timer_loop_and_explicit_actions_retry_once() {
    for trigger in [
        BackgroundRetryTrigger::ManualSave,
        BackgroundRetryTrigger::Flush,
    ] {
        let backend = Arc::new(PhasedBackend::new(1));
        backend.fail_commit.store(true, Ordering::SeqCst);
        let coordinator = SaveCoordinator::with_backend(backend.clone());
        let request = coordinator.notify_durable_commit(1, 6).unwrap();
        coordinator
            .report_thumbnail_failure(&request.ticket)
            .unwrap();
        tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
        tokio::task::yield_now().await;
        assert!(matches!(
            coordinator.persistence_health(),
            PersistenceHealthView::Degraded { .. }
        ));
        assert!(coordinator.autosave_target(1).is_none());
        let phase_count = backend.phases().len();

        tokio::time::advance(Duration::from_secs(60)).await;
        tokio::task::yield_now().await;
        assert_eq!(backend.phases().len(), phase_count);
        assert!(coordinator.notify_durable_commit(1, 6).is_none());

        let retry = coordinator.retry_failed_background(trigger).unwrap();
        coordinator.report_thumbnail_failure(&retry.ticket).unwrap();
        tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
        backend.wait_for_receipts(1).await;
        assert_eq!(backend.receipts.lock().unwrap().len(), 1);
    }
}

#[tokio::test(start_paused = true)]
async fn later_durable_revision_retries_after_background_failure() {
    let backend = Arc::new(PhasedBackend::new(1));
    backend.fail_commit.store(true, Ordering::SeqCst);
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let failed = coordinator.notify_durable_commit(1, 6).unwrap();
    coordinator
        .report_thumbnail_failure(&failed.ticket)
        .unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    tokio::task::yield_now().await;

    let later = coordinator.notify_durable_commit(1, 7).unwrap();
    coordinator.report_thumbnail_failure(&later.ticket).unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_receipts(1).await;

    assert_eq!(backend.receipts.lock().unwrap()[0].durable_revision, 7);
}

#[tokio::test(start_paused = true)]
async fn orphan_cleanup_runs_through_writer_after_active_save() {
    let backend = Arc::new(PhasedBackend::new(1));
    backend.pause_prepare();
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let request = coordinator.notify_durable_commit(1, 1).unwrap();
    coordinator
        .report_thumbnail_failure(&request.ticket)
        .unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_prepare().await;

    coordinator.enqueue_orphan_cleanup().unwrap();
    backend.release_prepare();
    backend.cleanup_done.notified().await;

    assert!(backend.phases().ends_with(&["W+G:commit", "W:cleanup"]));
}

#[tokio::test(start_paused = true)]
async fn receipt_less_cleanup_failure_survives_autosave_until_matching_retry_succeeds() {
    let backend = Arc::new(PhasedBackend::new(1));
    backend.fail_cleanup.store(true, Ordering::SeqCst);
    let coordinator = SaveCoordinator::with_backend(backend.clone());

    coordinator.enqueue_orphan_cleanup().unwrap();
    backend.wait_for_cleanup_attempts(1).await;
    tokio::task::yield_now().await;
    assert_eq!(
        coordinator.persistence_health(),
        PersistenceHealthView::Degraded {
            diagnostic: GameError::save_read_failed(),
        }
    );

    let request = coordinator.notify_durable_commit(1, 1).unwrap();
    coordinator
        .report_thumbnail_failure(&request.ticket)
        .unwrap();
    tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
    backend.wait_for_receipts(1).await;
    assert_eq!(
        coordinator.persistence_health(),
        PersistenceHealthView::Degraded {
            diagnostic: GameError::save_read_failed(),
        }
    );

    coordinator.enqueue_orphan_cleanup().unwrap();
    backend.wait_for_cleanup_attempts(2).await;
    tokio::task::yield_now().await;
    assert_eq!(
        coordinator.persistence_health(),
        PersistenceHealthView::Healthy
    );
    assert_eq!(
        backend
            .phases()
            .into_iter()
            .filter(|phase| *phase == "W:cleanup")
            .count(),
        2
    );
}

#[tokio::test(start_paused = true)]
async fn later_queued_receipt_less_cleanup_success_resolves_earlier_failure() {
    let backend = Arc::new(PhasedBackend::new(1));
    backend.fail_cleanup.store(true, Ordering::SeqCst);
    let coordinator = SaveCoordinator::with_backend(backend.clone());

    coordinator.enqueue_orphan_cleanup().unwrap();
    coordinator.enqueue_orphan_cleanup().unwrap();
    backend.wait_for_cleanup_attempts(2).await;
    tokio::task::yield_now().await;

    assert_eq!(
        backend
            .phases()
            .into_iter()
            .filter(|phase| *phase == "W:cleanup")
            .count(),
        2
    );
    assert_eq!(
        coordinator.persistence_health(),
        PersistenceHealthView::Healthy
    );
    assert!(coordinator.state.lock().unwrap().cleanup_failure.is_none());
}

#[tokio::test(start_paused = true)]
async fn cleanup_attempt_identity_follows_concurrent_writer_enqueue_order() {
    let backend = Arc::new(PhasedBackend::new(1));
    backend.fail_cleanup.store(true, Ordering::SeqCst);
    let coordinator = SaveCoordinator::with_backend(backend.clone());
    let before_lock = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let hook_before_lock = Arc::clone(&before_lock);
    let hook_release = Arc::clone(&release);
    coordinator
        .writer_queue
        .set_cleanup_before_lock_hook(Arc::new(move || {
            hook_before_lock.wait();
            hook_release.wait();
        }));

    let runtime = tokio::runtime::Handle::current();
    let first_coordinator = coordinator.clone();
    let first_caller = std::thread::spawn(move || {
        let _runtime_guard = runtime.enter();
        first_coordinator.enqueue_orphan_cleanup()
    });
    before_lock.wait();

    coordinator.enqueue_orphan_cleanup().unwrap();
    backend.wait_for_cleanup_attempts(1).await;
    tokio::task::yield_now().await;
    let first_failure_owner = coordinator
        .state
        .lock()
        .unwrap()
        .cleanup_failure
        .as_ref()
        .map(|failure| failure.owner.clone());

    release.wait();
    first_caller.join().unwrap().unwrap();
    backend.wait_for_cleanup_attempts(2).await;
    tokio::task::yield_now().await;

    assert!(matches!(
        first_failure_owner,
        Some(CleanupOwner::Attempt(1))
    ));
    assert_eq!(
        backend
            .phases()
            .into_iter()
            .filter(|phase| *phase == "W:cleanup")
            .count(),
        2
    );
    assert_eq!(
        coordinator.persistence_health(),
        PersistenceHealthView::Healthy
    );
    assert!(coordinator.state.lock().unwrap().cleanup_failure.is_none());
}

#[test]
fn older_receipt_less_cleanup_success_does_not_clear_later_failure() {
    let coordinator = SaveCoordinator::new();
    coordinator.record_cleanup_failure(CleanupOwner::Attempt(2), GameError::save_read_failed());

    coordinator.resolve_cleanup_failure(&CleanupOwner::Attempt(1));

    assert_eq!(
        coordinator.persistence_health(),
        PersistenceHealthView::Degraded {
            diagnostic: GameError::save_read_failed(),
        }
    );
    assert!(matches!(
        coordinator
            .state
            .lock()
            .unwrap()
            .cleanup_failure
            .as_ref()
            .map(|failure| &failure.owner),
        Some(CleanupOwner::Attempt(2))
    ));
}

#[test]
fn receipt_less_cleanup_success_does_not_clear_receipt_owned_failure() {
    let coordinator = SaveCoordinator::new();
    let receipt_owner = CleanupOwner::Receipt(AutosaveWriteReceipt {
        session_generation: 1,
        durable_revision: 7,
        slot: SaveSlotRef::Auto { slot: 2 },
        save_id: "receipt-owned".into(),
    });
    coordinator.record_cleanup_failure(receipt_owner.clone(), GameError::save_write_failed());

    coordinator.resolve_cleanup_failure(&CleanupOwner::Attempt(u64::MAX));

    assert_eq!(
        coordinator.persistence_health(),
        PersistenceHealthView::Degraded {
            diagnostic: GameError::save_write_failed(),
        }
    );
    assert!(coordinator
        .state
        .lock()
        .unwrap()
        .cleanup_failure
        .as_ref()
        .is_some_and(|failure| failure.owner == receipt_owner));
}

#[tokio::test(start_paused = true)]
async fn fake_backend_can_pause_at_each_storage_and_lock_boundary() {
    for point in [
        PausePoint::Temporary,
        PausePoint::Gate,
        PausePoint::Replacement,
    ] {
        let backend = Arc::new(PhasedBackend::new(1));
        backend.pause_at(point);
        let coordinator = SaveCoordinator::with_backend(backend.clone());
        let request = coordinator.notify_durable_commit(1, 1).unwrap();
        coordinator
            .report_thumbnail_failure(&request.ticket)
            .unwrap();
        tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
        backend.wait_at(point).await;

        assert!(backend.gameplay_lock.try_lock().is_ok(), "{point:?}");

        backend.release_at(point);
        backend.wait_for_receipts(1).await;
    }
}

#[tokio::test(start_paused = true)]
async fn storage_faults_before_temporary_gate_and_replacement_degrade_without_adoption() {
    for point in [
        FaultPoint::Capture,
        FaultPoint::Prepare,
        FaultPoint::BeforeGate,
        FaultPoint::BeforeReplacement,
    ] {
        let backend = Arc::new(PhasedBackend::new(1));
        backend.fail_at(point);
        let coordinator = SaveCoordinator::with_backend(backend);
        let request = coordinator.notify_durable_commit(1, 1).unwrap();
        coordinator
            .report_thumbnail_failure(&request.ticket)
            .unwrap();
        tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
        tokio::task::yield_now().await;
        tokio::task::yield_now().await;

        assert!(
            matches!(
                coordinator.persistence_health(),
                PersistenceHealthView::Degraded { .. }
            ),
            "{point:?}"
        );
        assert!(coordinator.autosave_target(1).is_none(), "{point:?}");
    }
}

#[tokio::test(start_paused = true)]
async fn stale_session_generation_fence_rejects_autosave_without_reinstalling_pending_or_overwriting_health(
) {
    // `replace_session_for_e2e` advances `next_session_generation`, clears
    // `pending_autosave`, and publishes `Healthy`. An autosave scheduled for
    // the prior generation must not reinstall a stale pending entry or
    // overwrite the replacement's `Healthy` publication. The fence uses `<`
    // (not `!=`) so a session whose generation equals the high-water mark
    // still schedules normally.
    let backend = Arc::new(RecordingBackend::default());
    let coordinator = SaveCoordinator::with_backend(backend.clone());

    // Simulate the post-replacement coordinator state that
    // `replace_session_for_e2e` installs under its locks.
    {
        let mut state = coordinator.state.lock().unwrap();
        state.next_session_generation = 2;
        state.pending_autosave = None;
        state.persistence_health = PersistenceHealthView::Healthy;
    }

    // An older session generation returns `staleSessionGeneration` and does
    // not reinstall `pending_autosave` or touch `next_autosave_serial`.
    let stale_purpose = ThumbnailCapturePurpose::Autosave {
        session_generation: 1,
        durable_revision: 11,
    };
    let serial_before = coordinator.state.lock().unwrap().next_autosave_serial;
    let stale_error = coordinator
        .schedule_autosave(
            stale_purpose,
            "stale-ticket".into(),
            tokio::time::Instant::now() + Duration::from_secs(10),
            false,
            true,
        )
        .unwrap_err();
    assert_eq!(stale_error.code, "staleSessionGeneration");
    {
        let state = coordinator.state.lock().unwrap();
        assert!(
            state.pending_autosave.is_none(),
            "stale schedule must not reinstall pending_autosave"
        );
        assert_eq!(
            state.next_autosave_serial, serial_before,
            "stale schedule must not advance next_autosave_serial"
        );
    }
    // Replacement health remains `Healthy`: the stale call's
    // `record_schedule_failure` partner is also fenced and must not degrade.
    assert_eq!(
        coordinator.persistence_health(),
        PersistenceHealthView::Healthy
    );

    // The current generation still schedules normally through the public
    // `notify_durable_commit` path, reinstalling a pending entry and
    // publishing `Pending`.
    let current_request = coordinator
        .notify_durable_commit(2, 20)
        .expect("current generation must schedule");
    assert!(coordinator.state.lock().unwrap().pending_autosave.is_some());
    assert_eq!(
        coordinator.persistence_health(),
        PersistenceHealthView::Pending
    );
    // The stale ticket never entered the coordinator's ticket table; the
    // current request's ticket is the live autosave intent.
    assert!(coordinator
        .state
        .lock()
        .unwrap()
        .tickets
        .contains_key(&current_request.ticket));
}

#[tokio::test(start_paused = true)]
async fn stale_notify_durable_commit_is_rejected_before_mutating_coordinator_state() {
    // The public `notify_durable_commit` path must enforce the generation
    // fence atomically inside `issue_thumbnail`, before a stale ticket is
    // issued. Otherwise the stale call would insert a ticket, supersede
    // `latest_by_intent[Autosave]`, and publish `Capturing`, and the late
    // `record_schedule_failure` fence (which early-returns on stale
    // generations) would leave all of that installed.
    let backend = Arc::new(RecordingBackend::default());
    let coordinator = SaveCoordinator::with_backend(backend.clone());

    // Simulate the post-replacement coordinator state that
    // `replace_session_for_e2e` installs under its locks.
    let serial_before = {
        let mut state = coordinator.state.lock().unwrap();
        state.next_session_generation = 2;
        state.pending_autosave = None;
        state.persistence_health = PersistenceHealthView::Healthy;
        state.thumbnail_activity = ThumbnailActivityView::Idle;
        state.next_autosave_serial
    };

    // An older-session durable commit through the public path returns `None`
    // and must not touch any coordinator state.
    assert!(coordinator.notify_durable_commit(1, 11).is_none());

    let state = coordinator.state.lock().unwrap();
    assert!(
        state.tickets.is_empty(),
        "stale notify must not issue a ticket"
    );
    assert!(
        state.latest_by_intent.is_empty(),
        "stale notify must not install a latest-intent ticket"
    );
    assert!(
        state.pending_autosave.is_none(),
        "stale notify must not install a pending autosave"
    );
    assert_eq!(
        state.next_autosave_serial, serial_before,
        "stale notify must not advance next_autosave_serial"
    );
    drop(state);
    assert_eq!(
        coordinator.persistence_health(),
        PersistenceHealthView::Healthy,
        "stale notify must not degrade health"
    );
    assert_eq!(
        coordinator.thumbnail_activity(),
        ThumbnailActivityView::Idle,
        "stale notify must not publish Capturing"
    );
}

#[tokio::test(start_paused = true)]
async fn stale_notify_durable_commit_cannot_supersede_live_replacement_autosave_ticket() {
    // Supersession regression: an old-session completion must not overwrite or
    // cancel the replacement session's live autosave intent. Both the stale
    // and the live autosave share `CaptureIntent::Autosave`, so without the
    // atomic fence in `issue_thumbnail` the stale call would evict the live
    // ticket from `latest_by_intent` and remove it from `tickets`, leaving the
    // replacement session's pending autosave referencing a missing ticket.
    let backend = Arc::new(RecordingBackend::default());
    let coordinator = SaveCoordinator::with_backend(backend.clone());

    {
        let mut state = coordinator.state.lock().unwrap();
        state.next_session_generation = 2;
        state.pending_autosave = None;
        state.persistence_health = PersistenceHealthView::Healthy;
        state.thumbnail_activity = ThumbnailActivityView::Idle;
    }

    // Schedule a valid generation-2 autosave through the public path and
    // retain its ticket as the live replacement intent.
    let live_request = coordinator
        .notify_durable_commit(2, 20)
        .expect("current generation must schedule");
    let live_pending = coordinator
        .state
        .lock()
        .unwrap()
        .pending_autosave
        .clone()
        .expect("live autosave must be pending");
    assert_eq!(live_pending.ticket, live_request.ticket);

    // An older-session durable commit arrives through the public path. It must
    // be rejected atomically and must not disturb the live intent.
    assert!(coordinator.notify_durable_commit(1, 11).is_none());

    let state = coordinator.state.lock().unwrap();
    assert!(
        state.tickets.contains_key(&live_request.ticket),
        "live replacement ticket must remain in tickets"
    );
    assert_eq!(
        state.latest_by_intent.get(&CaptureIntent::Autosave),
        Some(&live_request.ticket),
        "latest autosave intent must still point at the live ticket"
    );
    let pending_after = state.pending_autosave.as_ref();
    assert!(
        pending_after.is_some_and(|pending| pending.ticket == live_request.ticket),
        "pending autosave must still reference the live ticket"
    );
    drop(state);
    assert_eq!(
        coordinator.thumbnail_activity(),
        ThumbnailActivityView::Capturing,
        "thumbnail activity must still reflect the live capture"
    );
}
