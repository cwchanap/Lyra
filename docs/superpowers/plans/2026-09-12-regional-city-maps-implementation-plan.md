# Regional City Maps — Single-PR Implementation Plan

> **Status:** Draft; implementation has not started.
> **Baseline:** `main` @ `4feeb0782d99fd9523063ee343f6df5a3d3306ef`.
> The [design spec](../specs/2026-09-12-regional-city-maps-design.md) is the product/data contract. The [map art handoff](../../art/maps/README.md) owns visual asset details.
> This is one sequential work plan for Draft PR #89, not a set of separate PRs.

## Definition of done

The PR is complete when it contains:

- one Tokyo overview background and five district backgrounds;
- the v2 topology and asset-manifest support for those regions;
- Rust/view projection of only legal destinations and regions;
- a two-level Svelte map UI with a minimal return-to-map flow;
- Chapter 1's nine existing travel wrappers running unchanged in story order;
- a non-production multi-node fixture proving return/cancel/switch behavior;
- compiler, frontend, Rust, Workbench, save/resume, E2E, and visual-fidelity verification.

This PR does **not** author playable Chapters 2–8.

## Task 0 — Finalize and import map art

Review-candidate files committed now:

- `docs/art/maps/generated/tokyo.jpg`
- `docs/art/maps/generated/kichijoji.jpg`
- `docs/art/maps/generated/shibuya.jpg`
- `docs/art/maps/generated/shinjuku.jpg`
- `docs/art/maps/generated/kabukicho.jpg`
- `docs/art/maps/generated/ginza_minato.jpg`

Final runtime targets after art review:

- `static/assets/backgrounds/city_map/tokyo.png`
- `static/assets/backgrounds/city_map/kichijoji.png`
- `static/assets/backgrounds/city_map/shibuya.png`
- `static/assets/backgrounds/city_map/shinjuku.png`
- `static/assets/backgrounds/city_map/kabukicho.png`
- `static/assets/backgrounds/city_map/ginza_minato.png`

Checklist:

- [x] Generate/select one overview and five district candidates in the approved rainy anime neo-noir direction.
- [x] Normalize every review candidate to a 1920×1080 visual reference.
- [ ] After full-size art review, export the approved candidates as 1920×1080 opaque RGB PNGs at the runtime paths above.
- [x] Keep readable text/UI out of runtime rasters.
- [x] Record SHA-256 and source notes for the committed review candidates in the art handoff.
- [ ] Review each background at full size in the actual map UI before declaring art final.
- [ ] Measure final destination anchors against the imported 16:9 raster; do not copy approximate percentages from the concept board.
- [ ] Verify Shibuya's glass-booth scale and spoiler boundary in the actual runtime crop.

**Gate:** the files may be committed before code wiring, but production topology coordinates are not considered final until marker alignment is reviewed in the game.

## Task 1 — Cut `city_map.json` to v2 and extend compiler output

Primary files:

- `docs/stories_plan/city_map.json`
- `packages/scripts/compile-scenes/city-map.ts`
- `packages/scripts/compile-scenes/orchestrator.ts`
- `packages/scripts/compile-scenes/emitter.ts`
- `packages/scripts/compile-scenes/types.ts`
- existing city-map compiler fixtures/tests

Test first:

1. v2 parses regions plus nullable `regionId` on locations.
2. v1 is rejected; no compatibility parser is added.
3. duplicate IDs, invalid region references, invalid coordinates, and label/anchor mismatches fail closed.
4. unused future regions are legal.
5. an existing scene receives only metadata needed by its mapped destinations.
6. `regionId: null` destinations remain overview-direct.
7. assets-disabled compilation emits null background asset IDs while retaining navigable coordinates.

Implementation:

- preserve `- **Map:** tokyo` in authored scenes;
- preserve all Chapter 1 sublocation anchors;
- add region metadata and `node.regionId` to `JSONInvestigationMap`;
- keep existing pending-map reachability rules untouched;
- do not change travel-only null visual-cue handling or first-cue BGM/BGS logic.

**Gate:** all nine production wrappers still emit exactly one gameplay destination each.

## Task 2 — Register district assets and keep Reader/Assets correct

Primary files:

- `packages/scripts/compile-scenes/assets/enrich.ts`
- corresponding enrichment/manifest tests
- `apps/layout-editor/src/lib/reader-projection.ts`
- `apps/layout-editor/src/lib/asset-workspace.ts`
- corresponding Workbench tests
- `AssetsView.svelte` only if the current global-file display contract has a real gap

Implementation/test requirements:

- register six unique background entries through existing `globalFile` source ownership;
- use `background.city_map.tokyo` and `background.city_map.<region>` IDs;
- do not create fake chapter/scene owners;
- do not consume corpus first-visual-cue state;
- assets-disabled compile emits no map manifest entries;
- Reader emits `map:tokyo` plus `map:tokyo:<regionId>` structural visual cues only where a mapped scene can actually present them;
- future unused district art may correctly have zero production usage;
- do not add a second scene walker or a map-specific asset registry.

**Gate:** multiple wrappers referencing Kichijoji do not create duplicate manifest entries.

## Task 3 — Extend Rust schema/view projection, not durable state

Primary files:

- `apps/game/src-tauri/src/game/schema.rs`
- `apps/game/src-tauri/src/game/view.rs`
- `apps/game/src-tauri/src/game/mod.rs`
- Rust investigation/map tests
- `apps/game/src/lib/state/types.ts`

Test first:

- hidden/locked node is not projected;
- a region with no visible/unlocked node is not projected;
- a region with an available node is projected;
- overview-direct nodes remain available without a region;
- stale/guessed leaf IDs are still rejected by existing travel validation;
- map-less investigations retain current auto-entry behavior;
- mapped pending state still blocks auto-entry and auto-outro.

Implementation:

- mirror the compiler's v2 scene wire using existing camelCase serde rules;
- derive runtime region availability from the already-authorized node set;
- do not add a save field, migration, travel command, region command, or route state.

**Gate:** selecting the one Chapter 1 destination still advances exactly once through the existing command transaction.

## Task 4 — Implement overview/district planes and minimal return-to-map UI

Primary files:

- `apps/game/src/lib/components/InvestigationMapView.svelte`
- `apps/game/src/lib/components/InvestigationMapView.test.ts`
- `apps/game/src/lib/components/ExploreView.svelte`
- `apps/game/src/lib/components/ExploreView.test.ts`
- `apps/game/src/routes/+page.svelte` and focused source/component tests where needed

Tests/behavior:

- [ ] a sole non-null region opens directly on that district;
- [ ] mixed/direct destinations open on Tokyo overview;
- [ ] `data-map-region=<regionId>` changes plane only;
- [ ] `data-map-destination=<sublocationId>` remains the gameplay leaf selector;
- [ ] opening the map from a mapped interior preserves current sublocation;
- [ ] cancel returns to the same interior without IPC;
- [ ] selecting the current leaf closes the map without replaying entry content;
- [ ] selecting another leaf invokes the existing callback once;
- [ ] failed travel leaves the map open;
- [ ] successful travel closes/reset state through the returned current sublocation;
- [ ] same-scene save load resets map browsing via `presentationState.sessionEpoch` + scene identity;
- [ ] pending acquisitions, persistence layers, menus, and command-in-flight states block map interaction through the existing shell rules;
- [ ] narrow windows keep destination names readable and targets >= 44 px;
- [ ] keyboard navigation has one set of destination tab stops;
- [ ] `prefers-reduced-motion` disables crossfade animation;
- [ ] missing raster still leaves named native destination controls usable;
- [ ] A → B → A async background resolution cannot pair stale raster and markers.

Implementation guidance:

- keep one `InvestigationMapView`; do not create one Svelte component per district;
- `ExploreView` owns only `mapOpen`;
- `InvestigationMapView` owns only active plane/region and asset-loading presentation state;
- use a keyed identity or request generation for background resolution;
- continue to suppress `SublocationNav` for mapped investigations;
- do not add a global key listener; use existing shell Escape/top-layer behavior and native back/cancel controls.

**Gate:** browsing the map does not change revision/history/inventory/reveals; only travel does.

## Task 5 — Chapter 1 regression matrix, fixtures, save/resume, and Tauri E2E

Production route table:

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

Fixture requirements:

- at least two regions;
- at least one overview-direct leaf;
- at least one locked/hidden leaf;
- at least two legal destinations in one mapped investigation so return/switch behavior is exercised without authoring Chapter 2 production content.

E2E selectors:

- keep `data-map-destination` for leaf travel;
- add `data-map-region` for presentation browsing;
- do not widen `soleMapDestinationId()` to include region buttons.

Regression matrix:

| Scenario | Required result |
| --- | --- |
| Nine Chapter 1 maps | leaf IDs/order unchanged; one travel leaf each |
| Browse overview and back | no scene advance/evidence/history/save mutation |
| Rapid/double leaf click | one legal travel mutation; no skipped scene |
| Save/restore while pending | still waiting for player choice |
| Open map from interior then cancel | same interior; no entry replay |
| Select current destination | close map; no IPC/reveal replay |
| Multi-region fixture | legal regions/destinations switch; locked region cannot be exposed |
| Load same scene in new session epoch | old open/region/loading state does not survive |
| Slow or failed image load | text controls remain usable; no stale raster/marker pairing |
| 1920×1080 / 1280×720 / narrow | readable labels, 44 px targets, no critical overlap |
| Reader/Assets | six sources are unique; usage is not fabricated |

Use the existing WDIO/Tauri harness and production journey rather than a browser-only demo. Visual verification is separate from functional verification.

## Verification commands

Run focused touched-file tests first, then the repository gates:

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

Also verify image metadata with `file -b static/assets/backgrounds/city_map/*.png` (or an equivalent metadata tool) and inspect every imported background at 1920×1080 in the running game.

## Self-review / scope checks

| Risk | Plan response |
| --- | --- |
| Five districts become five engines | One topology, one component, one travel command |
| Browsing accidentally mutates game state | Region/overview changes are presentation-only |
| Return-to-map becomes a second state machine | Keep durable current sublocation; local `mapOpen` only |
| Frontend leaks locked destinations | Rust projects from authorized visible/unlocked nodes |
| Save format expands | No durable map fields |
| Future chapter art becomes playable accidentally | Art may exist with zero production scene usage |
| Concept-board text leaks into runtime | Runtime assets are textless PNGs; labels are native UI |
| Async images mismatch markers | Plane identity + stale-request guard |
| Same-scene load preserves stale UI | Reset with existing session epoch + scene identity |
| Chapter 1 free exploration sneaks in | Nine wrapper table remains the acceptance baseline |
| PR fragments into docs/art/code follow-ups | All work remains on Draft PR #89 |

## Current verification status

The design was revalidated against current `main` through the GitHub connector. The generated map art candidates are now included in the PR as reviewable 1920×1080 JPEGs under `docs/art/maps/generated/`. Final runtime PNG export/import remains a Task 0 gate. Runtime/compiler code remains unimplemented, so functional tests, Tauri E2E, and final visual-fidelity review are still pending. A skipped CI run is not considered passing evidence.
