use chrono::{DateTime, Duration as ChronoDuration, SecondsFormat, Utc};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use super::capture::{capture_checkpoint, CapturedCheckpoint};
use super::coordinator::{
    AutosaveBackend, AutosaveCapture, AutosaveCommitOutcome, AutosavePreparedWrite,
    AutosaveRegisteredIntent, AutosaveWriteJob, CoordinatorFuture,
};
use super::schema::{
    suggested_display_name, SaveBrowserView, SaveDiscoveryStatusView, SaveEnvelope, SaveSlotRef,
    SaveType, ThumbnailDescriptorV1, SAVE_SCHEMA_VERSION,
};
use super::storage::{
    clean_orphaned_save_files, discover_saves, ensure_save_layout, SaveDiscoveryContext,
    SaveFilesystem,
};
use crate::game::GameError;

pub(crate) mod session;
pub(crate) use session::{AppSession, SessionTransitionIdentity};

pub(crate) struct ApplicationPersistence {
    pub(crate) session: Arc<Mutex<AppSession>>,
    pub(crate) replacement_gate: Arc<tokio::sync::Mutex<()>>,
    pub(crate) fs: Arc<dyn SaveFilesystem>,
    pub(crate) root: PathBuf,
    pub(crate) discovery: SaveDiscoveryContext,
    pub(crate) last_saved_at: Mutex<Option<DateTime<Utc>>>,
    pub(crate) availability_error: Mutex<Option<GameError>>,
}

impl ApplicationPersistence {
    pub(crate) fn discover(&self) -> SaveBrowserView {
        if let Err(error) = ensure_save_layout(self.fs.as_ref(), &self.root) {
            if let Ok(mut availability) = self.availability_error.lock() {
                *availability = Some(error);
            }
            return crate::unavailable_save_browser();
        }
        let browser = discover_saves(self.fs.as_ref(), &self.root, &self.discovery);
        if let Ok(mut availability) = self.availability_error.lock() {
            *availability = match &browser.discovery {
                SaveDiscoveryStatusView::Available => None,
                SaveDiscoveryStatusView::Loading => Some(GameError::save_discovery_unavailable()),
                SaveDiscoveryStatusView::Unavailable { diagnostic } => Some(diagnostic.clone()),
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
        let now = Utc::now();
        let next = last
            .as_ref()
            .map(|previous| now.max(*previous + ChronoDuration::nanoseconds(1)))
            .unwrap_or(now);
        *last = Some(next);
        Ok(next.to_rfc3339_opts(SecondsFormat::Nanos, true))
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
            schema_version: SAVE_SCHEMA_VERSION,
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
}

impl AutosaveBackend for ApplicationPersistence {
    fn capture(
        &self,
        job: AutosaveWriteJob,
    ) -> CoordinatorFuture<'_, Result<AutosaveCapture, GameError>> {
        Box::pin(async move {
            let (checkpoint, content_revision) = {
                let session = self.session.lock().map_err(|_| GameError::unavailable())?;
                // The coordinator already authorized this writer before
                // application-exit exclusivity was installed. Revalidate its
                // identity below, but do not reject the writer merely because
                // exit is now waiting for it to flush.
                let engine = session
                    .engine
                    .as_ref()
                    .ok_or_else(GameError::game_not_started)?;
                if session.persistence.generation != job.session_generation
                    || engine.durable_revision() != job.durable_revision
                {
                    return Err(GameError::save_write_failed());
                }
                (
                    capture_checkpoint(engine)?,
                    self.discovery.definitions.content_revision().to_owned(),
                )
            };
            let slots = self.discover().slots;
            Ok(AutosaveCapture::captured(
                job,
                slots,
                checkpoint,
                content_revision,
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
            let (checkpoint, content_revision) = capture.captured_checkpoint()?;
            let display_name = suggested_display_name(
                &checkpoint.summary.chapter_title,
                &checkpoint.summary.scene_title,
            );
            let envelope = self.envelope(
                checkpoint,
                content_revision,
                target,
                save_id.clone(),
                display_name,
            )?;
            capture.register(target, save_id, envelope)
        })
    }

    fn prepare(
        &self,
        registered: AutosaveRegisteredIntent,
    ) -> CoordinatorFuture<'_, Result<AutosavePreparedWrite, GameError>> {
        Box::pin(async move { registered.prepare(self.fs.as_ref(), &self.root) })
    }

    fn commit_if_current(
        &self,
        prepared: AutosavePreparedWrite,
    ) -> CoordinatorFuture<'_, Result<AutosaveCommitOutcome, GameError>> {
        Box::pin(async move {
            let _gate = self.replacement_gate.lock().await;
            self.commit_current(prepared)
        })
    }

    fn cleanup_orphans(&self) -> CoordinatorFuture<'_, Result<(), GameError>> {
        Box::pin(async move { clean_orphaned_save_files(self.fs.as_ref(), &self.root) })
    }
}

impl ApplicationPersistence {
    pub(crate) async fn run_storage_write_if_session_current<T, F>(
        &self,
        session_generation: u64,
        write: F,
    ) -> Result<T, GameError>
    where
        T: Send,
        F: FnOnce(&dyn SaveFilesystem, &std::path::Path) -> Result<T, GameError> + Send,
    {
        let _gate = self.replacement_gate.lock().await;
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

    fn commit_current(
        &self,
        prepared: AutosavePreparedWrite,
    ) -> Result<AutosaveCommitOutcome, GameError> {
        let current = {
            let session = self.session.lock().map_err(|_| GameError::unavailable())?;
            // Exit exclusivity blocks new command-side mutations, not a writer
            // the coordinator has already authorized. Generation and revision
            // are the commit-time stale-write guard.
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
}
