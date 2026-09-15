# Regional Anime City Map Design Specification

> **Status:** Draft handoff for Draft PR #89. Six canonical runtime PNGs are committed; topology/compiler/Rust/UI wiring has not started.
> **Baseline:** `main` @ `4feeb0782d99fd9523063ee343f6df5a3d3306ef`.
> **Delivery rule:** design, runtime art, implementation, and verification stay in this single PR.

Related: [implementation plan](../plans/2026-09-12-regional-city-maps-implementation-plan.md) and [HPA-601 linear city-map design](2026-08-30-hpa-601-linear-city-map-navigation-design.md).

## 1. Goal

Replace the current “one Tokyo background plus scattered pins” with two presentation levels:

1. **Tokyo overview** — city shape and district relationship.
2. **District submap** — readable investigation destinations inside one region.

Case-specific sight lines/routes remain evidence content, not a third generic navigation layer.

Out of scope: GIS, 3D, pathfinding, travel cost, map save state, visited semantics, map editor, new travel IPC, day/night variants.

## 2. Reuse existing seams

- `city_map.json` → one-time v2 cutover.
- `compile-scenes/city-map.ts`, `orchestrator.ts`, `types.ts`, `emitter.ts` → extend existing map wire.
- `assets/enrich.ts` + `@lyra/asset-paths` → register all six global backgrounds once.
- Rust `schema.rs` / `view.rs` / `mod.rs` / `navigation.rs` → filter/project legal map state.
- `InvestigationMapView.svelte` + `ExploreView.svelte` → one map component family.
- `CrossfadeImage.svelte` → reuse transition/cancellation behavior.
- `presentationState.sessionEpoch` → existing load/session reset seam.
- existing WDIO helpers/suites → keep leaf travel deterministic.

Pending-map law does not change: mapped scenes wait with `current_sublocation_id == None`; only a leaf travels through `enter_sublocation`.

## 3. Districts and shared slug namespace

| Region | Visual identity | Production use in this PR |
| --- | --- | --- |
| `kichijoji` | low-rise streets, cafe warmth, station/green space | Chapter 1 cafe + shopping street |
| `shibuya` | screens, event plaza, human-scale glass booth | art + non-production test coverage |
| `shinjuku` | medical/business block against skyline | art preparation |
| `kabukicho` | theater/nightlife, restrained red-violet neon | art preparation |
| `ginza_minato` | commercial avenue to towers/waterfront | art preparation |

`regions[].id` and `locations[].id` share one namespace.

- Remove old reserved `shibuya` location in v2; the region owns that slug.
- Parser rejects region/location ID collisions.
- Existing Chapter 1 overview-direct nodes remain `regionId: null`.

## 4. Projection ownership

Three layers are locked:

1. **Manifest:** register all topology backgrounds once.
2. **Scene JSON:** `cityMapJsonForScene` emits only regions referenced by that scene's emitted nodes.
3. **Rust view:** project a region only if >=1 currently visible/unlocked node has that `regionId`.

Frontend renders projected `map.regions` as given and never unions global topology back in. Locked-only/future regions must not leak into Chapter 1 DOM or accessibility text.

## 5. Pure map-plane helpers

Add a tiny adjacent pure module:

```ts
initialActiveRegionId(nodes)
projectMapPlane(map, activeRegionId)
```

Rules:

- one shared non-null region across all legal leaves → open that district;
- otherwise → overview (`null`);
- overview plane = projected regions + `regionId == null` leaves;
- district plane = selected-region leaves only;
- invalid region → overview;
- overview and district coordinates never mix.

These rules are unit-tested outside Svelte rendering.

## 6. Return-to-map contract

Keep return-to-map in this PR.

- mapped interior: `data-map-open`, copy `地圖`;
- open map from interior: `data-map-close`;
- open/close is local presentation state only;
- selecting current leaf closes locally and sends no `enter_sublocation` IPC;
- selecting another legal leaf travels exactly once;
- failed travel keeps map open;
- pending-map state has no close-to-interior control;
- region controls use `data-map-region`, never `data-map-destination`.

## 7. Reset and input blocking

- `mapOpen` lives in `ExploreView`.
- `activeRegionId`/image-loading presentation state live in `InvestigationMapView`.
- `GameShell` remains keyed by `presentationState.sessionEpoch` only.
- Reset/key **Explore only** on `${sessionEpoch}:${scene.id}` or equivalent local effect.
- Never key on current sublocation or revision.
- Reuse existing GameShell inert + `gameState.inFlight` disabled path; no second blocker state machine.

## 8. Responsive UI

One navigation surface only: map buttons/pins.

- keep labels visible below 720 px;
- wrap/reposition as needed;
- >=44 px targets;
- fix overlap through measured coordinates/layout;
- do not add a second textual destination list;
- one destination = one native button/tab stop.

## 9. Raster transition identity

Reuse `CrossfadeImage`; no new loader/request registry.

- transition key: `${activeRegionId ?? "overview"}:${backgroundAssetId}`;
- markers render only for the raster identity that has loaded;
- A → B → A must finish on A raster + A markers;
- missing-art fallback keeps named native controls usable;
- reuse existing reduced-motion handling.

`planeKind` is redundant; `activeRegionId == null` means overview.

## 10. Topology schema

One authored `docs/stories_plan/city_map.json`, version 2 only.

```ts
type CityMap = {
  version: 2;
  id: "tokyo";
  backgroundPrompt: string;
  regions: Array<{ id: string; label: string; x: number; y: number; backgroundPrompt: string }>;
  locations: Array<{ id: string; label: string; regionId: string | null; x: number; y: number }>;
};
```

Validation: shared unique slug namespace, normalized coordinates `[0,1]`, valid region references, authored anchor/label consistency. Unused regions are legal globally but empty/locked-only regions never become runtime UI.

Scene wire remains in `compile-scenes/types.ts`; do not add map types to `@lyra/scene-types`.

## 11. Canonical runtime art

Only these copies exist:

- `static/assets/backgrounds/city_map/tokyo.png`
- `static/assets/backgrounds/city_map/kichijoji.png`
- `static/assets/backgrounds/city_map/shibuya.png`
- `static/assets/backgrounds/city_map/shinjuku.png`
- `static/assets/backgrounds/city_map/kabukicho.png`
- `static/assets/backgrounds/city_map/ginza_minato.png`

All remain opaque RGB 1920×1080 PNGs. Replace failed art in place and re-measure that map only; no image copy/versioning pipeline.

Reader uses `map:tokyo` and `map:tokyo:<regionId>` structural carriers. No second scene walker/map editor.

## 12. Story/spoiler boundaries

- **Shibuya:** public plaza/screen/glass booth/exterior only; no M-03, service-elevator internals, vacant-floor space, sight cones, final transfer route.
- **Shinjuku:** exterior clinic/neighborhood only; no ward/Aoba/memory-tech/left-right clues.
- **Kabukicho:** public theater/service street only; no stage machinery/lifts/body positions/90-second mechanism/blue-umbrella reveal.
- **Ginza/Minato:** roads are illustrative; no suspect route/timing/evidentiary distance claim.

## 13. Chapter 1 invariants

All nine existing wrappers keep their order and one legal leaf each. Kichijoji opens directly for `rain_bell_cafe` / `kichijoji_shopping_street`; police/review/office nodes remain overview-direct. Decorative landmarks do not become gameplay nodes.

## 14. Verification ownership

No fake production scene or Tauri-only fixture catalog.

- pure plane helper Vitest;
- `InvestigationMapView.test.ts` → projection/loading/narrow/fallback;
- `ExploreView.test.ts` → open/close/current-leaf/different-leaf behavior;
- Rust `navigation.rs` → extend existing mapped multi-node and locked-node tests, including locked-only region absent;
- existing packaged WDIO/Tauri homes: `investigation-layout.e2e.ts`, `save-resume.e2e.ts`, `production-journey.e2e.ts`.

Tokyo/Shibuya overlay checks are manual Tauri visual gates, not screenshot E2E.

## 15. Acceptance criteria

1. Six final runtime PNGs pass opaque RGB 1920×1080 validation.
2. v2 shared region/location namespace; reserved location `shibuya` removed; collisions rejected.
3. Global manifest registers all six backgrounds once.
4. Scene JSON emits only referenced regions.
5. Rust emits only regions with legal visible/unlocked leaves.
6. Pure plane helpers prevent coordinate mixing.
7. Only `data-map-destination` leaves travel; `data-map-region` is presentation-only.
8. `data-map-open` / `data-map-close` exist for mapped interiors; current leaf closes locally with no IPC.
9. GameShell remains sessionEpoch-only; Explore resets on session epoch + scene identity.
10. Narrow layout keeps labels visible and >=44 px; no second list.
11. Crossfade marker gating handles A → B → A and missing art.
12. Chapter 1 wrappers retain order and one leaf each.
13. Multi-node/return behavior is covered without fake production content.
14. `bun run test:e2e` remains Draft-exit; run production journey explicitly when the chosen suite excludes it.
15. Tokyo/Shibuya gates pass in actual Tauri UI.

## 16. Design review conclusion

Keep it small: one topology, one investigation lifecycle, one travel command, one map component family, two pure projection helpers, transient presentation state only.