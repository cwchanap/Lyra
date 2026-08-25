//! Exit Saving/Failed/Retry/Cancel/Without-Saving state machine.

use super::*;

impl ApplicationPersistence {
    pub(crate) fn lock_exit_transition(&self) -> Result<MutexGuard<'_, ()>, GameError> {
        self.exit_transition
            .lock()
            .map_err(|_| GameError::unavailable())
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
        let identity = {
            let session = self.session.lock().map_err(|_| GameError::unavailable())?;
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
            let mut session = self.session.lock().map_err(|_| GameError::unavailable())?;
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
        let parsed = Uuid::parse_str(&token.0)
            .ok()
            .filter(|parsed| parsed.hyphenated().to_string() == token.0)
            .ok_or_else(GameError::stale_persistence_failure_token)?;
        {
            let _transition = self
                .exit_transition
                .lock()
                .map_err(|_| GameError::unavailable())?;
            let session = self.session.lock().map_err(|_| GameError::unavailable())?;
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
        let session = self.session.lock().map_err(|_| GameError::unavailable())?;
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
        if self
            .fail_next_exit_prerequisite
            .swap(false, Ordering::SeqCst)
        {
            return Err(GameError::save_write_failed());
        }
        Ok(())
    }

    /// Exit-only transitions use `exit_transition -> session -> persistence
    /// state` and never acquire `operation_gate`. A path requiring both uses
    /// `operation_gate -> exit_transition -> session -> persistence state`.
    /// No transition holds this guard while publishing callbacks, awaiting,
    /// doing filesystem work, or invoking the external exit action.
    fn begin_exit_saving(
        &self,
        expected: ExitStatusView,
        deduplicate_mismatch: bool,
    ) -> Result<Option<ExitArmSnapshot>, GameError> {
        let (snapshot, subscribers) = {
            let _transition = self
                .exit_transition
                .lock()
                .map_err(|_| GameError::unavailable())?;
            let mut session = self.session.lock().map_err(|_| GameError::unavailable())?;
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

    pub(super) fn restore_exit_attempt(
        &self,
        recovery: ExitAttemptRecovery,
    ) -> Result<(), GameError> {
        let ExitAttemptRecovery {
            arm,
            consumed_failure_challenge,
        } = recovery;
        let subscribers = {
            let _transition = self
                .exit_transition
                .lock()
                .map_err(|_| GameError::unavailable())?;
            let mut session = self.session.lock().map_err(|_| GameError::unavailable())?;
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
        let persistence = self.clone();
        let (start_tx, start_rx) = tokio::sync::oneshot::channel();
        let run = async move {
            let Ok(recovery) = start_rx.await else {
                return;
            };
            let mut recovery = ExitAttemptRecoveryGuard::new(persistence.clone(), recovery);
            match persistence.flush_for_exit().await {
                Ok(()) => {
                    {
                        let Ok(mut state) = persistence.state.lock() else {
                            return;
                        };
                        state.programmatic_exit_bypass = true;
                    }
                    match exit.exit(0) {
                        Ok(()) => recovery.disarm(),
                        Err(error) => {
                            if let Ok(notification) = persistence.commit_exit_failure(error) {
                                recovery.disarm();
                                notification.publish();
                            }
                        }
                    }
                }
                Err(error) => {
                    if let Ok(notification) = persistence.commit_exit_failure(error) {
                        recovery.disarm();
                        notification.publish();
                    }
                }
            }
        };
        #[cfg(test)]
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(run);
            return Ok(start_tx);
        }
        #[cfg(not(test))]
        tauri::async_runtime::spawn(run);
        Ok(start_tx)
    }

    async fn flush_for_exit(&self) -> Result<(), GameError> {
        if self
            .session
            .lock()
            .map_err(|_| GameError::unavailable())?
            .engine
            .is_none()
        {
            return Ok(());
        }
        self.flush_session_parts(&self.session, &self.operation_gate, FlushOperation::Exit)
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
        let (status, health, exit_subscribers, health_subscribers) = {
            let _transition = self
                .exit_transition
                .lock()
                .map_err(|_| GameError::unavailable())?;
            let session = self.session.lock().map_err(|_| GameError::unavailable())?;
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
}
