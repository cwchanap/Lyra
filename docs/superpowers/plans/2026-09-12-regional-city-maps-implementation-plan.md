# Regional City Maps — Single-PR Implementation Plan

> **Status:** Draft. The six runtime map PNGs are already committed under `static/assets/backgrounds/city_map/`; topology/compiler/Rust/UI wiring has not started.
> **Baseline:** `main` @ `4feeb0782d99fd9523063ee343f6df5a3d3306ef`.
> The [design spec](../specs/2026-09-12-regional-city-maps-design.md) is the product/data contract.
> Keep design, runtime art, implementation, and verification in Draft PR #89 as one PR.

## Definition of done

The PR is ready when it contains:

- Tokyo overview + Kichijoji, Shibuya, Shinjuku, Kabukicho, and Ginza/Minato runtime backgrounds;
- `city_map.json` v2 regions and asset-manifest support;
- Rust projection of only legal regions/destinations;
- a two-level Svelte map UI (`Tokyo overview → district map`) with minimal return-to-map behavior;
- unchanged Chapter 1 story/travel order;
- a non-production multi-destination fixture for district switching;
- compiler, frontend, Rust, Workbench, save/load, responsive, accessibility, and Tauri E2E verification.

This PR does **not** author playable Chapters 2–8.

---

## Task 0 — Validate the committed runtime art and measure anchors

The art no longer has a separate review-source/import step. The canonical files are already at their final runtime paths:

| Map | Canonical runtime file | Placement status | Remaining visual gate |
| --- | --- | --- | --- |
| Tokyo | `static/assets/backgrounds/city_map/tokyo.png` | Committed | Five region anchors remain readable at 1280×720 |
| Kichijoji | `static/assets/backgrounds/city_map/kichijoji.png` | Committed | Cafe + shopping-street anchors remain distinct |
| Shibuya | `static/assets/backgrounds/city_map/shibuya.png` | Committed | Glass booth remains recognizable without exposing hidden route |
| Shinjuku | `static/assets/backgrounds/city_map/shinjuku.png` | Committed | Clinic hotspot reads against the skyline |
| Kabukicho | `static/assets/backgrounds/city_map/kabukicho.png` | Committed | Theater frontage remains the clear public landmark |
| Ginza / Minato | `static/assets/backgrounds/city_map/ginza_minato.png` | Committed | Art does not imply a canonical evidentiary route |

### Work

- [x] Generate/select the Tokyo overview and five district maps.
- [x] Commit all six PNGs directly to `static/assets/backgrounds/city_map/`.
- [x] Remove the duplicate `docs/art/maps/generated/` review-source layer from the feature branch.
- [x] Keep text, labels, markers, route arrows, and UI outside the raster.
- [ ] Verify all six checked-in files report opaque RGB 1920×1080 PNG metadata.
- [ ] Verify Tokyo can carry five readable region anchors at 1280×720.
- [ ] Verify Shibuya's physical glass booth remains recognizable beneath the real marker layer.
- [ ] Measure all region/destination coordinates against these exact committed runtime PNGs.

**Gate:** do not add another image-copy, conversion, versioning, or provenance subsystem. If an overlay check fails, replace only the failing PNG at the same runtime path and re-measure its anchors.

---

## Task 1 — Cut `city_map.json` to v2 and extend compiler output

Primary files:

- `docs/stories_plan/city_map.json`
- `packages/scripts/compile-scenes/city-map.ts`
- `packages/scripts/compile-scenes/orchestrator.ts`
- `packages/scripts/compile-scenes/emitter.ts`
- `packages/scripts/compile-scenes/types.ts`
- existing city-map compiler tests/fixtures

Test first:

1. v2 parses regions plus nullable `regionId` on locations.
2. v1 is rejected; no compatibility parser or migration layer.
3. duplicate IDs, invalid region references, invalid coordinates, and anchor/label mismatches fail closed.
4. unused future regions are legal.
5. `regionId: null` destinations remain overview-direct.
6. assets-disabled compilation keeps navigation data but emits null background IDs.

Implementation locks:

- keep authored scenes on `- **Map:** tokyo`;
- preserve all Chapter 1 sublocation IDs;
- emit region metadata + `node.regionId` in `JSONInvestigationMap`;
- keep current pending-map reachability behavior;
- do not change unrelated BGM/BGS or visual-cue behavior.

**Gate:** all nine Chapter 1 map wrappers still expose exactly one legal travel destination each.

---

## Task 2 — Register the existing runtime assets and keep Reader/Assets single-source

Primary files:

- `packages/scripts/compile-scenes/assets/enrich.ts`
- enrichment/manifest tests
- `apps/layout-editor/src/lib/reader-projection.ts`
- `apps/layout-editor/src/lib/asset-workspace.ts`
- existing Workbench tests

Requirements:

- register the six already-committed runtime files through the existing `globalFile` ownership path;
- use `background.city_map.tokyo` and `background.city_map.<region>` IDs;
- resolve those IDs to `static/assets/backgrounds/city_map/*.png` through the existing asset-path helper;
- do not invent chapter/scene owners for global art;
- do not add a map-specific asset registry, image copy step, or second scene walker;
- Reader uses existing `structuralVisualCue` carriers:
  - `map:tokyo`
  - `map:tokyo:<regionId>`;
- future unused region art may have zero production-scene usage;
- assets-disabled compile emits no map manifest entries.

**Gate:** repeated Kichijoji wrappers do not create duplicate manifest entries, and the compiler never duplicates or rewrites the committed PNG bytes.

---

## Task 3 — Extend Rust schema/view projection, not durable state

Primary files:

- `apps/game/src-tauri/src/game/schema.rs`
- `apps/game/src-tauri/src/game/view.rs`
- `apps/game/src-tauri/src/game/mod.rs`
- Rust investigation/map tests
- `apps/game/src/lib/state/types.ts`

Test first:

- hidden/locked leaf is not projected;
- a region with no currently legal leaf is not projected;
- a region with an available leaf is projected;
- overview-direct leaves still work;
- guessed/stale leaf IDs are rejected by existing travel validation;
- map-less investigations retain existing auto-entry behavior;
- mapped pending state still blocks auto-entry and auto-outro.

Implementation:

- mirror compiler v2 wire with existing serde conventions;
- derive available regions from the already-authorized node set;
- add no save field, migration, travel command, region command, or durable route state.

**Gate:** Chapter 1 travel still advances exactly once through the existing `enter_sublocation` transaction.

---

## Task 4 — Implement overview/district planes and minimal return-to-map UI

Primary files:

- `apps/game/src/lib/components/InvestigationMapView.svelte`
- `apps/game/src/lib/components/InvestigationMapView.test.ts`
- `apps/game/src/lib/components/ExploreView.svelte`
- `apps/game/src/lib/components/ExploreView.test.ts`
- `apps/game/src/routes/+page.svelte`

Behavior/tests:

- [ ] if all legal leaves are inside one non-null region, open that district directly;
- [ ] mixed/direct destinations open Tokyo overview;
- [ ] `data-map-region=<regionId>` switches presentation only;
- [ ] `data-map-destination=<sublocationId>` remains the only gameplay travel selector;
- [ ] opening map from an interior preserves `currentSublocationId`;
- [ ] cancel returns to the same interior without IPC;
- [ ] selecting current leaf closes the map without replaying entry reveals;
- [ ] selecting a different leaf calls existing travel once;
- [ ] failed travel leaves the map open;
- [ ] successful travel closes/resets local map state from returned game state;
- [ ] same-scene reload resets local browsing using `presentationState.sessionEpoch` + scene identity;
- [ ] existing shell interaction blocking also blocks map interaction;
- [ ] labels remain readable on narrow windows and targets are >= 44 px;
- [ ] one keyboard tab stop per destination;
- [ ] reduced-motion disables optional crossfade;
- [ ] missing/failed raster still leaves named native destination controls usable;
- [ ] A → B → A rapid background switching cannot show stale raster + new markers.

Implementation guidance:

- one `InvestigationMapView`, not one component per district;
- `ExploreView` owns only transient `mapOpen`;
- `InvestigationMapView` owns only active plane/region + image-loading presentation state;
- continue suppressing `SublocationNav` for mapped investigations;
- do not add a second travel state machine or global map key handler.

**Gate:** browsing a region changes no revision/history/inventory/reveal/save state. Only leaf travel mutates gameplay.

---

## Task 5 — Chapter 1 regression, fixture, save/load, and Tauri E2E

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

### Non-production fixture

Include:

- at least two regions;
- one overview-direct leaf;
- one locked/hidden leaf;
- at least two legal leaves in one mapped investigation.

Keep `soleMapDestinationId()` scoped to true leaf destinations; region buttons are never gameplay destinations.

### Regression matrix

| Scenario | Required result |
| --- | --- |
| Nine Chapter 1 maps | IDs/order unchanged; one travel leaf each |
| Browse overview/district and back | no gameplay mutation |
| Rapid/double destination click | one legal travel mutation |
| Save/restore while pending | still waiting for choice |
| Open map from interior then cancel | same interior; no replay |
| Select current destination | close map; no IPC |
| Multi-region fixture | legal regions switch; hidden region remains absent |
| Same-scene reload with new session epoch | old browsing/loading state cleared |
| Slow/failed art resolution | named controls still usable; no raster/marker mismatch |
| 1920×1080 / 1280×720 / narrow | readable labels, >=44 px targets, no critical overlap |
| Tokyo overview visual gate | five region anchors read as distinct choices at 1280×720 |
| Shibuya visual gate | glass booth is identifiable without exposing hidden route |
| Reader/Assets | six map sources unique; usage not fabricated |

Use the existing WDIO/Tauri harness and production journey, not a browser-only demo.

---

## Verification commands

Run focused tests first, then repository gates:

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

Also verify the committed asset metadata directly:

```sh
file -b static/assets/backgrounds/city_map/*.png
```

Expected result: every file is an opaque RGB 1920×1080 PNG. Then inspect all six maps in the actual Tauri UI before marking the PR ready.

---

## Scope / self-review locks

| Risk | Plan response |
| --- | --- |
| Five districts become five engines | One topology, one component family, one travel command |
| Browsing mutates gameplay | Region/overview changes are presentation-only |
| Return-to-map becomes a second state machine | Durable current sublocation stays in Rust; local `mapOpen` only |
| Frontend leaks locked destinations | Rust projects only authorized nodes/regions |
| Save format expands | No durable map fields |
| Future art accidentally becomes playable | Art can exist with zero production usage |
| Generated art dictates story geography | Coordinates come from story topology; art is presentation only |
| Art exists twice under docs and runtime paths | Keep only the canonical runtime copy under `static/assets/backgrounds/city_map/` |
| Chapter 1 becomes free-roam | Nine-wrapper regression matrix remains the gate |
| Work fragments across PRs | Complete this ticket in Draft PR #89 |

## Current status

Completed:

- English design spec;
- English implementation plan;
- six real PNG runtime assets committed at their final `static/assets/backgrounds/city_map/` paths;
- source-level district identity and spoiler review;
- duplicate generated-art review directory removed from this PR.

Pending:

- verify checked-in PNG metadata and opacity;
- measure final region/destination coordinates against the committed images;
- Tokyo/Shibuya overlay-specific visual checks;
- topology/compiler/Rust/Svelte/Workbench implementation;
- functional, responsive, accessibility, Tauri E2E, and final visual-fidelity verification.

A skipped workflow is not passing evidence. Keep PR #89 Draft until implementation and runtime visual checks are complete.
