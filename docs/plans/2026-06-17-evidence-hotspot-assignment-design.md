# Evidence Hotspot Assignment Editor Design

## Problem

Evidence can be authored and generated before its final scene hotspot is correct. Some
evidence should be invisible in the background image, while the scene hotspot should
represent only the physical or contextual trigger. Current runtime data supports multiple
`evidence:<id>` reveal targets on one hotspot, but the layout editor mainly exposes
layout and inspection, so fixing bad correlations requires manual Markdown edits.

## Decision

The editor should assign evidence to hotspots by updating the authored
`investigation_scene_*.md` `Reveals` lines. It should not edit generated resource JSON,
and it should not store evidence assignment in `.layout.json`, because the compiler
already treats hotspot `Reveals` as the source of truth.

## Editor Behavior

- Show a scene-level evidence assignment panel using existing generated evidence images.
- For each evidence item, show its current hotspot assignment and a hotspot selector.
- Allow assigning, moving, or detaching an evidence item.
- Preserve multiple evidence items on a single hotspot by appending `evidence:<id>` to
  the same hotspot `Reveals` line.
- Keep right-click hotspot menus focused on inspecting the evidence already correlated
  to that hotspot.

## File Write Boundary

- Keep `write_project_file` restricted to `*.layout.json`.
- Add a separate `write_story_scene_file` command restricted to authored
  `docs/stories_plan/chapter_*/investigation_scene_*.md` and
  `static/stories_plan/chapter_*/investigation_scene_*.md`.
- Add a `resolve_story_scene_path` command so the editor can map generated scene JSON
  back to its authored Markdown owner.

## Markdown Patch Rules

- Remove the selected `evidence:<id>` from every hotspot before assigning it to the new
  hotspot, so a single evidence item does not accidentally remain correlated to multiple
  triggers.
- Preserve non-evidence reveal targets such as `topic:<id>`.
- Preserve other evidence reveals on the same hotspot.
- Add a `Reveals` line to the target hotspot when it has none.
- Remove an empty `Reveals` line after detaching or moving an evidence item.

## Chapter 1 Backfill

The current Chapter 1 authored scenes should be treated as the initial backfill target.
Assignments should be based on written content first, not heuristic filename matching.
After editing, compile and audit the scenes to confirm every Chapter 1 evidence item is
hotspot-backed.

## Verification

- Unit test Markdown patching, including move, detach, no-existing-`Reveals`, and
  multiple evidence on one hotspot.
- Unit test the Svelte assignment panel.
- Unit test Rust path restrictions for the new Markdown writer.
- Run `bun run scenes:compile`, `bun run evidence-sources:audit`, layout-editor tests,
  and `bun run check`.
