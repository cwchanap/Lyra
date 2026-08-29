# HPA-134 Story Workbench Assets Design

## Status

Planning design for **HPA-134 — [Story Workbench] Inspect scene assets, prompts, portraits, audio, and usage**.

This is the second Story Workbench slice after HPA-634. It remains one ticket and one PR: this design and the implementation plan land first on the branch, then implementation continues on the same branch/PR.

## Goal

Add one read-only **Assets** mode to Lyra Story Workbench so an author can answer four practical questions without leaving the tool:

1. What visual/audio assets does the selected scene actually cue, and in what story order?
2. What is the canonical generated prompt/path/source for a referenced asset?
3. Where else is that asset reused?
4. For portrait-bearing characters, which configured expressions exist, which files exist, and where are they used?

The implementation must reuse current compiler output and authored YAML/Markdown. It must not create a second asset database, a prompt-approval system, a generation provider, or a generic DAM.

## Why HPA-134 is the next Story Workbench slice

HPA-634 has landed and now provides the required shell, canonical story-root navigation, manifest-ID scene resolution, public Analysis sanitization, Reader, Stage, Refresh, and a compiler-typed TypeScript projection boundary.

The HPA-639 dependency order is intentionally:

```text
HPA-634 Reader + Stage
   ├─> HPA-134 Assets
   └─> HPA-273 Plan

HPA-634 + HPA-134
   └─> HPA-135 focused source edits
```

HPA-134 therefore unlocks both focused source editing and the later AI-review slice, while staying independent from Chapter 2 recanon work. Chapter 2 production remains gated by its separate milestone.

## Current owners to reuse

### Workbench shell and domain IPC

Current `apps/layout-editor` already has:

- `apps/layout-editor/src/App.svelte` owning the Reader/Stage mode switch and scene selection;
- `apps/layout-editor/src/lib/workbench-api.ts` exposing ID-based Tauri calls;
- `apps/layout-editor/src/lib/workbench-types.ts` typing the public scene payload;
- `apps/layout-editor/src/lib/reader-projection.ts` proving that compiler-owned TypeScript types can be projected into an author-facing read model;
- `apps/layout-editor/src-tauri/src/lib.rs` owning workspace-root resolution, manifest ID/path containment, public Analysis sanitization, and investigation-layout I/O.

HPA-134 extends this ownership. It does not add arbitrary-path IPC or a second shell/router.

### Compiler-owned scene asset semantics

The compiler already emits all scene-level semantics needed for an Assets view:

- every scene has `assetRefs`;
- a dialogue `sceneTag` may carry a visual asset cue;
- investigation sublocations emit `backgroundAssetId`, `bgm`, and `bgs`;
- interrogation phases emit the same visual/audio fields;
- dialogue lines emit a resolved `PortraitRef` with `characterId`, expression, and asset ID;
- investigation/interrogation evidence manifests emit `imageAssetId`;
- investigation character layouts can carry sprite/standee asset IDs;
- Analysis dialogue is asset-enriched by the same compiler pipeline.

The existing `AudioCue | null` shape already distinguishes the three states HPA-134 needs:

```text
cue field is null                -> inherit / no authored change here
cue.assetId is null              -> explicit stop / none
cue.assetId is a concrete ID     -> set this BGM/BGS
```

No new scene cue schema is required.

### Generated asset manifest

`packages/scripts/compile-scenes/assets/manifest.ts` already produces:

```ts
AssetManifestEntry {
  assetId
  type
  source
  expectedPath
  publicPath
  promptParts {
    globalStyle
    typePrompt
    subjectPrompt
    entryPrompt
  }
  finalPrompt
}
```

Production compilation writes the manifest to:

```text
apps/game/src-tauri/resources/assets/manifest.json
```

and the existing compiler asset report to:

```text
apps/game/src-tauri/resources/assets/report.json
```

Those two generated files remain the generated source for referenced asset metadata and compiler diagnostics. HPA-134 does not add another generated Workbench manifest.

### Canonical authored asset config

The current canonical configs remain:

```text
static/assets/config/policy.yaml
static/assets/config/characters.yaml
static/assets/config/audio.yaml
```

The compiler already resolves policy prompts into each manifest entry, so Assets mode does **not** need to parse `policy.yaml` independently. It only needs raw read access to:

- `characters.yaml` for portrait-bearing characters and all configured expressions, including configured-but-currently-unused expressions;
- `audio.yaml` for referenced BGM/BGS prompt/loop metadata.

The Workbench will parse those two fixed YAML documents only as a read projection. Compiler validation remains authoritative; the Workbench does not create a second validation policy.

### Static asset serving

`apps/layout-editor/vite.config.ts` already uses:

```text
publicDir: ../../static
```

and `@lyra/asset-paths` already owns public path construction. Existing images/audio can therefore be previewed through the same `/assets/...` paths without another file-serving layer.

## Reuse survey and rejected approaches

### Option A — add manifest/config data to every `load_scene_bundle`

**Rejected.**

It would duplicate the same global asset manifest and config data into every scene load, couple Reader payloads to Assets concerns, and make Reader Refresh responsible for unrelated global state.

### Option B — one read-only Assets snapshot command + TypeScript projection

**Selected.**

Add one fixed-domain Tauri command that returns the existing generated asset metadata, canonical config source text, public scene payloads, and file-presence information. Keep all author-facing cue/usage/grouping logic in a pure TypeScript projection, mirroring HPA-634's Reader ownership.

Benefits:

- one local IPC read instead of N cross-mode cache calls;
- no arbitrary path input;
- Analysis continues through the existing public sanitizer;
- no Reader cache refactor;
- no compiler artifact or source-of-truth change;
- easy unit testing of projection semantics.

### Option C — emit an `assets-workbench.json`/asset database

**Rejected.**

The current manifest, compiled scenes, and YAML already contain the data. A new artifact would be a second read model that has to remain synchronized and would move editor-only concerns into the production compile contract.

## Selected architecture

```text
canonical scene Markdown
canonical characters/audio YAML
        │
        ▼
existing scene compiler
        │
        ├─ compiled public scene data
        ├─ resources/assets/manifest.json
        └─ resources/assets/report.json
                 │
                 ▼
     load_asset_workspace       # one fixed-domain Tauri read command
                 │
                 ▼
      asset-workspace.ts        # pure TypeScript projection
                 │
       ┌─────────┼─────────┐
       ▼         ▼         ▼
   Scene cues  Asset list  Character grouping
       │         │         │
       └─────────┴─────────┘
                 ▼
            AssetsView.svelte
```

### Rust responsibility

Rust remains a filesystem/domain boundary, not an asset-domain implementation.

The new command should be named:

```text
load_asset_workspace
```

It takes no arbitrary path and no asset ID. It resolves everything under the already-known Lyra workspace root.

Its response should contain:

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

`existingAssetPaths` is only a file-presence aid. It is a repo-relative set of files beneath `static/assets/`; it must never become a browser/catalog source of truth. The asset browser still comes only from referenced manifest entries, while configured character expressions use this set to distinguish present/missing expected files.

The command reuses existing helpers rather than adding parallel resolution logic:

1. `workspace_root()` resolves the repository.
2. `load_manifest_chapters()` owns chapter/scene order and canonical source paths.
3. `load_scene_bundle_at_root()` loads each scene and applies the existing Analysis public sanitizer.
4. fixed constants resolve `resources/assets/manifest.json`, `resources/assets/report.json`, `characters.yaml`, and `audio.yaml`.
5. a small recursive helper lists regular files under `static/assets/` for file-presence checks.

No canonical Markdown/YAML is writable in HPA-134.

### TypeScript responsibility

Add a pure projection module, tentatively:

```text
apps/layout-editor/src/lib/asset-workspace.ts
```

It owns:

- YAML read projection for characters and BGM/BGS;
- scene cue extraction in compiled semantic order;
- BGM/BGS set/stop/inherit presentation;
- portrait/expression usage extraction;
- evidence-image usage extraction;
- investigation sprite/standee usage extraction;
- manifest join;
- usage aggregation and deduplication;
- missing/unresolved presentation states;
- character/expression grouping;
- source-reference projection.

This module must not decide whether a configured-but-unused expression is invalid. It only states what exists, what is referenced, and what file is present.

## Read-model shape

Exact naming can be adjusted during implementation, but keep the model narrow.

### Asset type exposed to the UI

```ts
type WorkbenchAssetKind =
  | "background"
  | "portrait"
  | "standee"
  | "evidence"
  | "bgm"
  | "bgs";
```

The compiler manifest's generic `audio` type is projected to `bgm`/`bgs` from its canonical `audio.<channel>.<id>` identity/source metadata. SFX is explicitly filtered from HPA-134.

### Asset item

```ts
type WorkbenchAsset = {
  assetId: string;
  kind: WorkbenchAssetKind;
  expectedPath: string;
  publicPath: string;
  present: boolean;
  promptParts: AssetManifestEntry["promptParts"];
  finalPrompt: string;
  manifestSource: Record<string, string>;
  promptSources: SourceReference[];
  usages: AssetUsage[];
  diagnostics: AssetDiagnostic[];
};
```

The manifest remains canonical for prompt composition and paths. The Workbench never recomposes a "better" prompt.

### Usage item

A usage is a concrete authored/compiled occurrence, not an asset registry record:

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

Usage keys are deduplicated by stable scene/carrier/role/item identity. Reusing the same image in ten dialogue lines can still report ten dialogue occurrences while grouped scene counts remain concise in the UI.

### Scene cue item

The selected-scene cue list is intentionally not a timeline editor.

```ts
type SceneAssetCue = {
  id: string;
  carrierId: string;
  carrierLabel: string;
  sourceReference: SourceReference;
  backgroundAssetId?: string;
  bgm: AudioChange;
  bgs: AudioChange;
  portrait?: {
    characterId: string;
    expression: string;
    assetId: string;
  };
  evidenceAssetId?: string;
};

type AudioChange =
  | { kind: "inherit" }
  | { kind: "stop" }
  | { kind: "set"; assetId: string };
```

Do not add duration, tracks, draggable positions, waveform data, or video-editor semantics.

## Cue ordering rules

The projection must preserve the scene's compiler/authored order, not sort by asset ID.

### Linear

Walk queue items in order:

- scene tags create visual/audio cue rows;
- portrait rows are created when a resolved portrait/expression changes;
- consecutive identical portrait state may collapse in the scene cue display, while the usage index still records concrete line occurrences.

### Investigation

Use existing scene structure in this order:

1. intro dialogue cues;
2. each sublocation's structural background/BGM/BGS cue;
3. that sublocation's transition/hotspot/topic dialogue cues in authored order;
4. evidence/statement branch dialogue cues;
5. evidence image references;
6. outro dialogue cues.

Investigation character sprite layouts add standee/portrait/evidence/background usages where present, but do not create a second layout model.

### Interrogation

Use:

1. intro dialogue cues;
2. each phase's structural background/BGM/BGS cue and subject portrait;
3. phase entry/question/testimony branch dialogue cues in compiler order;
4. evidence/statement branch dialogue cues;
5. evidence image references;
6. outro dialogue cues.

### Analysis

Only the existing public writer payload is traversed:

1. intro;
2. board result dialogue in board order;
3. outro.

HPA-134 must not widen Analysis IPC to expose accepted mappings, thresholds, scoring rules, or runtime progression data just to inspect assets.

## Audio semantics

Assets mode shows **authored change semantics**, not a new audio runtime simulation.

For both BGM and BGS:

| Compiled value | Assets label |
|---|---|
| field/cue is `null` | `Inherit` |
| cue exists and `assetId === null` | `Stop` |
| cue has asset ID | `Set: <asset>` |

Do not infer cross-chapter effective playback state in this PR. If a cue says inherit before any local set is visible, display `Inherit` rather than synthesizing a previous asset.

Audio inspector scope is referenced BGM/BGS only:

- canonical prompt/loop metadata from `audio.yaml`;
- manifest-composed prompt and path;
- native browser `<audio controls>` audition when present;
- scene usages.

Catalog-only SFX remains out of scope.

## Character/expression grouping

The **Characters** view is a different grouping over the same source data, not a second asset registry.

For every `characters.yaml` entry with `portraitMode: portrait`, show:

- character ID and display name(s);
- identity `visualPrompt`;
- every configured expression ID and expression prompt;
- expected portrait asset ID `portrait.<characterId>.<expression>`;
- expected/public path via `@lyra/asset-paths`;
- present/missing state via `existingAssetPaths`;
- dialogue usage count and grouped scene usages;
- standee usages whose asset ID belongs to the same character.

Configured-but-unused expressions are normal. Display `0 usages`; do not label them warnings.

Characters with `portraitMode: none` do not need empty portrait grids.

## Manifest, source, and prompt references

The UI should show source ownership without pretending generated manifest metadata is a line-accurate source map.

### Manifest source

Always display the manifest's existing `source` key/value data, such as:

```text
chapterId
sceneId
unitId
evidenceId
characterId
expression
channel
id
```

### Canonical prompt-source references

Project simple source references from existing ownership:

- `globalStyle` and `typePrompt` -> `static/assets/config/policy.yaml`;
- portrait/standee identity and expression prompts -> `static/assets/config/characters.yaml`;
- BGM/BGS prompt -> `static/assets/config/audio.yaml`;
- scene background/evidence entry prompt -> the manifest source's chapter/scene canonical Markdown path;
- usage rows -> that usage scene's canonical Markdown path plus semantic carrier label/ID.

No new line-number parser is required.

### Source actions scope lock

HPA-134 provides:

- copy final prompt;
- copy canonical source path/reference;
- selecting a usage switches the Workbench's selected scene so the author can inspect it in Reader/Assets.

Do **not** add a Tauri file-opener/shell plugin only for this slice. Native source editing/navigation belongs to HPA-135. This keeps HPA-134 read-only and avoids temporary OS integration that the next ticket would replace.

## Diagnostics

HPA-134 surfaces existing facts and joins; it does not invent validity policy.

### Compiler report

Render existing `report.json` warnings in an Assets diagnostics area. Keep the compiler code/message/source intact.

### Missing files

For a referenced manifest asset, `present` is based on whether its existing expected path is in the fixed-root file snapshot. Show a clear missing-file state instead of a broken thumbnail/audio control.

For configured portrait expressions, compute the existing canonical path and use the same presence set.

### Unresolved joins

If a scene usage references an asset ID that is absent from the manifest, surface a Workbench projection diagnostic such as:

```text
Referenced asset is not present in the generated asset manifest.
```

This is not new compiler policy; it is a failure to join two existing sources and must not be silently hidden.

If manifest prompt/source fields are empty, display them as absent. Do not decide that they make an asset invalid unless the existing compiler report says so.

## UI design

Add **Assets** to the existing mode bar:

```text
Reader | Assets | Stage
```

No router/docking framework is introduced.

### Assets mode layout

Keep one `AssetsView.svelte` with three small local tabs/sections:

1. **Scene cues** — current selected scene's ordered visual/audio/portrait/evidence cues.
2. **Library** — referenced manifest assets filtered by kind/search; selected asset inspector and grouped usages.
3. **Characters** — character/expression matrix/grouping.

This is enough to prove the workflow without a separate DAM-style navigation system.

### Scene cues

Each cue row should show only useful authoring information:

- carrier/visual-unit label;
- background thumbnail if a background is set;
- BGM/BGS change chips (`Set`, `Stop`, `Inherit`);
- portrait/expression changes;
- evidence-image reference when applicable;
- source reference;
- click an asset ID/thumbnail to select it in Library.

### Library

Filters:

- kind;
- search by asset ID/path.

Inspector:

- preview/audition or explicit missing state;
- asset ID/kind;
- expected and public path;
- manifest source metadata;
- four prompt parts and final prompt;
- copy final prompt;
- canonical prompt-source references with copy action;
- grouped scene/visual-unit usage list and usage count;
- existing diagnostics relevant to that asset/path.

Do not add generation, approval, variants, candidate gallery, tags, status workflow, or asset editing.

### Characters

A compact character selector/grid is sufficient. It is not a second character editor.

For one character, show identity prompt then a table/grid of configured expressions with image/missing state, prompt, and usages. Standee usages can be a small secondary list.

## App-shell integration

`App.svelte` currently treats every non-Reader mode as Stage. HPA-134 must make mode ownership explicit rather than extending that implicit branch.

Use:

```ts
type WorkbenchMode = "reader" | "assets" | "stage";
```

Then:

- Reader selection keeps current Reader loading behavior;
- Assets selection only changes selected chapter/scene; `AssetsView` owns its current projection from the loaded asset workspace snapshot;
- Stage selection loads investigation layout only for investigation scenes;
- switching **away from Reader to either Assets or Stage** bumps the existing Reader cache-write epoch so pending Reader work cannot pollute its cache;
- switching into Stage always reloads/clears Stage for the current selection;
- switching into Assets does not mutate layout state.

Do not extract a new app-wide state framework or refactor the working Reader cache merely to add Assets.

## Assets loading and Refresh

`AssetsView` loads `load_asset_workspace` on first mount and exposes one explicit **Refresh** action, matching Reader's manual-refresh philosophy.

Refresh means "reread current compiler output and canonical asset config". It does not run the compiler or asset generator.

The existing development/build workflow already runs scene compilation where required. Assets mode should clearly report a missing generated manifest if compilation has not produced it, rather than silently falling back to filesystem guessing.

Use one local generation token in `AssetsView` so a late refresh result cannot overwrite a newer refresh. No watcher or polling.

## Interaction with open PR #77

The active Chapter 1 rhythm/audio/expression work may add or change BGM IDs, cue placements, and character expressions. HPA-134 must not encode Chapter 1-specific IDs or a fixed expression list. It reads the current manifest and YAML dynamically, so those content changes are data updates rather than architectural dependencies.

## Testing strategy

### Pure TypeScript projection tests

Add focused `asset-workspace.test.ts` coverage for:

- linear cue ordering;
- investigation structural cue + dialogue cue ordering;
- interrogation phase cue + subject portrait ordering;
- Analysis uses public dialogue only;
- BGM/BGS `set` / `stop` / `inherit` mapping;
- portrait change projection;
- evidence-image projection;
- sprite/standee usage;
- usage aggregation and deduplication;
- referenced asset missing from manifest;
- missing expected file;
- manifest prompt parts/source projection;
- configured-but-unused character expressions showing 0 usage;
- character/expression usage links;
- BGM/BGS config join with SFX excluded.

Use compiler JSON types in fixtures instead of creating a parallel scene schema.

### Assets view tests

Cover user-observable behavior:

- Assets mode renders selected-scene cues;
- selecting a cue asset opens its Library inspector;
- missing asset renders an explicit state, not a broken preview;
- audio renders an audition control only when present;
- filters/search work locally;
- copy prompt/source path actions use the clipboard boundary;
- selecting a usage requests the matching Workbench scene;
- Characters view renders configured expressions and 0-use entries;
- Refresh ignores stale responses.

### App integration tests

Extend `App.test.ts` for:

- `Reader | Assets | Stage` mode behavior;
- selecting a scene in Assets does not call Stage layout loading;
- switching Reader -> Assets invalidates pending Reader cache writes just like Reader -> Stage;
- switching Assets -> Stage correctly loads/clears the current Stage selection;
- Reader and Stage behavior stays unchanged.

### Rust tests

Add fixed-root command tests for:

- manifest/report/config source loading;
- public scene order follows chapter manifests;
- Analysis scene in the Assets snapshot remains sanitized;
- existing asset path enumeration stays under `static/assets` and ignores directories;
- missing generated manifest/report returns a clear domain error.

Do not write security-framework tests beyond the fixed-root domain contract already used by the Workbench.

## Required verification

The implementation PR must pass HPA-134's existing gates:

```text
bun run scenes:compile
bun run background-cues:audit
bun run audio:validate
bun run editor:check
bun run editor:build
bun run test:scripts
bun run lint:all
```

Also run the layout-editor's focused tests and Rust suite directly while implementing:

```text
bun run --cwd apps/layout-editor test
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
```

No new generic E2E framework is required for this read-only developer-tool slice.

## Non-goals

- No prompt/YAML/Markdown editing.
- No asset generation/provider calls.
- No candidate gallery or approval status.
- No prompt database or checked-in Workbench manifest.
- No new compiler asset artifact.
- No generic DAM/search taxonomy.
- No scene-by-asset matrix requirement.
- No waveform editor, mixing UI, or catalog-only SFX browser.
- No source-control integration.
- No OS file-opener plugin.
- No Story Plan mode; HPA-273 owns that.
- No AI review; HPA-136 owns that.
- No Chapter 2 implementation framework.

## Acceptance interpretation

HPA-134 is complete when an author can select any current public Workbench scene, see its meaningful ordered asset cues, browse referenced assets, inspect canonical prompt/path/source data, understand reuse, inspect configured character expressions, and see existing missing/unresolved states — all while current Markdown/YAML/compiler outputs remain the only sources of truth.
