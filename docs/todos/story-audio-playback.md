# Story Audio Playback Deferred Work

Audio intent is part of the asset-aware story pipeline, but playback is deferred from the first implementation.

## Contract Already Planned

- Scene visual units can select `BGM` and `BGS`.
- `BGM` is the music channel.
- `BGS` is the ambience/background-sound channel.
- A defined audio ID starts or changes that channel.
- `none` stops that channel.
- Omitting a field after the first visual unit keeps the previous channel state.
- The first visual unit must explicitly set each channel to a defined ID or `none` when assets are enabled.
- Missing loose audio files are tolerated in dev and should resolve as silence or placeholder metadata.
- Release verification should fail if referenced audio assets are missing.

## Later Playback Work

- Add a frontend audio controller with two looped channels: BGM and BGS.
- Resolve audio asset IDs through the same asset resolver/cache used by images.
- Start, replace, or stop channels when the current visual unit changes.
- Keep v1 simple: no crossfade is required for the first playback pass.
- Add volume settings after basic playback works.
- Add tests for `none`, omitted-channel persistence, and missing-asset silence.
