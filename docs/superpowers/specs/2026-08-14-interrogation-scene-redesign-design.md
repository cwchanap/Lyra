# Interrogation Scene Redesign

**Date:** 2026-08-14  
**Status:** Implemented

## Goal

Revamp interrogation presentation around the supplied
lyra-interrogation-scene-redesign prototype while preserving Lyra's existing
interrogation engine, authored-scene schema, save format, and gameplay rules.

The phase menu, testimony, challenge, evidence presentation, and case-file
access should feel like one continuous interrogation: a subject-focused record
stage, centered case-record panels, a deliberate large 反駁 affordance, and
current inventory data.

## Scope and non-goals

In scope:

- Svelte presentation for interrogation phase menus, cross-examination
  testimony, and engine-owned evidence presentation.
- The prototype's record-panel hierarchy, spacing, motion, responsive intent,
  and dark rain-soaked language while reusing existing game chrome.
- Existing GameAtmosphere, SceneBackdrop, GameShell, PrimaryObjectiveHud,
  CaseFilePanel, story-asset resolver, and escape coordinator at their current
  ownership boundaries.
- Current evidence and statement data: names, descriptions/content, details,
  optional image assets, and current case-file navigation.
- A subject name/role/phase/progress frame derived entirely from current
  interrogation data.

Out of scope:

- Rust, Tauri commands, saves, compiler, authored Markdown, or schema changes.
- New generated raster art, standee assets, or subject-to-character mappings.
- New persisted composure, mistake, or outcome mechanics.
- Invented evidence metadata, witness data, artwork, or client-derived
  correctness.
- Replacing GameShell, the case-file menu, dialogue history, the dialogue
  queue/typewriter, or engine-authored feedback.
- A second backdrop or atmospheric-effects system.

A future asset-backed witness stage is a separate slice. It must have supplied
subject art and a compiler-owned, manifest-visible subject-to-character asset
reference; a frontend alias table or renamed subject anchor alone is not an
adequate contract.

## Existing contract to preserve

| Runtime concept | Existing frontend input/action | Redesign responsibility |
| --- | --- | --- |
| Current phase, subject, questions, completion eligibility | SceneView interrogation arm | Render the phase record and derived progress. |
| Testimony line and challenge target | dialogue Mode plus crossExamLineId / CrossExamView | Render testimony and challenge presentation. |
| Start a question | onAsk(questionId) | Retain the callback. |
| Challenge a live testimony line | onChallenge(lineId) | Retain the callback; change its visual trigger only. |
| Enter evidence presentation | Existing challenge transition | Display engine-owned presenting state. |
| Submit evidence or statement | onPresent(lineId, kind, itemId) | Retain the callback and disabled semantics. |
| Leave presentation | onResume() | Retain the callback. |
| Leave a testimony | onWithdraw() | Retain the callback and the current 退下 action. |
| Correct/wrong response | Engine-authored dialogue | Render the next state; infer no outcome. |

The prototype's composure meter is replaced with derived progress: broken visible
questions divided by total visible questions.

## Architecture

### Stage lifetime and the single mode chain

InterrogationStage is always mounted around the existing single mode-children
chain in +page.svelte. It receives active={isInterrogationStage}, its children
snippet, and the current state/actions.

~~~ts
scene.kind === "interrogation" &&
  (mode.type === "interrogation" ||
    (mode.type === "dialogue" && mode.crossExamLineId !== null))
~~~

The active flag controls the stage chrome and evidence-presentation overlay.
The existing exclusive mode chain still chooses the scene child, so there is
one DialogueBox call site for ordinary and cross-examination dialogue:

- In active interrogation phase or presenting state, it renders
  InterrogationView.
- In active cross-examination dialogue, the same DialogueBox receives an
  optional interrogation-presentation input.
- When inactive, the same DialogueBox remains ordinary for intro, correct,
  wrong, and other dialogue where crossExamLineId is null.

The wrapper clears its transient state whenever active becomes false or the
scene changes. Its component identity remains stable through the engine's
dialogue-to-presenting-to-dialogue flip.

SceneBackdrop stays inside that existing mode chain and renders once for the
active mode. The stage never mounts another backdrop.

### Existing shell and atmosphere

GameAtmosphere remains mounted once in GameShell. InterrogationStage adds
record-panel and subject layers only; it does not recreate rain, halftone,
vignette, scan, or other atmosphere.

The page passes isInterrogationStage to GameShell as an
interrogation-presentation flag. In that mode, GameShell hides normal chapter
FILE/title/summary/rule chrome so it cannot stack above the scene. GameShell
keeps exactly one existing PrimaryObjectiveHud in a compact interrogation
placement. InterrogationStage renders subject/phase/progress chrome and never
receives or re-renders objective text.

### InterrogationStage

InterrogationStage is a visual scaffold, not an interrogation state machine. It
owns:

- Subject name, role, phase label, and derived broken-question progress.
- The evidence HUD trigger.
- The single InterrogationEvidenceTray while the engine is presenting evidence.
- Transient focus bookkeeping for that present tray.

It derives the current phase and CrossExamView from live SceneView.
crossExamLineId identifies the engine target only; lineIndex and lineTotal
always come from CrossExamView.

Pure display helpers live in apps/game/src/lib/interrogation/presentation.ts,
alongside other domain display models rather than in the components directory.
They provide the visible-question fraction and text formed from line/action
DialogueItems, allowing those rules to be unit-tested without a component.

There is intentionally no subject standee layer in this slice. Current shipped
interrogation subjects have no matching standee art, and a silent no-image
fallback would leave the central presentation hollow.

### Evidence access and the present tray

Read-only browsing reuses the existing CaseFilePanel rather than adding a
second record browser. The stage's evidence HUD asks +page.svelte to open the
existing GameShell Case File directly to the evidence section. GameShell owns
the menu/dialog, focus return, Escape routing, CaseFilePanel state, and
re-examination capability; the player can switch to the existing statements
section there.

The direct case-file request travels through GameShell's existing menu-opening
and submenu-opening paths, preserving its focus-origin and one-layer Escape
semantics. It must not mount a second CaseFilePanel inside the stage.

InterrogationEvidenceTray has one state: engine Present. InterrogationStage
mounts it only while CrossExamView.presenting is true and supplies live
inventory, active CrossExamView, onPresent, onResume, and disabled state. It
shows the target testimony line and submits existing evidence/statement
callbacks.

Evidence cards use current name, description, details, and imageAssetId.
Statement cards use current speaker/content and the established statement
marker. The present tray may use the established story-asset fallback for
evidence thumbnails, but it does not become a second case-file browse surface.

InterrogationView therefore becomes phase record only: question buttons and the
runtime-gated 完成訊問 control. It no longer owns inventory, evidence selection,
or resume behaviour.

### Mode-specific children and compatibility anchors

InterrogationView receives scene, onAsk, onComplete, and disabled state. It
becomes the prototype-inspired bottom-centered 訊問記錄: responsive question
grid, broken state, and completion control.

DialogueBox retains current, queueToken, typewriter, advance, LOG/history, and
engine feedback behaviour. Its optional cross-examination presentation receives
the actual CrossExamView for progress plus existing onChallenge and onWithdraw
callbacks. It changes testimony presentation only; it owns neither inventory
nor outcomes and never becomes another state machine.

The component's existing actions retain distinct meanings:

| Location | Label | Callback |
| --- | --- | --- |
| DialogueBox live testimony | 反駁 | onChallenge(lineId) |
| DialogueBox live testimony | 退下 | onWithdraw() |
| InterrogationEvidenceTray Present | 收回 | onResume() |
| InterrogationEvidenceTray Present | 遊戲選單 | onOpenGameMenu(trigger) |

The xexam-challenge class and visible 反駁 label remain packaged-E2E
compatibility anchors. The present tray auto-mounts solely from engine
presenting state, including a restored save, and its 收回 control remains the
unambiguous resume action used by the packaged save-resume path.

The Present tray's 遊戲選單 action calls `onOpenGameMenu(trigger)` with the
button element as the focus-return trigger. Opening the game menu this way
does **not** retract the tray: the engine's presenting state is preserved, the
tray stays mounted, and its Tab trap suspends via `topLayerOpen` while the
Game Menu (or Save Browser) owns keyboard navigation above it. The player
returns from the menu to the still-open Present tray.

## Interaction design

### Phase record

- Questions use a responsive two-column record grid, becoming one column at the
  existing 720px compact breakpoint.
- Unbroken questions are actionable; broken questions remain readable with the
  subdued 已破 treatment.
- 完成訊問 retains canComplete and existing disabled behaviour.

### Testimony and challenge

- The testimony is centered in a large record panel with speaker and
  CrossExamView line progress.
- The challenge remains a real button styled as the oversized crimson ring.
- Pointer input begins a visual charge on pointerdown. A completed hold calls
  onChallenge exactly once and suppresses its follow-on pointer click.
  Pointerup, pointercancel, or pointerleave before completion cancels the
  charge and suppresses that pointer sequence's click.
- Clicks without a tracked pointer sequence, including keyboard activation,
  assistive-technology activation, and programmatic button.click() used by
  packaged E2E, call onChallenge directly. This preserves native semantics and
  prevents duplicate submission.
- 退下 remains the secondary testimony action and uses unchanged onWithdraw.

### Evidence browsing and presentation

- The HUD opens the existing GameShell Case File at evidence; it does not open
  a new browse modal.
- Engine presenting mounts the stage-owned Present tray with the live target
  line and current evidence/statement callbacks.
- 收回 in that tray calls onResume, returning control to the engine's testimony
  flow.
- 遊戲選單 in that tray calls onOpenGameMenu(trigger), opening the existing
  GameShell game menu above the tray. The tray is not retracted: it stays
  mounted and its Tab trap suspends via topLayerOpen while the menu owns
  navigation, so the player returns to the still-open Present tray on close.
- Correct and incorrect feedback remains engine-authored dialogue; no
  client-side reaction is inferred from a submitted item.

## Accessibility and resilience

- The Present tray is a labelled modal dialog with initial focus and a focus
  trap.
- It claims Escape through claimEscape while mounted, releases that claim on
  close/unmount, and calls onResume before GameShell can open its game menu.
- Focus return reuses AcquisitionPopup's proven pattern: record an optional
  returnFocusTo, reject document.body as a restoration target, and fall back to
  the stage's focusable record root. This covers saves restored directly into
  Present, where there is no initiating HUD trigger.
- New controls are native buttons and retain disabled semantics while
  gameState.inFlight is true.
- Decorative stage and atmosphere layers are hidden from assistive technology;
  subject and objective text stays semantic.
- New animation honours prefers-reduced-motion.
- Missing evidence art uses the established evidence fallback.
- The explicit no-current-phase message remains available.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Mode flip destroys chrome or forks DialogueBox behaviour | Always-mounted stage wrapper, one mode chain, one DialogueBox call site, and a lifecycle test across dialogue and Present. |
| Restored Present has no opening trigger | AcquisitionPopup-style focus fallback plus the existing save-resume packaged test. |
| Pointer hold double-submits or blocks accessibility/E2E | Separate tracked-pointer and click paths; component tests exercise pointer sequences, while packaged E2E verifies the programmatic-click compatibility path. |
| Existing dossier and interrogation UI drift | HUD opens the existing CaseFilePanel; only Present selection cards are new. |
| Missing subject art leaves an empty centerpiece | The standee layer is intentionally excluded. Future art requires its own asset/pipeline slice. |

## Verification plan

Focused tests cover:

1. InterrogationView question states, completion gating, and no-current-phase
   rendering; InterrogationStage derived-progress rendering.
2. DialogueBox's presentation-only cross-exam path: CrossExamView progress,
   xexam-challenge/反駁/退下 compatibility, pointer-hold cancellation/completion,
   and direct keyboard or synthetic click activation.
3. InterrogationStage and InterrogationEvidenceTray: stable lifecycle across
   mode flips, engine-only Present mounting, callback arguments, 收回/onResume,
   focus trapping/restoration with and without an initiating control, and
   Escape claim cleanup.
4. GameShell's interrogation presentation: normal chapter chrome is absent,
   PrimaryObjectiveHud appears exactly once, and the evidence HUD opens the
   existing Case File at evidence.
5. Existing packaged E2E paths: button.xexam-challenge and programmatic 反駁
   compatibility in save-seed and analysis-beat85; Present auto-mount and 收回
   in save-resume.

Before completion, run focused component tests, the Svelte autofixer for every
edited Svelte component, bun run check, and bun run test:e2e.

The packaged suite verifies the synthetic direct-click compatibility branch and
restored Present flow. Component tests are the acceptance evidence for the
real pointer-hold sequence; this distinction is deliberate and explicit.

## Expected implementation surface

- apps/game/src/routes/+page.svelte
- apps/game/src/lib/components/GameShell.svelte
- apps/game/src/lib/components/InterrogationStage.svelte (new)
- apps/game/src/lib/components/InterrogationEvidenceTray.svelte (new, Present
  only)
- apps/game/src/lib/interrogation/presentation.ts (new pure display helpers)
- apps/game/src/lib/components/InterrogationView.svelte
- apps/game/src/lib/components/DialogueBox.svelte
- Focused tests for the new components/helpers plus changed InterrogationView,
  DialogueBox, and GameShell tests

No Rust, compiler, authored scene, generated-resource, raster asset, save, or
packaged E2E selector files are expected to change.
