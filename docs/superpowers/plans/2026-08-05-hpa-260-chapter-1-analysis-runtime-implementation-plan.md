# HPA-260 Chapter 1 Analysis Runtime and Exact Draft Persistence Implementation Plan

> **For implementation agents:** execute task-by-task with tests first. Keep every commit buildable. Prefer direct code and existing seams over abstractions. Start from current `main` after HPA-259; rebase before implementation and do not reproduce upstream compiler/schema/origin work.

**Goal:** Run the merged HPA-259 classify, order, and threshold Analysis definition in Rust, preserve exact authoritative drafts/result-dialogue position through the current save contract, expose an answer-key-free public view, and autosave workbench changes without frontend thumbnail capture or thumbnail-warning activity.

**Architecture:** HPA-259 owns immutable definitions, `StoryUnlockExpr`, normalized hidden answers, dialogue origins/resolution, catalog membership, loader validation, and the checked-in three-board fixture. HPA-260 adds only mutable runtime state, qualified completion, commands, public views, current-format persistence, and one narrow no-thumbnail autosave path. Availability is derived from package + `StoryState` and is not duplicated in the save snapshot.

---

## 0. Baseline and non-goals

Before coding, verify current `main` contains:

- `SceneType::Analysis` / `SceneJson::Analysis`;
- `AnalysisSceneJson`, `AnalysisBoardJson`, `AnalysisBoardJsonCommon`, `board.common()`;
- `StoryUnlockExpr`;
- hidden `acceptedGroupByCard`, `acceptedOrder`, `acceptedSelections`;
- incomplete/incorrect copy + optional static hint;
- `DialogueSegmentOriginV1::{AnalysisIntro, AnalysisResult, AnalysisOutro}`;
- Analysis origin resolution and dialogue-group enumeration;
- `StoryCatalog::has_analysis_scene` / `has_analysis_board`;
- loader validation for Analysis unlock/reveal refs;
- `apps/game/src-tauri/src/game/test_fixtures/analysis_scene_8_5.json`;
- the intentional pre-HPA-260 navigation/capture/restore fail-closed behavior.

Do not add:

- a generic puzzle/evaluator/plugin system;
- Rust provenance/source-group/procedure/capability evaluation;
- save migrations or sibling versioned DTOs;
- duplicate `AnalysisDraftInput` / `AnalysisDraftSnapshot` families;
- an Analysis persistence worker/state machine;
- Analysis acquisition or authorization-grant output;
- Svelte implementation, Chapter 2 templates, or production Beat 8.5 insertion;
- new packaged UI checkpoint IDs in HPA-260.

---

## File ownership map

### Create

- `apps/game/src-tauri/src/game/analysis.rs`
  - `AnalysisDraft`;
  - `AnalysisFeedbackState`;
  - `AnalysisActionToken`.
- `apps/game/src-tauri/src/game/scenes/analysis.rs`
  - `AnalysisSceneState`;
  - mutable draft validation;
  - completeness/direct evaluation;
  - availability recomputation;
  - focused tests.

### Modify

- `apps/game/src-tauri/src/game/mod.rs`
- `apps/game/src-tauri/src/game/scenes/mod.rs`
- `apps/game/src-tauri/src/game/unlock.rs`
- `apps/game/src-tauri/src/game/navigation.rs`
- `apps/game/src-tauri/src/game/dialogue.rs`
- `apps/game/src-tauri/src/game/story/catalog.rs`
- `apps/game/src-tauri/src/game/story/state.rs`
- `apps/game/src-tauri/src/game/story/mutations.rs`
- `apps/game/src-tauri/src/game/reveals.rs` only if a tiny adapter genuinely helps
- `apps/game/src-tauri/src/game/view.rs`
- `apps/game/src-tauri/src/game/error.rs`
- `apps/game/src-tauri/src/game/test_support.rs`
- `apps/game/src-tauri/src/game/save/schema.rs`
- `apps/game/src-tauri/src/game/save/capture.rs`
- `apps/game/src-tauri/src/game/save/restore.rs`
- `apps/game/src-tauri/src/game/save/coordinator/mod.rs`
- relevant coordinator test files
- `apps/game/src-tauri/src/lib.rs`
- `packages/shared/fixtures/unlock-expression-semantics.json`
- `packages/scripts/compile-scenes/parser-unlock.test.ts`

### Normally do not modify

- immutable Analysis serde definitions in `schema.rs`;
- HPA-259 Analysis dialogue origin variants/resolver except deleting a dead temporary helper;
- Analysis parser/validator/emitter/reachability production code;
- `game/e2e_checkpoints.rs`.

---

# Task 1 — Qualified completion, symmetric origin validation, and StoryUnlockExpr semantics

**Produces:** one completion authority, package-backed Analysis origin persistence, an Analysis-aware test catalog seam, and cross-language-pinned story unlock semantics.

## 1A. Tests first

Add failing tests for:

- qualified/idempotent board completion;
- qualified/idempotent scene completion;
- unknown completion refs rejected without mutation;
- AnalysisBoard origin accepted only for a catalog member;
- live origin acceptance and snapshot restore use the same catalog-backed rule;
- `StoryUnlockContext` reads persisted Analysis completion;
- `StoryUnlockExpr` leaf/and/or/at-least semantics.

## 1B. Reuse HPA-259 completion ref shapes

Reuse the existing `AnalysisSceneRef` / `AnalysisBoardRef` in `story/catalog.rs`.

- widen only to sibling `story` modules;
- add `Serialize` as needed;
- do not create state-only duplicates.

Add to `StoryState` and current `StoryStateSnapshot`:

```rust
completed_analysis_scenes: BTreeSet<AnalysisSceneRef>,
completed_analysis_boards: BTreeSet<AnalysisBoardRef>,
```

Add idempotent package-validated mutation façades:

```rust
complete_analysis_board(catalog, chapter_id, scene_id, board_id)
complete_analysis_scene(catalog, chapter_id, scene_id)
```

Return existing `MutationOutcome`.

## 1C. Fix origin persistability once

Change:

```rust
ensure_origin_kind_is_persistable(&self)
```

to:

```rust
ensure_origin_kind_is_persistable(
    &self,
    catalog: &StoryCatalog,
) -> Result<(), String>
```

Rules:

- `AnalysisBoard` -> require `catalog.has_analysis_board(...)`;
- `StoryEvent` -> keep fail-closed;
- existing durable origins -> unchanged.

Pass catalog through every current live-mutation and snapshot-validation call site. Do not create an Analysis-only second validator.

## 1D. Add Analysis-aware test catalog support

`write_neutral_story_catalog` / `catalog_with_case_records` currently cannot produce valid Analysis membership.

Add one small sibling/helper or shared private writer in `game/test_support.rs` that can include qualified Analysis scene/board refs without forcing unrelated tests to change signatures.

Use it in the origin/completion tests so `StoryCatalog::has_analysis_board` is exercised for real.

## 1E. Add `evaluate_story`

In `unlock.rs`:

```rust
pub fn evaluate_story(
    expr: &StoryUnlockExpr,
    story: &dyn StoryUnlockContext,
) -> bool
```

Direct-match the merged story-only variants and reuse existing `evaluate_at_least`. Do not refactor all expression families into a generic visitor.

## 1F. Pin semantics in the shared fixture

Extend:

```text
packages/shared/fixtures/unlock-expression-semantics.json
```

with a `story` family using valid story predicates and legal at-least counts.

Update:

- Rust `unlock.rs` fixture family enum/consumer;
- TS `parser-unlock.test.ts` fixture type/consumer.

Both sides must evaluate the same bytes to the same expected booleans.

Do not use this task to change parser grammar. `at_least(0, ...)` remains invalid input.

## Verify

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml story::
cargo test --manifest-path apps/game/src-tauri/Cargo.toml unlock::
bun run --cwd packages/scripts test parser-unlock.test.ts
```

## Commit

```bash
git add \
  apps/game/src-tauri/src/game/story \
  apps/game/src-tauri/src/game/unlock.rs \
  apps/game/src-tauri/src/game/test_support.rs \
  packages/shared/fixtures/unlock-expression-semantics.json \
  packages/scripts/compile-scenes/parser-unlock.test.ts
git commit -m "feat(game): persist analysis completion and unlocks"
```

---

# Task 2 — Neutral shared values and Analysis scene state

**Produces:** one shared draft/feedback/token wire and pure mutable Analysis semantics.

## 2A. Create neutral `game/analysis.rs`

```rust
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AnalysisDraft {
    Classify { group_by_card: BTreeMap<String, String> },
    Order { card_ids: Vec<String> },
    Threshold { selected_card_ids: BTreeSet<String> },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AnalysisFeedbackState {
    Incomplete,
    Incorrect,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisActionToken {
    pub scene_id: String,
    pub active_board_id: Option<String>,
    pub durable_revision: u64,
}
```

This token shape intentionally stays aligned with HPA-261's current public-view plan.

`save/schema.rs` may import this neutral module later. It must not import `scenes::analysis`.

## 2B. Table-driven draft tests

### Classify

- empty/partial valid;
- unknown card/group rejected;
- every displayed card required for completeness;
- correctness = exact normalized map equality.

### Order

- partial unique permutation valid;
- unknown/duplicate IDs rejected;
- included fixed anchor must occupy authored one-based position;
- completeness = all displayed cards once;
- correctness = exact normalized vector equality.

### Threshold

- selected IDs must be displayed/unique;
- completeness = selection count >= `minimumSelected`;
- correctness = normalized selected set matches an emitted accepted set;
- no provenance/source/procedure/capability evaluator exists here.

### Serde

- no `accepted*` fields in draft JSON;
- feedback only `incomplete` / `incorrect`;
- no separate save draft DTO.

## 2C. Add `AnalysisSceneState`

```rust
pub struct AnalysisSceneState {
    pub def: AnalysisSceneJson,
    pub intro_played: bool,
    pub outro_played: bool,
    pub available_board_ids: BTreeSet<String>,
    pub active_board_id: Option<String>,
    pub drafts: BTreeMap<String, AnalysisDraft>,
    pub feedback_by_board_id: BTreeMap<String, AnalysisFeedbackState>,
    pub(crate) pending_queue: Option<ActiveDialogueQueue>,
    pub intro_queue_gen: u64,
}
```

`from_json` initializes one empty typed draft per board.

## 2D. Pure availability recomputation

Add one helper that computes the current set from:

```text
packaged board unlocks + StoryState
```

Rules:

- no unlock -> available;
- story unlock -> `evaluate_story`;
- no previous-set union;
- no override set;
- no inventory/local unlock context;
- no hardcoded previous-board chain.

`available_board_ids` is runtime state/cache only. It will not be serialized.

## Verify

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml scenes::analysis
```

## Commit

```bash
git add \
  apps/game/src-tauri/src/game/analysis.rs \
  apps/game/src-tauri/src/game/scenes/analysis.rs \
  apps/game/src-tauri/src/game/scenes/mod.rs \
  apps/game/src-tauri/src/game/mod.rs
git commit -m "feat(game): add analysis mutable state and drafts"
```

---

# Task 3 — SceneRuntime, navigation, and dialogue lifecycle

**Produces:** playable Analysis entry/result/outro lifecycle while save support remains deliberately fail-closed until Task 6.

## 3A. Tests first

Cover:

- Analysis no longer fails navigation construction;
- runtime id/title are correct;
- initial availability is recomputed from StoryState;
- no-unlock board becomes available;
- intro uses existing `AnalysisIntro`;
- empty intro exposes workbench immediately;
- auto-focus chooses first available incomplete board in authored order;
- non-sequential unlock fixture proves no Chapter 1 hardcode;
- result/outro origins still resolve through HPA-259 infrastructure.

## 3B. Add `SceneRuntime::Analysis`

Extend the runtime enum and required exhaustive matches for:

- id/title;
- current dialogue item;
- SceneTag/queue consumption;
- queue install/remove;
- current queue token;
- mode/view routing;
- queue exhaustion.

Use compiler errors + `rg 'SceneRuntime::'` to discover true exhaustive sites. Do not infer a need for Analysis-specific rollback code: `EngineRollbackSnapshot` clones/restores `SceneRuntime` generically.

## 3C. Buildability rule

Save/capture/restore currently contain intentional pre-HPA-260 guards/fallbacks. Do not prematurely implement persistence in this task.

If adding the enum variant causes a genuinely exhaustive save/restore match to stop compiling, add only the smallest explicit fail-closed placeholder needed for this commit and mark it for Task 6 replacement. Do not add speculative temporary arms merely because a file mentions `SceneRuntime`.

Task 6 must remove every buildability-only placeholder.

## 3D. Navigation and lifecycle

Replace the scene-construction `unsupportedSceneType("analysis")` arm with `AnalysisSceneState::from_json`.

Prime:

1. recompute availability;
2. install non-empty unplayed intro using existing origin/generation;
3. otherwise mark intro consumed and expose workbench.

Queue exhaustion:

- intro -> workbench + auto-focus;
- result -> next available incomplete board;
- all boards complete -> existing AnalysisOutro;
- outro -> qualified scene completion + advance once.

## Verify

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_navigation
cargo test --manifest-path apps/game/src-tauri/Cargo.toml dialogue
```

## Commit

```bash
git add apps/game/src-tauri/src/game/scenes \
  apps/game/src-tauri/src/game/navigation.rs \
  apps/game/src-tauri/src/game/dialogue.rs \
  apps/game/src-tauri/src/game/mod.rs
# Add save files only if compiler-required fail-closed buildability arms were truly necessary.
git commit -m "feat(game): run analysis scene lifecycle"
```

---

# Task 4 — Atomic workbench commands

**Produces:** select/update/submit state machine through `command_tx`.

## 4A. Tests first

Cover:

- select any available board;
- reopen completed board read-only;
- partial classify/order/threshold whole-draft replacement;
- stale scene/active-board/revision token rejected without mutation;
- stale rejection does not bump revision or schedule persistence;
- incomplete submit changes only feedback;
- wrong submit changes only feedback;
- correct submit commits completion/reveals/result exactly once;
- injected invalid reveal rolls back complete engine state;
- repeated accepted submit cannot replay;
- correct submit recomputes runtime availability;
- final board waits for result + outro before scene advance.

## 4B. Keep one whole-draft update command

Commands:

```text
select_analysis_board
update_analysis_draft
submit_analysis_board
```

The reviewer-proposed split into classify/order/threshold delta commands is intentionally not adopted. Current `game-client.svelte.ts` already gates gameplay mutation dispatch with `gameState.inFlight`, so normal application traffic does not have two workbench mutations racing through Rust concurrently. Three new board-kind-specific public APIs would increase Tauri wrappers, command-name unions, SFX/source-contract tests, and validation branches without reducing HPA-260 backend work.

If later HPA-261 playtesting proves the existing one-command-in-flight UI behavior is too restrictive, fix that interaction policy in the UI layer rather than pre-expanding Rust APIs.

## 4C. Lock the stale wire

Every Analysis view returns the current `AnalysisActionToken` and the frontend echoes it unchanged.

Validate before mutation:

1. current scene is Analysis;
2. scene id matches;
3. active board matches;
4. durable revision matches.

Any mismatch returns exactly:

```text
staleAnalysisAction
```

with no mutation/revision/persistence side effect.

## 4D. Select

Inside `command_tx`:

- target board exists and is currently available;
- completed target allowed read-only;
- mutate only active board;
- selecting current board -> `Unchanged`.

## 4E. Update

Inside `command_tx`:

- require incomplete active board;
- validate shared draft kind/IDs;
- replace whole draft;
- clear failure feedback;
- identical draft -> `Unchanged`;
- no story/dialogue effects.

## 4F. Submit

Incomplete:

- `Incomplete` feedback only.

Complete wrong:

- `Incorrect` feedback only.

Correct in one transaction:

1. preserve final draft;
2. complete qualified board;
3. reuse `apply_story_reveals` with `AssertionOrigin::AnalysisBoard`;
4. empty FactSupport / no represented authority;
5. recompute runtime availability;
6. clear stale feedback;
7. install existing AnalysisResult dialogue.

No acquisition or authorization grant.

## Review checkpoint A

Reject implementation here if it added:

- a board evaluator registry;
- a second rollback snapshot;
- a second reveal executor;
- Rust provenance re-evaluation;
- completion IDs in scene progress;
- `Accepted` feedback;
- custom Analysis dialogue origins;
- acquisition acknowledgement changes;
- three board-kind-specific Tauri update APIs without a demonstrated need.

## Commit

```bash
git add \
  apps/game/src-tauri/src/game/analysis.rs \
  apps/game/src-tauri/src/game/scenes/analysis.rs \
  apps/game/src-tauri/src/game/mod.rs \
  apps/game/src-tauri/src/game/story \
  apps/game/src-tauri/src/game/error.rs
git commit -m "feat(game): add atomic analysis workbench commands"
```

---

# Task 5 — Answer-key-free Rust public views

**Produces:** stable backend view contract for HPA-261; no public Tauri registration yet.

## 5A. Projection tests first

Prove Analysis views expose:

- current background/audio;
- current action token;
- active/available/completed/read-only board state;
- public card/source labels/summaries;
- classify groups;
- order fixed anchors;
- threshold `minimumSelected`;
- current shared draft;
- only incomplete/incorrect failure state + authored visible copy;
- optional static hint.

Prove serialized `GameStateView` contains none of:

```text
acceptedGroupByCard
acceptedOrder
acceptedSelections
```

## 5B. Public structs

Add focused `ModeView::Analysis` / `SceneView::Analysis` structs in `view.rs`.

Do not serialize immutable Analysis definition structs directly.

Derived availability is projected from current runtime state; it is not a save DTO.

## Commit

```bash
git add apps/game/src-tauri/src/game/view.rs
git commit -m "feat(game): project analysis workbench views"
```

---

# Task 6 — Exact Analysis save/restore and complete guard retirement

**Produces:** current-format Analysis persistence before autosave/Tauri wiring is enabled.

## 6A. Save shape

Extend current `SceneProgressSnapshot` in place:

```rust
Analysis {
    intro_played: bool,
    outro_played: bool,
    active_board_id: Option<String>,
    drafts: BTreeMap<String, AnalysisDraft>,
    feedback_by_board_id: BTreeMap<String, AnalysisFeedbackState>,
}
```

Do **not** persist `available_board_ids`.

Completion remains only in `StoryStateSnapshot`; active Analysis dialogue remains in existing `activeDialogue`.

## 6B. Tests first

Add:

- partial classify/order/threshold round trips;
- incomplete/incorrect feedback round trip;
- completed read-only board restore;
- mid-result dialogue cursor round trip;
- unknown board/card/group/draft kind rejected;
- invalid fixed anchor / duplicate ID rejected;
- unknown completion ref rejected;
- active board unavailable after recomputation rejected;
- restore failure leaves live session untouched;
- exact recapture equals saved snapshot;
- save JSON contains no answer keys/authored hidden solution data;
- Analysis asset refs participate in definition validation.

## 6C. Capture

Capture:

- intro/outro flags;
- active board;
- exact draft map;
- failure feedback map;
- existing active dialogue state;
- StoryState snapshot completion.

Do not capture derived availability.

Remove the temporary capture rejection for Analysis dialogue origins.

## 6D. Restore

Replace temporary Analysis progress rejection with real definition-backed reconstruction.

Restore must:

- pair `SceneJson::Analysis` only with Analysis progress;
- rebuild `AnalysisSceneState` from packaged definition;
- validate exact authored draft-key set and draft kinds;
- validate mutable IDs/anchors via the same helpers commands use;
- validate completion refs through StoryCatalog;
- recompute availability from package + restored StoryState;
- require active board, if present, to be in the recomputed set;
- permit completed active board read-only;
- restore known-board feedback;
- restore Analysis intro/result/outro origins/cursor through the merged resolver;
- exact-recapture before live session replacement.

## 6E. Retire every temporary guard

Remove/replace:

- navigation scene-construction Analysis unsupported arm;
- active Analysis origin capture rejection;
- restore/dialogue-side Analysis-origin rejection;
- packaged Analysis scene-progress restore rejection;
- `scene_asset_refs(SceneJson::Analysis(_)) -> &[]` -> `&analysis.asset_refs`;
- `DialogueSegmentOriginV1::is_analysis()` if dead;
- old tests asserting Analysis capture/restore is unsupported;
- any Task 3 buildability-only placeholder.

Keep Analysis evidence/statement manifests empty.

### Permanent re-examination exception

Do not remove the existing inventory re-examination-origin guard in `game/mod.rs`:

```rust
SceneType::Analysis => GameError::unsupported_scene_type("analysis")
```

Analysis boards do not acquire inventory records, so that source-scene combination remains invalid by design.

## Verify

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_snapshot
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_restore
cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::
```

## Commit

```bash
git add \
  apps/game/src-tauri/src/game/save \
  apps/game/src-tauri/src/game/story \
  apps/game/src-tauri/src/game/dialogue_queue.rs
git commit -m "feat(save): persist exact analysis progress"
```

---

# Task 7 — No-thumbnail autosave policy, then Tauri registration

**Produces:** high-frequency authoritative workbench persistence without frontend capture or persistent preview-warning activity.

## 7A. Behavior test first

Now that Task 6 makes Analysis capturable, add an application/coordinator test proving:

```text
50 Analysis workbench mutations within AUTOSAVE_DEBOUNCE
-> 50 durable revision advances
-> every GameplayCommandResultView.thumbnailCapture == null
-> no frontend capture request is created
-> coordinator.thumbnail_activity() remains Idle before/during/after the burst
-> no thumbnail activity subscriber receives Capturing or Unavailable
-> no thumbnail-expiry task is spawned for those autosave intents
-> one trailing autosave write occurs
-> written revision == newest committed revision
-> autosave write sees CaptureTerminalResult::Unavailable
```

Also cover supersession/retry so a no-thumbnail autosave revision never later creates a frontend capture request or warning activity.

## 7B. Add policy

```rust
MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail
```

Extend `run_gameplay_mutation` so an advanced revision under this policy calls one narrow coordinator no-capture path and returns:

```text
thumbnailCapture: null
```

## 7C. Coordinator implementation boundary

Do not route this through normal `issue_thumbnail()`, because it publishes `ThumbnailActivityView::Capturing`, spawns an expiry task, and can later publish user-visible `Unavailable`.

If the current `PendingAutosave`/wait path still requires a ticket identity, add one private helper that creates an immediately terminal `Unavailable` ticket/record while:

- preserving intent supersession;
- setting `terminal = Some(CaptureTerminalResult::Unavailable)` immediately;
- notifying ticket waiters;
- never calling `set_thumbnail_activity` / `publish_activity`;
- never spawning `thumbnail_ticket_expiry_task`;
- reusing the existing trailing debounce/write path.

Internal terminal records are acceptable. Thumbnail activity must remain Idle.

If this unexpectedly requires broad schedule/wait/flush redesign, stop and attach measured evidence to HPA-521 instead of creating an Analysis-specific persistence subsystem.

## 7D. Register Tauri commands only now

Register:

```text
select_analysis_board
update_analysis_draft
submit_analysis_board
```

All three must use `AutosaveIfAdvancedWithoutThumbnail`.

Add a source/application contract test pinning that policy choice so a future edit cannot accidentally route workbench commands through ordinary thumbnail-requesting autosave.

Keep `advance_dialogue` on its existing policy.

## Commit

```bash
git add \
  apps/game/src-tauri/src/game/save/coordinator \
  apps/game/src-tauri/src/lib.rs
git commit -m "feat(save): autosave analysis without thumbnail activity"
```

---

# Task 8 — Fixture-backed Rust integration acceptance

**Produces:** one end-to-end Rust runtime/save flow without inventing UI checkpoint infrastructure.

## 8A. Build test resources from existing seams

Use the existing temp-resource pattern in `game/test_support.rs` (for example the `hpa_257_fixture_resources` style) and the checked-in:

```text
apps/game/src-tauri/src/game/test_fixtures/analysis_scene_8_5.json
```

Add only the minimum Analysis-aware resource helper needed to construct a valid chapter/catalog/content bundle for the Rust engine.

Do not add production `analysis_scene_8_5.md` and do not create another hand-authored three-board JSON definition.

## 8B. Do not add new `CheckpointId` variants

HPA-260 ships no Svelte and the three-board scene is not yet a compiled production Chapter 1 scene. Existing packaged checkpoints start from production resources and are consumed by UI/Tauri E2E.

Therefore remove the previously planned:

```text
chapter-1-analysis-classify-partial
chapter-1-analysis-order-partial
chapter-1-analysis-threshold-partial
chapter-1-analysis-result-dialogue
```

from HPA-260 scope.

If packaged deterministic Analysis entry points are still useful after HPA-265 authors the real production scene, HPA-266/HPA-516 can add them where both production resources and the UI consumer exist. HPA-261 continues using answer-key-free typed fixtures meanwhile.

## 8C. Integration flow

Drive the fixture through public engine commands:

```text
enter Analysis
-> drain intro
-> partial classify
-> explicit capture
-> detached restore + exact recapture
-> finish classify
-> drain result
-> finish order
-> drain result
-> wrong threshold
-> correct threshold
-> capture mid-result
-> detached restore at exact cursor
-> drain result
-> drain outro
-> advance exactly once
```

Assert:

- exact partial draft state across restore;
- expected StoryState facts/objective changes;
- qualified board/scene completion;
- derived availability after each completion;
- completed board read-only reopen;
- durable revision progression;
- no replay of accepted effects/dialogue;
- no accepted answer/provenance leakage in public/save JSON.

## Review checkpoint B

Reject final implementation if it contains:

- compiler/schema work already owned by HPA-259;
- duplicate Analysis ref/draft/snapshot types;
- persisted availability;
- duplicate completion truth;
- provenance reimplementation;
- Analysis-specific persistence machinery;
- accidental acquisition/authorization support;
- accidental Svelte/Chapter 2/production content;
- answer-key leakage;
- new Analysis packaged checkpoint IDs;
- broad coordinator refactor without HPA-521 evidence.

## Commit

```bash
git add apps/game/src-tauri/src/game/test_support.rs \
  apps/game/src-tauri/tests \
  apps/game/src-tauri/src/game
# Do not touch e2e_checkpoints.rs solely for HPA-260 Analysis checkpoints.
git commit -m "test(game): accept Chapter 1 analysis runtime"
```

---

# Review disposition

The latest implementation-seam review is resolved as follows:

1. **Thumbnail activity leak — accepted.** Activity must remain Idle; no Capturing/Unavailable publication or expiry task is allowed for Analysis workbench autosave.
2. **Task order — accepted.** Persistence now precedes autosave/Tauri registration. The review's blanket statement that Task 3 must modify `command_tx` is not adopted because rollback clones `SceneRuntime` generically; save placeholders are added only if actual exhaustive matches require them.
3. **Four HPA-260 packaged checkpoints — accepted with ownership correction.** Remove them from HPA-260. HPA-261 keeps typed frontend fixtures; optional packaged production checkpoints belong to HPA-266/HPA-516 after HPA-265 authors the real scene.
4. **Analysis-aware test catalog — accepted.** `test_support.rs` is Task 1 scope.
5. **Persisted `availableBoardIds` — accepted.** Remove it from the save shape and recompute on restore.
6. **Replace whole-draft command with delta commands — not adopted.** Existing `gameState.inFlight` already serializes normal gameplay mutation IPC. Splitting into board-kind-specific mutation APIs increases wire/test surface. Keep the whole-draft command + token, and lock the stale error to `staleAnalysisAction`.
7. **Shared StoryUnlock semantics corpus — accepted.** Extend the existing shared fixture with a story family consumed by Rust and TypeScript.
8. **Permanent Analysis unsupported guard — accepted.** The inventory re-examination source-scene guard is intentionally retained and excluded from the temporary-guard cleanup expectation.

---

# Final verification

Focused:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_completion
cargo test --manifest-path apps/game/src-tauri/Cargo.toml story_unlock
cargo test --manifest-path apps/game/src-tauri/Cargo.toml scenes::analysis
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_navigation
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_snapshot
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_restore
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_autosave
```

Final gate:

```bash
bun run scenes:compile
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
bun run check
bun run lint:all
```

Answer-key scan:

```bash
rg -n "acceptedGroupByCard|acceptedOrder|acceptedSelections" \
  apps/game/src-tauri/src/game/view.rs \
  apps/game/src-tauri/src/game/save \
  apps/game/src-tauri/src/lib.rs \
  apps/game/src/lib || true
```

Expected: accepted-answer names appear only in immutable schema/evaluator/tests, never in public/save/frontend serialized contracts.

Temporary-guard scan:

```bash
rg -n "before HPA-260|is_analysis\(\)|unsupported_scene_type\(\"analysis\"\)" \
  apps/game/src-tauri/src/game
```

Expected:

- no pre-HPA-260 navigation/capture/restore/dialogue guard remains;
- the intentional inventory re-examination `SceneType::Analysis => unsupported_scene_type("analysis")` in `game/mod.rs` may remain;
- historical test/doc strings may remain only when explicitly labeled historical.

---

# Definition of done

- [ ] All three merged Analysis board kinds run through one direct Rust evaluator path.
- [ ] Qualified completion persists once in StoryState and drives Analysis unlock predicates.
- [ ] AnalysisBoard origin persistence is package-validated symmetrically live and on restore.
- [ ] StoryUnlockExpr semantics are pinned by the shared cross-language fixture.
- [ ] One neutral AnalysisDraft/Feedback/ActionToken family serves runtime/view/save/command needs.
- [ ] Runtime availability is recomputed and is not duplicated in save state.
- [ ] Completed boards reopen read-only.
- [ ] Stale action failure is exactly `staleAnalysisAction` and mutates nothing.
- [ ] Incomplete/wrong submit preserves draft and emits no durable story output.
- [ ] Correct submit atomically commits final draft, completion, reveals, availability recompute, and result dialogue.
- [ ] Failed story/queue/view work restores the pre-command engine snapshot.
- [ ] Repeated accepted submit cannot replay output/dialogue.
- [ ] Analysis drafts and mid-result dialogue resume exactly through current-format detached restore.
- [ ] Every temporary HPA-259 Analysis guard is retired except the intentional inventory re-examination guard.
- [ ] Analysis asset refs participate in restore validation.
- [ ] Public/save JSON contains no accepted solution/provenance answer key.
- [ ] Workbench responses contain no thumbnail request and coordinator thumbnail activity remains Idle.
- [ ] A 50-mutation burst coalesces to one newest-revision autosave write with internal thumbnail result Unavailable.
- [ ] Tauri workbench commands are registered only after persistence and the final no-thumbnail policy exist.
- [ ] HPA-260 adds no new packaged UI checkpoint IDs; one fixture-backed Rust integration flow proves acceptance.
- [ ] No save migration, generic puzzle framework, acquisition extension, Svelte work, Chapter 2 support, or broad coordinator refactor is added.
