# HPA-261 Chapter 1 Analysis Workbench UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Chapter 1 Analysis workbench on top of merged HPA-260 while preserving the playable P1 tutorial, adding classify/order/threshold interactions, and keeping Rust authoritative for correctness and durable state.

**Architecture:** Reuse the existing public Analysis types, runtime commands, save model, page route, and action-token fencing. Replace the threshold-only `AnalysisView` with one `AnalysisWorkbench` and three focused board components. Add only the small contracts the UI genuinely requires: fail-closed public fixtures, a compiler-enforced prefix-anchor rule with defensive order algebra, and one shared Case File provenance-label helper.

**Tech Stack:** Svelte 5, TypeScript, existing Tauri game client, HPA-260 Analysis runtime, Vitest, Testing Library Svelte, existing scene compiler, packaged Tauri/WDIO production journey.

## Global Constraints

- Start/rebase implementation from current `main` containing merged PR #44 and PR #47.
- Support exactly `classify`, `order`, and `threshold`.
- Preserve the existing P1 `practice:` threshold tutorial, including authored wrong-choice feedback.
- Preserve the packaged P1 accessibility anchors unless deliberately updated in the same task:
  - root `aria-label="分析板"`;
  - existing P1 card accessible names;
  - submit button text `比對推論`.
- Reuse existing `AnalysisActionToken`, `AnalysisDraft`, `AnalysisBoardView`, Analysis `Mode`/`SceneView`, and the three Analysis commands; do not create adapter DTOs.
- Render `mode.boardId`; keep `mode.activeBoardId` / `mode.actionToken.activeBoardId` as the server-state mutation fence.
- Before draft update/Reset/Undo/Submit, reconcile `mode.activeBoardId !== mode.boardId` through `selectAnalysisBoard`, then use the returned state's fresh token.
- Respect public `board.available`, `board.completed`, `board.readOnly`, and `card.available`; never reconstruct unlock/correctness rules in TypeScript.
- TypeScript must not contain accepted classify mappings, accepted total order, accepted threshold subsets, source-independence truth, procedural eligibility truth, or durable reveal logic.
- Use the generic `board.draft` union for workbench interaction. Compatibility fields such as threshold `selectedCardIds` may remain in the public wire; do not make their removal HPA-261 scope.
- Order UI supports contiguous prefix anchors only. Unsupported sparse anchors fail compilation with `analysisOrderAnchorNotPrefix`.
- Never force an unavailable fixed-anchor card into a draft.
- No drag-and-drop dependency, graph/canvas framework, renderer registry, compare/route/chain abstraction, or Chapter 2 UI.
- No new Analysis frontend store, command dispatcher, response-fence module, session generation, or persistence layer.
- Preserve GameShell Escape ownership, Case File visibility, acquisition popup, audio routing, and persistence overlays.
- Case File remains visible during Analysis; record re-examination remains disabled.
- Submit remains enabled on editable structurally incomplete drafts so Rust can return authored `Incomplete` feedback.
- Completed boards are read-only: no draft mutation, Undo, Reset, or Submit.
- Beat 8.5 IDs in frontend fixtures come from the compiler/runtime **contract fixture**, not shipped production Chapter 1 content.
- HPA-265 owns production `docs/stories_plan/chapter_1/analysis_scene_8_5.md`; HPA-262 owns cross-layer integration/acceptance.
- No new npm/Bun dependency.

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
- no-thumbnail Analysis autosave;
- Scene Select Analysis type + `分析` label;
- the `+page.svelte` Analysis branch.

Merged HPA-561/HPA-260 also leave one threshold-only `AnalysisView.svelte` as the current playable P1 surface. HPA-261 migrates its useful behavior/tests before deleting it.

---

## File Structure

### Create

- `apps/game/src/lib/analysis/test-fixtures.ts`
  - P1 practice threshold public fixture migrated from current `AnalysisView.test.ts`;
  - public-only compiler-contract Beat 8.5 classify/order/threshold fixtures;
  - inventory records built from existing neutral fixture builders.
- `apps/game/src/lib/analysis/analysis-boundary.test.ts`
  - fixture ownership guard first; full feature-source scan added in Task 6 after all files exist.
- `apps/game/src/lib/analysis/order-draft.ts`
- `apps/game/src/lib/analysis/order-draft.test.ts`
- `apps/game/src/lib/case-file/provenance-badges.ts`
- `apps/game/src/lib/case-file/provenance-badges.test.ts`
- `apps/game/src/lib/components/analysis/AnalysisCard.svelte`
- `apps/game/src/lib/components/analysis/ClassifyBoard.svelte`
- `apps/game/src/lib/components/analysis/ClassifyBoard.test.ts`
- `apps/game/src/lib/components/analysis/OrderBoard.svelte`
- `apps/game/src/lib/components/analysis/OrderBoard.test.ts`
- `apps/game/src/lib/components/analysis/ThresholdBoard.svelte`
- `apps/game/src/lib/components/analysis/ThresholdBoard.test.ts`
- `apps/game/src/lib/components/analysis/AnalysisWorkbench.svelte`
- `apps/game/src/lib/components/analysis/AnalysisWorkbench.test.ts`
- `packages/scripts/__fixtures__/invalid/analysis-order-anchor-not-prefix/expected-error.txt`
  - plus a copied/modified `analysis-chapter-1` fixture tree under that invalid fixture root.

### Modify

- `packages/scripts/compile-scenes/validator-analysis.ts`
  - enforce contiguous prefix fixed anchors after existing structural checks.
- `apps/game/src/lib/components/case-file/CaseFileRecordDetail.svelte`
  - consume shared provenance presentation derivation with no visible behavior change.
- `apps/game/src/lib/components/case-file/CaseFileRecordDetail.test.ts`
  - keep current provenance copy pinned; adjust imports only if needed.
- `apps/game/src/lib/state/game-client.svelte.ts`
  - return the already-applied `GameStateView | null` from existing Analysis dispatch/wrappers.
- `apps/game/src/lib/state/game-client-source.test.ts`
  - pin wrapper payload + returned-state behavior.
- `apps/game/src/routes/+page.svelte`
  - replace `AnalysisView` with `AnalysisWorkbench`; the Analysis route already exists.
- `apps/game/src/lib/state/mode.test.ts`
  - pin current Analysis Case File-visible / reexamine-disabled behavior.
- `apps/game/src/lib/analysis/analysis-boundary.test.ts`
  - in final acceptance, extend to a fail-closed scan of all completed frontend Analysis feature files.

### Delete only after the new routed workbench passes the packaged P1 journey

- `apps/game/src/lib/components/AnalysisView.svelte`
- `apps/game/src/lib/components/AnalysisView.test.ts`

### Reuse / intentionally do not modify unless a deliberate UI-copy change requires it

- `apps/game/e2e-tauri/production-anchors.ts`
- `apps/game/e2e-tauri/helpers.ts`
- `apps/game/src/lib/state/types.ts`
- `apps/game/src/lib/audio/sfx-events.ts`
- `apps/game/src/lib/audio/sfx-events.test.ts`
- `apps/game/src/lib/components/SceneNavigationPanel.svelte`
- `apps/game/src/lib/components/SceneNavigationPanel.test.ts`
- `apps/game/src/lib/components/GameShell.svelte`
- Rust Analysis/runtime/save/view files
- production Chapter 1 authored story files

---

## Implementation Risks / Stop Conditions

### R1 — packaged P1 journey selector drift

The production journey directly queries `aria-label="分析板"`, the four P1 card names, and `比對推論`. `check:e2e` is type-only and cannot detect dead selectors.

**Stop condition:** do not delete `AnalysisView.svelte` until the routed new workbench completes `production-journey` in the packaged app.

### R2 — displayed fallback board is not the server active board

Rust may display `mode.boardId` while `mode.activeBoardId` / token active board is `null` or different. Update/submit operate on the stored active board and can return `analysisNoActiveBoard`.

**Stop condition:** no workbench mutation may call update/submit until the display board has been reconciled through `selectAnalysisBoard` when needed.

### R3 — sparse fixed anchors are legal compiler input today

The UI is intentionally prefix-only, so unsupported authoring must fail at build time rather than crash/render incorrectly.

**Stop condition:** land `analysisOrderAnchorNotPrefix` and its invalid fixture before relying on prefix-only UI algebra.

### R4 — fixed anchor may be unavailable

Rust rejects any draft containing an unavailable evidence/statement card.

**Stop condition:** never materialize a fixed anchor unless its public card is available; render the blocked-order state instead.

### R5 — provenance vocabulary drift

The threshold board needs source/procedure/proof data, but Case File already owns the user-facing vocabulary.

**Stop condition:** Case File provenance tests must remain semantically unchanged after helper extraction.

### R6 — compiler fixture mistaken for shipped story content

`packages/scripts/__fixtures__/analysis-chapter-1/chapter_1/analysis_scene_8_5.md` is not the production Chapter 1 scene.

**Stop condition:** fixture/test names say `compilerFixture`; HPA-261 must not edit `docs/stories_plan/chapter_1/scene_8_5.md` or author `analysis_scene_8_5.md`.

---

### Task 1: Pin P1 and Compiler-Contract Beat 8.5 Public Fixtures

**Files:**
- Create: `apps/game/src/lib/analysis/test-fixtures.ts`
- Create: `apps/game/src/lib/analysis/analysis-boundary.test.ts`
- Reuse: `apps/game/src/lib/state/test-fixtures.ts`

**Interfaces:**
- Consumes: existing `AnalysisBoardView`, `AnalysisDraft`, `Mode`, `SceneView`, `Inventory`, `neutralCaseRecordProvenance`, `neutralEvidenceRecordView`, `neutralStatementRecordView`.
- Produces: public-only fixtures for Tasks 2–5. No accepted answers.

- [ ] **Step 1: Move the current P1 public fixture into a shared fixture file**

Preserve the exact public semantics from current `AnalysisView.test.ts`:

- scene `analysis_scene_p1_5`;
- board `p1_reprint_time_board`;
- four `practice` cards;
- `available: true` cards;
- threshold draft `selectedCardIds: []`;
- compatibility threshold `selectedCardIds: []`;
- action token + current display/active-board values.

Do not invent inventory/provenance rows for practice cards.

Name the fixture `p1PracticeAnalysisSceneFixture`.

- [ ] **Step 2: Add public-only Beat 8.5 compiler-contract fixtures**

Use the existing compiler fixture IDs:

```text
evidence_packages      -> classify
local_event_sequence   -> order
narrow_request_basis   -> threshold
```

Name the scene fixture `beat85CompilerAnalysisSceneFixture` so it cannot be mistaken for shipped content.

Include only public data:

- classify cards/groups + empty/partial classify draft;
- order cards + `fixedAnchors: [{ cardId: "event_1841", position: 1 }]` + non-final partial order draft;
- threshold cards + `minimumSelected: 2` + empty/partial threshold draft;
- public availability/completion/read-only/feedback/hint;
- card source refs + current public source label/summary fields;
- card `available`.

Do **not** include `acceptedGroupByCard`, `acceptedOrder`, or `acceptedSelections`.

- [ ] **Step 3: Build threshold inventory rows from existing neutral builders**

Do not hand-write full record literals. Start from:

```ts
const lock = neutralEvidenceRecordView({
  id: "lock_sequence",
  name: "門鎖本機順序",
  description: "門鎖設備本機事件順序。",
  details: "只提供先後，不提供精確秒數。",
  imageAssetId: null,
  onReexamine: null,
  collectedInChapterId: "chapter_1",
  collectedInSceneId: "investigation_scene_7",
});
```

Then override only the test-relevant provenance/source group:

```ts
lock.provenance = {
  ...neutralCaseRecordProvenance(),
  sourceKind: "digital",
  proceduralStatus: "reacquired",
  sourceGroupId: "door-lock",
  sourceLabel: "雨鐘後場門鎖",
  proofCapabilities: ["time", "order"],
};
lock.sourceGroup = {
  id: "door-lock",
  label: "門鎖本機",
  summary: "雨鐘後場門鎖的本機資料。",
};
```

Build the other evidence/statement rows through `neutralEvidenceRecordView` / `neutralStatementRecordView`. Include a test-only same-source-group pair for local-independence negative coverage.

- [ ] **Step 4: Add the fixture-only answer-key guard**

Task 1 runs before later component files exist, so do **not** source-scan missing future files here.

```ts
it("keeps accepted answers out of Analysis UI fixtures", () => {
  const fixture = JSON.stringify(beat85CompilerAnalysisSceneFixture);
  expect(fixture).not.toMatch(
    /acceptedGroupByCard|acceptedOrder|acceptedSelections/,
  );
});
```

The full source scan is added in Task 6 after every file exists.

- [ ] **Step 5: Verify**

```bash
bun run --cwd apps/game test src/lib/analysis/analysis-boundary.test.ts
bun run --cwd apps/game check
```

Expected: PASS without changing `state/types.ts`.

- [ ] **Step 6: Commit**

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
- Consumes: `Extract<AnalysisBoardView, { kind: "classify" }>`.
- Produces: whole replacement classify drafts via `onDraft(draft, focusKey)` only.

- [ ] **Step 1: Write failing interaction tests**

Pin:

1. pointer click and keyboard Enter/Space produce the same assignment draft;
2. assigning an already-assigned available card to another group emits a moved mapping;
3. `移除` deletes only that card mapping;
4. `card.available === false` disables selection/assignment;
5. `readOnly` exposes no mutation controls.

Removal assertion:

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

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement `AnalysisCard` as presentation only**

It may render:

- card label;
- card summary;
- optional parent-supplied badge strings;
- unavailable/read-only text.

It must not know accepted answers or invoke Tauri.

- [ ] **Step 4: Implement classify interaction over the public draft**

Narrow before use:

```ts
if (board.draft.kind !== "classify") {
  return;
}
```

Assignment:

```ts
onDraft(
  {
    kind: "classify",
    groupByCard: {
      ...board.draft.groupByCard,
      [cardId]: groupId,
    },
  },
  `card:${cardId}`,
);
```

Removal copies the map and deletes only `cardId`.

Use native buttons and no local correctness coloring.

- [ ] **Step 5: Add and test focus/reduced-motion CSS**

Use visible `:focus-visible` styling and a `prefers-reduced-motion: reduce` block.

Following the existing AcquisitionPopup convention, add a source assertion rather than assuming CSS is covered by interaction tests:

```ts
const cardSource = readFileSync(
  fileURLToPath(new URL("./AnalysisCard.svelte", import.meta.url)),
  "utf8",
);
expect(cardSource).toContain(":focus-visible");
expect(cardSource).toContain("@media (prefers-reduced-motion: reduce)");
```

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

### Task 3: Enforce Prefix Anchors at Compile Time and Build Availability-Safe Order UI

**Files:**
- Modify: `packages/scripts/compile-scenes/validator-analysis.ts`
- Create: `packages/scripts/__fixtures__/invalid/analysis-order-anchor-not-prefix/expected-error.txt`
- Create by copying/editing: `packages/scripts/__fixtures__/invalid/analysis-order-anchor-not-prefix/**`
- Create: `apps/game/src/lib/analysis/order-draft.ts`
- Create: `apps/game/src/lib/analysis/order-draft.test.ts`
- Create: `apps/game/src/lib/components/analysis/OrderBoard.svelte`
- Create: `apps/game/src/lib/components/analysis/OrderBoard.test.ts`

**Interfaces:**
- Compiler produces only order views compatible with the first-version prefix-anchor UI.
- `order-draft.ts` remains defensive against stale/invalid public views and unavailable fixed cards.
- Produces structural order drafts only; never compares against hidden accepted order.

- [ ] **Step 1: Add a failing compiler invalid fixture**

Copy the valid compiler fixture:

```bash
cp -R packages/scripts/__fixtures__/analysis-chapter-1 \
  packages/scripts/__fixtures__/invalid/analysis-order-anchor-not-prefix
```

In the copied `chapter_1/analysis_scene_8_5.md`, change exactly:

```text
- **Fixed Anchors:** [event_1841@1]
```

to:

```text
- **Fixed Anchors:** [event_1843@3]
```

This remains consistent with the copied accepted order, so existing anchor validations pass while the unsupported prefix shape is isolated.

Create `expected-error.txt` containing:

```text
analysisOrderAnchorNotPrefix
```

- [ ] **Step 2: Run the compiler tests and confirm the new fixture does not yet fail with the expected diagnostic**

```bash
bun run test:scripts
```

Expected before implementation: the new invalid fixture is not rejected with `analysisOrderAnchorNotPrefix`.

- [ ] **Step 3: Add `analysisOrderAnchorNotPrefix` after existing anchor structural checks**

Do not emit the prefix diagnostic on top of malformed/duplicate/unknown-anchor diagnostics. Only enforce prefix shape when all anchors are otherwise structurally valid and unique.

Implementation shape:

```ts
const anchorsAreStructurallyValid =
  board.fixedAnchors.every(
    (anchor) =>
      Number.isSafeInteger(anchor.position) &&
      anchor.position >= 1 &&
      anchor.position <= board.cards.length &&
      cards.displayedById.has(anchor.cardId),
  ) &&
  anchorCardIds.size === board.fixedAnchors.length &&
  anchorPositions.size === board.fixedAnchors.length;

if (anchorsAreStructurallyValid) {
  const sorted = [...board.fixedAnchors].sort(
    (left, right) => left.position - right.position,
  );
  const firstGap = sorted.find(
    (anchor, index) => anchor.position !== index + 1,
  );
  if (firstGap) {
    pushError(
      errors,
      firstGap,
      "analysisOrderAnchorNotPrefix",
      `Order board "${board.id}" fixed anchors must occupy a contiguous prefix starting at position 1.`,
    );
  }
}
```

`Fixed Anchors: []` remains valid.

- [ ] **Step 4: Verify compiler rule and strict script type-check**

```bash
bun run test:scripts
bun run check:scripts
```

Expected: invalid fixture fails with the new diagnostic and all valid fixtures still pass.

- [ ] **Step 5: Write failing pure order-algebra tests**

Pin the public compiler fixture:

```ts
expect(board.fixedAnchors).toEqual([
  { cardId: "event_1841", position: 1 },
]);
```

Test these states:

```text
valid prefix + available anchor + add event_1842
  -> [event_1841, event_1842]

valid prefix + move event_1843 up
  -> event_1841 stays fixed at index 0

valid prefix + remove event_1842
  -> anchor remains

non-prefix public view
  -> configuration error result, never throw

prefix anchor card available=false
  -> fixed-anchor-unavailable result; materialization returns null

movable card available=false
  -> add returns unchanged/null and never emits that card
```

Use a non-throwing defensive API:

```ts
export type OrderBoardBlockReason =
  | "unsupportedAnchors"
  | "fixedAnchorUnavailable"
  | null;

export function orderBoardBlockReason(board: OrderBoardView): OrderBoardBlockReason;
export function materializePrefixAnchors(
  board: OrderBoardView,
  cardIds: string[],
): string[] | null;
export function addOrderCard(
  board: OrderBoardView,
  cardIds: string[],
  cardId: string,
): string[] | null;
export function moveOrderCard(
  board: OrderBoardView,
  cardIds: string[],
  cardId: string,
  direction: -1 | 1,
): string[] | null;
export function removeOrderCard(
  board: OrderBoardView,
  cardIds: string[],
  cardId: string,
): string[] | null;
```

- [ ] **Step 6: Implement the defensive pure helper**

Prefix validation sorts fixed anchors and requires positions `1..N`.

`fixedAnchorUnavailable` is returned when any fixed-anchor `cardId` resolves to a public card with `available === false` (or is missing from the public card list).

`materializePrefixAnchors` returns `null` for either block reason. Otherwise it prepends the fixed prefix once and removes duplicate copies from the movable remainder.

`addOrderCard` returns `null` for unavailable/missing cards.

Movement only affects indices after the fixed prefix.

- [ ] **Step 7: Build `OrderBoard.svelte` as a thin presentation layer**

Render:

- ordered list for the current public draft;
- fixed prefix as `固定位置`, with no move/remove controls;
- unplaced card pool;
- `加入時間線`, `上移`, `下移`, `移除` buttons for available movable cards.

Blocked states:

```text
unsupportedAnchors
  -> 排序設定無法顯示，請重新載入內容。

fixedAnchorUnavailable
  -> 尚未取得固定卡，暫時無法編排時間線。
```

In either blocked state, expose no add/move/remove controls. Keep the authoritative draft visible. Host-level Reset may still send the Rust-valid empty order draft.

- [ ] **Step 8: Add component interaction tests**

Pin:

- fixed anchor locked;
- pointer/keyboard add parity;
- up/down/remove emit helper-produced structural drafts;
- unavailable movable cards disabled;
- unavailable fixed anchor shows the explicit blocked state and no mutation controls;
- stale non-prefix public view renders the configuration-error state rather than throwing.

- [ ] **Step 9: Verify**

```bash
bun run test:scripts
bun run check:scripts
bun run --cwd apps/game test src/lib/analysis/order-draft.test.ts src/lib/components/analysis/OrderBoard.test.ts
bun run --cwd apps/game check
```

- [ ] **Step 10: Commit**

```bash
git add packages/scripts/compile-scenes/validator-analysis.ts packages/scripts/__fixtures__/invalid/analysis-order-anchor-not-prefix apps/game/src/lib/analysis/order-draft.ts apps/game/src/lib/analysis/order-draft.test.ts apps/game/src/lib/components/analysis/OrderBoard.svelte apps/game/src/lib/components/analysis/OrderBoard.test.ts
git commit -m "feat(analysis): enforce and render prefix order anchors"
```

---

### Task 4: Share Case File Provenance Presentation and Generalize Threshold UI

**Files:**
- Create: `apps/game/src/lib/case-file/provenance-badges.ts`
- Create: `apps/game/src/lib/case-file/provenance-badges.test.ts`
- Modify: `apps/game/src/lib/components/case-file/CaseFileRecordDetail.svelte`
- Modify: `apps/game/src/lib/components/case-file/CaseFileRecordDetail.test.ts`
- Create: `apps/game/src/lib/components/analysis/ThresholdBoard.svelte`
- Create: `apps/game/src/lib/components/analysis/ThresholdBoard.test.ts`

**Interfaces:**
- Shared helper converts an `EvidenceRecord | StatementRecord` into user-facing provenance strings using existing `case-file/labels.ts` maps.
- Case File consumes it without changing visible behavior.
- Threshold consumes the same vocabulary for real evidence/statement cards; `practice` cards bypass inventory provenance.

- [ ] **Step 1: Write failing pure provenance-label tests**

Define:

```ts
export type CaseRecordProvenancePresentation = {
  sourceKind: string | null;
  representationLayer: string | null;
  proceduralStatus: string | null;
  completeness: string | null;
  confidence: string | null;
  source: string | null;
  sourceGroup: string | null;
  sourceGroupSummary: string | null;
  proofCapabilities: string | null;
};

export function caseRecordProvenancePresentation(
  record: EvidenceRecord | StatementRecord,
): CaseRecordProvenancePresentation;
```

Pin the current Case File semantics:

```ts
expect(presentation.source).toBe("鑑識原始匯出");
expect(presentation.sourceGroup).toBe("店內收銀紀錄");
expect(presentation.proceduralStatus).toBe("正式證物");
expect(presentation.proofCapabilities).toBe("時間、順序");
```

When `provenance.sourceLabel === null` and a source group exists:

```ts
expect(presentation.source).toBe("現場目擊者");
expect(presentation.sourceGroup).toBeNull();
```

That matches current Case File output and avoids duplicated source/group lines.

- [ ] **Step 2: Run and confirm failure**

```bash
bun run --cwd apps/game test src/lib/case-file/provenance-badges.test.ts
```

- [ ] **Step 3: Implement the pure helper using existing label maps**

Implementation shape:

```ts
const provenance = record.provenance;
return {
  sourceKind: sourceKindLabels[provenance.sourceKind],
  representationLayer:
    representationLayerLabels[provenance.representationLayer],
  proceduralStatus:
    proceduralStatusLabels[provenance.proceduralStatus],
  completeness: completenessLabels[provenance.completeness],
  confidence: confidenceLabels[provenance.confidence],
  source:
    provenance.sourceLabel ?? record.sourceGroup?.label ?? null,
  sourceGroup:
    record.sourceGroup !== null && provenance.sourceLabel !== null
      ? record.sourceGroup.label
      : null,
  sourceGroupSummary: record.sourceGroup?.summary ?? null,
  proofCapabilities:
    provenance.proofCapabilities.length > 0
      ? provenance.proofCapabilities
          .map((capability) => proofCapabilityLabels[capability])
          .join("、")
      : null,
};
```

Do not add Analysis-specific labels.

- [ ] **Step 4: Refactor Case File detail to consume the helper unchanged**

Replace its local provenance-label derivation with:

```ts
const provenancePresentation = $derived(
  caseRecordProvenancePresentation(item.record),
);
```

Render the same current lines:

```text
來源類型
呈現層
程序狀態
完整度
可信度
來源
來源群組
source-group summary
可證明
```

Do not change copy or visibility rules.

- [ ] **Step 5: Verify Case File behavior remains unchanged**

```bash
bun run --cwd apps/game test src/lib/case-file/provenance-badges.test.ts src/lib/components/case-file/CaseFileRecordDetail.test.ts
bun run --cwd apps/game check
```

The existing test expecting:

```text
可證明：時間、順序、動線、身分、出入、動機、來源、可信度、程序、因果
```

must remain green.

- [ ] **Step 6: Write failing threshold tests before migrating the component**

Pin all of these:

1. P1 four `practice:` cards still render with no inventory lookup requirement;
2. pointer and keyboard toggle the same draft;
3. selected IDs are emitted sorted;
4. `card.available === false` disables toggle;
5. read-only/completed board has no mutation control;
6. two same-source-group real records can still both be selected locally;
7. real evidence/statement cards resolve inventory records and show shared provenance vocabulary;
8. at minimum, a Beat 8.5 record shows `來源類型`, `程序狀態`, `來源`/`來源群組` as applicable, and `可證明`;
9. the threshold logic never compares source-group IDs or proof capabilities for correctness.

Important: use inventory `record.provenance.sourceLabel` for provenance. `AnalysisCardView.sourceLabel` is only the card's projected source display label (record name/speaker), not the provenance source string.

- [ ] **Step 7: Implement `ThresholdBoard.svelte` using `board.draft` as authoritative selection**

Narrow:

```ts
if (board.draft.kind !== "threshold") return;
```

Toggle:

```ts
const selected = new Set(board.draft.selectedCardIds);
if (selected.has(cardId)) selected.delete(cardId);
else selected.add(cardId);

onDraft(
  {
    kind: "threshold",
    selectedCardIds: [...selected].sort(),
  },
  `card:${cardId}`,
);
```

For `practice` card sources, pass no provenance badges.

For evidence/statement sources, resolve the corresponding inventory record and call `caseRecordProvenancePresentation(record)`. Render the reasoning-relevant shared lines:

```text
來源類型：...
程序狀態：...
來源：...
來源群組：...   # when helper returns one
可證明：...
```

Do not evaluate whether the selection is eligible/correct.

- [ ] **Step 8: Verify threshold + Case File together**

```bash
bun run --cwd apps/game test src/lib/case-file/provenance-badges.test.ts src/lib/components/case-file/CaseFileRecordDetail.test.ts src/lib/components/analysis/ThresholdBoard.test.ts
bun run --cwd apps/game check
```

- [ ] **Step 9: Commit**

```bash
git add apps/game/src/lib/case-file/provenance-badges.ts apps/game/src/lib/case-file/provenance-badges.test.ts apps/game/src/lib/components/case-file/CaseFileRecordDetail.svelte apps/game/src/lib/components/case-file/CaseFileRecordDetail.test.ts apps/game/src/lib/components/analysis/ThresholdBoard.svelte apps/game/src/lib/components/analysis/ThresholdBoard.test.ts
git commit -m "feat(game-ui): share provenance and add threshold board"
```

---

### Task 5: Compose the Workbench, Reconcile Fallback Boards, Preserve P1 Packaged Journey, Then Retire `AnalysisView`

**Files:**
- Create: `apps/game/src/lib/components/analysis/AnalysisWorkbench.svelte`
- Create: `apps/game/src/lib/components/analysis/AnalysisWorkbench.test.ts`
- Modify: `apps/game/src/lib/state/game-client.svelte.ts`
- Modify: `apps/game/src/lib/state/game-client-source.test.ts`
- Modify: `apps/game/src/routes/+page.svelte`
- Modify: `apps/game/src/lib/state/mode.test.ts`
- Reuse unchanged: `apps/game/e2e-tauri/production-anchors.ts`
- Reuse unchanged: `apps/game/e2e-tauri/helpers.ts`
- Delete only after packaged journey passes: `apps/game/src/lib/components/AnalysisView.svelte`, `AnalysisView.test.ts`

**Interfaces:**
- Workbench consumes Analysis scene/mode/inventory plus existing select/update/submit wrappers.
- Existing Analysis wrappers now return `Promise<GameStateView | null>` rather than discarding the applied result.
- Workbench reconciles display board to active board before every update/reset/undo/submit mutation.

- [ ] **Step 1: Write wrapper return-value tests**

In `game-client-source.test.ts`, keep the existing payload assertions and add one Analysis command case proving a successful mocked response is returned after application.

Expected public wrapper contract:

```ts
selectAnalysisBoard(
  actionToken: AnalysisActionToken,
  boardId: string,
): Promise<GameStateView | null>

updateAnalysisDraft(
  actionToken: AnalysisActionToken,
  draft: AnalysisDraft,
): Promise<GameStateView | null>

submitAnalysisBoard(
  actionToken: AnalysisActionToken,
): Promise<GameStateView | null>
```

- [ ] **Step 2: Make the existing Analysis dispatcher/wrappers return the existing dispatch result**

Change the existing helper only:

```ts
async function dispatchAnalysisCommand(
  command: Extract<
    GameplayCommandName,
    | "select_analysis_board"
    | "update_analysis_draft"
    | "submit_analysis_board"
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

Return it directly from all three exported wrappers. Do not modify the generic dispatcher, command names, in-flight behavior, or Rust commands.

- [ ] **Step 3: Write host tests, including fallback-board reconciliation**

Pin:

1. render board by `mode.boardId`;
2. root has `aria-label="分析板"`;
3. editable submit button accessible name is exactly `比對推論`;
4. Back/board navigation uses `selectAnalysisBoard`;
5. incomplete editable draft still exposes Submit;
6. Reset sends the board-kind empty draft;
7. successful edit records one-step Undo; Undo sends the previous draft;
8. switching `mode.boardId` clears Undo/hint and focuses the new heading;
9. failed submit feedback receives focus;
10. completed board shows `完成・只讀檢視` and no mutation controls;
11. Case File is unaffected by the host;
12. fallback display-board mismatch reconciles before mutation.

Critical fallback test shape:

```ts
it("selects a fallback display board before updating it", async () => {
  const initial = analysisState({
    boardId: "evidence_packages",
    activeBoardId: null,
    durableRevision: 41,
  });
  const selected = analysisState({
    boardId: "evidence_packages",
    activeBoardId: "evidence_packages",
    durableRevision: 42,
  });
  const onSelectBoard = vi.fn().mockResolvedValue(selected);
  const onUpdateDraft = vi.fn().mockResolvedValue(
    analysisState({
      boardId: "evidence_packages",
      activeBoardId: "evidence_packages",
      durableRevision: 43,
    }),
  );

  renderWorkbench({
    state: initial,
    onSelectBoard,
    onUpdateDraft,
  });

  await assignFirstClassifyCard();

  expect(onSelectBoard).toHaveBeenCalledWith(
    initial.mode.type === "analysis" ? initial.mode.actionToken : null,
    "evidence_packages",
  );
  expect(onUpdateDraft).toHaveBeenCalledWith(
    selected.mode.type === "analysis" ? selected.mode.actionToken : null,
    expect.objectContaining({ kind: "classify" }),
  );
});
```

Use ordinary narrowing helpers in the actual test rather than passing nullable tokens; the important assertion is **fresh returned token after selection**.

Add a second test where `onSelectBoard` returns `null`; assert `onUpdateDraft` / `onSubmit` is not called.

Add the same reconciliation assertion for Submit so update-only coverage cannot hide a submit bug.

- [ ] **Step 4: Implement the mutation-token reconciliation in the host**

Use a small local helper:

```ts
async function tokenForDisplayedBoard(): Promise<AnalysisActionToken | null> {
  if (mode.activeBoardId === mode.boardId) {
    return mode.actionToken;
  }

  const selected = await onSelectBoard(mode.actionToken, mode.boardId);
  if (
    selected?.mode.type !== "analysis" ||
    selected.mode.boardId !== mode.boardId ||
    selected.mode.activeBoardId !== mode.boardId
  ) {
    return null;
  }

  return selected.mode.actionToken;
}
```

Every edit/Reset/Undo/Submit path calls this helper first. Explicit board navigation continues to call `onSelectBoard` directly.

Do not automatically select on render; reconciliation happens only when the player requests a mutation.

- [ ] **Step 5: Implement one-step Undo, Reset, feedback focus, and board focus**

Keep only presentation state:

```ts
let undoDraft = $state<AnalysisDraft | null>(null);
let undoBoardId = $state<string | null>(null);
let hintOpen = $state(false);
```

Record Undo only after `onUpdateDraft` returns non-null.

Follow the existing `CaseFilePanel.svelte` focus pattern:

1. `await tick()`;
2. query a stable `data-analysis-focus-key`;
3. focus that target when present;
4. otherwise focus the board heading.

Do not extract a generic focus helper; this is only the second consumer.

Feedback region:

```svelte
<p role="status" tabindex="-1" bind:this={feedbackElement}>
  {board.feedback.message}
</p>
```

- [ ] **Step 6: Route the new workbench while keeping the old files present**

Replace the existing Analysis branch's component only:

```svelte
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

Keep the route condition and `SceneBackdrop` behavior already on main.

At this point `AnalysisView.svelte` / `.test.ts` remain in the tree but are no longer imported by production routing.

- [ ] **Step 7: Pin Analysis Case File behavior without changing `mode.ts`**

Add:

```ts
expect(shouldShowCaseFile(analysisMode)).toBe(true);
expect(canReexamineCaseRecords(analysisMode)).toBe(false);
```

- [ ] **Step 8: Run focused unit/type tests before packaged acceptance**

```bash
bun run --cwd apps/game test \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/components/analysis/ClassifyBoard.test.ts \
  src/lib/components/analysis/OrderBoard.test.ts \
  src/lib/components/analysis/ThresholdBoard.test.ts \
  src/lib/state/game-client-source.test.ts \
  src/lib/state/mode.test.ts
bun run --cwd apps/game check
bun run --cwd apps/game check:e2e
```

- [ ] **Step 9: Run the real packaged P1 production journey against the new routed workbench**

`check:e2e` is not sufficient. Build the E2E app and execute the production journey:

```bash
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite production-journey
cd ../..
```

Expected: the journey reaches `[aria-label="分析板"]`, selects the existing P1 cards, activates `比對推論`, completes the tutorial, and continues to the existing KAGAMI production anchor.

If this fails due to a deliberate accessibility-copy change, update `production-anchors.ts` / helper in the same task and rerun. Otherwise preserve them unchanged.

- [ ] **Step 10: Only now delete the retired threshold-only component and migrate/remove its test file**

```bash
git rm apps/game/src/lib/components/AnalysisView.svelte
```

Delete `AnalysisView.test.ts` after confirming every useful P1 assertion is represented by `ThresholdBoard.test.ts` / `AnalysisWorkbench.test.ts`.

Verify no production imports remain:

```bash
git grep -n 'AnalysisView' -- apps/game/src || true
```

Expected: no matches.

- [ ] **Step 11: Re-run focused tests after deletion**

```bash
bun run --cwd apps/game test \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/components/analysis/ThresholdBoard.test.ts
bun run --cwd apps/game check
```

- [ ] **Step 12: Commit**

```bash
git add apps/game/src/lib/components/analysis apps/game/src/lib/state/game-client.svelte.ts apps/game/src/lib/state/game-client-source.test.ts apps/game/src/routes/+page.svelte apps/game/src/lib/state/mode.test.ts
git add -u apps/game/src/lib/components/AnalysisView.svelte apps/game/src/lib/components/AnalysisView.test.ts
git commit -m "feat(game-ui): integrate analysis workbench"
```

---

### Task 6: Fail-Closed Ownership Scan and Final Frontend/Compiler Acceptance

**Files:**
- Modify: `apps/game/src/lib/analysis/analysis-boundary.test.ts`
- Modify tests/docs only if verification exposes a gap; do not widen feature scope.

**Interfaces:**
- Consumes: Tasks 1–5 complete.
- Produces: HPA-261 acceptance evidence and explicit HPA-262/HPA-265 handoff.

- [ ] **Step 1: Extend the ownership guard now that every frontend Analysis file exists**

Use fail-closed paths relative to the test module. Missing files must throw/fail the test; never silently return `[]`.

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FEATURE_FILES = [
  "./test-fixtures.ts",
  "./order-draft.ts",
  "../components/analysis/AnalysisCard.svelte",
  "../components/analysis/ClassifyBoard.svelte",
  "../components/analysis/OrderBoard.svelte",
  "../components/analysis/ThresholdBoard.svelte",
  "../components/analysis/AnalysisWorkbench.svelte",
] as const;

it("keeps accepted answers out of all frontend Analysis source", () => {
  const sources = FEATURE_FILES.map((relativePath) =>
    readFileSync(
      fileURLToPath(new URL(relativePath, import.meta.url)),
      "utf8",
    ),
  );

  expect(sources).toHaveLength(FEATURE_FILES.length);
  expect(sources.join("\n")).not.toMatch(
    /acceptedGroupByCard|acceptedOrder|acceptedSelections/,
  );
});
```

The earlier fixture-serialization guard stays as a separate test.

- [ ] **Step 2: Run the complete HPA-261 focused test set**

```bash
bun run --cwd apps/game test \
  src/lib/analysis/analysis-boundary.test.ts \
  src/lib/analysis/order-draft.test.ts \
  src/lib/case-file/provenance-badges.test.ts \
  src/lib/components/case-file/CaseFileRecordDetail.test.ts \
  src/lib/components/analysis/ClassifyBoard.test.ts \
  src/lib/components/analysis/OrderBoard.test.ts \
  src/lib/components/analysis/ThresholdBoard.test.ts \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/state/game-client-source.test.ts \
  src/lib/state/mode.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run compiler/script gates because HPA-261 now adds one validator rule**

```bash
bun run test:scripts
bun run check:scripts
bun run scenes:compile
```

Expected: current production Chapter 1 still compiles; the invalid sparse-anchor fixture is rejected in compiler tests.

- [ ] **Step 4: Run frontend/repository gates**

```bash
bun run --cwd apps/game test
bun run --cwd apps/game check
bun run --cwd apps/game check:e2e
bun run lint:all
```

Expected: all exit 0.

- [ ] **Step 5: Run ownership/retirement greps**

```bash
git grep -nE 'acceptedGroupByCard|acceptedOrder|acceptedSelections' -- apps/game/src/lib/analysis apps/game/src/lib/components/analysis || true
git grep -n 'AnalysisView' -- apps/game/src || true
```

Expected: no matches.

Review threshold mutable state:

```bash
git grep -n 'selectedCardIds' -- apps/game/src/lib/analysis apps/game/src/lib/components/analysis apps/game/src/lib/state/types.ts
```

Allowed matches are the existing threshold wire/draft and UI consumers only; no accepted-solution data.

- [ ] **Step 6: Keyboard-only component acceptance**

Testing Library/native controls must prove a player can:

- classify every available card;
- move/remove classifications;
- add/reorder/remove available movable order cards without crossing the fixed prefix;
- understand and recover from the fixed-anchor-unavailable blocked state;
- toggle threshold cards;
- inspect source/procedure/proof labels for real records;
- use Undo/Reset/`比對推論`;
- receive textual feedback/focus return;
- navigate to a completed board and see read-only state.

No drag path is required.

- [ ] **Step 7: Record handoff ownership in the implementation PR**

HPA-262 remains the cross-layer integration/acceptance owner. It must prove:

1. final frontend fields match live Rust serialization;
2. fallback-board reconciliation works against the live runtime, not just fixtures;
3. one incomplete draft for each real board survives save → title → Continue;
4. solved boards reopen read-only;
5. correct submit commits result dialogue/story outputs exactly once;
6. packaged keyboard path completes the integrated real three-board scene.

HPA-265 remains the production story/content owner. It must:

1. create `docs/stories_plan/chapter_1/analysis_scene_8_5.md`;
2. replace the current linear Beat 8.5 transition without duplicate playable content;
3. preserve Chapter 1 canon/proof order;
4. author the final records/prompts/groups/order/threshold content that HPA-262 integrates.

Do not pull either responsibility into HPA-261.

- [ ] **Step 8: Commit any acceptance-only test correction**

If verification required a test-only correction:

```bash
git add apps/game/src/lib packages/scripts

git commit -m "test(game-ui): accept analysis workbench"
```

If no files changed, do not create an empty commit.

---

## Self-Review Checklist

Before implementation starts, verify this plan still satisfies the design:

- [ ] Implementation starts from current `main`.
- [ ] Existing HPA-260 public types/commands/save runtime are reused.
- [ ] Existing P1 practice tutorial remains a regression baseline.
- [ ] `aria-label="分析板"` and `比對推論` remain unless production anchors are deliberately changed with them.
- [ ] The real packaged `production-journey` runs before old `AnalysisView` deletion.
- [ ] `mode.boardId` remains the display board.
- [ ] `mode.activeBoardId` / action-token active board remains the mutation fence.
- [ ] Every update/Reset/Undo/Submit reconciles display→active when they differ and uses the returned fresh token.
- [ ] No frontend accepted-answer data.
- [ ] No frontend threshold evaluator.
- [ ] No optimistic/persistent Analysis store.
- [ ] No second frontend generation/response-fence framework.
- [ ] Compiler rejects non-prefix fixed anchors with `analysisOrderAnchorNotPrefix`.
- [ ] Order UI never throws for a stale non-prefix public view.
- [ ] Order helper never materializes an unavailable fixed anchor.
- [ ] Unavailable movable cards cannot be added.
- [ ] Provenance presentation is shared with Case File and includes proof capabilities.
- [ ] `AnalysisCardView.sourceLabel` is not confused with `record.provenance.sourceLabel`.
- [ ] Frontend inventory fixtures reuse `state/test-fixtures.ts` neutral builders.
- [ ] Full answer-key source scan is fail-closed and runs only after all files exist.
- [ ] Focus-return follows the existing CaseFilePanel `tick()` + stable selector + heading fallback pattern.
- [ ] Focus/reduced-motion CSS has an explicit source assertion.
- [ ] Case File visibility/reexamine behavior is pinned for Analysis.
- [ ] Beat 8.5 frontend fixtures are labelled compiler fixtures, not shipped content.
- [ ] HPA-262 and HPA-265 ownership is explicit and unchanged.

## Execution Handoff

Plan complete in this document. Implementation should use **subagent-driven development** task-by-task where available; otherwise execute inline with the same test-first gates.
