# Tokyo Rain Evidence — Regional Map Art Handoff

Companion docs: [design spec](../../superpowers/specs/2026-09-12-regional-city-maps-design.md) and [implementation plan](../../superpowers/plans/2026-09-12-regional-city-maps-implementation-plan.md).

This file owns the art review state and runtime import contract for the Tokyo overview and five district maps. It is not a second story/location registry.

## 1. Runtime asset set

| Map | Asset ID | Runtime path | Planned use |
| --- | --- | --- | --- |
| Tokyo overview | `background.city_map.tokyo` | `static/assets/backgrounds/city_map/tokyo.png` | Cross-district orientation |
| Kichijoji | `background.city_map.kichijoji` | `static/assets/backgrounds/city_map/kichijoji.png` | Chapter 1 |
| Shibuya | `background.city_map.shibuya` | `static/assets/backgrounds/city_map/shibuya.png` | Chapter 2 preparation |
| Shinjuku | `background.city_map.shinjuku` | `static/assets/backgrounds/city_map/shinjuku.png` | Chapter 4 preparation |
| Kabukicho | `background.city_map.kabukicho` | `static/assets/backgrounds/city_map/kabukicho.png` | Chapter 5 preparation |
| Ginza / Minato | `background.city_map.ginza_minato` | `static/assets/backgrounds/city_map/ginza_minato.png` | Chapter 3 preparation |

Runtime backgrounds are exact 1920×1080 opaque RGB PNGs. Labels, pins, state, and interaction remain native UI overlays.

## 2. Art direction

The approved family is grounded anime neo-noir Tokyo at rainy blue hour:

- elevated three-quarter city illustration;
- cool slate/navy rain atmosphere;
- wet-road reflections;
- restrained cyan/violet neon with selective warm windows;
- recognizable district silhouettes;
- continuous streets/blocks rather than floating islands;
- no readable labels, map UI, characters, bodies, spoiler routes, or interior cutaways baked into the art.

The art should establish place and mood. Gameplay meaning stays in the UI/data model.

## 3. Full-resolution review sources in this PR

The PR now contains six real raster PNG sources:

| Map | Review source | Source size | Review verdict |
| --- | --- | ---: | --- |
| Tokyo overview | [`generated/tokyo.png`](generated/tokyo.png) | 1672×941 | **Accept** — strong city-wide identity; verify region-anchor readability in the real UI |
| Kichijoji | [`generated/kichijoji.png`](generated/kichijoji.png) | 1672×941 | **Accept** — café, shopping street, greenery, and rail/station read clearly |
| Shibuya | [`generated/shibuya.png`](generated/shibuya.png) | 1672×941 | **Accept with runtime gate** — screens/crossing/event plaza read well; verify the physical glass booth still reads at gameplay scale |
| Shinjuku | [`generated/shinjuku.png`](generated/shinjuku.png) | 1920×1080 | **Accept** — visually distinct medical/business district; anchor the clinic to the institutional block, not a tower |
| Kabukicho | [`generated/kabukicho.png`](generated/kabukicho.png) | 1672×941 | **Accept** — theater/nightlife identity is clear and distinct from Shibuya |
| Ginza / Minato | [`generated/ginza_minato.png`](generated/ginza_minato.png) | 1672×941 | **Accept** — commercial-to-waterfront transition reads without implying a case route |

These exact files were reviewed as the sources currently committed to Draft PR #89. Five generated sources are near-16:9 at 1672×941; Shinjuku is already 1920×1080. Do not claim that all review sources are already runtime-sized.

The review sources remain under `docs/art/maps/generated/` for design provenance. During implementation, copy/normalize the approved images to the runtime paths in Section 1. Do not point `city_map.json` directly at the documentation folder.

## 4. Image-specific constraints

### Tokyo overview

The overview is intentionally an illustrated city, not GIS. Its job is to let the player understand the relative city shape after UI region anchors are added.

Runtime gate:

- place all five region anchors on visibly distinct clusters;
- test at 1280×720, not only 1920×1080;
- if labels/anchors make the city unreadable, adjust overlay placement first; regenerate art only if the image itself cannot support the hierarchy.

### Kichijoji

Use the warm corner storefront as the `rain_bell_cafe` landmark and a separated commercial street segment for `kichijoji_shopping_street`.

Decorative station, park, convenience stores, alleys, and homes do not become Chapter 1 gameplay nodes merely because they are visible.

### Shibuya

The region may show the public event plaza, giant screens, crossing, and the physical glass booth. It must not reveal M-03, service-elevator internals, the vacant-floor murder space, sight cones, or the final transfer route.

The current candidate has the correct district mood and keeps the giant screens separate from the small physical plaza structure. Before runtime approval, render the map with the actual marker layer and confirm the booth is still recognizable. If it reads only as a decorative glass sculpture, replace/edit **Shibuya only** rather than reopening the whole art set.

### Shinjuku

Exterior context only. Use the quieter institutional/medical cluster for the clinic anchor. Do not imply ward, reception, records-room, Aoba, or memory-treatment interior geography.

### Kabukicho

The public theater frontage and nightlife streets are safe. Do not expose stage machinery, lift compartments, prop-room truth, body positions, the 90-second mechanism, or blue-umbrella evidence.

### Ginza / Minato

The commercial avenue → towers → waterfront/highway composition is illustrative city compression. It does not define the Chapter 3 suspect route or evidentiary travel time.

## 5. Runtime normalization and coordinates

Task 0 implementation steps:

1. copy each approved review source into `static/assets/backgrounds/city_map/`;
2. normalize to exact 1920×1080 RGB/opaque PNG while preserving composition;
3. do not bake labels or markers into the image;
4. render each image in the actual 16:9 map surface;
5. measure destination coordinates against the final runtime PNG, not the generated source;
6. verify letterboxing/resizing keeps marker alignment stable;
7. test 1920×1080, 1280×720, and narrow-window layouts.

The source-resolution mismatch is not a reason to add an asset-versioning or image-processing subsystem. This is a one-time import step.

## 6. Acceptance checklist

Source-art review:

- [x] six real PNG review sources are committed;
- [x] all six sources were reviewed individually;
- [x] no source exposes a hidden case route or interior solution;
- [x] Kichijoji, Shinjuku, Kabukicho, and Ginza / Minato have distinct identities;
- [x] Shinjuku is visually distinct from Kabukicho;
- [x] the set shares a consistent rainy-night visual family;
- [ ] confirm Shibuya glass-booth legibility with the actual gameplay overlay;
- [ ] confirm Tokyo overview supports five readable region anchors at 1280×720.

Runtime-art gate:

- [ ] normalize/copy all six approved sources to exact 1920×1080 runtime PNGs;
- [ ] verify no readable generated signage becomes distracting at full runtime size;
- [ ] measure final anchors only after runtime normalization;
- [ ] run marker-alignment review in the Tauri game;
- [ ] replace only the failed candidate if a runtime visual check fails.

The current art set is good enough to proceed with implementation. Art should no longer block Tasks 1–4; the two remaining art checks happen when the real overlay exists.
