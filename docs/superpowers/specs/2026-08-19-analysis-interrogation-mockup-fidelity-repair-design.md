# Analysis and Interrogation Mockup Fidelity Repair Design

**Date:** 2026-08-19  
**Status:** Revised after review — awaiting implementation-plan approval
**Supersedes:** the visual-fidelity portions of `2026-08-17-analysis-interrogation-mockup-conformance-design.md`

## Purpose

Repair the remaining visible differences between the supplied handoff mockups
and the rendered desktop game without changing game authority, story content,
save data, or the Present state machine.

The prior conformance work correctly established the desktop containing blocks
and geometry. It did not make the mock's control hierarchy, evidence-tray
information architecture, or Analysis header contract executable enough to
prevent a geometry-only pass from being treated as visual completion.

## Sources of truth

The visual references are:

- `ui_mock/Lyra analysis scene redesign/Analysis Workbench v3.dc.html`
- `ui_mock/Lyra interrogation scene redesign/Interrogation Redesign.dc.html`

These handoffs define the target composition, hierarchy, typography scale,
control grouping, and information density. They do not replace production
runtime semantics. `ui_mock/` is supplied reference material and remains
untracked; no mock raster baseline is committed.

## Goals

1. Match the mock's remaining desktop visual hierarchy at exact 1280x720 and
   1280x800 CSS viewports.
2. Make every visible mock-derived control a real, keyboard-accessible entry
   point to an existing production behavior.
3. Preserve Rust as the authority for Analysis evaluation, interrogation
   state, evidence presentation, saves, and story progression.
4. Keep Present selection immediate: choosing a record invokes the existing
   engine callback with no local confirmation or preview state.
5. Make the visual contract testable through component assertions, stable E2E
   selectors, and reviewable packaged screenshots.

## Non-goals

- No Rust, compiler, scene-schema, save-schema, or authored-content changes.
- No new evidence browser, client-owned inventory, confirmation step, or
  local Present result state.
- No client-owned composure, health, verdict, or contradiction mechanics.
- No replacement Case File; the existing `GameShell` Case File remains the
  destination for the stage toolbar.
- No committed screenshot baselines or screenshot-diff framework.
- No change to normal dialogue history contents or the existing `L` shortcut
  contract.

## Fidelity contract

### Analysis Workbench

At desktop size:

- Keep the existing 248px rail, 960px centered board frame, board geometry,
  pointer interactions, draft reconciliation, and footer reachability.
- Render an ordinal chip before the board eyebrow: `Board N / Total`, where
  `N` comes from the authored `analysis.visibleBoards` order and `Total` is
  its length. Rail display sorting must not change this ordinal.
- Render the board title at 22px at the desktop target, followed by the
  existing prompt at the mock's compact hierarchy.
- Do not place the hint action in the board header. Keep it visible and
  keyboard-accessible as a secondary footer utility; its expanded copy must
  not alter header composition.
- Restore a segmented rail: a case/scene heading block, a separator, compact
  board entries, and the existing aggregate progress at the bottom. Each
  visible entry keeps its label, a compact status value, and a thin progress
  bar. Remove the visible kind label and the separate `進度 X / Y` row; retain
  complete state/progress labels for screen readers.

### Interrogation menu toolbar

At desktop size, render three separate buttons at the stage's top-right only
while `mode.type === "interrogation"` and Present is not active:

| Control | Production destination | Accessible behavior |
| --- | --- | --- |
| `LOG` | existing dialogue history | opens the shared history overlay |
| `案件檔案` | existing Case File objective section | opens GameShell Case File and returns focus to its trigger |
| `證物櫃 NN` | existing Case File evidence section | `NN` is `inventory.evidence.length` padded to two digits; opens Case File evidence |

The controls are individual buttons, not two visual fragments of one button.
They are hidden during same-scene dialogue/testimony and Present, matching the
mock. DialogueBox's existing LOG remains the testimony launcher; Case File
entry during testimony is deliberately outside this slice. Opening either menu
Case File control keeps the current interrogation state intact under the
existing top-layer behavior.

The lower-left subject card retains subject name and role. Its mock-shaped
meter derives from `brokenQuestionProgress(phase)`:

- visual fill is derived only from `broken / total`;
- the mock's `動搖 · COMPOSURE` copy is visual-only; it does not name a runtime
  field;
- a `data-interrogation-broken-progress` progressbar exposes `aria-valuenow`,
  `aria-valuemax`, and the authoritative `已突破 X / Y 題` label;
- it does not introduce a new composure field, mutation, or result rule.

### History overlay

The mock's stage `LOG` must reuse the same dialogue history model as the
existing in-frame `DialogueBox` button. One route-owned controller governs
both launchers:

- `+page.svelte` owns the one open request and its origin/focus behavior. It
  carries the existing `DialogueHistoryPanel` `bottom` value rather than
  inventing another geometry system: DialogueBox supplies its existing
  measured bottom offset and the menu LOG uses the panel's 180px default.
- A new `DialogueHistoryOverlay.svelte` renders the existing
  `DialogueHistoryPanel`, claims Escape while mounted, and restores focus on
  close. Its visual dimmer remains `pointer-events: none` and the panel
  remains `aria-modal="false"`.
- `DialogueBox.svelte` becomes a controlled launcher for history. Its normal
  `L` shortcut stays local to dialogue and retains the current Escape/CLOSE/L
  fallback to the advance button. Its content and advance target remain inert
  while history is open, but its LOG button remains operable so a LOG click
  toggles the panel closed.
- `InterrogationStage.svelte` launches the same overlay from its toolbar. A
  menu-origin close restores focus to the stage `LOG` button, which also stays
  operable to toggle the panel closed.
- The stage toolbar does not add a new global `L` shortcut during the
  interrogation menu.

This prevents separate history overlays from diverging in content, Escape
priority, focus behavior, or accessibility behavior without changing the
current non-modal LOG contract.

### Present evidence tray

The Present tray keeps its current lifecycle, focus trap, top-layer
suspension, direct callbacks, Game Menu action, `收回`, and Escape claim.
Only its presentation changes:

- desktop width remains at most 900px;
- its header contains title, kicker/progress, and a visible `ESC` button;
- the target testimony remains in a dedicated record above the choices;
- choices form a fixed five-column desktop tile grid, with a compact
  responsive fallback below the existing compact breakpoint;
- a tile contains only its image/seal, short name, and state tag;
- pointer hover and keyboard focus populate a separate detail panel with the
  record name, source/type, description, and details;
- activating a tile immediately calls the existing `onPresent` callback;
- `ESC` and `收回` both call the existing `onResume` path;
- the footer keeps the required Game Menu entry as a visually secondary
  action and styles the existing instruction as the mock's verdict/status
  region.

`presentableRecords(inventory)` is a small pure interrogation-presentation
mapper. It produces one display list for evidence and statements, including
the direct `kind`/`id` payload, short name, tag, description, details, image
asset id, and provenance labels from `caseRecordProvenancePresentation`.
The component keeps only transient hover/focus identity. It does not reuse the
Case File's predecessor-normalization or reexamine/navigation view model, and
it passes the mapper's unchanged `kind`/`id` values directly to `onPresent`.

## Component and data-flow design

### `+page.svelte`

Add route-local history-overlay request state in the existing Case File/Game
Menu request style. It records the launch origin, safe return focus, and the
existing `DialogueHistoryPanel` bottom value when DialogueBox supplies one.
The route renders one `DialogueHistoryOverlay` when a request is active and
passes the current `gameState.value.dialogueHistory` to it. Closing clears the
request with the source-specific focus behavior above. The route also changes
the existing Interrogation Case File callback
to accept a `CaseFileSection` before issuing the unchanged Case File request:

```ts
function openInterrogationCaseFile(
  section: CaseFileSection,
  trigger: HTMLElement,
): void;
```

It sets `caseFileSection` to `objective` or `evidence` before requesting the
existing `GameShell` Case File overlay. No `GameShell` request shape, Rust
command, or persistence contract changes.

### `DialogueHistoryOverlay.svelte` (new)

Own only overlay presentation and lifecycle: the non-blocking visual backdrop,
`DialogueHistoryPanel`, Escape claim, close callback, and safe focus
restoration. It consumes the route request, preserves `aria-modal="false"`,
and does not own or mutate dialogue history.

### `DialogueBox.svelte`

Replace its private history-panel mounting with controlled history props and
request callbacks. Preserve all current ordinary-dialogue behavior:

- the in-frame `LOG` button remains;
- `L` opens/closes history only while a dialogue surface owns the shortcut;
- the dialogue box and advance button remain inert while the shared overlay is
  open, while LOG remains active for click-to-close;
- Escape-close still favors the advance button to avoid the Space-reopens-LOG
  regression;
- the current wrapper measurement continues to supply the panel's bottom
  offset.

### `InterrogationStage.svelte`

Add stable controls and callbacks for the three toolbar actions. Render them
only in the menu state; testimony retains DialogueBox's LOG and Present renders
only its tray. The stage receives the controlled history state and request
callback, passes the correct Case File section to the route, and derives the
padded evidence count and broken-progress meter from its existing `inventory`
and `progress` values. It remains a presentation container, not an
interrogation state machine.

Use stable hooks:

- `data-interrogation-stage-log`
- `data-interrogation-case-file-objective`
- `data-interrogation-evidence-locker`
- `data-interrogation-broken-progress`

### `InterrogationEvidenceTray.svelte`

Consume the one `presentableRecords(inventory)` display list and retain only
transient focused/hovered record identity. Keep the engine-facing
`present(kind, id)` function unchanged.

Use stable hooks:

- `data-interrogation-evidence-grid`
- `data-interrogation-evidence-detail`
- `data-interrogation-tray-escape`

### `AnalysisWorkbench.svelte`

Derive the board ordinal from the authored visible-board order, independent
of `railBoards`. Restructure only visual containers and CSS; retain current
selection, reconciliation, draft, pointer, keyboard, read-only, undo, reset,
submit, feedback, and relative-navigation behavior.

Use the `data-analysis-board-position` hook for the ordinal chip. Reuse the
existing `data-analysis-focus-key="hint"` for the moved hint control; no
second hint-specific test hook is needed.

## Accessibility and responsive requirements

- Every toolbar and tray control is a native button with a meaningful name.
- The broken-progress meter has an accessible authoritative progress
  description; its mock-derived visual label does not become game state.
- The detail panel updates on both pointer hover and keyboard focus.
- The tray's existing Tab trap suspends under Game Menu/Case File and resumes
  after the upper layer closes.
- Escape always closes only the current topmost layer.
- Dialogue history remains a non-modal dialog with a non-blocking backdrop;
  its LOG origin stays available to toggle it closed.
- At narrow widths, stage toolbar controls may wrap and evidence tiles may
  reduce columns, but no action becomes hidden or unreachable.
- `prefers-reduced-motion` behavior remains unchanged.

## Verification strategy

### Focused component tests

Add or update tests for:

1. `DialogueHistoryOverlay.svelte`: Escape claim, closing behavior, and
   origin-specific focus restoration while preserving a non-modal,
   non-blocking overlay.
2. `DialogueBox.svelte`: controlled history requests, existing `L` behavior,
   in-frame `LOG` click-to-close, wrapper/advance inertness, and
   advance-button focus restoration.
3. `InterrogationStage.svelte`: exactly three distinct toolbar controls,
   menu-only HUD visibility, objective/evidence Case File routing, padded
   evidence count, and broken-progress meter semantics.
4. `InterrogationEvidenceTray.svelte`: fixed-grid hook, focus/hover detail
   content, direct Present callback, visible `ESC` using `onResume`, Game
   Menu without resume, focus trap, and disabled behavior.
5. `AnalysisWorkbench.svelte`: authored board ordinal, header title contract,
   compact rail status/bar contract, hint relocation using the existing focus
   key, and unchanged analysis callbacks/focus reconciliation.
6. `presentation.test.ts`: `presentableRecords(inventory)` maps evidence and
   statements once while retaining their exact `kind`/`id` Present payloads.
7. `InterrogationChrome.test.ts`, `InterrogationStageHarness.svelte`, and
   `page.test.ts`: update the frozen chrome contract, the Case File callback
   signature, and the route assertion that objective/evidence sections are
   selected before their existing Case File request.

### Packaged E2E contract

Extend the existing `apps/game/e2e-tauri/analysis-beat85.e2e.ts` journey.
Keep its existing viewport-relative geometry assertions and add semantic
desktop assertions for the new hooks and visual structure:

- three menu-only stage toolbar controls and the two-digit evidence count;
- no stage-right toolbar during testimony or Present, while testimony retains
  DialogueBox's LOG;
- a derived broken-progress meter with a valid progress ratio;
- five desktop evidence-grid columns and a separate detail panel;
- visible tray Escape control;
- Analysis board ordinal, 22px desktop title styling, footer hint, and the
  compact rail status/bar structure.

During stable states, use an exact CSS viewport helper rather than the current
at-least `ensureCaseFileViewport()` helper for capture. A capture step must
assert its requested `innerWidth` and `innerHeight` before saving; if the
native window cannot reach that CSS viewport, fail with the observed dimensions
instead of uploading a misleading image. Save each PNG with
`browser.saveScreenshot` to `LYRA_E2E_OUTPUT_DIR`, verify the resulting file
exists and has non-zero size, and retain the actual CSS viewport in its name.
Capture:

1. Analysis Classify at 1280x720;
2. Interrogation menu at 1280x720;
3. testimony with rebut control at 1280x720;
4. Present tray at 1280x720;
5. testimony at 1280x800.

Layout assertions remain relative so normal CI stays portable. PR visual
review requires the exact target-size captures and compares them side-by-side
with `ui_mock/` using this explicit checklist:

1. The interrogation menu has three distinct native controls: `LOG`,
   `案件檔案`, and `證物櫃 NN`; the locker count is the two-digit evidence
   count.
2. The stage-right toolbar is absent during testimony and Present; testimony
   exposes DialogueBox's existing LOG control.
3. The subject-meter fill equals `broken / total` and exposes the same values
   semantically.
4. Present has a five-column desktop tile grid, a separate detail panel, and
   a visible ESC control; tile activation stays immediate.
5. Analysis shows `Board N / Total`, a 22px board title, and its hint in the
   footer rather than the header.
6. Each Analysis rail entry shows a label, compact status, and thin bar, but
   not a kind label or a separate `進度 X / Y` row.

No screenshot baseline or pixel-diff assertion is added.

### Implementation order

1. Extract the shared history-overlay host and retain all existing DialogueBox
   history tests before adding the menu LOG.
2. Split the menu-only stage HUD and Case File section callback, updating the
   harness, chrome test, and route test together.
3. Add the pure Present-record mapper, then reshape the tray without changing
   its direct engine callbacks or top-layer behavior.
4. Apply the Analysis ordinal, compact rail, title, and hint relocation.
5. Extend the existing packaged `analysis-beat85` journey with semantic checks
   and exact-size capture artifacts.

### Required verification

Run the focused component/presentation tests during each slice. Before local
completion, run:

```sh
bun run --cwd apps/game check:e2e
node apps/game/scripts/build-e2e.mjs
node apps/game/scripts/run-save-e2e.mjs --suite analysis-beat85
bun run check
bun run test
bun run lint:all
```

The CI/merge gate runs the risk-selected E2E chain, including
`analysis-beat85` for this surface. `bun run test:e2e` remains the explicit
full-registry gate when CI selection or release validation requires it; it is
not a mandatory second local repetition of the focused journey. The final
review must inspect the five emitted screenshots and confirm the checklist
above before calling the work complete.

## Expected implementation surface

- Create `apps/game/src/lib/components/DialogueHistoryOverlay.svelte`
- Create `apps/game/src/lib/components/DialogueHistoryOverlay.test.ts`
- Modify `apps/game/src/routes/+page.svelte`
- Modify `apps/game/src/routes/page.test.ts`
- Modify `apps/game/src/lib/components/DialogueBox.svelte`
- Modify `apps/game/src/lib/components/DialogueBox.test.ts`
- Modify `apps/game/src/lib/components/InterrogationStage.svelte`
- Modify `apps/game/src/lib/components/InterrogationStage.test.ts`
- Modify `apps/game/src/lib/test-harnesses/InterrogationStageHarness.svelte`
- Modify `apps/game/src/lib/components/InterrogationChrome.test.ts`
- Modify `apps/game/src/lib/components/InterrogationEvidenceTray.svelte`
- Modify `apps/game/src/lib/components/InterrogationEvidenceTray.test.ts`
- Modify `apps/game/src/lib/interrogation/presentation.ts`
- Modify `apps/game/src/lib/interrogation/presentation.test.ts`
- Modify `apps/game/src/lib/components/analysis/AnalysisWorkbench.svelte`
- Modify `apps/game/src/lib/components/analysis/AnalysisWorkbench.test.ts`
- Modify `apps/game/e2e-tauri/analysis-beat85.e2e.ts`

No generated resources, Rust files, scene sources, or Case File model files
change.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| History refactor changes Escape/focus behavior | Keep current focus cases as explicit component tests and use one shared overlay host. |
| Case File access closes Present | Reuse the existing Case File request/top-layer path and preserve the tray's top-layer suspension test. |
| Five compact tiles clip a larger inventory | Keep the list scrollable after additional rows while preserving five columns at the desktop target. |
| Capture artifact has the wrong viewport or is missing | Assert exact CSS dimensions and non-empty output files before the PR visual review. |
| Visual drift passes geometry assertions | Add semantic structure assertions, an explicit visual checklist, and target-size screenshot artifacts for required PR review. |
| Analysis hint becomes inaccessible after header cleanup | Move, rather than remove, the control and keep its existing test coverage. |
