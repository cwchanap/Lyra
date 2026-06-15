# Evidence Source Asset Workflow Design

**Date:** 2026-06-14
**Status:** Approved design
**Related specs:**
- `docs/superpowers/specs/2026-05-13-investigation-scene-skill-design.md`
- `docs/superpowers/specs/2026-05-30-story-asset-pipeline-design.md`
- `docs/superpowers/specs/2026-06-06-investigation-scene-layout-editor-design.md`

## Goal

Investigation scenes need to distinguish the thing the player clicks in the
scene from the evidence image that appears after collection. Some evidence is
physically visible in the investigation background, some is implied by a visible
source such as a monitor, and some should not be visible in the background at
all.

The workflow should make that distinction explicit, compiler-checked, useful to
asset generation, and visible in the layout editor. Manual adjustment in the
editor remains a fallback for visual placement, not the primary way to express
story or asset semantics.

## Problem

The current asset contract gives evidence one `Image Prompt`, which describes
the collected inventory icon. Investigation hotspots can reveal evidence, and
layout data can place a clickable rectangle over the background, but there is no
field that says whether the evidence source itself should appear in the scene
background.

This causes three common mismatches:

- A visible source and collected evidence look different. Example: `閉店監視器回放`
  can be clicked through a small in-scene monitor, but the collected evidence is
  a CCTV still or playback record icon.
- The collected evidence should be hidden from the background. Example:
  `三宅打卡紀錄` should not necessarily draw a readable timecard or shift table in
  the cafe background.
- The evidence is a real document in the scene, but its inventory art still
  needs a clean square icon. Example: `KAGAMI 摘要副本` can be a visible desk
  document while the collected image stays an isolated evidence icon.

## Decisions

- Add evidence-source metadata to investigation hotspots, not evidence manifest
  entries.
- Keep evidence manifest `Image Prompt` focused on collected inventory art.
- Use evidence-source metadata to enrich sub-location background manifest
  prompts.
- Add an audit workflow that finds missing or suspicious source metadata in
  existing investigation scenes.
- Include layout editor support in v1 so reviewers can see whether a hotspot is
  visible, implied, or hidden while placing targets.
- Do not add a new scene-prop asset type in this iteration.

## Authoring Contract

Investigation hotspots gain two metadata fields for evidence-source semantics:

```markdown
- **Evidence Source:** visible | implied | hidden
- **Scene Source Prompt:** optional English prompt
```

`Evidence Source` describes the relationship between the clicked scene hotspot
and the evidence item collected by that hotspot.

`visible` means the evidence source should be visible in the sub-location
background. The source may still be visually different from the inventory icon.
Example: a printed KAGAMI summary lies on the desk, while
`evidence:kagami_summary` uses a square document icon after collection.

`implied` means the hotspot source is visible, but the collected evidence is not
literally shown in that form. Example: a small monitor on the counter can reveal
`evidence:cctv_screenshot`, but the background should not draw the final CCTV
still as a readable image.

`hidden` means the evidence should not be visible in the background. The hotspot
may represent a lookup, deduction, off-screen record, dialogue-triggered
discovery, or other abstract investigative action. Example:
`evidence:timecard_record` can be collected from a hotspot without requiring a
readable timecard table in the cafe background.

`Scene Source Prompt` describes only the in-scene source. It is useful when the
hotspot label and description are not enough for background generation. It is
not a filesystem path and does not replace the evidence `Image Prompt`.
Like existing scene metadata, the value is authored on one metadata line.

Example:

```markdown
### Hotspot: 閉店監視器回放 {#cctv_playback}
- **Description:** 收銀台旁的小螢幕還能調出閉店前的監視器畫面。
- **Reveals:** [evidence:cctv_screenshot]
- **Evidence Source:** implied
- **Scene Source Prompt:** Small security monitor beside the register, powered on but not showing a readable final screenshot.
```

## Compiler Contract

The investigation parser adds these fields to `ASTHotspot`:

```ts
evidenceSource: "visible" | "implied" | "hidden" | null;
sceneSourcePrompt: string | null;
```

When `assets.enabled` is true, validation requires every hotspot that reveals
one or more evidence items to declare `Evidence Source`. The compiler accepts
the same fields when assets are disabled so current content can be migrated
incrementally, but disabled assets do not require the new field.

Validation rules:

- `Evidence Source` must be one of `visible`, `implied`, or `hidden`.
- A hotspot that reveals evidence must declare `Evidence Source` when assets are
  enabled.
- `Scene Source Prompt` is allowed only when `Evidence Source` is present.
- `Scene Source Prompt` is recommended for `visible` or `implied` sources when
  the hotspot description does not give enough visual guidance.
- `hidden` sources normally omit `Scene Source Prompt`; if present, it describes
  the non-visible action or access point, not a visible evidence prop.
- Hotspots without evidence reveals may not use `Evidence Source`.

The emitted runtime JSON may include `evidenceSource` and `sceneSourcePrompt` on
hotspots for editor/debug visibility. Gameplay does not require new behavior;
Rust remains authoritative for collection and unlock state.

## Asset Manifest Behavior

The asset enrichment pass keeps the existing stable logical asset IDs:

- evidence inventory art stays `evidence.<id>`;
- sub-location backgrounds keep their existing `background.chapter_...` IDs.

The generated background manifest entry gains an additional prompt section built
from hotspot source metadata in that sub-location.

For `visible` sources, the background prompt guidance should include the source
object or source area. If `Scene Source Prompt` is present, use it; otherwise
derive a compact line from the hotspot label and description.

For `implied` sources, the prompt guidance should include the visible access
point or environmental source while explicitly avoiding the collected evidence
image or readable evidence content.

For `hidden` sources, the prompt guidance should add a negative constraint so
the collected evidence or source record is not visible in the background.

Example background guidance for `investigation_scene_3` front room:

```text
Investigation source guidance:
- implied: cctv_playback. Show a small counter security monitor; do not show
  the final CCTV screenshot or readable playback content.
- hidden: timecard. Do not show Miyake's timecard record, readable shift table,
  or the collected timecard evidence in the room.
```

Prompt enrichment changes the expected background art direction, not the
background asset identity. When guidance changes for an existing background,
the background should be regenerated or reviewed like any other prompt change.

## Audit And Migration Workflow

Add an audit script exposed through a root package script, for example:

```sh
bun run evidence-sources:audit
```

The script scans playable investigation scenes under the configured story
source roots and reports every hotspot that reveals evidence.

Each report item includes:

- scene file, sub-location ID, hotspot ID, and hotspot label;
- revealed evidence IDs and names;
- current `Evidence Source` value;
- current `Scene Source Prompt`, if any;
- hotspot description;
- evidence `Image Prompt`;
- sub-location `Background Prompt`;
- suggested source classification.

The first version should use conservative heuristics:

- labels or descriptions containing `監視器`, `回放`, `螢幕`, `monitor`, or
  `screen` suggest `implied`;
- labels or descriptions containing `打卡`, `紀錄`, `資料`, `系統`, or `查詢`
  suggest `hidden` unless the wording clearly describes a physical document;
- labels or descriptions containing `副本`, `列印`, `文件`, `傘`, `盒`, or `白板`
  suggest `visible`;
- ambiguous cases report `needs-review`.

The audit command is allowed to have a later `--write` mode, but automatic
rewrites must be conservative. The initial migration should explicitly update
high-value Chapter 1 cases, including:

- `investigation_scene_1` `kagami_summary_hotspot` -> `visible`;
- `investigation_scene_3` `cctv_playback` -> `implied`;
- `investigation_scene_3` `timecard` -> `hidden`.

## Layout Editor Behavior

The layout editor should surface the new source classification while keeping
Markdown as the source of story semantics.

Editor changes in scope:

- Show a compact source badge on each hotspot target: `visible`, `implied`, or
  `hidden`.
- Show missing source metadata as an attention state for hotspots that reveal
  evidence.
- Stop assuming that a revealed evidence image is always the hotspot preview.
- For `visible` evidence sources, the editor may keep showing the evidence icon
  as a placement hint when no better source preview exists.
- For `implied` sources, show a neutral monitor/source marker or label instead
  of the collected evidence image.
- For `hidden` sources, show only the placement box/label and no evidence image
  preview.
- Include the source classification in the hotspot detail text so reviewers can
  catch mismatches during placement.

The editor should not write `Evidence Source` or `Scene Source Prompt` in v1.
It reads compiled scene JSON and writes layout sidecars only. If reviewers find
wrong source classifications, they fix the authored investigation Markdown and
re-run `bun run scenes:compile`.

## Runtime And UI

Gameplay behavior stays unchanged. The player does not see source badges or
prompt metadata.

The player-facing improvement comes from regenerated backgrounds that include,
imply, or exclude evidence sources correctly, plus existing inventory evidence
icons that remain separate square assets.

If runtime JSON includes source metadata, the game frontend should tolerate it
without adding gameplay logic. Production UI does not need to render it.

## Error Handling

Compiler errors should name the scene file, hotspot ID, and offending field.

Examples:

- `hotspotEvidenceSourceMissing`: a hotspot reveals evidence while assets are
  enabled but lacks `Evidence Source`.
- `hotspotEvidenceSourceInvalid`: an unknown source value was used.
- `hotspotSceneSourcePromptWithoutSource`: `Scene Source Prompt` was declared
  without `Evidence Source`.
- `hotspotEvidenceSourceWithoutEvidenceReveal`: `Evidence Source` was declared
  on a hotspot that does not reveal evidence.

The audit script should not fail the compile by itself. It reports migration
work and can be used in CI later after the live corpus is fully migrated.

## Testing And Verification

Focused implementation verification should include:

- parser tests for valid `visible`, `implied`, and `hidden` hotspot metadata;
- parser or validator tests for invalid source values and disallowed field
  combinations;
- asset enrichment tests proving sub-location background manifest prompts
  include source guidance and hidden-source negative constraints;
- audit script fixture tests for suggested classifications and missing metadata;
- layout editor component tests for source badges and preview behavior;
- migration updates for Chapter 1 scene 1 and scene 3;
- `bun run scenes:compile`;
- focused Vitest tests for touched compiler/editor files;
- `bun run check` before claiming frontend or editor work complete.

## Non-Goals

- Adding a `sceneProp` asset type.
- Compositing separate clue props into backgrounds.
- Generating or editing raster images as part of this contract change.
- Letting writers author filesystem paths.
- Letting the layout editor become the source of evidence-source semantics.
- Changing investigation collection, reveal, or unlock gameplay behavior.
