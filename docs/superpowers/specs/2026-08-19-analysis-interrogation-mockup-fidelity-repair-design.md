# Analysis and Interrogation Mockup Fidelity Repair Design

**Date:** 2026-08-19  
**Status:** Approved design — awaiting implementation-plan review  
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

1. Match the mock's remaining desktop visual hierarchy at 1280x720 and
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
  board entries, and the existing aggregate progress at the bottom. Retain
  semantic board states and accessible progress labels while removing the
  visually noisy per-entry metadata that the mock does not show.

### Interrogation stage toolbar

At desktop size, render three separate buttons at the stage's top-right:

| Control | Production destination | Accessible behavior |
| --- | --- | --- |
| `LOG` | existing dialogue history | opens the shared history overlay |
| `案件檔案` | existing Case File objective section | opens GameShell Case File and returns focus to its trigger |
| `證物櫃 NN` | existing Case File evidence section | `NN` equals `inventory.evidence.length`; opens Case File evidence |

The controls are individual buttons, not two visual fragments of one button.
They remain visible in interrogation menu and testimony states. Opening either
Case File control keeps the current interrogation/Present state intact under
the existing top-layer behavior.

The lower-left subject card retains subject name and role. Its mock-shaped
meter derives from `brokenQuestionProgress(phase)`:

- visual fill is derived only from `broken / total`;
- accessible text reports the authoritative `已突破 X / Y 題` value;
- it does not introduce a new composure field, mutation, or result rule.

### History overlay

The mock's stage `LOG` must reuse the same dialogue history model as the
existing in-frame `DialogueBox` button. One route-owned controller governs
both launchers:

- `+page.svelte` owns the open request, return-focus target, fallback-focus
  target, and requested panel bottom offset.
- A new `DialogueHistoryOverlay.svelte` renders the existing
  `DialogueHistoryPanel`, claims Escape while mounted, and restores focus on
  close.
- `DialogueBox.svelte` becomes a controlled launcher for history. Its normal
  `L` shortcut stays local to dialogue and retains the current Escape-close
  fallback to the advance button.
- `InterrogationStage.svelte` launches the same overlay from its toolbar. A
  stage-origin close restores focus to the stage `LOG` button.
- The stage toolbar does not add a new global `L` shortcut during the
  interrogation menu.

This prevents separate history overlays from diverging in content, Escape
priority, focus trapping, or accessibility behavior.

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

Evidence and statements are normalized only for display inside the component;
their existing `InventoryTarget` kind/id values remain the direct callback
payload.

## Component and data-flow design

### `+page.svelte`

Add route-local history-overlay request state:

```ts
type DialogueHistoryRequest = {
  returnFocusTo: HTMLElement | null;
  fallbackFocusTo: HTMLElement | null;
  panelBottom: number;
};
```

The route renders one `DialogueHistoryOverlay` when a request is active and
passes the current `gameState.value.dialogueHistory` to it. Closing clears the
request. The route also changes the existing Interrogation Case File callback
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

Own only overlay presentation and lifecycle: backdrop, `DialogueHistoryPanel`,
Escape claim, close callback, and safe focus restoration. It consumes the
route request and does not own or mutate dialogue history.

### `DialogueBox.svelte`

Replace its private history-panel mounting with controlled history props and
request callbacks. Preserve all current ordinary-dialogue behavior:

- the in-frame `LOG` button remains;
- `L` opens/closes history only while a dialogue surface owns the shortcut;
- dialogue controls remain inert while the shared overlay is open;
- Escape-close still favors the advance button to avoid the Space-reopens-LOG
  regression;
- the current wrapper measurement continues to supply the panel's bottom
  offset.

### `InterrogationStage.svelte`

Add stable controls and callbacks for the three toolbar actions. It receives
the controlled history state and request callback, passes the correct Case
File section to the route, and derives the evidence count and meter from its
existing `inventory` and `progress` values. It remains a presentation
container, not an interrogation state machine.

Use stable hooks:

- `data-interrogation-stage-log`
- `data-interrogation-case-file-objective`
- `data-interrogation-evidence-locker`
- `data-interrogation-composure`

### `InterrogationEvidenceTray.svelte`

Add one display-normalized record list and transient focused/hovered record
identity. Keep the engine-facing `present(kind, id)` function unchanged.

Use stable hooks:

- `data-interrogation-evidence-grid`
- `data-interrogation-evidence-detail`
- `data-interrogation-tray-escape`

### `AnalysisWorkbench.svelte`

Derive the board ordinal from the authored visible-board order, independent
of `railBoards`. Restructure only visual containers and CSS; retain current
selection, reconciliation, draft, pointer, keyboard, read-only, undo, reset,
submit, feedback, and relative-navigation behavior.

Use stable hooks:

- `data-analysis-board-position`
- `data-analysis-hint-control`

## Accessibility and responsive requirements

- Every toolbar and tray control is a native button with a meaningful name.
- The composure meter has an accessible authoritative progress description.
- The detail panel updates on both pointer hover and keyboard focus.
- The tray's existing Tab trap suspends under Game Menu/Case File and resumes
  after the upper layer closes.
- Escape always closes only the current topmost layer.
- At narrow widths, stage toolbar controls may wrap and evidence tiles may
  reduce columns, but no action becomes hidden or unreachable.
- `prefers-reduced-motion` behavior remains unchanged.

## Verification strategy

### Focused component tests

Add or update tests for:

1. `DialogueHistoryOverlay.svelte`: Escape claim, closing behavior, and
   origin-specific focus restoration.
2. `DialogueBox.svelte`: controlled history requests, existing `L` behavior,
   in-frame `LOG`, wrapper inertness, and advance-button focus restoration.
3. `InterrogationStage.svelte`: exactly three distinct toolbar controls,
   objective/evidence Case File routing, dynamic evidence count, and derived
   meter semantics.
4. `InterrogationEvidenceTray.svelte`: fixed-grid hook, focus/hover detail
   content, direct Present callback, visible `ESC` using `onResume`, Game
   Menu without resume, focus trap, and disabled behavior.
5. `AnalysisWorkbench.svelte`: authored board ordinal, header title contract,
   hint relocation, and unchanged analysis callbacks/focus reconciliation.

### Packaged E2E contract

Extend the existing `apps/game/e2e-tauri/analysis-beat85.e2e.ts` journey.
Keep its existing viewport-relative geometry assertions and add semantic
desktop assertions for the new hooks and visual structure:

- three stage toolbar controls and the evidence count;
- a derived meter with a valid progress ratio;
- five desktop evidence-grid columns and a separate detail panel;
- visible tray Escape control;
- Analysis board ordinal and 22px desktop title styling.

During stable states, save PNG captures to `LYRA_E2E_OUTPUT_DIR`, which the
existing runner already retains as an artifact. Capture:

1. Analysis Classify at 1280x720;
2. Interrogation menu at 1280x720;
3. testimony with rebut control at 1280x720;
4. Present tray at 1280x720;
5. testimony at 1280x800.

The test must record the actual CSS viewport beside the capture names. Layout
assertions remain relative so CI stays portable; PR visual review requires the
target-size captures and compares them side-by-side with `ui_mock/`.

No screenshot baseline or pixel-diff assertion is added.

### Required verification

Run focused component tests first, then:

```sh
bun run --cwd apps/game check:e2e
node apps/game/scripts/build-e2e.mjs
node apps/game/scripts/run-save-e2e.mjs --suite analysis-beat85
bun run check
bun run test
bun run lint:all
bun run test:e2e
```

The final review must inspect the five emitted screenshots and confirm the
mock-specific visual checklist before calling the work complete.

## Expected implementation surface

- Create `apps/game/src/lib/components/DialogueHistoryOverlay.svelte`
- Create `apps/game/src/lib/components/DialogueHistoryOverlay.test.ts`
- Modify `apps/game/src/routes/+page.svelte`
- Modify `apps/game/src/lib/components/DialogueBox.svelte`
- Modify `apps/game/src/lib/components/DialogueBox.test.ts`
- Modify `apps/game/src/lib/components/InterrogationStage.svelte`
- Modify `apps/game/src/lib/components/InterrogationStage.test.ts`
- Modify `apps/game/src/lib/components/InterrogationEvidenceTray.svelte`
- Modify `apps/game/src/lib/components/InterrogationEvidenceTray.test.ts`
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
| Visual drift passes geometry assertions | Add semantic structure assertions and retain target-size screenshot artifacts for required PR review. |
| Analysis hint becomes inaccessible after header cleanup | Move, rather than remove, the control and keep its existing test coverage. |
