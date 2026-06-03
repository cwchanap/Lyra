---
name: subagent-driven-story-writing
description: Use when an orchestrating agent is asked to author one or more chapter beats/scenes for the Lyra detective game 《東京雨證：第零證人》 by delegating to writing subagents — e.g. "work on beat N", "write the next scenes", "use a subagent per beat/scene with the proper writing skill". Trigger when turning a construction plan (施工圖/詳細計劃) into playable scene files under stories_plan, not when editing a single file yourself.
---

# Subagent-Driven Story Writing (《東京雨證：第零證人》)

## Overview

How an **orchestrator** turns chapter-plan beats into compiled, reviewed scene
files by delegating: one **writing subagent per scene file**, then one separate
**review subagent** for consistency. The orchestrator never free-forms scene
prose itself — it owns the manifest, the briefs, the IDs, and the two gates.

**Core principle:** two gates make it correct. The **compiler** is the
structural gate (schema, unlock graph, ID resolution); a separate **review
subagent** is the semantic gate (canon, voice, continuity). A scene is not done
until both pass.

## When to Use

- Asked to author/extend chapter beats or scenes via subagents.
- You have a construction plan and need playable `scene_*.md` /
  `investigation_scene_*.md` / `interrogation_scene_*.md` files.

Do **not** use for: a tiny single-file edit you'll do yourself; authoring the
format details (those live in the `writing-*` skills this skill dispatches to).

## Roles

| Role | Owns |
|---|---|
| **Orchestrator** (you) | Reading sources, canon reconciliation, `chapter.md` manifest, the IDs, every subagent brief, validation, review dispatch, remediation triage, reporting. |
| **Writing subagent** (1 per scene file) | Only its one scene file's body. Starts cold. |
| **Review subagent** (1 per batch) | A findings report. Edits nothing. |

## Workflow

1. **Read the authoritative sources and reconcile canon first.** The chapter's
   construction plan (施工圖/`*_final_result_plan.md`), the writing addendum
   (voice + Do/Don't), and the story bible (`*_story_bible_v*.md`) under
   `docs/stories_plan/`. Resolve any discrepancy (stale names, old examples in a
   `writing-*` skill) and record the correction — it goes in every brief.
2. **Map beats → scene files and pick granularity.** Linear →
   `scene_<K>.md`; interactive investigation → `investigation_scene_<K>.md`;
   interrogation → `interrogation_scene_<K>.md`. **One writing subagent per
   scene file** — a file is the smallest independently-validatable unit (a
   linear queue or one unlock graph). Do not split sub-scenes (0A/0B) across
   agents.
3. **Author the manifest.** Use `writing-chapter-manifest` to write
   `chapter.md` listing exactly the scene files you are about to author.
4. **RED gate.** Run `bun run scenes:compile` (it merges `static/stories_plan/`
   and `docs/stories_plan/`). Expect failure naming the missing scene files —
   this proves the manifest + validator are wired before any prose exists.
5. **Dispatch writing subagents — in parallel when independent.** Two scene
   files that share no evidence/statement IDs are independent; dispatch them in
   one message (see superpowers:dispatching-parallel-agents). Each brief MUST be
   self-contained (the agent starts cold) — see the brief contract below.
6. **GREEN gate.** Re-run `bun run scenes:compile`; expect
   `OK — N chapter(s), M scene(s)`. If errors, fix the offending file **in
   place** (common: a `Reveals`/`Unlock` target not matching its `{#id}`; a
   locked block with no inbound path; a missing `#### On Collect`; an H2 inside
   a linear scene; a dialogue line >100 chars) and re-run until green. Don't
   edit the compiler.
7. **REVIEW gate.** Dispatch a separate review subagent (capable model) whose
   brief's first action is to invoke Skill `reviewing-story-scenes` — see the
   review brief below. Triage findings: fix Blocker/Important, re-run the GREEN
   gate, then re-review if needed. Minor/"no change required" can ship.
8. **Report and stop.** State files written, the `OK` line, and the review
   verdict. Commit only if the user asks (branch off `main` first).

## Writing-subagent brief contract

Because the agent has none of your context, every brief carries all of:

- **Exact file path + scene type + the writing skill to invoke FIRST.** e.g.
  "First action: invoke Skill `writing-investigation-scene`. Do not invoke
  `using-superpowers`." Write the file and nothing else.
- **The beat excerpt** from the construction plan (the content spec).
- **The matching addendum voice + Do/Don't** for the characters present.
- **Roster + canon corrections** that override stale skill examples (name the
  wrong value explicitly: "suspect is X, NEVER Y — ignore Y in skill examples").
- **Asset policy:** if `static/assets/config/policy.yaml` has `enabled: false`,
  "author semantic content only — no `Background Prompt`/`BGM`/`BGS`/`Image
  Prompt`/asset metadata." Writers author intent, never filesystem paths.
- **The beat's 不要做 list** (forbidden foreshadow / premature reveals).
- **For investigation/interrogation: the exact IDs and the full unlock graph.**
  The orchestrator owns IDs so cross-file references resolve. Game-global
  evidence/statement IDs are declared once; hotspot/topic/sublocation IDs are
  scene-local. State which locked blocks get exactly one inbound `Reveals` and
  no `Unlock` (a block must not have both); first sub-location is `unlocked`.
- **A self-check list** to run before returning, plus "report a 3–5 line summary
  and the final IDs used."

## Review-subagent brief

The review subagent owns *how* to review: its brief's first action is to invoke
Skill `reviewing-story-scenes`, which defines the four axes (canon/factual,
forbidden/premature reveals, voice & style, cross-beat continuity), the verdict
format (SHIP / FIX-RECOMMENDED / BLOCKERS-PRESENT), and the edit-nothing rule.
Your job is to hand it what that skill needs:

- The exact files under review, and the chapter id.
- The authoritative sources to check against: the story bible, the chapter
  construction plan, and the writing addendum (under `docs/stories_plan/` and/or
  `static/stories_plan/`).
- "First action: invoke Skill `reviewing-story-scenes`. Edit nothing — return a
  findings report only, not corrected files."

Don't restate the axes, verdict, or finding format in the brief — the skill owns
them. It returns a verdict plus `Severity — file:line — issue — suggested fix`
findings (offending text quoted, source cited) and a short strengths list.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Orchestrator writes the scene prose itself | Delegate; you own manifest/IDs/briefs/gates, not the body. |
| One subagent for a whole beat's sub-scenes, or per sub-scene | One agent per **scene file**. |
| Skipping the RED gate | Run compile before authoring so you trust the GREEN gate. |
| Letting writers invent IDs | Orchestrator owns IDs; put them in the brief. |
| Shipping on a clean compile alone | The compiler can't catch a canon contradiction or flat voice — the review gate is mandatory. |
| Committing unprompted | Commit only when the user asks; branch off `main`. |

**Related skills:** `reviewing-story-scenes` (the REVIEW gate),
`writing-chapter-manifest`, `writing-detective-game-dialogue`,
`writing-investigation-scene`, `writing-interrogation-scene`;
superpowers:dispatching-parallel-agents, superpowers:subagent-driven-development.
