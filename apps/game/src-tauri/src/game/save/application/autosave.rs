use super::*;
use crate::game::save::capture::capture_checkpoint;
use crate::game::save::schema::{suggested_display_name, SaveSlotRef};
use crate::game::save::storage::{clean_orphaned_save_files, select_autosave_target};
use crate::game::GameError;
use std::sync::Arc;
use tokio::time::Instant;
use uuid::Uuid;

impl ApplicationPersistence {
    pub(crate) fn schedule_autosave(&self, pending: PendingAutosave) -> Result<(), GameError> {
        let persistence = self.clone();
        #[cfg(test)]
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                persistence.await_pending_autosave(pending).await;
            });
            return Ok(());
        }
        #[cfg(not(test))]
        tauri::async_runtime::spawn(async move {
            persistence.await_pending_autosave(pending).await;
        });
        Ok(())
    }

    pub(crate) fn enqueue_orphan_cleanup(&self) -> Result<(), GameError> {
        let persistence = self.clone();
        #[cfg(test)]
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                let _gate = persistence.operation_gate.lock().await;
                match clean_orphaned_save_files(persistence.fs.as_ref(), &persistence.root) {
                    Ok(()) => persistence.resolve_cleanup_failure(),
                    Err(error) => persistence.record_cleanup_failure(error),
                }
            });
            return Ok(());
        }
        #[cfg(not(test))]
        {
            tauri::async_runtime::spawn(async move {
                let _gate = persistence.operation_gate.lock().await;
                match clean_orphaned_save_files(persistence.fs.as_ref(), &persistence.root) {
                    Ok(()) => persistence.resolve_cleanup_failure(),
                    Err(error) => persistence.record_cleanup_failure(error),
                }
            });
            Ok(())
        }
        // Test builds without an ambient tokio runtime reach this fallback; the
        // returned error is recorded by `retry_cleanup_if_needed`, which
        // publishes Degraded persistence health via `record_cleanup_failure`.
        #[cfg(test)]
        Err(GameError::save_write_failed())
    }

    async fn await_pending_autosave(&self, pending: PendingAutosave) {
        if !self.pending_matches(&pending) {
            return;
        }
        tokio::time::sleep_until(pending.debounce_deadline).await;
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
                    pending.thumbnail_capture_required,
                    error,
                );
                return;
            }
        };
        if !self.pending_matches(&pending) {
            return;
        }
        self.execute_ready_autosave(pending, thumbnail).await;
    }

    async fn execute_ready_autosave(
        &self,
        pending: PendingAutosave,
        thumbnail: CaptureTerminalResult,
    ) {
        if !self.pending_matches(&pending) {
            return;
        }
        let _operation_gate = self
            .acquire_operation_gate()
            .await
            .expect("ApplicationPersistence always has an operation gate");
        if !self.pending_matches(&pending) {
            return;
        }
        let capture = match self
            .capture_checkpoint_under_operation_gate(AutosaveWriteJob {
                session_generation: pending.session_generation,
                durable_revision: pending.durable_revision,
                thumbnail,
            })
            .await
        {
            Ok(capture) => capture,
            Err(error) if error.code == "staleSessionGeneration" => {
                self.record_stale_write(&pending);
                return;
            }
            Err(error) => {
                self.record_background_failure(
                    pending.session_generation,
                    pending.durable_revision,
                    pending.thumbnail_capture_required,
                    error,
                );
                return;
            }
        };
        let target = match select_autosave_target(capture.slots()) {
            Ok(target) => target,
            Err(error) => {
                self.record_background_failure(
                    pending.session_generation,
                    pending.durable_revision,
                    pending.thumbnail_capture_required,
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
        let registered = match self.register_autosave(capture, target, save_id).await {
            Ok(registered) => registered,
            Err(error) => {
                self.record_background_failure(
                    pending.session_generation,
                    pending.durable_revision,
                    pending.thumbnail_capture_required,
                    error,
                );
                return;
            }
        };
        let prepared = match self.prepare_autosave_write(registered).await {
            Ok(prepared) => prepared,
            Err(error) => {
                self.record_background_failure(
                    pending.session_generation,
                    pending.durable_revision,
                    pending.thumbnail_capture_required,
                    error,
                );
                return;
            }
        };
        match self.commit_prepared_slot_write(prepared).await {
            Ok(AutosaveCommitOutcome::Committed(committed)) => {
                let (receipt, cleanup_diagnostic) = committed.into_parts();
                if receipt == expected_receipt {
                    self.record_background_success(&pending, receipt, cleanup_diagnostic);
                } else {
                    self.record_background_failure(
                        pending.session_generation,
                        pending.durable_revision,
                        pending.thumbnail_capture_required,
                        GameError::save_write_failed(),
                    );
                }
            }
            Ok(AutosaveCommitOutcome::Stale(prepared)) => {
                match self.discard_prepared_slot_write(prepared) {
                    Ok(()) => self.record_stale_write(&pending),
                    Err(error) => self.record_background_failure(
                        pending.session_generation,
                        pending.durable_revision,
                        pending.thumbnail_capture_required,
                        error,
                    ),
                }
            }
            Err(error) => self.record_background_failure(
                pending.session_generation,
                pending.durable_revision,
                pending.thumbnail_capture_required,
                error,
            ),
        }
    }

    pub(crate) async fn capture_checkpoint(
        &self,
        job: AutosaveWriteJob,
    ) -> Result<AutosaveCapture, GameError> {
        let _operation_gate = self
            .acquire_operation_gate()
            .await
            .expect("ApplicationPersistence always has an operation gate");
        self.capture_checkpoint_under_operation_gate(job).await
    }

    async fn capture_checkpoint_under_operation_gate(
        &self,
        job: AutosaveWriteJob,
    ) -> Result<AutosaveCapture, GameError> {
        let (checkpoint, content_revision) = {
            let session = self.session.lock().map_err(|_| GameError::unavailable())?;
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
        let slots = self.discover_under_operation_gate().slots;
        Ok(AutosaveCapture::captured(
            job,
            slots,
            checkpoint,
            content_revision,
        ))
    }

    pub(crate) async fn register_autosave(
        &self,
        capture: AutosaveCapture,
        target: SaveSlotRef,
        save_id: String,
    ) -> Result<AutosaveRegisteredIntent, GameError> {
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
    }

    pub(crate) async fn prepare_autosave_write(
        &self,
        registered: AutosaveRegisteredIntent,
    ) -> Result<AutosavePreparedWrite, GameError> {
        registered.prepare(self.fs.as_ref(), &self.root)
    }

    pub(crate) async fn commit_prepared_slot_write(
        &self,
        prepared: AutosavePreparedWrite,
    ) -> Result<AutosaveCommitOutcome, GameError> {
        self.commit_current(prepared)
    }

    pub(crate) fn discard_prepared_slot_write(
        &self,
        prepared: AutosavePreparedWrite,
    ) -> Result<(), GameError> {
        prepared.discard()
    }

    pub(crate) async fn flush_session(
        &self,
        operation: super::FlushOperation,
    ) -> Result<super::FlushOutcome, GameError> {
        self.flush_session_parts(&self.session, &self.operation_gate, operation)
            .await
    }

    pub(super) async fn flush_session_parts(
        &self,
        session_state: &Arc<std::sync::Mutex<super::AppSession>>,
        operation_gate: &Arc<tokio::sync::Mutex<()>>,
        operation: super::FlushOperation,
    ) -> Result<super::FlushOutcome, GameError> {
        let (session_generation, durable_revision, flush_revision, preferred_target) = {
            let mut session = session_state.lock().map_err(|_| GameError::unavailable())?;
            if operation == super::FlushOperation::Exit {
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
            return Ok(super::FlushOutcome::Noop {
                session_generation,
                durable_revision,
            });
        };
        let (thumbnail, thumbnail_capture_required) = self
            .cancel_pending_autosave_covered_by_flush(session_generation, flush_revision)?
            .unwrap_or((CaptureTerminalResult::Unavailable, true));

        #[cfg(feature = "e2e")]
        if operation == super::FlushOperation::Exit {
            self.e2e_persistence_faults
                .fire(super::E2ePersistenceFaultBoundary::ExitFlush)
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
        if operation == super::FlushOperation::Exit {
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
            Ok(super::FlushOutcome::Written {
                session_generation,
                durable_revision,
                slot: receipt.slot,
            })
        } else {
            Ok(super::FlushOutcome::Noop {
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
        let _operation_gate = self
            .acquire_operation_gate()
            .await
            .expect("ApplicationPersistence always has an operation gate");
        if let Some(receipt) = self.last_successful_write().filter(|receipt| {
            receipt.session_generation == session_generation
                && receipt.durable_revision >= durable_revision
        }) {
            return Ok((receipt, false));
        }
        let write_result = async {
            let capture = self
                .capture_checkpoint_under_operation_gate(AutosaveWriteJob {
                    session_generation,
                    durable_revision,
                    thumbnail,
                })
                .await?;
            let target = match preferred_target {
                Some(target @ SaveSlotRef::Auto { .. }) => target,
                Some(SaveSlotRef::Manual { .. }) => return Err(GameError::save_write_failed()),
                None => select_autosave_target(capture.slots())?,
            };
            let save_id = Uuid::new_v4().hyphenated().to_string();
            let expected_receipt = AutosaveWriteReceipt {
                session_generation,
                durable_revision,
                slot: target,
                save_id: save_id.clone(),
            };
            let registered = self.register_autosave(capture, target, save_id).await?;
            let prepared = self.prepare_autosave_write(registered).await?;
            let committed = match self.commit_prepared_slot_write(prepared).await? {
                AutosaveCommitOutcome::Committed(committed) => committed,
                AutosaveCommitOutcome::Stale(prepared) => {
                    self.discard_prepared_slot_write(prepared)?;
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
            let updates = self.ticket_updates();
            tokio::select! {
                _ = updates.notified() => {}
                _ = tokio::time::sleep_until(deadline) => {}
            }
        }
    }
}

impl ApplicationPersistence {
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
        let (failure, retirement) = {
            let mut state = self.state.lock().ok()?;
            let failure = state.failed_write.clone()?;
            match retry_eligibility(&mut state, failure.identity) {
                RetryEligibility::Proceed => (Some(failure), None),
                RetryEligibility::Ignore => (None, None),
                RetryEligibility::Retire {
                    health,
                    subscribers,
                } => (None, Some((health, subscribers))),
            }
        };
        if let Some((health, subscribers)) = retirement {
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
        Some(Arc::clone(&self.operation_gate).lock_owned().await)
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

    pub(crate) fn publish_storage_write_health(
        &self,
        session_generation: u64,
        cleanup_diagnostic: Option<GameError>,
    ) -> Result<(), GameError> {
        let (health, subscribers, retry_cleanup) = {
            let mut state = self.lock_state()?;
            if session_generation < state.next_session_generation {
                return Err(GameError::stale_session_generation());
            }
            if let Some(diagnostic) = cleanup_diagnostic {
                state.cleanup_failure = Some(CleanupFailure { diagnostic });
            }
            let health = state
                .cleanup_failure
                .as_ref()
                .map(|failure| PersistenceHealthView::Degraded {
                    diagnostic: failure.diagnostic.clone(),
                })
                .unwrap_or(PersistenceHealthView::Healthy);
            let subscribers = set_persistence_health(&mut state, health.clone());
            (health, subscribers, state.cleanup_failure.is_some())
        };
        publish_health(&subscribers, &health);
        self.retry_cleanup_if_needed(retry_cleanup);
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
            // Reject stale sessions before mutating persistence state. A
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
            let pending = PendingAutosave {
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
        self.schedule_autosave(pending)
    }

    pub(crate) fn pending_matches(&self, pending: &PendingAutosave) -> bool {
        self.state.lock().ok().is_some_and(|state| {
            state
                .pending_autosave
                .as_ref()
                .is_some_and(|live| pending_matches_identity(live, pending))
        })
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
                .is_some_and(|pending| pending_matches_identity(pending, completed));
            let receipt_identity = (receipt.session_generation, receipt.durable_revision);
            if state
                .last_successful_write
                .as_ref()
                .is_none_or(|successful| {
                    receipt_identity >= (successful.session_generation, successful.durable_revision)
                })
            {
                state.last_successful_write = Some(receipt);
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
            if let Some(diagnostic) = cleanup_diagnostic {
                state.cleanup_failure = Some(CleanupFailure { diagnostic });
            }
            let cleanup_retry = state.cleanup_failure.is_some();
            let health = health_after_completion(&state);
            let subscribers = set_persistence_health(&mut state, health.clone());
            (health, subscribers, cleanup_retry)
        } else {
            let health = PersistenceHealthView::Degraded {
                diagnostic: GameError::save_write_failed(),
            };
            (health, Vec::new(), false)
        };
        publish_health(&subscribers, &health);
        self.retry_cleanup_if_needed(cleanup_retry);
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
                state.last_successful_write = Some(receipt);
            }
            if state
                .failed_write
                .as_ref()
                .is_some_and(|failed| failed.identity <= receipt_identity)
            {
                state.failed_write = None;
            }
            if let Some(diagnostic) = cleanup_diagnostic {
                state.cleanup_failure = Some(CleanupFailure { diagnostic });
            }
            let cleanup_retry = state.cleanup_failure.is_some();
            let health = health_after_completion(&state);
            let subscribers = set_persistence_health(&mut state, health.clone());
            (health, subscribers, cleanup_retry)
        } else {
            let health = PersistenceHealthView::Degraded {
                diagnostic: GameError::save_write_failed(),
            };
            (health, Vec::new(), false)
        };
        publish_health(&subscribers, &health);
        self.retry_cleanup_if_needed(cleanup_retry);
    }

    pub(crate) fn record_stale_write(&self, completed: &PendingAutosave) {
        let (health, subscribers) = if let Ok(mut state) = self.state.lock() {
            if state
                .pending_autosave
                .as_ref()
                .is_some_and(|pending| pending_matches_identity(pending, completed))
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

    pub(crate) fn resolve_cleanup_failure(&self) {
        let publication = if let Ok(mut state) = self.state.lock() {
            if state.cleanup_failure.take().is_some() {
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

    pub(crate) fn record_cleanup_failure(&self, error: GameError) {
        let publication = if let Ok(mut state) = self.state.lock() {
            state.cleanup_failure = Some(CleanupFailure {
                diagnostic: error.clone(),
            });
            let health = health_after_completion(&state);
            let subscribers = set_persistence_health(&mut state, health.clone());
            Some((health, subscribers))
        } else {
            None
        };
        if let Some((health, subscribers)) = publication {
            publish_health(&subscribers, &health);
        }
    }

    fn retry_cleanup_if_needed(&self, needed: bool) {
        if !needed {
            return;
        }
        if let Err(error) = self.enqueue_orphan_cleanup() {
            self.record_cleanup_failure(error);
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
}
