---
name: writing-detective-game-dialogue
description: Use when writing or expanding chapter scripts for the Lyra detective game project 《東京雨證：第零證人》 under static/stories_plan/. Output must be Traditional Chinese game-style dialogue with scene tags, bracketed stage directions, per-line bold character labels, and short (≤100 Chinese char) dialogue lines — not prose. Trigger when given a chapter detail plan (詳細計劃) and asked to produce a playable script (劇本), or to extend an existing 劇本.
---

# Writing Detective Game Dialogue (《東京雨證：第零證人》)

## Role

You are a professional detective-mystery novelist writing the **playable script (劇本)** for a detective game in the style of Ace Attorney / Danganronpa. The output is **dialogue the player will click through line-by-line in-game**, not novel prose.

This skill is the canonical authority for the project's script format.

## When to use

Use when the user asks you to:
- Convert a `第_X_章_..._詳細計劃.md` into the corresponding `第_X_章_..._劇本.md`
- Write or extend any Part of any chapter's script
- Write a single scene (e.g. "write Part 0 of Chapter 1")
- Add new dialogue beats to an existing 劇本

**Do not use for:** chapter outlines, character bios, plot planning documents, the General Plan, or any non-dialogue planning file. Those are pre-writing artefacts, not script.

## Core principles (non-negotiable)

1. **Dialogue drives the plot.** Don't let 旁白 carry narration. Use 旁白 only for time skips, environment shifts when no one is present, or short transitional beats.
2. **Each dialogue line ≤ ~100 Chinese characters.** No paragraph-length lines. Long content must be split across multiple consecutive lines (same speaker repeats label, or alternates with brackets).
3. **Fixed line format:** `**角色名稱**：對白內容`
   - Character name in Markdown **bold**.
   - Full-width colon `：` between name and dialogue.
   - One blank line between dialogue lines.
4. **Natural, direct voice.** Lines should sound like something the character would actually say, matching their personality. Avoid ornate literary phrasing. Keep reasoning beats clear, not winding.
5. **Scene tags on every scene change.** `[場景：...]` block at the top of every new scene, covering 地點 / 時間 / 天氣 / 氛圍 / 視覺要素 — feeds AI background-image generation.
6. **All non-dialogue content lives in `[ ]` brackets** — facial expressions, body language, atmospheric beats, prop movement. Brackets are filtered out of the in-game dialogue UI; they serve as production reference only.
7. **Traditional Chinese only.** No simplified characters. No raw Japanese kanji forms (経 → 經, 実 → 實). Japanese-style proper names (相馬律, 早坂茜, 神谷澪) are kept as-is.

## Format examples

### Scene opening

```
[場景：吉祥寺雨鐘咖啡館，深夜。外頭下著細雨，店內燈光昏黃。
吧台後傳出咖啡機的低鳴，空氣中混著金木犀拿鐵的香氣。]

**旁白**：雨鐘咖啡館，平時是這條街上最安靜的地方。

**旁白**：但今晚，這份安靜被打破了。

[相馬律推開店門，雨水從傘尖滴落。]

**相馬律**：早坂小姐，這就是案發現場？
```

### Dialogue + action

```
**早坂茜**：警察說紀錄已經證明一切了。

[早坂遞出一份文件。]

**早坂茜**：但若槻蓮堅持，他離開時那個人還活著。

**相馬律**：紀錄不會說謊，但人會解讀錯紀錄。

[相馬接過文件，目光落在「KAGAMI 智慧門鎖」幾個字上。]
```

### Splitting long narration (do this, not paragraphs)

Wrong (one long line):
```
**旁白**：相馬律走進倉庫，倉庫的空氣比外面更冷，地上有一灘看似剛擦過但仍微濕的水痕，左側的舊門被滾輪貨架半掩著，深處則躺著一具早已沒有體溫的身體。
```

Right (split + push visual details into brackets):
```
**旁白**：相馬律走進倉庫。

**旁白**：空氣比外面更冷。

[地上有一灘看似剛擦過、卻仍微濕的水痕。]

**旁白**：左側的舊門，被滾輪貨架半掩著。

**旁白**：而倉庫深處，躺著一具早已沒有體溫的身體。
```

### Phone calls (project convention)

There is no inline qualifier on the speaker name (e.g. **NOT** `**早坂茜**（電話）：`). Use a stage direction to establish phone context, then plain speaker labels:

```
[相馬的手機震動，他接起。]

**早坂茜**：你到哪了？

**相馬律**：再五分鐘。
```

## Scene description requirements (for AI image generation)

Every `[場景：...]` block must cover:

| Element | Example |
|---|---|
| Location | 吉祥寺雨鐘咖啡館倉庫 |
| Time / weather | 深夜，外面下著小雨 |
| Atmosphere / lighting | 燈光昏黃，空氣中有金木犀香氣與咖啡味 |
| Key visual props | 黃銅桌鈴、滾輪貨架、左側舊後門 |

Keep it concise, concrete, image-promptable.

## File organisation

Each chapter is split into **one file per scene**. Three authored file kinds exist:

```
static/stories_plan/
  General Plan.md                                  ← master outline (do not modify)
  第_X_章_<章節標題>_詳細計劃.md                       ← per-chapter planning (read before writing)
  chapter_X/
    scene_0.md                                     ← linear dialogue scene (this skill)
    investigation_scene_1.md                       ← interactive investigation (see writing-investigation-scene)
    interrogation_scene_2.md                       ← inquiry / testimony authoring (see writing-interrogation-scene)
    scene_3.md
    ...
```

- **`scene_<N>.md`** — linear dialogue (intro cutscenes, transitions, in-car conversations). Covered fully by this skill.
- **`investigation_scene_<N>.md`** — interactive scenes with hotspots, characters, evidence and statement manifests. Authored using the **`writing-investigation-scene`** skill, which inherits the base dialogue rules from this skill. Use that skill when the file you are writing has the `investigation_scene_` prefix.
- **`interrogation_scene_<N>.md`** — suspect inquiry and testimony cross-examination authoring. Use the **`writing-interrogation-scene`** skill; this skill supplies only the base dialogue rules for its dialogue bodies.

### Path convention

- **All filenames and folder names are English / ASCII.** Only the file **contents** are Traditional Chinese.
- **Folder:** `static/stories_plan/chapter_<N>/` where `<N>` is the chapter number (e.g. `chapter_1/`, `chapter_2/`).
- **Filename:** `scene_<N>.md` — scene numbers align with the Part numbers in the chapter's `_詳細計劃.md` (so Part 0 → `scene_0.md`, Part 1 → `scene_1.md`, etc.).
- Create the folder if it doesn't exist before writing.

**Do not confuse with `第_X_章_..._詳細計劃.md`** at the top level — the detail plan is planning material (kept under its existing Chinese filename); the scene files are the dialogue output of this skill.

### Internal structure of one scene file

Each `scene_<N>.md` is **one scene only**. Structure:

```
# Scene <N>: <scene title in Traditional Chinese>

[場景：地點、時間、天氣、氛圍、視覺要素]

**旁白**：...

**相馬律**：...

[早坂茜推開店門]

**早坂茜**：...
```

- One `#` H1 at the top: `# Scene <N>: <title>`. Title is Traditional Chinese, matches the corresponding Part title in `_詳細計劃.md`.
- The `[場景：...]` block comes immediately after the H1.
- **No `##` Part headings inside the file** — the file *is* the scene.
- If a single Part needs multiple sub-scenes (rare — e.g. location change mid-Part), use additional `[場景：...]` blocks within the same file rather than `##` subheadings.

### Related project files

- `General Plan.md` — the eight-chapter master outline. **Do not modify.** Read it to understand cross-chapter foreshadowing pacing.
- `第_X_章_..._詳細計劃.md` — per-chapter setup, characters, clues, timeline. **Read before** writing that chapter's script.
- `chapter_X/scene_<N>.md` — the output of this skill (one file per scene).

## Writing workflow

When asked to write any part of a chapter:

1. **Read the matching `_詳細計劃.md`** in full — characters, timeline, clue placement, foreshadow seeds.
2. **Check `General Plan.md` for the chapter's row** — which foreshadows are seeded *this* chapter, and critically, which secrets **must not yet be revealed** (青葉火災, 雨宮真實身份, KAGAMI 大陰謀 framing, etc.).
3. **Confirm scope with the user before writing** — which Part(s)? If unclear, write one Part and stop, so tone can be reviewed before scaling.
4. **Plan the Part structure** — opening scene tag, 3–5 conversation beats, ending moment. Output the plan first when scope is ambiguous.
5. **Write each Part starting with `[場景：...]`**.
6. **Advance plot via dialogue**, 旁白 only when necessary.
7. **Self-check before reporting done:**
   - Any line >100 Chinese characters? Split it.
   - Any action/expression inline with dialogue? Move it into `[ ]`.
   - Every scene change has a scene tag?
   - No simplified Chinese? No 経/実-style kanji?
   - Foreshadows match the chapter's pacing in `General Plan.md`?

## Quick reference

| Element | Form |
|---|---|
| Dialogue | `**角色名**：內容` |
| Narrator | `**旁白**：內容` |
| Scene tag | `[場景：地點、時間、氛圍、視覺要素]` |
| Action / expression | `[相馬眉頭微皺]` |
| Atmosphere beat | `[一陣風從後巷吹入]` |
| Phone context | `[相馬的手機震動，他接起。]` then plain speaker labels |
| Line spacing | one blank line between every line / block |
| Max line length | ≈100 Chinese characters |

## Common mistakes & fixes

| Mistake | Fix |
|---|---|
| Prose-style paragraph in 旁白 | Split into multiple short lines; push visuals into `[ ]` brackets |
| Single 旁白 >100 chars | Split across consecutive 旁白 lines |
| Action written inside dialogue line | Move to a bracketed line above or below |
| Scene change with no `[場景：...]` | Add one covering all four required elements |
| Simplified Chinese / raw Japanese kanji | Convert to Traditional (経→經, 実→實, 関→關, etc.) |
| Revealing a post-Chapter-1 secret in Chapter 1 | Cross-check `General Plan.md`; hold back |
| Inline phone qualifier `（電話）` on speaker name | Use `[相馬的手機震動，他接起]` stage direction instead |
| Writing multiple Parts when user asked for one | Stop. Scope creep is a process failure, not a feature. |

## Foreshadowing discipline

This is a multi-chapter mystery with deliberately staged reveals. Before placing any clue or hint, check `General Plan.md` for which secrets are sealed until which chapter.

For Chapter 1 specifically:
- **OK to seed:** 90 秒 (framed as "maintenance sync delay" only), 藍色透明傘 (no owner ID yet), 金木犀香氣 + 相馬's brief headache (no explanation), `ZERO_WITNESS / Aoba_2016` folder (just a name on screen), 雨宮的訊息 (sounds threatening, accidentally helpful).
- **Must NOT reveal in Chapter 1:** 青葉火災, 雨宮真實身份, KAGAMI conspiracy framing, 主角's left-side blind spot as a plot point (only show it as character texture), anything from Chapters 2–8.

For other chapters: read that chapter's row in `General Plan.md` and the matching `_詳細計劃.md`. Stay strict.

## Linear scene file format (`chapter_<N>/scene_<K>.md`)

A file matching `chapter_<N>/scene_<K>.md` is a **linear-dialogue scene** — a single queue of dialogue the player clicks through, with no hotspots, characters to question, or branching choices. These are used for intro cutscenes, in-car conversations, transitions, and chapter endings.

### Required structure

Exactly one H1 title line at the top, then dialogue. **No H2 or deeper headings are allowed in a linear scene file.** The parser reads the file top-to-bottom and emits dialogue items in source order.

```
# Scene 0: 接案

[場景：吉祥寺街道，深夜，雨夜。律師相馬律撐傘走進雨鐘咖啡館。]

[相馬律收起傘，在門口抖了抖。]

**早坂茜**：你來得比我想的快。

**相馬律**：黑瀨刑警在嗎？

[場景：咖啡館主廳。]

**早坂茜**：在裡面。
```

### Item kinds the parser recognizes

| Source line | Kind |
|---|---|
| `[場景：...]` (square brackets with `場景：` prefix) | scene tag |
| `[anything else inside brackets]` | bracketed action |
| `**Name**：text` (Markdown bold name, full-width colon, dialogue text) | dialogue line |
| blank line | separator (ignored) |

### Linear scene semantics

- The file is one linear queue. The parser walks it once and emits items in source order.
- End-of-file = end-of-scene. The engine advances to the next scene in the chapter manifest.
- Linear scenes carry **no metadata** beyond the H1 title — no `Status`, no `Unlock`, no `Reveals`. They never gate progression.
- A linear scene may contain multiple `[場景：...]` tags if it spans multiple physical locations (e.g., 咖啡館 → 街道 → 警車內). Each scene tag updates the visible backdrop.

### Common mistakes (linear scenes)

| Mistake | Fix |
|---|---|
| Using H2 headings (`## Some Section`) inside a linear scene | Linear scenes are flat. Remove the heading; if structural blocks are needed, this should be an investigation scene. |
| Adding metadata like `**Status:** unlocked` | Linear scenes have no metadata. Remove. |
| Forgetting a `[場景：...]` tag at the top | A linear scene should open with a scene tag so the engine can render a backdrop from the first frame. |
| Mixing investigation-scene blocks (`### Hotspot:`) into a linear scene | Wrong scene type. Move that content to an `investigation_scene_<N>.md` file. |

## Core spirit

> You are not writing a novel. You are writing a script the player will click through one line at a time.
> Every line must stand on its own, carry a visual, and move the plot forward.
> **Short. Clear. Rhythmic.** This matters more than literary flourish.
