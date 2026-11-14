---
name: writing-detective-game-dialogue
description: Use when writing or expanding chapter scripts for the Lyra detective game project 《東京雨證：第零證人》 under docs/stories_plan/. Output must be Traditional Chinese game-style dialogue with scene tags, bracketed stage directions, per-line bold character labels, and short (≤100 Chinese char) dialogue lines — not prose. Trigger when given a chapter detail plan (詳細計劃) and asked to produce a playable script (劇本), or to extend an existing 劇本.
---

# Writing Detective Game Dialogue (《東京雨證：第零證人》)

## Role

You are a professional detective-mystery novelist writing the **playable script (劇本)** for a detective game in the style of Ace Attorney / Danganronpa. The output is **dialogue the player will click through line-by-line in-game**, not novel prose.

This skill is the canonical authority for the project's script format.

## When to use

Use when the user asks you to:
- Convert a chapter plan (Notion page, see `CLAUDE.md`) into the corresponding playable chapter scenes
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
   - **Line IDs:** a translated chapter's spoken lines end in an ID such as ` {#L012}` (`**相馬律**：先確認現場。 {#L012}`). It links the line to its translation and voice clip, and is never shown or spoken. Write new lines without one (`bun run voice:sync` adds it). When editing a line, keep its ID at the end; when moving a line, move its ID with it; never copy an ID onto another line or type one yourself.
4. **Natural, direct voice.** Lines should sound like something the character would actually say, matching their personality. Avoid ornate literary phrasing. Keep reasoning beats clear, not winding. **Before writing any character's lines, read the Notion 角色設定總表 (see "Character reference" below) and match that character's 台詞風格 / 必須 / 禁止 entry; resolve the on-screen label and portrait mode in `characters.yaml`.**
5. **Scene tags on every scene change.** `[場景：...]` block at the top of every new scene, covering 地點 / 時間 / 天氣 / 氛圍 / 視覺要素 — feeds AI background-image generation.
6. **Visible non-dialogue content lives in `[ ]` brackets** — body language, atmospheric beats, room/object state, and prop movement. **The player reads every bracketed line:** the game shows it on screen as a narration line (敘述 · NARRATION), with no voice. Keep brackets few and short (see "Brackets are read by the player" below).
7. **Traditional Chinese only.** No simplified characters. No raw Japanese kanji forms (経 → 經, 実 → 實). Japanese-style proper names (相馬律, 早坂茜, 神谷澪) are kept as-is.
8. **Feeling happens on screen.** The story is quiet by default, with a few loud moments per chapter, and the lead, 相馬律, has inner voice. "Emotion and clarity" below is as binding as the format rules.

### Narration assignment

| Meaning | Authored form |
|---|---|
| Visible movement, body language, atmosphere, room/object state | `[ ... ]` |
| Present-character conclusion, judgment, interpretation, reaction | character dialogue |
| What 相馬律 feels or works out in plain words but does not say aloud | inner voice: `**相馬律**：（...）` |
| Time/location transition, unavailable information, intentional voiceover | `**旁白**：...` |

`旁白` is an explicit, narrow voiceover channel; never use it as a generic
fallback for things the player can see or for a conclusion a present character
can state. Inner voice belongs to 相馬律 alone; its form and limits are in
"Emotion and clarity" below.

## Emotion and clarity

Read this before drafting. The format rules above make a scene compile. These
rules make a first-time player care, and keep up.

「不靠感覺定罪」 is a rule about proof, not about people. **Feeling is the
motive; evidence is the means.** A character feels something on screen, then
goes and proves it: 「你要救他，就拿可以被採用的東西救。」

### Volume: quiet by default, three or four loud moments per chapter

- Quiet stays the default register. Do not make a working quiet scene louder.
- Each chapter has **three or four loud moments**: a reversal, a real clash
  between the leads, the culprit cornered, the release at the end. In those
  moments use exclamation marks, cut-off lines (`——`), interjections
  (欸、咦、可惡、糟了) and a fitting configured expression slug.
- **A feeling happens when its cause happens.** Do not skip the moment and
  report it afterwards (「剛才我慌了。」).
- **Do not answer an emotional line with procedure.** The next line is a human
  beat, spoken or inner voice. Procedure comes after it.
- Do not direct emotion away in a bracket (`[會場裡沒有怒吼或拍桌聲。]`) unless
  the silence is the point of the beat.
- The leads may be thrilled, wrong, or angry. Being corrected is not the only
  thing that can happen to a feeling.

### Inner voice (心聲)

相馬律 is the player's seat. Inner voice lets the player hear what he does not
say aloud.

**Form.** A spoken line whose whole text is wrapped in full-width parentheses:

```markdown
**相馬律**：（……我想相信她。可是「想相信」上不了審查會。）
```

- Use full-width `（` and `）`, and wrap the **whole** text: it starts with `（`
  and ends with `）`. Never wrap only part of a line; write a spoken line and a
  separate inner-voice line instead.
- Everything else is as for any spoken line: at most 100 characters, an
  optional expression slug (`**相馬律**[shaken]：（……）`), a line ID at the very
  end, a Japanese translation, a voice clip.
- The game shows it as 心聲 · THOUGHT instead of 發言 · LINE.

**Who and where.**

- Only 相馬律. The player never hears inside 早坂, 神谷, a witness or a culprit.
- Never in a testimony `##### Line:` body (see `writing-interrogation-scene`).
- Nobody reacts to an inner-voice line. The other characters did not hear it.

**What it is for.**

| Use | Example |
|---|---|
| Say the feeling | `（……我想相信她。可是「想相信」上不了審查會。）` |
| Put jargon into plain words | `（也就是說，那個時間是電腦把紀錄合在一起的時間，不是他進門的時間。）` |
| A dry aside that warms a daily scene | `（她連我哪一餐沒吃都記得。……有點可怕。）` |
| Carry a hedge without stopping the scene | `（門不會記得是誰。但它記得，有人替那一晚開了一條路。）` |

**Two limits.**

1. **It never states a deduction for the player.** Inner voice may restate
   what has just been established. It may not arrive first at a conclusion the
   player is about to reach through a 推理 prompt, a hotspot, a present, a
   challenge or an analysis board. Test: delete the line. If the player would
   now have to work out something the line had handed them, cut it.
2. **It never touches a sealed reveal.** Inner voice is player-visible text.
   The chapter's forbidden list and the Bible's reveal ladder apply to it in
   full. A thought may show _that_ something hurts. It may not say _why_
   before the ladder allows it.

**How much.** Key moments only: a new fact landing, a choice, a hard term,
something he cannot say to the person in front of him. As a guide, a
three-hour chapter carries a few dozen inner-voice lines, not hundreds. Many
scenes have none. Avoid more than two in a row.

### Seven dialogue rules

| #   | Rule | Meaning |
| --- | --- | --- |
| 1 | Reaction before analysis | When something new appears, the first line is a human reaction: inner voice or a short spoken line. The sorting-out comes after it. |
| 2 | One number per line | A spoken line carries at most one clock time or one code, never both. The exact figures live on the record card (the evidence or statement text); dialogue says what the figure means. |
| 3 | Hedges have a budget | A hedge such as 「這只能證明……」 appears at most once per scene. The leads stand on different sides of it: 相馬 wants to say more, 早坂 pulls him back. |
| 4 | A plain goal at the top | In a scene that gives the player a task, one of the first three spoken lines says in plain words what we came here to find, and what happens if we do not. |
| 5 | One plain explanation per term | The first time a system, procedure or product name appears in a chapter, inner voice or a side character's question gets it said in plain words. After that, use it freely. |
| 6 | Serial numbers must not look like clock times | Do not number events with four digits that read as a time (`1841`, `1842`). Use a form nobody can mistake for one (`第 41 筆`). |
| 7 | The lead has inner voice | See above. |

### Worked examples

A client's plea. The refusal stays, and becomes a promise:

```markdown
**三宅母親**：小孩子都會說謊。可是……殺人那種事，他做不到。

**相馬律**：（……我想相信她。可是「想相信」上不了審查會。）

**相馬律**：……三宅太太。這句話，我沒辦法拿去當證據。

**相馬律**：所以，請讓我去找一個可以的。

**早坂茜**：他的意思是，這個案子我們接了。
```

He still refuses to treat her words as evidence. The player hears that he
wants to believe her, and 早坂 says the plain version, so the two voices
differ.

A closing argument that carried two clock times and a code in one line.
Split it; the figures move to the record card:

```markdown
**相馬律**：那扇門，那一晚只開過一次。開了十八秒。

**相馬律**：開門用的，是一張「校準申請」發下來的通行碼。

**相馬律**：可是設備商說，他們那晚沒有派人，也沒有申請過校準。

**相馬律**：（門不會記得是誰。但它記得，有人替那一晚開了一條路。）
```

The hedge is still there. Inner voice carries it.

### Four fixed beats per chapter

Every chapter contains all four. The chapter plan's emotion table says where
they land. If your brief does not say, report that; do not skip a beat, and do
not invent one in a scene that was not given it.

| Beat | What the player gets | Guard |
| --- | --- | --- |
| The victim is a person | Before the case hardens, one scene makes the player like the victim. After the case closes, someone says a word for them. | None. |
| The culprit speaks after the proof stands | The culprit is present when the identification stands, and then speaks, face to face. The player sees who this person is. | The proof never rests on what they say. A culprit may still refuse to confess. |
| A solution scene | After the ruling, 相馬 retells the night from start to end, with visuals. | Only as far as the evidence proves. Where the record stops, the retelling stops, and says that it stops. |
| A release that is acted out | A detail planted earlier pays off, and the tears or the laughter happen on screen. | Not in a bracket, and not as a later report. |

### Brackets are read by the player

A bracketed line is shown on screen as narration. It has no voice and no
face, and the player clicks through it like any other line.

- If a configured expression slug shows it, use the slug and drop the bracket.
- If a spoken line or an inner-voice line can carry it, write that instead.
- Keep a bracket for what only narration can do: a movement that matters, an
  object changing state, a sound from off screen, a silence that is the point.
- Never park a feeling in a bracket and leave it there. `[相馬的手停了半拍。]`
  can stay when the mystery is that he will not say why. It must not be the
  only way the player ever learns what he feels.

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
stories_plan/               ← docs/stories_plan/
  chapter_<N>/
    chapter.md                                     ← playable chapter manifest
    scene_0.md                                     ← linear dialogue scene (this skill)
    investigation_scene_1.md                       ← interactive investigation (see writing-investigation-scene)
    interrogation_scene_2.md                       ← inquiry / testimony authoring (see writing-interrogation-scene)
    analysis_scene_3.md                             ← analysis board (see writing-analysis-scene)
    scene_3.md
    ...
```

Planning docs (story bible, chapter plans, character reference) live in Notion,
not in this tree; `CLAUDE.md` → Project domain links the pages.

- **`scene_<N>.md`** — linear dialogue (intro cutscenes, transitions, in-car conversations). Covered fully by this skill.
- **`investigation_scene_<N>.md`** — interactive scenes with hotspots, characters, evidence and statement manifests. Authored using the **`writing-investigation-scene`** skill, which inherits the base dialogue rules from this skill. Use that skill when the file you are writing has the `investigation_scene_` prefix.
- **`interrogation_scene_<N>.md`** — suspect inquiry and testimony cross-examination authoring. Use the **`writing-interrogation-scene`** skill; this skill supplies only the base dialogue rules for its dialogue bodies.
- **`analysis_scene_<N>.md`** — evidence-arrangement boards. Use the
  **`writing-analysis-scene`** skill; this skill supplies only the base dialogue
  rules for its dialogue carriers.

### Path convention

- **All filenames and folder names are English / ASCII.** Only the file **contents** are Traditional Chinese.
- **Playable folder:** `<stories_plan_root>/chapter_<N>/` where `<stories_plan_root>` is `docs/stories_plan/`, and `<N>` is the chapter number (e.g. `chapter_1/`, `chapter_2/`).
- **Construction plan:** the chapter plan page in Notion (see `CLAUDE.md`).
- **Filename:** `scene_<N>.md` — scene numbers align with the beat/scene numbers in the construction plan (so Beat 0 → `scene_0.md`, etc.).
- Create the playable folder if it doesn't exist before writing.

**Do not confuse the Notion chapter plan with `chapter_<N>/chapter.md`:** the former is planning material; the latter is the playable scene manifest consumed by the compiler.

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

- One `#` H1 at the top: `# Scene <N>: <title>`. Title is Traditional Chinese, matches the corresponding beat title in the Notion chapter plan.
- Immediately after the H1, write `- **Summary:** <...>`: one sentence of player-facing recap copy, not a beat list. The `[場景：...]` block follows the Summary.
- **No `##` Part headings inside the file** — the file *is* the scene.
- If a single Part needs multiple sub-scenes (rare — e.g. location change mid-Part), use additional `[場景：...]` blocks within the same file rather than `##` subheadings.

### Related project files

- Notion **Story Bible** — canonical eight-chapter story canon and reveal boundaries. **Do not modify while authoring a scene.**
- Notion **chapter plan** (`<N>`) — per-chapter construction plan, timeline, clue placement and beat intent. **Read before** writing that chapter's script.
- Notion **角色設定總表** — consolidated cast reference (see below). **Read before** writing any character's dialogue.

Page links are in `CLAUDE.md` → Project domain; read them with the Notion fetch tool.
- `static/assets/config/characters.yaml` — the global runtime speaker catalog for authored display labels, portrait intent, and configured expression slugs. **Read before** writing any speaker who appears on-screen.
- `chapter_<N>/scene_<K>.md` — the output of this skill (one file per scene).

### Character reference (Notion 角色設定總表)

The 角色設定總表 page in Notion (linked from `CLAUDE.md`) is the single source for
each character's
**設定 (background) / 性格 (personality) / 台詞風格 (voice) / 必須 (must) / 禁止 (avoid + spoiler seals)**,
consolidated from the story bible. It is planning material, **not** a scene file —
it lives outside the repo.

Use it like this:

- **Before writing a character's lines**, open their entry and write to the 台詞風格 examples
  (sentence length, register, verbal tics) — not a generic voice.
- **Use the 必須 entry.** It says what the character wants, what they fear, when they lose
  control, their catchphrase or habit, and what makes them laugh. A scene that belongs to a
  character shows at least one of these on screen. 禁止 alone makes every character short and
  restrained; 必須 is what makes two characters sound different.
- **Honour the 禁止 / 🔒 主線封印 list.** Each entry flags what would break the character or leak
  a sealed reveal. This is the per-character companion to the chapter-level foreshadowing rules
  in the Notion Story Bible and chapter plan.
- If the 角色設定總表 and the story bible ever disagree, the **story bible wins** (the page says so).
- Adding a new named character? Add the story-voice entry to the 角色設定總表
  in Notion when planning requires it, and resolve the global catalog label and
  `portraitMode` under the rule below before production use.

### Global visual speaker catalog (`static/assets/config/characters.yaml`)

The 角色設定總表 governs story voice and spoiler seals. The global catalog
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
an entry in the 角色設定總表 as a substitute for the global catalog.

## Writing workflow

When asked to write any part of a chapter:

1. **Read the Notion Story Bible and the matching Notion chapter plan** — canon, timeline, clue placement, foreshadow seeds and reveal boundaries.
2. **Read the Notion 角色設定總表 and `static/assets/config/characters.yaml`** for every speaker in this scene — lock their 台詞風格 / 必須 / 禁止, catalog display label, portrait mode, and configured expression slugs before drafting lines.
3. **Check the chapter's reveal contract in the story bible and chapter plan** — which foreshadows are seeded *this* chapter, and critically, which secrets must not yet be revealed.
4. **Confirm scope with the user before writing** — which Part(s)? If unclear, write one Part and stop, so tone can be reviewed before scaling.
5. **Plan the Part structure** — opening scene tag, the scene's plain goal, 3–5 conversation beats, ending moment. Note whether this scene carries one of the chapter's loud moments or four fixed beats. Output the plan first when scope is ambiguous.
6. **Write each Part starting with `[場景：...]`**.
7. **Advance plot via dialogue**, using `旁白` only for the narration-assignment cases above.
8. **Self-check before reporting done:**
   - Any line >100 Chinese characters? Split it.
   - Any action/expression inline with dialogue? Move it into `[ ]`.
   - Every scene change has a scene tag?
   - No simplified Chinese? No 経/実-style kanji?
   - Does each character's voice match their 角色設定總表 台詞風格 and 必須, with no 禁止 / 🔒 line crossed?
   - Does every speaker resolve to the global catalog label and an intentional `portraitMode`, with no uncatalogued portraitless fallback?
   - Does each meaningful visual state transition use a fitting configured expression slug when one exists, without flickering on every line?
   - Foreshadows match the Notion Story Bible and the current chapter plan?
   - Does each new fact get a human reaction before the analysis, and does each emotional line get a human beat before any procedure?
   - Does any spoken line carry more than one clock time or code? Is there more than one hedge in the scene?
   - If the scene gives the player a task, do the first three spoken lines state the goal in plain words? Is each new term explained once?
   - Inner voice: only 相馬律, whole text in full-width parentheses, not in testimony, no deduction handed to the player, no sealed reveal?
   - Could an expression slug, a spoken line or an inner-voice line replace any bracket?

## Quick reference

| Element | Form |
|---|---|
| Dialogue | `**角色名**：內容` |
| Inner voice (相馬律 only) | `**相馬律**：（內容）` |
| Narrator | `**旁白**：內容` |
| Scene tag | `[場景：地點、時間、氛圍、視覺要素]` |
| Action / expression | `[相馬眉頭微皺]` |
| Atmosphere beat | `[一陣風從後巷吹入]` |
| Deduction prompt | `> 推理：問題` then `> - [x] 正解` / `> - [ ] 錯誤 → **角色**：回應` |
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
| Revealing a sealed cross-chapter secret too early | Cross-check the Notion Story Bible + the current chapter plan; hold back |
| Inline phone qualifier `（電話）` on speaker name | Use `[相馬的手機震動，他接起]` stage direction instead |
| Writing multiple Parts when user asked for one | Stop. Scope creep is a process failure, not a feature. |
| A feeling exists only in a bracket, or is reported a scene later | Let it happen when its cause happens: an expression slug, a spoken line, or 相馬's inner voice |
| An emotional line answered by procedure in the next line | Give it one human beat first; procedure comes after |
| Inner voice hands over the answer before a 推理 prompt, a present or a challenge | Cut it, or move it after the player's action |
| Inner voice for anyone but 相馬律, or parentheses around only part of a line | Only 相馬律; wrap the whole text, or split the line in two |
| Inner voice hints at a sealed reveal because "nobody heard it" | The player heard it. The forbidden list applies in full |
| Two clock times, or a time and a code, in one spoken line | One number per line; exact figures live on the record card |
| Exclamation marks sprinkled through a quiet scene for energy | Loud is for the chapter's three or four loud moments |

## Foreshadowing discipline

This is a multi-chapter mystery with deliberately staged reveals. Before placing any clue or hint, check the Notion Story Bible and the current chapter plan.

**The spine question (Bible V7.1).** The whole game follows one question in 相馬's own voice: 「那一晚，我到底看見了什麼？」 Each chapter's ending returns to it with one new answer and one sharper question, through inner voice and the 「未解事項」 note. The Bible lists each chapter's line; never answer more than that chapter's row allows.

For Chapter 1 specifically:
- **Prologue 0–2:** do not name 青葉, A-90, 雨宮, `ZW_A16.lock`, or 相馬's old-case identity.
- **Beats 0–11 may seed only:** 約 90 秒 as a maintenance/sync discrepancy without origin; 藍色透明傘 without owner ID or formal-evidence treatment; 金木犀 with only a hand-pause / brief low-intensity reaction, **no headache or flashback**; `ZW_A16.lock` as an inaccessible filename only, **not** `ZERO_WITNESS` or `Aoba_2016`; 雨宮's anonymous message without identity or explanation.
- **Beat 11.5 is the only Chapter 1 青葉-name exception:** a public Mashiro preview may say **「2016 年青葉記憶研究所火災」**, and 相馬 may mute, look away, or pause briefly. Do not label the flashed image as raw / actual / reenactment, and keep `ZW_A16.lock` off-screen so the two source chains are not linked.
- **Beat 11.5, after the mute (Bible V7.1):** two inner-voice lines tell the player, and only the player, that 相馬 was in that building on the night of the fire and that his father did not come out. He says nothing aloud, no other character learns it, and 早坂 does not ask. This is the whole of the loosened seal: no headache, no flashback, nothing about what he saw.
- **Still forbidden through Chapter 1:** `A16 = Aoba_2016`, `ZW = ZERO WITNESS`, 雨宮's real identity, 相馬 being an Aoba **witness**, why his father was in the building and his father's full Aoba role, left/right escape truth, the 90 seconds as an Aoba fact, A-90 Hold, 久遠, Kagamihara involvement, whose view the reenactment follows, or any KAGAMI-conspiracy explanation.

For later chapters: read that chapter's reveal-ladder row and the matching Notion chapter plan. Stay strict.

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
| `**相馬律**：（text）` (the whole text inside full-width parentheses) | dialogue line, shown as inner voice |
| `> 推理：question` followed by `> - [x] ...` / `> - [ ] ... → reply` lines | deduction prompt (see below) |
| blank line | separator (ignored) |

### 推理 deduction prompts (any dialogue block)

A prompt stops the dialogue and asks the player to pick the right conclusion
before Soma says it. Use one where the player has just seen the facts and can
reasonably work the answer out; do not use it to quiz trivia or to guess what
the writer is thinking.

```
**相馬律**：總時長是 89.7 秒。

> 推理：那 89.7 秒說明了什麼？
> - [x] 摘要把合併的時間當成了事件時間
> - [ ] 三宅說了謊 → **早坂茜**：他的小謊和這段時間無關。
> - [ ] 門鎖當晚故障 → [門鎖的紀錄一直完整。]

**相馬律**：對，摘要把三段時間合併成了一段。
```

- 2-4 options, exactly one `[x]`. Option labels are short and distinct; the
  correct one should not stand out by length or wording.
- Every wrong `[ ]` option needs a reply after ` → `: one `**Name**：line` or one
  `[narration]`, no expression and no line ID. The reply shows under the
  question and the player picks again; a wrong pick costs nothing.
- The correct option takes no reply. The dialogue after the prompt states the
  conclusion, so write it as if the player said it.
- No line before the prompt gives the answer away. That includes 相馬's inner
  voice: he may react to the facts, but the conclusion is the player's.
- Prompts work in linear scenes and in every investigation, interrogation and
  analysis dialogue block, except inside interrogation testimony.

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
| A 推理 prompt whose wrong option has no `→ reply`, or whose correct option has one | Every wrong option needs one reply; the correct one has none, and the lines after the prompt give the conclusion. |
| A 推理 prompt the player cannot answer from what they have seen | Move it after the clue, or drop it; the prompt should reward attention, not guessing. |

## Core spirit

> You are not writing a novel. You are writing a script the player will click through one line at a time.
> Every line must stand on its own, carry a visual, and move the plot forward.
> **Short. Clear. Rhythmic.** This matters more than literary flourish.
