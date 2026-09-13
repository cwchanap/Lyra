# Tokyo Rain Evidence — Regional Map Art Handoff

Companion docs: [design spec](../../superpowers/specs/2026-09-12-regional-city-maps-design.md) and [implementation plan](../../superpowers/plans/2026-09-12-regional-city-maps-implementation-plan.md).

This file owns the visual requirements, imported-art provenance, and review checklist for the Tokyo overview and five district backgrounds. It is **not** a story bible and **not** a second runtime location registry.

## 1. Runtime asset set

| Map | Asset ID | Runtime path | Planned story use |
| --- | --- | --- | --- |
| Tokyo overview | `background.city_map.tokyo` | `static/assets/backgrounds/city_map/tokyo.png` | Cross-district orientation + existing overview-direct destinations |
| Kichijoji | `background.city_map.kichijoji` | `static/assets/backgrounds/city_map/kichijoji.png` | Chapter 1 map presentation |
| Shibuya | `background.city_map.shibuya` | `static/assets/backgrounds/city_map/shibuya.png` | Chapter 2 design preparation / fixture |
| Shinjuku | `background.city_map.shinjuku` | `static/assets/backgrounds/city_map/shinjuku.png` | Chapter 4 exterior district preparation |
| Kabukicho | `background.city_map.kabukicho` | `static/assets/backgrounds/city_map/kabukicho.png` | Chapter 5 exterior district preparation |
| Ginza / Minato | `background.city_map.ginza_minato` | `static/assets/backgrounds/city_map/ginza_minato.png` | Chapter 3 compressed transport-area preparation |

The six runtime targets will be opaque 1920×1080 PNGs. The files currently committed under `docs/art/maps/generated/` are 1920×1080 JPEG review candidates. Runtime text, markers, status, and controls stay outside the raster.

## 2. Shared art direction

The approved direction is a grounded anime neo-noir Tokyo at rainy blue hour:

- elevated three-quarter city illustration;
- readable continuous streets/blocks rather than floating islands;
- cool slate/navy rain atmosphere;
- wet-road reflections;
- restrained cyan/violet neon;
- warm windows and street lamps used sparingly;
- enough real-world Tokyo character to make districts distinct without becoming GIS;
- edited composition so interactive landmarks remain readable under UI overlays.

Do **not** bake any of the following into runtime rasters:

- readable place names or shop text;
- chapter numbers;
- map pins, focus rings, route arrows, scale bars, or compass UI;
- evidence labels or mystery annotations;
- foreground dialogue characters;
- bodies or spoiler props;
- hidden-room cutaways or omniscient internal routes.

## 3. Imported generated art

The PR now includes a first complete **review-candidate** set under `docs/art/maps/generated/`. These files are intentionally review assets rather than runtime inputs; Task 0 converts/replaces the approved candidates into opaque 1920×1080 RGB PNGs under `static/assets/backgrounds/city_map/` before the topology is wired.

### Provenance

- `tokyo.jpg` is normalized from the generated standalone Tokyo overview illustration.
- `shibuya.jpg` is normalized from the generated standalone Shibuya district illustration.
- `kichijoji.jpg`, `shinjuku.jpg`, `kabukicho.jpg`, and `ginza_minato.jpg` are 16:9 regional extractions from the generated standalone Tokyo overview, **not** crops from a labeled concept-board UI.
- Every candidate is 1920×1080 and contains no added UI overlay from this processing step.
- These images exist in the PR so reviewers can evaluate visual identity before runtime integration. They are not yet release-approved art.

| Review candidate | SHA-256 |
| --- | --- |
| `docs/art/maps/generated/tokyo.jpg` | `78505ca3b2809827588465a433b276d7df83dc621cfdf7fe94536cc10aa15e6e` |
| `docs/art/maps/generated/kichijoji.jpg` | `db5a6b642c9606b3c82fda7fd4c4816c8a3ca5dacdf75e1b6533ceaef7007d66` |
| `docs/art/maps/generated/shibuya.jpg` | `590388ad1324575b1b9fcfd3c52faa65fc2b17e0bb0a44479a6bddaafa3b69fe` |
| `docs/art/maps/generated/shinjuku.jpg` | `a96474611c8dce0058a5e9d794ad42285e6e3cba5e1f72b5da54317d776f0731` |
| `docs/art/maps/generated/kabukicho.jpg` | `d8fa05e4bd5fdbdc875299705b83cd8d14bea07fd57c1d471f5aa4d1c5f1ea7e` |
| `docs/art/maps/generated/ginza_minato.jpg` | `8bded5ab7f7d9cbb6c6d153a5cd6943dd1f843adb9af8737520ba4a610e7114e` |

Do not point `city_map.json` at the review-candidate JPEGs. Runtime asset IDs continue to resolve to the PNG paths in Section 1 after Task 0 approval.

## 4. District composition contracts

### 4.1 Kichijoji

Visual identity: warm low-rise neighborhood, tree cover, shopping-street scale, station/rail presence. It should feel quieter and more lived-in than the other districts.

Production anchors in this PR:

- `rain_bell_cafe` — must be placed on a readable modest storefront/building cluster, not a giant landmark palace;
- `kichijoji_shopping_street` — must sit on a coherent pedestrian/commercial street separated enough from the cafe that the two buttons do not visually collapse.

Decorative station, park, convenience stores, alleys, and houses must **not** become Chapter 1 gameplay destinations merely because they are visible.

### 4.2 Shibuya

Visual identity: dense commercial city, huge screen/light presence, event plaza, surrounding work/commercial blocks.

Story boundary:

- the district map may communicate that the event occupies a real public area;
- it must not prove the hidden service route, M-03 connection, elevator path, vacant-floor murder space, or any sight-line conclusion;
- the glass-box event structure must be treated as a human-scale livestream booth in runtime annotation, even if the current candidate artwork needs later scale correction.

If the full-size review concludes the current candidate overstates the booth scale, regenerate/replace `shibuya.png` in this same PR before marking the PR ready.

### 4.3 Shinjuku

Visual identity: cooler, calmer urban-medical district set against a large Shinjuku skyline.

Do not infer ward/reception/records-room positions from the district art. The map is exterior context only and must not expose Aoba, memory-treatment internals, or left/right-route clues.

### 4.4 Kabukicho

Visual identity: theater/nightlife block with more red-violet accent than Shibuya, but still grounded rather than full-saturation cyberpunk.

The region may show a theater-like public frontage and ordinary back/service streets. It must not expose stage machinery, lift compartments, prop-room truth, body positions, the 90-second mechanism, or blue-umbrella evidence.

### 4.5 Ginza / Minato

Visual identity: ordered commercial avenue transitioning toward denser modern towers and waterfront/highway infrastructure.

The connection is an artistic city-compression device, not a canonical route. Do not add suspect arrows, timing labels, live vehicle positions, or evidentiary distance claims.

## 5. Coordinate and UI handoff

Do not copy marker coordinates from any generated concept board. After the v2 topology is implemented:

1. render each background in the real 16:9 map plane;
2. place destinations against the actual final raster;
3. measure normalized coordinates from visible entrances/landmarks;
4. test long labels at 1920×1080, 1280×720, and narrow width;
5. ensure markers do not overlap the objective/header area;
6. verify the same coordinates align after letterboxing/resizing;
7. keep every interactive point outside baked art.

## 6. Art review checklist

Before Draft PR #89 can become ready:

- [ ] open all six images individually at 100% size;
- [ ] verify RGB/opaque 1920×1080 metadata;
- [ ] verify no readable text or UI leaked into runtime art;
- [ ] verify no spoiler routes/interiors are visible;
- [ ] verify Kichijoji has enough separation for cafe + shopping street anchors;
- [ ] verify Shibuya glass-box scale against the Chapter 2 case contract;
- [ ] verify Shinjuku/Kabukicho read as different districts;
- [ ] verify Ginza/Minato does not imply a canonical evidentiary route;
- [ ] verify Tokyo overview and region maps feel like the same visual family;
- [ ] perform marker alignment review in the actual Tauri game;
- [ ] replace any candidate that fails the above without adding an asset-versioning subsystem.

The committed JPEG candidates are the reviewable first pass. “File exists in the PR” is not the same as “art approved for release.”
