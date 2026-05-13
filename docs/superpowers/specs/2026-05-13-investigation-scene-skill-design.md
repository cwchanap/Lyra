# Investigation Scene Skill — Design Spec

**Date:** 2026-05-13
**Status:** Approved (ready for implementation plan)
**Author:** Brainstorm session with project owner

## Context

The project 《東京雨證：第零證人》 is a Tauri/SvelteKit detective game whose chapters are split into multiple parts. The existing `writing-detective-game-dialogue` skill covers **linear dialogue scenes** (intro cutscenes, transitions, in-car conversations) in `chapter_X/scene_<N>.md`.

But the chapter-1 detail plan also includes investigation parts — Part 1 「第一次現場調查」 and Part 4 「第二次現場調查與推理」 — where the player interactively examines hotspots, asks NPCs about topics, and collects evidence / statements. These are not linear scenes; they have branching triggers that must map cleanly onto the game's Rust engine data model (`HotspotState`, `TopicState`, `EvidenceState`, `StatementState`, etc. in `src-tauri/src/investigation.rs`).

This design specifies a format for those investigation parts, and the new skill that authors should use when writing them. Confrontation (presenting evidence) and deduction (filling slots) are **out of scope** — they belong to a future `interrogation_scene` format covering the final-interrogation parts.

## Goals

1. Writers can author investigation scenes in natural Traditional Chinese while the structure remains machine-parseable into Rust `CaseState` data.
2. The format must support: examining hotspots, questioning characters about topics, collecting evidence, collecting statements, sub-location movement, and auto-chain reveal/unlock logic.
3. The new skill must coexist cleanly with the existing dialogue skill — no duplicated format rules.

## Non-goals

- Presenting evidence to confront characters/statements (deferred to `writing-interrogation-scene`)
- Filling deduction slots (deferred to `writing-interrogation-scene`)
- A working parser (the format must support parsing, but the parser itself is a separate workstream)

## Decisions

### 1. Authoring pipeline: hybrid

The script file is the human-readable source. Structured anchors inside it (markdown headings with key:value metadata) are extractable by a future parser into the Rust engine's `CaseState`. Dialogue between anchors is free-form Traditional Chinese following the base dialogue skill.

Rejected alternatives:
- **Script-as-spec (strict).** Over-constrains writer voice; hard to read.
- **Script-as-companion (no parsing).** Dialogue and game data drift out of sync as chapters grow.

### 2. File naming

Inside `static/stories_plan/chapter_<N>/`:

| Filename | Format |
|---|---|
| `scene_<N>.md` | Linear dialogue (existing skill) |
| `investigation_scene_<N>.md` | Interactive investigation (this design) |

Both share the chapter's Part-number space. Example: a chapter might contain `scene_0.md` (opening cutscene), `investigation_scene_1.md` (first investigation), `scene_2.md` (interrogation transition), `investigation_scene_3.md` (second investigation), etc.

All filenames are English / ASCII; only file contents are Traditional Chinese.

### 3. Block style: heading-based with key:value metadata

Each game object is a markdown heading at a fixed H-level, with metadata as bulleted key:value lines below it, then free-form dialogue body. IDs are English slugs declared via `{#id}` anchors on the heading.

Rejected alternatives:
- **Fenced container blocks (`:::hotspot ... :::`).** Looks like a data file; loses the "writer's document" feel.
- **YAML front-matter declarations + body references.** Declaration and dialogue end up far apart in the file; hurts readability as scenes grow.

### 4. Heading hierarchy (final)

| Level | Block |
|---|---|
| H1 | `# Scene N: <title>` (one per file) |
| H2 | `## 進入`, `## Sub-location:`, `## Evidence Manifest`, `## Statement Manifest`, `## 退出` |
| H3 | `### Hotspot:`, `### Character:`, `### evidence:`, `### statement:` |
| H4 | `#### Topic:`, `#### 收集時` / `#### 重新檢視`, `#### 取得時` / `#### 重新檢視` |

Hotspots and Characters always live inside a Sub-location block (H3 under H2). Even single-location scenes wrap everything in one Sub-location for uniformity; the parser handles every file the same way.

### 5. Block field schemas

Reserved keyword labels in **Traditional Chinese**; reserved keyword *values* in **English** (`locked` / `unlocked`).

**Sub-location** (H2)
- Required: `狀態` (`locked` / `unlocked`)
- Optional: `解鎖條件`, `揭露` (list)
- Body: `[場景:...]` tag (required, immediately after metadata), then transition dialogue (plays on first entry), then nested Hotspot/Character blocks.

**Hotspot** (H3, inside a Sub-location)
- Required: `描述`
- Optional: `狀態` (defaults to `unlocked`), `解鎖條件`, `揭露` (list)
- Body: inspect dialogue (plays when player clicks the hotspot for the first time).

**Character** (H3, inside a Sub-location)
- Required: `角色` (role/title), `簡介` (profile)
- Optional: none
- Body: none directly — container for `#### Topic:` blocks.

**Topic** (H4, inside a Character)
- Required: `狀態`
- Optional: `解鎖條件`, `揭露` (list)
- Body: topic dialogue (plays when player selects this topic).

**Evidence Manifest entry** (H3 under `## Evidence Manifest`)
- Heading: `### evidence:<id> {#id}`
- Required: `名稱`, `描述`, `細節`
- Body: `#### 收集時` sub-block (required, dialogue on collection); `#### 重新檢視` sub-block (optional, dialogue when player re-inspects from inventory).

**Statement Manifest entry** (H3 under `## Statement Manifest`)
- Heading: `### statement:<id> {#id}`
- Required: `發言人`, `內容`
- Body: `#### 取得時` sub-block (required, dialogue when first revealed); `#### 重新檢視` sub-block (optional, dialogue when player re-reads from log).

**進入 / 退出** (H2)
- No metadata.
- Body: linear dialogue (intro on scene load; outro on scene close / Part advance).

### 6. Reveal / unlock syntax

All reveals are automatic chains — there is no manual "present evidence" action in investigation scenes.

**`揭露:` list values** (reveal targets):
- `evidence:<id>` — adds to inventory; triggers its `#### 收集時` dialogue
- `statement:<id>` — adds to statement log; triggers its `#### 取得時` dialogue
- `topic:<character-id>@<topic-id>` — unlocks a previously locked topic on a specific character
- `hotspot:<id>` — unlocks a previously locked hotspot
- `sublocation:<id>` — unlocks a previously locked sub-location

**`解鎖條件:` expression grammar** (only on blocks with `狀態: locked`):

Atomic predicates:
- `evidence:<id> 已收集`
- `statement:<id> 已取得`
- `topic:<character-id>@<topic-id> 已討論`
- `hotspot:<id> 已調查`

Combinators (sparingly):
- `<a> 且 <b>`
- `<a> 或 <b>`

**Interaction of `揭露:` and `解鎖條件:`** — two complementary mechanisms, never both for the same chain:

- `揭露:` is an **immediate effect** declared on a source block. It fires once when the source completes (hotspot inspected / topic discussed / sub-location entered), and instantly unlocks/collects each target.
- `解鎖條件:` is a **precondition** declared on a target block that starts `狀態: locked`. It is evaluated against game state; the target unlocks itself the moment the condition becomes true.

Author rule: for any given target, declare *one* path to unlock it. Either the source `揭露`s it (use for 1:1 single-trigger reveals — most evidence and most topic unlocks fit this), or the target itself has a `解鎖條件:` (use for unlocks that need multiple preconditions, e.g. "after inspecting X *and* discussing Y"). Don't declare both — the parser will warn.

**Play order when one trigger reveals multiple things:**

When the player completes a trigger (e.g. selects a topic with `揭露: [statement:S]`), dialogue plays in this fixed order:

1. The trigger block's own body dialogue (e.g. the Topic's response text)
2. Each `揭露` target's collection/reveal dialogue, in list order:
   - `evidence:<id>` → its `#### 收集時` block
   - `statement:<id>` → its `#### 取得時` block
   - `topic:` / `hotspot:` / `sublocation:` reveals are silent unlocks — no automatic dialogue (the unlocked block's own body plays only when the player engages it)

**Parser validation guarantees:**
- Every reference resolves to a declared ID in the same file
- No circular dependencies (A unlocks B, B unlocks A)
- Every `揭露:` target is declared somewhere in the file
- Every block with `狀態: locked` is unlockable — *either* via its own `解鎖條件:` *or* via inbound `揭露` from another block. If neither path exists, it's permanently locked (author error)
- The first Sub-location block in the file is `狀態: unlocked` (the player must be able to enter the scene)
- No target has both an inbound `揭露:` from one source *and* a `解鎖條件:` on itself — pick one (warning, not error)

### 7. Sub-location semantics

- **Entry point:** the first Sub-location declared in the file is where the player starts. Its `狀態` must be `unlocked`.
- **Persistence:** once unlocked, a Sub-location stays unlocked for the rest of the scene. Backtracking is allowed.
- **Scene tag:** each Sub-location *must* have its own `[場景:...]` tag — different physical space, different AI image prompt.
- **Transition dialogue:** the body of a Sub-location block (between metadata and the first nested H3) plays once on first entry.
- **First-entry reveals:** `揭露:` on a Sub-location triggers when the player first enters it — used for environmental discoveries not tied to a specific hotspot.
- **Character placement:** characters belong to exactly one Sub-location. If the same person needs to be present in two physical areas, declare them once per Sub-location with the topics appropriate to that location. Duplication is accepted; it keeps "who is here right now" trivially answerable from the file.

## Skill packaging

Two skills, not one extended skill.

### Existing skill: `writing-detective-game-dialogue`

Stays unchanged in scope. Owns:
- Base dialogue format (`**角色名**：`, ≤100 char, brackets, scene tags, phone convention)
- File path convention (`chapter_X/` folder, English filenames, Traditional Chinese contents)
- Foreshadowing discipline per chapter
- Workflow (read `_詳細計劃.md` → check `General Plan.md` → write)
- Linear `scene_<N>.md` format (no additional structure)

**One edit needed:** add a one-line note in the File Organisation section acknowledging that `investigation_scene_<N>.md` is also a valid file under `chapter_X/`, with a cross-reference to the new skill.

### New skill: `writing-investigation-scene`

Located at `.claude/skills/writing-investigation-scene/SKILL.md` (project-level).

**Frontmatter description:** "Use when writing or extending an `investigation_scene_<N>.md` file under `static/stories_plan/chapter_<N>/` — interactive investigation scenes with hotspots, characters, evidence/statements manifests, and unlock chains. Requires `writing-detective-game-dialogue` for base dialogue format."

**Required background callout:** explicit declaration that this skill describes the *structural wrapper* around dialogue, not the dialogue rules themselves. The reader must already know the base dialogue skill.

**Body covers only:**
1. When to use (file is `investigation_scene_<N>.md` vs. `scene_<N>.md`)
2. File skeleton (canonical order of H2 sections)
3. Heading hierarchy table
4. Block field schemas (one section per block type)
5. Reveal / unlock syntax
6. Sub-location rules
7. Parser validation guarantees (so writers know what will be checked)
8. Common mistakes table
9. A full worked example file (a small contrived scene exercising all block types)

**Body explicitly does NOT cover:**
- How to write a dialogue line (`**角色名**：` format) — that lives in the dialogue skill
- Scene tag requirements per `[場景:...]` — also in the dialogue skill
- Filename / Chinese-content rules — also in the dialogue skill
- Foreshadowing discipline — also in the dialogue skill

### Forward note: future `writing-interrogation-scene`

The investigation skill ends with a brief "future work" callout:

> Confrontation (presenting evidence to characters / statements), deduction slots, and testimony cross-examination are not part of investigation scenes. They belong to a separate `interrogation_scene_<N>.md` format covered by a future `writing-interrogation-scene` skill, to be designed when that scene type is ready to build.

## Worked example (informal — for the skill body)

A reduced fragment showing every block type in canonical order:

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

> Note: this topic has no `解鎖條件` of its own — it's unlocked by the inbound `揭露` from `### Hotspot: 黃銅桌鈴` above. The two mechanisms are mutually exclusive per author rule.

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

## Open items deferred to implementation plan

- Whether the parser is built as a Rust binary, a TypeScript CLI, or a Tauri command (likely TS, since the build step probably runs in Node alongside `vite build`)
- Whether to generate a JSON intermediate file or inject directly into Rust code
- Validation error reporting format
- Whether to add a `bun run check:scripts` task

These are implementation concerns; the format spec above is implementation-agnostic.

## Future work

`writing-interrogation-scene` skill — when ready to build, will cover:
- Presenting evidence to characters (Hotspot-of-NPC-vs-evidence interaction)
- Presenting evidence against statements (contradiction interaction)
- Deduction slot filling with verdict dialogue
- Testimony cross-examination (per-statement press/object interactions)

These will follow a similar hybrid markdown-heading approach and share the same dialogue base skill.
