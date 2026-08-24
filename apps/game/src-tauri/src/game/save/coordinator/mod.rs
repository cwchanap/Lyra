pub(crate) use super::application::session::SessionTransitionIdentity;
pub(crate) use super::application::{AppSession, ApplicationPersistence};
use super::capture::CapturedCheckpoint;
#[cfg(feature = "e2e")]
use super::e2e_faults::{E2ePersistenceFaultBoundary, E2ePersistenceFaultState};
use super::schema::{
    SaveDiagnosticView, SaveEnvelope, SaveSlotRef, SaveSlotView, SaveType, ThumbnailDescriptorV1,
    ThumbnailDiagnosticView, ThumbnailUnavailableReason,
};
use super::storage::{
    commit_prepared_slot_write, discard_prepared_slot_write, prepare_slot_write,
    select_autosave_target, PreparedSlotWrite, SaveFilesystem, SlotWriteRequest, ThumbnailWrite,
};
use super::thumbnail::ValidatedThumbnailCandidate;
use crate::game::{GameEngine, GameError};
use serde::{Deserialize, Serialize, Serializer};
use std::collections::HashMap;
#[cfg(test)]
use std::collections::VecDeque;
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

#[cfg(all(test, feature = "e2e"))]
mod e2e_fault_boundary_tests {
    use super::{AppSession, PendingAutosave, SaveCoordinator, ThumbnailCapturePurpose};
    use crate::game::save::e2e_faults::E2ePersistenceFaultBoundary;
    use crate::game::test_support::{empty_engine_with_scene, investigation_scene_with_intro};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tokio::time::Instant;

    #[tokio::test]
    async fn exit_flush_fault_cancels_pending_autosave_before_failing() {
        let mut engine =
            empty_engine_with_scene(investigation_scene_with_intro("scene", vec![]), 1);
        engine.durable_revision = 4;
        let session = Arc::new(Mutex::new(AppSession::installed(engine, 4, None)));
        session
            .lock()
            .unwrap()
            .engine
            .as_mut()
            .unwrap()
            .durable_revision = 5;
        let coordinator = SaveCoordinator::for_application(
            Arc::clone(&session),
            Arc::new(tokio::sync::Mutex::new(())),
        );
        let purpose = ThumbnailCapturePurpose::Autosave {
            session_generation: 4,
            durable_revision: 5,
        };
        let capture = coordinator.prepare_thumbnail(purpose.clone()).unwrap();
        {
            let mut state = coordinator.state.lock().unwrap();
            state.next_autosave_serial = 1;
            state.pending_autosave = Some(PendingAutosave {
                serial: 1,
                session_generation: 4,
                durable_revision: 5,
                ticket: capture.ticket,
                purpose,
                thumbnail_capture_required: true,
                debounce_deadline: Instant::now() + Duration::from_secs(30),
                capture_deadline: Instant::now() + Duration::from_secs(30),
            });
        }
        session.lock().unwrap().persistence.exit_flush_requested = true;

        coordinator
            .arm_e2e_persistence_fault(E2ePersistenceFaultBoundary::ExitFlush, 1)
            .unwrap();

        let error = coordinator.flush_for_exit().await.unwrap_err();

        assert_eq!(error.code, "saveWriteFailed");
        assert!(coordinator.state.lock().unwrap().pending_autosave.is_none());
        assert!(coordinator
            .e2e_persistence_faults
            .fire(E2ePersistenceFaultBoundary::ExitFlush)
            .is_ok());
    }
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

    #[cfg(test)]
    pub(crate) fn prepare_simulated(self) -> AutosavePreparedWrite {
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
    pub(crate) fn commit_simulated(self) -> AutosaveCommittedWrite {
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
    /// carries one so the coordinator can reject a stale-generation capture
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
    pub(crate) serial: u64,
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

#[derive(Clone, PartialEq, Eq)]
pub(crate) enum CleanupOwner {
    Receipt(AutosaveWriteReceipt),
    Attempt(u64),
}

#[derive(Clone)]
pub(crate) struct CleanupFailure {
    pub(crate) owner: CleanupOwner,
    diagnostic: GameError,
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

pub(crate) struct CoordinatorState {
    pub(crate) tickets: HashMap<String, TicketRecord>,
    pub(crate) latest_by_intent: HashMap<CaptureIntent, String>,
    pub(crate) persistence_health: PersistenceHealthView,
    pub(crate) thumbnail_activity: ThumbnailActivityView,
    pub(crate) health_subscribers: Vec<HealthSubscriber>,
    pub(crate) activity_subscribers: Vec<ActivitySubscriber>,
    pub(crate) exit_subscribers: Vec<ExitSubscriber>,
    pub(crate) next_session_generation: u64,
    pub(crate) discovery_generation: u64,
    pub(crate) next_autosave_serial: u64,
    pub(crate) next_cleanup_attempt: u64,
    pub(crate) pending_autosave: Option<PendingAutosave>,
    pub(crate) last_successful_write: Option<AutosaveWriteReceipt>,
    pub(crate) failed_write: Option<BackgroundWriteFailure>,
    pub(crate) cleanup_failure: Option<CleanupFailure>,
    pub(crate) minimum_cleanup_attempt: u64,
    pub(crate) failure_challenges: HashMap<Uuid, PersistenceFailureChallenge>,
    pub(crate) failure_token_source: FailureTokenSource,
    pub(crate) exit_status: ExitStatusView,
    pub(crate) programmatic_exit_bypass: bool,
    pub(crate) exit_action_in_progress: bool,
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
            exit_subscribers: Vec::new(),
            next_session_generation: 0,
            discovery_generation: 0,
            next_autosave_serial: 0,
            next_cleanup_attempt: 0,
            pending_autosave: None,
            last_successful_write: None,
            failed_write: None,
            cleanup_failure: None,
            minimum_cleanup_attempt: 0,
            failure_challenges: HashMap::new(),
            failure_token_source: FailureTokenSource::Random,
            exit_status: ExitStatusView::Idle,
            programmatic_exit_bypass: false,
            exit_action_in_progress: false,
        }
    }
}

impl CoordinatorState {
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

#[derive(Clone)]
struct ExitApplicationContext {
    session: Arc<Mutex<AppSession>>,
    operation_gate: Arc<tokio::sync::Mutex<()>>,
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
pub(crate) struct SaveCoordinator {
    pub(crate) state: Arc<Mutex<CoordinatorState>>,
    ticket_updates: Arc<Notify>,
    backend: Option<Arc<dyn AutosaveBackend>>,
    application: Option<Arc<ApplicationPersistence>>,
    exit_application: Option<ExitApplicationContext>,
    exit_transition: Arc<Mutex<()>>,
    fail_next_exit_prerequisite: Arc<AtomicBool>,
    fail_next_cancel_guard_clear: Arc<AtomicBool>,
    fail_next_exit_challenge: Arc<AtomicBool>,
    #[cfg(test)]
    retry_after_eligibility_hook: Arc<Mutex<Option<RetryEligibilityHook>>>,
    #[cfg(feature = "e2e")]
    e2e_persistence_faults: Arc<E2ePersistenceFaultState>,
}

#[cfg(feature = "e2e")]
pub(crate) struct E2eSessionReplacement {
    pub(crate) generation: u64,
    pub(crate) state: crate::game::GameStateView,
}

struct ExitAttemptRecoveryGuard {
    coordinator: SaveCoordinator,
    recovery: Option<ExitAttemptRecovery>,
}

impl ExitAttemptRecoveryGuard {
    fn new(coordinator: SaveCoordinator, recovery: ExitAttemptRecovery) -> Self {
        Self {
            coordinator,
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
        let coordinator = self.coordinator.clone();
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = coordinator.restore_exit_attempt(recovery);
        }));
    }
}

impl Default for SaveCoordinator {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(CoordinatorState::default())),
            ticket_updates: Arc::new(Notify::new()),
            backend: None,
            application: None,
            exit_application: None,
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

impl SaveCoordinator {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn for_application(
        session: Arc<Mutex<AppSession>>,
        operation_gate: Arc<tokio::sync::Mutex<()>>,
    ) -> Self {
        Self {
            exit_application: Some(ExitApplicationContext {
                session,
                operation_gate,
            }),
            ..Self::default()
        }
    }

    pub(crate) fn with_backend_for_application(
        backend: Arc<dyn AutosaveBackend>,
        session: Arc<Mutex<AppSession>>,
        operation_gate: Arc<tokio::sync::Mutex<()>>,
    ) -> Self {
        Self {
            backend: Some(backend),
            exit_application: Some(ExitApplicationContext {
                session,
                operation_gate,
            }),
            ..Self::default()
        }
    }

    pub(crate) fn with_application(
        application: Arc<ApplicationPersistence>,
        session: Arc<Mutex<AppSession>>,
        operation_gate: Arc<tokio::sync::Mutex<()>>,
    ) -> Self {
        Self {
            backend: Some(application.clone()),
            application: Some(application),
            exit_application: Some(ExitApplicationContext {
                session,
                operation_gate,
            }),
            ..Self::default()
        }
    }

    pub(crate) fn with_exit_application(
        mut self,
        session: Arc<Mutex<AppSession>>,
        operation_gate: Arc<tokio::sync::Mutex<()>>,
    ) -> Self {
        self.exit_application = Some(ExitApplicationContext {
            session,
            operation_gate,
        });
        self
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

    pub(crate) fn exit_status(&self) -> ExitStatusView {
        self.state
            .lock()
            .map(|state| state.exit_status.clone())
            .unwrap_or(ExitStatusView::Idle)
    }

    pub(crate) fn subscribe_exit_status(
        &self,
        subscriber: impl Fn(ExitStatusView) + Send + Sync + 'static,
    ) {
        let subscriber: ExitSubscriber = Arc::new(subscriber);
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let current = state.exit_status.clone();
        state.exit_subscribers.push(Arc::clone(&subscriber));
        drop(state);
        subscriber(current);
    }

    pub(crate) fn consume_programmatic_exit_bypass(&self) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        std::mem::take(&mut state.programmatic_exit_bypass)
    }

    pub(crate) fn request_exit_flush(
        &self,
        exit: Arc<dyn ApplicationExit>,
        _source: ExitRequestSource,
    ) -> Result<(), GameError> {
        self.ensure_exit_prerequisites()?;
        if self.current_exit_status()? != ExitStatusView::Idle {
            return Ok(());
        }
        let start = self.schedule_exit_flush(exit)?;
        let Some(arm) = self.begin_exit_saving(ExitStatusView::Idle, true)? else {
            return Ok(());
        };
        let recovery = ExitAttemptRecovery {
            arm,
            consumed_failure_challenge: None,
        };
        if let Err(recovery) = start.send(recovery) {
            self.restore_exit_attempt(recovery)?;
            return Err(GameError::save_write_failed());
        }
        Ok(())
    }

    pub(crate) fn retry_exit(
        &self,
        exit: Arc<dyn ApplicationExit>,
        token: PersistenceFailureTokenView,
    ) -> Result<(), GameError> {
        self.ensure_exit_prerequisites()?;
        let expected = self.validate_current_exit_token(&token)?;
        let application = self
            .exit_application
            .as_ref()
            .ok_or_else(GameError::save_write_failed)?;
        let identity = {
            let session = application
                .session
                .lock()
                .map_err(|_| GameError::unavailable())?;
            FailureChallengeIdentity {
                session_generation: session.persistence.generation,
                discovery_generation: None,
                durable_revision: session.durable_revision().unwrap_or(0),
                selected_save_id: None,
            }
        };
        let start = self.schedule_exit_flush(exit)?;
        let Some(arm) = self.begin_exit_saving(expected, false)? else {
            return Err(GameError::stale_persistence_failure_token());
        };
        let challenge = match self.consume_failure_token(
            &token,
            PersistenceBypassOperation::ExitWithoutSaving,
            identity,
        ) {
            Ok(challenge) => challenge,
            Err(error) => {
                self.rollback_exit_arm(arm)?;
                return Err(error);
            }
        };
        let recovery = ExitAttemptRecovery {
            arm,
            consumed_failure_challenge: Some(challenge),
        };
        if let Err(recovery) = start.send(recovery) {
            self.restore_exit_attempt(recovery)?;
            return Err(GameError::save_write_failed());
        }
        Ok(())
    }

    pub(crate) fn cancel_exit(
        &self,
        token: PersistenceFailureTokenView,
    ) -> Result<ExitStatusView, GameError> {
        self.validate_current_exit_token(&token)?;
        let application = self
            .exit_application
            .as_ref()
            .ok_or_else(GameError::save_write_failed)?;
        if self
            .fail_next_cancel_guard_clear
            .swap(false, Ordering::SeqCst)
        {
            return Err(GameError::save_write_failed());
        }
        let subscribers = {
            let _transition = self
                .exit_transition
                .lock()
                .map_err(|_| GameError::unavailable())?;
            let mut session = application
                .session
                .lock()
                .map_err(|_| GameError::unavailable())?;
            let identity = FailureChallengeIdentity {
                session_generation: session.persistence.generation,
                discovery_generation: None,
                durable_revision: session.durable_revision().unwrap_or(0),
                selected_save_id: None,
            };
            let parsed = Uuid::parse_str(&token.0)
                .ok()
                .filter(|parsed| parsed.hyphenated().to_string() == token.0)
                .ok_or_else(GameError::stale_persistence_failure_token)?;
            let mut state = self.lock_state()?;
            match &state.exit_status {
                ExitStatusView::Failed { failure_token, .. } if failure_token == &token => {}
                _ => return Err(GameError::stale_persistence_failure_token()),
            }
            let challenge = state
                .failure_challenges
                .get(&parsed)
                .ok_or_else(GameError::stale_persistence_failure_token)?;
            if !challenge.matches(
                parsed,
                PersistenceBypassOperation::ExitWithoutSaving,
                identity,
                state.discovery_generation,
            ) {
                return Err(GameError::stale_persistence_failure_token());
            }
            session.persistence.exit_flush_requested = false;
            state.failure_challenges.remove(&parsed);
            state.exit_status = ExitStatusView::Idle;
            state.programmatic_exit_bypass = false;
            state.exit_action_in_progress = false;
            state.exit_subscribers.clone()
        };
        publish_exit(&subscribers, &ExitStatusView::Idle);
        Ok(ExitStatusView::Idle)
    }

    pub(crate) fn exit_without_saving(
        &self,
        exit: Arc<dyn ApplicationExit>,
        token: PersistenceFailureTokenView,
    ) -> Result<(), GameError> {
        let application = self
            .exit_application
            .as_ref()
            .ok_or_else(GameError::save_write_failed)?;
        let parsed = Uuid::parse_str(&token.0)
            .ok()
            .filter(|parsed| parsed.hyphenated().to_string() == token.0)
            .ok_or_else(GameError::stale_persistence_failure_token)?;
        {
            let _transition = self
                .exit_transition
                .lock()
                .map_err(|_| GameError::unavailable())?;
            let session = application
                .session
                .lock()
                .map_err(|_| GameError::unavailable())?;
            let identity = FailureChallengeIdentity {
                session_generation: session.persistence.generation,
                discovery_generation: None,
                durable_revision: session.durable_revision().unwrap_or(0),
                selected_save_id: None,
            };
            let mut state = self.lock_state()?;
            match &state.exit_status {
                ExitStatusView::Failed { failure_token, .. }
                    if failure_token == &token && !state.exit_action_in_progress => {}
                _ => return Err(GameError::stale_persistence_failure_token()),
            }
            let challenge = state
                .failure_challenges
                .get(&parsed)
                .ok_or_else(GameError::stale_persistence_failure_token)?;
            if !challenge.matches(
                parsed,
                PersistenceBypassOperation::ExitWithoutSaving,
                identity,
                state.discovery_generation,
            ) {
                return Err(GameError::stale_persistence_failure_token());
            }
            state.programmatic_exit_bypass = true;
            state.exit_action_in_progress = true;
        }
        let action = exit.exit(0);
        let _transition = self
            .exit_transition
            .lock()
            .map_err(|_| GameError::unavailable())?;
        let session = application
            .session
            .lock()
            .map_err(|_| GameError::unavailable())?;
        let identity = FailureChallengeIdentity {
            session_generation: session.persistence.generation,
            discovery_generation: None,
            durable_revision: session.durable_revision().unwrap_or(0),
            selected_save_id: None,
        };
        let mut state = self.lock_state()?;
        if action.is_err() {
            state.programmatic_exit_bypass = false;
            state.exit_action_in_progress = false;
            return action;
        }
        let valid = state
            .failure_challenges
            .get(&parsed)
            .is_some_and(|challenge| {
                challenge.matches(
                    parsed,
                    PersistenceBypassOperation::ExitWithoutSaving,
                    identity,
                    state.discovery_generation,
                )
            });
        if !valid {
            state.programmatic_exit_bypass = false;
            state.exit_action_in_progress = false;
            return Err(GameError::stale_persistence_failure_token());
        }
        state.failure_challenges.remove(&parsed);
        state.exit_action_in_progress = false;
        Ok(())
    }

    fn validate_current_exit_token(
        &self,
        token: &PersistenceFailureTokenView,
    ) -> Result<ExitStatusView, GameError> {
        let state = self.lock_state()?;
        match &state.exit_status {
            status @ ExitStatusView::Failed { failure_token, .. }
                if failure_token == token && !state.exit_action_in_progress =>
            {
                Ok(status.clone())
            }
            _ => Err(GameError::stale_persistence_failure_token()),
        }
    }

    fn current_exit_status(&self) -> Result<ExitStatusView, GameError> {
        self.state
            .lock()
            .map(|state| state.exit_status.clone())
            .map_err(|_| GameError::unavailable())
    }

    fn ensure_exit_prerequisites(&self) -> Result<(), GameError> {
        self.exit_application
            .as_ref()
            .ok_or_else(GameError::save_write_failed)?;
        if self
            .fail_next_exit_prerequisite
            .swap(false, Ordering::SeqCst)
        {
            return Err(GameError::save_write_failed());
        }
        Ok(())
    }

    /// Exit transitions take `exit_transition -> S -> coordinator state`.
    /// They never acquire the writer gate or G and release every guard before
    /// publishing callbacks, scheduling work, awaiting, or invoking exit.
    fn begin_exit_saving(
        &self,
        expected: ExitStatusView,
        deduplicate_mismatch: bool,
    ) -> Result<Option<ExitArmSnapshot>, GameError> {
        let application = self
            .exit_application
            .as_ref()
            .ok_or_else(GameError::save_write_failed)?;
        let (snapshot, subscribers) = {
            let _transition = self
                .exit_transition
                .lock()
                .map_err(|_| GameError::unavailable())?;
            let mut session = application
                .session
                .lock()
                .map_err(|_| GameError::unavailable())?;
            let mut state = self.lock_state()?;
            if state.exit_status != expected {
                return if deduplicate_mismatch {
                    Ok(None)
                } else {
                    Err(GameError::stale_persistence_failure_token())
                };
            }
            let snapshot = ExitArmSnapshot {
                status: state.exit_status.clone(),
                exit_flush_requested: session.persistence.exit_flush_requested,
                programmatic_exit_bypass: state.programmatic_exit_bypass,
                exit_action_in_progress: state.exit_action_in_progress,
            };
            session.persistence.exit_flush_requested = true;
            state.exit_status = ExitStatusView::Saving;
            state.programmatic_exit_bypass = false;
            state.exit_action_in_progress = false;
            (snapshot, state.exit_subscribers.clone())
        };
        publish_exit(&subscribers, &ExitStatusView::Saving);
        Ok(Some(snapshot))
    }

    fn rollback_exit_arm(&self, snapshot: ExitArmSnapshot) -> Result<(), GameError> {
        self.restore_exit_attempt(ExitAttemptRecovery {
            arm: snapshot,
            consumed_failure_challenge: None,
        })
    }

    fn restore_exit_attempt(&self, recovery: ExitAttemptRecovery) -> Result<(), GameError> {
        let application = self
            .exit_application
            .as_ref()
            .ok_or_else(GameError::save_write_failed)?;
        let ExitAttemptRecovery {
            arm,
            consumed_failure_challenge,
        } = recovery;
        let subscribers = {
            let _transition = self
                .exit_transition
                .lock()
                .map_err(|_| GameError::unavailable())?;
            let mut session = application
                .session
                .lock()
                .map_err(|_| GameError::unavailable())?;
            let mut state = self.lock_state()?;
            if let Some(challenge) = consumed_failure_challenge {
                match state.failure_challenges.entry(challenge.token) {
                    std::collections::hash_map::Entry::Vacant(entry) => {
                        entry.insert(challenge);
                    }
                    std::collections::hash_map::Entry::Occupied(mut entry) => {
                        if entry.get() != &challenge {
                            // The previously issued retry authority wins this
                            // impossible UUID collision. Replace only the
                            // conflicting key; unrelated challenges remain
                            // untouched.
                            entry.insert(challenge);
                        }
                    }
                }
            }
            session.persistence.exit_flush_requested = arm.exit_flush_requested;
            state.exit_status = arm.status.clone();
            state.programmatic_exit_bypass = arm.programmatic_exit_bypass;
            state.exit_action_in_progress = arm.exit_action_in_progress;
            state.exit_subscribers.clone()
        };
        publish_exit(&subscribers, &arm.status);
        Ok(())
    }

    fn schedule_exit_flush(
        &self,
        exit: Arc<dyn ApplicationExit>,
    ) -> Result<tokio::sync::oneshot::Sender<ExitAttemptRecovery>, GameError> {
        let coordinator = self.clone();
        let (start_tx, start_rx) = tokio::sync::oneshot::channel();
        #[cfg(test)]
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                let Ok(recovery) = start_rx.await else {
                    return;
                };
                let mut recovery = ExitAttemptRecoveryGuard::new(coordinator.clone(), recovery);
                match coordinator.flush_for_exit().await {
                    Ok(()) => {
                        {
                            let Ok(mut state) = coordinator.state.lock() else {
                                return;
                            };
                            state.programmatic_exit_bypass = true;
                        }
                        match exit.exit(0) {
                            Ok(()) => recovery.disarm(),
                            Err(error) => {
                                if let Ok(notification) = coordinator.commit_exit_failure(error) {
                                    recovery.disarm();
                                    notification.publish();
                                }
                            }
                        }
                    }
                    Err(error) => {
                        if let Ok(notification) = coordinator.commit_exit_failure(error) {
                            recovery.disarm();
                            notification.publish();
                        }
                    }
                }
            });
        }
        #[cfg(not(test))]
        tauri::async_runtime::spawn(async move {
            let Ok(recovery) = start_rx.await else {
                return;
            };
            let mut recovery = ExitAttemptRecoveryGuard::new(coordinator.clone(), recovery);
            match coordinator.flush_for_exit().await {
                Ok(()) => {
                    {
                        let Ok(mut state) = coordinator.state.lock() else {
                            return;
                        };
                        state.programmatic_exit_bypass = true;
                    }
                    match exit.exit(0) {
                        Ok(()) => recovery.disarm(),
                        Err(error) => {
                            if let Ok(notification) = coordinator.commit_exit_failure(error) {
                                recovery.disarm();
                                notification.publish();
                            }
                        }
                    }
                }
                Err(error) => {
                    if let Ok(notification) = coordinator.commit_exit_failure(error) {
                        recovery.disarm();
                        notification.publish();
                    }
                }
            }
        });
        Ok(start_tx)
    }

    async fn flush_for_exit(&self) -> Result<(), GameError> {
        let application = self
            .exit_application
            .as_ref()
            .ok_or_else(GameError::save_write_failed)?;
        if application
            .session
            .lock()
            .map_err(|_| GameError::unavailable())?
            .engine
            .is_none()
        {
            return Ok(());
        }
        self.flush_session_parts(
            &application.session,
            &application.operation_gate,
            FlushOperation::Exit,
        )
        .await
        .map(|_| ())
    }

    fn commit_exit_failure(
        &self,
        diagnostic: GameError,
    ) -> Result<ExitFailureNotification, GameError> {
        if self.fail_next_exit_challenge.swap(false, Ordering::SeqCst) {
            return Err(GameError::save_write_failed());
        }
        let application = self
            .exit_application
            .as_ref()
            .ok_or_else(GameError::save_write_failed)?;
        let (status, health, exit_subscribers, health_subscribers) = {
            let _transition = self
                .exit_transition
                .lock()
                .map_err(|_| GameError::unavailable())?;
            let session = application
                .session
                .lock()
                .map_err(|_| GameError::unavailable())?;
            let identity = FailureChallengeIdentity {
                session_generation: session.persistence.generation,
                discovery_generation: None,
                durable_revision: session.durable_revision().unwrap_or(0),
                selected_save_id: None,
            };
            let health = PersistenceHealthView::Degraded {
                diagnostic: diagnostic.clone(),
            };
            let mut state = self.lock_state()?;
            if state.exit_status != ExitStatusView::Saving {
                return Err(GameError::stale_persistence_failure_token());
            }
            let token = state
                .reserve_failure_challenge(PersistenceBypassOperation::ExitWithoutSaving, identity);
            let token_wire = token.hyphenated().to_string();
            let mut status_diagnostic = diagnostic.clone();
            status_diagnostic.failure_token = None;
            let status = ExitStatusView::Failed {
                diagnostic: status_diagnostic,
                failure_token: PersistenceFailureTokenView(token_wire),
            };
            let health_subscribers = set_persistence_health(&mut state, health.clone());
            state.exit_status = status.clone();
            state.programmatic_exit_bypass = false;
            state.exit_action_in_progress = false;
            let exit_subscribers = state.exit_subscribers.clone();
            (status, health, exit_subscribers, health_subscribers)
        };
        Ok(ExitFailureNotification {
            status,
            health,
            exit_subscribers,
            health_subscribers,
        })
    }

    pub(crate) fn next_session_generation(&self) -> Result<u64, GameError> {
        let mut state = self.lock_state()?;
        state.next_session_generation = state
            .next_session_generation
            .checked_add(1)
            .ok_or_else(GameError::save_write_failed)?;
        Ok(state.next_session_generation)
    }

    #[cfg(feature = "e2e")]
    pub(crate) async fn replace_session_for_e2e(
        &self,
        app: &crate::AppState,
        engine: GameEngine,
    ) -> Result<E2eSessionReplacement, GameError> {
        let view = engine.view()?;
        {
            let session = app.session.lock().map_err(|_| GameError::unavailable())?;
            session.ensure_persistence_available()?;
        }
        {
            let state = self.lock_state()?;
            if state.exit_status == ExitStatusView::Saving {
                return Err(GameError::persistence_operation_in_progress());
            }
        }

        let _gate = app.operation_gate.lock().await;
        let _exit_transition = self
            .exit_transition
            .lock()
            .map_err(|_| GameError::unavailable())?;
        let mut session = app.session.lock().map_err(|_| GameError::unavailable())?;
        session.ensure_persistence_available()?;
        let mut state = self.lock_state()?;
        if state.exit_status == ExitStatusView::Saving {
            return Err(GameError::persistence_operation_in_progress());
        }
        let generation = state
            .next_session_generation
            .checked_add(1)
            .ok_or_else(GameError::save_write_failed)?;
        // Keep the coordinator state locked while advancing all stale-work
        // identities and installing the session. An active stale writer cannot
        // publish through the new generation fence.
        let minimum_cleanup_attempt = state
            .next_cleanup_attempt
            .checked_add(1)
            .ok_or_else(GameError::save_write_failed)?;
        state.next_cleanup_attempt = minimum_cleanup_attempt;
        state.next_session_generation = generation;
        state.discovery_generation = state.discovery_generation.wrapping_add(1);
        state.next_autosave_serial = state.next_autosave_serial.wrapping_add(1);
        state.tickets.clear();
        state.latest_by_intent.clear();
        state.pending_autosave = None;
        state.last_successful_write = None;
        state.failed_write = None;
        state.cleanup_failure = None;
        state.minimum_cleanup_attempt = minimum_cleanup_attempt;
        state.failure_challenges.clear();
        state.persistence_health = PersistenceHealthView::Healthy;
        state.thumbnail_activity = ThumbnailActivityView::Idle;
        state.exit_status = ExitStatusView::Idle;
        state.programmatic_exit_bypass = false;
        state.exit_action_in_progress = false;
        let health_subscribers = state.health_subscribers.clone();
        let activity_subscribers = state.activity_subscribers.clone();
        let exit_subscribers = state.exit_subscribers.clone();
        *session = AppSession::installed(engine, generation, None);
        self.e2e_persistence_faults.reset();
        self.fail_next_exit_prerequisite
            .store(false, Ordering::SeqCst);
        self.fail_next_cancel_guard_clear
            .store(false, Ordering::SeqCst);
        self.fail_next_exit_challenge.store(false, Ordering::SeqCst);
        drop(state);
        drop(session);

        publish_health(&health_subscribers, &PersistenceHealthView::Healthy);
        publish_activity(&activity_subscribers, &ThumbnailActivityView::Idle);
        publish_exit(&exit_subscribers, &ExitStatusView::Idle);
        self.ticket_updates.notify_waiters();

        Ok(E2eSessionReplacement {
            generation,
            state: view,
        })
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
        let _gate = app.operation_gate.lock().await;
        let mut session = app.session.lock().map_err(|_| GameError::unavailable())?;
        session.ensure_persistence_available()?;
        let generation = self.next_session_generation()?;
        let autosave_target = match autosave_target {
            Some(target @ SaveSlotRef::Auto { .. }) => Some(target),
            Some(SaveSlotRef::Manual { .. }) | None => None,
        };
        *session = AppSession::installed(engine, generation, autosave_target);
        Ok(view)
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

    pub(crate) async fn install_session_if_current(
        &self,
        app: &crate::AppState,
        engine: GameEngine,
        autosave_target: Option<SaveSlotRef>,
        expected: SessionTransitionIdentity,
    ) -> Result<crate::game::GameStateView, GameError> {
        let view = engine.view()?;
        let _gate = app.operation_gate.lock().await;
        let mut session = app.session.lock().map_err(|_| GameError::unavailable())?;
        session.ensure_persistence_available()?;
        if session.persistence.generation != expected.generation
            || session.durable_revision() != expected.durable_revision
        {
            return Err(GameError::stale_save_selection());
        }
        let generation = self.next_session_generation()?;
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
        let _gate = app.operation_gate.lock().await;
        let mut session = app.session.lock().map_err(|_| GameError::unavailable())?;
        session.ensure_persistence_available()?;
        let generation = self.next_session_generation()?;
        *session = AppSession::empty_at_generation(generation);
        Ok(generation)
    }

    pub(crate) async fn clear_session_if_current(
        &self,
        app: &crate::AppState,
        expected: SessionTransitionIdentity,
    ) -> Result<u64, GameError> {
        let _gate = app.operation_gate.lock().await;
        let mut session = app.session.lock().map_err(|_| GameError::unavailable())?;
        session.ensure_persistence_available()?;
        if session.persistence.generation != expected.generation
            || session.durable_revision() != expected.durable_revision
        {
            return Err(GameError::stale_persistence_failure_token());
        }
        let generation = self.next_session_generation()?;
        *session = AppSession::empty_at_generation(generation);
        Ok(generation)
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

    fn complete_discovery_attempt_locked(state: &mut CoordinatorState) -> Result<u64, GameError> {
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
        let _gate = app.operation_gate.lock().await;
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
                if let Err(error) = self.prepare_autosave(
                    purpose,
                    request.ticket.clone(),
                    request.deadline_at,
                    false,
                    true,
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

    /// Schedule an autosave for a committed workbench mutation without asking
    /// the frontend to capture a thumbnail. The coordinator still creates an
    /// internal terminal ticket so the existing trailing-debounce/write path
    /// can consume `Unavailable` without publishing thumbnail activity.
    pub(crate) fn notify_durable_commit_without_thumbnail(
        &self,
        session_generation: u64,
        durable_revision: u64,
    ) -> Option<ThumbnailCaptureRequestView> {
        let purpose = ThumbnailCapturePurpose::Autosave {
            session_generation,
            durable_revision,
        };
        let (ticket, deadline_at) = match self.issue_terminal_unavailable_thumbnail(purpose.clone())
        {
            Ok(ticket) => ticket,
            Err(error) => {
                self.record_schedule_failure_without_thumbnail(
                    session_generation,
                    durable_revision,
                    None,
                    error,
                );
                return None;
            }
        };
        if let Err(error) =
            self.prepare_autosave(purpose, ticket.clone(), deadline_at, false, false)
        {
            self.record_schedule_failure_without_thumbnail(
                session_generation,
                durable_revision,
                Some(&ticket),
                error,
            );
        }
        None
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

    pub(crate) fn notify_committed_without_thumbnail<T>(
        &self,
        committed: T,
        session_generation: u64,
        durable_revision: u64,
    ) -> CommittedNotification<T> {
        CommittedNotification {
            committed,
            thumbnail_capture: self
                .notify_durable_commit_without_thumbnail(session_generation, durable_revision),
        }
    }

    pub(crate) fn retry_failed_background(
        &self,
        _trigger: BackgroundRetryTrigger,
    ) -> Option<ThumbnailCaptureRequestView> {
        let (failure, stale_health_publication) = {
            let mut state = self.state.lock().ok()?;
            let failure = state.failed_write.clone()?;
            let (session_generation, durable_revision) = failure.identity;
            let superseded_by_pending = state.pending_autosave.as_ref().is_some_and(|pending| {
                pending.session_generation == session_generation
                    && pending.durable_revision > durable_revision
            });
            let superseded_by_success =
                state.last_successful_write.as_ref().is_some_and(|receipt| {
                    receipt.session_generation == session_generation
                        && receipt.durable_revision >= durable_revision
                });
            if superseded_by_pending || superseded_by_success {
                state.failed_write = None;
                let health = health_after_completion(&state);
                let subscribers = set_persistence_health(&mut state, health.clone());
                (None, Some((health, subscribers)))
            } else {
                (Some(failure), None)
            }
        };
        if let Some((health, subscribers)) = stale_health_publication {
            publish_health(&subscribers, &health);
        }
        let failure = failure?;
        let failure_identity = failure.identity;
        let (session_generation, durable_revision) = failure_identity;
        let thumbnail_capture_required = failure.thumbnail_capture_required;
        #[cfg(test)]
        self.run_retry_after_eligibility_hook_for_test();
        let purpose = ThumbnailCapturePurpose::Autosave {
            session_generation,
            durable_revision,
        };
        if !thumbnail_capture_required {
            let (ticket, deadline_at) = match self
                .issue_terminal_unavailable_thumbnail_for_retry(purpose.clone(), failure_identity)
            {
                Ok(Some(ticket)) => ticket,
                Ok(None) => return None,
                Err(error) => {
                    self.record_schedule_failure_without_thumbnail(
                        session_generation,
                        durable_revision,
                        None,
                        error,
                    );
                    return None;
                }
            };
            if let Err(error) =
                self.prepare_autosave(purpose, ticket.clone(), deadline_at, true, false)
            {
                self.record_schedule_failure_without_thumbnail(
                    session_generation,
                    durable_revision,
                    Some(&ticket),
                    error,
                );
            }
            return None;
        }
        let request = match self.issue_thumbnail_for_retry(purpose.clone(), failure_identity) {
            Ok(Some(request)) => request,
            Ok(None) => return None,
            Err(error) => {
                self.record_schedule_failure(session_generation, durable_revision, None, error);
                return None;
            }
        };
        if let Err(error) = self.prepare_autosave(
            purpose,
            request.ticket.clone(),
            request.deadline_at,
            true,
            true,
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

    pub(crate) async fn acquire_operation_gate(&self) -> Option<tokio::sync::OwnedMutexGuard<()>> {
        let operation_gate = self
            .exit_application
            .as_ref()
            .map(|application| Arc::clone(&application.operation_gate))?;
        Some(operation_gate.lock_owned().await)
    }

    pub(crate) async fn flush_session(
        &self,
        app: &crate::AppState,
        operation: FlushOperation,
    ) -> Result<FlushOutcome, GameError> {
        self.flush_session_parts(&app.session, &app.operation_gate, operation)
            .await
    }

    async fn flush_session_parts(
        &self,
        session_state: &Arc<Mutex<AppSession>>,
        operation_gate: &Arc<tokio::sync::Mutex<()>>,
        operation: FlushOperation,
    ) -> Result<FlushOutcome, GameError> {
        let (session_generation, durable_revision, flush_revision, preferred_target) = {
            let mut session = session_state.lock().map_err(|_| GameError::unavailable())?;
            if operation == FlushOperation::Exit {
                session.ensure_exit_flush_available()?;
            } else {
                session.ensure_persistence_available()?;
            }
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
                session.persistence.autosave_target,
            )
        };
        let Some(flush_revision) = flush_revision else {
            return Ok(FlushOutcome::Noop {
                session_generation,
                durable_revision,
            });
        };
        let (thumbnail, thumbnail_capture_required) = self
            .cancel_pending_autosave_covered_by_flush(session_generation, flush_revision)?
            .unwrap_or((CaptureTerminalResult::Unavailable, true));

        #[cfg(feature = "e2e")]
        if operation == FlushOperation::Exit {
            self.e2e_persistence_faults
                .fire(E2ePersistenceFaultBoundary::ExitFlush)
                .map_err(|_| GameError::save_write_failed())?;
        }

        let (receipt, wrote) = self
            .execute_blocking_flush(
                session_generation,
                flush_revision,
                preferred_target,
                thumbnail,
                thumbnail_capture_required,
            )
            .await?;

        let _gate = operation_gate.lock().await;
        let mut session = session_state.lock().map_err(|_| GameError::unavailable())?;
        if operation == FlushOperation::Exit {
            session.ensure_exit_flush_available()?;
        } else {
            session.ensure_persistence_available()?;
        }
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

    async fn execute_blocking_flush(
        &self,
        session_generation: u64,
        durable_revision: u64,
        preferred_target: Option<SaveSlotRef>,
        thumbnail: CaptureTerminalResult,
        thumbnail_capture_required: bool,
    ) -> Result<(AutosaveWriteReceipt, bool), GameError> {
        let _operation_gate = self.acquire_operation_gate().await;
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
            self.record_blocking_success(receipt.clone(), cleanup_diagnostic);
            Ok((receipt, true))
        }
        .await;
        if let Err(error) = &write_result {
            self.record_background_failure(
                session_generation,
                durable_revision,
                thumbnail_capture_required,
                error.clone(),
            );
        }
        write_result
    }

    fn cancel_pending_autosave_covered_by_flush(
        &self,
        session_generation: u64,
        durable_revision: u64,
    ) -> Result<Option<(CaptureTerminalResult, bool)>, GameError> {
        let (thumbnail, subscribers) = {
            let mut state = self.lock_state()?;
            let covered = state.pending_autosave.as_ref().is_some_and(|pending| {
                pending.session_generation == session_generation
                    && pending.durable_revision <= durable_revision
            });
            if !covered {
                return Ok(None);
            }
            let pending = state
                .pending_autosave
                .take()
                .ok_or_else(GameError::save_write_failed)?;
            let terminal = state
                .tickets
                .remove(&pending.ticket)
                .and_then(|mut record| record.terminal.take());
            let thumbnail = if pending.durable_revision == durable_revision {
                terminal.unwrap_or(CaptureTerminalResult::Unavailable)
            } else {
                CaptureTerminalResult::Unavailable
            };
            let thumbnail_capture_required = pending.thumbnail_capture_required;
            if state.latest_by_intent.get(&CaptureIntent::Autosave) == Some(&pending.ticket) {
                state.latest_by_intent.remove(&CaptureIntent::Autosave);
            }
            (
                Some((thumbnail, thumbnail_capture_required)),
                set_thumbnail_activity(&mut state, ThumbnailActivityView::Idle),
            )
        };
        publish_activity(&subscribers, &ThumbnailActivityView::Idle);
        self.ticket_updates.notify_waiters();
        Ok(thumbnail)
    }

    pub(crate) fn ticket_updates(&self) -> Arc<Notify> {
        Arc::clone(&self.ticket_updates)
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
        let owner = match owner {
            Some(owner) => owner,
            None => {
                let mut state = self.lock_state()?;
                state.next_cleanup_attempt = state
                    .next_cleanup_attempt
                    .checked_add(1)
                    .ok_or_else(GameError::save_write_failed)?;
                CleanupOwner::Attempt(state.next_cleanup_attempt)
            }
        };
        let coordinator = self.clone();
        #[cfg(test)]
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                let _operation_gate = coordinator.acquire_operation_gate().await;
                match backend.cleanup_orphans().await {
                    Ok(()) => coordinator.resolve_cleanup_failure(&owner),
                    Err(error) => coordinator.record_cleanup_failure(owner, error),
                }
            });
        }
        #[cfg(not(test))]
        tauri::async_runtime::spawn(async move {
            let _operation_gate = coordinator.acquire_operation_gate().await;
            match backend.cleanup_orphans().await {
                Ok(()) => coordinator.resolve_cleanup_failure(&owner),
                Err(error) => coordinator.record_cleanup_failure(owner, error),
            }
        });
        Ok(())
    }

    pub(crate) fn prepare_thumbnail(
        &self,
        purpose: ThumbnailCapturePurpose,
    ) -> Result<ThumbnailCaptureRequestView, GameError> {
        self.issue_thumbnail(purpose)
    }

    pub(crate) fn prepare_application_thumbnail(
        &self,
        app: &crate::AppState,
        purpose: PreparedThumbnailPurpose,
    ) -> Result<ThumbnailCaptureRequestView, GameError> {
        let purpose = {
            let session = app.session.lock().map_err(|_| GameError::unavailable())?;
            session.ensure_persistence_available()?;
            let engine = session
                .engine
                .as_ref()
                .ok_or_else(GameError::game_not_started)?;
            let session_generation = session.persistence.generation;
            let durable_revision = engine.durable_revision();
            match purpose {
                PreparedThumbnailPurpose::ManualSave => ThumbnailCapturePurpose::ManualSave {
                    session_generation,
                    durable_revision,
                },
            }
        };
        self.prepare_thumbnail(purpose)
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

    pub(crate) fn publish_persistence_health_for_session(
        &self,
        session_generation: u64,
        view: PersistenceHealthView,
    ) -> Result<(), GameError> {
        let mut state = self.lock_state()?;
        // `next_session_generation` is the replacement high-water mark: a
        // session whose generation is strictly older was replaced. Equality
        // is the normal case (production installs advance the mark to match
        // the session); a newer generation never occurs in production, so `<`
        // identifies exactly the stale case. This mirrors the `<` guard in
        // `record_schedule_failure` and lets the autosave scheduling path
        // route its Pending publication here without rejecting sessions whose
        // generation the test fixtures install ahead of the mark.
        if session_generation < state.next_session_generation {
            return Err(GameError::stale_session_generation());
        }
        let subscribers = set_persistence_health(&mut state, view.clone());
        drop(state);
        publish_health(&subscribers, &view);
        Ok(())
    }

    pub(crate) fn prepare_autosave(
        &self,
        purpose: ThumbnailCapturePurpose,
        ticket: String,
        capture_deadline: Instant,
        allow_unchanged_retry: bool,
        thumbnail_capture_required: bool,
    ) -> Result<(), GameError> {
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
            // Reject stale sessions before mutating coordinator state. A
            // replacement (`replace_session_for_e2e`) advances
            // `next_session_generation` and clears `pending_autosave`; an
            // autosave scheduled for a prior generation must not reinstall a
            // stale pending entry or overwrite the Healthy state replacement
            // published. `<` (not `!=`) matches the high-water-mark semantic
            // used by `record_schedule_failure`, so a session whose generation
            // is current or ahead of the mark still schedules. The subsequent
            // `publish_persistence_health_for_session` re-checks under the
            // lock so a replacement racing the health publication is ignored.
            if session_generation < state.next_session_generation {
                return Err(GameError::stale_session_generation());
            }
            if state.pending_autosave.as_ref().is_some_and(|pending| {
                pending.session_generation == session_generation
                    && pending.durable_revision > durable_revision
            }) {
                return Err(GameError::save_write_failed());
            }
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
                thumbnail_capture_required,
                debounce_deadline,
                capture_deadline,
            };
            state.pending_autosave = Some(pending.clone());
            pending
        };
        self.publish_persistence_health_for_session(
            session_generation,
            PersistenceHealthView::Pending,
        )?;
        if let Some(application) = self.application.as_ref() {
            return application.clone().schedule_autosave(self.clone(), pending);
        }
        #[cfg(test)]
        {
            let backend = self
                .backend
                .as_ref()
                .cloned()
                .ok_or_else(GameError::save_write_failed)?;
            ApplicationPersistence::schedule_autosave_with_backend(backend, self.clone(), pending)
        }
        #[cfg(not(test))]
        {
            Err(GameError::save_write_failed())
        }
    }

    pub(crate) fn take_terminal_thumbnail(
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

    pub(crate) fn pending_matches(&self, pending: &PendingAutosave) -> bool {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.pending_autosave.as_ref().map(|live| live.serial))
            == Some(pending.serial)
    }

    pub(crate) fn record_background_success(
        &self,
        completed: &PendingAutosave,
        receipt: AutosaveWriteReceipt,
        cleanup_diagnostic: Option<GameError>,
    ) {
        let (health, subscribers, cleanup_retry) = if let Ok(mut state) = self.state.lock() {
            if receipt.session_generation < state.next_session_generation {
                return;
            }
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
            if receipt.session_generation < state.next_session_generation {
                return;
            }
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

    pub(crate) fn record_stale_write(&self, completed: &PendingAutosave) {
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

    pub(crate) fn resolve_cleanup_failure(&self, owner: &CleanupOwner) {
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

    pub(crate) fn record_cleanup_failure(&self, owner: CleanupOwner, error: GameError) {
        let publication = if let Ok(mut state) = self.state.lock() {
            let stale = match &owner {
                CleanupOwner::Receipt(receipt) => {
                    receipt.session_generation < state.next_session_generation
                }
                CleanupOwner::Attempt(attempt) => *attempt < state.minimum_cleanup_attempt,
            };
            if stale {
                return;
            }
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

    pub(crate) fn record_background_failure(
        &self,
        session_generation: u64,
        durable_revision: u64,
        thumbnail_capture_required: bool,
        error: GameError,
    ) {
        let publication = if let Ok(mut state) = self.state.lock() {
            if session_generation < state.next_session_generation {
                return;
            }
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
                    thumbnail_capture_required,
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
            if session_generation < state.next_session_generation {
                return;
            }
            let health_publication = if state
                .failed_write
                .as_ref()
                .is_none_or(|existing| failed >= existing.identity)
            {
                state.failed_write = Some(BackgroundWriteFailure {
                    identity: failed,
                    diagnostic: error.clone(),
                    thumbnail_capture_required: true,
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

    fn record_schedule_failure_without_thumbnail(
        &self,
        session_generation: u64,
        durable_revision: u64,
        ticket: Option<&str>,
        error: GameError,
    ) {
        let failed = (session_generation, durable_revision);
        let health_publication = if let Ok(mut state) = self.state.lock() {
            if session_generation < state.next_session_generation {
                return;
            }
            let health_publication = if state
                .failed_write
                .as_ref()
                .is_none_or(|existing| failed >= existing.identity)
            {
                state.failed_write = Some(BackgroundWriteFailure {
                    identity: failed,
                    diagnostic: error.clone(),
                    thumbnail_capture_required: false,
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
            health_publication
        } else {
            None
        };
        if let Some((health, subscribers)) = health_publication {
            publish_health(&subscribers, &health);
        }
        self.ticket_updates.notify_waiters();
    }

    fn issue_thumbnail(
        &self,
        purpose: ThumbnailCapturePurpose,
    ) -> Result<ThumbnailCaptureRequestView, GameError> {
        self.issue_thumbnail_inner(purpose, None)?
            .ok_or_else(GameError::save_write_failed)
    }

    fn issue_thumbnail_for_retry(
        &self,
        purpose: ThumbnailCapturePurpose,
        failure_identity: (u64, u64),
    ) -> Result<Option<ThumbnailCaptureRequestView>, GameError> {
        self.issue_thumbnail_inner(purpose, Some(failure_identity))
    }

    fn issue_thumbnail_inner(
        &self,
        purpose: ThumbnailCapturePurpose,
        retry_identity: Option<(u64, u64)>,
    ) -> Result<Option<ThumbnailCaptureRequestView>, GameError> {
        let issued_at = Instant::now();
        let deadline_at = issued_at + THUMBNAIL_CAPTURE_TIMEOUT;
        let ticket = Uuid::new_v4().hyphenated().to_string();
        let intent = purpose.intent();
        let mut state = self.lock_state()?;
        // Reject a stale-generation capture atomically, before any coordinator
        // state is mutated. `next_session_generation` is the replacement
        // high-water mark; a capture for a prior generation must not insert a
        // ticket, supersede `latest_by_intent`, or publish `Capturing`, because
        // the late autosave scheduling / `record_schedule_failure` fences would
        // otherwise leave that stale ticket installed (and, for the autosave
        // intent, evict a live replacement-session ticket). `<` (not `!=`)
        // matches the high-water-mark semantic used by autosave scheduling and
        // `record_schedule_failure`, so a current-or-ahead generation still
        // issues normally.
        if purpose.session_generation() < state.next_session_generation {
            return Err(GameError::stale_session_generation());
        }
        if let Some(identity) = retry_identity {
            match retry_eligibility(&mut state, identity) {
                RetryEligibility::Proceed => {}
                RetryEligibility::Ignore => return Ok(None),
                RetryEligibility::Retire {
                    health,
                    subscribers,
                } => {
                    drop(state);
                    publish_health(&subscribers, &health);
                    return Ok(None);
                }
            }
        }
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
        let expiry_state = Arc::downgrade(&self.state);
        let expiry_updates = Arc::downgrade(&self.ticket_updates);
        let expiry_ticket = ticket.clone();
        #[cfg(test)]
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(thumbnail_ticket_expiry_task(
                expiry_state,
                expiry_ticket,
                deadline_at,
                expiry_updates,
            ));
        }
        #[cfg(not(test))]
        tauri::async_runtime::spawn(async move {
            thumbnail_ticket_expiry_task(expiry_state, expiry_ticket, deadline_at, expiry_updates)
                .await;
        });
        Ok(Some(ThumbnailCaptureRequestView {
            ticket,
            deadline_at,
        }))
    }

    fn issue_terminal_unavailable_thumbnail(
        &self,
        purpose: ThumbnailCapturePurpose,
    ) -> Result<(String, Instant), GameError> {
        self.issue_terminal_unavailable_thumbnail_inner(purpose, None)?
            .ok_or_else(GameError::save_write_failed)
    }

    fn issue_terminal_unavailable_thumbnail_for_retry(
        &self,
        purpose: ThumbnailCapturePurpose,
        failure_identity: (u64, u64),
    ) -> Result<Option<(String, Instant)>, GameError> {
        self.issue_terminal_unavailable_thumbnail_inner(purpose, Some(failure_identity))
    }

    fn issue_terminal_unavailable_thumbnail_inner(
        &self,
        purpose: ThumbnailCapturePurpose,
        retry_identity: Option<(u64, u64)>,
    ) -> Result<Option<(String, Instant)>, GameError> {
        let issued_at = Instant::now();
        let ticket = Uuid::new_v4().hyphenated().to_string();
        let intent = purpose.intent();
        let (activity_subscribers, activity) = {
            let mut state = self.lock_state()?;
            if purpose.session_generation() < state.next_session_generation {
                return Err(GameError::stale_session_generation());
            }
            if let Some(identity) = retry_identity {
                match retry_eligibility(&mut state, identity) {
                    RetryEligibility::Proceed => {}
                    RetryEligibility::Ignore => return Ok(None),
                    RetryEligibility::Retire {
                        health,
                        subscribers,
                    } => {
                        drop(state);
                        publish_health(&subscribers, &health);
                        return Ok(None);
                    }
                }
            }
            let removed_nonterminal_autosave = state
                .latest_by_intent
                .insert(intent, ticket.clone())
                .and_then(|superseded| state.tickets.remove(&superseded))
                .is_some_and(|record| {
                    record.purpose.intent() == CaptureIntent::Autosave && record.terminal.is_none()
                });
            state.tickets.insert(
                ticket.clone(),
                TicketRecord {
                    purpose,
                    issued_at,
                    deadline_at: issued_at,
                    terminal: Some(CaptureTerminalResult::Unavailable),
                },
            );
            if removed_nonterminal_autosave {
                clear_thumbnail_activity_if_no_live_capture(&mut state)
            } else {
                (Vec::new(), None)
            }
        };
        if let Some(activity) = activity {
            publish_activity(&activity_subscribers, &activity);
        }
        self.ticket_updates.notify_waiters();
        Ok(Some((ticket, issued_at)))
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
    pub(crate) fn ticket_only() -> Self {
        Self::new()
    }

    pub(crate) fn with_backend(backend: Arc<dyn AutosaveBackend>) -> Self {
        Self {
            backend: Some(backend),
            ..Self::default()
        }
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
        state.next_autosave_serial = state.next_autosave_serial.wrapping_add(1);
        let pending = PendingAutosave {
            serial: state.next_autosave_serial,
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

fn retry_eligibility(state: &mut CoordinatorState, identity: (u64, u64)) -> RetryEligibility {
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

fn clear_thumbnail_activity_if_no_live_capture(
    state: &mut CoordinatorState,
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

fn publish_activity(subscribers: &[ActivitySubscriber], view: &ThumbnailActivityView) {
    for subscriber in subscribers {
        subscriber(view.clone());
    }
}

fn publish_exit(subscribers: &[ExitSubscriber], view: &ExitStatusView) {
    for subscriber in subscribers {
        subscriber(view.clone());
    }
}

async fn thumbnail_ticket_expiry_task(
    state: Weak<Mutex<CoordinatorState>>,
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
    #[cfg(feature = "e2e")]
    mod e2e_replacement;
    mod exit_lifecycle;
    mod failure_token;
    mod flush;
    mod lock_order;
    mod storage_integration;
    mod ticket;
    mod unit;
}
