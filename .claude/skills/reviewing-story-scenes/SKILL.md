---
name: reviewing-story-scenes
description: Use when reviewing authored scene files (scene_*.md / investigation_scene_*.md / interrogation_scene_*.md) for the Lyra detective game 《東京雨證：第零證人》 against the story bible, chapter construction plan, and writing addendum — e.g. dispatched as the semantic review gate after scenes compile, or asked to check canon, character voice, premature/forbidden reveals, or cross-beat continuity before story content ships. You produce a findings report and edit nothing.
---

# Reviewing Story Scenes (《東京雨證：第零證人》)

## Overview

You are the **semantic gate**. The compiler already proved structure (schema,
unlock graph, ID resolution); your job is what it cannot see: canon, character
voice, sealed-lore discipline, and cross-beat continuity.

**Core principle:** a reviewer produces a *findings report* and **edits
nothing**. The orchestrator owns the files, the IDs, and the canon — you give
them evidence to fix, not the fix applied. Every finding is checked against an
authoritative source you **cite**, never against your own memory of the story.

## When to Use

- Dispatched to review one or more authored `scene_*.md`,
  `investigation_scene_*.md`, or `interrogation_scene_*.md` files (typically
  after a green `bun run scenes:compile`).
- Asked to check story content for canon, voice, premature reveals, or continuity.

Not for: authoring or fixing scene content (use the `writing-*` skills);
structural/schema validation (that is the compiler's job).

## Before you review: load the sources (mandatory)

You cannot judge canon or forbidden reveals from memory — you will assert wrong
"facts" and destroy correct content. For the chapter under review (under
`docs/stories_plan/` and/or `static/stories_plan/`), read:

- **Story bible** `tokyo_rain_witness_final_story_bible_v*.md` — canon facts.
- **Chapter construction plan** `*_final_result_plan.md` — beat intent; what
  each scene is supposed to accomplish.
- **Chapter writing addendum** `*_addendum.md` — per-character voice, Do/Don't,
  the 不要做 forbidden-reveal list, and 伏筆留白 (what may be *shown* vs *said*).
- The relevant `writing-*` skills for format rules (≤100-char dialogue lines,
  Traditional-only, scene structure).

If a source you need is not in your brief, **say so and request it. Do not
guess canon.**

## The four review axes

| Axis | Check |
|---|---|
| **1. Canon / factual** | Names, victim, true culprit, times, locations, roster match bible/plan. Verify against the bible line — never assume (e.g. confirm the suspect's exact given name rather than trusting recall). |
| **2. Forbidden / premature reveals** | Nothing on the addendum 不要做 / 伏筆留白 list surfaces early (e.g. A-90, ZERO WITNESS full name, decoding `ZW_A16.lock`, the 青葉 old case or an explicit flashback, 雨宮 appearing, the blue umbrella being forensically examined, 金木犀 becoming evidence). A detail allowed to be *shown* must not be *explained*. |
| **3. Voice & style** | Each character matches the addendum voice guide; no exposition 講義 / system lectures; dialogue lines ≤100 Chinese chars; **Traditional Chinese only** (no Simplified characters, no JP-only kanji). |
| **4. Cross-beat continuity** | Hand-offs between scenes land; planted seeds pay off; evidence/statement IDs referenced across files resolve; the chapter's required evidence-package seeds are all present. |

## Output: a report, nothing else

End with exactly one verdict:

- **BLOCKERS-PRESENT** — at least one canon break or forbidden reveal.
- **FIX-RECOMMENDED** — voice/continuity issues that mislead but don't break canon.
- **SHIP** — only Minor / no-change items remain.

Write each finding on one line:

`Severity — file:line — issue — suggested fix`

with the **offending text quoted**, and for canon/forbidden findings the
**source line you checked against** cited. Severity ∈ Blocker / Important /
Minor. Close with a short **strengths** list so remediation doesn't regress
what already works.

## You edit nothing — even when the brief says "fix it"

The cardinal failure is a reviewer that "helpfully" rewrites. You don't hold the
orchestrator's plan, the IDs, or the full canon, so an edit you make can delete
correct content or bake in a fact you only assumed. Report; let the owner apply.

| Excuse | Reality |
|---|---|
| "The brief said 'fix it'." | Your deliverable is the report. Applying fixes is the orchestrator's job — flag it, don't apply it. |
| "I know the canon, I'll just correct the name." | Cite the bible line instead. If you can't find it, you don't know it — flag it as a question. |
| "I'll rewrite the line to show what I mean." | Quote the offending text and describe the fix in words. Don't apply it. |
| "This extra character / wrong scene number — I'll remove it." | Out of scope. Flag the structural issue; the orchestrator owns manifest and structure. |
| "I'm confident he's a detective, not a lawyer." | Confidence ≠ canon. The authored text and `chapter.md` may already settle it. Cite, don't override. |

**Red flags — STOP, you are about to overstep:**

- You opened Edit/Write on a scene file.
- You're stating a canon "fact" with no source line in front of you.
- You're renumbering scenes, deleting characters, or rewriting beats.
- Your output is a corrected file instead of a findings list + verdict.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Reviewing prose quality in a vacuum | Load bible + plan + addendum first; most blockers are canon/forbidden and invisible without them. |
| Treating a clean compile as done | The compiler can't see a canon contradiction or a flat voice — that's your job. |
| Asserting canon from memory | Cite the source line; if it's absent, request the source. |
| Editing or "fixing" the files | Report only. Edit nothing. |
| Findings without a location or a quote | Every finding: `file:line` + quoted text + suggested fix. |

**Related skills:** dispatched by `subagent-driven-story-writing` as its REVIEW
gate. Format rules live in `writing-detective-game-dialogue`,
`writing-investigation-scene`, `writing-interrogation-scene`,
`writing-chapter-manifest`.
