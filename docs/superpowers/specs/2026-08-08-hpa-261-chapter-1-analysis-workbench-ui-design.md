# HPA-261 Chapter 1 Analysis Workbench UI Design

**Date:** 2026-08-08  
**Status:** Revised after design review  
**Linear:** HPA-261  
**Baseline:** HPA-259 merged through PR #37; HPA-260 in progress in parallel; current `main`; open PR #44 threshold-only Analysis path reviewed as a temporary migration seam

## 1. Goal

Build the smallest reusable Svelte workbench needed to play the real Chapter 1 Beat 8.5 `classify`, `order`, and `threshold` boards while keeping Rust authoritative for gameplay truth.

The first version must:

- render HPA-260's answer-key-free public Analysis view;
- let pointer and keyboard players produce identical semantic drafts;
- support board selection, classify assignment, order manipulation, threshold selection, remove, one-step undo, reset, submit, optional hint, feedback, and solved-board review;
- preserve the existing `GameShell`, Case File, dialogue, persistence overlays, audio routing, Escape ownership, and gameplay-input isolation;
- remain usable at the current 1280×720 target;
- satisfy the first-version accessibility floor without expanding into release hardening.

This is a Chapter 1 workbench, not a generic graph/template renderer.

## 2. Dependency and repository context

### HPA-259 is the immutable authored-contract baseline

The merged compiler/Rust wire already defines the three closed Analysis families and the real Beat 8.5 immutable fixture:

- `classify` with public groups and hidden accepted mapping;
- `order` with public fixed anchors and hidden accepted order;
- `threshold` with public `minimumSelected` and hidden accepted selections;
- cards referencing already-acquired evidence/statements;
- authored incomplete/incorrect copy and optional static hint.

HPA-261 must not reproduce compiler validation or hidden answers in TypeScript.

### HPA-260 owns mutable runtime truth

HPA-260 is the authority for:

- board availability and active-board selection;
- typed mutable drafts;
- direct evaluation;
- failure feedback;
- qualified completion and story effects;
- exact persistence;
- `AnalysisActionToken` stale-action fencing;
- answer-key-free `ModeView::Analysis` / `SceneView::Analysis`;
- `select_analysis_board`, `update_analysis_draft`, and `submit_analysis_board`.

HPA-261 may proceed against typed fixtures matching that public contract. HPA-262 remains responsible for proving fixture parity against live runtime responses and the complete Chapter 1 vertical slice.

### PR #44 is a cleanup seam, not a dependency

Open PR #44 currently carries a threshold-only `AnalysisView` and temporary `set_analysis_selection` / `submit_analysis_selection` frontend/backend-facing names for the P1 tutorial.

HPA-261 must not leave two Analysis UI contracts behind.

Implementation rule after rebasing:

- if PR #44 has not merged, implement this workbench directly;
- if PR #44 has merged, replace/generalize the threshold-only component and remove the entire temporary Analysis surface: component/tests, temporary command wrappers/names, temporary flat board fields, and temporary page routing assumptions;
- the final frontend uses only the HPA-260 public draft union and three semantic commands.

## 3. Chosen architecture

### Approach A — one host + three focused board components — chosen

Use one `AnalysisWorkbench` for common scene chrome, navigation, feedback, hint, undo/reset, submit, and focus behavior. Branch directly on the closed `board.kind` union and render one focused component for `classify`, `order`, or `threshold`. Reuse one small `AnalysisCard` presentation component.

This maps exactly to committed Chapter 1 content and keeps each interaction independently testable.

### Rejected: one monolithic workbench

A single component would mix classify assignment, order movement, threshold provenance display, focus return, and shared chrome. That saves file count but makes iteration and testing worse.

### Rejected: generic renderer / DnD / graph framework

Do not add:

- a renderer registry;
- drag-and-drop library;
- graph/canvas abstraction;
- compare/route/chain support;
- generic sparse-anchor order editor.

Those are explicitly outside the Chapter 1-first delivery policy.

## 4. Ownership boundary

### Rust/public view owns

- visible/available boards;
- active-board identity through `AnalysisActionToken.activeBoardId`;
- completion/read-only state;
- cards, groups, fixed anchors, `minimumSelected`;
- current draft;
- feedback kind and authored visible copy;
- optional hint;
- correctness, accepted solutions, source-independence truth, and procedural eligibility;
- story effects and durable completion.

### Svelte may own presentation mechanics only

- temporary selected card inside classify interaction;
- display ordering mechanically derived from the public order draft + public fixed prefix anchor;
- selected count;
- record lookup for public source/procedure badges;
- one previous public draft for one-step Undo;
- hint-expanded state;
- focus-return keys.

### Svelte must never own

- accepted classify mapping;
- accepted total order;
- accepted threshold combinations;
- threshold source-group independence;
- threshold eligibility/capability/procedure correctness;
- board completion truth;
- future hidden board availability;
- durable reveals.

The frontend never imports compiler Analysis definitions.

## 5. Public frontend contract

HPA-261 mirrors HPA-260's answer-key-free JSON directly in `apps/game/src/lib/state/types.ts`. Field spelling follows the final Rust serialization; do not add an adapter DTO family.

Required shapes:

```ts
export type AnalysisActionToken = {
  sceneId: string;
  activeBoardId: string | null;
  durableRevision: number;
};

export type AnalysisDraft =
  | { kind: "classify"; groupByCard: Record<string, string> }
  | { kind: "order"; cardIds: string[] }
  | { kind: "threshold"; selectedCardIds: string[] };

export type AnalysisFeedbackView =
  | { kind: "incomplete" | "incorrect"; message: string }
  | null;

export type AnalysisCardView = {
  id: string;
  label: string;
  summary: string;
  source: InventoryTarget;
};

export type AnalysisGroupView = {
  id: string;
  label: string;
  description: string;
};

export type AnalysisFixedAnchorView = {
  cardId: string;
  position: number;
};
```

Each board variant exposes only public presentation metadata and its current draft.

### Single active-board identity

`Mode` does **not** add a second `boardId` field. It carries the action token only:

```ts
| ({
    type: "analysis";
    actionToken: AnalysisActionToken;
  } & VisualAssetCue)
```

The active board is always:

```ts
mode.actionToken.activeBoardId
```

If that value is `null`, the workbench renders a neutral no-active-board/loading state. The UI never chooses between two board identity fields.

`SceneView::Analysis` contains only boards Rust currently exposes to the player; HPA-261 never synthesizes locked future boards.

## 6. Component and pure-helper structure

```text
apps/game/src/lib/analysis/
  beat-8-5-fixture.ts
  analysis-boundary.test.ts
  response-fence.ts
  response-fence.test.ts
  order-draft.ts
  order-draft.test.ts

apps/game/src/lib/components/analysis/
  AnalysisWorkbench.svelte
  AnalysisCard.svelte
  ClassifyBoard.svelte
  OrderBoard.svelte
  ThresholdBoard.svelte
```

### `AnalysisWorkbench`

Owns common presentation only:

- visible board navigation/progress;
- board title/prompt;
- board-kind dispatch;
- one-step Undo;
- Reset;
- optional Hint disclosure;
- feedback region;
- Submit;
- focus return;
- read-only solved state.

### `AnalysisCard`

Displays card label/summary and optional public badges. It has no backend knowledge and no correctness logic.

### Board components

Each board component receives one public board view, derives a replacement `AnalysisDraft` from an interaction, and emits the whole replacement draft to the host.

### `order-draft.ts`

The only non-trivial draft algebra lives in a pure Chapter-1-scoped helper rather than inside Svelte.

It owns:

- asserting that authored fixed anchors form the supported prefix shape;
- materializing required prefix anchors for an edited partial draft;
- add;
- move up/down without crossing the fixed prefix;
- remove without removing the fixed prefix.

It does **not** know the hidden accepted order.

The real Beat 8.5 fixture is pinned to `event_1841` at position 1. A future non-prefix anchor fails the helper/test intentionally and requires a new product decision rather than silently expanding HPA-261 into a sparse-slot editor.

## 7. Workbench layout

At 1280×720 use a contained workbench below the existing chapter header:

- width around `min(1100px, calc(100vw - 48px))`;
- bounded height using the remaining viewport;
- header, scrollable board body, feedback/actions footer;
- vertical overflow stays inside the board body;
- reuse current theme variables (`--bone`, `--char`, `--rule-strong`, `--crimson`, `--cyan`).

No chapter skin or animation system is added.

### Header

Contains:

- `ANALYSIS` marker;
- visible-board progress;
- board label;
- prompt;
- compact visible-board navigation;
- Back control selecting the previous visible board through Rust.

Locked future boards never appear.

### Footer

Contains:

- text feedback region;
- Hint disclosure when `hint !== null`;
- Undo when one previous draft exists;
- Reset when editable and non-empty;
- Submit whenever editable.

Do **not** disable Submit because the frontend believes a draft is incomplete. Incomplete submission belongs to Rust gameplay feedback.

Completed/read-only boards hide mutation/undo/reset/submit and show explicit text such as `完成・只讀檢視`.

## 8. Interaction model

All primary actions are native `<button>` controls. Pointer click and keyboard Enter/Space therefore execute the same semantic handler. No global Analysis keyboard router is added; Escape remains owned by `GameShell`.

### 8.1 Classify

Render:

- unassigned pool;
- one group panel per public group;
- already-assigned cards inside each group;
- temporary selected-card presentation state.

Interaction:

1. activate a card;
2. activate `放入「<group>」` to assign/move it;
3. assigned cards expose `移除`;
4. selecting an assigned card then another group moves it directly.

Emitted draft:

```ts
{ kind: "classify", groupByCard: nextMap }
```

No correctness coloring before Rust submission.

### 8.2 Order

Render a numbered current sequence and unplaced-card pool.

For Beat 8.5:

- `event_1841` is a public fixed anchor at authored position 1;
- it is rendered locked;
- it has no move/remove control;
- an edit materializes the required public prefix anchor before movable cards;
- Reset may still send the Rust-valid empty order draft.

Movable cards expose:

- `加入時間線`;
- `上移`;
- `下移`;
- `移除`.

All draft algebra comes from `order-draft.ts` and emits the whole structural order draft.

### 8.3 Threshold

Render every displayed card as a toggle button with `aria-pressed` and public source/procedure badges.

#### Shared Case File source text

Do not define Analysis-only precedence. Extract one pure helper in `$lib/case-file/labels.ts` and use it from both Case File detail and Threshold:

```ts
caseRecordSourceText(record)
```

It preserves the current Case File precedence:

1. `record.provenance.sourceLabel`;
2. `record.sourceGroup?.label`;
3. otherwise no source text.

Threshold may fall back to the existing `sourceKindLabels` only when the shared source text is absent. Procedure text uses the existing `proceduralStatusLabels` map.

This keeps the same record from presenting conflicting source names between Case File and Analysis.

Show only mechanical progress:

> `已選 N / 最少 M`

The frontend allows any displayed combination, including cards sharing a source group.

#### Deterministic threshold draft order

HPA-260 stores threshold selection as a sorted set. The frontend emits selected IDs in deterministic lexical order:

```ts
selectedCardIds: [...selected].sort()
```

This prevents semantically identical selections from producing unstable fixture/undo/round-trip order.

## 9. Undo and Reset

### One-step Undo

The host keeps at most one previous public draft for the current board.

Before an edit:

1. clone the current authoritative public draft;
2. send the replacement through `update_analysis_draft`;
3. retain the previous draft for Undo only after the authoritative response is accepted by the frontend response fence.

Undo sends that previous draft through the same command. It is never a local rollback.

Undo state clears on:

- board change;
- scene/session replacement;
- successful reset;
- solved/read-only transition.

It is not persisted.

### Reset

Reset submits the empty draft for the active board kind:

```ts
{ kind: "classify", groupByCard: {} }
{ kind: "order", cardIds: [] }
{ kind: "threshold", selectedCardIds: [] }
```

Rust's response remains authoritative.

## 10. Command flow and stale-response safety

### No optimistic gameplay mutation

Components compute candidate drafts, but rendered board state remains `gameState.value`. The authoritative command response becomes the next visible state.

### Commands

Frontend wrappers mirror HPA-260:

```ts
selectAnalysisBoard(expected: AnalysisActionToken, boardId: string)
updateAnalysisDraft(expected: AnalysisActionToken, draft: AnalysisDraft)
submitAnalysisBoard(expected: AnalysisActionToken)
```

All use the existing gameplay dispatcher and existing `gameState.inFlight` isolation.

### Existing command registries

Current `main` already has `MUTATING_GAMEPLAY_COMMANDS` in `game-client.svelte.ts`, used by the game-client test harness. HPA-261 extends it with the three Analysis commands.

Separately, `GameplayCommandName` in `sfx-events.ts` has an exhaustive compile-time record and explicit count in `sfx-events.test.ts`. HPA-261 must update both the union and that exhaustive test. No new SFX mapping is added.

### Frontend response fence

Rust's `AnalysisActionToken` rejects stale workbench actions at the authority boundary. The frontend still must stop a late successful response from an old session from overwriting a newer `gameState.value`.

Use one narrow optional response guard on the existing dispatcher:

1. wrapper captures `presentationState.sessionEpoch` and expected token;
2. invoke runs normally;
3. before `applyGameplayCommandResult`, guard checks:
   - session epoch unchanged;
   - current mode still `analysis`;
   - current action token still equals expected token;
4. stale response returns `null` and is not applied.

Do not add an Analysis generation counter or a second command client.

### Required wiring proof

Pure fence tests are not enough. Add one existing `game-client-source.test.ts` integration test that:

- starts an Analysis command with a deferred mocked invoke;
- calls `resetFrontendForTitle()` (or otherwise replaces the session) before the response resolves;
- resolves the old invoke;
- asserts the wrapper returns `null` and the late response does not overwrite the new/null game state.

## 11. Focus and accessibility

First-version requirements:

- semantic native buttons/lists/groups;
- useful accessible names including card/group/action names;
- visible `:focus-visible` styling;
- text feedback, not color alone;
- `prefers-reduced-motion: reduce` removes nonessential movement;
- 1280×720 remains usable;
- keyboard-only completion of all three boards.

### Focus return

Interactive controls carry stable public presentation keys such as:

```text
card:<cardId>
group:<groupId>
board:<boardId>
submit
reset
undo
hint
```

After an accepted edit, `tick()` and restore focus to the corresponding key if it still exists, otherwise the active board heading.

After incomplete/incorrect submit, focus the feedback region (`tabindex="-1"`, `role="status"`) so text feedback is immediately discoverable.

After board switch, focus the new board heading and clear one-step Undo.

## 12. Existing-shell integration

### `+page.svelte`

Add the Analysis branch beside interrogation:

- reuse `SceneBackdrop`;
- render `AnalysisWorkbench`;
- pass Analysis scene/mode, inventory, three command wrappers, and `gameState.inFlight`.

### GameShell

Do not modify `GameShell.svelte`.

Its existing behavior already provides:

- Escape ownership;
- inert gameplay while menu/top layers are open;
- chapter HUD;
- persistence layer isolation.

### Case File

Do not change the mode policy:

- `shouldShowCaseFile(analysis) === true`;
- `canReexamineCaseRecords(analysis) === false`.

Add an explicit `mode.test.ts` Analysis case so this intended behavior is pinned rather than merely inferred from current helper fallthrough.

The only Case File component change allowed by HPA-261 is refactoring its existing source-text precedence to call the shared `caseRecordSourceText` helper; behavior must remain unchanged.

### Scene Select

Extend `sceneTypeLabel` with:

```text
analysis -> 分析
```

and pin it in the existing component test.

## 13. PR #44 cleanup acceptance

After rebasing the implementation branch, no temporary Analysis path may survive.

If PR #44 has landed, final verification must find no occurrences of:

```text
AnalysisView
setAnalysisSelection
submitAnalysisSelection
set_analysis_selection
submit_analysis_selection
```

The final `AnalysisBoardView` must be the discriminated HPA-260 shape where mutable selection/order/assignment lives under `draft`; there is no legacy flat `selectedCardIds` field on the board common shape.

Do not leave both tutorial and workbench command families active.

## 14. Test strategy

### Pure tests

- answer-key-free boundary fixture/source guard;
- response token/session predicate;
- Chapter 1 order-draft algebra table tests;
- shared Case File source-text precedence.

### Board component tests

Classify:

- pointer/keyboard assignment parity;
- move assigned card;
- remove assigned card;
- no correctness styling/logic.

Order:

- fixed anchor has no mutation controls;
- component delegates to pure order helper;
- pointer/keyboard add parity;
- pure helper covers up/down/remove/boundaries/non-prefix rejection.

Threshold:

- source/procedure badges use shared Case File helper/maps;
- deterministic sorted selected IDs;
- pointer/keyboard toggle parity;
- two same-source-group cards can still both be selected.

Workbench:

- visible board navigation;
- submit remains enabled when editable/incomplete;
- reset uses Rust command;
- successful edit enables one-step Undo;
- board switch clears Undo;
- feedback receives focus after failed submit response;
- completed board is read-only.

Integration pins:

- game-client stale response is dropped after session replacement;
- `GameplayCommandName` exhaustive record/count updated;
- `MUTATING_GAMEPLAY_COMMANDS` contains all three commands;
- `mode.test.ts` pins Case File visible + reexamine disabled;
- Scene Select renders `分析`;
- page route uses only `AnalysisWorkbench`.

HPA-262, not HPA-261, owns packaged Tauri/live-Rust fixture parity and save/resume vertical-slice acceptance.

## 15. Scope boundaries

Deferred:

- progressive/contextual hints (HPA-263);
- animation polish;
- exhaustive screen-reader narration;
- controller-specific layer;
- Chapter 2 compare/route/chain templates;
- interactive layout editor;
- generic sparse-anchor order behavior;
- packaged runtime integration (HPA-262).

No new npm/Bun dependency is required.

## 16. Review resolution summary

The external review was accepted with these corrections:

- **Accepted:** align threshold source display with Case File through a shared helper.
- **Partially accepted:** command-registration plan needed the `GameplayCommandName` exhaustive test update, but the claim that `MUTATING_GAMEPLAY_COMMANDS` does not exist was incorrect; it exists on current `main` and remains the correct test-harness registry to extend.
- **Accepted:** move order draft algebra into a pure Chapter-1-scoped helper with table tests.
- **Accepted:** add a real dispatcher stale-response wiring test in addition to pure predicate tests.
- **Accepted:** remove duplicated `mode.boardId`; use only `actionToken.activeBoardId`.
- **Accepted:** sort threshold selection IDs before emitting drafts.
- **Accepted:** pin Analysis Case File/reexamine behavior in `mode.test.ts`.
- **Accepted:** expand PR #44 cleanup to the full temporary command/type/route surface.
- **Accepted:** add missing classify-remove, order algebra, and Undo-on-board-switch tests.
- **Not applied:** turning the execution plan into a high-level checklist only. This repository's implementation-plan workflow intentionally keeps task-level code/test commands, but the revised plan removes duplicated component implementation detail where pure helpers/tests now carry the risky logic.

## 17. Acceptance checklist

HPA-261 is ready for HPA-262 handoff when:

- classify/order/threshold all emit full replacement drafts with pointer/keyboard parity;
- no accepted-answer fields or frontend correctness rules exist;
- active board comes only from `actionToken.activeBoardId`;
- fixed order anchor cannot move;
- order helper rejects unsupported non-prefix anchor shapes;
- threshold displays consistent public source/procedure information and emits sorted selections;
- completed boards reopen read-only;
- feedback focus and board-switch focus are deterministic;
- one-step Undo/Reset use the same authoritative Rust update command;
- stale old-session Analysis responses are proven not to overwrite current state;
- Case File remains available but reexamination remains disabled in Analysis;
- PR #44 temporary Analysis names/shapes are absent if that PR merged first;
- HPA-262 can replace fixtures with live runtime responses without changing the component architecture.
