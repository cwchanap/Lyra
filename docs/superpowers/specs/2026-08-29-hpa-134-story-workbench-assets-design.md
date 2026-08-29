# HPA-134 Story Workbench Assets Design

## Status

Planning design for **HPA-134 — [Story Workbench] Inspect scene assets, prompts, portraits, audio, and usage**.

This remains one ticket and one PR. The planning documents land first, then implementation continues on the same branch/PR.

## Goal

Add one read-only **Assets** mode to Lyra Story Workbench so an author can answer four questions without leaving the tool:

1. What visual/audio assets does the selected scene cue, and in what authored order?
2. What is the canonical prompt/path/source for a referenced asset?
3. Where else is that asset reused?
4. For portrait-bearing characters, which configured expressions exist, which files exist, and where are they used?

Do this without creating a second asset database, second story model, prompt workflow, generation provider, or generic DAM.

## Why HPA-134 is next

HPA-634 has landed and supplies the required shell, canonical scene navigation, ID-based Tauri boundary, Reader, Stage, Refresh, and public Analysis sanitizer.

The Workbench program currently sequences:

```text
HPA-634 Reader + Stage
   ├─> HPA-134 Assets
   └─> HPA-273 Plan

HPA-634 + HPA-134
   └─> HPA-135 focused source edits
```

HPA-134 therefore removes the next dependency on the main Workbench authoring path while staying independent from deferred Chapter 2 implementation.

## Decision summary

Keep the original selected architecture:

```text
load_asset_workspace
        ↓
projectAssetWorkspace()
        ↓
AssetsView

Reader | Assets | Stage
```

The review corrections are ownership pins, not additional product scope:

- reuse compiler-owned YAML normalization instead of adding an editor parser;
- reuse compiler/Reader dialogue carrier identity and add completeness assertions;
- reuse compiler asset ID/path owners instead of concatenating strings in the editor;
- fix the final verification commands.

## Current owners to reuse

### Workbench shell and domain IPC

Reuse the existing HPA-634 boundaries:

- `apps/layout-editor/src/App.svelte` — selection + Workbench mode shell;
- `apps/layout-editor/src/lib/workbench-api.ts` — ID-based Tauri calls;
- `apps/layout-editor/src/lib/workbench-types.ts` — public scene payloads;
- `apps/layout-editor/src/lib/reader-projection.ts` — compiler-typed author-facing projection and dialogue carrier spelling;
- `apps/layout-editor/src-tauri/src/lib.rs` — workspace root, manifest resolution, public Analysis sanitization, layout I/O.

Rust remains a filesystem/domain boundary. TypeScript owns author-facing asset projection.

### Compiler-owned scene asset semantics

Do not add new scene cue syntax. Current compiled data already carries:

- `sceneTag.assetCue` for dialogue visual/audio changes;
- investigation `backgroundAssetId`, `bgm`, `bgs` per sublocation;
- interrogation `backgroundAssetId`, `bgm`, `bgs` per phase;
- resolved line `portrait` refs;
- evidence `imageAssetId`;
- investigation character `layout`, where only `kind: "sprite"` carries `assetId`;
- Analysis public intro/result/outro dialogue after HPA-634 sanitization.

For BGM/BGS, preserve authored delta semantics exactly:

```text
cue/field is null            -> Inherit
{ assetId: null }            -> Stop
{ assetId: concrete }        -> Set
```

Do not simulate effective cross-scene or cross-chapter playback.

### Generated asset manifest/report

The compiler already writes:

```text
apps/game/src-tauri/resources/assets/manifest.json
apps/game/src-tauri/resources/assets/report.json
```

`manifest.json` remains authoritative for referenced assets:

```ts
AssetManifestEntry {
  assetId
  type
  source
  expectedPath
  publicPath
  promptParts
  finalPrompt
}
```

HPA-134 does not add `assets-workbench.json` or any other generated editor manifest.

### Canonical asset configuration

The canonical authored configs remain:

```text
static/assets/config/policy.yaml
static/assets/config/characters.yaml
static/assets/config/audio.yaml
```

Policy prompts are already composed into manifest entries, so the Workbench does not parse `policy.yaml`.

For `characters.yaml` and `audio.yaml`, **do not add a second parser in `apps/layout-editor`**. The compiler currently owns normalization in `packages/scripts/compile-scenes/assets/config.ts`, including important semantics such as:

- flattened/trimmed `displayNames`;
- `portraitMode` defaulting;
- expression maps;
- `visualPrompt` / `referenceAssetId` normalization;
- BGM/BGS/SFX maps;
- audio `loop` defaulting to `true` when omitted.

Refactor that ownership into a filesystem-free compiler module that can be imported by both `loadAssetConfig()` and the Workbench.

Recommended boundary:

```text
packages/scripts/compile-scenes/assets/config-catalog.ts
```

with pure text readers such as:

```ts
parseCharactersYamlText(text, sourceFile)
parseAudioYamlText(text, sourceFile)
```

The exact return type can follow existing compiler diagnostic conventions, but the ownership split is fixed:

- the pure module performs YAML parsing + compiler-compatible catalog normalization;
- `loadAssetConfig()` still owns compiler validity policy and filesystem reads;
- the Workbench consumes normalized values only;
- the Workbench converts YAML syntax/root-shape failure into a read diagnostic;
- the Workbench does **not** independently enforce compiler validity rules such as required `standard` expressions, identifier policy, duplicate IDs, or approval status.

Do not reuse `packages/scripts/audio/audio-catalog.ts` for HPA-134: that parser intentionally requires explicit boolean `loop`, while compile-scenes currently defaults a missing loop to `true`. HPA-134 must match compile-scenes semantics, not silently tighten them.

`apps/layout-editor` therefore does **not** add a direct `yaml` dependency.

### Static asset paths and IDs

Use existing owners; do not concatenate identity/path strings in the Workbench.

For referenced assets:

- use manifest `expectedPath` and `publicPath` verbatim;
- use manifest `source` metadata verbatim.

For configured-but-unreferenced portrait expressions:

- centralize portrait ID construction in a filesystem-free compiler helper used by `enrich.ts` and the Workbench;
- use existing `expectedPath()` / `publicPath()` from `packages/scripts/compile-scenes/assets/manifest.ts` for repo/public paths.

Recommended small helper:

```text
packages/scripts/compile-scenes/assets/identity.ts
```

with:

```ts
portraitAssetId(characterId, expression)
```

and compiler call sites updated to use it. This prevents the Workbench from owning `portrait.${characterId}.${expression}` spelling.

Audio assets are **not** reconstructed from strings in the Workbench. Join short config IDs to manifest entries through canonical manifest metadata:

```text
source.channel
source.id
```

Filter SFX with `source.channel === "sfx"`.

Investigation character layout usages obey the actual `CharacterLayout` union:

- `kind === "sprite"` -> has `assetId`, join it to the manifest and record usage;
- `kind === "baked"` -> no asset ID, no sprite asset usage.

A sprite asset may be standee, portrait, evidence, or background. Do not assume every sprite is a standee.

### Dialogue carrier identity and completeness

Assets needs a separate scene walk because Reader intentionally strips presentation assets. What must not fork is **carrier identity**.

Reuse:

- `deriveDialogueSegments()` from `packages/scripts/compile-scenes/dialogue-segment-origins.ts`;
- `readerSegmentId()` from `apps/layout-editor/src/lib/reader-projection.ts` for the canonical Workbench carrier spelling.

Examples include:

```text
main
intro
outro
sublocation:<id>:transition
hotspot:<id>:inspect
hotspot:<id>:reexamine
topic:<characterId>:<topicId>:dialogue
phase:<id>:entry
question:<id>:line:<lineId>:content
evidence:<id>:onCollect
board:<boardId>:result
```

The Assets projection must use the same pool-style safety idea as Reader:

1. derive the compiler dialogue segments;
2. map them by `readerSegmentId()`;
3. the scene-specific walk takes the expected carrier rather than inventing an ID;
4. after projection, assert no **asset-bearing** compiler dialogue segment was left unprojected.

"Asset-bearing" means a non-empty segment containing at least one resolved portrait or `sceneTag.assetCue`.

This is required so a future dialogue carrier cannot silently disappear from Assets while Reader remains complete.

Non-dialogue asset facts are not covered by `deriveDialogueSegments()` and therefore get explicit typed tests:

- investigation sublocation structural `backgroundAssetId` / `bgm` / `bgs`;
- interrogation phase structural `backgroundAssetId` / `bgm` / `bgs`;
- evidence `imageAssetId`;
- investigation `layout.kind === "sprite"` asset usage;
- subject portrait where represented structurally outside dialogue.

Analysis is special: public IPC deliberately excludes private `assetRefs` and hidden answer fields. Traverse only the same public carriers Reader exposes:

```text
intro
board:<boardId>:result
outro
```

Do not cast `PublicAnalysisScene` to `JSONAnalysisScene` only to call compiler helpers.

## Selected architecture

```text
canonical scene Markdown
characters/audio YAML
        │
        ▼
existing compiler
        │
        ├─ public compiled scenes
        ├─ resources/assets/manifest.json
        └─ resources/assets/report.json
                 │
                 ▼
      load_asset_workspace
                 │
                 ▼
  compiler-owned YAML normalizers
  + projectAssetWorkspace()
                 │
        ┌────────┼────────┐
        ▼        ▼        ▼
    Scene cues  Library  Characters
        └────────┴────────┘
                 ▼
           AssetsView.svelte
```

## Rust boundary

Add one fixed-domain command:

```text
load_asset_workspace
```

It takes no workspace path and no asset ID.

Payload:

```ts
WorkbenchAssetWorkspacePayload {
  manifest: AssetManifest
  report: AssetReport
  configSources: {
    characters: { path, content }
    audio: { path, content }
  }
  scenes: Array<{
    chapterId
    sceneId
    sourcePath
    scene: WorkbenchScenePayload
  }>
  existingAssetPaths: string[]
}
```

Reuse existing Rust helpers:

1. `workspace_root()`;
2. `load_manifest_chapters()` for ordered manifest ownership;
3. `load_scene_bundle_at_root()` for public scene payloads and Analysis sanitization.

Read only fixed files beneath the known workspace root. `existingAssetPaths` is only a presence set; it does not populate the Library.

Missing generated `manifest.json` or `report.json` is a loud domain error telling the developer to compile scenes. Do not fall back to scanning loose assets as source of truth.

## TypeScript projection

Add:

```text
apps/layout-editor/src/lib/asset-workspace.ts
```

Primary API:

```ts
projectAssetWorkspace(payload): AssetWorkspace
```

Responsibilities:

- call compiler-owned character/audio YAML normalizers;
- preserve manifest prompts/paths/source exactly;
- project ordered scene cues;
- project BGM/BGS Set/Stop/Inherit;
- aggregate usage with stable carrier IDs;
- group portrait expressions by canonical character config;
- report file presence and failed joins;
- retain compiler report diagnostics.

It does not define validity/approval policy.

## Asset library model

Expose only:

```ts
type WorkbenchAssetKind =
  | "background"
  | "portrait"
  | "standee"
  | "evidence"
  | "bgm"
  | "bgs";
```

Referenced image/audio assets come from manifest entries only.

For manifest `type: "audio"`, determine `bgm` / `bgs` from `source.channel`, not by parsing the asset ID. If metadata is absent/unsupported, preserve the entry as an unresolved diagnostic rather than guessing.

Catalog-only SFX remains out of scope.

## Usage identity

A usage is a concrete authored/compiled occurrence:

```ts
type AssetUsage = {
  chapterId: string;
  sceneId: string;
  sceneSourcePath: string;
  carrierId: string;
  carrierLabel: string;
  role: "background" | "bgm" | "bgs" | "portrait" | "standee" | "evidence";
  itemIndex: number | null;
};
```

Deduplicate only exact duplicate occurrence keys. Dialogue usages retain per-item identity; grouped UI counts can summarize by scene later.

## Cue ordering

Preserve scene/authored order rather than sorting by asset ID.

### Linear

Walk the `main` dialogue carrier in queue order.

### Investigation

Use the authored structure:

1. intro dialogue;
2. each sublocation structural cue;
3. sublocation transition/hotspot/topic dialogue carriers;
4. sprite layout usage where `kind === "sprite"`;
5. evidence image + evidence/statement branch dialogue;
6. outro.

Carrier IDs are taken from the derived segment pool, not reconstructed.

### Interrogation

Use:

1. intro;
2. each phase structural cue + subject portrait;
3. entry/question/testimony dialogue carriers;
4. evidence/statement dialogue + evidence images;
5. outro.

Carrier IDs are taken from the derived segment pool.

### Analysis

Use only public:

1. intro;
2. board result dialogue in board order;
3. outro.

No answer keys, thresholds, scoring, unlocks, or private `assetRefs` are added to IPC.

## Character grouping

For every normalized character with `portraitMode: portrait`, show:

- ID and display names;
- identity `visualPrompt`;
- configured expressions and expression prompts;
- portrait asset ID from compiler-owned `portraitAssetId()`;
- `expectedPath()` / `publicPath()`;
- present/missing state via fixed-root file snapshot;
- portrait usage count + scene usages;
- related sprite usages where manifest type/identity corresponds to that character.

Configured-but-unused expressions are neutral: `0 usages`, no warning.

`portraitMode: none` characters do not render empty expression grids.

## Asset inspector

For a referenced asset, display:

- asset ID and projected kind;
- expected/public path from manifest;
- present/missing state;
- manifest source key/value metadata;
- four manifest prompt parts;
- manifest final prompt;
- usages;
- existing compiler diagnostics relevant to the asset.

Actions:

- Copy prompt.
- Copy source reference.
- Select usage to switch current scene.

No OS opener and no editing path in HPA-134.

## Diagnostics

Surface only existing facts:

- compiler `report.json` warnings;
- missing expected file;
- unresolved manifest join;
- YAML parse/root-shape failure from the shared compiler normalizer.

Do not label unused expressions, unapproved assets, missing candidates, or other invented states as invalid.

## Refresh and state

Assets owns its own snapshot and component-local stale-response generation counter.

Do not merge it into Reader's bundle cache.

When entering Assets:

- current chapter/scene selection is reused;
- no Stage loading is triggered;
- no Reader scene load is triggered by Assets itself.

When leaving Reader for **any** non-Reader mode, invalidate pending Reader cache writes using HPA-634's existing epoch rule.

No watcher/polling is added.

## UI

Add exactly one new functional mode:

```text
Reader | Assets | Stage
```

Use an explicit type:

```ts
type WorkbenchMode = "reader" | "assets" | "stage";
```

Do not retain the current implicit `mode !== "reader" => Stage` assumption.

`AssetsView` contains three local sections only:

```text
Scene cues | Library | Characters
```

No router or docking framework.

## Verification strategy

The highest-risk behavior is the projection walk, so verification is centered there.

Required:

```text
bun run scenes:compile
bun run --cwd apps/layout-editor test
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run editor:check
bun run editor:build
bun run test:scripts
bun run lint:all
```

`bun run audio:validate` is **not** a HPA-134 gate: it requires an explicit sound-plan path and HPA-134 does not change sound plans.

`bun run background-cues:audit` is optional corpus smoke only. It is not a substitute for the required asset-carrier completeness tests.

Required focused tests include:

- shared YAML normalizer parity with existing compiler semantics;
- referenced manifest prompt/path/source preservation;
- configured-unused portrait path construction through compiler owners;
- scene cue order for all public scene types;
- every asset-bearing derived dialogue segment is consumed;
- explicit non-dialogue structural asset coverage;
- BGM/BGS Set/Stop/Inherit;
- sprite vs baked layout handling;
- audio `source.channel` classification + SFX exclusion;
- usage aggregation/dedupe;
- unresolved manifest usage remains visible;
- character grouping;
- missing files;
- stale-safe Assets Refresh;
- Reader/Assets/Stage mode isolation.

## Non-goals

- No source editing.
- No prompt/YAML editing.
- No image/audio generation.
- No candidate gallery or approval workflow.
- No provider calls.
- No asset publishing/release packaging.
- No waveform editor or audio mixing UI.
- No catalog-only SFX browser.
- No generic DAM.
- No second character/audio registry.
- No independent asset validation engine.
- No Plan mode or AI review.
- No Chapter 2 authoring framework.

## Acceptance

HPA-134 is ready when:

1. a selected scene shows ordered background/BGM/BGS/portrait/evidence/sprite cues without silent dialogue-carrier gaps;
2. referenced assets show canonical manifest prompt/path/source and present/missing state;
3. usages answer where an asset is reused;
4. character grouping shows compiler-normalized identity/expressions, including neutral unused expressions;
5. BGM/BGS are classified from canonical manifest source metadata;
6. missing/unresolved states are explicit without new validity policy;
7. Reader and Stage behavior remain unchanged;
8. all work remains in the single HPA-134 PR.