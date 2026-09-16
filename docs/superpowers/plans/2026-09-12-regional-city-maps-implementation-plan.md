# Regional City Maps — Single-PR Implementation Plan

> **Status:** Implementation complete through Task 5 on `design/regional-anime-city-maps` (Draft PR #89): compiler, Rust, and UI wiring done; component/packaged E2E green; real-Tauri Tokyo/Kichijoji visual gate passed; Shibuya booth check deferred (no legal shibuya leaves exist in Chapter 1 — by design).
> **Baseline:** `main` @ `4feeb0782d99fd9523063ee343f6df5a3d3306ef`.
> The [design spec](../specs/2026-09-12-regional-city-maps-design.md) is the product/data contract.
> Keep design, runtime art, implementation, and verification in Draft PR #89 as one PR.

## Definition of done

The PR is ready when it contains:

- Tokyo overview + five district runtime backgrounds at final paths;
- `city_map.json` v2 with reviewed coordinates, shared slug namespace, regions, and `regionId`;
- compiler scene wire that emits only referenced regions;
- Rust projection of only legal regions/destinations;
- pure `map-plane.ts` projection helpers;
- pending-map Tokyo overview/district UI only;
- unchanged Chapter 1 story/travel order;
- compiler/frontend/Rust/Workbench/responsive/accessibility/packaged E2E verification.

This PR does **not** author playable Chapters 2–8, add return-to-map from interiors, or add a second travel engine.

---

## Task 0 — Finish overlay review and author final coordinates

Canonical runtime files already exist and have been validated as 1920×1080 8-bit truecolor PNGs:

- `static/assets/backgrounds/city_map/tokyo.png`
- `static/assets/backgrounds/city_map/kichijoji.png`
- `static/assets/backgrounds/city_map/shibuya.png`
- `static/assets/backgrounds/city_map/shinjuku.png`
- `static/assets/backgrounds/city_map/kabukicho.png`
- `static/assets/backgrounds/city_map/ginza_minato.png`

### Remaining work

- [ ] Inspect Tokyo at 1280×720 and choose five readable planned region anchors.
- [ ] Inspect Kichijoji and measure `rain_bell_cafe` + `kichijoji_shopping_street` anchors.
- [ ] Inspect Shibuya with intended marker treatment and confirm the physical glass booth remains readable without exposing hidden-route geometry.
- [ ] Measure existing overview-direct Chapter 1 anchors against the Tokyo raster without relocating them merely to match generated art.
- [ ] Write all reviewed normalized `[0,1]` coordinates into the v2 `docs/stories_plan/city_map.json` consumed by Task 1.
- [ ] Remove the old reserved `shibuya` location entry; the `shibuya` region owns that slug in v2.

**Gate:** Task 1 consumes reviewed coordinates; it does not invent them. If an overlay gate fails, replace only that PNG at the same path and re-measure its anchors. No copy/versioning/image pipeline.

---

## Task 1 — Cut `city_map.json` to v2 and extend parser/compiler

Primary files:

- `docs/stories_plan/city_map.json`
- `packages/scripts/compile-scenes/city-map.ts`
- `packages/scripts/compile-scenes/city-map.test.ts`
- `packages/scripts/compile-scenes/orchestrator.ts`
- `packages/scripts/compile-scenes/emitter.ts`
- `packages/scripts/compile-scenes/types.ts`

### Test first

1. v2 parses regions plus nullable `regionId` on locations.
2. v1 is rejected; no compatibility parser/migration.
3. apply the existing location slug regex (`^[a-z0-9_]+$`) to region IDs too.
4. parse region and location IDs through one shared `seenIds` set; cross-array collision fails with `cityMapDuplicateSlug`.
5. old reserved `shibuya` location is removed from the v2 fixture/anchor count.
6. invalid region references and out-of-range coordinates fail closed.
7. unused future regions are legal in global topology.
8. `regionId: null` locations remain overview-direct.
9. assets-disabled compile keeps topology/navigation metadata but emits null asset IDs.
10. `cityMapJsonForScene` emits **only regions referenced by that scene's emitted nodes**.

### Implementation locks

- authored scenes keep `- **Map:** tokyo`;
- preserve Chapter 1 sublocation IDs;
- emit `node.regionId` + only referenced region metadata;
- do not serialize all five topology regions into every scene;
- do not move map types into `@lyra/scene-types`;
- keep pending-map auto-entry/outro behavior unchanged.

**Gate:** all nine Chapter 1 wrappers expose exactly one legal travel leaf each and no future-district metadata leaks into their scene JSON.

---

## Task 2 — Register all global map art and extend Reader usage

Primary files:

- `packages/scripts/compile-scenes/assets/enrich.ts`
- enrichment/manifest tests
- `apps/layout-editor/src/lib/reader-projection.ts`
- `apps/layout-editor/src/lib/asset-workspace.ts`
- existing Workbench tests

### Requirements

- global manifest registers Tokyo + five district backgrounds exactly once through existing `globalFile` ownership;
- IDs remain `background.city_map.tokyo` and `background.city_map.<region>`;
- existing `@lyra/asset-paths` behavior resolves committed runtime files; do not modify asset-paths;
- registering global art must not consume first-visual-cue state;
- Reader uses `map:tokyo` and `map:tokyo:<regionId>` carriers;
- scene usage reflects planes that scene JSON can present; do not fabricate usage for every future district;
- Shinjuku/Kabukicho/Ginza-Minato may legitimately have zero production usage in this PR;
- assets-disabled compile emits no map manifest entries;
- no map-specific asset registry, image-copy step, second scene walker, or map editor.

**Gate:** repeated Kichijoji wrappers do not create duplicate manifest entries.

---

## Task 3 — Extend Rust schema/view projection using existing legal-node filtering

Primary files:

- `apps/game/src-tauri/src/game/schema.rs`
- `apps/game/src-tauri/src/game/view.rs`
- `apps/game/src-tauri/src/game/mod.rs`
- `apps/game/src-tauri/src/game/navigation.rs`
- `apps/game/src/lib/state/types.ts`

### Test first

Extend existing mapped multi-node/projection helpers rather than creating a new fixture catalog:

- hidden/locked leaf is not projected;
- region with only locked/hidden leaves is absent;
- region with at least one visible/unlocked leaf is projected;
- overview-direct leaves still work;
- guessed/stale leaf IDs remain rejected;
- mapped pending state still blocks auto-entry/outro;
- map-less investigation behavior remains unchanged.

### Implementation

- mirror compiler v2 wire using current serde conventions;
- Rust derives region visibility from already-authorized visible/unlocked nodes;
- never union global topology regions back into the view;
- add no save field, migration, travel command, region command, or durable route state.

**Gate:** Chapter 1 travel still advances exactly once through existing `enter_sublocation`.

---

## Task 4 — Add pure plane helpers and wire the pending-map UI

Primary files:

- `apps/game/src/lib/state/map-plane.ts`
- `apps/game/src/lib/state/map-plane.test.ts`
- `apps/game/src/lib/components/InvestigationMapView.svelte`
- `apps/game/src/lib/components/InvestigationMapView.test.ts`
- `apps/game/e2e-tauri/production-anchors.ts`

`ExploreView.svelte`, `+page.svelte`, and interior HUD state are **not** part of this feature unless implementation uncovers a pre-existing bug unrelated to return-to-map.

### 4A. Pure projection helpers

Implement/test `initialActiveRegionId(nodes)` and `projectMapPlane(map, activeRegionId)`.

- zero legal leaves → `null` overview;
- all legal leaves share one non-null region → that region;
- mixed regions or any overview-direct leaf → `null` overview;
- overview plane = projected region controls + `regionId == null` leaves only;
- district plane = matching region leaves only;
- invalid active region falls back to overview;
- district and overview-direct coordinates never mix.

### 4B. Pending-map region UI

- initialize `activeRegionId` from `initialActiveRegionId`;
- `data-map-region=<regionId>` changes plane only;
- add a return-to-overview control on the pending-map surface;
- `data-map-destination=<sublocationId>` remains leaf-only;
- region/overview switching invokes no gameplay command;
- do **not** add `mapOpen`, `data-map-open`, `data-map-close`, or any interior map re-entry.

### 4C. Narrow layout

Do not build a second destination list.

- keep `.pin-label` visible below 720 px;
- allow wrapping/repositioning;
- keep >=44 px targets;
- resolve overlap with measured coordinates/layout;
- one destination = one native button/tab stop.

### 4D. Reuse CrossfadeImage exactly

Do not add a loader/request registry and do not reimplement request ordering.

- pass `transitionKey={activeRegionId ?? "overview"}`;
- keep local `loadedRegionId` or equivalent plane key;
- set the loaded key from existing `onImageLoad` and `onImageError` callbacks;
- when `backgroundAssetId != null`, show markers only when loaded key == active key;
- when `backgroundAssetId == null`, bypass the load gate and render named controls immediately;
- existing placeholder/error behavior remains clickable;
- existing CrossfadeImage reduced-motion/stale-request/A→B→A tests remain the authority.

`CrossfadeImage.svelte` itself should not need modification unless a missing existing callback prevents this wiring.

### 4E. Production selector ownership

Update `apps/game/e2e-tauri/production-anchors.ts` for the new region/overview controls. Keep `soleMapDestinationId()` and `data-map-destination` semantics unchanged.

**Gate:** pending-map region browsing changes no gameplay state; only a destination leaf travels.

---

## Task 5 — Verification with explicit test layers

### Production Chapter 1 route matrix

| Wrapper | Existing destination | Expected presentation |
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

### A. Pure/component/Rust fixtures

The multi-region fixture exists **only** as Vitest props and the existing Rust mapped multi-node helper. Do not add it to production content or a packaged fixture catalog.

| Scenario | Required result | Test home |
| --- | --- | --- |
| empty legal set | opens overview | `map-plane.test.ts` |
| single-region set | opens district | `map-plane.test.ts` |
| mixed/direct set | opens overview | `map-plane.test.ts` |
| plane projection | overview/district coordinates never mix | `map-plane.test.ts` |
| region switching | no gameplay mutation | `InvestigationMapView.test.ts` |
| locked-only region | absent | Rust `navigation.rs` |
| A → B → A | final raster and markers both A | existing CrossfadeImage + map component test |
| background error | markers/controls become usable for active plane | `InvestigationMapView.test.ts` |
| backgroundAssetId null | controls render immediately | `InvestigationMapView.test.ts` |
| narrow width | labels remain visible, >=44 px, no second list | component/layout test |

### B. Existing packaged Tauri E2E

Use existing production content only:

- `apps/game/e2e-tauri/investigation-layout.e2e.ts`
- `apps/game/e2e-tauri/save-resume.e2e.ts`
- `apps/game/e2e-tauri/production-journey.e2e.ts`

Required regressions:

- nine Chapter 1 map gates retain IDs/order/one leaf each;
- `data-map-region` is not counted as a destination;
- pending-map save/resume remains stable;
- production journey still drains each Chapter 1 map through the existing leaf selector.

### C. Manual Tauri visual gates

Not automated screenshot assertions:

- Tokyo: five planned anchor positions are readable at 1280×720.
- Shibuya: glass booth remains identifiable under marker treatment and no hidden route is exposed.

---

## Verification commands

```sh
bun install --frozen-lockfile
bun run scenes:compile
bun run check:scripts
bun run check
bun run editor:check
bun run test:scripts
bun run test
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run --cwd apps/game check:e2e
bun run lint:all
bun run test:e2e
```

Run `production-journey.e2e.ts` explicitly too if the selected E2E suite excludes it.

---

## Scope locks / self-review

| Risk | Lock |
| --- | --- |
| Five districts become five engines | one topology, one map component, one travel command |
| Future districts leak onto Ch1 | scene wire referenced-regions only + Rust legal-leaf filter |
| Coordinate planes mix | pure `projectMapPlane` helper |
| Empty legal set selects undefined region | explicit `initialActiveRegionId([]) === null` |
| Interior map state grows before needed | no return-to-map in this PR |
| Narrow UI forks navigation | labels stay on pins; no destination list |
| Stale raster logic is duplicated | reuse CrossfadeImage; only gate markers to settled/error plane |
| Assets-off hides travel controls | bypass marker load gate when `backgroundAssetId == null` |
| Slug collision returns | shared `seenIds` + shared regex + `cityMapDuplicateSlug` |
| Save format expands | no durable map field |
| Fake E2E fixture becomes content | Vitest/Rust fixtures only + existing production E2E homes |
| Visual gate grows screenshot infra | manual Tauri only |
| Future art has no production button yet | explicitly allowed art preparation / zero production usage |
| Work fragments | complete in Draft PR #89 |

## Current status

Implementation complete through Task 5: six canonical runtime PNGs (district/spoiler review + metadata validation), Task 0 coordinate review, v2 topology/compiler cut, global manifest + Reader usage, Rust legal-region projection, `map-plane.ts` + pending-map UI (including the final-review rapid A→B→A marker-gating fix: `loadedPlaneKey` resets on plane change), production anchors, and component/Rust/packaged E2E green on this branch.

Real-Tauri visual gates (spec §10/§15 criterion 14; one-off recorded check, 2026-09-16, no committed screenshot infra): Tokyo overview and Kichijoji district planes captured from the packaged e2e binary at 1280×720 CSS — pins/labels readable, no overlap; PASS (screenshots under `/tmp/lyra-map-gate/`, not committed). Shibuya: unreachable in Chapter 1 production (no legal shibuya leaves, by design); art-level booth identification verified in Task 0; full check deferred until a chapter grants shibuya legal leaves.

A skipped workflow is not passing evidence. Keep PR #89 Draft until implementation and runtime verification are complete.