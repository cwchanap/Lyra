---
name: writing-interrogation-scene
description: Use when writing or extending an interrogation_scene_<N>.md file under static/stories_plan/chapter_<N>/ — suspect inquiry plus testimony cross-examination phases with evidence presentation.
---

# Writing Interrogation Scenes (《東京雨證：第零證人》)

## Role

You author playable interrogation scenes. An interrogation scene can contain both inquiry phases, where the player asks suspect questions, and testimony phases, where the player presses testimony lines and presents evidence or statements.

## Required Background

Read `writing-detective-game-dialogue` first. Reuse its dialogue rules exactly: Traditional Chinese player-facing text, `**角色名**：內容`, bracketed stage directions, `[場景：...]` tags, and short dialogue lines.

Read `writing-investigation-scene` for evidence and statement manifest rules. Interrogation scenes reuse those manifest formats.

## File Skeleton

```markdown
# Scene N: <title>

## Intro

## Phase: <label> {#phase_id}
- **Kind:** inquiry

## Phase: <label> {#phase_id}
- **Kind:** testimony

## Evidence Manifest

## Statement Manifest

## Outro
```

## Inquiry Phase

Use inquiry for suspect Q&A. Required blocks:

- `### Subject: <name> {#id}`
- `### Question: <label> {#id}`
- optional `#### Follow-up: <label> {#id}`
- optional `#### On Reask` or `##### On Reask`

Questions can reveal `evidence:<id>`, `statement:<id>`, `question:<id>`, or `phase:<id>`.

## Testimony Phase

Use testimony for cross-examination. Required blocks:

- `### Subject: <name> {#id}`
- `### Testimony`
- `#### Statement: <label> {#id}`
- `### Result: <label> {#id}`

A testimony statement can define:

- `Content`
- `Contradiction`
- `On Correct`
- `On Wrong`
- `##### On Press`
- `##### On Present`
- `##### On Wrong Present`

## Workflow

1. Read the chapter detail plan and General Plan.
2. Identify whether this scene has inquiry, testimony, or both.
3. Sketch phases before writing dialogue.
4. List every evidence and statement ID used by contradictions.
5. Write the scene in canonical order.
6. Self-check that every contradiction has a named exact evidence or statement.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Writing testimony as ordinary questions | Use `### Testimony` and `#### Statement:` blocks. |
| Referencing a clue by display name | Use exact `evidence:<id>` or `statement:<id>`. |
| Making wrong evidence end the scene | Wrong present returns to the same testimony phase. |
| Reusing investigation hotspot/topic predicates | Interrogation unlocks use inventory, question, and phase predicates only. |
