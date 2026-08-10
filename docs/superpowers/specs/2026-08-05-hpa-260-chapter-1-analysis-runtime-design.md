# HPA-260 Chapter 1 Analysis Runtime and Exact Draft Persistence Design

**Date:** 2026-08-09  
**Status:** Ready for implementation  
**Linear:** HPA-260  
**Baseline:** HPA-259 merged via PR #37; implementation seams re-reviewed against current `main`

## 1. Goal

Implement only the mutable Rust runtime still missing after HPA-259 for the Chapter 1 Analysis vertical slice:

- run the merged `classify`, `order`, and `threshold` definitions;
- keep Rust authoritative for availability, active-board selection, drafts, evaluation, completion, story effects, and dialogue lifecycle;
- preserve unfinished drafts and mid-result dialogue exactly through the current pre-release save format;
- expose an answer-key-free backend contract for HPA-261;
- persist high-frequency workbench mutations through the existing trailing autosave debounce without asking the frontend to capture thumbnails.

This is a Chapter 1 vertical slice, not a generic puzzle framework.

## 2. Merged HPA-259 baseline

HPA-260 reuses the merged implementation. HPA-259 already owns:

- `SceneType::Analysis` and `SceneJson::Analysis`;
- immutable `AnalysisSceneJson` / `AnalysisBoardJson` Rust serde;
- `AnalysisBoardJsonCommon` and `board.common()`;
- hidden normalized `acceptedGroupByCard`, `acceptedOrder`, and `acceptedSelections`;
- compiler-owned threshold provenance semantics and satisfiability;
- authored incomplete/incorrect feedback and optional static hint;
- story-only `StoryUnlockExpr`;
- `DialogueSegmentOriginV1::{AnalysisIntro, AnalysisResult, AnalysisOutro}`;
- packaged Analysis dialogue-origin resolution and dialogue-group enumeration;
- qualified Analysis refs in `StoryCatalog`;
- loader validation for Analysis unlocks and reveal targets;
- `apps/game/src-tauri/src/game/test_fixtures/analysis_scene_8_5.json`;
- intentional pre-HPA-260 navigation/capture/restore fail-closed behavior.

HPA-260 must not recreate compiler/schema/origin/resolver work.

## 3. Ownership and YAGNI boundary

### Compiler/package owns

- authored definitions and diagnostics;
- immutable cards/groups/source refs;
- accepted answers and fixed-anchor validation;
- threshold source/procedure/capability semantics;
- static reachability and package reference validation;
- Analysis dialogue origins/resolution;
- qualified package membership.

### Runtime owns

- current available board set, derived from package + `StoryState`;
- active board;
- one typed mutable draft per board;
- mutable draft validation and direct normalized-answer comparison;
- `Incomplete | Incorrect` failure feedback;
- qualified board/scene completion;
- atomic story effects;
- intro/result/outro sequencing;
- stale workbench action rejection;
- exact save/restore of authoritative mutable state;
- answer-key-free public projection.

### Do not add

- a generic puzzle/evaluator/plugin system;
- a Rust provenance solver;
- classify/order/threshold sub-frameworks;
- another rollback snapshot or reveal executor;
- another Analysis dialogue-origin system;
- an Analysis-specific persistence service;
- save migrations/versioned sibling DTOs;
- duplicate command/runtime/save draft DTOs;
- hint history;
- case-analysis evidence acquisition or authorization granting;
- Chapter 2 or Svelte implementation in HPA-260.

## 4. Existing seams to reuse

| Concern | Existing owner |
|---|---|
| Atomic mutation | `GameEngine::command_tx` |
| Rollback | `EngineRollbackSnapshot` |
| Story effects | `apply_story_reveal` / `apply_story_reveals` |
| Story predicates | `StoryUnlockContext` |
| Analysis unlock wire | merged `StoryUnlockExpr` |
| Dialogue origin/resolution | merged HPA-259 `dialogue_queue.rs` |
| Package membership | merged `StoryCatalog` |
| Navigation | `navigation.rs` |
| Capture/restore | current save modules |
| Autosave | current `SaveCoordinator` debounce/write path |
| Runtime test definition | merged `analysis_scene_8_5.json` fixture |

## 5. Qualified completion and origin persistence

Reuse HPA-259's existing qualified `AnalysisSceneRef` and `AnalysisBoardRef` shapes from `story/catalog.rs`. Widen visibility only inside the `story` module and add serialization support as required.

`StoryState` / current `StoryStateSnapshot` gain:

```rust
completed_analysis_scenes: BTreeSet<AnalysisSceneRef>,
completed_analysis_boards: BTreeSet<AnalysisBoardRef>,
```

These sets are the only accepted/completion truth. Do not duplicate completion IDs in scene progress and do not persist an `Accepted` feedback state.

### 5.1 Catalog-aware origin persistability

Current `AssertionOrigin::ensure_origin_kind_is_persistable()` has no catalog, but `AnalysisBoard` persistence depends on package membership. Change the existing API once:

```rust
ensure_origin_kind_is_persistable(
    &self,
    catalog: &StoryCatalog,
) -> Result<(), String>
```

Contract:

- `AnalysisBoard` succeeds only if `catalog.has_analysis_board(chapter_id, scene_id, board_id)`;
- `StoryEvent` remains fail-closed;
- current durable origin kinds keep their existing behavior.

Pass the catalog through every live mutation and snapshot-validation call site. Never allow an Analysis assertion to succeed live but fail only during restore.

### 5.2 Test catalog support

Task 1 must extend `game/test_support.rs` with one small Analysis-aware story-catalog helper. Do not duplicate a whole fixture stack and do not break every existing neutral-catalog call site merely to add Analysis arrays.

The helper must be able to build a catalog where `has_analysis_scene` / `has_analysis_board` genuinely return true so origin-persistence tests exercise package membership rather than mocks.

## 6. StoryUnlockExpr runtime semantics

Add one direct evaluator in `unlock.rs`:

```rust
pub fn evaluate_story(
    expr: &StoryUnlockExpr,
    story: &dyn StoryUnlockContext,
) -> bool;
```

Direct-match the closed story-only variants and reuse the existing `evaluate_at_least` helper. Do not introduce a generic expression visitor.

### 6.1 Pin semantics in the shared corpus

`evaluate_story` becomes another implementation of the same positive `and` / `or` / `at_least` semantics used by compiler-side reachability. Extend:

```text
packages/shared/fixtures/unlock-expression-semantics.json
```

with a `story` family using only legal story predicates/counts, and update both existing fixture consumers:

- Rust `game/unlock.rs` tests;
- TypeScript `packages/scripts/compile-scenes/parser-unlock.test.ts` semantic evaluator.

This is test-contract reuse, not a new compiler feature. HPA-260 does not change parser acceptance rules; invalid `at_least(0, ...)` remains rejected by the parser.

## 7. Shared Analysis value types

Keep save-facing shared values in neutral:

```text
apps/game/src-tauri/src/game/analysis.rs
```

not `scenes/analysis.rs`.

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

`scenes/analysis.rs`, `view.rs`, `save/schema.rs`, and Tauri command input reuse these types. `save/schema.rs` must not depend on a runtime scene module.

Do not add `AnalysisDraftInput` / `AnalysisDraftSnapshot` siblings unless implementation proves a real wire mismatch.

## 8. AnalysisSceneState

Follow investigation/interrogation queue ownership:

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

Initialize one empty correctly typed draft for every authored board. `available_board_ids` is runtime cache/state only; it is not persisted.

## 9. Availability is derived, not saved

For each authored board:

- no unlock -> available;
- authored `StoryUnlockExpr` -> `evaluate_story(unlock, StoryState)`;
- completed boards remain available/read-only because allowed story predicates are monotonic;
- auto-focus uses authored order only to pick the first available incomplete board;
- after correct submit, recompute only after completion and reveals commit;
- never hardcode previous-board sequencing.

Live refresh assigns the recomputed set directly. Do not union an old set and do not add availability overrides.

Because both inputs to availability — packaged definitions and restored `StoryState` — already exist during restore, **do not persist `available_board_ids`**. Restore recomputes it and validates only that `active_board_id`, if present, is currently available.

This removes duplicate state and a save-only drift failure mode while preserving exact authoritative resume.

## 10. Direct draft evaluation

### Classify

- referenced cards/groups must exist;
- partial map is valid;
- complete when every displayed card is assigned;
- correct only when complete map equals `acceptedGroupByCard`.

### Order

- IDs must be displayed and unique;
- partial permutation is valid;
- included fixed-anchor cards must occupy authored one-based positions;
- complete when every displayed card appears once;
- correct only when vector equals `acceptedOrder`.

### Threshold

- selected IDs must be displayed and unique;
- complete when selected count reaches `minimumSelected`;
- correct only when normalized selected IDs match one emitted `acceptedSelections` entry.

Rust must not reconstruct source-group/status/capability/satisfiability rules or the compiler's six-card materialization budget.

## 11. Workbench commands and action token

Keep the small command surface:

```text
select_analysis_board
update_analysis_draft
submit_analysis_board
```

`update_analysis_draft` replaces the whole typed draft. Do **not** fan this into three board-kind-specific Tauri commands in HPA-260; that would expand the public command surface and validation paths without reducing the first-version backend work.

The current frontend dispatcher already enforces one gameplay command in flight via `gameState.inFlight`, so the action token does not introduce a new IPC serialization requirement. It remains a narrow server-side stale-state fence for the whole-draft command and board switches.

The reviewer-proposed delta-command rewrite is intentionally not adopted in HPA-260: with the existing serialized dispatcher, its main lost-update premise does not apply to normal application traffic, while three board-kind-specific update commands would add more wire/tests. If later HPA-261 playtesting proves the existing one-command-in-flight UI behavior is too restrictive, fix that interaction policy in the UI layer rather than pre-expanding the Rust command API.

Every Analysis view projects:

```rust
AnalysisActionToken {
    scene_id,
    active_board_id,
    durable_revision,
}
```

The frontend echoes it unchanged. It is a fence, not a write instruction.

Any scene/active-board/revision mismatch returns the locked typed error:

```text
staleAnalysisAction
```

before mutation, with no revision bump and no persistence scheduling.

Existing `AppSession` generation remains the whole-session replacement fence; `QueueToken` remains dialogue fencing.

### Select

- target board must exist and be currently available;
- completed boards may reopen read-only;
- mutate only active selection;
- selecting current board is `Unchanged`.

### Update

- require incomplete active board;
- validate draft kind/IDs against the active definition;
- replace whole shared draft;
- clear prior failure feedback;
- identical draft is `Unchanged`.

### Submit

Incomplete:

- set `Incomplete`;
- preserve draft;
- no durable story output/dialogue.

Complete wrong:

- set `Incorrect`;
- preserve draft;
- no durable story output/dialogue.

Correct atomically:

1. preserve final draft;
2. mark qualified board complete;
3. run existing `apply_story_reveals` with `AssertionOrigin::AnalysisBoard`;
4. recompute runtime availability;
5. clear stale failure feedback;
6. install existing `AnalysisResult` origin/dialogue.

Any failure restores the pre-command `EngineRollbackSnapshot`. Completed boards are read-only, so accepted effects/dialogue cannot replay.

## 12. Story reveal integration

Merged HPA-259 case-analysis outputs are story-only and forbid `grantAuthorization`.

Reuse reveal materialization with:

```rust
origin: AssertionOrigin::AnalysisBoard { ... }
fact_support_by_id: empty
represented_authority: None
```

Do not invent per-fact support and do not call acquisition acknowledgement APIs.

## 13. Navigation and dialogue lifecycle

Replace only the temporary Analysis construction stop with `AnalysisSceneState::from_json(def, queue_gen)` and reuse HPA-259 origins/resolver.

Lifecycle:

1. construct Analysis scene;
2. prime by recomputing availability;
3. install authored intro if non-empty;
4. after intro, auto-focus first available incomplete board;
5. correct submit installs result only after atomic durable resolution;
6. after result, focus next available incomplete board;
7. when all boards complete, install authored outro;
8. after outro, persist qualified scene completion and advance exactly once.

### 13.1 Buildability while `SceneRuntime::Analysis` lands

Adding a new `SceneRuntime` variant may expose exhaustive matches outside the obvious scene/navigation files. Use compiler errors and code search to classify them.

Do not proactively add broad temporary implementations. If an exhaustive save/restore match truly must be touched before Task 6, add the smallest explicit fail-closed placeholder tagged for Task 6 removal. `command_tx` clones/restores `SceneRuntime` generically and should not gain Analysis-specific rollback logic.

Task 6 owns the real capture/restore implementation and must remove every temporary placeholder introduced solely for buildability.

## 14. Public view

Add focused `ModeView::Analysis` / `SceneView::Analysis` projections exposing:

- scene identity and visual/audio cue;
- active board and current action token;
- currently derived available/completed/read-only state;
- board kind/prompt/cards/groups/fixed anchors/`minimumSelected`;
- current draft;
- optional `Incomplete | Incorrect` feedback plus authored copy;
- optional static hint.

Never serialize accepted answers or compiler-only threshold constraints.

## 15. Exact persistence

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

No `available_board_ids` field is persisted.

Keep the current `SaveSnapshot` family and schema-generation policy. Pre-release local saves may break; no migration is added.

Completion stays only in `StoryStateSnapshot`. Active intro/result/outro origin/cursor stays in existing `activeDialogue`.

Restore:

- reconstructs from packaged Analysis definition;
- validates authored board/draft key set and draft kinds;
- validates mutable card/group/order/threshold IDs;
- validates completion refs through StoryCatalog;
- recomputes current availability from packaged `StoryUnlockExpr` + restored StoryState;
- requires active board, if any, to be in that recomputed set;
- allows completed active board read-only;
- validates feedback only for known boards;
- restores Analysis dialogue through the merged origin resolver/cursor checks;
- exact-recaptures before replacing the live session.

## 16. Complete temporary-guard retirement

HPA-260 must remove/replace every temporary pre-runtime stop:

- `navigation.rs` scene-construction `unsupported_scene_type("analysis")`;
- capture rejection of Analysis dialogue origins;
- restore/dialogue-side blanket Analysis-origin rejection;
- packaged Analysis `restore_scene` rejection;
- `scene_asset_refs(SceneJson::Analysis(_)) -> &[]` -> use packaged `analysis.asset_refs`;
- `DialogueSegmentOriginV1::is_analysis()` if no caller remains;
- tests whose only contract is "Analysis is unsupported before HPA-260";
- any buildability-only placeholder added while `SceneRuntime::Analysis` landed.

Keep Analysis evidence/statement manifests empty for normal case-analysis boards.

### Permanent exception

Do **not** remove this unrelated guard in `game/mod.rs`:

```rust
SceneType::Analysis => GameError::unsupported_scene_type("analysis")
```

inside inventory re-examination-origin construction. Analysis boards acquire no case records, so an inventory item cannot legitimately use an Analysis source scene. Final guard scans must name this as the expected permanent exception rather than trying to erase every textual Analysis/unsupported match.

## 17. High-frequency autosave: no frontend capture and no UI activity

Add:

```rust
MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail
```

The required behavior for a realistic Analysis burst is:

```text
50 rapid authoritative workbench mutations
-> 50 durable revision advances
-> every command result has thumbnailCapture: null
-> no frontend thumbnail capture work
-> coordinator thumbnail activity stays Idle throughout
-> no thumbnail activity publication occurs
-> no thumbnail-expiry task is spawned for these autosave intents
-> trailing debounce produces one autosave write at the newest revision
-> that autosave consumes an internal thumbnail terminal result of Unavailable
```

`ThumbnailActivityView::Unavailable` is user-visible in the current frontend, so the no-thumbnail path must **not** reuse `issue_thumbnail()` or `report_thumbnail_failure()` in a way that publishes `Capturing`/`Unavailable` activity.

The smallest acceptable coordinator extension is a private no-capture scheduling helper that, if a ticket record is still required by the existing wait/write path:

- creates/records it already terminal as `CaptureTerminalResult::Unavailable`;
- notifies ticket waiters;
- does not call `set_thumbnail_activity` / `publish_activity`;
- does not spawn an expiry task;
- preserves existing autosave supersession/debounce/write safety.

Internal terminal records are acceptable. User-visible thumbnail activity is not.

Retry/failure paths for these revisions must not later resurrect a frontend capture request or warning activity.

If this requires broad `PendingAutosave`/flush architecture changes rather than one narrow helper/path, record measured evidence on HPA-521 instead of adding Analysis-specific persistence machinery.

Explicit Save remains immediate/exact and may keep its normal thumbnail behavior.

## 18. Implementation ordering

The dependency order is:

1. completion/origin validation + `StoryUnlockExpr` semantics;
2. shared values + Analysis scene state/evaluator;
3. SceneRuntime/navigation/dialogue lifecycle;
4. atomic workbench commands;
5. answer-key-free Rust public views;
6. exact save/restore + complete temporary-guard retirement;
7. no-thumbnail autosave policy + Tauri command registration;
8. Rust integration acceptance.

The autosave burst test must run only after Analysis capture/restore is functional. Public Tauri workbench commands must not be registered earlier with ordinary `AutosaveIfAdvanced` as a temporary policy.

## 19. Acceptance strategy: Rust integration, not UI checkpoints

HPA-260 must **not** add the four proposed `CheckpointId` variants.

Current checkpoint construction starts from compiled production resources, while the three-board Analysis definition currently exists as a Rust test fixture rather than a production Chapter 1 scene. The existing checkpoint consumer is UI/Tauri-oriented, and HPA-260 deliberately ships no Svelte/production Beat 8.5 insertion.

Instead, build one Rust integration resource bundle using the existing `test_support.rs` temp-resource pattern (for example the `hpa_257_fixture_resources` style), reuse the checked-in `analysis_scene_8_5.json`, and drive state only through public engine commands.

Representative flow:

```text
enter Analysis
-> drain intro
-> partial classify
-> explicit capture + detached restore
-> finish classify + result
-> finish order + result
-> wrong threshold
-> correct threshold
-> capture mid-result + detached restore
-> drain result
-> drain outro
-> advance exactly once
```

Assert:

- exact drafts across restore;
- qualified completion and expected story outputs;
- read-only reopen;
- result/outro ordering;
- exact revision behavior;
- no replay;
- no answer keys in public/save JSON.

If deterministic packaged UI checkpoint entry points are still useful after the real Chapter 1 Analysis scene is authored, add them at the later production acceptance layer (HPA-266/HPA-516), where production resources and the UI consumer both exist. HPA-261 may continue using answer-key-free typed frontend fixtures meanwhile.

## 20. Latest review disposition

The latest implementation-seam review was adopted as follows:

1. **Thumbnail activity leak — accepted.** No-thumbnail autosave must keep activity Idle, publish no thumbnail activity, and spawn no expiry task.
2. **Task ordering — accepted.** Exact Analysis persistence now lands before autosave acceptance/Tauri registration. The review's broader claim that `command_tx` needs Analysis-specific variant work is not adopted; rollback stores `SceneRuntime` generically.
3. **HPA-260 packaged checkpoints — accepted with ownership correction.** They are removed from HPA-260, but not moved to HPA-261 as production checkpoints. HPA-261 owns typed frontend fixtures; HPA-266/HPA-516 may add packaged checkpoints after HPA-265 authors the production scene.
4. **Analysis-aware test catalog — accepted.** Task 1 explicitly extends `test_support.rs`.
5. **Persisted availability — accepted.** Derived availability is no longer in the save snapshot.
6. **Delta commands / delete action token — not adopted.** Current frontend mutation dispatch is already serialized by `gameState.inFlight`; three board-kind-specific mutation APIs would expand the wire/test surface. Keep whole-draft replacement + the existing three-field token, and lock the error code to `staleAnalysisAction`.
7. **Shared StoryUnlock semantics corpus — accepted.** Add a `story` family to the existing cross-language fixture.
8. **Permanent re-examination guard — accepted.** Final scans explicitly retain the inventory-source Analysis unsupported guard.

## 21. Risks and stop conditions

1. **Coordinator UI leakage:** no-thumbnail autosave must leave thumbnail activity Idle; a permanent preview-warning banner is a blocker.
2. **Save ordering:** do not test Analysis autosave before Analysis capture exists.
3. **Shared type placement:** do not make `save/schema.rs` import `scenes::analysis` and do not create duplicate draft DTOs.
4. **Origin asymmetry:** catalog-aware origin validation must land in live + restore paths together.
5. **Checkpoint scope:** do not build production-resource checkpoint infrastructure around a test-only Analysis scene.
6. **Abstraction drift:** no generic evaluator, puzzle registry, or Analysis persistence state machine.

## 22. Definition of done

- `SceneRuntime::Analysis` runs all three merged board kinds without chapter-specific evaluator branches.
- Qualified completion persists once in `StoryStateSnapshot`.
- `AssertionOrigin::AnalysisBoard` is catalog-validated symmetrically live and on restore.
- Story-only unlock semantics are pinned in the shared cross-language fixture.
- One neutral `AnalysisDraft` / `AnalysisFeedbackState` family serves command/runtime/save/view needs.
- Runtime availability is pure recomputation and is **not duplicated in save state**.
- Whole-draft updates remain atomic and stale-token mismatch uses `staleAnalysisAction`.
- Wrong submissions produce only `Incomplete | Incorrect` and no durable story outputs.
- Correct submit atomically commits final draft, completion, story reveals, availability recompute, and result dialogue.
- Completed boards reopen read-only; repeated submit cannot replay effects/dialogue.
- Analysis drafts and mid-result dialogue round-trip through current-format detached restore/exact recapture.
- Every temporary HPA-259 Analysis navigation/capture/restore/dialogue guard is retired; the inventory re-examination Analysis guard remains intentionally.
- Analysis asset refs participate in restore validation.
- Public/save JSON exposes no accepted answer/provenance solution data.
- Workbench autosave returns `thumbnailCapture: null`, leaves thumbnail activity Idle, and coalesces a burst to one newest-revision write.
- No UI checkpoint variants are added in HPA-260; one fixture-backed Rust integration flow proves the runtime slice.
- No save migration, generic puzzle framework, acquisition extension, Svelte work, Chapter 2 support, or broad coordinator refactor is introduced.
