# Interrogation Scene Redesign

**Date:** 2026-08-14  
**Status:** Approved design; implementation pending

## Goal

Rebuild the interrogation scene's frontend presentation around the supplied
`lyra-interrogation-scene-redesign` prototype while preserving Lyra's current
interrogation engine, authored-scene schema, save format, and gameplay rules.

The result should make the menu, testimony, challenge, and evidence-selection
states feel like one continuous interrogation experience: a witness-focused
stage, a centered case-record panel, a deliberate large `反駁` affordance, and
an inventory-backed evidence tray.

## Scope and non-goals

In scope:

- The Svelte presentation for interrogation menus, cross-examination
  testimony, presenting evidence, and read-only evidence browsing.
- Reusing the prototype's dark rain-soaked record-panel visual language,
  interaction hierarchy, spacing, motion, and responsive intent.
- Current inventory data for evidence and statements, including their existing
  names, descriptions/content, details, and optional image assets.
- A best-effort witness standee derived from the current `subject.id`, with a
  graceful no-image fallback.

Out of scope:

- Rust engine changes, Tauri commands, save migrations, compiler changes, or
  authored Markdown/schema changes.
- New persisted mechanics such as a composure meter, mistake counter, or
  outcome state.
- Invented evidence metadata, witness data, artwork, or a frontend-derived
  determination of whether a presented item is correct.
- Replacing the existing GameShell, case-file menu, dialogue history, or
  engine-owned dialogue feedback.

## Existing contract to preserve

The runtime retains ownership of all semantic interrogation state and actions:

| Runtime concept | Existing frontend input/action | Redesign responsibility |
| --- | --- | --- |
| Current phase, subject, questions, completion eligibility | `SceneView` interrogation arm | Render the phase record and derive visual question progress. |
| Testimony line and active challenge target | dialogue `Mode` plus `crossExamLineId` / `CrossExamView` | Render the testimony record and challenge affordance. |
| Start a question | `onAsk(questionId)` | Retain the existing callback. |
| Challenge a live testimony line | `onChallenge(lineId)` | Retain the existing callback; only change its visual trigger. |
| Enter evidence presentation | Existing challenge transition | Display the existing presenting state, not a new client state. |
| Submit evidence or a statement | `onPresent(lineId, kind, itemId)` | Use the existing callback and disable controls while in flight. |
| Leave evidence presentation | `onResume()` | Retain the existing callback. |
| Correct/wrong response | Engine-authored dialogue after the action | Render the engine's next state; do not infer an outcome. |

The prototype's composure meter is intentionally replaced with a derived
progress display: broken visible questions divided by total visible questions.
This remains accurate without adding a fake gameplay variable.

## Architecture

### `InterrogationStage`

Introduce a frontend-only stage component that wraps the interrogation
experience whenever either of these existing states is active:

1. `scene.kind === "interrogation"` and `mode.type === "interrogation"`.
2. `scene.kind === "interrogation"`, `mode.type === "dialogue"`, and
   `mode.crossExamLineId !== null`.

The stage is a visual scaffold, not a state machine. It owns only transient UI
state:

- Whether a read-only evidence tray is open.
- The focus origin to restore after that tray closes.
- Best-effort standee resolution/loading state.

It renders the persistent visual elements shared by both modes:

- Existing scene background, without duplicating the backdrop asset pipeline.
- Dark record-panel/rain/halftone/vignette treatment that respects reduced
  motion.
- Active primary objective, witness name/role, phase identifier, and derived
  progress.
- An optional evidence-browse HUD control.
- A witness standee resolved from `standee.<subject.id>.standard`; missing
  assets leave the atmospheric frame intact and do not render a broken image.

The page remains responsible for selecting the mode-specific child and passes
the current game state/actions through unchanged:

- In phase/presenting mode: `InterrogationView`.
- In cross-examination dialogue mode: `DialogueBox` with an explicit optional
  interrogation-presentation variant.

### `InterrogationEvidenceTray`

Extract the visual evidence tray into a shared presentational component.

- `browse` mode is opened from the stage HUD and allows inspection only.
- `present` mode receives the target line and current `onPresent` / `onResume`
  callbacks, so its cards submit the same current engine commands.
- Evidence cards show current `name`, `description`, `details`, and an optional
  resolved thumbnail from `imageAssetId`.
- Statement cards show current speaker/content and use the established
  statement marker when they have no image asset.
- Hover and keyboard focus populate the detail region. No source location or
  lore is fabricated when the live data does not provide it.

### Existing component changes

`InterrogationView` keeps its public callback contract. Its phase menu becomes
the prototype's bottom-centered `訊問記錄` panel and it delegates presenting
selection to `InterrogationEvidenceTray`.

`DialogueBox` keeps its normal appearance for ordinary dialogue. Its optional
cross-examination path receives the redesigned testimony presentation: record
frame, speaker/line-progress treatment, and the large challenge ring. It does
not receive ownership of the inventory or outcome logic.

## Interaction design

### Phase record

- Questions render as a responsive two-column record grid on desktop and a
  single column at the existing 720px compact breakpoint.
- Unbroken questions are visibly actionable; broken questions remain readable
  but use the subdued `已破` treatment.
- `完成訊問` retains the runtime's `canComplete` gate and the existing disabled
  behavior.

### Testimony and challenge

- The active testimony is centered in a large record panel with speaker and
  cross-examination line progress.
- The challenge control is a real button rendered as the prototype's oversized
  crimson ring.
- Pointer input must hold the button briefly before invoking the existing
  `onChallenge`. Releasing early cancels the visual charge without a command.
- Keyboard `Enter`/`Space` invokes the existing challenge directly. This keeps
  the control usable without an imprecise hold gesture and preserves native
  button semantics.
- The existing withdraw action remains present as a secondary control.

### Evidence browsing and presentation

- The stage HUD opens a read-only evidence tray while the player is reviewing
  a phase or listening to testimony.
- When the engine moves to its existing `presenting` state, the tray changes to
  `呈上證物`, displays the live target testimony line, and enables the existing
  evidence/statement selection callbacks.
- Closing the presenting tray calls `onResume`, returning control to the
  engine's testimony flow. Closing the read-only tray changes no game state.
- Correct and incorrect feedback continue through authored runtime dialogue;
  no client-side stamp or reaction is shown based only on a submitted item.

## Accessibility and resilience

- The evidence tray is a labelled modal dialog with initial focus, a focus
  trap, Escape support, and focus restoration to its trigger.
- The stage's evidence HUD and challenge ring are native buttons. Existing
  native disabled states remain in force whenever `gameState.inFlight` is true.
- Decorative backdrop, rain, and standee layers are hidden from assistive
  technology. Meaningful witness/objective text remains semantic text.
- All new animation honors `prefers-reduced-motion`.
- Missing standees/thumbnails use established visual fallbacks; a missing asset
  never leaves an empty broken-image control.
- The existing explicit no-current-phase message remains available rather than
  showing an unlabelled empty interrogation stage.

## Verification plan

Focused component tests will cover:

1. Phase record question states, derived progress, and completion gating.
2. Evidence browse and present modes, including evidence and statement callback
   arguments.
3. Tray keyboard navigation, Escape behavior, focus trapping, and focus return.
4. Pointer hold cancellation/completion and keyboard challenge activation.
5. Disabled/in-flight behavior across question, challenge, and tray controls.
6. Missing-art fallbacks and the no-current-phase state.
7. The 720px compact layout contract where feasible through component/CSS
   assertions.

Before completion, run the focused component tests, Svelte autofixer for every
edited Svelte component, and `bun run check`. Broader visual/runtime smoke
coverage will be selected once the concrete implementation plan identifies
the changed surface.

## Expected implementation surface

- `apps/game/src/routes/+page.svelte`
- `apps/game/src/lib/components/InterrogationStage.svelte` (new)
- `apps/game/src/lib/components/InterrogationEvidenceTray.svelte` (new)
- `apps/game/src/lib/components/InterrogationView.svelte`
- `apps/game/src/lib/components/DialogueBox.svelte`
- Focused Svelte component tests for the new/changed presentation components

No Rust, compiler, authored scene, generated-resource, or save files are
expected to change.
