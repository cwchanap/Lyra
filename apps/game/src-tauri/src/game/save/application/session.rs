use crate::game::save::coordinator::{AutosaveWriteReceipt, FlushOperation};
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
