use super::schema::{
    SaveDiagnosticView, SaveSlotRef, SaveSlotView, ThumbnailDiagnosticView,
    ThumbnailUnavailableReason,
};
use super::storage::select_autosave_target;
use super::thumbnail::ValidatedThumbnailCandidate;
use crate::game::GameError;
use serde::{Deserialize, Serialize, Serializer};
use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::Duration;
use tokio::sync::Notify;
use tokio::time::Instant;
use uuid::Uuid;

pub(crate) const AUTOSAVE_DEBOUNCE: Duration = Duration::from_millis(500);
pub(crate) const THUMBNAIL_CAPTURE_TIMEOUT: Duration = Duration::from_millis(1000);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum ThumbnailCapturePurpose {
    Autosave {
        session_generation: u64,
        durable_revision: u64,
    },
    ManualSave {
        session_generation: u64,
        durable_revision: u64,
    },
    AcquisitionAcknowledgement {
        session_generation: u64,
        source_revision: u64,
        next_revision: u64,
        event_id: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum PreparedThumbnailPurpose {
    ManualSave,
    AcquisitionAcknowledgement { event_id: String },
}

#[derive(Debug, Clone)]
pub(crate) struct ThumbnailCaptureRequestView {
    pub(crate) ticket: String,
    deadline_at: Instant,
}

impl ThumbnailCaptureRequestView {
    pub(crate) fn timeout_ms(&self) -> u32 {
        remaining_timeout_ms(self.deadline_at, Instant::now())
    }
}

impl Serialize for ThumbnailCaptureRequestView {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct WireView<'a> {
            ticket: &'a str,
            timeout_ms: u32,
        }

        WireView {
            ticket: &self.ticket,
            timeout_ms: self.timeout_ms(),
        }
        .serialize(serializer)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum PersistenceHealthView {
    Healthy,
    Pending,
    Degraded { diagnostic: SaveDiagnosticView },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum ThumbnailActivityView {
    Idle,
    Capturing,
    Unavailable { diagnostic: ThumbnailDiagnosticView },
}

#[derive(Debug)]
pub(crate) enum CaptureTerminalResult {
    Available(ValidatedThumbnailCandidate),
    Unavailable,
}

pub(crate) type CoordinatorFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub(crate) struct AutosaveWriteJob {
    pub(crate) session_generation: u64,
    pub(crate) durable_revision: u64,
    pub(crate) thumbnail: CaptureTerminalResult,
}

impl AutosaveWriteJob {
    pub(crate) fn thumbnail_available(&self) -> bool {
        matches!(self.thumbnail, CaptureTerminalResult::Available(_))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AutosaveWriteReceipt {
    pub(crate) session_generation: u64,
    pub(crate) durable_revision: u64,
    pub(crate) slot: SaveSlotRef,
    pub(crate) save_id: String,
}

pub(crate) struct AutosaveCapture {
    job: AutosaveWriteJob,
    slots: Vec<SaveSlotView>,
}

impl AutosaveCapture {
    pub(crate) fn new(job: AutosaveWriteJob, slots: Vec<SaveSlotView>) -> Self {
        Self { job, slots }
    }
}

pub(crate) struct AutosavePreparedWrite {
    capture: AutosaveCapture,
    target: SaveSlotRef,
    save_id: String,
}

impl AutosavePreparedWrite {
    pub(crate) fn new(capture: AutosaveCapture, target: SaveSlotRef, save_id: String) -> Self {
        Self {
            capture,
            target,
            save_id,
        }
    }

    pub(crate) fn session_generation(&self) -> u64 {
        self.capture.job.session_generation
    }

    pub(crate) fn receipt(&self) -> AutosaveWriteReceipt {
        AutosaveWriteReceipt {
            session_generation: self.capture.job.session_generation,
            durable_revision: self.capture.job.durable_revision,
            slot: self.target,
            save_id: self.save_id.clone(),
        }
    }
}

pub(crate) enum AutosaveCommitOutcome {
    Committed(AutosaveWriteReceipt),
    Stale(AutosavePreparedWrite),
}

pub(crate) trait AutosaveBackend: Send + Sync {
    fn capture(
        &self,
        job: AutosaveWriteJob,
    ) -> CoordinatorFuture<'_, Result<AutosaveCapture, GameError>>;

    fn prepare(
        &self,
        capture: AutosaveCapture,
        target: SaveSlotRef,
        save_id: String,
    ) -> CoordinatorFuture<'_, Result<AutosavePreparedWrite, GameError>>;

    fn commit_if_current(
        &self,
        prepared: AutosavePreparedWrite,
    ) -> CoordinatorFuture<'_, Result<AutosaveCommitOutcome, GameError>>;

    fn discard(
        &self,
        prepared: AutosavePreparedWrite,
    ) -> CoordinatorFuture<'_, Result<(), GameError>>;

    fn cleanup_orphans(&self) -> CoordinatorFuture<'_, Result<(), GameError>> {
        Box::pin(async { Ok(()) })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BackgroundRetryTrigger {
    ManualSave,
    Flush,
}

#[derive(Debug, Clone)]
pub(crate) struct CommittedNotification<T> {
    pub(crate) committed: T,
    pub(crate) thumbnail_capture: Option<ThumbnailCaptureRequestView>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum WriterJobClass {
    Debounced {
        session_generation: u64,
        durable_revision: u64,
    },
    AcquisitionAcknowledgement,
    OrphanCleanup,
}

struct QueuedWriterJob {
    class: WriterJobClass,
    run: CoordinatorFuture<'static, ()>,
}

#[derive(Default)]
struct WriterQueueState {
    running: bool,
    acknowledgements: VecDeque<QueuedWriterJob>,
    ordinary: VecDeque<QueuedWriterJob>,
}

#[derive(Default)]
struct WriterQueue {
    state: Mutex<WriterQueueState>,
}

impl WriterQueue {
    fn enqueue(
        self: &Arc<Self>,
        class: WriterJobClass,
        run: CoordinatorFuture<'static, ()>,
    ) -> Result<(), GameError> {
        let runtime =
            tokio::runtime::Handle::try_current().map_err(|_| GameError::save_write_failed())?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| GameError::save_write_failed())?;
        if let WriterJobClass::Debounced {
            session_generation, ..
        } = class
        {
            state.ordinary.retain(|job| {
                !matches!(
                    job.class,
                    WriterJobClass::Debounced {
                        session_generation: queued_generation,
                        ..
                    } if queued_generation == session_generation
                )
            });
        }
        let job = QueuedWriterJob {
            class: class.clone(),
            run,
        };
        if matches!(class, WriterJobClass::AcquisitionAcknowledgement) {
            state.acknowledgements.push_back(job);
        } else {
            state.ordinary.push_back(job);
        }
        let start_worker = !state.running;
        if start_worker {
            state.running = true;
        }
        drop(state);
        if start_worker {
            let queue = Arc::clone(self);
            runtime.spawn(async move {
                queue.run().await;
            });
        }
        Ok(())
    }

    async fn run(self: Arc<Self>) {
        loop {
            let next = {
                let Ok(mut state) = self.state.lock() else {
                    return;
                };
                let next = state
                    .acknowledgements
                    .pop_front()
                    .or_else(|| state.ordinary.pop_front());
                if next.is_none() {
                    state.running = false;
                }
                next
            };
            let Some(job) = next else {
                return;
            };
            job.run.await;
        }
    }
}

type HealthSubscriber = Arc<dyn Fn(PersistenceHealthView) + Send + Sync>;
type ActivitySubscriber = Arc<dyn Fn(ThumbnailActivityView) + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum CaptureIntent {
    Autosave,
    ManualSave,
    AcquisitionAcknowledgement,
}

impl ThumbnailCapturePurpose {
    fn intent(&self) -> CaptureIntent {
        match self {
            Self::Autosave { .. } => CaptureIntent::Autosave,
            Self::ManualSave { .. } => CaptureIntent::ManualSave,
            Self::AcquisitionAcknowledgement { .. } => CaptureIntent::AcquisitionAcknowledgement,
        }
    }
}

struct TicketRecord {
    purpose: ThumbnailCapturePurpose,
    issued_at: Instant,
    deadline_at: Instant,
    terminal: Option<CaptureTerminalResult>,
}

#[derive(Clone)]
struct PendingAutosave {
    serial: u64,
    session_generation: u64,
    durable_revision: u64,
    ticket: String,
    purpose: ThumbnailCapturePurpose,
    debounce_deadline: Instant,
    capture_deadline: Instant,
}

struct CoordinatorState {
    tickets: HashMap<String, TicketRecord>,
    latest_by_intent: HashMap<CaptureIntent, String>,
    persistence_health: PersistenceHealthView,
    thumbnail_activity: ThumbnailActivityView,
    health_subscribers: Vec<HealthSubscriber>,
    activity_subscribers: Vec<ActivitySubscriber>,
    next_autosave_serial: u64,
    pending_autosave: Option<PendingAutosave>,
    last_successful_write: Option<AutosaveWriteReceipt>,
    autosave_target: Option<SaveSlotRef>,
    failed_revision: Option<(u64, u64)>,
}

impl Default for CoordinatorState {
    fn default() -> Self {
        Self {
            tickets: HashMap::new(),
            latest_by_intent: HashMap::new(),
            persistence_health: PersistenceHealthView::Healthy,
            thumbnail_activity: ThumbnailActivityView::Idle,
            health_subscribers: Vec::new(),
            activity_subscribers: Vec::new(),
            next_autosave_serial: 0,
            pending_autosave: None,
            last_successful_write: None,
            autosave_target: None,
            failed_revision: None,
        }
    }
}

#[derive(Clone)]
pub(crate) struct SaveCoordinator {
    state: Arc<Mutex<CoordinatorState>>,
    ticket_updates: Arc<Notify>,
    writer_queue: Arc<WriterQueue>,
    backend: Option<Arc<dyn AutosaveBackend>>,
    fail_next_schedule: Arc<AtomicBool>,
}

impl Default for SaveCoordinator {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(CoordinatorState::default())),
            ticket_updates: Arc::new(Notify::new()),
            writer_queue: Arc::new(WriterQueue::default()),
            backend: None,
            fail_next_schedule: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl SaveCoordinator {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn notify_durable_commit(
        &self,
        session_generation: u64,
        durable_revision: u64,
    ) -> Option<ThumbnailCaptureRequestView> {
        let purpose = ThumbnailCapturePurpose::Autosave {
            session_generation,
            durable_revision,
        };
        match self.issue_thumbnail(purpose.clone()) {
            Ok(request) => {
                if let Err(error) = self.schedule_autosave(
                    purpose,
                    request.ticket.clone(),
                    request.deadline_at,
                    false,
                ) {
                    self.cancel_ticket(&request.ticket);
                    self.publish_persistence_health(PersistenceHealthView::Degraded {
                        diagnostic: error,
                    });
                    None
                } else {
                    Some(request)
                }
            }
            Err(error) => {
                self.publish_persistence_health(PersistenceHealthView::Degraded {
                    diagnostic: error,
                });
                None
            }
        }
    }

    pub(crate) fn notify_committed<T>(
        &self,
        committed: T,
        session_generation: u64,
        durable_revision: u64,
    ) -> CommittedNotification<T> {
        CommittedNotification {
            committed,
            thumbnail_capture: self.notify_durable_commit(session_generation, durable_revision),
        }
    }

    pub(crate) fn retry_failed_background(
        &self,
        _trigger: BackgroundRetryTrigger,
    ) -> Option<ThumbnailCaptureRequestView> {
        let (session_generation, durable_revision) = self
            .state
            .lock()
            .ok()
            .and_then(|state| state.failed_revision)?;
        let purpose = ThumbnailCapturePurpose::Autosave {
            session_generation,
            durable_revision,
        };
        let request = self.issue_thumbnail(purpose.clone()).ok()?;
        if let Err(error) =
            self.schedule_autosave(purpose, request.ticket.clone(), request.deadline_at, true)
        {
            self.cancel_ticket(&request.ticket);
            self.publish_persistence_health(PersistenceHealthView::Degraded { diagnostic: error });
            None
        } else {
            Some(request)
        }
    }

    pub(crate) fn last_successful_write(&self) -> Option<AutosaveWriteReceipt> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.last_successful_write.clone())
    }

    pub(crate) fn autosave_target(&self) -> Option<SaveSlotRef> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.autosave_target)
    }

    pub(crate) fn reserve_acknowledgement_writer(
        &self,
        run: CoordinatorFuture<'static, ()>,
    ) -> Result<(), GameError> {
        self.writer_queue
            .enqueue(WriterJobClass::AcquisitionAcknowledgement, run)
    }

    pub(crate) fn enqueue_orphan_cleanup(&self) -> Result<(), GameError> {
        let backend = self
            .backend
            .as_ref()
            .cloned()
            .ok_or_else(GameError::save_write_failed)?;
        let coordinator = self.clone();
        self.writer_queue.enqueue(
            WriterJobClass::OrphanCleanup,
            Box::pin(async move {
                if let Err(error) = backend.cleanup_orphans().await {
                    coordinator.publish_persistence_health(PersistenceHealthView::Degraded {
                        diagnostic: error,
                    });
                }
            }),
        )
    }

    pub(crate) fn prepare_thumbnail(
        &self,
        purpose: ThumbnailCapturePurpose,
    ) -> Result<ThumbnailCaptureRequestView, GameError> {
        self.issue_thumbnail(purpose)
    }

    pub(crate) fn submit_thumbnail(
        &self,
        ticket: &str,
        png: &[u8],
    ) -> Result<ThumbnailActivityView, GameError> {
        let now = Instant::now();
        let candidate = ValidatedThumbnailCandidate::from_png(png.to_vec());
        let mut state = self.lock_state()?;
        let record = live_record_mut(&mut state, ticket, now)?;
        let (result, activity) = match candidate {
            Ok(candidate) => (
                Ok(()),
                (
                    CaptureTerminalResult::Available(candidate),
                    ThumbnailActivityView::Idle,
                ),
            ),
            Err(error) => (
                Err(error),
                (
                    CaptureTerminalResult::Unavailable,
                    capture_unavailable_activity(),
                ),
            ),
        };
        record.terminal = Some(activity.0);
        let view = activity.1;
        let subscribers = set_thumbnail_activity(&mut state, view.clone());
        drop(state);
        publish_activity(&subscribers, &view);
        self.ticket_updates.notify_waiters();
        result.map(|()| view)
    }

    pub(crate) fn report_thumbnail_failure(
        &self,
        ticket: &str,
    ) -> Result<ThumbnailActivityView, GameError> {
        let now = Instant::now();
        let mut state = self.lock_state()?;
        let record = live_record_mut(&mut state, ticket, now)?;
        record.terminal = Some(CaptureTerminalResult::Unavailable);
        let view = capture_unavailable_activity();
        let subscribers = set_thumbnail_activity(&mut state, view.clone());
        drop(state);
        publish_activity(&subscribers, &view);
        self.ticket_updates.notify_waiters();
        Ok(view)
    }

    pub(crate) fn claim_thumbnail(
        &self,
        ticket: &str,
        expected: &ThumbnailCapturePurpose,
    ) -> Result<CaptureTerminalResult, GameError> {
        let now = Instant::now();
        let mut state = self.lock_state()?;
        let expired = {
            let record = state
                .tickets
                .get_mut(ticket)
                .ok_or_else(GameError::stale_thumbnail_ticket)?;
            if &record.purpose != expected {
                return Err(GameError::stale_thumbnail_ticket());
            }
            if record.terminal.is_none() && now >= record.deadline_at {
                record.terminal = Some(CaptureTerminalResult::Unavailable);
                true
            } else {
                false
            }
        };
        let (subscribers, expired_view) = if expired {
            let view = capture_unavailable_activity();
            (set_thumbnail_activity(&mut state, view.clone()), Some(view))
        } else {
            (Vec::new(), None)
        };
        let mut record = state
            .tickets
            .remove(ticket)
            .ok_or_else(GameError::stale_thumbnail_ticket)?;
        state.latest_by_intent.remove(&record.purpose.intent());
        let result = record
            .terminal
            .take()
            .ok_or_else(GameError::stale_thumbnail_ticket);
        drop(state);
        if let Some(view) = expired_view {
            publish_activity(&subscribers, &view);
        }
        result
    }

    pub(crate) fn persistence_health(&self) -> PersistenceHealthView {
        self.state
            .lock()
            .map(|state| state.persistence_health.clone())
            .unwrap_or_else(|_| PersistenceHealthView::Degraded {
                diagnostic: GameError::save_write_failed(),
            })
    }

    pub(crate) fn thumbnail_activity(&self) -> ThumbnailActivityView {
        self.state
            .lock()
            .map(|state| state.thumbnail_activity.clone())
            .unwrap_or_else(|_| capture_unavailable_activity())
    }

    pub(crate) fn subscribe(
        &self,
        health: impl Fn(PersistenceHealthView) + Send + Sync + 'static,
        activity: impl Fn(ThumbnailActivityView) + Send + Sync + 'static,
    ) {
        let health: HealthSubscriber = Arc::new(health);
        let activity: ActivitySubscriber = Arc::new(activity);
        let Ok(mut state) = self.state.lock() else {
            health(PersistenceHealthView::Degraded {
                diagnostic: GameError::save_write_failed(),
            });
            activity(capture_unavailable_activity());
            return;
        };
        let current_health = state.persistence_health.clone();
        let current_activity = state.thumbnail_activity.clone();
        state.health_subscribers.push(Arc::clone(&health));
        state.activity_subscribers.push(Arc::clone(&activity));
        drop(state);
        health(current_health);
        activity(current_activity);
    }

    pub(crate) fn publish_persistence_health(&self, view: PersistenceHealthView) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        state.persistence_health = view.clone();
        let subscribers = state.health_subscribers.clone();
        drop(state);
        for subscriber in subscribers {
            subscriber(view.clone());
        }
    }

    fn schedule_autosave(
        &self,
        purpose: ThumbnailCapturePurpose,
        ticket: String,
        capture_deadline: Instant,
        allow_unchanged_retry: bool,
    ) -> Result<(), GameError> {
        if self.backend.is_none() || self.fail_next_schedule.swap(false, Ordering::SeqCst) {
            return Err(GameError::save_write_failed());
        }
        let (session_generation, durable_revision) = match purpose {
            ThumbnailCapturePurpose::Autosave {
                session_generation,
                durable_revision,
            } => (session_generation, durable_revision),
            _ => return Err(GameError::thumbnail_ticket_purpose_mismatch()),
        };
        let debounce_deadline = Instant::now() + AUTOSAVE_DEBOUNCE;
        let pending = {
            let mut state = self.lock_state()?;
            if !allow_unchanged_retry
                && state
                    .failed_revision
                    .is_some_and(|(failed_generation, failed_revision)| {
                        failed_generation == session_generation
                            && durable_revision <= failed_revision
                    })
            {
                return Err(GameError::save_write_failed());
            }
            state.next_autosave_serial = state.next_autosave_serial.wrapping_add(1);
            let pending = PendingAutosave {
                serial: state.next_autosave_serial,
                session_generation,
                durable_revision,
                ticket,
                purpose,
                debounce_deadline,
                capture_deadline,
            };
            state.pending_autosave = Some(pending.clone());
            pending
        };
        self.publish_persistence_health(PersistenceHealthView::Pending);
        let coordinator = self.clone();
        tokio::runtime::Handle::try_current()
            .map_err(|_| GameError::save_write_failed())?
            .spawn(async move {
                tokio::time::sleep_until(pending.debounce_deadline).await;
                coordinator.run_pending_autosave(pending).await;
            });
        Ok(())
    }

    async fn run_pending_autosave(&self, pending: PendingAutosave) {
        if !self.pending_matches(&pending) {
            return;
        }
        let thumbnail = match self
            .wait_for_terminal_thumbnail(
                &pending.ticket,
                &pending.purpose,
                pending.capture_deadline,
            )
            .await
        {
            Ok(result) => result,
            Err(error) if error.code == "staleThumbnailTicket" => return,
            Err(error) => {
                self.record_background_failure(
                    pending.session_generation,
                    pending.durable_revision,
                    error,
                );
                return;
            }
        };
        if !self.pending_matches(&pending) {
            return;
        }
        let coordinator = self.clone();
        let class = WriterJobClass::Debounced {
            session_generation: pending.session_generation,
            durable_revision: pending.durable_revision,
        };
        let failed_identity = (pending.session_generation, pending.durable_revision);
        if let Err(error) = self.writer_queue.enqueue(
            class,
            Box::pin(async move {
                coordinator
                    .execute_pending_autosave(pending, thumbnail)
                    .await;
            }),
        ) {
            self.record_background_failure(failed_identity.0, failed_identity.1, error);
        }
    }

    async fn execute_pending_autosave(
        &self,
        pending: PendingAutosave,
        thumbnail: CaptureTerminalResult,
    ) {
        if !self.pending_matches(&pending) {
            return;
        }
        let Some(backend) = self.backend.as_ref() else {
            self.record_background_failure(
                pending.session_generation,
                pending.durable_revision,
                GameError::save_write_failed(),
            );
            return;
        };
        let capture = match backend
            .capture(AutosaveWriteJob {
                session_generation: pending.session_generation,
                durable_revision: pending.durable_revision,
                thumbnail,
            })
            .await
        {
            Ok(capture) => capture,
            Err(error) => {
                self.record_background_failure(
                    pending.session_generation,
                    pending.durable_revision,
                    error,
                );
                return;
            }
        };
        let target = match select_autosave_target(&capture.slots) {
            Ok(target) => target,
            Err(error) => {
                self.record_background_failure(
                    pending.session_generation,
                    pending.durable_revision,
                    error,
                );
                return;
            }
        };
        let save_id = Uuid::new_v4().hyphenated().to_string();
        let prepared = match backend.prepare(capture, target, save_id).await {
            Ok(prepared) => prepared,
            Err(error) => {
                self.record_background_failure(
                    pending.session_generation,
                    pending.durable_revision,
                    error,
                );
                return;
            }
        };
        match backend.commit_if_current(prepared).await {
            Ok(AutosaveCommitOutcome::Committed(receipt))
                if receipt.session_generation == pending.session_generation
                    && receipt.durable_revision == pending.durable_revision =>
            {
                self.record_background_success(&pending, receipt)
            }
            Ok(AutosaveCommitOutcome::Committed(_)) => self.record_background_failure(
                pending.session_generation,
                pending.durable_revision,
                GameError::stale_session_generation(),
            ),
            Ok(AutosaveCommitOutcome::Stale(prepared)) => match backend.discard(prepared).await {
                Ok(()) => self.record_stale_write(&pending),
                Err(error) => self.record_background_failure(
                    pending.session_generation,
                    pending.durable_revision,
                    error,
                ),
            },
            Err(error) => self.record_background_failure(
                pending.session_generation,
                pending.durable_revision,
                error,
            ),
        }
    }

    async fn wait_for_terminal_thumbnail(
        &self,
        ticket: &str,
        expected: &ThumbnailCapturePurpose,
        deadline: Instant,
    ) -> Result<CaptureTerminalResult, GameError> {
        loop {
            if let Some(result) = self.take_terminal_thumbnail(ticket, expected)? {
                return Ok(result);
            }
            if Instant::now() >= deadline {
                return self.claim_thumbnail(ticket, expected);
            }
            tokio::select! {
                _ = self.ticket_updates.notified() => {}
                _ = tokio::time::sleep_until(deadline) => {}
            }
        }
    }

    fn take_terminal_thumbnail(
        &self,
        ticket: &str,
        expected: &ThumbnailCapturePurpose,
    ) -> Result<Option<CaptureTerminalResult>, GameError> {
        let mut state = self.lock_state()?;
        let record = state
            .tickets
            .get(ticket)
            .ok_or_else(GameError::stale_thumbnail_ticket)?;
        if &record.purpose != expected {
            return Err(GameError::stale_thumbnail_ticket());
        }
        if record.terminal.is_none() {
            return Ok(None);
        }
        let mut record = state
            .tickets
            .remove(ticket)
            .ok_or_else(GameError::stale_thumbnail_ticket)?;
        state.latest_by_intent.remove(&record.purpose.intent());
        Ok(record.terminal.take())
    }

    fn pending_matches(&self, pending: &PendingAutosave) -> bool {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.pending_autosave.as_ref().map(|live| live.serial))
            == Some(pending.serial)
    }

    fn record_background_success(
        &self,
        completed: &PendingAutosave,
        receipt: AutosaveWriteReceipt,
    ) {
        let health = if let Ok(mut state) = self.state.lock() {
            state.autosave_target = Some(receipt.slot);
            state.last_successful_write = Some(receipt);
            state.failed_revision = None;
            if state
                .pending_autosave
                .as_ref()
                .is_some_and(|pending| pending.serial == completed.serial)
            {
                state.pending_autosave = None;
            }
            if state.pending_autosave.is_some() {
                PersistenceHealthView::Pending
            } else {
                PersistenceHealthView::Healthy
            }
        } else {
            PersistenceHealthView::Degraded {
                diagnostic: GameError::save_write_failed(),
            }
        };
        self.publish_persistence_health(health);
    }

    fn record_stale_write(&self, completed: &PendingAutosave) {
        let health = if let Ok(mut state) = self.state.lock() {
            if state
                .pending_autosave
                .as_ref()
                .is_some_and(|pending| pending.serial == completed.serial)
            {
                state.pending_autosave = None;
            }
            if state.pending_autosave.is_some() {
                PersistenceHealthView::Pending
            } else {
                PersistenceHealthView::Healthy
            }
        } else {
            PersistenceHealthView::Degraded {
                diagnostic: GameError::save_write_failed(),
            }
        };
        self.publish_persistence_health(health);
    }

    fn record_background_failure(
        &self,
        session_generation: u64,
        durable_revision: u64,
        error: GameError,
    ) {
        if let Ok(mut state) = self.state.lock() {
            state.failed_revision = Some((session_generation, durable_revision));
            if state.pending_autosave.as_ref().is_some_and(|pending| {
                pending.session_generation == session_generation
                    && pending.durable_revision == durable_revision
            }) {
                state.pending_autosave = None;
            }
        }
        self.publish_persistence_health(PersistenceHealthView::Degraded { diagnostic: error });
    }

    fn cancel_ticket(&self, ticket: &str) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(record) = state.tickets.remove(ticket) {
                state.latest_by_intent.remove(&record.purpose.intent());
            }
        }
        self.ticket_updates.notify_waiters();
    }

    fn issue_thumbnail(
        &self,
        purpose: ThumbnailCapturePurpose,
    ) -> Result<ThumbnailCaptureRequestView, GameError> {
        let runtime =
            tokio::runtime::Handle::try_current().map_err(|_| GameError::save_write_failed())?;
        let issued_at = Instant::now();
        let deadline_at = issued_at + THUMBNAIL_CAPTURE_TIMEOUT;
        let ticket = Uuid::new_v4().hyphenated().to_string();
        let intent = purpose.intent();
        let mut state = self.lock_state()?;
        if let Some(superseded) = state.latest_by_intent.insert(intent, ticket.clone()) {
            state.tickets.remove(&superseded);
        }
        state.tickets.insert(
            ticket.clone(),
            TicketRecord {
                purpose,
                issued_at,
                deadline_at,
                terminal: None,
            },
        );
        let view = ThumbnailActivityView::Capturing;
        let subscribers = set_thumbnail_activity(&mut state, view.clone());
        drop(state);
        publish_activity(&subscribers, &view);
        spawn_ticket_expiry(
            &runtime,
            Arc::downgrade(&self.state),
            ticket.clone(),
            deadline_at,
            Arc::downgrade(&self.ticket_updates),
        );
        Ok(ThumbnailCaptureRequestView {
            ticket,
            deadline_at,
        })
    }

    fn lock_state(&self) -> Result<MutexGuard<'_, CoordinatorState>, GameError> {
        self.state
            .lock()
            .map_err(|_| GameError::save_write_failed())
    }

    #[cfg(test)]
    fn ticket_only() -> Self {
        Self::new()
    }

    #[cfg(test)]
    fn with_backend(backend: Arc<dyn AutosaveBackend>) -> Self {
        Self {
            backend: Some(backend),
            ..Self::default()
        }
    }

    #[cfg(test)]
    fn fail_next_schedule_for_test(&self) {
        self.fail_next_schedule.store(true, Ordering::SeqCst);
    }

    #[cfg(test)]
    fn enqueue_writer_probe(
        &self,
        class: WriterJobClass,
        label: &'static str,
        probe: Arc<WriterQueueProbe>,
    ) {
        self.writer_queue
            .enqueue(
                class,
                Box::pin(async move {
                    probe.run(label).await;
                }),
            )
            .expect("test runtime and writer queue are available");
    }

    #[cfg(test)]
    fn ticket_deadline(&self, ticket: &str) -> Result<Instant, GameError> {
        self.lock_state()?
            .tickets
            .get(ticket)
            .map(|record| record.deadline_at)
            .ok_or_else(GameError::stale_thumbnail_ticket)
    }

    #[cfg(test)]
    fn ticket_issued_at(&self, ticket: &str) -> Result<Instant, GameError> {
        self.lock_state()?
            .tickets
            .get(ticket)
            .map(|record| record.issued_at)
            .ok_or_else(GameError::stale_thumbnail_ticket)
    }
}

#[cfg(test)]
#[derive(Default)]
struct WriterProbeState {
    started: Vec<&'static str>,
    completed: usize,
    active: usize,
    max_concurrent: usize,
}

#[cfg(test)]
pub(crate) struct WriterQueueProbe {
    state: Mutex<WriterProbeState>,
    paused: AtomicBool,
    started: Notify,
    completed: Notify,
    release: Notify,
}

#[cfg(test)]
impl WriterQueueProbe {
    fn paused() -> Self {
        Self {
            state: Mutex::new(WriterProbeState::default()),
            paused: AtomicBool::new(true),
            started: Notify::new(),
            completed: Notify::new(),
            release: Notify::new(),
        }
    }

    async fn run(&self, label: &'static str) {
        {
            let mut state = self.state.lock().unwrap();
            state.started.push(label);
            state.active += 1;
            state.max_concurrent = state.max_concurrent.max(state.active);
        }
        self.started.notify_waiters();
        while self.paused.load(Ordering::SeqCst) {
            self.release.notified().await;
        }
        {
            let mut state = self.state.lock().unwrap();
            state.active -= 1;
            state.completed += 1;
        }
        self.completed.notify_waiters();
    }

    async fn wait_until_started(&self, label: &str) {
        loop {
            if self.started_labels().contains(&label) {
                return;
            }
            self.started.notified().await;
        }
    }

    fn release_all(&self) {
        self.paused.store(false, Ordering::SeqCst);
        self.release.notify_waiters();
    }

    async fn wait_for_completions(&self, expected: usize) {
        loop {
            if self.state.lock().unwrap().completed >= expected {
                return;
            }
            self.completed.notified().await;
        }
    }

    fn started_labels(&self) -> Vec<&'static str> {
        self.state.lock().unwrap().started.clone()
    }

    fn max_concurrent(&self) -> usize {
        self.state.lock().unwrap().max_concurrent
    }
}

fn remaining_timeout_ms(deadline_at: Instant, now: Instant) -> u32 {
    deadline_at
        .checked_duration_since(now)
        .unwrap_or(Duration::ZERO)
        .as_millis()
        .min(u128::from(u32::MAX)) as u32
}

fn live_record_mut<'a>(
    state: &'a mut CoordinatorState,
    ticket: &str,
    now: Instant,
) -> Result<&'a mut TicketRecord, GameError> {
    let record = state
        .tickets
        .get_mut(ticket)
        .ok_or_else(GameError::stale_thumbnail_ticket)?;
    if record.terminal.is_some() || now >= record.deadline_at {
        return Err(GameError::stale_thumbnail_ticket());
    }
    Ok(record)
}

fn capture_unavailable_activity() -> ThumbnailActivityView {
    ThumbnailActivityView::Unavailable {
        diagnostic: ThumbnailDiagnosticView {
            reason: ThumbnailUnavailableReason::CaptureUnavailable,
            message: "Thumbnail capture is unavailable.".into(),
            retryable: false,
        },
    }
}

fn set_thumbnail_activity(
    state: &mut CoordinatorState,
    view: ThumbnailActivityView,
) -> Vec<ActivitySubscriber> {
    state.thumbnail_activity = view;
    state.activity_subscribers.clone()
}

fn publish_activity(subscribers: &[ActivitySubscriber], view: &ThumbnailActivityView) {
    for subscriber in subscribers {
        subscriber(view.clone());
    }
}

fn spawn_ticket_expiry(
    runtime: &tokio::runtime::Handle,
    state: Weak<Mutex<CoordinatorState>>,
    ticket: String,
    deadline_at: Instant,
    updates: Weak<Notify>,
) {
    runtime.spawn(async move {
        tokio::time::sleep_until(deadline_at).await;
        let Some(state) = state.upgrade() else {
            return;
        };
        let Ok(mut state) = state.lock() else {
            return;
        };
        let Some(record) = state.tickets.get_mut(&ticket) else {
            return;
        };
        if record.terminal.is_some() {
            return;
        }
        record.terminal = Some(CaptureTerminalResult::Unavailable);
        let view = capture_unavailable_activity();
        let subscribers = set_thumbnail_activity(&mut state, view.clone());
        drop(state);
        publish_activity(&subscribers, &view);
        if let Some(updates) = updates.upgrade() {
            updates.notify_waiters();
        }
    });
}

#[cfg(test)]
mod tests {
    mod debounce {
        use super::super::{
            AutosaveBackend, AutosaveCapture, AutosaveCommitOutcome, AutosavePreparedWrite,
            AutosaveWriteJob, AutosaveWriteReceipt, BackgroundRetryTrigger, CoordinatorFuture,
            PersistenceHealthView, SaveCoordinator, ThumbnailActivityView, AUTOSAVE_DEBOUNCE,
            THUMBNAIL_CAPTURE_TIMEOUT,
        };
        use crate::game::save::schema::{SaveSlotRef, SaveSlotStatusView, SaveSlotView};
        use crate::game::GameError;
        use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
        use std::sync::{Arc, Mutex};
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
        struct RecordingBackend {
            writes: Mutex<Vec<WriteObservation>>,
            pause_writes: AtomicBool,
            started: Notify,
            release: Notify,
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
            fn paused() -> Self {
                Self {
                    pause_writes: AtomicBool::new(true),
                    ..Self::default()
                }
            }

            fn observations(&self) -> Vec<WriteObservation> {
                self.writes.lock().unwrap().clone()
            }

            async fn wait_until_started(&self) {
                if self.observations().is_empty() {
                    self.started.notified().await;
                }
            }

            fn release(&self) {
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

            fn prepare(
                &self,
                capture: AutosaveCapture,
                target: SaveSlotRef,
                save_id: String,
            ) -> CoordinatorFuture<'_, Result<AutosavePreparedWrite, GameError>> {
                Box::pin(async move { Ok(AutosavePreparedWrite::new(capture, target, save_id)) })
            }

            fn commit_if_current(
                &self,
                prepared: AutosavePreparedWrite,
            ) -> CoordinatorFuture<'_, Result<AutosaveCommitOutcome, GameError>> {
                Box::pin(async move {
                    let receipt = prepared.receipt();
                    self.writes.lock().unwrap().push(WriteObservation {
                        generation: receipt.session_generation,
                        revision: receipt.durable_revision,
                        thumbnail_available: prepared.capture.job.thumbnail_available(),
                    });
                    self.started.notify_waiters();
                    while self.pause_writes.load(Ordering::SeqCst) {
                        self.release.notified().await;
                    }
                    Ok(AutosaveCommitOutcome::Committed(receipt))
                })
            }

            fn discard(
                &self,
                _prepared: AutosavePreparedWrite,
            ) -> CoordinatorFuture<'_, Result<(), GameError>> {
                Box::pin(async { Ok(()) })
            }
        }

        struct PhasedBackend {
            phases: Mutex<Vec<&'static str>>,
            slots: Mutex<Vec<SaveSlotView>>,
            pause_prepare: AtomicBool,
            prepare_started: Notify,
            release_prepare: Notify,
            current_generation: AtomicU64,
            fail_commit: AtomicBool,
            installed: AtomicBool,
            discarded: AtomicBool,
            receipts: Mutex<Vec<AutosaveWriteReceipt>>,
            committed: Notify,
            cleanup_done: Notify,
            gameplay_lock: Mutex<()>,
            pause_point: Mutex<Option<PausePoint>>,
            reached_point: Mutex<Option<PausePoint>>,
            pause_reached: Notify,
            pause_release: Notify,
            fault_point: Mutex<Option<FaultPoint>>,
        }

        impl PhasedBackend {
            fn new(generation: u64) -> Self {
                Self {
                    phases: Mutex::new(Vec::new()),
                    slots: Mutex::new(empty_autosave_slots()),
                    pause_prepare: AtomicBool::new(false),
                    prepare_started: Notify::new(),
                    release_prepare: Notify::new(),
                    current_generation: AtomicU64::new(generation),
                    fail_commit: AtomicBool::new(false),
                    installed: AtomicBool::new(false),
                    discarded: AtomicBool::new(false),
                    receipts: Mutex::new(Vec::new()),
                    committed: Notify::new(),
                    cleanup_done: Notify::new(),
                    gameplay_lock: Mutex::new(()),
                    pause_point: Mutex::new(None),
                    reached_point: Mutex::new(None),
                    pause_reached: Notify::new(),
                    pause_release: Notify::new(),
                    fault_point: Mutex::new(None),
                }
            }

            fn pause_prepare(&self) {
                self.pause_prepare.store(true, Ordering::SeqCst);
            }

            async fn wait_for_prepare(&self) {
                if !self.phases.lock().unwrap().contains(&"W:prepare") {
                    self.prepare_started.notified().await;
                }
            }

            fn release_prepare(&self) {
                self.pause_prepare.store(false, Ordering::SeqCst);
                self.release_prepare.notify_waiters();
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
                    if *self.reached_point.lock().unwrap() == Some(point) {
                        return;
                    }
                    self.pause_reached.notified().await;
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
                    if *self.pause_point.lock().unwrap() != Some(point) {
                        return;
                    }
                    *self.reached_point.lock().unwrap() = Some(point);
                    self.pause_reached.notify_waiters();
                    self.pause_release.notified().await;
                }
            }

            async fn wait_for_receipts(&self, count: usize) {
                loop {
                    if self.receipts.lock().unwrap().len() >= count {
                        return;
                    }
                    self.committed.notified().await;
                }
            }

            fn phases(&self) -> Vec<&'static str> {
                self.phases.lock().unwrap().clone()
            }

            fn targets(&self) -> Vec<SaveSlotRef> {
                self.receipts
                    .lock()
                    .unwrap()
                    .iter()
                    .map(|receipt| receipt.slot)
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

            fn prepare(
                &self,
                capture: AutosaveCapture,
                target: SaveSlotRef,
                save_id: String,
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
                    Ok(AutosavePreparedWrite::new(capture, target, save_id))
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
                    if prepared.session_generation()
                        != self.current_generation.load(Ordering::SeqCst)
                    {
                        return Ok(AutosaveCommitOutcome::Stale(prepared));
                    }
                    drop(_session);
                    self.pause_if_requested(PausePoint::Replacement).await;
                    if self.take_fault(FaultPoint::BeforeReplacement) {
                        return Err(GameError::save_replace_failed());
                    }
                    if self.fail_commit.swap(false, Ordering::SeqCst) {
                        return Err(GameError::save_replace_failed());
                    }
                    self.phases.lock().unwrap().push("W+G:commit");
                    self.installed.store(true, Ordering::SeqCst);
                    let receipt = prepared.receipt();
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
                    Ok(AutosaveCommitOutcome::Committed(receipt))
                })
            }

            fn discard(
                &self,
                _prepared: AutosavePreparedWrite,
            ) -> CoordinatorFuture<'_, Result<(), GameError>> {
                Box::pin(async move {
                    self.phases.lock().unwrap().push("W:discard");
                    self.discarded.store(true, Ordering::SeqCst);
                    Ok(())
                })
            }

            fn cleanup_orphans(&self) -> CoordinatorFuture<'_, Result<(), GameError>> {
                Box::pin(async move {
                    self.phases.lock().unwrap().push("W:cleanup");
                    self.cleanup_done.notify_waiters();
                    Ok(())
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
        async fn normal_write_orders_capture_prepare_revalidate_commit_and_keeps_session_responsive(
        ) {
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

            assert!(backend.discarded.load(Ordering::SeqCst));
            assert!(!backend.installed.load(Ordering::SeqCst));
            assert!(backend.phases().ends_with(&["G:S:revalidate", "W:discard"]));
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
                coordinator.autosave_target(),
                Some(SaveSlotRef::Auto { slot: 2 })
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
                assert!(coordinator.autosave_target().is_none());
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
                assert!(coordinator.autosave_target().is_none(), "{point:?}");
            }
        }
    }

    mod writer {
        use super::super::{SaveCoordinator, WriterJobClass, WriterQueueProbe};
        use std::sync::Arc;
        use tokio::sync::Mutex;

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
        async fn waiting_for_writer_holds_neither_gate_nor_session_lock() {
            let coordinator = SaveCoordinator::new();
            let probe = Arc::new(WriterQueueProbe::paused());
            let gate = Arc::new(Mutex::new(()));
            let session = Arc::new(Mutex::new(()));

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

            assert!(gate.try_lock().is_ok());
            assert!(session.try_lock().is_ok());

            probe.release_all();
            probe.wait_for_completions(2).await;
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
            coordinator.enqueue_writer_probe(
                WriterJobClass::OrphanCleanup,
                "cleanup",
                probe.clone(),
            );

            probe.release_all();
            probe.wait_for_completions(2).await;

            assert_eq!(probe.started_labels(), ["save", "cleanup"]);
            assert_eq!(probe.max_concurrent(), 1);
        }
    }

    mod ticket {
        use super::super::{
            CaptureTerminalResult, PersistenceHealthView, SaveCoordinator, ThumbnailActivityView,
            ThumbnailCapturePurpose, THUMBNAIL_CAPTURE_TIMEOUT,
        };
        use crate::game::save::schema::{
            canonical_uuid_v4, ThumbnailUnavailableReason, MAX_THUMBNAIL_BYTES, MAX_THUMBNAIL_WIDTH,
        };
        use std::sync::{Arc, Mutex};
        use std::time::Duration;

        fn coordinator() -> SaveCoordinator {
            SaveCoordinator::ticket_only()
        }

        fn manual(generation: u64, revision: u64) -> ThumbnailCapturePurpose {
            ThumbnailCapturePurpose::ManualSave {
                session_generation: generation,
                durable_revision: revision,
            }
        }

        fn acknowledgement(
            generation: u64,
            source_revision: u64,
            next_revision: u64,
            event_id: &str,
        ) -> ThumbnailCapturePurpose {
            ThumbnailCapturePurpose::AcquisitionAcknowledgement {
                session_generation: generation,
                source_revision,
                next_revision,
                event_id: event_id.into(),
            }
        }

        fn png(width: u32, height: u32) -> Vec<u8> {
            let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
            bytes.extend_from_slice(&width.to_be_bytes());
            bytes.extend_from_slice(&height.to_be_bytes());
            bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
            bytes.extend_from_slice(&[0, 0, 0, 0]);
            bytes
        }

        #[tokio::test(start_paused = true)]
        async fn ticket_is_a_canonical_uuid_v4_with_one_exact_deadline() {
            let coordinator = coordinator();
            let request = coordinator.prepare_thumbnail(manual(7, 11)).unwrap();

            assert_eq!(
                canonical_uuid_v4(&request.ticket)
                    .unwrap()
                    .get_version_num(),
                4
            );
            assert_eq!(request.timeout_ms(), 1_000);
            assert_eq!(
                coordinator.ticket_deadline(&request.ticket).unwrap()
                    - coordinator.ticket_issued_at(&request.ticket).unwrap(),
                THUMBNAIL_CAPTURE_TIMEOUT
            );
        }

        #[tokio::test(start_paused = true)]
        async fn remaining_timeout_spends_the_original_budget_and_never_extends_it() {
            let coordinator = coordinator();
            let request = coordinator.prepare_thumbnail(manual(1, 2)).unwrap();

            tokio::time::advance(Duration::from_millis(375)).await;
            assert_eq!(request.timeout_ms(), 625);
            tokio::time::advance(Duration::from_millis(625)).await;
            assert_eq!(request.timeout_ms(), 0);
            tokio::time::advance(Duration::from_secs(10)).await;
            assert_eq!(request.timeout_ms(), 0);
        }

        #[tokio::test(start_paused = true)]
        async fn accepted_png_is_terminal_and_can_be_consumed_once() {
            let coordinator = coordinator();
            let purpose = manual(3, 5);
            let request = coordinator.prepare_thumbnail(purpose.clone()).unwrap();

            assert_eq!(
                coordinator.submit_thumbnail(&request.ticket, &png(320, 180)),
                Ok(ThumbnailActivityView::Idle)
            );
            let CaptureTerminalResult::Available(thumbnail) = coordinator
                .claim_thumbnail(&request.ticket, &purpose)
                .unwrap()
            else {
                panic!("accepted PNG must be retained");
            };
            assert_eq!(thumbnail.bytes.len(), 33);
            assert_eq!(thumbnail.width, 320);
            assert_eq!(thumbnail.height, 180);
            assert_eq!(thumbnail.byte_length, 33);
            assert_eq!(
                coordinator
                    .claim_thumbnail(&request.ticket, &purpose)
                    .unwrap_err()
                    .code,
                "staleThumbnailTicket"
            );
            assert_eq!(
                coordinator
                    .submit_thumbnail(&request.ticket, &png(320, 180))
                    .unwrap_err()
                    .code,
                "staleThumbnailTicket"
            );
        }

        #[tokio::test(start_paused = true)]
        async fn reported_failure_is_terminal_unavailable_and_single_consume() {
            let coordinator = coordinator();
            let purpose = manual(3, 8);
            let request = coordinator.prepare_thumbnail(purpose.clone()).unwrap();

            let activity = coordinator
                .report_thumbnail_failure(&request.ticket)
                .unwrap();
            let ThumbnailActivityView::Unavailable { diagnostic } = activity else {
                panic!("failure must publish a complete unavailable payload");
            };
            assert_eq!(
                diagnostic.reason,
                ThumbnailUnavailableReason::CaptureUnavailable
            );
            assert!(!diagnostic.retryable);
            assert!(matches!(
                coordinator
                    .claim_thumbnail(&request.ticket, &purpose)
                    .unwrap(),
                CaptureTerminalResult::Unavailable
            ));
            assert_eq!(
                coordinator
                    .claim_thumbnail(&request.ticket, &purpose)
                    .unwrap_err()
                    .code,
                "staleThumbnailTicket"
            );
        }

        #[tokio::test(start_paused = true)]
        async fn expiry_is_terminal_unavailable_at_exactly_one_second() {
            let coordinator = coordinator();
            let purpose = manual(1, 9);
            let request = coordinator.prepare_thumbnail(purpose.clone()).unwrap();

            tokio::time::advance(THUMBNAIL_CAPTURE_TIMEOUT).await;
            tokio::task::yield_now().await;

            assert!(matches!(
                coordinator.thumbnail_activity(),
                ThumbnailActivityView::Unavailable { .. }
            ));
            assert!(matches!(
                coordinator
                    .claim_thumbnail(&request.ticket, &purpose)
                    .unwrap(),
                CaptureTerminalResult::Unavailable
            ));
            assert_eq!(
                coordinator
                    .submit_thumbnail(&request.ticket, &png(1, 1))
                    .unwrap_err()
                    .code,
                "staleThumbnailTicket"
            );
        }

        #[tokio::test(start_paused = true)]
        async fn a_newer_intent_supersedes_the_older_ticket_terminally() {
            let coordinator = coordinator();
            let older_purpose = manual(4, 20);
            let older = coordinator
                .prepare_thumbnail(older_purpose.clone())
                .unwrap();
            let newer = coordinator.prepare_thumbnail(manual(4, 21)).unwrap();

            assert_ne!(older.ticket, newer.ticket);
            assert_eq!(
                coordinator
                    .claim_thumbnail(&older.ticket, &older_purpose)
                    .unwrap_err()
                    .code,
                "staleThumbnailTicket"
            );
            assert_eq!(
                coordinator
                    .submit_thumbnail(&older.ticket, &png(1, 1))
                    .unwrap_err()
                    .code,
                "staleThumbnailTicket"
            );
        }

        #[tokio::test(start_paused = true)]
        async fn claim_rejects_changed_generation_revision_purpose_and_event() {
            let coordinator = coordinator();
            let original = acknowledgement(8, 40, 41, "acq:40:0");
            let request = coordinator.prepare_thumbnail(original.clone()).unwrap();
            coordinator
                .submit_thumbnail(&request.ticket, &png(1, 1))
                .unwrap();

            for changed in [
                acknowledgement(9, 40, 41, "acq:40:0"),
                acknowledgement(8, 39, 41, "acq:40:0"),
                acknowledgement(8, 40, 42, "acq:40:0"),
                acknowledgement(8, 40, 41, "acq:40:1"),
                manual(8, 40),
            ] {
                assert_eq!(
                    coordinator
                        .claim_thumbnail(&request.ticket, &changed)
                        .unwrap_err()
                        .code,
                    "staleThumbnailTicket"
                );
            }
            assert!(matches!(
                coordinator
                    .claim_thumbnail(&request.ticket, &original)
                    .unwrap(),
                CaptureTerminalResult::Available(_)
            ));
        }

        #[tokio::test(start_paused = true)]
        async fn valid_png_is_bounded_and_digested_before_retention() {
            let coordinator = coordinator();
            let purpose = manual(1, 1);
            let request = coordinator.prepare_thumbnail(purpose.clone()).unwrap();
            let bytes = png(MAX_THUMBNAIL_WIDTH, 1);

            coordinator
                .submit_thumbnail(&request.ticket, &bytes)
                .unwrap();
            let CaptureTerminalResult::Available(thumbnail) = coordinator
                .claim_thumbnail(&request.ticket, &purpose)
                .unwrap()
            else {
                panic!("valid PNG must be retained");
            };
            assert_eq!(thumbnail.byte_length as usize, bytes.len());
            assert_eq!(
                thumbnail.sha256,
                "sha256:4493c13e589d22f0626679ba358933119c84ce86119395589007a90417d7d69e"
            );
        }

        #[tokio::test(start_paused = true)]
        async fn rejected_png_is_terminal_unavailable_and_never_retained() {
            for (bytes, code) in [
                (vec![0; 33], "thumbnailPngMalformed"),
                (vec![0; MAX_THUMBNAIL_BYTES + 1], "thumbnailPngTooLarge"),
                (
                    png(MAX_THUMBNAIL_WIDTH + 1, 1),
                    "thumbnailDimensionsOutOfBounds",
                ),
            ] {
                let coordinator = coordinator();
                let purpose = manual(2, 3);
                let request = coordinator.prepare_thumbnail(purpose.clone()).unwrap();

                assert_eq!(
                    coordinator
                        .submit_thumbnail(&request.ticket, &bytes)
                        .unwrap_err()
                        .code,
                    code
                );
                assert!(matches!(
                    coordinator
                        .claim_thumbnail(&request.ticket, &purpose)
                        .unwrap(),
                    CaptureTerminalResult::Unavailable
                ));
            }
        }

        #[tokio::test(start_paused = true)]
        async fn only_the_latest_terminal_result_for_an_intent_is_retained() {
            let coordinator = coordinator();
            let purpose = manual(6, 12);
            let first = coordinator.prepare_thumbnail(purpose.clone()).unwrap();
            coordinator
                .submit_thumbnail(&first.ticket, &png(1, 1))
                .unwrap();
            let second = coordinator.prepare_thumbnail(purpose.clone()).unwrap();
            coordinator
                .report_thumbnail_failure(&second.ticket)
                .unwrap();

            assert_eq!(
                coordinator
                    .claim_thumbnail(&first.ticket, &purpose)
                    .unwrap_err()
                    .code,
                "staleThumbnailTicket"
            );
            assert!(matches!(
                coordinator
                    .claim_thumbnail(&second.ticket, &purpose)
                    .unwrap(),
                CaptureTerminalResult::Unavailable
            ));
        }

        #[tokio::test(start_paused = true)]
        async fn subscribers_receive_complete_health_and_activity_payloads() {
            let coordinator = coordinator();
            let health = Arc::new(Mutex::new(Vec::new()));
            let activity = Arc::new(Mutex::new(Vec::new()));
            let health_sink = Arc::clone(&health);
            let activity_sink = Arc::clone(&activity);
            coordinator.subscribe(
                move |value| health_sink.lock().unwrap().push(value),
                move |value| activity_sink.lock().unwrap().push(value),
            );

            let purpose = manual(1, 2);
            let request = coordinator.prepare_thumbnail(purpose).unwrap();
            coordinator
                .report_thumbnail_failure(&request.ticket)
                .unwrap();

            assert_eq!(
                health.lock().unwrap().as_slice(),
                &[PersistenceHealthView::Healthy]
            );
            assert!(matches!(
                activity.lock().unwrap().as_slice(),
                [
                    ThumbnailActivityView::Idle,
                    ThumbnailActivityView::Capturing,
                    ThumbnailActivityView::Unavailable { .. }
                ]
            ));
        }
    }
}
