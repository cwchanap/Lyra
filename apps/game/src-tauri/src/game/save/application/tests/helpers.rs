use super::super::{AppSession, ApplicationPersistence};
use crate::game::save::capture::CapturedCheckpoint;
use crate::game::save::coordinator::{
    AutosaveCapture, AutosaveRegisteredIntent, AutosaveWriteJob, CaptureTerminalResult,
    SaveCoordinator,
};
use crate::game::save::restore::load_current_definitions;
use crate::game::save::schema::{SaveSlotRef, SaveType};
use crate::game::save::storage::{
    ensure_save_layout, ProductionSaveFilesystem, SaveDiscoveryContext, SaveFileMetadata,
    SaveFilesystem, StagedAtomicWrite,
};
use crate::game::test_support::{representative_save_envelope, save_capture_fixture_resources};
use crate::game::GameEngine;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use tokio::sync::Notify;

pub(super) struct TrackingFilesystem {
    inner: ProductionSaveFilesystem,
    installed: Arc<AtomicUsize>,
    discarded: Arc<AtomicUsize>,
    active_mutations: AtomicUsize,
    max_concurrent_mutations: AtomicUsize,
    stage_reached: AtomicBool,
    pause_staging: AtomicBool,
    stage_update: Notify,
    release_staging: (Mutex<()>, Condvar),
}

impl Default for TrackingFilesystem {
    fn default() -> Self {
        Self {
            inner: ProductionSaveFilesystem,
            installed: Arc::new(AtomicUsize::new(0)),
            discarded: Arc::new(AtomicUsize::new(0)),
            active_mutations: AtomicUsize::new(0),
            max_concurrent_mutations: AtomicUsize::new(0),
            stage_reached: AtomicBool::new(false),
            pause_staging: AtomicBool::new(false),
            stage_update: Notify::new(),
            release_staging: (Mutex::new(()), Condvar::new()),
        }
    }
}

impl TrackingFilesystem {
    pub(super) fn pause_staging(&self) {
        self.pause_staging.store(true, Ordering::SeqCst);
    }

    pub(super) fn release_staging(&self) {
        self.pause_staging.store(false, Ordering::SeqCst);
        self.release_staging.1.notify_all();
    }

    pub(super) async fn wait_for_stage(&self) {
        loop {
            if self.stage_reached.load(Ordering::SeqCst) {
                return;
            }
            self.stage_update.notified().await;
        }
    }

    pub(super) fn max_concurrent_mutations(&self) -> usize {
        self.max_concurrent_mutations.load(Ordering::SeqCst)
    }

    pub(super) fn discarded_count(&self) -> usize {
        self.discarded.load(Ordering::SeqCst)
    }

    fn begin_mutation(&self) -> MutationGuard<'_> {
        let active = self.active_mutations.fetch_add(1, Ordering::SeqCst) + 1;
        loop {
            let current_max = self.max_concurrent_mutations.load(Ordering::SeqCst);
            if active <= current_max {
                break;
            }
            if self
                .max_concurrent_mutations
                .compare_exchange(current_max, active, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                break;
            }
        }
        MutationGuard { filesystem: self }
    }
}

struct MutationGuard<'a> {
    filesystem: &'a TrackingFilesystem,
}

impl Drop for MutationGuard<'_> {
    fn drop(&mut self) {
        self.filesystem
            .active_mutations
            .fetch_sub(1, Ordering::SeqCst);
    }
}

struct TrackingStagedWrite {
    inner: Box<dyn StagedAtomicWrite>,
    installed: Arc<AtomicUsize>,
    discarded: Arc<AtomicUsize>,
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
        let _mutation = self.begin_mutation();
        self.stage_reached.store(true, Ordering::SeqCst);
        self.stage_update.notify_waiters();
        let mut release = self.release_staging.0.lock().unwrap();
        while self.pause_staging.load(Ordering::SeqCst) {
            release = self.release_staging.1.wait(release).unwrap();
        }
        drop(release);

        let inner = self.inner.stage_atomic(path, bytes)?;
        Ok(Box::new(TrackingStagedWrite {
            inner,
            installed: Arc::clone(&self.installed),
            discarded: Arc::clone(&self.discarded),
        }))
    }

    fn remove_file(&self, path: &Path) -> io::Result<()> {
        self.inner.remove_file(path)
    }

    fn sync_dir(&self, path: &Path) -> io::Result<()> {
        self.inner.sync_dir(path)
    }
}

pub(super) struct ApplicationFixture {
    pub(super) persistence: Arc<ApplicationPersistence>,
    pub(super) coordinator: SaveCoordinator,
    pub(super) session: Arc<Mutex<AppSession>>,
    pub(super) filesystem: Arc<TrackingFilesystem>,
    _resources: tempfile::TempDir,
    _saves: tempfile::TempDir,
}

pub(super) fn application_fixture() -> ApplicationFixture {
    let (resources, resources_dir) = save_capture_fixture_resources();
    let definitions = Arc::new(load_current_definitions(&resources_dir).unwrap());
    let saves = tempfile::tempdir().unwrap();
    let root = saves.path().join("saves");
    let filesystem = Arc::new(TrackingFilesystem::default());
    ensure_save_layout(filesystem.as_ref(), &root).unwrap();

    let mut engine = GameEngine::new_started(resources_dir.clone()).unwrap();
    engine.durable_revision = 1;
    let session = Arc::new(Mutex::new(AppSession::installed(engine, 1, None)));
    let operation_gate = Arc::new(tokio::sync::Mutex::new(()));
    let persistence = Arc::new(ApplicationPersistence {
        session: Arc::clone(&session),
        operation_gate: Arc::clone(&operation_gate),
        fs: filesystem.clone(),
        root,
        discovery: SaveDiscoveryContext {
            resources_dir: resources_dir.clone(),
            definitions,
        },
        last_saved_at: Mutex::new(None),
        availability_error: Mutex::new(None),
    });
    let coordinator = SaveCoordinator::with_backend_for_application(
        persistence.clone(),
        Arc::clone(&session),
        operation_gate,
    );

    ApplicationFixture {
        persistence,
        coordinator,
        session,
        filesystem,
        _resources: resources,
        _saves: saves,
    }
}

pub(super) fn registered_write(slot: u8, durable_revision: u64) -> AutosaveRegisteredIntent {
    let save_id = match slot {
        1 => "550e8400-e29b-41d4-a716-446655440101",
        2 => "550e8400-e29b-41d4-a716-446655440102",
        _ => panic!("test fixture only defines two save IDs"),
    };
    let mut envelope = representative_save_envelope();
    envelope.save_id = save_id.into();
    envelope.save_type = SaveType::Auto;
    envelope.slot = slot;
    envelope.snapshot.durable_revision = durable_revision;
    let checkpoint = CapturedCheckpoint {
        summary: envelope.summary.clone(),
        snapshot: envelope.snapshot.clone(),
    };
    AutosaveCapture::captured(
        AutosaveWriteJob {
            session_generation: 1,
            durable_revision,
            thumbnail: CaptureTerminalResult::Unavailable,
        },
        Vec::new(),
        checkpoint,
        envelope.content_revision.clone(),
    )
    .register(SaveSlotRef::Auto { slot }, save_id.into(), envelope)
    .unwrap()
}
