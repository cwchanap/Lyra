# Free Scene Navigation Menu Design

**Date:** 2026-06-28
**Status:** Approved design; implementation plan to follow
**Revisions (2026-06-28, post-implementation review):**
- Escape inside an open submenu steps back to the root menu first; a second
  Escape closes the whole menu. (Replaces the original "one Escape closes the
  menu from anywhere" rule in Accessibility And Focus.)
- `Close Case` returns to the title screen (`returnToMainMenu`) instead of
  resetting to chapter 1. (Replaces "keep current behavior" in Menu UI.)
- Sound controls are removed from the title-screen `MainMenu` and live only
  behind the Escape-menu `Sound` submenu. (Adds to scope; see Menu UI.)
**Related specs:**
- `docs/superpowers/specs/2026-05-13-scene-pipeline-design.md`
- `docs/superpowers/specs/2026-05-19-interrogation-scene-design.md`
- `docs/superpowers/specs/2026-06-24-gameplay-audio-design.md`

## Goal

Add a free-style scene navigator to the in-game Escape menu so eligible users
can jump to any compiled scene under any compiled chapter.

The feature is eligible in either of these cases:

- development builds
- players who have reached game completion once

At the same time, move the current evidence dossier and sound controls behind
their own menu buttons inside the existing Escape menu. The main menu should
stay compact, and the existing modal ownership in `GameShell.svelte` should
remain the single place for Escape handling, focus trap, and menu chrome.

## Decisions

User-approved scope decisions:

- Add a persistent local "cleared once" flag for production eligibility.
- Development builds always expose free scene navigation.
- Selecting a scene starts a fresh run at that scene's opening.
- Scene jumps do not preserve current inventory, investigation state, or
  interrogation state.
- Evidence and sound become separate submenu buttons, not one combined tools
  drawer.
- Keep this feature in the current in-game Escape menu. Title-screen scene
  navigation is out of scope for this pass.

## Existing Context

`GameShell.svelte` currently owns the Escape menu, global Escape handling,
fullscreen reassertion, focus trapping, and focus restoration. Page-level code
passes inventory through the `menu` snippet and binds the menu `open` state so
menu-triggered flows can close the modal programmatically.

`AudioSettings.svelte` is currently rendered directly in `GameShell.svelte`.
`InventoryPanel.svelte` is currently rendered through the page's `menu` snippet.
Both should remain reusable components; this feature changes where they appear,
not their core behavior.

Runtime state is owned by `GameEngine`: resources directory, compiled chapter
manifest list, current chapter index, current scene index, active
`SceneRuntime`, visual cue state, inventory, and queue generation. There is no
existing scene-jump command and no existing persistent "cleared once" flag.

The browser development path uses the dev HTTP fallback on `127.0.0.1:1421` and
must mirror new Tauri commands.

## Scope

### In Scope

- A scene-navigation index command exposed through Tauri and the dev HTTP
  fallback.
- A scene-jump command exposed through Tauri and the dev HTTP fallback.
- Engine support for starting a fresh run at a requested chapter and scene.
- A local cleared-once entitlement flag using the existing local-storage style.
- Escape-menu submenus for:
  - scene navigation
  - evidence dossier
  - sound controls
- Focus-trap-safe submenu rendering inside the existing menu dialog.
- Focused Rust, frontend, and page integration tests.

### Out of Scope

- Full save-file work.
- Preserving inventory/progress when jumping.
- Unlocking scene navigation from the title screen.
- Bookmarking a mid-dialogue cursor, sublocation, phase, hotspot, topic, or
  testimony statement.
- Editor changes.
- Compiler schema changes.

## Backend Architecture

Add a lightweight scene-navigation model in the game view layer:

```ts
type SceneNavigationIndex = {
  chapters: Array<{
    id: string;
    title: string;
    index: number;
    scenes: Array<{
      id: string;
      title: string;
      type: "linear" | "investigation" | "interrogation";
      index: number;
    }>;
  }>;
};
```

Rust should expose the equivalent serializable structs with
`#[serde(rename_all = "camelCase")]`.

### `list_scenes`

`list_scenes` returns the compiled navigation index. It should use
`chapters.json` as source of truth and load each listed scene JSON to read the
scene's ID and title. This avoids duplicating scene metadata in Svelte and
keeps the navigator aligned with compiled resources.

The command needs access to the same resource directory used by `start_game`.
It should load directly from resolved resources rather than requiring an active
engine, so it works in all of these situations:

- no game has started yet
- the current game is in progress
- the current game is complete

### `jump_to_scene`

`jump_to_scene(chapterId, sceneId)` validates the requested IDs against the
compiled chapter list, resets gameplay state, loads the requested
`SceneRuntime`, resets scene-specific visual cue state, allocates a fresh queue
generation, and calls the same initial-priming path used by normal startup.

The resulting state is a fresh run beginning at the requested scene:

- inventory is empty
- investigation/interrogation progress is empty
- leading scene tags are consumed normally
- investigation intros and first-sublocation transitions run normally
- interrogation intros and phase entry run normally
- BGM/BGS continuity starts from default empty audio state and then follows the
  target scene's initial visual cues

The command returns `GameStateView`.

## Frontend Architecture

Add game-client wrappers:

- `listScenes(): Promise<SceneNavigationIndex | null>`
- `jumpToScene(chapterId: string, sceneId: string): Promise<void>`

Both should route through Tauri `invoke` or the dev HTTP fallback just like
existing commands. `jumpToScene` participates in the existing in-flight guard
and error normalization. It should not infer gameplay SFX; any click feedback
should remain ordinary UI feedback from the menu control, not scene-runtime
audio inference.

### Cleared Entitlement

Add a small frontend persistence helper for the scene-navigation entitlement.
Use the existing audio preference key style:

```ts
const STORY_CLEARED_STORAGE_KEY = "lyra.storyClearedOnce.v1";
```

The helper should:

- read a boolean-like cleared flag from `window.localStorage`
- write the flag when the app observes `gameState.value.mode.type ===
  "gameComplete"`
- warn once if storage is unavailable or saving fails
- fall back to `false` when storage cannot be read

Scene navigation is enabled when:

```ts
import.meta.env.DEV || storyClearedOnce
```

The frontend should hide the scene-select submenu button when disabled. The
backend command can remain a neutral engine capability; the product gate lives
in the UI.

## Menu UI

The Escape menu becomes a compact command list plus one open submenu at a time:

- `繼續調查 / Resume`
- `場景跳轉 / Scene Select` when enabled
- `物證檔案 / Evidence`
- `音訊設定 / Sound`
- `結束案件 / Close Case`

`Evidence` renders the existing `InventoryPanel`. `Sound` renders the existing
`AudioSettings`. `Scene Select` renders the navigation index.

Only one submenu should be open at a time. Opening a different submenu closes
the previous one. `Resume` keeps its current behavior. `Close Case` returns to
the title screen (`returnToMainMenu`) rather than resetting to chapter 1.
Closing the whole Escape menu should preserve page-level evidence panel
expansion state, matching the current `InventoryPanel` behavior.

Sound controls live only behind the Escape-menu `Sound` submenu. The
title-screen `MainMenu` no longer renders `AudioSettings`; players adjust
BGM/BGS/SFX volume from the in-game Escape menu.

### Scene Select Layout

The scene-select submenu should list chapters first, then scenes for the
selected chapter. The default selected chapter should be the current chapter
when possible. If the current state is game complete, default to the first
chapter.

For each scene, show:

- scene order number
- scene title
- scene type
- a current-scene indicator when it matches the active scene

Selecting a scene calls `jumpToScene(chapterId, sceneId)`. Close the Escape menu
after the command resolves whether it succeeds or fails. This mirrors the
existing dossier reexamine behavior: success reveals the new scene immediately,
and failure exposes the page-level `ErrorBanner` instead of trapping the error
behind the modal scrim.

## Error Handling

Use typed `GameError` values for backend failures:

- unknown chapter ID
- unknown scene ID within a known chapter
- scene-load failure
- malformed scene JSON
- unavailable engine state or poisoned lock

The frontend should keep the existing `normalizeError` behavior and display
errors through the existing `ErrorBanner`.

Storage failures should not block gameplay. They only disable the production
cleared-once entitlement for that browser/session and should produce at most
one warning per failure class.

## Accessibility And Focus

Keep the existing `GameShell` dialog contract:

- `role="dialog"`
- `aria-modal="true"`
- menu panel `tabindex="-1"`
- focus starts on Resume
- `Tab` and `Shift+Tab` remain trapped inside the open menu
- focus restores to the previously focused element after close

Submenu buttons and controls must participate in the same focus trap. The
submenu should not install a second global Escape handler. Pressing Escape
while a submenu is open steps back to the root menu first; pressing Escape
again (or when no submenu is open) closes the whole menu.

## Testing

### Rust

- Engine can jump to a linear scene and starts at that scene's first playable
  dialogue.
- Engine can jump to an investigation scene and primes intro / first
  sublocation behavior normally.
- Engine can jump to an interrogation scene and primes intro / phase behavior
  normally.
- Jumping resets inventory and prior scene progress.
- Unknown chapter and unknown scene IDs return typed errors.
- Scene index returns compiled chapters and ordered scenes with IDs, titles,
  types, and indexes.

### Dev HTTP And Tauri Wiring

- Tauri command list includes `list_scenes` and `jump_to_scene`.
- Dev HTTP fallback dispatches `list_scenes`.
- Dev HTTP fallback dispatches `jump_to_scene` with camelCase args:
  `{ chapterId, sceneId }`.

### Frontend State

- Cleared entitlement defaults to false outside dev.
- Cleared entitlement becomes true when game state reaches `gameComplete`.
- Storage failures warn and fall back without throwing.
- `jumpToScene` calls the correct command and updates `gameState.value` on
  success.
- `jumpToScene` does not mutate state on command failure.

### UI

- `GameShell` renders Evidence and Sound as separate submenus.
- `AudioSettings` is no longer always visible in the main menu body.
- `AudioSettings` is no longer rendered on the title-screen `MainMenu`.
- `InventoryPanel` is no longer always visible in the main menu body.
- Scene Select appears in dev mode or with the cleared flag.
- Scene Select is hidden in production without the cleared flag.
- Focus trap includes controls inside whichever submenu is open.
- Escape inside a submenu steps back to the root menu; Escape at the root
  closes the whole menu.
- Successful scene selection closes the Escape menu (behavioral page test,
  not only a source-string pin).
- Reaching `gameComplete` persists the cleared-once flag and reveals Scene
  Select on a subsequent production render (behavioral page test, not only a
  source-string pin).

## Verification

Use the smallest checks that cover the touched surfaces, then broaden before
claiming the feature is complete:

- focused Rust tests for `GameEngine`
- focused tests for the dev HTTP dispatcher
- focused `game-client` and storage helper tests
- focused `GameShell` tests
- `bun run --cwd apps/game test`
- `bun run --cwd apps/game check`
- `cargo test --manifest-path apps/game/src-tauri/Cargo.toml`
- `bun run check` if frontend type surfaces changed broadly

## Acceptance Criteria

- In development, the Escape menu can jump to any compiled scene in any
  compiled chapter.
- In production without the cleared flag, the scene-select submenu is hidden.
- After reaching game completion once, the scene-select submenu appears on
  later production runs in the same local profile.
- A selected scene starts cleanly at that scene's opening and does not carry
  current inventory or progress.
- Evidence and sound controls live behind separate Escape-menu submenu buttons.
- Existing Escape menu focus, close, and reset behavior remains intact.
