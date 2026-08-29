# HPA-134 Story Workbench Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Assets mode to Lyra Story Workbench that projects current compiler scene cues, generated manifest data, compiler-normalized character/audio config, file presence, and cross-scene usage into one author-facing inspection workflow.

**Architecture:** Add one fixed-domain `load_asset_workspace` Tauri read command that reuses the current Workbench manifest resolver/public Analysis sanitizer. Extract browser-safe character/audio normalization and portrait identity from the existing compiler owners rather than adding editor copies. Keep cue ordering, carrier completeness, prompt/source joins, usage aggregation, character grouping, and diagnostics in one pure TypeScript `asset-workspace.ts` projection, rendered by one `AssetsView.svelte` under an explicit `reader | assets | stage` mode.

**Tech Stack:** Tauri 2/Rust, Svelte 5, TypeScript 5.6, existing `@lyra/scripts` compiler modules/types, existing `@lyra/asset-paths`, Vitest/Testing Library, Cargo tests.

**Spec:** `docs/superpowers/specs/2026-08-29-hpa-134-story-workbench-assets-design.md`

## Global Constraints

- [ ] Keep HPA-134 as **one ticket and one PR**. Continue implementation on `agent/hpa-134-story-workbench-assets-plan`.
- [ ] Keep authored Markdown/YAML/layout sidecars plus existing compiler outputs as the only sources of truth.
- [ ] Do not add a prompt DB, asset DB, checked-in Workbench manifest, generated `assets-workbench.json`, DAM, watcher, polling loop, or generation provider.
- [ ] Do not add arbitrary-path Tauri commands. `load_asset_workspace` takes no workspace path.
- [ ] Do not widen public Analysis data to hidden answers/progression metadata.
- [ ] Do not refactor Reader cache/state merely to share scene bundles with Assets. Assets owns its own snapshot.
- [ ] Do not add an OS file-opener/shell plugin. HPA-134 copies prompt/source references; HPA-135 owns write/navigation workflow.
- [ ] Do not browse catalog-only SFX.
- [ ] Do not infer new asset validity/approval rules.
- [ ] Do not hard-code production Chapter 1 asset IDs, expression IDs, or audio IDs.
- [ ] Do not add `yaml` to `apps/layout-editor`; reuse compiler-owned browser-safe parsing/normalization.
- [ ] Preserve HPA-634 Reader/Stage behavior and current public Analysis sanitizer.

---

## Task 1: Add the fixed-domain Assets workspace snapshot

**Files:**

- Modify: `apps/layout-editor/src-tauri/src/lib.rs`
- Modify: `apps/layout-editor/src/lib/workbench-types.ts`
- Modify: `apps/layout-editor/src/lib/workbench-api.ts`

**Interfaces:**

Add:

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

Use type-only imports for compiler `AssetManifest` / `AssetReport`; do not duplicate those shapes.

Frontend command:

```ts
export const loadAssetWorkspace = () =>
  invoke<WorkbenchAssetWorkspacePayload>("load_asset_workspace");
```

Rust command:

```text
load_asset_workspace
```

Fixed roots:

```text
apps/game/src-tauri/resources/assets/manifest.json
apps/game/src-tauri/resources/assets/report.json
static/assets/config/characters.yaml
static/assets/config/audio.yaml
static/assets
```

**Steps:**

- [ ] Write `asset_workspace_snapshot_preserves_manifest_order_and_sources` in the existing Rust test module. Fixture: one chapter, one compiled linear scene, generated manifest/report, characters/audio YAML, one static asset. Expected: manifest order, scene source path, config text/path, and repo-relative present file survive exactly.
- [ ] Run the focused Rust test and confirm it fails because the command/helper does not exist yet.
- [ ] Write `asset_workspace_reuses_public_analysis_sanitizer`: fixture private Analysis JSON includes accepted answers/threshold/progression fields; expected snapshot equals `load_scene_bundle_at_root()` public shape and omits those fields.
- [ ] Write `asset_workspace_requires_generated_manifest_and_report` for missing `manifest.json` and missing `report.json`; require stable domain errors that tell the developer to compile scenes rather than scanning loose files.
- [ ] Write `asset_workspace_file_presence_stays_under_static_assets`: only regular files under fixed `static/assets` appear, normalized to forward-slash repo-relative paths.
- [ ] Implement `load_asset_workspace_at_root(root)` using existing `load_manifest_chapters()` and `load_scene_bundle_at_root()`; do not re-resolve scene paths.
- [ ] Add fixed-file JSON/text readers and deterministic regular-file enumeration under `static/assets`.
- [ ] Register `load_asset_workspace` in the Tauri invoke handler.
- [ ] Add frontend types/API wrapper.
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

## Task 2: Extract compiler-owned catalog/identity helpers and build base asset projection

**Files:**

- Create: `packages/scripts/compile-scenes/assets/config-catalog.ts`
- Create: `packages/scripts/compile-scenes/assets/config-catalog.test.ts`
- Create: `packages/scripts/compile-scenes/assets/identity.ts`
- Modify: `packages/scripts/compile-scenes/assets/config.ts`
- Modify: `packages/scripts/compile-scenes/assets/config.test.ts`
- Modify: `packages/scripts/compile-scenes/assets/enrich.ts`
- Modify: `packages/scripts/compile-scenes/assets/enrich.test.ts`
- Create: `apps/layout-editor/src/lib/asset-workspace.ts`
- Create: `apps/layout-editor/src/lib/asset-workspace.test.ts`

Do **not** modify `apps/layout-editor/package.json` or `bun.lock` for YAML parsing.

**Compiler reuse interfaces:**

The browser-safe compiler module must expose text readers equivalent to:

```ts
export function parseCharactersYamlText(
  text: string,
  sourceFile: string,
): CatalogReadResult<CharacterCatalog>;

export function parseAudioYamlText(
  text: string,
  sourceFile: string,
): CatalogReadResult<AudioCatalog>;
```

The exact catalog collection shape can be chosen to minimize churn, but it must preserve compiler normalization used by the Workbench:

```text
displayNames trimming/flattening
portraitMode default
visualPrompt/referenceAssetId normalization
expression ID + prompt map
audio channel maps
audio loop default true
```

Keep compiler validity policy in `loadAssetConfig()`/its compiler validation path. The Workbench must not independently enforce required `standard`, slug, duplicate-ID/display-name, or enabled-policy rules.

Identity helper:

```ts
export function portraitAssetId(
  characterId: string,
  expression: string,
): string;
```

Update compiler `registerPortraitRef()` to use that helper so the editor cannot drift from compiler identity spelling.

Do not replace this with `packages/scripts/audio/audio-catalog.ts`; that parser has stricter `loop` semantics than compile-scenes.

**Editor API:**

```ts
export function projectAssetWorkspace(
  payload: WorkbenchAssetWorkspacePayload,
): AssetWorkspace;
```

**Steps:**

- [ ] Write `shared_character_catalog_normalization_matches_compiler` using aliases in `displayNames`, `portraitMode: none`, multiple expressions, and nullable identity fields. It must fail before extraction and preserve current compiler behavior after extraction.
- [ ] Write `shared_audio_catalog_defaults_missing_loop_to_true` with BGM/BGS/SFX. This pins compile-scenes behavior and prevents accidental adoption of the stricter sound-plan catalog parser.
- [ ] Write `shared_catalog_reports_yaml_parse_failure_without_node_fs` against malformed text; the new module must import `yaml` but no `node:fs`/`node:path`.
- [ ] Refactor `loadAssetConfig()` to read files as it does today and feed text into the extracted pure normalizers. Keep existing compiler diagnostics/tests green; do not move policy authority into the editor.
- [ ] Write `portrait_asset_identity_has_one_owner`; update `enrich.ts` to call `portraitAssetId()` and preserve existing emitted IDs.
- [ ] Run focused script tests plus strict script typecheck:

```text
bun run test:scripts -- config-catalog config enrich
bun run check:scripts
```

- [ ] Write editor `configured_unused_expression_uses_compiler_identity_and_paths`:
  - one portrait-bearing character;
  - two configured expressions;
  - one referenced expression;
  - one file present.
  Assert both expressions appear, unused expression has `0 usages`, `portraitAssetId()` owns its ID, and `expectedPath()` / `publicPath()` from compiler `manifest.ts` own its paths.
- [ ] Write `referenced_manifest_fields_are_not_recomputed`: prompt parts, final prompt, expected path, public path, and source metadata remain exactly the generated manifest values.
- [ ] Write `audio_library_joins_by_manifest_source_channel_and_id`: BGM/BGS config short IDs join through `manifest.source.channel` + `manifest.source.id`; SFX is excluded using `source.channel === "sfx"`; no `audio.${channel}.${id}` reconstruction exists in editor code.
- [ ] Write `yaml_parse_failure_is_workbench_read_diagnostic`: malformed characters/audio text becomes an explicit read diagnostic, while compiler validity policy is not duplicated.
- [ ] Implement the base `AssetWorkspace` projection and canonical prompt-source references.
- [ ] Verify `apps/layout-editor/package.json` has no new `yaml` dependency.
- [ ] Run:

```text
bun run --cwd apps/layout-editor test -- asset-workspace.test.ts
bun run --cwd apps/layout-editor check
bun run check:scripts
```

- [ ] Commit:

```text
refactor(assets): share compiler catalog and identity owners
```

---

## Task 3: Project ordered cues with compiler/Reader carrier completeness

**Files:**

- Modify: `apps/layout-editor/src/lib/asset-workspace.ts`
- Modify: `apps/layout-editor/src/lib/asset-workspace.test.ts`
- Modify: `apps/layout-editor/src/lib/reader-projection.ts` only if a tiny exported carrier helper must move without behavior change
- Modify: `apps/layout-editor/src/lib/reader-projection.test.ts` only if that helper moves

**Reuse contracts:**

```ts
import { deriveDialogueSegments } from
  "@lyra/scripts/compile-scenes/dialogue-segment-origins";
import { readerSegmentId } from "./reader-projection";
```

For linear/investigation/interrogation, Assets must not invent dialogue carrier spellings.

Recommended local safety helper:

```ts
class AssetSegmentPool {
  take(carrierId: string): JSONDialogueItem[];
  assertAssetBearingFullyConsumed(): void;
}
```

Seed it from `deriveDialogueSegments({ chapterId, json: scene })`; canonical keys come from `readerSegmentId(segment.origin)`. Track all derived segments, but the final completeness failure is required for any unconsumed segment containing a resolved portrait or `sceneTag.assetCue`.

Public Analysis is intentionally different: walk only `intro`, `board:<id>:result`, `outro` using the same carrier spelling Reader exposes. Do not cast it to private `JSONAnalysisScene`.

**Steps:**

- [ ] Write `linear_asset_cues_follow_main_carrier_and_item_order` with multiple scene tags and portrait lines. Expect carrier `main` and exact item order.
- [ ] Write `asset_usage_keeps_concrete_portrait_occurrences_when_display_collapses_state`: Scene-cue display may collapse consecutive identical portrait state; usage index keeps each concrete line occurrence.
- [ ] Write `audio_delta_preserves_inherit_stop_set` for BGM and BGS:

```text
null                  -> Inherit
{ assetId: null }     -> Stop
{ assetId: concrete } -> Set
```

- [ ] Write `investigation_assets_use_reader_carrier_ids` covering intro, sublocation transition, hotspot inspect/reexamine, topic dialogue/reexamine, evidence/statement branches, and outro. Expected carrier IDs must match `readerSegmentId(deriveDialogueSegments(...).origin)`.
- [ ] Write `interrogation_assets_use_reader_carrier_ids` covering intro, phase entry, question-level testimony carriers, line content/challenge/correct/wrong carriers, inventory branches, and outro.
- [ ] Write `new_asset_bearing_dialogue_carrier_cannot_be_silently_dropped`: leave one derived asset-bearing segment untaken in a fixture/helper test and require `assertAssetBearingFullyConsumed()` to throw a stable projection error. Then prove the real scene-type projection fully consumes every asset-bearing derived segment.
- [ ] Write `non_asset_dialogue_segment_does_not_require_usage` so plain text-only dialogue does not manufacture empty asset rows merely to satisfy completeness.
- [ ] Write explicit non-dialogue coverage tests:
  - `investigation_structural_cues_are_projected` for sublocation background/BGM/BGS;
  - `interrogation_structural_cues_and_subject_portrait_are_projected`;
  - `evidence_image_usage_is_projected`;
  - `sprite_layout_uses_manifest_asset_type` with standee, portrait, evidence, and background sprite IDs;
  - `baked_layout_has_no_sprite_asset_usage`.
- [ ] Write `public_analysis_assets_walk_only_intro_result_outro`: use `PublicAnalysisScene`; assert `intro`, `board:<id>:result`, `outro` and no hidden answer/progression dependency.
- [ ] Write `unresolved_manifest_usage_remains_visible`: an asset occurrence absent from manifest remains in scene cues/usages with an unresolved diagnostic.
- [ ] Implement the scene-type walk using the segment pool for dialogue and typed structural handling for non-dialogue asset fields.
- [ ] Implement deterministic usage dedupe by chapter + scene + carrier + role + concrete item index where applicable.
- [ ] Run the risk-owning tests, not just ordering examples:

```text
bun run --cwd apps/layout-editor test -- asset-workspace.test.ts reader-projection.test.ts
bun run --cwd apps/layout-editor check
```

- [ ] Commit:

```text
feat(editor): project complete ordered asset cues
```

---

## Task 4: Implement AssetsView Scene cues + Library

**Files:**

- Create: `apps/layout-editor/src/lib/AssetsView.svelte`
- Create: `apps/layout-editor/src/lib/AssetsView.test.ts`
- Modify: `apps/layout-editor/src/lib/asset-workspace.ts` only for genuinely shared presentation helpers

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

`AssetsView` owns its snapshot load/Refresh state through `loadAssetWorkspace()` + `projectAssetWorkspace()`.

**Steps:**

- [ ] Write mount/loading test and assert the selected scene's ordered cue rows render after the snapshot resolves.
- [ ] Write accessible section-switch test for exactly `Scene cues | Library | Characters`; do not add routing.
- [ ] Implement Scene cues with carrier label/ID, background preview/missing state, BGM/BGS Set/Stop/Inherit, portrait/expression, evidence refs, sprite usages, and source reference.
- [ ] Make asset IDs/previews select the corresponding Library item.
- [ ] Write Library kind/search filters. Library entries come from projected manifest entries only; `existingAssetPaths` never populates loose browser rows.
- [ ] Write inspector test for exact asset ID/kind, manifest expected/public path, manifest source, four prompt parts, final prompt, presence, usages, and diagnostics.
- [ ] Implement image preview using manifest `publicPath` only when present.
- [ ] Implement referenced BGM/BGS audition with native `<audio controls>` only; no audio manager.
- [ ] Write clipboard-boundary tests and implement `Copy prompt` / `Copy source` using `navigator.clipboard`, with visible failure state.
- [ ] Write usage-navigation test; selecting usage calls `onSelectScene(chapterId, sceneId)` only.
- [ ] Run:

```text
bun run --cwd apps/layout-editor test -- AssetsView.test.ts asset-workspace.test.ts
bun run --cwd apps/layout-editor check
```

- [ ] Commit:

```text
feat(editor): add asset scene browser and inspector
```

---

## Task 5: Finish Characters, diagnostics, and stale-safe Refresh

**Files:**

- Modify: `apps/layout-editor/src/lib/AssetsView.svelte`
- Modify: `apps/layout-editor/src/lib/AssetsView.test.ts`
- Modify: `apps/layout-editor/src/lib/asset-workspace.ts`
- Modify: `apps/layout-editor/src/lib/asset-workspace.test.ts`

**Steps:**

- [ ] Write Characters test with one `portraitMode: portrait` and one `portraitMode: none`; only the portrait-bearing character gets an expression grid.
- [ ] Implement character identity/displayNames/visualPrompt and each normalized expression with compiler-owned portrait ID/path, present/missing state, usage count, grouped scene usages, and related sprite usages where applicable.
- [ ] Add regression: configured-but-unused expression is `0 usages`, never a warning/error.
- [ ] Add diagnostics test for compiler report warnings, missing files, unresolved manifest joins, and shared YAML read failures; no approval/status model is introduced.
- [ ] Add Refresh race test using two deferred `loadAssetWorkspace()` promises; resolve newer first and older last; older result must not overwrite current projected workspace.
- [ ] Implement one component-local load generation counter invalidated on each Refresh and destroy. No watcher/polling.
- [ ] Confirm Refresh rereads snapshot only; it never compiles scenes or runs audio/generation commands from UI.
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

## Task 6: Integrate explicit Reader | Assets | Stage mode ownership

**Files:**

- Modify: `apps/layout-editor/src/App.svelte`
- Modify: `apps/layout-editor/src/App.test.ts`

**Required type:**

```ts
type WorkbenchMode = "reader" | "assets" | "stage";
```

**Steps:**

- [ ] Write mode-bar test: Reader, Assets, Stage are exposed; Reader remains default.
- [ ] Write Assets selection isolation test: selecting a scene in Assets changes selection but does not call Stage investigation loading and does not start a Reader load from `App.svelte`.
- [ ] Write Reader race regression: start Reader load, switch to Assets, then resolve old Reader load. It must not write Reader shared cache after mode ownership changed. Generalize HPA-634's epoch rule from leaving Reader for Stage to leaving Reader for any non-Reader mode.
- [ ] Write Assets -> Stage behavior test: investigation selection loads Stage; non-investigation selection clears Stage and keeps the existing placeholder behavior.
- [ ] Implement explicit branches in `setMode()` and `selectScene()`; do not extract a state-machine/store framework.
- [ ] Render `AssetsView` only for `mode === "assets"`.
- [ ] Preserve Reader-only scope/filter/Refresh controls and Stage-only Save Layout controls.
- [ ] Preserve sidebar sublocation gating exactly under Stage.
- [ ] Run full editor suite:

```text
bun run --cwd apps/layout-editor test
bun run --cwd apps/layout-editor check
```

- [ ] Commit:

```text
feat(editor): integrate Story Workbench assets mode
```

---

## Task 7: Real-corpus verification and single-PR closeout

**Files:**

- Modify the two HPA-134 planning docs only if implementation uncovers a factual mismatch that must be recorded.
- Update the existing draft PR body with actual verification results.

**Required automated gates:**

- [ ] Generate fresh compiler outputs:

```text
bun run scenes:compile
```

- [ ] Run compiler/script ownership checks because Task 2 modifies compiler modules:

```text
bun run check:scripts
bun run test:scripts
```

- [ ] Run complete developer-tool tests:

```text
bun run --cwd apps/layout-editor test
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run editor:check
```

- [ ] Build the Workbench app:

```text
bun run editor:build
```

- [ ] Run repository formatting/lint/Rust gates:

```text
bun run lint:all
```

`bun run audio:validate` is deliberately absent: it requires `<plan.yaml>` and HPA-134 does not modify sound plans.

`bun run background-cues:audit` is optional corpus smoke only. If run, record it separately; it is not an Assets acceptance gate and does not replace Task 3 completeness tests.

**Manual real-corpus smoke:**

- [ ] Launch the Workbench against freshly compiled current content.
- [ ] Inspect one linear, one investigation, one interrogation, and one Analysis scene.
- [ ] Verify at least one present visual asset and one present BGM/BGS when available.
- [ ] Verify any current compiler-report missing asset renders as missing; if current corpus has none, rely on fixture coverage instead of modifying story content.
- [ ] Verify Set/Stop/Inherit states that current corpus naturally exercises; fixture tests own absent variants.
- [ ] Verify character grouping includes configured unused expressions as neutral 0-usage rows.
- [ ] Verify one reused asset shows cross-scene usages when current corpus has one.

**Scope review:**

- [ ] Inspect `git diff main...HEAD` and confirm no Plan mode, source editing, AI, Chapter 2 framework, prompt generation, extra YAML parser, OS opener, DAM, or second manifest was added.
- [ ] Confirm `apps/layout-editor/package.json` still has no direct `yaml` dependency.
- [ ] Confirm `asset-workspace.ts` does not concatenate portrait IDs, audio IDs, or expected paths that have compiler owners.
- [ ] Confirm every real asset-bearing derived dialogue segment is consumed by the projection tests.
- [ ] Update PR #78 with actual command results and keep implementation in the same PR.

## Final self-review checklist

Before marking HPA-134 ready for review:

- [ ] Library is manifest-driven, not static-file-scan driven.
- [ ] Static-file enumeration is presence-only.
- [ ] Character/audio YAML normalization is shared from compiler code; editor has no parser/dependency copy.
- [ ] Compiler validity policy remains compiler-owned.
- [ ] Referenced manifest prompt/path/source values are never recomposed.
- [ ] Configured-unused portraits use compiler-owned portrait ID + `expectedPath()` / `publicPath()`.
- [ ] Audio kind is joined through `manifest.source.channel` / `source.id`; SFX excluded.
- [ ] Dialogue carrier IDs come from `deriveDialogueSegments()` + `readerSegmentId()`.
- [ ] Every asset-bearing derived dialogue carrier has a completeness assertion.
- [ ] Structural sublocation/phase/evidence/sprite/subject assets have explicit typed tests.
- [ ] Only sprite layouts contribute layout asset usages; baked layouts do not.
- [ ] BGM/BGS Inherit/Stop/Set are distinct.
- [ ] Analysis stays public/sanitized.
- [ ] Unused configured expressions are neutral 0-use rows.
- [ ] Missing files and failed joins are explicit without new policy.
- [ ] Reader cache semantics and Stage behavior remain intact.
- [ ] No new persistent state, DB, source writer, generator, generic DAM, watcher, or OS opener exists.
- [ ] All work remains on the single HPA-134 PR.