# HPA-621 Analysis Workbench Redesign Implementation Plan

> **For agentic workers:** use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Keep each implementation PR independently green and reviewable.

**Goal:** implement the approved `Analysis Workbench v3.dc.html` hierarchy for both production Chapter 1 Analysis scenes while preserving Rust correctness, whole-draft commands, exact persistence, and semantic fallback input.

**Architecture:** keep existing component boundaries. Add pure presentation/Classify/Order transforms, a GameShell Analysis scene-presentation seam, a local AnalysisCard Pointer Events gesture with injectable hit resolution, workspace-only board components, and no new result modal. Successful boards use the engine-authored `AnalysisResult` dialogue; rejection stays inline in the workbench.

**Tech stack:** Svelte 5 runes, TypeScript, existing Lyra tokens, Pointer Events, Testing Library + Vitest/jsdom, WebdriverIO 9, current Tauri/Rust Analysis runtime.

## Global constraints

- Keep `AnalysisWorkbench -> onUpdateDraft(actionToken, wholeDraft) -> Rust` as the only semantic draft mutation path.
- Do not change `apps/game/src-tauri/**`, Analysis wire types, authored content, save schema, migrations, or correctness ownership.
- Preserve the existing `interrogationPresentation` GameShell behavior.
- No `AnalysisResultOverlay`, generated success copy, result scrim, result focus trap, or page-level result state.
- Successful submission uses authored Analysis Result Dialogue.
- Rejected/incomplete submission uses existing runtime feedback inline and keeps the board retryable.
- No HTML5 drag-and-drop, DnD library, shared drag manager/registry, floating clone, touch long-press, or future-board abstraction.
- Mouse/pen pickup starts only after movement exceeds 4 CSS pixels; touch stays on semantic controls.
- Classify fallback and pointer placement share one pure transform.
- Order arbitrary placement extends existing `order-draft.ts` only.
- Threshold has no custom drag and retains every current provenance field.
- The rail is `分析工作台` / `本案分析`, never `案件檔案`.
- P1 practice is a production acceptance case.
- Reuse the existing `analysis-beat85` packaged suite and risk routing.
- Run Svelte autofixer on every changed Svelte file before each implementation PR is declared ready.

## Why the result modal was removed

`submit_analysis_board` already installs an authored `AnalysisResult` dialogue segment for a correct board. Both current production sources contain Result Dialogue:

- `docs/stories_plan/chapter_1/analysis_scene_p1_5.md`;
- `docs/stories_plan/chapter_1/analysis_scene_8_5.md` for all three boards.

Adding a modal would duplicate the story-authored confirmation, hide/delay the dialogue, and require unrelated page-level focus/Escape/inert machinery. HPA-621 instead keeps Analysis scene presentation active through same-scene dialogue.

If a future board omits Result Dialogue, fix that content rather than manufacturing a TypeScript success narrative.

## Execution slicing

PR #60 remains a planning-only PR. Implement HPA-621 in three PRs:

1. **PR A — Shell and hierarchy**: presentation predicate/progress, GameShell fitted viewport, Workbench rail/header/footer/focus, P1 + Beat 8.5 layout acceptance.
2. **PR B — Direct manipulation**: pure Classify transform, AnalysisCard pointer gesture, Classify, explicit packaged pointer transport decision, Order helper + Order drag UX.
3. **PR C — Threshold and journey hardening**: Threshold v3 visual pass, final packaged journey, exact three-board partial persistence, regression/manual verification.

Do not put unused Order code in PR A just to preserve old task numbering.

---

# PR A — Shell and hierarchy

## Task A1: Add Analysis presentation predicate and progress helpers

**Files**
- Create: `apps/game/src/lib/analysis/presentation.ts`
- Create: `apps/game/src/lib/analysis/presentation.test.ts`

### Public API

```ts
import type { AnalysisBoardView, Mode, SceneView } from "$lib/state/types";

export type AnalysisBoardProgress = {
  current: number;
  target: number;
  percent: number;
};

export function isAnalysisPresentationActive(
  scene: SceneView,
  mode: Mode,
): boolean;

export function analysisBoardProgress(
  board: AnalysisBoardView,
): AnalysisBoardProgress;

export function analysisOverallProgress(
  boards: AnalysisBoardView[],
): AnalysisBoardProgress;
```

### Step A1.1 — Write failing predicate tests

Cover all branches:

```ts
expect(isAnalysisPresentationActive(analysisScene, analysisMode)).toBe(true);

expect(
  isAnalysisPresentationActive(analysisScene, {
    ...dialogueMode,
    queueToken: { sceneId: analysisScene.id, queueGen: 9, cursor: 0 },
  }),
).toBe(true);

expect(
  isAnalysisPresentationActive(analysisScene, {
    ...dialogueMode,
    queueToken: { sceneId: "another_scene", queueGen: 9, cursor: 0 },
  }),
).toBe(false);

expect(isAnalysisPresentationActive(investigationScene, dialogueMode)).toBe(false);
```

The same-scene Dialogue case intentionally covers Analysis intro, Result Dialogue, and outro; the public mode does not expose private segment origin.

### Step A1.2 — Write failing progress tests

Use current fixtures.

- Classify counts only available authored cards assigned to authored groups.
- Unknown card/group IDs do not inflate progress.
- Order materializes fixed prefix and counts it once.
- Threshold target is `minimumSelected`; percentage caps at 100.
- Completed board is 100%.
- Overall counts completed visible boards / all visible boards.

Representative:

```ts
expect(analysisBoardProgress(threshold)).toEqual({
  current: 3,
  target: 2,
  percent: 100,
});

expect(analysisOverallProgress(boards)).toMatchObject({
  current: 1,
  target: 3,
});
```

Use `toBeCloseTo` for fractional percentages.

### Step A1.3 — Run RED

```bash
bun run --cwd apps/game test src/lib/analysis/presentation.test.ts
```

Expected: FAIL because module/API is absent.

### Step A1.4 — Implement the pure helpers

Predicate:

```ts
export function isAnalysisPresentationActive(
  scene: SceneView,
  mode: Mode,
): boolean {
  return (
    scene.kind === "analysis" &&
    (mode.type === "analysis" ||
      (mode.type === "dialogue" && mode.queueToken.sceneId === scene.id))
  );
}
```

For Order progress, reuse `materializePrefixAnchors()` rather than duplicating fixed-prefix rules. Progress helpers never throw on a stale public view; invalid IDs simply do not count.

### Step A1.5 — Run GREEN

```bash
bun run --cwd apps/game test src/lib/analysis/presentation.test.ts
```

Expected: PASS.

---

## Task A2: Add fitted GameShell Analysis presentation

**Files**
- Modify: `apps/game/src/lib/components/GameShell.svelte`
- Modify: `apps/game/src/lib/components/GameShell.test.ts`
- Modify: `apps/game/src/routes/+page.svelte`
- Modify: focused page test only where behavioral wiring genuinely benefits from a source guard

### Step A2.1 — Add failing GameShell behavioral tests

Add `analysisPresentation?: boolean` with default false.

Test:

1. false preserves normal Analysis chapter chrome;
2. true hides normal FILE/title/summary/objective chapter chrome;
3. children and existing menu path still render;
4. existing `interrogationPresentation` behavior remains unchanged;
5. Analysis presentation class/data hook is present.

Do **not** assert literal CSS source strings.

### Step A2.2 — Run RED

```bash
bun run --cwd apps/game test src/lib/components/GameShell.test.ts
```

### Step A2.3 — Implement the sibling prop and viewport containment

Keep the existing interrogation seam and add:

```ts
analysisPresentation = false
```

Chapter chrome rule includes `!analysisPresentation`.

Give the shell an Analysis presentation class and make it the fitted containing block:

```css
.shell.analysis-presentation {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
}

.shell.analysis-presentation > main {
  flex: 1 1 auto;
  min-height: 0;
}
```

Preserve one `GameAtmosphere`, one Game Menu, Case File ownership, Escape, persistence, and save-thumbnail layout behavior.

### Step A2.4 — Wire the tested helper in `+page.svelte`

Import `isAnalysisPresentationActive` and derive from current state:

```ts
let analysisPresentationActive = $derived(
  gameState.value !== null &&
    isAnalysisPresentationActive(
      gameState.value.scene,
      gameState.value.mode,
    ),
);
```

Pass it to the existing GameShell instance. Do not duplicate the predicate in page code.

### Step A2.5 — Autofix and run GREEN

```bash
npx @sveltejs/mcp svelte-autofixer apps/game/src/lib/components/GameShell.svelte
npx @sveltejs/mcp svelte-autofixer apps/game/src/routes/+page.svelte
bun run --cwd apps/game test src/lib/components/GameShell.test.ts
bun run --cwd apps/game test src/lib/analysis/presentation.test.ts
bun run --cwd apps/game check
```

---

## Task A3: Build the v3 Workbench host and preserve focus anchors

**Files**
- Modify: `apps/game/src/lib/components/analysis/AnalysisWorkbench.svelte`
- Modify: `apps/game/src/lib/components/analysis/AnalysisWorkbench.test.ts`
- Modify: `ClassifyBoard.svelte` / test
- Modify: `OrderBoard.svelte` / test
- Modify: `ThresholdBoard.svelte` / test

### Step A3.1 — Add failing hierarchy tests

Beat 8.5:

- rail label is `分析工作台` or `本案分析`, never `案件檔案`;
- all `visibleBoards` render, including locked/completed;
- active has `aria-current="page"`;
- locked is disabled;
- completed remains navigable for review;
- per-board native `<progress>` + text;
- overall native `<progress>` + completed/total text;
- one host board heading/prompt/hint;
- workspace scroll region;
- persistent utility/feedback/submit footer;
- completed and non-completed readOnly are visibly distinct.

P1:

- exactly one rail entry;
- no invented siblings;
- practice Threshold still renders;
- existing wrong-choice feedback remains available.

Preserve the invariant that Workbench does not mount `CaseFilePanel`.

### Step A3.2 — Add explicit focus-migration tests

Existing focus behavior is load-bearing. Add assertions before moving headings:

1. board switch focuses the **host** board heading;
2. after fallback Classify Assign, focus lands on `card:<id>` once AnalysisCard has that anchor later, or the current board heading until PR B adds it;
3. after host migration, fallback to `board:<id>` never lands on `<body>`.

For PR A, pin the host anchor explicitly:

```ts
expect(hostHeading).toHaveAttribute(
  "data-analysis-focus-key",
  `board:${boardId}`,
);
```

### Step A3.3 — Make board components workspace-only

Move title/prompt/hint to Workbench and put the focus anchor on the host heading:

```svelte
<h2
  tabindex="-1"
  data-analysis-focus-key={`board:${boardForRender.id}`}
>
  {boardForRender.label}
</h2>
```

Remove `headingFocusKey` from Classify/Order/Threshold props and their child `<h2>` elements.

Boards retain semantic region labels and controls only.

### Step A3.4 — Render all visible boards in the rail

Do not filter navigation to `availableBoardIds`.

State order:

- completed;
- current active;
- available;
- locked.

Do not call `onSelectBoard` for locked or already-current entries. Completed entries remain selectable for review according to the existing runtime contract.

### Step A3.5 — Add progress and fitted shell layout

Use Task A1 helpers. Stable hooks:

```html
data-analysis-board-id="<id>"
data-analysis-board-state="active|available|completed|locked"
```

Host layout:

```css
.analysis-workbench {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(220px, 272px) minmax(0, 1fr);
  overflow: hidden;
}

.board-region {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.board-workspace {
  min-height: 0;
  overflow: auto;
}
```

Use vertical compaction for 720px-height desktop if needed. Do not rely on the 720px-width mobile breakpoint.

### Step A3.6 — Keep rejection inline

Keep current `boardFeedback` ownership and focus behavior. Move it visually into the host footer/result area and restyle to the v3 Rejected language, but do not add a modal.

Preserve runtime-authored message and retryability.

### Step A3.7 — Run focused GREEN

```bash
npx @sveltejs/mcp svelte-autofixer apps/game/src/lib/components/analysis/AnalysisWorkbench.svelte
npx @sveltejs/mcp svelte-autofixer apps/game/src/lib/components/analysis/ClassifyBoard.svelte
npx @sveltejs/mcp svelte-autofixer apps/game/src/lib/components/analysis/OrderBoard.svelte
npx @sveltejs/mcp svelte-autofixer apps/game/src/lib/components/analysis/ThresholdBoard.svelte
bun run --cwd apps/game test src/lib/components/analysis/AnalysisWorkbench.test.ts
bun run --cwd apps/game test src/lib/components/analysis/ClassifyBoard.test.ts
bun run --cwd apps/game test src/lib/components/analysis/OrderBoard.test.ts
bun run --cwd apps/game test src/lib/components/analysis/ThresholdBoard.test.ts
bun run --cwd apps/game check
```

---

## Task A4: Validate 1280x720 immediately

Do not defer the core layout risk until the last implementation PR.

Run the game at **1280x720** and manually verify both production shapes:

### P1 practice

- one rail entry looks intentional;
- board header/footer fit without dead space dominating;
- Threshold cards scroll within workspace when needed;
- submit remains visible.

### Beat 8.5

For Classify, Order, Threshold:

- one fitted viewport; no body/page stacked vertical scroll;
- rail visible;
- board header/footer visible;
- primary submit visible;
- long content scrolls only inside workspace;
- no overlap/clipping;
- Game Menu still opens correctly.

Record any layout correction in PR A before merging. Do not add a screenshot framework.

### PR A final verification

```bash
bun run --cwd apps/game test src/lib/analysis/presentation.test.ts
bun run --cwd apps/game test src/lib/components/GameShell.test.ts
bun run --cwd apps/game test src/lib/components/analysis/AnalysisWorkbench.test.ts
bun run --cwd apps/game check
```

Then commit/push/open the first implementation PR.

---

# PR B — Direct manipulation

## Task B1: Add the pure Classify placement transform

**Files**
- Create: `apps/game/src/lib/analysis/classify-draft.ts`
- Create: `apps/game/src/lib/analysis/classify-draft.test.ts`

### Interface

```ts
export type ClassifyPlacementTarget =
  | { kind: "unassigned" }
  | { kind: "group"; groupId: string };

export function applyClassifyPlacement(
  board: ClassifyBoardView,
  groupByCard: Record<string, string>,
  cardId: string,
  target: ClassifyPlacementTarget,
): Record<string, string> | null;
```

### Step B1.1 — Write RED table tests

Cover:

- assign;
- group-to-group move;
- unassign;
- same-group no-op returns same object;
- already-unassigned no-op returns same object;
- unknown card -> null;
- unavailable card -> null;
- unknown group -> null.

### Step B1.2 — Run RED

```bash
bun run --cwd apps/game test src/lib/analysis/classify-draft.test.ts
```

### Step B1.3 — Implement minimal transform and GREEN

```bash
bun run --cwd apps/game test src/lib/analysis/classify-draft.test.ts
```

No DOM or Pointer Events in this module.

---

## Task B2: Add AnalysisCard Pointer Events with injectable hit resolution

**Files**
- Modify: `apps/game/src/lib/components/analysis/AnalysisCard.svelte`
- Modify: `apps/game/src/lib/components/analysis/AnalysisCard.test.ts`

Use the sibling `apps/layout-editor/src/lib/EditorCanvas.svelte` state-machine pattern: `pointerId`, `startX`, `startY`, `moved`, threshold, best-effort capture.

### Interface

```ts
focusKey?: string | null;
dragEnabled?: boolean;
settled?: boolean;
resolveDropTarget?: (x: number, y: number) => string | null;
onDragStart?: () => void;
onDragTargetChange?: (targetId: string | null) => void;
onDrop?: (targetId: string | null) => void;
onDragCancel?: () => void;
```

Production default safely uses:

```ts
const elements = document.elementsFromPoint?.(x, y) ?? [];
```

Unit tests do **not** rely on jsdom hit testing. They inject `resolveDropTarget: vi.fn(...)`.

### Step B2.1 — Write failing gesture tests

Cover:

- 4px or less does not pick up;
- movement greater than 4px calls `onDragStart` once;
- mouse/pen work;
- touch does not start custom drag;
- resolver target changes emit opaque ID;
- pointer up emits one drop;
- pointer cancel emits no drop;
- completed drag suppresses physical follow-on click;
- semantic click still works without drag;
- non-button branch is real `<article>` and gains no fake button role;
- focus hook is `card:<id>`.

### Step B2.2 — Run RED

```bash
bun run --cwd apps/game test src/lib/components/analysis/AnalysisCard.test.ts
```

### Step B2.3 — Implement and GREEN

Use `setPointerCapture?.()` / `releasePointerCapture?.()` best-effort. Do not make lack of capture throw.

```bash
npx @sveltejs/mcp svelte-autofixer apps/game/src/lib/components/analysis/AnalysisCard.svelte
bun run --cwd apps/game test src/lib/components/analysis/AnalysisCard.test.ts
```

---

## Task B3: Wire Classify fallback and drag through the pure transform

**Files**
- Modify: `ClassifyBoard.svelte`
- Modify: `ClassifyBoard.test.ts`

Targets:

```text
classify:unassigned
classify:group:<group id>
```

### Step B3.1 — Add failing component tests

Component tests should test **dispatch**, not duplicate the pure placement table:

- Assign button calls helper path and emits one changed draft;
- Remove button calls the same helper path;
- drag target group emits one changed draft;
- drag back unassigned emits one changed draft;
- same region and invalid target emit zero `onDraft` calls;
- live region gives textual no-op/invalid state;
- successful mutation focus requests `card:<id>`.

Inject resolver stubs through the rendered AnalysisCard path so jsdom never needs `elementsFromPoint`.

### Step B3.2 — Implement target decode

```ts
function decodeClassifyTarget(id: string | null): ClassifyPlacementTarget | null {
  if (id === "classify:unassigned") return { kind: "unassigned" };
  const prefix = "classify:group:";
  return id?.startsWith(prefix)
    ? { kind: "group", groupId: id.slice(prefix.length) }
    : null;
}
```

Assign, Remove, and drop all call `applyClassifyPlacement()`.

Only call `onDraft` when returned mapping is non-null and not the same object.

### Step B3.3 — Autofix / GREEN / focus regression

```bash
npx @sveltejs/mcp svelte-autofixer apps/game/src/lib/components/analysis/ClassifyBoard.svelte
bun run --cwd apps/game test src/lib/analysis/classify-draft.test.ts
bun run --cwd apps/game test src/lib/components/analysis/AnalysisCard.test.ts
bun run --cwd apps/game test src/lib/components/analysis/ClassifyBoard.test.ts
bun run --cwd apps/game test src/lib/components/analysis/AnalysisWorkbench.test.ts
```

At this point add/confirm the post-assign Workbench focus test: the moved card is the active element; fallback must not land on `<body>`.

---

## Task B4: Make the packaged pointer transport decision

This is a development decision checkpoint, **not** a runtime fallback.

### Step B4.1 — Add a temporary/probe helper in `analysis-beat85.e2e.ts`

Target stable hooks only:

```text
[data-analysis-card-id]
[data-analysis-drop-target]
```

Probe WebdriverIO W3C pointer actions against packaged WebKit.

### Step B4.2 — Run focused suite

```bash
node apps/game/scripts/run-save-e2e.mjs --suite analysis-beat85
```

### Step B4.3 — Choose exactly one committed transport

**If W3C works reliably:** commit a W3C-only drag helper.

**If W3C is unsupported/unreliable:** commit a `browser.execute()` helper that dispatches `PointerEvent` to the same production listeners.

In the synthetic case, put an explicit comment in the test and PR:

> Packaged coverage proves the production Pointer Events listener and target-resolution path; driver-level pointer transport is not asserted on this WebKit driver.

Do not ship:

```ts
try {
  await w3cDrag();
} catch {
  await syntheticDrag();
}
```

A hidden fallback makes a broken W3C path permanently green and defeats the proof.

---

## Task B5: Extend Order helper and build timeline/pending drag UX

**Files**
- Modify: `apps/game/src/lib/analysis/order-draft.ts`
- Modify: `order-draft.test.ts`
- Modify: `OrderBoard.svelte`
- Modify: `OrderBoard.test.ts`

### Pure helper

```ts
export function placeOrderCardBefore(
  board: OrderBoardView,
  cardIds: string[],
  cardId: string,
  beforeCardId: string | null,
): string[] | null;
```

Pure tests cover:

- pending insert before movable;
- reorder;
- append;
- valid no-op;
- unknown/unavailable source;
- fixed-anchor source rejection;
- unknown/fixed-prefix target rejection.

### UI targets

```text
order:before:<movable id>
order:end
order:pending
```

Required UX:

- vertical numbered timeline;
- fixed anchors visually distinct, no drag source/target;
- pending pool;
- stable insertion gutters at rest;
- active insertion preview;
- pending -> insert;
- timeline -> reorder;
- timeline -> pending removal;
- Add/Up/Down/Remove semantic fallback remains.

Component tests inject the AnalysisCard resolver rather than relying on jsdom hit-testing.

### Task B5 verification

```bash
npx @sveltejs/mcp svelte-autofixer apps/game/src/lib/components/analysis/OrderBoard.svelte
bun run --cwd apps/game test src/lib/analysis/order-draft.test.ts
bun run --cwd apps/game test src/lib/components/analysis/OrderBoard.test.ts
bun run --cwd apps/game test src/lib/components/analysis/AnalysisCard.test.ts
bun run --cwd apps/game check
node apps/game/scripts/run-save-e2e.mjs --suite analysis-beat85
```

The packaged suite must use the transport selected at Task B4; no fallback switching.

---

# PR C — Threshold and journey hardening

## Task C1: Apply v3 Threshold presentation without changing interaction

**Files**
- Modify: `ThresholdBoard.svelte`
- Modify: `ThresholdBoard.test.ts`
- Modify `AnalysisCard.svelte` only if compact badges require a presentational prop that is already justified

### Required behavior

Keep existing selection semantics:

- native button;
- `aria-pressed`;
- click/tap/Space/Enter toggle;
- sorted whole-draft update;
- no drag zones.

Add/retain:

- explicit Selected marker/text;
- `已選 X / 至少 Y`;
- native `<progress max={minimumSelected} value={...}>`;
- full provenance when inventory record exists:
  1. source kind;
  2. procedural status;
  3. source;
  4. source group;
  5. proof capabilities.

Practice cards have no inventory record; render no invented provenance.

### Tests

Beat 8.5:

- all five provenance categories remain visible when fixture supplies them;
- count/meter update;
- keyboard toggle works;
- read-only state retains selection/provenance but no mutation.

P1:

- practice cards render;
- no fake source badges;
- wrong selection feedback remains owned by Workbench;
- correct submit proceeds to authored P1 Result Dialogue.

### Verification

```bash
npx @sveltejs/mcp svelte-autofixer apps/game/src/lib/components/analysis/ThresholdBoard.svelte
bun run --cwd apps/game test src/lib/components/analysis/ThresholdBoard.test.ts
bun run --cwd apps/game test src/lib/components/analysis/AnalysisWorkbench.test.ts
```

---

## Task C2: Expand the packaged Beat 8.5 journey and exact persistence proof

**Files**
- Modify: `apps/game/e2e-tauri/analysis-beat85.e2e.ts`

Keep the existing registered suite. Do not create `test:e2e:analysis-beat85` or edit risk routing.

### Step C2.1 — Keep helper semantics explicit

Use the one pointer helper selected in PR B.

Prove Classify through pointer input:

- assign unassigned -> group;
- move group -> group where useful;
- unassign/reassign or equivalent drag-back path;
- authoritative state matches expected draft.

Prove Order through the same selected pointer transport:

- pending -> precise insertion;
- reorder;
- timeline -> pending removal;
- final correct order.

Threshold stays click/tap-equivalent button activation, not pointer drag.

### Step C2.2 — Prove partial Classify persistence

1. start from Beat 8.5 checkpoint;
2. place only part of Classify;
3. Save -> Title -> Continue;
4. assert exact `groupByCard` restored;
5. complete/submit board;
6. advance authored Result Dialogue to next board.

### Step C2.3 — Prove partial Order persistence

1. place only part of movable Order cards;
2. Save -> Title -> Continue;
3. assert exact `cardIds` restored including fixed-prefix semantics;
4. finish and submit;
5. advance authored Result Dialogue.

### Step C2.4 — Preserve/extend partial Threshold persistence

1. select one eligible card;
2. Save -> Title -> Continue;
3. assert exact selected IDs;
4. finish and submit.

### Step C2.5 — Prove final hearing handoff

Drain Analysis result/outro dialogue and preserve the current hearing transition assertion.

### Run focused packaged suite

```bash
node apps/game/scripts/run-save-e2e.mjs --suite analysis-beat85
```

---

## Task C3: Final regression and 1280x720 re-check

Run focused unit suites:

```bash
bun run --cwd apps/game test src/lib/analysis/presentation.test.ts
bun run --cwd apps/game test src/lib/analysis/classify-draft.test.ts
bun run --cwd apps/game test src/lib/analysis/order-draft.test.ts
bun run --cwd apps/game test src/lib/components/GameShell.test.ts
bun run --cwd apps/game test src/lib/components/analysis/AnalysisWorkbench.test.ts
bun run --cwd apps/game test src/lib/components/analysis/AnalysisCard.test.ts
bun run --cwd apps/game test src/lib/components/analysis/ClassifyBoard.test.ts
bun run --cwd apps/game test src/lib/components/analysis/OrderBoard.test.ts
bun run --cwd apps/game test src/lib/components/analysis/ThresholdBoard.test.ts
bun run --cwd apps/game check
```

Run packaged proof:

```bash
node apps/game/scripts/run-save-e2e.mjs --suite analysis-beat85
```

Then re-check **1280x720** manually for P1 + all Beat 8.5 board states:

- fitted single viewport;
- no body/page stacked scrolling;
- rail/header/footer visible;
- workspace scroll only;
- primary action reachable;
- locked/completed states readable;
- inline Rejected feedback readable/focusable;
- authored Result Dialogue stays in Analysis scene presentation with no chapter-chrome flash;
- reduced-motion setting removes nonessential drag/settle/progress motion.

Do not claim all tests/builds pass unless the commands above were run fresh and exited successfully.

---

# Final expected production surface

Create:

- `apps/game/src/lib/analysis/presentation.ts`
- `apps/game/src/lib/analysis/presentation.test.ts`
- `apps/game/src/lib/analysis/classify-draft.ts`
- `apps/game/src/lib/analysis/classify-draft.test.ts`

Modify:

- `apps/game/src/lib/analysis/order-draft.ts`
- `apps/game/src/lib/analysis/order-draft.test.ts`
- `apps/game/src/lib/components/GameShell.svelte`
- `apps/game/src/lib/components/GameShell.test.ts`
- `apps/game/src/lib/components/analysis/AnalysisWorkbench.svelte`
- `apps/game/src/lib/components/analysis/AnalysisWorkbench.test.ts`
- `apps/game/src/lib/components/analysis/AnalysisCard.svelte`
- `apps/game/src/lib/components/analysis/AnalysisCard.test.ts`
- `apps/game/src/lib/components/analysis/ClassifyBoard.svelte`
- `apps/game/src/lib/components/analysis/ClassifyBoard.test.ts`
- `apps/game/src/lib/components/analysis/OrderBoard.svelte`
- `apps/game/src/lib/components/analysis/OrderBoard.test.ts`
- `apps/game/src/lib/components/analysis/ThresholdBoard.svelte`
- `apps/game/src/lib/components/analysis/ThresholdBoard.test.ts`
- `apps/game/src/routes/+page.svelte`
- `apps/game/e2e-tauri/analysis-beat85.e2e.ts`

Not created:

- `AnalysisResultOverlay.svelte`;
- result-overlay tests/state;
- a seventh focus trap;
- a new E2E suite or package script;
- a DnD framework/store;
- Rust/schema/save changes.

# Acceptance checklist

- [ ] Pure `isAnalysisPresentationActive()` covers Analysis mode and same-scene dialogue.
- [ ] GameShell remains in Analysis presentation through authored Result Dialogue and no chapter chrome flashes mid-scene.
- [ ] 1280x720 fit is verified in PR A, not deferred to final polish.
- [ ] Workbench rail is Analysis navigation, never a second Case File.
- [ ] P1 single-board practice looks intentional and keeps wrong-choice + authored result behavior.
- [ ] Host heading owns `board:<id>` focus key after child headings are removed.
- [ ] Board switch and post-mutation focus never collapse to body.
- [ ] Progress is participation/completion-only and never contains accepted solutions.
- [ ] Classify fallback + drag share one pure transform.
- [ ] AnalysisCard tests inject `resolveDropTarget`; jsdom layout hit-testing is not required.
- [ ] Pointer state machine follows the existing EditorCanvas precedent where applicable.
- [ ] Pointer transport is chosen once at PR B decision gate; no hidden fallback.
- [ ] Order fixed anchors remain immutable and outside target/source DOM.
- [ ] Threshold remains direct selection with full existing provenance.
- [ ] Rejected feedback is inline, runtime-authored, focusable, and retryable.
- [ ] Successful submit uses authored `AnalysisResult` dialogue; no generated Confirmed modal.
- [ ] `analysis-beat85` proves selected pointer path, Threshold selection, exact Classify/Order/Threshold partial persistence, submissions, and hearing handoff.
- [ ] No Rust/schema/save/evaluator/future-board abstraction added.
