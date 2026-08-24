use super::ApplicationPersistence;
use crate::game::save::capture::capture_checkpoint;
use crate::game::save::coordinator::{
    AutosaveBackend, AutosaveCapture, AutosaveCommitOutcome, AutosavePreparedWrite,
    AutosaveRegisteredIntent, AutosaveWriteJob, CoordinatorFuture, PendingAutosave,
    SaveCoordinator, ThumbnailCapturePurpose,
};
use crate::game::save::schema::{suggested_display_name, SaveSlotRef};
use crate::game::save::storage::clean_orphaned_save_files;
use crate::game::GameError;
use std::sync::Arc;
use tokio::time::Instant;
use uuid::Uuid;

impl ApplicationPersistence {
    pub(crate) fn schedule_autosave(
        self: Arc<Self>,
        coordinator: SaveCoordinator,
        pending: PendingAutosave,
    ) -> Result<(), GameError> {
        #[cfg(test)]
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                self.await_pending_autosave(&coordinator, pending).await;
            });
        }
        #[cfg(not(test))]
        tauri::async_runtime::spawn(async move {
            self.await_pending_autosave(&coordinator, pending).await;
        });
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn schedule_autosave_with_backend(
        backend: Arc<dyn AutosaveBackend>,
        coordinator: SaveCoordinator,
        pending: PendingAutosave,
    ) -> Result<(), GameError> {
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                await_pending_autosave_with_backend(backend, &coordinator, pending).await;
            });
        }
        Ok(())
    }

    pub(crate) async fn await_pending_autosave(
        self: &Arc<Self>,
        coordinator: &SaveCoordinator,
        pending: PendingAutosave,
    ) {
        let backend: Arc<dyn AutosaveBackend> = self.clone();
        await_pending_autosave_with_backend(backend, coordinator, pending).await;
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

async fn await_pending_autosave_with_backend(
    backend: Arc<dyn AutosaveBackend>,
    coordinator: &SaveCoordinator,
    pending: PendingAutosave,
) {
    if !coordinator.pending_matches(&pending) {
        return;
    }
    tokio::time::sleep_until(pending.debounce_deadline).await;
    if !coordinator.pending_matches(&pending) {
        return;
    }
    let thumbnail = match wait_for_terminal_thumbnail(
        coordinator,
        &pending.ticket,
        &pending.purpose,
        pending.capture_deadline,
    )
    .await
    {
        Ok(result) => result,
        Err(error) if error.code == "staleThumbnailTicket" => return,
        Err(error) => {
            coordinator.record_background_failure(
                pending.session_generation,
                pending.durable_revision,
                pending.thumbnail_capture_required,
                error,
            );
            return;
        }
    };
    if !coordinator.pending_matches(&pending) {
        return;
    }
    execute_ready_autosave(backend, coordinator, pending, thumbnail).await;
}

async fn execute_ready_autosave(
    backend: Arc<dyn AutosaveBackend>,
    coordinator: &SaveCoordinator,
    pending: PendingAutosave,
    thumbnail: crate::game::save::coordinator::CaptureTerminalResult,
) {
    if !coordinator.pending_matches(&pending) {
        return;
    }
    let _operation_gate = coordinator.acquire_operation_gate().await;
    if !coordinator.pending_matches(&pending) {
        return;
    }
    let capture = match backend
        .capture(AutosaveWriteJob {
            session_generation: pending.session_generation,
            durable_revision: pending.durable_revision,
            thumbnail,
        })
        .await
    {
        Ok(capture) => capture,
        Err(error) if error.code == "staleSessionGeneration" => {
            coordinator.record_stale_write(&pending);
            return;
        }
        Err(error) => {
            coordinator.record_background_failure(
                pending.session_generation,
                pending.durable_revision,
                pending.thumbnail_capture_required,
                error,
            );
            return;
        }
    };
    let target = match crate::game::save::storage::select_autosave_target(capture.slots()) {
        Ok(target) => target,
        Err(error) => {
            coordinator.record_background_failure(
                pending.session_generation,
                pending.durable_revision,
                pending.thumbnail_capture_required,
                error,
            );
            return;
        }
    };
    let save_id = Uuid::new_v4().hyphenated().to_string();
    let expected_receipt = crate::game::save::coordinator::AutosaveWriteReceipt {
        session_generation: pending.session_generation,
        durable_revision: pending.durable_revision,
        slot: target,
        save_id: save_id.clone(),
    };
    let registered = match backend.register(capture, target, save_id).await {
        Ok(registered) => registered,
        Err(error) => {
            coordinator.record_background_failure(
                pending.session_generation,
                pending.durable_revision,
                pending.thumbnail_capture_required,
                error,
            );
            return;
        }
    };
    let prepared = match backend.prepare(registered).await {
        Ok(prepared) => prepared,
        Err(error) => {
            coordinator.record_background_failure(
                pending.session_generation,
                pending.durable_revision,
                pending.thumbnail_capture_required,
                error,
            );
            return;
        }
    };
    match backend.commit_if_current(prepared).await {
        Ok(AutosaveCommitOutcome::Committed(committed)) => {
            let (receipt, cleanup_diagnostic) = committed.into_parts();
            if receipt == expected_receipt {
                coordinator.record_background_success(&pending, receipt, cleanup_diagnostic);
            } else {
                coordinator.record_background_failure(
                    pending.session_generation,
                    pending.durable_revision,
                    pending.thumbnail_capture_required,
                    GameError::save_write_failed(),
                );
            }
        }
        Ok(AutosaveCommitOutcome::Stale(prepared)) => match prepared.discard() {
            Ok(()) => coordinator.record_stale_write(&pending),
            Err(error) => coordinator.record_background_failure(
                pending.session_generation,
                pending.durable_revision,
                pending.thumbnail_capture_required,
                error,
            ),
        },
        Err(error) => coordinator.record_background_failure(
            pending.session_generation,
            pending.durable_revision,
            pending.thumbnail_capture_required,
            error,
        ),
    }
}

async fn wait_for_terminal_thumbnail(
    coordinator: &SaveCoordinator,
    ticket: &str,
    expected: &ThumbnailCapturePurpose,
    deadline: Instant,
) -> Result<crate::game::save::coordinator::CaptureTerminalResult, GameError> {
    loop {
        if let Some(result) = coordinator.take_terminal_thumbnail(ticket, expected)? {
            return Ok(result);
        }
        if Instant::now() >= deadline {
            return coordinator.claim_thumbnail(ticket, expected);
        }
        let updates = coordinator.ticket_updates();
        tokio::select! {
            _ = updates.notified() => {}
            _ = tokio::time::sleep_until(deadline) => {}
        }
    }
}
