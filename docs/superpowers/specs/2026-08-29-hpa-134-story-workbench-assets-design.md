# HPA-134 Story Workbench Assets Design

## Status

Planning design for **HPA-134 — [Story Workbench] Inspect scene assets, prompts, portraits, audio, and usage**.

This remains one ticket and one PR. Planning lands first; implementation continues on the same branch/PR.

## Goal

Add one read-only **Assets** mode so an author can answer four questions without leaving Story Workbench:

1. What visual/audio assets does the selected scene cue, and in what authored order?
2. What is the canonical prompt/path/source for a referenced asset?
3. Where else is that asset reused?
4. For portrait-bearing characters, which configured expressions exist, which files exist, and where are they used?

Do this without a second asset database, second scene model, prompt workflow, generation provider, or generic DAM.

## Why HPA-134 is next

HPA-634 already supplies the shell, canonical scene navigation, ID-based Tauri boundary, Reader, Stage, Refresh, and public Analysis sanitizer.

```text
HPA-634 Reader + Stage
   ├─> HPA-134 Assets
   └─> HPA-273 Plan

HPA-634 + HPA-134
   └─> HPA-135 focused source edits
```

HPA-134 therefore removes the next dependency on the main authoring path while staying independent from deferred Chapter 2 implementation.

## Decision summary

The product scope stays unchanged. The implementation ownership is tightened to reuse existing structural owners:

```text
load_asset_workspace
        ↓
projectReaderScene()            # one authored-order scene/carrier walk
  ├─ Reader groups/items        # HPA-634 display model
  └─ presentation facts         # HPA-134 visual/audio refs; Reader ignores these
        ↓
projectAssetWorkspace()         # joins, usage aggregation, grouping, diagnostics
        ↓
AssetsView

Reader | Assets | Stage
```

Key decisions:

- one fixed-domain Assets snapshot, not manifest data stuffed into every `load_scene_bundle`;
- one scene/carrier walk, owned by `reader-projection.ts`, not a second Assets scene-type switch;
- Reader keeps its strict existing `SegmentPool.assertFullyConsumed()` dialogue completeness contract;
- non-dialogue presentation coverage gets an independent generic oracle test modeled on the existing recursive background-cue audit;
- compiler-owned YAML normalization is shared instead of adding an editor parser;
- `AssetManifestEntry` becomes type-safe at compile time without changing serialized manifest JSON;
- portrait identity construction/parsing belongs to `@lyra/asset-paths`;
- real-corpus projection verification runs at the end of the projection task, not only during final manual smoke;
- final gates do not include the invalid argument-less `audio:validate` command.

## Current owners to reuse

### Workbench shell and domain IPC

Reuse:

- `apps/layout-editor/src/App.svelte` — selection + Workbench mode shell;
- `apps/layout-editor/src/lib/workbench-api.ts` — ID-based Tauri calls;
- `apps/layout-editor/src/lib/workbench-types.ts` — public scene/Reader payloads;
- `apps/layout-editor/src/lib/reader-projection.ts` — the existing compiler-typed authored-order scene walk and carrier spelling;
- `apps/layout-editor/src-tauri/src/lib.rs` — workspace root, manifest resolution, public Analysis sanitization, layout I/O.

Rust remains a filesystem/domain boundary. TypeScript owns author-facing projection.

### One scene walk: Reader structure plus presentation facts

HPA-634 already implemented the expensive structural walk in `projectReaderScene()`:

- linear queue;
- investigation intro/outro, sublocations, transitions, hotspots, topics, inventory branches;
- interrogation intro/outro, phases, questions, testimony carriers, inventory branches;
- public Analysis intro/result/outro.

It also already owns compiler carrier identity through `deriveDialogueSegments()`, `readerSegmentId()`, `SegmentPool.take()`, and strict `SegmentPool.assertFullyConsumed()`.

HPA-134 must **extend this walk**, not reproduce it in `asset-workspace.ts`.

The existing HPA-634 statement that presentation data is not copied into Reader items remains true. Instead, add a sibling presentation fact stream to the projection result:

```ts
type ReaderPresentationFact =
  | {
      kind: "dialogueAssetCue";
      carrierId: string;
      itemIndex: number;
      cue: VisualAssetCue;
    }
  | {
      kind: "dialoguePortrait";
      carrierId: string;
      itemIndex: number;
      portrait: PortraitRef;
    }
  | {
      kind: "structuralVisualCue";
      carrierId: string;
      backgroundAssetId: string | null;
      bgm: AudioCue | null;
      bgs: AudioCue | null;
    }
  | {
      kind: "subjectPortrait";
      carrierId: string;
      portrait: PortraitRef;
    }
  | {
      kind: "evidenceImage";
      carrierId: string;
      imageAssetId: string;
    }
  | {
      kind: "sprite";
      carrierId: string;
      characterId: string;
      assetId: string;
    };
```

Exact names may adjust during implementation, but preserve these ownership properties:

- presentation facts are produced while the existing Reader walk is already visiting the node;
- dialogue facts are collected from the raw compiler `JSONDialogueItem[]` before `projectDialogue()` strips presentation for Reader display;
- structural facts are emitted at the existing sublocation/phase/evidence/character loop sites;
- Reader groups/items and their rendered behavior stay unchanged;
- `asset-workspace.ts` does not switch on scene type or derive carrier IDs.

`ReaderScene` may carry the sibling list directly (for example `presentation: ReaderPresentationFact[]`). `reader-view.ts` continues to filter/render only Reader groups/items and does not expose presentation data in Reader UI.

### Dialogue completeness

Keep the current strict Reader contract:

1. `deriveDialogueSegments()` supplies every non-empty compiler dialogue carrier for linear/investigation/interrogation;
2. the Reader walk consumes them via `SegmentPool.take(readerSegmentId(...))`;
3. `assertFullyConsumed()` fails on **any** leftover compiler carrier, whether or not it currently contains an asset.

Do not add `AssetSegmentPool` and do not weaken the assertion to “asset-bearing only”. Empty asset output is a downstream display decision, not a reason to weaken structural completeness.

Public Analysis remains special because the Rust IPC deliberately exposes a sanitized `PublicAnalysisScene`. The existing `projectPublicAnalysis()` walk is the owner for its public structure; presentation facts come only from public intro/result/outro dialogue. Do not cast public Analysis back to private `JSONAnalysisScene` or expose `assetRefs`/answer data.

### Structural completeness oracle

`deriveDialogueSegments()` cannot prove non-dialogue asset coverage. Add an **independent test-only recursive oracle**, modeled on `collectBackgroundCues()` in `packages/scripts/compile-scenes/background-cues-audit.ts`.

The oracle recursively scans compiled public scene values for presentation-bearing fields rather than hand-maintaining one test per scene field. It must account for:

- `backgroundAssetId`;
- `bgm` / `bgs` authored cue values;
- evidence `imageAssetId`;
- resolved line/subject `portrait`;
- `sceneTag.assetCue`;
- `layout.kind === "sprite"` `assetId`;
- baked layouts as explicitly non-asset-bearing.

Compare the raw-scene fact multiset with `ReaderScene.presentation` so a newly-added structural presentation field cannot silently disappear from Assets. Keep this oracle in tests; it is not another production scene walker.

### Compiler-owned scene asset semantics

Do not add new scene cue syntax. Existing compiled data already distinguishes:

```text
cue/field is null            -> Inherit
{ assetId: null }            -> Stop
{ assetId: concrete }        -> Set
```

for BGM/BGS where a visual cue exists. Do not simulate effective cross-scene or cross-chapter playback.

Only `layout.kind === "sprite"` carries a layout asset ID. Baked layouts do not create sprite usages. Sprite IDs may resolve to standee, portrait, evidence, or background; type comes from the manifest join.

### Generated asset manifest/report

The compiler already writes:

```text
apps/game/src-tauri/resources/assets/manifest.json
apps/game/src-tauri/resources/assets/report.json
```

`manifest.json` remains authoritative for referenced assets. HPA-134 does not add `assets-workbench.json` or another editor manifest.

#### Type the existing manifest source without changing JSON

Today `AssetManifestEntry.source` is `Record<string, string>`, while HPA-134 makes audio `source.channel` and `source.id` load-bearing. Fix the type boundary while `manifest.ts` / `enrich.ts` are already open, but **do not add a serialized `source.kind` field**.

Use the existing parent `type` as the discriminant:

```ts
type SceneAssetSource = {
  chapterId: string;
  sceneId: string;
};

type AudioAssetSource = SceneAssetSource & {
  channel: AudioChannel;
  id: string;
};

type PortraitAssetSource = SceneAssetSource & {
  characterId: string;
  expression: string;
};

type AssetManifestEntry =
  | AssetManifestEntryOf<"audio", AudioAssetSource>
  | AssetManifestEntryOf<"portrait", PortraitAssetSource>
  | AssetManifestEntryOf<"standee", StandeeAssetSource>
  | AssetManifestEntryOf<"evidence", EvidenceAssetSource>
  | AssetManifestEntryOf<"background", BackgroundAssetSource>;
```

Background/evidence source types may remain small unions of their existing emitted shapes (`unitId` vs sprite `characterId`, `evidenceId` vs sprite `characterId`). No new runtime property is needed.

Consequences:

- `entry.type === "audio"` narrows `source.channel/source.id` statically;
- a compiler-side rename of those keys fails TypeScript rather than silently breaking Assets;
- manifest JSON bytes can remain unchanged;
- UI can still display `Object.entries(source)` as canonical key/value metadata.

### Canonical asset configuration

Canonical config remains:

```text
static/assets/config/policy.yaml
static/assets/config/characters.yaml
static/assets/config/audio.yaml
```

Policy prompts are already composed into manifest entries, so the Workbench does not parse `policy.yaml`.

For `characters.yaml` and `audio.yaml`, do not add a second parser in `apps/layout-editor`. Extract browser-safe normalization from `packages/scripts/compile-scenes/assets/config.ts` into a filesystem-free compiler module, for example:

```text
packages/scripts/compile-scenes/assets/config-catalog.ts
```

with pure text APIs such as:

```ts
parseCharactersYamlText(text, sourceFile)
parseAudioYamlText(text, sourceFile)
```

The shared normalizer preserves existing compiler semantics:

- flattened/trimmed `displayNames`;
- `portraitMode` defaulting;
- expression maps;
- `visualPrompt` / `referenceAssetId` normalization;
- BGM/BGS/SFX maps;
- audio `loop` defaulting to `true` when omitted.

Ownership remains:

- pure module: YAML parse + catalog normalization;
- `loadAssetConfig()`: filesystem reads and compiler validity policy;
- Workbench: consume normalized catalog and convert read failure to a Workbench diagnostic;
- no editor-side enforcement of required `standard`, slug, duplicate-ID/display-name, enabled policy, or approval status.

Do not reuse `packages/scripts/audio/audio-catalog.ts`: it requires explicit boolean `loop`, while compile-scenes defaults omitted `loop` to `true`.

The important invariant is **one compile-scenes asset-config normalizer owner**, not whether `yaml` is physically present transitively in the Vite bundle. `apps/layout-editor` should not directly import `yaml` or call `YAML.parse`.

### Static asset ID/path ownership

`@lyra/asset-paths` declares itself the single owner for asset ID/path conventions, so portrait construction/parsing belongs there rather than in a new compile-scenes `identity.ts`.

Add narrowly:

```ts
portraitAssetId(characterId, expression)
parsePortraitAssetId(assetId)
```

and reuse `parsePortraitAssetId()` inside `publicPathForAssetId()` plus the existing portrait-layout enrichment path. `registerPortraitRef()` uses `portraitAssetId()`.

When compiler code needs its existing domain-specific error code/message, catch/translate the shared parser failure rather than letting a generic error escape.

For configured-but-unreferenced portrait expressions:

- build the ID with `portraitAssetId()`;
- derive repo/public paths with existing `expectedPath()` / `publicPath()` from compiler `manifest.ts`.

For referenced assets:

- manifest `expectedPath` / `publicPath` / prompts / source remain authoritative and are displayed verbatim.

Audio config joins use typed `entry.type === "audio"` plus `entry.source.channel` / `entry.source.id`; never guess `audio.${channel}.${id}` in the editor. Filter SFX by typed channel metadata.

## Selected architecture

```text
canonical scene Markdown
characters/audio YAML
        │
        ▼
existing compiler
        │
        ├─ compiled scenes
        ├─ resources/assets/manifest.json
        └─ resources/assets/report.json
                 │
                 ▼
      load_asset_workspace       # fixed-root Rust snapshot
                 │
                 ▼
       projectReaderScene()       # single structure/carrier owner
        ├─ Reader groups/items
        └─ presentation facts
                 │
                 ▼
      projectAssetWorkspace()     # joins + usage/grouping/diagnostics
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
2. `load_manifest_chapters()` for manifest order/canonical source paths;
3. `load_scene_bundle_at_root()` for public scene payloads and Analysis sanitization.

`existingAssetPaths` is a deterministic repo-relative list of regular files beneath fixed `static/assets`. It is presence-only; it never populates the Library.

Missing generated `manifest.json` or `report.json` is a loud domain error telling the developer to compile scenes. Do not fall back to loose-file discovery.

## TypeScript asset projection

Add:

```text
apps/layout-editor/src/lib/asset-workspace.ts
```

Primary API:

```ts
projectAssetWorkspace(payload): AssetWorkspace
```

For each snapshot scene it calls the existing `projectReaderScene()` and consumes `ReaderScene.presentation`. It does **not** have a scene-type switch.

Responsibilities:

- call compiler-owned character/audio YAML normalizers;
- preserve manifest prompts/paths/source exactly;
- map ordered Reader presentation facts into scene cues;
- project BGM/BGS Set/Stop/Inherit;
- join referenced assets through the typed manifest;
- aggregate/deduplicate usage;
- group portrait expressions by normalized character config;
- report file presence and failed joins;
- retain compiler report diagnostics.

It does not own scene structure, carrier spelling, asset identity spelling, or validity/approval policy.

## Library and usage model

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

Referenced Library rows come from manifest entries only. Catalog-only SFX remains out of scope.

A usage is a concrete occurrence:

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

Deduplicate only exact duplicate occurrence keys. Dialogue usages retain item identity; UI may group counts by scene later.

## Cue ordering

Ordering comes from `ReaderScene.presentation`, which is emitted during the existing authored-order Reader walk. Assets does not reconstruct ordering itself.

- Linear: `main` dialogue order.
- Investigation: intro; sublocation structural cue; transition/hotspot/topic carriers and sprite facts in the same structural visit; evidence image/inventory branches; outro.
- Interrogation: intro; phase structural cue + subject portrait; entry/question/testimony carriers; evidence image/inventory branches; outro.
- Analysis: public intro; board result dialogue in board order; outro.

No answer keys, thresholds, scoring, unlocks, or private `assetRefs` are added to IPC.

## Character grouping

For every normalized character with `portraitMode: portrait`, show:

- ID and display names;
- `visualPrompt`;
- configured expressions + prompts;
- asset ID from `@lyra/asset-paths` `portraitAssetId()`;
- `expectedPath()` / `publicPath()`;
- present/missing state;
- portrait usage count + scenes;
- related sprite usages where the manifest/parsed portrait identity matches.

Configured-but-unused expressions are neutral: `0 usages`, no warning. `portraitMode: none` does not render an empty portrait grid.

## Asset inspector

For a referenced asset, display:

- asset ID and kind;
- manifest expected/public path;
- present/missing state;
- typed manifest source metadata;
- four manifest prompt parts;
- manifest final prompt;
- usages;
- relevant existing compiler diagnostics.

Actions are limited to:

- Copy prompt.
- Copy source reference.
- Select usage to switch current scene.

No OS opener and no editing path in HPA-134.

## Diagnostics

Surface only existing facts:

- compiler `report.json` warnings;
- missing expected file;
- unresolved manifest join;
- shared YAML read/normalization failure.

Do not invent approval/status policy or warn on unused expressions.

## Refresh and mode ownership

Assets owns its own snapshot and component-local stale-response generation counter. Do not merge it into Reader's bundle cache.

Add exactly one new functional mode:

```text
Reader | Assets | Stage
```

with:

```ts
type WorkbenchMode = "reader" | "assets" | "stage";
```

When leaving Reader for **any** non-Reader mode, invalidate pending Reader cache writes using HPA-634's existing epoch rule.

Assets scene selection changes current selection only; it does not trigger Reader or Stage loading. Entering Stage retains current investigation/non-investigation behavior. No watcher/polling is added.

`AssetsView` has three local sections only:

```text
Scene cues | Library | Characters
```

No router/docking framework.

## Verification strategy

### Task-local output stability

The YAML-normalizer and portrait-ID refactors feed generated manifest output. Before Task 2 refactors, compile current corpus and record the fresh `manifest.json` Git blob hash. Recompile after the refactor and require the hash to be identical.

This proves the ownership extraction did not change existing emitted IDs/prompts/source/path data. The typed manifest-source change is type-only and must not add serialized fields.

### Task-local real-corpus projection

Add:

```text
apps/layout-editor/scripts/verify-asset-real-content.ts
```

and package script:

```text
verify:asset-real-content
```

Mirror the existing Reader real-content verifier, but exercise the Assets projection immediately after Task 3:

- read fresh generated chapter/scenes + asset manifest/report + characters/audio text;
- run every compiled **non-Analysis** scene through the single Reader/presentation projection and Assets projection;
- require no carrier/presentation completeness failures;
- require concrete referenced presentation facts to either join the manifest or surface the intended unresolved diagnostic.

The script deliberately skips raw compiled Analysis rather than recreating the Rust public whitelist in TypeScript. Analysis is covered by the Rust sanitizer test plus `PublicAnalysisScene` projection fixtures and final GUI smoke.

### Required final gates

```text
bun run scenes:compile
bun run check:scripts
bun run test:scripts
bun run --cwd apps/layout-editor test
bun run --cwd apps/layout-editor verify:reader-real-content
bun run --cwd apps/layout-editor verify:asset-real-content
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run editor:check
bun run editor:build
bun run lint:all
```

`bun run audio:validate` is not a HPA-134 gate: it requires an explicit sound-plan path and HPA-134 does not modify sound plans.

`bun run background-cues:audit` is optional corpus smoke. Its recursive traversal pattern is reused conceptually by the structural completeness test, but its CLI result is not Assets acceptance.

### Parser-owner closeout check

Do not assert that YAML is absent transitively from the editor bundle; `@lyra/scripts` already depends on it. Assert the actual property:

- `apps/layout-editor` contains no direct `yaml` import / `YAML.parse` for asset config;
- within `packages/scripts/compile-scenes/assets`, the extracted `config-catalog.ts` is the sole YAML parse owner after the refactor;
- existing unrelated sound-plan/audio-catalog parsers remain untouched.

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

1. `projectReaderScene()` remains the single authored-order scene/carrier walk and emits all public presentation facts needed by Assets;
2. strict compiler dialogue carrier consumption remains intact;
3. the generic structural oracle proves every relevant public compiled presentation field is represented;
4. a selected scene shows ordered background/BGM/BGS/portrait/evidence/sprite cues;
5. referenced assets show canonical manifest prompt/path/source and present/missing state;
6. manifest audio source metadata is statically typed without changing serialized output;
7. usages answer where an asset is reused;
8. character grouping shows normalized identity/expressions, including neutral unused expressions;
9. real compiled non-Analysis content passes the headless Assets verifier before UI integration;
10. Reader and Stage visible behavior remain unchanged;
11. all work remains in the single HPA-134 PR.
