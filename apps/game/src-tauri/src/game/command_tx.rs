// src-tauri/src/game/command_tx.rs
//
// Command transaction seam. Every engine command that mutates state and
// returns a view runs inside `command_tx`, which owns snapshot → execute →
// commit/restore and the single dialogue-history finalization point.

use super::scenes::SceneRuntime;
use super::state::Inventory;
use super::view::{DialogueHistoryEntry, GameStateView, QueueToken};
use super::{GameEngine, GameError, LastVisualCue};

/// Transient rollback state for a single in-flight command.
///
/// This is NOT the persistent `SaveSnapshot` of canonical design §16 — see
/// §7.4. Rollback may clone runtime-owned objects for atomic restoration;
/// persistent saves store stable IDs and mutable progress. HPA-129's save
/// capture reads the same field enumeration below, but into a different
/// contract.
pub(super) struct EngineRollbackSnapshot {
    current_chapter_idx: usize,
    current_scene_idx: usize,
    scene: SceneRuntime,
    last_visual_cue: LastVisualCue,
    inventory: Inventory,
    next_queue_gen: u64,
    dialogue_history: Vec<DialogueHistoryEntry>,
    next_dialogue_history_id: u64,
    last_recorded_dialogue_token: Option<QueueToken>,
}

impl EngineRollbackSnapshot {
    pub(super) fn capture(engine: &GameEngine) -> Self {
        // Exhaustive destructuring, no `..`: a field added to GameEngine fails
        // to compile here until it is classified as rollback-tracked or as
        // immutable-after-load.
        let GameEngine {
            resources_dir: _,
            chapters: _,
            current_chapter_idx,
            current_scene_idx,
            scene,
            last_visual_cue,
            inventory,
            next_queue_gen,
            dialogue_history,
            next_dialogue_history_id,
            last_recorded_dialogue_token,
        } = engine;
        Self {
            current_chapter_idx: *current_chapter_idx,
            current_scene_idx: *current_scene_idx,
            scene: scene.clone(),
            last_visual_cue: last_visual_cue.clone(),
            inventory: inventory.clone(),
            next_queue_gen: *next_queue_gen,
            dialogue_history: dialogue_history.clone(),
            next_dialogue_history_id: *next_dialogue_history_id,
            last_recorded_dialogue_token: last_recorded_dialogue_token.clone(),
        }
    }

    pub(super) fn restore(engine: &mut GameEngine, snapshot: EngineRollbackSnapshot) {
        // Exhaustive destructuring by value, no `..`: a field added to the
        // snapshot must be named here, and an unused binding is an error under
        // clippy's -D warnings, so it cannot be named and silently dropped.
        let EngineRollbackSnapshot {
            current_chapter_idx,
            current_scene_idx,
            scene,
            last_visual_cue,
            inventory,
            next_queue_gen,
            dialogue_history,
            next_dialogue_history_id,
            last_recorded_dialogue_token,
        } = snapshot;
        engine.current_chapter_idx = current_chapter_idx;
        engine.current_scene_idx = current_scene_idx;
        engine.scene = scene;
        engine.last_visual_cue = last_visual_cue;
        engine.inventory = inventory;
        engine.next_queue_gen = next_queue_gen;
        engine.dialogue_history = dialogue_history;
        engine.next_dialogue_history_id = next_dialogue_history_id;
        engine.last_recorded_dialogue_token = last_recorded_dialogue_token;
    }
}

impl GameEngine {
    /// Snapshot → run → restore on error. Returns the closure's value on
    /// success. Builds no view and records no history; use `command_tx` for
    /// command paths.
    ///
    /// Nesting is safe: an inner restore followed by an outer restore lands on
    /// the outer snapshot, which is what `advance_scene` running inside a
    /// command's transaction already relied on before this seam existed.
    pub(super) fn rollback_scope<T>(
        &mut self,
        f: impl FnOnce(&mut Self) -> Result<T, GameError>,
    ) -> Result<T, GameError> {
        let snapshot = EngineRollbackSnapshot::capture(self);
        match f(self) {
            Ok(value) => Ok(value),
            Err(err) => {
                EngineRollbackSnapshot::restore(self, snapshot);
                Err(err)
            }
        }
    }

    /// The command seam. Runs `f` under rollback, then finalizes dialogue
    /// history and builds the view.
    ///
    /// The closure returns `()`, so no command can produce a `GameStateView`
    /// from inside a transaction without history being recorded first. Note
    /// the limit of that guarantee: `GameEngine::view` is `pub` (lib.rs needs
    /// it), so a command that bypasses `command_tx` entirely can still skip
    /// history. The source-contract test in mod.rs covers that residual gap.
    ///
    /// `#[allow(dead_code)]`: no command body calls this yet in Task 1 — Task
    /// 2 converts command bodies to use it. Remove this allow once a caller
    /// exists.
    #[allow(dead_code)]
    pub(super) fn command_tx(
        &mut self,
        f: impl FnOnce(&mut Self) -> Result<(), GameError>,
    ) -> Result<GameStateView, GameError> {
        self.rollback_scope(f)?;
        self.record_current_dialogue_history();
        Ok(self.view())
    }
}
