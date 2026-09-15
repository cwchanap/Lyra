# Regional Anime City Map Design Specification

> **Status:** Draft design and implementation handoff for Draft PR #89. The six canonical runtime PNGs are committed; topology/compiler/Rust/UI wiring has not started yet.
> **Baseline:** `main` @ `4feeb0782d99fd9523063ee343f6df5a3d3306ef`.
> **Delivery rule:** design, runtime art, implementation, and verification stay in this single PR.

Related documents: [implementation plan](../plans/2026-09-12-regional-city-maps-implementation-plan.md) and the existing [HPA-601 linear city-map design](2026-08-30-hpa-601-linear-city-map-navigation-design.md).

## 1. Goal and scope

Replace the current “one Tokyo background plus scattered pins” presentation with a two-level map:

1. **Tokyo overview** — establishes the city shape and the relative position of major districts.
2. **District submap** — gives the current investigation a readable illustrated neighborhood with spatially meaningful destinations.

This is a presentation/navigation improvement on the existing investigation flow, not an open-world or travel-engine project.

| Layer | Question | Responsibility in this PR |
| --- | --- | --- |
| Tokyo overview | Where are the districts relative to each other? | Stable city silhouette, legal district entries, overview-direct destinations |
| District map | Where can I go inside this district? | Kichijoji, Shibuya, Shinjuku, Kabukicho, Ginza/Minato |
| Case spatial evidence | Who saw what and how could someone move? | Remains case-specific evidence; not a third generic map layer |

Out of scope: GIS, 3D/WebGL, free camera, pathfinding, travel cost, timetable simulation, map-specific save state, visited semantics, map editor, weather/day-night variants, or new travel IPC.

## 2. Existing seams to reuse

| Concern | Existing source | This PR |
| --- | --- | --- |
| Topology | `docs/stories_plan/city_map.json` | One-time v2 cutover with regions + `regionId` |
| Parser/compiler | `city-map.ts`, `orchestrator.ts`, `types.ts`, `emitter.ts` | Extend existing map wire |
| Global art manifest | `assets/enrich.ts`, `@lyra/asset-paths` | Register overview + five district assets once |
| Rust projection | `schema.rs`, `view.rs`, `mod.rs`, `navigation.rs` | Project only legal regions/destinations |
| Map UI | `InvestigationMapView.svelte`, `ExploreView.svelte` | Add overview/district plane projection and return-to-map |
| Image transition | `CrossfadeImage.svelte` | Reuse existing transition/cancellation behavior |
| Session reset | `presentationState.sessionEpoch` in `+page.svelte` | Reset only the Explore subtree for scene/session identity |
| E2E helpers | `soleMapDestinationId()`, existing WDIO suites | Keep region controls out of leaf travel helpers |

Existing laws that stay unchanged:

- mapped investigations wait with `current_sublocation_id == None` until a leaf is selected;
- pending mapped scenes do not auto-enter or auto-outro;
- actual travel remains `enter_sublocation`;
- Chapter 1 remains nine one-destination wrappers;
- mapped scenes continue to suppress `SublocationNav`.

## 3. District model and shared ID namespace

The first map set contains five districts.

| Region ID | Display name | Visual identity | Production use in this PR |
| --- | --- | --- | --- |
| `kichijoji` | Kichijoji | Low-rise streets, cafe warmth, rail/station, green space | `rain_bell_cafe`, `kichijoji_shopping_street` |
| `shibuya` | Shibuya | Large screens, event plaza, glass-box area, dense commercial blocks | Art + non-production test coverage |
| `shinjuku` | Shinjuku | Quiet clinic block against dense skyline | Art preparation |
| `kabukicho` | Kabukicho | Theater frontage, nightlife streets, restrained red/violet neon | Art preparation |
| `ginza_minato` | Ginza / Minato | Ordered commercial avenue to towers/waterfront | Art preparation |

Kabukicho remains a neighborhood view within greater Shinjuku. Ginza/Minato is an intentionally compressed presentation region, not a claim that every point shown is walkable.

### 3.1 Region and location IDs share one slug namespace

`regions[].id` and `locations[].id` must be unique across the whole `city_map.json` document, not merely within their own arrays.

- v2 removes the old reserved `shibuya` location; the `shibuya` region replaces that slug.
- `parseCityMapJson` rejects any region/location collision with the existing duplicate-ID failure family.
- future topology edits cannot reintroduce a location whose ID matches any region.

Existing Chapter 1 destinations `police_meeting_room`, `outsourced_review_office`, `soma_detective_office`, and `kagami_review_room` stay `regionId: null` overview-direct destinations for this slice.

## 4. Compiler and runtime projection contract

Three layers have distinct ownership and must not compensate for each other.

### 4.1 Asset manifest: all topology art

`assets/enrich.ts` registers the Tokyo overview and all five district backgrounds once through the existing `globalFile` ownership path. Unused future district art is allowed to exist with zero production-scene usage.

### 4.2 Scene wire: referenced regions only

`cityMapJsonForScene` **must emit only regions referenced by that scene’s emitted nodes**. It must not serialize every topology region into every mapped scene.

For a scene with only Kichijoji nodes, its scene JSON contains Kichijoji only. A future Shinjuku/Kabukicho/Ginza region must not appear in that scene JSON or DOM merely because the global topology knows it exists.

### 4.3 Rust view: legal regions only

Rust already filters map nodes to currently visible/unlocked leaves. It must project a region only when at least one currently visible/unlocked node has that `regionId`.

A region referenced only by locked/hidden leaves is absent from the view entirely. The frontend renders the projected `map.regions` as given and never unions them with global topology data.

This is the spoiler boundary.

## 5. Pure plane projection

Overview-versus-district is a small pure projection, not logic buried in Svelte markup.

Add one tiny module next to `InvestigationMapView` with:

```ts
initialActiveRegionId(nodes)
projectMapPlane(map, activeRegionId)
```

Contracts:

- `initialActiveRegionId(nodes)` returns the shared non-null `regionId` only when every currently legal leaf belongs to that same region; otherwise it returns `null` for overview.
- `projectMapPlane(map, null)` returns `map.regions` plus overview-direct nodes (`regionId == null`).
- `projectMapPlane(map, regionId)` returns only that region and only nodes whose `regionId` matches it.
- overview-direct nodes never render on a district raster;
- district nodes never render on the Tokyo raster;
- invalid/unavailable region IDs fall back to overview rather than inventing content.

Vitest this module directly. `InvestigationMapView.svelte` should only bind the resulting buttons/markers.

## 6. Player flow and controls

### 6.1 Pending-map entry

- one legal non-null region → open that district directly;
- mixed regions or any overview-direct leaf → open Tokyo overview;
- region selection changes presentation only;
- only a leaf destination can travel.

### 6.2 Return-to-map stays in this PR

This PR keeps the minimum return-to-map behavior needed by Chapter 2 instead of deferring it into a second navigation design.

- When `inv.map && currentSublocationId != null`, the mapped interior HUD exposes one native button: `data-map-open`, copy `地圖`.
- Opening it sets local `mapOpen = true`; it does not clear `currentSublocationId`.
- While `mapOpen && currentSublocationId != null`, expose one `data-map-close` control.
- Close/cancel returns to the same interior without IPC.
- Selecting the **current** leaf closes the map locally and does **not** call `enter_sublocation`.
- Selecting a different legal leaf calls the existing travel callback exactly once.
- Failed travel keeps the map open; successful travel renders the returned state and closes/resets local map state.
- Pending-map state (`currentSublocationId == null`) has no “return to scene” control.

Region controls must use `data-map-region`; they must never use `data-map-destination`.

## 7. Transient state and reset rules

- `mapOpen` belongs to `ExploreView` only.
- `activeRegionId` and raster-loading presentation state belong to `InvestigationMapView` only.
- `GameShell` stays keyed by `presentationState.sessionEpoch` only; do not add scene identity to the GameShell key.
- Reset/remount **ExploreView only** on `${sessionEpoch}:${scene.id}` (or use an equivalent local effect).
- Do not key/reset on `currentSublocationId`, durable revision, or every game-state object.
- same-scene load is already covered because load bumps `sessionEpoch`.
- reuse existing `GameShell` inert behavior and existing `disabled={gameState.inFlight}` plumbing; do not create a second blocker path for map UI.

## 8. Visual and responsive contract

### 8.1 Art

The committed raster remains pure environment art:

- grounded anime neo-noir Tokyo;
- elevated three-quarter view;
- rainy blue-gray atmosphere, wet reflections, restrained neon, warm lights;
- no baked labels, pins, route arrows, characters, bodies, or spoiler clues.

### 8.2 Labels and controls

This PR uses **one navigation surface only**: map pins/buttons.

- keep destination labels visible on narrow windows; remove the current “hide labels below 720px” behavior;
- labels may wrap/reposition as needed;
- targets are at least 44 px;
- if overlap occurs, adjust measured coordinates/layout; do **not** add a second textual destination list in this PR;
- one native button/tab stop per destination;
- region/leaf state is communicated with shape/text/focus treatment, not color alone.

## 9. Raster loading identity

Do not add a second image loader/request registry.

Reuse `CrossfadeImage` and the existing cancelled `resolveStoryAsset` flow.

- transition identity is `${activeRegionId ?? "overview"}:${backgroundAssetId}`;
- markers render only for the raster identity that has finished loading;
- during a region switch, hide/freeze the new plane’s markers until its raster is the loaded identity;
- A → B → A must settle on the final A identity;
- reduced-motion behavior comes from existing `CrossfadeImage` support;
- if art is missing/fails to resolve, named destination controls remain usable on the existing placeholder/fallback path.

`planeKind` is not a separate state dimension; `activeRegionId == null` already means overview.

## 10. Topology schema

Keep one authored topology file: `docs/stories_plan/city_map.json`.

Use a one-time `version: 2` cutover; there is no v1 parser or migration converter.

```ts
type CityMap = {
  version: 2;
  id: "tokyo";
  backgroundPrompt: string;
  regions: Array<{
    id: string;
    label: string;
    x: number; // Tokyo overview anchor
    y: number;
    backgroundPrompt: string;
  }>;
  locations: Array<{
    id: string;
    label: string;
    regionId: string | null;
    x: number; // district coordinates when regionId != null; overview otherwise
    y: number;
  }>;
};
```

Validation requirements:

- one shared unique slug namespace across regions + locations;
- finite normalized coordinates in `[0,1]`;
- every non-null `regionId` references an existing region;
- authored sublocation anchors/labels continue to match topology entries;
- unused regions are legal;
- empty/locked-only regions never become runtime UI entries.

Authored scenes continue to use `- **Map:** tokyo`.

Compiler-emitted scene shape remains:

```ts
type JSONInvestigationMap = {
  id: "tokyo";
  backgroundAssetId: string | null;
  regions: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    backgroundAssetId: string | null;
  }>;
  nodes: Array<{
    sublocationId: string;
    regionId: string | null;
    x: number;
    y: number;
  }>;
};
```

Do not add map types to `@lyra/scene-types`; HPA-601 intentionally keeps this wire in `compile-scenes/types.ts`.

## 11. Canonical runtime art and Workbench

The following are the only canonical copies for this feature:

| Asset ID | Path |
| --- | --- |
| `background.city_map.tokyo` | `static/assets/backgrounds/city_map/tokyo.png` |
| `background.city_map.kichijoji` | `static/assets/backgrounds/city_map/kichijoji.png` |
| `background.city_map.shibuya` | `static/assets/backgrounds/city_map/shibuya.png` |
| `background.city_map.shinjuku` | `static/assets/backgrounds/city_map/shinjuku.png` |
| `background.city_map.kabukicho` | `static/assets/backgrounds/city_map/kabukicho.png` |
| `background.city_map.ginza_minato` | `static/assets/backgrounds/city_map/ginza_minato.png` |

All six must remain opaque RGB 1920×1080 PNGs. Replacing one after overlay review means replacing that same path and re-measuring that map’s anchors; do not introduce image versioning/copy pipelines.

Reader uses existing `structuralVisualCue` carriers:

- `map:tokyo`;
- `map:tokyo:<regionId>`.

Do not add a second scene walker or map editor. Keep multi-prompt Workbench authoring read-only if the existing write-back seam cannot safely edit the global topology source.

## 12. Story/spoiler boundaries

- **Shibuya:** public plaza, giant screen, human-scale glass booth, surrounding streets, ordinary commercial exterior are allowed. Do not reveal M-03, service-elevator internals, vacant-floor murder space, sight cones, or final transfer route.
- **Shinjuku:** exterior clinic/neighborhood only; no ward layout, Aoba labels, memory-tech internals, or left/right clues.
- **Kabukicho:** public theater frontage and ordinary service street only; no stage machinery, lift compartments, body positions, 90-second mechanism, or blue-umbrella reveal.
- **Ginza/Minato:** roads are illustrative; no suspect route, live vehicle path, timing arrow, or evidentiary distance claim.

## 13. Chapter 1 invariants

All nine existing wrappers retain their story order and one legal leaf each.

| Wrapper | Destination | Presentation |
| --- | --- | --- |
| `investigation_scene_map_01` | `rain_bell_cafe` | Kichijoji direct |
| `investigation_scene_map_02` | `police_meeting_room` | Overview direct |
| `investigation_scene_map_03` | `kagami_review_room` | Overview direct |
| `investigation_scene_map_04` | `kichijoji_shopping_street` | Kichijoji direct |
| `investigation_scene_map_05` | `rain_bell_cafe` | Kichijoji direct |
| `investigation_scene_map_06` | `outsourced_review_office` | Overview direct |
| `investigation_scene_map_07` | `kagami_review_room` | Overview direct |
| `investigation_scene_map_08` | `rain_bell_cafe` | Kichijoji direct |
| `investigation_scene_map_09` | `soma_detective_office` | Overview direct |

Decorative landmarks never become Chapter 1 gameplay nodes merely because they are visible in the art.

## 14. Verification ownership

The multi-node/return-to-map behavior is proven in existing test homes, not by adding a fake production scene.

- pure plane helpers: focused Vitest module tests;
- `InvestigationMapView.test.ts`: region/leaf projection, loaded-raster marker gating, narrow labels, reduced motion integration;
- `ExploreView.test.ts`: `data-map-open`, `data-map-close`, cancel, current-leaf local close, different-leaf travel;
- Rust `navigation.rs`: extend the existing mapped multi-node helper and locked-node projection tests, including “locked-only region is absent”;
- packaged WDIO/Tauri: keep the existing HPA-601 homes (`investigation-layout.e2e.ts`, `save-resume.e2e.ts`, `production-journey.e2e.ts`). Do not add a fixture catalog or fake production scene.

Tokyo/Shibuya overlay checks are manual visual gates in the wired Tauri UI, not screenshot-E2E assertions.

## 15. Acceptance criteria

1. Six canonical runtime PNGs remain at `static/assets/backgrounds/city_map/` and pass opaque RGB 1920×1080 metadata validation.
2. `city_map.json` v2 uses one shared region/location slug namespace; old reserved location `shibuya` is removed and collisions are rejected.
3. Global manifest registers all six map backgrounds once.
4. Scene JSON emits only regions referenced by that scene’s nodes.
5. Rust projects only regions containing at least one currently visible/unlocked leaf; locked-only regions are absent.
6. `initialActiveRegionId` and `projectMapPlane` are pure, focused-tested helpers; overview/direct and district nodes never mix planes.
7. Only `data-map-destination` leaves can travel; `data-map-region` is presentation-only.
8. Mapped interiors expose `data-map-open`; open maps expose `data-map-close` when an interior exists; current-leaf selection closes locally with no IPC.
9. GameShell remains keyed by session epoch only; Explore map state resets on session epoch + scene identity, never on revision/current sublocation.
10. Narrow layouts keep labels visible and >=44 px targets; no second textual destination list is added.
11. Region changes reuse `CrossfadeImage`; markers are gated to the loaded raster identity, including A → B → A and missing-art cases.
12. Chapter 1’s nine wrappers retain order and exactly one legal leaf each.
13. Return-to-map/multi-node behavior is covered in component/Rust tests without a fake production scene.
14. `bun run test:e2e` remains a Draft-exit gate and `production-journey.e2e.ts` is run explicitly as part of verification.
15. Tokyo/Shibuya visual gates are inspected in the actual Tauri UI; a failed map is replaced in place without new image infrastructure.

## 16. Design review conclusion

The feature remains deliberately small: one topology, one investigation lifecycle, one travel command, one map component family, two pure projection helpers, and transient presentation state only. Future chapters can opt into the prepared district art without requiring a second navigation architecture.