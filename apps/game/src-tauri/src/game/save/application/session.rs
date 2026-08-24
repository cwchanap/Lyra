use super::ApplicationPersistence;
use crate::game::save::coordinator::{AutosaveWriteReceipt, FlushOperation, SaveCoordinator};
#[cfg(feature = "e2e")]
use crate::game::save::coordinator::{
    ExitStatusView, PersistenceHealthView, ThumbnailActivityView,
};
use crate::game::save::schema::SaveSlotRef;
use crate::game::{GameEngine, GameError};

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

    pub(crate) fn empty_at_generation(generation: u64) -> Self {
        Self {
            engine: None,
            persistence: SessionPersistence::for_installed_engine(generation, 0, None),
        }
    }

    pub(crate) fn durable_revision(&self) -> Option<u64> {
        self.engine.as_ref().map(GameEngine::durable_revision)
    }

    pub(crate) fn ensure_persistence_available(&self) -> Result<(), GameError> {
        if self.persistence.exit_flush_requested {
            Err(GameError::persistence_operation_in_progress())
        } else {
            Ok(())
        }
    }

    pub(crate) fn ensure_exit_flush_available(&self) -> Result<(), GameError> {
        if self.persistence.exit_flush_requested {
            Ok(())
        } else {
            Err(GameError::persistence_operation_in_progress())
        }
    }
}

pub(crate) struct SessionPersistence {
    pub(crate) generation: u64,
    pub(crate) flush_baseline_revision: u64,
    pub(crate) written_revision: Option<u64>,
    pub(crate) autosave_target: Option<SaveSlotRef>,
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

impl ApplicationPersistence {
    pub(crate) async fn install_session(
        &self,
        coordinator: &SaveCoordinator,
        engine: GameEngine,
        autosave_target: Option<SaveSlotRef>,
    ) -> Result<crate::game::GameStateView, GameError> {
        {
            let session = self.session.lock().map_err(|_| GameError::unavailable())?;
            session.ensure_persistence_available()?;
        }
        let view = engine.view()?;
        let _gate = self.operation_gate.lock().await;
        let mut session = self.session.lock().map_err(|_| GameError::unavailable())?;
        session.ensure_persistence_available()?;
        let generation = coordinator.next_session_generation()?;
        let autosave_target = match autosave_target {
            Some(target @ SaveSlotRef::Auto { .. }) => Some(target),
            Some(SaveSlotRef::Manual { .. }) | None => None,
        };
        *session = AppSession::installed(engine, generation, autosave_target);
        Ok(view)
    }

    pub(crate) async fn install_session_if_current(
        &self,
        coordinator: &SaveCoordinator,
        engine: GameEngine,
        autosave_target: Option<SaveSlotRef>,
        expected: SessionTransitionIdentity,
    ) -> Result<crate::game::GameStateView, GameError> {
        let view = engine.view()?;
        let _gate = self.operation_gate.lock().await;
        let mut session = self.session.lock().map_err(|_| GameError::unavailable())?;
        session.ensure_persistence_available()?;
        if session.persistence.generation != expected.generation
            || session.durable_revision() != expected.durable_revision
        {
            return Err(GameError::stale_save_selection());
        }
        let generation = coordinator.next_session_generation()?;
        let autosave_target = match autosave_target {
            Some(target @ SaveSlotRef::Auto { .. }) => Some(target),
            Some(SaveSlotRef::Manual { .. }) | None => None,
        };
        *session = AppSession::installed(engine, generation, autosave_target);
        Ok(view)
    }

    pub(crate) async fn clear_session(
        &self,
        coordinator: &SaveCoordinator,
    ) -> Result<u64, GameError> {
        {
            let session = self.session.lock().map_err(|_| GameError::unavailable())?;
            session.ensure_persistence_available()?;
        }
        let _gate = self.operation_gate.lock().await;
        let mut session = self.session.lock().map_err(|_| GameError::unavailable())?;
        session.ensure_persistence_available()?;
        let generation = coordinator.next_session_generation()?;
        *session = AppSession::empty_at_generation(generation);
        Ok(generation)
    }

    pub(crate) async fn clear_session_if_current(
        &self,
        coordinator: &SaveCoordinator,
        expected: SessionTransitionIdentity,
    ) -> Result<u64, GameError> {
        let _gate = self.operation_gate.lock().await;
        let mut session = self.session.lock().map_err(|_| GameError::unavailable())?;
        session.ensure_persistence_available()?;
        if session.persistence.generation != expected.generation
            || session.durable_revision() != expected.durable_revision
        {
            return Err(GameError::stale_persistence_failure_token());
        }
        let generation = coordinator.next_session_generation()?;
        *session = AppSession::empty_at_generation(generation);
        Ok(generation)
    }
}

#[cfg(feature = "e2e")]
#[derive(Debug)]
pub(crate) struct E2eSessionReplacement {
    pub(crate) generation: u64,
    pub(crate) state: crate::game::GameStateView,
}

#[cfg(feature = "e2e")]
impl ApplicationPersistence {
    pub(crate) async fn replace_session_for_e2e(
        &self,
        coordinator: &SaveCoordinator,
        engine: GameEngine,
    ) -> Result<E2eSessionReplacement, GameError> {
        let view = engine.view()?;
        {
            let session = self.session.lock().map_err(|_| GameError::unavailable())?;
            session.ensure_persistence_available()?;
        }
        {
            let state = coordinator
                .state
                .lock()
                .map_err(|_| GameError::unavailable())?;
            if state.exit_status == ExitStatusView::Saving {
                return Err(GameError::persistence_operation_in_progress());
            }
        }

        let _gate = self.operation_gate.lock().await;
        // The dual-lock path is deliberately operation_gate -> exit_transition
        // -> session -> coordinator state. Exit-only transitions never acquire
        // or await operation_gate, so this path cannot reverse the hierarchy.
        let _exit_transition = coordinator.lock_exit_transition()?;
        let mut session = self.session.lock().map_err(|_| GameError::unavailable())?;
        session.ensure_persistence_available()?;
        let mut state = coordinator
            .state
            .lock()
            .map_err(|_| GameError::unavailable())?;
        if state.exit_status == ExitStatusView::Saving {
            return Err(GameError::persistence_operation_in_progress());
        }
        let generation = state
            .next_session_generation
            .checked_add(1)
            .ok_or_else(GameError::save_write_failed)?;
        state.next_session_generation = generation;
        state.discovery_generation = state.discovery_generation.wrapping_add(1);
        state.tickets.clear();
        state.latest_by_intent.clear();
        state.pending_autosave = None;
        state.last_successful_write = None;
        state.failed_write = None;
        state.cleanup_failure = None;
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
        drop(state);
        drop(session);
        drop(_exit_transition);

        coordinator.reset_e2e_replacement_controls();
        crate::game::save::coordinator::publish_health(
            &health_subscribers,
            &PersistenceHealthView::Healthy,
        );
        crate::game::save::coordinator::publish_activity(
            &activity_subscribers,
            &ThumbnailActivityView::Idle,
        );
        crate::game::save::coordinator::publish_exit(&exit_subscribers, &ExitStatusView::Idle);
        coordinator.ticket_updates().notify_waiters();

        Ok(E2eSessionReplacement {
            generation,
            state: view,
        })
    }
}
