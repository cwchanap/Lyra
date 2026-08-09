# HPA-261 Chapter 1 Analysis Workbench UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Chapter 1 Beat 8.5 Analysis workbench in Svelte so classify, order, and threshold boards are fully playable with pointer or keyboard while Rust remains the only owner of correctness and durable state.

**Architecture:** Mirror HPA-260's answer-key-free public Analysis view directly in the existing frontend state types, then render it through one `AnalysisWorkbench` host and three small board-kind components. Every edit sends a complete semantic `AnalysisDraft` through the existing gameplay dispatcher; no optimistic/persistent frontend Analysis store is added. A narrow session/token response guard prevents stale Analysis responses from overwriting a newer session. Typed Beat 8.5 fixtures let HPA-261 proceed before HPA-260 finishes; HPA-262 later proves parity with real runtime responses.

**Tech Stack:** Svelte 5, TypeScript, Tauri 2 command client, existing `GameStateView`/`GameShell`, Vitest, Testing Library Svelte, existing Case File provenance labels, existing gameplay command dispatcher.

## Global Constraints

- Support exactly the Chapter 1 `classify`, `order`, and `threshold` board families.
- Do not add drag-and-drop, graph/canvas editing, a renderer registry, or compare/route/chain abstractions.
- TypeScript must not contain accepted mappings, accepted orders, accepted threshold selections, source-independence truth, eligibility truth, or durable reveal logic.
- Render only the boards and public metadata exposed by Rust; never synthesize hidden/locked boards.
- HPA-260 command names are `select_analysis_board`, `update_analysis_draft`, and `submit_analysis_board`; intro/result/outro continue through existing `advance_dialogue`.
- Workbench edits render only after authoritative command responses; no optimistic Analysis store.
- Keep existing `gameState.inFlight`, `GameShell` Escape ownership, Case File behavior, acquisition popup behavior, audio routing, and persistence overlays.
- Case File remains visible in Analysis but record re-examination remains disabled because `canReexamineCaseRecords` stays explore/interrogation-only.
- Use existing provenance labels from `$lib/case-file/labels`; do not duplicate source/procedure vocabulary.
- Submit remains available on editable incomplete drafts so Rust can return authored `Incomplete` feedback.
- Completed boards are read-only: no draft mutation, reset, undo, or submit.
- No new npm/Bun dependency is required.
- PR #44 is not a dependency. If its threshold-only `AnalysisView` has merged when implementation starts, replace it with this workbench and remove the temporary threshold-only frontend command path in the same task that wires the final route.
- If HPA-260's final serialized field spelling differs from the names shown below, mirror the Rust JSON exactly and update the typed fixture in the same commit; do not add an adapter DTO family.

---

## File Structure

### Create

- `apps/game/src/lib/analysis/beat-8-5-fixture.ts`
  - answer-key-free public fixture for all three real Beat 8.5 boards plus representative public inventory/provenance.
- `apps/game/src/lib/analysis/analysis-boundary.test.ts`
  - public-shape and hidden-answer source guard.
- `apps/game/src/lib/analysis/response-fence.ts`
  - pure frontend stale-response predicate using session epoch + Analysis action token.
- `apps/game/src/lib/analysis/response-fence.test.ts`
  - fence coverage independent of Tauri.
- `apps/game/src/lib/components/analysis/AnalysisCard.svelte`
  - shared card copy/badge presentation only.
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
  - mirror answer-key-free HPA-260 Analysis mode/scene/board/draft/action-token public types.
- `apps/game/src/lib/state/game-client.svelte.ts`
  - register Analysis mutating commands, add a narrow optional response guard, and expose three semantic Analysis wrappers.
- `apps/game/src/lib/audio/sfx-events.ts`
  - add Analysis commands to `GameplayCommandName`; add no new sound mapping.
- `apps/game/src/routes/+page.svelte`
  - route `mode.type === "analysis"` through `SceneBackdrop` + `AnalysisWorkbench`.
- `apps/game/src/lib/components/SceneNavigationPanel.svelte`
  - label Analysis scene entries as `分析`.
- `apps/game/src/lib/components/SceneNavigationPanel.test.ts`
  - pin Analysis scene-index rendering.

### Delete only if present after rebasing current `main`

- `apps/game/src/lib/components/AnalysisView.svelte`
- `apps/game/src/lib/components/AnalysisView.test.ts`

These are the threshold-only temporary files currently visible in PR #44. Do not leave both UI paths in the repository.

### Intentionally do not modify

- `apps/game/src/lib/state/mode.ts` — current rules already keep Case File visible and re-examination disabled in Analysis.
- `apps/game/src/lib/components/GameShell.svelte` — current inert/Escape/focus ownership is reused.
- Rust runtime/schema/save files — HPA-260 owns them.
- compiler Analysis parser/validator/emitter — HPA-259 owns them.

---

### Task 1: Add the answer-key-free frontend Analysis contract and Beat 8.5 fixture

**Files:**
- Create: `apps/game/src/lib/analysis/beat-8-5-fixture.ts`
- Create: `apps/game/src/lib/analysis/analysis-boundary.test.ts`
- Modify: `apps/game/src/lib/state/types.ts`

**Interfaces:**
- Consumes: existing `InventoryTarget`, `Inventory`, `CaseRecordProvenance`, `VisualAssetCue`.
- Produces: `AnalysisActionToken`, `AnalysisDraft`, `AnalysisFeedbackView`, `AnalysisCardView`, `AnalysisGroupView`, `AnalysisFixedAnchorView`, `AnalysisBoardView`, Analysis `Mode`, and Analysis `SceneView` used by every later task.

- [ ] **Step 1: Write the failing public-contract test**

Create `apps/game/src/lib/analysis/analysis-boundary.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  beat85AnalysisSceneFixture,
  beat85InventoryFixture,
} from "./beat-8-5-fixture";

const FRONTEND_ANALYSIS_SOURCES = [
  "src/lib/analysis/beat-8-5-fixture.ts",
  "src/lib/components/analysis/AnalysisCard.svelte",
  "src/lib/components/analysis/ClassifyBoard.svelte",
  "src/lib/components/analysis/OrderBoard.svelte",
  "src/lib/components/analysis/ThresholdBoard.svelte",
  "src/lib/components/analysis/AnalysisWorkbench.svelte",
];

describe("Analysis frontend ownership boundary", () => {
  it("represents all three Chapter 1 board kinds without answer keys", () => {
    expect(beat85AnalysisSceneFixture.visibleBoards.map((board) => board.kind)).toEqual([
      "classify",
      "order",
      "threshold",
    ]);
    expect(beat85InventoryFixture.evidence.length).toBeGreaterThan(0);
    expect(beat85InventoryFixture.statements.length).toBeGreaterThan(0);

    const publicFixture = JSON.stringify(beat85AnalysisSceneFixture);
    expect(publicFixture).not.toContain("acceptedGroupByCard");
    expect(publicFixture).not.toContain("acceptedOrder");
    expect(publicFixture).not.toContain("acceptedSelections");
  });

  it("keeps hidden answer-key names out of Analysis feature source", () => {
    const source = FRONTEND_ANALYSIS_SOURCES.filter((path) => {
      try {
        readFileSync(path, "utf8");
        return true;
      } catch {
        return false;
      }
    })
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(source).not.toMatch(/acceptedGroupByCard/);
    expect(source).not.toMatch(/acceptedOrder/);
    expect(source).not.toMatch(/acceptedSelections/);
  });
});
```

The temporary `try/catch` allows the source guard to be added before Tasks 3–6 create all feature files; once each file exists it is automatically included without changing the test.

- [ ] **Step 2: Run the test and verify it fails on missing types/fixture**

Run:

```bash
bun run --cwd apps/game test src/lib/analysis/analysis-boundary.test.ts
```

Expected: FAIL because `beat-8-5-fixture.ts` and the Analysis public types do not exist on current `main`.

- [ ] **Step 3: Add the public TypeScript mirror**

Extend `apps/game/src/lib/state/types.ts` with the HPA-260 public contract:

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

export type AnalysisFeedbackView = {
  kind: "incomplete" | "incorrect";
  message: string;
} | null;

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

Add the Analysis mode arm using the same `VisualAssetCue` intersection pattern as existing modes:

```ts
| ({
    type: "analysis";
    boardId: string;
    actionToken: AnalysisActionToken;
  } & VisualAssetCue)
```

Add the Analysis scene arm:

```ts
| {
    kind: "analysis";
    id: string;
    title: string;
    summary: string;
    index: number;
    total: number;
    visibleBoards: AnalysisBoardView[];
  }
```

Extend `SceneNavigationIndex` scene type with `"analysis"`.

- [ ] **Step 4: Add the answer-key-free Beat 8.5 fixture**

Create `apps/game/src/lib/analysis/beat-8-5-fixture.ts`. Use the real HPA-259 public IDs/labels and only public draft/source data:

```ts
import type {
  AnalysisActionToken,
  Inventory,
  SceneView,
} from "$lib/state/types";

type AnalysisSceneView = Extract<SceneView, { kind: "analysis" }>;

export const beat85ActionTokenFixture: AnalysisActionToken = {
  sceneId: "analysis_scene_8_5",
  activeBoardId: "evidence_packages",
  durableRevision: 41,
};

export const beat85AnalysisSceneFixture: AnalysisSceneView = {
  kind: "analysis",
  id: "analysis_scene_8_5",
  title: "短暫誤判整理點",
  summary: "相馬與早坂整理目前真正成立的命題。",
  index: 10,
  total: 17,
  visibleBoards: [
    {
      kind: "classify",
      id: "evidence_packages",
      label: "證據包整理",
      prompt: "把每張卡放進它真正支持的命題。",
      completed: false,
      readOnly: false,
      feedback: null,
      hint: "先問每一項資料真正能證明什麼。",
      draft: { kind: "classify", groupByCard: {} },
      cards: [
        {
          id: "miyake_call",
          label: "三宅母親通話紀錄",
          summary: "解釋三宅隱瞞通話的原因。",
          source: { kind: "evidence", id: "miyake_call_record" },
        },
        {
          id: "l_corridor_replay",
          label: "L 型後場視角重演",
          summary: "證明三宅當時站位看不見內側倉庫。",
          source: { kind: "evidence", id: "l_corridor_replay" },
        },
        {
          id: "external_credential_event",
          label: "外包憑證事件",
          summary: "證明有人比三宅更早從承包商動線進入。",
          source: { kind: "evidence", id: "external_credential_event" },
        },
      ],
      groups: [
        {
          id: "miyake_small_lies",
          label: "三宅的小謊",
          description: "只解釋生活壓力造成的隱瞞。",
        },
        {
          id: "earlier_third_party",
          label: "更早的第三者",
          description: "支持更早外部進入者存在的資料。",
        },
      ],
    },
    {
      kind: "order",
      id: "local_event_sequence",
      label: "本機事件順序",
      prompt: "把本機事件排回原始先後。",
      completed: false,
      readOnly: false,
      feedback: null,
      hint: null,
      draft: { kind: "order", cardIds: [] },
      cards: [
        { id: "event_1841", label: "維護模式開啟", summary: "本機事件 1841。", source: { kind: "evidence", id: "event_1841" } },
        { id: "event_1842", label: "外包憑證開門", summary: "本機事件 1842。", source: { kind: "evidence", id: "event_1842" } },
        { id: "event_1843", label: "員工憑證開門", summary: "本機事件 1843。", source: { kind: "evidence", id: "event_1843" } },
        { id: "event_1844", label: "伺服器合併完成", summary: "本機事件 1844。", source: { kind: "evidence", id: "event_1844" } },
      ],
      fixedAnchors: [{ cardId: "event_1841", position: 1 }],
    },
    {
      kind: "threshold",
      id: "narrow_request_basis",
      label: "有限調取申請基礎",
      prompt: "選出足以支持有限調取申請的獨立矛盾。",
      completed: false,
      readOnly: false,
      feedback: null,
      hint: null,
      draft: { kind: "threshold", selectedCardIds: [] },
      minimumSelected: 2,
      cards: [
        { id: "lock_sequence", label: "門鎖本機順序", summary: "提供事件先後與摘要時間不一致的證明。", source: { kind: "evidence", id: "lock_sequence" } },
        { id: "phone_notification", label: "死者手機通知", summary: "提供獨立時間錨。", source: { kind: "evidence", id: "phone_notification" } },
        { id: "manager_timing", label: "店長時間證詞", summary: "提供另一個可被程序固定的時間來源。", source: { kind: "statement", id: "manager_timing" } },
      ],
    },
  ],
};

const acquisitionContext = {
  chapterId: "chapter_1",
  chapterTitle: "雨鐘咖啡館殺人事件",
  sceneId: "investigation_scene_7",
  sceneTitle: "反轉調查",
};

const baseProvenance = {
  representationLayer: "raw" as const,
  completeness: "complete" as const,
  confidence: "corroborated" as const,
  proofCapabilities: ["time" as const],
  supersedesRecordId: null,
};

export const beat85InventoryFixture: Inventory = {
  evidence: [
    {
      id: "lock_sequence",
      name: "門鎖本機順序",
      description: "門鎖設備本機事件順序。",
      details: "只提供先後，不提供精確秒數。",
      imageAssetId: null,
      onReexamine: null,
      collectedInChapterId: "chapter_1",
      collectedInSceneId: "investigation_scene_7",
      acquisitionContext,
      provenance: {
        ...baseProvenance,
        sourceKind: "digital",
        proceduralStatus: "reacquired",
        sourceGroupId: "door-lock",
        sourceLabel: "雨鐘後場門鎖",
      },
      sourceGroup: {
        id: "door-lock",
        label: "門鎖本機",
        summary: "雨鐘後場門鎖的本機資料。",
      },
    },
    {
      id: "phone_notification",
      name: "死者手機通知",
      description: "衝突前後的手機通知。",
      details: "提供獨立時間錨。",
      imageAssetId: null,
      onReexamine: null,
      collectedInChapterId: "chapter_1",
      collectedInSceneId: "investigation_scene_7",
      acquisitionContext,
      provenance: {
        ...baseProvenance,
        sourceKind: "digital",
        proceduralStatus: "exhibit",
        sourceGroupId: "masuda-phone",
        sourceLabel: "增田手機",
      },
      sourceGroup: {
        id: "masuda-phone",
        label: "增田手機",
        summary: "死者個人裝置資料。",
      },
    },
  ],
  statements: [
    {
      id: "manager_timing",
      speaker: "高瀨真澄",
      content: "店長對維護與發現時間的證詞。",
      onReexamine: null,
      acquiredInChapterId: "chapter_1",
      acquiredInSceneId: "investigation_scene_7",
      acquisitionContext,
      provenance: {
        ...baseProvenance,
        sourceKind: "testimony",
        representationLayer: "none",
        proceduralStatus: "exhibit",
        sourceGroupId: "manager-testimony",
        sourceLabel: "店長證詞",
      },
      sourceGroup: {
        id: "manager-testimony",
        label: "店長證詞",
        summary: "高瀨真澄的正式證詞。",
      },
    },
  ],
};
```

The classify/order source records not needed by Threshold badge tests do not need duplicate inventory rows; their public card source refs remain valid presentation data in this fixture.

- [ ] **Step 5: Run focused test and type check**

Run:

```bash
bun run --cwd apps/game test src/lib/analysis/analysis-boundary.test.ts
bun run --cwd apps/game check
```

Expected: PASS with no Svelte/TypeScript error.

- [ ] **Step 6: Commit**

```bash
git add apps/game/src/lib/state/types.ts apps/game/src/lib/analysis
git commit -m "feat(game-ui): add analysis public view contract"
```

---

### Task 2: Add semantic Analysis command wrappers and stale-response fencing

**Files:**
- Create: `apps/game/src/lib/analysis/response-fence.ts`
- Create: `apps/game/src/lib/analysis/response-fence.test.ts`
- Modify: `apps/game/src/lib/state/game-client.svelte.ts`
- Modify: `apps/game/src/lib/audio/sfx-events.ts`

**Interfaces:**
- Consumes: `AnalysisActionToken`, `AnalysisDraft`, `GameStateView`, existing `presentationState.sessionEpoch`, existing `dispatchGameCommand`.
- Produces: `selectAnalysisBoard`, `updateAnalysisDraft`, `submitAnalysisBoard`, each returning the accepted authoritative `GameStateView | null`.

- [ ] **Step 1: Write the failing response-fence tests**

Create `apps/game/src/lib/analysis/response-fence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GameStateView } from "$lib/state/types";
import { beat85ActionTokenFixture, beat85AnalysisSceneFixture } from "./beat-8-5-fixture";
import { isAnalysisResponseCurrent } from "./response-fence";

function state(): GameStateView {
  return {
    chapter: { id: "chapter_1", title: "第一章", summary: "", index: 0, total: 1 },
    scene: beat85AnalysisSceneFixture,
    mode: {
      type: "analysis",
      boardId: "evidence_packages",
      actionToken: beat85ActionTokenFixture,
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    },
    inventory: { evidence: [], statements: [] },
    story: { facts: [], questions: [], objectives: [], authorizations: [] },
    dialogueHistory: [],
    pendingAcquisition: null,
  };
}

describe("isAnalysisResponseCurrent", () => {
  it("accepts the same session and expected action token", () => {
    expect(isAnalysisResponseCurrent(state(), 7, 7, beat85ActionTokenFixture)).toBe(true);
  });

  it("rejects a replaced session", () => {
    expect(isAnalysisResponseCurrent(state(), 7, 8, beat85ActionTokenFixture)).toBe(false);
  });

  it("rejects a changed durable revision", () => {
    expect(
      isAnalysisResponseCurrent(state(), 7, 7, {
        ...beat85ActionTokenFixture,
        durableRevision: 40,
      }),
    ).toBe(false);
  });

  it("rejects non-analysis current state", () => {
    const current = state();
    current.mode = { type: "gameComplete" };
    expect(isAnalysisResponseCurrent(current, 7, 7, beat85ActionTokenFixture)).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify the test fails**

Run:

```bash
bun run --cwd apps/game test src/lib/analysis/response-fence.test.ts
```

Expected: FAIL because `response-fence.ts` does not exist.

- [ ] **Step 3: Implement the pure fence**

Create `apps/game/src/lib/analysis/response-fence.ts`:

```ts
import type { AnalysisActionToken, GameStateView } from "$lib/state/types";

export function sameAnalysisActionToken(
  left: AnalysisActionToken,
  right: AnalysisActionToken,
): boolean {
  return (
    left.sceneId === right.sceneId &&
    left.activeBoardId === right.activeBoardId &&
    left.durableRevision === right.durableRevision
  );
}

export function isAnalysisResponseCurrent(
  current: GameStateView | null,
  capturedSessionEpoch: number,
  currentSessionEpoch: number,
  expected: AnalysisActionToken,
): boolean {
  return (
    capturedSessionEpoch === currentSessionEpoch &&
    current?.mode.type === "analysis" &&
    sameAnalysisActionToken(current.mode.actionToken, expected)
  );
}
```

- [ ] **Step 4: Extend the existing gameplay dispatcher with one optional response guard**

In `game-client.svelte.ts`, change only the existing dispatcher signature/application point:

```ts
async function dispatchGameCommand(
  command: GameplayCommandName,
  args?: Record<string, unknown>,
  loading = false,
  acceptResponse?: () => boolean,
): Promise<GameStateView | null> {
  if (gameState.inFlight) return null;
  gameState.inFlight = true;
  if (loading) gameState.loading = true;
  let result: GameStateView | null = null;
  try {
    const previous = gameState.value;
    const response = await runCommand<GameplayCommandResultView>(command, args);
    if (response && (acceptResponse?.() ?? true)) {
      result = await applyGameplayCommandResult(response, (next) => {
        let events: ReturnType<typeof inferGameplaySfxEvents>;
        try {
          events = inferGameplaySfxEvents(previous, next, command);
        } catch (inferenceError) {
          console.warn(`[GameplayAudio] SFX inference failed for ${command}`, inferenceError);
          events = [];
        }
        for (const event of events) {
          try {
            playGameplaySfxEvent(event);
          } catch (playbackError) {
            console.warn("[GameplayAudio] SFX playback failed", playbackError);
          }
        }
      });
    }
  } finally {
    if (loading) gameState.loading = false;
    gameState.inFlight = false;
  }
  return result;
}
```

Do not create another dispatcher.

- [ ] **Step 5: Add the three Analysis wrappers**

Import `AnalysisActionToken`, `AnalysisDraft`, and `isAnalysisResponseCurrent`, then add:

```ts
function analysisResponseGuard(expected: AnalysisActionToken): () => boolean {
  const capturedSessionEpoch = presentationState.sessionEpoch;
  return () =>
    isAnalysisResponseCurrent(
      gameState.value,
      capturedSessionEpoch,
      presentationState.sessionEpoch,
      expected,
    );
}

export function selectAnalysisBoard(
  expected: AnalysisActionToken,
  boardId: string,
): Promise<GameStateView | null> {
  return dispatchGameCommand(
    "select_analysis_board",
    { expected, boardId },
    false,
    analysisResponseGuard(expected),
  );
}

export function updateAnalysisDraft(
  expected: AnalysisActionToken,
  draft: AnalysisDraft,
): Promise<GameStateView | null> {
  return dispatchGameCommand(
    "update_analysis_draft",
    { expected, draft },
    false,
    analysisResponseGuard(expected),
  );
}

export function submitAnalysisBoard(
  expected: AnalysisActionToken,
): Promise<GameStateView | null> {
  return dispatchGameCommand(
    "submit_analysis_board",
    { expected },
    false,
    analysisResponseGuard(expected),
  );
}
```

- [ ] **Step 6: Register command names without adding SFX behavior**

In `audio/sfx-events.ts`, extend `GameplayCommandName`:

```ts
  | "select_analysis_board"
  | "update_analysis_draft"
  | "submit_analysis_board";
```

In `MUTATING_GAMEPLAY_COMMANDS`, add all three names. Do not add entries to `SFX_ASSETS` and do not make `inferGameplaySfxEvents` infer new events.

- [ ] **Step 7: Run focused tests and checks**

Run:

```bash
bun run --cwd apps/game test src/lib/analysis/response-fence.test.ts src/lib/audio/sfx-events.test.ts
bun run --cwd apps/game check
```

Expected: PASS. Existing commands behave identically because the response guard is optional.

- [ ] **Step 8: Commit**

```bash
git add apps/game/src/lib/analysis/response-fence.ts apps/game/src/lib/analysis/response-fence.test.ts apps/game/src/lib/state/game-client.svelte.ts apps/game/src/lib/audio/sfx-events.ts
git commit -m "feat(game-ui): add analysis command fencing"
```

---

### Task 3: Build the shared card presentation and classify interaction

**Files:**
- Create: `apps/game/src/lib/components/analysis/AnalysisCard.svelte`
- Create: `apps/game/src/lib/components/analysis/ClassifyBoard.svelte`
- Create: `apps/game/src/lib/components/analysis/ClassifyBoard.test.ts`

**Interfaces:**
- Consumes: `Extract<AnalysisBoardView, { kind: "classify" }>`.
- Produces: full replacement classify drafts through `onDraft(draft, focusKey)`; no command call and no correctness result.

- [ ] **Step 1: Write pointer/keyboard parity tests first**

Create `ClassifyBoard.test.ts` around the classify fixture. The test must prove the same draft is emitted for click and keyboard activation:

```ts
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ClassifyBoard from "./ClassifyBoard.svelte";
import { beat85AnalysisSceneFixture } from "$lib/analysis/beat-8-5-fixture";

const board = beat85AnalysisSceneFixture.visibleBoards[0];
if (board.kind !== "classify") throw new Error("fixture classify board missing");

afterEach(cleanup);

describe("ClassifyBoard", () => {
  it("emits the same assignment draft for pointer and keyboard activation", async () => {
    const user = userEvent.setup();
    const pointerDraft = vi.fn();
    const keyboardDraft = vi.fn();

    const first = render(ClassifyBoard, { board, disabled: false, onDraft: pointerDraft });
    await user.click(screen.getByRole("button", { name: /三宅母親通話紀錄/ }));
    await user.click(screen.getByRole("button", { name: /放入.*三宅的小謊/ }));
    expect(pointerDraft).toHaveBeenLastCalledWith(
      { kind: "classify", groupByCard: { miyake_call: "miyake_small_lies" } },
      "card:miyake_call",
    );
    first.unmount();

    render(ClassifyBoard, { board, disabled: false, onDraft: keyboardDraft });
    screen.getByRole("button", { name: /三宅母親通話紀錄/ }).focus();
    await user.keyboard("{Enter}");
    screen.getByRole("button", { name: /放入.*三宅的小謊/ }).focus();
    await user.keyboard("{Enter}");
    expect(keyboardDraft).toHaveBeenLastCalledWith(
      { kind: "classify", groupByCard: { miyake_call: "miyake_small_lies" } },
      "card:miyake_call",
    );
  });

  it("moves and removes an assigned card without local correctness markers", async () => {
    const user = userEvent.setup();
    const onDraft = vi.fn();
    const assigned = {
      ...board,
      draft: { kind: "classify" as const, groupByCard: { miyake_call: "miyake_small_lies" } },
    };
    render(ClassifyBoard, { board: assigned, disabled: false, onDraft });

    await user.click(screen.getByRole("button", { name: /三宅母親通話紀錄/ }));
    await user.click(screen.getByRole("button", { name: /放入.*更早的第三者/ }));
    expect(onDraft).toHaveBeenLastCalledWith(
      { kind: "classify", groupByCard: { miyake_call: "earlier_third_party" } },
      "card:miyake_call",
    );

    expect(screen.queryByText(/正確|錯誤/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
bun run --cwd apps/game test src/lib/components/analysis/ClassifyBoard.test.ts
```

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement `AnalysisCard.svelte` as presentation only**

Use a phrasing-content wrapper so it can live inside a native button:

```svelte
<script lang="ts">
  let {
    label,
    summary,
    badges = [],
  }: { label: string; summary: string; badges?: string[] } = $props();
</script>

<span class="analysis-card-copy">
  <strong>{label}</strong>
  <span class="summary">{summary}</span>
  {#if badges.length > 0}
    <span class="badges" aria-label="來源與程序">
      {#each badges as badge (badge)}<span class="badge">{badge}</span>{/each}
    </span>
  {/if}
</span>
```

Style with current game variables only; no new global tokens.

- [ ] **Step 4: Implement classify assignment using native buttons**

`ClassifyBoard.svelte` keeps only `selectedCardId` as local presentation state. Its mutation helpers copy the public map and emit a full draft:

```ts
function assign(groupId: string) {
  if (!selectedCardId || board.readOnly || disabled) return;
  onDraft(
    {
      kind: "classify",
      groupByCard: { ...board.draft.groupByCard, [selectedCardId]: groupId },
    },
    `card:${selectedCardId}`,
  );
}

function remove(cardId: string) {
  if (board.readOnly || disabled) return;
  const next = { ...board.draft.groupByCard };
  delete next[cardId];
  onDraft({ kind: "classify", groupByCard: next }, `card:${cardId}`);
}
```

Render one labelled unassigned pool and one labelled section per group. Every card activation is a button with:

```svelte
aria-pressed={selectedCardId === card.id}
data-analysis-focus-key={`card:${card.id}`}
```

Each group gets an explicit button whose accessible name includes the group label, for example `放入「三宅的小謊」`.

Do not add green/red correctness styling.

- [ ] **Step 5: Add visible focus styling and reduced-motion fallback**

At minimum:

```css
button:focus-visible {
  outline: 2px solid var(--cyan);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  button { transition: none; }
}
```

- [ ] **Step 6: Run tests and check**

Run:

```bash
bun run --cwd apps/game test src/lib/components/analysis/ClassifyBoard.test.ts
bun run --cwd apps/game check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/game/src/lib/components/analysis/AnalysisCard.svelte apps/game/src/lib/components/analysis/ClassifyBoard.svelte apps/game/src/lib/components/analysis/ClassifyBoard.test.ts
git commit -m "feat(game-ui): add classify analysis board"
```

---

### Task 4: Build the Chapter 1 order-slot interaction with fixed anchors

**Files:**
- Create: `apps/game/src/lib/components/analysis/OrderBoard.svelte`
- Create: `apps/game/src/lib/components/analysis/OrderBoard.test.ts`

**Interfaces:**
- Consumes: `Extract<AnalysisBoardView, { kind: "order" }>`.
- Produces: full replacement order drafts through `onDraft(draft, focusKey)`.
- Chapter 1 constraint: Beat 8.5 has the fixed `event_1841` anchor at authored position 1. Do not build a sparse generic order editor for speculative future anchor layouts.

- [ ] **Step 1: Write failing fixed-anchor and keyboard tests**

Create `OrderBoard.test.ts`:

```ts
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import OrderBoard from "./OrderBoard.svelte";
import { beat85AnalysisSceneFixture } from "$lib/analysis/beat-8-5-fixture";

const board = beat85AnalysisSceneFixture.visibleBoards[1];
if (board.kind !== "order") throw new Error("fixture order board missing");

afterEach(cleanup);

describe("OrderBoard", () => {
  it("renders the authored anchor locked and never exposes move/remove controls for it", () => {
    render(OrderBoard, { board, disabled: false, onDraft: vi.fn() });
    expect(screen.getByText("維護模式開啟")).toBeInTheDocument();
    expect(screen.getByText("固定位置")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /維護模式開啟.*移除/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /維護模式開啟.*上移/ })).toBeNull();
  });

  it("places, moves, and removes every movable card with keyboard buttons", async () => {
    const user = userEvent.setup();
    const onDraft = vi.fn();
    render(OrderBoard, { board, disabled: false, onDraft });

    const add = screen.getByRole("button", { name: /外包憑證開門.*加入時間線/ });
    add.focus();
    await user.keyboard("{Enter}");
    expect(onDraft).toHaveBeenLastCalledWith(
      { kind: "order", cardIds: ["event_1841", "event_1842"] },
      "card:event_1842",
    );
  });
});
```

Add a second fixture state with all four cards in a non-final public draft and assert `上移`, `下移`, and `移除` emit only structural permutations; do not assert against the hidden accepted order.

- [ ] **Step 2: Run and verify failure**

Run:

```bash
bun run --cwd apps/game test src/lib/components/analysis/OrderBoard.test.ts
```

Expected: FAIL because `OrderBoard.svelte` does not exist.

- [ ] **Step 3: Implement the current Chapter 1 anchor mechanics**

Inside `OrderBoard.svelte`, derive the fixed card set from public metadata:

```ts
let fixedPositionByCard = $derived(
  new Map(board.fixedAnchors.map((anchor) => [anchor.cardId, anchor.position])),
);
let fixedCardIds = $derived(new Set(board.fixedAnchors.map((anchor) => anchor.cardId)));
```

For the current Beat 8.5 public contract, the first authored position is fixed. When adding the first movable card, materialize the public prefix anchor before the new card:

```ts
function withRequiredPrefixAnchors(cardIds: string[]): string[] {
  const next = [...cardIds];
  const prefixAnchors = [...board.fixedAnchors]
    .filter((anchor) => anchor.position <= next.length + 1)
    .sort((a, b) => a.position - b.position);

  for (const anchor of prefixAnchors) {
    const index = anchor.position - 1;
    if (!next.includes(anchor.cardId)) next.splice(index, 0, anchor.cardId);
  }
  return next;
}

function add(cardId: string) {
  if (board.readOnly || disabled || fixedCardIds.has(cardId)) return;
  const base = withRequiredPrefixAnchors(board.draft.cardIds);
  if (base.includes(cardId)) return;
  onDraft(
    { kind: "order", cardIds: withRequiredPrefixAnchors([...base, cardId]) },
    `card:${cardId}`,
  );
}
```

The real fixture pins `event_1841` at position 1. Add a fixture assertion in `OrderBoard.test.ts` so a future Chapter 1 authoring change to non-prefix anchors forces an explicit UI redesign instead of silently inventing sparse-draft semantics:

```ts
expect(board.fixedAnchors).toEqual([{ cardId: "event_1841", position: 1 }]);
```

This is a deliberate Chapter 1-first constraint, not a generic order-template promise.

- [ ] **Step 4: Implement movable up/down/remove helpers**

Operate only on the current public draft vector and skip fixed cards:

```ts
function move(cardId: string, direction: -1 | 1) {
  const next = withRequiredPrefixAnchors(board.draft.cardIds);
  const index = next.indexOf(cardId);
  if (index < 0 || fixedCardIds.has(cardId)) return;

  let target = index + direction;
  while (target >= 0 && target < next.length && fixedCardIds.has(next[target])) {
    target += direction;
  }
  if (target < 0 || target >= next.length) return;

  [next[index], next[target]] = [next[target], next[index]];
  onDraft({ kind: "order", cardIds: next }, `card:${cardId}`);
}

function remove(cardId: string) {
  if (fixedCardIds.has(cardId) || board.readOnly || disabled) return;
  onDraft(
    { kind: "order", cardIds: board.draft.cardIds.filter((id) => id !== cardId) },
    `card:${cardId}`,
  );
}
```

Expose native buttons with card label in the accessible name: `外包憑證開門・上移`, `…・下移`, `…・移除`.

- [ ] **Step 5: Render the fixed slot and unplaced pool clearly**

Use `<ol aria-label="本機事件順序">` for the current sequence and a separate labelled unplaced-card list. Fixed cards show text `固定位置` and no mutation buttons.

- [ ] **Step 6: Run focused tests/check**

Run:

```bash
bun run --cwd apps/game test src/lib/components/analysis/OrderBoard.test.ts
bun run --cwd apps/game check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/game/src/lib/components/analysis/OrderBoard.svelte apps/game/src/lib/components/analysis/OrderBoard.test.ts
git commit -m "feat(game-ui): add order analysis board"
```

---

### Task 5: Build threshold selection with public source/procedure badges

**Files:**
- Create: `apps/game/src/lib/components/analysis/ThresholdBoard.svelte`
- Create: `apps/game/src/lib/components/analysis/ThresholdBoard.test.ts`
- Reuse: `apps/game/src/lib/components/analysis/AnalysisCard.svelte`
- Reuse: `apps/game/src/lib/case-file/labels.ts`

**Interfaces:**
- Consumes: threshold board public view + current `Inventory`.
- Produces: full replacement threshold drafts through `onDraft(draft, focusKey)`.

- [ ] **Step 1: Write failing selection/badge tests**

Create `ThresholdBoard.test.ts`:

```ts
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ThresholdBoard from "./ThresholdBoard.svelte";
import {
  beat85AnalysisSceneFixture,
  beat85InventoryFixture,
} from "$lib/analysis/beat-8-5-fixture";

const board = beat85AnalysisSceneFixture.visibleBoards[2];
if (board.kind !== "threshold") throw new Error("fixture threshold board missing");

afterEach(cleanup);

describe("ThresholdBoard", () => {
  it("renders public source/procedure badges and mechanical progress", () => {
    render(ThresholdBoard, {
      board,
      inventory: beat85InventoryFixture,
      disabled: false,
      onDraft: vi.fn(),
    });

    expect(screen.getByText("門鎖本機")).toBeInTheDocument();
    expect(screen.getByText("重新取得")).toBeInTheDocument();
    expect(screen.getByText("已選 0 / 最少 2")).toBeInTheDocument();
  });

  it("emits the same threshold draft for pointer and keyboard activation", async () => {
    const user = userEvent.setup();
    const onDraft = vi.fn();
    render(ThresholdBoard, {
      board,
      inventory: beat85InventoryFixture,
      disabled: false,
      onDraft,
    });

    const card = screen.getByRole("button", { name: /門鎖本機順序/ });
    card.focus();
    await user.keyboard("{Enter}");
    expect(onDraft).toHaveBeenLastCalledWith(
      { kind: "threshold", selectedCardIds: ["lock_sequence"] },
      "card:lock_sequence",
    );
  });
});
```

Add a test clone where two displayed cards resolve to the same `sourceGroup.id`; activate both and assert the component still emits both selected IDs. This proves no source-independence evaluator exists in Svelte.

- [ ] **Step 2: Run and verify failure**

Run:

```bash
bun run --cwd apps/game test src/lib/components/analysis/ThresholdBoard.test.ts
```

Expected: FAIL because `ThresholdBoard.svelte` does not exist.

- [ ] **Step 3: Resolve only public record presentation**

In `ThresholdBoard.svelte`, import existing labels:

```ts
import {
  proceduralStatusLabels,
  sourceKindLabels,
} from "$lib/case-file/labels";
```

Resolve card source without deriving eligibility:

```ts
function recordFor(source: InventoryTarget) {
  return source.kind === "evidence"
    ? inventory.evidence.find((record) => record.id === source.id) ?? null
    : inventory.statements.find((record) => record.id === source.id) ?? null;
}

function badgesFor(card: AnalysisCardView): string[] {
  const record = recordFor(card.source);
  if (!record) return ["來源資訊不可用"];

  const source =
    record.sourceGroup?.label ??
    record.provenance.sourceLabel ??
    sourceKindLabels[record.provenance.sourceKind] ??
    null;
  const procedure = proceduralStatusLabels[record.provenance.proceduralStatus] ?? null;

  return [source, procedure].filter((value): value is string => Boolean(value));
}
```

This code is presentation only. It must not compare source-group IDs across selected cards.

- [ ] **Step 4: Implement selection as a plain public toggle**

```ts
function toggle(cardId: string) {
  if (board.readOnly || disabled) return;
  const selected = new Set(board.draft.selectedCardIds);
  if (selected.has(cardId)) selected.delete(cardId);
  else selected.add(cardId);
  onDraft(
    { kind: "threshold", selectedCardIds: [...selected] },
    `card:${cardId}`,
  );
}
```

Render native buttons with `aria-pressed` and `AnalysisCard` badges. Do not disable based on minimum/source/procedure/capability semantics.

- [ ] **Step 5: Run focused tests/check**

Run:

```bash
bun run --cwd apps/game test src/lib/components/analysis/ThresholdBoard.test.ts
bun run --cwd apps/game check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/game/src/lib/components/analysis/ThresholdBoard.svelte apps/game/src/lib/components/analysis/ThresholdBoard.test.ts apps/game/src/lib/components/analysis/AnalysisCard.svelte
git commit -m "feat(game-ui): add threshold analysis board"
```

---

### Task 6: Compose the workbench host, focus behavior, Undo/Reset, and page routing

**Files:**
- Create: `apps/game/src/lib/components/analysis/AnalysisWorkbench.svelte`
- Create: `apps/game/src/lib/components/analysis/AnalysisWorkbench.test.ts`
- Modify: `apps/game/src/routes/+page.svelte`
- Modify: `apps/game/src/lib/components/SceneNavigationPanel.svelte`
- Modify: `apps/game/src/lib/components/SceneNavigationPanel.test.ts`
- Delete if present after rebase: `apps/game/src/lib/components/AnalysisView.svelte`
- Delete if present after rebase: `apps/game/src/lib/components/AnalysisView.test.ts`

**Interfaces:**
- Consumes: Analysis `SceneView`, Analysis `Mode`, current `Inventory`, Task 2 command wrappers, Task 3–5 board components.
- Produces: the only production Analysis workbench surface rendered by `+page.svelte`.

- [ ] **Step 1: Write failing host tests for board navigation, feedback focus, Undo/Reset, and read-only review**

Create `AnalysisWorkbench.test.ts` using a small harness that owns reactive `scene`/`mode` props. Pin these behaviors:

```ts
it("selects a previous visible board through the Rust command boundary", async () => {
  const user = userEvent.setup();
  const onSelectBoard = vi.fn().mockResolvedValue(authoritativeState());
  renderWorkbench({ activeBoardId: "local_event_sequence", onSelectBoard });

  await user.click(screen.getByRole("button", { name: /返回上一分析板/ }));
  expect(onSelectBoard).toHaveBeenCalledWith(
    expect.objectContaining({ sceneId: "analysis_scene_8_5" }),
    "evidence_packages",
  );
});

it("keeps submit enabled on an incomplete editable draft", () => {
  renderWorkbench({ activeBoardId: "evidence_packages" });
  expect(screen.getByRole("button", { name: "提交推論" })).toBeEnabled();
});

it("sends reset through update_analysis_draft instead of clearing locally", async () => {
  const user = userEvent.setup();
  const onUpdateDraft = vi.fn().mockResolvedValue(authoritativeState());
  renderWorkbench({ activeBoardId: "evidence_packages", withAssignedClassifyDraft: true, onUpdateDraft });

  await user.click(screen.getByRole("button", { name: "重設" }));
  expect(onUpdateDraft).toHaveBeenCalledWith(
    expect.any(Object),
    { kind: "classify", groupByCard: {} },
  );
});

it("renders a completed board read-only", () => {
  renderWorkbench({ activeBoardId: "evidence_packages", completed: true });
  expect(screen.getByText("完成・只讀檢視")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "提交推論" })).toBeNull();
  expect(screen.queryByRole("button", { name: "重設" })).toBeNull();
});
```

Add one test where an authoritative submit response keeps the board active with `feedback.message`; after the reactive rerender, assert the feedback element has `document.activeElement` and contains the text. Add one test proving a successful update makes Undo available and Undo sends the previous public draft through `onUpdateDraft`.

- [ ] **Step 2: Run and verify failure**

Run:

```bash
bun run --cwd apps/game test src/lib/components/analysis/AnalysisWorkbench.test.ts
```

Expected: FAIL because `AnalysisWorkbench.svelte` does not exist.

- [ ] **Step 3: Implement common host state without a second durable store**

Use props:

```ts
let {
  scene,
  mode,
  inventory,
  onSelectBoard,
  onUpdateDraft,
  onSubmit,
  disabled = false,
}: {
  scene: Extract<SceneView, { kind: "analysis" }>;
  mode: Extract<Mode, { type: "analysis" }>;
  inventory: Inventory;
  onSelectBoard: (expected: AnalysisActionToken, boardId: string) => Promise<GameStateView | null>;
  onUpdateDraft: (expected: AnalysisActionToken, draft: AnalysisDraft) => Promise<GameStateView | null>;
  onSubmit: (expected: AnalysisActionToken) => Promise<GameStateView | null>;
  disabled?: boolean;
} = $props();
```

Keep only presentation state:

```ts
let undoDraft = $state<AnalysisDraft | null>(null);
let undoBoardId = $state<string | null>(null);
let hintOpen = $state(false);
let root = $state<HTMLElement>();
let feedback = $state<HTMLElement>();

let board = $derived(scene.visibleBoards.find((candidate) => candidate.id === mode.boardId) ?? null);
```

Clear Undo/Hint whenever `mode.boardId` changes.

- [ ] **Step 4: Implement authoritative draft edits + one-step Undo**

```ts
async function focusKey(key: string | null) {
  await tick();
  if (key) {
    root?.querySelector<HTMLElement>(`[data-analysis-focus-key="${CSS.escape(key)}"]`)?.focus();
  }
}

async function updateDraft(next: AnalysisDraft, returnFocusKey: string) {
  if (!board || board.readOnly || disabled) return;
  const previous = structuredClone(board.draft) as AnalysisDraft;
  const result = await onUpdateDraft(mode.actionToken, next);
  if (!result) return;
  undoDraft = previous;
  undoBoardId = board.id;
  await focusKey(returnFocusKey);
}

async function undo() {
  if (!board || undoBoardId !== board.id || undoDraft === null) return;
  const previous = undoDraft;
  undoDraft = null;
  undoBoardId = null;
  const result = await onUpdateDraft(mode.actionToken, previous);
  if (result) await focusKey(`board:${board.id}`);
}
```

Reset calls the same `onUpdateDraft` with the board-kind empty draft and clears Undo only after an accepted response.

- [ ] **Step 5: Implement submit feedback focus**

```ts
async function submit() {
  if (!board || board.readOnly || disabled) return;
  const submittedBoardId = board.id;
  const result = await onSubmit(mode.actionToken);
  if (!result) return;
  await tick();
  if (
    result.mode.type === "analysis" &&
    result.mode.boardId === submittedBoardId
  ) {
    feedback?.focus();
  }
}
```

Render feedback as text:

```svelte
{#if board.feedback}
  <p bind:this={feedback} class="feedback" role="status" tabindex="-1">
    {board.feedback.message}
  </p>
{/if}
```

A correct submission normally returns dialogue mode; do not steal focus from `DialogueBox`.

- [ ] **Step 6: Render board progress/navigation and dispatch directly on closed board kind**

Use a semantic `<nav aria-label="分析板進度">` with one button per `scene.visibleBoards`. Mark active with `aria-current="step"` and completion with visible text.

Dispatch without a registry:

```svelte
{#if board.kind === "classify"}
  <ClassifyBoard {board} {disabled} onDraft={updateDraft} />
{:else if board.kind === "order"}
  <OrderBoard {board} {disabled} onDraft={updateDraft} />
{:else}
  <ThresholdBoard {board} {inventory} {disabled} onDraft={updateDraft} />
{/if}
```

Back selects the previous visible board through `onSelectBoard(mode.actionToken, previous.id)` and focuses the active board heading after the accepted response.

- [ ] **Step 7: Add Hint, Reset, Undo, Submit, and read-only footer**

Rules:

- hint button renders only when `board.hint !== null`;
- hint-expanded state is local and non-durable;
- Undo only when `undoBoardId === board.id && undoDraft !== null`;
- Reset only on editable non-empty draft;
- Submit on every editable board, including incomplete drafts;
- completed/read-only board displays `完成・只讀檢視` and no mutation controls.

Use a bounded grid with scrollable board body:

```css
.analysis-workbench {
  width: min(1100px, calc(100vw - 48px));
  max-height: calc(100dvh - 190px);
  margin: 18px auto 24px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  color: var(--bone);
  background: rgba(8, 8, 14, 0.94);
  border: 1px solid var(--rule-strong);
}

.board-body {
  min-height: 0;
  overflow-y: auto;
}
```

Do not hide essential controls below the body scroll area.

- [ ] **Step 8: Wire the page through existing shell/backdrop**

In `+page.svelte`, import the Task 2 wrappers and `AnalysisWorkbench`. Add the route next to interrogation:

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

Do not change `GameShell` or `state/mode.ts` behavior.

If PR #44's temporary threshold-only `AnalysisView` and old analysis wrappers exist after rebasing, remove them now and keep only this route.

- [ ] **Step 9: Add Analysis scene label to the existing Scene Select**

Change `SceneNavigationPanel.svelte` to accept the expanded union and return `分析`:

```ts
function sceneTypeLabel(
  type: "linear" | "investigation" | "interrogation" | "analysis",
) {
  if (type === "investigation") return "調查";
  if (type === "interrogation") return "詰問";
  if (type === "analysis") return "分析";
  return "對話";
}
```

Add an Analysis entry to `SceneNavigationPanel.test.ts` and assert the small label includes `分析 · analysis_scene_8_5`.

- [ ] **Step 10: Run focused feature tests**

Run:

```bash
bun run --cwd apps/game test \
  src/lib/analysis/analysis-boundary.test.ts \
  src/lib/analysis/response-fence.test.ts \
  src/lib/components/analysis/ClassifyBoard.test.ts \
  src/lib/components/analysis/OrderBoard.test.ts \
  src/lib/components/analysis/ThresholdBoard.test.ts \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/components/SceneNavigationPanel.test.ts
bun run --cwd apps/game check
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/game/src/lib/components/analysis apps/game/src/routes/+page.svelte apps/game/src/lib/components/SceneNavigationPanel.svelte apps/game/src/lib/components/SceneNavigationPanel.test.ts
git add -u apps/game/src/lib/components/AnalysisView.svelte apps/game/src/lib/components/AnalysisView.test.ts 2>/dev/null || true
git commit -m "feat(game-ui): compose analysis workbench"
```

---

### Task 7: Prove the first-version accessibility/ownership floor and prepare HPA-262 handoff

**Files:**
- Modify only files found by failing tests/checks from Tasks 1–6.
- Do not add a second E2E harness or production-only compatibility layer.

**Interfaces:**
- Consumes: complete HPA-261 frontend feature.
- Produces: fixture-backed UI acceptance ready for HPA-262 live runtime parity.

- [ ] **Step 1: Add an exhaustive keyboard completion test at the workbench level**

Extend `AnalysisWorkbench.test.ts` with one test per board that uses only `user.keyboard("{Enter}")` on native controls and a harness that applies each emitted draft back into its reactive fixture view. The final assertion is not correctness; it is that the public draft can reach a structurally complete state without pointer or drag interaction:

```ts
expect(classifyDraft.groupByCard).toHaveProperty("miyake_call");
expect(classifyDraft.groupByCard).toHaveProperty("l_corridor_replay");
expect(classifyDraft.groupByCard).toHaveProperty("external_credential_event");

expect(orderDraft.cardIds).toHaveLength(4);
expect(orderDraft.cardIds[0]).toBe("event_1841");

expect(thresholdDraft.selectedCardIds).toHaveLength(2);
```

Do not assert these drafts are accepted solutions. The harness deliberately verifies interaction completeness only.

- [ ] **Step 2: Add a text/focus accessibility regression test**

Pin:

- feedback has `role="status"` and textual copy;
- fixed anchors have visible `固定位置` text;
- completed board has visible `完成・只讀檢視` text;
- every board mutation is a native button;
- no `draggable="true"` appears in the Analysis DOM.

- [ ] **Step 3: Re-run the hidden-answer boundary scan after all component files exist**

Run:

```bash
bun run --cwd apps/game test src/lib/analysis/analysis-boundary.test.ts
```

Expected: PASS with every planned Analysis feature file now included by the source guard.

- [ ] **Step 4: Run the complete frontend verification set**

Run:

```bash
bun run --cwd apps/game test
bun run --cwd apps/game check
bun run --cwd apps/game check:e2e
bun run lint:all
```

Expected:

- Vitest passes;
- Svelte check reports 0 errors / 0 warnings;
- E2E TypeScript compiles with the new `analysis` scene/mode union;
- lint/format/rust checks remain clean even though HPA-261 changes no Rust runtime behavior.

If HPA-260 has merged by this point, rebase on current `main` before the final run and make the TypeScript field names exactly match its serialized public view. Do not add a compatibility adapter for the pre-merge fixture shape.

- [ ] **Step 5: Verify the PR #44 overlap is gone**

Run:

```bash
git grep -n "set_analysis_selection\|submit_analysis_selection\|components/AnalysisView"
```

Expected: no match in production frontend source after PR #44 has merged. If PR #44 never merged, there is naturally nothing to remove.

Also run:

```bash
git grep -n "acceptedGroupByCard\|acceptedOrder\|acceptedSelections" -- apps/game/src/lib apps/game/src/routes
```

Expected: matches are limited to the ownership-boundary test strings themselves; no production Analysis source or public fixture contains them.

- [ ] **Step 6: Commit final test/cleanup changes**

```bash
git add apps/game/src/lib apps/game/src/routes

git commit -m "test(game-ui): accept analysis workbench interactions"
```

- [ ] **Step 7: Handoff notes for HPA-262**

Record these exact integration checks in the implementation PR body or HPA-262 handoff comment:

```text
HPA-262 must replace fixture confidence with live Rust responses for:
1. Beat 8.5 classify partial -> save/title/Continue -> exact draft.
2. Beat 8.5 order partial with event_1841 fixed -> exact restore.
3. Beat 8.5 threshold partial -> exact restore and public provenance badges.
4. Wrong/incomplete submit -> Rust-authored text feedback + focus return.
5. Correct submit -> result dialogue once; completed board reopens read-only.
6. Full keyboard-only classify -> order -> threshold -> outro -> existing hearing handoff.
7. No serialized accepted mapping/order/selections in GameStateView.
```

HPA-261 does not duplicate those packaged runtime acceptance tests.

---

## Plan Self-Review

### Spec coverage

- Three Chapter 1 board families: Tasks 3–5.
- Workbench title/prompt/progress/back/hint/feedback/submit: Task 6.
- Pointer/keyboard parity: Tasks 3–5 plus Task 7 exhaustive keyboard pass.
- Fixed anchors: Task 4.
- Source/procedure badges without local threshold truth: Task 5.
- Undo/reset: Task 6.
- Solved read-only review: Task 6.
- Rust-ownership fixture/source guard: Tasks 1 and 7.
- Stale response protection: Task 2.
- Existing shell/Case File/acquisition/audio/Escape isolation: Tasks 2 and 6, with intentionally unchanged owners.
- 1280×720 target: Task 6 bounded layout; live packaged visual acceptance remains HPA-262's cross-layer responsibility.
- PR #44 threshold-only overlap: Task 6/7 cleanup gate.

### Type consistency

The same `AnalysisActionToken` and `AnalysisDraft` types flow from `state/types.ts` -> game client wrappers -> workbench -> board components. Board components emit full replacement drafts; only `game-client.svelte.ts` speaks Tauri command names.

### Scope check

This is one focused frontend feature. It does not absorb HPA-260 runtime work, HPA-262 packaged integration, HPA-263 rich feedback, HPA-561 story/tooling hardening, or Chapter 2 template expansion.

## Execution Handoff

Plan complete at `docs/superpowers/plans/2026-08-08-hpa-261-chapter-1-analysis-workbench-ui-implementation-plan.md`.

Recommended execution mode after review: **Subagent-Driven** — each task has an isolated component/contract surface and an independent test gate, which makes review between tasks cheap while HPA-260 continues in parallel.
