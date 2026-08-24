use super::ApplicationPersistence;
use crate::game::save::capture::capture_checkpoint;
use crate::game::save::coordinator::{
    AutosaveBackend, AutosaveCapture, AutosaveCommitOutcome, AutosavePreparedWrite,
    AutosaveRegisteredIntent, AutosaveWriteJob, CoordinatorFuture,
};
use crate::game::save::schema::{suggested_display_name, SaveSlotRef};
use crate::game::save::storage::clean_orphaned_save_files;
use crate::game::GameError;

impl AutosaveBackend for ApplicationPersistence {
    fn capture(
        &self,
        job: AutosaveWriteJob,
    ) -> CoordinatorFuture<'_, Result<AutosaveCapture, GameError>> {
        Box::pin(async move {
            let (checkpoint, content_revision) = {
                let session = self.session.lock().map_err(|_| GameError::unavailable())?;
                // Revalidate the exact identity before capture. The coordinator
                // holds operation_gate for the rest of the ready write.
                let engine = session
                    .engine
                    .as_ref()
                    .ok_or_else(GameError::game_not_started)?;
                if session.persistence.generation != job.session_generation
                    || engine.durable_revision() != job.durable_revision
                {
                    return Err(GameError::stale_session_generation());
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
        Box::pin(async move { self.commit_current(prepared) })
    }

    fn cleanup_orphans(&self) -> CoordinatorFuture<'_, Result<(), GameError>> {
        Box::pin(async move { clean_orphaned_save_files(self.fs.as_ref(), &self.root) })
    }
}
