---
name: subagent-driven-story-writing
description: Use when an orchestrating agent is asked to author one or more chapter beats/scenes for the Lyra detective game 《東京雨證：第零證人》 — e.g. "work on beat N", "write the next scenes", "use a subagent per beat/scene with the proper writing skill". Trigger when turning a construction plan (施工圖/詳細計劃) into playable scene files under stories_plan, not when editing a single file yourself.
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
  `investigation_scene_*.md` / `interrogation_scene_*.md` /
  `analysis_scene_*.md` files.

Do **not** use for: a tiny single-file edit you'll do yourself; authoring the
format details (those live in the `writing-*` skills this skill dispatches to).

## Roles

| Role | Owns |
|---|---|
| **Orchestrator** (you) | Reading sources, canon reconciliation, `chapter.md` manifest, the IDs, every subagent brief, validation, review dispatch, remediation triage, reporting. |
| **Writing subagent** (1 per scene file) | Only its one scene file's body. Starts cold. |
| **Review subagent** (1 per batch) | A findings report. Edits nothing. |

## Workflow

1. **Read the authoritative sources and reconcile canon first.** Use the
   chapter construction plan `docs/stories_plan/chapter_<N>_plan.md`, the
   writing addendum (voice + Do/Don't), and the story bible
   `docs/stories_plan/final_story_bible.md`. Resolve any discrepancy (stale
   names, old examples in a `writing-*` skill) and record the correction — it
   goes in every brief.
2. **Map beats → scene files and pick granularity.** Linear →
   `scene_<K>.md`; interactive investigation → `investigation_scene_<K>.md`;
   interrogation → `interrogation_scene_<K>.md`; evidence-arrangement
   thought-organization → `analysis_scene_<K>.md`. **One writing subagent per
   scene file** — a file is the smallest independently-validatable unit (a
   linear queue or one unlock graph). Do not split sub-scenes (0A/0B) across
   agents.
3. **Author the manifest.** Use `writing-chapter-manifest` to write
   `chapter.md` listing exactly the scene files you are about to author.
4. **RED gate.** Run `bun run scenes:compile`. Expect failure naming the missing scene files —
   this proves the manifest + validator are wired before any prose exists.
5. **Dispatch writing subagents — in parallel when independent.** Two scene
   files that share no evidence/statement IDs are independent; dispatch them in
   one message (see superpowers:dispatching-parallel-agents). Each brief MUST be
   self-contained (the agent starts cold) — see the brief contract below. Each
   subagent runs the §2.4 self-review on its own scene before returning.
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

- **Exact file path + scene type + the writing skill to invoke FIRST.** Match
  the skill to the scene type: linear → `writing-detective-game-dialogue`,
  investigation → `writing-investigation-scene`, interrogation →
  `writing-interrogation-scene`, analysis → `writing-analysis-scene`. e.g.
  "First action: invoke Skill `writing-analysis-scene`. Do not invoke
  `using-superpowers`." Write the file and nothing else.
- **The beat excerpt** from the construction plan (the content spec).
- **The matching addendum voice + Do/Don't** for the characters present.
- **Authoritative source paths + source-located canon corrections.** Give the
  writer the actual story bible, `characters.md`,
  `static/assets/config/characters.yaml`, plan, and addendum paths to read;
  include a concrete correction only when it is source-located (for example,
  "suspect is X, NEVER Y — ignore Y in skill examples"). Do not relay an
  ephemeral cast table: it drifts from the sources.
- **Catalog escalation rule.** `characters.yaml` is the only visual-speaker
  catalog: reusable or visually important speakers require
  `portraitMode: portrait`; intentional faceless/system/very minor speakers
  require `portraitMode: none`; an unknown identity must stop for a catalog
  label/mode decision. Writers must not rely on an uncatalogued speaker
  compiling portraitless or create a local speaker registry.
- **Asset policy:** if `static/assets/config/policy.yaml` has `enabled: false`,
  "author semantic content only — no `Background Prompt`/`BGM`/`BGS`/`Image
  Prompt`/asset metadata." Writers author intent, never filesystem paths.
- **The beat's 不要做 list** (forbidden foreshadow / premature reveals).
- **For investigation/interrogation: the exact IDs and the full unlock graph.**
  The orchestrator owns IDs so cross-file references resolve. Game-global
  evidence/statement IDs are declared once; hotspot/topic/sublocation IDs are
  scene-local. State which locked blocks get exactly one inbound `Reveals` and
  no `Unlock` (a block must not have both); first sub-location is `unlocked`.
- **For analysis scenes: delegate the board contract to
  `writing-analysis-scene`.** The orchestrator owns the intended **Kind**
  (`classify`, `order`, or `threshold`) for every board — take it from the beat
  excerpt, or pick one of the three when the excerpt omits it — plus
  board/card/group IDs as applicable, card source IDs and source-owner paths,
  the authored board sequence and unlock chain, intended story outputs, and the
  request-vs-authorization boundary. The writer invokes
  `writing-analysis-scene` for all remaining kind-specific fields and
  validation rules. When the scene uses practice cards, provide the exact
  practice-card binding details; provenance stays on source records. Analysis
  dialogue-carrier asset cues follow the dedicated skill.
- **For investigation scenes: the interaction-point ratio budget
  (addendum §2.1, per-chapter not per-scene).** Tell the writer the target
  mix across the chapter's investigation scenes *in aggregate*: ~40% 破案資訊
  (directly support the three evidence packages), ~30% 角色生活資訊 (make
  characters feel alive), ~20% 氣氛與伏筆 (blue umbrella, osmanthus, rain,
  shop objects), ~10% 錯誤焦點 / 紅鯡魚 (let players briefly suspect the
  manager, Katase, or deeper Miyake lies). A single scene may concentrate in
  one bucket (e.g. a reversal scene can be mostly 破案); the orchestrator
  balances across scenes. Instruct the writer to label each interaction
  point's bucket in their summary so the orchestrator can aggregate the
  chapter-wide mix; case-breaking info must not leak through a 生活/氣氛
  point.
- **For any scene that grants or updates evidence: the three-layer evidence
  text rule (addendum §2.3).** Each evidence item needs (1) **初始描述** —
  the neutral wording the player sees on first acquisition, (2) **更新後描述**
  — one added sentence after the player discovers its new meaning, and
  (3) **審查會使用語** — the 1–2 lines 相馬 can say when presenting it in a
  hearing/review. Tell the writer which evidence IDs this scene introduces or
  updates and require all three layers for each.
- **Immediate self-review before returning (addendum §2.4 Scene QA Checklist).**
  After writing the scene and before reporting back, the writing subagent MUST
  self-review its own scene against these five questions and fix any violation
  in place:
  1. Does this scene serve only 1–2 main functions? (If it tries to do more,
     cut or move the excess.)
  2. Is any character lecturing the theme instead of acting it? (Rewrite as
     action/dialogue, not exposition.)
  3. Can the player *see* the clue, or are they only *told* it? (Convert
     told-clues to visible/investigable objects.)
  4. Does this scene introduce unnecessary new questions? (Remove side plots
     that don't serve the beat's evidence packages.)
  5. Is any foreshadow mistaken for evidence? (Foreshadow stays atmospheric;
     evidence enters the manifest with formal IDs.)
  The subagent reports which questions passed/failed and what it fixed.
- **Natural conversation & situational context (addendum §5.4).** Every scene
  must open with natural dialogue that grounds the player before case
  mechanics begin. Tell the writer the minimum breathing-dialogue ratio for
  this scene type: linear transitions ≥25%, investigation scenes need 2–3
  lines of pre-investigation dialogue (why we're here, partner check-in,
  first impression of the location), interrogation/hearing scenes need 2–3
  lines of pre-proceeding partner dialogue (nervousness, strategy, opponent
  read), breathing points ≥30%. New characters get a natural introduction
  exchange, not just a Bio field. The writer must not assume the player
  remembers the previous scene's motivation — re-establish presence and
  stakes through human dialogue, not narration.
- **A self-check list** to run before returning, plus "report a 3–5 line summary
  and the final IDs used."

## Review-subagent brief

The review subagent owns *how* to review: its brief's first action is to invoke
Skill `reviewing-story-scenes`, which defines the review axes, verdict format,
and the edit-nothing rule. Your job is to hand it what that skill needs — do not
restate the axes, verdict, or finding format in the brief, the skill owns them:

- The exact files under review, and the chapter id.
- The authoritative sources to check against: the story bible, the chapter
  construction plan, and the writing addendum (under `docs/stories_plan/`).
- "First action: invoke Skill `reviewing-story-scenes`. Edit nothing — return a
  findings report only, not corrected files."

## Common Mistakes

| Mistake | Fix |
|---|---|
| Orchestrator writes the scene prose itself | Delegate; you own manifest/IDs/briefs/gates, not the body. |
| One subagent for a whole beat's sub-scenes, or per sub-scene | One agent per **scene file**. |
| Skipping the RED gate | Run compile before authoring so you trust the GREEN gate. |
| Letting writers invent IDs | Orchestrator owns IDs; put them in the brief. |
| Passing a hand-maintained cast table | Pass authoritative source paths and the catalog escalation rule; writers read the global catalog themselves. |
| Shipping on a clean compile alone | The compiler can't catch a canon contradiction or flat voice — the review gate is mandatory. |
| Committing unprompted | Commit only if the user asks; branch off `main` first. |

**Related skills:** `reviewing-story-scenes` (the REVIEW gate),
`writing-chapter-manifest`, `writing-detective-game-dialogue`,
`writing-investigation-scene`, `writing-interrogation-scene`,
`writing-analysis-scene`;
superpowers:dispatching-parallel-agents, superpowers:subagent-driven-development.
