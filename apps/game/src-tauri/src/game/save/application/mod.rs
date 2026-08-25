use super::capture::CapturedCheckpoint;
#[cfg(feature = "e2e")]
use super::e2e_faults::{E2ePersistenceFaultBoundary, E2ePersistenceFaultState};
use super::schema::{
    SaveDiagnosticView, SaveEnvelope, SaveSlotRef, SaveSlotView, SaveType, ThumbnailDescriptorV1,
    ThumbnailDiagnosticView, ThumbnailUnavailableReason,
};
use super::storage::{
    commit_prepared_slot_write, discard_prepared_slot_write, prepare_slot_write, PreparedSlotWrite,
    SaveFilesystem, SlotWriteRequest, ThumbnailWrite,
};
use super::thumbnail::ValidatedThumbnailCandidate;
use crate::game::GameError;
use serde::{Deserialize, Serialize, Serializer};
use std::collections::HashMap;
#[cfg(test)]
use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::Duration;
use tokio::sync::Notify;
use tokio::time::Instant;
use uuid::Uuid;

pub(crate) mod autosave;
pub(crate) mod commands;
pub(crate) mod exit;
pub(crate) mod session;
pub(crate) mod tickets;
pub(crate) use session::{AppSession, SessionTransitionIdentity};

pub(crate) const AUTOSAVE_DEBOUNCE: Duration = Duration::from_millis(500);
pub(crate) const THUMBNAIL_CAPTURE_TIMEOUT: Duration = Duration::from_millis(5000);

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
}

#[derive(Debug, Clone)]
pub(crate) struct ThumbnailCaptureRequestView {
    pub(crate) ticket: String,
    deadline_at: Instant,
}

#[cfg(test)]
impl ThumbnailCaptureRequestView {
    pub(crate) fn deadline_at_for_test(&self) -> Instant {
        self.deadline_at
    }
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
pub(crate) enum ExitStatusView {
    Idle,
    Saving,
    Failed {
        diagnostic: SaveDiagnosticView,
        failure_token: PersistenceFailureTokenView,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExitRequestSource {
    WindowClose,
    ApplicationQuit,
}

pub(crate) trait ApplicationExit: Send + Sync {
    fn exit(&self, code: i32) -> Result<(), GameError>;
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
    pub(crate) job: AutosaveWriteJob,
    slots: Vec<SaveSlotView>,
    checkpoint: Option<CapturedCheckpoint>,
    content_revision: Option<String>,
}

impl AutosaveCapture {
    pub(crate) fn new(job: AutosaveWriteJob, slots: Vec<SaveSlotView>) -> Self {
        Self {
            job,
            slots,
            checkpoint: None,
            content_revision: None,
        }
    }

    pub(crate) fn captured(
        job: AutosaveWriteJob,
        slots: Vec<SaveSlotView>,
        checkpoint: CapturedCheckpoint,
        content_revision: String,
    ) -> Self {
        Self {
            job,
            slots,
            checkpoint: Some(checkpoint),
            content_revision: Some(content_revision),
        }
    }

    pub(crate) fn captured_checkpoint(&self) -> Result<(CapturedCheckpoint, String), GameError> {
        self.checkpoint
            .clone()
            .zip(self.content_revision.clone())
            .ok_or_else(GameError::save_write_failed)
    }

    pub(crate) fn slots(&self) -> &[SaveSlotView] {
        &self.slots
    }

    pub(crate) fn register(
        self,
        target: SaveSlotRef,
        save_id: String,
        mut envelope: SaveEnvelope,
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
}

enum AutosavePreparedStorage {
    Real(Box<PreparedSlotWrite>),
}

pub(crate) struct AutosavePreparedWrite {
    pub(crate) identity: AutosaveWriteReceipt,
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
        let AutosavePreparedStorage::Real(prepared) = self.storage;
        let outcome = commit_prepared_slot_write(fs, root, *prepared)?;
        AutosaveCommittedWrite::from_envelope(
            self.identity,
            &outcome.committed_envelope,
            outcome.cleanup_diagnostic,
        )
    }

    pub(crate) fn discard(self) -> Result<(), GameError> {
        let AutosavePreparedStorage::Real(prepared) = self.storage;
        discard_prepared_slot_write(*prepared)
    }
}

pub(crate) struct AutosaveCommittedWrite {
    receipt: AutosaveWriteReceipt,
    cleanup_diagnostic: Option<GameError>,
}

impl AutosaveCommittedWrite {
    fn from_envelope(
        expected: AutosaveWriteReceipt,
        envelope: &SaveEnvelope,
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

    pub(crate) fn into_parts(self) -> (AutosaveWriteReceipt, Option<GameError>) {
        (self.receipt, self.cleanup_diagnostic)
    }
}

pub(crate) enum AutosaveCommitOutcome {
    Committed(AutosaveCommittedWrite),
    Stale(AutosavePreparedWrite),
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
    Exit,
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

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub(crate) struct PersistenceFailureTokenView(String);

impl PersistenceFailureTokenView {
    #[cfg(test)]
    pub(crate) fn from_error(error: &GameError) -> Result<Self, GameError> {
        error
            .failure_token
            .clone()
            .map(Self)
            .ok_or_else(GameError::stale_persistence_failure_token)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum PersistenceBypassOperation {
    StartWithoutSaving,
    LoadDiscardingCurrent,
    ReturnWithoutSaving,
    ExitWithoutSaving,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PersistenceFailureChallenge {
    token: Uuid,
    operation: PersistenceBypassOperation,
    session_generation: u64,
    discovery_generation: Option<u64>,
    durable_revision: u64,
    selected_save_id: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct FailureChallengeIdentity<'a> {
    session_generation: u64,
    discovery_generation: Option<u64>,
    durable_revision: u64,
    selected_save_id: Option<&'a str>,
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
    }
}

fn selected_save_challenge_key(reference: SaveSlotRef, observed_save_id: &str) -> String {
    let (save_type, slot) = match reference {
        SaveSlotRef::Auto { slot } => ("auto", slot),
        SaveSlotRef::Manual { slot } => ("manual", slot),
    };
    format!("{save_type}:{slot}:{observed_save_id}")
}

pub(crate) type HealthSubscriber = Arc<dyn Fn(PersistenceHealthView) + Send + Sync>;
pub(crate) type ActivitySubscriber = Arc<dyn Fn(ThumbnailActivityView) + Send + Sync>;
pub(crate) type ExitSubscriber = Arc<dyn Fn(ExitStatusView) + Send + Sync>;
#[cfg(test)]
pub(crate) type RetryEligibilityHook = Arc<dyn Fn() + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum CaptureIntent {
    Autosave,
    ManualSave,
}

impl ThumbnailCapturePurpose {
    fn intent(&self) -> CaptureIntent {
        match self {
            Self::Autosave { .. } => CaptureIntent::Autosave,
            Self::ManualSave { .. } => CaptureIntent::ManualSave,
        }
    }

    /// The session generation this capture purpose belongs to. Every variant
    /// carries one so the persistence can reject a stale-generation capture
    /// atomically before issuing its ticket, before `latest_by_intent` /
    /// `tickets` / thumbnail activity are mutated.
    fn session_generation(&self) -> u64 {
        match self {
            Self::Autosave {
                session_generation, ..
            }
            | Self::ManualSave {
                session_generation, ..
            } => *session_generation,
        }
    }
}

pub(crate) struct TicketRecord {
    pub(crate) purpose: ThumbnailCapturePurpose,
    pub(crate) issued_at: Instant,
    pub(crate) deadline_at: Instant,
    pub(crate) terminal: Option<CaptureTerminalResult>,
}

#[derive(Clone)]
pub(crate) struct PendingAutosave {
    pub(crate) session_generation: u64,
    pub(crate) durable_revision: u64,
    pub(crate) ticket: String,
    pub(crate) purpose: ThumbnailCapturePurpose,
    pub(crate) thumbnail_capture_required: bool,
    pub(crate) debounce_deadline: Instant,
    pub(crate) capture_deadline: Instant,
}

#[derive(Clone)]
pub(crate) struct BackgroundWriteFailure {
    pub(crate) identity: (u64, u64),
    pub(crate) diagnostic: GameError,
    pub(crate) thumbnail_capture_required: bool,
}

enum RetryEligibility {
    Proceed,
    Ignore,
    Retire {
        health: PersistenceHealthView,
        subscribers: Vec<HealthSubscriber>,
    },
}

#[derive(Clone)]
pub(crate) struct CleanupFailure {
    pub(crate) diagnostic: GameError,
}

pub(crate) enum FailureTokenSource {
    Random,
    #[cfg(test)]
    Deterministic(VecDeque<Uuid>),
}

impl FailureTokenSource {
    fn next(&mut self) -> Uuid {
        match self {
            Self::Random => Uuid::new_v4(),
            #[cfg(test)]
            Self::Deterministic(tokens) => tokens
                .pop_front()
                .expect("deterministic failure-token source exhausted"),
        }
    }
}

pub(super) struct PersistenceState {
    pub(crate) tickets: HashMap<String, TicketRecord>,
    pub(crate) latest_by_intent: HashMap<CaptureIntent, String>,
    pub(crate) persistence_health: PersistenceHealthView,
    pub(crate) thumbnail_activity: ThumbnailActivityView,
    pub(crate) health_subscribers: Vec<HealthSubscriber>,
    pub(crate) activity_subscribers: Vec<ActivitySubscriber>,
    pub(crate) exit_subscribers: Vec<ExitSubscriber>,
    pub(crate) next_session_generation: u64,
    pub(crate) discovery_generation: u64,
    pub(crate) pending_autosave: Option<PendingAutosave>,
    pub(crate) last_successful_write: Option<AutosaveWriteReceipt>,
    pub(crate) failed_write: Option<BackgroundWriteFailure>,
    pub(crate) cleanup_failure: Option<CleanupFailure>,
    pub(crate) failure_challenges: HashMap<Uuid, PersistenceFailureChallenge>,
    pub(crate) failure_token_source: FailureTokenSource,
    pub(crate) exit_status: ExitStatusView,
    pub(crate) programmatic_exit_bypass: bool,
    pub(crate) exit_action_in_progress: bool,
}

impl Default for PersistenceState {
    fn default() -> Self {
        Self {
            tickets: HashMap::new(),
            latest_by_intent: HashMap::new(),
            persistence_health: PersistenceHealthView::Healthy,
            thumbnail_activity: ThumbnailActivityView::Idle,
            health_subscribers: Vec::new(),
            activity_subscribers: Vec::new(),
            exit_subscribers: Vec::new(),
            next_session_generation: 0,
            discovery_generation: 0,
            pending_autosave: None,
            last_successful_write: None,
            failed_write: None,
            cleanup_failure: None,
            failure_challenges: HashMap::new(),
            failure_token_source: FailureTokenSource::Random,
            exit_status: ExitStatusView::Idle,
            programmatic_exit_bypass: false,
            exit_action_in_progress: false,
        }
    }
}

impl PersistenceState {
    fn reserve_failure_challenge(
        &mut self,
        operation: PersistenceBypassOperation,
        identity: FailureChallengeIdentity<'_>,
    ) -> Uuid {
        loop {
            let token = self.failure_token_source.next();
            match self.failure_challenges.entry(token) {
                std::collections::hash_map::Entry::Vacant(entry) => {
                    entry.insert(PersistenceFailureChallenge {
                        token,
                        operation,
                        session_generation: identity.session_generation,
                        discovery_generation: identity.discovery_generation,
                        durable_revision: identity.durable_revision,
                        selected_save_id: identity.selected_save_id.map(str::to_owned),
                    });
                    return token;
                }
                std::collections::hash_map::Entry::Occupied(_) => {}
            }
        }
    }
}

struct ExitArmSnapshot {
    status: ExitStatusView,
    exit_flush_requested: bool,
    programmatic_exit_bypass: bool,
    exit_action_in_progress: bool,
}

struct ExitAttemptRecovery {
    arm: ExitArmSnapshot,
    consumed_failure_challenge: Option<PersistenceFailureChallenge>,
}

struct ExitFailureNotification {
    status: ExitStatusView,
    health: PersistenceHealthView,
    exit_subscribers: Vec<ExitSubscriber>,
    health_subscribers: Vec<HealthSubscriber>,
}

impl ExitFailureNotification {
    fn publish(self) {
        publish_health(&self.health_subscribers, &self.health);
        publish_exit(&self.exit_subscribers, &self.status);
    }
}

#[derive(Clone)]
pub(crate) struct ApplicationPersistence {
    pub(crate) session: Arc<Mutex<AppSession>>,
    pub(crate) operation_gate: Arc<tokio::sync::Mutex<()>>,
    pub(crate) fs: Arc<dyn SaveFilesystem>,
    pub(crate) root: std::path::PathBuf,
    pub(crate) discovery: Arc<super::storage::SaveDiscoveryContext>,
    pub(crate) last_saved_at: Arc<Mutex<Option<chrono::DateTime<chrono::Utc>>>>,
    pub(crate) availability_error: Arc<Mutex<Option<GameError>>>,
    state: Arc<Mutex<PersistenceState>>,
    ticket_updates: Arc<Notify>,
    exit_transition: Arc<Mutex<()>>,
    fail_next_exit_prerequisite: Arc<AtomicBool>,
    fail_next_cancel_guard_clear: Arc<AtomicBool>,
    fail_next_exit_challenge: Arc<AtomicBool>,
    #[cfg(test)]
    retry_after_eligibility_hook: Arc<Mutex<Option<RetryEligibilityHook>>>,
    #[cfg(feature = "e2e")]
    pub(crate) e2e_persistence_faults: Arc<E2ePersistenceFaultState>,
}

struct ExitAttemptRecoveryGuard {
    persistence: ApplicationPersistence,
    recovery: Option<ExitAttemptRecovery>,
}

impl ExitAttemptRecoveryGuard {
    fn new(persistence: ApplicationPersistence, recovery: ExitAttemptRecovery) -> Self {
        Self {
            persistence,
            recovery: Some(recovery),
        }
    }

    fn disarm(&mut self) {
        self.recovery = None;
    }
}

impl Drop for ExitAttemptRecoveryGuard {
    fn drop(&mut self) {
        let Some(recovery) = self.recovery.take() else {
            return;
        };
        // A task cancellation or in-process panic drops this guard
        // synchronously. Recovery obeys the same transition -> S -> state lock
        // order as every other exit transition and never awaits.
        let persistence = self.persistence.clone();
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = persistence.restore_exit_attempt(recovery);
        }));
    }
}

impl ApplicationPersistence {
    #[cfg(test)]
    pub(crate) fn new() -> Self {
        let (_resources, resources_dir) =
            crate::game::test_support::save_capture_fixture_resources();
        let definitions = std::sync::Arc::new(
            super::restore::load_current_definitions(&resources_dir).expect("test definitions"),
        );
        Self::from_parts(
            Arc::new(Mutex::new(AppSession::empty())),
            Arc::new(tokio::sync::Mutex::new(())),
            Arc::new(super::storage::ProductionSaveFilesystem),
            std::path::PathBuf::new(),
            super::storage::SaveDiscoveryContext {
                resources_dir,
                definitions,
            },
            None,
        )
    }

    pub(crate) fn from_parts(
        session: Arc<Mutex<AppSession>>,
        operation_gate: Arc<tokio::sync::Mutex<()>>,
        fs: Arc<dyn SaveFilesystem>,
        root: std::path::PathBuf,
        discovery: super::storage::SaveDiscoveryContext,
        availability_error: Option<GameError>,
    ) -> Self {
        Self {
            session,
            operation_gate,
            fs,
            root,
            discovery: Arc::new(discovery),
            last_saved_at: Arc::new(Mutex::new(None)),
            availability_error: Arc::new(Mutex::new(availability_error)),
            state: Arc::new(Mutex::new(PersistenceState::default())),
            ticket_updates: Arc::new(Notify::new()),
            exit_transition: Arc::new(Mutex::new(())),
            fail_next_exit_prerequisite: Arc::new(AtomicBool::new(false)),
            fail_next_cancel_guard_clear: Arc::new(AtomicBool::new(false)),
            fail_next_exit_challenge: Arc::new(AtomicBool::new(false)),
            #[cfg(test)]
            retry_after_eligibility_hook: Arc::new(Mutex::new(None)),
            #[cfg(feature = "e2e")]
            e2e_persistence_faults: Arc::new(E2ePersistenceFaultState::new()),
        }
    }
}

impl ApplicationPersistence {
    pub(crate) async fn discover(&self) -> super::schema::SaveBrowserView {
        let layout = {
            let _gate = self.operation_gate.lock().await;
            super::storage::ensure_save_layout(self.fs.as_ref(), &self.root)
        };
        self.discover_after_layout(layout)
    }

    /// Discover while the caller already owns `operation_gate`.
    ///
    /// Tokio's mutex is not reentrant, so storage paths that hold the gate
    /// across capture and staging must use this path instead of `discover`.
    pub(crate) fn discover_under_operation_gate(&self) -> super::schema::SaveBrowserView {
        self.discover_after_layout(super::storage::ensure_save_layout(
            self.fs.as_ref(),
            &self.root,
        ))
    }

    fn discover_after_layout(
        &self,
        layout: Result<(), GameError>,
    ) -> super::schema::SaveBrowserView {
        if let Err(error) = layout {
            if let Ok(mut availability) = self.availability_error.lock() {
                *availability = Some(error);
            }
            return crate::unavailable_save_browser();
        }
        let browser = super::storage::discover_saves(self.fs.as_ref(), &self.root, &self.discovery);
        if let Ok(mut availability) = self.availability_error.lock() {
            *availability = match &browser.discovery {
                super::schema::SaveDiscoveryStatusView::Available => None,
                super::schema::SaveDiscoveryStatusView::Loading => {
                    Some(GameError::save_discovery_unavailable())
                }
                super::schema::SaveDiscoveryStatusView::Unavailable { diagnostic } => {
                    Some(diagnostic.clone())
                }
            };
        }
        browser
    }

    pub(crate) fn availability_error(&self) -> Option<GameError> {
        self.availability_error
            .lock()
            .ok()
            .and_then(|error| error.clone())
    }

    fn next_saved_at(&self) -> Result<String, GameError> {
        let mut last = self
            .last_saved_at
            .lock()
            .map_err(|_| GameError::save_write_failed())?;
        let now = chrono::Utc::now();
        let next = last
            .as_ref()
            .map(|previous| now.max(*previous + chrono::Duration::nanoseconds(1)))
            .unwrap_or(now);
        *last = Some(next);
        Ok(next.to_rfc3339_opts(chrono::SecondsFormat::Nanos, true))
    }

    pub(crate) fn envelope(
        &self,
        checkpoint: CapturedCheckpoint,
        content_revision: String,
        reference: SaveSlotRef,
        save_id: String,
        display_name: String,
    ) -> Result<SaveEnvelope, GameError> {
        let (save_type, slot) = match reference {
            SaveSlotRef::Auto { slot } => (SaveType::Auto, slot),
            SaveSlotRef::Manual { slot } => (SaveType::Manual, slot),
        };
        Ok(SaveEnvelope {
            schema_version: super::schema::SAVE_SCHEMA_VERSION,
            content_revision,
            save_id,
            save_type,
            slot,
            saved_at: self.next_saved_at()?,
            display_name,
            thumbnail: ThumbnailDescriptorV1::Unavailable,
            summary: checkpoint.summary,
            snapshot: checkpoint.snapshot,
        })
    }

    pub(crate) async fn run_storage_write_if_session_current<T, F>(
        &self,
        session_generation: u64,
        write: F,
    ) -> Result<T, GameError>
    where
        T: Send,
        F: FnOnce(&dyn SaveFilesystem, &std::path::Path) -> Result<T, GameError> + Send,
    {
        let _gate = self.operation_gate.lock().await;
        let current = self
            .session
            .lock()
            .map_err(|_| GameError::unavailable())?
            .persistence
            .generation
            == session_generation;
        if !current {
            return Err(GameError::stale_session_generation());
        }
        write(self.fs.as_ref(), &self.root)
    }

    pub(crate) fn commit_current(
        &self,
        prepared: AutosavePreparedWrite,
    ) -> Result<AutosaveCommitOutcome, GameError> {
        let current = {
            let session = self.session.lock().map_err(|_| GameError::unavailable())?;
            session.persistence.generation == prepared.session_generation()
                && session.durable_revision() == Some(prepared.durable_revision())
        };
        if !current {
            return Ok(AutosaveCommitOutcome::Stale(prepared));
        }
        prepared
            .commit(self.fs.as_ref(), &self.root)
            .map(AutosaveCommitOutcome::Committed)
    }

    #[cfg(feature = "e2e")]
    pub(crate) fn with_e2e_persistence_faults(
        mut self,
        faults: Arc<E2ePersistenceFaultState>,
    ) -> Self {
        self.e2e_persistence_faults = faults;
        self
    }

    #[cfg(feature = "e2e")]
    pub(crate) fn arm_e2e_persistence_fault(
        &self,
        boundary: E2ePersistenceFaultBoundary,
        occurrence_count: u8,
    ) -> Result<(), GameError> {
        self.e2e_persistence_faults.arm(boundary, occurrence_count)
    }

    #[cfg(feature = "e2e")]
    pub(crate) fn reset_e2e_replacement_controls(&self) {
        self.e2e_persistence_faults.reset();
        self.fail_next_exit_prerequisite
            .store(false, Ordering::SeqCst);
        self.fail_next_cancel_guard_clear
            .store(false, Ordering::SeqCst);
        self.fail_next_exit_challenge.store(false, Ordering::SeqCst);
    }

    pub(crate) fn next_session_generation(&self) -> Result<u64, GameError> {
        let mut state = self.lock_state()?;
        state.next_session_generation = state
            .next_session_generation
            .checked_add(1)
            .ok_or_else(GameError::save_write_failed)?;
        Ok(state.next_session_generation)
    }

    pub(crate) fn transition_identity(
        &self,
        app: &crate::AppState,
    ) -> Result<SessionTransitionIdentity, GameError> {
        let session = app.session.lock().map_err(|_| GameError::unavailable())?;
        session.ensure_persistence_available()?;
        Ok(SessionTransitionIdentity {
            generation: session.persistence.generation,
            durable_revision: session.durable_revision(),
        })
    }

    pub(crate) fn complete_discovery_attempt(&self) -> Result<u64, GameError> {
        let mut state = self.lock_state()?;
        Self::complete_discovery_attempt_locked(&mut state)
    }

    pub(crate) fn complete_discovery_attempt_for_session(
        &self,
        session_generation: u64,
    ) -> Result<u64, GameError> {
        let mut state = self.lock_state()?;
        if state.next_session_generation != session_generation {
            return Err(GameError::stale_session_generation());
        }
        Self::complete_discovery_attempt_locked(&mut state)
    }

    fn complete_discovery_attempt_locked(state: &mut PersistenceState) -> Result<u64, GameError> {
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
        let health = PersistenceHealthView::Degraded {
            diagnostic: diagnostic.clone(),
        };
        let (token_wire, subscribers) = {
            let mut state = self.lock_state()?;
            if identity
                .discovery_generation
                .is_some_and(|generation| generation != state.discovery_generation)
            {
                return Err(GameError::stale_persistence_failure_token());
            }
            let token = state.reserve_failure_challenge(operation, identity);
            (
                token.hyphenated().to_string(),
                set_persistence_health(&mut state, health.clone()),
            )
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
        self.consume_failure_token_matching(token, expected, current, None)
    }

    fn consume_failure_token_matching(
        &self,
        token: &PersistenceFailureTokenView,
        expected: PersistenceBypassOperation,
        current: FailureChallengeIdentity<'_>,
        alternate: Option<FailureChallengeIdentity<'_>>,
    ) -> Result<PersistenceFailureChallenge, GameError> {
        let parsed = Uuid::parse_str(&token.0)
            .ok()
            .filter(|parsed| parsed.hyphenated().to_string() == token.0)
            .ok_or_else(GameError::stale_persistence_failure_token)?;
        let mut state = self.lock_state()?;
        let challenge = state
            .failure_challenges
            .get(&parsed)
            .cloned()
            .ok_or_else(GameError::stale_persistence_failure_token)?;
        if !challenge.matches(parsed, expected, current, state.discovery_generation)
            && !alternate.is_some_and(|identity| {
                challenge.matches(parsed, expected, identity, state.discovery_generation)
            })
        {
            return Err(GameError::stale_persistence_failure_token());
        }
        state
            .failure_challenges
            .remove(&parsed)
            .ok_or_else(GameError::stale_persistence_failure_token)
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

    pub(crate) async fn cancel_persistence_failure(
        &self,
        app: &crate::AppState,
        token: PersistenceFailureTokenView,
    ) -> Result<(), GameError> {
        let _gate = self.operation_gate.lock().await;
        let parsed = Uuid::parse_str(&token.0)
            .ok()
            .filter(|parsed| parsed.hyphenated().to_string() == token.0)
            .ok_or_else(GameError::stale_persistence_failure_token)?;
        let challenge = self
            .lock_state()?
            .failure_challenges
            .get(&parsed)
            .cloned()
            .ok_or_else(GameError::stale_persistence_failure_token)?;
        match challenge.operation {
            PersistenceBypassOperation::StartWithoutSaving
            | PersistenceBypassOperation::LoadDiscardingCurrent
            | PersistenceBypassOperation::ReturnWithoutSaving => {}
            PersistenceBypassOperation::ExitWithoutSaving => {
                return Err(GameError::stale_persistence_failure_token());
            }
        }
        let identity = self.transition_identity(app)?;
        let current = FailureChallengeIdentity {
            session_generation: identity.generation,
            discovery_generation: challenge.discovery_generation,
            durable_revision: identity.durable_revision.unwrap_or(0),
            selected_save_id: challenge.selected_save_id.as_deref(),
        };
        self.cancel_failure_token(&token, challenge.operation, current)
    }

    pub(crate) fn challenge_current_session_failure(
        &self,
        app: &crate::AppState,
        operation: PersistenceBypassOperation,
        discovery_generation: Option<u64>,
        diagnostic: GameError,
    ) -> Result<(GameError, PersistenceFailureTokenView), GameError> {
        let (session_generation, durable_revision) = {
            let session = app.session.lock().map_err(|_| GameError::unavailable())?;
            session.ensure_persistence_available()?;
            (
                session.persistence.generation,
                session.durable_revision().unwrap_or(0),
            )
        };
        let mut challenged = self.challenge_persistence_failure(
            operation,
            FailureChallengeIdentity {
                session_generation,
                discovery_generation,
                durable_revision,
                selected_save_id: None,
            },
            diagnostic,
        )?;
        let token = challenged
            .failure_token
            .take()
            .map(PersistenceFailureTokenView)
            .ok_or_else(GameError::stale_persistence_failure_token)?;
        Ok((challenged, token))
    }

    pub(crate) fn challenge_current_session_error(
        &self,
        app: &crate::AppState,
        operation: PersistenceBypassOperation,
        diagnostic: GameError,
    ) -> Result<GameError, GameError> {
        let identity = self.transition_identity(app)?;
        self.challenge_persistence_failure(
            operation,
            FailureChallengeIdentity {
                session_generation: identity.generation,
                discovery_generation: None,
                durable_revision: identity.durable_revision.unwrap_or(0),
                selected_save_id: None,
            },
            diagnostic,
        )
    }

    pub(crate) fn challenge_current_discovery_failure(
        &self,
        app: &crate::AppState,
        operation: PersistenceBypassOperation,
        diagnostic: GameError,
    ) -> Result<GameError, GameError> {
        let identity = self.transition_identity(app)?;
        let discovery_generation = self
            .state
            .lock()
            .map_err(|_| GameError::save_discovery_unavailable())?
            .discovery_generation;
        self.challenge_persistence_failure(
            operation,
            FailureChallengeIdentity {
                session_generation: identity.generation,
                discovery_generation: Some(discovery_generation),
                durable_revision: identity.durable_revision.unwrap_or(0),
                selected_save_id: None,
            },
            diagnostic,
        )
    }

    pub(crate) fn challenge_current_selected_save_failure(
        &self,
        app: &crate::AppState,
        operation: PersistenceBypassOperation,
        reference: SaveSlotRef,
        observed_save_id: &str,
        diagnostic: GameError,
    ) -> Result<GameError, GameError> {
        let identity = self.transition_identity(app)?;
        let discovery_generation = self
            .state
            .lock()
            .map_err(|_| GameError::save_discovery_unavailable())?
            .discovery_generation;
        let selected_save_id = selected_save_challenge_key(reference, observed_save_id);
        self.challenge_persistence_failure(
            operation,
            FailureChallengeIdentity {
                session_generation: identity.generation,
                discovery_generation: Some(discovery_generation),
                durable_revision: identity.durable_revision.unwrap_or(0),
                selected_save_id: Some(&selected_save_id),
            },
            diagnostic,
        )
    }

    pub(crate) fn consume_current_discovery_failure(
        &self,
        app: &crate::AppState,
        token: &PersistenceFailureTokenView,
        operation: PersistenceBypassOperation,
    ) -> Result<SessionTransitionIdentity, GameError> {
        let identity = self.transition_identity(app)?;
        let discovery_generation = self
            .state
            .lock()
            .map_err(|_| GameError::save_discovery_unavailable())?
            .discovery_generation;
        self.consume_failure_token(
            token,
            operation,
            FailureChallengeIdentity {
                session_generation: identity.generation,
                discovery_generation: Some(discovery_generation),
                durable_revision: identity.durable_revision.unwrap_or(0),
                selected_save_id: None,
            },
        )?;
        Ok(identity)
    }

    pub(crate) fn consume_current_start_without_saving_failure(
        &self,
        app: &crate::AppState,
        token: &PersistenceFailureTokenView,
    ) -> Result<SessionTransitionIdentity, GameError> {
        let identity = self.transition_identity(app)?;
        let discovery_generation = self
            .state
            .lock()
            .map_err(|_| GameError::save_discovery_unavailable())?
            .discovery_generation;
        let session_identity = FailureChallengeIdentity {
            session_generation: identity.generation,
            discovery_generation: None,
            durable_revision: identity.durable_revision.unwrap_or(0),
            selected_save_id: None,
        };
        let discovery_identity = FailureChallengeIdentity {
            discovery_generation: Some(discovery_generation),
            ..session_identity
        };
        self.consume_failure_token_matching(
            token,
            PersistenceBypassOperation::StartWithoutSaving,
            session_identity,
            Some(discovery_identity),
        )?;
        Ok(identity)
    }

    pub(crate) fn consume_current_selected_save_failure(
        &self,
        app: &crate::AppState,
        token: &PersistenceFailureTokenView,
        operation: PersistenceBypassOperation,
        reference: SaveSlotRef,
        observed_save_id: &str,
    ) -> Result<SessionTransitionIdentity, GameError> {
        let identity = self.transition_identity(app)?;
        let discovery_generation = self
            .state
            .lock()
            .map_err(|_| GameError::save_discovery_unavailable())?
            .discovery_generation;
        let selected_save_id = selected_save_challenge_key(reference, observed_save_id);
        let challenge_identity = FailureChallengeIdentity {
            session_generation: identity.generation,
            discovery_generation: Some(discovery_generation),
            durable_revision: identity.durable_revision.unwrap_or(0),
            selected_save_id: Some(&selected_save_id),
        };
        let generic_browser_identity = FailureChallengeIdentity {
            selected_save_id: None,
            ..challenge_identity
        };
        self.consume_failure_token_matching(
            token,
            operation,
            challenge_identity,
            Some(generic_browser_identity),
        )?;
        Ok(identity)
    }

    pub(crate) fn consume_current_session_failure(
        &self,
        app: &crate::AppState,
        token: &PersistenceFailureTokenView,
        operation: PersistenceBypassOperation,
    ) -> Result<SessionTransitionIdentity, GameError> {
        let identity = self.transition_identity(app)?;
        self.consume_failure_token(
            token,
            operation,
            FailureChallengeIdentity {
                session_generation: identity.generation,
                discovery_generation: None,
                durable_revision: identity.durable_revision.unwrap_or(0),
                selected_save_id: None,
            },
        )?;
        Ok(identity)
    }

    fn lock_state(&self) -> Result<MutexGuard<'_, PersistenceState>, GameError> {
        self.state
            .lock()
            .map_err(|_| GameError::save_write_failed())
    }

    #[cfg(test)]
    pub(crate) fn ticket_only() -> Self {
        Self::new()
    }

    #[cfg(test)]
    pub(crate) fn set_retry_after_eligibility_hook(&self, hook: RetryEligibilityHook) {
        *self.retry_after_eligibility_hook.lock().unwrap() = Some(hook);
    }

    #[cfg(test)]
    fn run_retry_after_eligibility_hook_for_test(&self) {
        let hook = self.retry_after_eligibility_hook.lock().unwrap().take();
        if let Some(hook) = hook {
            hook();
        }
    }

    #[cfg(test)]
    pub(crate) fn fail_next_exit_prerequisite_for_test(&self) {
        self.fail_next_exit_prerequisite
            .store(true, Ordering::SeqCst);
    }

    #[cfg(test)]
    pub(crate) fn fail_next_cancel_guard_clear_for_test(&self) {
        self.fail_next_cancel_guard_clear
            .store(true, Ordering::SeqCst);
    }

    #[cfg(test)]
    pub(crate) fn fail_next_exit_challenge_for_test(&self) {
        self.fail_next_exit_challenge.store(true, Ordering::SeqCst);
    }

    #[cfg(test)]
    pub(crate) fn pending_autosave_for_test(
        &self,
        ticket: String,
        capture_deadline: Instant,
    ) -> Result<PendingAutosave, GameError> {
        let mut state = self.lock_state()?;
        let pending = PendingAutosave {
            session_generation: 1,
            durable_revision: 1,
            ticket,
            purpose: ThumbnailCapturePurpose::Autosave {
                session_generation: 1,
                durable_revision: 1,
            },
            thumbnail_capture_required: true,
            debounce_deadline: Instant::now() + AUTOSAVE_DEBOUNCE,
            capture_deadline,
        };
        state.pending_autosave = Some(pending.clone());
        Ok(pending)
    }

    #[cfg(test)]
    pub(crate) fn ticket_deadline(&self, ticket: &str) -> Result<Instant, GameError> {
        self.lock_state()?
            .tickets
            .get(ticket)
            .map(|record| record.deadline_at)
            .ok_or_else(GameError::stale_thumbnail_ticket)
    }

    #[cfg(test)]
    pub(crate) fn ticket_issued_at(&self, ticket: &str) -> Result<Instant, GameError> {
        self.lock_state()?
            .tickets
            .get(ticket)
            .map(|record| record.issued_at)
            .ok_or_else(GameError::stale_thumbnail_ticket)
    }
}

pub(super) fn pending_matches_identity(left: &PendingAutosave, right: &PendingAutosave) -> bool {
    left.session_generation == right.session_generation
        && left.durable_revision == right.durable_revision
        && left.ticket == right.ticket
}

fn remaining_timeout_ms(deadline_at: Instant, now: Instant) -> u32 {
    deadline_at
        .checked_duration_since(now)
        .unwrap_or(Duration::ZERO)
        .as_millis()
        .min(u128::from(u32::MAX)) as u32
}

fn live_record_mut<'a>(
    state: &'a mut PersistenceState,
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

pub(super) fn capture_unavailable_activity() -> ThumbnailActivityView {
    ThumbnailActivityView::Unavailable {
        diagnostic: ThumbnailDiagnosticView {
            reason: ThumbnailUnavailableReason::CaptureUnavailable,
            message: "Thumbnail capture is unavailable.".into(),
            retryable: false,
        },
    }
}

pub(super) fn health_after_completion(state: &PersistenceState) -> PersistenceHealthView {
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

fn retry_eligibility(state: &mut PersistenceState, identity: (u64, u64)) -> RetryEligibility {
    let Some(failure) = state.failed_write.as_ref() else {
        return RetryEligibility::Ignore;
    };
    if failure.identity != identity {
        return RetryEligibility::Ignore;
    }
    let superseded_by_pending = state.pending_autosave.as_ref().is_some_and(|pending| {
        pending.session_generation == identity.0 && pending.durable_revision > identity.1
    });
    let superseded_by_success = state.last_successful_write.as_ref().is_some_and(|receipt| {
        receipt.session_generation == identity.0 && receipt.durable_revision >= identity.1
    });
    if !superseded_by_pending && !superseded_by_success {
        return RetryEligibility::Proceed;
    }
    state.failed_write = None;
    let health = health_after_completion(state);
    let subscribers = set_persistence_health(state, health.clone());
    RetryEligibility::Retire {
        health,
        subscribers,
    }
}

pub(super) fn set_persistence_health(
    state: &mut PersistenceState,
    view: PersistenceHealthView,
) -> Vec<HealthSubscriber> {
    state.persistence_health = view;
    state.health_subscribers.clone()
}

pub(crate) fn publish_health(subscribers: &[HealthSubscriber], view: &PersistenceHealthView) {
    for subscriber in subscribers {
        subscriber(view.clone());
    }
}

pub(super) fn set_thumbnail_activity(
    state: &mut PersistenceState,
    view: ThumbnailActivityView,
) -> Vec<ActivitySubscriber> {
    state.thumbnail_activity = view;
    state.activity_subscribers.clone()
}

fn clear_thumbnail_activity_if_no_live_capture(
    state: &mut PersistenceState,
) -> (Vec<ActivitySubscriber>, Option<ThumbnailActivityView>) {
    let has_live_capture = state
        .tickets
        .values()
        .any(|record| record.terminal.is_none());
    if has_live_capture || state.thumbnail_activity == ThumbnailActivityView::Idle {
        return (Vec::new(), None);
    }
    let view = ThumbnailActivityView::Idle;
    (set_thumbnail_activity(state, view.clone()), Some(view))
}

pub(crate) fn publish_activity(subscribers: &[ActivitySubscriber], view: &ThumbnailActivityView) {
    for subscriber in subscribers {
        subscriber(view.clone());
    }
}

pub(crate) fn publish_exit(subscribers: &[ExitSubscriber], view: &ExitStatusView) {
    for subscriber in subscribers {
        subscriber(view.clone());
    }
}

async fn thumbnail_ticket_expiry_task(
    state: Weak<Mutex<PersistenceState>>,
    ticket: String,
    deadline_at: Instant,
    updates: Weak<Notify>,
) {
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
}

#[cfg(test)]
mod tests {
    mod autosave;
    mod commands;
    mod exit;
    mod failure_token;
    mod flush;
    mod helpers;
    mod serialization;
    mod session;
    mod tickets;
    mod units;
}
