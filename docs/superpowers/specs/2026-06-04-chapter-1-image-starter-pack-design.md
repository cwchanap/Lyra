# Chapter 1 Image Starter Pack Design

**Date:** 2026-06-04
**Status:** Approved scope, awaiting implementation plan
**Related spec:** `docs/superpowers/specs/2026-05-30-story-asset-pipeline-design.md`

## Goal

Create the first small playable image asset pack for Chapter 1 of
《東京雨證：第零證人》. The pack should prove the existing story asset pipeline with
real backgrounds, character portraits, and evidence icons before generating a
complete chapter-wide asset set.

The starter pack covers the opening case loop only:

- `docs/stories_plan/chapter_1/scene_0.md`
- `docs/stories_plan/chapter_1/investigation_scene_1.md`
- `docs/stories_plan/chapter_1/scene_2.md`
- `docs/stories_plan/chapter_1/investigation_scene_3.md`

## Visual Direction

Use a grounded anime neo-noir visual novel style:

- stylized Tokyo interiors and rainy street atmosphere
- cinematic but restrained lighting
- muted, varied color with no saturated one-note palette
- serious adult anime character designs, no chibi or comedy exaggeration
- no baked-in readable UI or document text in generated images
- no watermarks, logos, subtitles, or decorative text

Text described by the story, such as KAGAMI summaries, document contents,
labels, or time values, should be represented by layout, glow, paper shapes,
or unreadable small marks only. Player-readable text remains in the game UI and
authored Traditional Chinese scene content.

## Asset Scope

### Backgrounds

Generate 16:9 background plates for the selected slice. The required starter
set is nine plates. Do not add additional backgrounds in this first pack unless
the implementation plan is revised first.

1. KAGAMI summary cold-open interface, black and cold-white, abstracted with no
   readable text.
2. Police meeting-room corridor with a wall monitor showing an unreadable
   summary layout.
3. Somai detective office interior, small, paper-stacked, broken coffee machine.
4. Hayasaka law office, rainy morning, case summary and thermos on the table.
5. Review-board entry window, narrow corridor and metal door.
6. Review-board exterior hallway, wet city light through long windows.
7. Rain Bell cafe front room at rainy night after closing.
8. Rain Bell back corridor, narrow L-shaped sightline clue.
9. Rain Bell inner storage entrance, high shelves and dark sightline occlusion.

The original scope of this pack limited background cues to sub-locations
inside investigation scenes (and the equivalent structural blocks in
linear/interrogation scenes); the Somai office exterior intro was expected
to remain text-only. That limit was lifted in the follow-up commit
`feat(assets): intro scene-tag backgrounds and side-aware portraits`, which
extended the parsers (linear, investigation, interrogation) to accept
`Background Prompt` / `BGM` / `BGS` metadata immediately after intro
`[場景：...]` scene tags. As a result, the shipped starter pack also
includes three intro plates that are not in the original nine-item list
above:

10. Somai detective office exterior, early-morning drizzle
    (`investigation_scene_1` intro).
11. Late-night police-station waiting area (`interrogation_scene_4` intro).
12. KAGAMI evidence-summary review hearing room in daylight
    (`interrogation_scene_10` intro).

Future packs should treat intro-scene-tag backgrounds as a supported
authoring surface, not as out-of-scope text.

### Portraits

Generate transparent portrait PNGs for the speakers needed by the selected
slice:

- 相馬律
- 早坂茜
- 三宅母親
- 書記官
- 店長高瀨
- 片瀨

Each portrait character requires a `standard` expression. The first pass may
add one extra expression only where the selected scenes strongly need it:

- 早坂茜: `stern`
- 三宅母親: `strained`
- 店長高瀨: `tired`

Portrait prompts should come from `docs/stories_plan/characters.md` and must not
introduce hidden-story details.

### Evidence Icons

Generate isolated evidence icons for the evidence collected in the selected
slice:

- `kagami_summary`
- `two_coffee_order`
- `cctv_screenshot`
- `timecard_record`
- `doorlock_summary_timetable`
- `closing_routine`
- `backroom_floorplan`

Evidence icons should be readable as object silhouettes at small UI sizes while
avoiding baked-in readable text. Use paper forms, screen thumbnails, cup
sleeves, whiteboards, and simple floor-plan geometry as visual cues.

### Audio

No generated audio in this starter pack. `static/assets/config/audio.yaml` can
remain empty unless scene metadata requires explicit `none` for the first
visual unit after assets are enabled.

## Pipeline Changes

Implementation should use the existing asset contract:

- `static/assets/config/policy.yaml` becomes the policy source of truth.
- `static/assets/config/characters.yaml` maps selected dialogue speakers to
  stable portrait IDs and expression prompts.
- Scene Markdown receives `Background Prompt`, `BGM`, `BGS`, and evidence
  `Image Prompt` metadata only for the selected opening-loop files.
- Generated PNG files are saved under:
  - `static/assets/backgrounds/...`
  - `static/assets/portraits/...`
  - `static/assets/evidence/...`
- `src-tauri/resources/scenes/` and `src-tauri/resources/assets/` remain
  generated compiler output and should not be hand-edited or committed except
  for existing `.gitkeep` files.

Logical asset IDs should follow the compiler's existing derived-ID convention.
Do not author filesystem paths in scene Markdown.

## Error Handling

The compiler remains the source of truth for missing or malformed asset
metadata. If asset mode exposes required metadata gaps outside the selected
slice, implementation should use one of these two explicit paths:

- add minimal metadata for affected live Chapter 1 visual units, or
- keep the first implementation in a safe incremental shape that does not make
  unrelated chapter files fail compilation.

Do not weaken slug validation, speaker validation, or missing-file warnings to
force this pack through.

## Verification

Minimum verification for the implementation:

- `bun run scenes:compile`
- focused compile-script tests if parser, asset config, or enrichment code is
  changed
- `bun run check` if frontend or Svelte-facing asset behavior changes

Before claiming the playable starter pack is complete, inspect that each
generated asset file exists in the expected public `static/assets` path and
that the compiler report references the intended background, portrait, and
evidence IDs.
