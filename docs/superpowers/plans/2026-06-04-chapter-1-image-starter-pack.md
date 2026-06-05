# Chapter 1 Image Starter Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first playable Chapter 1 image asset slice with generated backgrounds, portraits, and evidence icons for the opening case loop.

**Architecture:** Use the existing compiler-owned story asset pipeline. Enable the asset policy, add catalog/metadata for the live Chapter 1 corpus so compilation stays green, then generate only the opening-loop PNG files into `static/assets`. Generated Tauri resource JSON remains compiler output and is not hand-edited.

**Tech Stack:** Bun, TypeScript scene compiler, Svelte/Tauri asset resolver, YAML source catalogs, Markdown scene metadata, built-in `image_gen` tool, local chroma-key removal helper for transparent PNGs.

---

## File Structure

- Modify `static/assets/config/policy.yaml`: enable assets and set global/type prompt policy.
- Modify `static/assets/config/characters.yaml`: map Chapter 1 speakers to stable character IDs; starter-pack speakers use portraits, later-only speakers use `portraitMode: none`.
- Keep `static/assets/config/audio.yaml` empty unless compile requires otherwise; scene metadata uses `BGM: none` and `BGS: none` for the first cue and omitted audio metadata elsewhere.
- Modify Chapter 1 Markdown files under `docs/stories_plan/chapter_1/`: add required background and evidence image metadata for the live corpus.
- Create background PNGs under `static/assets/backgrounds/chapter_1/...`.
- Create portrait PNGs under character/expression folders such as `static/assets/portraits/soma_ritsu/standard.png`.
- Create evidence PNGs under ID-based filenames such as `static/assets/evidence/kagami_summary.png`.
- Do not modify `src-tauri/resources/scenes/*` or `src-tauri/resources/assets/*` by hand.

## Asset IDs To Produce

### Starter Backgrounds

These are the only background files generated in this first pack:

| Asset ID | Expected path |
| --- | --- |
| `background.chapter_1.scene_0.tag_001` | `static/assets/backgrounds/chapter_1/scene_0/tag_001.png` |
| `background.chapter_1.scene_0.tag_002` | `static/assets/backgrounds/chapter_1/scene_0/tag_002.png` |
| `background.chapter_1.investigation_scene_1.office` | `static/assets/backgrounds/chapter_1/investigation_scene_1/office.png` |
| `background.chapter_1.scene_2.tag_001` | `static/assets/backgrounds/chapter_1/scene_2/tag_001.png` |
| `background.chapter_1.scene_2.tag_002` | `static/assets/backgrounds/chapter_1/scene_2/tag_002.png` |
| `background.chapter_1.scene_2.tag_003` | `static/assets/backgrounds/chapter_1/scene_2/tag_003.png` |
| `background.chapter_1.investigation_scene_3.front` | `static/assets/backgrounds/chapter_1/investigation_scene_3/front.png` |
| `background.chapter_1.investigation_scene_3.corridor` | `static/assets/backgrounds/chapter_1/investigation_scene_3/corridor.png` |
| `background.chapter_1.investigation_scene_3.inner_entry` | `static/assets/backgrounds/chapter_1/investigation_scene_3/inner_entry.png` |

### Starter Portraits

| Asset ID | Expected path |
| --- | --- |
| `portrait.soma_ritsu.standard` | `static/assets/portraits/soma_ritsu/standard.png` |
| `portrait.hayasaka_akane.standard` | `static/assets/portraits/hayasaka_akane/standard.png` |
| `portrait.hayasaka_akane.stern` | `static/assets/portraits/hayasaka_akane/stern.png` |
| `portrait.miyake_mother.standard` | `static/assets/portraits/miyake_mother/standard.png` |
| `portrait.miyake_mother.strained` | `static/assets/portraits/miyake_mother/strained.png` |
| `portrait.clerk.standard` | `static/assets/portraits/clerk/standard.png` |
| `portrait.takase_manager.standard` | `static/assets/portraits/takase_manager/standard.png` |
| `portrait.takase_manager.tired` | `static/assets/portraits/takase_manager/tired.png` |
| `portrait.katase.standard` | `static/assets/portraits/katase/standard.png` |

### Starter Evidence

| Asset ID | Expected path |
| --- | --- |
| `evidence.kagami_summary` | `static/assets/evidence/kagami_summary.png` |
| `evidence.two_coffee_order` | `static/assets/evidence/two_coffee_order.png` |
| `evidence.cctv_screenshot` | `static/assets/evidence/cctv_screenshot.png` |
| `evidence.timecard_record` | `static/assets/evidence/timecard_record.png` |
| `evidence.doorlock_summary_timetable` | `static/assets/evidence/doorlock_summary_timetable.png` |
| `evidence.closing_routine` | `static/assets/evidence/closing_routine.png` |
| `evidence.backroom_floorplan` | `static/assets/evidence/backroom_floorplan.png` |

## Task 1: Enable Asset Catalogs

**Files:**

- Modify: `static/assets/config/policy.yaml`
- Modify: `static/assets/config/characters.yaml`
- Verify: `static/assets/config/audio.yaml`

- [ ] **Step 1: Verify baseline compile before edits**

Run:

```bash
bun run scenes:compile
```

Expected: PASS with `Assets` output absent or `enabled: false` behavior, because `static/assets/config/policy.yaml` currently has `assets.enabled: false`.

- [ ] **Step 2: Replace `static/assets/config/policy.yaml`**

Use this exact policy:

```yaml
assets:
  enabled: true

globalStyle:
  prompt: >
    Grounded anime neo-noir Japanese detective visual novel, stylized Tokyo interiors,
    rainy cinematic atmosphere, restrained varied color, adult character tone,
    no chibi or comedy exaggeration, no readable text in image, no watermark.

types:
  background:
    dimensions: [1920, 1080]
    format: png
    transparency: false
    prompt: >
      Wide 16:9 background plate for visual novel gameplay, no foreground
      dialogue characters, no UI overlay, no readable text, clear spatial
      composition, cinematic but grounded lighting.
  portrait:
    dimensions: [768, 1024]
    format: png
    transparency: true
    prompt: >
      Half-body visual novel character portrait, consistent face and outfit,
      neutral three-quarter stance, transparent background, crisp edges, no
      props unless specified, no text.
  evidence:
    dimensions: [512, 512]
    format: png
    transparency: true
    prompt: >
      Isolated evidence icon, readable silhouette at small UI sizes, clean
      object-focused composition, transparent background, no readable text.
  audio:
    format: ogg
    loop: true
```

- [ ] **Step 3: Replace `static/assets/config/characters.yaml`**

Use this catalog. Starter-pack characters use portraits. Later-only characters are explicitly no-portrait for this pass so they do not request ungenerated portrait files.

```yaml
characters:
  - id: soma_ritsu
    displayNames: ["相馬律"]
    portraitMode: portrait
    visualPrompt: >
      26-year-old Japanese private detective, slim build, slightly disheveled
      dark hair, shirt sleeves rolled to the elbows, quiet orderly posture,
      worn leather case folder nearby, observant but inexperienced.
    referenceAssetId: null
    expressions:
      standard:
        prompt: calm focused expression, restrained concern, eyes attentive

  - id: hayasaka_akane
    displayNames: ["早坂茜"]
    portraitMode: portrait
    visualPrompt: >
      Japanese woman in her early thirties, practical defense attorney, sturdy
      composed build, structured dark jacket over casual clothes, neatly tied
      hair, organized document bag, direct procedural presence.
    referenceAssetId: null
    expressions:
      standard:
        prompt: composed attentive expression, professional calm
      stern:
        prompt: firm serious expression, brows slightly set, controlled voice

  - id: miyake_mother
    displayNames: ["三宅母親"]
    portraitMode: portrait
    visualPrompt: >
      Middle-aged Japanese mother, modest everyday clothes, tired restrained
      face, hands often tense around a convenience-store rice-ball bag,
      quiet dignity, not crying.
    referenceAssetId: null
    expressions:
      standard:
        prompt: quiet restrained expression, worried but holding together
      strained:
        prompt: pained controlled expression, fingers tense, short fragile smile

  - id: clerk
    displayNames: ["書記官"]
    portraitMode: portrait
    visualPrompt: >
      Japanese review-board clerk behind a narrow counter, plain office attire,
      precise bureaucratic posture, neutral face, controlled gatekeeping manner.
    referenceAssetId: null
    expressions:
      standard:
        prompt: neutral procedural expression, professional distance

  - id: takase_manager
    displayNames: ["店長高瀨"]
    portraitMode: portrait
    visualPrompt: >
      Japanese cafe manager in her late thirties to early forties, apron over
      loose casual clothes, tired brow from running a small shop for years,
      practical ordinary presence, one hand habitually wiping a clean counter.
    referenceAssetId: null
    expressions:
      standard:
        prompt: plain practical expression, tired but cooperative
      tired:
        prompt: visibly fatigued expression, shoulders slightly lowered

  - id: katase
    displayNames: ["片瀨"]
    portraitMode: portrait
    visualPrompt: >
      Petite Japanese cafe employee in her early twenties, uniform apron, small
      colorful hair tie and tiny earrings, hurried end-of-shift energy, glancing
      toward the time.
    referenceAssetId: null
    expressions:
      standard:
        prompt: hurried polite expression, slightly anxious about catching train

  - id: miyake_sota
    displayNames: ["三宅蒼太"]
    portraitMode: none

  - id: kamiya_mio
    displayNames: ["神谷澪"]
    portraitMode: none

  - id: kurose_toru
    displayNames: ["黑瀨徹"]
    portraitMode: none

  - id: kitami_shuichi
    displayNames: ["北見修一"]
    portraitMode: none

  - id: contractor_supervisor
    displayNames: ["承包商主管"]
    portraitMode: none
```

- [ ] **Step 4: Keep `static/assets/config/audio.yaml` empty**

Confirm it remains:

```yaml
bgm: {}
bgs: {}
```

This pack does not generate audio. Use `BGM: none` and `BGS: none` on the first visual unit only.

- [ ] **Step 5: Run compile to verify RED**

Run:

```bash
bun run scenes:compile
```

Expected: FAIL with `assetFirstCueMissingBgm`, `assetFirstCueMissingBgs`, or `assetMissingBackgroundPrompt`. This proves the enabled policy is exercising the live scene metadata requirements.

Do not commit this task until Task 2 makes compile green.

## Task 2: Add Chapter-Wide Metadata

**Files:**

- Modify: `docs/stories_plan/chapter_1/scene_0.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_1.md`
- Modify: `docs/stories_plan/chapter_1/scene_2.md`
- Modify: `docs/stories_plan/chapter_1/investigation_scene_3.md`
- Modify: remaining `docs/stories_plan/chapter_1/*.md` files with visual units or evidence manifests

- [ ] **Step 1: Add starter background metadata**

Add metadata immediately after each selected visual unit. For the first visual unit only, include `BGM: none` and `BGS: none`.

Use these prompts:

```text
scene_0 tag_001: Minimal black KAGAMI evidence-summary interface, cold white aligned data rows implied by abstract glowing lines, clean machine logic, no readable text, no people, no UI labels.
scene_0 tag_002: Quiet Japanese police meeting-room corridor under pale fluorescent light, wall monitor showing an unreadable case-summary layout, empty bench, tense still air.
investigation_scene_1 office: Small private detective office in Tokyo on a rainy morning, stacked paper files, worn desk, broken coffee machine, canned coffee, narrow practical room.
scene_2 tag_001: Hayasaka law office on a rainy morning, quiet interior, case summary papers, thermos and rice-ball bag on table, restrained emotional tension, no readable document text.
scene_2 tag_002: Review-board entry window in a narrow institutional corridor, metal door at the end, small lit counter window, cold procedural mood.
scene_2 tag_003: Long review-board exterior hallway with wet city light through windows, pale morning after rain, closed door at far end, quiet legal pressure.
investigation_scene_3 front: Rain Bell cafe front room at rainy night after closing, dim half-light, counter, register, umbrella stand with blue transparent umbrella, wet glass door, no readable signage.
investigation_scene_3 corridor: Narrow Rain Bell back corridor, L-shaped turn, stacked paper cups and cake boxes, cleaning rack, half-open fire door, fluorescent hum, sightline blocked.
investigation_scene_3 inner_entry: Dark inner storage entrance of Rain Bell cafe, high shelves, thin dust, sensor light just out of range, occluded view into deeper storage, tense spatial clue.
```

- [ ] **Step 2: Add minimal metadata for non-starter backgrounds**

For every other `sceneTag`, investigation `Sub-location`, and interrogation `Phase` in Chapter 1, add a concise English `Background Prompt` based on the existing Traditional Chinese scene tag. Do not add generated image files for these in this pack.

Rules:

- Use `Background Prompt` only unless the unit intentionally changes audio later.
- Do not add `BGM` or `BGS` except the first visual unit in `scene_0.md`.
- Keep prompts under 35 words.
- Do not include readable text requirements except “no readable text”.
- Do not reveal sealed main-plot facts from `docs/stories_plan/characters.md`.

Example for `scene_5.md`:

```markdown
[場景：吉祥寺地方分署審查會場，上午，雨後陰天。...]
- **Background Prompt:** Regional review-board chamber after rain, long table, sparse audience seating, pale fluorescent light, thick case-summary documents implied without readable text, cold procedural silence.
```

- [ ] **Step 3: Add image prompts for every evidence manifest**

For starter evidence, use these exact `Image Prompt` lines:

```text
kagami_summary: Official KAGAMI case-summary document printout in a folder, clean grid-like layout implied with unreadable marks, isolated evidence icon.
two_coffee_order: Two takeaway coffee cups and a cup sleeve with an unreadable single initial mark implied, cafe receipt beside them, isolated evidence icon.
cctv_screenshot: Small surveillance monitor screenshot thumbnail showing a blurred cafe backroom route, unreadable timestamp blocks, isolated evidence icon.
timecard_record: Monthly staff timecard sheet on a clipboard, grid layout implied with unreadable marks, isolated evidence icon.
doorlock_summary_timetable: Printed doorlock event timetable sheet with clean columns and unreadable rows, isolated evidence icon.
closing_routine: Cafe closing-routine whiteboard checklist with several unreadable tick marks and two blank lines, isolated evidence icon.
backroom_floorplan: Simple L-shaped backroom floor plan diagram with blocked sightline geometry, no readable labels, isolated evidence icon.
```

For non-starter evidence, add concise prompts from the existing name/description. These IDs require prompts so asset-enabled compile succeeds, but their PNG files are out of scope for this first pack:

```text
cake_box
miyake_mother_call_log
amemiya_message_thumb
floor_water_drying_map
wet_umbrella_sleeve
coffee_last_cup_record
old_clock_photo
victim_phone_notification
murder_weapon_candidate
forensic_prelim_range
miyake_pov_replay
local_sequence_record
maintenance_mode_note
external_maintenance_credential
temp_maintenance_workorder
kitami_external_access
contractor_umbrella_sleeve_match
masuda_unsent_memo
masuda_whistleblower_draft
kitami_data_theft_record
approved_clip
```

- [ ] **Step 4: Run compile to verify GREEN with warnings**

Run:

```bash
bun run scenes:compile
```

Expected: PASS. The command may print `assetFileMissing` warnings because PNGs have not been generated yet. It must not print `assetMissingBackgroundPrompt`, `assetMissingEvidenceImagePrompt`, `assetUnknownSpeaker`, or `assetUnknownAudio`.

- [ ] **Step 5: Commit metadata and config**

Run:

```bash
git add static/assets/config docs/stories_plan/chapter_1
git commit -m "Enable chapter 1 story asset metadata"
```

## Task 3: Generate Starter Background PNGs

**Files:**

- Create: `static/assets/backgrounds/chapter_1/scene_0/tag_001.png`
- Create: `static/assets/backgrounds/chapter_1/scene_0/tag_002.png`
- Create: `static/assets/backgrounds/chapter_1/investigation_scene_1/office.png`
- Create: `static/assets/backgrounds/chapter_1/scene_2/tag_001.png`
- Create: `static/assets/backgrounds/chapter_1/scene_2/tag_002.png`
- Create: `static/assets/backgrounds/chapter_1/scene_2/tag_003.png`
- Create: `static/assets/backgrounds/chapter_1/investigation_scene_3/front.png`
- Create: `static/assets/backgrounds/chapter_1/investigation_scene_3/corridor.png`
- Create: `static/assets/backgrounds/chapter_1/investigation_scene_3/inner_entry.png`

- [ ] **Step 1: Create destination directories**

Run:

```bash
mkdir -p static/assets/backgrounds/chapter_1/scene_0 static/assets/backgrounds/chapter_1/investigation_scene_1 static/assets/backgrounds/chapter_1/scene_2 static/assets/backgrounds/chapter_1/investigation_scene_3
```

- [ ] **Step 2: Generate each background with built-in `image_gen`**

Use one built-in `image_gen` call per row. Prompt format:

```text
Use case: illustration-story
Asset type: 16:9 visual novel background plate
Primary request: use the exact row-specific background prompt from Task 2.
Style: grounded anime neo-noir Japanese detective visual novel, stylized Tokyo interiors, rainy cinematic atmosphere, restrained varied color, serious adult tone, no chibi or comedy exaggeration.
Composition: wide background plate, no foreground dialogue characters, clear gameplay-readable space, no UI overlay.
Avoid: readable text, logos, watermarks, subtitles, chibi styling, comedy exaggeration, decorative gradients.
Output: PNG-like raster image, 16:9 composition.
```

After each generation, copy the selected output from the generated-images location into the expected path in the table above. Do not overwrite an existing non-generated asset without checking `git status` first.

- [ ] **Step 3: Inspect the generated background files**

Use `view_image` for each generated file or a contact sheet. Reject and regenerate any background with readable text, foreground character portraits, wrong setting, severe cropping, or unreadable spatial clue.

- [ ] **Step 4: Commit backgrounds**

Run:

```bash
git add static/assets/backgrounds/chapter_1
git commit -m "Add chapter 1 starter backgrounds"
```

## Task 4: Generate Starter Portrait PNGs

**Files:**

- Create portrait PNGs listed in "Starter Portraits".

- [ ] **Step 1: Create destination directories**

Run:

```bash
mkdir -p static/assets/portraits/soma_ritsu static/assets/portraits/hayasaka_akane static/assets/portraits/miyake_mother static/assets/portraits/clerk static/assets/portraits/takase_manager static/assets/portraits/katase
```

- [ ] **Step 2: Generate portrait source images on chroma key**

Use one built-in `image_gen` call per portrait. Prompt format:

```text
Use case: illustration-story
Asset type: half-body visual novel character portrait for transparent PNG
Primary request: combine the exact character `visualPrompt` from `characters.yaml` with the exact expression prompt for the portrait being generated.
Style: grounded anime neo-noir Japanese detective visual novel, serious adult anime proportions, restrained color, consistent face and outfit across expressions for the same character.
Background handling: Create the character on a perfectly flat solid #00ff00 chroma-key background for background removal. The background must be one uniform color with no shadows, gradients, texture, reflections, floor plane, or lighting variation. Keep the subject fully separated from the background with crisp edges and generous padding. Do not use #00ff00 anywhere in the subject.
Avoid: readable text, logos, watermarks, props not specified, chibi styling, comedy exaggeration, full-body tiny framing.
```

- [ ] **Step 3: Remove chroma key for each portrait**

For each generated portrait source file, run this command with `SOURCE_PATH`
set to the exact generated-image path returned by the built-in tool and
`OUT_PATH` set to the expected portrait path from the Starter Portraits table.
This example shows the first portrait destination:

```bash
SOURCE_PATH="$HOME/.codex/generated_images/example-source.png"
OUT_PATH="static/assets/portraits/soma_ritsu/standard.png"
python "${CODEX_HOME:-$HOME/.codex}/skills/.system/imagegen/scripts/remove_chroma_key.py" \
  --input "$SOURCE_PATH" \
  --out "$OUT_PATH" \
  --auto-key border \
  --soft-matte \
  --transparent-threshold 12 \
  --opaque-threshold 220 \
  --despill
```

Expected: output PNG has an alpha channel and transparent corners.

- [ ] **Step 4: Inspect portraits**

Use `view_image` or a contact sheet. Reject and regenerate any portrait with green fringe, inconsistent Hayasaka/Miyake/Takase identity across expressions, unreadable facial expression, cropped head/hands, or hidden-story imagery.

- [ ] **Step 5: Commit portraits**

Run:

```bash
git add static/assets/portraits
git commit -m "Add chapter 1 starter portraits"
```

## Task 5: Generate Starter Evidence PNGs

**Files:**

- Create evidence PNGs listed in "Starter Evidence".

- [ ] **Step 1: Generate evidence source images on chroma key**

Use one built-in `image_gen` call per starter evidence item. Prompt format:

```text
Use case: illustration-story
Asset type: isolated detective evidence icon for transparent PNG
Primary request: use the exact starter evidence `Image Prompt` from Task 2.
Style: grounded anime neo-noir Japanese detective visual novel, stylized but grounded object rendering, restrained color, object-focused.
Background handling: Create the evidence object on a perfectly flat solid #00ff00 chroma-key background for background removal. The background must be one uniform color with no shadows, gradients, texture, reflections, floor plane, or lighting variation. Keep the object fully separated from the background with crisp edges and generous padding. Do not use #00ff00 anywhere in the object.
Avoid: readable text, logos, watermarks, decorative UI frames, overly tiny details.
```

- [ ] **Step 2: Remove chroma key for each evidence icon**

Run the same helper command as portraits, writing to each expected evidence path.

- [ ] **Step 3: Inspect evidence icons**

Use `view_image` or a contact sheet. Reject and regenerate any icon with readable text, missing transparent background, weak silhouette at small size, or misleading evidence content.

- [ ] **Step 4: Commit evidence icons**

Run:

```bash
git add static/assets/evidence
git commit -m "Add chapter 1 starter evidence icons"
```

## Task 6: Verify Compiler Manifest And Frontend Types

**Files:**

- Generated by command, do not hand-edit: `src-tauri/resources/scenes/*`
- Generated by command, do not hand-edit: `src-tauri/resources/assets/*`

- [ ] **Step 1: Compile scenes**

Run:

```bash
bun run scenes:compile
```

Expected: PASS. Missing-file warnings are acceptable only for non-starter asset IDs. There must be no missing-file warnings for any asset listed in "Asset IDs To Produce".

- [ ] **Step 2: Assert starter files are present**

Run:

```bash
bun --eval "const fs=await import('node:fs'); const paths=[
'static/assets/backgrounds/chapter_1/scene_0/tag_001.png',
'static/assets/backgrounds/chapter_1/scene_0/tag_002.png',
'static/assets/backgrounds/chapter_1/investigation_scene_1/office.png',
'static/assets/backgrounds/chapter_1/scene_2/tag_001.png',
'static/assets/backgrounds/chapter_1/scene_2/tag_002.png',
'static/assets/backgrounds/chapter_1/scene_2/tag_003.png',
'static/assets/backgrounds/chapter_1/investigation_scene_3/front.png',
'static/assets/backgrounds/chapter_1/investigation_scene_3/corridor.png',
'static/assets/backgrounds/chapter_1/investigation_scene_3/inner_entry.png',
'static/assets/portraits/soma_ritsu/standard.png',
'static/assets/portraits/hayasaka_akane/standard.png',
'static/assets/portraits/hayasaka_akane/stern.png',
'static/assets/portraits/miyake_mother/standard.png',
'static/assets/portraits/miyake_mother/strained.png',
'static/assets/portraits/clerk/standard.png',
'static/assets/portraits/takase_manager/standard.png',
'static/assets/portraits/takase_manager/tired.png',
'static/assets/portraits/katase/standard.png',
'static/assets/evidence/kagami_summary.png',
'static/assets/evidence/two_coffee_order.png',
'static/assets/evidence/cctv_screenshot.png',
'static/assets/evidence/timecard_record.png',
'static/assets/evidence/doorlock_summary_timetable.png',
'static/assets/evidence/closing_routine.png',
'static/assets/evidence/backroom_floorplan.png'
]; const missing=paths.filter(p=>!fs.existsSync(p)); if(missing.length){ console.error(missing.join('\\n')); process.exit(1); } console.log('starter asset files present:', paths.length);"
```

Expected: `starter asset files present: 25`.

- [ ] **Step 3: Assert manifest references selected starter IDs**

Run:

```bash
bun --eval "const fs=await import('node:fs'); const manifest=JSON.parse(fs.readFileSync('src-tauri/resources/assets/manifest.json','utf8')); const ids=new Set(manifest.entries.map(e=>e.assetId)); const required=[
'background.chapter_1.scene_0.tag_001',
'background.chapter_1.scene_0.tag_002',
'background.chapter_1.investigation_scene_1.office',
'background.chapter_1.scene_2.tag_001',
'background.chapter_1.scene_2.tag_002',
'background.chapter_1.scene_2.tag_003',
'background.chapter_1.investigation_scene_3.front',
'background.chapter_1.investigation_scene_3.corridor',
'background.chapter_1.investigation_scene_3.inner_entry',
'portrait.soma_ritsu.standard',
'portrait.hayasaka_akane.standard',
'portrait.hayasaka_akane.stern',
'portrait.miyake_mother.standard',
'portrait.miyake_mother.strained',
'portrait.clerk.standard',
'portrait.takase_manager.standard',
'portrait.takase_manager.tired',
'portrait.katase.standard',
'evidence.kagami_summary',
'evidence.two_coffee_order',
'evidence.cctv_screenshot',
'evidence.timecard_record',
'evidence.doorlock_summary_timetable',
'evidence.closing_routine',
'evidence.backroom_floorplan'
]; const missing=required.filter(id=>!ids.has(id)); if(missing.length){ console.error(missing.join('\\n')); process.exit(1); } console.log('starter manifest ids present:', required.length);"
```

Expected: `starter manifest ids present: 25`.

- [ ] **Step 4: Run frontend type check**

Run:

```bash
bun run check
```

Expected: PASS.

- [ ] **Step 5: Review git status**

Run:

```bash
git status --short
```

Expected: modified source config/Markdown and new static asset PNGs are committed. Generated files under `src-tauri/resources` may appear locally after compile and should not be committed unless the repo ignore policy says otherwise.

## Task 7: Final Commit Or Cleanup

**Files:**

- Commit only source config, story metadata, and static asset files.
- Leave generated resource JSON untracked.

- [ ] **Step 1: Remove generated-resource staging if present**

Run:

```bash
git status --short src-tauri/resources
```

Expected: either clean or ignored generated output. If any generated JSON is staged, unstage it with:

```bash
git restore --staged src-tauri/resources
```

- [ ] **Step 2: Commit remaining verified source/assets**

If any verified source or asset files remain uncommitted, run:

```bash
git add static/assets/config docs/stories_plan/chapter_1 static/assets/backgrounds static/assets/portraits static/assets/evidence
git commit -m "Wire chapter 1 starter image assets"
```

- [ ] **Step 3: Final verification summary**

Record the final outputs in the user-facing response:

```text
Verified:
- bun run scenes:compile
- starter asset file presence assertion
- starter manifest ID assertion
- bun run check
```

Also report any accepted non-starter `assetFileMissing` warnings as intentional follow-up scope.
