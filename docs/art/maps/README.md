# Tokyo Rain Evidence — Regional Map Art Handoff

Companion docs: [design spec](../../superpowers/specs/2026-09-12-regional-city-maps-design.md) and [implementation plan](../../superpowers/plans/2026-09-12-regional-city-maps-implementation-plan.md).

This file owns the visual requirements, generated-art review state, and runtime import checklist for the Tokyo overview and five district backgrounds. It is **not** a story bible and **not** a second runtime location registry.

## 1. Runtime asset set

| Map | Asset ID | Runtime path | Planned story use |
| --- | --- | --- | --- |
| Tokyo overview | `background.city_map.tokyo` | `static/assets/backgrounds/city_map/tokyo.png` | Cross-district orientation + existing overview-direct destinations |
| Kichijoji | `background.city_map.kichijoji` | `static/assets/backgrounds/city_map/kichijoji.png` | Chapter 1 map presentation |
| Shibuya | `background.city_map.shibuya` | `static/assets/backgrounds/city_map/shibuya.png` | Chapter 2 design preparation / fixture |
| Shinjuku | `background.city_map.shinjuku` | `static/assets/backgrounds/city_map/shinjuku.png` | Chapter 4 exterior district preparation |
| Kabukicho | `background.city_map.kabukicho` | `static/assets/backgrounds/city_map/kabukicho.png` | Chapter 5 exterior district preparation |
| Ginza / Minato | `background.city_map.ginza_minato` | `static/assets/backgrounds/city_map/ginza_minato.png` | Chapter 3 compressed transport-area preparation |

The six **runtime** targets remain opaque 1920×1080 RGB PNGs. Runtime text, markers, status, and controls stay outside the raster.

## 2. Shared art direction

The approved direction is grounded anime neo-noir Tokyo at rainy blue hour:

- elevated three-quarter city illustration;
- readable continuous streets / blocks rather than floating islands;
- cool slate / navy rain atmosphere;
- wet-road reflections;
- restrained cyan / violet neon;
- warm windows and street lamps used sparingly;
- enough Tokyo character to make districts distinct without becoming GIS;
- edited composition so interactive landmarks remain readable under UI overlays.

Do **not** bake any of the following into runtime rasters:

- readable place names or shop text;
- chapter numbers;
- map pins, focus rings, route arrows, scale bars, or compass UI;
- evidence labels or mystery annotations;
- foreground dialogue characters;
- bodies or spoiler props;
- hidden-room cutaways or omniscient internal routes.

## 3. Generated art included in this PR

`docs/art/maps/generated/` contains the complete first-pass visual review set:

- `tokyo.svg`
- `kichijoji.svg`
- `shibuya.svg`
- `shinjuku.svg`
- `kabukicho.svg`
- `ginza_minato.svg`

These SVGs are **review previews**, not runtime assets. Each file wraps an embedded generated JPEG frame at 480×270 so the art direction is visible directly in the PR without pretending the preview is the final asset pipeline.

Why keep the distinction explicit:

- the production policy requires 1920×1080 opaque PNG backgrounds;
- district anchors must be measured against the final approved raster, not a preview;
- generated signage or composition mistakes may require regeneration;
- Shibuya in particular must be checked for livestream-booth scale and spoiler-safe exterior geometry;
- generated art must not silently establish new story geography.

Do **not** point `city_map.json` at `docs/art/maps/generated/*.svg`. After review, approved or regenerated source art is normalized into the runtime paths in Section 1 and verified there.

### Review-state table

| Preview | Current purpose | Runtime-approved? |
| --- | --- | --- |
| `tokyo.svg` | overall visual family / city silhouette | No |
| `kichijoji.svg` | Chapter 1 district identity and anchor spacing | No |
| `shibuya.svg` | Chapter 2 district identity / event-area composition | No |
| `shinjuku.svg` | medical-district mood / skyline contrast | No |
| `kabukicho.svg` | theater-nightlife identity | No |
| `ginza_minato.svg` | commercial / waterfront transport identity | No |

The PR may stay Draft while a preview is being replaced. “Generated and committed” means the direction is reviewable; it does **not** mean release art has passed the runtime contract.

## 4. District composition contracts

### 4.1 Kichijoji

Visual identity: warm low-rise neighborhood, tree cover, shopping-street scale, station / rail presence. It should feel quieter and more lived-in than the other districts.

Production anchors in this PR:

- `rain_bell_cafe` — place on a readable modest storefront / building cluster, not a giant landmark palace;
- `kichijoji_shopping_street` — place on a coherent pedestrian / commercial street separated enough from the cafe that the two buttons do not visually collapse.

Decorative station, park, convenience stores, alleys, and houses must **not** become Chapter 1 gameplay destinations merely because they are visible.

### 4.2 Shibuya

Visual identity: dense commercial city, huge screen / light presence, event plaza, surrounding work / commercial blocks.

Story boundary:

- the district map may communicate that the event occupies a real public area;
- it must not prove the hidden service route, M-03 connection, elevator path, vacant-floor murder space, or any sight-line conclusion;
- the livestream glass box must be human-scale, with the audience outside it;
- the giant screen and the physical booth must remain visibly distinct objects.

If the final art overstates booth scale or exposes the service route, regenerate / replace it in this same PR before marking the PR ready.

### 4.3 Shinjuku

Visual identity: cooler, calmer urban-medical district set against a large Shinjuku skyline.

The district art is exterior context only. Do not infer or expose ward / reception / records-room positions, Aoba material, memory-treatment internals, or left / right route clues.

### 4.4 Kabukicho

Visual identity: theater / nightlife block with more red-violet accent than Shibuya, but still grounded rather than full-saturation cyberpunk.

The region may show a theater-like public frontage and ordinary back / service streets. It must not expose stage machinery, lift compartments, prop-room truth, body positions, the 90-second mechanism, or blue-umbrella evidence.

### 4.5 Ginza / Minato

Visual identity: ordered commercial avenue transitioning toward denser modern towers and waterfront / highway infrastructure.

The connection is an artistic city-compression device, not a canonical route. Do not add suspect arrows, timing labels, live vehicle positions, or evidentiary distance claims.

## 5. Coordinate and UI handoff

Do not copy marker coordinates from generated concept boards or review previews. After the v2 topology is implemented:

1. open the final approved 1920×1080 raster;
2. render it in the real 16:9 map plane;
3. place destinations against actual entrances / landmarks;
4. measure normalized coordinates from the final image;
5. test long labels at 1920×1080, 1280×720, and narrow width;
6. ensure markers do not overlap the objective / header area;
7. verify the same coordinates align after letterboxing / resizing;
8. keep every interactive point outside baked art.

## 6. Runtime-art acceptance checklist

Before Draft PR #89 can become ready:

- [x] commit one review preview for Tokyo + each of the five districts;
- [ ] open the selected full-resolution source for all six images individually;
- [ ] approve or regenerate any preview with weak district identity, readable generated signage, wrong scale, or spoiler geometry;
- [ ] normalize approved sources to RGB / opaque 1920×1080 PNGs under `static/assets/backgrounds/city_map/`;
- [ ] verify no readable text or UI leaked into runtime art;
- [ ] verify no spoiler routes / interiors are visible;
- [ ] verify Kichijoji has enough separation for cafe + shopping-street anchors;
- [ ] verify Shibuya glass-box scale against the Chapter 2 case contract;
- [ ] verify Shinjuku / Kabukicho read as different districts;
- [ ] verify Ginza / Minato does not imply a canonical evidentiary route;
- [ ] verify Tokyo overview and district maps feel like the same visual family;
- [ ] measure final anchors only after runtime art is approved;
- [ ] perform marker-alignment review in the actual Tauri game;
- [ ] replace any failed candidate without introducing an asset-versioning subsystem.

The committed SVG previews make the complete generated art direction reviewable in GitHub. They deliberately remain outside the runtime asset path until the full-resolution art passes this checklist.
