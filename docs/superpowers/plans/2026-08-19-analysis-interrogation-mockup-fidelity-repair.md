# Analysis and Interrogation Mockup Fidelity Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair every remaining Analysis and Interrogation mockup mismatch while preserving the existing game, save, Present, Case File, and dialogue-history authority boundaries.

**Architecture:** Keep all game authority in the existing Rust/public-view contracts and make only narrow Svelte presentation changes. Add one pure Present-record mapper, one reusable non-modal history-overlay host, and stable component/E2E hooks; restructure the existing views around those seams rather than adding client state machines or replacing the Case File. Extend the existing packaged Analysis journey with semantic checks and reviewable screenshot artifacts instead of a screenshot-diff framework.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest + Testing Library, WDIO/Tauri packaged E2E, Bun/Turborepo.

**Spec:** docs/superpowers/specs/2026-08-19-analysis-interrogation-mockup-fidelity-repair-design.md

## Global Constraints

- Preserve Rust as the authority for Analysis evaluation, interrogation state, evidence presentation, saves, story progression, Case File data, and dialogue history.
- Do not modify Rust, compiler, scene-schema, save-schema, authored content, generated resources, or Case File model files.
- Keep the supplied ui_mock directory untracked and do not commit mock rasters, a screenshot baseline, or screenshot-diff tooling.
- Preserve the current Present lifecycle, focus trap, top-layer suspension, Game Menu action, direct onPresent callback, onResume behavior, and immediate record selection. Do not add browse, preview, confirmation, client-owned inventory, or Present-result state.
- Keep Case File as the sole Case File UI. The new stage buttons request its existing objective or evidence section; they do not create a second drawer or persist a section.
- Do not create client-owned composure, health, verdict, contradiction, or progress mechanics. The mock-shaped subject meter derives only from brokenQuestionProgress(phase).
- Keep normal dialogue-history contents, DialogueBox local history state, its L shortcut, non-modal panel, non-blocking backdrop, advance inertness, and focus behavior.
- The stage toolbar exists only in the interrogation menu while Present is inactive. It has no global L shortcut and is absent during testimony/dialogue and Present.
- Every new visible control is a native button with a meaningful accessible name. Escape always closes only the topmost layer.
- At the desktop mock targets, the tray is at most 900px wide and has five choice columns; at narrow widths controls may wrap and tiles may reduce columns without becoming inaccessible.
- Preserve Analysis board selection, reconciliation, draft mutation, read-only behavior, pointer/keyboard interaction, undo/reset/submit behavior, relative navigation, feedback, and footer reachability.
- The Analysis board ordinal uses authored analysis.visibleBoards order, not rail sorting. Reuse data-analysis-focus-key="hint"; add no duplicate hint hook.
- Preserve existing at-least ensureCaseFileViewport() setup and relative layout assertions. Exact capture viewport equality is opt-in only through LYRA_E2E_REQUIRE_EXACT_CAPTURE_VIEWPORT=1.
- Run the Svelte autofixer for every changed or new Svelte component.

---

## File Structure and Delivery Boundaries

| File(s) | Responsibility | Delivery task |
| --- | --- | --- |
| apps/game/src/lib/interrogation/presentation.ts and presentation.test.ts | Convert authoritative inventory records into the closed Present display model without changing the engine payload. | 1 |
| apps/game/src/lib/components/InterrogationEvidenceTray.svelte and test | Render the five-column tile tray, transient detail panel, visible Escape button, and preserve Present/top-layer behavior. | 2 |
| apps/game/src/lib/components/analysis/AnalysisWorkbench.svelte and test | Apply ordinal/header/footer/rail fidelity while retaining all board behavior. | 3 |
| apps/game/scripts/select-e2e-suites.mjs and test | Route Analysis component changes to the established gameplay E2E chain. | 3 |
| apps/game/src/lib/components/DialogueHistoryOverlay.svelte and test | Own only the shared visual history host, backdrop, and Escape claim. | 4 |
| apps/game/src/lib/components/InterrogationStage.svelte, test, and test harness | Own menu-local LOG state, menu-only toolbar, Case File section dispatch, and derived subject meter. | 4 |
| apps/game/src/routes/+page.svelte, page.test.ts, and InterrogationChrome.test.ts | Pass dialogue history, request a selected Case File section, and remove superseded raw-source checks. | 4 |
| apps/game/src/lib/components/DialogueBox.svelte and test | Swap its private history visual layer for the shared host while keeping its local controller and shortcut behavior. | 5 |
| apps/game/e2e-tauri/helpers.ts and analysis-beat85.e2e.ts | Add portable semantic assertions and five non-empty, sidecar-described packaged captures. | 6 |

The six tasks are intentionally separately reviewable. Tasks 1 and 2 close the Present mismatch without route changes. Task 3 closes the Analysis mismatch and its risk-selection gap. Task 4 adds the reusable host and stage/menu composition. Task 5 migrates the existing dialogue owner after that host has focused coverage. Task 6 proves the finished rendered contract through the existing packaged journey.

### Task 1: Add the pure Present-record display mapper

**Files:**

- Modify: apps/game/src/lib/interrogation/presentation.ts
- Test: apps/game/src/lib/interrogation/presentation.test.ts

**Interfaces:**

- Consumes: Inventory, EvidenceRecord, StatementRecord, and caseRecordProvenancePresentation(record).
- Produces:

~~~typescript
export type PresentableRecord = {
  kind: "evidence" | "statement";
  id: string;
  shortName: string;
  typeLabel: "物證 / EVIDENCE" | "證言 / STATEMENT";
  sourceTag: string;
  description: string;
  details: string | null;
  imageAssetId: string | null;
};

export function presentableRecords(inventory: Inventory): PresentableRecord[];
~~~

- Later consumers use only PresentableRecord.kind and PresentableRecord.id as the existing engine-facing payload. The mapper must not construct CaseFileRecordItem, normalize predecessors, or expose reexamine/navigation behavior.

- [ ] **Step 1: Add failing mapper contracts to presentation.test.ts.**

Use the existing neutralEvidenceRecordView, neutralStatementRecordView, and neutralCaseRecordProvenance fixtures so the test constructs real Inventory records. Cover evidence with a provenance source, evidence whose provenance source is blank and therefore falls back to acquisitionContext.sceneTitle, evidence whose empty details becomes null, and a statement whose imageAssetId/details are null.

~~~typescript
it("maps Present records once while preserving their engine payload and display fallbacks", () => {
  const evidence = neutralEvidenceRecordView({
    id: "receipt",
    name: "咖啡收據",
    description: "十七點四十二分的消費紀錄。",
    details: "付款末四碼 0192。",
    imageAssetId: "evidence.coffee_receipt",
  });
  evidence.provenance = {
    ...neutralCaseRecordProvenance(),
    sourceLabel: "店內收銀匯出",
  };
  const statement = neutralStatementRecordView({
    id: "witness",
    speaker: "目擊者",
    content: "我看見她走進巷子。",
  });
  statement.provenance = {
    ...neutralCaseRecordProvenance(),
    sourceLabel: "   ",
  };
  statement.acquisitionContext.sceneTitle = "雨夜巷口";

  expect(
    presentableRecords({ evidence: [evidence], statements: [statement] }),
  ).toEqual([
    {
      kind: "evidence",
      id: "receipt",
      shortName: "咖啡收據",
      typeLabel: "物證 / EVIDENCE",
      sourceTag: "店內收銀匯出",
      description: "十七點四十二分的消費紀錄。",
      details: "付款末四碼 0192。",
      imageAssetId: "evidence.coffee_receipt",
    },
    {
      kind: "statement",
      id: "witness",
      shortName: "目擊者",
      typeLabel: "證言 / STATEMENT",
      sourceTag: "雨夜巷口",
      description: "我看見她走進巷子。",
      details: null,
      imageAssetId: null,
    },
  ]);
});
~~~

- [ ] **Step 2: Add the final fallback assertion before implementation.**

Make a record whose sourceLabel, sourceGroup, and acquisitionContext.sceneTitle are all empty strings and assert sourceTag is the record's typeLabel. This prevents a blank tag from reaching a five-column tile.

~~~typescript
expect(
  presentableRecords({
    evidence: [blankSourceEvidence],
    statements: [],
  })[0]?.sourceTag,
).toBe("物證 / EVIDENCE");
~~~

- [ ] **Step 3: Run the focused mapper test and confirm it fails because the export does not exist.**

Run:

~~~bash
rtk bun run --cwd apps/game test -- src/lib/interrogation/presentation.test.ts
~~~

Expected: TypeScript/Vitest fails because presentableRecords is not exported.

- [ ] **Step 4: Add the closed display type and source-tag helper in presentation.ts.**

Import Inventory, EvidenceRecord, and StatementRecord from the existing state type module plus caseRecordProvenancePresentation from the existing Case File provenance helper. Use a helper that trims each source in the required order.

~~~typescript
function presentSourceTag(
  record: EvidenceRecord | StatementRecord,
  typeLabel: PresentableRecord["typeLabel"],
): string {
  const provenanceSource =
    caseRecordProvenancePresentation(record).source?.trim() ?? "";
  const sceneTitle = record.acquisitionContext.sceneTitle.trim();
  return provenanceSource || sceneTitle || typeLabel;
}
~~~

- [ ] **Step 5: Implement presentableRecords with separate evidence and statement projections.**

The order is all evidence followed by all statements, matching the current tray order. Preserve kind/id exactly; do not derive new IDs.

~~~typescript
export function presentableRecords(inventory: Inventory): PresentableRecord[] {
  return [
    ...inventory.evidence.map((record) => ({
      kind: "evidence" as const,
      id: record.id,
      shortName: record.name,
      typeLabel: "物證 / EVIDENCE" as const,
      sourceTag: presentSourceTag(record, "物證 / EVIDENCE"),
      description: record.description,
      details: record.details.trim() || null,
      imageAssetId: record.imageAssetId,
    })),
    ...inventory.statements.map((record) => ({
      kind: "statement" as const,
      id: record.id,
      shortName: record.speaker,
      typeLabel: "證言 / STATEMENT" as const,
      sourceTag: presentSourceTag(record, "證言 / STATEMENT"),
      description: record.content,
      details: null,
      imageAssetId: null,
    })),
  ];
}
~~~

- [ ] **Step 6: Run focused presentation checks and verify the old helpers still pass.**

Run:

~~~bash
rtk bun run --cwd apps/game test -- src/lib/interrogation/presentation.test.ts
rtk bun run --cwd apps/game check
~~~

Expected: Mapper contracts, phase progress, same-scene presentation, and line-text contracts pass.

- [ ] **Step 7: Commit the independently usable presentation seam.**

~~~bash
rtk git add apps/game/src/lib/interrogation/presentation.ts apps/game/src/lib/interrogation/presentation.test.ts
rtk git commit -m "feat: map interrogation present records"
~~~

### Task 2: Reshape the Present tray around tiles and a transient detail panel

**Files:**

- Modify: apps/game/src/lib/components/InterrogationEvidenceTray.svelte
- Test: apps/game/src/lib/components/InterrogationEvidenceTray.test.ts

**Interfaces:**

- Consumes: presentableRecords(inventory) from Task 1 and the tray's existing onPresent(lineId, kind, itemId), onResume(), onOpenGameMenu(trigger), disabled, and topLayerOpen props.
- Produces stable DOM hooks:

~~~text
data-interrogation-evidence-grid
data-interrogation-evidence-detail
data-interrogation-tray-escape
~~~

- Keeps the existing data-interrogation-present-tray and data-interrogation-game-menu hooks. A tile calls present(record.kind, record.id) directly; selecting or focusing a tile never writes persistent state.

- [ ] **Step 1: Write failing tray tests for the visible mock contract.**

Extend the existing tray fixture with one evidence record and one statement. Assert desktop grid hook, separate initially empty/placeholder detail region, source tag/name-only tile content, hover detail content, focus detail content, and direct Present payload.

~~~typescript
const grid = document.querySelector(
  "[data-interrogation-evidence-grid]",
);
expect(grid).not.toBeNull();

const evidenceTile = screen.getByRole("button", {
  name: /咖啡收據.*店內收銀匯出/,
});
await user.hover(evidenceTile);
expect(
  document.querySelector("[data-interrogation-evidence-detail]"),
).toHaveTextContent(
  "十七點四十二分的消費紀錄。",
);
expect(
  document.querySelector("[data-interrogation-evidence-detail]"),
).toHaveTextContent(
  "付款末四碼 0192。",
);

await user.click(evidenceTile);
expect(onPresent).toHaveBeenCalledWith("line_1", "evidence", "receipt");
~~~

Use the stable data-* selectors directly in these tests; do not add data-testid attributes solely for test convenience.

- [ ] **Step 2: Add failing tests for Escape and retained layered behavior.**

Assert the header contains a visible native button named ESC with data-interrogation-tray-escape, clicking it calls onResume once, and clicking Game Menu calls only onOpenGameMenu. Retain and run the existing focus trap, disabled, and top-layer-suspension tests unchanged except for their updated tab order.

~~~typescript
await user.click(
  screen.getByRole("button", { name: "ESC" }),
);
expect(onResume).toHaveBeenCalledTimes(1);
expect(onOpenGameMenu).not.toHaveBeenCalled();
~~~

- [ ] **Step 3: Run the tray test before changing markup.**

Run:

~~~bash
rtk bun run --cwd apps/game test -- src/lib/components/InterrogationEvidenceTray.test.ts
~~~

Expected: The new grid/detail/ESC assertions fail against the current record-card layout.

- [ ] **Step 4: Replace the duplicated evidence/statement loops with one derived record list.**

Import PresentableRecord and presentableRecords. Keep evidence-image loading keyed only by evidence IDs, because statements remain seal-only. Track only the current display identity.

~~~svelte
let records = $derived(presentableRecords(inventory));
let activeRecordId = $state<string | null>(null);
let activeRecord = $derived(
  records.find((record) => record.id === activeRecordId) ?? null,
);

function showRecordDetail(record: PresentableRecord): void {
  activeRecordId = record.id;
}

function clearRecordDetail(record: PresentableRecord): void {
  if (activeRecordId === record.id) activeRecordId = null;
}
~~~

- [ ] **Step 5: Render the header Escape button, five-column grid, and separate detail panel.**

Put the target testimony above the choices exactly as it is now. The tile contains only the evidence image or statement seal, shortName, and sourceTag. Place description/details only in the detail panel. Keep click activation direct and wire pointer plus keyboard identity events to the same helpers.

~~~svelte
<button
  type="button"
  class="tray-escape"
  data-interrogation-tray-escape=""
  {disabled}
  onclick={resume}
>
  ESC
</button>

<section
  class="record-grid"
  data-interrogation-evidence-grid=""
  aria-label="可提出的紀錄"
>
  {#each records as record (record.kind + ":" + record.id)}
    <button
      class:statement-card={record.kind === "statement"}
      class="record-tile"
      type="button"
      {disabled}
      onmouseenter={() => showRecordDetail(record)}
      onmouseleave={() => clearRecordDetail(record)}
      onfocus={() => showRecordDetail(record)}
      onblur={() => clearRecordDetail(record)}
      onclick={() => present(record.kind, record.id)}
    >
      <!-- image/seal, shortName, and sourceTag only -->
    </button>
  {/each}
</section>

<section
  class="record-detail"
  data-interrogation-evidence-detail=""
  aria-live="polite"
  aria-label="紀錄詳情"
>
  {#if activeRecord}
    <p>{activeRecord.typeLabel} · {activeRecord.sourceTag}</p>
    <h3>{activeRecord.shortName}</h3>
    <p>{activeRecord.description}</p>
    {#if activeRecord.details}<p>{activeRecord.details}</p>{/if}
  {:else}
    <p>將游標移至紀錄，或以 Tab 選取以查看詳情。</p>
  {/if}
</section>
~~~

- [ ] **Step 6: Apply the desktop and compact CSS contract without altering layering behavior.**

Keep the outer tray max width at 900px. Use five fixed equal columns on the desktop target and a smaller explicit count below the existing compact breakpoint. Keep overflow/scroll behavior for additional rows.

~~~css
.record-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 720px) {
  .record-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
~~~

Do not modify the existing Escape claim, onDestroy focus restoration, capture-phase Tab listener, topLayerOpen guard, Game Menu callback, or disabled guards.

- [ ] **Step 7: Run the component checks and Svelte autofixer.**

Run:

~~~bash
rtk bun run --cwd apps/game test -- src/lib/components/InterrogationEvidenceTray.test.ts
rtk bun run --cwd apps/game check
~~~

Expected: Tile hover/focus detail, direct Present, visible Escape, Game Menu, focus trap, disabled, and layered-tray tests pass.

- [ ] **Step 8: Commit the Present visual repair.**

~~~bash
rtk git add apps/game/src/lib/components/InterrogationEvidenceTray.svelte apps/game/src/lib/components/InterrogationEvidenceTray.test.ts
rtk git commit -m "feat: align interrogation evidence tray"
~~~

### Task 3: Align the Analysis hierarchy and route Analysis changes to packaged E2E

**Files:**

- Modify: apps/game/src/lib/components/analysis/AnalysisWorkbench.svelte
- Test: apps/game/src/lib/components/analysis/AnalysisWorkbench.test.ts
- Modify: apps/game/scripts/select-e2e-suites.mjs
- Test: apps/game/scripts/select-e2e-suites.test.mjs

**Interfaces:**

- Consumes: the existing authored AnalysisSceneView.visibleBoards order, existing railBoards display sort, analysisBoardProgress(candidate), and data-analysis-focus-key="hint".
- Produces:

~~~text
data-analysis-board-position
Board N / Total visual chip
footer-resident hint button retaining data-analysis-focus-key="hint"
rail entries with label, compact X / Y value, and progress element
~~~

- The selector rule produces the existing suite chain: smoke, gameplay, production-journey, analysis-beat85.

- [ ] **Step 1: Add failing Analysis component assertions for authored ordinal and compact header structure.**

Use the existing multi-board fixture where rail ordering differs from authored visibleBoards ordering. Assert the active board's chip reads Board 2 / 3 for the authored second board even when it does not occupy the second visual rail slot. Assert the title computed style is 22px and the hint's existing focus key appears inside workbench-footer rather than board-header.

~~~typescript
expect(
  document.querySelector("[data-analysis-board-position]"),
).toHaveTextContent("Board 2 / 3");
expect(
  getComputedStyle(screen.getByRole("heading", { level: 2 })).fontSize,
).toBe("22px");
expect(
  document.querySelector(
    ".analysis-workbench .workbench-footer [data-analysis-focus-key='hint']",
  ),
).not.toBeNull();
~~~

Use the stable data-analysis-board-position hook directly; do not add a duplicate test ID.

- [ ] **Step 2: Add failing Analysis rail assertions without deleting behavioral tests.**

For an active rail entry, assert a visible label, a compact numeric status such as 1 / 3, and a progress element. Assert there is no visible board-entry-kind or board-entry-progress row. Keep the existing aria-describedby assertion, and require it still exposes the human-readable state and progress to screen readers.

~~~typescript
const entry = screen.getByRole("button", { name: "時間順序" });
expect(entry).toHaveTextContent("1 / 3");
expect(entry.querySelector("progress")).not.toBeNull();
expect(entry.querySelector(".board-entry-kind")).toBeNull();
expect(entry.querySelector(".board-entry-progress")).toBeNull();
expect(
  document.getElementById(entry.getAttribute("aria-describedby") ?? "")?.textContent,
).toMatch(/目前.*進度 1 \/ 3/);
~~~

- [ ] **Step 3: Run the Analysis component test before implementation.**

Run:

~~~bash
rtk bun run --cwd apps/game test -- src/lib/components/analysis/AnalysisWorkbench.test.ts
~~~

Expected: New ordinal/header/footer/rail assertions fail; existing mutation and focus reconciliation tests remain green.

- [ ] **Step 4: Derive ordinal from authored visibleBoards independently of railBoards.**

Add a derived ordinal and total beside the existing board/rail derivations. Do not sort, mutate, or use railBoards for the ordinal.

~~~svelte
let boardPosition = $derived(
  board && analysis
    ? analysis.visibleBoards.findIndex((candidate) => candidate.id === board.id) + 1
    : 0,
);
let boardCount = $derived(analysis?.visibleBoards.length ?? 0);
~~~

Render it before the existing eyebrow, retain boardKindLabel(board.kind) as the eyebrow content, and make the h2 22px at desktop.

~~~svelte
<p class="board-position" data-analysis-board-position="">
  Board {boardPosition} / {boardCount}
</p>
<p class="eyebrow">{boardKindLabel(board.kind)}</p>
<h2 tabindex="-1" data-analysis-focus-key={"board:" + board.id}>
  {board.label}
</h2>
~~~

~~~css
@media (min-width: 721px) {
  .board-heading-copy h2 {
    font-size: 22px;
  }
}
~~~

- [ ] **Step 5: Reduce each rail entry to the mock's visible status while retaining the accessible description.**

Keep boardStateLabel for the screen-reader description and styling data attribute. Replace visible kind and standalone progress row with a compact status string in board-entry-state plus the existing progress element.

~~~svelte
<span class="board-entry-heading">
  <span class="board-entry-label">
    <span class="board-entry-diamond" aria-hidden="true"></span>
    <span>{candidate.label}</span>
  </span>
  <span class="board-entry-state">
    {progress.current} / {progress.target}
  </span>
</span>
<progress
  max={100}
  value={progress.percent}
  aria-label={candidate.label + "進度"}
>
  {progress.current} / {progress.target}
</progress>
~~~

Retain the sr-only description with boardStateLabel and 進度 X / Y. Adjust CSS only for compact value and thin bar; leave selection, disable, aria-current, and onclick behavior unchanged.

- [ ] **Step 6: Move the hint action into the existing footer without changing its controller.**

Remove only the hint button from board-header-actions. Render the same button under footer-controls, keep data-analysis-focus-key="hint", disabled behavior, aria-expanded, and onclick={toggleHint}. Keep expanded hint copy accessible below the footer control so it does not alter the header's composition.

~~~svelte
{#if !boardReadOnly && board.hint !== null}
  <button
    type="button"
    class="hint-toggle"
    data-analysis-focus-key="hint"
    disabled={disabled}
    aria-expanded={hintOpen}
    onclick={toggleHint}
  >
    {hintOpen ? "隱藏提示" : "顯示提示"}
  </button>
{/if}
{#if hintOpen && board.hint !== null}
  <p class="board-hint">提示：{board.hint}</p>
{/if}
~~~

- [ ] **Step 7: Add the failing E2E-selection regression test.**

In select-e2e-suites.test.mjs, pass a changed path under apps/game/src/lib/components/analysis/ and assert that the result is the gameplay chain rather than the general-ui smoke-only path.

~~~javascript
assert.deepEqual(
  selectE2eSuites([
    "apps/game/src/lib/components/analysis/AnalysisWorkbench.svelte",
  ]),
  ["smoke", "gameplay", "production-journey", "analysis-beat85"],
);
~~~

- [ ] **Step 8: Add the narrow gameplay pattern and run the script contract.**

Add exactly apps/game/src/lib/components/analysis/** to the existing gameplay rule's patterns array; do not broaden the infrastructure rule or alter suite IDs.

~~~javascript
patterns: [
  "apps/game/src/lib/components/ExploreView.svelte",
  "apps/game/src/lib/components/Interrogation*.svelte",
  "apps/game/src/lib/components/analysis/**",
]
~~~

Run:

~~~bash
rtk bun run --cwd apps/game test -- src/lib/components/analysis/AnalysisWorkbench.test.ts
rtk bun run --cwd apps/game test:e2e:ci-contracts
rtk bun run --cwd apps/game check
~~~

Expected: Analysis behavior remains intact, the visual hierarchy tests pass, and an Analysis-only change selects analysis-beat85.

- [ ] **Step 9: Commit the Analysis and risk-routing slice.**

~~~bash
rtk git add apps/game/src/lib/components/analysis/AnalysisWorkbench.svelte apps/game/src/lib/components/analysis/AnalysisWorkbench.test.ts apps/game/scripts/select-e2e-suites.mjs apps/game/scripts/select-e2e-suites.test.mjs
rtk git commit -m "feat: align analysis workbench hierarchy"
~~~

### Task 4: Add the shared history host and menu-only Interrogation stage controls

**Files:**

- Create: apps/game/src/lib/components/DialogueHistoryOverlay.svelte
- Test: apps/game/src/lib/components/DialogueHistoryOverlay.test.ts
- Modify: apps/game/src/lib/components/InterrogationStage.svelte
- Test: apps/game/src/lib/components/InterrogationStage.test.ts
- Modify: apps/game/src/lib/test-harnesses/InterrogationStageHarness.svelte
- Modify: apps/game/src/routes/+page.svelte
- Test: apps/game/src/routes/page.test.ts
- Modify: apps/game/src/lib/components/InterrogationChrome.test.ts

**Interfaces:**

- DialogueHistoryOverlay accepts only presentation/lifecycle inputs:

~~~typescript
type DialogueHistoryOverlayProps = {
  history: DialogueHistoryEntry[];
  bottom: number;
  onClose: () => void;
};
~~~

- InterrogationStage receives history and dispatches Case File intent:

~~~typescript
history: DialogueHistoryEntry[];
onOpenCaseFile: (
  section: Extract<CaseFileSection, "objective" | "evidence">,
  trigger: HTMLElement,
) => void;
~~~

- The route owns no history-overlay state. It supplies gameState.value.dialogueHistory and changes its existing callback to:

~~~typescript
function openInterrogationCaseFile(
  section: Extract<CaseFileSection, "objective" | "evidence">,
  trigger: HTMLElement,
): void;
~~~

- Produces exactly these stable controls:

~~~text
data-interrogation-stage-log
data-interrogation-case-file-objective
data-interrogation-evidence-locker
data-interrogation-broken-progress
~~~

- [ ] **Step 1: Write the failing DialogueHistoryOverlay presentation test.**

Use a short DialogueHistoryEntry fixture and the escape coordinator's existing test utility. Assert a visual backdrop is aria-hidden and non-interactive, the existing DialogueHistoryPanel renders as non-modal, Escape invokes the supplied close callback once, and destroying the host releases the claim.

~~~typescript
render(DialogueHistoryOverlay, {
  history,
  bottom: 180,
  onClose,
});
expect(document.querySelector(".history-backdrop")).toHaveAttribute(
  "aria-hidden",
  "true",
);
expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "false");
await closeTopmostEscapeClaim();
expect(onClose).toHaveBeenCalledTimes(1);
~~~

- [ ] **Step 2: Run the new host test and confirm it fails before the component exists.**

Run:

~~~bash
rtk bun run --cwd apps/game test -- src/lib/components/DialogueHistoryOverlay.test.ts
~~~

Expected: test module resolution fails because DialogueHistoryOverlay.svelte is absent.

- [ ] **Step 3: Implement the self-contained visual history host.**

Reuse the existing backdrop class/styles from DialogueBox; move no focus-restoration policy into this component. Claim/release Escape in an onMount/onDestroy lifecycle and call the parent's callback as the claim action.

~~~svelte
<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { claimEscape } from "$lib/state/escape-coordinator";
  import DialogueHistoryPanel from "./DialogueHistoryPanel.svelte";
  import type { DialogueHistoryEntry } from "../state/types";

  let { history, bottom, onClose }: DialogueHistoryOverlayProps = $props();
  let releaseEscapeClaim: (() => void) | null = null;

  function close(): void {
    // Release before the parent flips its local open state, so a second
    // Escape cannot close an underlying layer before Svelte destroys us.
    releaseEscapeClaim?.();
    releaseEscapeClaim = null;
    onClose();
  }

  onMount(() => {
    releaseEscapeClaim = claimEscape(close);
  });

  onDestroy(() => {
    releaseEscapeClaim?.();
    releaseEscapeClaim = null;
  });
</script>

<div class="history-backdrop" aria-hidden="true"></div>
<DialogueHistoryPanel {history} {bottom} onClose={close} />

<style>
  .history-backdrop {
    pointer-events: none;
  }
</style>
~~~

Carry over the complete existing visual backdrop CSS from DialogueBox so this is a visual extraction, not a weaker replacement.

- [ ] **Step 4: Add failing InterrogationStage tests for the menu-only toolbar and subject meter.**

Replace the old one-button Case File expectation with three exact controls in menu mode. Cover callback section and trigger, two-digit evidence count, progressbar semantics, absence on same-scene dialogue, and absence during Present.

~~~typescript
const objective = document.querySelector<HTMLButtonElement>(
  "[data-interrogation-case-file-objective]",
);
const locker = document.querySelector<HTMLButtonElement>(
  "[data-interrogation-evidence-locker]",
);
const stageLog = document.querySelector<HTMLButtonElement>(
  "[data-interrogation-stage-log]",
);
expect(stageLog).toBeInTheDocument();
expect(locker).toHaveTextContent("證物櫃 02");

await user.click(objective!);
expect(onOpenCaseFile).toHaveBeenLastCalledWith(
  "objective",
  objective!,
);

const meter = document.querySelector(
  "[data-interrogation-broken-progress]",
);
expect(meter).toHaveAttribute("role", "progressbar");
expect(meter).toHaveAttribute("aria-valuenow", "1");
expect(meter).toHaveAttribute("aria-valuemax", "3");
expect(meter).toHaveAccessibleName("已突破 1 / 3 題");
~~~

Add a rerender test from menu to same-scene dialogue asserting the stage toolbar and host unmount, then rerender back to menu, open stage LOG, close it through the host, and assert focus returns to the stage LOG button.

- [ ] **Step 5: Implement stage-local history and menu-only controls.**

Import tick, DialogueHistoryOverlay, CaseFileSection, and DialogueHistoryEntry. Keep stage history state local and do not add a global key handler.

~~~svelte
let stageHistoryOpen = $state(false);
let stageLogButton: HTMLButtonElement | undefined = $state();
let menuChromeVisible = $derived(
  active && mode.type === "interrogation" && !presenting,
);

$effect(() => {
  if (!menuChromeVisible) stageHistoryOpen = false;
});

function openStageHistory(): void {
  if (!disabled) stageHistoryOpen = true;
}

function closeStageHistory(): void {
  if (!stageHistoryOpen) return;
  stageHistoryOpen = false;
  void tick().then(() => stageLogButton?.focus());
}

function openCaseFile(
  section: Extract<CaseFileSection, "objective" | "evidence">,
  event: MouseEvent,
): void {
  if (disabled) return;
  const trigger = event.currentTarget;
  if (trigger instanceof HTMLElement) onOpenCaseFile(section, trigger);
}
~~~

Render the right-side toolbar only under menuChromeVisible. Each launcher is a separate native button; derive the count from inventory.evidence.length.padStart(2, "0"). Keep subject name/role and replace phase-record's visible contract with the derived visual meter without inventing data.

~~~svelte
{#if menuChromeVisible}
  <div class="interrogation-menu-toolbar" aria-label="訊問工具">
    <button bind:this={stageLogButton} data-interrogation-stage-log="" type="button" {disabled} onclick={openStageHistory}>LOG</button>
    <button data-interrogation-case-file-objective="" type="button" {disabled} onclick={(event) => openCaseFile("objective", event)}>案件檔案</button>
    <button data-interrogation-evidence-locker="" type="button" {disabled} onclick={(event) => openCaseFile("evidence", event)}>
      證物櫃 {String(inventory.evidence.length).padStart(2, "0")}
    </button>
  </div>
{/if}

<div class="subject-meter">
  <p>動搖 · COMPOSURE</p>
  <div
    data-interrogation-broken-progress=""
    role="progressbar"
    aria-label={"已突破 " + progress.broken + " / " + progress.total + " 題"}
    aria-valuenow={progress.broken}
    aria-valuemin="0"
    aria-valuemax={progress.total}
  >
    <span style={"--progress: " + (progress.total === 0 ? 0 : progress.broken / progress.total)}></span>
  </div>
</div>

{#if menuChromeVisible && stageHistoryOpen}
  <DialogueHistoryOverlay history={history} bottom={180} onClose={closeStageHistory} />
{/if}
~~~

Keep stage chrome pointer-events behavior but restore pointer-events: auto on the toolbar and its buttons. The existing testimony DialogueBox remains the only LOG launcher during dialogue.

- [ ] **Step 6: Update the harness and route to pass history and selected Case File sections.**

Add history to the harness prop type with a default empty array. Pass it straight through. In +page.svelte pass history={gameState.value.dialogueHistory}; change the current callback only by selecting its supplied section before the pre-existing Case File request.

~~~typescript
function openInterrogationCaseFile(
  section: Extract<CaseFileSection, "objective" | "evidence">,
  trigger: HTMLElement,
): void {
  caseFileSection = section;
  caseFileRequestId += 1;
  caseFileRequest = {
    id: caseFileRequestId,
    returnFocusTo: trigger,
  };
}
~~~

Do not change the existing Case File request shape, GameShell ownership, or any Rust command.

- [ ] **Step 7: Add route-level section assertions and remove only obsolete raw-source chrome cases.**

In page.test.ts render an interrogation-menu state, click objective and evidence independently, and assert the existing Case File opens to the corresponding section. In InterrogationChrome.test.ts remove only the raw CSS/source-string assertions about the previous stage case-file HUD and previous tray cards. Keep the question-record/dialogue chrome tests and replace any lost behavioral coverage with the component tests above.

~~~typescript
await user.click(
  screen.getByRole("button", { name: /案件檔案/ }),
);
expect(screen.getByRole("tab", { name: /目標/ })).toHaveAttribute(
  "aria-selected",
  "true",
);

await user.click(
  screen.getByRole("button", { name: /證物櫃 02/ }),
);
expect(screen.getByRole("tab", { name: /證物/ })).toHaveAttribute(
  "aria-selected",
  "true",
);
~~~

- [ ] **Step 8: Run focused history, stage, route, and chrome tests.**

Run:

~~~bash
rtk bun run --cwd apps/game test -- src/lib/components/DialogueHistoryOverlay.test.ts src/lib/components/InterrogationStage.test.ts src/routes/page.test.ts src/lib/components/InterrogationChrome.test.ts
rtk bun run --cwd apps/game check
~~~

Expected: The menu has exactly three independent controls, its history is non-modal/local, Case File section selection is explicit, and stage toolbar visibility follows mode.

- [ ] **Step 9: Commit the shared host and menu control integration.**

~~~bash
rtk git add apps/game/src/lib/components/DialogueHistoryOverlay.svelte apps/game/src/lib/components/DialogueHistoryOverlay.test.ts apps/game/src/lib/components/InterrogationStage.svelte apps/game/src/lib/components/InterrogationStage.test.ts apps/game/src/lib/test-harnesses/InterrogationStageHarness.svelte apps/game/src/routes/+page.svelte apps/game/src/routes/page.test.ts apps/game/src/lib/components/InterrogationChrome.test.ts
rtk git commit -m "feat: add interrogation menu fidelity controls"
~~~

### Task 5: Migrate DialogueBox to the shared history host without changing its controller

**Files:**

- Modify: apps/game/src/lib/components/DialogueBox.svelte
- Test: apps/game/src/lib/components/DialogueBox.test.ts

**Interfaces:**

- Consumes: DialogueHistoryOverlay from Task 4:

~~~svelte
<DialogueHistoryOverlay
  {history}
  bottom={historyPanelBottom}
  onClose={() => closeHistory({ refocusLog: false })}
/>
~~~

- Preserves DialogueBox-owned local state/functions: historyOpen, openHistory(), closeHistory({ refocusLog }), toggleHistory(), updateHistoryPanelBottom(), the ResizeObserver, the L shortcut, LOG click-to-close behavior, and advance-button focus restoration.
- DialogueHistoryOverlay owns the history-specific Escape claim after this task. DialogueBox must not retain a second claim for the same history state.

- [ ] **Step 1: Extend the existing DialogueBox tests before editing the component.**

Keep the existing history/L/focus regression tests, and add an assertion that the visual host is present when history opens while the dialogue wrapper and advance button are inert, the LOG button remains available, and Escape closes through the shared host with advance focus restoration.

~~~typescript
await user.click(screen.getByRole("button", { name: "LOG" }));
expect(document.querySelector(".history-backdrop")).toBeInTheDocument();
expect(document.querySelector(".wrapper")).toHaveAttribute("inert");
expect(screen.getByRole("button", { name: "LOG" })).not.toBeDisabled();

await closeTopmostEscapeClaim();
await waitFor(() => {
  expect(screen.getByRole("button", { name: /繼續/ })).toHaveFocus();
});
~~~

Use the actual existing wrapper/advance selectors in this test file if it does not expose the illustrated test IDs; preserve its established assertion style rather than adding behavior-only test IDs.

- [ ] **Step 2: Run the focused DialogueBox test and confirm the host assertion fails.**

Run:

~~~bash
rtk bun run --cwd apps/game test -- src/lib/components/DialogueBox.test.ts
~~~

Expected: The test fails because DialogueBox still renders a private backdrop/panel and owns the history Escape claim.

- [ ] **Step 3: Replace only the private visual block with DialogueHistoryOverlay.**

Remove DialogueHistoryPanel and claimEscape imports from DialogueBox. Import DialogueHistoryOverlay. Delete the private history-backdrop markup and its copied CSS from DialogueBox, then mount the host under the existing historyOpen condition.

~~~svelte
{#if historyOpen}
  <DialogueHistoryOverlay
    {history}
    bottom={historyPanelBottom}
    onClose={() => closeHistory({ refocusLog: false })}
  />
{/if}
~~~

- [ ] **Step 4: Remove only the history-specific Escape effect and its synchronous-release lines.**

Delete releaseEscapeClaim, the $effect that claims Escape while historyOpen, and the synchronous release lines inside closeHistory. The shared host now releases its own claim before invoking the parent callback. Keep the ResizeObserver effect, closeHistory's focus policy, all keyboard handling, and inert attributes. Because the host calls closeHistory, a LOG-click close still explicitly uses refocusLog: true while Escape/CLOSE/L continue to choose advance focus.

~~~typescript
function closeHistory({ refocusLog = false } = {}): void {
  if (!historyOpen) return;
  historyOpen = false;
  if (refocusLog) {
    void tick().then(() => logButton?.focus());
  } else {
    void tick().then(() => advanceButton?.focus());
  }
}

function toggleHistory(): void {
  if (historyOpen) {
    closeHistory({ refocusLog: true });
    return;
  }
  openHistory();
}
~~~

- [ ] **Step 5: Run dialogue history regression checks and Svelte type checks.**

Run:

~~~bash
rtk bun run --cwd apps/game test -- src/lib/components/DialogueBox.test.ts src/lib/components/DialogueHistoryOverlay.test.ts
rtk bun run --cwd apps/game check
~~~

Expected: L and LOG open/close only on dialogue, Escape closes a single overlay, Space after Escape advances rather than reopening LOG, non-modal history remains non-blocking, and wrapper measurement still clears the panel.

- [ ] **Step 6: Commit the DialogueBox visual-host migration.**

~~~bash
rtk git add apps/game/src/lib/components/DialogueBox.svelte apps/game/src/lib/components/DialogueBox.test.ts
rtk git commit -m "refactor: share dialogue history overlay"
~~~

### Task 6: Extend the packaged journey with semantic fidelity assertions and capture artifacts

**Files:**

- Modify: apps/game/e2e-tauri/helpers.ts
- Modify: apps/game/e2e-tauri/analysis-beat85.e2e.ts

**Interfaces:**

- Consumes: ensureCaseFileViewport(), caseFileViewportNativeSize(dpr, target), validDevicePixelRatio(), browser.saveScreenshot(), LYRA_E2E_OUTPUT_DIR, and optional LYRA_E2E_REQUIRE_EXACT_CAPTURE_VIEWPORT.
- Produces a helper with an explicit result and one PNG/JSON pair per requested capture:

~~~typescript
export type MockupCaptureResult = {
  requested: CssViewportSize;
  observed: CssViewportSize & { devicePixelRatio: number };
  screenshotPath: string;
  metadataPath: string;
  strict: boolean;
};

export async function captureMockupViewport(input: {
  name: string;
  requested: CssViewportSize;
  outputDirectory: string;
}): Promise<MockupCaptureResult>;
~~~

- Sidecar JSON contains requested, observed, devicePixelRatio, and strict. The helper names each PNG with the observed CSS viewport and verifies PNG and sidecar existence/non-zero size before returning.

- [ ] **Step 1: Add semantic E2E assertions to the existing checkpoint journey before adding captures.**

At the interrogation menu checkpoint, assert exactly three stage toolbar buttons, distinct labels, the two-digit locker count, and the broken progressbar. At testimony, assert the stage controls are absent and DialogueBox LOG remains. At Present, assert the stage controls remain absent, the five-column computed grid, visible ESC button, and separate detail panel. At Analysis Classify, assert the ordinal chip, a 22px h2, the footer-contained hint, and rail entries without kind/progress-row elements.

~~~typescript
await expect(
  await $$("[data-interrogation-stage-log], [data-interrogation-case-file-objective], [data-interrogation-evidence-locker]"),
).toHaveLength(3);
expect(
  await $("[data-interrogation-broken-progress]").getAttribute("role"),
).toBe("progressbar");
expect(
  await browser.execute(() =>
    getComputedStyle(
      document.querySelector("[data-interrogation-evidence-grid]")!,
    ).gridTemplateColumns.split(" ").length,
  ),
).toBe(5);
~~~

Use the current WDIO matcher/import conventions already in this file. Assert the meter ratio is valid with aria-valuenow and aria-valuemax rather than hard-coding a story phase's broken count.

- [ ] **Step 2: Run the currently built suite to establish the semantic failures.**

Run:

~~~bash
rtk bun run --cwd apps/game check:e2e
rtk node apps/game/scripts/build-e2e.mjs
rtk node apps/game/scripts/run-save-e2e.mjs --suite analysis-beat85
~~~

Expected: Existing geometry remains green; new semantic assertions fail until Tasks 1–5 are implemented. If the binary was already built before Tasks 1–5, rebuild it before judging the failures.

- [ ] **Step 3: Implement best-effort target viewport and capture artifact helper in helpers.ts.**

Export the observed viewport type/function needed by the helper rather than duplicating browser.execute. Use the same three-attempt DPR/chrome compensation pattern as ensureCaseFileViewport(), but request the caller's target CSS viewport. Always capture and write metadata after the final observed measurement; only then throw in strict mode if observed width/height differ.

~~~typescript
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

function assertNonEmptyArtifact(filePath: string): void {
  if (!existsSync(filePath) || statSync(filePath).size === 0) {
    throw new Error("Mockup capture artifact is missing or empty: " + filePath);
  }
}

const strict = process.env.LYRA_E2E_REQUIRE_EXACT_CAPTURE_VIEWPORT === "1";
const observedSuffix =
  "css-" + observed.width + "x" + observed.height;
const screenshotPath = path.join(
  outputDirectory,
  input.name + "-" + observedSuffix + ".png",
);
const metadataPath = screenshotPath.replace(/\.png$/, ".json");

await browser.saveScreenshot(screenshotPath);
writeFileSync(
  metadataPath,
  JSON.stringify(
    {
      requested: input.requested,
      observed: { width: observed.width, height: observed.height },
      devicePixelRatio: observed.devicePixelRatio,
      strict,
    },
    null,
    2,
  ),
);
assertNonEmptyArtifact(screenshotPath);
assertNonEmptyArtifact(metadataPath);
if (
  strict &&
  (observed.width !== input.requested.width ||
    observed.height !== input.requested.height)
) {
  throw new Error(
    "Exact mockup capture viewport unavailable: requested " +
      input.requested.width + "x" + input.requested.height +
      ", observed " + observed.width + "x" + observed.height,
  );
}
~~~

Use mkdirSync(outputDirectory, { recursive: true }) before artifact creation. The normal path records the observed viewport and does not fail merely because window chrome/DPR prevented exact size.

- [ ] **Step 4: Capture all five required states through the existing journey.**

Resolve outputDirectory from LYRA_E2E_OUTPUT_DIR when supplied; otherwise use the current app E2E logs directory convention. Invoke the helper after each state is semantically asserted:

~~~typescript
await captureMockupViewport({
  name: "analysis-classify",
  requested: { width: 1280, height: 720 },
  outputDirectory,
});
await captureMockupViewport({
  name: "interrogation-menu",
  requested: { width: 1280, height: 720 },
  outputDirectory,
});
await captureMockupViewport({
  name: "interrogation-testimony-rebut",
  requested: { width: 1280, height: 720 },
  outputDirectory,
});
await captureMockupViewport({
  name: "interrogation-present",
  requested: { width: 1280, height: 720 },
  outputDirectory,
});
await captureMockupViewport({
  name: "interrogation-testimony-tall",
  requested: { width: 1280, height: 800 },
  outputDirectory,
});
~~~

Do not replace ensureCaseFileViewport() with an exact-size assertion. Keep its at-least setup and all existing geometry assertions; the helper makes the additional best-effort target request only at capture points.

- [ ] **Step 5: Run type checks and the ordinary packaged suite.**

Run:

~~~bash
rtk bun run --cwd apps/game check:e2e
rtk bun run --cwd apps/game test:e2e:ci-contracts
rtk node apps/game/scripts/build-e2e.mjs
rtk node apps/game/scripts/run-save-e2e.mjs --suite analysis-beat85
~~~

Expected: Semantic assertions, non-empty PNGs, and non-empty JSON sidecars pass even if observed CSS dimensions are not exact.

- [ ] **Step 6: Run the opt-in strict review capture and inspect the five artifacts against ui_mock.**

Run:

~~~bash
rtk env LYRA_E2E_REQUIRE_EXACT_CAPTURE_VIEWPORT=1 node apps/game/scripts/run-save-e2e.mjs --suite analysis-beat85
~~~

Expected: The suite either emits all five exact 1280x720/1280x800 PNGs plus sidecars, or fails with requested versus observed dimensions while retaining the artifact it captured. Inspect the target-size images side-by-side with the supplied Analysis and Interrogation mockups using this checklist:

1. Menu has distinct LOG, 案件檔案, and 證物櫃 NN buttons.
2. Menu controls disappear in testimony/Present, while testimony LOG remains.
3. Subject meter fill and ARIA values equal broken/total.
4. Present has five tiles, separate detail, visible ESC, and no confirmation state.
5. Analysis has Board N / Total, a 22px title, and footer hint.
6. Rail has label, compact status, thin bar, no visible kind or standalone progress row.

- [ ] **Step 7: Commit the packaged proof contract.**

~~~bash
rtk git add apps/game/e2e-tauri/helpers.ts apps/game/e2e-tauri/analysis-beat85.e2e.ts
rtk git commit -m "test: capture mockup fidelity evidence"
~~~

## Final Verification and Review Gate

- [ ] **Step 1: Inspect the complete diff for forbidden authority and generated-resource changes.**

Run:

~~~bash
rtk git diff main...HEAD -- apps/game/src-tauri packages/scripts static/stories_plan docs/stories_plan apps/game/src/lib/case-file
rtk git status --short
~~~

Expected: No changed Rust/compiler/content/generated/Case File model files. The untracked ui_mock directory remains un-staged.

- [ ] **Step 2: Run the full required local verification set.**

Run:

~~~bash
rtk bun run --cwd apps/game check:e2e
rtk bun run --cwd apps/game test:e2e:ci-contracts
rtk node apps/game/scripts/build-e2e.mjs
rtk node apps/game/scripts/run-save-e2e.mjs --suite analysis-beat85
rtk bun run check
rtk bun run test
rtk bun run lint:all
~~~

Expected: All checks pass. Run bun run test:e2e only when CI selection or release validation explicitly requires the full registry; do not treat it as a mandatory duplicate of the focused suite.

- [ ] **Step 3: Conduct the final visual and behavioral review.**

Inspect the five capture artifacts, then manually verify keyboard access in the packaged app: stage LOG closes by Escape and returns focus to LOG; DialogueBox L behavior remains dialogue-only; tray ESC/收回 resume; Game Menu suspends the tray focus trap; Case File section buttons return to their own triggers; Analysis hint focuses and operates from the footer.

- [ ] **Step 4: Record the completed validation in the implementation handoff.**

Report the exact commands/results, observed capture dimensions, whether strict capture succeeded, and any environment limitation. Do not claim mockup conformance from geometry checks alone.

## Plan Self-Review

### Spec coverage

| Spec requirement | Plan coverage |
| --- | --- |
| Pure evidence/statement display model and source fallback chain | Task 1 |
| Five-column Present tiles, detail panel, ESC, direct lifecycle preservation | Task 2 |
| Analysis ordinal/title/hint/rail hierarchy | Task 3 |
| Analysis-only E2E suite selection | Task 3 |
| Shared non-modal history host without route-owned state | Task 4 |
| Menu-only LOG/Case File/locker controls and derived meter | Task 4 |
| Case File objective/evidence routing and stale raw-source test removal | Task 4 |
| DialogueBox preservation after overlay extraction | Task 5 |
| Semantic E2E checks, five artifact pairs, observed dimensions, strict opt-in mode | Task 6 |
| No authority/schema/content/generated/baseline changes and full verification | Global constraints and final gate |

No design requirement is unassigned.

### Placeholder scan

The prohibited-placeholder scan returned no matches. Every task lists concrete files, contracts, test conditions, implementation snippets, commands, expected outcomes, and a commit boundary.

### Type consistency

PresentableRecord is introduced in Task 1 and consumed by Task 2. DialogueHistoryOverlay is introduced in Task 4 and consumed by both Stage in Task 4 and DialogueBox in Task 5. The selected Case File section union is declared in Task 4 and passed through Stage, harness, and route using the same objective/evidence values. CaptureMockupViewport is introduced in Task 6 and used only by the existing E2E journey. No later task names an undeclared controller or adds route-owned history state.
