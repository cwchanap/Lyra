# Audio Workflow Design

**Date:** 2026-06-21
**Status:** Approved design
**Related specs:**
- `docs/superpowers/specs/2026-05-13-scene-pipeline-design.md`
- `docs/superpowers/specs/2026-05-30-story-asset-pipeline-design.md`
- `docs/superpowers/specs/2026-06-04-chapter-1-image-starter-pack-design.md`

## Goal

Lyra already has an asset pipeline for story backgrounds, portraits, evidence,
and audio IDs. This design adds an audio workflow that lets agents decide what
background music, background ambience, and sound effects should exist, reuse
existing audio assets where possible, and generate missing audio files with an
explicit review step before paid provider calls.

The workflow is intentionally split:

- plan sound design from chapter markdown;
- review a durable sound plan;
- apply approved `BGM` and `BGS` cues to source markdown;
- update `static/assets/config/audio.yaml`;
- generate missing `.ogg` files through ElevenLabs;
- leave runtime playback for a later design.

## Current Context

The existing story asset design already defines `BGM` and `BGS` metadata, an
`audio.yaml` catalog, and expected paths under `static/assets/audio/`. The
compiler validates audio IDs, emits audio manifest entries, and carries audio
cues into generated scene JSON. Rust runtime state preserves omitted `BGM` and
`BGS` channels across scene boundaries so a later visual unit can keep the
current audio without repeating metadata.

The current live catalog is empty:

```yaml
bgm: {}
bgs: {}
```

Chapter 1 markdown currently sets `BGM: none` and `BGS: none` only on the first
visual unit. Stage directions mention sounds such as rain, footsteps, vending
machine hum, plastic bag noise, and fluorescent lights, but these are prose
evidence for sound design, not machine-readable audio requests.

The frontend does not play audio yet. Runtime playback, SFX event semantics, and
audio UI controls are out of scope for this design.

## Decisions

- Create a workspace package at `packages/scripts` named `@lyra/scripts`.
- Move the entire current root `scripts/` tree into `packages/scripts`; do not
  keep root compatibility shims.
- Keep scene compile, evidence-source audit, doc validation, and new audio
  workflow tooling in that package.
- Keep `scenes:compile` deterministic and offline. It must never call
  ElevenLabs.
- Add a durable chapter-scoped sound plan under `docs/audio_plans/`.
- Use a plan-first workflow before any catalog update, scene metadata edit, or
  paid generation.
- Apply `BGM` and `BGS` cues into scene markdown after approval.
- Treat `SFX` as a planned and generated asset class in v1, but do not write SFX
  cues into scene markdown yet.
- Generate `BGM` with ElevenLabs Music Compose.
- Generate `BGS` and `SFX` with ElevenLabs text-to-sound-effects.
- Normalize all generated audio to `.ogg` files at the existing public asset
  paths.

## Package Migration

`packages/scripts` becomes the single source of truth for repo automation that
is not app runtime code.

The migration can preserve the current internal layout to reduce churn:

```text
packages/scripts/
  package.json
  compile-scenes.ts
  compile-scenes/
  audio/
  __fixtures__/
  __snapshots__/
```

The implementation may introduce a `src/` layout later, but this migration does
not require it. Root `scripts/` must disappear before the migration is complete.

Root and app commands delegate into the package:

```text
bun run scenes:compile
bun run scenes:watch
bun run evidence-sources:audit
bun run audio:plan
bun run audio:apply
bun run audio:generate
```

The migration must update all direct references to root `scripts/`, including:

- root `package.json`;
- `apps/game/package.json`;
- Vitest script config;
- imports inside tests and compile modules;
- fixture and snapshot paths;
- documentation and repo skills that mention compiler fixture paths;
- Tauri build hooks that call scene compilation through package scripts.

## Sound Plan Contract

The sound-design agent produces one durable YAML file per chapter:

```text
docs/audio_plans/chapter_1.sound-plan.yaml
```

The plan is a source artifact. It remains in the repo after generation so later
agents can inspect why each sound exists, which scene evidence justified it, and
which visual units reuse it.

The sound plan contains:

- schema version;
- chapter ID;
- source files reviewed;
- existing audio catalog snapshot used during planning;
- reusable `bgm`, `bgs`, and `sfx` entries;
- cue recommendations for `BGM` and `BGS`;
- rejected incidental sounds;
- generation status for each proposed asset.

Each audio entry records:

- stable snake_case ID;
- channel: `bgm`, `bgs`, or `sfx`;
- English generation prompt;
- intended duration;
- loop intent;
- reuse rationale;
- scene evidence with file and line reference;
- approval state;
- provider generation metadata when generated.

The sound-design rules are:

- `BGM` is sparse and chapter-palette-driven.
- `BGM` changes only at major story beats.
- `BGS` is location/mood pooled.
- `BGS` changes only when the acoustic environment meaningfully changes.
- `SFX` is proposed only for brief actions that are narratively emphasized,
  repeated, or useful as player feedback.
- Stage directions are evidence, not automatic sound requests.
- The agent must prefer existing `audio.yaml` entries and existing files before
  proposing a new generated sound.
- The agent must list notable rejected incidental sounds so future agents do not
  repeatedly re-propose them.

Example shape:

```yaml
schemaVersion: 1
chapterId: chapter_1
sources:
  - docs/stories_plan/chapter_1/scene_0.md
  - docs/stories_plan/chapter_1/investigation_scene_3.md
catalogSnapshot:
  bgm: []
  bgs: []
  sfx: []
entries:
  - id: rain_street_light
    channel: bgs
    status: approved
    loop: true
    intendedDurationSeconds: 30
    prompt: >
      Steady light rain on a narrow Tokyo shopping street at night, distant
      traffic, no thunder, no voices, loopable ambience.
    reuseRationale: >
      Covers rainy exterior and awning scenes without changing per dialogue beat.
    evidence:
      - file: docs/stories_plan/chapter_1/scene_6.md
        line: 3
        note: rainy shopping street under an awning
cues:
  - file: docs/stories_plan/chapter_1/scene_6.md
    visualUnit: tag_001
    bgs: rain_street_light
rejected:
  - file: docs/stories_plan/chapter_1/investigation_scene_3.md
    line: 26
    sound: coin tray click
    reason: incidental texture, not persistent or narratively emphasized
```

## Audio Catalog

`static/assets/config/audio.yaml` remains the compiler catalog.

The catalog gains an optional `sfx` map in addition to the existing `bgm` and
`bgs` maps:

```yaml
bgm:
  low_tension:
    prompt: sparse piano and soft synth pulse for restrained detective tension
    loop: true
bgs:
  rain_street_light:
    prompt: steady Tokyo street rain with distant traffic, no thunder
    loop: true
sfx:
  plastic_bag_crinkle:
    prompt: short close plastic bag crinkle, dry and intimate, no voices
    loop: false
```

For v1, the compiler continues to understand only `BGM` and `BGS` in scene
markdown. `sfx` entries are cataloged and generated, but they are not referenced
by playable scene markdown yet.

The package must validate catalog IDs as snake_case slugs. Audio asset paths
follow the existing convention, extended to `sfx`:

```text
audio.bgm.<id> -> static/assets/audio/bgm/<id>.ogg
audio.bgs.<id> -> static/assets/audio/bgs/<id>.ogg
audio.sfx.<id> -> static/assets/audio/sfx/<id>.ogg
```

## Applying Approved Plans

`audio:apply` applies an approved sound plan to repo source files. It does not
generate audio files and does not call the network.

Responsibilities:

- add approved `bgm`, `bgs`, and `sfx` entries to
  `static/assets/config/audio.yaml`;
- insert or update approved `BGM` and `BGS` cues in chapter scene markdown;
- preserve existing `Background Prompt` and `Image Prompt` metadata;
- never insert `SFX` into scene markdown in v1;
- keep cue insertion deterministic;
- support `--check` to report drift without editing.

Cue rules:

- The first visual unit in the asset-enabled corpus must explicitly set both
  `BGM` and `BGS`.
- Later visual units omit unchanged channels.
- Later visual units set an ID only when the channel changes.
- Later visual units use `none` only when the channel should stop.
- The apply step must not rewrite unrelated scene prose.

If the approved plan conflicts with current markdown or catalog state,
`audio:apply` should fail with a specific diagnostic rather than guessing. Good
failure examples include an unknown visual unit, duplicate ID with different
prompt, unapproved entry, or cue targeting a scene file not listed in the
chapter manifest.

## ElevenLabs Generation

`audio:generate` reads the approved sound plan and `audio.yaml`, then generates
only approved entries that are missing from `static/assets/audio/...`.

Generation rules:

- require `ELEVENLABS_API_KEY`;
- support `--dry-run`;
- support `--only <id>`;
- support `--force` for explicit regeneration;
- use ElevenLabs Music Compose for `bgm`;
- use ElevenLabs text-to-sound-effects for `bgs` and `sfx`;
- write temporary raw output under a package-controlled temp/cache path;
- normalize final outputs to `.ogg`;
- write final files under `static/assets/audio/<channel>/<id>.ogg`;
- update generation metadata in the sound plan.

Generation metadata records:

- provider;
- endpoint or model when known;
- prompt hash;
- generated timestamp;
- duration;
- output path;
- whether generation was forced;
- any normalization notes.

The exact ElevenLabs response shape and local audio conversion tool should be
verified during implementation against current official docs and the local
environment. The design requires stable `.ogg` outputs, not a particular
intermediate format.

## Skill Workflow

Add a Lyra repo skill for sound design. It is plan-first, analogous to the image
asset SOP but without direct generation.

The skill must:

- read the chapter manifest and every listed scene file for one chapter;
- inspect `static/assets/config/audio.yaml`;
- inspect existing `static/assets/audio/**`;
- produce or update `docs/audio_plans/chapter_N.sound-plan.yaml`;
- cite scene file and line evidence for every proposed sound;
- prefer reuse before new generation;
- keep `BGM` sparse;
- keep `BGS` pooled;
- threshold `SFX`;
- list rejected incidental sounds;
- not call ElevenLabs;
- not edit scene markdown directly.

The intended human and agent flow:

1. Sound-design agent writes or updates the sound plan.
2. Human reviews and approves entries/cues in the plan.
3. `audio:apply` updates `audio.yaml` and scene `BGM`/`BGS` metadata.
4. `audio:generate` creates missing `.ogg` files.
5. `bun run scenes:compile` validates the resulting cue IDs and asset report.

## Error Handling

The audio workflow should fail closed. It should not silently generate, delete,
or replace assets.

Plan validation errors:

- duplicate audio IDs;
- non-snake_case IDs;
- invalid channel;
- missing prompt;
- missing evidence for a new proposed sound;
- unapproved entry referenced by a cue;
- cue references unknown entry;
- cue references unknown scene file or visual unit.

Catalog/application errors:

- duplicate catalog ID with incompatible prompt or loop setting;
- plan cue conflicts with current markdown metadata;
- `SFX` cue requested for markdown in v1;
- first visual unit would be missing explicit `BGM` or `BGS`;
- scene file is not listed in the chapter manifest.

Generation errors:

- missing `ELEVENLABS_API_KEY`;
- unapproved entry requested;
- output path already exists without `--force`;
- provider failure;
- conversion or normalization failure;
- generated file missing or empty after normalization.

## Verification

Migration verification:

- focused package tests for compile-scene modules;
- `bun run scenes:compile`;
- `bun run test:scripts`;
- update docs/skills that refer to old root `scripts/` paths;
- confirm root `scripts/` has no remaining call sites.

Audio workflow verification:

- unit tests for sound-plan schema validation;
- unit tests for catalog reuse and duplicate diagnostics;
- unit tests for `audio:apply --check`;
- unit tests for deterministic markdown cue insertion;
- dry-run tests for `audio:generate` that do not hit the network;
- fixture chapter with existing and proposed audio entries;
- compile validation proving applied `BGM`/`BGS` IDs resolve.

Manual generation with ElevenLabs remains opt-in and outside ordinary
test/build flows.

## Out Of Scope

- Runtime audio playback.
- Audio settings UI.
- Real-time preview inside the game or layout editor.
- Writing SFX cues into scene markdown.
- Auto-generating audio during scene compilation or Tauri build.
- Multi-chapter batch generation.
- Non-ElevenLabs providers.
- Automatic mastering beyond basic output validation and `.ogg` normalization.

## Future Work

Later specs can add:

- frontend audio playback for `BGM` and `BGS`;
- runtime SFX event semantics;
- user volume/mute controls;
- in-editor audio preview;
- chapter-wide mix review reports;
- provider abstraction if another audio generation service becomes useful.
