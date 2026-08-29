# HPA-134 Story Workbench Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Assets mode to Lyra Story Workbench that projects current compiler scene cues, generated manifest data, canonical character/audio config, file presence, and cross-scene usage into an author-facing inspection workflow.

**Architecture:** Add one fixed-domain `load_asset_workspace` Tauri read command that reuses the current manifest scene resolver/public Analysis sanitizer and returns existing compiler outputs plus fixed canonical config sources. Keep cue ordering, prompt/source joins, usage aggregation, character grouping, and diagnostics in one pure TypeScript `asset-workspace.ts` projection. Render the projection in a single `AssetsView.svelte` and make `App.svelte` explicitly support `reader | assets | stage` without refactoring the working Reader cache or Stage store.

**Tech Stack:** Tauri 2/Rust, Svelte 5, TypeScript 5.6, existing `@lyra/scripts` compiler types, existing `@lyra/asset-paths`, existing `yaml` package, Vitest/Testing Library, Cargo tests.

**Spec:** `docs/superpowers/specs/2026-08-29-hpa-134-story-workbench-assets-design.md`

## Global Constraints

- [ ] Keep HPA-134 as **one ticket and one PR**. Continue implementation on `agent/hpa-134-story-workbench-assets-plan`; do not split backend/UI/projection into separate PRs.
- [ ] Keep canonical Markdown, `characters.yaml`, `audio.yaml`, `policy.yaml`, layout sidecars, compiler outputs, and generated asset manifest/report as the only sources of truth.
- [ ] Do not add a prompt DB, asset DB, checked-in Workbench manifest, generated `assets-workbench.json`, DAM framework, watcher, polling loop, or asset-generation provider.
- [ ] Do not add arbitrary-path Tauri commands. `load_asset_workspace` takes no workspace path and resolves fixed roots through the current Workbench boundary.
- [ ] Do not widen public Analysis data to hidden answers/progression metadata. Reuse `load_scene_bundle_at_root()`/the existing sanitizer when assembling the Assets scene snapshot.
- [ ] Do not refactor the Reader cache/state architecture merely to share scene bundles with Assets. Assets owns a separate read-only snapshot.
- [ ] Do not add an OS file-opener/shell plugin. HPA-134 copies prompt/source references; HPA-135 owns source-edit/navigation workflow.
- [ ] Do not browse catalog-only SFX. Only referenced BGM/BGS belongs in this slice.
- [ ] Do not infer new asset validity rules. Surface compiler `report.json`, explicit file presence, and failed manifest/config joins only.
- [ ] Do not hard-code Chapter 1 asset IDs/expressions/BGM values; active content PRs must flow through the current manifest/YAML dynamically.
- [ ] Preserve HPA-634 Reader/Stage behavior and all existing tests while adding the third mode.

---

## Task 1: Add the fixed-domain Assets workspace snapshot

**Files:**

- Modify: `apps/layout-editor/src-tauri/src/lib.rs`
- Modify: `apps/layout-editor/src/lib/workbench-types.ts`
- Modify: `apps/layout-editor/src/lib/workbench-api.ts`

**Interfaces:**

Add the frontend contract:

```ts
export type WorkbenchTextSource = {
  path: string;
  content: string;
};

export type WorkbenchAssetScenePayload = {
  chapterId: string;
  sceneId: string;
  sourcePath: string;
  scene: WorkbenchScenePayload;
};

export type WorkbenchAssetWorkspacePayload = {
  manifest: AssetManifest;
  report: AssetReport;
  configSources: {
    characters: WorkbenchTextSource;
    audio: WorkbenchTextSource;
  };
  scenes: WorkbenchAssetScenePayload[];
  existingAssetPaths: string[];
};
```

Use type-only imports for the existing compiler `AssetManifest` and `AssetReport` contracts. Do not duplicate their TypeScript shapes.

Add the frontend call:

```ts
export const loadAssetWorkspace = () =>
  invoke<WorkbenchAssetWorkspacePayload>("load_asset_workspace");
```

Add one Rust command:

```text
load_asset_workspace
```

with fixed constants for:

```text
apps/game/src-tauri/resources/assets/manifest.json
apps/game/src-tauri/resources/assets/report.json
static/assets/config/characters.yaml
static/assets/config/audio.yaml
static/assets
```

**Steps:**

- [ ] In the existing Rust test module, write a failing fixture test that creates a minimal Workbench repository with:
  - chapter manifest + compiled linear scene;
  - generated asset manifest/report JSON;
  - characters/audio YAML;
  - one present static asset file.
- [ ] Assert the future snapshot preserves chapter/scene manifest order, source path, generated manifest/report values, config source path/content, and the present repo-relative static asset path.
- [ ] Add a failing Rust test with an Analysis scene containing hidden accepted-answer fields. Assert the Assets scene snapshot contains exactly the same sanitized public Analysis shape as `load_scene_bundle_at_root()`.
- [ ] Add failing tests for missing generated `manifest.json` and `report.json`; require stable domain error codes/messages that tell the developer the compiler output is missing rather than falling back to filesystem discovery.
- [ ] Add a failing test that the file walker reports regular files only and never walks outside the fixed `static/assets` root.
- [ ] Implement small JSON/source helpers in `lib.rs`; reuse existing `workspace_root`, `load_manifest_chapters`, and `load_scene_bundle_at_root` instead of resolving scene paths again.
- [ ] Enumerate public scene payloads in chapter-manifest order. Do not deserialize/re-emit private Analysis JSON separately.
- [ ] Recursively list only regular files beneath `static/assets`, normalize the returned paths to repo-relative forward-slash strings, and sort them deterministically.
- [ ] Register `load_asset_workspace` in the existing Tauri invoke handler.
- [ ] Add the TypeScript payload types and API wrapper.
- [ ] Run:

```text
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run --cwd apps/layout-editor check
```

- [ ] Commit:

```text
feat(editor): expose assets workspace snapshot
```

---

## Task 2: Build the pure asset/config/usage projection

**Files:**

- Create: `apps/layout-editor/src/lib/asset-workspace.ts`
- Create: `apps/layout-editor/src/lib/asset-workspace.test.ts`
- Modify: `apps/layout-editor/package.json`
- Modify: `bun.lock`

**Core API:**

```ts
export function projectAssetWorkspace(
  payload: WorkbenchAssetWorkspacePayload,
): AssetWorkspace;
```

Keep the author-facing model local to `asset-workspace.ts` unless another component truly consumes a type. Do not add a generic shared asset-schema package.

**Projection responsibilities:**

```text
payload.manifest
+ payload.report
+ characters.yaml
+ audio.yaml
+ public compiler scene payloads
+ existingAssetPaths
        ↓
AssetWorkspace {
  assets
  assetsById
  sceneCuesByKey
  characters
  diagnostics
}
```

**Steps:**

- [ ] Add `yaml` to `apps/layout-editor` dependencies using the repository's existing major/version line. Update `bun.lock`; do not add a new YAML library.
- [ ] Write a failing test for a tiny `characters.yaml` projection containing:
  - one `portraitMode: portrait` character;
  - two configured expressions;
  - only one expression referenced by scenes;
  - one matching portrait file present.
  Assert both expressions are shown, the unused one has `0` usages, and file presence follows expected paths rather than manifest membership.
- [ ] Write a failing audio-config test with BGM, BGS, and SFX. Assert only referenced BGM/BGS become HPA-134 library/audio config items and SFX is excluded.
- [ ] Implement narrow YAML read projection helpers. Treat compiler validation as authoritative; if YAML cannot be read into the expected top-level projection, return a Workbench projection diagnostic/error instead of introducing validation policy.
- [ ] Write failing manifest-join tests that assert:
  - manifest prompt parts/final prompt are preserved byte-for-byte as data;
  - expected/public paths are not recomputed for referenced manifest assets;
  - manifest `source` metadata is preserved;
  - file presence comes from `existingAssetPaths`;
  - compiler `report.json` warnings remain visible.
- [ ] Implement `WorkbenchAssetKind` mapping for `background`, `portrait`, `standee`, `evidence`, `bgm`, and `bgs`; explicitly filter SFX.
- [ ] Implement part-specific canonical prompt-source references:
  - global/type -> `static/assets/config/policy.yaml`;
  - portrait/standee -> `static/assets/config/characters.yaml`;
  - BGM/BGS -> `static/assets/config/audio.yaml`;
  - scene background/evidence entry prompt -> scene `sourcePath` from manifest source chapter/scene;
  - usage source -> that scene's `sourcePath` plus carrier label/ID.
- [ ] Use `@lyra/asset-paths` only for configured portrait-expression expected paths that do not necessarily exist in the referenced manifest.
- [ ] Run:

```text
bun run --cwd apps/layout-editor test -- asset-workspace.test.ts
bun run --cwd apps/layout-editor check
```

- [ ] Commit:

```text
feat(editor): project asset catalog and config sources
```

---

## Task 3: Project ordered scene cues across all public scene types

**Files:**

- Modify: `apps/layout-editor/src/lib/asset-workspace.ts`
- Modify: `apps/layout-editor/src/lib/asset-workspace.test.ts`

**Cue contract:**

Keep a narrow discriminated presentation model that can represent:

- structural visual/background cue;
- BGM/BGS `set | stop | inherit`;
- portrait/expression occurrence;
- evidence image occurrence;
- investigation sprite/standee occurrence.

Do not add duration/timeline coordinates.

**Steps:**

- [ ] Write a failing linear-scene test with multiple `sceneTag` cues and alternating line portraits. Assert visual cues and portrait occurrences preserve authored/compiled queue order.
- [ ] Add a regression that consecutive identical portrait state may collapse in the **scene cue display** while the global usage index retains concrete dialogue occurrences/counts.
- [ ] Write a failing audio-delta test proving all three compiler states:

```text
null cue field          -> Inherit
{ assetId: null }       -> Stop
{ assetId: concrete }   -> Set
```

for both BGM and BGS.
- [ ] Write a failing investigation test that orders:
  - intro dialogue assets;
  - sublocation structural background/BGM/BGS cue;
  - transition/hotspot/topic dialogue assets;
  - sprite/standee usage;
  - evidence image;
  - evidence/statement branch dialogue assets;
  - outro assets.
- [ ] Write a failing interrogation test that orders:
  - intro;
  - phase structural cue;
  - subject portrait;
  - entry/question/testimony dialogue assets;
  - branch/evidence assets;
  - outro.
- [ ] Write a failing Analysis test using `PublicAnalysisScene`, not `JSONAnalysisScene`, and assert only intro/result/outro public dialogue is traversed. Do not cast in hidden accepted answers to make the test pass.
- [ ] Implement one scene-type switch with exhaustive `assertNever` behavior, mirroring Reader's compiler-typed projection style.
- [ ] Implement usage aggregation with a stable dedupe key containing chapter, scene, carrier, role, and item occurrence where meaningful.
- [ ] Add a failing test where a scene usage references an asset ID absent from the generated manifest; assert the usage remains visible with an unresolved-manifest diagnostic rather than disappearing.
- [ ] Run:

```text
bun run --cwd apps/layout-editor test -- asset-workspace.test.ts
bun run --cwd apps/layout-editor check
```

- [ ] Commit:

```text
feat(editor): project ordered scene asset cues
```

---

## Task 4: Implement the Assets view — Scene cues and Library

**Files:**

- Create: `apps/layout-editor/src/lib/AssetsView.svelte`
- Create: `apps/layout-editor/src/lib/AssetsView.test.ts`
- Modify: `apps/layout-editor/src/lib/asset-workspace.ts` only if a presentation helper is genuinely shared/testable

**Component API:**

```ts
let {
  selectedChapterId,
  selectedSceneId,
  onSelectScene,
}: {
  selectedChapterId: string | null;
  selectedSceneId: string | null;
  onSelectScene: (chapterId: string, sceneId: string) => void;
} = $props();
```

`AssetsView` owns its read-only snapshot load/Refresh state through `loadAssetWorkspace()` and `projectAssetWorkspace()`.

**Steps:**

- [ ] Mock `loadAssetWorkspace()` in a failing component test and assert the first mount renders a loading state then the selected scene's ordered cue rows.
- [ ] Add a failing test for the three local tabs/sections:

```text
Scene cues | Library | Characters
```

The test only needs stable accessible labels; do not build a routing abstraction.
- [ ] Implement **Scene cues** rows with:
  - carrier label;
  - background thumbnail when the referenced file is present;
  - explicit missing state when absent;
  - BGM/BGS `Set`, `Stop`, `Inherit` labels;
  - portrait character/expression changes;
  - evidence image refs;
  - source reference;
  - clickable asset IDs/thumbnails that switch to Library and select the asset.
- [ ] Add a failing Library filter test for asset kind + search by ID/path.
- [ ] Implement referenced-asset browser from projected manifest entries only. `existingAssetPaths` must never cause loose files to appear as browser assets.
- [ ] Add a failing inspector test that asserts exact display of:
  - asset ID/kind;
  - expected/public path;
  - manifest source metadata;
  - four prompt parts;
  - final prompt;
  - present/missing state;
  - grouped usage count/list;
  - relevant existing diagnostics.
- [ ] Implement image preview for background/portrait/standee/evidence using manifest `publicPath` only when `present` is true.
- [ ] Implement BGM/BGS audition using native `<audio controls>` only when present; no new audio manager.
- [ ] Add clipboard-boundary tests and implement:
  - `Copy prompt` for `finalPrompt`;
  - `Copy source` for canonical source path/reference.
  Use `navigator.clipboard`; keep failures visible to the developer instead of silently claiming success.
- [ ] Add a failing usage-navigation test; clicking a usage calls `onSelectScene(chapterId, sceneId)`. Do not implement deep source-line navigation.
- [ ] Run:

```text
bun run --cwd apps/layout-editor test -- AssetsView.test.ts
bun run --cwd apps/layout-editor check
```

- [ ] Commit:

```text
feat(editor): add scene asset browser and inspector
```

---

## Task 5: Finish Characters, diagnostics, and stale-safe Refresh

**Files:**

- Modify: `apps/layout-editor/src/lib/AssetsView.svelte`
- Modify: `apps/layout-editor/src/lib/AssetsView.test.ts`
- Modify: `apps/layout-editor/src/lib/asset-workspace.ts`
- Modify: `apps/layout-editor/src/lib/asset-workspace.test.ts`

**Steps:**

- [ ] Add a failing Characters-view test with one portrait-bearing character and one `portraitMode: none` character. Assert only the portrait-bearing character gets an expression grid.
- [ ] Implement character identity display with:
  - character ID/display names;
  - `visualPrompt`;
  - configured expression IDs/prompts;
  - expected/public portrait path;
  - present/missing state;
  - usage count + grouped scene usages;
  - related standee usages where present.
- [ ] Add a regression proving an unused configured expression is neutral (`0 usages`), not a warning/error.
- [ ] Add a failing diagnostics test that renders existing compiler report warnings and unresolved manifest joins without inventing an approval/status field.
- [ ] Add a failing Refresh race test with two deferred `loadAssetWorkspace()` promises. Resolve the newer response first and the older response last; assert the older response cannot overwrite the newer projected workspace.
- [ ] Implement one component-local load generation counter. Increment/invalidate it on each Refresh and on destroy. Do not add polling/watchers.
- [ ] Ensure Refresh rereads the snapshot only; it never runs `scenes:compile`, `audio:validate`, or generators from the UI.
- [ ] Run:

```text
bun run --cwd apps/layout-editor test -- AssetsView.test.ts asset-workspace.test.ts
bun run --cwd apps/layout-editor check
```

- [ ] Commit:

```text
feat(editor): add character assets and diagnostics
```

---

## Task 6: Integrate `Reader | Assets | Stage` without regressing HPA-634

**Files:**

- Modify: `apps/layout-editor/src/App.svelte`
- Modify: `apps/layout-editor/src/App.test.ts`

**Required shell behavior:**

```ts
type WorkbenchMode = "reader" | "assets" | "stage";
```

Do not keep the current assumption that every non-Reader mode is Stage.

**Steps:**

- [ ] Write a failing App test asserting the mode bar exposes `Reader`, `Assets`, and `Stage`, with Reader still default.
- [ ] Write a failing test that selecting a scene in Assets updates selection but does **not** call investigation Stage loading and does not call Reader scene loading from `App.svelte`.
- [ ] Write a failing Reader race regression: start a Reader load, switch to Assets, load/select another scene there, then resolve the old Reader load. Assert the old Reader request cannot write the shared Reader bundle cache. Generalize the existing cache epoch rule from “leaving Reader for Stage” to “leaving Reader for any non-Reader mode.”
- [ ] Write a failing Assets -> Stage test:
  - if current selection is investigation, Stage loads that scene;
  - if current selection is non-investigation, Stage clears and renders its existing placeholder.
- [ ] Implement explicit `setMode()` and `selectScene()` branches for all three modes. Do not extract a new state machine/store.
- [ ] Render `AssetsView` only when `mode === "assets"` and pass the current selection plus a callback that reuses the normal scene-selection path.
- [ ] Preserve Reader current-scene/whole-chapter controls only in Reader and Save Layout only in Stage.
- [ ] Keep sidebar sublocations gated on Stage exactly as HPA-634 fixed them.
- [ ] Run the complete editor tests:

```text
bun run --cwd apps/layout-editor test
bun run --cwd apps/layout-editor check
```

- [ ] Commit:

```text
feat(editor): integrate Story Workbench assets mode
```

---

## Task 7: Verify real compiler/config integration and finish the single PR

**Files:**

- Modify planning docs only if implementation reveals a factual mismatch that must be recorded:
  - `docs/superpowers/specs/2026-08-29-hpa-134-story-workbench-assets-design.md`
  - `docs/superpowers/plans/2026-08-29-hpa-134-story-workbench-assets-implementation-plan.md`

Do not add a new planning document or split the PR.

**Steps:**

- [ ] Run the HPA-134 required compiler/content gates first so Assets mode is tested against fresh generated artifacts:

```text
bun run scenes:compile
bun run background-cues:audit
bun run audio:validate
```

- [ ] Run direct developer-tool suites:

```text
bun run --cwd apps/layout-editor test
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run editor:check
```

- [ ] Build the actual Workbench app and confirm static `/assets/...` previews/audio are packaged through the existing `publicDir` path:

```text
bun run editor:build
```

- [ ] Run the broader repository gates required by the ticket:

```text
bun run test:scripts
bun run lint:all
```

- [ ] Manually launch the developer Workbench against the freshly compiled current Chapter 1 corpus and verify:
  - one linear scene;
  - one investigation scene;
  - one interrogation scene;
  - one Analysis scene;
  - at least one present background;
  - at least one missing asset if current compiler report contains one;
  - BGM or BGS `Set`, `Stop`, and `Inherit` states where current content exercises them;
  - portrait expression grouping from `characters.yaml`;
  - a cross-scene reused asset usage list.
- [ ] If current content does not naturally exercise one presentation state, rely on the focused fixture test instead of changing story content merely for UI coverage.
- [ ] Review `git diff main...HEAD` and confirm the PR contains HPA-134 only: no Plan mode, no source editing, no AI, no Chapter 2 framework, no prompt generator.
- [ ] Update the existing draft PR body with the final verification results; keep the same PR rather than opening a separate implementation PR.
- [ ] Final implementation commit, only if verification/doc corrections produced changes:

```text
docs: finalize HPA-134 assets verification
```

## Final self-review checklist

Before marking HPA-134 ready for review:

- [ ] The asset browser is driven by generated manifest entries, not a static-files scan.
- [ ] Existing static-file enumeration is used only for present/missing checks.
- [ ] The selected-scene cue list follows compiled/authored order.
- [ ] BGM/BGS `inherit`, `stop`, and `set` are visibly distinct.
- [ ] Usage counts come from public compiler scene payloads and dedupe deterministically.
- [ ] Analysis remains public/sanitized.
- [ ] Manifest prompt parts/final prompt are displayed, not recomposed.
- [ ] `characters.yaml` configured expressions include unused expressions without warning them.
- [ ] Audio browser scope excludes SFX.
- [ ] Missing files and failed joins are explicit.
- [ ] Reader Refresh/cache semantics and Stage layout behavior remain intact.
- [ ] No new persistent state, DB, status workflow, source writer, generator, or generic DAM was introduced.
- [ ] All work remains on the single HPA-134 PR.
