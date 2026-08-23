---
name: writing-detective-game-dialogue
description: Use when writing or expanding chapter scripts for the Lyra detective game project 《東京雨證：第零證人》 under docs/stories_plan/ or static/stories_plan/. Output must be Traditional Chinese game-style dialogue with scene tags, bracketed stage directions, per-line bold character labels, and short (≤100 Chinese char) dialogue lines — not prose. Trigger when given a chapter detail plan (詳細計劃) and asked to produce a playable script (劇本), or to extend an existing 劇本.
---

# Writing Detective Game Dialogue (《東京雨證：第零證人》)

## Role

You are a professional detective-mystery novelist writing the **playable script (劇本)** for a detective game in the style of Ace Attorney / Danganronpa. The output is **dialogue the player will click through line-by-line in-game**, not novel prose.

This skill is the canonical authority for the project's script format.

## When to use

Use when the user asks you to:
- Convert a `docs/stories_plan/chapter_<N>_plan.md` into the corresponding playable chapter scenes
- Write or extend any Part of any chapter's script
- Write a single scene (e.g. "write Part 0 of Chapter 1")
- Add new dialogue beats to an existing 劇本

**Do not use for:** chapter outlines, character bios, plot planning documents, the story bible, or any non-dialogue planning file. Those are pre-writing artefacts, not script.

## Core principles (non-negotiable)

1. **Dialogue drives the plot.** Don't let 旁白 carry visible narration or a present character's conclusion. Use it only for the limited cases in the narration assignment below.
2. **Each dialogue line ≤ ~100 Chinese characters.** No paragraph-length lines. Long content must be split across multiple consecutive lines (same speaker repeats label, or alternates with brackets).
3. **Fixed line format:** `**角色名稱**：對白內容`
   - Character name in Markdown **bold**.
   - Full-width colon `：` between name and dialogue.
   - One blank line between dialogue lines.
4. **Natural, direct voice.** Lines should sound like something the character would actually say, matching their personality. Avoid ornate literary phrasing. Keep reasoning beats clear, not winding. **Before writing any character's lines, read `characters.md` (see "Character reference" below) and match that character's 台詞風格 / 禁止 entry; resolve the on-screen label and portrait mode in `characters.yaml`.**
5. **Scene tags on every scene change.** `[場景：...]` block at the top of every new scene, covering 地點 / 時間 / 天氣 / 氛圍 / 視覺要素 — feeds AI background-image generation.
6. **Visible non-dialogue content lives in `[ ]` brackets** — facial expressions, body language, atmospheric beats, room/object state, and prop movement. Brackets are filtered out of the in-game dialogue UI; they serve as production reference only.
7. **Traditional Chinese only.** No simplified characters. No raw Japanese kanji forms (経 → 經, 実 → 實). Japanese-style proper names (相馬律, 早坂茜, 神谷澪) are kept as-is.

### Narration assignment

| Meaning | Authored form |
|---|---|
| Visible movement, body language, atmosphere, room/object state | `[ ... ]` |
| Present-character conclusion, judgment, interpretation, reaction | character dialogue |
| Time/location transition, unavailable information, intentional voiceover | `**旁白**：...` |

`旁白` is an explicit, narrow voiceover channel; never use it as a generic
fallback for things the player can see or for a conclusion a present character
can state.

## Format examples

### Scene opening with intentional voiceover

The `旁白` line below is explicitly an intentional time/location transition;
the visible setting and action remain bracketed.

```markdown
[場景：吉祥寺雨鐘咖啡館，深夜。外頭下著細雨，店內燈光昏黃。
吧台後傳出咖啡機的低鳴，空氣中混著金木犀拿鐵的香氣。]

**旁白**：幾分鐘後，鏡頭回到吉祥寺雨鐘咖啡館。

[相馬律推開店門，雨水從傘尖滴落。]

**相馬律**：早坂小姐，這就是案發現場？
```

### Dialogue + action

```markdown
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

Right (split + keep every visible detail in brackets):
```
**旁白**：幾分鐘後，鏡頭轉到倉庫入口。

[相馬律走進倉庫。]

[倉庫的空氣比外面更冷。]

[地上有一灘看似剛擦過、卻仍微濕的水痕。]

[左側的舊門被滾輪貨架半掩著。]

[倉庫深處躺著一具早已沒有體溫的身體。]
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

### Purposeful background prompts

For each materially new view, its `Background Prompt` must state the view's
narrative/spatial function, camera angle or distance, focal area, stable
continuity anchors, lighting/weather/occupancy state, and UI-safe lower
composition. Preserve anchors that make adjacent views legible; change only
what the story or space makes materially different. Never create a variant
solely to increase image count.

## Asset metadata when assets are enabled

When the project asset workflow is enabled, every `[場景：...]` tag in a linear scene must be followed immediately by production metadata:

```markdown
[場景：吉祥寺雨鐘咖啡館，深夜，雨夜。]
- **Background Prompt:** Rainy midnight exterior of a small Tokyo cafe, warm interior light visible through glass, neo-noir detective visual novel background, no characters, no UI text.
- **BGM:** rain_mystery_low
- **BGS:** street_rain
```

- **Background Prompt:** English production metadata for background generation.
- **Background Asset ID:** optional explicit background asset id. When reusing
  an unchanged background, repeat the exact `Background Asset ID` together
  with the scene tag and `Background Prompt`; repeating the prompt alone does
  not reuse an asset and causes the compiler to generate a new id.
- **BGM** and **BGS:** IDs from `static/assets/config/audio.yaml`, or `none`.
- The first visual cue in the compiler-wide manifest order must explicitly set
  both BGM and BGS. Later visual cues may omit a channel to keep the previous
  value; this requirement is not reset per chapter.
- Writers never write filesystem paths.
- Dialogue may request speaker expression with `**角色名**[expression_slug]：台詞`. Omitted expression means `standard`.

### Expression choreography (catalog-bounded)

Before authoring an expression, inspect that speaker's configured expression
slugs in `static/assets/config/characters.yaml`. If a meaningful state
transition has a fitting configured non-standard slug, put it on the dialogue
where the transition lands; do not leave that portrait transition only in a
bracket.

```text
bracketed emotion does not select a portrait
use configured slugs only
switch on meaningful state transitions
avoid line-by-line flicker
standard-only / calm scenes remain valid
```

## File organisation

Each chapter is split into **one file per scene**. Four authored file kinds exist:

```
stories_plan/               ← either docs/stories_plan/ or static/stories_plan/
  final_story_bible.md                             ← canonical story bible (planning only)
  chapter_<N>_plan.md                              ← per-chapter construction plan (planning only)
  characters.md                                   ← consolidated cast reference
  chapter_<N>/
    chapter.md                                     ← playable chapter manifest
    scene_0.md                                     ← linear dialogue scene (this skill)
    investigation_scene_1.md                       ← interactive investigation (see writing-investigation-scene)
    interrogation_scene_2.md                       ← inquiry / testimony authoring (see writing-interrogation-scene)
    analysis_scene_3.md                             ← analysis board (see writing-analysis-scene)
    scene_3.md
    ...
```

- **`scene_<N>.md`** — linear dialogue (intro cutscenes, transitions, in-car conversations). Covered fully by this skill.
- **`investigation_scene_<N>.md`** — interactive scenes with hotspots, characters, evidence and statement manifests. Authored using the **`writing-investigation-scene`** skill, which inherits the base dialogue rules from this skill. Use that skill when the file you are writing has the `investigation_scene_` prefix.
- **`interrogation_scene_<N>.md`** — suspect inquiry and testimony cross-examination authoring. Use the **`writing-interrogation-scene`** skill; this skill supplies only the base dialogue rules for its dialogue bodies.
- **`analysis_scene_<N>.md`** — evidence-arrangement boards. Use the
  **`writing-analysis-scene`** skill; this skill supplies only the base dialogue
  rules for its dialogue carriers.

### Path convention

- **All filenames and folder names are English / ASCII.** Only the file **contents** are Traditional Chinese.
- **Playable folder:** `<stories_plan_root>/chapter_<N>/` where `<stories_plan_root>` is either `docs/stories_plan/` or `static/stories_plan/`, and `<N>` is the chapter number (e.g. `chapter_1/`, `chapter_2/`).
- **Construction plan:** `docs/stories_plan/chapter_<N>_plan.md`.
- **Filename:** `scene_<N>.md` — scene numbers align with the beat/scene numbers in the construction plan (so Beat 0 → `scene_0.md`, etc.).
- Create the playable folder if it doesn't exist before writing.

**Do not confuse `chapter_<N>_plan.md` with `chapter_<N>/chapter.md`:** the former is planning material; the latter is the playable scene manifest consumed by the compiler.

### Internal structure of one scene file

Each `scene_<N>.md` is **one scene only**. Structure:

```
# Scene <N>: <scene title in Traditional Chinese>

- **Summary:** <one-sentence player recap copy, not a beat list>

[場景：地點、時間、天氣、氛圍、視覺要素]

**旁白**：...

**相馬律**：...

[早坂茜推開店門]

**早坂茜**：...
```

- One `#` H1 at the top: `# Scene <N>: <title>`. Title is Traditional Chinese, matches the corresponding beat title in `chapter_<N>_plan.md`.
- Immediately after the H1, write `- **Summary:** <...>`: one sentence of player-facing recap copy, not a beat list. The `[場景：...]` block follows the Summary.
- **No `##` Part headings inside the file** — the file *is* the scene.
- If a single Part needs multiple sub-scenes (rare — e.g. location change mid-Part), use additional `[場景：...]` blocks within the same file rather than `##` subheadings.

### Related project files

- `docs/stories_plan/final_story_bible.md` — canonical eight-chapter story canon and reveal boundaries. **Do not modify while authoring a scene.**
- `docs/stories_plan/chapter_<N>_plan.md` — per-chapter construction plan, timeline, clue placement and beat intent. **Read before** writing that chapter's script.
- `docs/stories_plan/characters.md` — consolidated cast reference (see below). **Read before** writing any character's dialogue.
- `static/assets/config/characters.yaml` — the global runtime speaker catalog for authored display labels, portrait intent, and configured expression slugs. **Read before** writing any speaker who appears on-screen.
- `chapter_<N>/scene_<K>.md` — the output of this skill (one file per scene).

### Character reference (`stories_plan/characters.md`)

`characters.md` sits at the root of the `stories_plan/` tree (currently
`docs/stories_plan/characters.md`). It is the single source for each character's
**設定 (background) / 性格 (personality) / 台詞風格 (voice) / 禁止 (avoid + spoiler seals)**,
consolidated from the story bible. It is planning material, **not** a scene file —
the compiler ignores it.

Use it like this:

- **Before writing a character's lines**, open their entry and write to the 台詞風格 examples
  (sentence length, register, verbal tics) — not a generic voice.
- **Honour the 禁止 / 🔒 主線封印 list.** Each entry flags what would break the character or leak
  a sealed reveal. This is the per-character companion to the chapter-level foreshadowing rules
  in `final_story_bible.md` and `chapter_<N>_plan.md`.
- If `characters.md` and the story bible ever disagree, the **story bible wins** (characters.md says so).
- Adding a new named character? Add the story-voice entry to `characters.md`
  when planning requires it, and resolve the global catalog label and
  `portraitMode` under the rule below before production use.

### Global visual speaker catalog (`static/assets/config/characters.yaml`)

`characters.md` governs story voice and spoiler seals. The global catalog
governs the runtime label, portrait intent, and available expression slugs;
it is the only visual-speaker contract. Resolve an authored bold speaker label
against its catalog `displayNames` rather than inventing or shortening one.

```text
reusable or visually important speaker -> characters.yaml portraitMode: portrait
intentional faceless/system/very minor speaker -> characters.yaml portraitMode: none
unknown/unresolved identity -> stop and resolve catalog label/mode
never rely on an uncatalogued speaker compiling portraitless
```

For a missing or unresolved speaker, return an explicit asset/catalog
escalation before production use: identify the needed global `displayNames`
label and `portraitMode` decision. Do not create a local speaker list or treat
an entry in `characters.md` as a substitute for the global catalog.

## Writing workflow

When asked to write any part of a chapter:

1. **Read `docs/stories_plan/final_story_bible.md` and the matching `docs/stories_plan/chapter_<N>_plan.md`** — canon, timeline, clue placement, foreshadow seeds and reveal boundaries.
2. **Read `characters.md` and `static/assets/config/characters.yaml`** for every speaker in this scene — lock their 台詞風格 / 禁止, catalog display label, portrait mode, and configured expression slugs before drafting lines.
3. **Check the chapter's reveal contract in the story bible and chapter plan** — which foreshadows are seeded *this* chapter, and critically, which secrets must not yet be revealed.
4. **Confirm scope with the user before writing** — which Part(s)? If unclear, write one Part and stop, so tone can be reviewed before scaling.
5. **Plan the Part structure** — opening scene tag, 3–5 conversation beats, ending moment. Output the plan first when scope is ambiguous.
6. **Write each Part starting with `[場景：...]`**.
7. **Advance plot via dialogue**, using `旁白` only for the narration-assignment cases above.
8. **Self-check before reporting done:**
   - Any line >100 Chinese characters? Split it.
   - Any action/expression inline with dialogue? Move it into `[ ]`.
   - Every scene change has a scene tag?
   - No simplified Chinese? No 経/実-style kanji?
   - Does each character's voice match their `characters.md` 台詞風格, with no 禁止 / 🔒 line crossed?
   - Does every speaker resolve to the global catalog label and an intentional `portraitMode`, with no uncatalogued portraitless fallback?
   - Does each meaningful visual state transition use a fitting configured expression slug when one exists, without flickering on every line?
   - Foreshadows match `final_story_bible.md` and the current `chapter_<N>_plan.md`?

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
| Visible action, body language, atmosphere, room/object state in 旁白 | Move it into `[ ]`; reserve `旁白` for time/location transition, unavailable information, or intentional voiceover |
| Present character's conclusion in 旁白 | Let that character state it in dialogue |
| Single intentional 旁白 >100 chars | Split across consecutive intentional voiceover lines |
| Action written inside dialogue line | Move to a bracketed line above or below |
| Scene change with no `[場景：...]` | Add one covering all four required elements |
| Simplified Chinese / raw Japanese kanji | Convert to Traditional (経→經, 実→實, 関→關, etc.) |
| Revealing a sealed cross-chapter secret too early | Cross-check `final_story_bible.md` + the current `chapter_<N>_plan.md`; hold back |
| Inline phone qualifier `（電話）` on speaker name | Use `[相馬的手機震動，他接起]` stage direction instead |
| Writing multiple Parts when user asked for one | Stop. Scope creep is a process failure, not a feature. |

## Foreshadowing discipline

This is a multi-chapter mystery with deliberately staged reveals. Before placing any clue or hint, check `docs/stories_plan/final_story_bible.md` and the current `docs/stories_plan/chapter_<N>_plan.md`.

For Chapter 1 specifically:
- **Prologue 0–2:** do not name 青葉, A-90, 雨宮, `ZW_A16.lock`, or 相馬's old-case identity.
- **Beats 0–11 may seed only:** 約 90 秒 as a maintenance/sync discrepancy without origin; 藍色透明傘 without owner ID or formal-evidence treatment; 金木犀 with only a hand-pause / brief low-intensity reaction, **no headache or flashback**; `ZW_A16.lock` as an inaccessible filename only, **not** `ZERO_WITNESS` or `Aoba_2016`; 雨宮's anonymous message without identity or explanation.
- **Beat 11.5 is the only Chapter 1 青葉-name exception:** a public Mashiro preview may say **「2016 年青葉記憶研究所火災」**, and 相馬 may mute, look away, or pause briefly. Do not label the flashed image as raw / actual / reenactment, do not explain his reaction, and keep `ZW_A16.lock` off-screen so the two source chains are not linked.
- **Still forbidden through Chapter 1:** `A16 = Aoba_2016`, `ZW = ZERO WITNESS`, 雨宮's real identity, 相馬 being an Aoba witness, his father's full Aoba role, left/right escape truth, A-90 Hold, Kagamihara involvement, or any KAGAMI-conspiracy explanation.

For later chapters: read that chapter's reveal-ladder row and the matching `chapter_<N>_plan.md`. Stay strict.

## Linear scene file format (`chapter_<N>/scene_<K>.md`)

A file matching `chapter_<N>/scene_<K>.md` is a **linear-dialogue scene** — a single queue of dialogue the player clicks through, with no hotspots, characters to question, or branching choices. These are used for intro cutscenes, in-car conversations, transitions, and chapter endings.

### Required structure

Exactly one H1 title line at the top, then dialogue. **No H2 or deeper headings are allowed in a linear scene file.** The parser reads the file top-to-bottom and emits dialogue items in source order.

```
# Scene 0: 接案

- **Summary:** 相馬在雨夜接下委託，知道眼前的紀錄仍缺了一段人證。

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
- `- **Summary:**` sits directly after the H1 and is one-sentence player recap copy, never a beat list.
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
