use super::schema::{
    SaveDiagnosticView, SaveEnvelopeV1, SaveSlotRef, SaveSlotView, SaveType, ThumbnailDescriptorV1,
    ThumbnailDiagnosticView, ThumbnailUnavailableReason,
};
use super::storage::{
    commit_prepared_slot_write, discard_prepared_slot_write, prepare_slot_write,
    select_autosave_target, PreparedSlotWrite, SaveFilesystem, SlotWriteRequest, ThumbnailWrite,
};
use super::thumbnail::ValidatedThumbnailCandidate;
use crate::game::GameError;
use serde::{Deserialize, Serialize, Serializer};
use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::path::Path;
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

    pub(crate) fn register(
        self,
        target: SaveSlotRef,
        save_id: String,
        mut envelope: SaveEnvelopeV1,
    ) -> Result<AutosaveRegisteredIntent, GameError> {
        let envelope_matches_target = match target {
            SaveSlotRef::Auto { slot } => {
                envelope.save_type == SaveType::Auto && envelope.slot == slot
            }
            SaveSlotRef::Manual { slot } => {
                envelope.save_type == SaveType::Manual && envelope.slot == slot
            }
        };
        if envelope.save_id != save_id
            || envelope.snapshot.durable_revision != self.job.durable_revision
            || !envelope_matches_target
        {
            return Err(GameError::save_write_failed());
        }
        envelope.thumbnail = ThumbnailDescriptorV1::Unavailable;
        let thumbnail_available = self.job.thumbnail_available();
        let thumbnail = match self.job.thumbnail {
            CaptureTerminalResult::Available(candidate) => {
                ThumbnailWrite::Available(candidate.bind(&save_id)?)
            }
            CaptureTerminalResult::Unavailable => ThumbnailWrite::Unavailable,
        };
        Ok(AutosaveRegisteredIntent {
            identity: AutosaveWriteReceipt {
                session_generation: self.job.session_generation,
                durable_revision: self.job.durable_revision,
                slot: target,
                save_id,
            },
            request: SlotWriteRequest {
                reference: target,
                envelope,
                thumbnail,
                expected_manual: None,
            },
            thumbnail_available,
        })
    }
}

pub(crate) struct AutosaveRegisteredIntent {
    identity: AutosaveWriteReceipt,
    request: SlotWriteRequest,
    thumbnail_available: bool,
}

impl AutosaveRegisteredIntent {
    pub(crate) fn prepare(
        self,
        fs: &dyn SaveFilesystem,
        root: &Path,
    ) -> Result<AutosavePreparedWrite, GameError> {
        let prepared = prepare_slot_write(fs, root, self.request)?;
        Ok(AutosavePreparedWrite {
            identity: self.identity,
            thumbnail_available: self.thumbnail_available,
            storage: AutosavePreparedStorage::Real(Box::new(prepared)),
        })
    }

    #[cfg(test)]
    fn prepare_simulated(self) -> AutosavePreparedWrite {
        AutosavePreparedWrite {
            identity: self.identity,
            thumbnail_available: self.thumbnail_available,
            storage: AutosavePreparedStorage::Simulated,
        }
    }
}

enum AutosavePreparedStorage {
    Real(Box<PreparedSlotWrite>),
    Simulated,
}

pub(crate) struct AutosavePreparedWrite {
    identity: AutosaveWriteReceipt,
    thumbnail_available: bool,
    storage: AutosavePreparedStorage,
}

impl AutosavePreparedWrite {
    pub(crate) fn session_generation(&self) -> u64 {
        self.identity.session_generation
    }

    pub(crate) fn durable_revision(&self) -> u64 {
        self.identity.durable_revision
    }

    pub(crate) fn thumbnail_available(&self) -> bool {
        self.thumbnail_available
    }

    pub(crate) fn commit(
        self,
        fs: &dyn SaveFilesystem,
        root: &Path,
    ) -> Result<AutosaveCommittedWrite, GameError> {
        let prepared = match self.storage {
            AutosavePreparedStorage::Real(prepared) => prepared,
            AutosavePreparedStorage::Simulated => return Err(GameError::save_write_failed()),
        };
        let outcome = commit_prepared_slot_write(fs, root, *prepared)?;
        AutosaveCommittedWrite::from_envelope(
            self.identity,
            &outcome.committed_envelope,
            outcome.cleanup_diagnostic,
        )
    }

    pub(crate) fn discard(self) -> Result<(), GameError> {
        match self.storage {
            AutosavePreparedStorage::Real(prepared) => discard_prepared_slot_write(*prepared),
            AutosavePreparedStorage::Simulated => Ok(()),
        }
    }

    #[cfg(test)]
    fn commit_simulated(self) -> AutosaveCommittedWrite {
        AutosaveCommittedWrite {
            receipt: self.identity,
            cleanup_diagnostic: None,
        }
    }
}

pub(crate) struct AutosaveCommittedWrite {
    receipt: AutosaveWriteReceipt,
    cleanup_diagnostic: Option<GameError>,
}

impl AutosaveCommittedWrite {
    fn from_envelope(
        expected: AutosaveWriteReceipt,
        envelope: &SaveEnvelopeV1,
        cleanup_diagnostic: Option<GameError>,
    ) -> Result<Self, GameError> {
        let envelope_matches_target = match expected.slot {
            SaveSlotRef::Auto { slot } => {
                envelope.save_type == SaveType::Auto && envelope.slot == slot
            }
            SaveSlotRef::Manual { slot } => {
                envelope.save_type == SaveType::Manual && envelope.slot == slot
            }
        };
        if envelope.save_id != expected.save_id
            || envelope.snapshot.durable_revision != expected.durable_revision
            || !envelope_matches_target
        {
            return Err(GameError::save_write_failed());
        }
        Ok(Self {
            receipt: expected,
            cleanup_diagnostic,
        })
    }

    fn into_parts(self) -> (AutosaveWriteReceipt, Option<GameError>) {
        (self.receipt, self.cleanup_diagnostic)
    }
}

pub(crate) enum AutosaveCommitOutcome {
    Committed(AutosaveCommittedWrite),
    Stale(AutosavePreparedWrite),
}

pub(crate) trait AutosaveBackend: Send + Sync {
    fn capture(
        &self,
        job: AutosaveWriteJob,
    ) -> CoordinatorFuture<'_, Result<AutosaveCapture, GameError>>;

    fn register(
        &self,
        capture: AutosaveCapture,
        target: SaveSlotRef,
        save_id: String,
    ) -> CoordinatorFuture<'_, Result<AutosaveRegisteredIntent, GameError>>;

    fn prepare(
        &self,
        registered: AutosaveRegisteredIntent,
    ) -> CoordinatorFuture<'_, Result<AutosavePreparedWrite, GameError>>;

    fn commit_if_current(
        &self,
        prepared: AutosavePreparedWrite,
    ) -> CoordinatorFuture<'_, Result<AutosaveCommitOutcome, GameError>>;

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

#[derive(Clone)]
struct BackgroundWriteFailure {
    identity: (u64, u64),
    diagnostic: GameError,
}

#[derive(Clone, PartialEq, Eq)]
enum CleanupOwner {
    Receipt(AutosaveWriteReceipt),
    Attempt(u64),
}

#[derive(Clone)]
struct CleanupFailure {
    owner: CleanupOwner,
    diagnostic: GameError,
}

struct CoordinatorState {
    tickets: HashMap<String, TicketRecord>,
    latest_by_intent: HashMap<CaptureIntent, String>,
    persistence_health: PersistenceHealthView,
    thumbnail_activity: ThumbnailActivityView,
    health_subscribers: Vec<HealthSubscriber>,
    activity_subscribers: Vec<ActivitySubscriber>,
    next_autosave_serial: u64,
    next_cleanup_attempt: u64,
    pending_autosave: Option<PendingAutosave>,
    last_successful_write: Option<AutosaveWriteReceipt>,
    autosave_target: Option<(u64, SaveSlotRef)>,
    failed_write: Option<BackgroundWriteFailure>,
    cleanup_failure: Option<CleanupFailure>,
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
            next_cleanup_attempt: 0,
            pending_autosave: None,
            last_successful_write: None,
            autosave_target: None,
            failed_write: None,
            cleanup_failure: None,
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
                    self.record_schedule_failure(
                        session_generation,
                        durable_revision,
                        Some(&request.ticket),
                        error,
                    );
                    None
                } else {
                    Some(request)
                }
            }
            Err(error) => {
                self.record_schedule_failure(session_generation, durable_revision, None, error);
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
            .and_then(|state| state.failed_write.as_ref().map(|failure| failure.identity))?;
        let purpose = ThumbnailCapturePurpose::Autosave {
            session_generation,
            durable_revision,
        };
        let request = match self.issue_thumbnail(purpose.clone()) {
            Ok(request) => request,
            Err(error) => {
                self.record_schedule_failure(session_generation, durable_revision, None, error);
                return None;
            }
        };
        if let Err(error) =
            self.schedule_autosave(purpose, request.ticket.clone(), request.deadline_at, true)
        {
            self.record_schedule_failure(
                session_generation,
                durable_revision,
                Some(&request.ticket),
                error,
            );
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

    pub(crate) fn autosave_target(&self, session_generation: u64) -> Option<SaveSlotRef> {
        self.state
            .lock()
            .ok()
            .and_then(|state| match state.autosave_target {
                Some((target_generation, target)) if target_generation == session_generation => {
                    Some(target)
                }
                Some(_) | None => None,
            })
    }

    pub(crate) fn reserve_acknowledgement_writer(
        &self,
        run: CoordinatorFuture<'static, ()>,
    ) -> Result<(), GameError> {
        self.writer_queue
            .enqueue(WriterJobClass::AcquisitionAcknowledgement, run)
    }

    pub(crate) fn enqueue_orphan_cleanup(&self) -> Result<(), GameError> {
        let owner = {
            let mut state = self.lock_state()?;
            if let Some(owner) = state
                .cleanup_failure
                .as_ref()
                .map(|failure| failure.owner.clone())
            {
                owner
            } else {
                state.next_cleanup_attempt = state.next_cleanup_attempt.wrapping_add(1);
                CleanupOwner::Attempt(state.next_cleanup_attempt)
            }
        };
        self.enqueue_cleanup_retry(owner)
    }

    fn enqueue_cleanup_retry(&self, owner: CleanupOwner) -> Result<(), GameError> {
        let backend = self
            .backend
            .as_ref()
            .cloned()
            .ok_or_else(GameError::save_write_failed)?;
        let coordinator = self.clone();
        self.writer_queue.enqueue(
            WriterJobClass::OrphanCleanup,
            Box::pin(async move {
                match backend.cleanup_orphans().await {
                    Ok(()) => coordinator.resolve_cleanup_failure(&owner),
                    Err(error) => coordinator.record_cleanup_failure(owner, error),
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
                && state.failed_write.as_ref().is_some_and(|failure| {
                    let (failed_generation, failed_revision) = failure.identity;
                    failed_generation == session_generation && durable_revision <= failed_revision
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
        let expected_receipt = AutosaveWriteReceipt {
            session_generation: pending.session_generation,
            durable_revision: pending.durable_revision,
            slot: target,
            save_id: save_id.clone(),
        };
        let registered = match backend.register(capture, target, save_id).await {
            Ok(registered) => registered,
            Err(error) => {
                self.record_background_failure(
                    pending.session_generation,
                    pending.durable_revision,
                    error,
                );
                return;
            }
        };
        let prepared = match backend.prepare(registered).await {
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
            Ok(AutosaveCommitOutcome::Committed(committed)) => {
                let (receipt, cleanup_diagnostic) = committed.into_parts();
                if receipt == expected_receipt {
                    self.record_background_success(&pending, receipt, cleanup_diagnostic);
                } else {
                    self.record_background_failure(
                        pending.session_generation,
                        pending.durable_revision,
                        GameError::save_write_failed(),
                    );
                }
            }
            Ok(AutosaveCommitOutcome::Stale(prepared)) => match prepared.discard() {
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
        cleanup_diagnostic: Option<GameError>,
    ) {
        let (health, subscribers, cleanup_retry) = if let Ok(mut state) = self.state.lock() {
            let completed_is_current = state
                .pending_autosave
                .as_ref()
                .is_some_and(|pending| pending.serial == completed.serial);
            let receipt_identity = (receipt.session_generation, receipt.durable_revision);
            if state
                .last_successful_write
                .as_ref()
                .is_none_or(|successful| {
                    receipt_identity >= (successful.session_generation, successful.durable_revision)
                })
            {
                state.autosave_target = Some((receipt.session_generation, receipt.slot));
                state.last_successful_write = Some(receipt.clone());
            }
            if completed_is_current {
                state.pending_autosave = None;
            }
            if completed_is_current
                && state
                    .failed_write
                    .as_ref()
                    .is_some_and(|failed| failed.identity <= receipt_identity)
            {
                state.failed_write = None;
            }
            let cleanup_retry = cleanup_diagnostic.and_then(|diagnostic| {
                let candidate = CleanupFailure {
                    owner: CleanupOwner::Receipt(receipt),
                    diagnostic,
                };
                if state.cleanup_failure.as_ref().is_none_or(|existing| {
                    cleanup_owner_replaces(&candidate.owner, &existing.owner)
                }) {
                    state.cleanup_failure = Some(candidate.clone());
                    Some(candidate.owner)
                } else {
                    None
                }
            });
            let health = health_after_completion(&state);
            let subscribers = set_persistence_health(&mut state, health.clone());
            (health, subscribers, cleanup_retry)
        } else {
            let health = PersistenceHealthView::Degraded {
                diagnostic: GameError::save_write_failed(),
            };
            (health, Vec::new(), None)
        };
        publish_health(&subscribers, &health);
        if let Some(owner) = cleanup_retry {
            let _ = self.enqueue_cleanup_retry(owner);
        }
    }

    fn record_stale_write(&self, completed: &PendingAutosave) {
        let (health, subscribers) = if let Ok(mut state) = self.state.lock() {
            if state
                .pending_autosave
                .as_ref()
                .is_some_and(|pending| pending.serial == completed.serial)
            {
                state.pending_autosave = None;
            }
            let health = health_after_completion(&state);
            let subscribers = set_persistence_health(&mut state, health.clone());
            (health, subscribers)
        } else {
            let health = PersistenceHealthView::Degraded {
                diagnostic: GameError::save_write_failed(),
            };
            (health, Vec::new())
        };
        publish_health(&subscribers, &health);
    }

    fn resolve_cleanup_failure(&self, owner: &CleanupOwner) {
        let publication = if let Ok(mut state) = self.state.lock() {
            if state
                .cleanup_failure
                .as_ref()
                .is_some_and(|failure| &failure.owner == owner)
            {
                state.cleanup_failure = None;
                let health = health_after_completion(&state);
                let subscribers = set_persistence_health(&mut state, health.clone());
                Some((health, subscribers))
            } else {
                None
            }
        } else {
            None
        };
        if let Some((health, subscribers)) = publication {
            publish_health(&subscribers, &health);
        }
    }

    fn record_cleanup_failure(&self, owner: CleanupOwner, error: GameError) {
        let publication = if let Ok(mut state) = self.state.lock() {
            let replace = state
                .cleanup_failure
                .as_ref()
                .is_none_or(|existing| cleanup_owner_replaces(&owner, &existing.owner));
            if replace {
                state.cleanup_failure = Some(CleanupFailure {
                    owner,
                    diagnostic: error.clone(),
                });
                let health = health_after_completion(&state);
                let subscribers = set_persistence_health(&mut state, health.clone());
                Some((health, subscribers))
            } else {
                None
            }
        } else {
            None
        };
        if let Some((health, subscribers)) = publication {
            publish_health(&subscribers, &health);
        }
    }

    fn record_background_failure(
        &self,
        session_generation: u64,
        durable_revision: u64,
        error: GameError,
    ) {
        let publication = if let Ok(mut state) = self.state.lock() {
            let failed = (session_generation, durable_revision);
            if state.pending_autosave.as_ref().is_some_and(|pending| {
                pending.session_generation == session_generation
                    && pending.durable_revision == durable_revision
            }) {
                state.pending_autosave = None;
            }
            if state
                .failed_write
                .as_ref()
                .is_none_or(|existing| failed >= existing.identity)
            {
                state.failed_write = Some(BackgroundWriteFailure {
                    identity: failed,
                    diagnostic: error.clone(),
                });
                let view = PersistenceHealthView::Degraded { diagnostic: error };
                let subscribers = set_persistence_health(&mut state, view.clone());
                Some((view, subscribers))
            } else {
                None
            }
        } else {
            None
        };
        if let Some((view, subscribers)) = publication {
            publish_health(&subscribers, &view);
        }
    }

    fn record_schedule_failure(
        &self,
        session_generation: u64,
        durable_revision: u64,
        ticket: Option<&str>,
        error: GameError,
    ) {
        let failed = (session_generation, durable_revision);
        let activity = capture_unavailable_activity();
        let (health_publication, activity_subscribers) = if let Ok(mut state) = self.state.lock() {
            let health_publication = if state
                .failed_write
                .as_ref()
                .is_none_or(|existing| failed >= existing.identity)
            {
                state.failed_write = Some(BackgroundWriteFailure {
                    identity: failed,
                    diagnostic: error.clone(),
                });
                let health = PersistenceHealthView::Degraded { diagnostic: error };
                let subscribers = set_persistence_health(&mut state, health.clone());
                Some((health, subscribers))
            } else {
                None
            };
            if state.pending_autosave.as_ref().is_some_and(|pending| {
                (pending.session_generation, pending.durable_revision) <= failed
            }) {
                state.pending_autosave = None;
            }
            if let Some(ticket) = ticket {
                if let Some(record) = state.tickets.remove(ticket) {
                    let intent = record.purpose.intent();
                    if state.latest_by_intent.get(&intent).map(String::as_str) == Some(ticket) {
                        state.latest_by_intent.remove(&intent);
                    }
                }
            }
            let activity_subscribers = set_thumbnail_activity(&mut state, activity.clone());
            (health_publication, activity_subscribers)
        } else {
            (None, Vec::new())
        };
        if let Some((health, subscribers)) = health_publication {
            publish_health(&subscribers, &health);
        }
        publish_activity(&activity_subscribers, &activity);
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

fn cleanup_owner_replaces(candidate: &CleanupOwner, existing: &CleanupOwner) -> bool {
    match (candidate, existing) {
        (CleanupOwner::Receipt(candidate), CleanupOwner::Receipt(existing)) => {
            (
                candidate.session_generation,
                candidate.durable_revision,
                &candidate.save_id,
            ) > (
                existing.session_generation,
                existing.durable_revision,
                &existing.save_id,
            )
        }
        (CleanupOwner::Receipt(_), CleanupOwner::Attempt(_)) => true,
        (CleanupOwner::Attempt(_), CleanupOwner::Receipt(_)) => false,
        (CleanupOwner::Attempt(candidate), CleanupOwner::Attempt(existing)) => candidate > existing,
    }
}

fn health_after_completion(state: &CoordinatorState) -> PersistenceHealthView {
    if state.pending_autosave.is_some() {
        PersistenceHealthView::Pending
    } else if let Some(failure) = &state.failed_write {
        PersistenceHealthView::Degraded {
            diagnostic: failure.diagnostic.clone(),
        }
    } else if let Some(failure) = &state.cleanup_failure {
        PersistenceHealthView::Degraded {
            diagnostic: failure.diagnostic.clone(),
        }
    } else {
        PersistenceHealthView::Healthy
    }
}

fn set_persistence_health(
    state: &mut CoordinatorState,
    view: PersistenceHealthView,
) -> Vec<HealthSubscriber> {
    state.persistence_health = view;
    state.health_subscribers.clone()
}

fn publish_health(subscribers: &[HealthSubscriber], view: &PersistenceHealthView) {
    for subscriber in subscribers {
        subscriber(view.clone());
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
            AutosaveRegisteredIntent, AutosaveWriteJob, AutosaveWriteReceipt,
            BackgroundRetryTrigger, CaptureIntent, CoordinatorFuture, PersistenceHealthView,
            SaveCoordinator, ThumbnailActivityView, ThumbnailCapturePurpose, AUTOSAVE_DEBOUNCE,
            THUMBNAIL_CAPTURE_TIMEOUT,
        };
        use crate::game::save::schema::{
            SaveEnvelopeV1, SaveSlotRef, SaveSlotStatusView, SaveSlotView, SaveType,
        };
        use crate::game::test_support::representative_save_envelope;
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

        struct PhasedBackend {
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
            receipts: Mutex<Vec<AutosaveWriteReceipt>>,
            committed: Notify,
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
            fn new(generation: u64) -> Self {
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
                    receipts: Mutex::new(Vec::new()),
                    committed: Notify::new(),
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

            async fn wait_for_failed_commits(&self, count: u64) {
                loop {
                    if self.failed_commits.load(Ordering::SeqCst) >= count {
                        return;
                    }
                    self.commit_failed.notified().await;
                }
            }

            async fn wait_for_cleanup_attempts(&self, count: u64) {
                loop {
                    if self.cleanup_attempts.load(Ordering::SeqCst) >= count {
                        return;
                    }
                    self.cleanup_done.notified().await;
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

            fn register(
                &self,
                capture: AutosaveCapture,
                target: SaveSlotRef,
                save_id: String,
            ) -> CoordinatorFuture<'_, Result<AutosaveRegisteredIntent, GameError>> {
                Box::pin(async move {
                    let _session = self.gameplay_lock.lock().unwrap();
                    self.phases.lock().unwrap().push("S:register");
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

        fn autosave_envelope(
            save_id: &str,
            target: SaveSlotRef,
            durable_revision: u64,
        ) -> SaveEnvelopeV1 {
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
    }

    mod storage_integration {
        use super::super::{
            AutosaveBackend, AutosaveCapture, AutosaveCommitOutcome, AutosavePreparedWrite,
            AutosaveRegisteredIntent, AutosaveWriteJob, CaptureTerminalResult, CoordinatorFuture,
            PersistenceHealthView, SaveCoordinator, SaveSlotRef, AUTOSAVE_DEBOUNCE,
        };
        use crate::game::save::schema::{
            parse_current_envelope, SaveEnvelopeV1, SaveSlotStatusView, SaveSlotView, SaveType,
        };
        use crate::game::save::storage::{
            clean_orphaned_save_files, ProductionSaveFilesystem, SaveFileMetadata, SaveFilesystem,
            StagedAtomicWrite,
        };
        use crate::game::save::thumbnail::ValidatedThumbnail;
        use crate::game::test_support::representative_save_envelope;
        use crate::game::GameError;
        use std::io;
        use std::path::{Path, PathBuf};
        use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
        use std::sync::{Arc, Mutex};
        use tokio::sync::{Mutex as AsyncMutex, Notify};

        #[derive(Default)]
        struct TrackingFilesystem {
            inner: ProductionSaveFilesystem,
            staged: Arc<AtomicUsize>,
            installed: Arc<AtomicUsize>,
            discarded: Arc<AtomicUsize>,
            discard_update: Arc<Notify>,
            fail_remove_once: AtomicBool,
        }

        impl TrackingFilesystem {
            async fn wait_for_discards(&self, expected: usize) {
                for _ in 0..100 {
                    if self.discarded.load(Ordering::SeqCst) >= expected {
                        return;
                    }
                    tokio::task::yield_now().await;
                }
                panic!(
                    "timed out waiting for {expected} discards; observed {}",
                    self.discarded.load(Ordering::SeqCst)
                );
            }
        }

        struct TrackingStagedWrite {
            inner: Box<dyn StagedAtomicWrite>,
            installed: Arc<AtomicUsize>,
            discarded: Arc<AtomicUsize>,
            discard_update: Arc<Notify>,
        }

        impl StagedAtomicWrite for TrackingStagedWrite {
            fn install(self: Box<Self>) -> io::Result<()> {
                self.inner.install()?;
                self.installed.fetch_add(1, Ordering::SeqCst);
                Ok(())
            }

            fn discard(self: Box<Self>) -> io::Result<()> {
                self.inner.discard()?;
                self.discarded.fetch_add(1, Ordering::SeqCst);
                self.discard_update.notify_waiters();
                Ok(())
            }
        }

        impl SaveFilesystem for TrackingFilesystem {
            fn create_dir_all(&self, path: &Path) -> io::Result<()> {
                self.inner.create_dir_all(path)
            }

            fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
                self.inner.read(path)
            }

            fn read_prefix(&self, path: &Path, limit: usize) -> io::Result<Vec<u8>> {
                self.inner.read_prefix(path, limit)
            }

            fn metadata(&self, path: &Path) -> io::Result<SaveFileMetadata> {
                self.inner.metadata(path)
            }

            fn list_dir(&self, path: &Path) -> io::Result<Vec<PathBuf>> {
                self.inner.list_dir(path)
            }

            fn stage_atomic(
                &self,
                path: &Path,
                bytes: &[u8],
            ) -> io::Result<Box<dyn StagedAtomicWrite>> {
                let inner = self.inner.stage_atomic(path, bytes)?;
                self.staged.fetch_add(1, Ordering::SeqCst);
                Ok(Box::new(TrackingStagedWrite {
                    inner,
                    installed: Arc::clone(&self.installed),
                    discarded: Arc::clone(&self.discarded),
                    discard_update: Arc::clone(&self.discard_update),
                }))
            }

            fn remove_file(&self, path: &Path) -> io::Result<()> {
                if self.fail_remove_once.swap(false, Ordering::SeqCst) {
                    return Err(io::Error::other("injected cleanup removal failure"));
                }
                self.inner.remove_file(path)
            }

            fn sync_dir(&self, path: &Path) -> io::Result<()> {
                self.inner.sync_dir(path)
            }
        }

        #[derive(Debug, Clone, Copy)]
        enum RegistrationCorruption {
            SaveId,
            Slot,
        }

        #[derive(Debug, Clone, Copy)]
        enum CommitReceiptCorruption {
            SaveId,
            Slot,
        }

        struct StorageBackend {
            _temp: tempfile::TempDir,
            root: PathBuf,
            fs: Arc<TrackingFilesystem>,
            writer: AsyncMutex<()>,
            gate: AsyncMutex<()>,
            session: AsyncMutex<()>,
            current_generation: AtomicU64,
            current_revision: AtomicU64,
            phases: Mutex<Vec<&'static str>>,
            pause_after_prepare: AtomicBool,
            prepare_reached: AtomicBool,
            prepare_error: Mutex<Option<GameError>>,
            prepare_update: Notify,
            prepare_release: Notify,
            completions: AtomicUsize,
            completion_update: Notify,
            registrations: AtomicUsize,
            registration_update: Notify,
            corruption: Mutex<Option<RegistrationCorruption>>,
            commit_receipt_corruption: Mutex<Option<CommitReceiptCorruption>>,
            pause_cleanup: AtomicBool,
            cleanup_started: AtomicBool,
            cleanup_update: Notify,
            cleanup_release: Notify,
            cleanup_completions: AtomicUsize,
            register_held_session: AtomicBool,
            prepare_held_writer: AtomicBool,
            revalidate_held_gate_and_session: AtomicBool,
            commit_held_writer_and_gate: AtomicBool,
        }

        impl StorageBackend {
            fn new(session_generation: u64, durable_revision: u64) -> Self {
                let temp = tempfile::tempdir().unwrap();
                let root = temp.path().join("saves");
                let fs = Arc::new(TrackingFilesystem::default());
                fs.create_dir_all(&root).unwrap();
                Self {
                    _temp: temp,
                    root,
                    fs,
                    writer: AsyncMutex::new(()),
                    gate: AsyncMutex::new(()),
                    session: AsyncMutex::new(()),
                    current_generation: AtomicU64::new(session_generation),
                    current_revision: AtomicU64::new(durable_revision),
                    phases: Mutex::new(Vec::new()),
                    pause_after_prepare: AtomicBool::new(false),
                    prepare_reached: AtomicBool::new(false),
                    prepare_error: Mutex::new(None),
                    prepare_update: Notify::new(),
                    prepare_release: Notify::new(),
                    completions: AtomicUsize::new(0),
                    completion_update: Notify::new(),
                    registrations: AtomicUsize::new(0),
                    registration_update: Notify::new(),
                    corruption: Mutex::new(None),
                    commit_receipt_corruption: Mutex::new(None),
                    pause_cleanup: AtomicBool::new(false),
                    cleanup_started: AtomicBool::new(false),
                    cleanup_update: Notify::new(),
                    cleanup_release: Notify::new(),
                    cleanup_completions: AtomicUsize::new(0),
                    register_held_session: AtomicBool::new(false),
                    prepare_held_writer: AtomicBool::new(false),
                    revalidate_held_gate_and_session: AtomicBool::new(false),
                    commit_held_writer_and_gate: AtomicBool::new(false),
                }
            }

            fn pause_after_prepare(&self) {
                self.pause_after_prepare.store(true, Ordering::SeqCst);
            }

            async fn wait_for_prepare(&self) {
                for _ in 0..100 {
                    if self.prepare_reached.load(Ordering::SeqCst) {
                        if let Some(error) = self.prepare_error.lock().unwrap().clone() {
                            panic!("prepare failed: {error:?}");
                        }
                        return;
                    }
                    tokio::task::yield_now().await;
                }
                panic!("timed out waiting for prepare; phases={:?}", self.phases());
            }

            fn release_prepare(&self) {
                self.pause_after_prepare.store(false, Ordering::SeqCst);
                self.prepare_release.notify_waiters();
            }

            async fn wait_for_completions(&self, expected: usize) {
                for _ in 0..100 {
                    if self.completions.load(Ordering::SeqCst) >= expected {
                        return;
                    }
                    tokio::task::yield_now().await;
                }
                panic!(
                    "timed out waiting for {expected} completions; phases={:?}",
                    self.phases()
                );
            }

            async fn wait_for_registration(&self) {
                for _ in 0..100 {
                    if self.registrations.load(Ordering::SeqCst) > 0 {
                        return;
                    }
                    tokio::task::yield_now().await;
                }
                panic!(
                    "timed out waiting for registration; phases={:?}",
                    self.phases()
                );
            }

            fn finish(&self) {
                self.completions.fetch_add(1, Ordering::SeqCst);
                self.completion_update.notify_waiters();
            }

            fn phases(&self) -> Vec<&'static str> {
                self.phases.lock().unwrap().clone()
            }

            fn slot_path(&self, slot: u8) -> PathBuf {
                self.root.join(format!("autosave-{slot}.json"))
            }

            fn corrupt_registration(&self, corruption: RegistrationCorruption) {
                *self.corruption.lock().unwrap() = Some(corruption);
            }

            fn corrupt_commit_receipt(&self, corruption: CommitReceiptCorruption) {
                *self.commit_receipt_corruption.lock().unwrap() = Some(corruption);
            }

            fn pause_cleanup(&self) {
                self.pause_cleanup.store(true, Ordering::SeqCst);
            }

            async fn wait_for_cleanup_start(&self) {
                for _ in 0..100 {
                    if self.cleanup_started.load(Ordering::SeqCst) {
                        return;
                    }
                    tokio::task::yield_now().await;
                }
                panic!(
                    "timed out waiting for cleanup start; phases={:?}",
                    self.phases()
                );
            }

            fn release_cleanup(&self) {
                self.pause_cleanup.store(false, Ordering::SeqCst);
                self.cleanup_release.notify_waiters();
            }

            async fn wait_for_cleanup_completions(&self, expected: usize) {
                for _ in 0..100 {
                    if self.cleanup_completions.load(Ordering::SeqCst) >= expected {
                        return;
                    }
                    tokio::task::yield_now().await;
                }
                panic!(
                    "timed out waiting for {expected} cleanup completions; phases={:?}",
                    self.phases()
                );
            }

            fn install_old_autosave_with_sidecar(&self) -> PathBuf {
                const OLD_SAVE_ID: &str = "33333333-3333-4333-8333-333333333333";
                let thumbnail_bytes = png(1, 1);
                let mut envelope = autosave_envelope(
                    OLD_SAVE_ID,
                    SaveSlotRef::Auto { slot: 1 },
                    self.current_revision
                        .load(Ordering::SeqCst)
                        .saturating_sub(1),
                );
                envelope.thumbnail =
                    ValidatedThumbnail::from_png(thumbnail_bytes.clone(), OLD_SAVE_ID)
                        .unwrap()
                        .descriptor;
                let thumbnails = self.root.join("thumbnails");
                self.fs.create_dir_all(&thumbnails).unwrap();
                std::fs::write(self.slot_path(1), serde_json::to_vec(&envelope).unwrap()).unwrap();
                let sidecar = thumbnails.join(format!("{OLD_SAVE_ID}.png"));
                std::fs::write(&sidecar, thumbnail_bytes).unwrap();
                sidecar
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

        fn autosave_envelope(
            save_id: &str,
            target: SaveSlotRef,
            durable_revision: u64,
        ) -> SaveEnvelopeV1 {
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

        fn png(width: u32, height: u32) -> Vec<u8> {
            let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
            bytes.extend_from_slice(&width.to_be_bytes());
            bytes.extend_from_slice(&height.to_be_bytes());
            bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
            bytes.extend_from_slice(&[0, 0, 0, 0]);
            bytes
        }

        impl AutosaveBackend for StorageBackend {
            fn capture(
                &self,
                job: AutosaveWriteJob,
            ) -> CoordinatorFuture<'_, Result<AutosaveCapture, GameError>> {
                Box::pin(async move {
                    let _session = self.session.lock().await;
                    self.phases.lock().unwrap().push("S:capture");
                    Ok(AutosaveCapture::new(job, empty_autosave_slots()))
                })
            }

            fn register(
                &self,
                capture: AutosaveCapture,
                target: SaveSlotRef,
                save_id: String,
            ) -> CoordinatorFuture<'_, Result<AutosaveRegisteredIntent, GameError>> {
                Box::pin(async move {
                    let _session = self.session.lock().await;
                    self.register_held_session
                        .store(self.session.try_lock().is_err(), Ordering::SeqCst);
                    self.phases.lock().unwrap().push("S:register");
                    let revision = capture.job.durable_revision;
                    let mut envelope = autosave_envelope(&save_id, target, revision);
                    match self.corruption.lock().unwrap().take() {
                        Some(RegistrationCorruption::SaveId) => {
                            envelope.save_id = "22222222-2222-4222-8222-222222222222".into();
                        }
                        Some(RegistrationCorruption::Slot) => {
                            envelope.slot = 2;
                        }
                        None => {}
                    }
                    let registered = capture.register(target, save_id, envelope);
                    self.registrations.fetch_add(1, Ordering::SeqCst);
                    self.registration_update.notify_waiters();
                    registered
                })
            }

            fn prepare(
                &self,
                registered: AutosaveRegisteredIntent,
            ) -> CoordinatorFuture<'_, Result<AutosavePreparedWrite, GameError>> {
                Box::pin(async move {
                    let _writer = self.writer.lock().await;
                    self.prepare_held_writer
                        .store(self.writer.try_lock().is_err(), Ordering::SeqCst);
                    self.phases.lock().unwrap().push("W:prepare");
                    let prepared = match registered.prepare(self.fs.as_ref(), &self.root) {
                        Ok(prepared) => prepared,
                        Err(error) => {
                            *self.prepare_error.lock().unwrap() = Some(error.clone());
                            self.prepare_reached.store(true, Ordering::SeqCst);
                            self.prepare_update.notify_waiters();
                            return Err(error);
                        }
                    };
                    self.prepare_reached.store(true, Ordering::SeqCst);
                    self.prepare_update.notify_waiters();
                    while self.pause_after_prepare.load(Ordering::SeqCst) {
                        self.prepare_release.notified().await;
                    }
                    Ok(prepared)
                })
            }

            fn commit_if_current(
                &self,
                prepared: AutosavePreparedWrite,
            ) -> CoordinatorFuture<'_, Result<AutosaveCommitOutcome, GameError>> {
                Box::pin(async move {
                    let _writer = self.writer.lock().await;
                    let _gate = self.gate.lock().await;
                    self.phases.lock().unwrap().push("G");
                    let _session = self.session.lock().await;
                    self.revalidate_held_gate_and_session.store(
                        self.gate.try_lock().is_err() && self.session.try_lock().is_err(),
                        Ordering::SeqCst,
                    );
                    self.phases.lock().unwrap().push("G:S:revalidate");
                    if prepared.session_generation()
                        != self.current_generation.load(Ordering::SeqCst)
                        || prepared.durable_revision()
                            != self.current_revision.load(Ordering::SeqCst)
                    {
                        drop(_session);
                        self.finish();
                        return Ok(AutosaveCommitOutcome::Stale(prepared));
                    }
                    drop(_session);
                    self.commit_held_writer_and_gate.store(
                        self.writer.try_lock().is_err() && self.gate.try_lock().is_err(),
                        Ordering::SeqCst,
                    );
                    self.phases.lock().unwrap().push("W+G:commit");
                    let mut committed = prepared.commit(self.fs.as_ref(), &self.root)?;
                    match self.commit_receipt_corruption.lock().unwrap().take() {
                        Some(CommitReceiptCorruption::SaveId) => {
                            committed.receipt.save_id =
                                "22222222-2222-4222-8222-222222222222".into();
                        }
                        Some(CommitReceiptCorruption::Slot) => {
                            committed.receipt.slot = SaveSlotRef::Auto { slot: 2 };
                        }
                        None => {}
                    }
                    self.finish();
                    Ok(AutosaveCommitOutcome::Committed(committed))
                })
            }

            fn cleanup_orphans(&self) -> CoordinatorFuture<'_, Result<(), GameError>> {
                Box::pin(async move {
                    let _writer = self.writer.lock().await;
                    self.phases.lock().unwrap().push("W:cleanup");
                    self.cleanup_started.store(true, Ordering::SeqCst);
                    self.cleanup_update.notify_waiters();
                    while self.pause_cleanup.load(Ordering::SeqCst) {
                        self.cleanup_release.notified().await;
                    }
                    let result = clean_orphaned_save_files(self.fs.as_ref(), &self.root);
                    self.cleanup_completions.fetch_add(1, Ordering::SeqCst);
                    self.cleanup_update.notify_waiters();
                    result
                })
            }
        }

        #[test]
        fn registered_intent_rejects_mismatched_save_id_before_storage_preparation() {
            let save_id = "11111111-1111-4111-8111-111111111111";
            let target = SaveSlotRef::Auto { slot: 1 };
            let capture = AutosaveCapture::new(
                AutosaveWriteJob {
                    session_generation: 3,
                    durable_revision: 7,
                    thumbnail: CaptureTerminalResult::Unavailable,
                },
                Vec::new(),
            );
            let mut envelope = representative_save_envelope();
            envelope.save_id = "22222222-2222-4222-8222-222222222222".into();
            envelope.save_type = SaveType::Auto;
            envelope.slot = 1;
            envelope.snapshot.durable_revision = 7;

            assert!(capture.register(target, save_id.into(), envelope).is_err());
        }

        #[tokio::test(start_paused = true)]
        async fn real_staged_write_uses_s_w_g_s_and_receipt_from_committed_envelope() {
            let backend = Arc::new(StorageBackend::new(4, 12));
            backend.pause_after_prepare();
            let coordinator = SaveCoordinator::with_backend(backend.clone());
            let request = coordinator.notify_durable_commit(4, 12).unwrap();
            coordinator
                .report_thumbnail_failure(&request.ticket)
                .unwrap();
            tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
            backend.wait_for_prepare().await;

            assert!(backend.writer.try_lock().is_err());
            assert!(backend.gate.try_lock().is_ok());
            assert!(backend.session.try_lock().is_ok());
            backend.release_prepare();
            backend.wait_for_completions(1).await;

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
            assert!(backend.register_held_session.load(Ordering::SeqCst));
            assert!(backend.prepare_held_writer.load(Ordering::SeqCst));
            assert!(backend
                .revalidate_held_gate_and_session
                .load(Ordering::SeqCst));
            assert!(backend.commit_held_writer_and_gate.load(Ordering::SeqCst));

            let envelope =
                parse_current_envelope(&backend.fs.read(&backend.slot_path(1)).unwrap()).unwrap();
            let receipt = coordinator.last_successful_write().unwrap();
            assert_eq!(receipt.session_generation, 4);
            assert_eq!(receipt.durable_revision, envelope.snapshot.durable_revision);
            assert_eq!(
                receipt.slot,
                SaveSlotRef::Auto {
                    slot: envelope.slot
                }
            );
            assert_eq!(receipt.save_id, envelope.save_id);
            assert_eq!(
                coordinator.autosave_target(4),
                Some(SaveSlotRef::Auto { slot: 1 })
            );
        }

        #[tokio::test(start_paused = true)]
        async fn committed_cleanup_diagnostic_adopts_receipt_and_retries_through_writer() {
            let backend = Arc::new(StorageBackend::new(7, 22));
            let old_sidecar = backend.install_old_autosave_with_sidecar();
            backend.fs.fail_remove_once.store(true, Ordering::SeqCst);
            backend.pause_cleanup();
            let coordinator = SaveCoordinator::with_backend(backend.clone());
            let request = coordinator.notify_durable_commit(7, 22).unwrap();
            coordinator
                .report_thumbnail_failure(&request.ticket)
                .unwrap();
            tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
            backend.wait_for_completions(1).await;
            backend.wait_for_cleanup_start().await;

            let envelope =
                parse_current_envelope(&backend.fs.read(&backend.slot_path(1)).unwrap()).unwrap();
            let receipt = coordinator.last_successful_write().unwrap();
            assert_eq!(receipt.durable_revision, 22);
            assert_eq!(receipt.save_id, envelope.save_id);
            assert_eq!(
                coordinator.autosave_target(7),
                Some(SaveSlotRef::Auto { slot: 1 })
            );
            assert_eq!(
                coordinator.persistence_health(),
                PersistenceHealthView::Degraded {
                    diagnostic: GameError::save_write_failed(),
                }
            );
            assert!(old_sidecar.exists());
            assert!(backend.writer.try_lock().is_err());
            assert!(backend.phases().ends_with(&["W+G:commit", "W:cleanup"]));

            backend.release_cleanup();
            backend.wait_for_cleanup_completions(1).await;
            tokio::task::yield_now().await;

            assert!(!old_sidecar.exists());
            assert_eq!(
                coordinator.persistence_health(),
                PersistenceHealthView::Healthy
            );
        }

        #[tokio::test(start_paused = true)]
        async fn stale_registered_token_discards_the_exact_real_staged_write() {
            let backend = Arc::new(StorageBackend::new(5, 20));
            backend.pause_after_prepare();
            let coordinator = SaveCoordinator::with_backend(backend.clone());
            let request = coordinator.notify_durable_commit(5, 20).unwrap();
            coordinator
                .report_thumbnail_failure(&request.ticket)
                .unwrap();
            tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
            backend.wait_for_prepare().await;

            backend.current_generation.store(6, Ordering::SeqCst);
            backend.current_revision.store(1, Ordering::SeqCst);
            backend.release_prepare();
            backend.wait_for_completions(1).await;
            backend.fs.wait_for_discards(1).await;

            assert!(!backend.slot_path(1).exists());
            assert_eq!(backend.fs.installed.load(Ordering::SeqCst), 0);
            assert!(backend.fs.discarded.load(Ordering::SeqCst) >= 1);
            assert!(coordinator.last_successful_write().is_none());
            assert!(coordinator.autosave_target(5).is_none());
            assert_eq!(
                backend.phases(),
                [
                    "S:capture",
                    "S:register",
                    "W:prepare",
                    "G",
                    "G:S:revalidate"
                ]
            );
        }

        #[tokio::test(start_paused = true)]
        async fn mismatched_registered_slot_or_save_id_cannot_be_adopted() {
            for corruption in [RegistrationCorruption::SaveId, RegistrationCorruption::Slot] {
                let backend = Arc::new(StorageBackend::new(9, 30));
                backend.corrupt_registration(corruption);
                let coordinator = SaveCoordinator::with_backend(backend.clone());
                let request = coordinator.notify_durable_commit(9, 30).unwrap();
                coordinator
                    .report_thumbnail_failure(&request.ticket)
                    .unwrap();
                tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
                backend.wait_for_registration().await;
                tokio::task::yield_now().await;

                assert!(
                    matches!(
                        coordinator.persistence_health(),
                        PersistenceHealthView::Degraded { .. }
                    ),
                    "{corruption:?}"
                );
                assert!(
                    coordinator.last_successful_write().is_none(),
                    "{corruption:?}"
                );
                assert!(coordinator.autosave_target(9).is_none(), "{corruption:?}");
                assert_eq!(backend.fs.staged.load(Ordering::SeqCst), 0);
            }
        }

        #[tokio::test(start_paused = true)]
        async fn mismatched_committed_slot_or_save_id_receipt_cannot_be_adopted() {
            for corruption in [
                CommitReceiptCorruption::SaveId,
                CommitReceiptCorruption::Slot,
            ] {
                let backend = Arc::new(StorageBackend::new(10, 31));
                backend.corrupt_commit_receipt(corruption);
                let coordinator = SaveCoordinator::with_backend(backend.clone());
                let request = coordinator.notify_durable_commit(10, 31).unwrap();
                coordinator
                    .report_thumbnail_failure(&request.ticket)
                    .unwrap();
                tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
                backend.wait_for_completions(1).await;
                tokio::task::yield_now().await;

                assert!(
                    matches!(
                        coordinator.persistence_health(),
                        PersistenceHealthView::Degraded { .. }
                    ),
                    "{corruption:?}"
                );
                assert!(
                    coordinator.last_successful_write().is_none(),
                    "{corruption:?}"
                );
                assert!(coordinator.autosave_target(10).is_none(), "{corruption:?}");
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
