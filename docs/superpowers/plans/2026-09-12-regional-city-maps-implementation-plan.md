# Regional City Maps — Single-PR Implementation Plan

> **Status:** Draft. Art sources are reviewed; runtime/compiler/UI implementation has not started.
> **Baseline:** `main` @ `4feeb0782d99fd9523063ee343f6df5a3d3306ef`.
> The [design spec](../specs/2026-09-12-regional-city-maps-design.md) is the product/data contract. The [map art handoff](../../art/maps/README.md) owns visual constraints and art-review status.
> Keep design, art import, implementation, and verification in Draft PR #89 as one PR.

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

## Task 0 — Import the reviewed raster art

### Review sources already committed

| Map | Review source | Current source size | Status |
| --- | --- | ---: | --- |
| Tokyo | `docs/art/maps/generated/tokyo.png` | 1672×941 | Accepted; overlay-readability gate remains |
| Kichijoji | `docs/art/maps/generated/kichijoji.png` | 1672×941 | Accepted |
| Shibuya | `docs/art/maps/generated/shibuya.png` | 1672×941 | Accepted; glass-booth runtime legibility gate remains |
| Shinjuku | `docs/art/maps/generated/shinjuku.png` | 1920×1080 | Accepted |
| Kabukicho | `docs/art/maps/generated/kabukicho.png` | 1672×941 | Accepted |
| Ginza / Minato | `docs/art/maps/generated/ginza_minato.png` | 1672×941 | Accepted |

### Runtime targets

- `static/assets/backgrounds/city_map/tokyo.png`
- `static/assets/backgrounds/city_map/kichijoji.png`
- `static/assets/backgrounds/city_map/shibuya.png`
- `static/assets/backgrounds/city_map/shinjuku.png`
- `static/assets/backgrounds/city_map/kabukicho.png`
- `static/assets/backgrounds/city_map/ginza_minato.png`

### Work

- [x] Generate and commit six real raster review sources.
- [x] Review all six for district identity and spoiler safety.
- [ ] Copy/normalize the approved sources to exact 1920×1080 opaque RGB PNG runtime paths.
- [ ] Preserve composition; do not bake labels, markers, route arrows, or UI into the raster.
- [ ] Verify Tokyo can carry five readable region anchors at 1280×720.
- [ ] Verify Shibuya's physical glass booth remains recognizable beneath the real marker layer.
- [ ] Measure destination coordinates only against the final runtime PNGs.

**Gate:** source-art review is complete enough to unblock implementation. Runtime overlay checks may replace only the failing map; they do not reopen the whole art set.

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

## Task 2 — Register map assets and keep Reader/Assets single-source

Primary files:

- `packages/scripts/compile-scenes/assets/enrich.ts`
- enrichment/manifest tests
- `apps/layout-editor/src/lib/reader-projection.ts`
- `apps/layout-editor/src/lib/asset-workspace.ts`
- existing Workbench tests

Requirements:

- register six unique backgrounds through the existing `globalFile` ownership path;
- use `background.city_map.tokyo` and `background.city_map.<region>` IDs;
- do not invent chapter/scene owners for global art;
- do not add a map-specific asset registry or second scene walker;
- Reader uses existing `structuralVisualCue` carriers:
  - `map:tokyo`
  - `map:tokyo:<regionId>`;
- future unused region art may have zero production-scene usage;
- assets-disabled compile emits no map manifest entries.

**Gate:** repeated Kichijoji wrappers do not create duplicate manifest entries.

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

Also inspect final runtime PNG metadata and visually check every map in the actual Tauri UI.

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
| Source sizes trigger architecture work | One-time normalization; no asset-versioning/image pipeline subsystem |
| Chapter 1 becomes free-roam | Nine-wrapper regression matrix remains the gate |
| Work fragments across PRs | Complete this ticket in Draft PR #89 |

## Current status

Completed:

- English design spec;
- English implementation plan;
- English art handoff;
- six real PNG review sources committed and individually reviewed;
- source-level spoiler/district-identity review.

Pending:

- runtime normalization/import of the six backgrounds;
- Tokyo/Shibuya overlay-specific visual checks;
- topology/compiler/Rust/Svelte/Workbench implementation;
- functional, responsive, accessibility, Tauri E2E, and final visual-fidelity verification.

A skipped workflow is not passing evidence. Keep PR #89 Draft until implementation and runtime visual checks are complete.
