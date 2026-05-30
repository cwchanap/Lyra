# Story Asset Pipeline Design

**Date:** 2026-05-30
**Status:** Approved design
**Related specs:**
- `docs/superpowers/specs/2026-05-13-scene-pipeline-design.md`
- `docs/superpowers/specs/2026-05-19-interrogation-scene-design.md`

## Goal

Lyra's scene pipeline already turns authored Markdown scenes into runtime JSON. This design extends that pipeline so story authoring can also produce a stable asset contract for visual-novel presentation:

- sub-scene backgrounds
- current-speaker character portraits and expression variants
- evidence/item images
- background music and ambience selections

The first implementation is an asset-aware compile and runtime wiring pass. It does not generate images or audio, does not introduce a binary asset pack, and does not implement audio playback.

## Scope

In scope:

- Story scene Markdown can declare asset intent.
- Reusable asset config is YAML under `static/assets/config/`.
- The compiler emits logical asset IDs into scene JSON.
- The compiler emits a generated asset manifest under `src-tauri/resources/assets/`.
- The runtime/frontend can render background, portrait, and evidence placeholder or loose-file assets by logical asset ID.
- BGM/BGS IDs are validated and carried through data, but not played.
- Asset-enabled compiler fixtures are created from copied current Chapter 1 content so live Chapter 1 can be rewritten later without fixture churn.
- Existing story-writing skills are updated with the new authoring contract.

Out of scope:

- AI image generation implementation.
- Audio generation implementation.
- Runtime audio playback.
- Binary, encrypted, or obfuscated release asset packs.
- Human approval or curation state for generated assets.
- Multi-character staging, portrait positions, or non-speaker expression changes.

## Directory Model

The project should keep story source, loose assets, and generated runtime data separate.

```text
static/
  stories_plan/
    chapter_1/
      chapter.md
      scene_0.md
      investigation_scene_1.md
      interrogation_scene_2.md
  assets/
    config/
      policy.yaml
      characters.yaml
      audio.yaml
    backgrounds/
    portraits/
    evidence/
    audio/

src-tauri/
  resources/
    scenes/
      chapters.json
      chapter_1/*.json
    assets/
      manifest.json
      report.json
```

`static/stories_plan/` remains story Markdown only.

`static/assets/config/` holds controlled asset policy/catalog data. The production repo should have an explicit `policy.yaml`; live content can keep `assets.enabled: false` until the real story revamp enables the workflow.

`static/assets/backgrounds/`, `static/assets/portraits/`, `static/assets/evidence/`, and `static/assets/audio/` hold v1 loose asset files. The frontend can render these with ordinary `/assets/...` URLs.

`src-tauri/resources/scenes/` and `src-tauri/resources/assets/` are compiler outputs consumed by the Rust/runtime side. The compiler may regenerate these outputs. They are not the source of truth for story or art direction.

## Authoring Contract

Scene files stay Markdown. Reusable asset catalogs are YAML.

### Policy YAML

`static/assets/config/policy.yaml` defines whether asset enforcement is active and the global art policy. It is the feature switch for the production story corpus: `assets.enabled: false` keeps current live Markdown compiling without asset metadata, while fixture corpora and later revamped chapters can set it to `true`.

Example shape:

```yaml
assets:
  enabled: true

globalStyle:
  prompt: >
    Neo-noir Japanese detective visual novel, cinematic rain atmosphere,
    grounded realistic environments, restrained color, no text in image.

types:
  background:
    dimensions: [1920, 1080]
    format: png
    transparency: false
    prompt: >
      Wide background plate, no foreground dialogue characters, no UI, no text.
  portrait:
    dimensions: [768, 1024]
    format: png
    transparency: true
    prompt: >
      Half-body visual novel portrait, transparent background, consistent face.
  evidence:
    dimensions: [512, 512]
    format: png
    transparency: true
    prompt: >
      Isolated evidence icon, readable silhouette, transparent background.
  audio:
    format: ogg
    loop: true
```

Dimensions and format are type policy, not per-entry story metadata.

### Character YAML

`static/assets/config/characters.yaml` maps dialogue speaker labels to stable character IDs.

Every non-`旁白` speaker must resolve to one entry. `旁白` is a built-in no-portrait speaker.

Portrait speakers must define `standard`. Expressions are controlled per character.

Example shape:

```yaml
characters:
  - id: hayasaka_akane
    displayNames: ["早坂茜"]
    portraitMode: portrait
    visualPrompt: >
      Young Japanese defense attorney, sharp eyes, practical dark suit,
      composed but warm presence.
    referenceAssetId: null
    expressions:
      standard:
        prompt: calm, attentive neutral expression
      concerned:
        prompt: worried expression, brows drawn slightly inward
      stern:
        prompt: controlled serious expression

  - id: kagami_system
    displayNames: ["KAGAMI"]
    portraitMode: none
```

If `portraitMode: none`, expression tags are compile errors for that speaker.

Unused declared expressions are warnings, not errors.

### Audio YAML

`static/assets/config/audio.yaml` defines reusable background music and background sound IDs.

Example shape:

```yaml
bgm:
  rain_mystery_low:
    prompt: low tension detective cue, sparse piano, soft synth pulse
    loop: true

bgs:
  street_rain:
    prompt: steady Tokyo street rain, distant traffic, no thunder
    loop: true
  indoor_rain_window:
    prompt: muffled rain against cafe windows, subtle room tone
    loop: true
```

Scene files may use a defined ID, `none`, or omit the field. Omission means keep the previous channel. `none` means stop that channel. The first visual unit in an asset-enabled corpus must explicitly set both channels to a defined ID or `none`.

### Visual Units

Asset changes attach to visual units:

- Linear scenes: each `[場景：...]` tag.
- Investigation scenes: each `## Sub-location`.
- Interrogation scenes: each `## Phase`.

For linear scenes, metadata lines immediately follow the scene tag:

```markdown
[場景：吉祥寺雨鐘咖啡館，深夜，雨夜。]
- **Background Prompt:** Rainy midnight exterior of a small Tokyo cafe...
- **BGM:** rain_mystery_low
- **BGS:** street_rain
```

For investigation sub-locations and interrogation phases, the same fields live in the block metadata:

```markdown
## Sub-location: 正門與傘架 {#entrance}
- **Status:** unlocked
- **Background Prompt:** Interior cafe entrance with umbrella stand...
- **BGM:** rain_mystery_low
- **BGS:** indoor_rain_window

[場景：雨鐘咖啡館正門內側，深夜，雨夜。...]
```

Background prompts are English production metadata. Player-facing story content remains Traditional Chinese.

### Portrait Expressions

Dialogue keeps the existing player-facing format. A speaker-scoped optional expression slug may appear after the bold speaker label:

```markdown
**早坂茜**[concerned]：你不舒服？

**相馬律**：沒有。只是不喜歡這種味道。
```

No expression tag means `standard`.

The compiler validates that:

- the speaker resolves through `characters.yaml`, unless the speaker is `旁白`;
- portrait speakers have `standard`;
- explicit expressions exist for that speaker;
- no-portrait speakers do not use expression tags.

V1 renders only the current speaker portrait. It does not stage multiple visible characters.

### Evidence Images

Evidence Manifest entries gain an English image prompt field when assets are enabled:

```markdown
### evidence:blue_umbrella {#blue_umbrella}
- **Name:** 藍色透明傘
- **Description:** ...
- **Details:** ...
- **Image Prompt:** Clear umbrella with blue handle, isolated evidence icon...
```

Statements remain text-only in v1.

## Logical Asset IDs

Scene JSON stores logical asset IDs, never prompts or filesystem paths.

The compiler derives stable IDs from semantic source IDs. Prompt edits regenerate the same asset identity.

Examples:

```text
background.chapter_1.scene_0.tag_001
background.chapter_1.investigation_scene_1.sublocation.entrance
background.chapter_1.interrogation_scene_2.phase.wakatsuki_inquiry

portrait.hayasaka_akane.standard
portrait.hayasaka_akane.concerned

evidence.blue_umbrella

audio.bgm.rain_mystery_low
audio.bgs.indoor_rain_window
```

Backgrounds are not deduplicated by prompt text. Each visual unit receives its own background asset ID.

Portraits are deduplicated by character ID and expression.

Evidence images are deduplicated by global evidence ID.

Audio assets are deduplicated by audio library ID.

## Scene JSON Changes

The Rust and TypeScript schemas should accept asset fields even when assets are disabled.

When assets are disabled, fields are null or empty.

When assets are enabled:

- `DialogueItem.kind = "line"` includes optional `portrait`.
- `DialogueItem.kind = "sceneTag"` includes optional visual-unit asset cue fields for linear scenes.
- investigation sub-locations include `backgroundAssetId`, `bgm`, and `bgs`.
- interrogation phases include `backgroundAssetId`, `bgm`, and `bgs`.
- evidence records include `imageAssetId`.
- each scene includes top-level `assetRefs` for cheap preload/verification.

Example dialogue item:

```json
{
  "kind": "line",
  "speaker": "早坂茜",
  "text": "你不舒服？",
  "portrait": {
    "characterId": "hayasaka_akane",
    "expression": "concerned",
    "assetId": "portrait.hayasaka_akane.concerned"
  }
}
```

Example linear scene tag item:

```json
{
  "kind": "sceneTag",
  "text": "吉祥寺雨鐘咖啡館，深夜，雨夜。",
  "backgroundAssetId": "background.chapter_1.scene_0.tag_001",
  "bgm": "audio.bgm.rain_mystery_low",
  "bgs": "audio.bgs.street_rain"
}
```

Example scene summary:

```json
{
  "assetRefs": [
    { "type": "background", "assetId": "background.chapter_1.scene_0.tag_001" },
    { "type": "portrait", "assetId": "portrait.hayasaka_akane.standard" },
    { "type": "portrait", "assetId": "portrait.hayasaka_akane.concerned" }
  ]
}
```

`assetRefs` includes all assets present in compiled scene content, including locked or optional branches. It does not duplicate cross-scene inventory evidence icons; inventory records carry those at runtime.

## Generated Asset Manifest

`bun run scenes:compile` emits `src-tauri/resources/assets/manifest.json` when `policy.yaml` is present. If assets are disabled, the manifest may contain no requested asset entries but still records that asset enforcement was off.

The manifest is generated. It is not edited by hand and does not carry mutable status such as missing, present, generated, or approved.

Each entry includes:

- `assetId`
- `type`
- source reference for debugging
- expected v1 loose file path under `static/assets/*`
- policy profile key
- prompt parts
- composed final prompt

Example:

```json
{
  "assetId": "portrait.hayasaka_akane.concerned",
  "type": "portrait",
  "source": {
    "kind": "characterExpression",
    "characterId": "hayasaka_akane",
    "expression": "concerned"
  },
  "expectedPath": "static/assets/portraits/hayasaka_akane/concerned.png",
  "publicPath": "/assets/portraits/hayasaka_akane/concerned.png",
  "policy": "portrait",
  "promptParts": {
    "globalStyle": "...",
    "typePrompt": "...",
    "subjectPrompt": "...",
    "entryPrompt": "worried expression, brows drawn slightly inward"
  },
  "finalPrompt": "..."
}
```

The manifest is also useful to future image/audio-generation agents. A separate repo-local generation skill can consume it later.

## Compiler Behavior

`bun run scenes:compile` remains the main compile command.

It reads playable scenes from `static/stories_plan/chapter_<N>/chapter.md`. Asset generation scope follows the chapter manifest; unlisted draft files are ignored.

When `assets.enabled` is false:

- strict asset metadata is not required;
- generated scene JSON still includes null/empty asset fields;
- generated asset manifest output is empty or marked disabled;
- no live story content needs temporary prompts before the Chapter 1 revamp.

When `assets.enabled` is true:

- `policy.yaml`, `characters.yaml`, and `audio.yaml` are mandatory and must validate;
- every visual unit needs `Background Prompt`;
- every non-initial visual unit may omit audio fields to keep previous audio;
- the first visual unit must set BGM and BGS to a defined ID or `none`;
- every non-`旁白` speaker must resolve through `characters.yaml`;
- every explicit expression slug must be declared for that character;
- every portrait speaker must have `standard`;
- every evidence entry requires `Image Prompt`;
- audio IDs must resolve in `audio.yaml`;
- scene JSON and manifest output are generated in one deterministic pass.

Warnings:

- declared but unused character expressions;
- missing loose asset files in dev;
- other non-blocking asset report findings.

Errors:

- missing required config when assets are enabled;
- missing background/evidence prompts;
- unknown speaker;
- ambiguous speaker mapping;
- invalid expression;
- expression tag on a no-portrait speaker;
- unknown audio ID;
- missing first visual-unit audio decision.

`bun run scenes:compile` should print a compact asset report:

```text
Assets: backgrounds 8 requested / 3 files present / 5 missing
Assets: portraits 12 requested / 0 files present / 12 missing
Assets: evidence 5 requested / 0 files present / 5 missing
Assets: audio 4 requested / 1 files present / 3 missing
Warnings: 2
```

A later `assets:verify` command or strict release mode should fail if any referenced asset resolves to a placeholder or missing file.

## Runtime And UI

The runtime contract is asset ID first.

`GameStateView` should expose:

- current `backgroundAssetId`;
- current `bgm` and `bgs` IDs;
- portrait metadata on current dialogue lines;
- evidence `imageAssetId` in inventory records.

The frontend should use an async resolver/cache:

- input: logical asset ID and type;
- output: `{ url, placeholder }`;
- v1 URL: `/assets/backgrounds/...`, `/assets/portraits/...`, `/assets/evidence/...`, or `/assets/audio/...`;
- missing files: return typed placeholder in dev;
- release: placeholders are rejected by verification before packaging.

The resolver can follow the existing game-client pattern: Tauri command in desktop runtime, dev HTTP fallback in browser/dev server. This keeps future packed-resource support behind the resolver.

UI changes:

- `SceneBackdrop` renders the current background asset if present; otherwise it falls back to the existing text-stamp scene label.
- `DialogueBox` renders the current speaker portrait when the dialogue item has portrait metadata.
- `InventoryPanel` renders evidence icons when `imageAssetId` exists.
- BGM/BGS IDs are carried in state but not played in v1.

Preloading should use compiled scene content. Scene JSON has `assetRefs` for current-scene preload. Inventory icons can be preloaded from current inventory records.

## Fixtures And Live Content

Current Chapter 1 content is not final and should not receive test-only asset prompts.

Implementation should copy current Chapter 1 into an asset-enabled fixture corpus, for example:

```text
scripts/compile-scenes/__fixtures__/asset-enabled/
  stories_plan/chapter_1/...
  assets/config/policy.yaml
  assets/config/characters.yaml
  assets/config/audio.yaml
```

That fixture is allowed to contain non-final prompts because it is compiler test data.

Live `static/stories_plan/chapter_1` can stay asset-disabled until the real Chapter 1 revamp adds asset metadata intentionally.

## Skill Updates

Update the repo-local story-writing skills:

- `writing-detective-game-dialogue`: linear scene tags need background prompt and audio metadata when assets are enabled; dialogue supports inline speaker expression slugs.
- `writing-investigation-scene`: sub-location metadata includes background/audio fields; evidence entries require `Image Prompt` when assets are enabled.
- `writing-interrogation-scene`: phase metadata includes background/audio fields; evidence entries require `Image Prompt` when assets are enabled.
- `writing-chapter-manifest`: add a small note that the chapter manifest controls playable scene order and asset generation scope.

Do not make writer agents choose filesystem paths.

## Deferred Audio Playback

Runtime audio playback is intentionally deferred. The design still validates and carries BGM/BGS IDs because writers must decide the background sound for each visual unit.

The deferred playback contract is documented in `docs/todos/story-audio-playback.md`.

## Verification Plan

The implementation plan should include:

- parser tests for inline expression tags and linear scene-tag metadata;
- parser tests for investigation/interrogation background/audio metadata;
- YAML config validation tests;
- compiler fixture tests for asset-enabled corpus output;
- snapshot tests for `assetRefs` and generated manifest entries;
- Rust serde tests for optional asset fields;
- frontend tests for placeholder background, portrait, and evidence icon rendering;
- `bun run check`;
- targeted compiler tests with Bun;
- Rust tests for schema/state changes.

End-to-end generation is not part of this verification plan.
