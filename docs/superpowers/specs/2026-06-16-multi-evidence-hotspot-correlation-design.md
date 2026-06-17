# Multi-Evidence Hotspot Correlation Design

**Date:** 2026-06-16
**Status:** Approved design
**Related spec:** `docs/superpowers/specs/2026-06-14-evidence-source-asset-workflow-design.md`

## Goal

Make the layout editor show the full evidence correlation for investigation
hotspots that reveal more than one evidence item, and teach writing agents to
use the existing `Reveals` list as the source of truth for that correlation.

## Decision

Do not add a second correlation field. A hotspot already owns its evidence
correlation through:

```markdown
- **Reveals:** [evidence:first_item, evidence:second_item]
```

This remains the canonical story and runtime contract. Adding another field
would duplicate the relationship and create drift between authored content,
compiler validation, runtime collection, and editor review.

## Editor Behavior

The layout editor should derive a hotspot's correlated evidence from every
`evidence:` target in its `Reveals` list.

For `visible` evidence-source hotspots, the editor should show all available
collected evidence thumbnails in a compact preview stack or grid. It should not
collapse the preview to the first evidence image.

For `implied`, `hidden`, and missing-source evidence hotspots, the editor should
not render collected evidence thumbnails, but it should still expose the
correlation through count/name chips and the hotspot control title. This lets a
reviewer see which evidence items are tied to the placement rectangle without
implying those collected images should be visible in the background.

## Writer Guidance

Writing agents should place multiple evidence IDs in a single hotspot's
`Reveals` list when those evidence items are discovered through the same player
inspection and share the same scene-source treatment.

The order in `Reveals` is meaningful: the hotspot inspect dialogue plays first,
then each evidence item's `On Collect` dialogue plays in listed order.

Because `Evidence Source` and `Scene Source Prompt` are currently hotspot-level
metadata, evidence items that need different source visibility should be split
into separate hotspots.

## Runtime Compatibility

No Rust gameplay change is required. The runtime already iterates the full
hotspot `reveals` array, adds each new evidence item to inventory, and appends
each item's collection dialogue in order. This design adds an explicit
regression test for that behavior so the editor guidance is backed by runtime
coverage.
