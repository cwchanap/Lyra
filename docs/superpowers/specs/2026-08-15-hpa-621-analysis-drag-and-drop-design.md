# HPA-621 Analysis Workbench Redesign

**Date:** 2026-08-16  
**Status:** Approved design, revised after second PR review  
**Target baseline:** current `main` (refresh branch before implementation)

## Design source of truth

`Analysis Workbench v3.dc.html` from the supplied `Lyra analysis scene redesign.zip` is the visual and interaction reference. Earlier mockups are exploratory predecessors.

Production adopts the v3 hierarchy and interaction model, not its prototype implementation. Do not port sample answers, inline CSS, Google Fonts, or native HTML5 drag handlers. Production continues to render the Rust public view and reuse Lyra's current tokens/components.

## Goal

Replace the form-like Chapter 1 Analysis screen with a fitted, full-height workbench while preserving:

- Rust-owned correctness and completion;
- the whole-draft mutation boundary;
- action-token reconciliation and stale-response protection;
- exact Save -> Title -> Continue draft persistence;
- keyboard/touch completion;
- existing GameShell, Case File, dialogue, and persistence ownership.

The same host must support both production Analysis shapes:

- the single-board P1 practice Threshold scene; and
- the three-board Beat 8.5 Classify / Order / Threshold scene.

## Architecture choice

Keep architecture C: extend existing seams, do not introduce a second state model.

- `apps/game/src/lib/analysis/presentation.ts` owns pure Analysis presentation predicates and progress.
- `GameShell.svelte` owns the fitted viewport presentation seam.
- `AnalysisWorkbench.svelte` owns Analysis navigation, host chrome, focus/reconciliation, utilities, inline feedback, and submit.
- `classify-draft.ts` owns pure Classify placement.
- existing `order-draft.ts` owns Order structural edits including arbitrary placement.
- `AnalysisCard.svelte` owns one local mouse/pen Pointer Events gesture and opaque target lookup.
- Classify and Order components own only target decoding and transient drag visuals.
- Threshold stays a native pressed-button selection board.
- authored `AnalysisResult` dialogue remains the success/result surface.

This keeps the redesign local and avoids duplicate modal/result infrastructure.

## Non-goals

- No Rust Analysis runtime, command, wire type, schema, save, migration, or authored-content changes.
- No frontend correctness/accepted-answer map.
- No HTML5 `draggable`, `DataTransfer`, `dragstart`, `dragover`, or `drop` path.
- No generic DnD manager, target registry, third-party DnD library, or floating drag clone.
- No touch long-press drag arbitration.
- No Chapter 2/future-board abstraction.
- No screenshot-test framework.
- No new modal/focus-trap subsystem for Analysis results.

## Existing contracts to preserve

### Rust remains authoritative

The semantic mutation path remains:

```text
Board component
  -> onDraft(next whole draft, focus key)
  -> AnalysisWorkbench.handleDraft()
  -> active-board reconciliation
  -> current AnalysisActionToken
  -> onUpdateDraft(action token, whole draft)
  -> Rust validation + exact persistence
```

A pointer drop produces the same `AnalysisDraft` as the existing semantic fallback controls. Invalid and valid no-op placements call `onDraft` zero times.

### Existing success and rejection surfaces remain authoritative

A successful `submit_analysis_board` already commits the board and installs its authored `AnalysisResult` dialogue. The production P1 practice board and all three Beat 8.5 boards currently have authored Result Dialogue. That authored dialogue is the confirmation beat.

Therefore HPA-621 does **not** add `AnalysisResultOverlay`, a generated `「${board.label}」已確認。` message, a result scrim, a new Escape claim, a seventh focus trap, or page-level result state.

A rejected/incomplete submit already returns Analysis mode feedback and keeps the board retryable. HPA-621 retains that inline feedback in `AnalysisWorkbench`, moves it into the v3 footer/result treatment as appropriate, and preserves focus-on-feedback behavior.

If a future authored Analysis board has an empty Result Dialogue, that is an authored-content gap. The UI must not silently manufacture a second success narrative to compensate.

## Analysis presentation predicate

Analysis presentation should follow the existing interrogation presentation pattern: keep scene presentation active while the scene owns dialogue.

Add to `apps/game/src/lib/analysis/presentation.ts`:

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

`+page.svelte` calls this helper instead of reimplementing the predicate inline.

This intentionally covers same-scene Analysis intro, board Result Dialogue, and Analysis outro dialogue. The public `Mode` exposes `queueToken.sceneId`, not the private dialogue-segment origin, and keeping one scene presentation through the whole Analysis scene avoids chapter-chrome flashes without new state.

When the queue advances to a different scene, `queueToken.sceneId !== scene.id` or `scene.kind` changes and ordinary GameShell presentation resumes.

## Pure Analysis progress helpers

The same module exports:

```ts
export type AnalysisBoardProgress = {
  current: number;
  target: number;
  percent: number;
};

export function analysisBoardProgress(
  board: AnalysisBoardView,
): AnalysisBoardProgress;

export function analysisOverallProgress(
  boards: AnalysisBoardView[],
): AnalysisBoardProgress;
```

Progress is participation/completion only; it never infers correctness.

- Classify: available authored cards assigned to authored groups / available authored cards.
- Order: unique available cards in the materialized timeline, including fixed prefix once / available authored cards.
- Threshold: valid selected available cards / `minimumSelected`; text may exceed the minimum while the percentage caps at 100%.
- Completed board: 100%.
- Overall: completed visible boards / all visible boards.
- Unknown/stale IDs never inflate progress.

There is no `analysisSubmitPresentation()` helper after this revision.

## GameShell viewport seam

The already-merged `interrogationPresentation` prop stays unchanged. Add an independent sibling:

```ts
analysisPresentation?: boolean;
```

While true:

- normal FILE/chapter title/summary/objective chrome is hidden;
- `GameAtmosphere`, Game Menu, Case File, persistence, and Escape remain GameShell-owned;
- `.shell` is the actual viewport-height containing block;
- `<main>` is a shrinking flex child;
- the workbench fills the available `<main>` height instead of stacking another viewport unit.

Required shape:

```css
.shell.analysis-presentation {
  height: 100dvh;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.shell.analysis-presentation > main {
  flex: 1 1 auto;
  min-height: 0;
}
```

`AnalysisWorkbench` uses `height: 100%` and `min-height: 0`.

The primary acceptance viewport is **1280x720**. Vertical spacing must fit 720px height; a 720px width breakpoint is not the mechanism that makes the desktop target fit. A height compaction rule may tighten rail/header/footer spacing without collapsing the desktop two-column layout.

Unit tests assert only the behavioral presentation hook/class and chrome visibility. They do **not** assert literal CSS source strings. Real fit is checked at 1280x720 as soon as the shell/rail/footer exist and again at final regression.

## Workbench information hierarchy

The left column is Analysis navigation, not the GameShell Case File.

Use `分析工作台` and/or `本案分析`. Never label this rail `案件檔案`.

```text
analysis-workbench
├── analysis rail
│   ├── 分析工作台 / 本案分析
│   ├── scene title + summary
│   ├── every visible board
│   │   ├── active / available / completed / locked
│   │   └── current / target + <progress>
│   └── completed / total + <progress>
└── board region
    ├── board number / kind / title / prompt / read-only status
    ├── minmax(0, 1fr) scrollable workspace
    └── persistent utilities / feedback / submit footer
```

Navigation uses all `visibleBoards`:

- current entry: `aria-current="page"`;
- locked/unavailable: visible, disabled;
- completed: visible and navigable for read-only review;
- non-completed `readOnly`: labelled read-only, never Confirmed.

`AnalysisWorkbench` must not mount `CaseFilePanel`.

### P1 practice

The single-board P1 production scene must render cleanly:

- exactly one rail entry;
- no invented locked siblings;
- practice cards work without inventory provenance;
- wrong-choice feedback remains inline and focusable;
- authored P1 Result Dialogue remains the success beat.

## Host heading and focus contract

Board components become workspace-only and stop owning duplicate title/prompt/hint/outer shell. This moves a load-bearing focus anchor, so the host heading must take it explicitly:

```svelte
<h2
  tabindex="-1"
  data-analysis-focus-key={`board:${board.id}`}
>
  {board.label}
</h2>
```

Then remove `headingFocusKey` from Classify, Order, and Threshold board props.

`AnalysisWorkbench.focusAfterRender()` keeps `board:<id>` as its fallback. Tests must cover:

1. board navigation focuses the new host heading;
2. a fallback Assign/Remove mutation requesting `card:<id>` focuses the real card anchor when present, otherwise the host board heading;
3. after moving card focus anchors into `AnalysisCard`, post-assign focus lands on the moved card rather than `<body>`.

## Pure Classify placement

Add `apps/game/src/lib/analysis/classify-draft.ts`:

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

Rules:

- unknown/unavailable card -> `null`;
- unknown group -> `null`;
- assign/move/unassign -> new mapping;
- same group/already unassigned -> the same mapping object as a valid no-op.

All three Classify paths use it:

- fallback Assign;
- fallback Remove;
- pointer drop.

The component decodes `classify:unassigned` and `classify:group:<id>`, owns transient visuals/live text, and calls `onDraft` only when the helper returns a different object.

## Pure Order placement

Extend existing `order-draft.ts` only with:

```ts
export function placeOrderCardBefore(
  board: OrderBoardView,
  cardIds: string[],
  cardId: string,
  beforeCardId: string | null,
): string[] | null;
```

Rules:

- reuse current fixed-prefix materialization/validation;
- reject unknown/unavailable card and fixed-anchor source;
- remove a movable card before reinserting it;
- non-null `beforeCardId` must be an available movable card in the timeline;
- `null` means append;
- never insert inside/before the fixed prefix;
- valid no-op returns the materialized sequence; invalid returns `null`.

Targets:

```text
order:before:<movable card id>
order:end
order:pending
```

Dropping a movable card on `order:pending` reuses the existing remove transform. Fixed anchors expose neither drag source nor insertion target.

## AnalysisCard Pointer Events contract

There is an existing Pointer Events precedent in `apps/layout-editor/src/lib/EditorCanvas.svelte`: pointer ID/start coordinates, movement threshold, `moved` state, and best-effort pointer capture. Analysis should reuse that state-machine shape rather than invent a new gesture architecture.

Analysis differs in one important way: it resolves semantic drop targets from the DOM. The game Vitest environment is jsdom, which does not provide layout hit-testing. Do not call `document.elementsFromPoint()` as an untestable hard global dependency.

Add one injectable seam:

```ts
resolveDropTarget?: (x: number, y: number) => string | null;
```

Production default:

```ts
function resolveDropTargetAt(x: number, y: number): string | null {
  const stack = document.elementsFromPoint?.(x, y) ?? [];
  for (const element of stack) {
    const target = element.closest<HTMLElement>("[data-analysis-drop-target]");
    if (target?.dataset.analysisDropTarget) {
      return target.dataset.analysisDropTarget;
    }
  }
  return null;
}
```

Boards pass nothing. Unit tests inject deterministic resolver stubs.

Other `AnalysisCard` additions stay narrow:

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

Gesture:

1. primary mouse/pen only;
2. pickup after movement exceeds 4 CSS pixels;
3. touch never enters custom drag;
4. best-effort `setPointerCapture?.()`;
5. resolver reports opaque target IDs;
6. pointer up emits at most one drop;
7. pointer cancel emits none;
8. completed drag suppresses follow-on click.

Stable hooks:

```html
data-analysis-card-id="<id>"
data-analysis-focus-key="card:<id>"
data-analysis-drop-target="<opaque target>"
```

The non-button Order branch remains a real `<article>` with `tabindex="-1"` only when needed for programmatic focus. No global `touch-action: none` and no floating clone.

## Classify interaction

- unassigned pool left, authored groups right;
- drag assign, group-to-group move, drag-back unassign;
- fallback Assign/Remove remain;
- lifted/eligible/active/invalid/settled states;
- one polite text live region;
- structural semantics come only from `applyClassifyPlacement()`.

## Order interaction

- numbered vertical timeline;
- fixed anchors visually immutable;
- pending pool beside timeline;
- stable insertion gutters before movable events and at end;
- insertion preview;
- pending -> precise insertion;
- timeline -> reorder;
- timeline -> pending removal;
- Add/Up/Down/Remove fallback remains.

## Threshold interaction and provenance

Threshold deliberately has no custom drag.

- native button/`aria-pressed` selection for click/tap/Space/Enter;
- explicit selected marker/text;
- existing `已選 X / 至少 Y` count;
- native `<progress>` meter;
- no drag zones.

Preserve all currently shown provenance fields when available:

1. source kind;
2. procedural status;
3. source;
4. source group;
5. proof capabilities.

They may move into compact `AnalysisCard.badges`, but none may disappear. Practice cards render without invented provenance.

## Rejected treatment

Rejected/incomplete feedback stays inside `AnalysisWorkbench` and is restyled with v3 visual weight. It remains textual, focusable after submit, and leaves the same board retryable.

Do not duplicate `gameState.error`: command errors remain the shared ErrorBanner path.

## Packaged pointer proof: decision gate, not runtime fallback

There is no existing pointer-action helper in `apps/game/e2e-tauri`. Prove transport immediately after Classify drag is implemented.

The implementation task is a **decision checkpoint**:

1. probe WebdriverIO W3C `browser.action("pointer", ...)` once against the packaged app and stable `data-analysis-*` hooks;
2. if it works reliably, commit a W3C-only helper;
3. if it is unsupported/unreliable, commit a `browser.execute()` helper that dispatches `PointerEvent` into the same production listeners;
4. record the observed reason in the test/helper comment and implementation PR;
5. do **not** ship a per-run try/catch that silently falls back.

If the synthetic path is selected, the claim is explicitly narrower: the packaged test proves the real production Pointer Events listener/target path, not driver-level pointer transport.

Never use HTML5 `dragTo()`.

Focused command:

```bash
node apps/game/scripts/run-save-e2e.mjs --suite analysis-beat85
```

## Layout verification timing

jsdom cannot verify the 1280x720 fit. Therefore:

- component tests pin semantic hooks/classes and chrome behavior only;
- no source-string assertions for `height: 100dvh`, `min-height: 0`, or literal CSS formatting;
- perform the first manual 1280x720 acceptance immediately after GameShell + Workbench rail/header/footer are implemented;
- re-run the same acceptance in the final implementation PR.

First layout acceptance checks:

- one fitted viewport, no body/page vertical stacking;
- rail visible without hiding board primary action;
- header and footer remain visible at 720px height;
- long board content scrolls only inside workspace;
- P1 one-board layout does not look like a broken three-board rail;
- Beat 8.5 three-board rail has no overlap/clipping.

## Implementation slicing

PR #60 remains one **planning-only** PR. Implementation should be delivered as three independently reviewable PRs.

### Implementation PR A — Shell and hierarchy

- `analysis/presentation.ts`: progress + `isAnalysisPresentationActive()`;
- GameShell `analysisPresentation` viewport seam;
- `AnalysisWorkbench` v3 rail/header/workspace/footer;
- host focus-anchor migration;
- P1 + Beat 8.5 component coverage;
- first manual 1280x720 acceptance.

This is independently user-visible and shippable.

### Implementation PR B — Direct manipulation

- `classify-draft.ts`;
- `AnalysisCard` Pointer Events using the EditorCanvas state-machine precedent and injectable resolver;
- Classify drag/fallback through one pure transform;
- early packaged pointer decision/proof;
- `placeOrderCardBefore()` plus Order timeline/pending drag UX.

Do not put the unused Order helper in PR A merely to preserve old task numbering.

### Implementation PR C — Threshold and journey hardening

- Threshold v3 direct-selection visual pass with all provenance + native `<progress>`;
- final `analysis-beat85` Classify/Order/Threshold journey;
- partial Classify, Order, and Threshold Save -> Title -> Continue proofs;
- final unit/type/full regression and 1280x720 re-check.

No Analysis result modal task remains.

## Acceptance criteria

- [ ] `isAnalysisPresentationActive()` is unit-tested for Analysis mode, same-scene Analysis dialogue, unrelated dialogue, and non-Analysis scene.
- [ ] Analysis presentation stays active through authored P1/Beat 8.5 Result Dialogue; normal chapter chrome does not flash back mid-scene.
- [ ] At 1280x720, GameShell owns one fitted viewport; `<main>` shrinks and the workbench fills it without stacked viewport height.
- [ ] Rail uses `分析工作台` / `本案分析`, never `案件檔案`; `AnalysisWorkbench` does not mount `CaseFilePanel`.
- [ ] P1 renders as one clean rail entry with practice cards, wrong-choice feedback, and authored Result Dialogue.
- [ ] Beat 8.5 shows all visible boards, active/locked/completed states, per-board `<progress>`, and overall completion.
- [ ] Host board heading carries `data-analysis-focus-key="board:<id>"`; child `headingFocusKey` props are removed.
- [ ] Board switch and post-mutation focus never collapse to `<body>`.
- [ ] Classify Assign/Remove/drag share `applyClassifyPlacement()`; invalid/no-op placements dispatch zero drafts.
- [ ] AnalysisCard drag tests inject `resolveDropTarget`; jsdom never needs real layout hit-testing.
- [ ] Mouse/pen pickup threshold is >4px; touch keeps semantic controls; pointer cancel emits no drop.
- [ ] Order supports precise insert/reorder/append/pending removal with immutable fixed anchors and visible insertion preview.
- [ ] Threshold remains direct semantic selection with full existing provenance and native `<progress>`.
- [ ] Rejected feedback stays inline/focusable/retryable and uses runtime-authored copy.
- [ ] Successful submit uses authored `AnalysisResult` dialogue; no generated Confirmed modal/scrim/focus trap/inert state is added.
- [ ] Pointer transport selection is explicit and fixed after the early packaged probe; there is no hidden runtime W3C-to-synthetic fallback.
- [ ] Existing `analysis-beat85` suite proves the selected production pointer path, Threshold selection, submission, hearing handoff, and exact three-board partial persistence.
- [ ] No Rust/schema/save/evaluator/future-board abstraction is added.
