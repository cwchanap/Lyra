# HPA-260 Chapter 1 Analysis Runtime and Exact Draft Persistence Implementation Plan

> **For implementation agents:** execute task-by-task with tests first. Keep every commit buildable. Prefer direct code and existing seams over abstractions. This plan starts from current `main` after HPA-259 merged; do not reimplement the compiler/Rust handoff already present.

**Goal:** Run the merged HPA-259 Chapter 1 classify, order, and threshold fixture in the Rust-owned runtime, preserve exact mutable drafts/result-dialogue position through the current save contract, and expose an answer-key-free public view.

**Architecture:** HPA-259 already owns immutable Analysis definitions, `StoryUnlockExpr`, compiler-normalized hidden answers, stable dialogue origins/resolution, StoryCatalog membership, loader validation, and the Beat 8.5 fixture. HPA-260 adds only mutable completion/state/commands/views/persistence. Correctness is direct comparison with the merged hidden answers. Completion persists once in `StoryStateSnapshot`. Workbench mutations reuse `command_tx` and the current autosave debounce without thumbnails.

**Tech stack:** Rust, Tauri 2, serde, existing `GameEngine::command_tx`, existing dialogue queue/origin resolver, existing StoryState/reveal seams, current save DTOs, current SaveCoordinator, Rust tests/E2E checkpoints.

---

## 0. Merged baseline — do not rebuild this

Before editing, verify `main` contains the merged HPA-259 handoff:

- `SceneType::Analysis` / `SceneJson::Analysis`;
- `AnalysisSceneJson`, `AnalysisBoardJson`, `AnalysisBoardJsonCommon` and `board.common()`;
- `StoryUnlockExpr`;
- `acceptedGroupByCard`, `acceptedOrder`, `acceptedSelections`;
- incomplete/incorrect feedback and optional hint;
- `DialogueSegmentOriginV1::{AnalysisIntro, AnalysisResult, AnalysisOutro}`;
- Analysis origin resolution in `dialogue_queue.rs`;
- Analysis dialogue-group enumeration in `schema.rs`;
- `StoryCatalog::has_analysis_scene` / `has_analysis_board`;
- loader validation for Analysis unlocks/reveals;
- `apps/game/src-tauri/src/game/test_fixtures/analysis_scene_8_5.json`;
- `navigation.rs` Analysis `unsupportedSceneType` fail-closed arm;
- capture/restore Analysis fail-closed guards.

If any item is missing, rebase/update the implementation branch before coding; do not reproduce HPA-259 inside HPA-260.

### Locked YAGNI constraints

- Support exactly `classify`, `order`, `threshold`.
- Do not add a generic puzzle/evaluator/plugin system.
- Do not add a Rust provenance/source-group/status/capability solver.
- Treat HPA-259's six-card threshold cap as compiler-only.
- Persist feedback only as `Incomplete | Incorrect`.
- Successful acceptance is qualified completion + result dialogue, not an `Accepted` flag.
- Board outputs are story reveals only; do not add Analysis acquisition output or authorization granting.
- Do not add save migrations/versioned sibling DTOs/compatibility adapters.
- Do not add Svelte, Chapter 2, production Beat 8.5 insertion, or progressive hint history.
- Reuse `command_tx`, `EngineRollbackSnapshot`, `apply_story_reveals`, `StoryUnlockContext`, merged Analysis dialogue origins/resolver, exact detached restore, and current autosave debounce.

---

## File ownership map after HPA-259 merge

### Create

- `apps/game/src-tauri/src/game/scenes/analysis.rs`
  - `AnalysisSceneState`;
  - shared serde `AnalysisDraft`;
  - shared serde `AnalysisFeedbackState`;
  - mutable draft validation/completeness/direct evaluation;
  - availability helpers;
  - focused unit tests.

Use one flat scene module first, matching existing `linear.rs`, `investigation.rs`, and `interrogation.rs`. Do not create classify/order/threshold submodules unless the implemented file becomes demonstrably hard to maintain.

### Modify

- `apps/game/src-tauri/src/game/scenes/mod.rs`
- `apps/game/src-tauri/src/game/unlock.rs`
- `apps/game/src-tauri/src/game/navigation.rs`
- `apps/game/src-tauri/src/game/dialogue.rs`
- `apps/game/src-tauri/src/game/mod.rs`
- `apps/game/src-tauri/src/game/story/catalog.rs`
- `apps/game/src-tauri/src/game/story/state.rs`
- `apps/game/src-tauri/src/game/story/mutations.rs`
- `apps/game/src-tauri/src/game/reveals.rs` only if a tiny Analysis adapter improves call-site clarity; do not add another executor
- `apps/game/src-tauri/src/game/view.rs`
- `apps/game/src-tauri/src/game/error.rs`
- `apps/game/src-tauri/src/game/save/schema.rs`
- `apps/game/src-tauri/src/game/save/capture.rs`
- `apps/game/src-tauri/src/game/save/restore.rs`
- `apps/game/src-tauri/src/game/save/coordinator/mod.rs`
- `apps/game/src-tauri/src/game/e2e_checkpoints.rs`
- `apps/game/src-tauri/src/lib.rs`

### Normally do not modify

- immutable Analysis serde in `schema.rs`;
- Analysis origin variants/resolver in `dialogue_queue.rs`;
- compiler Analysis parser/validator/emitter/reachability;
- shared scene types.

The only expected `dialogue_queue.rs` cleanup is deleting `DialogueSegmentOriginV1::is_analysis()` if HPA-260 removes its last temporary save-guard caller.

---

## Task 1 — Persist qualified completion and evaluate StoryUnlockExpr

**Produces:** one durable Analysis completion authority plus the missing runtime evaluator for HPA-259's story-only board unlock wire.

### 1A. Tests first

Add failing tests covering:

- `analysis_board_completion_is_qualified_idempotent_and_snapshot_backed`;
- `analysis_scene_completion_is_qualified_idempotent_and_snapshot_backed`;
- `analysis_completion_rejects_unknown_catalog_refs_without_mutation`;
- `analysis_board_origin_is_persistable_only_for_catalog_board`;
- `analysis_unlock_context_reads_persisted_completion_sets`;
- `story_unlock_expr_evaluates_leaf_combinator_and_at_least_variants`.

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_completion
cargo test --manifest-path apps/game/src-tauri/Cargo.toml story_unlock
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_board_origin
```

Expected initial failure: mutable completion does not exist, Analysis origin persistence is still fail-closed, and `StoryUnlockExpr` has no runtime evaluator.

### 1B. Reuse HPA-259 qualified ref types

HPA-259 already added `AnalysisSceneRef` and `AnalysisBoardRef` privately in `story/catalog.rs` for package membership.

Do **not** define duplicate completion-ref structs.

- widen those two types only enough for sibling `story` modules to reuse them;
- derive `Serialize` in addition to their existing ordering/deserialization traits;
- expose fields/constructors only at the narrowest `story` visibility required.

Add to `StoryState` + current `StoryStateSnapshot`:

```rust
completed_analysis_scenes: BTreeSet<AnalysisSceneRef>,
completed_analysis_boards: BTreeSet<AnalysisBoardRef>,
```

### 1C. Completion mutations

Add idempotent package-validated mutations, e.g. string-parameter façades so callers do not need catalog internals:

```rust
complete_analysis_board(catalog, chapter_id, scene_id, board_id)
complete_analysis_scene(catalog, chapter_id, scene_id)
```

Return existing `MutationOutcome::{Changed, Unchanged}`.

Make `StoryUnlockContext` read these sets instead of returning `false`.

### 1D. Analysis assertion origin

Change `AssertionOrigin::ensure_origin_kind_is_persistable` to validate `AnalysisBoard` through merged `StoryCatalog::has_analysis_board`.

Update every existing call site:

- `StoryState::assert_fact`;
- `StoryState::grant_authorization` even though Analysis compiler output currently forbids this target;
- StoryState snapshot validation.

Keep `StoryEvent` origin fail-closed.

### 1E. StoryUnlockExpr evaluator

In `unlock.rs`, add one direct recursive evaluator:

```rust
pub fn evaluate_story(
    expr: &StoryUnlockExpr,
    story: &dyn StoryUnlockContext,
) -> bool
```

Reuse existing `evaluate_at_least` and direct-match the merged variants. Do not refactor the three expression families into a generic visitor.

### Verify

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml story::
cargo test --manifest-path apps/game/src-tauri/Cargo.toml unlock::
```

### Commit

```bash
git add apps/game/src-tauri/src/game/story apps/game/src-tauri/src/game/unlock.rs
git commit -m "feat(game): persist analysis completion and unlocks"
```

---

## Task 2 — Add one Analysis scene module with shared typed drafts

**Produces:** mutable state/input/save types and pure direct evaluation with no engine side effects.

### 2A. Tests first

Create `scenes/analysis.rs` with table-driven tests.

#### Classify

- empty/partial assignment is valid;
- unknown card rejected;
- unknown group rejected;
- complete iff every displayed card assigned once;
- correct iff complete map equals `accepted_group_by_card`.

#### Order

- empty/partial unique permutation is valid;
- unknown/duplicate card rejected;
- included fixed-anchor card must occupy authored one-based position;
- complete iff every displayed card appears once;
- correct iff vector equals `accepted_order`.

#### Threshold

- empty/partial displayed-card selection is valid;
- unknown/duplicate input IDs rejected at deserialization/validation as applicable;
- completeness uses `minimum_selected`;
- correctness compares sorted selected IDs with `accepted_selections`;
- no source-group/status/capability logic exists in evaluator.

#### Serialization

- draft JSON contains no `accepted*` key;
- feedback serializes only `incomplete` / `incorrect`;
- no separate `AnalysisDraftSnapshot` conversion is required.

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml scenes::analysis
```

### 2B. Shared types — no duplicate DTO

Use one serde enum for command input, runtime state, and save snapshot:

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
```

Do not create `AnalysisDraftInput` and `AnalysisDraftSnapshot` siblings unless a concrete serde/runtime mismatch is discovered.

### 2C. AnalysisSceneState

Follow current investigation/interrogation queue ownership:

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

`from_json` initializes one empty correctly typed draft for every authored board. It does not evaluate availability because navigation construction does not own `StoryState`; the engine refreshes availability during scene priming.

Add `id()` / `title()` helpers and board lookup helpers based on merged `board.common()`.

### 2D. Pure availability helper

Given `StoryState`, derive the currently available board set:

- `None` unlock -> available;
- `Some(StoryUnlockExpr)` -> `unlock::evaluate_story`;
- iterate authored board order;
- no inventory/local context;
- no sequential hardcode.

Runtime refresh unions/validates monotonically rather than inventing overrides.

### Commit

```bash
git add apps/game/src-tauri/src/game/scenes/analysis.rs apps/game/src-tauri/src/game/scenes/mod.rs
git commit -m "feat(game): add analysis mutable state and drafts"
```

---

## Task 3 — Replace navigation fail-closed and run the existing dialogue lifecycle

**Produces:** playable Analysis scene entry/result/outro without duplicating HPA-259 dialogue infrastructure.

### 3A. Tests first

Add lifecycle tests:

- loading Analysis no longer returns `unsupportedSceneType`;
- `SceneRuntime::Analysis` keeps the merged scene id/title;
- scene priming evaluates initial `StoryUnlockExpr` availability;
- no-unlock first board becomes available;
- intro uses existing `AnalysisIntro` origin;
- empty intro exposes workbench immediately;
- first available incomplete board is auto-focused in authored order;
- a non-sequential test unlock proves runtime does not assume previous-board chaining;
- merged result/outro origin resolver continues to resolve packaged dialogue.

### 3B. SceneRuntime

Add `SceneRuntime::Analysis(AnalysisSceneState)` and update exhaustive matches for:

- id/title;
- current dialogue item;
- scene title;
- SceneTag consumption/queue advance;
- queue installation/removal;
- current queue token;
- view/mode routing;
- rollback snapshot cloning (normally automatic through SceneRuntime clone).

Use code search/compiler errors to find exhaustive matches; do not perform unrelated refactors.

### 3C. Navigation

In merged `navigation.rs`, replace only:

```text
SceneJson::Analysis(_) -> unsupportedSceneType("analysis")
```

with construction of `AnalysisSceneState::from_json(def, queue_gen)`.

Preserve `scene_runtime_from_json -> Result<SceneRuntime, GameError>` and the transactional jump/advance behavior introduced by HPA-259.

Extend `prime_initial_queue_for_command`:

1. refresh Analysis availability from current `StoryState`;
2. if non-empty unplayed intro exists, create a `DialogueSegment` with already-existing `AnalysisIntro` origin and `intro_queue_gen`;
3. otherwise mark intro consumed and choose first available incomplete board.

Do not edit immutable Analysis origin definitions or origin resolver.

### 3D. Queue exhaustion

Extend existing `on_queue_exhausted` orchestration for Analysis:

- intro drained -> workbench + first available incomplete board;
- board result drained -> next available incomplete board if any;
- all boards complete -> install existing `AnalysisOutro` origin;
- outro drained -> mark qualified scene complete and call existing `advance_scene` exactly once.

Use existing queue/history/SceneTag machinery.

### Verify

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_navigation
cargo test --manifest-path apps/game/src-tauri/Cargo.toml dialogue
```

### Commit

```bash
git add apps/game/src-tauri/src/game/scenes apps/game/src-tauri/src/game/navigation.rs apps/game/src-tauri/src/game/dialogue.rs apps/game/src-tauri/src/game/mod.rs
git commit -m "feat(game): run analysis scene lifecycle"
```

---

## Task 4 — Implement select/update/submit through command_tx

**Produces:** actual Beat 8.5 workbench state machine and atomic accepted resolution.

### 4A. Tests first

Add engine tests:

- `analysis_selects_any_available_board`;
- `analysis_reopens_completed_board_read_only`;
- `analysis_updates_partial_classify_order_threshold_drafts`;
- `analysis_rejects_stale_revision_without_mutation`;
- `analysis_rejects_scene_or_active_board_token_mismatch_without_mutation`;
- `analysis_incomplete_submit_sets_feedback_only`;
- `analysis_wrong_submit_sets_incorrect_feedback_only`;
- `analysis_correct_submit_commits_completion_reveals_and_result_once`;
- `analysis_reveal_failure_rolls_back_scene_story_dialogue_and_revision`;
- `analysis_repeated_submit_cannot_replay_effects_or_dialogue`;
- `analysis_correct_submit_refreshes_story_unlock_availability`;
- `analysis_final_board_waits_for_result_and_outro_before_scene_advance`.

### 4B. Action token

Expose:

```rust
AnalysisActionToken {
    scene_id: String,
    active_board_id: Option<String>,
    durable_revision: u64,
}
```

Validate before mutation:

1. current scene is Analysis;
2. scene id matches;
3. durable revision matches;
4. active board matches;
5. target operation is valid for availability/completion.

Do not add an Analysis-owned session counter. Existing `AppSession` generation remains the application replacement fence; existing `QueueToken` remains dialogue continuation fencing.

### 4C. Select

Inside `command_tx`:

- validate requested board exists and is in current available set;
- permit completed boards;
- mutate only `active_board_id`;
- return `Unchanged` when selecting current board;
- no story effects/queue.

### 4D. Update

Inside `command_tx`:

- require an incomplete active board;
- validate the submitted shared `AnalysisDraft` kind/IDs against active merged definition;
- replace whole draft;
- clear prior failure feedback;
- no story output/queue.

### 4E. Submit

Inside one `command_tx`:

Incomplete:

- set `Incomplete`;
- preserve draft;
- no story effects/queue.

Complete wrong:

- set `Incorrect`;
- preserve draft;
- no story effects/queue.

Correct:

1. preserve final draft;
2. `complete_analysis_board` in StoryState;
3. call existing `apply_story_reveals` using:

```rust
AssertionOrigin::AnalysisBoard { chapter_id, scene_id, board_id }
FactSupport = empty
represented_authority = None
```

4. refresh available board IDs through `evaluate_story`;
5. clear stale failure feedback;
6. install a segment with already-merged `AnalysisResult` origin + packaged `result_dialogue`.

HPA-259 guarantees Analysis reveals are story-only and forbids authorization grants. Do not invoke acquisition APIs.

Inject an invalid story reveal only in a unit fixture to prove rollback; do not add production failpoints.

### Review checkpoint A

Reject the branch here if it contains:

- a second rollback snapshot;
- a second story-reveal executor;
- a generic board evaluator registry;
- Rust provenance re-evaluation;
- completed IDs duplicated in scene progress;
- accepted feedback state;
- acquisition acknowledgement changes;
- custom Analysis dialogue origins/resolver.

### Commit

```bash
git add apps/game/src-tauri/src/game/scenes/analysis.rs apps/game/src-tauri/src/game/mod.rs apps/game/src-tauri/src/game/story apps/game/src-tauri/src/game/reveals.rs apps/game/src-tauri/src/game/error.rs
git commit -m "feat(game): add atomic analysis workbench commands"
```

---

## Task 5 — Add answer-key-free views and Tauri wire

**Produces:** stable backend contract for HPA-261 without implementing Svelte.

### 5A. Tests first

Add JSON projection tests proving:

- `ModeView::Analysis` exposes current background/audio and action token;
- `SceneView::Analysis` exposes active/available/completed/read-only board state;
- cards expose public source refs, labels, summaries;
- classify exposes groups but no accepted map;
- order exposes fixed anchors but no accepted order;
- threshold exposes `minimumSelected` but no accepted selections/provenance constraints;
- current shared `AnalysisDraft` is projected;
- feedback kind is only incomplete/incorrect;
- authored visible copy/hint comes from immutable definition;
- serialized `GameStateView` contains no `acceptedGroupByCard`, `acceptedOrder`, or `acceptedSelections`.

### 5B. Public types

Add focused view structs in `view.rs`; do not serialize immutable Analysis serde directly.

Completed/read-only comes from StoryState completion, not `AnalysisFeedbackState`.

### 5C. Tauri commands

Add/register:

```text
select_analysis_board
update_analysis_draft
submit_analysis_board
```

Use existing `advance_dialogue` for intro/result/outro continuation.

Each workbench command will later use the thumbnail-free autosave policy from Task 7; until then wire tests may call a test policy/helper or Task 7 can be implemented immediately after Task 6 before final command integration.

### Commit

```bash
git add apps/game/src-tauri/src/game/view.rs apps/game/src-tauri/src/game/error.rs apps/game/src-tauri/src/lib.rs
git commit -m "feat(tauri): expose analysis workbench commands"
```

---

## Task 6 — Add exact Analysis save/restore and retire HPA-259 temporary guards

**Produces:** current-format exact draft/completion/dialogue resume with no migration and no duplicate Analysis DTO.

### 6A. Save shape

Use the shared runtime serde types directly:

```rust
SceneProgressSnapshot::Analysis {
    intro_played: bool,
    outro_played: bool,
    available_board_ids: BTreeSet<String>,
    active_board_id: Option<String>,
    drafts: BTreeMap<String, AnalysisDraft>,
    feedback_by_board_id: BTreeMap<String, AnalysisFeedbackState>,
}
```

Do not create `AnalysisDraftSnapshot` or another Analysis progress family.

Completion lives only in the Task 1 `StoryStateSnapshot` sets.

### 6B. Tests first

Add failing tests:

- `analysis_snapshot_round_trips_partial_classify`;
- `analysis_snapshot_round_trips_partial_order`;
- `analysis_snapshot_round_trips_partial_threshold`;
- `analysis_snapshot_round_trips_incomplete_and_incorrect_feedback`;
- `analysis_snapshot_round_trips_completed_read_only_board`;
- `analysis_snapshot_round_trips_mid_result_dialogue_cursor`;
- `analysis_restore_rejects_unknown_board_card_group_or_draft_kind`;
- `analysis_restore_rejects_invalid_fixed_anchor_or_duplicate_ids`;
- `analysis_restore_rejects_unknown_completion_refs`;
- `analysis_restore_rejects_availability_drift`;
- `analysis_restore_failure_leaves_live_session_untouched`;
- `analysis_recapture_matches_exact_saved_snapshot`;
- `analysis_save_json_contains_no_answer_keys_or_authored_copy`;
- `analysis_scene_asset_refs_participate_in_restore_definition_validation`.

### 6C. Capture

Extend exhaustive capture matches for `SceneRuntime::Analysis`.

Capture:

- intro/outro consumed flags;
- exact available set;
- exact active board;
- shared draft map;
- failure feedback map;
- active dialogue through existing `ActiveDialogueStateV1`;
- StoryState completion through its existing snapshot.

Remove HPA-259's temporary capture rejection for `DialogueSegmentOriginV1::is_analysis()`.

### 6D. Restore

Replace HPA-259's temporary:

```text
(SceneJson::Analysis(_), _) -> invalidSaveProgress
```

with real definition-backed reconstruction.

Restore rules:

- require `SceneJson::Analysis` + `SceneProgressSnapshot::Analysis` pairing;
- rebuild `AnalysisSceneState` from packaged definition;
- validate exact authored board/draft key set and draft kinds;
- validate mutable IDs/anchors using the same Analysis helpers as commands;
- validate completion refs through StoryCatalog;
- derive current availability with `evaluate_story` and require exact equality with saved `available_board_ids`;
- require active board to be available when present;
- allow completed board as active read-only;
- restore feedback only for known boards using closed enum;
- restore intro/result/outro dialogue using the already-merged resolver/cursor validation;
- exact recapture before live session replacement.

Remove HPA-259's `restore_active_queue` blanket Analysis-origin rejection.

### 6E. Asset/manifests cleanup

In merged `save/restore.rs`:

- keep `evidence_manifest(SceneJson::Analysis(_)) -> &[]`;
- keep `statement_manifest(SceneJson::Analysis(_)) -> &[]`;
- change `scene_asset_refs(SceneJson::Analysis(scene))` from `&[]` to `&scene.asset_refs`.

After capture/restore guards are removed, delete `DialogueSegmentOriginV1::is_analysis()` if no caller remains.

Keep current `SAVE_SCHEMA_VERSION`; no migration/adapter.

### Verify

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_snapshot
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_restore
cargo test --manifest-path apps/game/src-tauri/Cargo.toml save::
```

### Commit

```bash
git add apps/game/src-tauri/src/game/save apps/game/src-tauri/src/game/dialogue_queue.rs apps/game/src-tauri/src/game/story
# dialogue_queue.rs only if is_analysis becomes dead
git commit -m "feat(save): persist exact analysis progress"
```

---

## Task 7 — Reuse debounce without Analysis thumbnail tickets

**Produces:** authoritative frequent draft persistence without save-thumbnail churn or another persistence state machine.

### 7A. Behavior test first

Add a coordinator/application test proving:

```text
50 Analysis workbench mutations within AUTOSAVE_DEBOUNCE
-> 50 durable revisions
-> 0 thumbnail requests/tickets/activity transitions
-> 1 trailing autosave write
-> written revision == newest committed revision
```

Also prove Analysis Tauri command responses return `thumbnailCapture: null`.

### 7B. Minimal persistence policy

Add:

```rust
MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail
```

Extend `run_gameplay_mutation` with the smallest branch needed to notify the coordinator of a committed revision without producing a thumbnail request.

Add one coordinator entry point, e.g.:

```rust
notify_committed_without_thumbnail(...)
```

It must reuse:

- existing session generation checks;
- existing trailing debounce serial/timer;
- existing autosave target/write path;
- existing failure/health publication.

Represent thumbnail as unavailable for that autosave without allocating a capture ticket.

Do not add:

- Analysis-specific queue/timer/worker;
- another generation counter;
- another write backend;
- acknowledgement-specific branches.

If the implementation requires broad coordinator changes beyond one narrow path, stop and add measured evidence to HPA-521.

### 7C. Apply policy

Use thumbnail-free autosave for:

- select Analysis board;
- update Analysis draft;
- submit Analysis board.

Keep `advance_dialogue` on its existing ordinary persistence policy because dialogue is low-frequency and already integrated.

### Commit

```bash
git add apps/game/src-tauri/src/game/save/coordinator apps/game/src-tauri/src/lib.rs
git commit -m "feat(save): debounce analysis progress without thumbnails"
```

---

## Task 8 — Deterministic Beat 8.5 checkpoints and end-to-end acceptance

**Produces:** stable deep-state development entry points and a final real-wire acceptance flow without production content insertion.

### 8A. Reuse the existing HPA-259 definition

Use:

```text
apps/game/src-tauri/src/game/test_fixtures/analysis_scene_8_5.json
```

and the corresponding HPA-259 compiler fixture/case-record/story-catalog data.

Do not duplicate the board definitions in another Rust JSON/string fixture. Add only the minimum resource-bundle plumbing required to run the existing fixture through GameEngine.

### 8B. Checkpoints

Add:

```text
chapter-1-analysis-classify-partial
chapter-1-analysis-order-partial
chapter-1-analysis-threshold-partial
chapter-1-analysis-result-dialogue
```

Checkpoint construction must use public engine commands after fixture setup, not direct field mutation.

Projection may include only:

- active board ID;
- completed board IDs;
- current public draft;
- optional incomplete/incorrect feedback kind;
- dialogue origin/cursor when relevant;
- durable revision.

No hidden answers/provenance.

### 8C. Integration flow

Implement one acceptance flow:

```text
enter Analysis
-> drain intro
-> partial classify edit
-> explicit capture/save
-> detached restore
-> finish classify
-> drain result
-> finish order
-> drain result
-> wrong threshold
-> correct threshold
-> capture mid-result dialogue
-> detached restore at exact cursor
-> drain final result
-> drain outro
-> advance exactly once
```

Assert:

- exact expected StoryState facts/objective effects from merged fixture;
- qualified completed board refs;
- qualified completed scene ref only after outro;
- read-only reopen behavior;
- exact durable revision progression;
- no replay after accepted board;
- no answer keys in checkpoint/public/save JSON.

### Review checkpoint B

Inspect complete diff for:

- schema/compiler work that HPA-259 already owns;
- duplicate Analysis ref/draft/snapshot types;
- duplicate dialogue origin/resolver code;
- duplicate completion truth;
- provenance reimplementation;
- Analysis-specific persistence machinery;
- accidental acquisition/authorization support;
- accidental Svelte/Chapter 2/production-content scope;
- answer-key leakage;
- direct state mutation outside `command_tx`.

### Commit

```bash
git add apps/game/src-tauri/src/game/e2e_checkpoints.rs apps/game/src-tauri/tests apps/game/src-tauri/src/game/test_support.rs
git commit -m "test(game): accept Chapter 1 analysis runtime"
```

---

## Final verification

Focused during development:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml story_unlock
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_completion
cargo test --manifest-path apps/game/src-tauri/Cargo.toml scenes::analysis
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_navigation
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_snapshot
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_restore
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis_autosave
cargo test --manifest-path apps/game/src-tauri/Cargo.toml e2e_checkpoints --features e2e
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

Expected: no hidden-answer field is serialized by public/save/frontend code. References are allowed only in immutable schema/evaluator/tests that directly verify hidden-answer isolation.

Also search for obsolete pre-HPA-260 guards:

```bash
rg -n "before HPA-260|is_analysis\(\)|unsupported_scene_type\(\"analysis\"\)" \
  apps/game/src-tauri/src/game
```

Expected after implementation: no runtime/capture/restore fail-closed Analysis guard remains; only historical test/doc text may mention the old state.

---

## Definition of done

- [ ] HPA-259's actual checked-in Beat 8.5 fixture runs through Rust without chapter-specific evaluator logic.
- [ ] `StoryUnlockExpr` is evaluated directly against `StoryState` with no second rule engine.
- [ ] Package-qualified completion persists once and drives existing Analysis predicates.
- [ ] HPA-259 catalog ref types are reused rather than duplicated for completion snapshots.
- [ ] One shared `AnalysisDraft` serde type serves command/runtime/save needs.
- [ ] Available board IDs, active board, drafts, failure feedback, and dialogue cursor round-trip exactly.
- [ ] Completed boards reopen read-only.
- [ ] Stale/malformed workbench actions do not consume a durable revision or mutate state.
- [ ] Incomplete/wrong submissions preserve drafts and apply no story outputs.
- [ ] Correct submit atomically commits final draft, board completion, story reveals, availability refresh, and ordered result dialogue.
- [ ] Failed story/queue work restores the complete pre-command engine state.
- [ ] Repeated submit cannot replay effects/dialogue.
- [ ] Existing HPA-259 Analysis origins/resolver/dialogue groups are reused unchanged.
- [ ] HPA-259's temporary navigation/capture/restore guards are retired.
- [ ] Analysis asset refs participate in restore validation.
- [ ] Public/save/checkpoint JSON contains no accepted solutions or threshold provenance constraints.
- [ ] Workbench mutations request no thumbnail and a realistic burst coalesces to one newest-revision autosave.
- [ ] No save migration, duplicate DTO family, generic puzzle system, acquisition extension, Svelte work, Chapter 2 support, or broad coordinator refactor is included.
