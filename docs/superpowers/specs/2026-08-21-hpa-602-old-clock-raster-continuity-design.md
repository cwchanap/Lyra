# HPA-602 Old-Clock Raster Continuity Design

**Linear:** HPA-602 — Old-clock raster continuity for `scene_p2` / `scene_11` (HPA-561 follow-up)

## Goal

Close the remaining Chapter 1 visual-continuity follow-up for the Rain Bell café's old wall clock without changing the already-correct authored case logic.

The two story plates must read as the **same physical clock** across the chapter:

- `background.chapter_1.scene_p2.tag_002` is the ordinary-day seed: the old clock is still mounted at the inner-storage entrance in its normal operational state; the authored scene supplies the fact that it runs slowly.
- `background.chapter_1.scene_11.tag_002` is the post-case payoff: that same clock has been removed from the warehouse, is resting on the counter, and its hands are stopped near **22:59**.

This is a raster-continuity task, not a story rewrite or an asset-system change.

## Current Canon

The authored text already carries the intended continuity.

`docs/stories_plan/chapter_1/scene_p2.md` establishes:

- the back-corridor / inner-storage entrance as the clock's normal location;
- an old clock mounted on the entrance's inner wall;
- the manager noticing that it is running slowly;
- the clock continuing to lag later in the scene.

`docs/stories_plan/chapter_1/scene_11.md` establishes:

- the stopped clock is the warehouse clock from the case;
- it has been taken down after the case;
- it rests on the café counter before the manager packs it into a box.

HPA-602 therefore must preserve the written continuity rather than edit dialogue, evidence, scene order, or case logic to accommodate the current raster files.

## Scope

### In scope

1. Regenerate exactly these two Chapter 1 background plates:
   - `static/assets/backgrounds/chapter_1/scene_p2/tag_002.png`
   - `static/assets/backgrounds/chapter_1/scene_11/tag_002.png`
2. If necessary for repeatable generation, make a **minimal semantic prompt-only patch** to the corresponding `Background Prompt` lines in:
   - `docs/stories_plan/chapter_1/scene_p2.md`
   - `docs/stories_plan/chapter_1/scene_11.md`
3. Re-run the old-clock item of the existing Axis 5 visual review.
4. Move the old-clock entry in `docs/stories_plan/chapter_1/semantic-content-reaudit.md` from deferred to resolved with the accepted asset IDs and verification result.
5. Run the existing scene compiler and Chapter 1 background-cue audit.

### Out of scope

- No changes to the culprit, motive, death time, evidence packages, proof order, unlocks, reveal ladder, or sealed-reveal timing.
- No dialogue or narration rewrite except a prompt-only clarification if generation needs one.
- No new evidence asset, hotspot, scene tag, asset ID, renderer behavior, layout contract, compiler feature, or runtime feature.
- No regeneration of any other Chapter 1 background.
- No attempt to solve unrelated visual findings from the historical semantic re-audit.
- No Chapter 2 work.

## Design Decision

Use **paired, reference-first regeneration**, with the `scene_p2` clock acting as the canonical visual identity and `scene_11` preserving that identity in a different state and location.

This is preferable to the alternatives:

- **Only regenerate `scene_11`:** smallest file count, but weak continuity because the payoff can drift into a different clock design.
- **Rewrite the story around the existing rasters:** violates HPA-602's purpose and reopens authored continuity that HPA-561 already fixed.
- **Introduce a standalone clock sprite/overlay:** unnecessary new rendering and composition machinery for a two-plate continuity problem.

The clock stays baked into the existing background plates.

## Visual Continuity Contract

The implementation must inspect the current two target plates and relevant café siblings locally before generation, as required by `.claude/skills/generating-lyra-image-assets/SKILL.md`. The inspection records stable anchors and intended deltas before writing generation prompts.

### Clock identity — must remain recognizable

The two generated plates must share the same visible clock identity:

- same casing / rim shape and material;
- same dial styling and hand design;
- same age, wear, discoloration, and distinctive small imperfections;
- same overall proportions.

These features are continuity anchors, not new evidence. They should be visually recognizable without a dialogue callout or UI label.

### `scene_p2/tag_002` — seed state

Preserve the authored composition:

- eye-level medium-wide view from the corridor mouth;
- narrow café back corridor leading to the inner-storage entrance;
- old clock mounted on the entrance's inner wall above / near stacked supplies;
- quiet, operational afternoon mood;
- no foreground dialogue characters;
- lower composition remains usable by the dialogue UI.

A still raster does **not** need to prove that the clock runs slowly. Its job is to establish the recognizable physical clock in the correct operational location; the authored action and dialogue carry the slow-running fact. The plate also does not need to encode an exact story-critical time before the murder.

### `scene_11/tag_002` — payoff state

Preserve the authored aftermath composition:

- empty Rain Bell café interior in soft afternoon light;
- latte cup / quiet post-case stillness where compatible with the existing composition;
- the **same clock** now resting naturally on the counter after being removed from the warehouse wall;
- hands clearly stopped near **22:59**;
- no people, logos, watermark, or unrelated readable signage;
- lower composition remains usable by the dialogue UI.

The clock must not look like a decorative replacement, a modern clock, or a different prop introduced for the ending.

## Prompt Ownership

The existing authored `Background Prompt` remains the semantic source of truth.

Prefer using the current prompts unchanged if the paired generation workflow can reliably preserve clock identity and the 22:59 payoff. If the implementation proves the prompts are underspecified, patch only the minimum needed continuity language:

- `scene_p2`: define the old clock as the recurring clock whose design must remain stable later.
- `scene_11`: explicitly say it is the **same old clock from the back-corridor / inner-storage entrance**, now removed and resting on the counter, with hands stopped near 22:59.

Do not add story facts, new clues, exact evidence language, or filesystem paths to authored Markdown.

## Asset Generation Workflow

Follow `.claude/skills/generating-lyra-image-assets/SKILL.md` and the system image-generation skill it references.

1. Inspect target plates and café sibling backgrounds before prompt writing.
2. Record stable room / prop anchors and the intended delta for each target.
3. Generate the seed plate first.
4. Preserve the accepted seed clock in the payoff plate. Prefer direct visual-reference generation when the available workflow supports it; otherwise carry the same explicit clock descriptors and compare the outputs side by side before acceptance.
5. Normalize both workspace files to the repository background policy:
   - opaque PNG;
   - exactly `1920x1080`;
   - preserve aspect ratio; no non-uniform stretching.
6. Inspect both final normalized files side by side before acceptance.

Use the built-in image-generation path by default. Do not introduce an alternate asset pipeline or CLI/API fallback unless the implementation environment requires the repo-documented fallback and the user has approved it where required by the asset skill.

## Acceptance Criteria

### Visual

- `scene_p2/tag_002` clearly establishes the recurring old clock at the inner-storage entrance.
- `scene_11/tag_002` clearly depicts the same clock after removal.
- Clock casing, dial, hands, wear, and proportions are recognizably continuous across both plates.
- The payoff clock hands read near 22:59.
- Both scenes retain their intended room composition and dialogue-safe lower area.
- No new visual contradiction is introduced with nearby Rain Bell backgrounds.

### Asset contract

- Both PNGs are exactly `1920x1080`.
- Both are opaque after normalization.
- Existing paths and semantic asset IDs remain unchanged.
- No additional Chapter 1 background is regenerated.

### Repository verification

Run:

```bash
bun run scenes:compile
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

Both commands must exit 0 with no new warning or audit drift attributable to HPA-602.

Run the repo-appropriate dimension / alpha inspection for the two touched PNGs and record the result in the PR.

### Review closeout

- Re-run Axis 5 only for the old-clock continuity item.
- Axis 5 verdict for this item is `SHIP`.
- Update `docs/stories_plan/chapter_1/semantic-content-reaudit.md` so the old-clock follow-up is recorded as resolved rather than deferred.

## Expected File Surface

Expected implementation changes are deliberately small:

- `static/assets/backgrounds/chapter_1/scene_p2/tag_002.png`
- `static/assets/backgrounds/chapter_1/scene_11/tag_002.png`
- `docs/stories_plan/chapter_1/semantic-content-reaudit.md`
- optionally, only if generation repeatability requires it:
  - `docs/stories_plan/chapter_1/scene_p2.md`
  - `docs/stories_plan/chapter_1/scene_11.md`

Generated runtime resource JSON remains untracked and must not be hand-edited.

## Testing Philosophy

This task does not need new unit, component, Rust, or packaged E2E infrastructure. The production risk is visual continuity and asset-policy drift, so verification stays at the owning boundaries:

- side-by-side visual acceptance;
- exact PNG dimensions / opacity;
- scene compilation;
- existing background-cue audit;
- the existing Axis 5 review artifact.

Adding automated image-similarity tests, computer-vision matching, snapshot infrastructure, or a reusable prop-continuity framework would cost more than this two-asset follow-up justifies.

## Single-PR Boundary

HPA-602 is delivered as one PR. The same branch carries the approved design, implementation plan, two regenerated plates, any minimal prompt clarification, re-audit closeout, and verification evidence. There is no separate asset PR or follow-up PR for this ticket.