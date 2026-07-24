# GameEngine Seam Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract command-transaction, dialogue-lifecycle, and navigation seams out of `apps/game/src-tauri/src/game/mod.rs` so P0 persistence and P1 analysis work attach to stable delegation points, with zero runtime behaviour change.

**Architecture:** Four new sibling modules under `game/` hosting `impl GameEngine` blocks with `pub(super)` methods, plus one owned sub-struct (`DialogueHistory`). Semantic changes (transaction seam, history collapse, queue helpers) land first while code is still in `mod.rs`; module relocation happens afterwards as pure moves. This keeps every behaviour-changing diff small and reviewable, and makes the relocation commits trivially verifiable.

**Tech Stack:** Rust 2021, crate `lyra` / lib target `lyra_lib`, Tauri 2. Tests are inline `#[cfg(test)] mod tests` plus `apps/game/src-tauri/tests/full_playthrough.rs`.

**Spec:** `docs/superpowers/specs/2026-07-21-gameengine-seam-extraction-design.md`

## Global Constraints

- **No public API change.** All 16 public `GameEngine` methods keep name, signature, and error behaviour. `lib.rs`, `generate_handler!`, the IPC wire contract, and all frontend code are untouched.
- **No behaviour change.** If implementation reveals a behaviour difference, existing behaviour wins; record the discovery, do not fix engine bugs found in passing.
- **No feature work.** No `SaveSnapshot`, save file, autosave, `AcquisitionEventState`, story catalog, provenance, or analysis scene.
- **Test assertions move unmodified.** Permitted mechanical adjustments only: `use` statements, fixture paths, engine struct-literal fields, direct field-access paths, and adding `pub(super)` to shared fixtures.
- **Line citations in the spec are pinned to `f4fcb70`** and rot as soon as Task 1 lands. Locate code by symbol name.
- **Every task ends green:** `cargo test --manifest-path apps/game/src-tauri/Cargo.toml` passes before commit.
- **Rust privacy is parent-to-child.** A private item in a child module is not visible to its parent. Items in `game/<child>.rs` called from `game/mod.rs` need `pub(super)`.
- **Clippy runs with `-D warnings`.** Unused bindings, dead code, and unused imports are build failures, not warnings.

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `apps/game/src-tauri/src/game/command_tx.rs` | Create | `EngineRollbackSnapshot` with symmetric exhaustive capture/restore; `rollback_scope`; `command_tx` |
| `apps/game/src-tauri/src/game/dialogue.rs` | Create | `DialogueHistory`; queue install/advance/token/tag-consumption; exhaustion dispatch |
| `apps/game/src-tauri/src/game/navigation.rs` | Create | Scene loading, chapter/scene transition, jump, navigation index |
| `apps/game/src-tauri/src/game/acquisition.rs` | Create | `AcquisitionCtx` — named entry point for inventory acquisition |
| `apps/game/src-tauri/src/game/test_support.rs` | Create | `#[cfg(test)]` shared fixtures |
| `apps/game/src-tauri/src/game/mod.rs` | Modify | Engine struct, `LastVisualCue`, `new_started`, 13 view-returning commands, view builders |
| `apps/game/src-tauri/src/game/reveals.rs` | Modify | Take `&mut AcquisitionCtx` instead of `&mut Inventory` |
| `apps/game/src-tauri/src/game/state.rs` | Modify | Narrow `add_*_from_def` to `pub(in crate::game)` |

---

## Task 1: Command transaction seam

**Files:**

- Create: `apps/game/src-tauri/src/game/command_tx.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs` (declare module; delete `GameSnapshot`, `snapshot`, `restore_snapshot`, `restore_on_error`, `view_with_history`)

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `pub(super) struct EngineRollbackSnapshot` with `pub(super) fn capture(engine: &GameEngine) -> Self` and `pub(super) fn restore(engine: &mut GameEngine, snapshot: EngineRollbackSnapshot)`.
  - `GameEngine::rollback_scope<T>(&mut self, f: impl FnOnce(&mut Self) -> Result<T, GameError>) -> Result<T, GameError>` — `pub(super)`.
  - `GameEngine::command_tx(&mut self, f: impl FnOnce(&mut Self) -> Result<(), GameError>) -> Result<GameStateView, GameError>` — `pub(super)`.

This task adds the seam and converts nothing. All 12 existing `restore_on_error` call sites are rewritten to `rollback_scope` mechanically so the old helpers can be deleted in one commit; command bodies keep their current shape until Task 2.

- [ ] **Step 1: Write the failing test**

Add to `apps/game/src-tauri/src/game/mod.rs`, inside the existing `#[cfg(test)] mod tests` block, at the end. These tests live in `mod.rs` for now and move to `command_tx.rs` in Task 8.

Note the fixture signatures, both already present in that test module: `investigation_scene_with_intro(id: &str, intro: Vec<DialogueItem>)` and `empty_engine_with_scene(scene: InvestigationSceneJson, intro_queue_gen: u64)`.

```rust
    #[test]
    fn rollback_scope_restores_every_tracked_field_on_error() {
        let scene = investigation_scene_with_intro(
            "investigation_scene_1",
            vec![DialogueItem::Line {
                speaker: "A".into(),
                text: "intro".into(),
                portrait: None,
            }],
        );
        let mut engine = empty_engine_with_scene(scene, 1);
        engine.inventory.add_evidence_from_def(
            &EvidenceJson {
                id: "before".into(),
                name: "before".into(),
                description: "before".into(),
                details: "before".into(),
                image_asset_id: None,
                on_collect: vec![],
                on_reexamine: None,
            },
            "chapter_1",
            "investigation_scene_1",
        );
        let gen_before = engine.next_queue_gen;
        let evidence_before = engine.inventory.evidence.len();

        let result: Result<(), GameError> = engine.rollback_scope(|e| {
            e.next_queue_gen += 99;
            e.inventory.evidence.clear();
            e.current_scene_idx += 5;
            Err(GameError::internal("boom".into()))
        });

        assert!(result.is_err());
        assert_eq!(engine.next_queue_gen, gen_before, "next_queue_gen not restored");
        assert_eq!(
            engine.inventory.evidence.len(),
            evidence_before,
            "inventory not restored"
        );
        assert_eq!(engine.current_scene_idx, 0, "scene index not restored");
    }

    #[test]
    fn rollback_scope_keeps_mutations_on_success() {
        let scene = investigation_scene_with_intro("investigation_scene_1", vec![]);
        let mut engine = empty_engine_with_scene(scene, 1);
        let gen_before = engine.next_queue_gen;

        let result: Result<u64, GameError> = engine.rollback_scope(|e| {
            e.next_queue_gen += 7;
            Ok(e.next_queue_gen)
        });

        assert_eq!(result.unwrap(), gen_before + 7);
        assert_eq!(engine.next_queue_gen, gen_before + 7);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml rollback_scope`

Expected: FAIL to compile with `no method named 'rollback_scope' found for struct 'GameEngine'`.

- [ ] **Step 3: Create the module**

Write `apps/game/src-tauri/src/game/command_tx.rs`:

```rust
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
    pub(super) fn command_tx(
        &mut self,
        f: impl FnOnce(&mut Self) -> Result<(), GameError>,
    ) -> Result<GameStateView, GameError> {
        self.rollback_scope(f)?;
        self.record_current_dialogue_history();
        Ok(self.view())
    }
}
```

- [ ] **Step 4: Declare the module and delete the superseded helpers**

In `apps/game/src-tauri/src/game/mod.rs`, add to the module declarations at the top (keep alphabetical order):

```rust
pub mod command_tx;
```

Delete the `struct GameSnapshot { … }` definition, and the `snapshot`, `restore_snapshot`, and `restore_on_error` methods from `impl GameEngine`.

Rewrite all 12 `restore_on_error` call sites. Each currently reads:

```rust
        let snapshot = self.snapshot();
        let result = (|| -> Result<GameStateView, GameError> {
            /* body */
            Ok(self.view_with_history())
        })();
        self.restore_on_error(snapshot, result)
```

and becomes:

```rust
        self.rollback_scope(|engine| -> Result<GameStateView, GameError> {
            /* body, with every `self.` replaced by `engine.` */
            Ok(engine.view_with_history())
        })
```

Rewrite the two hand-rolled sites the same way. In `advance_dialogue`:

```rust
        self.rollback_scope(|engine| -> Result<(), GameError> {
            /* existing closure body, self. → engine. */
            Ok(())
        })?;
        Ok(self.view_with_history())
```

In `advance_scene`, replace the trailing

```rust
        if let Err(err) = self.prime_initial_queue() {
            self.restore_snapshot(snapshot);
            return Err(err);
        }
        Ok(())
```

and the `let snapshot = self.snapshot();` above it, wrapping the mutation block:

```rust
        self.rollback_scope(|engine| {
            engine.current_chapter_idx = next_chapter_idx;
            engine.current_scene_idx = next_scene_idx;
            engine.scene = new_scene;
            engine.last_visual_cue.reset_for_new_scene();
            engine.next_queue_gen += 1;
            engine.prime_initial_queue()
        })
```

Keep `view_with_history` for now; Task 2 removes it.

- [ ] **Step 5: Run the new tests**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml rollback_scope`

Expected: PASS, 2 tests.

- [ ] **Step 6: Run the full suite**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml`

Expected: PASS. No test count change other than the 2 added.

- [ ] **Step 7: Lint and format**

Run: `bun run rust:fmt && bun run rust:lint`

Expected: no diff, no clippy warnings.

- [ ] **Step 8: Commit**

```bash
git add apps/game/src-tauri/src/game/command_tx.rs apps/game/src-tauri/src/game/mod.rs
git commit -m "refactor(engine): add EngineRollbackSnapshot and rollback_scope seam (HPA-55)"
```

---

## Task 2: Convert commands to `command_tx`

**Files:**

- Modify: `apps/game/src-tauri/src/game/mod.rs`

**Interfaces:**

- Consumes: `GameEngine::command_tx`, `GameEngine::rollback_scope` from Task 1.
- Produces: all 13 public view-returning methods routed through `command_tx`; `view_with_history` deleted.

Convert the eleven straightforward commands first, then `jump_to_scene` and `advance_dialogue`, which have hazards.

- [ ] **Step 1: Establish the rollback-delegate baseline**

The spec's acceptance criterion "command rollback tests cover investigation and interrogation delegates" is **already satisfied by six existing tests**, and they are stronger evidence than new ones because they predate this refactor:

| Test | Delegate |
| --- | --- |
| `failed_initial_silent_investigation_transition_rolls_back_inventory` | investigation |
| `failed_investigation_intro_completion_rolls_back_inventory` | investigation |
| `failed_silent_investigation_completion_rolls_back_action_state` | investigation |
| `failed_scene_advance_keeps_previous_dialogue_view` | investigation |
| `reexamine_evidence_rolls_back_tag_only_queue_when_scene_advance_fails` | interrogation (engine scene is `SceneRuntime::Interrogation`) |
| `reexamine_statement_rolls_back_tag_only_queue_when_scene_advance_fails` | interrogation |

Do **not** write replacements for these. Task 1's two `rollback_scope` unit tests already cover the seam directly; these six cover the delegates through real commands.

Record the baseline before touching anything:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml rolls_back 2>&1 | tail -3
cargo test --manifest-path apps/game/src-tauri/Cargo.toml failed_ 2>&1 | tail -3
```

Expected: all pass. These are the gate for every step in this task.

- [ ] **Step 2: Note the fixture signature you will need**

`completed_interrogation_engine_with_bad_next_scene(resources_dir: PathBuf, inventory: Inventory)` takes **two** arguments and builds a `GameEngine` struct literal — it is one of the nine literals Task 3 rewrites. No change needed here; just be aware the two `reexamine_*_rolls_back_*` tests depend on it.

- [ ] **Step 3: Convert the eleven straightforward commands**

For each of `inspect_hotspot`, `interview_topic`, `enter_sublocation`, `reexamine_evidence`, `reexamine_statement`, `ask_interrogation_question`, `challenge_interrogation_line`, `present_interrogation_evidence`, `withdraw_interrogation`, `resume_interrogation_testimony`, `complete_interrogation_phase`:

Replace the `rollback_scope` wrapper introduced in Task 1 with `command_tx`, dropping the trailing view construction. The pattern:

```rust
        self.rollback_scope(|engine| -> Result<GameStateView, GameError> {
            /* body */
            Ok(engine.view_with_history())
        })
```

becomes

```rust
        self.command_tx(|engine| {
            /* same body */
            Ok(())
        })
```

Guard clauses above the transaction stay exactly where they are. The compute phase does **not** move — the closure receives `&mut Self`, so everything done with `engine.` inside stays inside.

- [ ] **Step 4: Convert `advance_dialogue`**

The stale-token early return stays outside the transaction and keeps its bare `view()`:

```rust
    pub fn advance_dialogue(&mut self, expected: QueueToken) -> Result<GameStateView, GameError> {
        let current_token = match self.current_queue_token() {
            Some(t) => t,
            None => return Err(GameError::no_active_dialogue()),
        };
        // Stale token: the frontend acted on a view we have already replaced.
        // Not a transaction, and deliberately records no history.
        if current_token != expected {
            return Ok(self.view());
        }

        self.command_tx(|engine| {
            /* existing cursor-advance body, self. → engine. */
            Ok(())
        })
    }
```

- [ ] **Step 5: Convert `jump_to_scene` — read this step fully before editing**

`jump_to_scene` is the one command whose transaction boundary is not the existing closure. All nine reset mutations currently sit between `snapshot()` and the closure. They **must move inside** the `command_tx` closure, or a `prime_initial_queue` failure rolls back to the already-wiped state instead of the pre-jump state.

Only the non-mutating resolution stays outside:

```rust
    pub fn jump_to_scene(
        &mut self,
        chapter_id: &str,
        scene_id: &str,
    ) -> Result<GameStateView, GameError> {
        let chapter_idx = self
            .chapters
            .iter()
            .position(|chapter| chapter.id == chapter_id)
            .ok_or_else(|| GameError::unknown_chapter(chapter_id))?;
        let queue_gen = self.next_queue_gen;
        let (scene_idx, new_scene) = find_scene_runtime_by_id(
            &self.resources_dir,
            &self.chapters[chapter_idx],
            scene_id,
            queue_gen,
        )?
        .ok_or_else(|| GameError::unknown_scene(chapter_id, scene_id))?;

        self.command_tx(move |engine| {
            engine.current_chapter_idx = chapter_idx;
            engine.current_scene_idx = scene_idx;
            engine.scene = new_scene;
            engine.last_visual_cue = LastVisualCue::default();
            engine.inventory = Inventory::default();
            engine.next_queue_gen = queue_gen + 1;
            engine.dialogue_history = vec![];
            engine.next_dialogue_history_id = 1;
            engine.last_recorded_dialogue_token = None;

            engine.prime_initial_queue()?;
            // Developer convenience: jumping straight into an interrogation via
            // scene-navigation skips the investigation where its contradiction
            // evidence is normally collected. Grant everything so every
            // testimony is presentable for testing. Gated to debug builds
            // (`cfg!(debug_assertions)`) because Scene Select is also exposed
            // in production replay after `storyClearedOnce`; releasing the full
            // inventory there would spoil every scene's evidence and bypass
            // the intended inventory gating.
            if cfg!(debug_assertions) && matches!(engine.scene, SceneRuntime::Interrogation(_)) {
                engine.grant_all_evidence_for_testing();
            }
            Ok(())
        })
    }
```

- [ ] **Step 6: Verify the jump hazard specifically**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml jump_to_scene_restores`

Expected: PASS, 2 tests — `jump_to_scene_restores_previous_state_when_priming_fails` and `jump_to_scene_restores_non_empty_dialogue_history_when_priming_fails`. **If either fails, the reset mutations are outside the closure.** Do not proceed until both pass.

- [ ] **Step 7: Delete `view_with_history`**

Remove the `view_with_history` method and its doc comment from `mod.rs`. Nothing should reference it.

Run: `cargo build --manifest-path apps/game/src-tauri/Cargo.toml`

Expected: compiles clean. Any error naming `view_with_history` is an unconverted command — convert it.

- [ ] **Step 8: Full suite, lint, commit**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml && bun run rust:fmt && bun run rust:lint`

Expected: all pass.

```bash
git add apps/game/src-tauri/src/game/mod.rs
git commit -m "refactor(engine): route every view-returning command through command_tx (HPA-55)"
```

---

## Task 3: `DialogueHistory` owned unit

**Files:**

- Create: `apps/game/src-tauri/src/game/dialogue.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`, `apps/game/src-tauri/src/game/command_tx.rs`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `pub(super) struct DialogueHistory` with `Default`, and methods `entries(&self) -> &[DialogueHistoryEntry]`, `reset(&mut self)`, `is_last_token(&self, token: &QueueToken) -> bool`, `record(&mut self, token: QueueToken, item: DialogueItem, chapter_title: String, scene_title: String)`. `GameEngine.history: DialogueHistory` replaces the three history fields.

- [ ] **Step 1: Write the failing unit tests**

Create `apps/game/src-tauri/src/game/dialogue.rs`:

```rust
// src-tauri/src/game/dialogue.rs
//
// Dialogue history and queue lifecycle.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::DialogueItem;
    use crate::game::view::{DialogueHistoryEntry, QueueToken};

    fn token(cursor: usize) -> QueueToken {
        QueueToken {
            scene_id: "s".into(),
            queue_gen: 1,
            cursor,
        }
    }

    fn line(text: &str) -> DialogueItem {
        DialogueItem::Line {
            speaker: "A".into(),
            text: text.into(),
            portrait: None,
        }
    }

    #[test]
    fn record_dedups_on_repeated_token() {
        let mut h = DialogueHistory::default();
        h.record(token(0), line("a"), "ch".into(), "sc".into());
        h.record(token(0), line("a"), "ch".into(), "sc".into());
        assert_eq!(h.entries().len(), 1);
    }

    #[test]
    fn record_keeps_newest_fifty() {
        let mut h = DialogueHistory::default();
        for i in 0..55 {
            h.record(token(i), line(&format!("line {i}")), "ch".into(), "sc".into());
        }
        assert_eq!(h.entries().len(), 50);
        match &h.entries()[0] {
            DialogueHistoryEntry::Line { text, .. } => assert_eq!(text, "line 5"),
            other => panic!("expected line, got {other:?}"),
        }
    }

    #[test]
    fn record_ignores_scene_tags_without_consuming_the_token() {
        let mut h = DialogueHistory::default();
        h.record(
            token(0),
            DialogueItem::SceneTag {
                text: "tag".into(),
                asset_cue: None,
            },
            "ch".into(),
            "sc".into(),
        );
        assert!(h.entries().is_empty());
        // A SceneTag must not mark the token as recorded, or the real item at
        // that cursor would be deduped away.
        assert!(!h.is_last_token(&token(0)));
    }

    #[test]
    fn reset_clears_entries_and_restarts_ids() {
        let mut h = DialogueHistory::default();
        h.record(token(0), line("a"), "ch".into(), "sc".into());
        h.reset();
        assert!(h.entries().is_empty());
        h.record(token(1), line("b"), "ch".into(), "sc".into());
        match &h.entries()[0] {
            DialogueHistoryEntry::Line { id, .. } => assert_eq!(*id, 1),
            other => panic!("expected line, got {other:?}"),
        }
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml --lib dialogue::`

Expected: FAIL to compile — `cannot find type 'DialogueHistory'`, and `dialogue` is not a declared module.

- [ ] **Step 3: Implement `DialogueHistory`**

Add above the test module in `dialogue.rs`:

```rust
use super::schema::DialogueItem;
use super::view::{DialogueHistoryEntry, QueueToken};

const DIALOGUE_HISTORY_LIMIT: usize = 50;

/// The engine's rolling dialogue log. Owns dedup-by-token, the entry cap, and
/// the rule that scene tags are not logged.
pub(super) struct DialogueHistory {
    entries: Vec<DialogueHistoryEntry>,
    next_id: u64,
    last_token: Option<QueueToken>,
}

impl Default for DialogueHistory {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            next_id: 1,
            last_token: None,
        }
    }
}

impl DialogueHistory {
    pub(super) fn entries(&self) -> &[DialogueHistoryEntry] {
        &self.entries
    }

    pub(super) fn reset(&mut self) {
        *self = Self::default();
    }

    pub(super) fn is_last_token(&self, token: &QueueToken) -> bool {
        self.last_token.as_ref() == Some(token)
    }

    pub(super) fn record(
        &mut self,
        token: QueueToken,
        item: DialogueItem,
        chapter_title: String,
        scene_title: String,
    ) {
        if self.is_last_token(&token) {
            return;
        }
        let id = self.next_id;
        let entry = match item {
            DialogueItem::Line {
                speaker,
                text,
                portrait: _,
            } => DialogueHistoryEntry::Line {
                id,
                speaker,
                text,
                chapter_title,
                scene_title,
            },
            DialogueItem::Action { text } => DialogueHistoryEntry::Action {
                id,
                text,
                chapter_title,
                scene_title,
            },
            // Scene tags are not logged, and must not consume the token —
            // matching the pre-extraction early return.
            DialogueItem::SceneTag { .. } => return,
        };

        self.next_id += 1;
        self.last_token = Some(token);
        self.entries.push(entry);
        let overflow = self.entries.len().saturating_sub(DIALOGUE_HISTORY_LIMIT);
        if overflow > 0 {
            self.entries.drain(0..overflow);
        }
    }
}
```

Declare the module in `mod.rs`: `pub mod dialogue;` and delete the now-duplicated `const DIALOGUE_HISTORY_LIMIT` from `mod.rs`.

- [ ] **Step 4: Run the unit tests**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml --lib dialogue::`

Expected: PASS, 4 tests.

- [ ] **Step 5: Collapse the engine fields**

In `mod.rs`, replace the three fields in `struct GameEngine`:

```rust
    dialogue_history: Vec<DialogueHistoryEntry>,
    next_dialogue_history_id: u64,
    last_recorded_dialogue_token: Option<QueueToken>,
```

with

```rust
    history: dialogue::DialogueHistory,
```

Rewrite `record_current_dialogue_history` to delegate, preserving the current ordering — the dedup check runs **before** the chapter `.expect()`:

```rust
    fn record_current_dialogue_history(&mut self) {
        let Some(token) = self.current_queue_token() else {
            return;
        };
        if self.history.is_last_token(&token) {
            return;
        }
        let Some(item) = self.current_dialogue_item() else {
            return;
        };
        // Indexing with a clamp silently masks an out-of-range chapter index
        // and panics (usize underflow) when `chapters` is empty. Both states
        // are engine invariants — surface them with a clear expect instead.
        let chapter_title = self
            .chapters
            .get(self.current_chapter_idx)
            .expect("current_chapter_idx must reference a loaded chapter when recording dialogue history")
            .title
            .clone();
        let scene_title = self.current_scene_title();
        self.history.record(token, item, chapter_title, scene_title);
    }
```

In `view()`, replace `dialogue_history: self.dialogue_history.clone()` with `dialogue_history: self.history.entries().to_vec()`.

In `new_started`, replace the three initializers with `history: dialogue::DialogueHistory::default()`.

In `jump_to_scene`'s closure, replace the three reset assignments with `engine.history.reset();`.

- [ ] **Step 6: Update the snapshot**

In `command_tx.rs`, replace the three snapshot fields with `history: DialogueHistory`, add `#[derive(Clone)]`-free cloning by giving `DialogueHistory` a `Clone` derive (add `#[derive(Clone)]` above `pub(super) struct DialogueHistory`), and update both destructuring blocks: `capture` binds `history` and stores `history.clone()`; `restore` binds `history` and assigns `engine.history = history;`.

The compiler enforces this — `capture`'s exhaustive pattern will not compile against the new struct until updated. That is the seam working as designed.

- [ ] **Step 7: Update the nine test struct literals**

In `mod.rs`'s test module, replace each occurrence of

```rust
            dialogue_history: vec![],
            next_dialogue_history_id: 1,
            last_recorded_dialogue_token: None,
```

with

```rust
            history: dialogue::DialogueHistory::default(),
```

and replace the two direct reads of `engine.dialogue_history` with `engine.history.entries()`.

Reads of `view.dialogue_history` are **unchanged** — `GameStateView` keeps that field.

- [ ] **Step 8: Full suite, lint, commit**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml && bun run rust:fmt && bun run rust:lint`

Expected: all pass.

```bash
git add apps/game/src-tauri/src/game/dialogue.rs apps/game/src-tauri/src/game/mod.rs apps/game/src-tauri/src/game/command_tx.rs
git commit -m "refactor(engine): extract DialogueHistory as an owned unit (HPA-55)"
```

---

## Task 4: History enforcement tests

**Files:**

- Modify: `apps/game/src-tauri/src/game/mod.rs`

**Interfaces:**

- Consumes: `command_tx` (Task 2), `DialogueHistory` (Task 3).
- Produces: no production API. Replaces `every_view_returning_command_routes_through_view_with_history`.

- [ ] **Step 1: Write the behavioural history test**

The predicate is **focused queue token**, not "advancing". An installing command produces a new token at cursor 0 and therefore records, despite advancing nothing. Add to `mod.rs`'s test module:

```rust
    #[test]
    fn new_focused_token_records_exactly_one_history_entry() {
        let d = dialogue_history_fixture_resources(3);
        let mut engine = GameEngine::new_started(d).unwrap();
        let before = engine.view().dialogue_history.len();

        let view = engine.advance_dialogue(token_from(&engine.view())).unwrap();

        assert_eq!(
            view.dialogue_history.len(),
            before + 1,
            "a new focused token must append exactly one entry"
        );
    }

    #[test]
    fn unchanged_focused_token_records_nothing() {
        let d = dialogue_history_fixture_resources(3);
        let mut engine = GameEngine::new_started(d).unwrap();
        let token = token_from(&engine.view());
        let after_first = engine.advance_dialogue(token.clone()).unwrap();
        let count = after_first.dialogue_history.len();

        // Replaying the now-stale token does not advance, so the focused token
        // is unchanged and nothing is recorded.
        let view = engine.advance_dialogue(token).unwrap();

        assert_eq!(view.dialogue_history.len(), count);
    }

    #[test]
    fn installing_command_records_despite_advancing_nothing() {
        // inspect_hotspot installs a fresh queue at cursor 0. It advances no
        // existing dialogue, but it does produce a new focused token, so its
        // first item must be logged. Phrasing this contract as "advances" would
        // leave this path — most of the commands — untested.
        let scene = InvestigationSceneJson {
            id: "investigation_scene_1".into(),
            title: "Room".into(),
            asset_refs: vec![],
            intro: vec![],
            sublocations: vec![SublocationJson {
                id: "room".into(),
                label: "Room".into(),
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
                flattened_asset_cue: VisualAssetCueJson::default(),
                transition_dialogue: vec![],
                hotspots: vec![HotspotJson {
                    id: "desk".into(),
                    label: "Desk".into(),
                    description: "A desk.".into(),
                    status: LockStatus::Unlocked,
                    unlock: None,
                    reveals: vec![],
                    layout: None,
                    inspect_dialogue: vec![DialogueItem::Line {
                        speaker: "A".into(),
                        text: "a drawer is ajar".into(),
                        portrait: None,
                    }],
                    on_reexamine: None,
                }],
                characters: vec![],
            }],
            evidence_manifest: vec![],
            statement_manifest: vec![],
            outro: OutroJson {
                // Never satisfied, so inspecting cannot end the scene and the
                // installed queue stays the focused dialogue.
                unlock: OutroUnlock::Expr(UnlockExpr::HotspotInvestigated {
                    id: "absent".into(),
                }),
                dialogue: vec![],
            },
        };
        let mut engine = empty_engine_with_scene(scene, 1);
        engine.prime_initial_queue().unwrap();
        let before = engine.view().dialogue_history.len();

        let view = engine.inspect_hotspot("desk").unwrap();

        assert_eq!(
            view.dialogue_history.len(),
            before + 1,
            "an installing command must log its first item"
        );
    }
```

Check `UnlockExpr`'s hotspot-predicate variant name in `schema.rs` before running and use whatever it is — the point is only that the outro can never be satisfied.

- [ ] **Step 2: Run to verify they pass or fail meaningfully**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml focused_token installing_command`

Expected: PASS. These describe behaviour that already holds; they exist to lock it. If `installing_command_records_despite_advancing_nothing` fails, `command_tx` is not recording on install paths — stop and diagnose before continuing.

- [ ] **Step 3: Replace the source-contract test**

Delete `every_view_returning_command_routes_through_view_with_history` entirely and add:

```rust
    /// Source-contract guard. `command_tx` guarantees history finalization only
    /// for commands that use it, and `GameEngine::view` must stay `pub` for
    /// lib.rs, so nothing structurally prevents a new command from returning
    /// `Ok(self.view())` and skipping the log. This scans the engine modules
    /// for that mistake.
    ///
    /// Weaker than a type guarantee, and deliberately kept until one exists.
    #[test]
    fn every_view_returning_command_routes_through_command_tx() {
        let sources: &[(&str, &str)] = &[
            ("mod.rs", include_str!("mod.rs")),
            ("command_tx.rs", include_str!("command_tx.rs")),
            ("dialogue.rs", include_str!("dialogue.rs")),
            ("navigation.rs", include_str!("navigation.rs")),
        ];
        // Documented exemptions. Each needs a justification here.
        //   advance_dialogue — stale-token early return is not a transaction
        //                      and deliberately records no history.
        let allowed: &[&str] = &["advance_dialogue"];

        let mut seen: Vec<String> = Vec::new();
        let mut missing: Vec<String> = Vec::new();

        for (file, source) in sources {
            let mut current: Option<String> = None;
            let mut body_has_tx = false;
            let mut signature = String::new();
            let mut in_signature = false;

            for line in source.lines() {
                let trimmed = line.trim_start();
                if trimmed.starts_with("mod tests {") || trimmed.starts_with("#[cfg(test)]") {
                    break;
                }
                if trimmed.starts_with("pub fn ") {
                    if let Some(name) = current.take() {
                        if !body_has_tx && !allowed.contains(&name.as_str()) {
                            missing.push(format!("{file}::{name}"));
                        }
                        body_has_tx = false;
                    }
                    signature.clear();
                    signature.push_str(trimmed);
                    in_signature = !trimmed.contains('{');
                    if !in_signature {
                        if let Some(name) = tracked_command_name(&signature) {
                            seen.push(format!("{file}::{name}"));
                            current = Some(name);
                        }
                    }
                    continue;
                }
                if in_signature {
                    signature.push(' ');
                    signature.push_str(trimmed);
                    if trimmed.contains('{') {
                        in_signature = false;
                        if let Some(name) = tracked_command_name(&signature) {
                            seen.push(format!("{file}::{name}"));
                            current = Some(name);
                        }
                    }
                    continue;
                }
                if current.is_some() && trimmed.contains("command_tx(") {
                    body_has_tx = true;
                }
            }
            if let Some(name) = current.take() {
                if !body_has_tx && !allowed.contains(&name.as_str()) {
                    missing.push(format!("{file}::{name}"));
                }
            }
        }

        assert!(
            !seen.is_empty(),
            "scanner found no Result<GameStateView, GameError> commands; it is broken"
        );
        assert!(
            missing.is_empty(),
            "these commands return Result<GameStateView, GameError> but never call \
             command_tx(), so they can silently skip dialogue history: {missing:?} \
             (tracked: {seen:?})"
        );
    }

    /// Extracts the fn name from an accumulated signature if it returns a view.
    fn tracked_command_name(signature: &str) -> Option<String> {
        if !signature.contains("-> Result<GameStateView, GameError>") {
            return None;
        }
        let after = signature.strip_prefix("pub fn ")?;
        Some(
            after
                .split(|c: char| c == '(' || c.is_whitespace())
                .next()?
                .to_string(),
        )
    }
```

**Note:** `navigation.rs` does not exist until Task 6. Until then, drop that entry from `sources` and add it in Task 6 Step 5.

- [ ] **Step 4: Run the scanner**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml every_view_returning_command`

Expected: PASS. If it reports missing commands, those are genuinely unconverted — fix them, don't extend the allow-list.

- [ ] **Step 5: Full suite, lint, commit**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml && bun run rust:fmt && bun run rust:lint`

```bash
git add apps/game/src-tauri/src/game/mod.rs
git commit -m "test(engine): enforce history finalization by token change and command_tx routing (HPA-55)"
```

---

## Task 5: Queue install helpers

**Files:**

- Modify: `apps/game/src-tauri/src/game/mod.rs`

**Interfaces:**

- Consumes: nothing new.
- Produces: `GameEngine::install_or_exhaust(&mut self, items: Vec<DialogueItem>) -> Result<(), GameError>` and `GameEngine::install_or_exhaust_line_content(&mut self, items: Vec<DialogueItem>, line_content_start: usize) -> Result<(), GameError>`. `install_investigation_queue` deleted.

- [ ] **Step 1: Write the failing degenerate-testimony test**

This locks the carve-out that keeps `advance_playing_testimony`'s empty branch out of the helper. Add to `mod.rs`'s test module:

The fixture must hit the *unbroken* degenerate path, which existing fixtures do not. `empty_testimony()` has `lines: vec![]`, so a question using it auto-breaks and takes the honest-question route — already covered by `honest_question_returns_to_menu_after_draining`. What is needed is a question that stays **unbroken** (it has a contradiction line) whose line content is empty and which has no loop bridge:

```rust
    #[test]
    fn degenerate_testimony_returns_to_menu_without_recursing() {
        // An UNBROKEN question whose only testimony line has empty content and
        // whose testimony has no on_loop / loop_prompt bridge. Asking it
        // installs nothing, so advance_playing_testimony reaches its degenerate
        // branch. That branch must withdraw first and then run the phase/outro
        // checks. It must NOT call on_queue_exhausted: that function's
        // interrogation arm dispatches straight back into
        // advance_playing_testimony while is_playing_unbroken() holds, which
        // recurses without bound.
        let scene = InterrogationSceneJson {
            id: "interrogation_scene_1".into(),
            title: "Interrogation".into(),
            asset_refs: vec![],
            intro: vec![],
            phases: vec![InterrogationPhaseJson::Inquiry {
                id: "inquiry".into(),
                label: "Inquiry".into(),
                subject: subject(),
                required: false,
                status: LockStatus::Unlocked,
                unlock: None,
                reveals: vec![],
                scene_tag: "room".into(),
                flattened_asset_cue: VisualAssetCueJson::default(),
                entry_dialogue: vec![],
                complete: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                questions: vec![InquiryQuestionJson {
                    id: "q_degenerate".into(),
                    label: "Degenerate".into(),
                    status: LockStatus::Unlocked,
                    required: false,
                    unlock: None,
                    reveals: vec![],
                    testimony: TestimonyJson {
                        on_loop: vec![],
                        loop_prompt: vec![],
                        default_challenge: vec![],
                        default_wrong: vec![],
                        wrong_reply: vec![],
                        lines: vec![TestimonyLineJson {
                            id: "l_empty".into(),
                            label: "Empty".into(),
                            // Empty content plus an empty loop bridge is what
                            // makes the queue degenerate.
                            content: vec![],
                            // A contradiction keeps the question unbroken, so
                            // the engine enters the Playing loop rather than
                            // the honest-question path.
                            contradiction: Some(InventoryTarget::Evidence {
                                id: "never_held".into(),
                            }),
                            challenge: vec![],
                            on_correct: vec![],
                            on_wrong_evidence: vec![],
                            reveals: vec![],
                        }],
                    },
                }],
            }],
            evidence_manifest: vec![],
            statement_manifest: vec![],
            outro: InterrogationOutroJson {
                unlock: InterrogationOutroUnlock::Auto(AutoMarker::Auto),
                dialogue: vec![],
            },
        };
        let mut engine = empty_engine_with_interrogation_scene(scene, 1);

        let view = engine.ask_interrogation_question("q_degenerate").unwrap();

        assert!(
            !matches!(view.mode, ModeView::Dialogue { .. }),
            "degenerate testimony left the engine in dialogue mode: {:?}",
            view.mode
        );
    }
```

Check `empty_engine_with_interrogation_scene`'s arity before running — it is a two-argument fixture like its investigation counterpart.

- [ ] **Step 2: Run it**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml degenerate_testimony`

Expected: PASS (current behaviour is correct; this test guards it). If it **hangs**, the fixture has produced a genuinely recursive state — reduce it until it terminates, since a hanging test is not a usable guard.

- [ ] **Step 3: Add the helpers**

Add to `impl GameEngine` in `mod.rs`, next to `install_scene_queue`:

```rust
    /// Install `items` as the active dialogue queue, or run the exhausted-queue
    /// machinery when there is nothing to play.
    fn install_or_exhaust(&mut self, items: Vec<DialogueItem>) -> Result<(), GameError> {
        if items.is_empty() {
            return self.on_queue_exhausted();
        }
        let queue_gen = self.alloc_queue_gen();
        self.install_scene_queue(items, queue_gen)
    }

    /// As `install_or_exhaust`, then mark where challengeable testimony line
    /// content begins in the installed queue.
    ///
    /// Order matters: `install_scene_queue` sets `line_content_start` to
    /// `items.len()` (the "nothing here is challengeable" default), so the
    /// override must come after the install or it is silently discarded and the
    /// inline 反駁 control never appears. The variant guard is retained rather
    /// than assumed, because installation can drain to empty and reach
    /// `on_queue_exhausted`, which may transition the scene.
    fn install_or_exhaust_line_content(
        &mut self,
        items: Vec<DialogueItem>,
        line_content_start: usize,
    ) -> Result<(), GameError> {
        if items.is_empty() {
            return self.on_queue_exhausted();
        }
        let queue_gen = self.alloc_queue_gen();
        self.install_scene_queue(items, queue_gen)?;
        if let SceneRuntime::Interrogation(scene) = &mut self.scene {
            scene.line_content_start = line_content_start;
        }
        Ok(())
    }
```

- [ ] **Step 4: Convert the five verbatim sites**

In `try_enter_current_interrogation_phase`, `inspect_hotspot`, `interview_topic`, `challenge_interrogation_line`, and `present_interrogation_evidence`, replace

```rust
            if queue_items.is_empty() {
                engine.on_queue_exhausted()?;
            } else {
                let queue_gen = engine.alloc_queue_gen();
                engine.install_scene_queue(queue_items, queue_gen)?;
            }
```

with

```rust
            engine.install_or_exhaust(queue_items)?;
```

(`try_enter_current_interrogation_phase` uses `self.` rather than `engine.`, being outside a closure.)

- [ ] **Step 5: Convert the three line-content sites**

In `ask_interrogation_question` and `resume_interrogation_testimony`, and the `else` arm of `advance_playing_testimony`, replace the branch plus its trailing `line_content_start` assignment with a single call:

```rust
            engine.install_or_exhaust_line_content(queue_items, line_content_start)?;
```

`resume_interrogation_testimony` passes `0`. Leave `advance_playing_testimony`'s **empty** branch exactly as it is — see the test in Step 1.

- [ ] **Step 6: Convert the two scene-tag sites**

In `enter_sublocation` and `advance_into_first_sublocation`, hoist the tag above the branch. Both branches currently set it, so this is behaviour-identical and removes two `.clone()` calls that existed only to satisfy the duplicated borrow:

```rust
            engine.last_visual_cue.set_scene_tag(scene_tag, asset_cue);
            engine.install_or_exhaust(queue_items)?;
```

- [ ] **Step 7: Delete the alias**

Remove `install_investigation_queue` — a bare forward to `install_scene_queue` with no added behaviour. Any remaining call sites become `install_scene_queue` or, where they match the pattern, `install_or_exhaust`.

- [ ] **Step 8: Full suite, lint, commit**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml && bun run rust:fmt && bun run rust:lint`

Expected: all pass, including `draining_unbroken_testimony_loops_in_dialogue`, `loop_plays_detective_prompt_after_on_loop`, `loop_bridge_hides_cross_exam_line_id_until_line_content`, and `challenge_lead_in_hides_cross_exam_line_id` — the tests most sensitive to `line_content_start` ordering.

```bash
git add apps/game/src-tauri/src/game/mod.rs
git commit -m "refactor(engine): add install_or_exhaust helpers and drop the queue alias (HPA-55)"
```

---

## Task 6: Relocate dialogue lifecycle and navigation

**Files:**

- Create: `apps/game/src-tauri/src/game/navigation.rs`
- Modify: `apps/game/src-tauri/src/game/dialogue.rs`, `apps/game/src-tauri/src/game/mod.rs`

**Interfaces:**

- Consumes: everything from Tasks 1–5.
- Produces: `navigation.rs` exposing `pub(super) fn load_chapter_manifests`, `pub(super) fn scene_navigation_index_from_chapters`, `pub(super) fn load_scene_runtime`, plus `pub(super)` methods `prime_initial_queue`, `advance_scene`, `grant_all_evidence_for_testing`. `dialogue.rs` exposing the queue lifecycle as `pub(super)` methods.

This is a **pure move**. No logic changes. If a diff hunk shows anything other than relocation and visibility, revert it.

- [ ] **Step 1: Move the dialogue lifecycle**

Move these from `impl GameEngine` in `mod.rs` into an `impl GameEngine` block in `dialogue.rs`, marking each `pub(super)`: `install_scene_queue`, `install_or_exhaust`, `install_or_exhaust_line_content`, `consume_scene_tags_at_cursor`, `peek_just_consumed`, `current_queue_token`, `current_dialogue_item`, `current_scene_title`, `alloc_queue_gen`, `on_queue_exhausted`, `interrogation_playing_unbroken`, `finish_broken_playing`, `advance_playing_testimony`, `record_current_dialogue_history`.

Add a doc comment on `install_scene_queue`:

```rust
    /// Scene-entry sequencing lives in `navigation.rs` (`prime_initial_queue`),
    /// which calls into these primitives.
```

Add the imports `dialogue.rs` now needs — `use super::scenes::investigation::DialogueQueue;`, `use super::scenes::SceneRuntime;`, `use super::{GameEngine, GameError};` — and let the compiler drive the rest.

- [ ] **Step 2: Build**

Run: `cargo build --manifest-path apps/game/src-tauri/Cargo.toml`

Expected: compiles. Errors of the form `method is private` mean a `pub(super)` was missed.

- [ ] **Step 3: Create `navigation.rs` and move the free functions**

Move all ten free functions from `mod.rs` into `navigation.rs`, with exactly this visibility — three are called from `new_started` / `scene_navigation_index`, which stay in the parent, and Rust privacy does not flow child-to-parent:

| Function | Visibility |
| --- | --- |
| `load_chapter_manifests` | `pub(super)` |
| `scene_navigation_index_from_chapters` | `pub(super)` |
| `load_scene_runtime` | `pub(super)` |
| `find_scene_runtime_by_id` | private |
| `load_scene_json_for_ref` | private |
| `scene_runtime_from_json` | private |
| `validate_manifest_scene_type` | private |
| `scene_json_identity` | private |
| `scene_json_type` | private |
| `scene_type_label` | private |

Move `prime_initial_queue`, `advance_scene`, and `grant_all_evidence_for_testing` into an `impl GameEngine` block here as `pub(super)`, and move `jump_to_scene`'s body into `pub(super) fn jump_to_scene_inner(&mut self, chapter_id: &str, scene_id: &str) -> Result<GameStateView, GameError>`, leaving the public `jump_to_scene` in `mod.rs` as a one-line delegation.

> **As-built note (scanner follow-delegation):** the `every_view_returning_command_routes_through_command_tx` scanner enforces invariant A by literal `command_tx(` substring matching with no exemptions, so a one-line `self.jump_to_scene_inner(...)` delegation in `mod.rs` would have been flagged as `missing_tx` (the `pub(super)` inner is not a tracked `pub fn`). To make this delegation shape viable, `scan_sources` was extended to follow `self.<target>(` delegations transitively (cycle-safe, excluding `command_tx` itself) and excuse a tracked command when the chain reaches a fn containing `command_tx(`. A command that calls `command_tx` directly is still checked on its own body only, so the delegation path does not weaken the direct-call check. The `scanner_follows_one_line_delegation_to_inner` self-test locks this in.

Add to `prime_initial_queue`:

```rust
    /// Scene-entry sequencing. Installs the new scene's opening queue via the
    /// primitives in `dialogue.rs`; it lives here because its three callers
    /// (`new_started`, `jump_to_scene`, `advance_scene`) are all navigation
    /// paths.
```

Declare both modules in `mod.rs`, keeping alphabetical order with the existing declarations:

```rust
pub mod command_tx;
pub mod dialogue;
pub mod error;
pub mod loader;
pub mod navigation;
pub mod reveals;
pub mod scenes;
pub mod schema;
pub mod state;
pub mod unlock;
pub mod view;
```

- [ ] **Step 4: Build and run the full suite**

Run: `cargo build --manifest-path apps/game/src-tauri/Cargo.toml && cargo test --manifest-path apps/game/src-tauri/Cargo.toml`

Expected: PASS, same test count as after Task 5.

- [ ] **Step 5: Re-arm the source scanner**

In the `every_view_returning_command_routes_through_command_tx` test, add the entry deferred in Task 4:

```rust
            ("navigation.rs", include_str!("navigation.rs")),
```

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml every_view_returning_command`

Expected: PASS.

- [ ] **Step 6: Lint and commit**

Run: `bun run rust:fmt && bun run rust:lint`

```bash
git add apps/game/src-tauri/src/game/
git commit -m "refactor(engine): relocate dialogue lifecycle and navigation into focused modules (HPA-55)"
```

---

## Task 7: Acquisition entry point

**Files:**

- Create: `apps/game/src-tauri/src/game/acquisition.rs`
- Modify: `apps/game/src-tauri/src/game/reveals.rs`, `apps/game/src-tauri/src/game/state.rs`, `apps/game/src-tauri/src/game/navigation.rs`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `pub(super) struct AcquisitionCtx<'a> { pub(super) inventory: &'a mut Inventory }` with `pub(super) fn evidence(&mut self, def: &EvidenceJson, chapter_id: &str, scene_id: &str) -> bool` and `pub(super) fn statement(&mut self, def: &StatementJson, chapter_id: &str, scene_id: &str) -> bool`. `reveals::apply_reveals_and_build_queue` and `apply_interrogation_reveals_and_build_queue` take `&mut AcquisitionCtx` in place of `&mut Inventory`.

- [ ] **Step 1: Write the failing test**

Create `apps/game/src-tauri/src/game/acquisition.rs` with its test module:

```rust
// src-tauri/src/game/acquisition.rs

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::schema::EvidenceJson;
    use crate::game::state::Inventory;

    fn evidence_def(id: &str) -> EvidenceJson {
        EvidenceJson {
            id: id.into(),
            name: id.into(),
            description: id.into(),
            details: id.into(),
            image_asset_id: None,
            on_collect: vec![],
            on_reexamine: None,
        }
    }

    #[test]
    fn evidence_reports_newly_added_then_dedupes() {
        let mut inventory = Inventory::default();
        let mut ctx = AcquisitionCtx {
            inventory: &mut inventory,
        };
        assert!(ctx.evidence(&evidence_def("coffee"), "chapter_1", "scene_1"));
        assert!(!ctx.evidence(&evidence_def("coffee"), "chapter_1", "scene_1"));
        assert_eq!(inventory.evidence.len(), 1);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml --lib acquisition::`

Expected: FAIL to compile — `cannot find struct 'AcquisitionCtx'`.

- [ ] **Step 3: Implement**

Add above the test module:

```rust
use super::schema::{EvidenceJson, StatementJson};
use super::state::Inventory;

/// The engine's named entry point for adding records to the inventory.
///
/// This is an entry point, not an enforced funnel. `Inventory` exposes its
/// `evidence` and `statements` vectors publicly, so any holder of
/// `&mut Inventory` can still push directly; making that impossible means
/// encapsulating those fields behind accessors, which is out of scope for
/// HPA-55. What this type provides is one well-named place that all three
/// current acquisition call sites route through, and a home for HPA-129's
/// `AcquisitionLog` and `command_id`.
///
/// It is a borrowed context rather than a `&mut self` engine method because
/// `reveals::*` already holds `&mut scene` and `&mut inventory` as disjoint
/// borrows of the engine; a `&mut self` call from inside would not compile.
pub(super) struct AcquisitionCtx<'a> {
    pub(super) inventory: &'a mut Inventory,
    // HPA-129 adds: events: &'a mut AcquisitionLog, command_id: &'a str
}

impl AcquisitionCtx<'_> {
    /// Returns true when the record was newly acquired.
    pub(super) fn evidence(
        &mut self,
        def: &EvidenceJson,
        chapter_id: &str,
        scene_id: &str,
    ) -> bool {
        self.inventory
            .add_evidence_from_def(def, chapter_id, scene_id)
    }

    /// Returns true when the record was newly acquired.
    pub(super) fn statement(
        &mut self,
        def: &StatementJson,
        chapter_id: &str,
        scene_id: &str,
    ) -> bool {
        self.inventory
            .add_statement_from_def(def, chapter_id, scene_id)
    }
}
```

Declare in `mod.rs`: `pub mod acquisition;` (alphabetically first).

- [ ] **Step 4: Run the unit test**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml --lib acquisition::`

Expected: PASS, 1 test.

- [ ] **Step 5: Route `reveals.rs` through it**

Change both function signatures from `inventory: &mut Inventory` to `acq: &mut AcquisitionCtx`, and each `inventory.add_evidence_from_def(def, chapter_id, &scene.def.id)` to `acq.evidence(def, chapter_id, &scene.def.id)` (likewise `add_statement_from_def` → `acq.statement`). Add `use crate::game::acquisition::AcquisitionCtx;` and drop the now-unused `Inventory` import.

Update the four call sites in `mod.rs` and `navigation.rs`, which currently pass `&mut self.inventory`:

```rust
                reveals::apply_reveals_and_build_queue(
                    inv,
                    &mut AcquisitionCtx {
                        inventory: &mut self.inventory,
                    },
                    body,
                    &hot_def.reveals,
                    &chapter_id,
                )
```

Update `reveals.rs`'s own six tests to construct an `AcquisitionCtx` around their local `Inventory`.

- [ ] **Step 6: Route the debug grant through it**

In `navigation.rs`'s `grant_all_evidence_for_testing`, replace the two direct `self.inventory.add_*_from_def` calls with an `AcquisitionCtx` built once per scene, closing the path that currently bypasses `reveals` entirely.

- [ ] **Step 7: Narrow the inventory methods**

In `state.rs`, change `pub fn add_evidence_from_def` and `pub fn add_statement_from_def` to `pub(in crate::game) fn`. `state.rs`'s own unit test continues to call them directly and needs no change.

- [ ] **Step 8: Full suite, lint, commit**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml && bun run rust:fmt && bun run rust:lint`

Expected: all pass, including `jump_to_interrogation_grants_all_evidence_for_testing`.

```bash
git add apps/game/src-tauri/src/game/
git commit -m "refactor(engine): route acquisitions through AcquisitionCtx (HPA-55)"
```

---

## Task 8: Test relocation and final gate

**Files:**

- Create: `apps/game/src-tauri/src/game/test_support.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`, `dialogue.rs`, `navigation.rs`, `command_tx.rs`

**Interfaces:**

- Consumes: all prior tasks.
- Produces: `#[cfg(test)] mod test_support` with `pub(super)` fixtures reachable from every `game` descendant.

- [ ] **Step 1: Create the fixture module**

Create `apps/game/src-tauri/src/game/test_support.rs` and move these from `mod.rs`'s test module, marking each `pub(super)` — a private item here is not visible to sibling test modules:

`investigation_scene_with_intro`, `empty_engine_with_scene`, `empty_engine_with_interrogation_scene`, `completed_interrogation_engine_with_bad_next_scene`, `token_from`, `history_labels`, `dialogue_history_fixture_resources`, `scene_jump_fixture_resources`, `subject`, `empty_testimony`, `two_line_question_scene`, `empty_inquiry_interrogation_scene`, `locked_unsatisfied_interrogation_scene`, `locked_inventory_unlocked_interrogation_scene`, `source_order_inventory_unlocked_interrogation_scene`, `single_required_question_scene`, `single_honest_question_scene`, and `break_q1`.

Declare in `mod.rs`, **immediately before the existing `#[cfg(test)] mod tests` block, after all production declarations and code** — not beside the other `pub mod` declarations at the top of the file. The source scanner (see design §Testing, "Where a `#[cfg(test)]` module is *declared* changes what the source scanner can see") stops reading a file at its first `#[cfg(test)]` or `mod tests {` line, so a top-of-file `mod test_support;` would truncate the scan immediately and hide every command below it. Placing it just before `mod tests` keeps the production-code traversal intact and keeps both `#[cfg(test)]` items adjacent at the end of the file:

```rust
#[cfg(test)]
mod test_support;

#[cfg(test)]
mod tests {
    // …
}
```

`pub(super)` here means "visible in `game`", which includes every descendant — so `game::dialogue::tests` reaches them as `crate::game::test_support::*`.

- [ ] **Step 2: Build the test target**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml --no-run`

Expected: compiles. Unresolved-name errors are fixtures that still need `pub(super)`.

- [ ] **Step 3: Re-home the tests**

Move each test **body unmodified** — the assertions are this refactor's behaviour-preservation evidence. Adjust only `use` statements and fixture paths.

To `navigation.rs`: the six `jump_to_scene_*` tests (including both `_restores_*` cases, which are jump-specific), `jump_to_interrogation_grants_all_evidence_for_testing`, the four `scene_navigation_index_*`, the two `scene_lookup_*`, and the two `load_scene_runtime_*`.

To `dialogue.rs`: the four `dialogue_history_*`, `stale_intro_token_does_not_advance_later_scene_with_same_id`, both `prime_initial_queue_consumes_leading_scene_tags_*`, `advance_dialogue_skips_mid_scene_tags_in_linear_scene`, `inspect_hotspot_consumes_leading_scene_tags_in_investigation_queue`, and `tag_only_linear_scene_advances_to_game_complete`.

To `command_tx.rs`: `reexamine_evidence_rolls_back_tag_only_queue_when_scene_advance_fails`, `reexamine_statement_rolls_back_tag_only_queue_when_scene_advance_fails`, `failed_scene_advance_keeps_previous_dialogue_view`, `failed_initial_silent_investigation_transition_rolls_back_inventory`, `failed_investigation_intro_completion_rolls_back_inventory`, `failed_silent_investigation_completion_rolls_back_action_state`, and the two `command_tx_rolls_back_*` tests from Task 2.

Everything else — command behaviour, interrogation flow, cross-examination, visual/audio cue, view shape, and the source scanner — stays in `mod.rs`.

Each receiving module's test block opens with:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::test_support::*;
    use crate::game::*;
```

adding schema imports as the compiler demands.

- [ ] **Step 4: Confirm no tests were lost**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml 2>&1 | grep -E "^test result:"`

Expected: the summed `passed` count across binaries equals the count from Task 7 Step 8. A drop means a test was dropped rather than moved — find it before continuing.

- [ ] **Step 5: Run the full verification gate**

```bash
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --check
bun run rust:lint
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
```

Expected: all three pass. `tests/full_playthrough.rs` must pass **untouched** — it exercises only the public surface, and is the primary regression gate for this refactor.

- [ ] **Step 6: Manual smoke test**

Run: `bun run dev:game`

Play a Chapter 1 slice: advance through the opening linear dialogue, enter an investigation scene, inspect a hotspot, interview a topic, open the dialogue log (LOG button), then use Scene Select to jump to an interrogation and ask one question. Rollback and scene transition depend on real resource loading that unit fixtures only approximate.

Confirm: dialogue history accumulates, scene tags do not appear in the log, the inline 反駁 control appears only on testimony line content, and Scene Select lands correctly.

- [ ] **Step 7: Commit**

```bash
git add apps/game/src-tauri/src/game/
git commit -m "test(engine): re-home tests per concern with shared fixtures (HPA-55)"
```

---

## Self-Review Notes

Spec coverage check against `2026-07-21-gameengine-seam-extraction-design.md`:

| Spec requirement | Task |
| --- | --- |
| `EngineRollbackSnapshot` rename + exhaustive capture | 1 |
| Symmetric exhaustive restore | 1 |
| `rollback_scope` / `command_tx` two layers | 1 |
| All view-returning commands converted | 2 |
| `jump_to_scene` mutation-inside-transaction hazard | 2 (Steps 5–6) |
| `advance_dialogue` stale-token return outside tx | 2 (Step 4) |
| `DialogueHistory` owned unit + `Default` | 3 |
| Nine struct literals, two field reads | 3 (Step 7) |
| Token-based behavioural history test | 4 |
| Rewritten multi-file source-contract test | 4, re-armed in 6 |
| `install_or_exhaust` (+ line-content variant, install-then-assign) | 5 |
| Degenerate-testimony regression test | 5 (Step 1) |
| Scene-tag hoist, alias deletion | 5 (Steps 6–7) |
| Navigation visibility table | 6 (Step 3) |
| `prime_initial_queue` cross-references | 6 (Steps 1, 3) |
| `AcquisitionCtx` + three call sites | 7 |
| `pub(in crate::game)` narrowing | 7 (Step 7) |
| Fixture `pub(super)` visibility | 8 (Step 1) |
| Test re-homing table | 8 (Step 3) |
| Verification gate + smoke test | 8 (Steps 5–6) |

Not implemented by design, per spec Out of Scope: `LinearSceneState` queue unification, view-builder extraction, command-body rewrites, any save type or I/O.
