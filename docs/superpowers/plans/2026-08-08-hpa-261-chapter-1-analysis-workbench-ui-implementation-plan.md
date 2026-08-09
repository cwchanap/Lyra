# HPA-261 Chapter 1 Analysis Workbench UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Chapter 1 Beat 8.5 Analysis workbench in Svelte so classify, order, and threshold boards are fully playable with pointer or keyboard while Rust remains the only owner of correctness and durable state.

**Architecture:** Mirror HPA-260's answer-key-free public Analysis view directly in existing frontend state types. Render it through one `AnalysisWorkbench` and three focused board components. Every edit sends a complete `AnalysisDraft` through the existing gameplay dispatcher; there is no optimistic/persistent frontend Analysis store. Pure helpers own the two reusable presentation rules that deserve isolated tests: stale-response fencing and the real Chapter 1 prefix-anchor order algebra.

**Tech Stack:** Svelte 5, TypeScript, Tauri 2 command client, existing `GameStateView` / `GameShell`, Vitest, Testing Library Svelte, current Case File provenance labels/helpers.

## Global Constraints

- Support exactly Chapter 1 `classify`, `order`, and `threshold`.
- Do not add drag-and-drop, graph/canvas editing, a renderer registry, compare/route/chain abstractions, or a generic sparse-anchor order editor.
- TypeScript must not contain accepted mappings, accepted orders, accepted threshold selections, source-independence truth, eligibility truth, or durable reveal logic.
- Render only public boards exposed by Rust; never synthesize hidden/locked boards.
- Active-board identity comes only from `AnalysisActionToken.activeBoardId`; do not add a duplicate `mode.boardId` field.
- HPA-260 command names are `select_analysis_board`, `update_analysis_draft`, and `submit_analysis_board`; intro/result/outro continue through `advance_dialogue`.
- Workbench edits render only after authoritative command responses; no optimistic Analysis state model.
- Keep existing `gameState.inFlight`, `GameShell` Escape ownership, Case File behavior, acquisition popup behavior, audio routing, and persistence overlays.
- Case File remains visible in Analysis, while record re-examination remains disabled.
- Submit stays available on editable incomplete drafts so Rust can return authored `Incomplete` feedback.
- Completed boards are read-only.
- Threshold selections are emitted in deterministic lexical ID order.
- No new npm/Bun dependency is required.
- PR #44 is not a dependency. If it lands first, remove its entire temporary Analysis component/command/type/route surface while wiring the final workbench.
- If HPA-260's final serialized field spelling differs from this plan, mirror Rust exactly in Task 1; do not add an adapter DTO family.

---

## File Structure

### Create

- `apps/game/src/lib/analysis/beat-8-5-fixture.ts`
- `apps/game/src/lib/analysis/analysis-boundary.test.ts`
- `apps/game/src/lib/analysis/response-fence.ts`
- `apps/game/src/lib/analysis/response-fence.test.ts`
- `apps/game/src/lib/analysis/order-draft.ts`
- `apps/game/src/lib/analysis/order-draft.test.ts`
- `apps/game/src/lib/case-file/labels.test.ts`
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

- `apps/game/src/lib/state/types.ts`
- `apps/game/src/lib/state/game-client.svelte.ts`
- `apps/game/src/lib/state/game-client-source.test.ts`
- `apps/game/src/lib/state/mode.test.ts`
- `apps/game/src/lib/audio/sfx-events.ts`
- `apps/game/src/lib/audio/sfx-events.test.ts`
- `apps/game/src/lib/case-file/labels.ts`
- `apps/game/src/lib/components/case-file/CaseFileRecordDetail.svelte`
- `apps/game/src/routes/+page.svelte`
- `apps/game/src/lib/components/SceneNavigationPanel.svelte`
- `apps/game/src/lib/components/SceneNavigationPanel.test.ts`

### Delete only if present after rebasing

- `apps/game/src/lib/components/AnalysisView.svelte`
- `apps/game/src/lib/components/AnalysisView.test.ts`

Also remove PR #44's temporary `setAnalysisSelection` / `submitAnalysisSelection`, `set_analysis_selection` / `submit_analysis_selection`, and flat threshold-board frontend shape wherever they appear.

### Intentionally do not modify

- `apps/game/src/lib/state/mode.ts` behavior;
- `apps/game/src/lib/components/GameShell.svelte`;
- Rust runtime/schema/save files;
- compiler Analysis parser/validator/emitter.

---

### Task 1: Add the answer-key-free frontend Analysis contract and Beat 8.5 fixture

**Files:**
- Create: `apps/game/src/lib/analysis/beat-8-5-fixture.ts`
- Create: `apps/game/src/lib/analysis/analysis-boundary.test.ts`
- Modify: `apps/game/src/lib/state/types.ts`

**Interfaces:**
- Consumes: existing `InventoryTarget`, `Inventory`, `VisualAssetCue`.
- Produces: `AnalysisActionToken`, `AnalysisDraft`, `AnalysisFeedbackView`, public board/card/group/fixed-anchor views, Analysis `Mode`, Analysis `SceneView`.

- [ ] **Step 1: Write the failing ownership-boundary test**

Create `analysis-boundary.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { beat85AnalysisSceneFixture } from "./beat-8-5-fixture";

const HIDDEN_KEYS = [
  "acceptedGroupByCard",
  "acceptedOrder",
  "acceptedSelections",
];

describe("Analysis frontend ownership boundary", () => {
  it("contains all three Chapter 1 board kinds without answer keys", () => {
    expect(beat85AnalysisSceneFixture.visibleBoards.map((b) => b.kind)).toEqual([
      "classify",
      "order",
      "threshold",
    ]);
    const json = JSON.stringify(beat85AnalysisSceneFixture);
    for (const key of HIDDEN_KEYS) expect(json).not.toContain(key);
  });

  it("keeps hidden answer-key names out of Analysis feature source", () => {
    const files = [
      "src/lib/analysis/beat-8-5-fixture.ts",
      "src/lib/components/analysis/ClassifyBoard.svelte",
      "src/lib/components/analysis/OrderBoard.svelte",
      "src/lib/components/analysis/ThresholdBoard.svelte",
      "src/lib/components/analysis/AnalysisWorkbench.svelte",
    ];
    const source = files.flatMap((path) => {
      try { return [readFileSync(path, "utf8")]; } catch { return []; }
    }).join("\n");
    for (const key of HIDDEN_KEYS) expect(source).not.toContain(key);
  });
});
```

- [ ] **Step 2: Run it and confirm the initial failure**

```bash
bun run --cwd apps/game test src/lib/analysis/analysis-boundary.test.ts
```

Expected: FAIL because the fixture/types do not exist on current `main`.

- [ ] **Step 3: Mirror HPA-260's public types**

Add to `state/types.ts`:

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

type AnalysisBoardCommon = {
  id: string;
  label: string;
  prompt: string;
  cards: AnalysisCardView[];
  completed: boolean;
  readOnly: boolean;
  feedback: AnalysisFeedbackView;
  hint: string | null;
};

export type AnalysisBoardView =
  | (AnalysisBoardCommon & {
      kind: "classify";
      groups: AnalysisGroupView[];
      draft: Extract<AnalysisDraft, { kind: "classify" }>;
    })
  | (AnalysisBoardCommon & {
      kind: "order";
      fixedAnchors: AnalysisFixedAnchorView[];
      draft: Extract<AnalysisDraft, { kind: "order" }>;
    })
  | (AnalysisBoardCommon & {
      kind: "threshold";
      minimumSelected: number;
      draft: Extract<AnalysisDraft, { kind: "threshold" }>;
    });
```

Add exactly one Analysis mode identity:

```ts
| ({
    type: "analysis";
    actionToken: AnalysisActionToken;
  } & VisualAssetCue)
```

Add the Analysis `SceneView` arm with `visibleBoards: AnalysisBoardView[]`, and extend `SceneNavigationIndex` scene type with `"analysis"`.

Do **not** add `mode.boardId`.

- [ ] **Step 4: Add the answer-key-free Beat 8.5 fixture**

Use the real HPA-259 public IDs/labels:

- scene `analysis_scene_8_5`;
- classify board `evidence_packages` with `miyake_call`, `l_corridor_replay`, `external_credential_event` and the two public groups;
- order board `local_event_sequence` with `event_1841` through `event_1844` and `fixedAnchors: [{ cardId: "event_1841", position: 1 }]`;
- threshold board `narrow_request_basis` with `lock_sequence`, `phone_notification`, `manager_timing`, `minimumSelected: 2`;
- only empty/current public drafts, never accepted solutions.

The fixture's Analysis token starts with:

```ts
export const beat85ActionTokenFixture: AnalysisActionToken = {
  sceneId: "analysis_scene_8_5",
  activeBoardId: "evidence_packages",
  durableRevision: 41,
};
```

Add only the evidence/statement inventory rows needed by threshold source/procedure presentation tests.

- [ ] **Step 5: Verify focused tests and types**

```bash
bun run --cwd apps/game test src/lib/analysis/analysis-boundary.test.ts
bun run --cwd apps/game check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/game/src/lib/state/types.ts apps/game/src/lib/analysis/beat-8-5-fixture.ts apps/game/src/lib/analysis/analysis-boundary.test.ts
git commit -m "feat(game-ui): add analysis public view contract"
```

---

### Task 2: Add semantic command wrappers and prove stale-response fencing

**Files:**
- Create: `apps/game/src/lib/analysis/response-fence.ts`
- Create: `apps/game/src/lib/analysis/response-fence.test.ts`
- Modify: `apps/game/src/lib/state/game-client.svelte.ts`
- Modify: `apps/game/src/lib/state/game-client-source.test.ts`
- Modify: `apps/game/src/lib/audio/sfx-events.ts`
- Modify: `apps/game/src/lib/audio/sfx-events.test.ts`

**Interfaces:**
- Consumes: `AnalysisActionToken`, `AnalysisDraft`, existing `presentationState.sessionEpoch`, `dispatchGameCommand`, `MUTATING_GAMEPLAY_COMMANDS`.
- Produces: `selectAnalysisBoard`, `updateAnalysisDraft`, `submitAnalysisBoard` returning `Promise<GameStateView | null>`.

- [ ] **Step 1: Write pure fence tests**

Create `response-fence.test.ts` with cases for:

- same epoch + same token => true;
- replaced epoch => false;
- changed durable revision => false;
- changed active board => false;
- non-Analysis current mode => false.

Implementation target:

```ts
export function sameAnalysisActionToken(
  left: AnalysisActionToken,
  right: AnalysisActionToken,
): boolean {
  return left.sceneId === right.sceneId &&
    left.activeBoardId === right.activeBoardId &&
    left.durableRevision === right.durableRevision;
}

export function isAnalysisResponseCurrent(
  current: GameStateView | null,
  capturedEpoch: number,
  currentEpoch: number,
  expected: AnalysisActionToken,
): boolean {
  return capturedEpoch === currentEpoch &&
    current?.mode.type === "analysis" &&
    sameAnalysisActionToken(current.mode.actionToken, expected);
}
```

- [ ] **Step 2: Run the pure test and confirm failure**

```bash
bun run --cwd apps/game test src/lib/analysis/response-fence.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Add one optional response guard to the existing dispatcher**

Change only the existing dispatcher signature/application point:

```ts
async function dispatchGameCommand(
  command: GameplayCommandName,
  args?: Record<string, unknown>,
  loading = false,
  acceptResponse?: () => boolean,
): Promise<GameStateView | null> {
  // preserve the existing inFlight/loading/finally behavior
  const previous = gameState.value;
  const response = await runCommand<GameplayCommandResultView>(command, args);
  if (response && (acceptResponse?.() ?? true)) {
    return applyGameplayCommandResult(response, (next) => {
      // preserve the existing SFX inference/playback body unchanged
    });
  }
  return null;
}
```

Do not create another dispatcher or Analysis-owned generation.

- [ ] **Step 4: Add the three wrappers**

```ts
function analysisResponseGuard(expected: AnalysisActionToken): () => boolean {
  const capturedEpoch = presentationState.sessionEpoch;
  return () => isAnalysisResponseCurrent(
    gameState.value,
    capturedEpoch,
    presentationState.sessionEpoch,
    expected,
  );
}

export function selectAnalysisBoard(expected: AnalysisActionToken, boardId: string) {
  return dispatchGameCommand(
    "select_analysis_board",
    { expected, boardId },
    false,
    analysisResponseGuard(expected),
  );
}

export function updateAnalysisDraft(expected: AnalysisActionToken, draft: AnalysisDraft) {
  return dispatchGameCommand(
    "update_analysis_draft",
    { expected, draft },
    false,
    analysisResponseGuard(expected),
  );
}

export function submitAnalysisBoard(expected: AnalysisActionToken) {
  return dispatchGameCommand(
    "submit_analysis_board",
    { expected },
    false,
    analysisResponseGuard(expected),
  );
}
```

- [ ] **Step 5: Add a dispatcher wiring regression test**

In existing `game-client-source.test.ts`, add an `analysisState(activeBoardId, durableRevision)` helper using the Task 1 public type. Then add:

```ts
it("drops a late Analysis response after the frontend session is replaced", async () => {
  const current = analysisState("evidence_packages", 41);
  const staleResponse = analysisState("evidence_packages", 42);
  const client = await loadGameClient(current);
  let resolveInvoke!: (value: GameStateView) => void;

  mocks.invoke.mockReturnValueOnce(new Promise<GameStateView>((resolve) => {
    resolveInvoke = resolve;
  }));

  if (current.mode.type !== "analysis") {
    throw new Error("analysisState must return Analysis mode");
  }
  const expected = current.mode.actionToken;
  const command = client.updateAnalysisDraft(expected, {
    kind: "classify",
    groupByCard: { miyake_call: "miyake_small_lies" },
  });

  client.resetFrontendForTitle();
  resolveInvoke(staleResponse);

  await expect(command).resolves.toBeNull();
  expect(client.gameState.value).toBeNull();
});
```

This verifies the actual dispatcher hook, not only the pure predicate.

- [ ] **Step 6: Register all three commands in both existing command surfaces**

In `sfx-events.ts`, extend `GameplayCommandName` with:

```ts
| "select_analysis_board"
| "update_analysis_draft"
| "submit_analysis_board"
```

In existing `MUTATING_GAMEPLAY_COMMANDS` in `game-client.svelte.ts`, add the same three names.

In `sfx-events.test.ts`, update the exhaustive `Record<GameplayCommandName, true>` and change the explicit count from 14 to 17. Add no SFX assets/events.

- [ ] **Step 7: Verify**

```bash
bun run --cwd apps/game test src/lib/analysis/response-fence.test.ts src/lib/state/game-client-source.test.ts src/lib/audio/sfx-events.test.ts
bun run --cwd apps/game check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/game/src/lib/analysis/response-fence.ts apps/game/src/lib/analysis/response-fence.test.ts apps/game/src/lib/state/game-client.svelte.ts apps/game/src/lib/state/game-client-source.test.ts apps/game/src/lib/audio/sfx-events.ts apps/game/src/lib/audio/sfx-events.test.ts
git commit -m "feat(game-ui): add analysis command fencing"
```

---

### Task 3: Build shared card presentation and classify interaction

**Files:**
- Create: `apps/game/src/lib/components/analysis/AnalysisCard.svelte`
- Create: `apps/game/src/lib/components/analysis/ClassifyBoard.svelte`
- Create: `apps/game/src/lib/components/analysis/ClassifyBoard.test.ts`

**Interfaces:**
- Consumes: classify `AnalysisBoardView`.
- Produces: full replacement classify drafts through `onDraft(draft, focusKey)`.

- [ ] **Step 1: Write failing pointer/keyboard, move, and remove tests**

Pin:

1. click card + click group and keyboard Enter/Space produce the same draft;
2. selecting an already-assigned card and assigning another group emits a moved mapping;
3. `移除` deletes exactly that card mapping.

Removal test:

```ts
it("removes an assigned card back to the unassigned pool", async () => {
  const assigned = {
    ...board,
    draft: {
      kind: "classify" as const,
      groupByCard: { miyake_call: "miyake_small_lies" },
    },
  };
  const onDraft = vi.fn();
  const user = userEvent.setup();
  render(ClassifyBoard, { board: assigned, disabled: false, onDraft });

  await user.click(screen.getByRole("button", { name: /三宅母親通話紀錄.*移除/ }));
  expect(onDraft).toHaveBeenLastCalledWith(
    { kind: "classify", groupByCard: {} },
    "card:miyake_call",
  );
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
bun run --cwd apps/game test src/lib/components/analysis/ClassifyBoard.test.ts
```

Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement `AnalysisCard` and classify component**

Use native buttons only. Component-local state may remember `selectedCardId`, but the authoritative assignment map always comes from `board.draft.groupByCard`.

Assignment:

```ts
function assign(cardId: string, groupId: string) {
  if (board.readOnly || disabled) return;
  onDraft(
    {
      kind: "classify",
      groupByCard: { ...board.draft.groupByCard, [cardId]: groupId },
    },
    `card:${cardId}`,
  );
}
```

Removal:

```ts
function remove(cardId: string) {
  if (board.readOnly || disabled) return;
  const next = { ...board.draft.groupByCard };
  delete next[cardId];
  onDraft({ kind: "classify", groupByCard: next }, `card:${cardId}`);
}
```

Use labelled pool/group sections and visible focus styles. Do not render correctness colors.

- [ ] **Step 4: Add reduced-motion fallback**

```css
button:focus-visible {
  outline: 2px solid var(--cyan);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  button { transition: none; }
}
```

- [ ] **Step 5: Verify**

```bash
bun run --cwd apps/game test src/lib/components/analysis/ClassifyBoard.test.ts
bun run --cwd apps/game check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/game/src/lib/components/analysis/AnalysisCard.svelte apps/game/src/lib/components/analysis/ClassifyBoard.svelte apps/game/src/lib/components/analysis/ClassifyBoard.test.ts
git commit -m "feat(game-ui): add classify analysis board"
```

---

### Task 4: Add tested Chapter 1 order-draft algebra and order UI

**Files:**
- Create: `apps/game/src/lib/analysis/order-draft.ts`
- Create: `apps/game/src/lib/analysis/order-draft.test.ts`
- Create: `apps/game/src/lib/components/analysis/OrderBoard.svelte`
- Create: `apps/game/src/lib/components/analysis/OrderBoard.test.ts`

**Interfaces:**
- Consumes: order public board + public fixed anchors.
- Produces: structural order drafts only.
- Chapter 1 contract: supported anchors must form a contiguous prefix; current fixture is exactly `event_1841@1`.

- [ ] **Step 1: Write table-driven pure tests first**

Create `order-draft.test.ts` and pin:

```ts
expect(board.fixedAnchors).toEqual([{ cardId: "event_1841", position: 1 }]);
```

Table/boundary cases:

```ts
it.each([
  ["materializes prefix on first add", [], "event_1842", ["event_1841", "event_1842"]],
  ["does not duplicate anchor", ["event_1841"], "event_1842", ["event_1841", "event_1842"]],
])("%s", (_name, current, cardId, expected) => {
  expect(addOrderCard(board, current, cardId)).toEqual(expected);
});

it("moves a movable card without crossing the fixed prefix", () => {
  expect(moveOrderCard(board, ["event_1841", "event_1842", "event_1843"], "event_1843", -1))
    .toEqual(["event_1841", "event_1843", "event_1842"]);
  expect(moveOrderCard(board, ["event_1841", "event_1842"], "event_1842", -1))
    .toEqual(["event_1841", "event_1842"]);
});

it("removes movable cards but never the fixed prefix", () => {
  expect(removeOrderCard(board, ["event_1841", "event_1842", "event_1843"], "event_1842"))
    .toEqual(["event_1841", "event_1843"]);
  expect(removeOrderCard(board, ["event_1841", "event_1842"], "event_1841"))
    .toEqual(["event_1841", "event_1842"]);
});

it("rejects a non-prefix fixed-anchor shape", () => {
  expect(() => assertSupportedPrefixAnchors({
    ...board,
    fixedAnchors: [{ cardId: "event_1842", position: 2 }],
  })).toThrow(/prefix/i);
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
bun run --cwd apps/game test src/lib/analysis/order-draft.test.ts
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement the pure helper**

Use signatures:

```ts
type OrderBoardView = Extract<AnalysisBoardView, { kind: "order" }>;

export function assertSupportedPrefixAnchors(board: OrderBoardView): void;
export function materializePrefixAnchors(board: OrderBoardView, cardIds: string[]): string[];
export function addOrderCard(board: OrderBoardView, cardIds: string[], cardId: string): string[];
export function moveOrderCard(board: OrderBoardView, cardIds: string[], cardId: string, direction: -1 | 1): string[];
export function removeOrderCard(board: OrderBoardView, cardIds: string[], cardId: string): string[];
```

`assertSupportedPrefixAnchors` sorts anchors by position and requires positions `1..N`. `materializePrefixAnchors` prepends those public anchor IDs and removes duplicate copies from the movable remainder. Movement may reorder only indices after the fixed prefix. No function compares against hidden accepted order.

- [ ] **Step 4: Build `OrderBoard.svelte` as a thin presentation layer**

Render:

- `<ol aria-label="本機事件順序">`;
- fixed prefix card with `固定位置`, no mutation controls;
- unplaced card pool;
- movable buttons `加入時間線`, `上移`, `下移`, `移除`.

Every handler delegates to the pure helper and emits:

```ts
onDraft({ kind: "order", cardIds: next }, `card:${cardId}`);
```

- [ ] **Step 5: Add component parity tests**

Component tests prove:

- fixed anchor is locked/no move/remove controls;
- pointer and keyboard `加入時間線` emit the same helper-produced draft;
- a prepared public draft exposes `上移` / `下移` / `移除` controls and each emits through `onDraft`.

Pure helper tests own permutation/boundary correctness.

- [ ] **Step 6: Verify**

```bash
bun run --cwd apps/game test src/lib/analysis/order-draft.test.ts src/lib/components/analysis/OrderBoard.test.ts
bun run --cwd apps/game check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/game/src/lib/analysis/order-draft.ts apps/game/src/lib/analysis/order-draft.test.ts apps/game/src/lib/components/analysis/OrderBoard.svelte apps/game/src/lib/components/analysis/OrderBoard.test.ts
git commit -m "feat(game-ui): add order analysis board"
```

---

### Task 5: Build threshold selection with shared Case File source text

**Files:**
- Create: `apps/game/src/lib/case-file/labels.test.ts`
- Modify: `apps/game/src/lib/case-file/labels.ts`
- Modify: `apps/game/src/lib/components/case-file/CaseFileRecordDetail.svelte`
- Create: `apps/game/src/lib/components/analysis/ThresholdBoard.svelte`
- Create: `apps/game/src/lib/components/analysis/ThresholdBoard.test.ts`

**Interfaces:**
- Consumes: threshold board + current `Inventory`.
- Produces: sorted full replacement threshold drafts.
- Shared helper: `caseRecordSourceText(record): string | null`.

- [ ] **Step 1: Write a failing pure source-text precedence test**

Create `apps/game/src/lib/case-file/labels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { caseRecordSourceText } from "./labels";

function sourceOnly(sourceLabel: string | null, groupLabel: string | null) {
  return {
    provenance: { sourceLabel },
    sourceGroup: groupLabel === null ? null : { label: groupLabel },
  } as Parameters<typeof caseRecordSourceText>[0];
}

describe("caseRecordSourceText", () => {
  it("prefers the existing Case File sourceLabel over source-group label", () => {
    expect(caseRecordSourceText(sourceOnly("雨鐘後場門鎖", "門鎖本機")))
      .toBe("雨鐘後場門鎖");
  });

  it("falls back to source-group label when sourceLabel is absent", () => {
    expect(caseRecordSourceText(sourceOnly(null, "門鎖本機")))
      .toBe("門鎖本機");
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
bun run --cwd apps/game test src/lib/case-file/labels.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Extract the shared helper without changing Case File behavior**

In `case-file/labels.ts`:

```ts
export function caseRecordSourceText(
  record: EvidenceRecord | StatementRecord,
): string | null {
  return record.provenance.sourceLabel ?? record.sourceGroup?.label ?? null;
}
```

Update `CaseFileRecordDetail.svelte` to derive `sourceText` through that function. Keep its existing separate source-kind/procedure/completeness/confidence rendering unchanged.

- [ ] **Step 4: Write threshold tests**

Pin:

- the lock record source badge is `雨鐘後場門鎖` (not `門鎖本機`) because Case File source label takes precedence;
- procedure badge `重新取得` renders;
- progress shows `已選 0 / 最少 2`;
- pointer and keyboard produce the same selection draft;
- selected IDs are emitted sorted;
- a fixture clone with two cards sharing `sourceGroup.id` can select both.

- [ ] **Step 5: Implement public presentation only**

Record lookup:

```ts
function recordFor(source: InventoryTarget) {
  return source.kind === "evidence"
    ? inventory.evidence.find((record) => record.id === source.id) ?? null
    : inventory.statements.find((record) => record.id === source.id) ?? null;
}
```

Badges:

```ts
const source = caseRecordSourceText(record) ??
  sourceKindLabels[record.provenance.sourceKind] ??
  null;
const procedure =
  proceduralStatusLabels[record.provenance.proceduralStatus] ?? null;
```

Do not compare source-group IDs across selected cards.

Toggle:

```ts
function toggle(cardId: string) {
  if (board.readOnly || disabled) return;
  const selected = new Set(board.draft.selectedCardIds);
  if (selected.has(cardId)) selected.delete(cardId);
  else selected.add(cardId);
  onDraft(
    { kind: "threshold", selectedCardIds: [...selected].sort() },
    `card:${cardId}`,
  );
}
```

- [ ] **Step 6: Verify**

```bash
bun run --cwd apps/game test src/lib/case-file/labels.test.ts src/lib/components/analysis/ThresholdBoard.test.ts
bun run --cwd apps/game check
```

Run the existing focused Case File component tests that cover `CaseFileRecordDetail` after the helper extraction.

Expected: PASS with unchanged Case File presentation behavior.

- [ ] **Step 7: Commit**

```bash
git add apps/game/src/lib/case-file/labels.ts apps/game/src/lib/case-file/labels.test.ts apps/game/src/lib/components/case-file/CaseFileRecordDetail.svelte apps/game/src/lib/components/analysis/ThresholdBoard.svelte apps/game/src/lib/components/analysis/ThresholdBoard.test.ts
git commit -m "feat(game-ui): add threshold analysis board"
```

---

### Task 6: Compose the workbench, focus behavior, route, mode pins, and PR #44 cleanup

**Files:**
- Create: `apps/game/src/lib/components/analysis/AnalysisWorkbench.svelte`
- Create: `apps/game/src/lib/components/analysis/AnalysisWorkbench.test.ts`
- Modify: `apps/game/src/routes/+page.svelte`
- Modify: `apps/game/src/lib/state/mode.test.ts`
- Modify: `apps/game/src/lib/components/SceneNavigationPanel.svelte`
- Modify: `apps/game/src/lib/components/SceneNavigationPanel.test.ts`
- Delete if present: temporary `AnalysisView.svelte` / `.test.ts`
- Clean if present: temporary PR #44 command/type/route surface.

**Interfaces:**
- Consumes: Analysis scene/mode/inventory + Tasks 2–5 components/wrappers.
- Produces: the only production Analysis surface rendered by the game page.

- [ ] **Step 1: Write host tests before implementation**

Pin:

1. active board is derived from `mode.actionToken.activeBoardId`;
2. Back selects the previous visible board through `onSelectBoard`;
3. Submit remains enabled on editable incomplete drafts;
4. Reset sends the board-kind empty draft through `onUpdateDraft`;
5. successful edit makes one-step Undo available and Undo sends the previous public draft;
6. switching `activeBoardId` via reactive rerender clears Undo and focuses the new heading;
7. failed submit response with `feedback.message` focuses the feedback region;
8. completed board shows `完成・只讀檢視` and no mutation controls;
9. `activeBoardId: null` renders neutral no-active-board state and no submit control.

Board-switch Undo regression:

```ts
it("clears one-step Undo when Rust switches the active board", async () => {
  const { rerender } = renderWorkbench({ activeBoardId: "evidence_packages" });
  await performSuccessfulEdit();
  expect(screen.getByRole("button", { name: "復原" })).toBeInTheDocument();

  await rerender(propsFor("local_event_sequence"));
  expect(screen.queryByRole("button", { name: "復原" })).toBeNull();
  expect(screen.getByRole("heading", { name: "本機事件順序" })).toHaveFocus();
});
```

The local test harness must implement `performSuccessfulEdit()` by invoking a real rendered board control and rerendering with the authoritative fixture response, and `propsFor(boardId)` by cloning the fixture token with that `activeBoardId`; do not bypass workbench handlers.

- [ ] **Step 2: Run and confirm failure**

```bash
bun run --cwd apps/game test src/lib/components/analysis/AnalysisWorkbench.test.ts
```

Expected: FAIL because workbench does not exist.

- [ ] **Step 3: Implement host with presentation-only state**

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

Derived active board:

```ts
let activeBoardId = $derived(mode.actionToken.activeBoardId);
let board = $derived(
  activeBoardId === null
    ? null
    : scene.visibleBoards.find((candidate) => candidate.id === activeBoardId) ?? null,
);
```

Presentation state only:

```ts
let undoDraft = $state<AnalysisDraft | null>(null);
let undoBoardId = $state<string | null>(null);
let hintOpen = $state(false);
```

On board ID change, clear Undo/hint and `tick()` focus to the board heading.

After failed submit, focus:

```svelte
<p role="status" tabindex="-1" bind:this={feedbackElement}>{board.feedback.message}</p>
```

- [ ] **Step 4: Wire one-step Undo and Reset through Rust**

On an accepted edit response, retain the previous authoritative public draft as the one Undo slot. Undo calls `onUpdateDraft` with that draft. Reset sends the board-kind empty draft. Neither mutates `scene` locally.

- [ ] **Step 5: Route Analysis through the existing page shell**

In `+page.svelte`, import the three wrappers and `AnalysisWorkbench`, then add beside interrogation:

```svelte
{:else if gameState.value.mode.type === "analysis" && gameState.value.scene.kind === "analysis"}
  <SceneBackdrop
    sceneTag={null}
    backgroundAssetId={gameState.value.mode.backgroundAssetId ?? null}
  />
  <AnalysisWorkbench
    scene={gameState.value.scene}
    mode={gameState.value.mode}
    inventory={gameState.value.inventory}
    onSelectBoard={selectAnalysisBoard}
    onUpdateDraft={updateAnalysisDraft}
    onSubmit={submitAnalysisBoard}
    disabled={gameState.inFlight}
  />
```

Do not modify `GameShell.svelte`.

- [ ] **Step 6: Pin Case File behavior for Analysis**

In existing `mode.test.ts`, create an Analysis mode using an action token and assert:

```ts
expect(shouldShowCaseFile(analysisMode)).toBe(true);
expect(canReexamineCaseRecords(analysisMode)).toBe(false);
```

`mode.ts` itself should not require a behavior change.

- [ ] **Step 7: Add Scene Select label**

Extend `sceneTypeLabel`:

```ts
if (type === "analysis") return "分析";
```

Update its parameter union/type to include Analysis and add an Analysis scene fixture/test in `SceneNavigationPanel.test.ts`.

- [ ] **Step 8: Remove the entire temporary PR #44 path if present**

After rebasing, inspect and remove all temporary names/shapes rather than deleting only the component:

```bash
git grep -nE 'AnalysisView|setAnalysisSelection|submitAnalysisSelection|set_analysis_selection|submit_analysis_selection' -- apps/game/src || true
```

Expected final output: no matches.

Inspect `state/types.ts` and ensure Analysis mutable state appears only under the discriminated `draft` union. There must be no legacy flat `selectedCardIds` field on the board common/threshold view outside `AnalysisDraft`.

- [ ] **Step 9: Verify focused integration**

```bash
bun run --cwd apps/game test \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/state/mode.test.ts \
  src/lib/components/SceneNavigationPanel.test.ts
bun run --cwd apps/game check
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/game/src/lib/components/analysis/AnalysisWorkbench.svelte apps/game/src/lib/components/analysis/AnalysisWorkbench.test.ts apps/game/src/routes/+page.svelte apps/game/src/lib/state/mode.test.ts apps/game/src/lib/components/SceneNavigationPanel.svelte apps/game/src/lib/components/SceneNavigationPanel.test.ts apps/game/src/lib/state/types.ts apps/game/src/lib/state/game-client.svelte.ts
git commit -m "feat(game-ui): integrate analysis workbench"
```

Include deletions of temporary PR #44 files in the same commit when applicable.

---

### Task 7: Run Chapter 1 UI acceptance and prepare HPA-262 handoff

**Files:**
- Modify only tests/docs if a verification gap is found. Do not widen feature scope.

**Interfaces:**
- Consumes: Tasks 1–6 completed implementation.
- Produces: frontend acceptance evidence and an explicit live-runtime handoff list for HPA-262.

- [ ] **Step 1: Run the full Analysis-focused test set**

```bash
bun run --cwd apps/game test \
  src/lib/analysis/analysis-boundary.test.ts \
  src/lib/analysis/response-fence.test.ts \
  src/lib/analysis/order-draft.test.ts \
  src/lib/case-file/labels.test.ts \
  src/lib/components/analysis/ClassifyBoard.test.ts \
  src/lib/components/analysis/OrderBoard.test.ts \
  src/lib/components/analysis/ThresholdBoard.test.ts \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/state/game-client-source.test.ts \
  src/lib/state/mode.test.ts \
  src/lib/components/SceneNavigationPanel.test.ts \
  src/lib/audio/sfx-events.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repository-level frontend validation**

```bash
bun run --cwd apps/game test
bun run --cwd apps/game check
bun run --cwd apps/game check:e2e
bun run lint:all
```

Expected: all commands exit 0. `lint:all` may run Rust checks as a repository cleanliness gate, but HPA-261 does not interpret that as runtime Analysis acceptance.

- [ ] **Step 3: Re-run ownership/cleanup greps**

```bash
git grep -nE 'acceptedGroupByCard|acceptedOrder|acceptedSelections' -- apps/game/src/lib/analysis apps/game/src/lib/components/analysis || true
git grep -nE 'AnalysisView|setAnalysisSelection|submitAnalysisSelection|set_analysis_selection|submit_analysis_selection' -- apps/game/src || true
```

Expected: no matches.

Check the only allowed frontend threshold mutable field spelling is inside the `AnalysisDraft` threshold arm and its consumers:

```bash
git grep -n 'selectedCardIds' -- apps/game/src/lib/state/types.ts apps/game/src/lib/analysis apps/game/src/lib/components/analysis
```

Review each result: it must be the threshold draft field/fixture/toggle use, not a legacy flat board-common field.

- [ ] **Step 4: Keyboard-only acceptance against the typed fixture/harness**

Verify via Testing Library/native controls that a player can:

- classify every card using Tab + Enter/Space;
- move/remove classifications;
- add/reorder/remove every movable order card without touching the fixed anchor;
- toggle threshold cards;
- use Undo/Reset/Submit;
- receive textual feedback/focus return;
- navigate back to a completed board and see read-only state.

No drag path is required.

- [ ] **Step 5: Record HPA-262 live-runtime handoff items in the implementation PR**

HPA-262 must prove, against HPA-260 live public responses:

1. TS field spelling exactly matches Rust serialization;
2. `AnalysisActionToken.activeBoardId` is the only active-board identity consumed by UI;
3. fixture board/card/group/fixed-anchor/minimum/provenance presentation matches the real Beat 8.5 public view;
4. each wrapper sends the real HPA-260 expected-token + draft payload;
5. stale responses are rejected both by Rust token validation and frontend session fence;
6. one incomplete draft for each board survives save -> title -> Continue;
7. completed boards reopen read-only;
8. correct submit commits result dialogue/story outputs exactly once;
9. packaged keyboard path completes all three real boards;
10. PR #44 temporary threshold-only path is absent.

- [ ] **Step 6: Commit any acceptance-only test correction**

If verification required a test-only correction:

```bash
git add apps/game/src/lib apps/game/src/routes
git commit -m "test(game-ui): accept analysis workbench"
```

If no files changed, do not create an empty commit.

---

## Self-Review Checklist

Before implementation starts, verify this plan still satisfies the design:

- [ ] No frontend accepted-answer data.
- [ ] No frontend threshold evaluator.
- [ ] No duplicate active-board identity.
- [ ] No optimistic/persistent Analysis store.
- [ ] No Analysis-owned generation counter.
- [ ] Existing `MUTATING_GAMEPLAY_COMMANDS` is extended, not replaced.
- [ ] `GameplayCommandName` exhaustive test/count is updated.
- [ ] Dispatcher fence is tested through the real game-client module.
- [ ] Order algebra is pure/tested and remains prefix-anchor-only.
- [ ] Case File source precedence is shared, not reimplemented.
- [ ] Threshold selected IDs are sorted before emission.
- [ ] Classify removal is explicitly tested.
- [ ] Board switching clears Undo and is explicitly tested.
- [ ] Case File visibility/reexamine behavior is pinned for Analysis.
- [ ] PR #44 cleanup covers component + commands + types + route.
- [ ] HPA-262 remains the live Rust/save/packaged acceptance owner.

## Execution Handoff

Plan complete in this document. Implementation should use **subagent-driven development** task-by-task where available; otherwise execute inline with the same test-first gates. Do not merge HPA-260 runtime work into HPA-261 merely to make fixtures live early — HPA-262 is the integration owner.
