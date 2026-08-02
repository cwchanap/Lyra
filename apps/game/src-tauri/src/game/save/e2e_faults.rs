use super::storage::{SaveFileMetadata, SaveFilesystem, StagedAtomicWrite};
use crate::game::GameError;
use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum E2ePersistenceFaultBoundary {
    ThumbnailInstall,
    EnvelopeReplace,
    SavesDirectorySync,
    ExitFlush,
}

#[derive(Default)]
pub(crate) struct E2ePersistenceFaultState {
    pending: Mutex<Option<E2ePersistenceFaultBoundary>>,
}

impl E2ePersistenceFaultState {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn arm(
        &self,
        boundary: E2ePersistenceFaultBoundary,
        occurrence_count: u8,
    ) -> Result<(), GameError> {
        if occurrence_count != 1 {
            return Err(GameError::save_write_failed());
        }
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| GameError::save_write_failed())?;
        if pending.is_some() {
            return Err(GameError::save_write_failed());
        }
        *pending = Some(boundary);
        Ok(())
    }

    pub(crate) fn fire(&self, boundary: E2ePersistenceFaultBoundary) -> io::Result<()> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| io::Error::other("E2E persistence fault state is unavailable"))?;
        if *pending == Some(boundary) {
            *pending = None;
            Err(io::Error::other(format!(
                "controlled E2E persistence fault at {boundary:?}",
            )))
        } else {
            Ok(())
        }
    }

    pub(crate) fn reset(&self) {
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *pending = None;
    }
}

pub(crate) struct E2eFaultingSaveFilesystem {
    inner: Arc<dyn SaveFilesystem>,
    faults: Arc<E2ePersistenceFaultState>,
}

impl E2eFaultingSaveFilesystem {
    pub(crate) fn new(
        inner: Arc<dyn SaveFilesystem>,
        faults: Arc<E2ePersistenceFaultState>,
    ) -> Self {
        Self { inner, faults }
    }
}

struct E2eFaultingStagedWrite {
    inner: Box<dyn StagedAtomicWrite>,
    faults: Arc<E2ePersistenceFaultState>,
    boundary: Option<E2ePersistenceFaultBoundary>,
}

impl StagedAtomicWrite for E2eFaultingStagedWrite {
    fn install(self: Box<Self>) -> io::Result<()> {
        let Self {
            inner,
            faults,
            boundary,
        } = *self;
        if let Some(boundary) = boundary {
            if let Err(fault) = faults.fire(boundary) {
                let _ = inner.discard();
                return Err(fault);
            }
        }
        inner.install()
    }

    fn discard(self: Box<Self>) -> io::Result<()> {
        self.inner.discard()
    }
}

impl SaveFilesystem for E2eFaultingSaveFilesystem {
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
        let boundary = match path.extension().and_then(|extension| extension.to_str()) {
            Some("png") => Some(E2ePersistenceFaultBoundary::ThumbnailInstall),
            Some("json") => Some(E2ePersistenceFaultBoundary::EnvelopeReplace),
            _ => None,
        };
        Ok(Box::new(E2eFaultingStagedWrite {
            inner: self.inner.stage_atomic(path, bytes)?,
            faults: Arc::clone(&self.faults),
            boundary,
        }))
    }

    fn remove_file(&self, path: &Path) -> io::Result<()> {
        self.inner.remove_file(path)
    }

    fn sync_dir(&self, path: &Path) -> io::Result<()> {
        if path.file_name().and_then(|name| name.to_str()) == Some("saves") {
            self.faults
                .fire(E2ePersistenceFaultBoundary::SavesDirectorySync)?;
        }
        self.inner.sync_dir(path)
    }
}

#[cfg(test)]
mod e2e_fault_tests {
    use super::{E2eFaultingSaveFilesystem, E2ePersistenceFaultBoundary, E2ePersistenceFaultState};
    use crate::game::save::storage::{SaveFileMetadata, SaveFilesystem, StagedAtomicWrite};
    use std::io;
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};
    use std::time::SystemTime;

    #[derive(Default)]
    struct RecordingFilesystem {
        staged: Mutex<Vec<(PathBuf, Vec<u8>)>>,
        installs: Arc<Mutex<usize>>,
        discards: Arc<Mutex<usize>>,
        abandoned_drops: Arc<Mutex<usize>>,
        syncs: Mutex<Vec<PathBuf>>,
    }

    struct RecordingStagedWrite {
        installs: Arc<Mutex<usize>>,
        discards: Arc<Mutex<usize>>,
        abandoned_drops: Arc<Mutex<usize>>,
        completed: bool,
    }

    impl StagedAtomicWrite for RecordingStagedWrite {
        fn install(mut self: Box<Self>) -> io::Result<()> {
            *self.installs.lock().unwrap() += 1;
            self.completed = true;
            Ok(())
        }

        fn discard(mut self: Box<Self>) -> io::Result<()> {
            *self.discards.lock().unwrap() += 1;
            self.completed = true;
            Ok(())
        }
    }

    impl Drop for RecordingStagedWrite {
        fn drop(&mut self) {
            if !self.completed {
                *self.abandoned_drops.lock().unwrap() += 1;
            }
        }
    }

    impl SaveFilesystem for RecordingFilesystem {
        fn create_dir_all(&self, _path: &Path) -> io::Result<()> {
            Ok(())
        }

        fn read(&self, _path: &Path) -> io::Result<Vec<u8>> {
            Ok(Vec::new())
        }

        fn read_prefix(&self, _path: &Path, _limit: usize) -> io::Result<Vec<u8>> {
            Ok(Vec::new())
        }

        fn metadata(&self, _path: &Path) -> io::Result<SaveFileMetadata> {
            Ok(SaveFileMetadata {
                modified_at: SystemTime::UNIX_EPOCH,
                byte_length: 0,
            })
        }

        fn list_dir(&self, _path: &Path) -> io::Result<Vec<PathBuf>> {
            Ok(Vec::new())
        }

        fn stage_atomic(
            &self,
            path: &Path,
            bytes: &[u8],
        ) -> io::Result<Box<dyn StagedAtomicWrite>> {
            self.staged
                .lock()
                .unwrap()
                .push((path.to_path_buf(), bytes.to_vec()));
            Ok(Box::new(RecordingStagedWrite {
                installs: Arc::clone(&self.installs),
                discards: Arc::clone(&self.discards),
                abandoned_drops: Arc::clone(&self.abandoned_drops),
                completed: false,
            }))
        }

        fn remove_file(&self, _path: &Path) -> io::Result<()> {
            Ok(())
        }

        fn sync_dir(&self, path: &Path) -> io::Result<()> {
            self.syncs.lock().unwrap().push(path.to_path_buf());
            Ok(())
        }
    }

    #[test]
    fn every_closed_boundary_fails_exactly_once() {
        for boundary in [
            E2ePersistenceFaultBoundary::ThumbnailInstall,
            E2ePersistenceFaultBoundary::EnvelopeReplace,
            E2ePersistenceFaultBoundary::SavesDirectorySync,
            E2ePersistenceFaultBoundary::ExitFlush,
        ] {
            let faults = E2ePersistenceFaultState::new();
            faults.arm(boundary, 1).unwrap();

            assert!(faults.fire(boundary).is_err(), "{boundary:?}");
            assert!(faults.fire(boundary).is_ok(), "{boundary:?}");
        }
    }

    #[test]
    fn occurrence_count_is_closed_to_one() {
        let faults = E2ePersistenceFaultState::new();

        assert!(faults
            .arm(E2ePersistenceFaultBoundary::EnvelopeReplace, 0)
            .is_err());
        assert!(faults
            .arm(E2ePersistenceFaultBoundary::EnvelopeReplace, 2)
            .is_err());
        assert!(faults
            .fire(E2ePersistenceFaultBoundary::EnvelopeReplace)
            .is_ok());
    }

    #[test]
    fn a_new_app_session_cannot_inherit_an_armed_fault() {
        let first = E2ePersistenceFaultState::new();
        first
            .arm(E2ePersistenceFaultBoundary::ExitFlush, 1)
            .unwrap();

        let next_session = E2ePersistenceFaultState::new();

        assert!(next_session
            .fire(E2ePersistenceFaultBoundary::ExitFlush)
            .is_ok());
        assert!(first.fire(E2ePersistenceFaultBoundary::ExitFlush).is_err());
    }

    #[test]
    fn envelope_fault_preserves_the_exact_staged_path_and_payload() {
        let inner = Arc::new(RecordingFilesystem::default());
        let faults = Arc::new(E2ePersistenceFaultState::new());
        let wrapper = E2eFaultingSaveFilesystem::new(inner.clone(), Arc::clone(&faults));
        let path = Path::new("/fixed/test-root/saves/manual-1.json");
        let bytes = br#"{"saveId":"fixed"}"#;
        faults
            .arm(E2ePersistenceFaultBoundary::EnvelopeReplace, 1)
            .unwrap();

        let staged = wrapper.stage_atomic(path, bytes).unwrap();

        assert!(staged.install().is_err());
        assert_eq!(
            inner.staged.lock().unwrap().as_slice(),
            &[(path.to_path_buf(), bytes.to_vec())],
        );
        assert_eq!(*inner.installs.lock().unwrap(), 0);
    }

    #[test]
    fn thumbnail_install_fault_discards_once_then_a_new_same_png_install_succeeds() {
        let inner = Arc::new(RecordingFilesystem::default());
        let faults = Arc::new(E2ePersistenceFaultState::new());
        let wrapper = E2eFaultingSaveFilesystem::new(inner.clone(), Arc::clone(&faults));
        let path =
            Path::new("/fixed/test-root/saves/thumbnails/123e4567-e89b-42d3-a456-426614174000.png");
        let bytes = b"\x89PNG\r\n\x1a\nfixed-thumbnail";
        faults
            .arm(E2ePersistenceFaultBoundary::ThumbnailInstall, 1)
            .unwrap();

        let first = wrapper.stage_atomic(path, bytes).unwrap();

        assert!(first.install().is_err());
        assert_eq!(
            inner.staged.lock().unwrap().as_slice(),
            &[(path.to_path_buf(), bytes.to_vec())],
        );
        assert_eq!(*inner.installs.lock().unwrap(), 0);
        assert_eq!(*inner.discards.lock().unwrap(), 1);
        assert_eq!(*inner.abandoned_drops.lock().unwrap(), 0);

        let second = wrapper.stage_atomic(path, bytes).unwrap();

        assert!(second.install().is_ok());
        assert_eq!(
            inner.staged.lock().unwrap().as_slice(),
            &[
                (path.to_path_buf(), bytes.to_vec()),
                (path.to_path_buf(), bytes.to_vec()),
            ],
        );
        assert_eq!(*inner.installs.lock().unwrap(), 1);
        assert_eq!(*inner.discards.lock().unwrap(), 1);
        assert_eq!(*inner.abandoned_drops.lock().unwrap(), 0);
    }

    #[test]
    fn saves_directory_sync_fault_is_one_shot_at_the_wrapped_boundary() {
        let inner = Arc::new(RecordingFilesystem::default());
        let faults = Arc::new(E2ePersistenceFaultState::new());
        let wrapper = E2eFaultingSaveFilesystem::new(inner.clone(), Arc::clone(&faults));
        let saves = Path::new("/fixed/test-root/saves");
        faults
            .arm(E2ePersistenceFaultBoundary::SavesDirectorySync, 1)
            .unwrap();

        assert!(wrapper.sync_dir(saves).is_err());
        assert!(wrapper.sync_dir(saves).is_ok());
        assert_eq!(inner.syncs.lock().unwrap().as_slice(), &[saves]);
    }
}
