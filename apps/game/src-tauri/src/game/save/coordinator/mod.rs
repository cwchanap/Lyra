use super::capture::CapturedCheckpointV2;
#[cfg(feature = "e2e")]
use super::e2e_faults::{E2ePersistenceFaultBoundary, E2ePersistenceFaultState};
use super::schema::{
    SaveDiagnosticView, SaveEnvelopeV2, SaveSlotRef, SaveSlotView, SaveType, ThumbnailDescriptorV1,
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

pub(crate) type CoordinatorTask = Pin<Box<dyn Future<Output = ()> + Send + 'static>>;

pub(crate) trait CoordinatorTaskScheduler: Send + Sync {
    /// Accepts ownership of `task`. Returning an error means the task was not
    /// accepted and will never be polled.
    fn spawn(&self, task: CoordinatorTask) -> Result<(), GameError>;
}

struct PortableCoordinatorTaskScheduler {
    runtime: Option<tokio::runtime::Handle>,
    fallback: Mutex<Option<tokio::runtime::Handle>>,
}

impl PortableCoordinatorTaskScheduler {
    fn capture() -> Self {
        Self {
            runtime: tokio::runtime::Handle::try_current().ok(),
            fallback: Mutex::new(None),
        }
    }
}

impl CoordinatorTaskScheduler for PortableCoordinatorTaskScheduler {
    fn spawn(&self, task: CoordinatorTask) -> Result<(), GameError> {
        if let Some(handle) = tokio::runtime::Handle::try_current()
            .ok()
            .or_else(|| self.runtime.clone())
        {
            handle.spawn(task);
            return Ok(());
        }
        let handle = {
            let mut guard = self
                .fallback
                .lock()
                .map_err(|_| GameError::save_write_failed())?;
            if guard.is_none() {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|_| GameError::save_write_failed())?;
                let handle = runtime.handle().clone();
                std::thread::Builder::new()
                    .name("lyra-save-coordinator".into())
                    .spawn(move || runtime.block_on(std::future::pending::<()>()))
                    .map_err(|_| GameError::save_write_failed())?;
                *guard = Some(handle);
            }
            guard.as_ref().unwrap().clone()
        };
        handle.spawn(task);
        Ok(())
    }
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
    checkpoint: Option<CapturedCheckpointV2>,
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
        checkpoint: CapturedCheckpointV2,
        content_revision: String,
    ) -> Self {
        Self {
            job,
            slots,
            checkpoint: Some(checkpoint),
            content_revision: Some(content_revision),
        }
    }

    pub(crate) fn captured_checkpoint(&self) -> Result<(CapturedCheckpointV2, String), GameError> {
        self.checkpoint
            .clone()
            .zip(self.content_revision.clone())
            .ok_or_else(GameError::save_write_failed)
    }

    pub(crate) fn register(
        self,
        target: SaveSlotRef,
        save_id: String,
        mut envelope: SaveEnvelopeV2,
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
        envelope: &SaveEnvelopeV2,
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

    fn commit_with_gate_held(
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

pub(crate) struct AcknowledgementOutcome {
    pub(crate) state: crate::game::GameStateView,
    pub(crate) cleanup_diagnostic: Option<SaveDiagnosticView>,
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
    ContinueWithoutSaving,
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

fn selected_save_challenge_key(reference: SaveSlotRef, observed_save_id: &str) -> String {
    let (save_type, slot) = match reference {
        SaveSlotRef::Auto { slot } => ("auto", slot),
        SaveSlotRef::Manual { slot } => ("manual", slot),
    };
    format!("{save_type}:{slot}:{observed_save_id}")
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SessionTransitionIdentity {
    pub(crate) generation: u64,
    pub(crate) durable_revision: Option<u64>,
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
        if self.persistence.exclusive_intent.is_some() || self.persistence.exit_flush_requested {
            Err(GameError::persistence_operation_in_progress())
        } else {
            Ok(())
        }
    }

    pub(crate) fn ensure_rendered_state_available(&self) -> Result<(), GameError> {
        if self.persistence.exclusive_intent.is_some() {
            Err(GameError::persistence_operation_in_progress())
        } else {
            Ok(())
        }
    }

    fn ensure_exit_flush_available(&self) -> Result<(), GameError> {
        if self.persistence.exclusive_intent.is_none() && self.persistence.exit_flush_requested {
            Ok(())
        } else {
            Err(GameError::persistence_operation_in_progress())
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

struct AcknowledgementIntentGuard<'a> {
    app: &'a crate::AppState,
    session_generation: u64,
    intent_updates: Arc<Notify>,
}

impl<'a> AcknowledgementIntentGuard<'a> {
    fn new(app: &'a crate::AppState, session_generation: u64, intent_updates: Arc<Notify>) -> Self {
        Self {
            app,
            session_generation,
            intent_updates,
        }
    }
}

impl Drop for AcknowledgementIntentGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut session) = self.app.session.lock() {
            let mut cleared = false;
            if session.persistence.generation == self.session_generation
                && session.persistence.exclusive_intent
                    == Some(ExclusivePersistenceIntent::AcquisitionAcknowledgement)
            {
                session.end_acknowledgement();
                cleared = true;
            }
            drop(session);
            if cleared {
                self.intent_updates.notify_one();
            }
        }
    }
}

struct AcknowledgementRollbackGuard<'a> {
    app: &'a crate::AppState,
    rollback: Option<EngineRollbackSnapshot>,
    session_generation: u64,
    source_revision: u64,
    next_revision: u64,
}

impl<'a> AcknowledgementRollbackGuard<'a> {
    fn new(
        app: &'a crate::AppState,
        rollback: EngineRollbackSnapshot,
        session_generation: u64,
        source_revision: u64,
        next_revision: u64,
    ) -> Self {
        Self {
            app,
            rollback: Some(rollback),
            session_generation,
            source_revision,
            next_revision,
        }
    }

    fn restore_now(&mut self) -> Result<(), GameError> {
        let mut session = self
            .app
            .session
            .lock()
            .map_err(|_| GameError::unavailable())?;
        if session.persistence.generation != self.session_generation
            || session.persistence.exclusive_intent
                != Some(ExclusivePersistenceIntent::AcquisitionAcknowledgement)
        {
            return Err(GameError::save_write_failed());
        }
        let engine = session
            .engine
            .as_mut()
            .ok_or_else(GameError::game_not_started)?;
        if engine.durable_revision() != self.next_revision {
            return Err(GameError::save_write_failed());
        }
        let rollback = self
            .rollback
            .take()
            .ok_or_else(GameError::save_write_failed)?;
        EngineRollbackSnapshot::restore(engine, rollback);
        if engine.durable_revision() != self.source_revision {
            return Err(GameError::save_write_failed());
        }
        Ok(())
    }

    fn disarm(&mut self) {
        self.rollback = None;
    }
}

impl Drop for AcknowledgementRollbackGuard<'_> {
    fn drop(&mut self) {
        let Some(rollback) = self.rollback.take() else {
            return;
        };
        let Ok(mut session) = self.app.session.lock() else {
            return;
        };
        if session.persistence.generation != self.session_generation
            || session.persistence.exclusive_intent
                != Some(ExclusivePersistenceIntent::AcquisitionAcknowledgement)
        {
            return;
        }
        let Some(engine) = session.engine.as_mut() else {
            return;
        };
        if engine.durable_revision() != self.next_revision {
            return;
        }
        EngineRollbackSnapshot::restore(engine, rollback);
        debug_assert_eq!(engine.durable_revision(), self.source_revision);
    }
}

pub(crate) struct SessionPersistence {
    pub(crate) generation: u64,
    pub(crate) flush_baseline_revision: u64,
    pub(crate) written_revision: Option<u64>,
    pub(crate) autosave_target: Option<SaveSlotRef>,
    pub(crate) exclusive_intent: Option<ExclusivePersistenceIntent>,
    pub(crate) exit_flush_requested: bool,
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
            exit_flush_requested: false,
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
    ManualSave,
    DeleteSave,
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
    #[cfg(feature = "e2e")]
    fn invalidate_queued_for_e2e(&self) -> Result<u64, GameError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| GameError::save_write_failed())?;
        let minimum_cleanup_attempt = state
            .next_cleanup_attempt
            .checked_add(1)
            .ok_or_else(GameError::save_write_failed)?;
        state.acknowledgements.clear();
        state.ordinary.clear();
        state.next_cleanup_attempt = minimum_cleanup_attempt;
        Ok(minimum_cleanup_attempt)
    }

    fn enqueue(
        self: &Arc<Self>,
        scheduler: Arc<dyn CoordinatorTaskScheduler>,
        class: WriterJobClass,
        run: CoordinatorFuture<'static, ()>,
    ) -> Result<(), GameError> {
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| GameError::save_write_failed())?;
            if state.running {
                Self::enqueue_locked(&mut state, class, run);
                return Ok(());
            }
        }
        let start = self.schedule_worker_candidate(scheduler)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| GameError::save_write_failed())?;
        let start_worker = Self::enqueue_locked(&mut state, class, run);
        drop(state);
        if start_worker {
            start.send(()).map_err(|_| GameError::save_write_failed())?;
        }
        Ok(())
    }

    fn enqueue_cleanup<F>(
        self: &Arc<Self>,
        scheduler: Arc<dyn CoordinatorTaskScheduler>,
        owner: Option<CleanupOwner>,
        make_run: F,
    ) -> Result<(), GameError>
    where
        F: FnOnce(CleanupOwner) -> CoordinatorFuture<'static, ()>,
    {
        #[cfg(test)]
        {
            let hook = self.cleanup_before_lock.lock().unwrap().take();
            if let Some(hook) = hook {
                hook();
            }
        }
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| GameError::save_write_failed())?;
            if state.running {
                let owner = owner.unwrap_or_else(|| {
                    state.next_cleanup_attempt = state.next_cleanup_attempt.wrapping_add(1);
                    CleanupOwner::Attempt(state.next_cleanup_attempt)
                });
                Self::enqueue_locked(&mut state, WriterJobClass::OrphanCleanup, make_run(owner));
                return Ok(());
            }
        }
        let start = self.schedule_worker_candidate(scheduler)?;
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
        if start_worker {
            start.send(()).map_err(|_| GameError::save_write_failed())?;
        }
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

    fn schedule_worker_candidate(
        self: &Arc<Self>,
        scheduler: Arc<dyn CoordinatorTaskScheduler>,
    ) -> Result<tokio::sync::oneshot::Sender<()>, GameError> {
        let queue = Arc::clone(self);
        let (start_tx, start_rx) = tokio::sync::oneshot::channel();
        scheduler.spawn(Box::pin(async move {
            if start_rx.await.is_ok() {
                queue.run().await;
            }
        }))?;
        Ok(start_tx)
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
type ExitSubscriber = Arc<dyn Fn(ExitStatusView) + Send + Sync>;

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

enum FailureTokenSource {
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

struct CoordinatorState {
    tickets: HashMap<String, TicketRecord>,
    latest_by_intent: HashMap<CaptureIntent, String>,
    persistence_health: PersistenceHealthView,
    thumbnail_activity: ThumbnailActivityView,
    health_subscribers: Vec<HealthSubscriber>,
    activity_subscribers: Vec<ActivitySubscriber>,
    exit_subscribers: Vec<ExitSubscriber>,
    next_session_generation: u64,
    discovery_generation: u64,
    next_autosave_serial: u64,
    pending_autosave: Option<PendingAutosave>,
    registered_autosave_targets: HashMap<(u64, u64), SaveSlotRef>,
    last_successful_write: Option<AutosaveWriteReceipt>,
    failed_write: Option<BackgroundWriteFailure>,
    cleanup_failure: Option<CleanupFailure>,
    minimum_cleanup_attempt: u64,
    failure_challenges: HashMap<Uuid, PersistenceFailureChallenge>,
    failure_token_source: FailureTokenSource,
    exit_status: ExitStatusView,
    programmatic_exit_bypass: bool,
    exit_action_in_progress: bool,
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
            pending_autosave: None,
            registered_autosave_targets: HashMap::new(),
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
                        acquisition_event_id: identity.acquisition_event_id.map(str::to_owned),
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
    replacement_gate: Arc<tokio::sync::Mutex<()>>,
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
    state: Arc<Mutex<CoordinatorState>>,
    ticket_updates: Arc<Notify>,
    writer_queue: Arc<WriterQueue>,
    backend: Option<Arc<dyn AutosaveBackend>>,
    fail_next_schedule: Arc<AtomicBool>,
    exit_application: Option<ExitApplicationContext>,
    task_scheduler: Arc<dyn CoordinatorTaskScheduler>,
    exit_transition: Arc<Mutex<()>>,
    fail_next_exit_prerequisite: Arc<AtomicBool>,
    fail_next_cancel_guard_clear: Arc<AtomicBool>,
    fail_next_exit_challenge: Arc<AtomicBool>,
    #[cfg(test)]
    panic_next_exit_worker: Arc<AtomicBool>,
    exclusive_updates: Arc<Notify>,
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
            writer_queue: Arc::new(WriterQueue::default()),
            backend: None,
            fail_next_schedule: Arc::new(AtomicBool::new(false)),
            exit_application: None,
            task_scheduler: Arc::new(PortableCoordinatorTaskScheduler::capture()),
            exit_transition: Arc::new(Mutex::new(())),
            fail_next_exit_prerequisite: Arc::new(AtomicBool::new(false)),
            fail_next_cancel_guard_clear: Arc::new(AtomicBool::new(false)),
            fail_next_exit_challenge: Arc::new(AtomicBool::new(false)),
            #[cfg(test)]
            panic_next_exit_worker: Arc::new(AtomicBool::new(false)),
            exclusive_updates: Arc::new(Notify::new()),
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
        replacement_gate: Arc<tokio::sync::Mutex<()>>,
    ) -> Self {
        Self {
            exit_application: Some(ExitApplicationContext {
                session,
                replacement_gate,
            }),
            ..Self::default()
        }
    }

    pub(crate) fn with_backend_for_application(
        backend: Arc<dyn AutosaveBackend>,
        session: Arc<Mutex<AppSession>>,
        replacement_gate: Arc<tokio::sync::Mutex<()>>,
    ) -> Self {
        Self {
            backend: Some(backend),
            exit_application: Some(ExitApplicationContext {
                session,
                replacement_gate,
            }),
            ..Self::default()
        }
    }

    pub(crate) fn with_exit_application(
        mut self,
        session: Arc<Mutex<AppSession>>,
        replacement_gate: Arc<tokio::sync::Mutex<()>>,
    ) -> Self {
        self.exit_application = Some(ExitApplicationContext {
            session,
            replacement_gate,
        });
        self
    }

    pub(crate) fn with_task_scheduler(
        mut self,
        scheduler: Arc<dyn CoordinatorTaskScheduler>,
    ) -> Self {
        self.task_scheduler = scheduler;
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
                acquisition_event_id: None,
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
                acquisition_event_id: None,
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
                acquisition_event_id: None,
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
            acquisition_event_id: None,
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
        self.task_scheduler.spawn(Box::pin(async move {
            let Ok(recovery) = start_rx.await else {
                return;
            };
            let mut recovery = ExitAttemptRecoveryGuard::new(coordinator.clone(), recovery);
            #[cfg(test)]
            if coordinator
                .panic_next_exit_worker
                .swap(false, Ordering::SeqCst)
            {
                panic!("controlled post-start exit worker panic");
            }
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
        }))?;
        Ok(start_tx)
    }

    async fn flush_for_exit(&self) -> Result<(), GameError> {
        let application = self
            .exit_application
            .as_ref()
            .ok_or_else(GameError::save_write_failed)?;
        loop {
            let update = self.exclusive_updates.notified();
            let acknowledgement_active = application
                .session
                .lock()
                .map_err(|_| GameError::unavailable())?
                .persistence
                .exclusive_intent
                .is_some();
            if !acknowledgement_active {
                break;
            }
            update.await;
        }
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
            &application.replacement_gate,
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
                acquisition_event_id: None,
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

        let _gate = app.replacement_gate.lock().await;
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
        // Keep the coordinator state locked while invalidating the writer queue and
        // installing the session. An active stale writer therefore cannot enqueue a
        // follow-up between queue invalidation and the generation fence becoming live.
        let minimum_cleanup_attempt = self.writer_queue.invalidate_queued_for_e2e()?;
        state.next_session_generation = generation;
        state.discovery_generation = state.discovery_generation.wrapping_add(1);
        state.next_autosave_serial = state.next_autosave_serial.wrapping_add(1);
        state.tickets.clear();
        state.latest_by_intent.clear();
        state.pending_autosave = None;
        state.registered_autosave_targets.clear();
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
        self.fail_next_schedule.store(false, Ordering::SeqCst);
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
        self.exclusive_updates.notify_waiters();

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
        let _gate = app.replacement_gate.lock().await;
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
        let _gate = app.replacement_gate.lock().await;
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
        let _gate = app.replacement_gate.lock().await;
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
        let _gate = app.replacement_gate.lock().await;
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
            return Err(GameError::save_write_failed());
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
        let _gate = app.replacement_gate.lock().await;
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
            PersistenceBypassOperation::ContinueWithoutSaving
            | PersistenceBypassOperation::ExitWithoutSaving => {
                return Err(GameError::stale_persistence_failure_token());
            }
        }
        let (session_generation, durable_revision) =
            if let Some(event_id) = challenge.acquisition_event_id.as_deref() {
                current_acquisition_failure_identity(app, event_id)?
            } else {
                let identity = self.transition_identity(app)?;
                (identity.generation, identity.durable_revision.unwrap_or(0))
            };
        let current = FailureChallengeIdentity {
            session_generation,
            discovery_generation: challenge.discovery_generation,
            durable_revision,
            selected_save_id: challenge.selected_save_id.as_deref(),
            acquisition_event_id: challenge.acquisition_event_id.as_deref(),
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
                acquisition_event_id: None,
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
                acquisition_event_id: None,
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
                acquisition_event_id: None,
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
                acquisition_event_id: None,
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
                acquisition_event_id: None,
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
            acquisition_event_id: None,
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
            acquisition_event_id: None,
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
                acquisition_event_id: None,
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
        self.flush_session_parts(&app.session, &app.replacement_gate, operation)
            .await
    }

    async fn flush_session_parts(
        &self,
        session_state: &Arc<Mutex<AppSession>>,
        replacement_gate: &Arc<tokio::sync::Mutex<()>>,
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
        let thumbnail = self
            .cancel_pending_autosave_covered_by_flush(session_generation, flush_revision)?
            .unwrap_or(CaptureTerminalResult::Unavailable);

        #[cfg(feature = "e2e")]
        if operation == FlushOperation::Exit {
            self.e2e_persistence_faults
                .fire(E2ePersistenceFaultBoundary::ExitFlush)
                .map_err(|_| GameError::save_write_failed())?;
        }

        let (result_tx, result_rx) = tokio::sync::oneshot::channel();
        let coordinator = self.clone();
        if let Err(error) = self.writer_queue.enqueue(
            Arc::clone(&self.task_scheduler),
            WriterJobClass::BlockingFlush {
                session_generation,
                durable_revision: flush_revision,
            },
            Box::pin(async move {
                let result = coordinator
                    .execute_blocking_flush(
                        session_generation,
                        flush_revision,
                        preferred_target,
                        thumbnail,
                    )
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

        let _gate = replacement_gate.lock().await;
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
        let _intent_guard = AcknowledgementIntentGuard::new(
            app,
            session_generation,
            Arc::clone(&self.exclusive_updates),
        );

        self.cancel_pending_autosave_covered_by_flush(session_generation, source_revision)?;

        let (turn_tx, turn_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();
        self.writer_queue.enqueue(
            Arc::clone(&self.task_scheduler),
            WriterJobClass::AcquisitionAcknowledgement,
            Box::pin(async move {
                let _ = turn_tx.send(());
                let _ = release_rx.await;
            }),
        )?;
        if turn_rx.await.is_err() {
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
        let retained_target = self.registered_autosave_target(session_generation, source_revision);
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
                let preferred_target = retained_target.or(session.persistence.autosave_target);
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
                let mut rollback_guard = AcknowledgementRollbackGuard::new(
                    app,
                    rollback,
                    session_generation,
                    source_revision,
                    next_revision,
                );
                let write_result = self
                    .execute_acknowledgement_write(
                        session_generation,
                        next_revision,
                        preferred_target,
                        thumbnail,
                    )
                    .await;
                match write_result {
                    Ok((receipt, cleanup_diagnostic)) => {
                        let mut session =
                            app.session.lock().map_err(|_| GameError::unavailable())?;
                        if session.persistence.generation != session_generation
                            || session.persistence.exclusive_intent
                                != Some(ExclusivePersistenceIntent::AcquisitionAcknowledgement)
                            || session.durable_revision() != Some(next_revision)
                        {
                            return Err(GameError::save_write_failed());
                        }
                        session.persistence.record_written(&receipt);
                        self.record_blocking_success(receipt, cleanup_diagnostic.clone());
                        rollback_guard.disarm();
                        Ok(AcknowledgementOutcome {
                            state,
                            cleanup_diagnostic,
                        })
                    }
                    Err(error) => {
                        rollback_guard.restore_now()?;
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
        let committed = match backend.commit_with_gate_held(prepared).await? {
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

    async fn execute_blocking_flush(
        &self,
        session_generation: u64,
        durable_revision: u64,
        preferred_target: Option<SaveSlotRef>,
        thumbnail: CaptureTerminalResult,
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
            self.record_background_failure(session_generation, durable_revision, error.clone());
        }
        write_result
    }

    fn cancel_pending_autosave_covered_by_flush(
        &self,
        session_generation: u64,
        durable_revision: u64,
    ) -> Result<Option<CaptureTerminalResult>, GameError> {
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
            if state.latest_by_intent.get(&CaptureIntent::Autosave) == Some(&pending.ticket) {
                state.latest_by_intent.remove(&CaptureIntent::Autosave);
            }
            (
                Some(thumbnail),
                set_thumbnail_activity(&mut state, ThumbnailActivityView::Idle),
            )
        };
        publish_activity(&subscribers, &ThumbnailActivityView::Idle);
        self.ticket_updates.notify_waiters();
        Ok(thumbnail)
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

    fn record_registered_autosave_target(
        &self,
        session_generation: u64,
        durable_revision: u64,
        target: SaveSlotRef,
    ) -> Result<(), GameError> {
        let mut state = self.lock_state()?;
        if session_generation < state.next_session_generation {
            return Ok(());
        }
        let identity = (session_generation, durable_revision);
        if state
            .registered_autosave_targets
            .keys()
            .any(|registered| *registered > identity)
        {
            return Ok(());
        }
        state
            .registered_autosave_targets
            .retain(|registered, _| *registered >= identity);
        state.registered_autosave_targets.insert(identity, target);
        Ok(())
    }

    fn registered_autosave_target(
        &self,
        session_generation: u64,
        durable_revision: u64,
    ) -> Option<SaveSlotRef> {
        self.state.lock().ok().and_then(|state| {
            state
                .registered_autosave_targets
                .get(&(session_generation, durable_revision))
                .copied()
        })
    }

    pub(crate) fn reserve_acknowledgement_writer(
        &self,
        run: CoordinatorFuture<'static, ()>,
    ) -> Result<(), GameError> {
        self.writer_queue.enqueue(
            Arc::clone(&self.task_scheduler),
            WriterJobClass::AcquisitionAcknowledgement,
            run,
        )
    }

    pub(crate) fn reserve_manual_writer(
        &self,
        run: CoordinatorFuture<'static, ()>,
    ) -> Result<(), GameError> {
        self.writer_queue.enqueue(
            Arc::clone(&self.task_scheduler),
            WriterJobClass::ManualSave,
            run,
        )
    }

    pub(crate) fn reserve_delete_writer(
        &self,
        run: CoordinatorFuture<'static, ()>,
    ) -> Result<(), GameError> {
        self.writer_queue.enqueue(
            Arc::clone(&self.task_scheduler),
            WriterJobClass::DeleteSave,
            run,
        )
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
        self.writer_queue
            .enqueue_cleanup(Arc::clone(&self.task_scheduler), owner, move |owner| {
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
                PreparedThumbnailPurpose::AcquisitionAcknowledgement { event_id } => {
                    if engine
                        .pending_acquisition_events
                        .iter()
                        .filter(|event| event.id == event_id)
                        .count()
                        != 1
                    {
                        return Err(GameError::unknown_acquisition_event());
                    }
                    ThumbnailCapturePurpose::AcquisitionAcknowledgement {
                        session_generation,
                        source_revision: durable_revision,
                        next_revision: durable_revision
                            .checked_add(1)
                            .ok_or_else(GameError::save_write_failed)?,
                        event_id,
                    }
                }
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
    ) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        if state.next_session_generation != session_generation {
            return false;
        }
        state.persistence_health = view.clone();
        let subscribers = state.health_subscribers.clone();
        drop(state);
        for subscriber in subscribers {
            subscriber(view.clone());
        }
        true
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
        self.task_scheduler.spawn(Box::pin(async move {
            tokio::time::sleep_until(pending.debounce_deadline).await;
            coordinator.run_pending_autosave(pending).await;
        }))?;
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
            Arc::clone(&self.task_scheduler),
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
        if let Err(error) = self.record_registered_autosave_target(
            pending.session_generation,
            pending.durable_revision,
            target,
        ) {
            self.record_background_failure(
                pending.session_generation,
                pending.durable_revision,
                error,
            );
            return;
        }
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
            if receipt.session_generation < state.next_session_generation {
                return;
            }
            let completed_is_current = state
                .pending_autosave
                .as_ref()
                .is_some_and(|pending| pending.serial == completed.serial);
            let receipt_identity = (receipt.session_generation, receipt.durable_revision);
            state
                .registered_autosave_targets
                .retain(|identity, _| *identity > receipt_identity);
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
            state
                .registered_autosave_targets
                .retain(|identity, _| *identity > receipt_identity);
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

    fn record_background_failure(
        &self,
        session_generation: u64,
        durable_revision: u64,
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
        if let Err(error) = self.task_scheduler.spawn(thumbnail_ticket_expiry_task(
            Arc::downgrade(&self.state),
            ticket.clone(),
            deadline_at,
            Arc::downgrade(&self.ticket_updates),
        )) {
            // The expiry task never started, so without an explicit terminal
            // publication the activity would remain stuck at `Capturing` for
            // any subscriber that already observed it. Revert to a terminal
            // `Unavailable` view (the same terminal state the expiry task
            // publishes on timeout) while preserving the ticket /
            // latest_by_intent cleanup and the original error return.
            let terminal = capture_unavailable_activity();
            let activity_subscribers = if let Ok(mut state) = self.state.lock() {
                if let Some(record) = state.tickets.remove(&ticket) {
                    let intent = record.purpose.intent();
                    if state.latest_by_intent.get(&intent) == Some(&ticket) {
                        state.latest_by_intent.remove(&intent);
                    }
                }
                set_thumbnail_activity(&mut state, terminal.clone())
            } else {
                Vec::new()
            };
            publish_activity(&activity_subscribers, &terminal);
            return Err(error);
        }
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

    pub(crate) fn with_backend(backend: Arc<dyn AutosaveBackend>) -> Self {
        Self {
            backend: Some(backend),
            ..Self::default()
        }
    }

    #[cfg(test)]
    pub(crate) fn fail_next_schedule_for_test(&self) {
        self.fail_next_schedule.store(true, Ordering::SeqCst);
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
    fn panic_next_exit_worker_for_test(&self) {
        self.panic_next_exit_worker.store(true, Ordering::SeqCst);
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
                Arc::clone(&self.task_scheduler),
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

fn publish_exit(subscribers: &[ExitSubscriber], view: &ExitStatusView) {
    for subscriber in subscribers {
        subscriber(view.clone());
    }
}

fn thumbnail_ticket_expiry_task(
    state: Weak<Mutex<CoordinatorState>>,
    ticket: String,
    deadline_at: Instant,
    updates: Weak<Notify>,
) -> CoordinatorTask {
    Box::pin(async move {
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
    })
}

#[cfg(test)]
mod tests {
    mod acknowledgement;
    mod debounce;
    #[cfg(feature = "e2e")]
    mod e2e_replacement;
    mod exit_lifecycle;
    mod failure_token;
    mod flush;
    mod lock_order;
    mod storage_integration;
    mod ticket;
    mod writer;
}
