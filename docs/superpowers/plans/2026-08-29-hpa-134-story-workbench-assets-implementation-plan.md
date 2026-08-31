# HPA-134 Story Workbench Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Follow TDD and the checkbox order.

**Goal:** Add one read-only Assets mode to Story Workbench using the existing Reader scene/carrier walk as the single authored-order structure owner, while projecting compiler manifest/config/file-presence data into scene cues, asset inspection, character grouping, and cross-scene usage.

**Architecture:** Add one fixed-domain `load_asset_workspace` Tauri snapshot. Extend `projectReaderScene()` so the existing walk emits a sibling `presentation` fact stream while Reader-visible items/groups remain behaviorally unchanged. `asset-workspace.ts` consumes those facts and owns only manifest/config joins, usage aggregation, character grouping, and diagnostics. Share compiler YAML normalization, type the existing manifest source shapes without changing serialized JSON, and put portrait ID construction/parsing in `@lyra/asset-paths`.

**Tech Stack:** Tauri 2/Rust, Svelte 5, TypeScript 5.6, existing `@lyra/scripts`, existing `@lyra/asset-paths`, Vitest/Testing Library, Cargo tests.

**Spec:** `docs/superpowers/specs/2026-08-29-hpa-134-story-workbench-assets-design.md`

## Global constraints

- [ ] Keep HPA-134 as **one ticket and one PR** on `agent/hpa-134-story-workbench-assets-plan`.
- [ ] Keep authored Markdown/YAML/layout sidecars plus existing compiler outputs as the only sources of truth.
- [ ] Do not add an asset DB, prompt DB, checked-in Workbench manifest, `assets-workbench.json`, DAM, watcher, polling loop, generation provider, Plan mode, AI workflow, or Chapter 2 framework.
- [ ] `load_asset_workspace` takes no arbitrary path or asset ID.
- [ ] Reuse `load_scene_bundle_at_root()` so public Analysis sanitization stays Rust-owned; do not widen public Analysis.
- [ ] Keep Assets snapshot/cache lifetime separate from Reader's bundle cache.
- [ ] **Do not add a second scene-type/carrier walk in `asset-workspace.ts`.** `projectReaderScene()` remains the single authored-order walk.
- [ ] Keep Reader's existing strict `SegmentPool.assertFullyConsumed()` behavior; do not add `AssetSegmentPool` or an asset-only weaker completeness rule.
- [ ] Do not add an OS opener. HPA-134 copies prompt/source references; HPA-135 owns source editing/navigation.
- [ ] Do not browse catalog-only SFX.
- [ ] Do not infer new asset validity/approval policy.
- [ ] Do not hard-code current Chapter 1 IDs/expressions/audio values.
- [ ] Do not add a direct `yaml` parser/import in `apps/layout-editor`; share compile-scenes asset-config normalization.
- [ ] Preserve Reader and Stage visible behavior.

---

## Task 1: Add the fixed-domain Assets workspace snapshot

**Files:**

- Modify: `apps/layout-editor/src-tauri/src/lib.rs`
- Modify: `apps/layout-editor/src/lib/workbench-types.ts`
- Modify: `apps/layout-editor/src/lib/workbench-api.ts`

**Frontend contract:**

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

Use compiler-owned `AssetManifest` / `AssetReport` types; do not duplicate shapes.

**Command:**

```ts
export const loadAssetWorkspace = () =>
  invoke<WorkbenchAssetWorkspacePayload>("load_asset_workspace");
```

Fixed files/roots:

```text
apps/game/src-tauri/resources/assets/manifest.json
apps/game/src-tauri/resources/assets/report.json
static/assets/config/characters.yaml
static/assets/config/audio.yaml
static/assets
```

**Steps:**

- [ ] Add failing Rust fixture `asset_workspace_snapshot_preserves_manifest_order_and_sources`: one chapter/scene, generated manifest/report, config text, one static file. Assert manifest order, scene source path, text sources, and repo-relative present file survive exactly.
- [ ] Add failing `asset_workspace_reuses_public_analysis_sanitizer`: private Analysis fixture contains accepted answers/threshold/progression fields; snapshot scene must exactly follow `load_scene_bundle_at_root()` public shape and omit them.
- [ ] Add failing `asset_workspace_requires_generated_manifest_and_report`: missing generated manifest/report produces stable domain errors instructing the developer to compile scenes; no loose-file fallback.
- [ ] Add failing `asset_workspace_file_presence_stays_under_static_assets`: regular files only, fixed root only, repo-relative forward slashes, deterministic sort.
- [ ] Implement `load_asset_workspace_at_root(root)` using existing `load_manifest_chapters()` + `load_scene_bundle_at_root()`; do not re-resolve scene paths.
- [ ] Add fixed JSON/text readers and recursive regular-file enumeration beneath `static/assets`.
- [ ] Register `load_asset_workspace` in Tauri invoke handler.
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

## Task 2: Consolidate compiler config, manifest-source, and portrait identity owners

**Files:**

- Create: `packages/scripts/compile-scenes/assets/config-catalog.ts`
- Create: `packages/scripts/compile-scenes/assets/config-catalog.test.ts`
- Modify: `packages/scripts/compile-scenes/assets/config.ts`
- Modify: `packages/scripts/compile-scenes/assets/config.test.ts`
- Modify: `packages/scripts/compile-scenes/assets/manifest.ts`
- Modify: `packages/scripts/compile-scenes/assets/enrich.ts`
- Modify: `packages/scripts/compile-scenes/assets/enrich.test.ts`
- Modify: `packages/asset-paths/src/index.ts`
- Create: `apps/layout-editor/src/lib/asset-workspace.ts`
- Create: `apps/layout-editor/src/lib/asset-workspace.test.ts`

Do **not** create `packages/scripts/compile-scenes/assets/identity.ts` and do not add `yaml` to `apps/layout-editor/package.json`.

### 2A. Record real output baseline before ownership refactors

- [ ] Generate a fresh baseline before modifying compiler config/identity/manifest types:

```text
bun run scenes:compile
baseline_manifest_hash="$(git hash-object apps/game/src-tauri/resources/assets/manifest.json)"
```

Keep this shell value for the end-of-task equality check. If implementation tooling cannot preserve a shell variable across its steps, record the hash in the task notes/PR comment; do not write a baseline artifact into the repository.

### 2B. Extract browser-safe compiler catalog normalization

Expose pure text readers from `config-catalog.ts`, approximately:

```ts
parseCharactersYamlText(text, sourceFile)
parseAudioYamlText(text, sourceFile)
```

They preserve current compile-scenes normalization:

```text
displayNames trimming/flattening
portraitMode default
visualPrompt/referenceAssetId normalization
expression map
audio bgm/bgs/sfx maps
audio loop default true
```

`loadAssetConfig()` retains filesystem I/O and compiler-only validity policy: required `standard`, slug/duplicate checks, enabled-mode requirements, etc.

**TDD:**

- [ ] Write `shared_character_catalog_normalization_matches_compiler` covering aliases, `portraitMode: none`, expressions, nullable identity fields.
- [ ] Write `shared_audio_catalog_defaults_missing_loop_to_true` covering BGM/BGS/SFX and omitted `loop`.
- [ ] Write `shared_catalog_reports_yaml_parse_failure_without_node_fs`; new module imports `yaml` but no `node:fs`/`node:path`.
- [ ] Refactor `loadAssetConfig()` to read files and delegate parsing/normalization to the pure module. Existing compiler diagnostics remain authoritative.
- [ ] Explicitly keep `packages/scripts/audio/audio-catalog.ts` unchanged; its strict explicit-`loop` contract is a different owner.

### 2C. Type manifest source without changing emitted JSON

Replace `AssetManifestEntry.source: Record<string, string>` with a parent-`type` discriminated entry union. Do **not** serialize a new `source.kind`.

Required narrowing:

```ts
if (entry.type === "audio") {
  entry.source.channel; // AudioChannel, typed
  entry.source.id;      // string, typed
}
```

Model the already-emitted source shapes:

- audio: `chapterId`, `sceneId`, `channel`, `id`;
- portrait: `chapterId`, `sceneId`, `characterId`, `expression`;
- standee: existing scene/character source;
- evidence: existing `evidenceId` or sprite `characterId` variants;
- background: existing `unitId` or sprite `characterId` variants.

Update `ManifestDraft` / `buildAssetManifest()` inputs to use the same typed union so compiler source-key renames fail TypeScript.

- [ ] Add/adjust compiler type/runtime tests proving current source objects compile and serialize unchanged.
- [ ] Add editor test `audio_library_joins_by_typed_manifest_source`: BGM/BGS use `entry.type === "audio"` + typed `source.channel/source.id`; SFX is filtered by channel; editor never reconstructs `audio.${channel}.${id}`.

### 2D. Move portrait ID construction/parsing to `@lyra/asset-paths`

Add narrowly:

```ts
portraitAssetId(characterId, expression)
parsePortraitAssetId(assetId)
```

Reuse `parsePortraitAssetId()` inside `publicPathForAssetId()` so decomposition has one owner.

- [ ] Update `registerPortraitRef()` to use `portraitAssetId()`.
- [ ] Update the existing portrait-layout enrichment branch to use `parsePortraitAssetId()` instead of hand-rolled `startsWith + split + length` parsing. Translate helper failure back to the existing compiler domain error rather than leaking a generic exception.
- [ ] Keep standee/evidence/background identity work out of scope unless required by compilation.
- [ ] Add/adjust existing script tests to prove emitted portrait IDs and invalid-layout diagnostics remain unchanged.

### 2E. Build base asset/config projection

Add:

```ts
export function projectAssetWorkspace(
  payload: WorkbenchAssetWorkspacePayload,
): AssetWorkspace;
```

At this task it may build the manifest/config/library/character base model before scene presentation usage is wired in Task 3.

- [ ] Write `configured_unused_expression_uses_shared_identity_and_paths`: both configured expressions appear, unused is 0 usages, ID from `portraitAssetId()`, paths from compiler `expectedPath()` / `publicPath()`.
- [ ] Write `referenced_manifest_fields_are_not_recomputed`: prompt parts/final prompt/expected path/public path/source stay exactly generated values.
- [ ] Write `yaml_parse_failure_is_workbench_read_diagnostic`: malformed config source becomes a read diagnostic without running compiler validity policy in the editor.
- [ ] Implement canonical prompt-source references and manifest-driven Library base rows. `existingAssetPaths` is presence-only.

### 2F. Prove real generated manifest is unchanged

- [ ] Recompile and compare the real manifest hash to the Task 2 baseline:

```text
bun run scenes:compile
test "$baseline_manifest_hash" = "$(git hash-object apps/game/src-tauri/resources/assets/manifest.json)"
```

A mismatch is a Task 2 regression unless an already-approved content change independently changed the generated corpus. Do not normalize away a mismatch; inspect it before continuing.

- [ ] Run:

```text
bun run test:scripts -- config-catalog config enrich
bun run check:scripts
bun run --cwd apps/layout-editor test -- asset-workspace.test.ts
bun run --cwd apps/layout-editor check
```

- [ ] Commit:

```text
refactor(assets): share config manifest and portrait owners
```

---

## Task 3: Extend the single Reader walk with presentation facts and project usages

**Files:**

- Modify: `apps/layout-editor/src/lib/workbench-types.ts`
- Modify: `apps/layout-editor/src/lib/reader-projection.ts`
- Modify: `apps/layout-editor/src/lib/reader-projection.test.ts`
- Modify: `apps/layout-editor/src/lib/asset-workspace.ts`
- Modify: `apps/layout-editor/src/lib/asset-workspace.test.ts`
- Create: `apps/layout-editor/scripts/verify-asset-real-content.ts`
- Modify: `apps/layout-editor/package.json`

### Single-walk contract

`projectReaderScene()` remains the one scene-type switch and authored-order structural walk.

Add a sibling presentation stream on the projected scene, approximately:

```ts
ReaderScene {
  ...existingReaderFields,
  presentation: ReaderPresentationFact[]
}
```

Presentation facts cover:

```text
dialogue sceneTag assetCue + carrierId + itemIndex
dialogue portrait + carrierId + itemIndex
sublocation/phase structural background + bgm + bgs
phase subject portrait
evidence imageAssetId
investigation sprite layout assetId + characterId
```

`projectDialogue()` may continue returning the same Reader-visible fields; collect presentation from the raw `JSONDialogueItem[]` before stripping it for Reader display.

Do not export/reimplement `SegmentPool`. The current Reader walk continues to `take()` all compiler dialogue carriers and call strict `assertFullyConsumed()`.

### TDD: dialogue + order

- [ ] Write `reader_projection_emits_dialogue_presentation_without_changing_reader_items`: enriched sceneTag/line produce presentation facts while Reader-visible item shape remains the intended HPA-634 text/cue shape.
- [ ] Write linear order test: `main` presentation facts follow exact queue item indexes.
- [ ] Write investigation order test across intro, sublocation transition, hotspot inspect/reexamine, topic dialogue/reexamine, inventory branches, outro. Carrier IDs remain the existing Reader IDs because there is only one walk.
- [ ] Write interrogation order test across intro, phase entry, question-level carriers, line content/challenge/correct/wrong, inventory branches, outro.
- [ ] Preserve the existing strict unconsumed-segment regression. Add a plain text-only carrier regression proving strict structural consumption still occurs even when Assets later emits no usage.

### TDD: structural presentation completeness

- [ ] Emit structural presentation facts at the existing Reader traversal sites for sublocation/phase visual cues, subject portrait, evidence image, and sprite layout.
- [ ] Only `layout.kind === "sprite"` emits a sprite fact; baked does not.
- [ ] Sprite fact keeps the raw asset ID. Asset kind is resolved later by manifest join, so standee/portrait/evidence/background sprite IDs all work.
- [ ] Public Analysis emits presentation only from sanitized intro/result/outro dialogue. No private `assetRefs`/answer data.

Add one independent **test-only recursive completeness oracle**, modeled on `collectBackgroundCues()`:

- recursively inspect compiled public fixture values;
- collect a multiset of all presentation-bearing field occurrences for `backgroundAssetId`, `bgm`, `bgs`, `imageAssetId`, resolved `portrait`, `sceneTag.assetCue`, and sprite `assetId`;
- compare it to the multiset represented by `ReaderScene.presentation`;
- include duplicate occurrences/counts so one repeated asset cannot mask a dropped field;
- keep the oracle independent of production projection helpers.

This replaces hand-written “five structural fields happened to be covered” as the completeness guarantee. Focused field tests can remain for readable semantics.

### TDD: Assets usage projection

`asset-workspace.ts` now consumes `projectReaderScene(...).presentation` for every snapshot scene. It must not switch on `scene.type`.

- [ ] Write `asset_projection_has_no_scene_specific_carrier_walk`: all scene cue/usage input comes from Reader presentation facts.
- [ ] Write `audio_delta_preserves_inherit_stop_set` for BGM and BGS from dialogue/structural visual facts.
- [ ] Write `asset_usage_keeps_concrete_portrait_occurrences_when_display_collapses_state`: usage keeps each item occurrence even if Scene-cue UI later collapses consecutive identical portrait state.
- [ ] Write `sprite_usage_uses_manifest_asset_type` for standee/portrait/evidence/background IDs.
- [ ] Write `unresolved_manifest_usage_remains_visible`: fact without manifest entry remains visible with unresolved diagnostic.
- [ ] Implement deterministic dedupe by chapter + scene + carrier + role + item index + assetId where meaningful.

### Early real-corpus verifier

Create `verify-asset-real-content.ts`, mirroring the existing Reader verifier.

- [ ] Add package script:

```json
"verify:asset-real-content": "bun run scripts/verify-asset-real-content.ts"
```

- [ ] Read fresh generated chapter manifests/scenes, asset manifest/report, config text, and static presence from the repository.
- [ ] Run **every compiled non-Analysis scene** through `projectReaderScene()` + `projectAssetWorkspace()` headlessly.
- [ ] Require no Reader carrier/presentation completeness error.
- [ ] Require every concrete presentation reference to either join a manifest entry or appear in the explicit unresolved diagnostic path.
- [ ] Deliberately skip raw compiled Analysis in this script rather than copying the Rust public whitelist into TypeScript. Rust sanitizer tests + `PublicAnalysisScene` unit fixtures own Analysis until final GUI smoke.
- [ ] Run immediately at the end of Task 3:

```text
bun run scenes:compile
bun run --cwd apps/layout-editor test -- reader-projection.test.ts asset-workspace.test.ts
bun run --cwd apps/layout-editor verify:reader-real-content
bun run --cwd apps/layout-editor verify:asset-real-content
bun run --cwd apps/layout-editor check
```

- [ ] Commit:

```text
feat(editor): project asset facts from Reader walk
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

- [ ] Write mount/loading test and assert selected scene ordered cue rows render after snapshot resolves.
- [ ] Write accessible section-switch test for exactly `Scene cues | Library | Characters`; no router.
- [ ] Implement Scene cues with carrier label/ID, background preview/missing state, BGM/BGS Set/Stop/Inherit, portrait/expression, evidence refs, sprite usages, source reference.
- [ ] Make asset IDs/previews select the corresponding Library item.
- [ ] Write Library kind/search filters. Library entries come from manifest only; `existingAssetPaths` never creates loose rows.
- [ ] Write inspector test for exact asset ID/kind, manifest expected/public path, typed manifest source, four prompt parts, final prompt, presence, usages, diagnostics.
- [ ] Implement image preview using manifest `publicPath` only when present.
- [ ] Implement referenced BGM/BGS audition with native `<audio controls>` only; no audio manager.
- [ ] Add clipboard tests and implement `Copy prompt` / `Copy source` with visible failure state.
- [ ] Add usage-navigation test; selecting usage calls `onSelectScene(chapterId, sceneId)` only.
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

- [ ] Add Characters test with one `portraitMode: portrait` and one `portraitMode: none`; only portrait-bearing character gets expression grid.
- [ ] Implement ID/displayNames/visualPrompt and normalized expressions with shared portrait ID/path, present/missing state, usage count, grouped scenes, related sprite usages.
- [ ] Add regression: configured-but-unused expression is neutral `0 usages`, never warning/error.
- [ ] Add diagnostics test for compiler report warnings, missing files, unresolved joins, shared config-read failures; no approval/status model.
- [ ] Add Refresh race test with two deferred `loadAssetWorkspace()` promises; newer response wins even if older resolves last.
- [ ] Implement one component-local load generation counter invalidated on Refresh/destroy. No watcher/polling.
- [ ] Confirm Refresh only rereads snapshot; it never compiles/generates from UI.
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

- [ ] Write mode-bar test: Reader, Assets, Stage exposed; Reader default.
- [ ] Write Assets selection isolation test: selecting scene in Assets changes selection but does not trigger Stage investigation loading or Reader load from `App.svelte`.
- [ ] Write Reader race regression: start Reader load, switch to Assets, resolve old Reader load; old request cannot write Reader shared cache. Generalize existing epoch rule from “leaving Reader for Stage” to “leaving Reader for any non-Reader mode”.
- [ ] Write Assets -> Stage test: investigation selection loads Stage; non-investigation selection clears Stage and preserves existing placeholder.
- [ ] Implement explicit `setMode()` / `selectScene()` branches; no state-machine/store framework.
- [ ] Render `AssetsView` only for Assets mode.
- [ ] Preserve Reader-only scope/filter/Refresh controls and Stage-only Save Layout controls.
- [ ] Preserve sidebar sublocation gating under Stage.
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

## Task 7: Final real-corpus verification and same-PR closeout

**Files:**

- Modify the two HPA-134 planning docs only if implementation uncovers a factual mismatch.
- Update the existing draft PR body with actual verification results.

### Required automated gates

- [ ] Fresh compiler output + script checks:

```text
bun run scenes:compile
bun run check:scripts
bun run test:scripts
```

- [ ] Full editor projections/tests, including real-data verifiers:

```text
bun run --cwd apps/layout-editor test
bun run --cwd apps/layout-editor verify:reader-real-content
bun run --cwd apps/layout-editor verify:asset-real-content
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run editor:check
```

- [ ] Build actual Workbench:

```text
bun run editor:build
```

- [ ] Repository lint/format/Rust gates:

```text
bun run lint:all
```

`bun run audio:validate` is deliberately absent: it requires `<plan.yaml>` and HPA-134 does not change sound plans.

`bun run background-cues:audit` is optional corpus smoke only. The projection's generic recursive completeness oracle owns structural Assets coverage.

### Parser/identity/source ownership closeout

- [ ] Confirm no second asset-config YAML parser was introduced. Inspect the relevant scope, not transitive dependency presence:

```text
git grep -n -E 'from "yaml"|YAML\.parse' -- apps/layout-editor packages/scripts/compile-scenes/assets
```

Expected production ownership after refactor: no direct parser in `apps/layout-editor`; `config-catalog.ts` owns compile-scenes asset-config YAML parsing. Existing unrelated sound-plan/audio-catalog parsers outside this path are intentionally separate.

- [ ] Confirm no `AssetSegmentPool` and no scene-type switch in `asset-workspace.ts`.
- [ ] Confirm portrait construction/parsing comes from `@lyra/asset-paths`; no new compile-scenes identity module.
- [ ] Confirm audio classification narrows on typed `entry.type === "audio"` and uses typed `source.channel/source.id`.
- [ ] Confirm typed manifest-source refactor added no serialized property and Task 2 real manifest hash remained identical.

### Manual current-corpus smoke

- [ ] Launch Workbench against freshly compiled content.
- [ ] Inspect one linear, one investigation, one interrogation, and one **sanitized Analysis** scene.
- [ ] Verify present visual asset and present BGM/BGS when available.
- [ ] Verify current compiler-report missing asset renders missing; if corpus has none, rely on fixture.
- [ ] Verify Set/Stop/Inherit states current corpus naturally exercises; fixtures own absent variants.
- [ ] Verify character grouping includes unused expressions as neutral 0-use rows.
- [ ] Verify one reused asset shows cross-scene usage when current corpus has one.

### Scope review

- [ ] Inspect `git diff main...HEAD` and confirm HPA-134 only: no Plan mode, source editing, AI, Chapter 2 framework, generation provider, OS opener, DAM, watcher, second manifest, or second scene walker.
- [ ] Update PR #78 with actual command results and keep implementation in the same PR.

## Final self-review checklist

Before marking HPA-134 ready for review:

- [ ] Library is manifest-driven; static scan is presence-only.
- [ ] `projectReaderScene()` is the single authored-order scene/carrier walk for Reader + Assets presentation.
- [ ] Reader-visible items/groups remain behaviorally unchanged; presentation is sibling metadata.
- [ ] Existing strict `SegmentPool.assertFullyConsumed()` remains the dialogue completeness owner.
- [ ] Generic recursive structural oracle covers presentation-bearing compiled fields independently of production projection.
- [ ] `asset-workspace.ts` owns joins/usage/grouping/diagnostics, not scene structure/carrier IDs.
- [ ] Real non-Analysis corpus passes `verify:asset-real-content` at Task 3 and final verification.
- [ ] Analysis remains Rust-sanitized/public; no private cast or duplicated whitelist.
- [ ] Character/audio normalization has one compile-scenes asset-config owner.
- [ ] Editor does not directly parse asset YAML; transitive `yaml` presence is not treated as a defect.
- [ ] Manifest source is statically narrowed by existing asset `type` without a new serialized discriminant.
- [ ] Task 2 ownership refactors preserve real `manifest.json` hash.
- [ ] Portrait ID build/parse belongs to `@lyra/asset-paths`.
- [ ] Referenced manifest prompt/path/source values are not recomposed.
- [ ] Configured-unused portraits use shared portrait ID + existing `expectedPath()` / `publicPath()`.
- [ ] Audio kind uses typed source channel/id; SFX excluded.
- [ ] Only sprite layouts contribute layout asset usage; baked does not.
- [ ] BGM/BGS Inherit/Stop/Set are distinct.
- [ ] Unused configured expressions are neutral 0-use rows.
- [ ] Missing files and failed joins are explicit without new validity policy.
- [ ] Reader cache semantics and Stage behavior remain intact.
- [ ] No new persistent state, DB, writer, generator, DAM, watcher, or OS opener exists.
- [ ] All work remains in the single HPA-134 PR.
