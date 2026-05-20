---
name: writing-interrogation-scene
description: Use when writing or extending an interrogation_scene_<N>.md file under static/stories_plan/chapter_<N>/ for compiler-validated suspect inquiry plus testimony cross-examination phases with evidence presentation.
---

# Writing Interrogation Scenes (《東京雨證：第零證人》)

## Role

You author compiler-validated interrogation scene markdown. An interrogation scene can contain both inquiry phases, where the player asks suspect questions, and testimony phases, where the player presses testimony lines and presents evidence or statements.

## Required Background

Read `writing-detective-game-dialogue` first. Reuse its dialogue rules exactly: Traditional Chinese player-facing text, `**角色名**：內容`, bracketed stage directions, `[場景：...]` tags, and short dialogue lines.

Read `writing-investigation-scene` for evidence and statement manifest rules. Interrogation scenes reuse those manifest formats.

## File Skeleton

```markdown
# Scene N: <title>

## Intro

## Phase: <label> {#phase_id}
- **Kind:** inquiry
- **Required:** true
- **Status:** unlocked

[場景：地點、時間、氛圍、視覺要素]

### Subject: <name> {#subject_id}
- **Role:** <player-facing role>
- **Bio:** <player-facing bio>

### Question: <label> {#question_id}
- **Status:** unlocked

**相馬律**：...

## Phase: <label> {#phase_id}
- **Kind:** testimony
- **Required:** true
- **Status:** locked
- **Unlock:** statement:<id> acquired

[場景：地點、時間、氛圍、視覺要素]

### Subject: <name> {#subject_id}
- **Role:** <player-facing role>
- **Bio:** <player-facing bio>

### Testimony

#### Statement: <label> {#statement_id}
- **Content:** <testimony line>
- **Contradiction:** evidence:<id>
- **On Correct:** <result_id>

### Result: <label> {#result_id}

## Evidence Manifest

## Statement Manifest

## Outro
```

## Heading Hierarchy Reference

| Level | Block |
| --- | --- |
| H1 | `# Scene N: <title>` |
| H2 | `## Intro`, `## Phase:`, `## Evidence Manifest`, `## Statement Manifest`, `## Outro` |
| H3 | `### Subject:`, `### Question:`, `### Testimony`, `### Result:`, `### evidence:`, `### statement:` |
| H4 | `#### Follow-up:`, `#### On Reask`, `#### Statement:`, `#### On Collect`, `#### On Acquire`, `#### On Reexamine` |
| H5 | `##### On Reask`, `##### On Press`, `##### On Present`, `##### On Wrong Present` |

## Block Field Schemas

Field labels are English. Reserved metadata values are English (`inquiry`, `testimony`, `true`, `false`, `locked`, `unlocked`). Player-facing field values and dialogue are Traditional Chinese. IDs are English slugs anchored with `{#id}`.

### Phase (H2)
- **Heading:** `## Phase: <label> {#phase_id}`
- **Required:** `Kind` (`inquiry` or `testimony`)
- **Optional:** `Required` (`true` or `false`, defaults to `true`), `Status` (`locked` or `unlocked`, defaults to `unlocked`), `Unlock`, `Reveals`, `Complete` (inquiry phases only, defaults to `auto`)
- **Body:** exactly one `[場景：...]` tag, then optional entry dialogue, then one `### Subject:` and the phase-specific blocks.

Use `Required: false` for optional branches. If a phase has `Unlock`, its `Status` must be `locked`. A locked phase must be reachable by either its own `Unlock` or an inbound `Reveals` target from an earlier reachable block.

### Subject (H3)
- **Heading:** `### Subject: <name> {#subject_id}`
- **Required:** `Role`, `Bio`
- **Optional:** none
- **Body:** none directly.

Every phase must declare exactly one Subject. If the same subject ID appears in multiple phases, keep `name`, `Role`, and `Bio` identical.

## Inquiry Phase

Use inquiry for suspect Q&A. Required blocks:

- `### Subject: <name> {#id}`
- `### Question: <label> {#id}`
- optional `#### Follow-up: <label> {#id}`
- optional `#### On Reask` or `##### On Reask`

Questions can reveal `evidence:<id>`, `statement:<id>`, `question:<id>`, or `phase:<id>`.

### Question (H3)
- **Heading:** `### Question: <label> {#question_id}`
- **Optional:** `Status` (defaults to `unlocked`), `Required` (defaults to `true`), `Unlock`, `Reveals`
- **Body:** answer dialogue that plays the first time the player asks the question.
- **Optional sub-block:** `#### On Reask` — plays on repeat asks.

### Follow-up (H4)
- **Heading:** `#### Follow-up: <label> {#follow_up_id}`
- **Optional:** `Status` (defaults to `unlocked`), `Required` (defaults to `true`), `Unlock`, `Reveals`
- **Body:** answer dialogue that plays the first time the player asks the follow-up.
- **Optional sub-block:** `##### On Reask` — plays on repeat asks.

Follow-ups must appear immediately after their parent Question. If a question or follow-up has `Unlock`, its `Status` must be `locked`. For locked questions and follow-ups, use either an inbound `Reveals: [question:<id>]` or an `Unlock` expression, not both.

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
- `Reveals`
- `##### On Press`
- `##### On Present`
- `##### On Wrong Present`

### Testimony Statement (H4)
- **Heading:** `#### Statement: <label> {#statement_id}` under `### Testimony`
- **Required:** `Content`
- **Optional:** `Contradiction`, `On Correct`, `On Wrong`, `Reveals`
- **Optional sub-blocks:** `##### On Press`, `##### On Present`, `##### On Wrong Present`

`Contradiction` must be an exact inventory target: `evidence:<id>` or `statement:<id>`. When `Contradiction` is present, `On Correct` is required and must name a `### Result:` ID in the same testimony phase. `On Wrong` is optional and also names a Result ID. `Reveals` uses the same interrogation reveal list syntax as inquiry questions.

### Result (H3)
- **Heading:** `### Result: <label> {#result_id}`
- **Optional:** `Reveals`
- **Body:** result dialogue. Correct-result reveals should add any evidence or statement that later scenes rely on.

Every required testimony phase needs at least one reachable statement with both a valid `Contradiction` and a valid `On Correct` result. Wrong-present dialogue returns to the same testimony phase; it should not advance the scene.

## Reveal And Unlock Syntax

Interrogation reveals are declared on phases, questions, follow-ups, testimony statements, or results:

```markdown
- **Reveals:** [evidence:cleaning_log, statement:timeline_gap, question:hidden_follow_up, phase:wakatsuki_testimony]
```

| Target form | Effect |
| --- | --- |
| `evidence:<id>` | Adds an Evidence Manifest item to inventory and plays its `#### On Collect`. |
| `statement:<id>` | Adds a Statement Manifest item to the log and plays its `#### On Acquire`. |
| `question:<id>` | Unlocks a locked question or follow-up in this interrogation scene. |
| `phase:<id>` | Unlocks a locked phase in this interrogation scene. |

Interrogation `Unlock` and `Complete` expressions only support:

- `evidence:<id> collected`
- `statement:<id> acquired`
- `question:<id> answered`
- `phase:<id> completed`
- `<a> and <b>`
- `<a> or <b>`

Hotspot, topic, and sub-location predicates are investigation-only. Do not use them in interrogation scenes.

## Evidence And Statement Manifests

Use the same manifest entry formats as `writing-investigation-scene`:

- `### evidence:<id> {#id}` with `Name`, `Description`, `Details`, required `#### On Collect`, optional `#### On Reexamine`
- `### statement:<id> {#id}` with `Speaker`, `Content`, required `#### On Acquire`, optional `#### On Reexamine`

Contradictions can use evidence or statements from earlier guaranteed scenes, or from this interrogation scene if the item is obtainable before the testimony phase. If the compiler cannot prove the item is guaranteed, the build fails.

## Outro

- **Heading:** `## Outro`
- **Optional:** `Unlock` (defaults to `auto`)
- **Body:** closing dialogue parsed into the scene JSON. Runtime advancement for interrogation scenes belongs to the later engine/frontend tasks.

## Workflow

1. Read the chapter detail plan and General Plan.
2. Identify whether this scene has inquiry, testimony, or both.
3. Sketch phases before writing dialogue.
4. List every evidence and statement ID used by contradictions.
5. Write the scene in canonical order.
6. Self-check that every phase has exactly one scene tag and one Subject with Role/Bio.
7. Self-check that every contradiction has a named exact evidence or statement and a valid On Correct result.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Writing testimony as ordinary questions | Use `### Testimony` and `#### Statement:` blocks. |
| Referencing a clue by display name | Use exact `evidence:<id>` or `statement:<id>`. |
| Making wrong evidence end the scene | Wrong present returns to the same testimony phase. |
| Reusing investigation hotspot/topic predicates | Interrogation unlocks use inventory, question, and phase predicates only. |
| Omitting the phase scene tag | Add exactly one `[場景：...]` tag inside every Phase body. |
| Subject without `Role` and `Bio` | Add both metadata fields under `### Subject:`. |
| `Contradiction` without `On Correct` | Add an `On Correct` result ID and define the matching `### Result:` block. |
