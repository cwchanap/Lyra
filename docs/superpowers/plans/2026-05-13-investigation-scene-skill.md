# Investigation Scene Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a new project-level Claude Code skill (`writing-investigation-scene`) that defines the `investigation_scene_<N>.md` file format for interactive investigation parts of the detective game, and cross-reference it from the existing `writing-detective-game-dialogue` skill.

**Architecture:** Documentation-only change. Two skill files edited:
- **New:** `.claude/skills/writing-investigation-scene/SKILL.md` — full structural reference (block schemas, reveal/unlock syntax, sub-location rules, worked example)
- **Edited:** `.claude/skills/writing-detective-game-dialogue/SKILL.md` — one-line cross-reference in the File Organisation section

A separate validation step dispatches a sonnet subagent to author a small investigation_scene fragment using only the new skill, to verify the documentation is sufficient for an agent to produce valid output.

**Tech Stack:** Markdown skill files with YAML frontmatter. No code, no parser, no tests in the traditional sense. The "test" is a subagent dry-run against the format.

**Source spec:** `docs/superpowers/specs/2026-05-13-investigation-scene-skill-design.md`

---

## File Structure

| Path | Responsibility | Action |
|---|---|---|
| `.claude/skills/writing-investigation-scene/SKILL.md` | Investigation scene format reference (block schemas, reveal/unlock, sub-locations, worked example) | Create |
| `.claude/skills/writing-detective-game-dialogue/SKILL.md` | Base dialogue skill — needs cross-reference to investigation skill in File Organisation section | Modify |
| `docs/superpowers/plans/.scratch/test_scene_output.md` | Temporary output of the validation subagent (deleted after verification) | Create then delete |

---

### Task 1: Create the new skill file

**Files:**
- Create: `.claude/skills/writing-investigation-scene/SKILL.md`

The skill file should follow the full structure from the spec. Below is the complete content — copy as-is into the new file.

- [ ] **Step 1: Create the skill directory**

Run: `mkdir -p .claude/skills/writing-investigation-scene`
Expected: directory created silently. Verify with `ls .claude/skills/` and confirm `writing-investigation-scene/` appears.

- [ ] **Step 2: Write the SKILL.md file with the full content below**

File path: `.claude/skills/writing-investigation-scene/SKILL.md`

````markdown
---
name: writing-investigation-scene
description: Use when writing or extending an investigation_scene_<N>.md file under static/stories_plan/chapter_<N>/ — interactive investigation scenes with hotspots, characters, evidence/statements manifests, and unlock chains. Requires writing-detective-game-dialogue for base dialogue format. Trigger when given a chapter detail plan (詳細計劃) and asked to produce the interactive investigation part (not a linear scene).
---

# Writing Investigation Scenes (《東京雨證：第零證人》)

## Role

You are authoring **interactive investigation scenes** for the detective game. Each scene is a markdown file the player will explore non-linearly — clicking hotspots, asking characters topics, collecting evidence and statements. The format is hybrid: human-readable dialogue with structured markdown-heading blocks that map cleanly onto the game's Rust engine data (`HotspotState`, `CharacterState`, `TopicState`, `EvidenceState`, `StatementState`).

## REQUIRED BACKGROUND

You MUST be familiar with **`writing-detective-game-dialogue`** before using this skill. That skill owns the base dialogue rules: line format (`**角色名**：`), ≤100 Chinese char limit, bracketed stage directions, scene tags, phone-call convention, foreshadowing discipline, Traditional Chinese rules, and the per-chapter foreshadowing allow/deny lists.

This skill describes only the **structural wrapper** around dialogue — the block hierarchy and reveal/unlock logic specific to investigation scenes. All dialogue *inside* block bodies follows the base dialogue skill's rules unchanged.

## When to use

Use when the file you are authoring is `chapter_<N>/investigation_scene_<N>.md` — i.e. the user has asked you to write the interactive investigation Part (Part 1, Part 4 in Chapter 1, etc.).

**Do not use for** `chapter_<N>/scene_<N>.md` — those are linear dialogue scenes (intro cutscenes, transitions, in-car conversations). For linear scenes, use `writing-detective-game-dialogue` directly.

**Also not for** `interrogation_scene_<N>.md` (a future format covering confrontation and deduction) — that has its own skill, designed separately when needed.

## File skeleton (canonical order)

Every `investigation_scene_<N>.md` follows this top-to-bottom order:

```
# Scene N: <title>

## 進入                          (intro narration — H2)

## Sub-location: ... {#id}       (one or more — H2)
  ### Hotspot: ... {#id}         (H3, inside sub-location)
  ### Character: ... {#id}       (H3, inside sub-location)
    #### Topic: ... {#id}        (H4, inside character)

## Evidence Manifest             (H2, optional if scene has no evidence)
  ### evidence:... {#id}         (H3)
    #### 收集時                  (H4, required)
    #### 重新檢視                (H4, optional)

## Statement Manifest            (H2, optional if scene has no statements)
  ### statement:... {#id}        (H3)
    #### 取得時                  (H4, required)
    #### 重新檢視                (H4, optional)

## 退出                          (outro narration — H2)
```

## Heading hierarchy reference

| Level | Block |
|---|---|
| H1 | `# Scene N: <title>` (exactly one per file) |
| H2 | `## 進入`, `## Sub-location:`, `## Evidence Manifest`, `## Statement Manifest`, `## 退出` |
| H3 | `### Hotspot:`, `### Character:`, `### evidence:`, `### statement:` |
| H4 | `#### Topic:`, `#### 收集時` / `#### 重新檢視`, `#### 取得時` / `#### 重新檢視` |

**Hotspots and Characters always live inside a Sub-location block.** Even single-location scenes wrap everything in one Sub-location for parser uniformity.

## Block field schemas

Field labels are Traditional Chinese; reserved keyword values are English (`locked` / `unlocked`). IDs are English slugs anchored with `{#id}` on the heading line.

### Sub-location (H2)
- **Required:** `狀態` (`locked` or `unlocked`)
- **Optional:** `解鎖條件`, `揭露` (list)
- **Body:** `[場景：...]` tag (mandatory, immediately after metadata), then transition dialogue, then nested H3 Hotspot / Character blocks.

### Hotspot (H3, inside a Sub-location)
- **Required:** `描述`
- **Optional:** `狀態` (defaults to `unlocked`), `解鎖條件`, `揭露` (list)
- **Body:** inspect dialogue (plays once when the player clicks this hotspot).

### Character (H3, inside a Sub-location)
- **Required:** `角色`, `簡介`
- **Optional:** none
- **Body:** none directly — container for `#### Topic:` blocks.

### Topic (H4, inside a Character)
- **Required:** `狀態`
- **Optional:** `解鎖條件`, `揭露` (list)
- **Body:** topic dialogue (plays when the player selects this topic).

### Evidence Manifest entry (H3 under `## Evidence Manifest`)
- **Heading:** `### evidence:<id> {#id}`
- **Required:** `名稱`, `描述`, `細節`
- **Body:**
  - `#### 收集時` (required) — dialogue that plays when this evidence is first added to inventory.
  - `#### 重新檢視` (optional) — dialogue that plays when the player re-opens this item from inventory.

### Statement Manifest entry (H3 under `## Statement Manifest`)
- **Heading:** `### statement:<id> {#id}`
- **Required:** `發言人`, `內容`
- **Body:**
  - `#### 取得時` (required) — dialogue that plays when this statement is first added to the log.
  - `#### 重新檢視` (optional) — dialogue that plays when the player re-reads it from the log.

### 進入 / 退出 (H2)
- **No metadata.**
- **Body:** linear dialogue (intro plays on scene load; outro plays when the scene closes / Part advances).

## Reveal / unlock syntax

All reveals are automatic chains — there is no manual "present evidence" action in investigation scenes (that's interrogation-scene territory).

### `揭露:` — declared on the source

A list of things this trigger collects/unlocks when the block completes (hotspot inspected, topic discussed, sub-location entered).

```
揭露: [evidence:cooling_coffee, statement:hayasaka_says_alive, topic:hayasaka@victim_background, hotspot:back_alley, sublocation:storeroom]
```

| Target form | Effect |
|---|---|
| `evidence:<id>` | Adds to inventory; triggers its `#### 收集時` dialogue. |
| `statement:<id>` | Adds to statement log; triggers its `#### 取得時` dialogue. |
| `topic:<character-id>@<topic-id>` | Unlocks a previously locked topic on that character. Silent unlock. |
| `hotspot:<id>` | Unlocks a previously locked hotspot in the same scene. Silent. |
| `sublocation:<id>` | Unlocks a previously locked sub-location. Silent. |

### `解鎖條件:` — declared on the locked target

Only on blocks with `狀態: locked`. A boolean expression that, when satisfied, flips the target to unlocked.

**Atomic predicates:**
- `evidence:<id> 已收集`
- `statement:<id> 已取得`
- `topic:<character-id>@<topic-id> 已討論`
- `hotspot:<id> 已調查`

**Combinators (use sparingly — long unlock chains usually mean a pacing problem):**
- `<a> 且 <b>` — both required
- `<a> 或 <b>` — either suffices

### Interaction: `揭露` and `解鎖條件` are mutually exclusive per chain

For any locked target, pick **one** path to unlock it. Never both.

- Use `揭露` on the source when the unlock is a 1:1 single-trigger reveal (most evidence collection, most topic unlocks).
- Use `解鎖條件` on the target when the unlock depends on multiple preconditions across different triggers (e.g. "after inspecting X *and* discussing Y").

Declaring both an inbound `揭露` *and* a `解鎖條件` for the same target is an author error (parser warning).

### Play order when one trigger reveals multiple things

When the player completes a trigger that has a `揭露:` list, dialogue plays in this fixed order:

1. The trigger block's own body dialogue (the Hotspot's inspect text, the Topic's response).
2. Each `揭露` target's reveal dialogue in list order:
   - `evidence:<id>` → its `#### 收集時` block
   - `statement:<id>` → its `#### 取得時` block
   - `topic:` / `hotspot:` / `sublocation:` → silent (the unlocked block's body plays only when the player engages it directly)

## Sub-location semantics

- **Entry point:** the first `## Sub-location:` block declared in the file is where the player starts. Its `狀態` *must* be `unlocked`.
- **Persistence:** once unlocked, a sub-location stays unlocked for the rest of the scene. Backtracking is allowed.
- **Scene tag:** every sub-location must have its own `[場景:...]` tag immediately after the metadata. Different physical space → different AI image prompt.
- **Transition dialogue:** the body of a sub-location block (between metadata and the first nested H3) plays once on first entry.
- **First-entry reveals:** `揭露:` on a sub-location triggers when the player first enters it — useful for environmental discoveries not tied to a specific hotspot.
- **Character placement:** characters belong to exactly one sub-location. If the same person needs to be in two physical areas, declare them once per sub-location with topics appropriate to that location. Duplication is accepted; it keeps "who is here right now" trivially answerable.

## Parser validation guarantees

A future parser/validator will check the following — author with them in mind:

- Every `揭露:` target resolves to a declared ID in the same file.
- Every `解鎖條件:` predicate references a declared ID in the same file.
- No circular dependencies (A unlocks B, B unlocks A).
- Every block with `狀態: locked` is unlockable via at least one path (`解鎖條件:` on itself **or** inbound `揭露` from another block).
- The first `## Sub-location:` block in the file is `狀態: unlocked`.
- No target has both an inbound `揭露` and a `解鎖條件` (warning).
- Every Sub-location has exactly one `[場景:...]` tag in its body.
- Every Evidence Manifest entry has a `#### 收集時` sub-block.
- Every Statement Manifest entry has a `#### 取得時` sub-block.

## Workflow

When asked to write an `investigation_scene_<N>.md`:

1. **Read the chapter's `_詳細計劃.md`** in full — characters, hotspots planned, clue placement, foreshadow seeds for this Part.
2. **Check `General Plan.md`** for foreshadowing pacing — which seeds belong to this chapter, which must NOT be revealed yet.
3. **Confirm scope with the user** — which Part is this scene, what are the sub-locations, what are the must-cover hotspots/topics/evidence/statements?
4. **Sketch the block list before writing dialogue:**
   - List sub-locations in order, marked locked/unlocked
   - List hotspots per sub-location with their reveal targets
   - List characters per sub-location with their topics
   - List evidence and statements with their IDs
   - Draw the unlock graph mentally — does every locked block have a path?
5. **Write the file in canonical order** (進入 → Sub-locations with their nested H3s → Evidence Manifest → Statement Manifest → 退出).
6. **Self-check before reporting done:**
   - Every dialogue line follows the base dialogue skill's format (≤100 chars, bracketed actions, etc.)
   - Every locked block has either a `解鎖條件` or an inbound `揭露`
   - First sub-location is `狀態: unlocked`
   - Every sub-location has a `[場景:...]` tag
   - All `揭露` and `解鎖條件` references resolve

## Common mistakes

| Mistake | Fix |
|---|---|
| Hotspots written at H2 (sibling of Sub-location) instead of H3 inside | Move inside the relevant Sub-location block |
| Topic dialogue written as separate H3 outside its Character | Nest Topic blocks as H4 under their Character (H3) |
| Sub-location missing its own `[場景:...]` tag | Add one — every physical area needs its own image prompt |
| Locked block with neither `解鎖條件` nor inbound `揭露` | Add a path; otherwise it's permanently locked |
| Locked block with BOTH `解鎖條件` and inbound `揭露` | Pick one; remove the other |
| First sub-location declared as `狀態: locked` | Set to `unlocked` — the player must be able to enter |
| Evidence Manifest entry without `#### 收集時` | Add it; even one short line is required |
| Manifest entries placed inline under their producing hotspot/topic | Move to the dedicated `## Evidence Manifest` / `## Statement Manifest` sections near the file bottom |
| Inline dialogue describes "present this evidence to the witness" | That belongs in a future `interrogation_scene` — investigation scenes only collect, not confront |
| Dialogue line >100 Chinese characters | Split per the base dialogue skill |
| Action/expression written into a dialogue line | Move to a `[ ]` bracket on its own line |

## Worked example

A reduced fragment exercising every block type in canonical order. Use as a structural reference, not a content template.

```markdown
# Scene 1: 第一次現場調查 — 雨鐘咖啡館

## 進入

[相馬律與早坂茜跨過警戒線。]

**早坂茜**：黑瀨刑警在裡面。

## Sub-location: 咖啡館主廳 {#main_floor}
- **狀態：** unlocked

[場景：吉祥寺雨鐘咖啡館主廳，深夜，雨夜，燈光昏黃，吧台上一個黃銅桌鈴。]

[黑瀨刑警站在吧台旁，神情疲憊。]

### Hotspot: 黃銅桌鈴 {#counter_bell}
- **描述：** 吧台上一個黃銅製桌鈴，看起來最近被用過。
- **揭露：** [evidence:cooling_coffee, topic:hayasaka@victim_background]

[相馬律按了一下桌鈴，又把手背貼在咖啡機側面。]

**相馬律**：還是熱的。

### Character: 早坂茜 {#hayasaka}
- **角色：** 律師
- **簡介：** 男主角的合作搭檔，重視人證。

#### Topic: 案發時間 {#timeline}
- **狀態：** unlocked
- **揭露：** [statement:hayasaka_says_alive]

**早坂茜**：若槻蓮堅持，他離開時那個人還活著。

#### Topic: 死者背景 {#victim_background}
- **狀態：** locked

**早坂茜**：增田圭是 KAGAMI 的資料審查員。

## Sub-location: 倉庫 {#storeroom}
- **狀態：** locked
- **解鎖條件：** hotspot:counter_bell 已調查 且 topic:hayasaka@timeline 已討論
- **揭露：** [evidence:wet_floor_marks]

[場景：倉庫，更冷，空氣中有金屬味，左側舊木門半掩。]

[兩人推開那扇舊門，相馬律抬手讓早坂先進。]

**相馬律**：這裡更冷。

### Hotspot: 滾輪貨架 {#wheeled_shelf}
- **描述：** 一座滾輪貨架，半遮住左側舊門。
- **揭露：** [evidence:shelf_recently_moved]

[相馬律推了一下貨架，輪子順滑地滾動。]

**相馬律**：剛被推過。

## Evidence Manifest

### evidence:cooling_coffee {#cooling_coffee}
- **名稱：** 還溫的咖啡機
- **描述：** 一台仍微熱的咖啡機。
- **細節：** 機身溫度顯示在過去 15 分鐘內被使用過。

#### 收集時

**相馬律**：還是熱的。

**早坂茜**：表示有人剛沖過咖啡？

#### 重新檢視

[相馬律從口袋取出記事本。]

**相馬律**：21:14。死者死亡時間。咖啡機餘溫不對。

### evidence:wet_floor_marks {#wet_floor_marks}
- **名稱：** 半濕的地板水痕
- **描述：** 倉庫地板上一灘剛擦過、仍微濕的水痕。
- **細節：** 水痕邊緣與一般雨水滲入的形狀不一致。

#### 收集時

[相馬律蹲下，用指尖碰了一下地面。]

**相馬律**：剛被擦過。

### evidence:shelf_recently_moved {#shelf_recently_moved}
- **名稱：** 剛被推動過的貨架
- **描述：** 滾輪貨架的輪痕在地上留下半圓形刮痕。
- **細節：** 刮痕方向顯示貨架最近被往左推開了大約四十公分。

#### 收集時

**相馬律**：剛被推過。

## Statement Manifest

### statement:hayasaka_says_alive {#hayasaka_says_alive}
- **發言人：** 早坂茜
- **內容：** 「若槻蓮堅持，他離開時那個人還活著。」

#### 取得時

[早坂茜的語氣比之前更慎重。]

**早坂茜**：他不像是在撒謊。

## 退出

[相馬律站在倉庫門口回頭看了一眼。]

**相馬律**：走吧。
```

## Future work

Confrontation (presenting evidence to characters / statements), deduction slot filling, and testimony cross-examination are **not** part of investigation scenes. They belong to a separate `interrogation_scene_<N>.md` file format covered by a future `writing-interrogation-scene` skill — to be designed when that scene type is ready to build.
````

- [ ] **Step 3: Verify the file was written**

Run: `wc -l .claude/skills/writing-investigation-scene/SKILL.md`
Expected: approximately 300+ lines.

Run: `head -5 .claude/skills/writing-investigation-scene/SKILL.md`
Expected: starts with `---` frontmatter and the `name: writing-investigation-scene` line.

- [ ] **Step 4: Verify the skill appears in the available-skills list**

The skill list is provided to Claude via system reminders. To verify the new skill is registered, in a fresh interaction you should see `writing-investigation-scene` listed alongside `writing-detective-game-dialogue`. If you are executing this plan inline, the list will refresh after the next user turn.

Manual sanity check (does not require fresh session):

Run: `grep -c '^name: writing-investigation-scene$' .claude/skills/writing-investigation-scene/SKILL.md`
Expected: `1` (the frontmatter `name` field exists exactly once).

Run: `grep -c '^description: Use when' .claude/skills/writing-investigation-scene/SKILL.md`
Expected: `1` (the frontmatter `description` field starts with "Use when").

- [ ] **Step 5: Commit Task 1**

```bash
git add .claude/skills/writing-investigation-scene/
git commit -m "$(cat <<'EOF'
feat: add writing-investigation-scene skill

Project-level skill defining the investigation_scene_<N>.md format
for interactive investigation parts of the detective game. Covers
sub-locations, hotspots, characters, topics, evidence/statement
manifests, and auto-chain reveal/unlock syntax. Declares
writing-detective-game-dialogue as required background for base
dialogue rules.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Expected output: `[main <sha>] feat: add writing-investigation-scene skill` followed by file change summary.

---

### Task 2: Cross-reference from the existing dialogue skill

**Files:**
- Modify: `.claude/skills/writing-detective-game-dialogue/SKILL.md` (File organisation section, lines ~113–130)

The existing skill's File Organisation section currently shows only `scene_<N>.md` files. Add a line mentioning `investigation_scene_<N>.md` and pointing to the new skill.

- [ ] **Step 1: Read the current File organisation section to find the exact location**

Run: `grep -n "scene_<N>.md\|Path convention\|Each chapter" .claude/skills/writing-detective-game-dialogue/SKILL.md`
Expected: lines showing the File Organisation section structure.

- [ ] **Step 2: Edit the File Organisation section to mention investigation_scene files**

Find this block in `.claude/skills/writing-detective-game-dialogue/SKILL.md`:

```markdown
Each chapter is split into **one file per scene**:

```
static/stories_plan/
  General Plan.md                                  ← master outline (do not modify)
  第_X_章_<章節標題>_詳細計劃.md                       ← per-chapter planning (read before writing)
  chapter_X/
    scene_0.md                                     ← one scene per file
    scene_1.md
    scene_2.md
    ...
```
```

Replace it with:

```markdown
Each chapter is split into **one file per scene**. Two file kinds exist:

```
static/stories_plan/
  General Plan.md                                  ← master outline (do not modify)
  第_X_章_<章節標題>_詳細計劃.md                       ← per-chapter planning (read before writing)
  chapter_X/
    scene_0.md                                     ← linear dialogue scene (this skill)
    investigation_scene_1.md                       ← interactive investigation (see writing-investigation-scene)
    scene_2.md
    investigation_scene_3.md
    ...
```

- **`scene_<N>.md`** — linear dialogue (intro cutscenes, transitions, in-car conversations). Covered fully by this skill.
- **`investigation_scene_<N>.md`** — interactive scenes with hotspots, characters, evidence and statement manifests. Authored using the **`writing-investigation-scene`** skill, which inherits the base dialogue rules from this skill. Use that skill when the file you are writing has the `investigation_scene_` prefix.
```

- [ ] **Step 3: Verify the edit**

Run: `grep -A 2 "investigation_scene" .claude/skills/writing-detective-game-dialogue/SKILL.md | head -20`
Expected: at least two matches — the new file-tree entries and the description bullet pointing to `writing-investigation-scene`.

- [ ] **Step 4: Commit Task 2**

```bash
git add .claude/skills/writing-detective-game-dialogue/SKILL.md
git commit -m "$(cat <<'EOF'
docs: cross-reference investigation skill in dialogue skill

Add investigation_scene_<N>.md to the file organisation section of
the base dialogue skill, with a pointer to the new
writing-investigation-scene skill. The base skill remains the
authority for dialogue format; the investigation skill layers
structural blocks on top.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Expected output: `[main <sha>] docs: cross-reference investigation skill in dialogue skill`.

---

### Task 3: Validate by dispatching a subagent dry-run

The "test" of a documentation skill is: can an agent that hasn't seen this conversation read the skill and produce a valid investigation scene fragment? Dispatch a fresh sonnet subagent to author a small fragment using only the new skill.

**Files:**
- Create: `docs/superpowers/plans/.scratch/test_scene_output.md` (subagent writes here; deleted after verification)

- [ ] **Step 1: Create scratch directory**

Run: `mkdir -p docs/superpowers/plans/.scratch`
Expected: silent success.

- [ ] **Step 2: Dispatch the validation subagent**

Use the `Agent` tool with `subagent_type=general-purpose`, `model=sonnet`. The prompt is below — pass it verbatim:

```
You are validating a new skill by using it to produce a small example file. Working directory: /Users/chanwaichan/workspace/Lyra.

## Step 1 — Read the skill

Use the Skill tool to invoke `writing-investigation-scene`. Read all of it. Also read the required-background skill it points to: `writing-detective-game-dialogue` (use the Skill tool for that too).

## Step 2 — Write a tiny investigation scene

Author a small contrived investigation scene fragment that exercises every block type the skill defines. The scene need not relate to the actual game story — it's purely a structural test.

Save it to: `/Users/chanwaichan/workspace/Lyra/docs/superpowers/plans/.scratch/test_scene_output.md`

Requirements:
- Exactly one `# Scene N: <title>` H1
- One `## 進入` block with 2-3 lines of dialogue
- TWO `## Sub-location:` blocks — the first `狀態: unlocked`, the second `狀態: locked` with a `解鎖條件:`
- Each Sub-location has its own `[場景:...]` tag with 地點/時間/天氣/氛圍/視覺要素
- The first Sub-location contains:
  - Two `### Hotspot:` blocks (one revealing an evidence, one revealing a topic)
  - One `### Character:` block with two `#### Topic:` sub-blocks (one unlocked, one locked-with-inbound-揭露-from-the-hotspot)
- The second Sub-location contains one `### Hotspot:` block with `揭露:` to an evidence and a statement
- A `## Evidence Manifest` with at least two entries, each with `#### 收集時` (one of them also has `#### 重新檢視`)
- A `## Statement Manifest` with one entry with `#### 取得時`
- A `## 退出` block with 1-2 lines of dialogue
- All dialogue in Traditional Chinese, following the base dialogue format (`**角色名**：` with full-width colon, ≤100 chars per line, `[ ]` brackets for actions)
- All IDs are English slugs anchored with `{#id}`

## Step 3 — Self-check

Before reporting back, verify these in your file:
1. Run: `grep -c '^## Sub-location' docs/superpowers/plans/.scratch/test_scene_output.md` → must be 2
2. Run: `grep -c '^### Hotspot' docs/superpowers/plans/.scratch/test_scene_output.md` → must be 3
3. Run: `grep -c '^### evidence:' docs/superpowers/plans/.scratch/test_scene_output.md` → must be ≥ 2
4. Run: `grep -c '^### statement:' docs/superpowers/plans/.scratch/test_scene_output.md` → must be ≥ 1
5. Run: `grep -c '^#### 收集時' docs/superpowers/plans/.scratch/test_scene_output.md` → must be ≥ 2
6. Run: `grep -c '^#### 取得時' docs/superpowers/plans/.scratch/test_scene_output.md` → must be ≥ 1
7. Run: `grep '^- \*\*狀態：\*\* locked' docs/superpowers/plans/.scratch/test_scene_output.md | wc -l` → must be ≥ 2 (the locked sub-location and the locked topic)
8. Confirm: no `## Present:` blocks, no `## Deduction Slot:` blocks (those are interrogation-scene territory)
9. Confirm: every locked block has either `**解鎖條件：**` or appears as a target inside a `揭露:` list elsewhere in the file

Report the grep outputs and any judgement calls you made (under 200 words). The file lives in the scratch dir — don't paste it into your reply.
```

Expected: subagent reports all grep counts match, and confirms no Present/Deduction blocks.

- [ ] **Step 3: Manually inspect the output**

Run: `cat docs/superpowers/plans/.scratch/test_scene_output.md | head -80`
Expected: the file follows the canonical order. If the subagent produced anything obviously wrong (out-of-order blocks, missing scene tags, simplified Chinese), the skill documentation has a gap — note what's missing and edit the skill before proceeding to commit.

Run: `grep -E "^(# |## |### |#### )" docs/superpowers/plans/.scratch/test_scene_output.md`
Expected: heading order matches canonical (進入 → Sub-locations → Evidence Manifest → Statement Manifest → 退出).

- [ ] **Step 4: If the validation passed, delete the scratch file**

Run: `rm docs/superpowers/plans/.scratch/test_scene_output.md && rmdir docs/superpowers/plans/.scratch 2>/dev/null; ls docs/superpowers/plans/`
Expected: scratch artefacts gone; only the plan and spec files remain visible.

- [ ] **Step 5: If validation revealed gaps, edit the skill and re-test**

If the subagent struggled with any part of the skill, that's signal the documentation needs to be clearer. Fix the skill (`.claude/skills/writing-investigation-scene/SKILL.md`), then re-run Step 2 with a fresh subagent. Repeat until the subagent succeeds cleanly without needing clarification.

If you edited the skill, amend Task 1's commit OR create a follow-up commit `docs: clarify <X> in investigation skill after validation`. Prefer the follow-up commit for traceability.

---

## Self-Review

This plan's tasks map back to the spec as follows:

| Spec section | Implementation |
|---|---|
| §1 hybrid format decision | Task 1 SKILL.md "When to use" + "File skeleton" sections |
| §2 file naming | Task 2 (edits the dialogue skill's file org section) + Task 1 "When to use" |
| §3 heading-based block style | Task 1 "Heading hierarchy" + "Block field schemas" |
| §4 heading hierarchy | Task 1 "Heading hierarchy reference" table |
| §5 block field schemas | Task 1 "Block field schemas" section |
| §6 reveal/unlock syntax | Task 1 "Reveal / unlock syntax" section |
| §7 sub-location semantics | Task 1 "Sub-location semantics" section |
| Skill packaging — new skill | Task 1 |
| Skill packaging — edit existing skill | Task 2 |
| Forward note re. interrogation scene | Task 1 "Future work" section |
| Parser validation guarantees | Task 1 "Parser validation guarantees" section |

**Placeholder scan:** no TBD/TODO markers; every step has complete content or exact commands.

**Type consistency:** the skill file uses the same field names (`狀態`, `揭露`, `解鎖條件`, `描述`, `角色`, `簡介`, `名稱`, `細節`, `發言人`, `內容`, `收集時`, `取得時`, `重新檢視`) consistently across schema tables, worked example, and validation rules. Reveal target forms (`evidence:`, `statement:`, `topic:<character>@<topic>`, `hotspot:`, `sublocation:`) appear identically in the syntax section, validation rules, and worked example.
