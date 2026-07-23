# GameEngine Seam Extraction Design

**Date:** 2026-07-21
**Status:** Approved design; implementation plan to follow
**Linear:** [HPA-55](https://linear.app/cwchanap/issue/HPA-55/extract-gameengine-transaction-dialogue-and-navigation-seams)
**Milestone:** P0.0 — Engine Seam Extraction
**Line citations:** pinned to `f4fcb70`, the `main` revision this design was
written against. They will rot as soon as implementation starts; the
implementation plan should reference symbol names, not line numbers.
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

1. **The transaction is a convention, repeated.** Sixteen methods on
   `GameEngine` are public; thirteen return `Result<GameStateView, GameError>`.
   Twelve of those thirteen (`jump_to_scene` plus the eleven gameplay commands)
   follow an identical shape:

   ```rust
   let snapshot = self.snapshot();
   let result = (|| -> Result<GameStateView, GameError> {
       /* ... */
       Ok(self.view_with_history())
   })();
   self.restore_on_error(snapshot, result)
   ```

   The thirteenth, `advance_dialogue`, hand-rolls the same thing with an inline
   `if let Err(err) = result { self.restore_snapshot(snapshot); … }` (mod.rs:445),
   as does the private `advance_scene` (mod.rs:1028). That accounts for all 14
   `self.snapshot()` call sites: 12 paired with `restore_on_error`, plus these
   two.

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

   appears at exactly ten sites, verified individually:

   | Shape | Count | Sites (mod.rs) |
   |---|---|---|
   | Verbatim | 5 | 886, 1115, 1211, 1598, 1734 |
   | Followed by `scene.line_content_start = …` | 3 | 656 (`else` arm), 1502, 1848 |
   | Preceded by `set_scene_tag` in both arms | 2 | 942, 1296 |

   Two nearby constructs are *not* instances and must not be folded in:
   mod.rs:273 is `if let Some((items, queue_gen)) = intro_queue`, a different
   shape; and mod.rs:559 is the `if exhausted { self.on_queue_exhausted()?; }`
   tail *inside* `install_scene_queue` itself — that is the callee the helper
   wraps, so absorbing it would nest the exhaustion check.

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
- Rewriting the thirteen public view-returning command bodies. Their guard clauses,
  read/compute/write phasing, and error ordering stay as they are.
- Unifying `LinearSceneState`'s inline queue with `DialogueQueue`. This would
  remove most triplicated matches, but it changes scene-state shape and belongs
  with HPA-129's ordered-dialogue-segment work.
- Extracting `mode_view` / `chapter_view` / `scene_view`. View construction is
  not a seam this program needs; it is the obvious next extraction and stays in
  `mod.rs`.
- Any line-count target as an acceptance criterion.

## Module Layout

Sizes below are orientation estimates, not targets or acceptance criteria:

```text
apps/game/src-tauri/src/game/
  mod.rs            ~1,250 prod   engine struct, LastVisualCue, new_started,
                                  13 view-returning commands, view builders,
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

`command_tx`'s closure returns `()`, so a command **that uses `command_tx`**
cannot skip history finalization — there is no path through it that yields a
`GameStateView` without recording first.

**Be precise about the limit of this guarantee.** It is not absolute.
`GameEngine::view` is `pub` and must stay so: `lib.rs` calls it directly in
`start_game` and `get_state`. A future command can therefore still write
`Ok(self.view())` and never call `command_tx` at all. What the seam removes is
the *per-command convention* — inside the transaction, history is automatic —
not the possibility of bypassing the transaction entirely.

This matters because it is the sole justification for deleting the source
scanner, so the residual gap must be covered deliberately rather than assumed
away. See "Enforcement after the scanner" under Testing.

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

**Restore must be symmetric.** Exhaustive destructuring on `capture` alone is
half a guarantee: it forces a new `GameEngine` field to be classified, but
nothing stops a captured field from being dropped on the way back. `restore`
therefore destructures the snapshot by value, exhaustively and without `..`:

```rust
fn restore(engine: &mut GameEngine, snapshot: EngineRollbackSnapshot) {
    // Exhaustive, no `..`: a field added to the snapshot must be named here,
    // and an unused binding is an error under clippy's -D warnings, so it
    // cannot be named and then silently ignored.
    let EngineRollbackSnapshot {
        current_chapter_idx,
        current_scene_idx,
        scene,
        last_visual_cue,
        inventory,
        next_queue_gen,
        history,
    } = snapshot;
    engine.current_chapter_idx = current_chapter_idx;
    /* … one assignment per binding … */
}
```

Both halves together give the property the chosen approach is meant to deliver:
a field cannot enter rollback tracking without also leaving it. (The alternative
— one clonable `EngineProgress` struct, where restore is a single assignment —
was considered and rejected earlier for its field-path churn across ~2,400
lines.)

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

**The compute phase does not move.** The closure *receives* `&mut Self` as its
parameter, so everything the current immediately-invoked closure does with
`self` — including the large compute phases in `interview_topic`,
`ask_interrogation_question`, and `present_interrogation_evidence` — stays
exactly where it is, with `self.` renamed to `engine.`. No command needs a
fatter pre-transaction read phase. The only data that must be produced before
the transaction is what the closure captures, and today's read phases already
`.clone()` everything they hand forward, because the existing IIFE takes a
unique borrow of `self` for the same reason.

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

  **`install_or_exhaust_line_content` must pass the boundary into the install,
  not assign it afterwards.** `install_scene_queue` takes an optional
  `line_content_start_override` and applies it to the interrogation scene's
  `line_content_start` *before* `consume_scene_tags_at_cursor` runs (dialogue.rs
  `install_scene_queue` doc comment). `None` uses the safe default
  (`items.len()` — nothing here is challengeable), which is what every
  non-testimony caller passes. Testimony callers pass `Some(line_content_start)`
  so the challenge boundary is in place the moment the queue is live.

  The ordering is load-bearing: if the installed queue drains to empty because
  every item was a `SceneTag`, `on_queue_exhausted` may install a successor
  queue with its own boundary. Applying the override *after* the install (as the
  pre-refactor code did) would clobber that successor's boundary with the stale
  value computed for the drained queue, and the inline 反駁 control would
  silently target the wrong line. The regression
  `successor_queue_boundary_survives_draining_predecessor` locks this ordering.
  The override application also keeps its existing
  `if let SceneRuntime::Interrogation(scene) = &mut self.scene` guard rather
  than assuming the variant: installation can drain to empty and reach
  `on_queue_exhausted`, which may transition the scene entirely.

  Five sites use the first verbatim. Three testimony sites
  (`ask_interrogation_question`, `resume_interrogation_testimony`,
  `advance_playing_testimony`'s non-degenerate branch) use the second. The two
  scene-tag sites (`enter_sublocation`, `advance_into_first_sublocation`) hoist
  their `set_scene_tag` call above the branch and then call
  `install_or_exhaust`; because the tag is currently set in both branches this
  is behaviour-identical, and it removes two `.clone()` calls that exist only to
  satisfy the duplicated borrow.

  `advance_playing_testimony`'s degenerate branch (dialogue.rs
  `advance_playing_testimony`, the `!has_dialogue` arm) stays bespoke, and the
  reason must not be lost: **it deliberately does not call
  `on_queue_exhausted()`**. That function's interrogation arm dispatches
  straight back into `advance_playing_testimony` whenever
  `interrogation_playing_unbroken()` holds (dialogue.rs `on_queue_exhausted`),
  so two degenerate shapes would recurse without bound:

  - **Empty testimony** — no line content and no loop bridge. The pre-refactor
    code already special-cased this.
  - **All-`SceneTag` testimony** — `line` / `on_loop` / `loop_prompt` consists
    only of `SceneTag` items. `install_scene_queue` runs
    `consume_scene_tags_at_cursor` before returning, which eats every item, so
    the queue drains to empty inside the install, `on_queue_exhausted` fires,
    and control returns here while `is_playing_unbroken()` still holds —
    recursing until the stack overflows. This path was not handled before this
    issue; the helper extraction would have inherited the unbounded recursion,
    so the degenerate branch was extended to cover it (see Non-Goals for the
    scope exception).

  The branch processes the `SceneTag` items for visual continuity, then calls
  `scene.withdraw()` *first* — making `interrogation_playing_unbroken()` false
  — and only then runs `try_advance_interrogation` / `advance_scene`. Forcing
  this branch into `install_or_exhaust` reintroduces the recursion. Its `else`
  branch is an ordinary `install_or_exhaust_line_content` call and does
  convert.

**Deliberately not done.** `LinearSceneState` keeps its inline `queue` / `cursor`
/ `queue_gen`. Unifying it with `DialogueQueue` would collapse most triplicated
matches, but it changes persisted scene-state shape — that is HPA-129's call to
make alongside `ActiveDialogueState`.

**Terminology warning.** Plan §5 phrases this deliverable as "extract ordered
dialogue-segment lifecycle." That is *not* §16.2's `DialogueSegmentOrigin` /
`ActiveDialogueState` model. In P0.0 it means the existing runtime queue
lifecycle — install, tag consumption, cursor advance, exhaustion dispatch, and
history finalization. Nothing in this issue introduces authored segment origins,
definition hashes, or queue reconstruction; an implementer who starts that shape
change has begun HPA-129 under a P0.0 ticket.

### 3. Navigation (`navigation.rs`)

Ten stateless free functions move. Their **bodies** are verbatim, but three need
a visibility change — Rust privacy runs parent-to-child only, so a private item
in `game::navigation` is *not* visible to its parent `game`, and `new_started`
and `scene_navigation_index` stay in `mod.rs`:

| Function | Visibility | Why |
|---|---|---|
| `load_chapter_manifests` | `pub(super)` | called from `new_started` (mod.rs:111) and `scene_navigation_index` (:140) |
| `scene_navigation_index_from_chapters` | `pub(super)` | called from `scene_navigation_index` (:141) |
| `load_scene_runtime` | `pub(super)` | called from `new_started` (:118) |
| `find_scene_runtime_by_id` | private | only caller is the `jump_to_scene` body, which moves here |
| `scene_json_identity` | private | callers at :205, :2286, :2332 all move here |
| `load_scene_json_for_ref`, `scene_runtime_from_json`, `validate_manifest_scene_type`, `scene_json_type`, `scene_type_label` | private | navigation-internal only |

Getting this wrong is a compile error, not a silent bug, so it is cheap to
correct during implementation — but the table saves a round of confusion about
whether "verbatim" meant visibility too.

Moving as `pub(super)` methods: `prime_initial_queue`, `advance_scene`
(keeping its own `rollback_scope`), `grant_all_evidence_for_testing`, and
`jump_to_scene`'s resolution/reset body.

`prime_initial_queue` is a deliberate judgement call: it installs a dialogue
queue, so a reader chasing queue logic will look in `dialogue.rs` first, but its
three callers (`new_started`, `jump_to_scene`, `advance_scene`) are all
scene-entry paths and it is scene-entry sequencing, not queue mechanics. It
lives here, with a doc comment cross-referencing `dialogue.rs` for the install
primitives it calls, and a matching pointer beside `install_scene_queue` in
`dialogue.rs`.

#### `jump_to_scene` conversion hazard

`jump_to_scene` is the one command whose transaction boundary is **not** the
existing closure, and converting it naively silently breaks rollback.

Today the snapshot is taken at mod.rs:162, and nine mutations run between it and
the closure at mod.rs:174:

```rust
let snapshot = self.snapshot();          // 162

self.current_chapter_idx = chapter_idx;  // 164  ─┐
self.current_scene_idx = scene_idx;               │
self.scene = new_scene;                           │  inside the snapshot's
self.last_visual_cue = LastVisualCue::default();  │  protection, but OUTSIDE
self.inventory = Inventory::default();            │  the closure
self.next_queue_gen = queue_gen + 1;              │
self.dialogue_history = vec![];                   │
self.next_dialogue_history_id = 1;                │
self.last_recorded_dialogue_token = None;    // 172 ─┘

let result = (|| { self.prime_initial_queue()?; /* … */ })();  // 174
self.restore_on_error(snapshot, result)
```

Wrapping only the closure body in `command_tx` would take the snapshot *after*
the resets, so a `prime_initial_queue` failure would roll back to the
already-wiped state instead of the pre-jump state. **All nine mutations must
move inside the `command_tx` closure.** Only the chapter/scene resolution —
`find_scene_runtime_by_id` and the two `ok_or_else` guards, which mutate
nothing — stays outside.

`jump_to_scene_restores_previous_state_when_priming_fails` and
`jump_to_scene_restores_non_empty_dialogue_history_when_priming_fails` are the
tests that catch this. They must be run against the converted command
specifically, not just as part of the suite.

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
closing the path that currently bypasses `reveals`. Return values (`true` when
newly added) and the `on_collect` / `on_acquire` queue-append behaviour are
unchanged.

`Inventory::add_evidence_from_def` and `add_statement_from_def` narrow from
`pub` to `pub(in crate::game)`.

**Call this a hook, not a funnel.** The word "funnel" implies all acquisition
traffic is forced through one point, and that is not achievable in this issue:

- Rust has no single-caller visibility. `pub(in crate::game)` stops bypass from
  *outside* `game` and makes a new bypass inside `game` visible in review, but
  `state.rs`'s own unit tests call these methods directly and will continue to.
- More fundamentally, `Inventory` exposes `pub evidence: Vec<EvidenceRecord>`
  and `pub statements: Vec<StatementRecord>` (state.rs:32–33). Any code holding
  `&mut Inventory` can `.push()` a record directly, and no method-level
  visibility change prevents that.

Closing the second gap means making those fields private with accessors, which
ripples into every `self.inventory.evidence.iter().find(…)` in the commands —
scope this issue explicitly excludes. So the honest contract is: **P0.0 gives
acquisition a single well-named entry point and routes all three current call
sites through it.** It does not prove no fourth path can exist. If HPA-129
needs that proof before attaching `AcquisitionLog`, field encapsulation is its
prerequisite, and this design flags it as such rather than implying the work is
already done.

The funnel test asserts dedup behaviour only. It does not and cannot assert
absence of bypass; the earlier claim that it enforced the funnel was wrong.

Two separate decisions are at work here, and they must not be conflated:

- **Shape** is forced, not chosen. Because `reveals::*` already holds
  `&mut scene` and `&mut inventory` as disjoint borrows of `self`, the funnel
  cannot be a `&mut self` method in *any* module. A borrowed context struct is
  the only shape that compiles.
- **Placement** is a cohesion judgement, and the borrow argument says nothing
  about it — a context struct would compile equally well from `command_tx.rs`.
  It gets its own module because acquisition is where HPA-129's `AcquisitionLog`
  and its `acknowledged` flag will live, and because the two `reveals` functions
  are its only production callers, giving it a boundary independent of the
  transaction machinery. The `command_id` that arrives with HPA-129 is passed
  *into* the context, not owned by it.

This is a fourth module beyond the issue's three named files. The issue states
new modules "may include" those three and that "the focused spec may refine
names," so a fourth focused module is in bounds.

## Testing

### Relocation

Test **assertions move unmodified**. They are the behaviour-preservation
evidence for this refactor; rewriting them would forfeit the proof.

Three categories of mechanical adjustment are expected and allowed, so that a
reviewer does not read them as violating "unmodified":

1. `use` statements and fixture-path references for the new module.
2. **Engine struct literals.** Nine test-side `GameEngine { … }` literals
   (mod.rs:2498, 3640, 4104, 4143, 5127, 5196, 5862, 5995, 6181) currently spell
   out `dialogue_history: vec![]`, `next_dialogue_history_id: 1`,
   `last_recorded_dialogue_token: None`. Each becomes
   `history: DialogueHistory::default()`. `DialogueHistory` therefore implements
   `Default` as `{ entries: vec![], next_id: 1, last_token: None }` — matching
   what `new_started` (mod.rs:127–130) and `jump_to_scene` (mod.rs:170–172)
   currently assign — so this is one token per site, not a rewrite.
3. **Direct field reads.** Two assertions read `engine.dialogue_history`
   directly; they become `engine.history.entries()`.
4. **Fixture visibility.** Declaring `#[cfg(test)] mod test_support;` does not
   by itself let sibling modules call into it — the same parent-to-child
   privacy rule applies. Every shared fixture needs `pub(super)`, which makes it
   visible in `game` and therefore in every descendant, including
   `game::dialogue::tests`. Fixtures that stay local to one module keep their
   current private visibility.

`view.dialogue_history` reads are **not** affected. `GameStateView` keeps its
`dialogue_history` field unchanged — that is the serialized IPC contract the
frontend consumes — so the majority of history assertions need no edit at all.

| Destination | Tests |
|---|---|
| `navigation.rs` | `jump_to_scene_*` (6, including the two `_restores_*` rollback cases, which are jump-specific), `jump_to_interrogation_grants_all_evidence_for_testing`, `scene_navigation_index_*` (4), `scene_lookup_*` (2), `load_scene_runtime_*` (2) |
| `dialogue.rs` | `dialogue_history_*` (4), `stale_intro_token_does_not_advance_later_scene_with_same_id`, `prime_initial_queue_consumes_leading_scene_tags_*` (2), `advance_dialogue_skips_mid_scene_tags_in_linear_scene`, `inspect_hotspot_consumes_leading_scene_tags_in_investigation_queue`, `tag_only_linear_scene_advances_to_game_complete` |
| `command_tx.rs` | `reexamine_{evidence,statement}_rolls_back_tag_only_queue_when_scene_advance_fails`, `failed_scene_advance_keeps_previous_dialogue_view`, `failed_initial_silent_investigation_transition_rolls_back_inventory`, `failed_investigation_intro_completion_rolls_back_inventory`, `failed_silent_investigation_completion_rolls_back_action_state` (6) |
| `mod.rs` | command behaviour, interrogation flow, cross-examination, visual/audio cue, and view-shape tests |
| `test_support.rs` | `empty_engine_with_scene`, `empty_engine_with_interrogation_scene`, `completed_interrogation_engine_with_bad_next_scene`, `investigation_scene_with_intro`, the six interrogation scene builders, `subject`, `empty_testimony`, `break_q1`, `token_from`, `history_labels`, `scene_jump_fixture_resources`, `dialogue_history_fixture_resources` |

`test_support` is `#[cfg(test)] mod test_support;` declared in `game/mod.rs`, so
sibling modules reach it as `super::test_support`.

#### Relocation hazards found during execution

Two hazards surfaced while this design was implemented. Both are properties of
*moving code between modules* rather than of this refactor specifically, so
record them for the next relocation task of this shape.

1. **Moving a type's usages out of a module orphans doc links that referenced
   it.** Relocating the `InterrogationSceneState` usages into `dialogue.rs` and
   `navigation.rs` dropped that name from `mod.rs`'s imports, which silently
   broke an intra-doc link on the *public* `complete_interrogation_phase`. This
   was the only defect introduced by the branch and it survived eight task
   reviews, because **`cargo clippy` does not run rustdoc lints** and CI has no
   rustdoc gate — `-D warnings` is blind to it. After any relocation, run
   `cargo doc --no-deps` and diff the warning count. Note that plain `cargo doc`
   only resolves links on items it documents, so a link on a `pub(super)` item
   needs `--document-private-items` to surface at all. Fix by fully qualifying
   the path rather than re-adding the import, which would then be flagged unused.

2. **Where a `#[cfg(test)]` module is *declared* changes what the source scanner
   can see.** The scanner stops reading a file at its first `#[cfg(test)]` or
   `mod tests {` line, so declaring `mod test_support;` beside the other module
   declarations at the top of `mod.rs` truncates the scan immediately and hides
   every command below it. It must be declared *after* all production code. This
   is a case where file **organisation**, not code, disarms a guard — the
   tracked-command floor catches it (the count collapses rather than shrinking
   by one), but the constraint is otherwise discoverable only by failing, so
   each scanned file carries a comment above its test module saying so.

### Enforcement after the scanner

`every_view_returning_command_routes_through_view_with_history` is retired in
its current form, but **its contract is not fully absorbed by the type system**.
As noted under §1, `command_tx` guarantees history only for commands that go
through it; `self.view()` stays `pub` for `lib.rs`, so a future command can
still bypass the transaction. Deleting the scanner outright would reopen exactly
the hole it was written to close.

It is therefore replaced, not dropped, by a **rewritten source-contract test**
with a narrower and more honest predicate: every
`pub fn … -> Result<GameStateView, GameError>` in the `game` module tree must
contain a `command_tx(` call, with a documented allow-list. Differences from the
version being retired:

- It scans every `.rs` file under `src/game/`, discovered by a recursive
  directory walk at test time, not `include_str!("mod.rs")` alone — the original
  could not see commands defined outside `mod.rs`, which is precisely what this
  refactor creates. **As-built correction:** this shipped first as a hardcoded
  four-file list, which had the same defect one level up — a command added in a
  *fifth* module would never be scanned, and the tracked-command floor would not
  catch it, because the floor guards against shrinkage, not unscanned growth. It
  was replaced with the walk before merge. The walk is deliberately scoped to
  `src/game/` and must stay so: `lib.rs` holds sixteen `#[tauri::command]`
  wrappers that also return `Result<GameStateView, GameError>` and correctly do
  not use the seam, so widening the walk to `src/` fails all sixteen.
- It keeps **both** invariants, not one. **As-built correction:** this design
  originally specified checking only `command_tx(` presence, on the reasoning
  that "the bare-view failure mode is now unreachable inside a transaction."
  That reasoning was wrong and the resulting guard was weaker than the one it
  retired, which review caught before merge. Presence of `command_tx(` is
  satisfiable by an incidental mention — the scanner has no brace tracking, so a
  command's "body" runs to the next `pub fn` and can absorb a private helper's
  text. The retired scanner carried a second, compensating assertion for exactly
  this, and it was restored: **invariant A** is `command_tx(` present, with no
  exemptions; **invariant B** is no bare `Ok(self.view())`, with the allow-list
  scoped to B alone.
- `advance_dialogue` remains allow-listed **for invariant B only**, for its
  documented stale-token early return. It is not, and must not be, exempt from
  invariant A.

This is still a source-text test, which is a weak instrument. It is retained
because the alternative is an unenforced convention, and because the acceptance
criterion it backs — "dialogue history is finalized through one shared path" —
is one HPA-129 will build on. If a later epic makes the property genuinely
structural, the test should go then.

### Added

- **Rollback, investigation delegate.** A command whose queue install fails
  leaves inventory, scene progress, `next_queue_gen`, and dialogue history at
  their pre-command values.
- **Rollback, interrogation delegate.** Same, for a cross-examination command.
- **History finalization, behavioural.** This complements the rewritten
  source-contract test above — that one checks a command *routes through*
  `command_tx`, this one checks the routing produces the right entries — and
  must be specified in terms of the **focused queue token**, not "advancing". `record_current_dialogue_history` dedups on
  `last_recorded_dialogue_token`, so an *installing* command like
  `inspect_hotspot` or `ask_interrogation_question` appends an entry despite
  advancing nothing — it produced a new token at cursor 0. Phrasing the test as
  "advances → one entry" would pass while leaving the install path uncovered,
  which is most of the commands. The three cases:
  - success path leaves a **new** focused token → exactly one new entry for that
    item, unless the item is a `SceneTag`, which records nothing;
  - success path leaves the **same** token, or no active dialogue → zero new
    entries;
  - `advance_dialogue` with a stale token → zero new entries, and no
    transaction is opened at all.
- **`DialogueHistory` unit tests.** Token dedup, 50-entry cap with front-drain
  overflow, `SceneTag` items recording nothing — asserted directly against the
  struct without a `GameEngine`.
- **`AcquisitionCtx` funnel test.** Both `evidence` and `statement` dedupe on
  second acquisition and report `false`.
- **Degenerate-testimony regression test.** A question whose testimony has no
  line content and no `on_loop` / `loop_prompt` bridge returns to the question
  menu and terminates. This locks the `advance_playing_testimony` carve-out
  described above into CI, so a later "fold everything into `install_or_exhaust`"
  cleanup fails loudly instead of hanging. The existing `empty_testimony()`
  fixture (mod.rs:3714) is the starting point. The test must assert termination
  by construction — a drain-everything loop helper would itself spin on an
  unbroken `Playing` state.

### Unchanged

`apps/game/src-tauri/tests/full_playthrough.rs` is not touched. It exercises the
public surface only (`new_started`, `view`, `advance_dialogue`,
`inspect_hotspot`, `interview_topic`, `enter_sublocation`), which this design
holds byte-identical. It is the primary regression gate.

## Integration Points

`apps/game/src-tauri/src/lib.rs` calls all sixteen public `GameEngine` methods
across its `#[tauri::command]` handlers: the thirteen view-returners plus
`new_started`, `view`, and `scene_navigation_index`. Every one keeps its name,
signature, and error behaviour, so `lib.rs`, `generate_handler!`, the IPC wire
contract, and the entire Svelte frontend are untouched by this issue.

**What "save capture/restore entry points" means here.** Canonical §6.2 lists
"save capture/restore entry points" among P0.0's seams and plan §5 says
"establish … save integration entry points," so this needs an explicit
reconciliation rather than a flat denial.

An *entry point* is a place to attach, not an implementation. On that reading
P0.0 delivers three, all of them real and none of them speculative:

1. **The commit point.** §16.1 requires that "saving is allowed after a command
   commits and no mutation is in flight," and §16.4 that "autosave runs after
   committed durable mutations." After this refactor there is exactly one such
   moment in the engine — `command_tx`'s success path, between the closure
   returning `Ok(())` and the view being built. Before the refactor there were
   twelve. That single point is what autosave hooks.
2. **The state enumeration.** `EngineRollbackSnapshot`'s symmetric exhaustive
   capture/restore is the authoritative list of mutable engine state, and the
   compiler forces every future field into it. `SaveSnapshot` is a different
   contract (§7.4) but reads the same enumeration.
3. **The acquisition entry point**, with `AcquisitionCtx` reserving `events`
   and `command_id`.

What P0.0 does **not** ship: any `SaveSnapshot` type, capture or restore
function, serialization, or file I/O. Those are deliberately excluded, on two
grounds. §16.3's `SaveSnapshot` includes facts, questions, objectives, and
authorizations that do not exist until HPA-255, so an adapter designed now would
be designed against unknowns. And an unused adapter is dead code, which
`bun run rust:lint` rejects under clippy's `-D warnings` unless annotated —
trading a real lint gate for a placeholder.

**Open item for the epic owner:** if §6.2 is meant to require an actual save
adapter *function* in P0.0 rather than attachment points, that is a scope
change to this issue and the canonical plan should say so explicitly. This
design assumes the attachment-point reading and assigns adapter creation to
HPA-129.

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

  **Two scoped exceptions** (commit 17a0580), each justified by being
  load-bearing for the refactor's own correctness rather than incidental
  cleanup:

  1. **Challenge-boundary ordering.** `install_or_exhaust_line_content` passes
     `line_content_start` into `install_scene_queue` so the boundary is applied
     *before* `consume_scene_tags_at_cursor`, not assigned after the install.
     The post-install assignment the pre-refactor code used would clobber a
     successor queue's boundary when an all-`SceneTag` queue drains inside the
     install and `on_queue_exhausted` installs a successor — which is exactly
     the shape the extracted helpers now make reachable from more call sites.
     Reverting to the old ordering would reintroduce the clobber under the
     refactored control flow. Locked by the
     `successor_queue_boundary_survives_draining_predecessor` regression.
  2. **All-`SceneTag` degenerate testimony.** A testimony whose `line` /
     `on_loop` / `loop_prompt` is entirely `SceneTag` items previously
     installed a queue that drained immediately and recursed back into
     `advance_playing_testimony` until the stack overflowed. The helper
     extraction routes more testimony paths through
     `install_or_exhaust_line_content`, so the unbounded recursion would have
     been inherited by the refactored code. The degenerate branch was extended
     to process the tags and withdraw instead (see the degenerate-branch note
     above).
