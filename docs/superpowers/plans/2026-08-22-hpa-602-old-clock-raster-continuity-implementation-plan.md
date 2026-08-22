# HPA-602 Old-Clock Raster Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regenerate the four player-facing Chapter 1 old-clock rasters as one durable physical prop, preserve the correct entrance-wall/sightline logic, and close the existing Axis 5 follow-up.

**Architecture:** Keep the clock baked into existing backgrounds/evidence. Put one literal clock identity into the four owning asset prompts, regenerate all four surfaces unconditionally, inspect the adjacent Scene 3 entrance plate for spatial context, and use human side-by-side review as the visual gate. Repair the already-red background-audit report baseline and make the asset skill's dimension-scan command explicit; add no new runtime/compiler/image-validation machinery.

**Tech Stack:** Authored Markdown, Lyra raster asset workflow, built-in OpenAI image generation, PNG normalization, `file(1)`, existing scene compiler/background audit.

**Spec:** `docs/superpowers/specs/2026-08-21-hpa-602-old-clock-raster-continuity-design.md`

## Global Constraints

- Deliver HPA-602 as this single PR.
- Regenerate exactly:
  - `static/assets/backgrounds/chapter_1/scene_p2/tag_002.png`
  - `static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png`
  - `static/assets/evidence/old_clock_photo.png`
  - `static/assets/backgrounds/chapter_1/scene_11/tag_002.png`
- Inspect but do not regenerate `static/assets/backgrounds/chapter_1/investigation_scene_3/inner_entry.png`.
- Use this literal identity in every touched asset prompt: **round old analog café wall clock with a heavy black multi-ring metal bezel, aged cream enamel dial with fine hairline crazing, twelve short black baton hour markers and no numerals, thick tapered black hands, and a small scuff on the lower-right outer ring**.
- P2: mounted on the inner-storage entrance's inner wall; no exact time required.
- Scene 7: same clock still on that entrance wall, visible after crossing the fire door, not on the deep storage back wall, and consistent with Miyake being unable to see it from his 23:06 replay position.
- Scene 7/evidence/Scene 11 stopped state: minute hand nearly vertical at 12, hour hand just before 11; never render literal `22:59` or readable numerals.
- Scene 11: same clock removed from the wall and resting on the café counter.
- Backgrounds: opaque RGB PNG, exactly `1920x1080`.
- Evidence: transparent/RGBA PNG, exactly `512x512`.
- Preserve all current IDs, paths, scene/evidence semantics, hotspot/reveal wiring, dialogue, and Scene 7 interaction landmarks/baked 黑瀨 placement.
- No sprite/overlay, new IDs, compiler/runtime/layout work, image-similarity/CV/screenshot infrastructure, new validation script, generic prop framework, unrelated Chapter 1 regeneration, Chapter 2 work, or follow-up ticket for a mismatch found here.
- Generated JSON under `apps/game/src-tauri/resources/**` stays untracked and is never hand-edited.

---

### Task 1: Make identity and verification contracts durable

**Files:**
- Modify: `docs/stories_plan/chapter_1/scene_p2.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_7.md`
- Modify: `docs/stories_plan/chapter_1/scene_11.md`
- Modify: `docs/stories_plan/chapter_1/background-variety-audit.md`
- Modify: `.claude/skills/generating-lyra-image-assets/SKILL.md`
- Inspect: `static/assets/backgrounds/chapter_1/investigation_scene_3/inner_entry.png`

**Interfaces:**
- Produces: four asset prompts containing the same literal physical identity.
- Produces: Scene 7 prompt geometry pinning the clock to the entrance wall.
- Produces: a background-audit report aligned with current `analysis_scene_8_5` ownership.
- Produces: explicit reusable `file -b` raster metadata verification in the asset skill.

- [ ] **Step 1: Inspect the five-surface spatial context before edits**

Read the asset/review skills plus `static/assets/config/policy.yaml`, then open together:

```text
static/assets/backgrounds/chapter_1/scene_p2/tag_002.png
static/assets/backgrounds/chapter_1/investigation_scene_3/inner_entry.png
static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png
static/assets/evidence/old_clock_photo.png
static/assets/backgrounds/chapter_1/scene_11/tag_002.png
```

For Scene 3, select exactly one inspection disposition for Task 3:

```text
A. The Scene 3 inner-entry plate does not expose the precise clock wall; no change required.
B. The Scene 3 inner-entry plate exposes entrance geometry but remains non-blocking because it is not the clock-interaction carrier; no change required.
```

Do not regenerate Scene 3.

- [ ] **Step 2: Patch P2's `Background Prompt`**

Use exactly this asset contract:

```markdown
- **Background Prompt:** Eye-level medium-wide establishing view from the corridor mouth, camera pulled back to frame the narrow back corridor of a small Tokyo cafe leading to the inner-storage entrance at its end, focal area a round old analog cafe wall clock with a heavy black multi-ring metal bezel, aged cream enamel dial with fine hairline crazing, twelve short black baton hour markers and no numerals, thick tapered black hands, and a small scuff on the lower-right outer ring, mounted on the entrance's inner wall above stacked supply boxes, dim service light, quiet operational mood, no people, no readable text, keep the lower composition clear and uncluttered for dialogue UI.
```

Change no adjacent action/dialogue/BGS.

- [ ] **Step 3: Patch Scene 7's `inner` `Background Prompt`**

Use this contract, retaining all existing room/黑瀨 anchors:

```markdown
- **Background Prompt:** Cold inner storage room of a small Tokyo cafe, high metal shelves casting long shadows and preserving the blocked sightline from the corridor-side replay position, hard sensor light, shelf impact mark on floor. Immediately inside the fire door, on the inner-storage entrance's inner wall rather than the deep storage back wall, mount the recurring round old analog cafe wall clock with a heavy black multi-ring metal bezel, aged cream enamel dial with fine hairline crazing, twelve short black baton hour markers and no numerals, thick tapered black hands, and a small scuff on the lower-right outer ring; its minute hand is nearly vertical at 12 and its hour hand is just before 11, with no readable time text. Detective Kurose Toru baked into the right side of the storage room: stocky weathered middle-aged man, wrinkled brown-gray field coat, worn dark leather shoes, thick hands, standing with slow steady footing as he leads the inspection, deep crow's-feet and night-shift weariness, perspective-correct scale and lighting under the hard sensor light, not covering the clock, shelf impact mark, phone drop position, bean can, or paperback hotspot.
```

Keep hotspot geometry, `Scene Source Prompt`, reveals, and dialogue unchanged.

- [ ] **Step 4: Patch `old_clock_photo` `Image Prompt`**

Use:

```markdown
- **Image Prompt:** Isolated photo print of the recurring round old analog cafe wall clock examined at the inner-storage entrance, with a heavy black multi-ring metal bezel, aged cream enamel dial with fine hairline crazing, twelve short black baton hour markers and no numerals, thick tapered black hands, and a small scuff on the lower-right outer ring; stopped at a vague late-night position with the minute hand nearly vertical at 12 and the hour hand just before 11, cracked shadowed aged appearance, no readable timestamp or text, transparent evidence-icon composition.
```

Keep Name, Description, Details, Source Sublocation, reveal wiring, and On Collect dialogue unchanged.

- [ ] **Step 5: Patch Scene 11's `Background Prompt`**

Use:

```markdown
- **Background Prompt:** Empty Rain Bell cafe interior in afternoon light, a latte cup on a wooden table, the recurring round old analog cafe wall clock from the back-corridor inner-storage entrance now removed from the wall and resting naturally on the counter, with a heavy black multi-ring metal bezel, aged cream enamel dial with fine hairline crazing, twelve short black baton hour markers and no numerals, thick tapered black hands, and a small scuff on the lower-right outer ring; its minute hand is nearly vertical at 12 and its hour hand is just before 11, no readable clock numerals or other text, quiet unresolved stillness.
```

Change no story copy/BGM/BGS.

- [ ] **Step 6: Repair the already-red background-audit report baseline**

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

- [ ] **Step 7: Make the asset skill's dimension scan concrete**

Replace its vague `a dimension scan for touched asset types` bullet with:

```text
- on Unix-like development/CI hosts, run `file -b <touched PNG paths>` and verify each output reports the policy dimensions plus RGB for opaque backgrounds or RGBA for transparent portrait/evidence assets; use an equivalent image-metadata inspector only when `file` is unavailable
```

Do not add a script or PNG parser.

- [ ] **Step 8: Compile and prove the repaired audit baseline before art generation**

```bash
bun run scenes:compile
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

Expected: both exit 0. If coverage still reports a stale/missing cue key, repair only current report ownership required by the compiler output before continuing.

- [ ] **Step 9: Review and commit this contract slice**

`git diff` must show only four asset-prompt edits, current audit ownership repair, and the skill's dimension-scan wording; no story/reveal changes.

```bash
git add \
  docs/stories_plan/chapter_1/scene_p2.md \
  docs/stories_plan/chapter_1/investigation_scene_7.md \
  docs/stories_plan/chapter_1/scene_11.md \
  docs/stories_plan/chapter_1/background-variety-audit.md \
  .claude/skills/generating-lyra-image-assets/SKILL.md
git commit -m "docs: lock Chapter 1 old-clock asset identity"
```

---

### Task 2: Regenerate all four old-clock surfaces

**Files:**
- Modify: `static/assets/backgrounds/chapter_1/scene_p2/tag_002.png`
- Modify: `static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png`
- Modify: `static/assets/evidence/old_clock_photo.png`
- Modify: `static/assets/backgrounds/chapter_1/scene_11/tag_002.png`
- Inspect: `static/assets/backgrounds/chapter_1/investigation_scene_3/inner_entry.png`

**Interfaces:**
- Consumes: Task 1's four durable prompts.
- Produces: one four-surface family satisfying the six-dimension visual gate.

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
high shelves preserve blocked corridor-side sightline
baked 黑瀨 remains right-side/perspective-correct
clock + shelf impact + phone + bean can + paperback landmarks remain unobstructed
```

Write opaque RGB `1920x1080` to `static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png`.

- [ ] **Step 3: Generate and normalize `old_clock_photo.png`**

Required result:

```text
isolated photo-print evidence composition
same literal clock identity
same stopped hand position as Scene 7
cracked/aged appearance retained
no readable numerals/timestamp/text
transparent background
```

Write RGBA `512x512` to `static/assets/evidence/old_clock_photo.png`.

- [ ] **Step 4: Generate and normalize Scene 11**

Required result:

```text
empty Rain Bell cafe aftermath
same literal clock identity
clock removed and resting naturally on counter
same stopped hand position
quiet afternoon / latte context
no readable text/numerals
lower dialogue area clear
```

Write opaque RGB `1920x1080` to `static/assets/backgrounds/chapter_1/scene_11/tag_002.png`.

- [ ] **Step 5: Run the six-dimension side-by-side gate**

Open all four regenerated surfaces together and require:

```text
1. casing/rim — heavy black multi-ring metal bezel
2. dial/markers — cream enamel + hairline crazing + black baton marks + no numerals
3. hands — thick tapered black hands
4. wear — same aged finish + lower-right outer-ring scuff
5. proportions — same round face / thick-bezel relationship
6. placement/sightline — P2 and Scene 7 entrance-wall placement; Scene 7 blocked replay sightline; evidence photo of that clock; Scene 11 removed-to-counter state
```

Any failed dimension means reject/regenerate the affected raster and repeat the complete four-surface gate. Do not accept a mismatch as follow-up work.

- [ ] **Step 6: Reinspect Scene 3 `inner_entry.png`**

Compare it with the accepted entrance-wall placement and retain the exact A or B disposition selected in Task 1 Step 1. Do not regenerate it.

- [ ] **Step 7: Verify dimensions/color types**

```bash
file -b \
  static/assets/backgrounds/chapter_1/scene_p2/tag_002.png \
  static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png \
  static/assets/evidence/old_clock_photo.png \
  static/assets/backgrounds/chapter_1/scene_11/tag_002.png
```

Required metadata:

```text
P2: 1920 x 1080, RGB
Scene 7: 1920 x 1080, RGB
old_clock_photo: 512 x 512, RGBA
Scene 11: 1920 x 1080, RGB
```

Bit-depth/interlace wording may vary.

- [ ] **Step 8: Commit the raster family**

```bash
git add \
  static/assets/backgrounds/chapter_1/scene_p2/tag_002.png \
  static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png \
  static/assets/evidence/old_clock_photo.png \
  static/assets/backgrounds/chapter_1/scene_11/tag_002.png
git commit -m "feat: unify Chapter 1 old-clock rasters"
```

---

### Task 3: Verify and close the Axis 5 follow-up

**Files:**
- Modify: `docs/stories_plan/chapter_1/semantic-content-reaudit.md`

**Interfaces:**
- Consumes: accepted four-surface family, Scene 3 inspection disposition, `file -b` output, compiler/audit results.
- Produces: durable HPA-602 Axis 5 `SHIP` closeout.

- [ ] **Step 1: Run final mechanical checks**

```bash
bun run scenes:compile
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

Expected: both exit 0. These commands are structural/report gates, not visual identity proof.

- [ ] **Step 2: Re-run only the old-clock Axis 5 item**

Review these five surfaces with `.claude/skills/reviewing-story-scenes/SKILL.md`:

```text
scene_p2/tag_002.png
investigation_scene_3/inner_entry.png
investigation_scene_7/inner.png
old_clock_photo.png
scene_11/tag_002.png
```

Verdict is `SHIP` only if the four regeneration targets pass all six dimensions and Scene 3 has the recorded A/B non-blocking disposition.

- [ ] **Step 3: Replace the deferred HPA-602 block with the resolved closeout**

Use this common block:

```markdown
### Resolved follow-up — old-clock raster continuity (HPA-602)

- **Status:** Resolved. Axis 5 clock-item verdict: `SHIP`.
- **Inspected surfaces:** `scene_p2/tag_002.png`, `investigation_scene_3/inner_entry.png`, `investigation_scene_7/inner.png`, `old_clock_photo.png`, `scene_11/tag_002.png`.
- **Regenerated surfaces:** `scene_p2/tag_002.png`, `investigation_scene_7/inner.png`, `old_clock_photo.png`, `scene_11/tag_002.png`.
- **Durable identity:** round old analog café wall clock with a heavy black multi-ring metal bezel, aged cream enamel dial with fine hairline crazing, twelve short black baton hour markers and no numerals, thick tapered black hands, and a small scuff on the lower-right outer ring. The four owning asset prompts contain these literal traits.
- **Placement/sightline:** P2 and Scene 7 keep the clock on the inner-storage entrance wall; Scene 7 keeps the corridor-side replay sightline blocked by the existing shelf/fire-door geometry; Scene 11 shows the same clock removed to the counter.
- **Stopped-time depiction:** Scene 7, evidence, and Scene 11 use only the vague analog late-night position (minute hand near 12, hour hand just before 11); exact `22:59` remains authored text, not readable raster content.
- **Asset policy:** `file -b` verifies the three backgrounds as RGB `1920x1080` PNGs and `old_clock_photo.png` as RGBA `512x512` PNG.
- **Mechanical verification:** `bun run scenes:compile` and `bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md` both exit 0 after the stale current `scene_8_5` report ownership is updated to `analysis_scene_8_5`.
- **Owner/tracking:** HPA-602 complete; no further old-clock visual follow-up remains.
```

Then append exactly one of these two lines, matching Task 1 Step 1:

```markdown
- **Scene 3 inspection:** The `inner_entry.png` plate does not expose the precise clock wall; no change required.
```

or

```markdown
- **Scene 3 inspection:** The `inner_entry.png` plate exposes entrance geometry but remains non-blocking because it is not the clock-interaction carrier; no change required.
```

Do not create a replacement standalone Axis 5 report file.

- [ ] **Step 4: Verify final diff scope**

`git diff --name-only main...HEAD` may contain the two planning docs plus exactly these implementation files:

```text
.claude/skills/generating-lyra-image-assets/SKILL.md
docs/stories_plan/chapter_1/background-variety-audit.md
docs/stories_plan/chapter_1/investigation_scene_7.md
docs/stories_plan/chapter_1/scene_11.md
docs/stories_plan/chapter_1/scene_p2.md
docs/stories_plan/chapter_1/semantic-content-reaudit.md
static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png
static/assets/backgrounds/chapter_1/scene_11/tag_002.png
static/assets/backgrounds/chapter_1/scene_p2/tag_002.png
static/assets/evidence/old_clock_photo.png
```

`investigation_scene_3/inner_entry.png` must not be in the diff.

- [ ] **Step 5: Commit closeout**

```bash
git add docs/stories_plan/chapter_1/semantic-content-reaudit.md
git commit -m "docs: close HPA-602 clock continuity audit"
```

- [ ] **Step 6: Record final PR evidence**

PR #68 must state:

```text
- four regenerated clock surfaces pass six-dimension side-by-side identity/placement review
- Scene 3 A/B inspection disposition
- file -b dimensions/color types
- scenes:compile exit 0
- background-cues:audit --check-report exit 0
- Axis 5 clock-item verdict SHIP
```

Do not mark HPA-602 Done until each statement is backed by the current branch.