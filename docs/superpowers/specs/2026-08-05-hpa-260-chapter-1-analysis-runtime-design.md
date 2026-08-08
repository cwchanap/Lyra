# HPA-260 Chapter 1 Analysis Runtime and Exact Draft Persistence Design

**Date:** 2026-08-07  
**Status:** Ready for implementation  
**Linear:** HPA-260  
**Baseline:** HPA-259 merged via PR #37; reviewed against current `main`

## 1. Goal

Implement only the mutable Rust runtime still missing after HPA-259 for the Chapter 1 Beat 8.5 Analysis scene:

- run the merged `classify`, `order`, and `threshold` boards;
- keep Rust authoritative for availability, selection, drafts, evaluation, completion, effects, and dialogue lifecycle;
- preserve unfinished drafts and mid-result dialogue exactly through the current save format;
- expose an answer-key-free backend contract for HPA-261;
- persist high-frequency workbench edits through the current trailing debounce without thumbnail churn.

This is a Chapter 1 vertical-slice runtime, not a generic puzzle framework.

## 2. Merged HPA-259 baseline

HPA-260 must reuse the actual upstream implementation. HPA-259 already provides:

- `SceneType::Analysis` and `SceneJson::Analysis`;
- strict immutable `AnalysisSceneJson` / `AnalysisBoardJson` Rust serde;
- nested `AnalysisBoardJsonCommon` exposed through `board.common()`;
- hidden normalized `acceptedGroupByCard`, `acceptedOrder`, and `acceptedSelections`;
- compiler-owned threshold provenance semantics and satisfiability;
- authored incomplete/incorrect feedback and optional static hint;
- story-only `StoryUnlockExpr`;
- `DialogueSegmentOriginV1::{AnalysisIntro, AnalysisResult, AnalysisOutro}`;
- Analysis dialogue-origin resolution against packaged definitions;
- Analysis dialogue-group enumeration;
- `StoryCatalog::has_analysis_scene` / `has_analysis_board`;
- loader validation for Analysis story unlocks and reveal targets;
- the checked-in Beat 8.5 fixture at `apps/game/src-tauri/src/game/test_fixtures/analysis_scene_8_5.json`;
- temporary navigation/capture/restore fail-closed branches until HPA-260 supplies mutable progress.

HPA-260 must not recreate any of those layers.

## 3. Ownership boundaries

### Compiler/package owns

- authored Markdown and diagnostics;
- immutable board/card/group/source definitions;
- accepted solutions;
- fixed-anchor validation;
- threshold source-group/status/capability interpretation;
- threshold satisfiability;
- story target/reference validation;
- static reachability;
- Analysis dialogue origin definitions and packaged resolution;
- qualified Analysis package membership.

### HPA-260 runtime owns

- available board IDs;
- active board;
- one typed mutable draft per authored board;
- mutable draft-shape validation;
- direct normalized-answer comparison;
- last failure feedback (`Incomplete | Incorrect`);
- qualified board/scene completion;
- atomic story effects;
- intro/result/outro runtime sequencing;
- stale workbench action rejection;
- exact capture/restore;
- public answer-key-free projection.

### Frontend receives

- presentation metadata;
- cards/groups/fixed anchors/minimum selection;
- availability/completion/read-only state;
- current draft;
- incomplete/incorrect feedback and authored visible copy;
- optional static hint;
- Analysis action token.

It never receives hidden accepted answers or compiler-only threshold provenance rules.

## 4. KISS constraints

Do not add:

- a generic evaluator/plugin/constraint engine;
- a Rust provenance solver;
- classify/order/threshold sub-frameworks;
- another rollback type;
- another reveal executor;
- another dialogue-origin/resolver system;
- an Analysis-specific persistence service;
- save migrations or versioned sibling DTOs;
- duplicate runtime/input/save Analysis DTOs when one serde type works;
- an Analysis-owned session generation;
- hint history/consumption state;
- Analysis evidence/statement acquisition output;
- Svelte, Chapter 2, or production Beat 8.5 content.

## 5. Existing seams to reuse

| Concern | Existing owner |
|---|---|
| Atomic mutation | `GameEngine::command_tx` |
| Rollback | `EngineRollbackSnapshot` |
| Story effects | `apply_story_reveal` / `apply_story_reveals` |
| Story predicate state | `StoryUnlockContext` |
| Analysis unlock wire | merged `StoryUnlockExpr` |
| Dialogue origins/resolver | merged HPA-259 `dialogue_queue.rs` |
| Dialogue groups/hash input | merged HPA-259 Analysis enumeration |
| Package membership | merged `StoryCatalog` |
| Navigation | `navigation.rs` |
| Capture/restore | current save modules |
| Autosave | current `SaveCoordinator` trailing debounce |
| Acceptance definition | merged `analysis_scene_8_5.json` fixture |

## 6. Qualified completion

HPA-259 already added qualified `AnalysisSceneRef` / `AnalysisBoardRef` types privately inside `story/catalog.rs`.

Reuse those exact shapes for completion rather than defining duplicate state-only refs. Widen visibility only inside the `story` module and add serialization support as needed.

`StoryState` / current `StoryStateSnapshot` gain:

```rust
completed_analysis_scenes: BTreeSet<AnalysisSceneRef>,
completed_analysis_boards: BTreeSet<AnalysisBoardRef>,
```

These sets are the only accepted/completion truth used by:

- `analysis_scene_completed`;
- `analysis_board_completed`;
- read-only board projection;
- scene-completion logic;
- save/restore.

Do not duplicate completed IDs in `SceneProgressSnapshot::Analysis` and do not persist `Accepted` feedback.

### AssertionOrigin::AnalysisBoard

The enum already exists but persistence is intentionally fail-closed. Change its persistability check to validate the qualified board through merged `StoryCatalog::has_analysis_board`.

Use the same package-backed check for live story mutations and snapshot restore. Keep unrelated `StoryEvent` origins fail-closed.

## 7. StoryUnlockExpr runtime evaluation

HPA-259 introduced a separate story-only `StoryUnlockExpr`; current `unlock.rs` does not evaluate it yet.

Add one direct function:

```rust
pub fn evaluate_story(
    expr: &StoryUnlockExpr,
    story: &dyn StoryUnlockContext,
) -> bool;
```

Match the merged closed variants and reuse existing `evaluate_at_least`.

Do not build a generic expression visitor. Analysis availability needs no local inventory unlock context.

## 8. AnalysisSceneState

Follow the existing investigation/interrogation queue ownership pattern:

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

`intro_queue_gen` reuses the existing scene-entry queue-generation model; do not add another counter.

Initialize one empty typed draft for every authored board. This avoids optional draft lifecycle branches and leaves one stable slot for partial/final state.

Use a single serde draft type for command input, runtime state, and save data:

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
```

Feedback is also one shared serde enum:

```rust
pub enum AnalysisFeedbackState {
    Incomplete,
    Incorrect,
}
```

No `AnalysisDraftInput`, `AnalysisDraftSnapshot`, `ConstraintMismatch`, or `Accepted` sibling is needed unless implementation exposes a concrete mismatch that cannot be solved cleanly with the shared type.

## 9. Availability

For each authored board:

- `unlock: None` -> available;
- otherwise `evaluate_story(unlock, StoryState)`;
- availability is monotonic because merged story predicates are monotonic;
- completed boards stay available/read-only;
- player may select any available board;
- auto-focus picks first available incomplete board in authored order;
- after correct submit, refresh only after board completion and story reveals have committed;
- never hardcode previous-board sequencing.

The Linear contract explicitly requires persisted `availableBoardIds`, so keep them despite being derivable. Treat them as an exact checkpoint of Rust-owned state, not another rule engine.

Restore must require the saved set to equal the set derived from current packaged `StoryUnlockExpr` + restored `StoryState`; do not silently normalize drift.

## 10. Draft evaluation

### Classify

Valid:

- referenced cards exist on active board;
- referenced groups exist;
- each card has at most one assignment;
- partial map allowed.

Complete when every displayed card is assigned.

Correct only when complete map equals `acceptedGroupByCard`.

### Order

Valid:

- IDs are displayed cards;
- IDs are unique;
- partial permutation allowed;
- every included fixed-anchor card sits at authored one-based position.

Complete when every displayed card appears once.

Correct only when vector equals `acceptedOrder`.

### Threshold

Valid:

- every selected ID is a displayed card;
- IDs are unique.

Complete when selected count reaches emitted `minimumSelected`.

Correct only when sorted selected IDs equal one emitted `acceptedSelections` entry.

The merged Rust wire intentionally contains no eligible-card/provenance constraints. Rust must not reconstruct source groups, procedural status, proof capabilities, satisfiability, or the compiler's six-card materialization budget.

## 11. Workbench commands

Use:

```text
select_analysis_board
update_analysis_draft
submit_analysis_board
```

Continue all dialogue through existing `advance_dialogue(QueueToken)`.

### Action token

```rust
pub struct AnalysisActionToken {
    pub scene_id: String,
    pub active_board_id: Option<String>,
    pub durable_revision: u64,
}
```

This fences stale same-session workbench actions. Existing `AppSession` generation remains the whole-session replacement fence; Analysis adds no session counter.

All workbench mutations use `command_tx`.

### Select

- reject unknown/unavailable board;
- permit completed board read-only review;
- mutate only active selection;
- no-op selection does not consume revision;
- no story/dialogue effect.

### Update

- require incomplete active board;
- validate/replace entire shared `AnalysisDraft`;
- clear old failure feedback;
- no-op replacement does not consume revision;
- use thumbnail-free autosave.

### Submit

Incomplete:

- store `Incomplete`;
- keep draft;
- no story/dialogue effect.

Complete wrong:

- store `Incorrect` for all board kinds;
- keep draft;
- no story/dialogue effect.

Correct, atomically:

1. preserve final draft;
2. mark qualified board complete;
3. run existing `apply_story_reveals` with `AssertionOrigin::AnalysisBoard`;
4. refresh available board IDs;
5. clear stale failure feedback;
6. install existing `AnalysisResult` origin with packaged result dialogue.

Any failure restores the pre-command engine snapshot. Completed boards are read-only, so repeated submit cannot replay effects/dialogue.

## 12. Story reveal integration

Merged HPA-259 Analysis boards emit only `StoryRevealTarget` and compiler validation forbids `grantAuthorization`.

Use existing reveal materialization with:

```rust
origin: AssertionOrigin::AnalysisBoard { ... }
fact_support_by_id: empty
represented_authority: None
```

HPA-259 emits no per-fact card-support map. Do not infer one.

Do not call evidence/statement acquisition or acknowledgement APIs.

## 13. Navigation and dialogue

Merged navigation already recognizes Analysis metadata but deliberately stops in `scene_runtime_from_json` with `unsupportedSceneType("analysis")`.

Replace that one stop with `AnalysisSceneState::from_json(def, queue_gen)` while preserving the current `Result` signature and navigation transaction.

Do not add Analysis dialogue origins, origin resolution, or dialogue-group enumeration; HPA-259 already owns them.

Lifecycle:

1. construct `AnalysisSceneState` with existing intro queue generation;
2. `prime_initial_queue_for_command` refreshes availability;
3. install authored intro using existing `AnalysisIntro`;
4. after intro drains, auto-focus first available incomplete board;
5. correct submit installs existing `AnalysisResult` only after durable resolution succeeds;
6. after result drains, auto-focus next available incomplete board;
7. when all boards complete, install existing `AnalysisOutro`;
8. after outro drains, persist qualified scene completion and advance exactly once.

Extend existing queue exhaust/current-item/SceneTag matches for `SceneRuntime::Analysis`; keep `pending_queue`, `QueueToken`, history, and queue installation ownership unchanged.

## 14. Public view

Add focused `ModeView::Analysis` / `SceneView::Analysis` projections.

Expose:

- scene identity/summary;
- current background/audio cue;
- active board/action token;
- available/completed/read-only state;
- board kind/prompt;
- card labels/summaries/public source refs;
- classify groups;
- order fixed anchors;
- threshold `minimumSelected`;
- current shared draft;
- optional failure feedback state + authored visible copy;
- optional static hint.

Never serialize hidden accepted answers or compiler-only threshold rules.

## 15. Exact persistence

Extend current `SceneProgressSnapshot` in place:

```rust
Analysis {
    intro_played: bool,
    outro_played: bool,
    available_board_ids: BTreeSet<String>,
    active_board_id: Option<String>,
    drafts: BTreeMap<String, AnalysisDraft>,
    feedback_by_board_id: BTreeMap<String, AnalysisFeedbackState>,
}
```

Reuse the shared runtime serde types; do not create save-only Analysis DTOs.

Keep current `SAVE_SCHEMA_VERSION` / `SaveSnapshot` family. Pre-release breaking saves may become invalid; no migration is added.

Completion stays only in `StoryStateSnapshot`. Active intro/result/outro origin/cursor stays in existing `activeDialogue`.

### Retire HPA-259 temporary guards

HPA-260 must remove/replace these intentional upstream stops:

- capture rejection of active Analysis dialogue origin;
- `restore_active_queue` rejection of Analysis origin;
- `restore_scene` rejection of packaged Analysis;
- `scene_asset_refs(SceneJson::Analysis(_)) -> &[]`.

After HPA-260:

- capture Analysis dialogue normally;
- restore Analysis origins through the already-merged resolver;
- reconstruct `AnalysisSceneState` from packaged definition + progress;
- use `&scene.asset_refs` for Analysis restore validation;
- keep Analysis evidence/statement manifests empty;
- delete `DialogueSegmentOriginV1::is_analysis()` if no caller remains.

### Restore invariants

Detached restore validates:

- qualified scene/boards exist in `StoryCatalog`;
- draft map has the authored board IDs and matching kinds;
- mutable card/group/order/threshold values are valid;
- saved availability exactly equals current `StoryUnlockExpr` evaluation over restored `StoryState`;
- active board is available when present;
- completed active board is allowed read-only;
- feedback is only incomplete/incorrect for known boards;
- active dialogue origin/cursor resolves;
- exact recapture equals saved snapshot before replacing live session.

## 16. Autosave

Add the narrow policy:

```rust
MutationPersistencePolicy::AutosaveIfAdvancedWithoutThumbnail
```

Reuse the existing trailing debounce/write path but explicitly represent autosave thumbnail as unavailable without allocating a capture ticket.

Target measurement:

```text
50 rapid Analysis workbench mutations
-> 50 durable revisions
-> 0 thumbnail requests/tickets/activity transitions
-> 1 trailing autosave write at newest revision
```

Explicit Save stays immediate/exact. Existing dialogue continuation keeps its current ordinary policy.

If this cannot fit as one narrow coordinator path, record measured evidence on HPA-521 instead of adding Analysis-specific persistence machinery.

## 17. Deterministic acceptance

Reuse the existing HPA-259 fixture:

```text
apps/game/src-tauri/src/game/test_fixtures/analysis_scene_8_5.json
```

Do not create a second three-board definition.

Required checkpoints:

```text
chapter-1-analysis-classify-partial
chapter-1-analysis-order-partial
chapter-1-analysis-threshold-partial
chapter-1-analysis-result-dialogue
```

Build checkpoint states through public engine commands.

Representative integration flow:

```text
enter Analysis
-> drain intro
-> partial classify
-> explicit save + detached restore
-> finish classify + result
-> finish order + result
-> wrong threshold
-> correct threshold
-> save mid-result + detached restore
-> drain result
-> drain outro
-> advance exactly once
```

Assert exact story effects, qualified completion, revision progression, read-only reopen, and absence of answer-key data.

## 18. Adjacent work

### HPA-549

Remain deferred. Merged HPA-259 emits no Analysis acquisition output and forbids authorization grant.

### HPA-521

Remain deferred unless measured thumbnail-free autosave integration proves the current coordinator seam inadequate.

## 19. Definition of done

- `SceneRuntime::Analysis` replaces the merged navigation fail-closed arm.
- Runtime evaluates merged `StoryUnlockExpr` directly against StoryState.
- HPA-259 qualified Analysis ref types are reused for durable completion.
- One shared `AnalysisDraft` and `AnalysisFeedbackState` serve command/runtime/save needs.
- Classify/order/threshold correctness is direct normalized-answer comparison only.
- Available IDs, active board, drafts, feedback, completion, and dialogue cursor round-trip exactly.
- Completed boards reopen read-only.
- Wrong submissions produce only `Incomplete` / `Incorrect` and no story effects.
- Correct submit atomically commits final draft, board completion, story reveals, availability refresh, and result dialogue.
- Repeated submit cannot replay effects/dialogue.
- Existing HPA-259 Analysis dialogue origins/resolver/groups are reused unchanged.
- HPA-259 navigation/capture/restore temporary guards are retired.
- Analysis asset refs participate in restore validation.
- Public/save/checkpoint JSON contains no accepted answers or threshold provenance rules.
- Thumbnail-free workbench autosave coalesces a realistic burst to the newest write.
- Existing HPA-259 fixture drives acceptance.
- No generic puzzle framework, migration, duplicate Analysis DTO family, acquisition extension, Svelte work, Chapter 2 support, or broad coordinator refactor is introduced.
