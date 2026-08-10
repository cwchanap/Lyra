# HPA-261 Chapter 1 Analysis Workbench UI Design

**Date:** 2026-08-10  
**Status:** Rebased after HPA-561 and HPA-260 merged  
**Linear:** HPA-261  
**Baseline:** current `main` at HPA-260 merge head `b7114a1`; HPA-259 PR #37, HPA-561 PR #44, and HPA-260 PR #47 are merged

## 1. Goal

Build the smallest reusable Svelte workbench needed to play the real Chapter 1 Beat 8.5 `classify`, `order`, and `threshold` boards while preserving the already-playable P1 threshold tutorial.

The first version must:

- reuse the **implemented** Rust-owned Analysis public view and three semantic commands;
- add playable classify and order interaction and improve the existing threshold presentation;
- support pointer and keyboard parity for select, assign, move, reorder, remove, one-step Undo, Reset, board selection, and Submit;
- preserve P1 `practice:` cards and authored wrong-choice feedback;
- expose the public source/procedure information needed by the Beat 8.5 threshold board without evaluating correctness in Svelte;
- keep completed boards read-only;
- preserve `GameShell`, Case File, dialogue, acquisition popup, persistence overlays, audio, Escape layering, and gameplay-input isolation;
- remain usable at the current 1280x720 target.

This is now primarily a **frontend presentation/refactor task**. HPA-260 has already implemented the runtime, persistence, public wire, command names, Tauri handlers, and the minimum TypeScript bridge.

---

## 2. Current repository baseline

### 2.1 HPA-561 PR #44 is merged

Current Chapter 1 already contains a playable P1 Analysis tutorial:

- one threshold board;
- four tutorial-local `practice:` cards;
- authored incorrect feedback;
- exact persistence;
- a threshold-only `AnalysisView.svelte`.

HPA-261 must evolve this path, not create a parallel Analysis UI and not regress the onboarding scene.

### 2.2 HPA-260 PR #47 is merged

The runtime work HPA-261 previously planned around hypothetically now exists on `main`.

Already implemented and **not HPA-261 work**:

- `AnalysisActionToken`;
- `AnalysisDraft` for classify/order/threshold;
- answer-key-free `ModeView::Analysis` and `SceneView::Analysis`;
- public classify groups, order fixed anchors, threshold `minimumSelected`, board/card availability, read-only/completion state, feedback, hint, and card source metadata;
- `select_analysis_board`;
- `update_analysis_draft`;
- `submit_analysis_board`;
- TypeScript mirrors for the above;
- `MUTATING_GAMEPLAY_COMMANDS` registration;
- `GameplayCommandName` registration and its 17-command exhaustive test;
- Tauri command registration;
- exact Analysis save/restore;
- no-frontend-thumbnail Analysis autosave behavior;
- Rust stale-action validation;
- Scene Select `analysis` support and the `分析` label;
- the existing `+page.svelte` Analysis route.

HPA-261 must not repeat any of those tasks.

### 2.3 The remaining UI gap is narrow

Current `AnalysisView.svelte`:

- renders threshold cards;
- sends whole threshold drafts through `updateAnalysisDraft`;
- submits through `submitAnalysisBoard`;
- respects card availability and completed state;
- renders authored feedback;
- shows a placeholder for classify/order boards.

Therefore HPA-261 should **replace/generalize this component**, preserve its P1 behavior, and add the missing Chapter 1 workbench interactions.

---

## 3. Chosen architecture

Use one workbench host plus three focused board components:

```text
apps/game/src/lib/components/analysis/
  AnalysisWorkbench.svelte
  AnalysisCard.svelte
  ClassifyBoard.svelte
  OrderBoard.svelte
  ThresholdBoard.svelte

apps/game/src/lib/analysis/
  test-fixtures.ts
  analysis-boundary.test.ts
  order-draft.ts
  order-draft.test.ts
```

### Why this shape

- There are exactly three committed board families.
- Their interactions differ enough to deserve focused components.
- Shared chrome/focus/Undo/Reset belongs in one host.
- Order manipulation has enough pure draft algebra to deserve one small helper.
- Nothing in Chapter 1 justifies a renderer registry, graph model, DnD layer, or generic sparse-slot framework.

### Explicitly rejected

Do not add:

- drag-and-drop dependencies;
- a generic board renderer registry;
- graph/canvas/edge editing;
- compare/route/chain support;
- a second Analysis frontend store;
- a frontend correctness evaluator;
- a new Analysis command client;
- a frontend Analysis generation counter.

---

## 4. Reuse the implemented public contract exactly

HPA-261 should consume the current TypeScript contract in `state/types.ts`; it no longer designs or mirrors a future contract.

### 4.1 Board display identity and action identity are intentionally different

The implemented `Mode` currently carries:

```ts
{
  type: "analysis";
  boardId: string;
  activeBoardId: string | null;
  actionToken: AnalysisActionToken;
  availableBoardIds: string[];
  feedback: AnalysisFeedbackView | null;
  lastFeedback: string | null;
  // visual/audio cue fields...
}
```

Do **not** collapse these fields in HPA-261.

Rust uses them for different purposes:

- `mode.boardId` = the board the view should render; Rust may fall back to the next available incomplete board if the stored active board is absent/unavailable;
- `mode.activeBoardId` / `actionToken.activeBoardId` = the exact server-state selection used for stale-action validation;
- `actionToken` = echoed unchanged with every semantic Analysis mutation.

The workbench therefore:

1. finds the displayed board using `mode.boardId`;
2. uses `mode.actionToken` for every `select/update/submit` command;
3. never manufactures a board ID inside the token.

### 4.2 `visibleBoards` contains public board definitions plus availability

Do not assume `visibleBoards` means “currently selectable only.” The implemented view exposes board definitions with:

- `available`;
- `completed`;
- `readOnly`;
- current `draft`;
- `feedback`;
- `hint`.

The UI may use all public boards for progress, but selection controls must be driven only by Rust’s `available/completed` state.

Recommended presentation:

- progress may count all public boards;
- navigation shows available/completed boards;
- unavailable boards are not selectable and need not expose detailed prompt/card content in the navigation chrome.

Do not derive unlock predicates in TypeScript.

### 4.3 Cards have runtime availability

Every board card exposes `available`.

All mutation controls must respect it:

- unavailable classify cards cannot be assigned/moved;
- unavailable order cards cannot be added;
- unavailable threshold cards cannot be toggled.

HPA-260 also validates card availability at the Rust command boundary, so the UI rule is presentation/affordance only, not authority.

### 4.4 Preserve `practice:` sources

`AnalysisCardSourceView` is already:

```ts
{ kind: "evidence" | "statement" | "practice"; ... }
```

P1 uses `practice` sources that deliberately do not exist in the Case File inventory.

HPA-261 must support both:

- P1 practice cards: render normally, no Case File provenance badges required;
- Beat 8.5 evidence/statement cards: resolve public provenance from `GameStateView.inventory` for threshold badges.

### 4.5 Use `draft` as the generic mutable board state

The current threshold view also exposes a compatibility `selectedCardIds` field used by the existing threshold-only component. The unified workbench should read/write the public `draft` union for all three board kinds.

Do not make removal of Rust compatibility aliases part of HPA-261. They can remain unused by the new UI.

---

## 5. Ownership boundary

### Rust owns

- board/card availability;
- active selection and action token;
- draft validation;
- accepted solutions;
- classify/order/threshold correctness;
- threshold source-independence/procedure/capability truth;
- failure feedback state/copy;
- board and scene completion;
- story effects;
- durable revision;
- save/restore.

### Svelte may own only presentation mechanics

- temporary selected-card state for classify;
- mechanical order operations over the public draft/fixed anchors;
- selected count;
- one previous public draft for one-step Undo;
- Hint open/closed presentation;
- focus-return targets;
- lookup of public inventory provenance for display badges.

### Svelte must never contain

- accepted group mappings;
- accepted order;
- accepted threshold combinations;
- local source-group independence evaluation;
- local eligibility/proof-capability/procedural correctness;
- durable board completion or reveal logic.

---

## 6. Workbench layout

At the 1280x720 target, keep the workbench inside the existing `GameShell` rather than adding another full-screen shell.

Suggested structure:

```text
AnalysisWorkbench
  header
    ANALYSIS marker
    completed / total progress
    visible board navigation
    current board label + prompt
  scrollable board body
    ClassifyBoard | OrderBoard | ThresholdBoard
  footer
    feedback
    optional Hint
    Undo
    Reset
    Submit
```

Use existing game theme variables. Do not add a Chapter-specific skin or animation framework.

### Board navigation

- current display board = `mode.boardId`;
- available/completed board buttons call `selectAnalysisBoard(mode.actionToken, targetId)`;
- unavailable boards are not selectable;
- Back means previous available/completed board, not local history reconstruction.

Completed boards can be selected and reopened read-only because Rust already supports that behavior.

---

## 7. Board interactions

All primary actions use native buttons. Pointer click and keyboard Enter/Space therefore execute the same semantic handlers.

### 7.1 Classify

Render:

- an unassigned pool;
- one panel per public group;
- assigned cards in their current group;
- a temporary selected-card presentation state.

Actions:

1. select an available card;
2. activate `放入「<group>」` to assign/move it;
3. assigned cards expose `移除`;
4. selecting an assigned card and another group moves it.

Emit the whole public draft:

```ts
{ kind: "classify", groupByCard: nextMap }
```

No green/red local correctness state.

### 7.2 Order

Beat 8.5 currently exposes one public fixed anchor:

```text
event_1841 @ position 1
```

Use a pure `order-draft.ts` helper for:

- asserting the supported fixed-anchor shape is a contiguous prefix;
- materializing the public prefix anchor when the player first places a movable card;
- add;
- move up/down without crossing the prefix;
- remove without removing the fixed prefix.

The UI renders:

- a numbered ordered list;
- fixed anchor with `固定位置` and no mutation controls;
- unplaced available cards;
- `加入時間線`, `上移`, `下移`, `移除` controls for movable cards.

Reset may send the Rust-valid empty order draft.

Do not implement non-prefix sparse anchors. A future authored non-prefix anchor should fail the focused helper test and trigger a later product decision.

### 7.3 Threshold

Migrate the existing P1 threshold behavior into `ThresholdBoard` rather than rewriting it from scratch.

Use the board’s threshold `draft` as the selected set and emit IDs in deterministic lexical order:

```ts
{ kind: "threshold", selectedCardIds: [...selected].sort() }
```

Show only mechanical progress:

```text
已選 N / 最少 M
```

Do not prevent combinations based on source group, procedure, or proof capability; Rust owns acceptance.

#### Public provenance badges

For `evidence` / `statement` cards, resolve the referenced record from `GameStateView.inventory` and show explicit semantics:

- if `sourceGroup` exists: `來源群組：<label>`;
- otherwise, if `provenance.sourceLabel` exists: `來源：<label>`;
- optional fallback to the existing `sourceKindLabels` vocabulary;
- if procedural status has a public label: `程序：<label>`.

This mirrors the Case File distinction between a source and a source group rather than inventing an Analysis-only precedence rule.

For `practice` cards, do not attempt inventory lookup and do not fabricate provenance badges.

---

## 8. Undo and Reset

### One-step Undo

Undo is presentation convenience, not durable Analysis state.

The current Analysis command wrappers return `Promise<void>`, which makes it impossible for the host to distinguish an applied command from `dispatchGameCommand` returning `null`.

HPA-261 should make the smallest client change:

```ts
dispatchAnalysisCommand(...): Promise<GameStateView | null>
selectAnalysisBoard(...): Promise<GameStateView | null>
updateAnalysisDraft(...): Promise<GameStateView | null>
submitAnalysisBoard(...): Promise<GameStateView | null>
```

No command payload changes are required.

For an edit:

1. clone the current authoritative public draft;
2. call `updateAnalysisDraft`;
3. only if it returns a non-null applied state, store the previous draft as the one Undo slot.

Undo sends that previous draft through the same Rust command and then clears the slot.

Clear Undo on:

- displayed board change;
- successful Reset;
- solved/read-only transition;
- scene/session replacement.

Do not persist Undo and do not add redo history.

### Reset

Reset sends the board-kind empty draft through `updateAnalysisDraft`:

```ts
{ kind: "classify", groupByCard: {} }
{ kind: "order", cardIds: [] }
{ kind: "threshold", selectedCardIds: [] }
```

---

## 9. Stale-response safety: reuse current mechanisms

The previous HPA-261 draft planned a new frontend response-fence helper. The merged HPA-260/current client makes that extra layer unnecessary for the first version.

Current protection is already two-layered:

1. `gameState.inFlight` serializes frontend gameplay commands and disables/blocks competing gameplay/menu transitions while a command is pending;
2. Rust validates `AnalysisActionToken { sceneId, activeBoardId, durableRevision }` before every workbench mutation.

Persistence/session replacement commands also reject while the gameplay client is in flight.

Therefore HPA-261 should **not** add:

- `response-fence.ts`;
- another session generation;
- another command dispatcher;
- optimistic local board state.

The workbench continues to render only the authoritative `gameState.value` returned by the existing dispatcher.

---

## 10. Feedback, Hint, and focus behavior

### Feedback

Use the board’s implemented `feedback` field:

```ts
{ state: "incomplete" | "incorrect"; message: string } | null
```

Do not build contextual feedback precedence; that remains HPA-263.

Submit stays enabled for editable boards even when the UI can see the draft is incomplete. Rust must be able to return authored `Incomplete` feedback.

After incomplete/incorrect submit, focus the feedback region:

- `role="status"`;
- `tabindex="-1"`;
- textual message, not color alone.

### Hint

If `board.hint !== null`, expose a simple disclosure button. Hint open/closed state is presentation-only and not persisted.

### Focus return

Use stable public focus keys such as:

```text
card:<id>
group:<id>
board:<id>
submit
reset
undo
hint
```

After an applied draft mutation, return focus to the originating card/action when it still exists; otherwise focus the board heading.

After `mode.boardId` changes, clear Undo/Hint and focus the new board heading.

---

## 11. Existing-shell integration

### `+page.svelte`

The Analysis route already exists.

HPA-261 only needs to:

- import `selectAnalysisBoard` in addition to the already-used update/submit wrappers;
- replace `AnalysisView` with `AnalysisWorkbench`;
- pass `scene`, `mode`, `inventory`, the three wrappers, and `gameState.inFlight`.

Keep the existing `SceneBackdrop` branch.

### `GameShell.svelte`

No change.

### `SceneNavigationPanel.svelte`

No change. Current main already handles `analysis` and labels it `分析`.

### `audio/sfx-events.ts`

No change. Current main already contains all three Analysis command names and the exhaustive test count is already 17.

### `state/types.ts`

No new public wire is required for HPA-261. Consume the HPA-260 types as implemented.

### Case File

No production behavior change. Current helpers already mean:

- Analysis: Case File visible;
- Analysis: re-examination disabled.

Add one focused `mode.test.ts` regression pin for that existing behavior.

---

## 12. Test strategy

### Preserve the current P1 tutorial first

Migrate the useful assertions from the current `AnalysisView.test.ts`:

- four practice cards render;
- threshold toggle sends a whole threshold draft;
- authored incorrect feedback renders;
- completed/read-only board blocks mutation;
- disabled/in-flight state blocks mutation.

This is a hard regression requirement because P1 is already playable on `main`.

### Add answer-key-free Beat 8.5 UI fixtures

Create frontend-only public-view fixtures using real Beat 8.5 IDs/labels but **no accepted mapping/order/selection data**.

Cover:

- classify groups/cards with empty/partial public drafts;
- order cards + public `event_1841@1` fixed anchor with a deliberately non-final partial draft;
- threshold cards with minimum selection and public inventory provenance.

Do not import the Rust hidden-answer fixture into frontend code.

### Focused component tests

Classify:

- pointer/keyboard parity;
- move;
- remove;
- unavailable card disabled;
- read-only state.

Order:

- pure prefix-anchor table tests;
- add/move/remove;
- cannot cross/remove fixed anchor;
- unavailable unplaced card disabled;
- pointer/keyboard parity;
- non-prefix anchor shape fails the helper test.

Threshold:

- P1 practice regression;
- evidence/statement provenance badges;
- unavailable card disabled;
- same-source-group cards remain selectable together;
- deterministic sorted draft IDs;
- pointer/keyboard parity.

Workbench:

- `mode.boardId` chooses displayed board;
- available/completed board navigation calls `selectAnalysisBoard` with the current action token;
- unavailable board cannot be selected;
- Submit remains enabled on incomplete editable draft;
- one-step Undo records only an applied update;
- board switch clears Undo and moves focus;
- Reset uses the Rust command;
- feedback gets focus after failed submit;
- completed board reopens read-only.

Ownership:

- frontend Analysis sources contain no `acceptedGroupByCard`, `acceptedOrder`, or `acceptedSelections` contract/data.

---

## 13. HPA-262 handoff after HPA-261

Because HPA-260 is now merged, HPA-262’s remaining integration burden is smaller.

HPA-262 should prove against the final authored Chapter 1 Beat 8.5 scene:

1. the real classify/order/threshold board content flows through the already-merged Rust runtime into this workbench;
2. one representative partial draft per board survives Save -> Title -> Continue;
3. fixed anchor behavior matches the authored board;
4. threshold source/procedure information is understandable with real Chapter 1 inventory provenance;
5. correct submit commits facts/objective/result dialogue exactly once;
6. completed boards reopen read-only;
7. a packaged keyboard-only path completes all three real boards;
8. the existing P1 practice threshold tutorial still works after the UI replacement.

HPA-261 does not need to recreate HPA-260’s runtime acceptance or save tests.

---

## 14. Deferred / non-goals

Deferred:

- progressive/contextual hints (HPA-263);
- animation/card-flight polish;
- exhaustive screen-reader narration;
- controller-specific optimization;
- broad responsive/mobile work;
- Chapter-specific skins;
- compare/route/chain templates;
- non-prefix/sparse order anchors;
- layout-editor integration.

Non-goals:

- Rust evaluator/runtime changes;
- save schema changes;
- frontend accepted-solution data;
- provenance correctness evaluation in Svelte;
- generic graph/editor architecture;
- Chapter 2 UI.

---

## 15. Acceptance mapping

| HPA-261 acceptance criterion | Design owner |
|---|---|
| Keyboard-only classify/order/threshold | focused native-button board components |
| Pointer and keyboard emit identical semantic drafts | component parity tests |
| Fixed anchors cannot move | pure prefix-anchor helper + locked UI |
| Threshold exposes source/procedure info | public inventory provenance badges |
| Completed boards reopen read-only | Rust state + workbench read-only rendering |
| Feedback text + useful focus return | workbench footer/focus logic |
| No frontend truth | Rust ownership + source/fixture guard |
| Stale action safety | existing `gameState.inFlight` + Rust `AnalysisActionToken` |
| 1280x720 first-version usability | contained workbench layout |

## 16. Final implementation principle

Do not rebuild the Analysis platform HPA-260 just delivered.

HPA-261 should now be a small UI completion layer:

> **reuse the live Rust contract, preserve the existing P1 threshold tutorial, add classify/order/threshold interaction quality, and stop there.**
