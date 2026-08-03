---
name: writing-interrogation-scene
description: Use when writing or extending an interrogation_scene_<N>.md file under static/stories_plan/chapter_<N>/ for compiler-validated suspect cross-examination — locked/unlocked Questions whose Testimony lines the player challenges with evidence.
---

# Writing Interrogation Scenes (《東京雨證：第零證人》)

## Role

You author compiler-validated interrogation scene markdown. An interrogation
scene has exactly one phase kind, `inquiry`. Asking a suspect a Question plays
their answer as a line-by-line **Testimony**; the player cross-examines that
testimony by challenging a line and presenting evidence against it — there is
no separate "testimony phase" to write, the questioning IS the
cross-examination.

## Required Background

Read `writing-detective-game-dialogue` first. Reuse its dialogue rules exactly:
Traditional Chinese player-facing text, `**角色名**：內容`, bracketed stage
directions, `[場景：...]` tags, and short dialogue lines.

Read `writing-investigation-scene` for evidence and statement manifest rules.
Interrogation scenes reuse those manifest formats.

## The unified model

- A **Phase** has one **Subject** and one or more **Questions**.
- Each **Question**, once asked, plays a **Testimony**: an ordered list of
  **Lines** delivered one at a time.
- The testimony plays its lines one at a time in the dialogue box and loops;
  advancing (Space) steps to the next line. At any line the player may
  **反駁 (challenge)** that line or **退下 (withdraw)** back to the question menu.
- A line may carry a **Contradiction** — an `evidence:<id>` / `statement:<id>`
  inventory target. Challenging a line with the right evidence fires the
  line's authored **On Correct** breakthrough (+`Reveals`); challenging it
  with the wrong evidence fires **On Wrong Evidence**; challenging a line with
  no `Contradiction` (an honest line) falls back to the testimony's
  **Default Challenge** / **Default Wrong**.
- Reaching the end of a testimony without a breakthrough plays the testimony's
  **On Loop** line, then the detective's **Loop Prompt** line, then repeats
  from line 1.
- **A follow-up is not a separate block kind.** It is an ordinary `### Question`
  that starts `locked` and is unlocked by an earlier line's
  `On Correct → Reveals: [question:<id>]`. Whether that follow-up feels like
  "the same testimony, deeper" or "a completely different question" is purely
  a matter of which question id(s) you reveal — the structure is identical
  either way.
- **Completing a phase is a player action.** A `Complete: auto` phase never
  ends on its own: once every `Required` Question is broken, a **完成訊問
  (complete)** button appears at the question menu and the player presses it to
  conclude the phase (advancing to the next phase, or the scene outro). Optional
  questions never block completion — the player may break the follow-ups they
  want, or none, before finishing. A phase with an explicit `Complete:`
  expression instead ends automatically the moment that expression is satisfied.

Nothing is flagged in the UI: honest lines and lies render identically. Author
`On Wrong Evidence` / `Default Wrong` so a wrong guess is a satisfying dead
end, not a dead-end error.

## File Skeleton

```markdown
# Scene N: <title>

- **Summary:** <one-sentence player recap copy, not a beat list>

## Intro

**角色名**：...

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
- **Required:** true

#### Testimony

- **On Loop:** **角色名**：還有哪裡對不上，再說一次。
- **Loop Prompt:** **偵探名**：從頭再聽一次。
- **Default Challenge:** **偵探名**：等等，這句話讓我想想。
- **Default Wrong:** **角色名**：這句話沒問題吧？
- **Wrong Reply:** **偵探名**：不對，這不是關鍵。

##### Line: <label> {#l_honest}

**角色名**：<誠實的證詞，沒有 Contradiction>

##### Line: <label> {#l_lie}

**角色名**：<有問題的證詞>

- **Contradiction:** evidence:<id>
- **Challenge:** **偵探名**：等一下，這句話和我手上的東西對不上。
- **On Correct:** **角色名**：好吧⋯⋯是我。
  - **Reveals:** [question:<follow_up_id>, evidence:<id>]
- **On Wrong Evidence:** **角色名**：這能證明什麼？

### Question: <label> {#follow_up_id}

- **Status:** locked
- **Unlock:** question:<question_id> answered

#### Testimony

- **On Loop:** **偵探名**：⋯你在迴避什麼？

##### Line: <label> {#l2}

**角色名**：...

## Evidence Manifest

### evidence:<id> {#id}

- **Name:** ...
- **Description:** ...
- **Details:** ...

#### On Collect

**偵探名**：...

## Statement Manifest

### statement:<id> {#id}

- **Speaker:** ...
- **Content:** ...

#### On Acquire

**偵探名**：...

## Outro

**偵探名**：...
```

The skeleton's base interrogation headings, heading levels, and manifest block
structure follow the canonical compiler fixture
`packages/scripts/__fixtures__/valid_interrogation/chapter_1/interrogation_scene_1.md`.
`- **Summary:**` belongs directly after the H1 and is one sentence of
player-facing recap copy, not a beat list or authoring notes.
Use that fixture to resolve questions about base interrogation structure. The
skeleton deliberately omits the nine optional provenance fields from its
Evidence / Statement entries so the reusable template stays classification
neutral — copying it never silently imports a `Source Kind`, `Representation
Layer`, or `Proof Capabilities` claim. Those nine fields, their neutral
defaults, and a labelled concrete example are governed by this skill's shared
provenance section below and the canonical `writing-investigation-scene`
guidance it delegates to; the fixture omits them too, and that must not be
used as a reason to drop them from annotated records that need them.

## Heading Hierarchy Reference

| Level | Block |
| --- | --- |
| H1 | `# Scene N: <title>` |
| H2 | `## Intro`, `## Phase:`, `## Evidence Manifest`, `## Statement Manifest`, `## Outro` |
| H3 | `### Subject:`, `### Question:`, `### evidence:`, `### statement:` |
| H4 | `#### Testimony`, `#### On Collect`, `#### On Acquire`, `#### On Reexamine` |
| H5 | `##### Line:` |

There is no `#### Follow-up:`, `#### On Reask`, `#### Statement:`,
`### Result:`, or `##### On Press` / `On Present` / `On Wrong Present` in the
current grammar — those belonged to the retired two-kind model. Do not author
them; the parser has no handler for them and will reject the scene as an
unknown heading.

## Block Field Schemas

Field labels are English. Reserved metadata values are English (`inquiry`,
`true`, `false`, `locked`, `unlocked`). Player-facing field values and dialogue
are Traditional Chinese. IDs are English slugs anchored with `{#id}`.

### Intro (H2)

- **Heading:** `## Intro`.
- **Metadata:** none on the `## Intro` heading itself.
- **Scene-tag asset metadata:** when assets are enabled, any `[場景：...]` tag
  inside the Intro may be followed immediately by `Background Prompt` plus
  optional `BGM` / `BGS`, using the same visual metadata rules as phases.
- **Body:** linear dialogue. Plays on scene load.

### Phase (H2)

- **Heading:** `## Phase: <label> {#phase_id}`
- **Reserved phase id:** `inventory` is reserved by the compiler for
  evidence/statement manifest dialogue (onCollect / onReexamine / onAcquire)
  and cannot be used as a writer-authored phase id. The compiler rejects it
  with `interrogationPhaseReservedId`.
- **Required:** `Kind` — always `inquiry` (kept for forward compatibility;
  there is no other value the parser accepts).
- **Required when assets are enabled:** `Background Prompt`
- **Optional:** `Required` (`true`/`false`, defaults to `true`), `Status`
  (`locked`/`unlocked`, defaults to `unlocked`), `Unlock`, `Reveals`,
  `Complete` (defaults to `auto`: the phase never ends on its own — the player
  presses the **完成訊問** button, which becomes available once every `Required`
  Question in the phase is broken; an explicit expression instead completes the
  phase automatically when satisfied — see "Contradiction guarantee" below)
- **Optional after first visual unit:** `BGM`, `BGS` (IDs from
  `static/assets/config/audio.yaml`, or `none`)
- **Body:** exactly one `[場景：...]` tag, then optional entry dialogue, then
  one `### Subject:` and one or more `### Question:` blocks.

Use `Required: false` for optional branches. If a phase has `Unlock`, its
`Status` must be `locked`. A locked phase must be reachable by either its own
`Unlock` or an inbound `Reveals` target from an earlier reachable block.

### Subject (H3)

- **Heading:** `### Subject: <name> {#subject_id}`
- **Required:** `Role`, `Bio`
- **Optional:** none
- **Body:** none directly.

Every phase declares exactly one Subject. If the same subject id appears in
multiple phases, keep `name`, `Role`, and `Bio` identical.

### Question (H3)

- **Heading:** `### Question: <label> {#question_id}`
- **Optional:** `Status` (defaults to `unlocked`), `Required` (defaults to
  `true`), `Unlock`, `Reveals`
- **Body:** exactly one `#### Testimony` block. There is no follow-up field —
  a follow-up question is just another `### Question` (see "Follow-ups"
  below).

If a question has `Unlock`, its `Status` must be `locked`. For a locked
question, use either an inbound `Reveals: [question:<id>]` or an `Unlock`
expression, not both (`interrogationRevealsAndUnlockBoth`); a locked question
with neither is unreachable (`interrogationLockedBlockUnreachable`).

### Testimony (H4)

- **Heading:** `#### Testimony`, directly under a `### Question:`.
- **Required:** `On Loop` — the main-character line that plays when the
  player reaches the end of the testimony without a breakthrough, before
  looping back to line 1.
- **Optional:** `Default Challenge` (lead-in used when the player challenges
  an honest line, i.e. a Line with no `Contradiction`), `Default Wrong` (the
  rebuff that follows). Both may be overridden per line.
- **Required iff the testimony has ≥1 `Contradiction` line:** `Loop Prompt`
  (the detective 相馬律's line, played after `On Loop` and before the
  testimony repeats from line 1 — the runtime plays `On Loop` then
  `Loop Prompt` then the first Line), `Wrong Reply` (the detective's line,
  played after whichever suspect rebuff fires — a line's own
  `On Wrong Evidence`, or the testimony's `Default Wrong` — whenever the
  player presents wrong evidence). A testimony with no `Contradiction` line at
  all (an honest question) may omit both — this mirrors the `Challenge` /
  `On Correct` / `On Wrong Evidence` required-iff-`Contradiction` rule on Line
  (H5) below.
- **Body:** one or more `##### Line:` blocks, in play order.
- **Honest questions play only their first Line.** A testimony with no
  `Contradiction` line anywhere auto-breaks the instant it is asked (there is
  nothing to press), so the runtime plays only the first `##### Line:` block
  and then returns to the question menu — any further `##### Line:` blocks
  would be silently dropped. The compiler therefore rejects a multi-Line
  honest testimony with `interrogationHonestTestimonyMultipleLines`. Author an
  honest question as a **single** Line, or give at least one Line a
  `Contradiction` if you want multiple Lines to play.

Every field value (`On Loop`, `Loop Prompt`, `Default Challenge`,
`Default Wrong`, `Wrong Reply`, and the per-line fields below) is a single
bold-label dialogue line or `[action]` — `- **On Loop:** **相馬律**：...` —
not a multi-line exchange.

### Line (H5)

- **Heading:** `##### Line: <label> {#line_id}`
- **Body immediately under the heading:** one or more bold-label dialogue
  lines — the suspect's statement. This is plain dialogue, **not** a
  `- **Content:**` metadata bullet (that field name belonged to the old
  `#### Statement:` block and no longer exists — see Common Mistakes).
- **Optional:** `Contradiction` (`evidence:<id>` or `statement:<id>`).
- **Required iff `Contradiction` is present:** `Challenge` (the lead-in played
  before the evidence tray opens), `On Correct` (the breakthrough dialogue;
  may carry a nested `- **Reveals:** [...]` bullet), `On Wrong Evidence` (the
  rebuff for presenting the wrong item against this line).
- **Optional even without `Contradiction`:** per-line `Challenge` /
  `On Wrong Evidence` overrides of the testimony defaults are allowed on
  honest lines too.
- **Forbidden without `Contradiction`:** `Reveals`. A Line `Reveals` is the
  `On Correct` reveal list (authored as a nested bullet under `On Correct`).
  `On Correct` only fires on a correct contradiction present, so a `Reveals`
  on an honest line is dead — it never fires at runtime but the validator
  would still count it as obtainable, which can mask an unwinnable scene. The
  compiler rejects it with `interrogationRevealsOnHonestLine`.

A line with no `Contradiction` is honest: challenging it always falls back to
the testimony's `Default Challenge` / `Default Wrong`.

## Follow-ups

A follow-up is not a distinct block. It is an ordinary `### Question` that
starts `Status: locked` and is unlocked by an earlier line's
`On Correct → Reveals: [question:<id>]`. Whether the follow-up reads as "the
same testimony, deeper" or "a different question entirely" is purely a matter
of which question id(s) that `On Correct` reveals — author it exactly like
any other locked Question with its own `#### Testimony` and `##### Line:`
blocks. There is no `parent_question_id`, no flattening rule, and no special
casing to remember.

## Reveal And Unlock Syntax

Interrogation reveals are declared on phases, questions, or `On Correct`
lines:

```markdown
- **Reveals:** [evidence:cleaning_log, statement:timeline_gap, question:hidden_follow_up, phase:wakatsuki_testimony]
```

| Target form | Effect |
| --- | --- |
| `evidence:<id>` | Adds an Evidence Manifest item to inventory and plays its `#### On Collect`. |
| `statement:<id>` | Adds a Statement Manifest item to the log and plays its `#### On Acquire`. |
| `question:<id>` | Unlocks a locked question in this interrogation scene. |
| `phase:<id>` | Unlocks a locked phase in this interrogation scene. |

Interrogation `Unlock` and `Complete` expressions support these **local**
predicates:

- `evidence:<id> collected`
- `statement:<id> acquired`
- `question:<id> answered`
- `phase:<id> completed`

`question:<id> answered` means that question's testimony has been **broken**
— the player presented the correct evidence on one of its `Contradiction`
lines. Hotspot, topic, and sub-location predicates are investigation-only. Do
not use them in interrogation scenes.

The HPA-257 global predicates and positive combinators below are available in
both scene families. `question:<id> resolved` is global catalog progress and
is deliberately distinct from this interrogation-local `answered` form.

### HPA-257 monotonic story progression

This is the shared investigation/interrogation contract for `Unlock:` and
`Complete:` expressions and for story targets in `Reveals:`. It does not alter
the existing local grammar, add a metadata flag, or add unlock/reveal metadata
to linear scenes.

#### Positive expression grammar

Use only positive expressions: `and`, `or`, parentheses, and nested
`at_least` are valid. For example:

```text
at_least(2,fact:camera asserted,(question:who_left resolved or objective:check_alibi completed))
```

Whitespace is optional around commas and parentheses, so
`at_least(1,fact:camera asserted)` is valid just like
`at_least(2, fact:camera asserted, fact:door asserted)`. `at_least` requires a
positive base-10 count no greater than its child count; its child expressions
may nest, but cannot be structural duplicates. Negative and active-state forms
are not supported: do not write `not ...`, `objective:<id> incomplete`,
`authorization:<id> missing`, `active_primary_objective:<id>`, or
`objective:<id> revealed`.

The exact global story predicates are:

```text
fact:<id> asserted
question:<id> resolved
objective:<id> completed
authorization:<id> granted
analysis_scene:<chapter_id>@<scene_id> completed
analysis_board:<chapter_id>@<scene_id>@<board_id> completed
```

Analysis predicates require the shown fully qualified slug segments. Their
syntax is present now, but packaged production investigation/interrogation
content has no HPA-259 analysis registry or completion adapter and rejects
them. They are for the synthetic fixture boundary only until future HPA-259
work provides the production contract; do not author them in shipped content.

#### Story targets in `Reveals:`

In addition to the local `evidence:`, `statement:`, `question:`, and `phase:`
targets, a phase, question, or correct-line reveal list may use:

```text
assert_fact:<fact_id>
reveal_question:<question_id>
resolve_question:<question_id>@<fact_id>
reveal_objective:<objective_id>
complete_objective:<secondary_objective_id>
set_primary_objective:<primary_objective_id>
set_primary_objective:<primary_objective_id>; complete_current
set_primary_objective:null
set_primary_objective:null; complete_current
grant_authorization:<authorization_id>
```

Each typed ID must resolve in `story_catalog.md`. `resolve_question` has an
explicit resolver requirement: its `fact_id` must exist, already be asserted
when that target runs (or be asserted earlier in the same ordered list), and
appear in the Question's `Resolved By: [fact:<id>, ...]` field. Do not expect
the compiler to infer a resolver from testimony or evidence proximity.

`complete_objective:<id>` directly completes **secondary** objectives only.
Primary transitions must use `set_primary_objective:`; any non-null next target
must be a primary objective. `null` has exactly one special target use:
`set_primary_objective:null` clears the active primary. `{#null}` is forbidden
as an Objective catalog ID, and `null` is not a generic placeholder.

#### Ordered transaction and one-shot boundary

Every mixed local/story `Reveals:` list is an authored **ordered atomic
transaction**, never an unordered set. Earlier targets can make later targets
legal:

```text
[assert_fact:camera, resolve_question:who_left@camera]  # valid
[resolve_question:who_left@camera, assert_fact:camera]  # invalid unless camera was already asserted
```

If any later target fails, every provisional earlier effect rolls back,
including local state, inventory/dialogue, facts, objectives, and
authorizations. Conditions are re-evaluated only after the full list commits.
Avoid duplicate story targets, conflicting resolver facts for one question, and
more than one `set_primary_objective:` target in a list.

The owning first-entry, auto-break, or correct-break trigger is durable and
one-shot. A committed trigger does not redispatch its list when the player
re-asks, repeats a correct submission, re-enters, or the command is delivered
again. Do not model a later branch as if it can replay a prior breakthrough.

#### Reachability and phase-order limits

Positive self-dependencies and multi-node positive cycles are compilation
errors, even if an outside seed also reaches the cycle. This includes a cycle
hidden inside `or` or nested `at_least`; create a real forward seed instead.
Free-order choices are not cycles, but an order-sensitive story batch or
primary transition can warn. Make the prerequisite strict or linearize the
branch when its result must be deterministic. New unreachable mandatory
HPA-257 content errors and optional content warns; optionality never excuses an
unknown reference or an invalid atomic batch.

The current interrogation analysis proves only the statically unlocked phase
schedule: required phases before optional phases, in author order within each
priority. It does **not** model every conditional ordering produced when a
previously locked phase becomes dynamically unlocked. Do not rely on that
unmodeled scheduling to make an order-sensitive primary transition safe;
express an explicit prerequisite or make the branch order-insensitive.

Do not author authorization:<id> granted as a production unlock gate in HPA-257/HPA-259 content. No production authority event can grant it until HPA-264; mandatory use fails compilation and optional use warns.

## Contradiction guarantee (critical — the Beat-10 trap)

Every `Contradiction` target must be **guaranteed** obtainable before the
player can reach the line that needs it — either from a prior guaranteed
scene, or from an earlier guaranteed breakthrough in this same scene.
"Guaranteed" is stricter than "obtainable": an item revealed only inside an
**optional** (`Required: false`) question's `On Correct` is obtainable (a
thorough player might find it) but is **not guaranteed**, because the
compiler cannot assume every player answers an optional question.

Two compiler checks enforce this, and you will hit one of them if a
contradiction chain isn't guaranteed:

- **`crossSceneInventoryNotGuaranteed`** — a `Contradiction` (or `Unlock`)
  references `evidence:<id>` / `statement:<id>` from an earlier scene that the
  compiler cannot prove is guaranteed before this interrogation scene runs
  (e.g. it only exists behind an optional investigation branch, or the
  investigation's `## Outro` has an explicit `Unlock:` that only guarantees
  one predicate's evidence rather than everything reachable).
- **`interrogationUnguaranteedContradiction`** — a `Required` phase has no
  reachable question whose `Contradiction` line is guaranteed and whose
  `On Correct` can fire, *within this scene*. This is the in-scene form of the
  same trap: a chain of reveals that only fires through an optional question
  never counts as guaranteed.

**The workaround you need for a real, accepted case:** if a `Required`
follow-up question's only unlock/contradiction path is gated behind an
`Optional` (`Required: false`) question's `On Correct → Reveals`, the compiler
conservatively rejects it with `interrogationUnguaranteedContradiction` — it
propagates guaranteed inventory only through `Required` questions (only those
are guaranteed to be broken), so an optional question's reveals never count as
guaranteed even if, in practice, the player has no other way to finish the
phase. **Fix: mark the gating (parent) question `Required: true`.** Once the
parent question is required, its `On Correct` reveals participate in the
guaranteed-inventory pass, and the downstream required follow-up resolves.
(See `packages/scripts/__fixtures__/invalid/interrogation_unguaranteed_contradiction/`
for the exact shape of this failure.)

One more subtlety: if a single Question has **multiple** `Contradiction` lines
that are all independently obtainable (the player could break the question
via any one of them), only `Reveals` **common to every valid line** are
guaranteed downstream — the compiler cannot assume which line the player
presented against. Don't rely on one specific line's unique reveal unless
every viable breakthrough line for that question reveals the same id(s).

## Evidence And Statement Manifests

Use the same manifest entry formats as `writing-investigation-scene`:

- `### evidence:<id> {#id}` with `Name`, `Description`, `Details`, required
  `Image Prompt` when assets are enabled, required `#### On Collect`, optional
  `#### On Reexamine`
- `### statement:<id> {#id}` with `Speaker`, `Content`, required
  `#### On Acquire`, optional `#### On Reexamine`

`Image Prompt` is an English production prompt for the evidence icon. Do not
include a path. Phase scene tags and background prompts are semantic
production prompts, not filesystem paths; writers never author paths.

### 案件紀錄 provenance（本地 skeleton 與 Investigation 共用）

上方 File Skeleton 的 Evidence / Statement entries 刻意不列出 provenance
slots：九個欄位都是 optional，且 `Source Kind`、`Representation Layer`、
`Proof Capabilities` 等分類彼此正交，預填具體值會讓作者在複製 skeleton 時
默默把實體證物誤歸為 `digital`、把逐字證詞誤歸為 `summary`。skeleton 保持
分類中性，分類語義與 labelled 具體範例只留在本節與 canonical
`writing-investigation-scene` 的「案件紀錄來源與承接」範例。這九個 exact
English keys 都是 optional；若不寫，輸出以下 neutral values：

| Exact key | Allowed value | Omitted neutral value |
|---|---|---|
| `Source Kind` | `physical`, `testimony`, `digital`, `subjective`, `unspecified` | `unspecified` |
| `Representation Layer` | `raw`, `sync`, `summary`, `composite`, `none` | `none` |
| `Procedural Status` | `unspecified`, `lead`, `reacquired`, `exhibit` | `unspecified` |
| `Completeness` | `complete`, `partial`, `cropped`, `unspecified` | `unspecified` |
| `Confidence` | `unverified`, `corroborated`, `disputed`, `unspecified` | `unspecified` |
| `Source Group` | 已在全域 catalog 宣告的非空 slug | `null` |
| `Source Label` | 非空的繁體中文顯示文字 | `null` |
| `Proof Capabilities` | 方括號包住的 capability list | `[]` |
| `Supersedes` | `evidence:<id>` 或 `statement:<id>` | `null` |

`Representation Layer: none` 既是 omitted neutral default，也可明寫成
「沒有 meaningful representation layer」；runtime 不保留 authored-presence
bit，兩者無法區分。

`Proof Capabilities` 是正向能力集合。缺少某個 capability 表示不能靠此紀錄
滿足該 authored requirement，但不證明相反命題。不可重複；用方括號並依
canonical order 書寫：

```text
time, order, route, identity, access, motive, source, credibility, procedure, causation
```

`Source Group` 只引用全域 `story_catalog.md` 最後 `## Source Groups` 內
`### Source Group: <繁體中文顯示 label> {#<english_slug>}` 的 anchor slug。
Group block 只寫 `Summary`；compiler 從 Evidence / Statement records 的
references 推導 typed membership。未填 group 會輸出 `null`，表示來源獨立性
未知，絕不是自成一組的 synthetic independent source。`Source Label`
只供顯示，不建立 source identity。

`Supersedes` 必須由新紀錄指向同種類的 immutable immediate predecessor：
evidence 指 evidence，statement 指 statement。Chain 不可分叉；source
grouping 與 supersession 互不推導。只要寫 `Supersedes`，就同時明寫
`Procedural Status`，並遵守：

```text
unspecified < lead < reacquired < exhibit
```

Successor 省略 status 會落到 `unspecified`，可能正確觸發 non-regression
error。File Skeleton 預設 neutral：九個 provenance 欄位全部省略（套用
neutral 預設值），不預設 supersession、source group 或任何分類。要寫
successor 時才補上 `Procedural Status`（不得低於 predecessor）與
`Supersedes`，並參照 canonical `writing-investigation-scene` 技能中
「案件紀錄來源與承接」的 opt-in successor 範例（使用前務必換成真實
predecessor）。沒有 predecessor 的 lead 可省略 `Supersedes`，但應
明寫 `Procedural Status: lead`。

Evidence / Statement metadata 是 closed、duplicate-safe contract。同一 key
重複會在第二次出現處報錯；present-but-blank provenance value 無效；不要把
source、capability 或 supersession 只寫進 `Details` / `Content` 後期待
compiler 推斷。完整語義與 compact two-file example 以
`writing-investigation-scene` 的「案件紀錄來源與承接」為 canonical
reference。

## Outro

- **Heading:** `## Outro`
- **Optional:** `Unlock` (defaults to `auto`)
- **Body:** closing dialogue parsed into the scene JSON.

## Workflow

1. Read the chapter detail plan and General Plan.
2. Sketch phases and questions before writing dialogue: which questions are
   `Required`, which lines carry a `Contradiction`, which follow-up ids each
   breakthrough reveals.
3. List every evidence and statement id used by a `Contradiction`, and confirm
   where it becomes guaranteed (a prior scene's guaranteed inventory, or an
   earlier `Required` breakthrough in this scene).
4. Write the scene in canonical order: `## Intro`, `## Phase:` blocks, then
   `## Evidence Manifest`, `## Statement Manifest`, `## Outro`.
5. Self-check that every phase has exactly one scene tag and one Subject with
   `Role`/`Bio`.
6. Self-check that every `Contradiction` line also has `Challenge`,
   `On Correct`, and `On Wrong Evidence`; that every `#### Testimony` has
   `On Loop`; and that any testimony with a `Contradiction` line also has
   `Loop Prompt` and `Wrong Reply`.
7. Self-check that any `Required` follow-up's unlock chain does not pass
   through an `Optional` question's reveal — if it must, mark that question
   `Required` instead.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Authoring a `- **Content:**` field on a `##### Line:` | The suspect line is plain dialogue directly under the heading (`**角色名**：...`), not a metadata bullet — `Content` was a field of the retired `#### Statement:` block. Writing it as metadata triggers `interrogationEmptyLine` (no dialogue found) or `interrogationBadLineField`. |
| Writing a `#### Follow-up:`, `#### On Reask`, `#### Statement:`, or `### Result:` block | These blocks no longer exist. A follow-up is a locked `### Question`; the parser rejects unknown headings. |
| `Contradiction` line missing `Challenge` / `On Correct` / `On Wrong Evidence` | All three are required together — the compiler fails with `interrogationMissingChallenge`, `interrogationMissingOnCorrect`, or `interrogationMissingOnWrongEvidence`. |
| `Reveals` on an honest line (no `Contradiction`) | `Reveals` is the `On Correct` reveal list and only fires on a correct contradiction present. Move it under a contradiction line's `On Correct`, or remove it — fails with `interrogationRevealsOnHonestLine`. |
| `#### Testimony` missing `On Loop` | `On Loop` is required on every Testimony — fails with `interrogationMissingOnLoop`. |
| `#### Testimony` with a `Contradiction` line but missing `Loop Prompt` or `Wrong Reply` | Both are required once the testimony has ≥1 `Contradiction` line — fails with `interrogationMissingLoopPrompt` or `interrogationMissingWrongReply`. |
| `#### Testimony` with zero `##### Line:` blocks | Every Testimony needs at least one Line — fails with `interrogationEmptyTestimony`. |
| A `Required` follow-up unlocked only through an `Optional` question's reveal | Fails with `interrogationUnguaranteedContradiction`. Mark the gating question `Required: true` (see "Contradiction guarantee" above). |
| Referencing a clue by display name | Use exact `evidence:<id>` or `statement:<id>` in `Contradiction` / `Reveals`. Malformed targets fail with `interrogationContradictionMalformed` / `interrogationRevealUnknownTarget`. |
| Reusing investigation hotspot/topic predicates in `Unlock` | Interrogation unlocks use inventory, question, and phase predicates only. |
| Omitting the phase scene tag | Add exactly one `[場景：...]` tag inside every Phase body (`interrogationPhaseNoSceneTag`). |
| Subject without `Role` and `Bio` | Add both metadata fields under `### Subject:` (`interrogationSubjectMissingMetadata`). |
| Locked question with both `Unlock` and an inbound `Reveals` | Pick one — `interrogationRevealsAndUnlockBoth`. |
| Locked question with neither `Unlock` nor an inbound `Reveals` | It's unreachable — `interrogationLockedBlockUnreachable`. |
