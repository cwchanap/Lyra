# HPA-602 Old-Clock Raster Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regenerate the five player-facing Chapter 1 old-clock state rasters as one durable physical prop sequence, preserve the correct entrance-wall/sightline logic, and close the existing Axis 5 follow-up.

**Architecture:** Keep the clock baked into existing backgrounds/evidence. Put one literal clock identity into the four clock-bearing asset prompts, carry one literal post-impact crack across the three post-impact clock surfaces, add one post-box Scene 11 cue, durably frame the adjacent Scene 3 entrance plate, and use human side-by-side review across six surfaces as the visual gate. Repair the already-red background-audit report baseline and make the asset skill's dimension-scan command explicit; add no new runtime/compiler/image-validation machinery.

**Tech Stack:** Authored Markdown, Lyra raster asset workflow, built-in OpenAI image generation, PNG normalization, `file(1)`, existing scene compiler/background audit.

**Spec:** `docs/superpowers/specs/2026-08-21-hpa-602-old-clock-raster-continuity-design.md`

## Global Constraints

- Deliver HPA-602 as this single PR.
- Regenerate exactly:
  - `static/assets/backgrounds/chapter_1/scene_p2/tag_002.png`
  - `static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png`
  - `static/assets/evidence/old_clock_photo.png`
  - `static/assets/backgrounds/chapter_1/scene_11/tag_002.png`
  - `static/assets/backgrounds/chapter_1/scene_11/tag_003.png`
- Inspect but do not regenerate `static/assets/backgrounds/chapter_1/investigation_scene_3/inner_entry.png`; update its authored framing so the entrance wall stays behind the camera and no wall clock is visible.
- Use this literal identity in every clock-bearing asset prompt: **round old analog café wall clock with a heavy black multi-ring metal bezel, aged cream enamel dial with fine hairline crazing, twelve short black baton hour markers and no numerals, thick tapered black hands, and a small scuff on the lower-right outer ring**.
- Post-impact Scene 7, evidence, and Scene 11 `tag_002` additionally carry **one sharp diagonal impact crack crossing the lower-left of the cream dial, distinct from the fine hairline crazing**; P2 stays intact.
- P2: mounted on the inner-storage entrance's inner wall; no exact time required.
- Scene 7: same clock still on that entrance wall, visible after crossing the fire door, not on the deep storage back wall, and consistent with Miyake being unable to see it from his 23:06 replay position.
- Scene 7/evidence/Scene 11 stopped state: minute hand nearly vertical at 12, hour hand just before 11; never render literal `22:59` or readable numerals.
- Scene 11 `tag_002`: same clock removed from the wall and resting on the café counter through the packing beat.
- Scene 11 `tag_003`: post-box state only, with a closed cardboard box in the corner and no visible clock; former `tag_003`–`tag_005` cues shift to `tag_004`–`tag_006`.
- Backgrounds: opaque RGB PNG, exactly `1920x1080`.
- Evidence: transparent/RGBA PNG, exactly `512x512`.
- Preserve scene/evidence semantics, hotspot/reveal wiring, dialogue, and Scene 7 interaction landmarks/baked 黑瀨 placement; the only cue/ID change is the approved Scene 11 post-box addition and resulting later-tag shift.
- No sprite/overlay, new runtime asset mechanism, compiler/runtime/layout work, image-similarity/CV/screenshot infrastructure, new validation script, generic prop framework, unrelated Chapter 1 regeneration, Chapter 2 work, or follow-up ticket for a mismatch found here.
- Generated JSON under `apps/game/src-tauri/resources/**` stays untracked and is never hand-edited.

---

### Task 1: Make identity and verification contracts durable

**Files:**
- Modify: `docs/stories_plan/chapter_1/scene_p2.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_3.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_7.md`
- Modify: `docs/stories_plan/chapter_1/scene_11.md`
- Modify: `docs/stories_plan/chapter_1/background-variety-audit.md`
- Modify: `.claude/skills/generating-lyra-image-assets/SKILL.md`
- Modify: `apps/game/e2e-tauri/production-anchors.ts`
- Modify: `packages/scripts/__snapshots__/compile-scenes.test.ts.snap`
- Inspect: `static/assets/backgrounds/chapter_1/investigation_scene_3/inner_entry.png`

**Interfaces:**
- Produces: four clock-bearing asset prompts containing the same literal physical identity, with one literal crack carried across the three post-impact surfaces.
- Produces: one post-box Scene 11 cue with a closed box and no visible clock.
- Produces: Scene 7 placement plus durable Scene 3 framing that keep the entrance-wall geometry consistent.
- Produces: a background-audit report aligned with current `analysis_scene_8_5` ownership and the new Scene 11 cue.
- Produces: explicit reusable `file -b` raster metadata verification in the asset skill.

- [ ] **Step 1: Inspect the six-surface spatial/state context before edits**

Read the asset/review skills plus `static/assets/config/policy.yaml`, then open together:

```text
static/assets/backgrounds/chapter_1/scene_p2/tag_002.png
static/assets/backgrounds/chapter_1/investigation_scene_3/inner_entry.png
static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png
static/assets/evidence/old_clock_photo.png
static/assets/backgrounds/chapter_1/scene_11/tag_002.png
static/assets/backgrounds/chapter_1/scene_11/tag_003.png
```

For Scene 3, require the `inner_entry` prompt to pin the camera at the fire-door threshold facing deeper into storage, with the entrance wall behind the camera and out of frame and no wall clock visible. Confirm the existing plate complies with this framing; do not regenerate Scene 3 unless that confirmation fails.

- [ ] **Step 2: Patch P2's `Background Prompt`**

Use exactly this asset contract:

```markdown
- **Background Prompt:** Eye-level medium-wide establishing view from the corridor mouth, camera pulled back to frame the narrow back corridor of a small Tokyo cafe leading to the inner-storage entrance at its end, focal area a round old analog cafe wall clock with a heavy black multi-ring metal bezel, aged cream enamel dial with fine hairline crazing, twelve short black baton hour markers and no numerals, thick tapered black hands, and a small scuff on the lower-right outer ring, mounted on the entrance's inner wall above stacked supply boxes, dim service light, quiet operational mood, no people, no readable text, keep the lower composition clear and uncluttered for dialogue UI.
```

Change no adjacent action/dialogue/BGS.

- [ ] **Step 3: Make Scene 3's `inner_entry` framing durable**

Use this exact prompt while leaving the raster inspection-only:

```markdown
- **Background Prompt:** Dark inner storage entrance of Rain Bell cafe seen from the fire-door threshold, camera facing deeper into the storage so the entrance wall behind the camera stays out of frame, high shelves blocking the view into deeper storage, thin dust, sensor light just out of range, no wall clock visible, tense spatial clue.
```

Change no status, scene copy, hotspots, or unlock wiring.

- [ ] **Step 4: Patch Scene 7's `inner` `Background Prompt`**

Use this contract, retaining all existing room/黑瀨 anchors:

```markdown
- **Background Prompt:** Cold inner storage room of a small Tokyo cafe, high metal shelves casting long shadows and preserving the blocked sightline from the corridor-side replay position, hard sensor light, shelf impact mark on floor. Immediately inside the fire door, on the inner-storage entrance's inner wall rather than the deep storage back wall, mount the recurring round old analog cafe wall clock with a heavy black multi-ring metal bezel, aged cream enamel dial with fine hairline crazing, twelve short black baton hour markers and no numerals, thick tapered black hands, a small scuff on the lower-right outer ring, and one sharp diagonal impact crack crossing the lower-left of the cream dial, distinct from the fine hairline crazing; its minute hand is nearly vertical at 12 and its hour hand is just before 11, with no readable time text. Detective Kurose Toru baked into the right side of the storage room: stocky weathered middle-aged man, wrinkled brown-gray field coat, worn dark leather shoes, thick hands, standing with slow steady footing as he leads the inspection, deep crow's-feet and night-shift weariness, perspective-correct scale and lighting under the hard sensor light, not covering the clock, shelf impact mark, phone drop position, bean can, or paperback hotspot.
```

Keep hotspot geometry, `Scene Source Prompt`, reveals, and dialogue unchanged.

- [ ] **Step 5: Patch `old_clock_photo` `Image Prompt`**

Use:

```markdown
- **Image Prompt:** Isolated photo print of the recurring round old analog cafe wall clock examined at the inner-storage entrance, with a heavy black multi-ring metal bezel, aged cream enamel dial with fine hairline crazing, twelve short black baton hour markers and no numerals, thick tapered black hands, and a small scuff on the lower-right outer ring; stopped at a vague late-night position with the minute hand nearly vertical at 12 and the hour hand just before 11, shadowed aged appearance with one sharp diagonal impact crack crossing the lower-left of the cream dial, distinct from the fine hairline crazing, no readable timestamp or text, transparent evidence-icon composition.
```

Keep Name, Description, Details, Source Sublocation, reveal wiring, and On Collect dialogue unchanged.

- [ ] **Step 6: Patch Scene 11's counter `Background Prompt`**

Use:

```markdown
- **Background Prompt:** Empty Rain Bell cafe interior in afternoon light, a latte cup on a wooden table, the recurring round old analog cafe wall clock from the back-corridor inner-storage entrance now removed from the wall and resting naturally on the counter, with a heavy black multi-ring metal bezel, aged cream enamel dial with fine hairline crazing, twelve short black baton hour markers and no numerals, thick tapered black hands, a small scuff on the lower-right outer ring, and one sharp diagonal impact crack crossing the lower-left of the cream dial, distinct from the fine hairline crazing; its minute hand is nearly vertical at 12 and its hour hand is just before 11, no readable clock numerals or other text, quiet unresolved stillness.
```

Change no story copy/BGM/BGS.

- [ ] **Step 7: Add the Scene 11 post-box cue after the boxing action**

Immediately after `[店長把紙箱蓋上，放到角落。門邊的傘架，只在畫面邊緣靜靜立著。]`, add:

```markdown
[場景：雨鐘咖啡館，午後。吧台上已不見掛鐘，角落放著一只封好的紙箱，門邊傘架在畫面邊緣。]
- **Background Prompt:** Empty Rain Bell cafe interior in afternoon light, a latte cup on a wooden table, the old cafe wall clock no longer on the counter, a closed cardboard box resting on the floor in the corner, the umbrella stand standing quietly at the frame edge near the door, quiet unresolved stillness, no readable text.
- **BGM:** bgm_chapter_close
- **BGS:** bgs_cafe_afternoon_after_rain
```

The action must precede the resulting-state cue so `tag_002` remains visible throughout packing and `tag_003` begins only after the box is closed and moved. This addition shifts the former `tag_003`–`tag_005` cues and rasters to `tag_004`–`tag_006`.

- [ ] **Step 8: Repair the already-red background-audit report baseline**

In `docs/stories_plan/chapter_1/background-variety-audit.md`:

1. Keep the historical **Frozen production manifest** `scene_8_5.md` entry unchanged.
2. In **Current accepted manifest**, change `14. scene_8_5.md` to `14. analysis_scene_8_5.md`.
3. Change only this live cue key:

```text
chapter_1/scene_8_5.json::/queue/0/assetCue/backgroundAssetId
```

to:

```text
chapter_1/analysis_scene_8_5.json::/intro/0/assetCue/backgroundAssetId
```

Keep the row's Police station vending corridor semantics/decision/priority unchanged.
4. Adjust current-state prose to note HPA-265 replaced the former linear `scene_8_5.md` with `analysis_scene_8_5.md`; do not rewrite the frozen historical baseline.

- [ ] **Step 9: Make the asset skill's dimension scan concrete**

Replace its vague `a dimension scan for touched asset types` bullet with:

```text
- on Unix-like development/CI hosts, run `file -b <touched PNG paths>` and verify each output reports the policy dimensions plus RGB for opaque backgrounds or RGBA for transparent portrait/evidence assets; use an equivalent image-metadata inspector only when `file` is unavailable
```

Do not add a script or PNG parser.

- [ ] **Step 10: Compile and prove the repaired audit baseline before art generation**

```bash
bun run scenes:compile
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

Expected: both exit 0. The accepted report must include the new Scene 11 post-box cue in addition to the `analysis_scene_8_5` ownership repair. If coverage reports a stale/missing cue key, repair only current report ownership required by compiler output before continuing.

- [ ] **Step 11: Update production-corpus coupling**

The added Scene 11 scene tag changes tracked production content and adds one queue advance:

1. Update `packages/scripts/__snapshots__/compile-scenes.test.ts.snap` to the newly compiled `contentRevision`.
2. Update the measured Chapter 1 count in `apps/game/e2e-tauri/production-anchors.ts` from `N=273` to `N=274`; keep `DIALOGUE_DRAIN_CAP` unchanged.
3. Verify both surfaces:

```bash
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
bun run --cwd apps/game check:e2e
```

- [ ] **Step 12: Review and commit this contract slice**

`git diff` must show four clock-bearing prompt edits, the Scene 3 framing edit, the Scene 11 post-box cue after its causative action, current audit ownership/cue repair, the asset skill wording, and the required snapshot/E2E coupling updates; no reveal, hotspot, or unrelated story changes.

```bash
git add \
  docs/stories_plan/chapter_1/scene_p2.md \
  docs/stories_plan/chapter_1/investigation_scene_3.md \
  docs/stories_plan/chapter_1/investigation_scene_7.md \
  docs/stories_plan/chapter_1/scene_11.md \
  docs/stories_plan/chapter_1/background-variety-audit.md \
  .claude/skills/generating-lyra-image-assets/SKILL.md \
  apps/game/e2e-tauri/production-anchors.ts \
  packages/scripts/__snapshots__/compile-scenes.test.ts.snap
git commit -m "feat: close HPA-602 review gaps for old-clock raster continuity"
```

---

### Task 2: Regenerate all five old-clock state surfaces

**Files:**
- Modify: `static/assets/backgrounds/chapter_1/scene_p2/tag_002.png`
- Modify: `static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png`
- Modify: `static/assets/evidence/old_clock_photo.png`
- Modify: `static/assets/backgrounds/chapter_1/scene_11/tag_002.png`
- Add/regenerate: `static/assets/backgrounds/chapter_1/scene_11/tag_003.png`
- Shift existing Scene 11 rasters: `tag_003.png`–`tag_005.png` → `tag_004.png`–`tag_006.png`
- Inspect: `static/assets/backgrounds/chapter_1/investigation_scene_3/inner_entry.png`

**Interfaces:**
- Consumes: Task 1's four clock-bearing prompts, post-box prompt, and Scene 3 framing contract.
- Produces: four clock-bearing rasters satisfying identity dimensions 1–5, one post-box raster satisfying the resulting-state contract, and all five satisfying their placement/state criterion.

- [ ] **Step 1: Generate and normalize P2**

Use the repo asset skill and built-in image generation. Required result:

```text
wide 16:9 corridor-mouth view
inner-storage entrance at corridor endpoint
literal recurring clock identity on entrance inner wall
no exact clock time/readable text
lower dialogue area clear
```

Write opaque RGB `1920x1080` to `static/assets/backgrounds/chapter_1/scene_p2/tag_002.png`.

- [ ] **Step 2: Generate and normalize Scene 7 `inner.png`**

Use P2 as visual reference when supported, but rely on the authored prompt as durable truth. Reject output unless:

```text
same literal clock identity
clock mounted immediately inside fire door on entrance inner wall, never storage back wall
stopped hands: minute near 12, hour just before 11
one sharp diagonal impact crack across the lower-left dial, distinct from hairline crazing
high shelves preserve blocked corridor-side sightline
baked 黑瀨 remains right-side/perspective-correct
clock + shelf impact + phone + bean can + paperback landmarks remain unobstructed
```

Write opaque RGB `1920x1080` to `static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png`.

- [ ] **Step 3: Generate and normalize `old_clock_photo.png`**

Required result:

```text
isolated photo-print evidence composition
same literal clock identity and stopped hand position as Scene 7
same sharp diagonal lower-left dial crack as Scene 7
aged photo-print appearance retained
no readable numerals/timestamp/text
transparent background
```

Write RGBA `512x512` to `static/assets/evidence/old_clock_photo.png`.

- [ ] **Step 4: Generate and normalize Scene 11 `tag_002`**

Required result:

```text
empty Rain Bell cafe aftermath
same literal clock identity, stopped hand position, and post-impact dial crack
clock removed and resting naturally on counter
quiet afternoon / latte context
no readable text/numerals
lower dialogue area clear
```

Write opaque RGB `1920x1080` to `static/assets/backgrounds/chapter_1/scene_11/tag_002.png`.

- [ ] **Step 5: Generate and normalize Scene 11 `tag_003`**

Required result:

```text
same empty Rain Bell cafe afternoon/latte anchors as tag_002
closed cardboard box resting on the floor in the corner
clock no longer visible on the counter
umbrella stand at the frame edge near the door
no people or readable text
lower dialogue area clear
```

Write opaque RGB `1920x1080` to `static/assets/backgrounds/chapter_1/scene_11/tag_003.png`, and shift the former later rasters to `tag_004.png`–`tag_006.png` without regenerating their unrelated content.

- [ ] **Step 6: Run the split six-dimension side-by-side gate**

Open all five regenerated surfaces together. Require dimensions 1–5 for the four clock-visible surfaces (P2, Scene 7, evidence, Scene 11 `tag_002`):

```text
1. casing/rim — heavy black multi-ring metal bezel
2. dial/markers — cream enamel + hairline crazing + black baton marks + no numerals
3. hands — thick tapered black hands
4. wear — same aged finish + lower-right outer-ring scuff; Scene 7, evidence, and Scene 11 tag_002 share the same sharp lower-left dial crack; P2 stays intact
5. proportions — same round face / thick-bezel relationship
```

Apply dimension 6 to all five surfaces:

```text
6. placement/state — P2 and Scene 7 entrance-wall placement; Scene 7 blocked replay sightline; evidence photo of that clock; Scene 11 tag_002 removed-to-counter state; Scene 11 tag_003 closed-box state with no visible clock
```

Any failed applicable dimension means reject/regenerate the affected raster and repeat the complete five-surface gate. Do not accept a mismatch as follow-up work.

- [ ] **Step 7: Reinspect Scene 3 `inner_entry.png`**

Confirm the existing plate complies with the durable authored framing: camera at the fire-door threshold facing deeper into storage, entrance wall behind the camera and out of frame, no wall clock visible. Do not rely on the obsolete “not the interaction carrier” exemption, and do not regenerate the plate when it complies.

- [ ] **Step 8: Verify dimensions/color types**

```bash
file -b \
  static/assets/backgrounds/chapter_1/scene_p2/tag_002.png \
  static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png \
  static/assets/evidence/old_clock_photo.png \
  static/assets/backgrounds/chapter_1/scene_11/tag_002.png \
  static/assets/backgrounds/chapter_1/scene_11/tag_003.png
```

Required metadata:

```text
P2: 1920 x 1080, RGB
Scene 7: 1920 x 1080, RGB
old_clock_photo: 512 x 512, RGBA
Scene 11 tag_002: 1920 x 1080, RGB
Scene 11 tag_003: 1920 x 1080, RGB
```

Bit-depth/interlace wording may vary.

- [ ] **Step 9: Commit the raster family and tag shift**

```bash
git add \
  static/assets/backgrounds/chapter_1/scene_p2/tag_002.png \
  static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png \
  static/assets/evidence/old_clock_photo.png \
  static/assets/backgrounds/chapter_1/scene_11/tag_002.png \
  static/assets/backgrounds/chapter_1/scene_11/tag_003.png \
  static/assets/backgrounds/chapter_1/scene_11/tag_004.png \
  static/assets/backgrounds/chapter_1/scene_11/tag_005.png \
  static/assets/backgrounds/chapter_1/scene_11/tag_006.png
git commit -m "feat: close HPA-602 review gaps for old-clock raster continuity"
```

---

### Task 3: Verify and close the Axis 5 follow-up

**Files:**
- Modify: `docs/stories_plan/chapter_1/semantic-content-reaudit.md`

**Interfaces:**
- Consumes: accepted five-surface state family, durable Scene 3 framing confirmation, `file -b` output, compiler/audit results, and production-corpus snapshot/E2E coupling updates.
- Produces: durable HPA-602 Axis 5 `SHIP` closeout covering six inspected surfaces.

- [ ] **Step 1: Run final mechanical checks**

```bash
bun run scenes:compile
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
bun run test:scripts -- packages/scripts/compile-scenes.test.ts
bun run --cwd apps/game check:e2e
```

Expected: all exit 0. These commands are structural/report/coupling gates, not visual identity proof.

- [ ] **Step 2: Re-run only the old-clock Axis 5 item**

Review these six surfaces with `.claude/skills/reviewing-story-scenes/SKILL.md`:

```text
scene_p2/tag_002.png
investigation_scene_3/inner_entry.png
investigation_scene_7/inner.png
old_clock_photo.png
scene_11/tag_002.png
scene_11/tag_003.png
```

Verdict is `SHIP` only if the four clock-visible regeneration targets pass dimensions 1–5, all five regenerated surfaces pass their placement/state criterion, and Scene 3 complies with the durable out-of-frame entrance-wall framing.

- [ ] **Step 3: Replace the deferred HPA-602 block with the resolved closeout**

Use this block:

```markdown
### Resolved follow-up — old-clock raster continuity (HPA-602)

- **Status:** Resolved. Axis 5 clock-item verdict: `SHIP`.
- **Inspected surfaces:** `scene_p2/tag_002.png`, `investigation_scene_3/inner_entry.png`, `investigation_scene_7/inner.png`, `old_clock_photo.png`, `scene_11/tag_002.png`, `scene_11/tag_003.png`.
- **Regenerated surfaces:** `scene_p2/tag_002.png`, `investigation_scene_7/inner.png`, `old_clock_photo.png`, `scene_11/tag_002.png`, `scene_11/tag_003.png` (new post-box cue; former `scene_11` `tag_003`–`tag_005` shifted to `tag_004`–`tag_006`).
- **Durable identity:** round old analog café wall clock with a heavy black multi-ring metal bezel, aged cream enamel dial with fine hairline crazing, twelve short black baton hour markers and no numerals, thick tapered black hands, and a small scuff on the lower-right outer ring. Post-impact surfaces (Scene 7 background, `old_clock_photo`, Scene 11 `tag_002`) additionally carry one sharp diagonal impact crack crossing the lower-left of the cream dial, distinct from the hairline crazing; P2 stays intact. The owning asset prompts contain these literal traits.
- **Placement/sightline:** P2 and Scene 7 keep the clock on the inner-storage entrance wall; Scene 7 keeps the corridor-side replay sightline blocked by the existing shelf/fire-door geometry; Scene 11 `tag_002` shows the same clock removed to the counter through the packing beats, and the new `tag_003` cue shows the closed cardboard box in the corner with the clock no longer on the counter.
- **Stopped-time depiction:** Scene 7, evidence, and Scene 11 use only the vague analog late-night position (minute hand near 12, hour hand just before 11); exact `22:59` remains authored text, not readable raster content.
- **Asset policy:** `file -b` verifies the four backgrounds as RGB `1920x1080` PNGs and `old_clock_photo.png` as RGBA `512x512` PNG.
- **Mechanical verification:** `bun run scenes:compile` and `bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md` both exit 0 after the stale current `scene_8_5` report ownership is updated to `analysis_scene_8_5`.
- **Owner/tracking:** HPA-602 complete; no further old-clock visual follow-up remains.
- **Scene 3 inspection:** `inner_entry.png` renders the same inner-storage entrance, so its durability is owned by framing, not by the interaction-carrier argument: the `inner_entry` `Background Prompt` pins the camera at the fire-door threshold facing deeper into storage, with the entrance wall behind the camera out of frame and no wall clock visible. A regeneration therefore cannot contradict Scene 7's entrance-wall placement. Human confirmation that the existing plate complies with this framing is part of acceptance.
- **Review revision (2026-08-22):** external review of the first closeout found three gaps, all accepted and fixed on this branch: (1) the weak "not the clock-interaction carrier" Scene 3 exemption was replaced by the durable framing clause above; (2) Scene 11 gained the `tag_003` post-box cue so the authored boxing no longer plays over the clock-on-counter plate; (3) the previously evidence-only "cracked" state was unified into the literal post-impact dial crack carried across Scene 7 → evidence → Scene 11 and added to the six-dimension gate.
```

Do not create a replacement standalone Axis 5 report file.

- [ ] **Step 4: Verify final diff scope**

`git diff --name-only main...HEAD` may contain the two planning docs plus exactly these implementation files:

```text
.claude/skills/generating-lyra-image-assets/SKILL.md
apps/game/e2e-tauri/production-anchors.ts
docs/stories_plan/chapter_1/background-variety-audit.md
docs/stories_plan/chapter_1/investigation_scene_3.md
docs/stories_plan/chapter_1/investigation_scene_7.md
docs/stories_plan/chapter_1/scene_11.md
docs/stories_plan/chapter_1/scene_p2.md
docs/stories_plan/chapter_1/semantic-content-reaudit.md
packages/scripts/__snapshots__/compile-scenes.test.ts.snap
static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png
static/assets/backgrounds/chapter_1/scene_11/tag_002.png
static/assets/backgrounds/chapter_1/scene_11/tag_003.png
static/assets/backgrounds/chapter_1/scene_11/tag_004.png
static/assets/backgrounds/chapter_1/scene_11/tag_005.png
static/assets/backgrounds/chapter_1/scene_11/tag_006.png
static/assets/backgrounds/chapter_1/scene_p2/tag_002.png
static/assets/evidence/old_clock_photo.png
```

`investigation_scene_3/inner_entry.png` must not be in the diff; only its authored prompt changes.

- [ ] **Step 5: Commit closeout**

```bash
git add docs/stories_plan/chapter_1/semantic-content-reaudit.md
git commit -m "docs: close HPA-602 clock continuity audit"
```

- [ ] **Step 6: Record final PR evidence**

PR #68 must state:

```text
- five regenerated state surfaces and six inspected surfaces
- dimensions 1–5 pass on the four clock-visible rasters; placement/state passes on all five regenerated rasters
- Scene 3 durable framing and existing-plate confirmation
- shared post-impact crack across Scene 7, evidence, and Scene 11 tag_002
- Scene 11 post-box cue begins only after the box-closing/move action
- file -b dimensions/color types
- scenes:compile, background-cues:audit --check-report, focused compile-scenes snapshot test, and E2E type-check exit 0
- Axis 5 clock-item verdict SHIP
```

Do not mark HPA-602 Done until each statement is backed by the current branch.