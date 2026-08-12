# HPA-123 Chapter 1 Hotspot Overlap Fix Design

## Status

Planning only. HPA-123 is intentionally a content-geometry fix, not an investigation-platform change.

## Why this is next

HPA-123 is a High-priority Chapter 1 blocker in `Todo` with no blockers. HPA-265 is also High priority, but Linear still blocks it on HPA-262 and HPA-264. Fixing the click-stealing hotspots is therefore the smallest fully actionable Chapter 1 correctness slice.

## Current problem

Five hotspot pairs share pointer-active interior area:

| Scene / sublocation | Broad target to change | Protected target |
| --- | --- | --- |
| `investigation_scene_1 / office` | `old_request_slips` | `kagami_summary_hotspot` |
| `investigation_scene_1 / office` | `old_request_slips` | `canned_coffee` |
| `investigation_scene_7 / inner` | `takase_replay` | `miyake_replay` |
| `investigation_scene_7 / inner` | `takase_replay` | `bean_can` |
| `investigation_scene_7 / back_door` | `fire_door_7` | `floor_water` |

`InvestigationSceneSurface.svelte` renders placed hotspots as native buttons in one coordinate plane. Shared geometry therefore creates a real pointer ambiguity; changing DOM order would only decide which action steals the shared area, not remove the bug.

The current sidecars also list these pairs in `intentionalOverlaps`:

- `docs/stories_plan/chapter_1/investigation_scene_1.layout.json`
- `docs/stories_plan/chapter_1/investigation_scene_7.layout.json`

Those opt-outs no longer describe intentional design and should disappear with the geometry fix.

## Validator caveat

`detectLayoutOverlaps()` is deliberately high-signal: it warns only when overlap covers at least 80% of the smaller rectangle, and it skips declared `intentionalOverlaps`.

So `bun run scenes:compile` returning `Layout warnings (0)` is necessary but not sufficient for HPA-123. The implementation will also run one exact, non-committed rectangle-intersection check for the five named pairs.

No new validator rule is added. If repeated low-percentage overlap bugs later justify a stricter project-wide policy, that should be a separate ticket based on playtest evidence.

## Approaches

### A. Fix the authored rectangles — selected

Use the existing layout editor against the real scene backgrounds. Change only:

- `old_request_slips`;
- `takase_replay`;
- `fire_door_7`.

Then remove the corresponding `intentionalOverlaps` entries.

This is the smallest fix and exactly matches the approved HPA-123 decision.

### B. Runtime hit-test arbitration — rejected

A priority rule based on size, evidence importance, DOM order, or z-index would create hidden runtime semantics for a content bug and require new tests/guidance.

### C. New replay/overlay hotspot kind — rejected

A new schema/runtime/editor concept would be much larger than three authored rectangle corrections and would pre-design a feature Chapter 1 has not asked for.

## Design

### Protected geometry stays fixed

Do not move these targets:

- `kagami_summary_hotspot`;
- `canned_coffee`;
- `miyake_replay`;
- `bean_can`;
- `floor_water`.

The broad competing targets are the problem. In particular, do not move `bean_can` or `floor_water` away from their visual evidence just to preserve a replay/navigation hitbox.

### Scene 1 / office

Resize or reposition `old_request_slips` so it still covers the visible paper stack and has zero interior intersection with both `kagami_summary_hotspot` and `canned_coffee`.

Remove both `office.intentionalOverlaps` entries afterward. If none remain, omit the property.

### Scene 7 / inner

Resize or reposition `takase_replay` so it still represents Takase's replay route/position and has zero interior intersection with both `miyake_replay` and `bean_can`.

Remove both `inner.intentionalOverlaps` entries afterward.

### Scene 7 / back_door

Shorten or reposition `fire_door_7` so it remains on the visible half-open fire door but has zero interior intersection with `floor_water`.

Remove the `back_door.intentionalOverlaps` entry afterward.

### Geometry acceptance

For the five named pairs:

> normalized rectangles must have zero shared interior area.

Edge contact is safe, although a small visual gutter is preferable when it still matches the art. No global gutter constant is introduced.

Replacement numeric coordinates are deliberately not invented in this design document. They are authored visual data and should be produced in the existing layout editor against the real backgrounds.

## Verification

1. **RED baseline:** a one-off Bun rectangle check reports all five current intersections.
2. **GREEN geometry:** after editing, the same check reports zero intersections.
3. **Compiler:** `bun run scenes:compile` succeeds with `Layout warnings (0)`.
4. **Real pointer smoke:** every affected hotspot activates from its intended visual object; `bean_can` and `floor_water` cannot enter a replay beat or another sublocation.
5. **Keyboard smoke:** existing native-button labels and activation still work; no Markdown labels, IDs, or renderer markup change.
6. **Scope diff:** production implementation touches only the two layout sidecars.

## Risks

- **Target becomes too small:** use the existing editor over the real art; do not satisfy the geometry check by collapsing a rectangle.
- **Target drifts off the object:** visual alignment is part of acceptance, not just mathematical disjointness.
- **Editor preserves stale opt-outs:** remove `intentionalOverlaps` explicitly after saving; the editor intentionally round-trips them.
- **Compiler gives false confidence:** the exact five-pair check is mandatory because the compiler's 80% warning threshold is not an exact collision test.

## Non-goals

- renderer arbitration or z-index changes;
- a new hotspot kind;
- a new compiler diagnostic or warning threshold;
- broad Chapter 1 layout cleanup;
- investigation Markdown/story changes;
- asset regeneration.

## Expected production diff

Only:

- `docs/stories_plan/chapter_1/investigation_scene_1.layout.json`
- `docs/stories_plan/chapter_1/investigation_scene_7.layout.json`

HPA-123 is complete when the five pairs are disjoint, the stale overlap opt-outs are gone, the protected targets are unchanged, the real pointer/keyboard smoke passes, and no runtime/schema/compiler abstraction is introduced.
