use super::schema::{
    SaveDiagnosticView, SaveEnvelopeV1, SaveSlotRef, SaveSlotView, SaveType, ThumbnailDescriptorV1,
    ThumbnailDiagnosticView, ThumbnailUnavailableReason,
};
use super::storage::{
    commit_prepared_slot_write, discard_prepared_slot_write, prepare_slot_write,
    select_autosave_target, PreparedSlotWrite, SaveFilesystem, SlotWriteRequest, ThumbnailWrite,
};
use super::thumbnail::ValidatedThumbnailCandidate;
use crate::game::command_tx::EngineRollbackSnapshot;
use crate::game::{GameEngine, GameError};
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FlushOperation {
    ManualSave,
    InGameLoad,
    ReturnToTitle,
    AcquisitionAcknowledgement,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum FlushOutcome {
    Noop {
        session_generation: u64,
        durable_revision: u64,
    },
    Written {
        session_generation: u64,
        durable_revision: u64,
        slot: SaveSlotRef,
    },
}

pub(crate) struct AcknowledgementOutcome {
    pub(crate) state: crate::game::GameStateView,
    pub(crate) cleanup_diagnostic: Option<SaveDiagnosticView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub(crate) struct PersistenceFailureTokenView(String);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum PersistenceBypassOperation {
    StartWithoutSaving,
    LoadDiscardingCurrent,
    ReturnWithoutSaving,
    ContinueWithoutSaving,
    ExitWithoutSaving,
}

#[derive(Debug, Clone)]
pub(crate) struct PersistenceFailureChallenge {
    token: Uuid,
    operation: PersistenceBypassOperation,
    session_generation: u64,
    discovery_generation: Option<u64>,
    durable_revision: u64,
    selected_save_id: Option<String>,
    acquisition_event_id: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct FailureChallengeIdentity<'a> {
    session_generation: u64,
    discovery_generation: Option<u64>,
    durable_revision: u64,
    selected_save_id: Option<&'a str>,
    acquisition_event_id: Option<&'a str>,
}

impl PersistenceFailureChallenge {
    fn matches(
        &self,
        token: Uuid,
        expected: PersistenceBypassOperation,
        current: FailureChallengeIdentity<'_>,
        current_discovery_generation: u64,
    ) -> bool {
        self.token == token
            && self.operation == expected
            && self.session_generation == current.session_generation
            && self.discovery_generation == current.discovery_generation
            && self
                .discovery_generation
                .is_none_or(|generation| generation == current_discovery_generation)
            && self.durable_revision == current.durable_revision
            && self.selected_save_id.as_deref() == current.selected_save_id
            && self.acquisition_event_id.as_deref() == current.acquisition_event_id
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)] // Part B activates acknowledgement intent ownership.
pub(crate) enum ExclusivePersistenceIntent {
    AcquisitionAcknowledgement,
}

pub(crate) struct AppSession {
    pub(crate) engine: Option<GameEngine>,
    pub(crate) persistence: SessionPersistence,
}

impl AppSession {
    pub(crate) fn installed(
        engine: GameEngine,
        generation: u64,
        autosave_target: Option<SaveSlotRef>,
    ) -> Self {
        let installed_revision = engine.durable_revision();
        Self {
            engine: Some(engine),
            persistence: SessionPersistence::for_installed_engine(
                generation,
                installed_revision,
                autosave_target,
            ),
        }
    }

    pub(crate) fn empty() -> Self {
        Self::empty_at_generation(0)
    }

    fn empty_at_generation(generation: u64) -> Self {
        Self {
            engine: None,
            persistence: SessionPersistence::for_installed_engine(generation, 0, None),
        }
    }

    pub(crate) fn durable_revision(&self) -> Option<u64> {
        self.engine.as_ref().map(GameEngine::durable_revision)
    }

    pub(crate) fn ensure_persistence_available(&self) -> Result<(), GameError> {
        if self.persistence.exclusive_intent.is_some() {
            Err(GameError::persistence_operation_in_progress())
        } else {
            Ok(())
        }
    }

    fn begin_acknowledgement(&mut self) -> Result<(), GameError> {
        self.ensure_persistence_available()?;
        self.persistence.exclusive_intent =
            Some(ExclusivePersistenceIntent::AcquisitionAcknowledgement);
        Ok(())
    }

    fn end_acknowledgement(&mut self) {
        self.persistence.exclusive_intent = None;
    }
}

pub(crate) struct SessionPersistence {
    pub(crate) generation: u64,
    pub(crate) flush_baseline_revision: u64,
    pub(crate) written_revision: Option<u64>,
    pub(crate) autosave_target: Option<SaveSlotRef>,
    pub(crate) exclusive_intent: Option<ExclusivePersistenceIntent>,
}

impl SessionPersistence {
    pub(crate) fn for_installed_engine(
        generation: u64,
        installed_revision: u64,
        autosave_target: Option<SaveSlotRef>,
    ) -> Self {
        Self {
            generation,
            flush_baseline_revision: installed_revision,
            written_revision: None,
            autosave_target,
            exclusive_intent: None,
        }
    }

    pub(crate) fn flush_revision(
        &self,
        _operation: FlushOperation,
        live_revision: u64,
    ) -> Option<u64> {
        let covered_revision = self
            .written_revision
            .unwrap_or(self.flush_baseline_revision)
            .max(self.flush_baseline_revision);
        (live_revision > covered_revision).then_some(live_revision)
    }

    pub(crate) fn record_written(&mut self, receipt: &AutosaveWriteReceipt) {
        if receipt.session_generation != self.generation {
            return;
        }
        self.written_revision = Some(
            self.written_revision
                .unwrap_or(self.flush_baseline_revision)
                .max(receipt.durable_revision),
        );
        self.autosave_target = Some(receipt.slot);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum WriterJobClass {
    Debounced {
        session_generation: u64,
        durable_revision: u64,
    },
    BlockingFlush {
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
    next_cleanup_attempt: u64,
    acknowledgements: VecDeque<QueuedWriterJob>,
    ordinary: VecDeque<QueuedWriterJob>,
}

#[derive(Default)]
struct WriterQueue {
    state: Mutex<WriterQueueState>,
    #[cfg(test)]
    cleanup_before_lock: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
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
        let start_worker = Self::enqueue_locked(&mut state, class, run);
        drop(state);
        self.start_worker(runtime, start_worker);
        Ok(())
    }

    fn enqueue_cleanup<F>(
        self: &Arc<Self>,
        owner: Option<CleanupOwner>,
        make_run: F,
    ) -> Result<(), GameError>
    where
        F: FnOnce(CleanupOwner) -> CoordinatorFuture<'static, ()>,
    {
        let runtime =
            tokio::runtime::Handle::try_current().map_err(|_| GameError::save_write_failed())?;
        #[cfg(test)]
        {
            let hook = self.cleanup_before_lock.lock().unwrap().take();
            if let Some(hook) = hook {
                hook();
            }
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| GameError::save_write_failed())?;
        let owner = owner.unwrap_or_else(|| {
            state.next_cleanup_attempt = state.next_cleanup_attempt.wrapping_add(1);
            CleanupOwner::Attempt(state.next_cleanup_attempt)
        });
        let start_worker =
            Self::enqueue_locked(&mut state, WriterJobClass::OrphanCleanup, make_run(owner));
        drop(state);
        self.start_worker(runtime, start_worker);
        Ok(())
    }

    fn enqueue_locked(
        state: &mut WriterQueueState,
        class: WriterJobClass,
        run: CoordinatorFuture<'static, ()>,
    ) -> bool {
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
        start_worker
    }

    fn start_worker(self: &Arc<Self>, runtime: tokio::runtime::Handle, start_worker: bool) {
        if start_worker {
            let queue = Arc::clone(self);
            runtime.spawn(async move {
                queue.run().await;
            });
        }
    }

    #[cfg(test)]
    fn set_cleanup_before_lock_hook(&self, hook: Arc<dyn Fn() + Send + Sync>) {
        *self.cleanup_before_lock.lock().unwrap() = Some(hook);
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
    next_session_generation: u64,
    discovery_generation: u64,
    next_autosave_serial: u64,
    pending_autosave: Option<PendingAutosave>,
    last_successful_write: Option<AutosaveWriteReceipt>,
    failed_write: Option<BackgroundWriteFailure>,
    cleanup_failure: Option<CleanupFailure>,
    failure_challenges: HashMap<Uuid, PersistenceFailureChallenge>,
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
            next_session_generation: 0,
            discovery_generation: 0,
            next_autosave_serial: 0,
            pending_autosave: None,
            last_successful_write: None,
            failed_write: None,
            cleanup_failure: None,
            failure_challenges: HashMap::new(),
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

    pub(crate) fn next_session_generation(&self) -> Result<u64, GameError> {
        let mut state = self.lock_state()?;
        state.next_session_generation = state
            .next_session_generation
            .checked_add(1)
            .ok_or_else(GameError::save_write_failed)?;
        Ok(state.next_session_generation)
    }

    pub(crate) async fn install_session(
        &self,
        app: &crate::AppState,
        engine: GameEngine,
        autosave_target: Option<SaveSlotRef>,
    ) -> Result<crate::game::GameStateView, GameError> {
        {
            let session = app.session.lock().map_err(|_| GameError::unavailable())?;
            session.ensure_persistence_available()?;
        }
        let view = engine.view()?;
        let _gate = app.replacement_gate.lock().await;
        let generation = self.next_session_generation()?;
        let mut session = app.session.lock().map_err(|_| GameError::unavailable())?;
        session.ensure_persistence_available()?;
        let autosave_target = match autosave_target {
            Some(target @ SaveSlotRef::Auto { .. }) => Some(target),
            Some(SaveSlotRef::Manual { .. }) | None => None,
        };
        *session = AppSession::installed(engine, generation, autosave_target);
        Ok(view)
    }

    pub(crate) async fn clear_session(&self, app: &crate::AppState) -> Result<u64, GameError> {
        {
            let session = app.session.lock().map_err(|_| GameError::unavailable())?;
            session.ensure_persistence_available()?;
        }
        let _gate = app.replacement_gate.lock().await;
        let generation = self.next_session_generation()?;
        let mut session = app.session.lock().map_err(|_| GameError::unavailable())?;
        session.ensure_persistence_available()?;
        *session = AppSession::empty_at_generation(generation);
        Ok(generation)
    }

    pub(crate) fn complete_discovery_attempt(&self) -> Result<u64, GameError> {
        let mut state = self.lock_state()?;
        state.discovery_generation = state
            .discovery_generation
            .checked_add(1)
            .ok_or_else(GameError::save_discovery_unavailable)?;
        state
            .failure_challenges
            .retain(|_, challenge| challenge.discovery_generation.is_none());
        Ok(state.discovery_generation)
    }

    pub(crate) fn challenge_persistence_failure(
        &self,
        operation: PersistenceBypassOperation,
        identity: FailureChallengeIdentity<'_>,
        diagnostic: GameError,
    ) -> Result<GameError, GameError> {
        let token = Uuid::new_v4();
        let token_wire = token.hyphenated().to_string();
        let challenge = PersistenceFailureChallenge {
            token,
            operation,
            session_generation: identity.session_generation,
            discovery_generation: identity.discovery_generation,
            durable_revision: identity.durable_revision,
            selected_save_id: identity.selected_save_id.map(str::to_owned),
            acquisition_event_id: identity.acquisition_event_id.map(str::to_owned),
        };
        let health = PersistenceHealthView::Degraded {
            diagnostic: diagnostic.clone(),
        };
        let subscribers = {
            let mut state = self.lock_state()?;
            if identity
                .discovery_generation
                .is_some_and(|generation| generation != state.discovery_generation)
            {
                return Err(GameError::stale_persistence_failure_token());
            }
            state.failure_challenges.insert(token, challenge);
            set_persistence_health(&mut state, health.clone())
        };
        publish_health(&subscribers, &health);
        Ok(diagnostic.with_failure_token(token_wire))
    }

    pub(crate) fn consume_failure_token(
        &self,
        token: &PersistenceFailureTokenView,
        expected: PersistenceBypassOperation,
        current: FailureChallengeIdentity<'_>,
    ) -> Result<PersistenceFailureChallenge, GameError> {
        let parsed = Uuid::parse_str(&token.0)
            .ok()
            .filter(|parsed| parsed.hyphenated().to_string() == token.0)
            .ok_or_else(GameError::stale_persistence_failure_token)?;
        let mut state = self.lock_state()?;
        let challenge = state
            .failure_challenges
            .remove(&parsed)
            .ok_or_else(GameError::stale_persistence_failure_token)?;
        if !challenge.matches(parsed, expected, current, state.discovery_generation) {
            return Err(GameError::stale_persistence_failure_token());
        }
        Ok(challenge)
    }

    pub(crate) fn cancel_failure_token(
        &self,
        token: &PersistenceFailureTokenView,
        expected: PersistenceBypassOperation,
        current: FailureChallengeIdentity<'_>,
    ) -> Result<(), GameError> {
        self.consume_failure_token(token, expected, current)
            .map(|_| ())
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

    pub(crate) async fn flush_session(
        &self,
        app: &crate::AppState,
        operation: FlushOperation,
    ) -> Result<FlushOutcome, GameError> {
        let (session_generation, durable_revision, flush_revision) = {
            let mut session = app.session.lock().map_err(|_| GameError::unavailable())?;
            session.ensure_persistence_available()?;
            if let Some(receipt) = self.last_successful_write() {
                session.persistence.record_written(&receipt);
            }
            let durable_revision = session
                .durable_revision()
                .ok_or_else(GameError::game_not_started)?;
            (
                session.persistence.generation,
                durable_revision,
                session
                    .persistence
                    .flush_revision(operation, durable_revision),
            )
        };
        let Some(flush_revision) = flush_revision else {
            return Ok(FlushOutcome::Noop {
                session_generation,
                durable_revision,
            });
        };
        self.cancel_pending_autosave_covered_by_flush(session_generation, flush_revision)?;

        let (result_tx, result_rx) = tokio::sync::oneshot::channel();
        let coordinator = self.clone();
        if let Err(error) = self.writer_queue.enqueue(
            WriterJobClass::BlockingFlush {
                session_generation,
                durable_revision: flush_revision,
            },
            Box::pin(async move {
                let result = coordinator
                    .execute_blocking_flush(session_generation, flush_revision)
                    .await;
                let _ = result_tx.send(result);
            }),
        ) {
            self.record_background_failure(session_generation, flush_revision, error.clone());
            return Err(error);
        }
        let (receipt, wrote) = result_rx
            .await
            .map_err(|_| GameError::save_write_failed())??;

        let _gate = app.replacement_gate.lock().await;
        let mut session = app.session.lock().map_err(|_| GameError::unavailable())?;
        session.ensure_persistence_available()?;
        if session.persistence.generation != session_generation
            || session.durable_revision() != Some(durable_revision)
        {
            return Err(GameError::save_write_failed());
        }
        session.persistence.record_written(&receipt);
        if wrote {
            Ok(FlushOutcome::Written {
                session_generation,
                durable_revision,
                slot: receipt.slot,
            })
        } else {
            Ok(FlushOutcome::Noop {
                session_generation,
                durable_revision,
            })
        }
    }

    pub(crate) async fn acknowledge_acquisition(
        &self,
        app: &crate::AppState,
        event_id: String,
        ticket: String,
    ) -> Result<AcknowledgementOutcome, GameError> {
        let (session_generation, source_revision, next_revision, thumbnail) = {
            let mut session = app.session.lock().map_err(|_| GameError::unavailable())?;
            session.ensure_persistence_available()?;
            let engine = session
                .engine
                .as_ref()
                .ok_or_else(GameError::game_not_started)?;
            let source_revision = engine.durable_revision();
            let next_revision = source_revision
                .checked_add(1)
                .ok_or_else(GameError::save_write_failed)?;
            let matching_events = engine
                .pending_acquisition_events
                .iter()
                .filter(|event| event.id == event_id)
                .count();
            if matching_events != 1 {
                return Err(GameError::unknown_acquisition_event());
            }
            let session_generation = session.persistence.generation;
            let purpose = ThumbnailCapturePurpose::AcquisitionAcknowledgement {
                session_generation,
                source_revision,
                next_revision,
                event_id: event_id.clone(),
            };
            let thumbnail = self.claim_thumbnail(&ticket, &purpose)?;
            session.begin_acknowledgement()?;
            (
                session_generation,
                source_revision,
                next_revision,
                thumbnail,
            )
        };

        if let Err(error) =
            self.cancel_pending_autosave_covered_by_flush(session_generation, source_revision)
        {
            self.clear_acknowledgement_intent(app, session_generation);
            return Err(error);
        }

        let (turn_tx, turn_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();
        if let Err(error) = self.writer_queue.enqueue(
            WriterJobClass::AcquisitionAcknowledgement,
            Box::pin(async move {
                let _ = turn_tx.send(());
                let _ = release_rx.await;
            }),
        ) {
            self.clear_acknowledgement_intent(app, session_generation);
            return Err(error);
        }
        if turn_rx.await.is_err() {
            self.clear_acknowledgement_intent(app, session_generation);
            return Err(GameError::save_write_failed());
        }

        let gate = app.replacement_gate.lock().await;
        let result = self
            .acknowledge_acquisition_with_writer_and_gate(
                app,
                session_generation,
                source_revision,
                next_revision,
                &event_id,
                thumbnail,
            )
            .await;
        self.clear_acknowledgement_intent(app, session_generation);
        drop(gate);
        let _ = release_tx.send(());
        result
    }

    async fn acknowledge_acquisition_with_writer_and_gate(
        &self,
        app: &crate::AppState,
        session_generation: u64,
        source_revision: u64,
        next_revision: u64,
        event_id: &str,
        thumbnail: CaptureTerminalResult,
    ) -> Result<AcknowledgementOutcome, GameError> {
        let prepared_mutation = {
            let prepare = || -> Result<_, GameError> {
                let mut session = app.session.lock().map_err(|_| GameError::unavailable())?;
                if session.persistence.generation != session_generation
                    || session.persistence.exclusive_intent
                        != Some(ExclusivePersistenceIntent::AcquisitionAcknowledgement)
                {
                    return Err(GameError::persistence_operation_in_progress());
                }
                if let Some(receipt) = self.last_successful_write() {
                    session.persistence.record_written(&receipt);
                }
                let preferred_target = session.persistence.autosave_target;
                let engine = session
                    .engine
                    .as_mut()
                    .ok_or_else(GameError::game_not_started)?;
                if engine.durable_revision() != source_revision {
                    return Err(GameError::save_write_failed());
                }
                let rollback = EngineRollbackSnapshot::capture(engine);
                let matching_events: Vec<usize> = engine
                    .pending_acquisition_events
                    .iter()
                    .enumerate()
                    .filter_map(|(index, event)| (event.id == event_id).then_some(index))
                    .collect();
                if matching_events.len() != 1 {
                    return Err(GameError::unknown_acquisition_event());
                }
                engine.pending_acquisition_events.remove(matching_events[0]);
                engine.durable_revision = next_revision;
                match engine.view() {
                    Ok(state) => Ok((rollback, preferred_target, state)),
                    Err(error) => {
                        EngineRollbackSnapshot::restore(engine, rollback);
                        Err(error)
                    }
                }
            };
            prepare()
        };

        match prepared_mutation {
            Ok((rollback, preferred_target, state)) => {
                let write_result = self
                    .execute_acknowledgement_write(
                        session_generation,
                        next_revision,
                        preferred_target,
                        thumbnail,
                    )
                    .await;
                let mut session = app.session.lock().map_err(|_| GameError::unavailable())?;
                match write_result {
                    Ok((receipt, cleanup_diagnostic)) => {
                        session.persistence.record_written(&receipt);
                        self.record_blocking_success(receipt, cleanup_diagnostic.clone());
                        Ok(AcknowledgementOutcome {
                            state,
                            cleanup_diagnostic,
                        })
                    }
                    Err(error) => {
                        let engine = session
                            .engine
                            .as_mut()
                            .ok_or_else(GameError::game_not_started)?;
                        EngineRollbackSnapshot::restore(engine, rollback);
                        drop(session);
                        let challenged = self.challenge_persistence_failure(
                            PersistenceBypassOperation::ContinueWithoutSaving,
                            FailureChallengeIdentity {
                                session_generation,
                                discovery_generation: None,
                                durable_revision: source_revision,
                                selected_save_id: None,
                                acquisition_event_id: Some(event_id),
                            },
                            error.clone(),
                        );
                        Err(challenged.unwrap_or(error))
                    }
                }
            }
            Err(error) => Err(error),
        }
    }

    pub(crate) fn retry_acquisition_acknowledgement(
        &self,
        app: &crate::AppState,
        event_id: String,
        token: PersistenceFailureTokenView,
    ) -> Result<ThumbnailCaptureRequestView, GameError> {
        let (session_generation, source_revision) =
            current_acquisition_failure_identity(app, &event_id)?;
        let current = FailureChallengeIdentity {
            session_generation,
            discovery_generation: None,
            durable_revision: source_revision,
            selected_save_id: None,
            acquisition_event_id: Some(&event_id),
        };
        self.consume_failure_token(
            &token,
            PersistenceBypassOperation::ContinueWithoutSaving,
            current,
        )?;
        let next_revision = source_revision
            .checked_add(1)
            .ok_or_else(GameError::save_write_failed)?;
        let purpose = ThumbnailCapturePurpose::AcquisitionAcknowledgement {
            session_generation,
            source_revision,
            next_revision,
            event_id: event_id.clone(),
        };
        match self.prepare_thumbnail(purpose) {
            Ok(request) => Ok(request),
            Err(error) => {
                let challenged = self.challenge_persistence_failure(
                    PersistenceBypassOperation::ContinueWithoutSaving,
                    current,
                    error.clone(),
                );
                Err(challenged.unwrap_or(error))
            }
        }
    }

    pub(crate) fn cancel_acquisition_failure(
        &self,
        app: &crate::AppState,
        event_id: String,
        token: PersistenceFailureTokenView,
    ) -> Result<crate::game::GameStateView, GameError> {
        let (session_generation, source_revision) =
            current_acquisition_failure_identity(app, &event_id)?;
        self.cancel_failure_token(
            &token,
            PersistenceBypassOperation::ContinueWithoutSaving,
            FailureChallengeIdentity {
                session_generation,
                discovery_generation: None,
                durable_revision: source_revision,
                selected_save_id: None,
                acquisition_event_id: Some(&event_id),
            },
        )?;
        let session = app.session.lock().map_err(|_| GameError::unavailable())?;
        session.ensure_persistence_available()?;
        if session.persistence.generation != session_generation
            || session.durable_revision() != Some(source_revision)
        {
            return Err(GameError::stale_persistence_failure_token());
        }
        session
            .engine
            .as_ref()
            .ok_or_else(GameError::game_not_started)?
            .view()
    }

    pub(crate) async fn confirm_acquisition_without_saving(
        &self,
        app: &crate::AppState,
        event_id: String,
        token: PersistenceFailureTokenView,
    ) -> Result<crate::game::GameStateView, GameError> {
        let (session_generation, source_revision) =
            current_acquisition_failure_identity(app, &event_id)?;
        self.consume_failure_token(
            &token,
            PersistenceBypassOperation::ContinueWithoutSaving,
            FailureChallengeIdentity {
                session_generation,
                discovery_generation: None,
                durable_revision: source_revision,
                selected_save_id: None,
                acquisition_event_id: Some(&event_id),
            },
        )?;

        let _gate = app.replacement_gate.lock().await;
        let state = {
            let mut session = app.session.lock().map_err(|_| GameError::unavailable())?;
            session.ensure_persistence_available()?;
            if session.persistence.generation != session_generation {
                return Err(GameError::stale_persistence_failure_token());
            }
            let engine = session
                .engine
                .as_mut()
                .ok_or_else(GameError::game_not_started)?;
            if engine.durable_revision() != source_revision {
                return Err(GameError::stale_persistence_failure_token());
            }
            let matching_events: Vec<usize> = engine
                .pending_acquisition_events
                .iter()
                .enumerate()
                .filter_map(|(index, event)| (event.id == event_id).then_some(index))
                .collect();
            if matching_events.len() != 1 {
                return Err(GameError::unknown_acquisition_event());
            }
            let next_revision = source_revision
                .checked_add(1)
                .ok_or_else(GameError::save_write_failed)?;
            let rollback = EngineRollbackSnapshot::capture(engine);
            engine.pending_acquisition_events.remove(matching_events[0]);
            engine.durable_revision = next_revision;
            match engine.view() {
                Ok(state) => state,
                Err(error) => {
                    EngineRollbackSnapshot::restore(engine, rollback);
                    return Err(error);
                }
            }
        };
        self.mark_persistence_degraded(GameError::save_write_failed())?;
        Ok(state)
    }

    async fn execute_acknowledgement_write(
        &self,
        session_generation: u64,
        durable_revision: u64,
        preferred_target: Option<SaveSlotRef>,
        thumbnail: CaptureTerminalResult,
    ) -> Result<(AutosaveWriteReceipt, Option<GameError>), GameError> {
        let backend = self
            .backend
            .as_ref()
            .cloned()
            .ok_or_else(GameError::save_write_failed)?;
        let capture = backend
            .capture(AutosaveWriteJob {
                session_generation,
                durable_revision,
                thumbnail,
            })
            .await?;
        let target = match preferred_target {
            Some(target @ SaveSlotRef::Auto { .. }) => target,
            Some(SaveSlotRef::Manual { .. }) => return Err(GameError::save_write_failed()),
            None => select_autosave_target(&capture.slots)?,
        };
        let save_id = Uuid::new_v4().hyphenated().to_string();
        let expected_receipt = AutosaveWriteReceipt {
            session_generation,
            durable_revision,
            slot: target,
            save_id: save_id.clone(),
        };
        let registered = backend.register(capture, target, save_id).await?;
        let prepared = backend.prepare(registered).await?;
        let committed = match backend.commit_if_current(prepared).await? {
            AutosaveCommitOutcome::Committed(committed) => committed,
            AutosaveCommitOutcome::Stale(prepared) => {
                prepared.discard()?;
                return Err(GameError::save_write_failed());
            }
        };
        let (receipt, cleanup_diagnostic) = committed.into_parts();
        if receipt != expected_receipt {
            return Err(GameError::save_write_failed());
        }
        Ok((receipt, cleanup_diagnostic))
    }

    fn clear_acknowledgement_intent(&self, app: &crate::AppState, session_generation: u64) {
        if let Ok(mut session) = app.session.lock() {
            if session.persistence.generation == session_generation {
                session.end_acknowledgement();
            }
        }
    }

    async fn execute_blocking_flush(
        &self,
        session_generation: u64,
        durable_revision: u64,
    ) -> Result<(AutosaveWriteReceipt, bool), GameError> {
        if let Some(receipt) = self.last_successful_write().filter(|receipt| {
            receipt.session_generation == session_generation
                && receipt.durable_revision >= durable_revision
        }) {
            return Ok((receipt, false));
        }
        let backend = self
            .backend
            .as_ref()
            .cloned()
            .ok_or_else(GameError::save_write_failed)?;
        let write_result = async {
            let capture = backend
                .capture(AutosaveWriteJob {
                    session_generation,
                    durable_revision,
                    thumbnail: CaptureTerminalResult::Unavailable,
                })
                .await?;
            let target = select_autosave_target(&capture.slots)?;
            let save_id = Uuid::new_v4().hyphenated().to_string();
            let expected_receipt = AutosaveWriteReceipt {
                session_generation,
                durable_revision,
                slot: target,
                save_id: save_id.clone(),
            };
            let registered = backend.register(capture, target, save_id).await?;
            let prepared = backend.prepare(registered).await?;
            let committed = match backend.commit_if_current(prepared).await? {
                AutosaveCommitOutcome::Committed(committed) => committed,
                AutosaveCommitOutcome::Stale(prepared) => {
                    prepared.discard()?;
                    return Err(GameError::save_write_failed());
                }
            };
            let (receipt, cleanup_diagnostic) = committed.into_parts();
            if receipt != expected_receipt {
                return Err(GameError::save_write_failed());
            }
            self.record_blocking_success(receipt.clone(), cleanup_diagnostic);
            Ok((receipt, true))
        }
        .await;
        if let Err(error) = &write_result {
            self.record_background_failure(session_generation, durable_revision, error.clone());
        }
        write_result
    }

    fn cancel_pending_autosave_covered_by_flush(
        &self,
        session_generation: u64,
        durable_revision: u64,
    ) -> Result<(), GameError> {
        let subscribers = {
            let mut state = self.lock_state()?;
            let covered = state.pending_autosave.as_ref().is_some_and(|pending| {
                pending.session_generation == session_generation
                    && pending.durable_revision <= durable_revision
            });
            if !covered {
                return Ok(());
            }
            let pending = state
                .pending_autosave
                .take()
                .ok_or_else(GameError::save_write_failed)?;
            state.tickets.remove(&pending.ticket);
            if state.latest_by_intent.get(&CaptureIntent::Autosave) == Some(&pending.ticket) {
                state.latest_by_intent.remove(&CaptureIntent::Autosave);
            }
            set_thumbnail_activity(&mut state, ThumbnailActivityView::Idle)
        };
        publish_activity(&subscribers, &ThumbnailActivityView::Idle);
        self.ticket_updates.notify_waiters();
        Ok(())
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
            .and_then(|state| state.last_successful_write.clone())
            .filter(|receipt| receipt.session_generation == session_generation)
            .map(|receipt| receipt.slot)
    }

    pub(crate) fn reserve_acknowledgement_writer(
        &self,
        run: CoordinatorFuture<'static, ()>,
    ) -> Result<(), GameError> {
        self.writer_queue
            .enqueue(WriterJobClass::AcquisitionAcknowledgement, run)
    }

    pub(crate) fn enqueue_orphan_cleanup(&self) -> Result<(), GameError> {
        let owner = self
            .lock_state()?
            .cleanup_failure
            .as_ref()
            .map(|failure| failure.owner.clone());
        self.enqueue_cleanup_retry(owner)
    }

    fn enqueue_cleanup_retry(&self, owner: Option<CleanupOwner>) -> Result<(), GameError> {
        let backend = self
            .backend
            .as_ref()
            .cloned()
            .ok_or_else(GameError::save_write_failed)?;
        let coordinator = self.clone();
        self.writer_queue.enqueue_cleanup(owner, move |owner| {
            Box::pin(async move {
                match backend.cleanup_orphans().await {
                    Ok(()) => coordinator.resolve_cleanup_failure(&owner),
                    Err(error) => coordinator.record_cleanup_failure(owner, error),
                }
            })
        })
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
            let _ = self.enqueue_cleanup_retry(Some(owner));
        }
    }

    fn record_blocking_success(
        &self,
        receipt: AutosaveWriteReceipt,
        cleanup_diagnostic: Option<GameError>,
    ) {
        let (health, subscribers, cleanup_retry) = if let Ok(mut state) = self.state.lock() {
            let receipt_identity = (receipt.session_generation, receipt.durable_revision);
            if state
                .last_successful_write
                .as_ref()
                .is_none_or(|successful| {
                    receipt_identity >= (successful.session_generation, successful.durable_revision)
                })
            {
                state.last_successful_write = Some(receipt.clone());
            }
            if state
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
            if let Err(error) = self.enqueue_cleanup_retry(Some(owner.clone())) {
                self.record_cleanup_failure(owner, error);
            }
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
                .is_some_and(|failure| cleanup_success_resolves(owner, &failure.owner))
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

    fn mark_persistence_degraded(&self, diagnostic: GameError) -> Result<(), GameError> {
        let health = PersistenceHealthView::Degraded { diagnostic };
        let subscribers = {
            let mut state = self.lock_state()?;
            set_persistence_health(&mut state, health.clone())
        };
        publish_health(&subscribers, &health);
        Ok(())
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

fn current_acquisition_failure_identity(
    app: &crate::AppState,
    event_id: &str,
) -> Result<(u64, u64), GameError> {
    let session = app.session.lock().map_err(|_| GameError::unavailable())?;
    session.ensure_persistence_available()?;
    let engine = session
        .engine
        .as_ref()
        .ok_or_else(GameError::game_not_started)?;
    if engine
        .pending_acquisition_events
        .iter()
        .filter(|event| event.id == event_id)
        .count()
        != 1
    {
        return Err(GameError::stale_persistence_failure_token());
    }
    Ok((session.persistence.generation, engine.durable_revision()))
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

fn cleanup_success_resolves(success: &CleanupOwner, failure: &CleanupOwner) -> bool {
    match (success, failure) {
        (CleanupOwner::Attempt(success), CleanupOwner::Attempt(failure)) => failure <= success,
        _ => success == failure,
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
    mod lock_order {
        use super::super::{
            AppSession, ExclusivePersistenceIntent, FlushOperation, SaveCoordinator,
            AUTOSAVE_DEBOUNCE,
        };
        use super::acknowledgement::{app_with_event, terminal_acknowledgement_ticket};
        use super::debounce::PhasedBackend;
        use super::storage_integration::StorageBackend;
        use crate::game::save::schema::SaveSlotRef;
        use crate::game::test_support::{empty_engine_with_scene, investigation_scene_with_intro};
        use crate::AppState;
        use std::path::PathBuf;
        use std::sync::{Arc, Mutex};
        use std::time::Duration;

        fn engine(revision: u64) -> crate::game::GameEngine {
            let mut engine =
                empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
            engine.durable_revision = revision;
            engine
        }

        fn app(
            coordinator: SaveCoordinator,
            generation: u64,
            revision: u64,
            autosave_target: Option<SaveSlotRef>,
        ) -> AppState {
            AppState {
                session: Mutex::new(AppSession::installed(
                    engine(revision),
                    generation,
                    autosave_target,
                )),
                replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
                coordinator,
                resources_dir: PathBuf::new(),
                save_root: PathBuf::new(),
            }
        }

        #[tokio::test]
        async fn queued_exclusive_intent_rejects_session_transitions_without_waiting() {
            let coordinator = SaveCoordinator::new();
            let app = app(coordinator.clone(), 4, 9, None);
            app.session.lock().unwrap().persistence.exclusive_intent =
                Some(ExclusivePersistenceIntent::AcquisitionAcknowledgement);

            let install = tokio::time::timeout(
                Duration::from_millis(50),
                coordinator.install_session(&app, engine(21), SaveSlotRef::Auto { slot: 3 }.into()),
            )
            .await
            .expect("install must fail fast")
            .unwrap_err();
            assert_eq!(install.code, "persistenceOperationInProgress");

            let clear =
                tokio::time::timeout(Duration::from_millis(50), coordinator.clear_session(&app))
                    .await
                    .expect("clear must fail fast")
                    .unwrap_err();
            assert_eq!(clear.code, "persistenceOperationInProgress");
        }

        #[tokio::test]
        async fn replacements_install_monotonic_generations_and_only_adopt_auto_targets() {
            let coordinator = SaveCoordinator::new();
            let app = app(coordinator.clone(), 0, 0, None);

            coordinator
                .install_session(&app, engine(0), None)
                .await
                .unwrap();
            {
                let session = app.session.lock().unwrap();
                assert_eq!(session.persistence.generation, 1);
                assert_eq!(session.persistence.flush_baseline_revision, 0);
                assert_eq!(session.persistence.autosave_target, None);
            }

            coordinator
                .install_session(&app, engine(44), Some(SaveSlotRef::Auto { slot: 4 }))
                .await
                .unwrap();
            {
                let session = app.session.lock().unwrap();
                assert_eq!(session.persistence.generation, 2);
                assert_eq!(session.persistence.flush_baseline_revision, 44);
                assert_eq!(
                    session.persistence.autosave_target,
                    Some(SaveSlotRef::Auto { slot: 4 })
                );
            }

            coordinator
                .install_session(&app, engine(18), Some(SaveSlotRef::Manual { slot: 2 }))
                .await
                .unwrap();
            {
                let session = app.session.lock().unwrap();
                assert_eq!(session.persistence.generation, 3);
                assert_eq!(session.persistence.flush_baseline_revision, 18);
                assert_eq!(session.persistence.autosave_target, None);
            }

            assert_eq!(coordinator.clear_session(&app).await.unwrap(), 4);
            let session = app.session.lock().unwrap();
            assert!(session.engine.is_none());
            assert_eq!(session.persistence.generation, 4);
            assert_eq!(session.persistence.autosave_target, None);
        }

        #[tokio::test]
        async fn writer_holding_gate_never_blocks_session_access_for_install_or_clear() {
            for clear in [false, true] {
                let coordinator = SaveCoordinator::new();
                let app = Arc::new(app(coordinator.clone(), 7, 12, None));
                let gate = app.replacement_gate.clone().lock_owned().await;
                let transition = {
                    let app = Arc::clone(&app);
                    let coordinator = coordinator.clone();
                    tokio::spawn(async move {
                        if clear {
                            coordinator.clear_session(&app).await.map(|_| ())
                        } else {
                            coordinator
                                .install_session(&app, engine(33), None)
                                .await
                                .map(|_| ())
                        }
                    })
                };

                tokio::task::yield_now().await;
                assert!(
                    app.session.try_lock().is_ok(),
                    "a transition waiting for G must not own S"
                );
                drop(gate);
                tokio::time::timeout(Duration::from_millis(250), transition)
                    .await
                    .expect("transition wedged behind a writer holding G")
                    .unwrap()
                    .unwrap();
            }
        }

        #[tokio::test(start_paused = true)]
        async fn waiter_for_writer_owns_neither_session_nor_replacement_gate() {
            let backend = Arc::new(PhasedBackend::new(3));
            backend.pause_prepare();
            let coordinator = SaveCoordinator::with_backend(backend.clone());
            let app = Arc::new(app(coordinator.clone(), 3, 2, None));

            let autosave = coordinator.notify_durable_commit(3, 2).unwrap();
            coordinator
                .report_thumbnail_failure(&autosave.ticket)
                .unwrap();
            tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
            backend.wait_for_prepare().await;

            let flush = {
                let app = Arc::clone(&app);
                let coordinator = coordinator.clone();
                tokio::spawn(async move {
                    coordinator
                        .flush_session(&app, FlushOperation::ReturnToTitle)
                        .await
                })
            };
            tokio::task::yield_now().await;

            assert!(app.session.try_lock().is_ok(), "W waiter must not own S");
            assert!(
                app.replacement_gate.try_lock().is_ok(),
                "W waiter must not own G"
            );

            backend.release_prepare();
            flush.await.unwrap().unwrap();
        }

        #[tokio::test(start_paused = true)]
        async fn queued_acknowledgement_rejects_every_session_transition_without_owning_s_or_g() {
            let backend = Arc::new(PhasedBackend::new(8));
            backend.pause_prepare();
            let coordinator = SaveCoordinator::with_backend(backend.clone());
            let event_id = "acq:3:0";
            let app = Arc::new(app_with_event(coordinator.clone(), 8, 3, event_id, None));

            let autosave = coordinator.notify_durable_commit(8, 3).unwrap();
            coordinator
                .report_thumbnail_failure(&autosave.ticket)
                .unwrap();
            tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
            backend.wait_for_prepare().await;

            let ticket = terminal_acknowledgement_ticket(&coordinator, 8, 3, event_id);
            let acknowledgement = {
                let app = Arc::clone(&app);
                let coordinator = coordinator.clone();
                tokio::spawn(async move {
                    coordinator
                        .acknowledge_acquisition(&app, event_id.into(), ticket)
                        .await
                })
            };
            for _ in 0..100 {
                if app
                    .session
                    .lock()
                    .unwrap()
                    .persistence
                    .exclusive_intent
                    .is_some()
                {
                    break;
                }
                tokio::task::yield_now().await;
            }

            {
                let session = app.session.try_lock().expect("queued ack must not own S");
                assert_eq!(
                    session.ensure_persistence_available().unwrap_err().code,
                    "persistenceOperationInProgress"
                );
            }
            assert!(
                app.replacement_gate.try_lock().is_ok(),
                "queued ack must not own G"
            );
            assert_eq!(
                coordinator
                    .install_session(&app, engine(90), None)
                    .await
                    .unwrap_err()
                    .code,
                "persistenceOperationInProgress"
            );
            assert_eq!(
                coordinator.clear_session(&app).await.unwrap_err().code,
                "persistenceOperationInProgress"
            );

            backend.release_prepare();
            acknowledgement.await.unwrap().unwrap();
        }

        #[tokio::test]
        async fn active_acknowledgement_holds_g_not_s_and_other_transitions_fail_fast() {
            let backend = Arc::new(PhasedBackend::new(9));
            backend.pause_prepare();
            let coordinator = SaveCoordinator::with_backend(backend.clone());
            let event_id = "acq:4:0";
            let app = Arc::new(app_with_event(coordinator.clone(), 9, 4, event_id, None));
            let ticket = terminal_acknowledgement_ticket(&coordinator, 9, 4, event_id);
            let acknowledgement = {
                let app = Arc::clone(&app);
                let coordinator = coordinator.clone();
                tokio::spawn(async move {
                    coordinator
                        .acknowledge_acquisition(&app, event_id.into(), ticket)
                        .await
                })
            };
            backend.wait_for_prepare().await;

            assert!(
                app.replacement_gate.try_lock().is_err(),
                "active ack must own G"
            );
            {
                let session = app.session.try_lock().expect("active ack must not own S");
                assert_eq!(
                    session.ensure_persistence_available().unwrap_err().code,
                    "persistenceOperationInProgress"
                );
            }
            assert_eq!(
                coordinator
                    .install_session(&app, engine(91), None)
                    .await
                    .unwrap_err()
                    .code,
                "persistenceOperationInProgress"
            );
            assert_eq!(
                coordinator.clear_session(&app).await.unwrap_err().code,
                "persistenceOperationInProgress"
            );

            backend.release_prepare();
            acknowledgement.await.unwrap().unwrap();
        }

        #[tokio::test(start_paused = true)]
        async fn real_temporary_write_keeps_gameplay_session_and_replacement_gate_responsive() {
            let backend = Arc::new(StorageBackend::new(10, 15));
            backend.pause_after_prepare();
            let coordinator = SaveCoordinator::with_backend(backend.clone());
            let app = app(coordinator.clone(), 10, 15, None);

            let request = coordinator.notify_durable_commit(10, 15).unwrap();
            coordinator
                .report_thumbnail_failure(&request.ticket)
                .unwrap();
            tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
            backend.wait_for_prepare().await;

            assert_eq!(app.session.try_lock().unwrap().durable_revision(), Some(15));
            assert!(app.replacement_gate.try_lock().is_ok());
            assert_eq!(backend.phases(), ["S:capture", "S:register", "W:prepare"]);
            assert_eq!(
                backend.observed_required_lock_phases(),
                (true, true, false, false)
            );

            backend.release_prepare();
            backend.wait_for_completions(1).await;
            assert_eq!(
                backend.observed_required_lock_phases(),
                (true, true, true, true)
            );
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
        async fn stale_generation_fails_final_revalidation_before_real_replacement() {
            let backend = Arc::new(StorageBackend::new(11, 22));
            backend.pause_after_prepare();
            let coordinator = SaveCoordinator::with_backend(backend.clone());

            let request = coordinator.notify_durable_commit(11, 22).unwrap();
            coordinator
                .report_thumbnail_failure(&request.ticket)
                .unwrap();
            tokio::time::advance(AUTOSAVE_DEBOUNCE).await;
            backend.wait_for_prepare().await;

            backend.set_current_generation(12);
            backend.release_prepare();
            backend.wait_for_completions(1).await;
            backend.wait_for_discards(1).await;

            assert_eq!(backend.installed_count(), 0);
            assert_eq!(backend.discarded_count(), 1);
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
            assert!(coordinator.last_successful_write().is_none());
        }
    }

    mod flush {
        use super::super::{
            AppSession, AutosaveWriteReceipt, FlushOperation, FlushOutcome, SaveCoordinator,
            SessionPersistence,
        };
        use super::debounce::RecordingBackend;
        use crate::game::save::schema::SaveSlotRef;
        use crate::game::test_support::{empty_engine_with_scene, investigation_scene_with_intro};
        use crate::AppState;
        use std::path::PathBuf;
        use std::sync::{Arc, Mutex};

        #[test]
        fn fresh_revision_zero_baseline_is_a_physical_no_op() {
            let persistence = SessionPersistence::for_installed_engine(1, 0, None);

            assert_eq!(
                persistence.flush_revision(FlushOperation::ReturnToTitle, 0),
                None
            );
            assert_eq!(persistence.written_revision, None);
            assert_eq!(persistence.autosave_target, None);
        }

        #[tokio::test]
        async fn fresh_revision_zero_flush_never_enters_the_writer() {
            let backend = Arc::new(RecordingBackend::default());
            let coordinator = SaveCoordinator::with_backend(backend.clone());
            let engine =
                empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
            let app = AppState {
                session: Mutex::new(AppSession::installed(engine, 1, None)),
                replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
                coordinator: coordinator.clone(),
                resources_dir: PathBuf::new(),
                save_root: PathBuf::new(),
            };

            assert_eq!(
                coordinator
                    .flush_session(&app, FlushOperation::ReturnToTitle)
                    .await
                    .unwrap(),
                FlushOutcome::Noop {
                    session_generation: 1,
                    durable_revision: 0,
                }
            );
            assert_eq!(backend.write_count(), 0);
            assert_eq!(coordinator.last_successful_write(), None);
            assert_eq!(
                app.session.lock().unwrap().persistence.autosave_target,
                None
            );
        }

        #[test]
        fn loaded_revision_44_baseline_does_not_write_until_revision_45() {
            let source = SaveSlotRef::Auto { slot: 3 };
            let persistence = SessionPersistence::for_installed_engine(7, 44, Some(source));

            assert_eq!(
                persistence.flush_revision(FlushOperation::InGameLoad, 44),
                None
            );
            assert_eq!(
                persistence.flush_revision(FlushOperation::InGameLoad, 45),
                Some(45)
            );
            assert_eq!(persistence.autosave_target, Some(source));
        }

        #[tokio::test]
        async fn loaded_revision_44_flushes_only_after_revision_45() {
            let backend = Arc::new(RecordingBackend::default());
            let coordinator = SaveCoordinator::with_backend(backend.clone());
            let mut engine =
                empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
            engine.durable_revision = 44;
            let source = SaveSlotRef::Auto { slot: 3 };
            let app = AppState {
                session: Mutex::new(AppSession::installed(engine, 7, Some(source))),
                replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
                coordinator: coordinator.clone(),
                resources_dir: PathBuf::new(),
                save_root: PathBuf::new(),
            };

            assert!(matches!(
                coordinator
                    .flush_session(&app, FlushOperation::InGameLoad)
                    .await
                    .unwrap(),
                FlushOutcome::Noop {
                    session_generation: 7,
                    durable_revision: 44
                }
            ));
            assert_eq!(backend.write_count(), 0);

            app.session
                .lock()
                .unwrap()
                .engine
                .as_mut()
                .unwrap()
                .durable_revision = 45;
            assert!(matches!(
                coordinator
                    .flush_session(&app, FlushOperation::InGameLoad)
                    .await
                    .unwrap(),
                FlushOutcome::Written {
                    session_generation: 7,
                    durable_revision: 45,
                    ..
                }
            ));
            assert_eq!(backend.write_count(), 1);
            assert_eq!(app.session.lock().unwrap().durable_revision(), Some(45));
        }

        #[test]
        fn same_generation_baseline_or_written_revision_covers_every_flush_boundary() {
            let mut persistence = SessionPersistence::for_installed_engine(9, 12, None);
            persistence.record_written(&AutosaveWriteReceipt {
                session_generation: 9,
                durable_revision: 18,
                slot: SaveSlotRef::Auto { slot: 2 },
                save_id: "550e8400-e29b-41d4-a716-446655440001".into(),
            });

            for operation in [
                FlushOperation::ManualSave,
                FlushOperation::InGameLoad,
                FlushOperation::ReturnToTitle,
                FlushOperation::AcquisitionAcknowledgement,
            ] {
                assert_eq!(persistence.flush_revision(operation, 12), None);
                assert_eq!(persistence.flush_revision(operation, 18), None);
                assert_eq!(persistence.flush_revision(operation, 19), Some(19));
            }
        }

        #[test]
        fn prior_generation_revision_900_cannot_suppress_new_generation_revision_1() {
            let prior = AutosaveWriteReceipt {
                session_generation: 1,
                durable_revision: 900,
                slot: SaveSlotRef::Auto { slot: 5 },
                save_id: "550e8400-e29b-41d4-a716-446655440002".into(),
            };
            let mut persistence = SessionPersistence::for_installed_engine(2, 0, None);

            persistence.record_written(&prior);

            assert_eq!(persistence.written_revision, None);
            assert_eq!(
                persistence.flush_revision(FlushOperation::ReturnToTitle, 1),
                Some(1)
            );
            assert_eq!(persistence.autosave_target, None);
        }

        #[test]
        fn installed_sessions_receive_monotonic_generations() {
            let coordinator = super::super::SaveCoordinator::new();

            assert_eq!(coordinator.next_session_generation().unwrap(), 1);
            assert_eq!(coordinator.next_session_generation().unwrap(), 2);
            assert_eq!(coordinator.next_session_generation().unwrap(), 3);
        }

        #[test]
        fn installed_session_baseline_and_target_come_from_the_installed_engine() {
            let mut engine =
                empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
            engine.durable_revision = 44;
            let source = SaveSlotRef::Auto { slot: 4 };

            let session = AppSession::installed(engine, 8, Some(source));

            assert_eq!(session.durable_revision(), Some(44));
            assert_eq!(session.persistence.generation, 8);
            assert_eq!(session.persistence.flush_baseline_revision, 44);
            assert_eq!(session.persistence.autosave_target, Some(source));
            assert_eq!(session.persistence.exclusive_intent, None);
        }

        #[test]
        fn flush_and_manual_save_decisions_do_not_advance_durable_revision() {
            let mut durable_revision = 27;
            let persistence = SessionPersistence::for_installed_engine(4, 0, None);

            assert_eq!(
                persistence.flush_revision(FlushOperation::ReturnToTitle, durable_revision),
                Some(27)
            );
            assert_eq!(durable_revision, 27);

            assert_eq!(
                persistence.flush_revision(FlushOperation::ManualSave, durable_revision),
                Some(27)
            );
            assert_eq!(durable_revision, 27);

            durable_revision += 1;
            assert_eq!(durable_revision, 28);
        }

        #[tokio::test]
        async fn blocking_flush_writes_once_then_becomes_idempotent_without_advancing_revision() {
            let backend = Arc::new(RecordingBackend::default());
            let coordinator = SaveCoordinator::with_backend(backend.clone());
            let engine =
                empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
            let mut session = AppSession::installed(engine, 3, None);
            session.engine.as_mut().unwrap().durable_revision = 1;
            let app = AppState {
                session: Mutex::new(session),
                replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
                coordinator: coordinator.clone(),
                resources_dir: PathBuf::new(),
                save_root: PathBuf::new(),
            };

            let first = coordinator
                .flush_session(&app, FlushOperation::ReturnToTitle)
                .await
                .unwrap();
            assert!(matches!(
                first,
                FlushOutcome::Written {
                    session_generation: 3,
                    durable_revision: 1,
                    ..
                }
            ));
            assert_eq!(backend.write_count(), 1);

            {
                let session = app.session.lock().unwrap();
                assert_eq!(session.durable_revision(), Some(1));
                assert_eq!(session.persistence.written_revision, Some(1));
                assert_eq!(
                    session.persistence.autosave_target,
                    Some(SaveSlotRef::Auto { slot: 1 })
                );
            }

            assert_eq!(
                coordinator
                    .flush_session(&app, FlushOperation::ManualSave)
                    .await
                    .unwrap(),
                FlushOutcome::Noop {
                    session_generation: 3,
                    durable_revision: 1,
                }
            );
            assert_eq!(backend.write_count(), 1);
            assert_eq!(app.session.lock().unwrap().durable_revision(), Some(1));
        }

        #[tokio::test(start_paused = true)]
        async fn blocking_flush_cancels_same_revision_debounce_before_it_enters_writer() {
            let backend = Arc::new(RecordingBackend::default());
            let coordinator = SaveCoordinator::with_backend(backend.clone());
            let engine =
                empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
            let mut session = AppSession::installed(engine, 3, None);
            session.engine.as_mut().unwrap().durable_revision = 1;
            let app = AppState {
                session: Mutex::new(session),
                replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
                coordinator: coordinator.clone(),
                resources_dir: PathBuf::new(),
                save_root: PathBuf::new(),
            };

            assert!(coordinator.notify_durable_commit(3, 1).is_some());
            assert!(matches!(
                coordinator
                    .flush_session(&app, FlushOperation::ReturnToTitle)
                    .await
                    .unwrap(),
                FlushOutcome::Written { .. }
            ));
            assert_eq!(backend.write_count(), 1);

            tokio::time::advance(super::super::THUMBNAIL_CAPTURE_TIMEOUT).await;
            for _ in 0..5 {
                tokio::task::yield_now().await;
            }
            assert_eq!(backend.write_count(), 1);
        }
    }

    mod failure_token {
        use super::super::{
            FailureChallengeIdentity, PersistenceBypassOperation, PersistenceFailureTokenView,
            PersistenceHealthView, SaveCoordinator,
        };
        use crate::game::GameError;
        use serde_json::json;
        use uuid::Uuid;

        fn identity<'a>(
            session_generation: u64,
            discovery_generation: Option<u64>,
            durable_revision: u64,
            selected_save_id: Option<&'a str>,
            acquisition_event_id: Option<&'a str>,
        ) -> FailureChallengeIdentity<'a> {
            FailureChallengeIdentity {
                session_generation,
                discovery_generation,
                durable_revision,
                selected_save_id,
                acquisition_event_id,
            }
        }

        fn issue(
            coordinator: &SaveCoordinator,
            operation: PersistenceBypassOperation,
            identity: FailureChallengeIdentity<'_>,
        ) -> (GameError, PersistenceFailureTokenView) {
            let error = coordinator
                .challenge_persistence_failure(operation, identity, GameError::save_write_failed())
                .unwrap();
            let token = serde_json::from_value(json!(error
                .failure_token
                .as_deref()
                .expect("challenge error must carry its opaque token")))
            .unwrap();
            (error, token)
        }

        #[test]
        fn challenge_error_exposes_only_a_canonical_uuid_v4_token_on_the_wire() {
            let coordinator = SaveCoordinator::new();
            let (error, token) = issue(
                &coordinator,
                PersistenceBypassOperation::ReturnWithoutSaving,
                identity(7, None, 11, None, None),
            );
            let value = serde_json::to_value(&error).unwrap();
            let token_wire = value["failureToken"].as_str().unwrap();
            let uuid = Uuid::parse_str(token_wire).unwrap();

            assert_eq!(uuid.get_version_num(), 4);
            assert_eq!(uuid.hyphenated().to_string(), token_wire);
            assert_eq!(serde_json::to_value(&token).unwrap(), json!(token_wire));
            assert_eq!(
                value,
                json!({
                    "code": "saveWriteFailed",
                    "message": "Save could not be written.",
                    "failureToken": token_wire,
                })
            );

            assert_eq!(
                serde_json::to_value(GameError::save_write_failed()).unwrap(),
                json!({
                    "code": "saveWriteFailed",
                    "message": "Save could not be written.",
                })
            );
        }

        #[test]
        fn matching_retry_claim_is_one_shot_and_a_failed_retry_gets_a_new_token() {
            let coordinator = SaveCoordinator::new();
            let current = identity(9, None, 14, Some("save-a"), None);
            let (_, token) = issue(
                &coordinator,
                PersistenceBypassOperation::LoadDiscardingCurrent,
                current,
            );

            let consumed = coordinator
                .consume_failure_token(
                    &token,
                    PersistenceBypassOperation::LoadDiscardingCurrent,
                    current,
                )
                .unwrap();
            assert_eq!(
                consumed.operation,
                PersistenceBypassOperation::LoadDiscardingCurrent
            );
            assert_eq!(
                coordinator
                    .consume_failure_token(
                        &token,
                        PersistenceBypassOperation::LoadDiscardingCurrent,
                        current,
                    )
                    .unwrap_err()
                    .code,
                "stalePersistenceFailureToken"
            );

            let (retry_error, replacement) = issue(
                &coordinator,
                PersistenceBypassOperation::LoadDiscardingCurrent,
                current,
            );
            assert_ne!(
                retry_error.failure_token.as_deref(),
                serde_json::to_value(&token).unwrap().as_str()
            );
            coordinator
                .consume_failure_token(
                    &replacement,
                    PersistenceBypassOperation::LoadDiscardingCurrent,
                    current,
                )
                .unwrap();
        }

        #[test]
        fn exact_identity_rejects_stale_session_revision_discovery_save_and_event() {
            let coordinator = SaveCoordinator::new();
            assert_eq!(coordinator.complete_discovery_attempt().unwrap(), 1);
            assert_eq!(coordinator.complete_discovery_attempt().unwrap(), 2);
            assert_eq!(coordinator.complete_discovery_attempt().unwrap(), 3);
            let operation = PersistenceBypassOperation::ContinueWithoutSaving;
            let exact = identity(5, Some(3), 8, Some("save-a"), Some("acq:8:0"));
            let stale_identities = [
                identity(6, Some(3), 8, Some("save-a"), Some("acq:8:0")),
                identity(5, Some(3), 9, Some("save-a"), Some("acq:8:0")),
                identity(5, Some(4), 8, Some("save-a"), Some("acq:8:0")),
                identity(5, Some(3), 8, Some("save-b"), Some("acq:8:0")),
                identity(5, Some(3), 8, Some("save-a"), Some("acq:8:1")),
            ];

            for stale in stale_identities {
                let (_, token) = issue(&coordinator, operation, exact);
                assert_eq!(
                    coordinator
                        .consume_failure_token(&token, operation, stale)
                        .unwrap_err()
                        .code,
                    "stalePersistenceFailureToken"
                );
            }
        }

        #[test]
        fn wrong_uuid_is_rejected_without_exposing_challenge_fields() {
            let coordinator = SaveCoordinator::new();
            let current = identity(2, None, 4, None, None);
            let (_, issued) = issue(
                &coordinator,
                PersistenceBypassOperation::ExitWithoutSaving,
                current,
            );
            let wrong: PersistenceFailureTokenView =
                serde_json::from_value(json!(Uuid::new_v4().hyphenated().to_string())).unwrap();

            assert_ne!(
                serde_json::to_value(&issued).unwrap(),
                serde_json::to_value(&wrong).unwrap()
            );
            assert_eq!(
                coordinator
                    .consume_failure_token(
                        &wrong,
                        PersistenceBypassOperation::ExitWithoutSaving,
                        current,
                    )
                    .unwrap_err()
                    .code,
                "stalePersistenceFailureToken"
            );
        }

        #[test]
        fn completed_discovery_is_monotonic_and_invalidates_older_global_challenges() {
            let coordinator = SaveCoordinator::new();
            let first = coordinator.complete_discovery_attempt().unwrap();
            let (_, token) = issue(
                &coordinator,
                PersistenceBypassOperation::StartWithoutSaving,
                identity(0, Some(first), 0, None, None),
            );
            let second = coordinator.complete_discovery_attempt().unwrap();

            assert_eq!((first, second), (1, 2));
            assert_eq!(
                coordinator
                    .consume_failure_token(
                        &token,
                        PersistenceBypassOperation::StartWithoutSaving,
                        identity(0, Some(second), 0, None, None),
                    )
                    .unwrap_err()
                    .code,
                "stalePersistenceFailureToken"
            );
        }

        #[test]
        fn typed_without_saving_operations_cannot_consume_each_others_challenges() {
            let coordinator = SaveCoordinator::new();
            assert_eq!(coordinator.complete_discovery_attempt().unwrap(), 1);
            assert_eq!(coordinator.complete_discovery_attempt().unwrap(), 2);
            let current = identity(3, Some(2), 7, Some("save-a"), Some("acq:7:0"));
            let operations = [
                PersistenceBypassOperation::StartWithoutSaving,
                PersistenceBypassOperation::LoadDiscardingCurrent,
                PersistenceBypassOperation::ReturnWithoutSaving,
                PersistenceBypassOperation::ContinueWithoutSaving,
                PersistenceBypassOperation::ExitWithoutSaving,
            ];

            for (index, operation) in operations.into_iter().enumerate() {
                let wrong = operations[(index + 1) % operations.len()];
                let (_, token) = issue(&coordinator, operation, current);
                assert_eq!(
                    coordinator
                        .consume_failure_token(&token, wrong, current)
                        .unwrap_err()
                        .code,
                    "stalePersistenceFailureToken"
                );
            }
        }

        #[test]
        fn cancel_consumes_the_exact_challenge_and_retains_degraded_health() {
            let coordinator = SaveCoordinator::new();
            let operation = PersistenceBypassOperation::ReturnWithoutSaving;
            let current = identity(12, None, 22, None, None);
            let (_, token) = issue(&coordinator, operation, current);

            coordinator
                .cancel_failure_token(&token, operation, current)
                .unwrap();

            assert!(matches!(
                coordinator.persistence_health(),
                PersistenceHealthView::Degraded { .. }
            ));
            assert_eq!(
                coordinator
                    .consume_failure_token(&token, operation, current)
                    .unwrap_err()
                    .code,
                "stalePersistenceFailureToken"
            );
        }

        #[test]
        fn public_commands_and_coordinator_api_expose_no_boolean_data_loss_bypass() {
            let public_commands = include_str!("../../lib.rs");
            let coordinator_api = include_str!("coordinator.rs")
                .split("\n#[cfg(test)]\nmod tests")
                .next()
                .unwrap();

            for forbidden in [
                "force: bool",
                "skip: bool",
                "allow_data_loss: bool",
                "allowDataLoss: bool",
            ] {
                assert!(
                    !public_commands.contains(forbidden),
                    "public Tauri command exposed forbidden bypass `{forbidden}`"
                );
                assert!(
                    !coordinator_api.contains(forbidden),
                    "coordinator API exposed forbidden bypass `{forbidden}`"
                );
            }
        }

        #[test]
        fn authoritative_challenge_identity_stays_private_and_nonserializable() {
            let source = include_str!("coordinator.rs")
                .split("\n#[cfg(test)]\nmod tests")
                .next()
                .unwrap();
            let (before, after) = source
                .split_once("pub(crate) struct PersistenceFailureChallenge {")
                .unwrap();
            let derive = before.rsplit_once("#[derive(").unwrap().1;
            let derive = derive.split_once(")]").unwrap().0;
            assert!(!derive.contains("Serialize"));
            assert!(!derive.contains("Deserialize"));

            let fields = after.split_once("\n}").unwrap().0;
            for field in fields.lines().filter(|line| line.contains(':')) {
                assert!(
                    !field.trim_start().starts_with("pub"),
                    "challenge field escaped the coordinator: {field}"
                );
            }
        }
    }

    mod acknowledgement {
        use super::super::{
            AcknowledgementOutcome, AppSession, FailureChallengeIdentity,
            PersistenceBypassOperation, PersistenceFailureTokenView, PersistenceHealthView,
            SaveCoordinator, ThumbnailCapturePurpose, THUMBNAIL_CAPTURE_TIMEOUT,
        };
        use super::debounce::RecordingBackend;
        use crate::game::save::schema::{AcquisitionEventStateV1, RecordKind, SaveSlotRef};
        use crate::game::schema::EvidenceJson;
        use crate::game::state::EvidenceRecord;
        use crate::game::test_support::{empty_engine_with_scene, investigation_scene_with_intro};
        use crate::AppState;
        use std::path::PathBuf;
        use std::sync::{Arc, Mutex};

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
                session: Mutex::new(AppSession::installed(engine, generation, autosave_target)),
                replacement_gate: Arc::new(tokio::sync::Mutex::new(())),
                coordinator,
                resources_dir: PathBuf::new(),
                save_root: PathBuf::new(),
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
            let app = app_with_event(
                coordinator.clone(),
                34,
                1,
                event_id,
                Some(SaveSlotRef::Auto { slot: 1 }),
            );
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
            let app = app_with_event(
                coordinator.clone(),
                55,
                1,
                event_id,
                Some(SaveSlotRef::Auto { slot: 1 }),
            );
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
    }

    mod debounce {
        use super::super::{
            AutosaveBackend, AutosaveCapture, AutosaveCommitOutcome, AutosavePreparedWrite,
            AutosaveRegisteredIntent, AutosaveWriteJob, AutosaveWriteReceipt,
            BackgroundRetryTrigger, CaptureIntent, CleanupOwner, CoordinatorFuture,
            PersistenceHealthView, SaveCoordinator, ThumbnailActivityView, ThumbnailCapturePurpose,
            AUTOSAVE_DEBOUNCE, THUMBNAIL_CAPTURE_TIMEOUT,
        };
        use crate::game::save::schema::{
            SaveEnvelopeV1, SaveSlotRef, SaveSlotStatusView, SaveSlotView, SaveType,
        };
        use crate::game::test_support::representative_save_envelope;
        use crate::game::GameError;
        use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
        use std::sync::{Arc, Barrier, Mutex};
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

            pub(super) fn write_count(&self) -> usize {
                self.writes.lock().unwrap().len()
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
                if !self.phases.lock().unwrap().contains(&"W:prepare") {
                    self.prepare_started.notified().await;
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

            pub(super) async fn wait_for_receipts(&self, count: usize) {
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
            coordinator
                .record_cleanup_failure(CleanupOwner::Attempt(2), GameError::save_read_failed());

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
            coordinator
                .record_cleanup_failure(receipt_owner.clone(), GameError::save_write_failed());

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
            fail_install_once: Arc<AtomicBool>,
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
            fail_install_once: Arc<AtomicBool>,
        }

        impl StagedAtomicWrite for TrackingStagedWrite {
            fn install(self: Box<Self>) -> io::Result<()> {
                if self.fail_install_once.swap(false, Ordering::SeqCst) {
                    return Err(io::Error::other("injected replacement failure"));
                }
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
                    fail_install_once: Arc::clone(&self.fail_install_once),
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

        pub(super) struct StorageBackend {
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
            pub(super) fn new(session_generation: u64, durable_revision: u64) -> Self {
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

            pub(super) fn pause_after_prepare(&self) {
                self.pause_after_prepare.store(true, Ordering::SeqCst);
            }

            pub(super) async fn wait_for_prepare(&self) {
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

            pub(super) fn release_prepare(&self) {
                self.pause_after_prepare.store(false, Ordering::SeqCst);
                self.prepare_release.notify_waiters();
            }

            pub(super) async fn wait_for_completions(&self, expected: usize) {
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

            pub(super) fn phases(&self) -> Vec<&'static str> {
                self.phases.lock().unwrap().clone()
            }

            pub(super) fn set_current_generation(&self, generation: u64) {
                self.current_generation.store(generation, Ordering::SeqCst);
            }

            pub(super) fn installed_count(&self) -> usize {
                self.fs.installed.load(Ordering::SeqCst)
            }

            pub(super) fn discarded_count(&self) -> usize {
                self.fs.discarded.load(Ordering::SeqCst)
            }

            pub(super) async fn wait_for_discards(&self, expected: usize) {
                self.fs.wait_for_discards(expected).await;
            }

            pub(super) fn observed_required_lock_phases(&self) -> (bool, bool, bool, bool) {
                (
                    self.register_held_session.load(Ordering::SeqCst),
                    self.prepare_held_writer.load(Ordering::SeqCst),
                    self.revalidate_held_gate_and_session.load(Ordering::SeqCst),
                    self.commit_held_writer_and_gate.load(Ordering::SeqCst),
                )
            }

            fn slot_path(&self, slot: u8) -> PathBuf {
                self.root.join(format!("autosave-{slot}.json"))
            }

            pub(super) fn slot_bytes(&self, slot: u8) -> Vec<u8> {
                self.fs.read(&self.slot_path(slot)).unwrap()
            }

            pub(super) fn fail_next_install(&self) {
                self.fs.fail_install_once.store(true, Ordering::SeqCst);
            }

            pub(super) fn fail_next_cleanup_removal(&self) {
                self.fs.fail_remove_once.store(true, Ordering::SeqCst);
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

            pub(super) fn install_old_autosave_with_sidecar(&self) -> PathBuf {
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
