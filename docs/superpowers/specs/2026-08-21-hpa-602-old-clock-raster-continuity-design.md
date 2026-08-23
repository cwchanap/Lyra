# HPA-602 Old-Clock Raster Continuity Design

**Linear:** HPA-602 — Old-clock raster continuity for `scene_p2` / `scene_11` (HPA-561 follow-up)

## Goal

Close the remaining Chapter 1 old-clock visual-continuity follow-up without changing the already-correct case logic.

The player encounters one physical clock through five raster surfaces:

1. `static/assets/backgrounds/chapter_1/scene_p2/tag_002.png` — ordinary-day seed, mounted at the inner-storage entrance.
2. `static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png` — interactive crime-scene inspection, still mounted and stopped.
3. `static/assets/evidence/old_clock_photo.png` — Case File photograph collected from that inspection.
4. `static/assets/backgrounds/chapter_1/scene_11/tag_002.png` — post-case payoff, the same clock removed from the wall and resting on the counter.
5. `static/assets/backgrounds/chapter_1/scene_11/tag_003.png` — post-box final café cue, the closed cardboard box in the corner with the clock no longer on the counter.

HPA-602 succeeds only when all five surfaces show the same recognizable prop in the correct state and location.

This remains a raster/prompt continuity task. It does not introduce a clock sprite, rendering feature, compiler feature, visual-test framework, or new asset ID.

> **Post-review revision (2026-08-22):** external review of the HPA-602 closeout found three gaps, accepted and folded into this contract: (1) Scene 3 `inner_entry.png` is now covered by a durable framing clause rather than the "not the interaction carrier" exemption; (2) Scene 11 gains the `tag_003` post-box cue so the authored boxing no longer plays over the clock-on-counter plate; (3) one literal post-impact dial crack is carried across Scene 7 → evidence → Scene 11 so the physical state cannot regenerate intact/cracked/intact.

## Canon and Current Contract

The authored story already fixes the intended physical continuity:

- `scene_p2.md` places the clock on the **inner-storage entrance's inner wall** and establishes that it often runs slow.
- `investigation_scene_7.md` explicitly identifies the stopped clock as the same manager-mentioned clock, still mounted on that entrance wall and visible immediately after crossing the fire door.
- the same Scene 7 text requires the clock to remain **outside Miyake's blocked 23:06 sightline**.
- `old_clock_photo` is collected from that Scene 7 hotspot.
- `scene_11.md` says the stopped warehouse clock has been removed and placed on the café counter.

The old semantic re-audit also records the original defect as a location mismatch: the planted clock appeared to relocate from the corridor/entrance area into deeper storage. HPA-602 must therefore verify both **identity and placement**, not just clock styling.

## Scope

### Five regeneration targets

Regenerate all five clock-state player surfaces in this PR:

- `static/assets/backgrounds/chapter_1/scene_p2/tag_002.png`
- `static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png`
- `static/assets/evidence/old_clock_photo.png`
- `static/assets/backgrounds/chapter_1/scene_11/tag_002.png`
- `static/assets/backgrounds/chapter_1/scene_11/tag_003.png` (new post-box cue; later scene_11 tags shift by one)

The previous conditional sibling path is removed. The current family is already known to contain materially different clock designs, so planning a no-op branch adds process without reducing work.

### Sixth inspection-only surface

Also inspect, but do not regenerate as part of this ticket:

- `static/assets/backgrounds/chapter_1/investigation_scene_3/inner_entry.png`

This is a rendering of the same physical entrance. It is weaker than the five named surfaces because the player does not inspect the clock on this plate, but it must be looked at before acceptance so the final placement decision is made with the adjacent geometry visible.

Its absence of a clock is acceptable only when the plate durably does not expose the entrance wall where the clock hangs. Its `Background Prompt` therefore pins the camera at the fire-door threshold facing deeper into storage, with the entrance wall behind the camera and out of frame and no wall clock visible — a future regeneration cannot contradict Scene 7's entrance-wall placement. Acceptance requires human confirmation that the existing plate complies with this framing. HPA-602 does not regenerate this plate unless the confirmation fails.

## Durable Clock Identity

The identity must live in authored asset prompts, not in temporary working notes or prose that future generation cannot see.

Use this literal recurring identity across every touched `Background Prompt` / `Image Prompt`:

> **round old analog café wall clock with a heavy black multi-ring metal bezel, aged cream enamel dial with fine hairline crazing, twelve short black baton hour markers and no numerals, thick tapered black hands, and a small scuff on the lower-right outer ring**

Post-impact surfaces (Scene 7 `inner`, `old_clock_photo`, Scene 11 `tag_002`) additionally carry one literal damage trait:

> **one sharp diagonal impact crack crossing the lower-left of the cream dial, distinct from the fine hairline crazing**

P2 stays intact (pre-impact, no crack). The Scene 11 `tag_003` post-box plate carries no visible clock; its state is the closed cardboard box itself.

These are visual continuity traits, not evidence facts.

The exact phrase can be integrated grammatically into each prompt, but the concrete traits themselves must not be replaced by self-referential wording such as “matching the same distinctive clock.” A future generator must be able to reconstruct the identity from the prompt alone.

## Required Prompt Changes

Patch all four owning asset prompts before generation.

### `scene_p2.md`

The live P2 prompt already owns the correct corridor-mouth / entrance-wall composition. Extend it with the literal clock identity above.

Do not add an exact time. The still image does not need to prove that the clock is running slowly; authored action/dialogue owns that fact.

### `investigation_scene_7.md` — `inner` background

The `inner` `Background Prompt` must explicitly include:

- the literal clock identity;
- the clock mounted on the **inner-storage entrance wall**, not the deep storage back wall;
- the clock visible immediately after crossing the fire door;
- high shelves preserving Miyake's blocked sightline from his replay position;
- the existing shelf-impact, phone-drop, bean-can, paperback, and baked 黑瀨 visual anchors.

The existing `Scene Source Prompt` can remain the concise source-object description; the actual background asset contract lives in the sublocation `Background Prompt`.

### `investigation_scene_7.md` — `old_clock_photo`

Replace the generic evidence `Image Prompt` with a durable description containing the same literal clock identity plus the literal post-impact dial crack.

Keep the aged photo-print character rather than replacing it with a self-reference. The evidence image remains a photo-print style isolated object, not a generic clock icon.

### `scene_11.md`

Replace the generic “old wall clock resting on the counter” prompt with the literal clock identity plus the state change:

- same recurring physical clock;
- removed from the entrance wall;
- resting naturally on the café counter;
- stopped in the same vague late-night analog position as Scene 7;
- carrying the same post-impact dial crack as Scene 7 and the evidence photo.

Additionally add the post-box final café cue before the office cut:

- a new `[場景：...]` tag with its own `Background Prompt`;
- the old café wall clock no longer on the counter;
- a closed cardboard box resting on the floor in the corner;
- the umbrella stand at the frame edge;
- the latte cup anchor retained;
- later scene_11 tags shift by one (`tag_003` → `tag_004`, etc.).

## Time Depiction Rule

Do not render literal `22:59`, readable clock numerals, a digital display, or other clock-face text.

The asset policy forbids readable text, and the existing Scene 7 source prompt already uses a vague late-night position.

For stopped states:

- minute hand nearly vertical at the 12-o'clock position;
- hour hand just before the 11-o'clock position;
- baton marks may be visible as shapes, but no numerals;
- dialogue and evidence copy continue to carry the exact `22:59` interpretation.

P2 does not need an exact time.

## Six-Dimension Visual Gate

Side-by-side human review is the acceptance owner. No image-similarity or CV test is added.

All five regenerated surfaces must pass these six dimensions:

1. **Casing/rim** — heavy black multi-ring metal bezel.
2. **Dial/markers** — aged cream enamel, hairline crazing, short black baton markers, no numerals.
3. **Hands** — thick tapered black hands.
4. **Wear/imperfection** — same aged finish and lower-right outer-ring scuff; post-impact surfaces (Scene 7, evidence, Scene 11 counter) additionally show the same sharp diagonal impact crack across the lower-left of the dial, distinct from the crazing. P2 shows no crack.
5. **Proportions** — same round face / unusually thick bezel relationship.
6. **Placement and sightline** — the physical state/location is correct for that scene.

Placement/sightline rules:

- P2: mounted on the inner-storage entrance's inner wall at the corridor endpoint.
- Scene 7: still mounted on that entrance wall, visible just after crossing the fire door, not relocated to the storage back wall, and consistent with Miyake being unable to see it from his 23:06 position.
- evidence photo: isolated photograph of the same Scene 7 clock in the stopped, impact-cracked state.
- Scene 11 `tag_002`: removed from the wall and resting on the café counter through the packing beats.
- Scene 11 `tag_003`: closed cardboard box in the corner, clock no longer on the counter, umbrella stand at the frame edge.
- Scene 3 `inner_entry`: entrance wall out of frame; no wall clock visible.

A mismatch on any of these dimensions is rejected and regenerated in HPA-602. Do not file another clock-continuity follow-up.

## Scene 7 Composition Contract

Regenerating `investigation_scene_7/inner.png` must preserve more than the clock:

- cold inner storage room;
- high metal shelves;
- hard sensor light;
- shelf impact mark;
- phone drop position;
- bean can and paperback hotspot landmarks;
- baked 黑瀨徹 on the right at perspective-correct scale;
- floor clearance and existing interaction readability.

The only intended prop corrections are the clock's identity, stopped hand position, entrance-wall placement, and the post-impact dial crack.

## Background Audit Baseline Repair

The planned verification command is currently red on `main` for an unrelated but already-known report rename drift:

- current `chapter.md` uses `analysis_scene_8_5.md`;
- `background-variety-audit.md` still has a current-manifest entry and cue row for `scene_8_5`.

Because `background-cues:audit --check-report` performs exact cue-key coverage, HPA-602 must repair the report before relying on that gate.

Make the smallest correction:

1. keep the **Frozen production manifest** historical `scene_8_5.md` entry unchanged;
2. update the **Current accepted manifest** entry to `analysis_scene_8_5.md`;
3. update the cue row from
   `chapter_1/scene_8_5.json::/queue/0/assetCue/backgroundAssetId`
   to
   `chapter_1/analysis_scene_8_5.json::/intro/0/assetCue/backgroundAssetId`;
4. add/adjust the current-state prose so it no longer implies the P1 amendment was the last production change.

This is a report-baseline repair required to make the HPA-602 mechanical gate meaningful, not new background work.

## Asset Verification Contract

Do not add a repository PNG-validation script and do not carry the bespoke Python parser previously proposed.

Extend `.claude/skills/generating-lyra-image-assets/SKILL.md` so its existing vague “dimension scan for touched asset types” instruction names the simple reusable command:

```bash
file -b <touched PNG paths>
```

For HPA-602 the expected metadata is:

- four regenerated backgrounds (`scene_p2/tag_002`, `investigation_scene_7/inner`, `scene_11/tag_002`, `scene_11/tag_003`): `1920 x 1080`, RGB/non-alpha PNG;
- regenerated evidence: `512 x 512`, RGBA PNG.

This is sufficient for the normalizer used by the asset workflow. Do not add another ticket-specific validator.

## Mechanical Verification

Run after authored prompt/report changes and final raster normalization:

```bash
bun run scenes:compile
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

After the explicit report-baseline repair, both commands must exit 0.

These checks prove structural/compiler/report consistency only. They do not prove the clocks match visually.

## Axis 5 Closeout

Write the HPA-602 result directly into `docs/stories_plan/chapter_1/semantic-content-reaudit.md` rather than recreating the absent historical `final-cycle-axis-5-visual-background-rerun.md` file.

Record:

- all six surfaces inspected (five regenerated + `inner_entry.png`);
- the five regenerated paths;
- the literal durable clock identity (including the post-impact dial crack) used in the asset prompts;
- six-dimension side-by-side acceptance;
- the Scene 3 `inner_entry.png` inspection disposition;
- `file -b` metadata results;
- `scenes:compile` result;
- `background-cues:audit --check-report` result;
- Axis 5 old-clock item verdict `SHIP` and deferred follow-up resolved.

## Expected File Surface

Implementation is expected to modify:

- `docs/stories_plan/chapter_1/scene_p2.md`
- `docs/stories_plan/chapter_1/investigation_scene_7.md`
- `docs/stories_plan/chapter_1/scene_11.md`
- `docs/stories_plan/chapter_1/background-variety-audit.md`
- `docs/stories_plan/chapter_1/semantic-content-reaudit.md`
- `.claude/skills/generating-lyra-image-assets/SKILL.md`
- `static/assets/backgrounds/chapter_1/scene_p2/tag_002.png`
- `static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png`
- `static/assets/evidence/old_clock_photo.png`
- `static/assets/backgrounds/chapter_1/scene_11/tag_002.png`
- `static/assets/backgrounds/chapter_1/scene_11/tag_003.png` (new; former `tag_003`–`tag_005` shift to `tag_004`–`tag_006`)

Inspect only:

- `static/assets/backgrounds/chapter_1/investigation_scene_3/inner_entry.png`

Generated runtime JSON remains untracked and is never hand-edited.

## KISS Boundaries

Keep the existing decisions:

- clock stays baked into backgrounds/evidence;
- no sprite/overlay;
- no new asset IDs or scene carriers;
- no compiler/runtime/layout change;
- no image-similarity, CV, screenshot, or generic prop-continuity test infrastructure;
- no new repo validation script;
- no unrelated Chapter 1 regeneration;
- no Chapter 2 work;
- no follow-up ticket for a mismatch discovered while HPA-602 is open.

## Single-PR Boundary

HPA-602 remains one PR. The same branch carries the design, implementation plan, prompt/report/skill corrections, four regenerated rasters, visual closeout, and verification evidence.