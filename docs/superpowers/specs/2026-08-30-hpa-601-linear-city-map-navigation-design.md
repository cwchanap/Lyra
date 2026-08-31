# HPA-601 Linear City-Map Navigation Design

## Status

Approved design, revalidated against `main` at `975295b2455956bd9a5cb4f04da1e2f5dc553177` on 2026-08-31.

The core approach is unchanged: reuse the investigation model and `enter_sublocation`; do not add a travel scene type, second navigation state, or save migration.

The latest-main review found one material integration update: the newly shipped Story Workbench Assets surface now treats the compiler asset manifest as a typed library and derives per-scene usage through Reader presentation facts. HPA-601 therefore must make the global Tokyo map background first-class in that manifest/editor contract instead of pretending it is owned by an arbitrary Chapter 1 scene.

This feature changes navigation/presentation only. It does not change Chapter 1 plot order, evidence acquisition, analysis/interrogation proof order, character motivation, side-content policy, or the Aoba reveal contract.

## Product goal

Introduce the Tokyo city-map interaction in Chapter 1 without introducing free exploration:

- every approved cross-location transition opens the map;
- exactly one destination is available each time;
- the player must explicitly activate that destination to continue;
- no Chapter 1 side quests, route choices, action points, travel costs, or missable evidence are added;
- Chapter 2 remains the first chapter with simultaneous destinations and player-chosen investigation order.

Chapter 1 map scenes are **linear travel wrappers**. They reuse the same topology, pending-map projection, map surface, and `enter_sublocation` mutation that future free investigation will use, but they are not the full Chapter 2 lifecycle.

## Existing seams to extend

| Concern | Existing seam |
|---|---|
| Durable investigation progress | `InvestigationSceneState` |
| Destination mutation | frontend `enterSublocation()` -> Rust `enter_sublocation` |
| Global authored-file discovery | `story_catalog.md` handling in compiler orchestrator |
| Global authored-file watch | `story_catalog.md` handling in `watch-inputs.ts` |
| JSON sidecar parsing style | `parseInvestigationLayoutJson()` in `layout.ts` |
| Nullable visual cue path | `ASTSublocation.assetCue: VisualAssetCue | null` + `enrichVisualCue(!cue)` + Rust `apply_asset_cue(None)` |
| Asset path construction | `@lyra/asset-paths::publicPathForAssetId()` |
| Typed asset manifest | `packages/scripts/compile-scenes/assets/manifest.ts` |
| Asset library/source display | `apps/layout-editor/src/lib/AssetsView.svelte` |
| Per-scene asset usage | Reader `presentation` facts -> `asset-workspace.ts` |
| Investigation UI | `ExploreView.svelte`, `SublocationNav.svelte`, `InvestigationSceneSurface.svelte` |
| Positioned controls | normalized `x/y` -> CSS `--x/--y` convention in `InvestigationSceneSurface.svelte` |
| Pure E2E drain decisions | `apps/game/src/lib/e2e/pending-acquisition-drain.ts` |
| Production scene setup | `jumpToProductionScene()` |
| Save/resume | existing scene index + investigation state |

Do not create parallel state, path logic, asset registries, or scene walkers where these seams already exist.

## Considered approaches

### A. Optional map presentation on existing investigation scenes — selected

A mapped investigation can wait with `current_sublocation_id == None`. While waiting, the frontend renders positioned destination buttons. Selecting one calls the existing `enter_sublocation` command.

Chapter 1 uses nine one-node investigation wrappers that immediately auto-outro only **after** their sole node is entered.

### B. Pending travel metadata on every scene type — rejected

Would couple travel state to the chapter sequencer and expand save semantics across linear, investigation, analysis, and interrogation scenes.

### C. New `travel` scene type — rejected

Would duplicate parser/runtime/view/save/frontend machinery for a selection surface already expressible by investigation sublocations.

### D. One giant Chapter 1 investigation — rejected

Would fight existing scene ownership and nest hearings/linear scenes inside an investigation lifecycle.

## 1. One fixed Tokyo topology

Add one global authored file:

```text
docs/stories_plan/city_map.json
```

HPA-601 supports exactly one map ID: `tokyo`. `version: 1` is a parse guard matching existing layout-sidecar style, not a versioning policy.

```json
{
  "version": 1,
  "id": "tokyo",
  "backgroundPrompt": "Stylized illustrated investigation map of modern Tokyo at night after rain, restrained dark navy, charcoal and muted teal, subtle district silhouettes and rail or road traces, generous clean negative space around navigation nodes, no readable text, no labels, no icons, no pins, no characters, 16:9 composition.",
  "locations": [
    { "id": "rain_bell_cafe", "label": "雨鐘咖啡館", "x": 0.16, "y": 0.45 },
    { "id": "kichijoji_shopping_street", "label": "吉祥寺商店街", "x": 0.21, "y": 0.34 },
    { "id": "police_meeting_room", "label": "警署臨時會面室", "x": 0.29, "y": 0.50 },
    { "id": "outsourced_review_office", "label": "外包資料審查分室", "x": 0.34, "y": 0.29 },
    { "id": "soma_detective_office", "label": "相馬偵探事務所", "x": 0.54, "y": 0.38 },
    { "id": "kagami_review_room", "label": "KAGAMI 證據摘要審查室", "x": 0.72, "y": 0.45 },
    { "id": "shibuya", "label": "澀谷", "x": 0.50, "y": 0.68 }
  ]
}
```

`shibuya` remains intentionally reserved now. The product requirement is that the same city map persists across chapters; reserving the already-known Chapter 2 district prevents later art/topology drift. Existence in topology does not project it into Chapter 1.

Topology owns only:

- canonical map ID;
- map-level background prompt;
- location IDs/labels;
- normalized presentation coordinates.

It does **not** own routes, edges, chapter phases, unlocks, travel cost, visited/completed state, NPC schedules, or exact GIS data.

Compiler rules:

- at most one `city_map.json` exists across source roots;
- `version === 1`;
- `id === "tokyo"`;
- unique non-empty slug location IDs;
- non-empty labels;
- finite `x/y` in `[0,1]`;
- unused topology locations are allowed;
- the topology background is registered once as `background.city_map.tokyo`.

## 2. Authoring contract

A mapped investigation adds one optional scene-level field immediately after Summary:

```markdown
- **Map:** tokyo
```

No `Map Location` field exists. The existing sublocation anchor is the topology ID:

```markdown
## Sub-location: 雨鐘咖啡館 {#rain_bell_cafe}
```

The authored label must exactly match the topology label.

Every file still follows normal scene H1 grammar. Filenames determine scene IDs; H1 labels do not.

Canonical wrapper:

```markdown
# Scene 2.1: 前往雨鐘咖啡館

- **Summary:** 調查增田圭死亡現場。
- **Map:** tokyo

## Intro

## Sub-location: 雨鐘咖啡館 {#rain_bell_cafe}

- **Status:** unlocked

[場景：東京調查地圖／雨鐘咖啡館]

## Outro

- **Unlock:** auto
```

A Chapter 1 wrapper contains no transition dialogue, hotspots, characters, evidence, statements, or entry reveals.

## 3. Travel-only visual cue rule

Ordinary investigation sublocations still require their normal authored visual cue when assets are enabled. Do not globally turn every empty asset metadata block into `null`.

For a **mapped travel-only sublocation only**, investigation parsing normalizes an all-empty visual cue to `null` after confirming:

- scene has `Map`;
- no Background Prompt / Background Asset ID / BGM / BGS;
- no hotspots;
- no characters;
- no entry reveals;
- no non-scene-tag transition dialogue.

Use a small parser-assets helper to recognize an all-empty cue, but make the travel-wrapper eligibility decision in investigation parsing where the scene/sub-location shape is known.

Consequences:

- `enrichVisualCue(null)` takes the existing early return;
- the wrapper does not become the corpus first visual unit;
- no `assetFirstCueMissingBgm/Bgs` error is produced;
- no scene-local map raster is requested;
- Rust `apply_asset_cue(None)` keeps prior visual/audio state untouched;
- the only map raster request is `background.city_map.tokyo`.

A corpus-first fixture must exercise this rule so first-cue behavior is real rather than vacuous.

## 4. Compiler output and analysis laws

`ASTInvestigationScene` gains:

```ts
mapId: string | null;
```

`JSONInvestigationScene` gains an always-present nullable field:

```ts
map: JSONInvestigationMap | null;
```

```ts
type JSONInvestigationMap = {
  id: "tokyo";
  backgroundAssetId: string | null;
  nodes: Array<{
    sublocationId: string;
    x: number;
    y: number;
  }>;
};
```

The map node does not duplicate the sublocation label; runtime projection joins the canonical visible sublocation with node coordinates.

### Compiler reachability law

Any compile-time rule that relies on normal runtime auto-entry must be conditional on `scene.mapId === null`.

This applies to both:

- guaranteed inventory / entry-reveal analysis in `validator.ts`;
- cross-scene graph construction in `reachability.ts`.

For mapped investigations, the first unlocked sublocation is **available**, not automatically entered. Its entry reveals are guaranteed only when another existing mandatory-content/outro rule actually requires entry.

Do not key this behavior to Chapter 1 wrapper IDs.

### Type ownership

Map wire types remain in `packages/scripts/compile-scenes/types.ts` because that file owns compiler-emitted investigation JSON. Do not mirror them into `@lyra/scene-types` in this slice.

The layout editor imports `JSONInvestigationScene` from `@lyra/scripts`, so typed fixtures must add `map: null` or mapped fixture data as appropriate.

## 5. Global map asset manifest contract

Latest `main` changed the asset manifest into a typed library contract. `BackgroundManifestSource` currently assumes a background belongs to a chapter scene. The Tokyo map prompt belongs to `docs/stories_plan/city_map.json`, so HPA-601 must not attach a fake Chapter 1 scene source simply to satisfy the type.

Extend the background source union with one global authored-file form:

```ts
type BackgroundManifestSource =
  | ExistingSceneBackgroundSource
  | { globalFile: string };
```

For the Tokyo map entry:

```ts
{
  assetId: "background.city_map.tokyo",
  type: "background",
  source: { globalFile: "docs/stories_plan/city_map.json" },
  prompt: cityMap.backgroundPrompt
}
```

Rules:

- register exactly one global request regardless of mapped-scene count;
- never use a pseudo chapter/scene ID;
- keep path construction in `@lyra/asset-paths`;
- expected path remains `static/assets/backgrounds/city_map/tokyo.png`;
- public path remains `/assets/backgrounds/city_map/tokyo.png`;
- assets-disabled compilation emits `backgroundAssetId: null` and no manifest entry.

## 6. Story Workbench Assets compatibility

The new Assets workbench has two independent concepts that HPA-601 must keep correct:

1. **Library source** — where the prompt/manifest entry comes from.
2. **Scene usage** — which compiled scenes actually display/reference the asset.

### Library source

`AssetsView.assetSourceReference()` currently assumes `entry.source.chapterId/sceneId`. It must narrow the new background global-file variant:

```ts
if ("globalFile" in entry.source) return entry.source.globalFile;
```

No map editor UI is added. This only keeps the generic asset library source link accurate.

### Scene usage

Reader currently projects investigation sublocation visual cues but knows nothing about `scene.map.backgroundAssetId`. Without a Reader fact, `background.city_map.tokyo` would appear in the Assets library with zero usages even though every wrapper uses it.

For a mapped investigation, Reader must emit one existing `structuralVisualCue` presentation fact for the map surface:

```ts
{
  kind: "structuralVisualCue",
  carrierId: `map:${scene.map.id}`,
  backgroundAssetId: scene.map.backgroundAssetId,
  bgm: null,
  bgs: null
}
```

Do not add a second scene walker. Do not add a new Reader group kind just for the map. `asset-workspace.ts` already consumes `structuralVisualCue`, dedupes by scene/carrier/asset, and falls back to the carrier ID when no Reader group label exists.

Required editor behavior:

- the map background appears once in the manifest library;
- its source points to `docs/stories_plan/city_map.json`;
- each mapped scene contributes a concrete background usage row for `map:tokyo`;
- Assets Scene Cues shows the map background for a mapped wrapper;
- map-less scenes are unchanged;
- no layout-editor Rust change is required because the backend passes manifest/scene JSON through as `serde_json::Value`.

## 7. Runtime pending-map law

`InvestigationSceneState` remains the only durable owner. No save fields are added.

Normal investigations retain existing first-unlocked auto-entry.

Mapped investigations use this law:

```text
map.is_some() && current_sublocation_id.is_none()
=> pending player destination selection
=> do not auto-enter first sublocation
=> do not evaluate/use auto-outro completion to advance
=> remain in Explore
```

The current skip mechanism is the normal `advance_into_first_sublocation` path: without the map gate it auto-enters the wrapper destination; the resulting empty queue re-enters advancement with a current sublocation and satisfies the empty auto-outro. Gate mapped pending state **before** first-sublocation auto-entry.

After `enter_sublocation`:

- existing mutation records entry;
- an empty wrapper exhausts immediately;
- auto-outro may now satisfy;
- the scene advances exactly once in the same command transaction.

A real mapped multi-node fixture selects one node and remains inside the same investigation because it has normal content. HPA-601 does not implement returning from that interior to the map.

Public view changes:

```rust
ModeView::Explore {
    sublocation_id: Option<String>,
    ...
}
```

and:

```rust
SceneView::Investigation {
    ...,
    map: Option<InvestigationMapView>,
}
```

Only mapped investigation state may validly project Explore with `sublocation_id: None`.

## 8. Frontend ownership

Add:

```text
apps/game/src/lib/components/InvestigationMapView.svelte
```

Responsibilities:

- resolve `background.city_map.tokyo` through the existing story-asset resolver;
- render a responsive 16:9 map;
- position native `<button>` pins using the existing normalized-coordinate `--x/--y` convention;
- use the current scene Summary as travel objective;
- expose accessible names such as `前往：雨鐘咖啡館 — 調查增田圭死亡現場。`;
- set `data-map-destination=<sublocationId>` for deterministic E2E selection;
- disable destinations while a gameplay command is in flight;
- render only nodes projected for currently visible/unlocked scene sublocations.

`ExploreView.svelte` chooses:

```text
scene.map != null && currentSublocationId == null
=> InvestigationMapView

currentSublocationId != null
=> InvestigationSceneSurface
```

When `scene.map != null`, suppress `SublocationNav` completely. The map is the only travel surface for mapped investigations.

No `mapRequested`, local `地圖` toggle, or return-to-map behavior is added in HPA-601.

## 9. Chapter 1 route wrappers

Add nine investigation files. Filenames remain `investigation_scene_map_01.md` ... `investigation_scene_map_09.md`; H1 titles use normal decimal grammar:

| Wrapper | H1 | Destination | Inserted after |
|---|---|---|---|
| map 01 | `# Scene 2.1: 前往雨鐘咖啡館` | `rain_bell_cafe` | `scene_2.md` |
| map 02 | `# Scene 3.1: 前往警署臨時會面室` | `police_meeting_room` | `investigation_scene_3.md` |
| map 03 | `# Scene 4.1: 前往 KAGAMI 證據摘要審查室` | `kagami_review_room` | `interrogation_scene_4.md` |
| map 04 | `# Scene 5.1: 前往吉祥寺商店街` | `kichijoji_shopping_street` | `scene_5.md` |
| map 05 | `# Scene 6.1: 返回雨鐘咖啡館` | `rain_bell_cafe` | `scene_6.md` |
| map 06 | `# Scene 8.6: 前往外包資料審查分室` | `outsourced_review_office` | `analysis_scene_8_5.md` |
| map 07 | `# Scene 9.1: 前往 KAGAMI 證據摘要審查室` | `kagami_review_room` | `investigation_scene_9.md` |
| map 08 | `# Scene 10.1: 返回雨鐘咖啡館` | `rain_bell_cafe` | `interrogation_scene_10.md` |
| map 09 | `# Scene 11.1: 前往相馬偵探事務所` | `soma_detective_office` | Rain Bell portion of `scene_11.md` |

Split current `scene_11.md` only at its existing Rain Bell -> Soma office location boundary.

New `scene_11_2.md` begins:

```markdown
# Scene 11.2: 相馬事務所與章間媒體橋
```

It contains, without plot rewrite:

- Soma office USB sequence;
- `ZW_A16.lock` access failure;
- Amemiya source exclusion;
- public Aoba media bridge;
- final Rain Bell blue-umbrella cinematic cutaway.

The final Rain Bell exterior remains cinematic and does not create a tenth map interaction.

## 10. Save/resume

Pending map state is already representable by:

- chapter + scene index pointing to a mapped investigation;
- `current_sublocation_id == None`;
- no destination entry recorded.

Save/load must restore that exact state. Loading must not:

- auto-select the sole destination;
- auto-enter the first sublocation;
- auto-outro the wrapper;
- replay one-shot reveals.

No save schema version or migration is required.

## 11. E2E ownership and Draft-exit gate

Do not add an unregistered `city-map.e2e.ts`.

Use existing enumerated suites:

- map mouse/keyboard acceptance: extend `investigation-layout.e2e.ts`;
- pending-map save/resume: extend `save-resume.e2e.ts`;
- full Chapter 1 route crossing: extend `production-journey.e2e.ts` and generic drain logic.

`production-journey.e2e.ts` is a distinct `production-journey` suite, not part of the direct `--suite gameplay` command. Draft-exit verification must execute it explicitly in addition to gameplay and save suites.

Extend the nearest pure E2E helper with a sole-destination decision:

```ts
soleMapDestinationId(ids: readonly string[]): string | null
```

Contract:

- exactly one enabled destination => return its ID;
- zero => no map decision;
- more than one during deterministic Chapter 1 drain => fail rather than guess.

The generic production drain clicks only the sole `data-map-destination`; it does not hardcode nine scene IDs.

PR #81 remains Draft until final-head packaged evidence exists for:

- first-map mouse activation;
- first-map keyboard activation;
- pending-map save/resume before selection;
- production Chapter 1 journey crossing all map gates.

## 12. Explicit non-goals

- Chapter 1 free exploration or side quests.
- Chapter 2 playable content.
- Chapter 2 return-to-map UX.
- Decorative visited/completed pins.
- Map edges, route animation, zoom/pan, clustering, pathfinding, trains, travel costs, or time simulation.
- NPC schedule simulation.
- Generic map registry.
- Map editor or layout-editor map UI.
- New scene type, IPC command, durable map-progress collection, or save schema.
- Exact Tokyo GIS geography.
- Story-plan, case, evidence, hearing, dialogue, or Aoba canon changes.

## Acceptance summary

HPA-601 is complete only when:

- exactly nine Chapter 1 wrapper scenes compile with valid `# Scene N.M:` H1s;
- each exposes exactly one destination and waits for explicit player activation;
- mapped pending state cannot auto-enter or auto-outro;
- selecting a wrapper destination advances exactly once;
- map-less investigations keep current automatic first-entry behavior;
- validator and cross-scene reachability no longer assume first mapped node entry;
- travel-only wrappers normalize their empty visual cue to `null` without weakening ordinary investigation asset requirements;
- exactly one `background.city_map.tokyo` manifest entry exists with source `docs/stories_plan/city_map.json`;
- the Assets workbench shows real mapped-scene usages for that background;
- `city_map.json` is discovered and watched like `story_catalog.md`;
- mapped interiors suppress `SublocationNav`;
- layout-editor typed fixtures and Assets workbench tests remain green;
- `verify:asset-real-content` passes after the map raster exists;
- save/resume restores a pending map without selection/skip;
- required gameplay, production-journey, and save packaged checks pass before the PR leaves Draft.
