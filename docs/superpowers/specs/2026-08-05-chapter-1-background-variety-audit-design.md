# HPA-561 Chapter 1 Background Variety Audit Design

## Status

Approved HPA-561 companion design, refreshed for the merged HPA-259 baseline.

This workstream improves background variety for the **production Chapter 1 manifest that exists when the audit runs**. It does not hard-code the historical three-scene-type world and it does not create visual work for synthetic analysis fixtures.

## Goal

Make Chapter 1 feel visually less repetitive by introducing purposeful background variants where they improve spatial understanding, investigation readability, dramatic emphasis, or meaningful state change, while preserving continuity and avoiding wholesale regeneration.

## Post-HPA-259 baseline

The compiler now supports four scene types and HPA-259 already enriches analysis-scene dialogue assets.

Production Chapter 1 still currently lists `scene_8_5.md`, not `analysis_scene_8_5.md`. HPA-265 may replace that transition later.

Therefore the audit is **manifest-driven**:

1. read `docs/stories_plan/chapter_1/chapter.md` at audit start;
2. freeze the listed production scene files into the audit report;
3. inspect every player-visible background cue in those files;
4. if a production `analysis_scene_*.md` is present, include its scene-tag cues automatically.

Synthetic HPA-259 fixtures are never treated as Chapter 1 production assets.

## In scope

For every manifest-listed scene, inspect player-visible background cues from:

- linear `[場景：...]` tags;
- investigation sub-locations and dialogue scene tags;
- interrogation phases and dialogue scene tags;
- analysis Intro, board Result Dialogue, and Outro scene tags when a production analysis scene is manifest-listed.

Also inspect the corresponding generated asset IDs and actual PNGs under `static/assets/backgrounds/chapter_1/`.

## Out of scope

- evidence icons;
- portraits;
- runtime camera animation, zoom, pan, parallax, or transition effects;
- generic image-similarity scoring;
- automatic background-count targets;
- synthetic analysis fixtures;
- Chapter 2 or later assets;
- wholesale Chapter 1 regeneration.

## Design principle: variety must have a job

A new or regenerated background is justified only when it improves at least one concrete function:

- **orientation** — establish a room, route, entrance, or relationship between spaces;
- **investigation readability** — make hotspots, standee placement, or source areas understandable;
- **evidence focus** — emphasize a case-significant object/area without fabricating unreadable text;
- **pressure** — visually support confrontation, hearing, or revelation;
- **reasoning state** — support a materially different analytical or procedural beat;
- **aftermath/state** — show a meaningful time, weather, occupancy, lighting, or post-incident change.

A background does **not** deserve a variant merely because it has remained on screen for several dialogue lines.

## Continuity anchors

Variants of the same location family must preserve the stable facts players rely on:

- entrances/exits;
- window positions;
- fixed furniture;
- room geometry;
- corridor direction;
- case-significant props;
- signature palette/materials;
- believable adjacency between sub-locations.

Camera angle, distance, focal emphasis, light state, foreground crop, and weather may change when the narrative function changes.

## Audit record

Create `docs/stories_plan/chapter_1/background-variety-audit.md` and record the manifest snapshot plus one row per cue:

| Field | Meaning |
|---|---|
| Scene/source | authored file and cue line/block |
| Asset ID/path | compiled background identity |
| Location family | recurring physical space |
| Current function | orientation/dialogue/investigation/etc. |
| Continuity anchors | facts that must remain stable |
| Variety finding | why current composition is sufficient or repetitive |
| Decision | `keep`, `prompt-adjust`, `regenerate`, `add-variant` |
| Priority | `A` or `B` |
| Proposed function | required narrative/spatial delta |
| Disposition | implemented/deferred/accepted |

Priority A affects comprehension, investigation usability, evidence focus, major reveal/confrontation emphasis, meaningful state change, or canon/continuity. Priority B is serviceable cosmetic polish and remains documented only.

## Skill/review changes

- Base dialogue skill: background function, camera angle/distance, focal area, continuity anchors, lighting/weather/occupancy, UI-safe lower composition.
- Investigation skill: sibling sub-locations distinct but spatially coherent and standee/hotspot safe.
- Interrogation skill: new phase variant only when visible environmental/dramatic state materially changes.
- HPA-552 remains owner of the analysis authoring skill; production analysis scenes inherit base background rules.
- Axis 5 order remains completeness -> compiled/file existence -> spatial usability -> continuity -> purposeful variety -> same-view false-positive control.
- Image generation must inspect sibling same-location assets and document continuity anchors plus intended delta before generating a variant.

## Verification

- Every background-bearing production manifest scene is covered regardless of scene type.
- Production analysis scene tags are included automatically if present; synthetic HPA-259 fixtures are excluded.
- Every cue gets one explicit decision and priority.
- Every Priority A item is implemented or explicitly accepted with evidence; Priority B stays documented.
- Before/after location-family review demonstrates continuity and meaningful variation.
- At least one uninterrupted same-view scene remains `keep` to prove no image-count quota.
- `bun run scenes:compile` and `bun run format:check` pass.
- Touched backgrounds are opaque `1920x1080` PNGs.
