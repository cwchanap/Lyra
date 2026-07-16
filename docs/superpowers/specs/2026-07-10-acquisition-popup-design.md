# Acquisition Popup Design

**Date:** 2026-07-10
**Status:** Approved design (amended 2026-07-15 — see "Popup Timing
Amendment" below)

## Summary

When a successful gameplay command adds evidence or a statement to the
player's inventory, Lyra will pause gameplay and show a blocking acquisition
popup. Each newly acquired item gets its own popup. The player dismisses items
one at a time with the Continue button, Enter, Space, or Escape; gameplay
resumes only after the queue is empty.

The feature is frontend-only. It derives acquisitions by comparing the
previous and next `GameStateView` inventories at the existing successful
command boundary. It does not change Rust engine state, the Tauri wire
contract, authored scene Markdown, the compiler, or asset catalogs.

## Goals

- Make newly acquired evidence and statements impossible to miss.
- Present acquisitions consistently across investigation and interrogation.
- Show the popup after the acquisition command's authored `On Collect`/`On
  Acquire` dialogue queue drains, so the player experiences the narrative
  context before the mechanical notification interrupts. (Amended 2026-07-15;
  see "Popup Timing Amendment" below.)
- Support multiple acquisitions from one command without dropping or merging
  items.
- Preserve Lyra's existing inventory, dialogue, audio, keyboard, focus, and
  Escape-layer contracts.

## Non-goals

- Changing how or when the Rust engine grants inventory items.
- Adding a persisted acquisition-event history to `GameStateView`.
- Changing `On Collect`, `On Acquire`, re-examination, or dialogue-history
  semantics.
- Adding new sound assets or playback rules.
- Generating evidence art or statement art.
- Showing acquisition popups while hydrating an already-existing state.

## Existing Constraints

The Rust engine owns inventory mutation. Reveal processing can add more than
one item during a single command and immediately appends authored `On Collect`
or `On Acquire` dialogue to the resulting queue. The frontend receives a full
`GameStateView` after every successful gameplay command.

Evidence and statements are serialized in separate arrays. The frontend can
preserve order within each array but cannot reconstruct an authored ordering
that interleaves evidence and statements. This design therefore uses the
deterministic order described below.

Lyra already has an Escape coordinator: overlays claim Escape while open, and
`GameShell` closes only the topmost claim. The acquisition popup must use this
contract so Escape acknowledges one acquisition instead of opening the game
menu.

## Chosen Approach

### Frontend inventory-diff queue

After a successful gameplay command returns:

1. Capture the previous and next `GameStateView` values.
2. Find evidence IDs present only in the next inventory.
3. Find statement IDs present only in the next inventory.
4. Convert the new records into acquisition notifications.
5. Commit the next game state. If the returned mode is dialogue, buffer the
   notifications in a pending queue (they will be flushed when the dialogue
   queue exhausts). Otherwise, enqueue them into the acquisition controller
   synchronously, before the browser's next paint.

The detector treats a missing previous state as baseline hydration and emits
nothing. Inventory removals, reset results, and duplicate records also emit
nothing.

When one command grants both kinds, new evidence appears first in next-state
array order, followed by new statements in next-state array order. Subsequent
commands append to an already-open queue rather than replacing it.

### Alternatives not chosen

- **Explicit Rust acquisition events:** authoritative across item kinds, but it
  requires event identity/consumption semantics and expands every relevant IPC
  response.
- **Special dialogue queue items:** naturally ordered, but it mixes transient
  UI notifications into narrative queues and complicates dialogue history and
  advancement semantics.

## Components and Responsibilities

### Acquisition detector

A pure TypeScript function accepts previous and next `GameStateView` values and
returns an ordered array of a discriminated notification type:

- evidence notification carrying the complete `EvidenceRecord`, or
- statement notification carrying the complete `StatementRecord`.

It has no Svelte state, rendering, IPC, or asset-resolution responsibility.

### Acquisition controller

A small Svelte-state controller owns:

- the pending notification queue,
- the current notification,
- whether gameplay is blocked,
- enqueue, dismiss-current, and clear operations.

Each notification has a stable key composed from its kind and inventory ID.
`dismissCurrent(expectedKey)` removes the queue head only when that key still
matches. Delayed or repeated callbacks from the previous popup therefore
cannot dismiss the next item.

### `AcquisitionPopup.svelte`

The popup is presentational. It receives the current notification and an
`onContinue` callback. It owns asset resolution, modal focus, focus trapping,
Escape claiming, and keyboard-safe dismissal. It does not call Tauri commands
or mutate inventory.

### Page integration

`+page.svelte` mounts one acquisition-popup layer outside the gameplay
container so every gameplay mode shares it. While a notification is active,
the gameplay container is inert and the modal scrim sits above all scene,
dialogue, interrogation, HUD, and menu layers.

## Data and Interaction Flow

1. The player performs a normal gameplay action.
2. Rust mutates inventory, prepares any resulting `On Collect`/`On Acquire`
   dialogue, and returns the next `GameStateView`.
3. The game client detects newly added inventory records, commits the returned
   state, and — if the returned mode is dialogue — **buffers** the
   notifications in a pending queue rather than enqueuing them immediately.
   If the returned mode is not dialogue, notifications are enqueued
   immediately (there is no authored dialogue to drain first).
4. Svelte's next paint shows the returned scene/dialogue. The player advances
   the authored acquisition dialogue normally.
5. When the dialogue queue exhausts (detected via a `queueToken` scene-id or
   queue-gen transition, or a mode change out of dialogue), the game client
   flushes the pending buffer into the acquisition controller.
6. Svelte's next paint shows the first popup over the now-settled scene.
7. The player activates Continue, Enter, Space, or Escape.
8. Exactly one notification is removed. If another remains, its content
   replaces the first popup and Continue receives focus again.
9. When the queue becomes empty, the modal unmounts, gameplay stops being
   inert, and focus returns to the control that was active before the first
   popup.

The modal backdrop does not dismiss the popup. It prevents pointer input from
reaching gameplay but forces a deliberate acknowledgement through the approved
controls.

## Presentation

The popup follows Lyra's dark dossier aesthetic: a dim full-screen scrim and a
centered, bordered card with restrained crimson/cyan accents.

### Evidence

- Eyebrow: `EVIDENCE ACQUIRED`
- Heading: `物證取得`
- Resolved evidence image in a square frame
- Evidence name
- Evidence `description`; `details` are reserved for the inventory view
- Button: `CONTINUE / 繼續`

When `imageAssetId` is present, evidence images use the existing story-asset
resolver. A null ID uses `placeholderForStoryAsset("evidence")`; a resolution
or browser-load failure uses the existing missing-asset placeholder path. No
image condition delays or blocks the modal.

### Statement

- Eyebrow: `STATEMENT ACQUIRED`
- Heading: `證言取得`
- CSS-rendered document/seal treatment; no new raster asset
- Speaker name
- Statement `content`
- Button: `CONTINUE / 繼續`

Statement content is not semantically truncated. If unusually long content
does not fit the card, the text region scrolls while Continue remains visible.

### Responsive and motion behavior

Desktop uses a visual-and-text two-column card. Narrow screens stack the visual
above the text and keep the action visible. Opening uses a 180 ms opacity and
scale transition. Under `prefers-reduced-motion: reduce`, the popup appears and
changes items without animation.

Existing gameplay audio behavior remains unchanged.

## Accessibility and Input Layering

- The card uses `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, and
  `aria-describedby`.
- Continue receives focus after the popup mounts and whenever the current item
  changes.
- A capture-phase window listener intercepts Enter, Space, Tab, and Shift+Tab
  so dismissal and focus trapping work even if focus escapes the modal.
  Continue is the only interactive control in this scope.
- The popup claims Escape through the existing coordinator. Escape dismisses
  one item and cannot open or close the game menu in the same keypress.
- The Escape claim is released synchronously on dismissal and through effect
  cleanup on unmount.
- Underlying gameplay is inert, so pointer, focus, and assistive-technology
  navigation cannot activate it while the popup is open.
- After the last item closes, focus restoration occurs after the inert state is
  removed and only if the previously focused element is still connected.

## Lifecycle and Failure Handling

- Failed commands do not commit state and do not enqueue or buffer
  notifications.
- Duplicate inventory items do not enqueue because they are not additions.
- Removal-only and reset state transitions do not enqueue.
- Initial hydration with no previous state establishes a baseline and does not
  replay the full inventory.
- When a command returns dialogue, notifications are buffered in a pending
  queue and flushed only when that dialogue queue exhausts (detected via a
  `queueToken` scene-id or queue-gen transition, or a mode change out of
  dialogue). A subsequent non-advance command that exits dialogue also
  flushes the pending buffer before inferring new notifications, preserving
  earned order.
- Returning to the main menu, resetting the game, or unmounting gameplay
  clears pending notifications. Navigation commands (`start_game`,
  `reset_game`, `jump_to_scene`) clear the pending buffer and the
  acquisition controller only after the navigation command succeeds; if the
  command fails, the buffer is restored so the player can still see buffered
  popups when the current dialogue exhausts.
- Asset resolution guards against stale asynchronous results when queued items
  change quickly and falls back through the existing placeholder path.
- Dismissal callbacks carry the notification key, so a stale callback cannot
  remove a newer queue head.

## Testing Strategy

### Pure detector tests

- Detect one new evidence record.
- Detect one new statement record.
- Detect multiple records and enforce evidence-first deterministic ordering.
- Preserve each inventory array's order.
- Ignore unchanged records, duplicates, removals, and reset-to-empty states.
- Treat a null previous state as baseline hydration.

### Controller tests

- Queue and expose one current item at a time.
- Append acquisitions while another item is active.
- Dismiss sequentially without skipping.
- Ignore repeated dismissal for the same activation.
- Clear on reset/unmount transitions.

### Popup component tests

- Render evidence and statement copy and content.
- Resolve evidence images and cover null-ID, resolution-failure, and
  browser-load fallback behavior.
- Focus Continue on open and item change.
- Trap Tab and Shift+Tab.
- Dismiss exactly one item through click, Enter, Space, and Escape, including a
  stale callback from the previous item.
- Keep backdrop clicks non-dismissing.
- Release the Escape claim and restore focus after the final item.
- Apply the reduced-motion contract.

### Client and integration tests

- A successful state command commits state and enqueues each addition once.
- A rejected/failed command enqueues nothing.
- When a successful command returns dialogue, notifications are buffered
  (not enqueued) until the dialogue queue exhausts.
- A subsequent non-advance command that exits dialogue flushes the pending
  buffer before inferring new notifications.
- Navigation commands (`jump_to_scene`, `start_game`, `reset_game`) clear
  the pending buffer and acquisition controller on success; on failure, the
  pending buffer is restored.
- Existing SFX inference still runs independently of popup inference.
- Gameplay is inert while a popup is visible.
- Underlying dialogue does not advance from popup Enter/Space input.
- Escape dismisses the popup before it can affect `GameShell`.

### Browser-safe end-to-end test

Using the existing Tauri mock path, acquire an item, advance the resulting
`On Collect`/`On Acquire` dialogue to exhaustion, assert that the popup
appears after the dialogue drains, dismiss it, and confirm gameplay resumes.
Cover a multi-item command or fixture so sequential display is proven.

Final verification runs the focused Vitest files, the focused Playwright flow,
and `bun run check`.

## Acceptance Criteria

- Every newly added evidence or statement record from a normal gameplay command
  produces one blocking popup.
- Multiple records are never merged, lost, or skipped.
- Evidence precedes statements for mixed acquisitions, with stable order inside
  each type.
- The popup appears after the acquisition command's authored dialogue queue
  drains (or immediately if the command returns a non-dialogue mode).
- Continue, Enter, Space, and Escape dismiss exactly one item.
- The game menu and underlying dialogue never react to the same dismissal
  input.
- Missing assets, failed commands, hydration, reset, and duplicate inventory do
  not create stale or repeated popups.
- The inventory and authored acquisition dialogue remain unchanged.

## Popup Timing Amendment (2026-07-15)

The original design (2026-07-10) required the popup to appear *before* the
returned acquisition dialogue could be advanced. Implementation on the
`fix/dialogue-advance-acquisition-timing` branch revealed that interrupting
the authored `On Collect`/`On Acquire` dialogue with a mechanical popup
breaks the narrative flow the writer intended — the player sees "EVIDENCE
ACQUIRED" before the character's reaction line that gives the acquisition
its emotional context.

**Amended contract:** the popup now appears *after* the acquisition
command's authored dialogue queue drains. Notifications are buffered in a
pending queue while the returned mode is dialogue, and flushed when the
queue exhausts (detected via a `queueToken` scene-id or queue-gen
transition, or a mode change out of dialogue). If the command returns a
non-dialogue mode, notifications are enqueued immediately as before.

This amendment updates the Goals, Data and Interaction Flow, Lifecycle and
Failure Handling, Testing Strategy, and Acceptance Criteria sections above.
All other aspects of the design (detection, controller, popup component,
accessibility, Escape layering) are unchanged.
