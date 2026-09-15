# Regional Anime City Map Design Specification

> **Status:** Draft design and implementation handoff for Draft PR #89. The six canonical runtime PNGs are committed; topology/compiler/Rust/UI wiring has not started yet.
> **Baseline:** `main` @ `4feeb0782d99fd9523063ee343f6df5a3d3306ef`.
> **Delivery rule:** design, runtime art, implementation, and verification stay in this single PR.

Related documents: [implementation plan](../plans/2026-09-12-regional-city-maps-implementation-plan.md) and the existing [HPA-601 linear city-map design](2026-08-30-hpa-601-linear-city-map-navigation-design.md).

## 1. Goal and scope

Replace the current “one Tokyo background plus scattered pins” presentation with a two-level map:

1. **Tokyo overview** — establishes city shape and relative district placement.
2. **District submap** — provides a readable illustrated neighborhood for the current investigation.

This is a presentation/navigation improvement on the existing investigation flow, not an open-world or travel-engine project.

| Layer | Question | Responsibility in this PR |
| --- | --- | --- |
| Tokyo overview | Where are the districts relative to each other? | Stable city silhouette, legal district entries, overview-direct destinations |
| District map | Where can I go inside this district? | Kichijoji, Shibuya, Shinjuku, Kabukicho, Ginza/Minato |
| Case spatial evidence | Who saw what and how could someone move? | Case-specific evidence; not a third generic map layer |

Out of scope: GIS, 3D/WebGL, free camera, pathfinding, travel cost, timetable simulation, map-specific save state, visited semantics, map editor, weather/day-night variants, or new travel IPC.

## 2. Existing seams to reuse

| Concern | Existing source | This PR |
| --- | --- | --- |
| Topology | `docs/stories_plan/city_map.json` | One-time v2 cutover with regions + `regionId` |
| Parser/compiler | `city-map.ts`, `orchestrator.ts`, `types.ts`, `emitter.ts` | Extend existing map wire |
| Global art manifest | `assets/enrich.ts`, `@lyra/asset-paths` | Register overview + five district assets once |
| Rust projection | `schema.rs`, `view.rs`, `mod.rs`, `navigation.rs` | Project only legal regions/destinations |
| Map UI | `InvestigationMapView.svelte`, `ExploreView.svelte` | Add overview/district projection and return-to-map |
| Image transition | `CrossfadeImage.svelte` | Reuse existing transition/cancellation behavior |
| Session reset | `presentationState.sessionEpoch` in `+page.svelte` | Reset only Explore state for scene/session identity |
| E2E helpers | `soleMapDestinationId()`, existing WDIO suites | Keep region controls out of leaf travel helpers |

Existing laws remain unchanged: mapped investigations wait with `current_sublocation_id == None`; pending mapped scenes do not auto-enter/outro; actual travel remains `enter_sublocation`; Chapter 1 remains nine one-destination wrappers; mapped scenes suppress `SublocationNav`.

## 3. District model and shared ID namespace

| Region ID | Display name | Visual identity | Production use in this PR |
| --- | --- | --- | --- |
| `kichijoji` | Kichijoji | Low-rise streets, cafe warmth, rail/station, green space | `rain_bell_cafe`, `kichijoji_shopping_street` |
| `shibuya` | Shibuya | Large screens, event plaza, glass-box area, dense commercial blocks | Art + non-production test coverage |
| `shinjuku` | Shinjuku | Quiet clinic block against dense skyline | Art preparation |
| `kabukicho` | Kabukicho | Theater frontage, nightlife streets, restrained red/violet neon | Art preparation |
| `ginza_minato` | Ginza / Minato | Ordered commercial avenue to towers/waterfront | Art preparation |

Kabukicho remains a neighborhood view within greater Shinjuku. Ginza/Minato is intentionally compressed presentation, not a claim that every point shown is walkable.

### Shared slug namespace

`regions[].id` and `locations[].id` share one namespace across the whole topology.

- v2 removes the old reserved `shibuya` location; the `shibuya` region owns that slug.
- parser validation rejects any region/location collision.
- future topology edits cannot reintroduce a location whose ID matches a region.

Existing Chapter 1 destinations `police_meeting_room`, `outsourced_review_office`, `soma_detective_office`, and `kagami_review_room` stay `regionId: null` overview-direct destinations.

## 4. Compiler and runtime projection ownership

### Manifest

`assets/enrich.ts` registers Tokyo + all five district backgrounds once through the existing `globalFile` path. Unused future district art may exist with zero scene usage.

### Scene wire

`cityMapJsonForScene` **must emit only regions referenced by that scene's emitted nodes**. It must not serialize every global topology region into every mapped scene.

### Rust view

Rust projects a region only when at least one currently visible/unlocked node has that `regionId`. A region referenced only by locked/hidden leaves is absent entirely.

Frontend renders projected `map.regions` as given and never unions in global topology data. This is the spoiler boundary.

## 5. Pure plane projection

Overview/district selection is a pure projection, not ad-hoc Svelte filtering.

Add a tiny module next to the view with:

```ts
initialActiveRegionId(nodes)
projectMapPlane(map, activeRegionId)
```

Contracts:

- all currently legal leaves share one non-null region → that region;
- otherwise initial region is `null` overview;
- overview plane = projected regions + `regionId == null` leaves;
- district plane = only the selected region's leaves;
- invalid/unavailable region falls back to overview;
- overview-direct nodes never render on district art;
- district nodes never render on Tokyo art.

Vitest these helpers directly. The Svelte view binds the result.

## 6. Player flow and return-to-map

- one legal non-null region → open that district directly;
- mixed regions or any overview-direct leaf → open Tokyo overview;
- region selection changes presentation only;
- only a leaf can travel.

Return-to-map stays in this PR:

- mapped interior HUD exposes `data-map-open`, copy `地圖`, only when `inv.map && currentSublocationId != null`;
- open map exposes `data-map-close` only when an interior exists;
- open/close is local presentation state only;
- selecting current leaf closes locally and does **not** call `enter_sublocation`;
- selecting another legal leaf calls existing travel exactly once;
- failed travel keeps map open;
- successful travel closes/resets from returned state;
- pending-map state has no close-to-interior control.

Region controls use `data-map-region`, never `data-map-destination`.

## 7. Transient state and reset rules

- `mapOpen` belongs to `ExploreView` only.
- `activeRegionId` and raster-loading presentation state belong to `InvestigationMapView` only.
- `GameShell` remains keyed by `presentationState.sessionEpoch` only.
- Reset/remount **ExploreView only** on `${sessionEpoch}:${scene.id}` or equivalent local effect.
- Do not key on `currentSublocationId`, revision, or the whole game-state object.
- same-scene load resets because load increments session epoch.
- reuse existing GameShell inert and `disabled={gameState.inFlight}` plumbing; no second blocker path.

## 8. Visual/responsive contract

Raster art stays pure environment art: rainy anime neo-noir Tokyo, no baked labels/pins/routes/characters/bodies/spoilers.

This PR has **one navigation surface only**: map pins/buttons.

- labels remain visible below 720 px;
- labels may wrap/reposition;
- targets are >=44 px;
- overlap is fixed by coordinates/layout, not a second textual destination list;
- one destination = one native button/tab stop;
- state is not communicated by color alone.

## 9. Raster loading identity

Do not add another image loader/request registry. Reuse `CrossfadeImage` plus existing cancelled asset resolution.

- transition key is `${activeRegionId ?? "overview"}:${backgroundAssetId}`;
- markers render only for the raster identity that has actually loaded;
- during switch, new-plane markers stay hidden until the matching raster is active;
- A → B → A settles on final A raster + A markers;
- missing-art fallback keeps named native controls usable;
- reduced-motion comes from existing `CrossfadeImage` behavior.

`planeKind` is not separate state; `activeRegionId == null` already means overview.

## 10. Topology schema

One authored file: `docs/stories_plan/city_map.json`. Use one-time `version: 2`; no v1 parser/migration.

```ts
type CityMap = {
  version: 2;
  id: "tokyo";
  backgroundPrompt: string;
  regions: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    backgroundPrompt: string;
  }>;
  locations: Array<{
    id: string;
    label: string;
    regionId: string | null;
    x: number;
    y: number;
  }>;
};
```

Validation: one shared unique slug namespace, normalized coordinates `[0,1]`, valid `regionId` references, authored anchor/label consistency. Unused regions are legal; empty/locked-only regions never become runtime UI.

Authored scenes keep `- **Map:** tokyo`.

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

Do not add map types to `@lyra/scene-types`; keep them in `compile-scenes/types.ts`.

## 11. Canonical runtime art and Workbench

Canonical copies:

| Asset ID | Path |
| --- | --- |
| `background.city_map.tokyo` | `static/assets/backgrounds/city_map/tokyo.png` |
| `background.city_map.kichijoji` | `static/assets/backgrounds/city_map/kichijoji.png` |
| `background.city_map.shibuya` | `static/assets/backgrounds/city_map/shibuya.png` |
| `background.city_map.shinjuku` | `static/assets/backgrounds/city_map/shinjuku.png` |
| `background.city_map.kabukicho` | `static/assets/backgrounds/city_map/kabukicho.png` |
| `background.city_map.ginza_minato` | `static/assets/backgrounds/city_map/ginza_minato.png` |

All remain opaque RGB 1920×1080 PNG. If one fails overlay review, replace that same path and re-measure only that map's anchors. No image versioning/copy pipeline.

Reader uses `map:tokyo` and `map:tokyo:<regionId>` structural carriers. Do not add a second scene walker or map editor.

## 12. Story/spoiler boundaries

- **Shibuya:** public plaza, giant screen, human-scale glass booth, surrounding streets, ordinary commercial exterior allowed; no M-03, service-elevator internals, vacant-floor space, sight cones, or final transfer route.
- **Shinjuku:** exterior clinic/neighborhood only; no ward layout, Aoba labels, memory-tech internals, or left/right clues.
- **Kabukicho:** public theater frontage/service street only; no stage machinery, lift compartments, body positions, 90-second mechanism, or blue-umbrella reveal.
- **Ginza/Minato:** roads illustrative only; no suspect route, live vehicle path, timing arrow, or evidentiary distance claim.

## 13. Chapter 1 invariants

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

Decorative art does not create gameplay nodes.

## 14. Verification ownership

No fake production scene or Tauri-only fixture catalog.

- pure plane helpers → focused Vitest;
- `InvestigationMapView.test.ts` → region/leaf projection, loaded-raster marker gating, narrow labels, fallback behavior;
- `ExploreView.test.ts` → map open/close, current-leaf local close, different-leaf travel;
- Rust `navigation.rs` → extend existing mapped multi-node and locked-node projection tests, including locked-only region absent;
- packaged WDIO/Tauri → existing `investigation-layout.e2e.ts`, `save-resume.e2e.ts`, `production-journey.e2e.ts`.

Tokyo/Shibuya overlay checks are manual visual gates in wired Tauri UI, not screenshot E2E assertions.

## 15. Acceptance criteria

1. Six canonical runtime PNGs remain at final paths and pass opaque RGB 1920×1080 validation.
2. v2 uses a shared region/location namespace; reserved location `shibuya` is removed; collisions are rejected.
3. Global manifest registers all six backgrounds once.
4. Scene JSON emits only regions referenced by that scene's nodes.
5. Rust projects only regions with >=1 legal visible/unlocked leaf; locked-only regions are absent.
6. `initialActiveRegionId` and `projectMapPlane` are pure tested helpers; coordinate planes never mix.
7. Only `data-map-destination` leaves travel; `data-map-region` is presentation-only.
8. Mapped interiors expose `data-map-open`; open maps expose `data-map-close`; current-leaf selection closes locally with no IPC.
9. GameShell stays sessionEpoch-only; Explore map state resets on sessionEpoch + scene identity, never revision/current sublocation.
10. Narrow layouts keep labels visible and >=44 px targets; no second destination list.
11. Region changes reuse `CrossfadeImage`; markers are gated to loaded raster identity, including A → B → A and missing-art cases.
12. Chapter 1 nine wrappers retain order and exactly one legal leaf each.
13. Multi-node/return behavior is covered in component/Rust tests without fake production content.
14. `bun run test:e2e` remains a Draft-exit gate; run `production-journey.e2e.ts` explicitly if the chosen suite excludes it.
15. Tokyo/Shibuya visual gates are inspected in actual Tauri UI; failed art is replaced in place without new image infrastructure.

## 16. Design review conclusion

The feature stays deliberately small: one topology, one investigation lifecycle, one travel command, one map component family, two pure projection helpers, and transient presentation state only.