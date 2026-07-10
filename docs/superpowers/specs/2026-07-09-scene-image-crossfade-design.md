# Scene Image Crossfade Design

**Date:** 2026-07-09
**Status:** Approved design; implementation plan to follow
**Related specs:**
- `docs/superpowers/specs/2026-05-30-story-asset-pipeline-design.md`
- `docs/superpowers/specs/2026-06-06-investigation-scene-layout-editor-design.md`
- `docs/superpowers/specs/2026-06-28-free-scene-navigation-menu-design.md`

## Goal

Remove the abrupt black flash when the playable game changes scene
backgrounds or visible character portraits. The desired feel is a direct,
short crossfade: keep the old visual visible until the replacement image is
ready, then overlap the two for 300 ms with no intentional black overlay.

## Problem

The current Svelte presentation code resolves story assets asynchronously and
clears the currently rendered image before assigning the new one:

- `SceneBackdrop.svelte` clears `resolved` while a new background resolves.
- `DialogueBox.svelte` clears `portraitAsset` while a new speaker portrait
  resolves.
- `InvestigationSceneSurface.svelte` clears investigation backgrounds and
  placed character portrait/standee entries during re-resolution.

`resolveStoryAsset` is intentionally path-construction-only. The browser does
the real image loading through `<img>`, and failures are handled by component
`onerror` fallbacks. Because the old image leaves the DOM before the next image
has loaded and painted, the page background can show through as a black frame.

## Approved Approach

Use a small shared Svelte presentation primitive for image cutovers. The
component keeps the current image mounted, stages the incoming image, waits for
the incoming image to load, then crossfades and removes the outgoing image
after the transition completes.

This was chosen over:

- component-local duplicate transition state, which would spread the same
  timing and cleanup logic across multiple files;
- CSS-only transitions on a single `<img src>`, which cannot reliably keep the
  previous bitmap visible while the next URL is still loading.

## Scope

### In Scope

- Story and interrogation backgrounds rendered through `SceneBackdrop.svelte`.
- Dialogue speaker portraits rendered through `DialogueBox.svelte`.
- Investigation viewport backgrounds rendered through
  `InvestigationSceneSurface.svelte`.
- Placed investigation character images, including portrait and standee asset
  IDs, rendered through `InvestigationSceneSurface.svelte`.
- Focused component tests and Svelte type checking.

### Out of Scope

- Rust runtime changes.
- Scene compiler, asset manifest, or authoring-format changes.
- New transition metadata in story files.
- Generated image asset changes.
- Menu, dialogue log, inventory, or audio behavior changes.
- Crossfading entire route/mode changes as a separate full-screen effect.

## Architecture

Add a reusable frontend component at
`apps/game/src/lib/components/CrossfadeImage.svelte`.

The component owns only image presentation state. It does not resolve asset IDs,
log missing assets, know Lyra story semantics, or choose placeholders. Existing
callers continue to resolve asset IDs through `resolveStoryAsset` and continue
to own their existing error handlers.

Expected public contract:

- `src: string | null` - current desired URL.
- `alt: string` - normally empty for decorative game art.
- `durationMs?: number` - defaults to 300 ms.
- CSS hook props or wrapper classes that let callers preserve current layout
  rules such as `background-image`, `portrait`, `left`, `right`, and crop
  styling.
- pass-through image attributes needed by current callers, including
  `aria-hidden`, `data-*` attributes, inline style strings or CSS variables,
  `onload`, and `onerror`.

The component renders image layers inside a stable wrapper. The active layer
stays visible. A new layer is added at opacity 0 when `src` changes. After the
new layer fires `load`, it fades to opacity 1 while older layers fade to
opacity 0. Cleanup happens after the transition duration or transition end.

When `src` changes to `null`, the active image fades out and then unmounts.
This covers dialogue lines without portraits. Backgrounds usually receive a new
asset rather than `null`, but if a no-background state is intentional it must
fade to the normal page atmosphere instead of disappearing instantly.

## Integration Points

### `SceneBackdrop.svelte`

Keep resolving `backgroundAssetId` through `resolveStoryAsset`, but do not
remove the visible background during a new resolve. Render the resolved URL via
the shared crossfade component. The scene stamp remains independent of image
transition state.

The final CSS must preserve the existing viewport backdrop contract:
`position: fixed`, `inset: 0`, `z-index: -1`, `width: 100vw`,
`height: 100vh`, `object-fit: cover`, and pointer-events disabled.

### `DialogueBox.svelte`

Render the current speaker portrait through the shared crossfade component.
The side placement rules remain local to `DialogueBox`: the same character IDs
stay right-aligned, other portraits stay left-aligned, and the portrait remains
behind the dialogue box.

If the next dialogue item has no portrait, the current portrait fades out. If
the next portrait fails to load, the existing warning and placeholder fallback
path must run, and the user sees a crossfade from the previous portrait to the
placeholder.

### `InvestigationSceneSurface.svelte`

Use the shared crossfade component for the investigation viewport background
and for each placed character image. Character targets, layout boxes, alpha
crop calculation, topic popovers, fallback controls, and Escape behavior remain
unchanged.

Placed character images are keyed by scene character id as they are today. If
the asset ID for an existing placed character changes, that target crossfades
between the old and new portrait or standee. If the character is removed from
the current sublocation, Svelte may remove the whole target immediately; that is
acceptable for this iteration because the reported flash is about asset
cutover, not sublocation staging.

## Loading And Error Behavior

The old visual must remain visible until the replacement image has loaded. A
slow image load must extend the old visual, not reveal the page background.

If an incoming image emits `error`, the shared component forwards the error to
the caller and keeps the previous loaded layer visible. The caller's existing
handler swaps the desired URL to a placeholder asset. The placeholder then
loads as the next incoming layer and crossfades normally.

If there is no previous layer, a missing image may briefly show no visual until
the placeholder URL arrives. That is acceptable for initial load because there
is no prior visual to preserve.

Rapid `src` changes must converge on the newest desired source. Older pending
incoming layers must be cancelled or ignored so stale loads cannot replace a
newer asset.

## Motion And Accessibility

The default transition duration is 300 ms. The transition uses opacity only and
must not animate position or scale by default.

Callers may dim the visible (loaded) layer by setting the
`--crossfade-visible-opacity` CSS variable on the component's wrapper (e.g.
`SceneBackdrop` uses `0.52`); the component applies it to loaded layers so the
crossfade target opacity is the caller-supplied value rather than a hard-coded
`1`.

For users with `prefers-reduced-motion: reduce`, the component must complete
the cutover with a near-instant opacity change while still preserving the
important loading rule: do not remove the old image until the new one has
loaded.

Decorative backgrounds and portraits keep `alt=""` and `aria-hidden="true"` as
they do now, so the transition does not add screen reader noise.

## Testing

Focused frontend tests must cover both the shared component and its main
callers.

Shared component tests:

- renders the initial image;
- keeps the old image mounted when `src` changes before the incoming image
  loads;
- renders the incoming image as a second layer;
- after the incoming image load and transition cleanup, leaves only the new
  image;
- fades out and unmounts when `src` becomes `null`;
- forwards `error` from an incoming image while preserving the previous loaded
  layer.

Caller tests:

- `SceneBackdrop` renders the crossfade image while preserving the fixed
  viewport backdrop CSS contract.
- `DialogueBox` keeps portrait placement classes/data attributes through the
  crossfade wrapper and fades portrait removal on no-portrait dialogue lines.
- `InvestigationSceneSurface` uses the crossfade path for the viewport
  background and placed character image URLs.

Verification after implementation:

- run focused component tests under `apps/game`;
- run `bun run --cwd apps/game check`;
- if the implementation touches shared test helpers or state types, run the
  corresponding focused Vitest files before the app-level check.

## Non-Goals And Guardrails

- Do not add a black veil, iris wipe, or cinematic full-screen transition in
  this iteration.
- Do not introduce story-authored transition timing.
- Do not preload entire scenes as part of this change. The fix is local to
  visual cutover and must not grow into a scene asset scheduler.
- Do not move missing-asset logging out of the components that know the asset
  type and asset ID.
- Do not alter the current investigation coordinate plane or crop math while
  adding the character-image crossfade.
