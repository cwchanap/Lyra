---
name: auditing-investigation-evidence-sources
description: Use when auditing or fixing investigation_scene_<N>.md evidence carriers directly in authored Markdown, especially evidence-to-hotspot, evidence-to-topic, or layout-editor/generated-JSON drift.
---

# Auditing Investigation Evidence Sources

## Role

Audit and edit authored `investigation_scene_<N>.md` files so each evidence
item is revealed by the correct hotspot, topic, or local source carrier. Do not
edit generated JSON, and never hand-edit `apps/game/src-tauri/resources`.

## Required Source Loading

Before auditing, load:

- The target `investigation_scene_<N>.md`.
- Its `.layout.json` sidecar when present.
- The actual raster background image for each audited sub-location when it
  exists under `static/assets/backgrounds/...`.
- The current compiled JSON when available, for comparison only.
- `writing-investigation-scene`.

Authored Markdown is the source of truth. Layout sidecars and compiled JSON are
diagnostics for finding drift, not write targets. Raster backgrounds are
required evidence for visual hotspot placement.

## Carrier Table

Before editing, produce this table:

| Evidence ID | Evidence Name | Source Sublocation | Current Carrier | Proposed Carrier | Player Collection Affordance | Visual Background Fit | Source Type | Action |
|---|---|---|---|---|---|---|---|---|

Use these `Action` values:

- `keep`
- `move reveal`
- `create hotspot`
- `merge into multi-evidence hotspot`
- `split hotspot`
- `remove invalid source metadata`
- `layout sidecar drift`
- `visual hotspot drift`
- `needs human story decision`

Edit only rows with a justified action. For ambiguous story decisions, set
`Action` to `needs human story decision` and leave the Markdown unchanged unless
the fix is purely mechanical.

## Player Collection Affordance Gate

For every row, answer: what exactly does the player click, select, or inspect
in this sub-location to collect the evidence?

`keep` is allowed only when all are true:

- The carrier is in the evidence item's `Source Sublocation`.
- The player-facing carrier label names a concrete local object, area, person
  topic, or action, not only the final evidence name.
- The body dialogue explains why that interaction yields the evidence.
- The `Evidence Source` treatment matches the background:
  - `visible` when the player clicks a visible source object or visible source
    area in the scene. Use `visible` even when the final evidence icon/text is
    not readable or is produced after inspection, as long as the local click
    target itself is visible.
  - `implied` only for rare derived evidence where the player is using a local
    spatial/action carrier rather than a clear visible source object or area.
    Do not use `implied` merely because the collected evidence image differs
    from the background prop.
  - `hidden` when the source is not visible until a local action/device lookup.
- A multi-evidence hotspot uses one shared inspection/action, one shared source
  sub-location, and one shared source treatment for every evidence item.
- If the carrier is a hotspot that should be clickable in the scene image:
  - the sidecar has matching geometry, or the row is marked
    `layout sidecar drift`;
  - the geometry sits on the visible source object/area in the actual raster
    background, or the row is marked `visual hotspot drift`.

If a carrier label names the inventory item instead of the local click target,
rename the carrier to the source/action while preserving the evidence ID and
evidence name. For hidden sources, label the affordance as a concrete local
action or device lookup, such as a phone lookup or admin terminal check, rather
than a physical document that is not present in the background.

Never approve a hidden or implied source by placing its hotspot rectangle on
unrelated background pixels. If the background has no defensible visual
affordance, move the reveal to a visible proxy carrier, a person topic, or a
sub-location entry reveal, or mark `needs human story decision`.

## Source Type Taxonomy

These are audit-table-only `Source Type` labels. Do not write them into
Markdown. Markdown `Evidence Source` stays `visible`, `implied`, or `hidden`
only.

| Source Type | Use For |
|---|---|
| `physical-hotspot` | Player inspects a visible in-scene source object. |
| `implied-hotspot` | Player inspects a local object or area; the final evidence content is derived. |
| `hidden-hotspot` | Player uncovers non-visible evidence from a local action or device. |
| `person-topic` | A character provides the evidence through a specific topic. |
| `spatial-replay` | Player stands at, traces, or reconstructs a local route or sightline. |
| `document-packet` | One packet, table, admin area, or record set intentionally yields multiple evidence items. |
| `navigation-only` | Hotspot unlocks space or context only and must not carry evidence metadata. |

## Markdown Edit Rules

- Move reveals in Markdown only. Do not patch layout sidecars or compiled JSON
  to create semantic truth.
- Layout sidecars may be patched only to add or correct geometry for a carrier
  that already exists in authored Markdown. Mark this as `layout sidecar drift`
  in the carrier table; never use a sidecar edit to invent evidence semantics.
- Raster visual drift may be fixed by moving a sidecar rectangle onto the
  authored carrier's actual visible object/area. If no such visible object
  exists, change the authored carrier instead of moving the rectangle to a
  random nearby area.
- Preserve same-source-sublocation: every evidence reveal must come from a
  hotspot, topic, or sub-location in that evidence item's `Source Sublocation`.
- Put person-sourced evidence on the exact `#### Topic:` where the person gives
  the information.
- Put route, sightline, and reenactment-derived evidence on a meaningful local
  spatial hotspot, usually with `Evidence Source: implied`.
- Use `evidence_source_<evidence_id>` only for unavoidable hidden standalones
  when no meaningful physical hotspot, topic, document packet, or spatial
  carrier exists.
- Remove `Evidence Source` and `Scene Source Prompt` from non-evidence hotspots.
  Those fields are valid only on hotspots whose `Reveals:` include at least one
  `[evidence:...]` target.
- Keep multi-evidence hotspots only when every evidence item shares the same
  player inspection, source sub-location, and source treatment.
- Prefer a meaningful Traditional Chinese hotspot label over generic source
  labels whenever creating or renaming a carrier.
- Never hand-edit `apps/game/src-tauri/resources`.

## Verification

After editing authored Markdown, run:

```bash
bun run scenes:compile
bun run evidence-sources:audit
```

Then review the affected Markdown diff for story intent, same-sublocation
placement, and accidental generated-resource edits. Treat
`bun run evidence-sources:audit` as mostly a hotspot metadata diagnostic.
Topic and sub-location carrier choices still require the manual carrier table
and Markdown diff review.
