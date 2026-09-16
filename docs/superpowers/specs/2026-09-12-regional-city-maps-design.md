# Regional Anime City Map Design Specification

> **Status:** Draft handoff for Draft PR #89. Six canonical runtime PNGs are committed and validated at 1920×1080; topology/compiler/Rust/UI wiring has not started.
> **Baseline:** `main` @ `4feeb0782d99fd9523063ee343f6df5a3d3306ef`.
> **Delivery rule:** design, runtime art, implementation, and verification stay in this single PR.

Related: [implementation plan](../plans/2026-09-12-regional-city-maps-implementation-plan.md) and [HPA-601 linear city-map design](2026-08-30-hpa-601-linear-city-map-navigation-design.md).

## 1. Goal and shipped behavior

Replace the current “one Tokyo background plus scattered pins” with two presentation levels:

1. **Tokyo overview** — the raster establishes the broader city shape and relative district feeling.
2. **District submap** — a focused illustrated region with legal investigation destinations.

The overview does **not** expose every future district as an interactive button. Region controls are projected only when the current scene has a legal leaf in that region. In Chapter 1, Kichijoji is the only production district region; Shibuya, Shinjuku, Kabukicho, and Ginza/Minato are committed art preparation for later chapters. The city mental model therefore comes from the overview artwork even when future districts are not yet clickable.

Case-specific sight lines, backstage routes, and evidence diagrams remain case content, not a third generic navigation layer.

Out of scope: GIS, 3D, pathfinding, travel cost, map save state, visited semantics, map editor, new travel IPC, day/night variants, screenshot-E2E infrastructure, and return-to-map from an investigation interior.

## 2. Reuse existing seams

- `city_map.json` → one-time v2 cutover.
- `compile-scenes/city-map.ts`, `orchestrator.ts`, `types.ts`, `emitter.ts` → extend existing map wire.
- `assets/enrich.ts` + existing `@lyra/asset-paths` behavior → register all six global backgrounds once; no asset-paths change.
- Rust `schema.rs` / `view.rs` / `mod.rs` / `navigation.rs` → filter/project legal map state.
- `InvestigationMapView.svelte` → one overview/district surface.
- `CrossfadeImage.svelte` → reuse existing transition, stale-request, error, and reduced-motion behavior.
- existing WDIO helpers/production anchors → keep leaf travel deterministic.

Pending-map law does not change: mapped scenes wait with `current_sublocation_id == None`; only a leaf travels through `enter_sublocation`.

## 3. Districts and one shared slug namespace

| Region | Visual identity | Production use in this PR |
| --- | --- | --- |
| `kichijoji` | low-rise streets, cafe warmth, station/green space | Chapter 1 cafe + shopping street |
| `shibuya` | screens, event plaza, human-scale glass booth | art + unit/Rust fixture coverage only |
| `shinjuku` | medical/business block against skyline | art preparation |
| `kabukicho` | theater/nightlife, restrained red-violet neon | art preparation |
| `ginza_minato` | commercial avenue to towers/waterfront | art preparation |

`regions[].id` and `locations[].id` share one slug namespace.

- Apply the existing location slug shape (`^[a-z0-9_]+$`) to region IDs too.
- Parse both arrays through one `seenIds` set.
- A cross-array collision fails with `cityMapDuplicateSlug`.
- Remove the old reserved `shibuya` location in v2; the region owns that slug.
- Existing Chapter 1 overview-direct nodes remain `regionId: null`.

## 4. Projection ownership

Three layers are locked:

1. **Manifest:** register all topology backgrounds once.
2. **Scene JSON:** `cityMapJsonForScene` emits only regions referenced by that scene's emitted nodes.
3. **Rust view:** project a region only if at least one currently visible/unlocked node has that `regionId`.

Frontend renders projected `map.regions` as given and never unions global topology back in. A region with no legal leaves is a runtime omission rule, not a compiler validation error.

Locked-only/future regions must not leak into Chapter 1 DOM, labels, tooltips, or accessibility text.

## 5. Pure map-plane projection

Put plane selection in a small pure module, not in Svelte markup:

`apps/game/src/lib/state/map-plane.ts`

```ts
initialActiveRegionId(nodes)
projectMapPlane(map, activeRegionId)
```

Rules:

- **zero legal leaves → overview (`null`)**;
- all legal leaves share one non-null region → that region;
- otherwise → overview (`null`);
- overview plane = projected region controls + `regionId == null` leaves;
- district plane = selected-region leaves only;
- invalid region → overview;
- overview and district coordinates never mix.

These rules have colocated Vitest coverage in `map-plane.test.ts`.

## 6. Pending-map UI only

This PR does **not** add return-to-map from an investigation interior.

The map UI exists only while the mapped investigation is pending destination selection, matching the current HPA-601 lifecycle.

- `data-map-region=<regionId>` switches from overview to a legal district and is presentation-only.
- A return-to-overview control switches the same pending-map surface back to overview.
- `data-map-destination=<sublocationId>` remains reserved for real travel leaves.
- Region controls never call `enter_sublocation`.
- Only a destination leaf can mutate gameplay.
- No `mapOpen`, no `data-map-open`, no `data-map-close`, no interior map mount point, and no ExploreView travel state machine are introduced.

Return-to-map is deferred until a future chapter has a production investigation with multiple destinations after entering an interior.

## 7. Responsive UI

One navigation surface only: map buttons/pins.

- keep labels visible below 720 px;
- wrap/reposition as needed;
- minimum 44 px targets;
- fix overlap through measured coordinates/layout;
- do not add a second textual destination list;
- one destination = one native button/tab stop.

The existing 16:9 map plane already preserves the 1920×1080 art ratio, so this PR does not add a new letterboxing subsystem.

## 8. Raster transitions: reuse CrossfadeImage

Do not build a second presentation-identity/request-ordering system.

`CrossfadeImage.svelte` already owns stale request rejection, A→B→A ordering, error transitions, and reduced motion. `InvestigationMapView` only needs to coordinate markers with the loaded plane:

- pass `transitionKey={activeRegionId ?? "overview"}`;
- keep local `loadedRegionId` (or equivalent loaded-plane key);
- update it from the existing `onImageLoad` **and** `onImageError` callbacks;
- when `backgroundAssetId != null`, render plane markers only when the loaded key matches the active key;
- when `backgroundAssetId == null`, bypass the load gate and render named controls immediately;
- existing placeholder/error behavior remains navigable.

No new request registry and no CrossfadeImage reimplementation.

## 9. Topology schema

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

Compiler validation owns:

- version 2 hard cutover;
- shared region/location slug namespace;
- slug regex;
- normalized coordinates `[0,1]`;
- valid non-null region references;
- authored location anchor/label consistency.

Unused regions are legal in global topology. Whether a region is interactive is determined later by the scene wire and Rust legal-node projection.

Scene wire remains in `compile-scenes/types.ts`; do not add map types to `@lyra/scene-types`.

## 10. Canonical runtime art

Only these copies exist:

- `static/assets/backgrounds/city_map/tokyo.png`
- `static/assets/backgrounds/city_map/kichijoji.png`
- `static/assets/backgrounds/city_map/shibuya.png`
- `static/assets/backgrounds/city_map/shinjuku.png`
- `static/assets/backgrounds/city_map/kabukicho.png`
- `static/assets/backgrounds/city_map/ginza_minato.png`

All six are already validated as 1920×1080, 8-bit truecolor PNGs with no alpha. Replace failed art in place and re-measure that map only; no image copy/versioning/provenance subsystem.

Permanent art constraints live here:

- raster contains no UI labels, map pins, route arrows, chapter numbers, or evidence annotations;
- no foreground dialogue characters/bodies/spoiler props;
- interactive anchors are measured against the final committed raster, never copied from a concept board.

Remaining manual art gates:

- Tokyo: five planned region anchor positions remain readable at 1280×720.
- Shibuya: physical glass booth remains identifiable under the real marker layer without exposing hidden route geometry.

## 11. Asset and Workbench contract

- global manifest registers Tokyo + five district backgrounds exactly once through existing `globalFile` ownership;
- IDs remain `background.city_map.tokyo` and `background.city_map.<region>`;
- registering map art must not consume corpus first-visual-cue state;
- Reader uses `map:tokyo` and `map:tokyo:<regionId>` structural carriers;
- scene usage reflects planes that scene JSON can present; do not fabricate usage for every future district;
- future district art may legitimately have zero production-scene usage;
- assets-disabled compile emits no map manifest entries;
- no map-specific asset registry, image copy step, second scene walker, or map editor.

## 12. Story/spoiler boundaries

- **Shibuya:** public plaza/screen/glass booth/exterior only; no M-03, service-elevator internals, vacant-floor space, sight cones, final transfer route.
- **Shinjuku:** exterior clinic/neighborhood only; no ward/Aoba/memory-tech/left-right clues.
- **Kabukicho:** public theater/service street only; no stage machinery/lifts/body positions/90-second mechanism/blue-umbrella reveal.
- **Ginza/Minato:** roads are illustrative; no suspect route/timing/evidentiary distance claim.

## 13. Chapter 1 invariants

All nine existing wrappers keep their order and one legal leaf each. Kichijoji opens directly for `rain_bell_cafe` / `kichijoji_shopping_street`; police/review/office nodes remain overview-direct. Decorative landmarks do not become gameplay nodes.

No Chapter 1 production interior can reopen the map in this PR.

## 14. Verification ownership

No fake production scene or Tauri-only fixture catalog.

**Pure/component/Rust fixtures:**

- `map-plane.test.ts` → empty/mixed/single-region projection cases;
- `InvestigationMapView.test.ts` → region switching, overview return, responsive labels, loaded/error/null-raster marker gating;
- Rust `navigation.rs` → extend existing mapped multi-node and locked-node tests, including locked-only region absent.

The multi-region case is a Vitest prop fixture plus the existing Rust unit fixture only; it is not packaged as production content.

**Production coupling / packaged verification:**

- update `apps/game/e2e-tauri/production-anchors.ts` for `data-map-region` / overview selectors;
- existing E2E homes: `investigation-layout.e2e.ts`, `save-resume.e2e.ts`, `production-journey.e2e.ts`;
- keep `soleMapDestinationId()` leaf-only.

Tokyo/Shibuya overlay checks are manual Tauri visual gates, not screenshot E2E.

## 15. Acceptance criteria

1. Six canonical runtime PNGs are 1920×1080, 8-bit truecolor and live only under `static/assets/backgrounds/city_map/`.
2. v2 uses one region/location slug namespace, applies the slug regex to both, removes the reserved `shibuya` location, and rejects collisions.
3. Global manifest registers all six backgrounds once.
4. Scene JSON emits only regions referenced by that scene's nodes.
5. Rust emits only regions with currently legal visible/unlocked leaves.
6. `initialActiveRegionId([]) == null`; pure plane helpers prevent coordinate mixing.
7. Only `data-map-destination` leaves travel; `data-map-region` is presentation-only.
8. No interior return-to-map state/control is added in this PR.
9. Narrow layout keeps labels visible and targets >=44 px; no second destination list.
10. Crossfade marker gating reuses existing `CrossfadeImage` load/error ordering; assets-off renders controls immediately.
11. Chapter 1 wrappers retain order and one leaf each.
12. Multi-region behavior is covered by Vitest/component/Rust fixtures without fake production content.
13. `production-anchors.ts` owns the new production UI selectors; existing packaged E2E homes continue to pass.
14. Tokyo/Shibuya manual visual gates pass in the real Tauri UI.
15. Future district art may have zero production gameplay reachability in this PR without being treated as missing implementation.

## 16. Design review conclusion

Keep it small: one topology, one investigation lifecycle, one travel command, one pending-map component family, two pure projection helpers, and no new durable or interior map state.