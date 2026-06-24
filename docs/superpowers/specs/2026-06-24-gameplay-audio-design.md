# Gameplay Audio Design

**Date:** 2026-06-24
**Status:** Approved design; implementation plan to follow
**Related specs:**
- `docs/superpowers/specs/2026-05-30-story-asset-pipeline-design.md`
- `docs/superpowers/specs/2026-06-21-audio-workflow-design.md`

## Goal

Bring Lyra's existing audio assets into actual gameplay.

The current pipeline already lets authored scene visual units select BGM and
BGS, validates those IDs against `static/assets/config/audio.yaml`, emits
`audio.*.*` asset refs, and carries BGM/BGS state through the Rust game view.
The missing piece is runtime playback and a bounded SFX event model.

This design adds a chapter-general frontend audio runtime:

- looped BGM and BGS playback driven by the current game mode
- coarse SFX triggers for gameplay/story events and UI feedback
- persisted global mute plus per-channel BGM/BGS/SFX volume
- missing-file silence so gameplay never blocks on audio availability
- Chapter 1 as the concrete rollout and acceptance target

## Decisions

User-approved scope decisions:

- Build the full first-pass audio runtime, not BGM/BGS only.
- Use a hybrid SFX model: story/gameplay events plus a small UI feedback layer.
- Keep first-pass SFX coarse. Do not add per-dialogue-line SFX.
- Include separate BGM, BGS, and SFX volume controls plus global mute.
- Make the engine chapter-general, but use Chapter 1 as the only real content
  rollout and acceptance test.
- If ElevenLabs billing, API access, or credit blocks BGM generation, runtime
  playback may still land. The Chapter 1 all-audio rollout is not complete
  until the Chapter 1 BGM files exist.

## Scope

### In Scope

- A small frontend audio controller that owns BGM, BGS, and SFX playback.
- Two looped channels: BGM and BGS.
- One-shot SFX playback for coarse named events.
- Audio asset URL resolution through the existing story asset resolver/path
  convention.
- Local persistence for audio preferences:
  - global mute
  - BGM volume
  - BGS volume
  - SFX volume
- Chapter 1 rollout using the existing BGS/SFX files and the three approved BGM
  catalog entries.
- Tests that fake browser audio primitives rather than relying on real sound.
- A Tauri smoke test for actual playback behavior.

### Out of Scope

- Per-dialogue-line SFX authoring.
- A timeline mixer, fades, crossfades, ducking, equalization, or spatial audio.
- Voice playback.
- A developer audio debug panel.
- Save-file persistence for audio preferences. Browser local storage is enough
  for v1.
- Blocking runtime work on external audio generation services.

## Existing Contract

BGM and BGS already use the asset-aware story pipeline:

1. Writers place `BGM` and `BGS` metadata on visual units in authored Markdown.
2. The compiler validates `none`, omitted channel semantics, catalog membership,
   and first-visual-unit explicitness when assets are enabled.
3. Generated JSON carries `bgm` and `bgs` as typed audio cues.
4. Rust preserves BGM/BGS continuity across scene boundaries and exposes the
   current cue state in `GameStateView.mode`.
5. The frontend currently ignores those fields.

The implementation should preserve this ownership model. It should not move
Markdown parsing into Rust or Svelte, and it should not hand-edit generated
resource JSON.

## Runtime Architecture

### Audio Controller

Add a focused frontend audio controller with these responsibilities:

- observe desired BGM/BGS cue state from the current `GameStateView.mode`
- resolve `audio.bgm.*` and `audio.bgs.*` IDs to public URLs
- start, keep, replace, or stop looped channel audio
- play mapped `audio.sfx.*` one-shots for named events
- apply persisted audio preferences
- absorb browser audio failures as silence plus warnings
- stop and release channel references on reset, game completion, or component
  teardown

The controller should be independent of Svelte components where practical. Use
Svelte only to wire lifecycle and state changes. The controller should accept
an injectable audio factory so unit tests can run without real browser audio.

### Loop Channels

The controller owns two long-lived loop channels:

| Channel | Purpose | Input |
| --- | --- | --- |
| BGM | music | `mode.bgm` |
| BGS | ambience/background sound | `mode.bgs` |

For each channel:

- a string `assetId` starts or replaces the loop
- an explicit `assetId: null` stops the loop
- unchanged desired asset IDs do nothing
- missing or unplayable files become silence for that channel

Rust already resolves omitted-channel continuity into the current mode state, so
the frontend should compare only the current desired state with its own playing
state.

### SFX Events

SFX uses coarse named events rather than visual-unit channel state.

First-pass event families:

- UI feedback: new game, reset, menu confirm, action unavailable
- investigation: hotspot inspected, topic discussed, sublocation entered,
  evidence acquired, statement acquired
- interrogation: phase entered, question answered, testimony pressed, wrong
  present, successful contradiction
- story beat hooks where existing Chapter 1 SFX are materially meaningful

An event may map to one SFX asset ID or no sound. No event should play a sound
just to fill silence. The default should be restrained.

The first implementation should keep this mapping in a small typed frontend
data module. It is not authored scene data in v1, and it should not require
compiler changes. If later chapters need writer-owned SFX placement, that should
become a separate authoring design rather than expanding this v1 into per-line
sound direction.

## Preferences

Audio preferences are local player settings, not story state.

Fields:

```ts
type AudioPreferences = {
  muted: boolean;
  bgmVolume: number;
  bgsVolume: number;
  sfxVolume: number;
};
```

Volumes are normalized `0..1` values. Defaults should be conservative so BGS
does not mask dialogue and SFX does not spike over ambience.

Persistence should use browser local storage under a Lyra-specific key. If
storage read/write fails, the runtime falls back to defaults for that session.

Global mute takes effect immediately:

- loop channels are muted without changing desired state
- SFX is suppressed while muted
- unmuting restores the current desired BGM/BGS loops and allows future SFX

## Authoring And Content

### BGM/BGS

BGM and BGS authoring stays exactly where it is today: visual-unit metadata in
scene Markdown. Writers use semantic catalog IDs or `none`. The compiler remains
the validation gate.

### SFX

First-pass SFX is coarse only:

- no per-dialogue-line SFX
- no requirement to sound every interaction
- no SFX under the existing sound-plan `cues` field

Chapter 1 should map existing generated SFX only where they clearly support the
beat:

- `sfx_anonymous_message_buzz`
- `sfx_rice_ball_bag_crinkle`
- `sfx_coffee_machine_backflush`
- `sfx_usb_insert_chime`

If a Chapter 1 action has no meaningful match, it remains silent.

### BGM Generation Dependency

Chapter 1 has approved BGM catalog entries:

- `bgm_review_board_loss`
- `bgm_review_board_victory`
- `bgm_chapter_close`

Their `.ogg` files may still be missing. If ElevenLabs billing, API access, or
credit blocks generation, the runtime can still ship with missing BGM resolving
to silence. The Chapter 1 all-audio rollout remains incomplete until these
files exist under `static/assets/audio/bgm/`.

## Data Flow

### BGM/BGS

1. A game command returns `GameStateView`.
2. The Svelte page passes the current mode's BGM/BGS state to the audio
   lifecycle wiring.
3. The controller computes desired channel state.
4. The controller compares desired asset IDs with currently playing asset IDs.
5. Only changed channels are stopped, started, or replaced.

Semantics:

- `mode.bgm.assetId === null`: stop BGM
- `mode.bgm.assetId` is a string: play or keep that BGM loop
- same for BGS

The controller should not treat missing files as game errors. Missing files
produce silence and a warning.

### SFX

SFX is dispatched around successful gameplay actions:

1. The user performs an action.
2. The command wrapper invokes Rust as it does today.
3. If the command succeeds, the frontend compares relevant prior/current state
   or uses the command outcome to infer a coarse event.
4. The event mapping resolves to an `audio.sfx.*` ID or no sound.
5. The controller plays a one-shot if preferences allow it.

UI-only events can dispatch directly when success does not depend on Rust.

## Error Handling

Audio must never block gameplay.

- Browser autoplay rejection records an audio-locked state and retries after the
  next player gesture.
- Missing files log a concise warning with the asset ID and URL, then resolve to
  silence.
- Malformed runtime asset IDs are caught during resolution, logged, and ignored.
- Playback promise rejections are caught and do not surface an error banner.
- Local storage failures fall back to defaults.
- Reset, route teardown, and game completion stop looped channels and release
  references.

Compile-time validation should remain strict for authored IDs. Runtime leniency
is only for protecting the player experience if a bad state reaches the
frontend.

## Testing

### Unit Tests

Use an injected fake audio factory.

Cover:

- starts BGM and BGS loops
- keeps unchanged loops without restarting
- replaces a loop when the asset ID changes
- stops on explicit `none`
- suppresses SFX while muted
- applies channel volumes
- tolerates missing-file and rejected-play cases
- disposes active channels cleanly

### Frontend State Tests

Cover:

- page/lifecycle wiring sends mode audio changes to the controller
- successful actions dispatch coarse SFX events
- failed commands do not dispatch success SFX
- settings changes update active loop channels

### Compiler And Tooling Tests

No compiler behavior needs to change for BGM/BGS playback or first-pass SFX.
The v1 SFX mapping is a frontend data module, not authored data, so existing
compiler validation remains intact.

### Manual Verification

Run the smallest useful checks for the touched layer, then smoke real playback:

- `bun run scenes:compile`
- focused frontend unit tests
- `bun run check`
- `bun run dev:game`

The Tauri smoke should verify that user interaction unlocks audio, BGS/SFX files
play from static assets, missing BGM files do not break gameplay, and changing
mute/volume settings affects active playback.

## Acceptance Criteria

Runtime acceptance:

- BGM/BGS cue changes from game state drive looped playback.
- Existing Chapter 1 BGS files play in the correct scenes.
- Existing Chapter 1 SFX files can play from coarse events.
- Global mute and per-channel volume controls persist locally.
- Missing audio files fail silent with warnings.
- Gameplay remains usable if browser audio is locked or playback fails.

Chapter 1 all-audio rollout acceptance:

- Runtime acceptance passes.
- The three approved Chapter 1 BGM files exist and play in their mapped scenes.
- BGS, SFX, and BGM balance is manually checked in the Tauri app.

The runtime can be complete before the Chapter 1 rollout is complete if BGM
generation is externally blocked.
