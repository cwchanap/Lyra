# HPA-123 Chapter 1 Hotspot Overlap Fix Design

## Status

Planning only. This design intentionally limits HPA-123 to authored Chapter 1 investigation geometry. It does not change the investigation renderer, scene schema, hit-testing rules, or story content.

## Why this is the next actionable task

HPA-123 is a High-priority Chapter 1 correctness blocker in `Todo` with no blockers. The next major Chapter 1 content ticket, HPA-265, is still formally blocked by HPA-262 and HPA-264, so it is not the next fully actionable slice.

The fix also matches the current Chapter 1-first delivery policy: remove a player-facing soft-block before adding more first-version content, and do it without creating platform work that the real game has not asked for.

## Problem

Five pairs of placed investigation hotspots share pointer-active interior area:

| Scene / sublocation | Hotspot A | Hotspot B | Why it matters |
| --- | --- | --- | --- |
| `investigation_scene_1 / office` | `old_request_slips` | `kagami_summary_hotspot` | A broad flavor hotspot overlaps the case-entry evidence target. |
| `investigation_scene_1 / office` | `old_request_slips` | `canned_coffee` | The same broad flavor hotspot overlaps a separate inspectable object. |
| `investigation_scene_7 / inner` | `takase_replay` | `miyake_replay` | Two replay/navigation targets compete in their shared region. |
| `investigation_scene_7 / inner` | `takase_replay` | `bean_can` | A replay target can steal clicks from the murder-weapon candidate. |
| `investigation_scene_7 / back_door` | `fire_door_7` | `floor_water` | A sublocation-unlock target can steal clicks from required water evidence. |

`InvestigationSceneSurface.svelte` renders placed hotspots as native buttons in one coordinate plane. There is no first-version runtime disambiguation mechanism for shared hotspot area, so an overlap is a content-authoring correctness problem rather than a desired layered interaction.

The current sidecars also explicitly whitelist the five pairs through `intentionalOverlaps`:

- `docs/stories_plan/chapter_1/investigation_scene_1.layout.json`
- `docs/stories_plan/chapter_1/investigation_scene_7.layout.json`

Those opt-outs no longer describe intentional design. They document accidental geometry that the player can experience as the wrong interaction.

## Important validator limitation

`detectLayoutOverlaps()` is deliberately a high-signal warning, not an exact intersection validator. It warns only when the overlap covers at least 80% of the smaller rectangle, and it skips pairs listed in `intentionalOverlaps`.

Therefore:

- `bun run scenes:compile` reporting `Layout warnings (0)` is still a useful regression smoke;
- it is **not sufficient evidence** that the five HPA-123 pairs are geometrically disjoint;
- HPA-123 must verify those exact five pairs separately without adding a new committed validation subsystem.

The implementation plan uses a one-off Bun command that reads the two sidecars and asserts that the five named rectangle pairs have zero interior intersection. The command is verification only; it does not become a new script, package, schema rule, or reusable framework.

## Goals

1. Make every affected hotspot independently pointer-reachable at the visual object it represents.
2. Protect evidence-bearing targets from broad flavor, replay, or navigation hitboxes.
3. Remove stale `intentionalOverlaps` declarations for the fixed pairs.
4. Preserve all existing hotspot IDs, labels, story reveals, keyboard navigation, accessible names, and scene flow.
5. Keep the implementation to the two authored layout sidecars.

## Non-goals

- No renderer hit-test arbitration.
- No z-index policy.
- No first-class layered/replay hotspot type.
- No overlap-resolution popup or nearest-target picker.
- No new compiler diagnostic or lower global overlap threshold.
- No broad Chapter 1 layout cleanup.
- No changes to `investigation_scene_1.md` or `investigation_scene_7.md` story logic.
- No asset regeneration.

## Approaches considered

### A. Fix authored geometry only — selected

Use the existing layout editor against the real background art, resize/reposition only the broad hotspot that is causing each collision, save normalized coordinates, then remove the obsolete overlap opt-outs.

Benefits:

- smallest possible diff;
- directly fixes what the player touches;
- no runtime or schema maintenance cost;
- preserves the current renderer and accessibility model;
- aligns exactly with HPA-123's approved first-version decision.

### B. Add runtime click arbitration — rejected

The renderer could inspect every hotspot under the pointer and choose by size, evidence priority, z-index, or another rule.

Rejected because the game currently has no product requirement for overlapping targets. Any priority rule would create hidden semantics, require tests and authoring guidance, and still leave bad geometry visible in the layout editor.

### C. Add a replay/overlay hotspot kind — rejected

A new hotspot kind could model replay paths separately from evidence targets.

Rejected because HPA-123 only has three authored geometry corrections. A new scene contract, compiler branch, runtime rendering rule, save behavior, and editor support would be substantially more work than the bug and would pre-design later interactions before Chapter 1 playtesting asks for them.

## Selected design

### 1. Preserve proof-bearing target geometry where possible

The evidence or existing inspectable targets are the stable anchors:

- `kagami_summary_hotspot`
- `canned_coffee`
- `miyake_replay`
- `bean_can`
- `floor_water`

HPA-123 changes the broader competing hitboxes instead:

- `old_request_slips`
- `takase_replay`
- `fire_door_7`

This keeps the important evidence aligned with already-authored visual objects and avoids fixing a replay/navigation problem by moving the evidence away from its source art.

### 2. Scene 1: shrink or reposition `old_request_slips`

In `investigation_scene_1 / office`, the old-request-slips target should remain on the visible stack of old request papers but become disjoint from both:

- `kagami_summary_hotspot`;
- `canned_coffee`.

The KAGAMI folder and canned coffee coordinates remain unchanged.

After the visual edit, remove the two `office.intentionalOverlaps` entries. If no intentional overlaps remain in the sublocation, omit the property entirely instead of leaving an empty array.

### 3. Scene 7 inner storage: shrink or reposition `takase_replay`

In `investigation_scene_7 / inner`, edit only `takase_replay` so its pointer rectangle still represents Takase's replay route/position while becoming disjoint from:

- `miyake_replay`;
- `bean_can`.

Do not move `bean_can` merely to make the replay target easier to place. The murder-weapon candidate is a proof-bearing clue and should stay visually anchored.

After the visual edit, remove both `inner.intentionalOverlaps` entries.

### 4. Scene 7 back door: shorten or reposition `fire_door_7`

`fire_door_7` is currently a tall navigation target. Keep it on the visible half-open fire door, but ensure its bottom/side no longer intersects the `floor_water` rectangle.

`floor_water` remains unchanged because it reveals the anonymous-message thumbnail and drying-map evidence required by the Chapter 1 reversal investigation.

After the visual edit, remove the `back_door.intentionalOverlaps` entry.

### 5. Geometry rule

For the five HPA-123 pairs, the hard acceptance rule is:

> Their normalized rectangles must have zero shared interior area.

Edge adjacency is technically safe, but the editor should leave a small visible gutter when that still matches the background art. The gutter is an authoring preference, not a new global geometry constant.

The plan intentionally does not pre-author replacement numeric coordinates. The correct values are visual-content data and should be produced by the existing layout editor against the real scene art, not guessed in a design document.

## Verification design

### Exact targeted geometry check

Run a one-off Bun command against the two sidecars. It must assert no interior intersection for exactly the five HPA-123 pairs.

This closes the gap left by the compiler's intentional 80% warning threshold without creating a new repository-level validation abstraction.

### Existing compiler smoke

Run:

```bash
bun run scenes:compile
```

Expected result:

- Chapter 1 compiles successfully.
- Layout warnings remain `0`.

### Real UI pointer smoke

Open the real game and individually activate every affected target from its intended visible object:

Scene 1 office:

- old request slips;
- KAGAMI summary folder;
- canned coffee.

Scene 7 inner:

- Takase replay;
- Miyake replay;
- bean can.

Scene 7 back door:

- fire door;
- floor water.

`bean_can` and `floor_water` must be selectable without entering a replay beat or another sublocation.

### Keyboard/accessibility regression check

No Markdown label, hotspot ID, renderer markup, or button behavior changes. The existing native-button keyboard model and accessible labels therefore remain structurally unchanged. During the UI smoke, tab to the affected controls once to confirm the same labels are still exposed and activatable.

## Why no new committed automated test

This ticket changes authored rectangles only. Adding a new test helper or lowering the global overlap threshold would expand the product contract beyond the bug.

The exact one-off geometry assertion plus existing compiler smoke and real-screen pointer verification provide sufficient first-version confidence while keeping the repository unchanged outside the two sidecars.

If later Chapter 1 playtesting finds repeated low-percentage overlap bugs across many scenes, that repeated evidence would justify a separate validator-policy ticket. HPA-123 should not speculate ahead of that evidence.

## Risks and mitigations

### A corrected rectangle becomes too small

Mitigation: make the edit in the existing layout editor over the real background and perform the real-game pointer smoke. Do not satisfy the intersection check by collapsing a target to a tiny arbitrary box.

### A target is moved away from its visual object

Mitigation: treat visual alignment as part of acceptance. Geometry correctness and semantic placement must both hold.

### The editor preserves stale opt-outs

The layout store intentionally round-trips `intentionalOverlaps`, so resizing a rectangle does not remove the whitelist automatically.

Mitigation: remove the three obsolete opt-out groups explicitly after saving geometry, then re-open/recompile the sidecars.

### `Layout warnings (0)` creates false confidence

Mitigation: the one-off exact five-pair assertion is a required acceptance step, not optional documentation.

## Expected implementation diff

Production implementation should touch only:

- `docs/stories_plan/chapter_1/investigation_scene_1.layout.json`
- `docs/stories_plan/chapter_1/investigation_scene_7.layout.json`

The planning PR contains this design and its implementation plan only.

## Acceptance summary

HPA-123 is complete when:

- all five named hotspot pairs have zero interior intersection;
- all three stale `intentionalOverlaps` groups covering those pairs are removed;
- protected evidence/inspectable target geometry remains unchanged unless the visual editor proves a tiny adjustment is strictly necessary;
- every affected target can be activated independently on the intended visual object;
- `bean_can` and `floor_water` cannot be stolen by replay/navigation targets;
- keyboard labels and behavior remain unchanged;
- `bun run scenes:compile` succeeds with `Layout warnings (0)`;
- no runtime, schema, compiler-policy, or broad layout abstraction is introduced.
