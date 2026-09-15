# Regional Anime City Map Design Specification

> **Status:** Draft design and implementation handoff for Draft PR #89. The six runtime map PNGs are committed; topology/compiler/Rust/UI wiring has not started yet.
> **Baseline:** `main` @ `4feeb0782d99fd9523063ee343f6df5a3d3306ef`.
> **Delivery rule:** artwork, implementation, and tests for this feature stay in this single PR. Do not merge the documents and open a second implementation PR.

Related documents: [implementation plan](../plans/2026-09-12-regional-city-maps-implementation-plan.md) and the existing [HPA-601 linear city-map design](2026-08-30-hpa-601-linear-city-map-navigation-design.md).

## 1. Goal and scope

Replace the current “one city background plus scattered pins” presentation with a two-level map:

1. **Tokyo overview** — gives the player a stable mental model of where major districts sit relative to each other.
2. **District submap** — gives the player a readable illustrated neighborhood in which the current investigation destinations are spatially meaningful.

This is a presentation and navigation improvement, not an open-world system.

| Layer | Question it answers | Responsibility in this PR |
| --- | --- | --- |
| Tokyo overview | Where are the districts relative to each other? | Stable city silhouette, legal district entries, and existing direct destinations |
| District map | Where can I go inside this district? | One illustrated map for Kichijoji, Shibuya, Shinjuku, Kabukicho, and Ginza/Minato |
| Case spatial evidence | Who saw what and how could someone move? | Remains case-specific evidence/investigation content; not a third generic navigation layer |

The implementation target for this PR is the two-level presentation, its asset pipeline, the existing nine Chapter 1 travel wrappers, and a non-production multi-destination fixture. The PR does **not** author Chapters 2–8, implement Chapter 2 phases/side quests/evidence boards, or add a general city-simulation layer.

Out of scope: GIS, 3D/WebGL, free camera movement, pathfinding, travel cost, timetable simulation, map-specific save data, a map editor, weather simulation, day/night variants, or a new travel scene type.

## 2. Existing seams to reuse

The design is intentionally built on the seams already shipped by HPA-601.

| Concern | Existing source | This PR |
| --- | --- | --- |
| Global topology | `docs/stories_plan/city_map.json` | One v2 cutover adding regions and region membership |
| Compiler | `city-map.ts`, `orchestrator.ts`, `types.ts`, `emitter.ts` | Emit district metadata alongside existing destination nodes |
| Durable runtime state | Rust `schema.rs`, `view.rs`, `mod.rs` | Extend scene/view wire only; no new save state |
| Map UI | `InvestigationMapView.svelte`, `ExploreView.svelte` | Add overview/district planes and a minimal return-to-map flow |
| Session/input lifecycle | `apps/game/src/routes/+page.svelte` | Reuse `presentationState.sessionEpoch`, current scene identity, and existing gameplay blocking |
| Asset pipeline | `assets/enrich.ts`, `@lyra/asset-paths` | Register the committed overview + district art through the existing global-file path |
| Workbench | `reader-projection.ts`, `asset-workspace.ts`, `AssetsView.svelte` | Reuse `structuralVisualCue` and global source display |
| E2E destination drain | `soleMapDestinationId()` | Keep leaf travel deterministic; region buttons are never travel destinations |

Current behavior that must be preserved:

- mapped investigations wait with `current_sublocation_id == None` until the player chooses a destination;
- Rust does not auto-enter or auto-outro while a mapped scene is waiting;
- actual travel still uses the existing `enter_sublocation` command;
- Chapter 1 wrappers remain one-destination linear travel wrappers;
- mapped scenes continue to suppress `SublocationNav`.

## 3. District model

The first map set contains five districts.

| Region ID | Display name | Visual identity | Production usage in this PR |
| --- | --- | --- | --- |
| `kichijoji` | Kichijoji | Low-rise shopping streets, cafe warmth, station/rail, green space | `rain_bell_cafe`, `kichijoji_shopping_street` |
| `shibuya` | Shibuya | Large screens, event plaza, glass-box area, dense commercial blocks | Art preparation + non-production fixture |
| `shinjuku` | Shinjuku | Quiet clinic block against a dense tower skyline | Art preparation only |
| `kabukicho` | Kabukicho | Theater frontage, narrow nightlife streets, restrained red/violet neon | Art preparation only |
| `ginza_minato` | Ginza / Minato | Ordered commercial avenues transitioning toward modern high-rises | Art preparation only |

Kabukicho remains a neighborhood view within greater Shinjuku; it is not treated as a separate distant city. Ginza/Minato is a compressed presentation region and does not imply that every point shown is walkable.

Existing Chapter 1 destinations `police_meeting_room`, `outsourced_review_office`, `soma_detective_office`, and `kagami_review_room` remain `regionId: null` **overview-direct destinations** for this slice. Their existing IDs, labels, and overview coordinates remain stable. This is a presentation boundary, not a claim that their story addresses are unknown.

The old reserved `shibuya` location must not coexist with a `shibuya` region as a duplicate interactive entry. Before the v2 cutover, verify that no authored sublocation references that reserved location ID; if a real reference exists, resolve it explicitly rather than silently deleting it.

## 4. Player flow

### 4.1 Pending-map entry

When a mapped scene is waiting for destination selection:

- if every currently legal destination belongs to the same non-null region, open directly on that district map;
- otherwise open the Tokyo overview;
- direct overview destinations remain clickable from the overview;
- a region button only changes the displayed plane and does not invoke gameplay mutation;
- only a leaf destination calls `onEnterSublocation(id)`.

This prevents an unnecessary extra “Tokyo overview → Kichijoji” click in Chapter 1 while still letting the player back out to the overview for orientation.

The header remains intentionally small: `Tokyo Overview / <District>`, the current scene Summary, and a short map-context label. Do not import the concept-board chapter list, progress counters, decorative statistics, or new menu hierarchy into the runtime UI.

### 4.2 Interaction contract

| Player action | Presentation result | Durable game effect |
| --- | --- | --- |
| Select region | Switch overview/district plane | None |
| Return to overview | Switch plane | None |
| Select a different legal leaf | Invoke existing travel callback | Existing `enter_sublocation` mutation only |
| Open map from an interior | Show the current district, or overview for a direct node | Keep current sublocation unchanged |
| Cancel map browsing | Return to the same interior | None |
| Select the current leaf | Close map and remain in the same interior | No IPC; no replay of entry reveals |
| Travel command fails | Keep the map open and preserve the existing error path | No optimistic state mutation |
| Travel succeeds | Render returned scene/mode/current sublocation | No second advance/confirm command |

Pending-map state has no interior to cancel back to; therefore “Return to scene” is only available when `currentSublocationId != null`.

### 4.3 Return-to-map scope

HPA-601 deliberately did not implement returning from a mapped interior. This PR adds the minimum presentation-only version required for future multi-destination investigations:

- `ExploreView` owns a transient `mapOpen` flag;
- opening the map does not clear Rust `current_sublocation_id`;
- closing returns to the same interior state;
- the current destination is not re-entered;
- a different legal destination still travels through the existing command.

This is not a second navigation state machine and does not claim the full Chapter 2 free-investigation lifecycle is implemented.

### 4.4 Transient reset rules

Presentation-only state must never leak across loads or scenes.

- `mapOpen` belongs to `ExploreView` only.
- `activeRegionId` belongs to `InvestigationMapView` only; `null` means overview.
- hover/focus/loading state stays local to the map surface.
- `+page.svelte` resets the Explore subtree using the existing session epoch plus chapter/scene identity (a keyed subtree or an explicit reset identity are both acceptable).
- a successful load of the same scene ID must still reset presentation state; scene ID alone is insufficient.
- do **not** key on every game-state object or durable revision, because ordinary interactions must not collapse the map.
- when current sublocation changes successfully, close `mapOpen`.
- failed travel does not change current sublocation, so the map remains open.
- leaving Explore, changing scene, or changing session clears map browsing state.

The page continues to own higher-level input blocking. Pass `gameState.inFlight || gameplayInteractionBlocked` to map interactions; do not duplicate acquisition/save/menu state machines inside the map components.

## 5. Visual and interaction design

### 5.1 Art direction

The map art follows the selected Lyra visual direction:

- grounded anime neo-noir Tokyo;
- elevated three-quarter city illustration rather than realistic GIS;
- cool blue-gray rainy atmosphere;
- wet-road reflections and restrained neon;
- small amounts of warm window/street light;
- recognizable district silhouettes;
- no readable signage, UI, labels, pins, routes, chapter numbers, characters, bodies, or spoiler clues baked into the raster.

The map should help the player remember a place before asking them to read its label.

### 5.2 Runtime overlays

- The raster is art only. Destination names, states, focus treatment, and accessibility text are code-native.
- A destination corresponds to one physical landmark anchor and one native `<button>`.
- Do not imply that an entire raster building can independently glow; hover/focus highlights the marker/label layer.
- Legal travel state must be communicated with shape/text/focus affordance, not color alone.
- Destination names remain readable on narrow windows; do not repeat the current behavior that simply hides `.pin-label` below 720 px.
- Minimum target size is 44 px.
- If the narrow layout needs a textual destination list, it must be a projection of the same destination data and callback, not a parallel navigation model.
- Avoid duplicate tab stops when the map and list are both visible.
- Respect `prefers-reduced-motion`; the only motion required is a short optional crossfade between planes.

### 5.3 Coordinate plane and loading identity

Each background and its markers share one 16:9 normalized coordinate plane. The component should letterbox instead of cropping the map art to an arbitrary parent aspect ratio.

Treat `{mapId, planeKind, regionId, backgroundAssetId}` as one presentation identity. During region switching:

- never display new-region markers over the previous region's raster;
- cancel or ignore stale asset-resolution responses;
- A → B → A switching must settle on the final A identity;
- if art is missing, labels and native travel controls still remain usable;
- assets-disabled builds remain navigable with `backgroundAssetId == null`.

## 6. Topology and compiler contract

Keep one authored topology file: `docs/stories_plan/city_map.json`.

Use a one-time `version: 2` cutover. This pre-release project does not need a v1 compatibility parser or migration converter.

```ts
type CityMap = {
  version: 2;
  id: "tokyo";
  backgroundPrompt: string;
  regions: Array<{
    id: string;
    label: string;
    x: number; // anchor on Tokyo overview
    y: number;
    backgroundPrompt: string;
  }>;
  locations: Array<{
    id: string; // existing sublocation anchor
    label: string;
    regionId: string | null;
    x: number; // district coordinates when regionId != null, overview otherwise
    y: number;
  }>;
};
```

Topology owns IDs, labels, region membership, prompts, and normalized coordinates only. It does not own chapter progression, routes, travel cost, completion, or NPC schedules.

Validation requirements:

- unique non-empty region and location IDs;
- finite normalized coordinates in `[0,1]`;
- every non-null `regionId` references an existing region;
- authored sublocation anchors/labels continue to match topology entries;
- unused regions are allowed as future art preparation;
- an empty region never becomes an interactive UI entry.

Authored scenes continue to use `- **Map:** tokyo`; do not duplicate prompts into individual scene Markdown.

Compiler-emitted investigation map shape:

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

Compiler ownership and runtime ownership remain separate:

- the compiler may carry metadata for regions referenced by the scene definition;
- Rust derives the **currently visible/available** region set from the already-authorized visible/unlocked nodes;
- the frontend must not reconstruct chapter unlock rules;
- hidden/locked location names must not appear in labels, tooltips, ARIA text, or DOM buttons.

No new “visited” semantic is introduced in this slice. “Visited,” “searched,” and “completed” have different meanings; do not invent one until an existing durable field is verified as the source of truth.

## 7. Asset and Workbench contract

The committed files below are the **canonical runtime art** for this feature. Do not maintain a second copy under `docs/`.

| Asset ID | Canonical path |
| --- | --- |
| `background.city_map.tokyo` | `static/assets/backgrounds/city_map/tokyo.png` |
| `background.city_map.kichijoji` | `static/assets/backgrounds/city_map/kichijoji.png` |
| `background.city_map.shibuya` | `static/assets/backgrounds/city_map/shibuya.png` |
| `background.city_map.shinjuku` | `static/assets/backgrounds/city_map/shinjuku.png` |
| `background.city_map.kabukicho` | `static/assets/backgrounds/city_map/kabukicho.png` |
| `background.city_map.ginza_minato` | `static/assets/backgrounds/city_map/ginza_minato.png` |

All six runtime files must remain opaque RGB 1920×1080 PNGs. If art is replaced after an overlay review, replace the file at the same path and re-measure its normalized anchors.

Path construction remains in `@lyra/asset-paths`.

`assets/enrich.ts` registers the overview and each region exactly once, with `source: { globalFile: cityMap.sourceFile }`. Registering global map art must not consume the corpus first-visual-cue state. In assets-disabled compilation, all map background asset IDs are null and no map manifest entries are emitted.

Reader uses the existing `structuralVisualCue` mechanism:

- overview carrier: `map:tokyo`;
- region carrier: `map:tokyo:<regionId>`.

Scene usage means “this scene can present this map plane,” not “the player definitely visited it.” Unused future district art may correctly have zero production-scene usage.

Do not add a second scene walker, a dedicated map editor, an image-copy step, or a map-specific asset registry. If current Workbench write-back cannot safely edit several prompts inside one global topology source, keep those map prompt entries read-only rather than widening this PR into a map-authoring product.

## 8. Story and spoiler boundaries

The map is a district illustration, not omniscient evidence.

- Shibuya may show the public event plaza, giant screen, human-scale glass booth, surrounding streets, and an ordinary commercial-building exterior. It must not reveal M-03, service-elevator internals, the vacant-floor murder space, sight cones, or the final transfer route.
- Shinjuku may show the clinic exterior and neighborhood. It must not expose ward interiors, Aoba labels, memory-tech clues, or left/right escape-route information.
- Kabukicho may show the theater exterior, public streets, and an ordinary service entrance. It must not reveal stage machinery, lift compartments, body positions, the 90-second device, or the blue-umbrella reveal.
- Ginza/Minato roads are illustrative connections only. Do not draw a suspect route, live vehicle path, timing arrow, or precise evidentiary travel time.
- Chapter 6 can reuse the overview transportation skeleton later, but this PR does not invent a sixth district for Chapters 7–8 or place final-chapter truth on the map.

## 9. Chapter 1 invariants

All nine existing map wrappers remain in the same story order with the same leaf destination.

| Wrapper | Destination | Map presentation |
| --- | --- | --- |
| `investigation_scene_map_01` | `rain_bell_cafe` | Open Kichijoji directly; overview remains available |
| `investigation_scene_map_02` | `police_meeting_room` | Overview direct |
| `investigation_scene_map_03` | `kagami_review_room` | Overview direct |
| `investigation_scene_map_04` | `kichijoji_shopping_street` | Open Kichijoji directly; overview remains available |
| `investigation_scene_map_05` | `rain_bell_cafe` | Open Kichijoji directly |
| `investigation_scene_map_06` | `outsourced_review_office` | Overview direct |
| `investigation_scene_map_07` | `kagami_review_room` | Overview direct |
| `investigation_scene_map_08` | `rain_bell_cafe` | Open Kichijoji directly |
| `investigation_scene_map_09` | `soma_detective_office` | Overview direct |

No station, convenience store, park, or decorative landmark becomes a Chapter 1 gameplay node.

## 10. Acceptance criteria

1. The six canonical runtime map PNGs are committed directly under `static/assets/backgrounds/city_map/`; no duplicate review-art directory is required.
2. All six committed runtime maps are verified as opaque RGB 1920×1080 PNGs before Ready for Review.
3. The nine Chapter 1 wrappers retain their order and one legal travel leaf each.
4. Region browsing produces no durable revision, history, evidence, entry reveal, or save-state change.
5. Only a leaf destination invokes existing travel mutation.
6. Pending mapped scenes still do not auto-enter or auto-outro.
7. A mapped multi-node test fixture can enter a location, reopen the map, cancel, select the current location without replay, and move to another legal location.
8. Hidden/locked nodes cannot be exposed by region browsing.
9. Same-scene save load resets transient map UI via session identity.
10. Rapid region switching never combines one plane's markers with another plane's raster.
11. 1920×1080, 1280×720, and narrow-window layouts retain readable destination names and non-overlapping 44 px targets.
12. Keyboard and reduced-motion behavior are covered.
13. Six unique map background manifest entries use the existing global source contract; Reader/Assets distinguish overview and district usage.
14. Assets-off and missing-art cases remain navigable.
15. Tokyo's five region choices remain readable at 1280×720, and Shibuya's physical glass booth remains identifiable without exposing the hidden route.
16. The PR stays Draft until runtime, Tauri E2E, and visual-fidelity review are complete.

## 11. Design review conclusion

The two-level system is intentionally small: one topology, one existing investigation lifecycle, one existing travel command, one canonical runtime copy of each map image, and transient presentation state only. It improves spatial readability without turning the VN into a map engine. Future chapter content can opt into the prepared district art when authored, without requiring a new travel architecture.
