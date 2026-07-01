# Dialogue History Design

**Date:** 2026-07-01
**Status:** Approved design; implementation plan to follow
**Related specs:**
- `docs/superpowers/specs/2026-05-13-scene-pipeline-design.md`
- `docs/superpowers/specs/2026-05-19-interrogation-scene-design.md`
- `docs/superpowers/specs/2026-06-28-free-scene-navigation-menu-design.md`

## Goal

Add an RPG-style dialogue log for the playable game. While dialogue is active,
the player can open a compact history panel from the dialogue box and review
the previous visible text beats they may have advanced past.

The log shows the most recent 50 visible beats in the current game session,
following the player across normal scene transitions.

## Decisions

User-approved scope decisions:

- Access the log from the dialogue box, not from the Escape menu.
- Include spoken dialogue lines and narration/action text.
- Skip scene transition tags because they are visual/backdrop cues, not
  player-facing transcript text.
- Keep the most recent 50 entries across the current case/session.
- Provide both a visible `LOG` button and a keyboard shortcut.
- Store history in the Rust game engine and expose it through `GameStateView`.

## Existing Context

Dialogue playback is owned by `GameEngine`. Linear scenes keep a queue and
cursor directly on `LinearSceneState`; investigation and interrogation scenes
install temporary `DialogueQueue` values for intros, reexamine text, reveals,
answers, testimony results, and outros. `advance_dialogue` accepts a
`QueueToken` and no-ops on stale tokens, so rapid repeated input cannot skip
multiple lines.

`ModeView::Dialogue` currently exposes only the active `DialogueItem`, queue
remaining count, visual cue fields, and queue token. Svelte renders that state
through `DialogueBox.svelte`.

`GameShell.svelte` owns global Escape handling for the game menu. Any dialogue
log Escape handling must coexist with that capture-phase menu listener and
close the log before the Escape menu opens.

## Scope

### In Scope

- Engine-owned capped dialogue history.
- `GameStateView.dialogueHistory` serialization to Svelte.
- TypeScript state types matching the Rust wire contract.
- A dialogue-box `LOG` button.
- A read-only history panel for the last 50 visible entries.
- Keyboard support for opening/closing the log while dialogue is active.
- Escape precedence so the log closes before the game menu opens.
- Focused Rust and frontend tests.

### Out of Scope

- Rewind, replay, or jump-to-line behavior.
- Audio replay for previous dialogue.
- Persistent save-file history across app restarts.
- History access from the Escape menu.
- Compiler or authoring-format changes.
- Logging invisible `sceneTag` items.

## Backend Architecture

Add a capped history collection to `GameEngine`:

```rust
dialogue_history: Vec<DialogueHistoryEntry>
next_dialogue_history_id: u64
```

`DialogueHistoryEntry` is serializable with `#[serde(rename_all = "camelCase")]`
and contains:

```ts
type DialogueHistoryEntry =
  | {
      id: number;
      kind: "line";
      speaker: string;
      text: string;
      chapterTitle: string;
      sceneTitle: string;
    }
  | {
      id: number;
      kind: "action";
      text: string;
      chapterTitle: string;
      sceneTitle: string;
    };
```

Only `DialogueItem::Line` and `DialogueItem::Action` become history entries.
`DialogueItem::SceneTag` continues to update `LastVisualCue` and is not shown
in history.

The history cap is enforced at insertion time. After pushing a new entry, if
the vector is longer than 50, remove the oldest entries so only the newest 50
remain.

`GameSnapshot` must include `dialogue_history` and
`next_dialogue_history_id`. Existing rollback paths then naturally remove
history produced by failed commands.

## Recording Rules

The engine records a visible item exactly once when that item becomes the
current dialogue beat.

Recording points:

- after `prime_initial_queue` positions a new game on the first visible
  dialogue beat;
- after `install_scene_queue` consumes leading scene tags and exposes the first
  visible temporary-queue item;
- after `advance_dialogue` consumes the previous item, skips any scene tags, and
  exposes the next visible item;
- after queue exhaustion triggers scene advancement and the next scene primes a
  new dialogue beat in the same command result.

Stale `QueueToken` submissions return the unchanged view and do not append
history. Commands that fail after a snapshot restore do not leave history
behind.

Starting or resetting a game creates a new `GameEngine`, so history starts
empty. Normal scene advancement keeps history. `jump_to_scene` resets history
because it already starts a fresh run at the requested scene and clears
session-like state such as inventory.

## Frontend UI

`DialogueBox.svelte` gains a compact `LOG` control in the existing dialogue box
chrome. The button opens a read-only history panel above the dialogue box while
keeping the scene backdrop and portrait visible behind it.

The panel renders entries in play order with the newest entry at the bottom:

- `line`: speaker label plus text
- `action`: narration label plus text

The current active beat is included because it has already become visible to
the player. Empty history should render a short unavailable state, though in
normal dialogue mode the log will have at least the current beat.

The panel does not mutate game state and does not call Tauri commands.

## Keyboard And Escape

Keyboard behavior:

- `L` opens or closes the log while dialogue is active.
- `L` does nothing if focus is inside another interactive control.
- `Space` and `Enter` must not advance dialogue while the log is open.
- `Escape` closes the log first.
- If the log is closed, Escape keeps the existing `GameShell` menu behavior.

Because `GameShell` owns capture-phase Escape handling, the implementation
should use the existing escape-coordinator pattern for the dialogue log. When
the log opens, it claims Escape; closing or unmounting the log releases that
claim. This preserves the current "close one layer per Escape" contract without
moving Escape ownership out of `GameShell`.

The log panel should keep focus behavior simple: focus the close button when it
opens, trap focus inside the panel while open, and return focus to the `LOG`
button when it closes if that button is still mounted.

## Error Handling

History rendering is pure frontend state from `GameStateView`; it has no
network, Tauri, or asset loading failure path.

Backend recording should be internal and infallible. A malformed or unsupported
dialogue item should not occur because the enum is closed; scene tags are
explicitly ignored.

If the frontend receives no `dialogueHistory` because of a wire-contract drift,
type-checking should catch it. Runtime code should not invent a client-side log
fallback.

## Testing

Rust tests:

- records the initial visible dialogue beat on game start;
- records action and line items but skips scene tags;
- caps history at 50 entries;
- keeps history across normal scene advancement;
- clears history on `jump_to_scene`;
- stale queue tokens do not append duplicates;
- snapshot rollback restores history after a failed advance path.

Frontend tests:

- `DialogueBox` renders the `LOG` button when history is present;
- clicking `LOG` opens a panel with line and action entries;
- `L` toggles the panel while dialogue is active;
- Space/Enter do not advance dialogue while the panel is open;
- Escape closes the log before the game menu opens;
- focus returns to the `LOG` button after closing.

Verification should include focused Vitest coverage for the dialogue component
and focused Rust tests for history recording. Run `bun run check` after
frontend type changes, and run the relevant Rust test filter before broader
Rust verification.
