# Regional City Maps — Single-PR Implementation Plan

> **Status:** Draft. Six canonical runtime PNGs are committed under `static/assets/backgrounds/city_map/`; topology/compiler/Rust/UI wiring has not started.
> **Baseline:** `main` @ `4feeb0782d99fd9523063ee343f6df5a3d3306ef`.
> The [design spec](../specs/2026-09-12-regional-city-maps-design.md) is the product/data contract.
> Keep design, runtime art, implementation, and verification in Draft PR #89 as one PR.

## Definition of done

The PR is ready when it contains:

- Tokyo overview + five district runtime backgrounds;
- `city_map.json` v2 with reviewed coordinates, shared ID namespace, regions, and `regionId`;
- compiler scene wire that emits only referenced regions;
- Rust projection of only legal regions/destinations;
- two pure map-plane helpers;
- one two-level Svelte map UI with minimal return-to-map controls;
- unchanged Chapter 1 story/travel order;
- compiler/frontend/Rust/Workbench/save-load/responsive/accessibility/Tauri verification.

This PR does **not** author playable Chapters 2–8 or add a second travel engine.

---

## Task 0 — Validate runtime art and author final v2 coordinates

Canonical files already exist:

- `static/assets/backgrounds/city_map/tokyo.png`
- `static/assets/backgrounds/city_map/kichijoji.png`
- `static/assets/backgrounds/city_map/shibuya.png`
- `static/assets/backgrounds/city_map/shinjuku.png`
- `static/assets/backgrounds/city_map/kabukicho.png`
- `static/assets/backgrounds/city_map/ginza_minato.png`

### Work

- [x] Generate/select all six maps.
- [x] Commit them directly at runtime paths.
- [x] Keep labels/pins/routes/UI outside the raster.
- [ ] Verify every checked-in file is opaque RGB 1920×1080 PNG.
- [ ] Inspect Tokyo at 1280×720 and pick five readable region anchors.
- [ ] Inspect Kichijoji and measure `rain_bell_cafe` + `kichijoji_shopping_street` anchors.
- [ ] Inspect Shibuya with the intended marker treatment and confirm the physical glass booth remains readable without exposing hidden route geometry.
- [ ] Measure any existing overview-direct Chapter 1 anchors against the Tokyo raster without relocating them merely to match generated art.
- [ ] Write those normalized `[0,1]` coordinates into the v2 `docs/stories_plan/city_map.json` data used by Task 1.
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
3. region IDs and location IDs share one slug namespace; cross-array collision fails with duplicate-ID validation.
4. old reserved `shibuya` location is removed from the v2 fixture/anchor count.
5. invalid region references and out-of-range coordinates fail closed.
6. unused future regions are legal in global topology.
7. `regionId: null` locations remain overview-direct.
8. assets-disabled compile keeps topology/navigation metadata but emits null asset IDs.
9. `cityMapJsonForScene` emits **only regions referenced by that scene’s emitted nodes**.

### Implementation locks

- authored scenes keep `- **Map:** tokyo`;
- preserve Chapter 1 sublocation IDs;
- emit `node.regionId` and only referenced region metadata;
- do not serialize all five topology regions into every scene;
- do not move map types into `@lyra/scene-types`;
- keep pending-map auto-entry/outro behavior unchanged.

**Gate:** all nine Chapter 1 wrappers expose exactly one legal travel leaf each and no future-district region metadata leaks into their scene JSON.

---

## Task 2 — Register all global map art and extend Reader usage

Primary files:

- `packages/scripts/compile-scenes/assets/enrich.ts`
- enrichment/manifest tests
- `apps/layout-editor/src/lib/reader-projection.ts`
- `apps/layout-editor/src/lib/asset-workspace.ts`
- existing Workbench tests

### Requirements

- global manifest registers the overview + all five district backgrounds exactly once through existing `globalFile` ownership;
- IDs remain `background.city_map.tokyo` and `background.city_map.<region>`;
- existing `@lyra/asset-paths` resolves the committed runtime files;
- registering global art must not consume first-visual-cue state;
- Reader uses `map:tokyo` and `map:tokyo:<regionId>` structural carriers;
- scene usage reflects planes that scene JSON can present; do not fabricate usage for every future district;
- future unused district art may correctly have zero production-scene usage;
- assets-disabled compile emits no map manifest entries;
- do not add map-specific asset registry, image-copy step, second scene walker, or map editor.

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

Extend the existing mapped multi-node/projection tests rather than creating a new fixture catalog:

- hidden/locked leaf is not projected;
- region with only locked/hidden leaves is absent;
- region with at least one visible/unlocked leaf is projected;
- overview-direct leaves still work;
- guessed/stale leaf IDs remain rejected;
- mapped pending state still blocks auto-entry and auto-outro;
- map-less investigation behavior remains unchanged.

### Implementation

- mirror compiler v2 wire using current serde conventions;
- Rust derives region visibility from the already-authorized visible/unlocked node set;
- never union global topology regions back into the view;
- add no save field, migration, travel command, region command, or durable route state.

**Gate:** Chapter 1 travel still advances exactly once through existing `enter_sublocation`.

---

## Task 4 — Add pure plane helpers, then wire the Svelte map UI

Primary files:

- `apps/game/src/lib/components/investigation-map-presentation.ts` (or equivalently small adjacent pure module)
- focused Vitest for that module
- `apps/game/src/lib/components/InvestigationMapView.svelte`
- `apps/game/src/lib/components/InvestigationMapView.test.ts`
- `apps/game/src/lib/components/ExploreView.svelte`
- `apps/game/src/lib/components/ExploreView.test.ts`
- `apps/game/src/lib/components/CrossfadeImage.svelte` only as needed to expose/use the existing loaded transition identity
- `apps/game/src/routes/+page.svelte`

### 4A. Pure projection helpers

Implement/test `initialActiveRegionId(nodes)` and `projectMapPlane(map, activeRegionId)`.

Required cases:

- all legal leaves share one non-null region → that region;
- mixed regions or any overview-direct leaf → `null` overview;
- overview plane = regions + `regionId == null` leaves only;
- district plane = matching region leaves only;
- invalid active region falls back to overview;
- district and overview-direct pins never mix.

### 4B. Return-to-map controls

- `data-map-open`, copy `地圖`, only when `inv.map && currentSublocationId != null`;
- `data-map-close` only while `mapOpen && currentSublocationId != null`;
- open/close is local presentation state only;
- selecting current leaf closes locally and sends **no** `enter_sublocation` IPC;
- selecting another leaf calls existing travel exactly once;
- failed travel keeps map open;
- successful travel closes/resets through returned state;
- pending map has no close-to-interior control.

`data-map-region` is presentation-only. `data-map-destination` remains leaf-only.

### 4C. Narrow layout

Do not build a second destination list.

- keep labels visible below 720 px;
- allow wrapping/repositioning;
- keep >=44 px targets;
- resolve overlap with measured coordinates/layout;
- one destination = one native button/tab stop.

### 4D. Session reset and input blocking

- keep GameShell keyed by `presentationState.sessionEpoch` only;
- reset/key only Explore on `${sessionEpoch}:${scene.id}` (or equivalent local effect);
- do not key on current sublocation or revision;
- same-scene load resets because load increments session epoch;
- reuse GameShell inert + existing `disabled={gameState.inFlight}` path; no second blocker state machine.

### 4E. Raster transition / marker gating

Reuse `CrossfadeImage`; do not add another request registry.

- transition key: `${activeRegionId ?? "overview"}:${backgroundAssetId}`;
- markers render only when that exact raster identity has loaded;
- A → B → A must finish on A with A markers;
- stale asset resolution cannot expose stale raster + new markers;
- missing-art fallback still shows named native controls;
- use existing reduced-motion handling.

**Gate:** browsing regions/opening/closing changes no gameplay state. Only a different leaf travels.

---

## Task 5 — Chapter 1 regression + existing packaged E2E homes

### Production route matrix

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

### Test ownership

Do **not** add a fake production scene or Tauri-only fixture catalog.

Use:

- pure helper Vitest for plane logic;
- `InvestigationMapView.test.ts` for plane buttons, labels, loaded-raster marker gating, fallback behavior;
- `ExploreView.test.ts` for open/close/current-leaf/different-leaf behavior;
- existing Rust `navigation.rs` mapped multi-node helper for legal leaves and locked-only region absence;
- existing packaged WDIO homes: `investigation-layout.e2e.ts`, `save-resume.e2e.ts`, `production-journey.e2e.ts`.

Tokyo/Shibuya visual gates are manual Tauri inspection, not screenshot assertions.

### Regression matrix

| Scenario | Required result | Test home |
| --- | --- | --- |
| Nine Chapter 1 maps | IDs/order unchanged; one leaf each | compiler + production journey |
| Future region absent from Ch1 | no region metadata/DOM leakage | compiler + Rust |
| Plane projection | overview/district pins never mix | pure Vitest |
| Browse overview/district | no gameplay mutation | component |
| Open map from interior then close | same interior; no IPC | `ExploreView.test.ts` |
| Select current leaf | local close; no IPC/replay | `ExploreView.test.ts` |
| Select different leaf | one travel mutation | component + Rust |
| Locked-only region | absent | `navigation.rs` |
| Same-scene load | stale browsing cleared | component/save-resume |
| A → B → A | final raster/markers both A | `InvestigationMapView.test.ts` |
| Missing art | named controls usable | component |
| Narrow width | labels visible, >=44 px, no list | component/layout |
| Tokyo gate | five anchors readable at 1280×720 | manual Tauri |
| Shibuya gate | booth readable, route unspoiled | manual Tauri |

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

`production-journey.e2e.ts` is an explicit Draft-exit verification home; run it directly too if the selected suite does not include it.

Validate art metadata:

```sh
file -b static/assets/backgrounds/city_map/*.png
```

Expected: opaque RGB 1920×1080 PNG for all six.

---

## Scope locks / self-review

| Risk | Lock |
| --- | --- |
| Five districts become five engines | one topology, one map component family, one travel command |
| Future districts leak onto Ch1 | scene wire only referenced regions + Rust legal-leaf filter |
| Coordinate planes mix | pure `projectMapPlane` helper |
| Return-to-map becomes second machine | local `mapOpen`, one open/close pair, no new IPC |
| Current leaf replays reveals | local close; no command |
| Narrow UI forks navigation | labels stay on pins; no destination list |
| Scene change remounts shell | GameShell sessionEpoch-only; reset Explore only |
| Stale raster + new markers | CrossfadeImage identity + loaded-key gate |
| Slug collision returns | shared region/location namespace |
| Save format expands | no durable map field |
| Fake E2E fixture becomes content | component/Rust + existing production E2E homes |
| Visual gate grows screenshot infra | manual Tauri only |
| Work fragments | complete in Draft PR #89 |

## Current status

Completed: English spec/plan, six canonical runtime PNGs, district/spoiler review, and explicit review locks.

Pending: Task 0 metadata/coordinates, v2 topology/compiler, manifest/Reader, Rust projection, pure plane helpers + Svelte return-to-map UI, component/Rust/packaged E2E, and manual visual gates.

A skipped workflow is not passing evidence. Keep PR #89 Draft until implementation and runtime verification are complete.