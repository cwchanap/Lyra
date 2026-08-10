# HPA-261 Chapter 1 Analysis Workbench UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Chapter 1 Analysis UI on top of the merged HPA-260 runtime: preserve the existing P1 threshold tutorial, add usable classify/order/threshold workbench interactions, and keep Rust as the sole owner of correctness and durable state.

**Architecture:** Reuse the exact Analysis public types, action token, semantic commands, persistence, page route, and Scene Select support already on `main`. Replace the current threshold-only `AnalysisView` with one `AnalysisWorkbench` plus three focused board components. Keep only two small frontend pure helpers: answer-key-free fixtures/ownership tests and Chapter-1-scoped order draft algebra. No new wire contract, response-fence framework, DnD layer, or generic board renderer is introduced.

**Tech Stack:** Svelte 5, TypeScript, existing Tauri game client, existing HPA-260 Analysis commands/public view, Vitest, Testing Library Svelte, existing Case File provenance labels.

## Global Constraints

- Start from current `main` containing merged PR #44 and PR #47.
- Support exactly `classify`, `order`, and `threshold`.
- Preserve the existing P1 `practice:` threshold tutorial and its authored wrong-choice feedback.
- Reuse existing `AnalysisActionToken`, `AnalysisDraft`, `AnalysisBoardView`, Analysis Mode/SceneView, and the three Analysis command wrappers; do not create adapter DTOs.
- Display the board selected by Rust through `mode.boardId`; echo `mode.actionToken` unchanged with every board select/update/submit command.
- Treat `mode.boardId` and `actionToken.activeBoardId` as intentionally different runtime concepts; do not collapse them.
- Respect public `board.available`, `board.completed`, `board.readOnly`, and `card.available`; never reconstruct unlock/availability rules in TypeScript.
- TypeScript must not contain accepted classify mappings, accepted order, accepted threshold selections, source-independence truth, procedural eligibility truth, or durable reveal logic.
- Use the generic `board.draft` union for new workbench interactions. Do not make removal of existing compatibility fields (`selectedCardIds`, `lastFeedback`, etc.) part of HPA-261.
- No drag-and-drop dependency, graph/canvas editing, renderer registry, compare/route/chain abstraction, sparse-anchor framework, or Chapter 2 UI.
- No new Analysis frontend store, command dispatcher, response-fence module, session generation, or persistence layer.
- Preserve existing `gameState.inFlight`, `GameShell` Escape ownership, Case File behavior, acquisition popup, audio routing, and persistence overlays.
- Case File remains visible during Analysis and record re-examination remains disabled.
- Submit remains available on editable boards even when the draft is structurally incomplete so Rust can return authored `Incomplete` feedback.
- Completed boards are read-only: no draft mutation, Undo, Reset, or Submit.
- No new npm/Bun dependency is required.

---

## Current Main — Reuse, Do Not Rebuild

Merged HPA-260 already provides:

- `AnalysisActionToken`;
- `AnalysisDraft::{classify, order, threshold}` TypeScript mirror;
- `AnalysisCardSourceView` including `practice`;
- card `available` plus board `available/completed/readOnly/draft/feedback/hint`;
- classify groups, order fixed anchors, threshold minimum/selected projection;
- Analysis `Mode` and `SceneView`;
- `selectAnalysisBoard`, `updateAnalysisDraft`, `submitAnalysisBoard` wrappers;
- `MUTATING_GAMEPLAY_COMMANDS` registration;
- the 17-member `GameplayCommandName` union/exhaustive test;
- Tauri command registration;
- exact Analysis save/restore;
- Rust action-token stale validation;
- runtime draft/card availability validation;
- no-thumbnail Analysis autosave behavior;
- Scene Select Analysis type + `分析` label;
- the `+page.svelte` Analysis branch.

Merged HPA-561/HPA-260 also leave one threshold-only `AnalysisView.svelte` as the current playable P1 surface. HPA-261 replaces/generalizes that component rather than adding another Analysis path.

---

## File Structure

### Create

- `apps/game/src/lib/analysis/test-fixtures.ts`
  - P1 practice threshold public fixture migrated from current `AnalysisView.test.ts`;
  - answer-key-free Beat 8.5 classify/order/threshold public fixtures;
  - only the inventory rows required for provenance presentation tests.
- `apps/game/src/lib/analysis/analysis-boundary.test.ts`
  - guards the frontend Analysis feature against hidden answer-key fields/data.
- `apps/game/src/lib/analysis/order-draft.ts`
  - Chapter 1 prefix-anchor add/move/remove algebra only.
- `apps/game/src/lib/analysis/order-draft.test.ts`
- `apps/game/src/lib/components/analysis/AnalysisCard.svelte`
- `apps/game/src/lib/components/analysis/ClassifyBoard.svelte`
- `apps/game/src/lib/components/analysis/ClassifyBoard.test.ts`
- `apps/game/src/lib/components/analysis/OrderBoard.svelte`
- `apps/game/src/lib/components/analysis/OrderBoard.test.ts`
- `apps/game/src/lib/components/analysis/ThresholdBoard.svelte`
- `apps/game/src/lib/components/analysis/ThresholdBoard.test.ts`
- `apps/game/src/lib/components/analysis/AnalysisWorkbench.svelte`
- `apps/game/src/lib/components/analysis/AnalysisWorkbench.test.ts`

### Modify

- `apps/game/src/lib/state/game-client.svelte.ts`
  - make the existing Analysis dispatch/wrappers return the applied `GameStateView | null` so one-step Undo is only recorded after an authoritative applied update.
- `apps/game/src/lib/state/game-client-source.test.ts`
  - pin the existing Analysis wrapper payload and returned-state behavior.
- `apps/game/src/routes/+page.svelte`
  - replace `AnalysisView` with `AnalysisWorkbench` and pass the already-existing select/update/submit wrappers.
- `apps/game/src/lib/state/mode.test.ts`
  - pin current Analysis Case File-visible / reexamine-disabled behavior.

### Delete after migration

- `apps/game/src/lib/components/AnalysisView.svelte`
- `apps/game/src/lib/components/AnalysisView.test.ts`

The useful P1 tests from these files must be migrated before deletion.

### Intentionally Do Not Modify

- `apps/game/src/lib/state/types.ts`
- `apps/game/src/lib/audio/sfx-events.ts`
- `apps/game/src/lib/audio/sfx-events.test.ts`
- `apps/game/src/lib/components/SceneNavigationPanel.svelte`
- `apps/game/src/lib/components/SceneNavigationPanel.test.ts`
- `apps/game/src/lib/components/GameShell.svelte`
- Case File production components/labels
- Rust Analysis/runtime/save/view files
- compiler Analysis parser/validator/emitter

---

### Task 1: Pin the Current Public Contract with P1 + Beat 8.5 UI Fixtures

**Files:**
- Create: `apps/game/src/lib/analysis/test-fixtures.ts`
- Create: `apps/game/src/lib/analysis/analysis-boundary.test.ts`

**Interfaces:**
- Consumes: existing `AnalysisBoardView`, `AnalysisDraft`, `Mode`, `SceneView`, `Inventory` from `state/types.ts`.
- Produces: public-only fixtures used by Tasks 2–5. No accepted answers.

- [ ] **Step 1: Move the existing P1 public fixture into the shared fixture file**

Start from the current `AnalysisView.test.ts` P1 fixture and preserve its exact public semantics:

- scene `analysis_scene_p1_5`;
- one threshold board `p1_reprint_time_board`;
- four `practice` cards;
- `available: true` cards;
- `draft: { kind: "threshold", selectedCardIds: [] }`;
- threshold compatibility `selectedCardIds: []` because it remains part of the current public TypeScript shape;
- `actionToken` and current `boardId`/`activeBoardId` values appropriate for the fixture.

Do not invent Case File provenance rows for practice cards.

- [ ] **Step 2: Add answer-key-free Beat 8.5 public fixtures**

Create three board fixtures with the real public IDs/labels from the HPA-259 fixture:

```text
evidence_packages      -> classify
local_event_sequence   -> order
narrow_request_basis   -> threshold
```

Use only public data:

- classify cards/groups + empty/partial classify draft;
- order cards + `fixedAnchors: [{ cardId: "event_1841", position: 1 }]` + a deliberately non-final partial order draft;
- threshold cards + `minimumSelected: 2` + empty/partial threshold draft;
- `available/completed/readOnly/feedback/hint` public state;
- `AnalysisCardSourceView` with evidence/statement IDs and existing public source label/summary fields;
- card `available` values.

Do **not** include `acceptedGroupByCard`, `acceptedOrder`, or `acceptedSelections`.

Add only the evidence/statement inventory records needed for threshold badge tests. Give at least two records the same `sourceGroup.id` so the component can prove it does not enforce source independence locally.

- [ ] **Step 3: Add the hidden-answer ownership guard**

Create `analysis-boundary.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { beat85AnalysisSceneFixture } from "./test-fixtures";

const FEATURE_PATHS = [
  "src/lib/analysis/test-fixtures.ts",
  "src/lib/analysis/order-draft.ts",
  "src/lib/components/analysis/AnalysisCard.svelte",
  "src/lib/components/analysis/ClassifyBoard.svelte",
  "src/lib/components/analysis/OrderBoard.svelte",
  "src/lib/components/analysis/ThresholdBoard.svelte",
  "src/lib/components/analysis/AnalysisWorkbench.svelte",
];

it("keeps answer keys out of frontend Analysis fixtures and feature source", () => {
  const fixture = JSON.stringify(beat85AnalysisSceneFixture);
  expect(fixture).not.toContain("acceptedGroupByCard");
  expect(fixture).not.toContain("acceptedOrder");
  expect(fixture).not.toContain("acceptedSelections");

  const source = FEATURE_PATHS.flatMap((path) => {
    try { return [readFileSync(path, "utf8")]; } catch { return []; }
  }).join("\n");
  expect(source).not.toMatch(/acceptedGroupByCard|acceptedOrder|acceptedSelections/);
});
```

- [ ] **Step 4: Verify fixture/type compatibility**

Run:

```bash
bun run --cwd apps/game test src/lib/analysis/analysis-boundary.test.ts
bun run --cwd apps/game check
```

Expected: PASS without changing `state/types.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/game/src/lib/analysis/test-fixtures.ts apps/game/src/lib/analysis/analysis-boundary.test.ts
git commit -m "test(game-ui): pin analysis public fixtures"
```

---

### Task 2: Build Shared Card Presentation and Classify Interaction

**Files:**
- Create: `apps/game/src/lib/components/analysis/AnalysisCard.svelte`
- Create: `apps/game/src/lib/components/analysis/ClassifyBoard.svelte`
- Create: `apps/game/src/lib/components/analysis/ClassifyBoard.test.ts`

**Interfaces:**
- Consumes: current `Extract<AnalysisBoardView, { kind: "classify" }>`.
- Produces: whole replacement classify drafts via `onDraft(draft, focusKey)` only.

- [ ] **Step 1: Write failing interaction tests**

Pin all of these:

1. pointer click and keyboard Enter/Space produce the same assignment draft;
2. assigning an already-assigned available card to another group emits a moved mapping;
3. `移除` deletes only that card mapping;
4. `card.available === false` disables selection/assignment affordances;
5. `readOnly` prevents mutation controls.

Example removal assertion:

```ts
expect(onDraft).toHaveBeenLastCalledWith(
  { kind: "classify", groupByCard: {} },
  "card:miyake_call",
);
```

- [ ] **Step 2: Run and confirm failure**

```bash
bun run --cwd apps/game test src/lib/components/analysis/ClassifyBoard.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement `AnalysisCard` as presentation only**

It may render:

- card label;
- card summary;
- optional badge strings passed by the parent;
- unavailable/read-only visual text.

It must not know any solution or call Tauri commands.

- [ ] **Step 4: Implement classify interaction over the current draft**

Narrow the runtime draft before use:

```ts
if (board.draft.kind !== "classify") {
  // Valid Rust views should never hit this; render/disable safely rather than cast.
}
```

Assignment:

```ts
const next = {
  ...board.draft.groupByCard,
  [cardId]: groupId,
};
onDraft({ kind: "classify", groupByCard: next }, `card:${cardId}`);
```

Removal copies the map and deletes the requested card.

Use native buttons with useful accessible names. Do not render local correctness colors.

- [ ] **Step 5: Add visible focus and reduced-motion behavior**

Use `:focus-visible` and `prefers-reduced-motion: reduce`; do not add an animation system.

- [ ] **Step 6: Verify**

```bash
bun run --cwd apps/game test src/lib/components/analysis/ClassifyBoard.test.ts
bun run --cwd apps/game check
```

- [ ] **Step 7: Commit**

```bash
git add apps/game/src/lib/components/analysis/AnalysisCard.svelte apps/game/src/lib/components/analysis/ClassifyBoard.svelte apps/game/src/lib/components/analysis/ClassifyBoard.test.ts
git commit -m "feat(game-ui): add classify analysis board"
```

---

### Task 3: Add Pure Chapter 1 Order Algebra and the Order Board

**Files:**
- Create: `apps/game/src/lib/analysis/order-draft.ts`
- Create: `apps/game/src/lib/analysis/order-draft.test.ts`
- Create: `apps/game/src/lib/components/analysis/OrderBoard.svelte`
- Create: `apps/game/src/lib/components/analysis/OrderBoard.test.ts`

**Interfaces:**
- Consumes: current public order board + public fixed anchors.
- Produces: structural order drafts only.
- Chapter 1 constraint: supported fixed anchors must form a contiguous prefix; current fixture is exactly `event_1841@1`.

- [ ] **Step 1: Write table-driven pure tests first**

Pin the actual fixture:

```ts
expect(board.fixedAnchors).toEqual([{ cardId: "event_1841", position: 1 }]);
```

Required helper behaviors:

```ts
materializePrefixAnchors(board, [])
  -> ["event_1841"]

addOrderCard(board, [], "event_1842")
  -> ["event_1841", "event_1842"]

moveOrderCard(
  board,
  ["event_1841", "event_1842", "event_1843"],
  "event_1843",
  -1,
)
  -> ["event_1841", "event_1843", "event_1842"]

moveOrderCard(board, ["event_1841", "event_1842"], "event_1842", -1)
  -> unchanged

removeOrderCard(
  board,
  ["event_1841", "event_1842", "event_1843"],
  "event_1842",
)
  -> ["event_1841", "event_1843"]

removeOrderCard(board, ["event_1841", "event_1842"], "event_1841")
  -> unchanged
```

Also require a non-prefix anchor fixture (for example one anchor at position 2 without position 1) to throw/fail the supported-shape assertion.

- [ ] **Step 2: Run and confirm failure**

```bash
bun run --cwd apps/game test src/lib/analysis/order-draft.test.ts
```

- [ ] **Step 3: Implement the pure helper**

Use focused signatures:

```ts
type OrderBoardView = Extract<AnalysisBoardView, { kind: "order" }>;

export function assertSupportedPrefixAnchors(board: OrderBoardView): void;
export function materializePrefixAnchors(board: OrderBoardView, cardIds: string[]): string[];
export function addOrderCard(board: OrderBoardView, cardIds: string[], cardId: string): string[];
export function moveOrderCard(
  board: OrderBoardView,
  cardIds: string[],
  cardId: string,
  direction: -1 | 1,
): string[];
export function removeOrderCard(board: OrderBoardView, cardIds: string[], cardId: string): string[];
```

The helper may inspect only public fixed anchors/card IDs. It never compares against accepted order.

- [ ] **Step 4: Build the thin `OrderBoard.svelte`**

Runtime-narrow `board.draft.kind === "order"` before reading `cardIds`.

Render:

- numbered current sequence;
- fixed prefix card with `固定位置`, no move/remove controls;
- unplaced card pool;
- `加入時間線`, `上移`, `下移`, `移除` for movable available cards.

Unavailable cards cannot be added. Read-only boards expose no mutation buttons.

Every action delegates to `order-draft.ts` and emits:

```ts
onDraft({ kind: "order", cardIds: next }, `card:${cardId}`);
```

- [ ] **Step 5: Add component parity tests**

Prove:

- fixed anchor is locked;
- pointer/keyboard Add produces the same helper-derived draft;
- Up/Down/Remove call through structural drafts;
- unavailable unplaced cards are disabled;
- read-only boards cannot mutate.

- [ ] **Step 6: Verify**

```bash
bun run --cwd apps/game test \
  src/lib/analysis/order-draft.test.ts \
  src/lib/components/analysis/OrderBoard.test.ts
bun run --cwd apps/game check
```

- [ ] **Step 7: Commit**

```bash
git add apps/game/src/lib/analysis/order-draft.ts apps/game/src/lib/analysis/order-draft.test.ts apps/game/src/lib/components/analysis/OrderBoard.svelte apps/game/src/lib/components/analysis/OrderBoard.test.ts
git commit -m "feat(game-ui): add order analysis board"
```

---

### Task 4: Migrate Threshold UI Without Regressing P1

**Files:**
- Create: `apps/game/src/lib/components/analysis/ThresholdBoard.svelte`
- Create: `apps/game/src/lib/components/analysis/ThresholdBoard.test.ts`
- Reuse: `apps/game/src/lib/components/analysis/AnalysisCard.svelte`
- Reuse: `apps/game/src/lib/case-file/labels.ts`

**Interfaces:**
- Consumes: current threshold public board + current `Inventory`.
- Produces: sorted whole replacement threshold drafts via `onDraft(draft, focusKey)`.

- [ ] **Step 1: Migrate the current P1 regression tests before changing UI behavior**

Copy/reshape the useful current `AnalysisView.test.ts` coverage into `ThresholdBoard.test.ts`:

- all four P1 `practice` cards render;
- threshold toggle emits a whole threshold draft;
- selected card toggles off;
- authored incorrect feedback is renderable by the host/board contract;
- disabled/in-flight state blocks card mutation;
- completed/read-only state blocks card mutation.

This is a hard regression gate because P1 is already playable on `main`.

- [ ] **Step 2: Add Beat 8.5 threshold presentation tests**

Pin:

- progress text `已選 0 / 最少 2`;
- pointer/keyboard toggle parity;
- `card.available === false` disables toggling;
- selected IDs are emitted in deterministic lexical order;
- two cards sharing the same `sourceGroup.id` can still both be selected;
- evidence/statement cards can show `來源群組` / `來源` plus `程序` badges;
- practice cards do not attempt Case File inventory lookup and show no fabricated provenance badge.

- [ ] **Step 3: Implement threshold selection from `board.draft`**

Narrow the current generic draft:

```ts
if (board.draft.kind !== "threshold") {
  // defensive invalid-view state
}
```

Do **not** use the compatibility flat `board.selectedCardIds` as the new workbench source of truth.

Toggle:

```ts
const selected = new Set(board.draft.selectedCardIds);
if (selected.has(cardId)) selected.delete(cardId);
else selected.add(cardId);

onDraft(
  { kind: "threshold", selectedCardIds: [...selected].sort() },
  `card:${cardId}`,
);
```

Respect `card.available`, `board.readOnly`, and parent `disabled`.

- [ ] **Step 4: Render public provenance semantics without a local evaluator**

For evidence/statement cards:

1. resolve the referenced public inventory record by `card.source.kind/id`;
2. if it has a `sourceGroup`, render `來源群組：<label>`;
3. otherwise, if `provenance.sourceLabel` exists, render `來源：<label>`;
4. optional source-kind fallback may use existing `sourceKindLabels`;
5. if `proceduralStatusLabels[...]` returns a value, render `程序：<label>`.

Do not compare source groups between selected cards.

For `practice` source cards, skip inventory/provenance resolution.

- [ ] **Step 5: Verify**

```bash
bun run --cwd apps/game test src/lib/components/analysis/ThresholdBoard.test.ts
bun run --cwd apps/game check
```

- [ ] **Step 6: Commit**

```bash
git add apps/game/src/lib/components/analysis/ThresholdBoard.svelte apps/game/src/lib/components/analysis/ThresholdBoard.test.ts
git commit -m "feat(game-ui): generalize threshold analysis board"
```

---

### Task 5: Compose the Workbench, Enable Applied-State Undo, and Replace the Old AnalysisView

**Files:**
- Create: `apps/game/src/lib/components/analysis/AnalysisWorkbench.svelte`
- Create: `apps/game/src/lib/components/analysis/AnalysisWorkbench.test.ts`
- Modify: `apps/game/src/lib/state/game-client.svelte.ts`
- Modify: `apps/game/src/lib/state/game-client-source.test.ts`
- Modify: `apps/game/src/routes/+page.svelte`
- Modify: `apps/game/src/lib/state/mode.test.ts`
- Delete: `apps/game/src/lib/components/AnalysisView.svelte`
- Delete: `apps/game/src/lib/components/AnalysisView.test.ts`

**Interfaces:**
- Consumes: current Analysis mode/scene/inventory and the already-existing Analysis commands.
- Produces: the only production Analysis surface rendered by `+page.svelte`.

- [ ] **Step 1: Make the existing Analysis wrappers return applied authoritative state**

Current `dispatchAnalysisCommand` catches application failures but returns `void`. Keep that error behavior, but return the underlying dispatcher result:

```ts
async function dispatchAnalysisCommand(
  command: Extract<
    GameplayCommandName,
    "select_analysis_board" | "update_analysis_draft" | "submit_analysis_board"
  >,
  args: Record<string, unknown>,
): Promise<GameStateView | null> {
  try {
    return await dispatchGameCommand(command, args);
  } catch (error) {
    gameState.error = normalizeError(error);
    return null;
  }
}
```

Then have all three existing wrappers return that promise rather than `await` + discard it.

Do not change command names, payload keys, or Tauri handlers.

- [ ] **Step 2: Pin wrapper payload and return behavior in the existing game-client test**

Add a focused test to `game-client-source.test.ts` that:

- loads an Analysis state;
- mocks `update_analysis_draft` to return an authoritative next state;
- calls `updateAnalysisDraft(current.mode.actionToken, draft)`;
- asserts invoke received `{ expected: token, draft }`;
- asserts the wrapper returns the same applied next state and `gameState.value` is updated.

No new response-fence/generation test is required.

- [ ] **Step 3: Write workbench host tests**

Pin:

1. displayed board lookup uses `mode.boardId`;
2. available/completed board navigation calls `onSelectBoard(mode.actionToken, targetId)`;
3. unavailable board is not selectable;
4. Submit remains enabled on an editable incomplete draft;
5. successful draft update (`non-null` applied result) creates one-step Undo using the prior authoritative draft;
6. `null` update result does not create Undo;
7. Undo sends the previous draft through the same update command;
8. Reset sends the board-kind empty draft;
9. displayed board change clears Undo/Hint and focuses the new heading;
10. failed submit reflected as board feedback focuses the feedback region;
11. completed board shows `完成・只讀檢視` and no mutation/Undo/Reset/Submit controls.

- [ ] **Step 4: Implement common host state only**

Props:

```ts
scene: Extract<SceneView, { kind: "analysis" }>;
mode: Extract<Mode, { type: "analysis" }>;
inventory: Inventory;
onSelectBoard: typeof selectAnalysisBoard;
onUpdateDraft: typeof updateAnalysisDraft;
onSubmit: typeof submitAnalysisBoard;
disabled?: boolean;
```

Displayed board:

```ts
let board = $derived(
  scene.visibleBoards.find((candidate) => candidate.id === mode.boardId) ?? null,
);
```

Keep only presentation state:

```ts
let undoDraft = $state<AnalysisDraft | null>(null);
let undoBoardId = $state<string | null>(null);
let hintOpen = $state(false);
```

No copy of the current draft is kept outside the Rust-projected board view.

- [ ] **Step 5: Implement board navigation, Undo, Reset, Submit, and focus**

Board navigation:

- expose controls only for `candidate.available || candidate.completed`;
- call `onSelectBoard(mode.actionToken, candidate.id)`;
- never calculate unlocks.

Draft mutation:

1. clone `board.draft` as previous;
2. call `onUpdateDraft(mode.actionToken, candidateDraft)`;
3. only if result is non-null, retain previous as the one Undo slot;
4. return focus to requested focus key after authoritative rerender.

Reset sends the empty draft for the current board kind. Submit always calls Rust when the board is editable.

Feedback uses `board.feedback?.message`, text only, `role="status"`, `tabindex="-1"`.

- [ ] **Step 6: Replace the existing page-level component**

In `+page.svelte`:

- import existing `selectAnalysisBoard` alongside update/submit;
- replace `AnalysisView` import with `AnalysisWorkbench`;
- keep the existing `SceneBackdrop` branch;
- pass `scene`, `mode`, `inventory`, select/update/submit wrappers, and `gameState.inFlight`.

Do not edit `GameShell`, Scene Select, SFX command registration, or `state/types.ts`.

- [ ] **Step 7: Pin existing Case File behavior for Analysis**

Add an Analysis mode fixture to `mode.test.ts` and assert:

```ts
expect(shouldShowCaseFile(analysisMode)).toBe(true);
expect(canReexamineCaseRecords(analysisMode)).toBe(false);
```

No `mode.ts` production change should be needed.

- [ ] **Step 8: Delete the superseded threshold-only surface**

After its P1 tests have been migrated and are passing:

```bash
rm apps/game/src/lib/components/AnalysisView.svelte
rm apps/game/src/lib/components/AnalysisView.test.ts
```

Verify no old import remains:

```bash
git grep -n 'AnalysisView' -- apps/game/src || true
```

Expected final output: no matches.

- [ ] **Step 9: Verify focused integration**

```bash
bun run --cwd apps/game test \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/state/game-client-source.test.ts \
  src/lib/state/mode.test.ts
bun run --cwd apps/game check
```

- [ ] **Step 10: Commit**

```bash
git add apps/game/src/lib/components/analysis apps/game/src/lib/state/game-client.svelte.ts apps/game/src/lib/state/game-client-source.test.ts apps/game/src/lib/state/mode.test.ts apps/game/src/routes/+page.svelte apps/game/src/lib/components/AnalysisView.svelte apps/game/src/lib/components/AnalysisView.test.ts
git commit -m "feat(game-ui): integrate analysis workbench"
```

---

### Task 6: Run Frontend Acceptance and Prepare the Smaller HPA-262 Handoff

**Files:**
- Modify only tests/docs if verification exposes a concrete gap. Do not widen feature scope.

**Interfaces:**
- Consumes: Tasks 1–5 complete.
- Produces: frontend acceptance evidence and explicit remaining live-content acceptance for HPA-262.

- [ ] **Step 1: Run the full Analysis-focused frontend suite**

```bash
bun run --cwd apps/game test \
  src/lib/analysis/analysis-boundary.test.ts \
  src/lib/analysis/order-draft.test.ts \
  src/lib/components/analysis/ClassifyBoard.test.ts \
  src/lib/components/analysis/OrderBoard.test.ts \
  src/lib/components/analysis/ThresholdBoard.test.ts \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/state/game-client-source.test.ts \
  src/lib/state/mode.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repository-level frontend validation**

```bash
bun run --cwd apps/game test
bun run --cwd apps/game check
bun run --cwd apps/game check:e2e
bun run lint:all
```

Expected: all commands exit 0. `lint:all` is repository cleanliness, not a new HPA-260 runtime acceptance gate.

- [ ] **Step 3: Re-run ownership and migration checks**

```bash
git grep -nE 'acceptedGroupByCard|acceptedOrder|acceptedSelections' \
  -- apps/game/src/lib/analysis apps/game/src/lib/components/analysis || true

git grep -n 'AnalysisView' -- apps/game/src || true
```

Expected: no matches.

Confirm the new components use `board.draft` rather than the threshold compatibility alias:

```bash
git grep -n 'selectedCardIds' -- apps/game/src/lib/components/analysis
```

Review the matches: they must be threshold draft handling/tests, not a second mutable board model.

- [ ] **Step 4: Keyboard-only component acceptance**

Through Testing Library/native controls prove a player can:

- classify every available card with Tab + Enter/Space;
- move/remove classifications;
- add/reorder/remove every movable order card without moving the fixed anchor;
- toggle threshold cards;
- use Undo/Reset/Submit;
- receive textual feedback and useful focus return;
- reopen a completed board read-only.

No drag path is required.

- [ ] **Step 5: Record HPA-262 remaining integration items in the implementation PR**

HPA-262 now needs to prove only the real cross-layer/content acceptance still outside HPA-261:

1. real authored Beat 8.5 classify/order/threshold content renders through the merged Rust runtime into this workbench;
2. one representative partial draft for each real board survives Save -> Title -> Continue;
3. authored fixed anchor behavior matches the real order board;
4. real threshold source/procedure labels are understandable from Chapter 1 provenance;
5. correct submit commits facts/objective/result dialogue exactly once;
6. completed boards reopen read-only;
7. one packaged keyboard-only flow completes all three real Beat 8.5 boards;
8. the already-playable P1 practice threshold tutorial still works after the UI replacement.

Do not repeat HPA-260’s runtime/save unit acceptance inside HPA-261.

- [ ] **Step 6: Commit any acceptance-only correction**

If verification required a test-only correction:

```bash
git add apps/game/src/lib apps/game/src/routes
git commit -m "test(game-ui): accept analysis workbench"
```

If no files changed, do not create an empty commit.

---

## Self-Review Checklist

Before implementation starts:

- [ ] The implementation branch starts from/rebases onto current `main` with HPA-260 merged.
- [ ] No task recreates Analysis TypeScript wire types or Tauri command names.
- [ ] `mode.boardId` remains the displayed board; `mode.actionToken` remains the mutation fence.
- [ ] No task collapses `boardId` and `activeBoardId`.
- [ ] P1 `practice:` threshold behavior is a hard regression gate.
- [ ] All mutation controls respect public card/board availability/read-only state.
- [ ] No frontend accepted-answer or threshold-evaluator data exists.
- [ ] No extra frontend response-fence/generation/dispatcher is added.
- [ ] Order algebra is pure/tested and remains prefix-anchor-only.
- [ ] Threshold uses `draft.selectedCardIds`, not the compatibility flat field as its source of truth.
- [ ] Practice cards do not require Case File provenance.
- [ ] Beat 8.5 source-group/procedure badges are presentation only.
- [ ] One-step Undo is recorded only after a non-null authoritative update result.
- [ ] Existing Scene Select/SFX/types/runtime/save code is reused unchanged.
- [ ] Old `AnalysisView` is removed only after its useful P1 tests are migrated.
- [ ] HPA-262 remains the real authored/save/packaged acceptance owner.

## Execution Handoff

The plan is now intentionally smaller than the original HPA-261 draft because HPA-260 has landed. Implementation should use subagent-driven development task-by-task where available, or execute inline with the same test-first gates.

Do not rebuild infrastructure that already exists. Complete the UI, preserve P1, and hand the real authored vertical-slice acceptance to HPA-262.
