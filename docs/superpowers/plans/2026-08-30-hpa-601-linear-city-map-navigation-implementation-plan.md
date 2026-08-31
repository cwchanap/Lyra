# HPA-601 Linear City-Map Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` inside implementation slices and `superpowers:verification-before-completion` before marking the PR ready.

**Goal:** Introduce the Tokyo city map in Chapter 1 as nine deterministic, single-destination travel gates while preserving existing story, investigation, analysis/interrogation, save, and Aoba contracts.

**Architecture:** Extend the existing investigation model. One compiler-owned `city_map.json` provides stable coordinates and the map-level background prompt. Optional `Map: tokyo` makes an investigation wait at `current_sublocation_id == None` until existing `enter_sublocation` selects a destination. Chapter 1 wrappers auto-outro only after their one destination is entered. The new Story Workbench Assets surface is kept accurate by giving the global map manifest entry a real global-file source and projecting map background usage through Reader presentation facts.

**Tech Stack:** TypeScript scene compiler/Vitest, Rust/Tauri runtime, Svelte 5/Testing Library, existing asset manifest and Story Workbench Assets projection, authored Markdown/JSON, packaged WDIO/Tauri E2E.

**Spec:** `docs/superpowers/specs/2026-08-30-hpa-601-linear-city-map-navigation-design.md`

## Global Constraints

- Deliver all HPA-601 implementation in PR #81.
- Rebase onto current `main` before implementation and before final readiness review.
- Do not modify `docs/stories_plan/final_story_bible.md`, `chapter_1_plan.md`, or `chapter_2_plan.md`.
- Preserve Chapter 1 dialogue, evidence order, questions/objectives/authorizations, analysis boards, interrogation phases, hearing proof order, Prologue, and Aoba reveal contract.
- Reuse `InvestigationSceneState`, visible/unlocked sublocations, `enter_sublocation`, existing command transactions, and current save/restore.
- Add no `travel` scene type, no new Tauri command, no second current-location/unlock/visited/completed collection, and no save migration.
- Do not add `Map Location`; sublocation anchor ID is the topology ID.
- Keep ordinary investigations' current first-unlocked auto-entry and `SublocationNav` behavior.
- A mapped pending investigation must neither auto-enter nor auto-outro before explicit destination selection.
- Mapped travel wrappers have no scene-local visual cue and generate no scene-local raster.
- A mapped investigation never shows `SublocationNav`; the map owns travel.
- Do not add `mapRequested`, a `地圖` button, or return-to-map behavior.
- Keep `shibuya` as a reserved stable topology anchor because the map is intentionally cross-chapter; do not add Shibuya-specific UI leak machinery beyond the general projection rule.
- The Tokyo map background is a **global authored asset** sourced from `docs/stories_plan/city_map.json`; do not fake a Chapter 1 scene source.
- The Assets workbench must show real scene usages for `background.city_map.tokyo`; do not add a second scene walker.
- Generated `apps/game/src-tauri/resources/**` stays untracked.
- PR #81 remains Draft until required packaged gameplay, production-journey, and save evidence passes.

## Load-Bearing Risks

1. **Automatic entry skips the map.** Existing investigation advancement auto-enters the first unlocked sublocation when current is `None`; an empty wrapper would then exhaust and auto-outro.
2. **Compiler guarantees lie for mapped scenes.** Validator inventory analysis and cross-scene reachability model first-unlocked entry as mandatory/guaranteed.
3. **Empty wrapper cues become fake visual units.** Investigation parsing currently manufactures an all-null cue; enrichment treats any non-null cue as a visual unit.
4. **Global asset source no longer fits the manifest type.** Latest `main`'s `BackgroundManifestSource` only has scene-owned shapes.
5. **Assets workbench would show zero map usages.** Reader currently projects sublocation cues, not `scene.map.backgroundAssetId`.
6. **Invalid H1s block authored wrappers.** Every file still needs normal `# Scene N:` / `# Scene N.M:` grammar.
7. **Mapped interiors can expose a second navigation model.** Existing `ExploreView` renders `SublocationNav` once inside a sublocation.
8. **A new unregistered E2E file would never run.** Keep acceptance inside registered specs.
9. **`city_map.json` can go stale in watch mode.** Treat it like root-level `story_catalog.md`.
10. **Save/continue can accidentally auto-select after restore.** Pending map must remain `current_sublocation_id == None`.

---

### Task 1: Compiler topology, authoring metadata, asset contract, and reachability

**Files:**
- Create: `packages/scripts/compile-scenes/city-map.ts`
- Create: `packages/scripts/compile-scenes/city-map.test.ts`
- Modify: `packages/scripts/compile-scenes/types.ts`
- Modify: `packages/scripts/compile-scenes/parser-assets.ts`
- Modify: `packages/scripts/compile-scenes/parser-investigation.ts`
- Modify: `packages/scripts/compile-scenes/parser-investigation.test.ts`
- Modify: `packages/scripts/compile-scenes/validator.ts`
- Modify: `packages/scripts/compile-scenes/validator.test.ts`
- Modify: `packages/scripts/compile-scenes/reachability.ts`
- Modify: `packages/scripts/compile-scenes/reachability.test.ts`
- Modify: `packages/scripts/compile-scenes/orchestrator.ts`
- Modify: `packages/scripts/compile-scenes/watch-inputs.ts`
- Modify: `packages/scripts/compile-scenes/watch-inputs.test.ts`
- Modify: `packages/scripts/compile-scenes/assets/enrich.ts`
- Modify: `packages/scripts/compile-scenes/assets/enrich.test.ts`
- Modify: `packages/scripts/compile-scenes/assets/manifest.ts`
- Modify: `packages/scripts/compile-scenes/assets/manifest.test.ts`
- Modify: `packages/scripts/compile-scenes/emitter.ts`
- Modify: `packages/scripts/compile-scenes/emitter.test.ts`
- Modify: `packages/scripts/compile-scenes.test.ts`
- Modify: `packages/scripts/__snapshots__/compile-scenes.test.ts.snap`
- Modify: `.claude/skills/writing-investigation-scene/SKILL.md`

**Interfaces:**

```ts
type ASTCityMap = {
  version: 1;
  id: "tokyo";
  backgroundPrompt: string;
  locations: Array<{ id: string; label: string; x: number; y: number }>;
  sourceFile: string;
};

type ASTInvestigationScene = ExistingFields & {
  mapId: string | null;
};

type JSONInvestigationMap = {
  id: "tokyo";
  backgroundAssetId: string | null;
  nodes: Array<{ sublocationId: string; x: number; y: number }>;
};
```

`JSONInvestigationScene.map` is always present and nullable.

Extend the manifest background source union minimally:

```ts
type BackgroundManifestSource =
  | ExistingSceneBackgroundSource
  | { globalFile: string };
```

- [ ] **Step 1.1: Write RED city-map parser tests**

Cover valid `version: 1` / `id: tokyo`, invalid JSON/root, unsupported version, wrong map ID, blank prompt, blank/non-slug/duplicate location IDs, blank labels, non-number/non-finite coordinates, and coordinates outside `[0,1]`.

Use these seven intended anchors in the valid fixture:

```text
rain_bell_cafe
kichijoji_shopping_street
police_meeting_room
outsourced_review_office
soma_detective_office
kagami_review_room
shibuya
```

Run:

```bash
bun run test:scripts -- packages/scripts/compile-scenes/city-map.test.ts
```

Expected: FAIL because `city-map.ts` does not exist.

- [ ] **Step 1.2: Implement `parseCityMapJson` using existing JSON-guard style**

Follow `parseInvestigationLayoutJson()`'s small local record/type-guard pattern. Do not add a schema framework or generic map registry.

Re-run Step 1.1; require PASS.

- [ ] **Step 1.3: Write RED optional `Map` metadata tests**

In `parser-investigation.test.ts`, prove:

```text
Map: tokyo directly after Summary => accepted
no Map => mapId null
blank Map => compile error
duplicate/misplaced Map => compile error
Map Location => rejected
normal investigation => unchanged
```

Run the targeted test and require RED.

- [ ] **Step 1.4: Parse optional scene-level `Map`**

Thread `mapId` into sublocation parsing without weakening Summary placement or ordinary scene grammar.

Re-run parser tests; require PASS.

- [ ] **Step 1.5: Write RED all-empty visual-cue tests**

Add a small parser-assets helper test for:

```ts
isEmptyVisualAssetCue(cue)
```

It is true only when Background Prompt, Background Asset ID, BGM, and BGS are all absent/null.

Then add a **corpus-first** mapped-wrapper fixture with no visual metadata and assert:

- no `assetMissingBackgroundPrompt`;
- no `assetFirstCueMissingBgm` / `assetFirstCueMissingBgs`;
- no scene-local wrapper background request;
- one global `background.city_map.tokyo` request.

Negative controls:

- map-less playable sublocation without required background metadata still fails;
- mapped sublocation with real hotspot/character content and no visual metadata still fails.

Run focused parser/enrichment tests; require RED.

- [ ] **Step 1.6: Normalize only mapped travel-only cues to `null`**

After the mapped sublocation is fully parsed, normalize an all-empty cue to `null` only when all are true:

```text
mapId != null
no hotspots
no characters
no entry reveals
no non-scene-tag transition dialogue
all visual fields empty
```

Reuse existing `enrichVisualCue(null)` and Rust `apply_asset_cue(None)` behavior. Do not add a second skip branch in enrichment.

Re-run Step 1.5 tests; require PASS.

- [ ] **Step 1.7: Write RED topology discovery/binding tests**

In compiler integration tests, cover:

- one root-level `city_map.json` across source roots;
- duplicate global map files report both paths;
- mapped scene without topology fails;
- map ID mismatch fails;
- unknown topology ID fails;
- sublocation label mismatch fails;
- map-less corpus without topology still compiles;
- unused topology locations are allowed;
- repeated Rain Bell/KAGAMI uses canonical coordinates;
- emitted nodes include only sublocations authored in the scene.

- [ ] **Step 1.8: Discover one topology in `orchestrator.ts`**

Mirror `story_catalog.md` ownership: parse once, validate after scene parsing, thread to enrichment/emission. Do not add a generic global-file registry.

- [ ] **Step 1.9: Write RED validator first-entry guarantee tests**

Construct equivalent investigations with a first-unlocked sublocation entry reveal:

```text
mapId null => first entry reveal remains guaranteed
mapId tokyo => first entry reveal is not guaranteed from ordering alone
```

Cover both auto-outro and explicit-outro paths.

- [ ] **Step 1.10: Write RED cross-scene reachability graph test**

In `reachability.test.ts`, prove mapped investigation scene entry does not attach first-unlocked entry reveal effects merely because it is first. Normal investigation behavior remains unchanged.

- [ ] **Step 1.11: Correct all first-entry assumptions**

Update both:

```text
validator.ts guaranteed-inventory/entry-reveal logic
reachability.ts buildInvestigationNodes
```

Use `scene.mapId === null` as the auto-entry predicate; never use wrapper scene IDs.

Re-run validator + reachability tests; require PASS.

- [ ] **Step 1.12: Write RED typed global-manifest-source tests**

In `assets/manifest.test.ts`, add a background input:

```ts
{
  assetId: "background.city_map.tokyo",
  type: "background",
  source: { globalFile: "docs/stories_plan/city_map.json" },
  prompt: "Tokyo map prompt"
}
```

Assert serialized source remains exactly that global-file form and path construction is:

```text
static/assets/backgrounds/city_map/tokyo.png
/assets/backgrounds/city_map/tokyo.png
```

Run targeted manifest test; require RED before the type change.

- [ ] **Step 1.13: Add the global background source variant and map manifest request**

Extend only `BackgroundManifestSource`; do not loosen portrait/standee/evidence/audio source contracts.

Thread `cityMap` into `enrichScenesWithAssets` (or the nearest existing asset-enrichment input) and insert one request before/after scene walking without changing `hadVisualCue`:

```ts
putRequest(requests, {
  assetId: "background.city_map.tokyo",
  type: "background",
  source: { globalFile: normalizedCityMapSourcePath },
  prompt: cityMap.backgroundPrompt,
});
```

Rules:

- exactly one request regardless of mapped-scene count;
- no fake chapter/scene source;
- no effect on first-visual-cue state;
- no entry when assets are disabled.

Re-run manifest/enrichment tests; require PASS.

- [ ] **Step 1.14: Write RED/green JSON emission tests**

Mapped scene emits `map` with stable authored-order nodes. Normal investigation emits:

```json
"map": null
```

Assets-disabled mapped scene emits geometry with `backgroundAssetId: null`.

Update snapshots only for intended wire changes.

- [ ] **Step 1.15: Extend the watch seam**

`isCompileScenesWatchPath()` must treat root-level `city_map.json` add/change/unlink like `story_catalog.md`.

Add focused watch tests and require PASS.

- [ ] **Step 1.16: Update the investigation authoring skill**

Document exact `Map` placement, anchor-as-topology-ID, label equality, valid decimal H1s, travel-wrapper no-visual-metadata shape, and no `Map Location` field.

- [ ] **Step 1.17: Run Task 1 verification**

```bash
bun run check:scripts
bun run test:scripts -- \
  packages/scripts/compile-scenes/city-map.test.ts \
  packages/scripts/compile-scenes/parser-investigation.test.ts \
  packages/scripts/compile-scenes/validator.test.ts \
  packages/scripts/compile-scenes/reachability.test.ts \
  packages/scripts/compile-scenes/watch-inputs.test.ts \
  packages/scripts/compile-scenes/assets/enrich.test.ts \
  packages/scripts/compile-scenes/assets/manifest.test.ts \
  packages/scripts/compile-scenes/emitter.test.ts
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
```

Require PASS before continuing.

---

### Task 2: Story Workbench Assets compatibility for the global map asset

**Files:**
- Modify: `apps/layout-editor/src/lib/reader-projection.ts`
- Modify: `apps/layout-editor/src/lib/reader-projection.test.ts`
- Modify: `apps/layout-editor/src/lib/asset-workspace.test.ts`
- Modify: `apps/layout-editor/src/lib/AssetsView.svelte`
- Modify: `apps/layout-editor/src/lib/AssetsView.test.ts`

**Interfaces:**
- Consumes `JSONInvestigationScene.map` from Task 1.
- Consumes the `BackgroundManifestSource | { globalFile }` variant from Task 1.
- Reuses existing `ReaderPresentationFact.kind === "structuralVisualCue"`; no new fact kind or scene walker.

- [ ] **Step 2.1: Write RED Reader map-background presentation test**

Add a mapped investigation fixture whose map contains:

```ts
{
  id: "tokyo",
  backgroundAssetId: "background.city_map.tokyo",
  nodes: [{ sublocationId: "rain_bell_cafe", x: 0.16, y: 0.45 }]
}
```

Assert Reader `presentation` contains exactly one map structural visual fact:

```ts
{
  kind: "structuralVisualCue",
  carrierId: "map:tokyo",
  backgroundAssetId: "background.city_map.tokyo",
  bgm: null,
  bgs: null
}
```

Also update all map-less `satisfies JSONInvestigationScene` fixtures with `map: null`.

Run:

```bash
bun run --cwd apps/layout-editor test -- src/lib/reader-projection.test.ts
```

Expected: RED until Reader projects the map.

- [ ] **Step 2.2: Project map background through the existing Reader walk**

Inside `projectInvestigation`, before ordinary sublocation structural cues, append the map structural fact when `scene.map !== null`.

Do not add a Reader group kind or separate map traversal. Carrier label may fall back to `map:tokyo` in Assets because there is no reader-visible group.

Re-run Reader tests; require PASS.

- [ ] **Step 2.3: Write RED asset-workspace usage test**

Create a payload with:

- one global map manifest entry;
- two mapped investigation scene snapshots using the same map background.

Assert:

```text
library contains one background.city_map.tokyo entry
sceneUsages contains one map:tokyo background usage per mapped scene
usage count is 2
no assetUsageUnresolved diagnostic
```

Run:

```bash
bun run --cwd apps/layout-editor test -- src/lib/asset-workspace.test.ts
```

Expected: PASS only after Step 2.2 if no projection bug remains.

- [ ] **Step 2.4: Write RED AssetsView global-source display test**

Render a library entry with:

```ts
source: { globalFile: "docs/stories_plan/city_map.json" }
```

Assert the source reference displays that path and does not render a fabricated `chapter/scene` source.

Run:

```bash
bun run --cwd apps/layout-editor test -- src/lib/AssetsView.test.ts
```

Expected: RED because `assetSourceReference()` currently dereferences `chapterId/sceneId` unconditionally.

- [ ] **Step 2.5: Narrow global background sources in `AssetsView`**

Implement:

```ts
if ("globalFile" in entry.source) return entry.source.globalFile;
```

Keep existing scene-source lookup unchanged for every scene-owned entry.

Re-run AssetsView tests; require PASS.

- [ ] **Step 2.6: Run full editor compatibility checks**

```bash
bun run --cwd apps/layout-editor check
bun run --cwd apps/layout-editor test
```

No Rust editor changes and no city-map editor UI are allowed in this task.

---

### Task 3: Rust pending-map runtime and save invariant

**Files:**
- Modify: `apps/game/src-tauri/src/game/schema.rs`
- Modify: `apps/game/src-tauri/src/game/view.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Modify: focused existing Rust unit/integration test files under `apps/game/src-tauri/src/game/`
- Modify save capture/restore only if a failing test proves a real gap.

**Interfaces:**
- Consumes emitted `map: JSONInvestigationMap | null`.
- Keeps `InvestigationSceneState` as sole durable owner.

- [ ] **Step 3.1: Write RED schema deserialization tests**

Cover `map: null`, one-node map, two-node map, and assets-disabled `backgroundAssetId: null`.

- [ ] **Step 3.2: Add narrow Rust map schema mirrors**

Mirror compiler JSON exactly; do not create save-specific map types.

- [ ] **Step 3.3: Write RED pending-map no-auto-entry/no-advance test**

For an empty auto-outro mapped fixture, after scene entry/intro exhaustion assert:

```text
same scene index/id
current_sublocation_id None
entered_sublocations empty
Explore mode with sublocation_id None
```

- [ ] **Step 3.4: Gate mapped pending state before normal first auto-entry**

Target flow inside `try_advance_investigation`:

```rust
if no_current_sublocation {
    clear_exhausted_pending_queue_as_required();
    if investigation.def.map.is_some() {
        return Ok(false);
    }
    self.advance_into_first_sublocation(command_id, next_ordinal)?;
    return Ok(false);
}

// evaluate/use outro only after a current sublocation exists
```

Do not alter map-less behavior.

- [ ] **Step 3.5: Write/green one-node selection test**

Call existing `enter_sublocation`; assert entry records once and the empty wrapper advances exactly one scene in the same command transaction.

- [ ] **Step 3.6: Write/green multi-node in-scene selection test**

Two unlocked real nodes: pending map exposes both, selecting B keeps the scene active in B, and A was never auto-entered.

- [ ] **Step 3.7: Write/green public view projection tests**

`ModeView::Explore.sublocation_id` becomes optional. `SceneView::Investigation` exposes optional map data.

Project only currently visible/unlocked sublocations as nodes. A map-less `None` remains the old invariant/fallback; do not synthesize a map.

- [ ] **Step 3.8: Write RED/green save/restore pending-map test**

Save before destination selection, restore, and assert same mapped scene, current `None`, no entered destination, no auto-outro, no replayed one-shot reveal.

Prefer no production save-code change if the existing serialized investigation state already passes.

- [ ] **Step 3.9: Run Rust verification**

```bash
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
```

Require PASS.

---

### Task 4: Svelte pending-map presentation with one travel surface

**Files:**
- Create: `apps/game/src/lib/components/InvestigationMapView.svelte`
- Create: `apps/game/src/lib/components/InvestigationMapView.test.ts`
- Modify: `apps/game/src/lib/components/ExploreView.svelte`
- Modify: `apps/game/src/lib/components/ExploreView.test.ts`
- Modify: `apps/game/src/lib/state/types.ts` or nearest public view type mirror as required.

- [ ] **Step 4.1: Write RED one-node map component test**

Assert 16:9 map, resolved background, native destination button, accessible location+objective name, `data-map-destination`, one callback invocation, and disabled-state protection.

- [ ] **Step 4.2: Implement `InvestigationMapView`**

Reuse `percent(value)` and `--x/--y` normalized positioning convention from `InvestigationSceneSurface.svelte`. Do not add canvas hit testing or pixel coordinates.

- [ ] **Step 4.3: Write RED multi-node DOM/focus test**

Two projected nodes render in authored order; unavailable topology nodes are absent; DOM order is keyboard focus order; no visited/completed presentation exists.

- [ ] **Step 4.4: Write RED `ExploreView` switch tests**

Cover:

```text
mapped + current null => InvestigationMapView
mapped + current set => InvestigationSceneSurface, no SublocationNav
mapless + current set => existing InvestigationSceneSurface + SublocationNav
```

- [ ] **Step 4.5: Integrate `ExploreView` and suppress parallel navigation**

When `scene.map !== null`, never render `SublocationNav`. Do not add `mapRequested`, `地圖`, or return-to-map behavior.

- [ ] **Step 4.6: Run Svelte verification**

```bash
bun run --cwd apps/game check
bun run --cwd apps/game test -- \
  src/lib/components/InvestigationMapView.test.ts \
  src/lib/components/ExploreView.test.ts
bun run --cwd apps/game test
```

Require PASS.

---

### Task 5: Production topology, nine wrappers, Scene 11 split, and one map raster

**Files:**
- Create: `docs/stories_plan/city_map.json`
- Create: `docs/stories_plan/chapter_1/investigation_scene_map_01.md`
- Create: `docs/stories_plan/chapter_1/investigation_scene_map_02.md`
- Create: `docs/stories_plan/chapter_1/investigation_scene_map_03.md`
- Create: `docs/stories_plan/chapter_1/investigation_scene_map_04.md`
- Create: `docs/stories_plan/chapter_1/investigation_scene_map_05.md`
- Create: `docs/stories_plan/chapter_1/investigation_scene_map_06.md`
- Create: `docs/stories_plan/chapter_1/investigation_scene_map_07.md`
- Create: `docs/stories_plan/chapter_1/investigation_scene_map_08.md`
- Create: `docs/stories_plan/chapter_1/investigation_scene_map_09.md`
- Create: `docs/stories_plan/chapter_1/scene_11_2.md`
- Create: `static/assets/backgrounds/city_map/tokyo.png`
- Modify: `docs/stories_plan/chapter_1/chapter.md`
- Modify: `docs/stories_plan/chapter_1/scene_11.md`
- Modify only compiler production snapshots/content anchors and Scene 11 raster paths proven necessary by compilation.

- [ ] **Step 5.1: Author `city_map.json`**

Use the seven coordinates from the spec, including reserved `shibuya`. Raster contains no text/pins; UI owns labels and interaction.

- [ ] **Step 5.2: Author nine wrappers with exact valid H1s**

```text
map_01: # Scene 2.1: 前往雨鐘咖啡館
map_02: # Scene 3.1: 前往警署臨時會面室
map_03: # Scene 4.1: 前往 KAGAMI 證據摘要審查室
map_04: # Scene 5.1: 前往吉祥寺商店街
map_05: # Scene 6.1: 返回雨鐘咖啡館
map_06: # Scene 8.6: 前往外包資料審查分室
map_07: # Scene 9.1: 前往 KAGAMI 證據摘要審查室
map_08: # Scene 10.1: 返回雨鐘咖啡館
map_09: # Scene 11.1: 前往相馬偵探事務所
```

Each wrapper has Summary, `Map: tokyo`, one unlocked mapped sublocation, one scene tag, `Outro: auto`, and no visual metadata/interactions/reveals/inventory/story-state changes.

- [ ] **Step 5.3: Insert wrappers into `chapter.md` at fixed boundaries**

```text
scene_2 -> map_01 -> investigation_scene_3
investigation_scene_3 -> map_02 -> interrogation_scene_4
interrogation_scene_4 -> map_03 -> scene_5
scene_5 -> map_04 -> scene_6
scene_6 -> map_05 -> investigation_scene_7
analysis_scene_8_5 -> map_06 -> investigation_scene_9
investigation_scene_9 -> map_07 -> interrogation_scene_10
interrogation_scene_10 -> map_08 -> scene_11 Rain Bell portion
scene_11 Rain Bell portion -> map_09 -> scene_11_2
```

- [ ] **Step 5.4: Split Scene 11 only at the existing location boundary**

Keep Rain Bell case-close material in `scene_11.md`. Move Soma office USB, `ZW_A16.lock`, Amemiya source exclusion, Aoba media bridge, and final Rain Bell umbrella cinematic to:

```markdown
# Scene 11.2: 相馬事務所與章間媒體橋
```

Give it an authored Summary. Preserve dialogue/cue order. Do not add a tenth map before the cinematic cutaway.

- [ ] **Step 5.5: Compile before generating art**

```bash
bun run scenes:compile
bun run check:scripts
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
```

Require:

- ten new authored files pass grammar;
- exactly nine mapped wrappers;
- each wrapper has one mapped node;
- repeated Rain Bell/KAGAMI IDs reuse coordinates;
- exactly one global map manifest entry with `source.globalFile = docs/stories_plan/city_map.json`;
- zero wrapper-local map background requests;
- no story/proof/reachability regression.

- [ ] **Step 5.6: Generate only the one map raster**

Use the existing Lyra image-asset workflow from the manifest prompt.

Asset contract:

```text
static/assets/backgrounds/city_map/tokyo.png
1920x1080
opaque RGB PNG
no readable text
no baked labels
no baked pins/icons
no characters
```

- [ ] **Step 5.7: Verify the new Assets workbench sees the real asset**

Run:

```bash
bun run --cwd apps/layout-editor verify:asset-real-content
```

Require the generated manifest/library to resolve the map asset path and real file. If the verifier reports a global-source assumption, fix that inside Task 2 scope rather than bypassing the verifier.

- [ ] **Step 5.8: Resolve Scene 11 moved asset IDs**

Compare pre/post-split manifests. Move/regenerate only assets whose scene-local expected paths genuinely changed. Do not hand-edit generated JSON.

- [ ] **Step 5.9: Re-run production compiler checks**

```bash
bun run scenes:compile
bun run check:scripts
bun run test:scripts
bun run --cwd apps/layout-editor verify:asset-real-content
```

Require PASS.

---

### Task 6: Deterministic E2E drain and registered-suite acceptance

**Files:**
- Modify: `apps/game/src/lib/e2e/pending-acquisition-drain.ts`
- Modify: corresponding unit test for the pure helper module
- Modify: `apps/game/e2e-tauri/helpers.ts`
- Modify: `apps/game/e2e-tauri/production-anchors.ts`
- Modify: `apps/game/e2e-tauri/investigation-layout.e2e.ts`
- Modify: `apps/game/e2e-tauri/production-journey.e2e.ts`
- Modify: `apps/game/e2e-tauri/save-resume.e2e.ts`

Do **not** add `city-map.e2e.ts` and do not modify the suite registry merely to route a new file.

- [ ] **Step 6.1: Write RED pure sole-destination tests**

Add:

```ts
soleMapDestinationId(ids: readonly string[]): string | null
```

Behavior:

```text
[] => null
[one] => that id
[two or more] => deterministic error in Chapter 1 drain mode
```

Keep DOM querying out of the pure helper.

- [ ] **Step 6.2: Make production drain map-aware**

When Explore has no current sublocation:

1. query enabled `[data-map-destination]` buttons;
2. pass IDs to the pure helper;
3. click the sole destination if present;
4. fail on several rather than guessing;
5. continue normal dialogue/acquisition flow.

Do not hardcode nine wrapper IDs.

- [ ] **Step 6.3: Add mouse + keyboard acceptance to registered gameplay spec**

In `investigation-layout.e2e.ts`, use `jumpToProductionScene("investigation_scene_map_01")` or the nearest current production setup.

Cover:

- map background renders;
- exactly one destination enabled;
- mouse activation advances to intended Rain Bell investigation;
- fresh setup + Tab/Enter activates same destination;
- no double activation/scene skip.

- [ ] **Step 6.4: Make production journey cross all nine map gates**

Update generic drain and `production-journey.e2e.ts` so the normal Chapter 1 route crosses the wrappers without hanging.

Run explicitly:

```bash
cd apps/game
node scripts/run-save-e2e.mjs --suite production-journey
```

- [ ] **Step 6.5: Add pending-map save/resume acceptance to `save-resume.e2e.ts`**

Before selecting map 01 destination:

1. save through existing UI/helpers;
2. leave/load/continue per suite behavior;
3. assert same pending map returns;
4. assert no auto-selection;
5. select Rain Bell;
6. assert next scene starts once and no reveal/acquisition duplicates.

- [ ] **Step 6.6: Run E2E static and packaged gates**

```bash
bun run --cwd apps/game check:e2e
bun run --cwd apps/game test:e2e:ci-contracts
bun run --cwd apps/game test:e2e:gameplay
(cd apps/game && node scripts/run-save-e2e.mjs --suite production-journey)
bun run --cwd apps/game test:e2e:save
```

If packaged infrastructure cannot execute, record the exact blocker and keep PR #81 Draft. Do not substitute compiler/unit evidence for the packaged product gate.

---

### Task 7: Full regression, latest-main rebase, and closeout

**Files:**
- Modify only files required by verified failures.
- Do not add follow-up tickets for defects inside agreed HPA-601 scope.

- [ ] **Step 7.1: Rebase onto latest `main`**

Before final verification, rebase/refresh the branch so merge-base equals current `main`. Re-run any affected targeted tests if the rebase touches compiler, asset workbench, runtime, or E2E seams.

- [ ] **Step 7.2: Run full automated matrix**

```bash
bun run scenes:compile
bun run check:scripts
bun run test:scripts
bun run --cwd apps/layout-editor check
bun run --cwd apps/layout-editor test
bun run --cwd apps/layout-editor verify:reader-real-content
bun run --cwd apps/layout-editor verify:asset-real-content
bun run --cwd apps/game check
bun run --cwd apps/game test
bun run --cwd apps/game check:e2e
bun run --cwd apps/game test:e2e:ci-contracts
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run lint:all
```

Then run all packaged gates from Task 6.

- [ ] **Step 7.3: Inspect changed/generated output policy**

```bash
git status --short
```

Require:

- generated `apps/game/src-tauri/resources/**` not staged;
- no Story Bible / high-level Chapter 1/2 plan edits;
- exactly one city-map raster;
- no wrapper-local map rasters;
- only manifest-required Scene 11 raster moves;
- no generic map framework/editor/registry;
- no fake scene source for the global map manifest entry.

- [ ] **Step 7.4: Manual acceptance**

Walk Chapter 1 and confirm:

- nine map stops occur at intended boundaries;
- every stop has one destination;
- repeated locations stay at the same coordinates;
- map activation feels like travel confirmation, not fake choice;
- mapped scenes never show legacy `SublocationNav`;
- map-less investigations are unchanged;
- final Rain Bell umbrella cutaway remains cinematic;
- Chapter 1 story/proof order is unchanged apart from explicit map-interaction time;
- Story Workbench Assets lists the Tokyo map with `city_map.json` as source and non-zero scene usage.

- [ ] **Step 7.5: Draft exit rule**

PR #81 may leave Draft only after final-head evidence exists for all of:

- compiler topology/reachability/watch tests;
- typed global manifest-source tests;
- Reader/Assets-workbench map usage tests;
- editor real-content verification;
- Rust pending-map no-auto-entry/no-auto-outro test;
- first-map mouse packaged test;
- first-map keyboard packaged test;
- production-journey crossing all map gates;
- pending-map save/resume packaged test;
- full selected regression matrix.
