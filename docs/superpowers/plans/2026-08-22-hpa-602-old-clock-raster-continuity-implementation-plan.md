# HPA-602 Old-Clock Raster Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all four player-facing Chapter 1 old-clock surfaces read as one physical clock, with P2 as the pre-murder seed, Scene 7 and its Case File photo as the stopped inspection state, and Scene 11 as the removed-clock payoff.

**Architecture:** Keep the clock baked into existing background/evidence rasters. Lock a shared visual identity before generation, harden the authored Scene 11 prompt as the durable contract, regenerate the two named HPA-602 backgrounds, and conditionally regenerate the Scene 7/evidence siblings only if the four-surface identity gate fails. No renderer/compiler/runtime mechanism is added.

**Tech Stack:** Authored Markdown, Lyra raster asset pipeline, built-in OpenAI image generation, PNG normalization, Python standard-library PNG inspection, existing scene compiler/background audit.

**Spec:** `docs/superpowers/specs/2026-08-21-hpa-602-old-clock-raster-continuity-design.md`

## Global Constraints

- Deliver HPA-602 in this single PR; do not split asset, prompt, or closeout work.
- The four identity surfaces are:
  - `static/assets/backgrounds/chapter_1/scene_p2/tag_002.png`
  - `static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png`
  - `static/assets/evidence/old_clock_photo.png`
  - `static/assets/backgrounds/chapter_1/scene_11/tag_002.png`
- P2 and Scene 11 backgrounds are always regenerated.
- Scene 7 `inner.png` and `old_clock_photo.png` are mandatory siblings: inspect them and regenerate them in this PR if they fail the identity gate.
- `scene_11.md` receives a required prompt hardening before generation.
- `scene_p2.md` stays unchanged unless two rejected generation attempts show that its current prompt cannot reproduce the authored corridor/entrance composition.
- Scene 7 authored prompt(s) change only if Scene 7/evidence rasters are regenerated.
- Stopped time is visualized only as a vague analog late-night position: minute hand near 12, hour hand near 11. Do not render literal `22:59`, clock numerals, a digital display, or other readable text.
- Backgrounds remain opaque PNG at exactly `1920x1080`.
- If regenerated, `old_clock_photo.png` remains RGBA/transparent PNG at exactly `512x512`.
- Keep all current asset IDs and paths. Do not create a clock sprite, overlay, replacement evidence ID, or new scene carrier.
- Preserve Scene 7 hotspot landmarks, baked 黑瀨 placement, floor clearance, room geometry, and investigation interaction regions.
- Use `.claude/skills/generating-lyra-image-assets/SKILL.md`; built-in image generation is the default path.
- Do not add image-similarity/CV/screenshot infrastructure or a reusable prop-continuity framework.
- Do not create a PNG-validation script in the repo; use the one-off standard-library command in Task 4.
- Generated JSON under `apps/game/src-tauri/resources/**` remains untracked and is never hand-edited.

---

### Task 1: Lock the clock identity and harden the durable Scene 11 prompt

**Files:**
- Inspect: `static/assets/backgrounds/chapter_1/scene_p2/tag_002.png`
- Inspect: `static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png`
- Inspect: `static/assets/evidence/old_clock_photo.png`
- Inspect: `static/assets/backgrounds/chapter_1/scene_11/tag_002.png`
- Modify: `docs/stories_plan/chapter_1/scene_11.md`
- Read only: `docs/stories_plan/chapter_1/scene_p2.md`
- Read only: `docs/stories_plan/chapter_1/investigation_scene_7.md`
- Read only: `static/assets/config/policy.yaml`

**Interfaces:**
- Produces: one working identity sheet with casing/rim, dial, hands, wear/imperfection, and proportions used by all later generation steps.
- Produces: a durable Scene 11 `Background Prompt` that identifies the counter clock as the same recurring inner-storage-entrance clock.
- Preserves: existing story text, evidence semantics, asset IDs, and scene structure.

- [ ] **Step 1: Load the owning asset workflow and inspect all four current surfaces together**

Read:

```text
.claude/skills/generating-lyra-image-assets/SKILL.md
static/assets/config/policy.yaml
```

Open these four files side by side with the available project image viewer:

```text
static/assets/backgrounds/chapter_1/scene_p2/tag_002.png
static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png
static/assets/evidence/old_clock_photo.png
static/assets/backgrounds/chapter_1/scene_11/tag_002.png
```

Do not generate anything yet.

- [ ] **Step 2: Record the identity sheet before the first generation call**

Choose the most distinctive existing clock identity that can plausibly serve mounted-running, mounted-stopped, and counter-resting states.

Write five complete observations in working notes:

1. **Casing/rim:** describe the observed silhouette and material.
2. **Dial:** describe the face/background and non-text marking treatment.
3. **Hands:** describe the hand shape, thickness, and material/finish.
4. **Wear:** name one or two stable age/discoloration/imperfection traits.
5. **Proportions:** describe the overall shape and rim-to-face proportion.

Selection rule: the chosen traits must work on all four surfaces without changing any story fact. Do not choose P2 merely because it is generated first later.

- [ ] **Step 3: Patch the Scene 11 semantic prompt**

Replace only the current `Background Prompt` line for the empty-café clock shot in `docs/stories_plan/chapter_1/scene_11.md` with:

```markdown
- **Background Prompt:** Empty Rain Bell cafe interior in afternoon light, a latte cup on a wooden table, the same recurring old analog wall clock from the back-corridor inner-storage entrance now removed and resting on the counter, matching its distinctive aged casing and dial, hands stopped at a vague late-night position with minute hand near 12 and hour hand near 11, no readable clock numerals or text, quiet unresolved stillness.
```

Do not change dialogue, narration, BGM/BGS, scene tags, or any other prompt.

- [ ] **Step 4: Compile the prompt-only change**

Run:

```bash
bun run scenes:compile
```

Expected: exit 0 with no new warnings.

- [ ] **Step 5: Inspect the authored diff**

Run:

```bash
git diff -- docs/stories_plan/chapter_1/scene_11.md
```

Expected: exactly one semantic `Background Prompt` line changes; no story copy changes.

- [ ] **Step 6: Commit the durable prompt contract**

```bash
git add docs/stories_plan/chapter_1/scene_11.md
git commit -m "docs: lock recurring old-clock payoff prompt"
```

---

### Task 2: Regenerate the two named HPA-602 background targets

**Files:**
- Modify: `static/assets/backgrounds/chapter_1/scene_p2/tag_002.png`
- Modify: `static/assets/backgrounds/chapter_1/scene_11/tag_002.png`
- Inspect: `static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png`
- Inspect: `static/assets/evidence/old_clock_photo.png`
- Conditional modify: `docs/stories_plan/chapter_1/scene_p2.md`

**Interfaces:**
- Consumes: the five-observation identity sheet from Task 1.
- Consumes: the hardened Scene 11 prompt from Task 1.
- Produces: two accepted opaque `1920x1080` backgrounds sharing the selected clock identity.
- Produces: `scene7_identity_match` and `evidence_identity_match` decisions used by Task 3.

- [ ] **Step 1: Re-read the exact authored P2 and Scene 11 prompts immediately before generation**

Read:

```text
docs/stories_plan/chapter_1/scene_p2.md — back-corridor clock scene tag
docs/stories_plan/chapter_1/scene_11.md — empty-café counter-clock scene tag
```

P2 must remain the corridor-mouth view with the clock mounted on the inner-storage entrance wall. Scene 11 must remain the empty-café aftermath with the clock removed onto the counter.

- [ ] **Step 2: Generate the P2 background with the selected identity**

Use one built-in image-generation call for a wide 16:9 story background. Build the generation instruction from:

```text
Use case: illustration-story
Asset type: background
Authored prompt: live scene_p2 Background Prompt
Clock identity: all five observations recorded in Task 1
Required composition: corridor mouth to inner-storage entrance; clock mounted on entrance inner wall; stacked supplies retained; no foreground dialogue characters; lower area clear for UI
Constraints: grounded anime neo-noir Japanese detective visual novel; no readable text, logos, watermark; no exact story-critical clock time
```

Copy the selected returned image to:

```text
static/assets/backgrounds/chapter_1/scene_p2/tag_002.png
```

Normalize to opaque `1920x1080` without non-uniform stretching, following the repo asset skill.

- [ ] **Step 3: Inspect the normalized P2 plate before generating Scene 11**

Reject and regenerate P2 if any of these are false:

```text
camera is at corridor mouth / medium-wide
inner-storage entrance is readable as the corridor endpoint
clock is mounted on the entrance inner wall
clock matches all five Task 1 identity observations
no readable clock numerals/text
lower dialogue area remains usable
```

Do not patch `scene_p2.md` on the first failed generation. If two generation attempts fail specifically because the current authored prompt cannot hold the required location/composition, minimally strengthen only that prompt, rerun `bun run scenes:compile`, then regenerate.

- [ ] **Step 4: Generate the Scene 11 payoff from the same identity**

Use one built-in image-generation call for a wide 16:9 story background. Use the accepted P2 output as a visual reference when the available workflow supports it, and always include the same Task 1 identity observations.

Generation instruction:

```text
Use case: illustration-story
Asset type: background
Authored prompt: hardened live scene_11 Background Prompt
Clock identity: all five Task 1 observations; same object as accepted P2
State delta: removed from wall and resting naturally on counter
Stopped position: analog minute hand near 12, hour hand near 11; no readable numerals or literal 22:59
Constraints: empty Rain Bell cafe aftermath, afternoon light, quiet stillness, no people/readable text/logos/watermark, lower area clear for UI
```

Copy the selected output to:

```text
static/assets/backgrounds/chapter_1/scene_11/tag_002.png
```

Normalize to opaque `1920x1080`.

- [ ] **Step 5: Run the four-surface identity gate**

Open together:

```text
new scene_p2/tag_002.png
existing investigation_scene_7/inner.png
existing old_clock_photo.png
new scene_11/tag_002.png
```

For each mandatory sibling, compare all five identity dimensions:

```text
casing/rim silhouette + material
dial treatment
hand design
wear/imperfection
proportions
```

A sibling fails if a reasonable player would read it as a different clock on any major dimension, even if the stopped-hand position is similar.

Record exactly one of these two values for each sibling in working notes:

```text
scene7_identity_match = true
scene7_identity_match = false

evidence_identity_match = true
evidence_identity_match = false
```

- [ ] **Step 6: Commit the two named raster targets**

```bash
git add static/assets/backgrounds/chapter_1/scene_p2/tag_002.png static/assets/backgrounds/chapter_1/scene_11/tag_002.png
git commit -m "feat: align old-clock seed and payoff rasters"
```

Proceed to Task 3 even when both siblings pass; Task 3 explicitly defines the no-op path.

---

### Task 3: Resolve the Scene 7 inspection/evidence siblings when the identity gate fails

**Files:**
- Conditional modify: `docs/stories_plan/chapter_1/investigation_scene_7.md`
- Conditional modify: `static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png`
- Conditional modify: `static/assets/evidence/old_clock_photo.png`

**Interfaces:**
- Consumes: `scene7_identity_match` and `evidence_identity_match` from Task 2.
- Consumes: accepted P2/Scene 11 identity and Task 1 identity observations.
- Produces: all four player-facing surfaces matching one clock identity.

- [ ] **Step 1: Take the exact no-op path when both siblings pass**

When both decisions are `true`, do not edit `investigation_scene_7.md`, `inner.png`, or `old_clock_photo.png`. Continue directly to Task 4 and create no empty commit for this task.

- [ ] **Step 2: If Scene 7 fails, harden only the Scene 7 clock-bearing background prompt**

When `scene7_identity_match = false`, update the `## Sub-location: 內側倉庫 {#inner}` `Background Prompt` so it preserves all existing room/黑瀨/hotspot requirements and additionally identifies the visible prop as the same recurring old analog clock from the inner-storage entrance, using the five Task 1 identity observations and a vague late-night stopped-hand position with no readable numerals.

Do not change hotspot geometry, dialogue, reveals, or evidence semantics.

The existing old-clock `Scene Source Prompt` already carries the vague-time rule. Strengthen that source prompt only if the generation/source pipeline would otherwise lose the selected physical identity.

- [ ] **Step 3: If Scene 7 fails, regenerate `inner.png`**

Generate one wide 16:9 background using the updated live `inner` `Background Prompt`, the accepted P2 clock as reference where supported, and these non-negotiable anchors:

```text
cold inner storage room
high metal shelves
hard sensor light
same recurring clock mounted at inner-storage entrance wall
baked 黑瀨徹 remains perspective-correct on the right
clock, shelf impact mark, phone-drop position, bean can, paperback hotspot remain unobstructed
stopped analog hands: minute near 12, hour near 11, no readable numerals
```

Copy/normalize to opaque `1920x1080` at:

```text
static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png
```

- [ ] **Step 4: If evidence fails, harden the evidence `Image Prompt`**

When `evidence_identity_match = false`, replace only the `evidence:old_clock_photo` `Image Prompt` with:

```markdown
- **Image Prompt:** Isolated photo print of the same recurring old analog cafe wall clock examined at the inner-storage entrance, matching its distinctive aged casing, dial, hand design, wear and proportions, stopped at a vague late-night position with minute hand near 12 and hour hand near 11, no readable clock numerals or timestamp text, transparent evidence icon composition.
```

Keep Name, Description, Details, Source Sublocation, reveal wiring, and On Collect dialogue unchanged.

- [ ] **Step 5: If evidence fails, regenerate `old_clock_photo.png`**

Use one built-in image-generation call with the updated `Image Prompt`, accepted clock identity/reference, square evidence composition, and transparent evidence workflow from the repo skill.

Copy/normalize to RGBA `512x512` at:

```text
static/assets/evidence/old_clock_photo.png
```

- [ ] **Step 6: Re-run the four-surface identity gate after any sibling regeneration**

Open all four surfaces together. Every surface must pass all five identity dimensions.

Use this retry rule:

```text
identity mismatch -> reject and regenerate
same drift repeats because authored prompt is generic -> strengthen only that surface's semantic prompt -> regenerate
```

Do not accept a mismatch and create a follow-up.

- [ ] **Step 7: Compile conditional prompt changes**

If `investigation_scene_7.md` changed, run:

```bash
bun run scenes:compile
```

Expected: exit 0 with no new warnings.

- [ ] **Step 8: Commit sibling remediation when it occurred**

If Scene 7/evidence changed:

```bash
git add docs/stories_plan/chapter_1/investigation_scene_7.md static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png static/assets/evidence/old_clock_photo.png
git commit -m "feat: align old-clock inspection and evidence rasters"
```

If both siblings passed, create no commit for this task.

---

### Task 4: Verify asset policy, compile/audit, and close Axis 5 in the existing re-audit document

**Files:**
- Modify: `docs/stories_plan/chapter_1/semantic-content-reaudit.md`
- Verify: final changed clock rasters
- Verify: all four clock surfaces visually
- Verify: `docs/stories_plan/chapter_1/background-variety-audit.md`

**Interfaces:**
- Consumes: final accepted four-surface family from Tasks 2–3.
- Produces: mechanical verification evidence and the durable HPA-602 Axis 5 closeout.

- [ ] **Step 1: Run the one-off PNG header/chunk policy scan on raster files actually changed by HPA-602**

Run exactly:

```bash
python - <<'PY'
from pathlib import Path
import struct
import subprocess

PNG_SIG = b"\x89PNG\r\n\x1a\n"
P2 = Path("static/assets/backgrounds/chapter_1/scene_p2/tag_002.png")
SCENE7 = Path("static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png")
SCENE11 = Path("static/assets/backgrounds/chapter_1/scene_11/tag_002.png")
EVIDENCE = Path("static/assets/evidence/old_clock_photo.png")
KNOWN = {P2, SCENE7, SCENE11, EVIDENCE}

changed = {
    Path(line)
    for line in subprocess.check_output(
        ["git", "diff", "--name-only", "main...HEAD"],
        text=True,
    ).splitlines()
    if line
}
targets = sorted(KNOWN & changed, key=str)
assert P2 in targets, "P2 named target was not changed"
assert SCENE11 in targets, "Scene 11 named target was not changed"


def inspect_png(path: Path):
    data = path.read_bytes()
    assert data[:8] == PNG_SIG, f"{path}: not PNG"
    pos = 8
    width = height = color_type = None
    has_trns = False
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        kind = data[pos + 4 : pos + 8]
        payload = data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            width, height, _bit_depth, color_type, _compression, _filter, _interlace = struct.unpack(
                ">IIBBBBB", payload
            )
        elif kind == b"tRNS":
            has_trns = True
        pos += 12 + length
        if kind == b"IEND":
            break
    assert width is not None and height is not None and color_type is not None
    return width, height, color_type, has_trns


for path in targets:
    width, height, color_type, has_trns = inspect_png(path)
    if path == EVIDENCE:
        assert (width, height) == (512, 512), f"{path}: {width}x{height}"
        assert color_type == 6, f"{path}: expected regenerated RGBA color type 6, got {color_type}"
        print(f"PASS evidence {path}: {width}x{height}, RGBA")
    else:
        assert (width, height) == (1920, 1080), f"{path}: {width}x{height}"
        assert color_type not in {4, 6}, f"{path}: alpha color type {color_type}"
        assert not has_trns, f"{path}: tRNS transparency"
        print(f"PASS background {path}: {width}x{height}, color_type={color_type}, opaque")
PY
```

Expected:

- P2 and Scene 11 always print `PASS`.
- Scene 7 prints `PASS` only when it was regenerated.
- Evidence prints `PASS` only when it was regenerated, and then must be RGBA `512x512`.
- Exit code is 0.

This scan verifies format policy only; it does not claim visual identity.

- [ ] **Step 2: Run compiler and Chapter 1 background-cue coverage**

```bash
bun run scenes:compile
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
```

Expected: both exit 0 with no new warnings/cue-report drift.

The cue audit is structural inventory/report coverage only. Do not cite it as proof that the four clocks match visually.

- [ ] **Step 3: Perform the final Axis 5 clock-item visual gate**

Open the four clock surfaces together one final time and verify:

```text
same casing/rim identity
same dial identity
same hand design
same stable wear/imperfection
same proportions
P2 mounted at inner-storage entrance
Scene 7 same clock mounted/stopped and all hotspots unobstructed
Evidence photo belongs to Scene 7 clock
Scene 11 same clock removed/resting on counter
stopped surfaces use vague analog late-night hands only; no readable numerals/literal 22:59
```

Expected verdict: `SHIP` for the HPA-602 old-clock Axis 5 item.

- [ ] **Step 4: Derive the exact raster list for the closeout record**

Run:

```bash
git diff --name-only main...HEAD -- \
  static/assets/backgrounds/chapter_1/scene_p2/tag_002.png \
  static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png \
  static/assets/evidence/old_clock_photo.png \
  static/assets/backgrounds/chapter_1/scene_11/tag_002.png
```

Copy the returned paths verbatim into the resolved `Regenerated rasters` bullet in the next step. This avoids guessing whether the conditional siblings changed.

- [ ] **Step 5: Replace the deferred HPA-602 section in `semantic-content-reaudit.md` with a resolved closeout**

Do not create the historically referenced but absent `final-cycle-axis-5-visual-background-rerun.md`.

Replace the old deferred section with this structure:

```markdown
### Resolved follow-up — old-clock raster continuity (HPA-602)

- **Status:** Resolved. Axis 5 clock-item verdict: `SHIP`.
- **Identity family inspected:** `scene_p2/tag_002.png`, `investigation_scene_7/inner.png`, `old_clock_photo.png`, `scene_11/tag_002.png`.
- **Regenerated rasters:** paste the exact paths emitted by the Task 4 Step 4 command as indented sub-bullets.
- **Durable prompt contract:** Scene 11 explicitly identifies the counter clock as the same recurring inner-storage-entrance clock and uses an unreadable analog late-night hand position rather than rendered `22:59`.
- **Visual acceptance:** all four player-facing surfaces share the accepted casing/rim, dial, hand, wear, and proportion identity; Scene 7/evidence remain the inspection/photo state and Scene 11 remains the removed-clock payoff.
- **Asset policy:** every raster changed by HPA-602 passes the one-off policy scan; backgrounds are opaque `1920x1080`, and the evidence icon is RGBA `512x512` when regenerated.
- **Mechanical verification:** `bun run scenes:compile` and `bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md` both exit 0.
- **Owner/tracking:** HPA-602 complete; no further old-clock visual follow-up remains.
```

Also update the nearby Axis 5/final-evidence wording that currently says the old-clock item is still deferred so the document does not contradict its resolved section.

- [ ] **Step 6: Review the final diff for scope creep**

Run:

```bash
git diff --stat main...HEAD
git diff --name-only main...HEAD
```

Allowed implementation surface beyond the two planning docs:

```text
docs/stories_plan/chapter_1/scene_11.md
static/assets/backgrounds/chapter_1/scene_p2/tag_002.png
static/assets/backgrounds/chapter_1/scene_11/tag_002.png
docs/stories_plan/chapter_1/semantic-content-reaudit.md
```

Conditional implementation surface:

```text
docs/stories_plan/chapter_1/scene_p2.md
# only after two failed P2 generations prove the existing prompt insufficient

docs/stories_plan/chapter_1/investigation_scene_7.md
static/assets/backgrounds/chapter_1/investigation_scene_7/inner.png
static/assets/evidence/old_clock_photo.png
# only when the corresponding mandatory sibling failed identity acceptance
```

Any runtime/compiler/layout/Chapter 2/unrelated raster file is scope creep and must be removed before completion.

- [ ] **Step 7: Commit the verification closeout**

```bash
git add docs/stories_plan/chapter_1/semantic-content-reaudit.md
git commit -m "docs: close HPA-602 clock visual audit"
```

- [ ] **Step 8: Final verification before marking the PR ready**

Re-run:

```bash
bun run scenes:compile
bun run background-cues:audit --chapter chapter_1 --check-report docs/stories_plan/chapter_1/background-variety-audit.md
git diff --check
```

Then repeat the Task 4 PNG scan and final four-surface side-by-side visual gate once against the exact final files.

Expected: all mechanical commands pass and Axis 5 clock-item remains `SHIP`.