use super::super::{
    AutosaveBackend, AutosaveCapture, AutosaveCommitOutcome, AutosavePreparedWrite,
    AutosaveRegisteredIntent, AutosaveWriteJob, CaptureTerminalResult, CoordinatorFuture,
    PersistenceHealthView, SaveCoordinator, SaveSlotRef, AUTOSAVE_DEBOUNCE,
};
use crate::game::save::schema::{
    parse_current_envelope, SaveEnvelope, SaveSlotStatusView, SaveSlotView, SaveType,
};
use crate::game::save::storage::{
    ProductionSaveFilesystem, SaveFileMetadata, SaveFilesystem, StagedAtomicWrite,
};
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

    fn stage_atomic(&self, path: &Path, bytes: &[u8]) -> io::Result<Box<dyn StagedAtomicWrite>> {
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
    gate: Arc<AsyncMutex<()>>,
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
            gate: Arc::new(AsyncMutex::new(())),
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

    /// Shared revalidation, commit, receipt-corruption, and finish flow used
    /// by `commit_if_current`, which holds the writer lock and the gate and
    /// records the `"G"` phase before delegating here.
    async fn commit_locked(
        &self,
        prepared: AutosavePreparedWrite,
    ) -> Result<AutosaveCommitOutcome, GameError> {
        let _session = self.session.lock().await;
        self.revalidate_held_gate_and_session.store(
            self.gate.try_lock().is_err() && self.session.try_lock().is_err(),
            Ordering::SeqCst,
        );
        self.phases.lock().unwrap().push("G:S:revalidate");
        if prepared.session_generation() != self.current_generation.load(Ordering::SeqCst)
            || prepared.durable_revision() != self.current_revision.load(Ordering::SeqCst)
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
                committed.receipt.save_id = "22222222-2222-4222-8222-222222222222".into();
            }
            Some(CommitReceiptCorruption::Slot) => {
                committed.receipt.slot = SaveSlotRef::Auto { slot: 2 };
            }
            None => {}
        }
        self.finish();
        Ok(AutosaveCommitOutcome::Committed(committed))
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

    pub(super) fn operation_gate(&self) -> Arc<AsyncMutex<()>> {
        Arc::clone(&self.gate)
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

    fn corrupt_registration(&self, corruption: RegistrationCorruption) {
        *self.corruption.lock().unwrap() = Some(corruption);
    }

    fn corrupt_commit_receipt(&self, corruption: CommitReceiptCorruption) {
        *self.commit_receipt_corruption.lock().unwrap() = Some(corruption);
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
            self.commit_locked(prepared).await
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
    let persisted: serde_json::Value =
        serde_json::from_slice(&backend.fs.read(&backend.slot_path(1)).unwrap()).unwrap();
    assert_eq!(persisted["schemaVersion"], serde_json::json!(2));
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

// Required behavior A (HPA-549): a pre-acknowledgement save must cross a real
// staged save-file write and a real restore before the popup replay contract
// is proven. An in-memory clone would not cross serialization, so this test
// writes through the production `prepare_slot_write`/`commit_prepared_slot_write`
// seam, reads the file back through `read_save_envelope`, and restores it with
// `build_restore_candidate` against the same definitions.
//
// durable acquisition -> unsaved acknowledgement -> process loss -> real file
// restore -> popup replay -> no duplicate acquisition.
#[test]
fn real_file_pre_acknowledgement_save_replays_pending_popup_without_duplicate_acquisition() {
    use crate::game::save::capture::capture_checkpoint;
    use crate::game::save::restore::{build_restore_candidate, load_current_definitions};
    use crate::game::save::schema::{
        SaveEnvelope, SaveType, ThumbnailDescriptorV1, SAVE_SCHEMA_VERSION,
    };
    use crate::game::save::storage::{
        commit_prepared_slot_write, prepare_slot_write, read_save_envelope, SlotWriteRequest,
        ThumbnailWrite,
    };
    use crate::game::test_support::{
        drive_hpa_257_positive_progression, hpa_257_fixture_resources,
    };
    use crate::game::GameEngine;

    const SAVE_ID: &str = "11111111-1111-4111-8111-111111111111";

    // 1. Build valid fixture resources and an engine state containing exactly
    //    one acquired record, a simple story output (the asserted fact), and
    //    the pending acquisition event.
    let (_guard, resources) = hpa_257_fixture_resources();
    let mut engine = GameEngine::new_started(resources.clone()).unwrap();
    drive_hpa_257_positive_progression(&mut engine);
    assert_eq!(engine.inventory.evidence.len(), 1);
    assert_eq!(engine.pending_acquisition_events.len(), 1);
    let event_id = engine.pending_acquisition_events[0].id.clone();
    let story_before = engine.story_state.snapshot();
    assert!(story_before.facts.contains_key("fact_a"));

    // 2-3. Capture the pre-acknowledgement checkpoint and write it to a temp
    //      save through the real production save storage writer.
    let backend = Arc::new(StorageBackend::new(1, engine.durable_revision));
    let checkpoint = capture_checkpoint(&engine).unwrap();
    let envelope = SaveEnvelope {
        schema_version: SAVE_SCHEMA_VERSION,
        content_revision: engine.content_revision().into(),
        save_id: SAVE_ID.into(),
        save_type: SaveType::Auto,
        slot: 1,
        saved_at: "2026-07-26T12:34:56Z".into(),
        display_name: "Replay fixture".into(),
        thumbnail: ThumbnailDescriptorV1::Unavailable,
        summary: checkpoint.summary,
        snapshot: checkpoint.snapshot,
    };
    let prepared = prepare_slot_write(
        backend.fs.as_ref(),
        &backend.root,
        SlotWriteRequest {
            reference: SaveSlotRef::Auto { slot: 1 },
            envelope,
            thumbnail: ThumbnailWrite::Unavailable,
            expected_manual: None,
        },
    )
    .unwrap();
    let outcome = commit_prepared_slot_write(backend.fs.as_ref(), &backend.root, prepared).unwrap();
    assert_eq!(outcome.committed_envelope.save_id, SAVE_ID);
    assert_eq!(outcome.cleanup_diagnostic, None);

    // 4. Acknowledge the live in-memory event; the record and story outputs
    //    must survive untouched.
    let live_revision = engine.durable_revision;
    engine.acknowledge_acquisition_event(&event_id).unwrap();
    assert!(engine.pending_acquisition_events.is_empty());
    assert_eq!(engine.durable_revision, live_revision + 1);
    assert_eq!(engine.inventory.evidence.len(), 1);
    assert_eq!(engine.story_state.snapshot(), story_before);

    // 5-6. Read the file back through the real save reader and restore it
    //      with matching current definitions/resources.
    let saved = read_save_envelope(
        backend.fs.as_ref(),
        &backend.root,
        SaveSlotRef::Auto { slot: 1 },
        SAVE_ID,
    )
    .unwrap();
    let definitions = load_current_definitions(&resources).unwrap();
    let restored = build_restore_candidate(resources, &definitions, saved).unwrap();
    assert_eq!(restored.save_id, SAVE_ID);
    assert_eq!(restored.source, SaveSlotRef::Auto { slot: 1 });

    // 7. The restored engine holds the record exactly once, the story output
    //    exactly once, and the pending acquisition event again.
    let mut restored_engine = restored.engine;
    assert_eq!(restored_engine.inventory.evidence.len(), 1);
    assert_eq!(restored_engine.story_state.snapshot(), story_before);
    assert_eq!(restored_engine.pending_acquisition_events.len(), 1);
    assert_eq!(restored_engine.pending_acquisition_events[0].id, event_id);

    // 8. Acknowledge the replayed popup again: the pending event clears and
    //    the record/story counts remain single (no double grant).
    let restored_revision = restored_engine.durable_revision;
    restored_engine
        .acknowledge_acquisition_event(&event_id)
        .unwrap();
    assert!(restored_engine.pending_acquisition_events.is_empty());
    assert_eq!(restored_engine.durable_revision, restored_revision + 1);
    assert_eq!(restored_engine.inventory.evidence.len(), 1);
    assert_eq!(restored_engine.story_state.snapshot(), story_before);
}
