---
name: reviewing-story-scenes
description: Use when reviewing authored scene files (scene_*.md / investigation_scene_*.md / interrogation_scene_*.md) for the Lyra detective game 《東京雨證：第零證人》 against the story bible, chapter plan, writing addendum, and visual-background coverage before story content ships. You produce a findings report and edit nothing.
---

# Reviewing Story Scenes (《東京雨證：第零證人》)

## Overview

You are the **semantic gate**. The compiler already proved structure (schema,
unlock graph, ID resolution); your job is what it cannot see: canon, character
voice, sealed-lore discipline, cross-beat continuity, and missing visual
background coverage.

**Core principle:** a reviewer produces a *findings report* and **edits
nothing**. The orchestrator owns the files, the IDs, and the canon — you give
them evidence to fix, not the fix applied. Every finding is checked against an
authoritative source you **cite**, never against your own memory of the story.

## When to Use

- Dispatched to review one or more authored `scene_*.md`,
  `investigation_scene_*.md`, or `interrogation_scene_*.md` files (typically
  after a green `bun run scenes:compile`).
- Asked to check story content for canon, voice, premature reveals, continuity,
  or missing `Background Prompt` / background-cue coverage.

Not for: authoring or fixing scene content (use the `writing-*` skills);
structural/schema validation (that is the compiler's job).

---

## Phase 1: Load sources (mandatory — you do this)

You cannot judge canon or forbidden reveals from memory — you will assert wrong
"facts" and destroy correct content. For the chapter under review (under
`docs/stories_plan/` and/or `static/stories_plan/`), read:

- **Story bible** `tokyo_rain_witness_final_story_bible_v*.md` — canon facts.
- **Chapter construction plan** `*_final_result_plan.md` — beat intent; what
  each scene is supposed to accomplish.
- **Chapter writing addendum** `*_addendum.md` — per-character voice, Do/Don't,
  the 不要做 forbidden-reveal list, and 伏筆留白 (what may be *shown* vs *said*).
- **Scene files** — every `scene_*.md`, `investigation_scene_*.md`, and
  `interrogation_scene_*.md` in the chapter directory.
- **Compiled scene JSON** under `src-tauri/resources/scenes/chapter_<N>/` after
  `bun run scenes:compile` — visual coverage is checked against runtime output,
  not only authored Markdown. Read generated JSON for review evidence only; do
  not edit it.
- The relevant `writing-*` skills for format rules (≤100-char dialogue lines,
  Traditional-only, scene structure).

If a source you need is not in your brief, **say so and request it. Do not
guess canon.**

**You must read every file yourself.** The subagents you spawn will not
re-read; they work from the excerpts you quote in their brief.

---

## Phase 2: Spawn parallel subagents — one per axis

Do not review all axes yourself in one pass. Instead, launch **five background
subagents in parallel**, each responsible for exactly one axis.

### Brief template for each subagent

Front-load the context. Each subagent brief must contain:

1. The **axis definition** (copy from the table below).
2. The **canonical sources** — paste the relevant excerpts from bible, plan,
   addendum, and any `writing-*` skill rules this axis needs.
3. The **scene files** — paste every dialogue line, stage direction, and
   metadata field that this axis must inspect. Do not ask the subagent to
   re-read files; give it the text.
4. **Citation requirement:** every Blocker or Important finding must quote the
   offending text and cite the exact source line it was checked against. For
   Visual Background findings, cite the authored scene line and the compiled
   JSON file/field or `scenes:compile` warning that proves the runtime gap.
5. **Output format:**
   - `BLOCKERS-PRESENT` / `FIX-RECOMMENDED` / `SHIP` for this axis only.
   - One-line findings: `Severity — file:line — issue — suggested fix`
   - A short strengths list.

### The five axes

| Axis | Check | Sources the subagent needs |
|---|---|---|
| **1. Canon / factual** | Names, victim, true culprit, times, locations, roster match bible/plan. Verify against the bible line — never assume (e.g. confirm the suspect's exact given name rather than trusting recall). | Bible character sections + chapter plan roster + `chapter.md` summary + scene dialogue mentioning names/roles/times |
| **2. Forbidden / premature reveals** | Nothing on the addendum 不要做 / 伏筆留白 list surfaces early. A detail allowed to be *shown* must not be *explained*. | Addendum forbidden-reveal list + bible sealed-lore sections + all scene dialogue and evidence descriptions |
| **3. Voice & style** | Each character matches the addendum voice guide; no exposition 講義 / system lectures; dialogue lines ≤100 Chinese chars; **Traditional Chinese only** (no Simplified, no JP-only kanji). | Addendum voice guides + `writing-detective-game-dialogue` format rules + all character dialogue lines |
| **4. Cross-beat continuity** | Hand-offs between scenes land; planted seeds pay off; evidence/statement IDs referenced across files resolve; the chapter's required evidence-package seeds are all present. | Plan evidence-package list + all scene files (outros, intros, evidence manifests, statement manifests, unlock chains) |
| **5. Visual background coverage** | Every player-visible location change that needs a backdrop has authored `Background Prompt` metadata and compiles to a non-null `backgroundAssetId`. Linear scene queues and investigation/interrogation intros must establish a background before the first dialogue/action unless the previous scene background is intentionally carried and documented. Flag scene tags, sub-locations, or interrogation phases with missing prompts/IDs, and flag intro/dialogue sequences that start before any background cue. | All scene files with `[場景：...]`, `Background Prompt`, sub-location metadata, interrogation phase metadata + compiled `src-tauri/resources/scenes/chapter_<N>/*.json` + `bun run scenes:compile` warnings |

**Launch order:** spawn all five at once. They have no shared state and no
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

## Phase 3: Synthesize the five axis reports

After all five subagents return, produce **exactly one consolidated findings
report** with:

1. **Verdict** — the worst of the five axis verdicts (BLOCKERS-PRESENT wins
   over FIX-RECOMMENDED wins over SHIP).
2. **All findings merged** — deduplicate if the same `file:line` issue was
   caught by two axes. Keep the more severe severity.
3. **Strengths** — merged strengths from all five subagents, deduplicated.

**Do not synthesize by watering down.** If Axis 1 says BLOCKERS-PRESENT and
Axis 3 says SHIP, the consolidated verdict is BLOCKERS-PRESENT. Quote the
subagent's finding verbatim; do not rewrite its evidence.

---

## Phase 4: Output format

```markdown
## Review Report: Chapter N 《...》

**Subagent axes:** Canon, Forbidden, Voice, Continuity, Visual Background — all completed.

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
- You're stating a canon "fact" with no source line in front of you.
- You're renumbering scenes, deleting characters, or rewriting beats.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Reviewing prose quality in a vacuum | Load bible + plan + addendum first; most blockers are canon/forbidden and invisible without them. |
| Treating a clean compile as done | The compiler can't see a canon contradiction, a flat voice, or whether a scene starts with dialogue before its first background cue — that's the subagents' job. |
| Asserting canon from memory | Cite the source line; if it's absent, request the source. |
| Editing or "fixing" the files | Report only. Edit nothing. |
| Findings without a location or a quote | Every finding: `file:line` + quoted text + suggested fix. |
| Monolithic single-agent review | Spawn five parallel subagents. One brain trying to hold bible, plan, addendum, voice guides, format rules, visual cues, and all scene text at once misses things. |
| Subagent re-reading files | You read the files; paste excerpts into each subagent brief. Each axis reviewer works from your excerpt, not by re-reading source files. |

---

**Related skills:** dispatched by `subagent-driven-story-writing` as its REVIEW
gate. Format rules live in `writing-detective-game-dialogue`,
`writing-investigation-scene`, `writing-interrogation-scene`,
`writing-chapter-manifest`.
