---
name: reviewing-story-scenes
description: Use when reviewing authored scene files (scene_*.md / investigation_scene_*.md / interrogation_scene_*.md) for the Lyra detective game 《東京雨證：第零證人》 against the story bible, chapter plan, writing addendum, and visual-background coverage before story content ships.
---

# Reviewing Story Scenes (《東京雨證：第零證人》)

## Overview

You are the **semantic gate**. The compiler already proved structure (schema,
unlock graph, ID resolution); your job is what it cannot see: canon, character
voice, sealed-lore discipline, cross-beat continuity, and missing visual
background coverage.

**Core principle:** a reviewer produces a *findings report* and **edits
nothing**. You are a thin orchestrator: you locate source file paths, spawn
seven parallel subagents (one per review axis), and consolidate their reports
into one findings report. The subagents read the sources themselves and cite
exact lines; you do not read source content or curate excerpts. Every finding
is checked against an authoritative source the subagent **cites**, never
against its own memory of the story.

## When to Use

- Dispatched to review one or more authored `scene_*.md`,
  `investigation_scene_*.md`, or `interrogation_scene_*.md` files (typically
  after a green `bun run scenes:compile`).
- Asked to check story content for canon, voice, premature reveals, continuity,
  or missing `Background Prompt` / background-cue coverage.

Not for: authoring or fixing scene content (use the `writing-*` skills);
structural/schema validation (that is the compiler's job).

---

## Phase 1: Locate sources (mandatory — you do this)

Your job as orchestrator is to **locate the source files and pass their paths
to subagents** — you do NOT read their content yourself. Each subagent reads
the sources it needs directly (see Phase 2). Reading every source into the
orchestrator's context bloats it and forces you to curate excerpts that lose
context; subagents reading sources themselves see the full text and can cite
exact lines.

For the chapter under review (under `docs/stories_plan/` and/or
`static/stories_plan/`), locate these paths (list the directory if needed):

- **Story bible** `tokyo_rain_witness_final_story_bible_v*.md` — canon facts.
- **Character sheet** `docs/stories_plan/characters.md` — per-character
  設定/性格/台詞風格/禁止 integrated view for writers and reviewers. This is the
  primary voice/character reference; the addendum's voice guide supplements it.
  If it conflicts with the bible, the bible wins (per the file's own note).
- **Chapter manifest** `chapter.md` — the chapter's title, summary, and ordered
  scene list; the chapter-level plan the review checks roster and beat order
  against.
- **Chapter construction plan** `*_final_result_plan.md` (the high-level plan)
  — beat intent; what each scene is supposed to accomplish.
  (Note: `chapter.md` is the chapter *manifest* — a separate file.
  "Construction plan" always means `*_final_result_plan.md`, never `chapter.md`.)
- **Chapter writing addendum** `*_addendum.md` — per-character voice, Do/Don't,
  the 不要做 forbidden-reveal list, and 伏筆留白 (what may be *shown* vs *said*).
- **Scene files** — every `scene_*.md`, `investigation_scene_*.md`, and
  `interrogation_scene_*.md` in the chapter directory.
- **Compiled scene JSON** under `src-tauri/resources/scenes/chapter_<N>/` after
  `bun run scenes:compile` — visual coverage is checked against runtime output,
  not only authored Markdown. Subagents read generated JSON for review evidence
  only; do not edit it.
- The relevant `writing-*` skills for format rules (≤100-char dialogue lines,
  Traditional-only, scene structure).

If a source path you need is missing, **say so and request it. Do not guess
canon.**

**You do NOT read source content.** You read `chapter.md` only to get the
ordered scene list (so you know which scene files to pass to subagents). All
other sources — bible, characters.md, construction plan, addendum, scenes,
compiled JSON — are read by the subagents themselves from the paths you give
them. Your job is to locate paths, spawn subagents, and consolidate their
reports.

---

## Phase 2: Spawn parallel subagents — one per axis

Do not review all axes yourself in one pass. Instead, launch **seven background
subagents in parallel**, each responsible for exactly one axis. **Each subagent
reads the source files itself** from the paths you give it — you do not paste
content into the brief.

### Brief template for each subagent

Each subagent brief must contain:

1. The **axis definition** (copy from the table below).
2. The **source file paths** — give the subagent the relative paths to every
   source file this axis needs (bible, characters.md, chapter.md, construction
   plan, addendum, scene files, compiled JSON — whichever the axis table below
   lists). Instruct the subagent to read these files itself. The subagent sees
   the full text and can cite exact lines; you do not curate excerpts.
3. **Citation requirement:** every Blocker or Important finding must quote the
   offending text and cite the exact source line it was checked against (file
   path + line number). For Visual Background findings, cite the authored scene
   line and the compiled JSON file/field or `scenes:compile` warning that
   proves the runtime gap.
4. **Output format:**
   - `BLOCKERS-PRESENT` / `FIX-RECOMMENDED` / `SHIP` for this axis only.
   - One-line findings: `Severity — file:line — issue — suggested fix`
   - A short strengths list.

### The seven axes

| Axis | Check | Sources the subagent needs |
|---|---|---|
| **1. Canon / factual** | Names, victim, true culprit, times, locations, roster match bible/plan. Verify against the bible line — never assume (e.g. confirm the suspect's exact given name rather than trusting recall). | Bible character sections + `characters.md` roster/設定 + `chapter.md` summary + scene dialogue mentioning names/roles/times |
| **2. Forbidden / premature reveals** | Nothing on the addendum 不要做 / 伏筆留白 list surfaces early. A detail allowed to be *shown* must not be *explained*. | Addendum forbidden-reveal list + bible sealed-lore sections + all scene dialogue and evidence descriptions |
| **3. Voice & style** | Each character matches the `characters.md` 台詞風格 + addendum voice guide; no exposition 講義 / system lectures; dialogue lines ≤100 Chinese chars; **Traditional Chinese only** (no Simplified, no JP-only kanji). | `characters.md` per-character 台詞風格/禁止 + addendum voice guides + `writing-detective-game-dialogue` format rules + all character dialogue lines |
| **4. Cross-beat continuity** | Hand-offs between scenes land; planted seeds pay off; evidence/statement IDs referenced across files resolve; the chapter's required evidence-package seeds are all present. | Plan evidence-package list + all scene files (outros, intros, evidence manifests, statement manifests, unlock chains) |
| **5. Visual background coverage** | Every player-visible location change that needs a backdrop has authored `Background Prompt` metadata and compiles to a non-null `backgroundAssetId`. Linear scene queues and investigation/interrogation intros must establish a background before the first dialogue/action unless the previous scene background is intentionally carried and documented. Flag scene tags, sub-locations, or interrogation phases with missing prompts/IDs, and flag intro/dialogue sequences that start before any background cue. | All scene files with `[場景：...]`, `Background Prompt`, sub-location metadata, interrogation phase metadata + compiled `src-tauri/resources/scenes/chapter_<N>/*.json` + `bun run scenes:compile` warnings |
| **6. Investigation interaction balance** | The chapter's investigation scenes' interaction points, *in aggregate*, follow the addendum §2.1 ratio guidance: ~40% 破案資訊 (directly support the three evidence packages), ~30% 角色生活資訊 (make characters feel alive), ~20% 氣氛與伏筆 (blue umbrella, osmanthus, rain, shop objects), ~10% 錯誤焦點 / 紅鯡魚 (let players briefly suspect the manager, Katase, or deeper Miyake lies). The ratio is per-chapter, not per-scene — a single scene may legitimately concentrate in one bucket (e.g. a reversal scene mostly 破案). Flag the chapter-wide aggregate when it starves a bucket, and flag individual points that leak case-breaking info through a 生活/氣氛 point. | Addendum §2.1 ratio table + all `investigation_scene_*.md` hotspot/topic/evidence manifests + evidence-package list from the plan |
| **7. Natural conversation & situational context** | Every scene has enough natural, non-case dialogue to ground the player before investigation/hearing mechanics begin. Check against addendum §5.4 minimums: linear transitions ≥25% breathing dialogue, investigation scenes need 2–3 lines of pre-investigation dialogue (why we're here, partner check-in, first impression), interrogation/hearing scenes need 2–3 lines of pre-proceeding partner dialogue, breathing points ≥30%. New characters get a natural introduction exchange, not just a Bio field. Flag scenes that open directly into case mechanics with no human grounding, scenes where the 相馬/早坂 partnership has no relational texture (no history, no familiarity, no working dynamic), and breathing points that are actually case summaries in dialogue form. | Addendum §5.4 ratio table + all scene files' opening dialogue blocks + `characters.md` voice guides for partnership dynamics |

**Launch order:** spawn all seven at once. They have no shared state and no
sequential dependencies.

### Visual Background Minimum Checks

For Axis 5, at minimum check:

- Every authored `[場景：...]` that should change the backdrop is followed
  immediately by `Background Prompt` metadata.
- Every sub-location and interrogation phase has visual metadata when assets
  are enabled.
- Every compiled scene tag, sub-location, and interrogation phase has a
  non-null `backgroundAssetId`.
- Every linear `queue` and investigation/interrogation `intro` begins with a
  background-carrying scene tag before the first line/action, unless the scene
  explicitly documents intentional carry-over from the previous background.
- New `assetFileMissing` warnings for background IDs are reported separately
  from missing prompts: a prompt can compile correctly while the PNG still
  needs generation.

---

## Phase 3: Synthesize the seven axis reports

After all seven subagents return, produce **exactly one consolidated findings
report** with:

1. **Verdict** — the worst of the seven axis verdicts (BLOCKERS-PRESENT wins
   over FIX-RECOMMENDED wins over SHIP).
2. **All findings merged** — deduplicate if the same `file:line` issue was
   caught by two axes. Keep the more severe severity.
3. **Strengths** — merged strengths from all seven subagents, deduplicated.

**Do not synthesize by watering down.** If Axis 1 says BLOCKERS-PRESENT and
Axis 3 says SHIP, the consolidated verdict is BLOCKERS-PRESENT. Quote the
subagent's finding verbatim; do not rewrite its evidence.

---

## Phase 4: Output format

```markdown
## Review Report: Chapter N 《...》

**Subagent axes:** Canon, Forbidden, Voice, Continuity, Visual Background, Investigation Interaction Balance, Natural Conversation — all completed.

### Verdict: [BLOCKERS-PRESENT / FIX-RECOMMENDED / SHIP]

### Findings

[One line per finding: Severity — file:line — issue — suggested fix]
[Blocker / Important findings must include the quoted offending text]
[Canon/Forbidden findings must cite the source line checked against]

### Strengths

[Bulleted list of what already works]
```

---

## Cardinal rules (apply to you AND every subagent)

| Rule | Enforcement |
|---|---|
| **Edit nothing** | You and every subagent produce reports only. No `edit`, `write`, or `notebook_edit` on scene files. |
| **Cite, don't assume** | Every canon/forbidden claim must quote the bible/addendum line it was checked against. |
| **No rewrites** | Quote the offending text; describe the fix in words. Do not produce a "corrected" file. |
| **No structural changes** | Renumbering scenes, deleting characters, or rewriting beats is out of scope. Flag only. |
| **No memory claims** | If the source line is absent, the finding is a question, not a fact. |

## Red flags — STOP, you or a subagent is about to overstep:

- An `Edit` or `Write` tool is opened on a scene file.
- A subagent's output is a corrected file instead of a findings list + verdict.
- You (orchestrator) are reading source content (bible, characters.md,
  construction plan, addendum, scenes, JSON) instead of just locating paths.
  The only source file you read is `chapter.md` for the scene list.
- A subagent states a canon "fact" with no source line in front of it.
- You're renumbering scenes, deleting characters, or rewriting beats.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Reviewing prose quality in a vacuum | Subagents must read bible + construction plan + addendum first; most blockers are canon/forbidden and invisible without them. |
| Treating a clean compile as done | The compiler can't see a canon contradiction, a flat voice, or whether a scene starts with dialogue before its first background cue — that's the subagents' job. |
| Asserting canon from memory | Cite the source line; if it's absent, request the source. |
| Editing or "fixing" the files | Report only. Edit nothing. |
| Findings without a location or a quote | Every finding: `file:line` + quoted text + suggested fix. |
| Monolithic single-agent review | Spawn seven parallel subagents. One brain trying to hold bible, plan, addendum, voice guides, format rules, visual cues, interaction balance, natural conversation, and all scene text at once misses things. |
| Orchestrator reading source content | You locate paths and spawn subagents; you do NOT read bible, characters.md, construction plan, addendum, scenes, or JSON yourself. The only file you read is `chapter.md` (to get the scene list). Subagents read everything else directly. |
| Pasting excerpts into subagent briefs | Give subagents file paths, not pasted content. Subagents read sources themselves so they see full text and can cite exact lines; pasted excerpts lose context and bloat the orchestrator. |
| Verifying subagent findings by reading sources yourself | Do not re-read sources to "double-check" a subagent's citation. Quote the subagent's finding verbatim in your consolidated report; trust its citation. If a finding looks wrong, flag it as a question for the human, don't re-verify by reading the source. |

---

**Related skills:** dispatched by `subagent-driven-story-writing` as its REVIEW
gate. Format rules live in `writing-detective-game-dialogue`,
`writing-investigation-scene`, `writing-interrogation-scene`,
`writing-chapter-manifest`.
