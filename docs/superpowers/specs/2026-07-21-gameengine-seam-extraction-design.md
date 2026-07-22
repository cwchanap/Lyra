# GameEngine Seam Extraction Design

**Date:** 2026-07-21
**Status:** Approved design; implementation plan to follow
**Linear:** [HPA-55](https://linear.app/cwchanap/issue/HPA-55/extract-gameengine-transaction-dialogue-and-navigation-seams)
**Milestone:** P0.0 — Engine Seam Extraction
**Related specs:**

- `docs/superpowers/specs/2026-07-19-detective-gameplay-systems-design.md` (canonical design, §§6.2, 7.4, 16.2)
- `docs/superpowers/plans/2026-07-19-detective-gameplay-systems-implementation-plan.md` (§5, Epic P0.0)

## Goal

Extract the command-transaction, dialogue-lifecycle, and navigation seams out of
`apps/game/src-tauri/src/game/mod.rs` so that the P0 persistence work
(HPA-255, HPA-256, HPA-129) and the P1 analysis runtime (HPA-260) attach to
stable, testable delegation points instead of growing a monolith.

Runtime behaviour does not change. The public `GameEngine` surface does not
change.

## Problem

### Measured baseline

`game/mod.rs` is 7,357 lines. That figure is two distinct problems:

| Region | Lines | Content |
|---|---|---|
| 1–2221 | 2,221 | `GameEngine` struct + `impl GameEngine` |
| 2223–2431 | 209 | stateless free functions, `SceneAndInventoryCtx` |
| 2432–7357 | 4,926 | `#[cfg(test)] mod tests` |

The production surface is ~2,430 lines. The canonical design's §6.2 baseline
("roughly 7,350 lines / 288 KB") counts the test module, so a plan that targets
the headline number would be measuring the wrong thing.

### Seam problems, concretely

1. **The transaction is a convention, repeated.** `self.snapshot()` appears 14
   times and `restore_on_error` 13 times. Eleven of the twelve public commands
   follow an identical shape:

   ```rust
   let snapshot = self.snapshot();
   let result = (|| -> Result<GameStateView, GameError> {
       /* ... */
       Ok(self.view_with_history())
   })();
   self.restore_on_error(snapshot, result)
   ```

   `advance_dialogue` and `advance_scene` hand-roll the same thing with an
   inline `if let Err(err) = result { self.restore_snapshot(snapshot); … }`.

2. **Rollback completeness is unenforced.** `snapshot()` and
   `restore_snapshot()` hand-enumerate nine fields. Adding a tenth field to
   `GameEngine` and forgetting it in `snapshot()` compiles cleanly and silently
   breaks atomic rollback. HPA-255 and HPA-129 both add engine fields.

3. **Dialogue history is enforced by a source-text scanner.** The criterion
   "every view-returning command records history" is currently guarded by
   `every_view_returning_command_routes_through_view_with_history`, a test that
   does `include_str!("mod.rs")` and walks the source line by line looking for
   `pub fn`, `view_with_history()`, and `Ok(self.view())`. It maintains an
   allow-list (`["advance_dialogue"]`) and stops scanning at the
   `#[cfg(test)]` boundary. This test breaks the moment any command moves to
   another file, and it cannot see commands defined outside `mod.rs` at all.

4. **Acquisitions have three entry points.** Evidence and statements enter the
   inventory through `Inventory::add_evidence_from_def` /
   `add_statement_from_def`, called from `reveals::apply_reveals_and_build_queue`,
   `reveals::apply_interrogation_reveals_and_build_queue`, and
   `GameEngine::grant_all_evidence_for_testing` — the last bypassing `reveals`
   entirely. §16.2's durable `AcquisitionEventState` needs one place to observe.

5. **Queue plumbing is triplicated and duplicated.** `current_queue_token`,
   `current_dialogue_item`, `peek_just_consumed`, `consume_scene_tags_at_cursor`,
   `install_scene_queue`, and `mode_view` each `match` over all three
   `SceneRuntime` variants to reach a cursor, because `LinearSceneState` stores
   `queue` / `cursor` / `queue_gen` inline while the other two hold an
   `Option<DialogueQueue>`. Separately, the block

   ```rust
   if queue_items.is_empty() {
       self.on_queue_exhausted()?;
   } else {
       let queue_gen = self.alloc_queue_gen();
       self.install_scene_queue(queue_items, queue_gen)?;
   }
   ```

   appears ten times: five verbatim, three followed by a
   `scene.line_content_start = …` assignment, and two preceded by a
   `set_scene_tag` call applied to both branches.

## Approved Approach

Split by concern into four new sibling modules under `game/`, keeping
`GameEngine` the single owner of mutable state. Extract state into an owned
sub-struct only where fields genuinely cluster (`DialogueHistory`); leave
inherently cross-cutting logic as `pub(super)` `impl GameEngine` seams.

Rejected alternatives:

- **Pure file split with no owned state.** Cheapest, but the seams stay
  conventional — nothing would prevent HPA-129 from reintroducing per-command
  rollback and history calls.
- **Full decomposition into `Navigator` / `DialogueRuntime` / `Inventory`
  sub-systems.** Best long-term boundary, but queue installation mutates
  `scene`, `inventory`, and `last_visual_cue` together, so every command would
  need three simultaneous disjoint `&mut` field borrows across sub-system
  boundaries. That is a rewrite, and §5's non-goals forbid one.

## Scope

### In Scope

- `EngineRollbackSnapshot` (renamed from `GameSnapshot`) with compiler-enforced
  field completeness.
- A two-layer transaction seam: `rollback_scope` and `command_tx`.
- `DialogueHistory` as an owned unit; deletion of the `view_with_history()`
  convention and its source-scanning test.
- Dialogue queue lifecycle extraction, including an `install_or_exhaust` helper.
- Navigation extraction: scene loading, chapter/scene transition, debug jump.
- `AcquisitionCtx` as the single acquisition funnel.
- Test relocation per concern, with shared fixtures in `test_support`.

### Out of Scope

- Any save schema, save file, autosave, `AcquisitionEventState`, story catalog,
  provenance, analysis scene, or other P0/P1 feature behaviour.
- Rewriting the twelve public command bodies. Their guard clauses,
  read/compute/write phasing, and error ordering stay as they are.
- Unifying `LinearSceneState`'s inline queue with `DialogueQueue`. This would
  remove most triplicated matches, but it changes scene-state shape and belongs
  with HPA-129's ordered-dialogue-segment work.
- Extracting `mode_view` / `chapter_view` / `scene_view`. View construction is
  not a seam this program needs; it is the obvious next extraction and stays in
  `mod.rs`.
- Any line-count target as an acceptance criterion.

## Module Layout

```text
apps/game/src-tauri/src/game/
  mod.rs            ~1,250 prod   engine struct, LastVisualCue, new_started,
                                  12 public commands, view builders,
                                  SceneAndInventoryCtx
  command_tx.rs       ~110 prod   EngineRollbackSnapshot, rollback_scope, command_tx
  dialogue.rs         ~470 prod   DialogueHistory, queue lifecycle
  navigation.rs       ~480 prod   scene loading, transitions, jump, nav index
  acquisition.rs       ~70 prod   AcquisitionCtx
  test_support.rs               shared #[cfg(test)] fixtures
```

`dialogue.rs`, `navigation.rs`, and `command_tx.rs` host `impl GameEngine`
blocks with `pub(super)` methods. This is legal — inherent impls need only be in
the same crate — and private-field access holds, because Rust privacy is
module-scoped and these are descendants of `game`.

The `mod.rs` figure is an estimate, not a target. The commands (~875 lines) and
view builders (~270 lines) stay by design.

## Design

### 1. Command transactions (`command_tx.rs`)

Two layers, because `advance_scene` needs rollback but returns `()` and runs
inside other commands' transactions:

```rust
/// Snapshot → run → restore on error. No view, no history.
pub(super) fn rollback_scope<T>(
    &mut self,
    f: impl FnOnce(&mut Self) -> Result<T, GameError>,
) -> Result<T, GameError>;

/// The command seam. Adds guaranteed dialogue-history finalization and
/// view construction to `rollback_scope`.
pub(super) fn command_tx(
    &mut self,
    f: impl FnOnce(&mut Self) -> Result<(), GameError>,
) -> Result<GameStateView, GameError>;
```

`command_tx`'s closure returns `()`, so a command cannot construct its own
`GameStateView`. History finalization becomes structurally unskippable rather
than conventional, which is what acceptance criterion "dialogue history is
finalized through one shared path" asks for.

Nesting is safe and behaviour-preserving: an inner `rollback_scope` restore
followed by an outer restore lands on the outer snapshot. This already happens
today — `advance_scene` snapshots inside `inspect_hotspot`'s transaction.

**Snapshot completeness** is enforced by exhaustive destructuring:

```rust
impl EngineRollbackSnapshot {
    fn capture(engine: &GameEngine) -> Self {
        // Exhaustive destructuring: a field added to GameEngine fails to
        // compile here until it is classified as rollback-tracked or as
        // immutable-after-load. Save capture (HPA-129) reads the same
        // enumeration.
        let GameEngine {
            resources_dir: _,   // immutable after load
            chapters: _,        // immutable after load
            current_chapter_idx,
            current_scene_idx,
            scene,
            last_visual_cue,
            inventory,
            next_queue_gen,
            history,
        } = engine;
        /* ... */
    }
}
```

`EngineRollbackSnapshot` carries a doc comment distinguishing it from §16's
persistent `SaveSnapshot`, per canonical design §7.4.

**Call-site shape.** Guards stay outside the transaction, exactly where they are
today (they run before any mutation, so they need no rollback):

```rust
pub fn inspect_hotspot(&mut self, hotspot_id: &str) -> Result<GameStateView, GameError> {
    if self.current_chapter_idx >= self.chapters.len() {
        return Err(GameError::game_complete());
    }
    let chapter_id = self.chapters[self.current_chapter_idx].id.clone();
    let (hot_def, first_time) = { /* unchanged read/guard phase */ };

    self.command_tx(move |engine| {
        let queue_items = /* unchanged compute phase */;
        engine.install_or_exhaust(queue_items)
    })
}
```

The closure captures only owned locals, never `self`, so `&mut self` is free for
`command_tx` to pass in as `engine`.

`advance_dialogue`'s stale-token early return (`Ok(self.view())` with no history
record) happens before the transaction opens, so it needs no allow-list entry —
it is simply not a transaction.

### 2. Dialogue lifecycle (`dialogue.rs`)

**Owned unit.** `GameEngine`'s three history fields collapse into one field:

```rust
pub(super) struct DialogueHistory {
    entries: Vec<DialogueHistoryEntry>,
    next_id: u64,
    last_token: Option<QueueToken>,
}

impl DialogueHistory {
    pub(super) fn record(
        &mut self,
        token: QueueToken,
        item: DialogueItem,
        chapter_title: String,
        scene_title: String,
    );
    pub(super) fn entries(&self) -> &[DialogueHistoryEntry];
    pub(super) fn reset(&mut self);
}
```

`record` owns dedup-by-token, the `DIALOGUE_HISTORY_LIMIT` (50) cap with
front-drain overflow, and the rule that a `SceneTag` item records nothing. It is
unit-testable without constructing a `GameEngine`.

The engine keeps what only it knows: resolving the current token and item, and
the `.expect("current_chapter_idx must reference a loaded chapter when recording
dialogue history")` invariant, which stays engine-side verbatim.

`jump_to_scene`'s history reset becomes `self.history.reset()`.

**Queue lifecycle** moves as `pub(super)` methods, bodies unchanged:
`install_scene_queue`, `consume_scene_tags_at_cursor`, `peek_just_consumed`,
`current_queue_token`, `current_dialogue_item`, `current_scene_title`,
`alloc_queue_gen`, `on_queue_exhausted`, `interrogation_playing_unbroken`,
`finish_broken_playing`, `advance_playing_testimony`, and the cursor-advance
body of `advance_dialogue`.

**Two cleanups**, justified by touching this code anyway:

- Delete `install_investigation_queue`. It is a bare alias that forwards to
  `install_scene_queue` with no added behaviour.
- Add the missing helper for the ten-site duplication:

  ```rust
  /// Install `items` as the active queue, or run the exhausted-queue
  /// machinery when there is nothing to play.
  pub(super) fn install_or_exhaust(&mut self, items: Vec<DialogueItem>) -> Result<(), GameError>;

  /// As `install_or_exhaust`, then mark where challengeable testimony line
  /// content begins in the installed queue.
  pub(super) fn install_or_exhaust_line_content(
      &mut self,
      items: Vec<DialogueItem>,
      line_content_start: usize,
  ) -> Result<(), GameError>;
  ```

  Five sites use the first verbatim. Three testimony sites
  (`ask_interrogation_question`, `resume_interrogation_testimony`,
  `advance_playing_testimony`'s non-degenerate branch) use the second. The two
  scene-tag sites (`enter_sublocation`, `advance_into_first_sublocation`) hoist
  their `set_scene_tag` call above the branch and then call
  `install_or_exhaust`; because the tag is currently set in both branches this
  is behaviour-identical, and it removes two `.clone()` calls that exist only to
  satisfy the duplicated borrow. `advance_playing_testimony`'s degenerate
  empty-testimony branch (withdraw, then `try_advance_interrogation`) stays
  bespoke.

**Deliberately not done.** `LinearSceneState` keeps its inline `queue` / `cursor`
/ `queue_gen`. Unifying it with `DialogueQueue` would collapse most triplicated
matches, but it changes persisted scene-state shape — that is HPA-129's call to
make alongside `ActiveDialogueState`.

### 3. Navigation (`navigation.rs`)

Moving verbatim (already stateless free functions):
`load_chapter_manifests`, `scene_navigation_index_from_chapters`,
`find_scene_runtime_by_id`, `load_scene_runtime`, `load_scene_json_for_ref`,
`scene_runtime_from_json`, `validate_manifest_scene_type`, `scene_json_identity`,
`scene_json_type`, `scene_type_label`.

Moving as `pub(super)` methods: `prime_initial_queue`, `advance_scene`
(keeping its own `rollback_scope`), `grant_all_evidence_for_testing`, and
`jump_to_scene`'s resolution/reset body.

`jump_to_scene` and `scene_navigation_index` stay `pub` on `mod.rs` as
delegations, preserving the public surface. The `cfg!(debug_assertions)` gate on
`grant_all_evidence_for_testing` and its rationale comment — Scene Select is also
reachable in production replay after `storyClearedOnce`, where a full inventory
grant would spoil evidence gating — travel with the code unchanged.

The duplicate-id defences stay: `scene_navigation_index_from_chapters` rejects
duplicate chapter ids and duplicate scene ids within a chapter;
`find_scene_runtime_by_id` scans the whole chapter and errors on ambiguity.

### 4. Acquisition funnel (`acquisition.rs`)

`reveals::apply_reveals_and_build_queue(&mut scene, &mut self.inventory, …)`
depends on disjoint field borrows of `self`, so the funnel **cannot** be a
`&mut self` engine method — calling one while `self.scene` is mutably borrowed
would not compile. It is a borrowed context struct instead:

```rust
pub(super) struct AcquisitionCtx<'a> {
    pub(super) inventory: &'a mut Inventory,
    // HPA-129 adds: events: &'a mut AcquisitionLog, command_id: &'a str
}

impl AcquisitionCtx<'_> {
    pub(super) fn evidence(&mut self, def: &EvidenceJson, chapter_id: &str, scene_id: &str) -> bool;
    pub(super) fn statement(&mut self, def: &StatementJson, chapter_id: &str, scene_id: &str) -> bool;
}
```

Both `reveals` functions take `&mut AcquisitionCtx` in place of
`&mut Inventory`; `grant_all_evidence_for_testing` routes through it too,
closing the path that currently bypasses `reveals`. `Inventory::add_evidence_from_def`
and `add_statement_from_def` drop to `pub(crate)` so the funnel is their only
caller. Return values (`true` when newly added) and the
`on_collect` / `on_acquire` queue-append behaviour are unchanged.

This is a fourth module beyond the issue's three named files. The issue states
new modules "may include" those three and that "the focused spec may refine
names," so a fourth focused module is in bounds; the alternative — putting
acquisition inside `command_tx.rs`, since the future `command_id` is a
transaction property — was rejected as a less obvious home.

## Testing

### Relocation

Test **bodies move unmodified** — only `use` statements and fixture paths adjust
to the new module. The existing assertions are the behaviour-preservation
evidence for this refactor; rewriting them would forfeit the proof.

| Destination | Tests |
|---|---|
| `navigation.rs` | `jump_to_scene_*` (6, including the two `_restores_*` rollback cases, which are jump-specific), `jump_to_interrogation_grants_all_evidence_for_testing`, `scene_navigation_index_*` (4), `scene_lookup_*` (2), `load_scene_runtime_*` (2) |
| `dialogue.rs` | `dialogue_history_*` (4), `stale_intro_token_does_not_advance_later_scene_with_same_id`, `prime_initial_queue_consumes_leading_scene_tags_*` (2), `advance_dialogue_skips_mid_scene_tags_in_linear_scene`, `inspect_hotspot_consumes_leading_scene_tags_in_investigation_queue`, `tag_only_linear_scene_advances_to_game_complete` |
| `command_tx.rs` | `reexamine_{evidence,statement}_rolls_back_tag_only_queue_when_scene_advance_fails`, `failed_scene_advance_keeps_previous_dialogue_view`, `failed_initial_silent_investigation_transition_rolls_back_inventory`, `failed_investigation_intro_completion_rolls_back_inventory`, `failed_silent_investigation_completion_rolls_back_action_state` (6) |
| `mod.rs` | command behaviour, interrogation flow, cross-examination, visual/audio cue, and view-shape tests |
| `test_support.rs` | `empty_engine_with_scene`, `empty_engine_with_interrogation_scene`, `completed_interrogation_engine_with_bad_next_scene`, `investigation_scene_with_intro`, the six interrogation scene builders, `subject`, `empty_testimony`, `break_q1`, `token_from`, `history_labels`, `scene_jump_fixture_resources`, `dialogue_history_fixture_resources` |

`test_support` is `#[cfg(test)] mod test_support;` declared in `game/mod.rs`, so
sibling modules reach it as `super::test_support`.

### Deleted

`every_view_returning_command_routes_through_view_with_history` is deleted, not
ported. Its contract is now enforced by `command_tx`'s type signature. Porting
it would mean teaching a source-text scanner to walk four files while the
property it checks has become a compile-time guarantee.

### Added

- **Rollback, investigation delegate.** A command whose queue install fails
  leaves inventory, scene progress, `next_queue_gen`, and dialogue history at
  their pre-command values.
- **Rollback, interrogation delegate.** Same, for a cross-examination command.
- **History finalization, behavioural.** A command that advances the focused
  dialogue item appends exactly one history entry; a command that does not
  advance appends none. This replaces the deleted source scanner.
- **`DialogueHistory` unit tests.** Token dedup, 50-entry cap with front-drain
  overflow, `SceneTag` items recording nothing — asserted directly against the
  struct without a `GameEngine`.
- **`AcquisitionCtx` funnel test.** Both `evidence` and `statement` dedupe on
  second acquisition and report `false`.

### Unchanged

`apps/game/src-tauri/tests/full_playthrough.rs` is not touched. It exercises the
public surface only (`new_started`, `view`, `advance_dialogue`,
`inspect_hotspot`, `interview_topic`, `enter_sublocation`), which this design
holds byte-identical. It is the primary regression gate.

## Integration Points

`apps/game/src-tauri/src/lib.rs` calls fourteen `GameEngine` methods across its
`#[tauri::command]` handlers. Every one keeps its name, signature, and error
behaviour, so `lib.rs`, `generate_handler!`, the IPC wire contract, and the
entire Svelte frontend are untouched by this issue.

Deliberate downstream seams left for later epics:

| Epic | Attaches to |
|---|---|
| HPA-129 (saves) | `EngineRollbackSnapshot::capture`'s exhaustive field enumeration; `AcquisitionCtx`'s reserved `events` / `command_id` fields |
| HPA-255 (story state) | new `GameEngine` fields, which `capture` forces the author to classify |
| HPA-260 (analysis runtime) | `command_tx` for analysis command dispatch; `install_or_exhaust` for analysis result dialogue |

## Verification

Run in this order; the first three are the issue's stated gate.

1. `cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --check`
2. `bun run rust:lint` (clippy with warnings denied)
3. `cargo test --manifest-path apps/game/src-tauri/Cargo.toml` — unit tests plus
   `tests/full_playthrough.rs`
4. `bun run dev:game`, playing a Chapter 1 slice through an investigation scene
   and into an interrogation, plus one Scene Select jump. Rollback and scene
   transition depend on real resource loading, which unit fixtures only
   approximate.

Acceptance is ownership plus tests, per canonical design §6.2 — not a
line-count threshold.

## Non-Goals And Guardrails

- No new gameplay behaviour, no save format, no analysis scene.
- No change to generated resources, the compiler, `@lyra/scene-types`, or any
  frontend file.
- No public `GameEngine` API change.
- If a behaviour difference is discovered mid-implementation, the existing
  behaviour wins and the discovery is recorded — this issue is not the place to
  fix engine bugs found in passing.
