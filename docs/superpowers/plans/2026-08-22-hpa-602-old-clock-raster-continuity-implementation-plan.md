# HPA-602 Old-Clock Raster Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regenerate the four player-facing Chapter 1 old-clock rasters as one durable physical prop, preserve the correct entrance-wall/sightline logic, and close the existing Axis 5 follow-up.

**Architecture:** Keep the clock baked into existing backgrounds/evidence. Put one literal clock identity into the four owning asset prompts, regenerate all four surfaces unconditionally, inspect the adjacent Scene 3 entrance plate for spatial context, and use human side-by-side review as the visual gate. Repair the already-red background-audit report baseline and make the asset skill's dimension-scan command explicit; add no new runtime/compiler/image-validation machinery.

**Tech Stack:** Authored Markdown, Lyra raster asset workflow, built-in OpenAI image generation, PNG normalization, `file(1)`, existing scene compiler/background audit.

**Spec:** `docs/superpowers/specs/2026-08-21-hpa-602-old-clock-raster-continuity-design.md`

## Global Constraints

- Deliver HPA-602 as this single PR.
- Regenerate exactly these four clock-bearing player surfaces:
  - `static/assets/backgrounds/chapter_1/scene_p2/tag_002.png`
  - `static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png`
  - `static/assets/evidence/old_clock_photo.png`
  - `static/assets/backgrounds/chapter_1/scene_11/tag_002.png`
- Inspect but do not regenerate `static/assets/backgrounds/chapter_1/investigation_scene_3/inner_entry.png`.
- Use this literal identity in every touched `Background Prompt` / `Image Prompt`:
  - **round old analog café wall clock with a heavy black multi-ring metal bezel, aged cream enamel dial with fine hairline crazing, twelve short black baton hour markers and no numerals, thick tapered black hands, and a small scuff on the lower-right outer ring**.
- P2: mounted on the inner-storage entrance's inner wall; no exact time required.
- Scene 7: same clock still mounted on that entrance wall, visible after crossing the fire door, not on the storage back wall, and consistent with Miyake being unable to see it from his 23:06 replay position.
- Scene 7/evidence/Scene 11 stopped state: minute hand nearly vertical at 12, hour hand just before 11; never render literal `22:59` or readable numerals.
- Scene 11: same clock removed from the wall and resting naturally on the café counter.
- Backgrounds remain opaque RGB PNG at exactly `1920x1080`.
- Evidence remains transparent/RGBA PNG at exactly `512x512`.
- Preserve all current asset IDs, paths, scene IDs, evidence IDs, hotspot/reveal wiring, story logic, and dialogue.
- Preserve Scene 7 room geometry, shelf-impact/phone/bean-can/paperback landmarks, baked 黑瀨 placement, floor clearance, and interaction readability.
- Do not add a clock sprite/overlay, image-similarity/CV/screenshot infrastructure, new validation script, generic prop-continuity framework, compiler/runtime/layout change, Chapter 2 work, or a follow-up ticket for a mismatch found here.
- Generated JSON under `apps/game/src-tauri/resources/**` remains untracked and is never hand-edited.

---

### Task 1: Make the identity and verification contracts durable

**Files:**
- Modify: `docs/stories_plan/chapter_1/scene_p2.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_7.md`
- Modify: `docs/stories_plan/chapter_1/scene_11.md`
- Modify: `docs/stories_plan/chapter_1/background-variety-audit.md`
- Modify: `.claude/skills/generating-lyra-image-assets/SKILL.md`
- Inspect: `static/assets/backgrounds/chapter_1/investigation_scene_3/inner_entry.png`

**Interfaces:**
- Produces: four authored asset prompts containing the same literal clock identity.
- Produces: Scene 7 prompt geometry that pins the clock to the entrance wall.
- Produces: a greenable background-audit report aligned with current `analysis_scene_8_5` ownership.
- Produces: an explicit reusable `file -b` dimension/color-type verification command in the asset skill.
- Preserves: all story/evidence semantics and the historical frozen-manifest record.

- [ ] **Step 1: Read the owning asset/review contracts and inspect the five-surface context**

Read:

```text
.claude/skills/generating-lyra-image-assets/SKILL.md
.claude/skills/reviewing-story-scenes/SKILL.md
static/assets/config/policy.yaml
```

Open these five rasters together with the available project image viewer:

```text
static/assets/backgrounds/chapter_1/scene_p2/tag_002.png
static/assets/backgrounds/chapter_1/investigation_scene_3/inner_entry.png
static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png
static/assets/evidence/old_clock_photo.png
static/assets/backgrounds/chapter_1/scene_11/tag_002.png
```

Record only one Scene 3 disposition in working notes:

```text
scene3_inner_entry_context = wall-not-exposed | wall-exposed-but-nonblocking
```

Do not add Scene 3 to the regeneration set.

- [ ] **Step 2: Patch the P2 `Background Prompt` with the literal identity**

Replace the existing P2 clock prompt with:

```markdown
- **Background Prompt:** Eye-level medium-wide establishing view from the corridor mouth, camera pulled back to frame the narrow back corridor of a small Tokyo cafe leading to the inner-storage entrance at its end, focal area a round old analog cafe wall clock with a heavy black multi-ring metal bezel, aged cream enamel dial with fine hairline crazing, twelve short black baton hour markers and no numerals, thick tapered black hands, and a small scuff on the lower-right outer ring, mounted on the entrance's inner wall above stacked supply boxes, dim service light, quiet operational mood, no people, no readable text, keep the lower composition clear and uncluttered for dialogue UI.
```

Change no adjacent action/dialogue/BGS.

- [ ] **Step 3: Patch the Scene 7 `inner` `Background Prompt` with identity + placement**

Replace only the sublocation `Background Prompt` with wording equivalent to this exact contract:

```markdown
- **Background Prompt:** Cold inner storage room of a small Tokyo cafe, high metal shelves casting long shadows and preserving the blocked sightline from the corridor-side replay position, hard sensor light, shelf impact mark on floor. Immediately inside the fire door, on the inner-storage entrance's inner wall rather than the deep storage back wall, mount the recurring round old analog cafe wall clock with a heavy black multi-ring metal bezel, aged cream enamel dial with fine hairline crazing, twelve short black baton hour markers and no numerals, thick tapered black hands, and a small scuff on the lower-right outer ring; its minute hand is nearly vertical at 12 and its hour hand is just before 11, with no readable time text. Detective Kurose Toru baked into the right side of the storage room: stocky weathered middle-aged man, wrinkled brown-gray field coat, worn dark leather shoes, thick hands, standing with slow steady footing as he leads the inspection, deep crow's-feet and night-shift weariness, perspective-correct scale and lighting under the hard sensor light, not covering the clock, shelf impact mark, phone drop position, bean can, or paperback hotspot.
```

Keep hotspot geometry, `Scene Source Prompt`, reveals, and dialogue unchanged.

- [ ] **Step 4: Patch `old_clock_photo` `Image Prompt` with the same literal identity**

Replace only the evidence `Image Prompt` with:

```markdown
- **Image Prompt:** Isolated photo print of the recurring round old analog cafe wall clock examined at the inner-storage entrance, with a heavy black multi-ring metal bezel, aged cream enamel dial with fine hairline crazing, twelve short black baton hour markers and no numerals, thick tapered black hands, and a small scuff on the lower-right outer ring; stopped at a vague late-night position with the minute hand nearly vertical at 12 and the hour hand just before 11, cracked shadowed aged appearance, no readable timestamp or text, transparent evidence-icon composition.
```

Keep Name, Description, Details, Source Sublocation, reveal wiring, and On Collect dialogue unchanged.

- [ ] **Step 5: Patch the Scene 11 `Background Prompt` with the same literal identity**

Replace only the empty-café clock-shot prompt with:

```markdown
- **Background Prompt:** Empty Rain Bell cafe interior in afternoon light, a latte cup on a wooden table, the recurring round old analog cafe wall clock from the back-corridor inner-storage entrance now removed from the wall and resting naturally on the counter, with a heavy black multi-ring metal bezel, aged cream enamel dial with fine hairline crazing, twelve short black baton hour markers and no numerals, thick tapered black hands, and a small scuff on the lower-right outer ring; its minute hand is nearly vertical at 12 and its hour hand is just before 11, no readable clock numerals or other text, quiet unresolved stillness.
```

Change no adjacent story copy/BGM/BGS.

- [ ] **Step 6: Repair the already-red background-audit report baseline**

In `docs/stories_plan/chapter_1/background-variety-audit.md`:

1. Keep the historical **Frozen production manifest** entry `scene_8_5.md` unchanged.
2. Change only the **Current accepted manifest** entry from:

```text
14. `scene_8_5.md`
```

to:

```text
14. `analysis_scene_8_5.md`
```

3. Change the current cue row key from:

```text
chapter_1/scene_8_5.json::/queue/0/assetCue/backgroundAssetId
```

to:

```text
chapter_1/analysis_scene_8_5.json::/intro/0/assetCue/backgroundAssetId
```

Keep the row's Police station vending corridor semantics/decision/priority unchanged.

4. Update the current-state prose immediately above the current accepted manifest to mention that HPA-265 later replaced the former linear `scene_8_5.md` with `analysis_scene_8_5.md`. Do not rewrite the historical freeze.

- [ ] **Step 7: Make the asset skill's dimension scan concrete**

In `.claude/skills/generating-lyra-image-assets/SKILL.md`, replace the vague verification bullet:

```text
- a dimension scan for touched asset types
```

with:

```text
- on Unix-like development/CI hosts, run `file -b <touched PNG paths>` and verify each output reports the policy dimensions plus RGB for opaque backgrounds or RGBA for transparent portrait/evidence assets; use an equivalent image-metadata inspector only when `file` is unavailable
```

Do not add a repo script or PNG parser.

- [ ] **Step 8: Compile and prove the repaired audit baseline before art generation**

Run:

```bash
bun run scenes:compile
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

Expected: both exit 0. If the audit still reports any stale/missing cue key, stop and repair only the report row/current-manifest drift required by the current compiler output before generating art.

- [ ] **Step 9: Inspect the authored diff**

Run:

```bash
git diff -- \
  docs/stories_plan/chapter_1/scene_p2.md \
  docs/stories_plan/chapter_1/investigation_scene_7.md \
  docs/stories_plan/chapter_1/scene_11.md \
  docs/stories_plan/chapter_1/background-variety-audit.md \
  .claude/skills/generating-lyra-image-assets/SKILL.md
```

Expected:

- only the four owning asset prompts change in the three scene files;
- no dialogue/evidence semantics/reveal wiring changes;
- only current (not frozen historical) `scene_8_5` audit ownership changes;
- asset skill changes only the dimension-scan instruction.

- [ ] **Step 10: Commit the durable contracts**

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
- Consumes: the four durable prompts from Task 1.
- Produces: one four-surface clock family satisfying the six-dimension gate.
- Preserves: existing background/evidence paths and Scene 7 interaction landmarks.

- [ ] **Step 1: Generate P2 from its live authored prompt**

Use `.claude/skills/generating-lyra-image-assets/SKILL.md` and one built-in image-generation call.

Required composition/state:

```text
wide 16:9 story background
corridor-mouth medium-wide view
inner-storage entrance is the corridor endpoint
clock mounted on entrance inner wall above/near supplies
literal durable identity from Task 1
no exact clock time
no readable text/logos/watermark
lower dialogue area clear
```

Copy/normalize the accepted output to:

```text
static/assets/backgrounds/chapter_1/scene_p2/tag_002.png
```

Normalize to opaque RGB `1920x1080` without non-uniform stretching.

- [ ] **Step 2: Generate Scene 7 `inner.png` from its live authored prompt**

Use the accepted P2 clock as a visual reference when the available generation workflow supports it; the authored prompt remains sufficient without the reference.

Reject any output that violates one of these anchors:

```text
same literal clock identity
clock on entrance inner wall, not storage back wall
stopped hands: minute near 12, hour just before 11
high shelves preserve blocked corridor-side sightline
baked 黑瀨 remains on right, perspective-correct
clock / shelf-impact / phone-drop / bean-can / paperback landmarks unobstructed
hard sensor-light/cold-storage mood preserved
no readable numerals/text
```

Copy/normalize to opaque RGB `1920x1080` at:

```text
static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png
```

- [ ] **Step 3: Generate `old_clock_photo.png` from its live evidence prompt**

Use one built-in image-generation call with the evidence transparent workflow.

Required result:

```text
photo-print / isolated evidence composition
same literal clock identity as P2/Scene 7
same stopped analog hand position as Scene 7
cracked/aged appearance retained
no readable numerals/timestamp/text
transparent background
```

Copy/normalize to RGBA `512x512` at:

```text
static/assets/evidence/old_clock_photo.png
```

- [ ] **Step 4: Generate Scene 11 from its live authored prompt**

Use the accepted clock identity/reference and preserve the state change:

```text
empty Rain Bell cafe aftermath
same literal clock identity
clock removed from wall and resting naturally on counter
same stopped analog hand position
quiet afternoon / latte context
no people/readable numerals/text/logos/watermark
lower dialogue area clear
```

Copy/normalize to opaque RGB `1920x1080` at:

```text
static/assets/backgrounds/chapter_1/scene_11/tag_002.png
```

- [ ] **Step 5: Run the six-dimension side-by-side gate**

Open together:

```text
scene_p2/tag_002.png
investigation_scene_7/inner.png
old_clock_photo.png
scene_11/tag_002.png
```

Verify all six dimensions:

```text
1. casing/rim — heavy black multi-ring metal bezel
2. dial/markers — cream enamel + hairline crazing + black baton marks + no numerals
3. hands — thick tapered black hands
4. wear — same aged finish + lower-right outer-ring scuff
5. proportions — same round face / thick-bezel relationship
6. placement/sightline — correct mounted/photo/removed state for each scene; Scene 7 entrance-wall placement remains compatible with Miyake not seeing the clock from his replay position
```

Mismatch rule:

```text
any failed dimension -> reject the affected raster -> regenerate within HPA-602 -> repeat the full four-surface gate
```

Do not file a follow-up for an accepted known mismatch.

- [ ] **Step 6: Re-open Scene 3 `inner_entry.png` beside the accepted family**

Confirm the inspection-only plate does not introduce a direct spatial contradiction with the selected entrance-wall placement. Record one of these dispositions for the closeout:

```text
Scene 3 plate does not expose the precise clock wall; no change required.
Scene 3 plate exposes entrance geometry but remains non-blocking because the clock interaction is not represented on that plate; no change required.
```

Do not regenerate Scene 3 in this ticket.

- [ ] **Step 7: Verify raster metadata with the reusable skill command**

Run:

```bash
file -b \
  static/assets/backgrounds/chapter_1/scene_p2/tag_002.png \
  static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png \
  static/assets/evidence/old_clock_photo.png \
  static/assets/backgrounds/chapter_1/scene_11/tag_002.png
```

Expected:

```text
P2 background: PNG image data, 1920 x 1080, ... RGB ...
Scene 7 background: PNG image data, 1920 x 1080, ... RGB ...
old_clock_photo evidence: PNG image data, 512 x 512, ... RGBA ...
Scene 11 background: PNG image data, 1920 x 1080, ... RGB ...
```

Exact bit-depth/interlace wording may vary; dimensions and RGB/RGBA type are the gate.

- [ ] **Step 8: Commit the four regenerated rasters**

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
- Verify only: all Task 1/2 files

**Interfaces:**
- Consumes: accepted four-surface family, Scene 3 inspection disposition, raster metadata, compiler/audit results.
- Produces: durable HPA-602 Axis 5 `SHIP` closeout in the existing re-audit document.

- [ ] **Step 1: Run final compiler and audit checks**

Run:

```bash
bun run scenes:compile
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

Expected: both exit 0.

Do not treat these commands as visual proof; the Task 2 side-by-side gate owns clock identity/placement acceptance.

- [ ] **Step 2: Re-run only the old-clock Axis 5 item**

Use `.claude/skills/reviewing-story-scenes/SKILL.md` visual/background criteria against:

```text
static/assets/backgrounds/chapter_1/scene_p2/tag_002.png
static/assets/backgrounds/chapter_1/investigation_scene_3/inner_entry.png
static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png
static/assets/evidence/old_clock_photo.png
static/assets/backgrounds/chapter_1/scene_11/tag_002.png
```

Required verdict: `SHIP` only if the four regeneration targets pass the six-dimension gate and the Scene 3 inspection-only plate has a recorded non-blocking spatial disposition.

- [ ] **Step 3: Replace the deferred HPA-602 section with the resolved closeout**

In `docs/stories_plan/chapter_1/semantic-content-reaudit.md`, replace only the current `### Deferred follow-up — old-clock raster continuity` block with:

```markdown
### Resolved follow-up — old-clock raster continuity (HPA-602)

- **Status:** Resolved. Axis 5 clock-item verdict: `SHIP`.
- **Inspected surfaces:** `scene_p2/tag_002.png`, `investigation_scene_3/inner_entry.png`, `investigation_scene_7/inner.png`, `old_clock_photo.png`, `scene_11/tag_002.png`.
- **Regenerated surfaces:** `scene_p2/tag_002.png`, `investigation_scene_7/inner.png`, `old_clock_photo.png`, `scene_11/tag_002.png`.
- **Durable identity:** round old analog café wall clock with a heavy black multi-ring metal bezel, aged cream enamel dial with fine hairline crazing, twelve short black baton hour markers and no numerals, thick tapered black hands, and a small scuff on the lower-right outer ring. The four owning asset prompts now carry those literal traits.
- **Placement/sightline:** P2 and Scene 7 keep the clock on the inner-storage entrance wall; Scene 7 keeps the corridor-side replay sightline blocked by the existing shelf/fire-door geometry; Scene 11 shows the same clock removed to the counter.
- **Stopped-time depiction:** Scene 7, evidence, and Scene 11 use only the vague analog late-night position (minute hand near 12, hour hand just before 11); exact `22:59` remains authored text, not readable raster content.
- **Scene 3 inspection:** record the Task 2 Step 6 disposition here; no Scene 3 raster regeneration was required by HPA-602.
- **Asset policy:** `file -b` verifies the three backgrounds as RGB `1920x1080` PNGs and `old_clock_photo.png` as RGBA `512x512` PNG.
- **Mechanical verification:** `bun run scenes:compile` and `bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md` both exit 0 after the stale `scene_8_5` report ownership is updated to `analysis_scene_8_5`.
- **Owner/tracking:** HPA-602 complete; no further old-clock visual follow-up remains.
```

Replace `record the Task 2 Step 6 disposition here` with the exact disposition sentence already selected in Task 2. Do not create a separate Axis 5 report file.

- [ ] **Step 4: Inspect final scope**

Run:

```bash
git diff --stat main...HEAD
git diff --name-only main...HEAD
```

Expected implementation surface beyond the two planning docs:

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

`investigation_scene_3/inner_entry.png` must not appear in the diff.

- [ ] **Step 5: Commit the closeout**

```bash
git add docs/stories_plan/chapter_1/semantic-content-reaudit.md
git commit -m "docs: close HPA-602 clock continuity audit"
```

- [ ] **Step 6: Final PR verification summary**

Record in PR #68:

```text
- four regenerated clock surfaces pass the six-dimension side-by-side identity/placement gate
- Scene 3 inner_entry inspection disposition
- file -b dimensions/color types
- scenes:compile result
- background-cues:audit --check-report result
- Axis 5 clock-item verdict SHIP
```

Do not mark HPA-602 Done until all six lines are backed by the current branch.