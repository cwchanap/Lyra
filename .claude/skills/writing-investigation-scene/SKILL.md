---
name: writing-investigation-scene
description: Use when writing or extending an investigation_scene_<N>.md file under static/stories_plan/chapter_<N>/ — interactive investigation scenes with hotspots, characters, evidence/statements manifests, and unlock chains. Requires writing-detective-game-dialogue for base dialogue format. Trigger when given a chapter detail plan (詳細計劃) and asked to produce the interactive investigation part (not a linear scene).
---

# Writing Investigation Scenes (《東京雨證：第零證人》)

## Role

You are authoring **interactive investigation scenes** for the detective game. Each scene is a markdown file the player will explore non-linearly — clicking hotspots, asking characters topics, collecting evidence and statements. The format is hybrid: human-readable dialogue with structured markdown-heading blocks that map cleanly onto the scene JSON schema and investigation runtime state.

## Language convention

**Player-facing content** (everything the player sees in-game) is **Traditional Chinese**: dialogue lines, bracketed stage directions, `[場景：...]` scene tags, intro/outro narration, evidence/statement *values* (name, description, details, content). The base `writing-detective-game-dialogue` skill governs all of this.

**Author/parser-facing content** (markdown structure and metadata only) is **English**: block headings (`## Intro`, `#### On Collect`, etc.), field labels (`Status`, `Unlock`, `Reveals`, `Description`, etc.), state values (`locked`/`unlocked`), reveal target prefixes (`evidence:` / `statement:` / `topic:` / `hotspot:` / `sublocation:` / `practice:`), and the unlock-condition predicates/combinators (`collected`, `discussed`, `and`, `or`, ...). The parser reads these; the player never does.

## REQUIRED BACKGROUND

You MUST be familiar with **`writing-detective-game-dialogue`** before using this skill. That skill owns the base dialogue rules: line format (`**角色名**：`), ≤100 Chinese char limit, narration assignment, bracketed stage directions, scene tags and purposeful background prompts, catalog labels / portrait modes / expression choreography, phone-call convention, foreshadowing discipline, Traditional Chinese rules, and the per-chapter foreshadowing allow/deny lists.

This skill describes only the **structural wrapper** around dialogue — the block hierarchy and reveal/unlock logic specific to investigation scenes. All dialogue *inside* block bodies follows the base dialogue skill's rules unchanged.

## When to use

Use when the file you are authoring is `chapter_<N>/investigation_scene_<N>.md` — i.e. the user has asked you to write the interactive investigation Part (Part 1, Part 4 in Chapter 1, etc.).

**Do not use for** `chapter_<N>/scene_<N>.md` — those are linear dialogue scenes (intro cutscenes, transitions, in-car conversations). For linear scenes, use `writing-detective-game-dialogue` directly.

**Also not for** `interrogation_scene_<N>.md` — those are authored and compiler-validated suspect inquiry and testimony cross-examination scenes. Use `writing-interrogation-scene`.

## File skeleton (canonical order)

Every `investigation_scene_<N>.md` follows this top-to-bottom order:

```
# Scene N: <title>

- **Summary:** <one-sentence player recap copy, not a beat list>

## Intro                         (intro narration — H2)

## Sub-location: ... {#id}       (one or more — H2)
  ### Hotspot: ... {#id}         (H3, inside sub-location)
  ### Character: ... {#id}       (H3, inside sub-location)
    #### Topic: ... {#id}        (H4, inside character)

## Evidence Manifest             (H2, optional if scene has no evidence)
  ### evidence:... {#id}         (H3)
    #### On Collect              (H4, required)
    #### On Reexamine            (H4, optional)

## Statement Manifest            (H2, optional if scene has no statements)
  ### statement:... {#id}        (H3)
    #### On Acquire              (H4, required)
    #### On Reexamine            (H4, optional)

## Outro                         (outro narration — H2)
```

The `- **Summary:**` line appears directly after the H1. It is one sentence of
player-facing recap copy, not a beat list or authoring notes.

## Heading hierarchy reference

| Level | Block |
|---|---|
| H1 | `# Scene N: <title>` (exactly one per file) |
| H2 | `## Intro`, `## Sub-location:`, `## Evidence Manifest`, `## Statement Manifest`, `## Outro` |
| H3 | `### Hotspot:`, `### Character:`, `### evidence:`, `### statement:` |
| H4 | `#### Topic:`, `#### On Collect` / `#### On Reexamine` (under evidence), `#### On Acquire` / `#### On Reexamine` (under statement), `#### On Reexamine` (under Hotspot) |
| H5 | `##### On Reexamine` (under Topic only) |

**Hotspots and Characters always live inside a Sub-location block.** Even single-location scenes wrap everything in one Sub-location for parser uniformity.

## Block field schemas

Field labels are English; reserved keyword values are English (`locked` / `unlocked`). IDs are English slugs anchored with `{#id}` on the heading line. Field *values* that the player sees (name, description, details, dialogue) are Traditional Chinese.

### Sub-location (H2)
- **Required:** `Status` (`locked` or `unlocked`)
- **Required when assets are enabled:** `Background Prompt`
- **Optional:** `Unlock`, `Reveals` (list)
- **Optional after first visual unit:** `BGM`, `BGS` (IDs from `static/assets/config/audio.yaml`, or `none`)
- **Body:** `[場景：...]` tag (mandatory, immediately after metadata), then transition dialogue, then nested H3 Hotspot / Character blocks.

### Hotspot (H3, inside a Sub-location)
- **Required:** `Description`
- **Optional:** `Status` (defaults to `unlocked`), `Unlock`, `Reveals` (list), `Evidence Source`, `Scene Source Prompt`
- **Required when assets are enabled and this Hotspot reveals evidence:** `Evidence Source`
  - `visible` — the player clicks a visible source object or visible source
    area in the scene. Use this even when the final evidence icon/text is not
    readable or is only produced after inspection, as long as the local click
    target itself is visible.
  - `implied` — reserve for rare derived evidence where the player is using a
    local spatial/action carrier rather than a clear visible source object or
    area. Prefer `visible` for ordinary evidence-bearing hotspots.
  - `hidden` — the evidence source is not visually present before the player
    inspects or uncovers it.
- **Scene Source Prompt:** one-line English production guidance for the in-scene source only. It is not a filesystem path and does not replace the evidence manifest's `Image Prompt`.
- **Multiple evidence correlation:** a single Hotspot may reveal multiple evidence items by listing multiple `[evidence:...]` targets in `Reveals`. This is the canonical way to say those evidence items come from the same player inspection.
  - Use one Hotspot with multiple evidence reveals only when the evidence items share the same click target and the same `Evidence Source` treatment.
  - `Evidence Source` and `Scene Source Prompt` apply to the Hotspot as a whole, not to each individual evidence item.
  - If one evidence item should be `visible` and another should be `hidden` or `implied`, split them into separate Hotspots even if they are near each other in the same sub-location.
- **Local evidence rule:** any evidence revealed by a Hotspot must declare the same `Source Sublocation` ID as the Hotspot's parent sub-location. Do not reveal evidence from another room, corridor, or sub-location.
- **Invisible-document rule:** if the background lacks a physical document, terminal screen, board, or source object for the exact clue, do not invent a precise document Hotspot. Write the evidence as `hidden`, `implied`, or derived from a broader local trigger such as a counter record area, visible device, spatial sightline, or object cluster.
- **Compiler-enforced rules (compile errors regardless of asset state):**
  - `Evidence Source` may only take `visible`, `implied`, or `hidden`. Any other value is a parse error (`hotspotEvidenceSourceInvalid`), even when assets are disabled.
  - `Evidence Source` is only valid on a Hotspot that reveals evidence (its `Reveals:` includes at least one `[evidence:…]`). Putting it on a non-evidence hotspot is `hotspotEvidenceSourceWithoutEvidenceReveal`.
  - `Scene Source Prompt` requires `Evidence Source`. A prompt with no source is `hotspotSceneSourcePromptWithoutSource`.
  - Separately, `Evidence Source` becomes *required* (not just valid) when assets are enabled and the Hotspot reveals evidence — enforced by the asset enrichment layer.
- **Body:** inspect dialogue (plays on the player's **first** click on this hotspot, followed by `Reveals:` chain dialogue).
- **Optional sub-block:** `#### On Reexamine` — H4 immediately under this Hotspot's body. Plays on every click **after** the first. No new reveals fire on reexamine. If `#### On Reexamine` is absent, subsequent clicks play an engine-provided fallback line (configured in the engine, not authored here).

### Character (H3, inside a Sub-location)
- **Required:** `Role`, `Bio`
- **Optional:** none
- **Body:** none directly — container for `#### Topic:` blocks.

### Topic (H4, inside a Character)
- **Required:** `Status`
- **Optional:** `Unlock`, `Reveals` (list)
- **Person-sourced evidence:** if the evidence comes from what a person provides,
  reveal it from the specific `#### Topic:` where that person gives the
  information. Do not invent a standalone document hotspot unless the player
  actually inspects a local physical source.
- **Related audit workflow:** When re-auditing existing evidence-to-hotspot or
  evidence-to-topic placement, use
  `auditing-investigation-evidence-sources`; it owns Markdown-first carrier
  cleanup and avoids editor/generated-JSON sync drift.
- **Body:** topic dialogue (plays on the player's **first** selection of this topic, followed by `Reveals:` chain dialogue).
- **Optional sub-block:** `##### On Reexamine` — H5 immediately under this Topic's body. Plays on every selection **after** the first. No new reveals fire on reexamine. If absent, the engine plays a fallback line on subsequent selections.

### Evidence Manifest entry (H3 under `## Evidence Manifest`)
- **Heading:** `### evidence:<id> {#id}`
- **Required:** `Name`, `Description`, `Details`, `Source Sublocation`
- **Source Sublocation:** the exact ID of the sub-location where this evidence is discovered, e.g. `front`, `corridor`, or `inner_entry`. Evidence may only be revealed by a Hotspot, Topic, or sub-location entry trigger in that same sub-location.
- **Required when assets are enabled:** `Image Prompt` — English production prompt for the evidence icon. Do not include a path.
- **Optional:** the shared case-record provenance fields documented below.
- **Body:**
  - `#### On Collect` (required) — dialogue that plays when this evidence is first added to inventory.
  - `#### On Reexamine` (optional) — dialogue that plays when the player re-opens this item from inventory.

### Statement Manifest entry (H3 under `## Statement Manifest`)
- **Heading:** `### statement:<id> {#id}`
- **Required:** `Speaker`, `Content`
- **Optional:** the shared case-record provenance fields documented below.
- **Body:**
  - `#### On Acquire` (required) — dialogue that plays when this statement is first added to the log.
  - `#### On Reexamine` (optional) — dialogue that plays when the player re-reads it from the log.

### 案件紀錄來源與承接（Evidence / Statement 共用）

Evidence 與 Statement 可在既有必填欄位之後加入以下九個 optional
metadata keys。Parser-facing key 與 enum value 必須保持以下英文拼法；只有
`Source Label` 等玩家會看到的顯示文字使用繁體中文。

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

`Representation Layer: none` 同時表示「沒有有意義的 representation
layer」及 omitted neutral default；系統不保留「曾明寫 `none`」的 presence
bit。若玩法要求具體 layer，必須要求 `raw`、`sync`、`summary` 或
`composite`，不能靠 `none` 判斷作者是否填過欄位。

`Proof Capabilities` 是正向能力集合，只表示這筆紀錄能滿足哪些 authored
requirements。缺少 capability 代表不能用它滿足該 requirement，但不證明
相反命題。可用值的 canonical order 為：

```text
time, order, route, identity, access, motive, source, credibility, procedure, causation
```

寫成 `[]` 代表沒有能力；非空時必須用方括號，例如
`[time, source, procedure]`。同一 capability 重複出現是錯誤，不可期待
compiler 幫忙去重；依 canonical order 書寫，方便 review。

`Source Group` 是獨立來源計數的唯一 identity。相同顯示文字、紀錄種類、
場景、取得位置或 supersession 都不會自動建立同一來源。群組 identity 與
`Summary` 只在全域 `story_catalog.md` 最後的 `## Source Groups` 宣告一次；
每筆紀錄的 `Source Group` 只引用 heading anchor 的 group ID，compiler
再從所有紀錄反向推導 typed membership。Heading 使用
`### Source Group: <繁體中文顯示 label> {#<english_slug>}`；record 引用
`english_slug`，不是顯示 label。群組段只寫 `Summary`：

`story_catalog.md`：

```markdown
## Source Groups

### Source Group: 門禁終端原始匯出 {#access_terminal_export}

- **Summary:** 同一門禁終端原始事件匯出所衍生的紀錄。
```

`## Source Groups` block 只屬於全域 `story_catalog.md`，不放進
`investigation_scene_<N>.md`。Scene file 只在 Evidence / Statement entry
寫 `Source Group: access_terminal_export` 這類 group-ID reference。

未填 `Source Group` 會輸出 `null`，表示來源獨立性未知；不可把它當成一個
自成一組的獨立來源。`Source Label` 只供顯示，不取代 catalog group label，
也不建立來源 identity。

`Supersedes` 由較新的 immutable record 指向同種類的 immediate
predecessor：evidence 只能指向 evidence，statement 只能指向 statement。
每筆紀錄最多一個 predecessor，也最多被一個 successor 承接，因此鏈不可
分叉；舊紀錄不會被改寫或刪除。Source grouping 與 supersession 是兩個
不同維度：同一條 chain 不會自動變成同一來源，反之亦然。

程序狀態只可維持或往前：

```text
unspecified < lead < reacquired < exhibit
```

只要寫了 `Supersedes`，就應同時明寫 `Procedural Status`。若 successor
省略它，就會套用 `unspecified`；當 predecessor 已是 `lead`、
`reacquired` 或 `exhibit` 時，這會正確地被判定為程序倒退。

Metadata 是 closed、duplicate-safe contract：只可使用本 skill 列出的
Evidence/Statement keys；同一 key 重複出現會在第二次出現的位置報錯，
present-but-blank 的 provenance value 也無效。不要把來源或能力藏在
`Details` / `Content` 後期待 compiler 推斷。

以下是 `investigation_scene_<N>.md` 內同一底層來源的 lead 與經重新取得
核實之 successor；兩筆紀錄仍保留各自 immutable identity。搭配上方另存於
`story_catalog.md` 的 group declaration 使用：

```markdown
### evidence:access_log_lead {#access_log_lead}
- **Name:** 初步門禁紀錄
- **Description:** 從管理室終端機匯出的初步紀錄。
- **Details:** 保留事件時間，但尚未完成程序覆核。
- **Source Sublocation:** admin_office
- **Source Kind:** digital
- **Representation Layer:** raw
- **Procedural Status:** lead
- **Completeness:** partial
- **Confidence:** unverified
- **Source Group:** access_terminal_export
- **Source Label:** 門禁終端初步匯出
- **Proof Capabilities:** [time, source]

#### On Collect

**相馬律**：先保留原始匯出。

### evidence:access_log_verified {#access_log_verified}
- **Name:** 經核實門禁紀錄
- **Description:** 從同一終端重新取得並完成覆核的紀錄。
- **Details:** 保留完整時間及程序資料。
- **Source Sublocation:** admin_office
- **Source Kind:** digital
- **Representation Layer:** raw
- **Procedural Status:** reacquired
- **Completeness:** complete
- **Confidence:** corroborated
- **Source Group:** access_terminal_export
- **Source Label:** 經核實門禁終端匯出
- **Proof Capabilities:** [time, source, procedure]
- **Supersedes:** evidence:access_log_lead

#### On Collect

**相馬律**：這是同一來源重新取得的完整版本。
```

### Intro (H2)
- **Heading:** `## Intro`.
- **Metadata:** none on the `## Intro` heading itself.
- **Scene-tag asset metadata:** when assets are enabled, any `[場景：...]`
  tag inside the Intro may be followed immediately by `Background Prompt`
  plus optional `BGM` / `BGS`, using the same visual metadata rules as
  sub-locations. This attaches a backdrop to the intro moment without creating
  a sub-location.
- **Body:** linear dialogue. Plays on scene load.

### Outro (H2)
- **Heading:** `## Outro`.
- **Optional metadata:** `**Unlock:** <expression>` — a boolean expression (same grammar as the per-block `Unlock:`) that gates when the Outro becomes playable.
  - When omitted, the Outro defaults to **auto-completion**: it plays when every unlocked hotspot has been inspected and every unlocked topic has been discussed in the scene.
  - When present, the Outro plays the moment the expression evaluates true.
- **Body:** linear dialogue. When the Outro queue empties, the engine advances to the next scene in the chapter manifest.

## Reveal / unlock syntax

All reveals are automatic chains — there is no manual "present evidence" action in investigation scenes (that's interrogation-scene territory).

### Reveal (`Reveals:`) — declared on the source

A list of things this trigger collects/unlocks when the block completes (hotspot inspected, topic discussed, sub-location entered). A reveal list may also carry the **special** `practice:<id>` context marker, which binds an authored-static tutorial card to the immediately following Analysis scene instead of collecting or unlocking anything (see "Practice context markers" below).

```
Reveals: [evidence:cooling_coffee, statement:hayasaka_says_alive, topic:hayasaka@victim_background, hotspot:back_alley, sublocation:storeroom]
```

| Target form | Effect |
|---|---|
| `evidence:<id>` | Adds to inventory; triggers its `#### On Collect` dialogue. |
| `statement:<id>` | Adds to statement log; triggers its `#### On Acquire` dialogue. |
| `topic:<character-id>@<topic-id>` | Unlocks a previously locked topic on that character. Silent unlock. |
| `hotspot:<id>` | Unlocks a previously locked hotspot in the same scene. Silent. |
| `sublocation:<id>` | Unlocks a previously locked sub-location. Silent. |
| `practice:<id>` | **Special:** binds an authored-static tutorial card to the immediately following Analysis scene. No inventory/StoryState effect, no `#### On Collect` / `#### On Acquire` dialogue. |

**ID matching rule (strict):** the `<id>` in every target form must be the **exact anchor ID** declared on the target's heading via `{#id}`. If a Character heading is `### Character: 目擊者 田中誠 {#witness_tanaka}`, the reveal target form is `topic:witness_tanaka@<topic-id>` — never an abbreviation like `topic:witness@...`. The parser does string-match, not fuzzy-match.

### Practice context markers (special)

`practice:<id>` is a **special** reveal target, distinct from the five ordinary
same-file targets above. It does not collect or unlock anything: the card is
authored-static on the immediately following Analysis scene, so the marker only
declares compile-time context binding. It has no inventory or StoryState
effect, and no `#### On Collect` / `#### On Acquire` block fires.

The compiler guarantees the tutorial interaction is mandatory before the
predecessor Investigation's auto outro. A Practice marker is guaranteed only
when all of these hold:

- the predecessor Investigation's `## Outro` is **auto** (no `**Unlock:**`
  expression) — expression-gated outros may exit before unrelated unlocked
  interactions are completed;
- the marker sits on an **initially-unlocked** Hotspot or Topic (`Status:
  unlocked`);
- that carrier's parent Sub-location is **initially unlocked**.

A `practice:` marker on Sub-location entry (`Reveals:` on the
`## Sub-location:` block) is **not supported** by this contract: auto outro
never independently requires sublocation entry. Markers on locked carriers are
likewise rejected with `practiceRevealContextNotGuaranteed`. The five ordinary
targets' semantics (Evidence/Statement/topic/hotspot/sublocation) are
unchanged by this special marker.

### Unlock Condition (`Unlock:`) — declared on the locked target

Only on blocks with `Status: locked`. A boolean expression that, when satisfied, flips the target to unlocked.

**Scene-local atomic predicates:**
- `evidence:<id> collected`
- `statement:<id> acquired`
- `topic:<character-id>@<topic-id> discussed`
- `hotspot:<id> investigated`

HPA-257 also accepts the shared global story predicates documented below. They
are not local substitutes: `question:<id> resolved`, for example, is global
catalog progress, whereas this scene family has no local `question answered`
predicate.

**Positive combinators (use sparingly — long unlock chains usually mean a pacing problem):**
- `<a> and <b>` — both required
- `<a> or <b>` — either suffices
- `at_least(<positive-count>, <condition>, ...)` — enough child conditions
  must hold; children may themselves be grouped or nested `at_least`
  expressions.

### Interaction: `Reveals` and `Unlock` are mutually exclusive per chain

For any locked target, pick **one** path to unlock it. Never both.

- Use `Reveals` on the source when the unlock is a 1:1 single-trigger reveal (most evidence collection, most topic unlocks).
- Use `Unlock` on the target when the unlock depends on multiple preconditions across different triggers (e.g. "after inspecting X *and* discussing Y").

Declaring both an inbound `Reveals` *and* an `Unlock` for the same target is an author error (parser warning).

### Play order when one trigger reveals multiple things

When the player completes a trigger that has a `Reveals:` list, dialogue plays in this fixed order:

1. The trigger block's own body dialogue (the Hotspot's inspect text, the Topic's response).
2. Each `Reveals` target's reveal dialogue in list order:
   - `evidence:<id>` → its `#### On Collect` block
   - `statement:<id>` → its `#### On Acquire` block
   - `practice:<id>` → silent (compile-time context binding only; the card is authored-static on the following Analysis scene)
   - `topic:` / `hotspot:` / `sublocation:` → silent (the unlocked block's body plays only when the player engages it directly)

For a Hotspot with multiple evidence reveals, the editor and runtime both treat
that `Reveals` list as the evidence-to-hotspot correlation. Keep the order
intentional; it controls the sequence of collection dialogue.

## HPA-257 global story progression

This is the canonical shared contract for investigation and interrogation
authoring. It extends only `Unlock:` / `Reveals:` on those two scene families;
linear scenes do not gain this metadata and there is no enable flag. Keep the
existing scene-local forms above in their own family — HPA-257 does not turn
local IDs into cross-scene references.

### Positive expression grammar

`Unlock:` (and interrogation `Complete:`) accepts positive expressions using
`and`, `or`, parentheses, and nested `at_least`:

```text
at_least(2,fact:timeline asserted,(question:who_entered resolved or objective:check_alibi completed))
```

Whitespace is optional around commas and parentheses, so both
`at_least(1,fact:timeline asserted)` and
`at_least(2, fact:timeline asserted, fact:camera asserted)` are valid. The
count must be a positive base-10 integer, cannot exceed the number of child
conditions, and the child expressions cannot contain structural duplicates.
Use only positive progress; `not ...`, `objective:<id> incomplete`,
`authorization:<id> missing`, `active_primary_objective:<id>`, and
`objective:<id> revealed` are not authoring predicates.

The exact shared story predicates are:

```text
fact:<id> asserted
question:<id> resolved
objective:<id> completed
authorization:<id> granted
analysis_scene:<chapter_id>@<scene_id> completed
analysis_board:<chapter_id>@<scene_id>@<board_id> completed
```

`question:<id> resolved` is global story state, not an interrogation-local
`question:<id> answered` predicate. Analysis references always need all shown
slug segments; a bare scene or board ID is invalid. Qualified Analysis
predicates may reference any packaged Analysis board supported by the current
`writing-analysis-scene`/runtime contract whose full scene/board id resolves in
the compiled story catalog. Use these runtime-valid references, for example:

```text
analysis_scene:chapter_1@analysis_scene_p1_5 completed
analysis_board:chapter_1@analysis_scene_p1_5@p1_reprint_time_board completed
```

Do not use unresolved or placeholder analysis ids.

### Story targets in `Reveals:`

Alongside the existing local targets, both scene families recognize these exact
story-target spellings:

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

`grant_authorization:<authorization_id>` is **syntax-only** for current
investigation/interrogation content. Every such production reveal batch has
`representedAuthority: null`, so HPA-257 rejects it with
`authorizationGrantOutsideAuthorityEvent` at compilation/startup validation.
Do not put it in a production scene list. The only exceptions are a synthetic
fixture with matching represented authority or a future HPA-264 authority-event
adapter.

All typed IDs must resolve in `story_catalog.md`. `resolve_question` always
names its resolver fact explicitly: the fact must exist, be asserted before
that target runs (or appear earlier in the same ordered list), and be listed in
the Question's `Resolved By: [fact:<id>, ...]` catalog field. The compiler does
not infer a resolver from nearby evidence or dialogue.

`complete_objective:<id>` is direct completion for **secondary** objectives
only. A primary transition uses `set_primary_objective:` and the existing
primary-transition rules; a non-null target must be a primary objective.
`null` is a special value only in `set_primary_objective:null`, where it clears
the active primary. It is not a valid Objective ID — a catalog heading `{#null}`
is rejected — and it is never a generic placeholder.

### Ordered, atomic, one-shot behavior

Treat every `Reveals:` list as an **ordered atomic transaction**, not a set.
Mixed local and story targets keep their authored order, and an earlier target
may satisfy a later target's prerequisite:

```text
[assert_fact:timeline, resolve_question:who_entered@timeline]  # valid
[resolve_question:who_entered@timeline, assert_fact:timeline]  # invalid unless timeline was already asserted
```

If a later target fails, the whole trigger rolls back: earlier inventory,
local, dialogue, fact, objective, and authorization effects do not commit.
Unlock conditions are reconsidered only after the complete list commits.
Do not duplicate a story target, resolve one question with conflicting facts,
or place more than one `set_primary_objective:` target in one list.

The owning gameplay trigger is durable and one-shot. Once its first committed
entry, inspection, discussion, phase event, auto-break, or correct breakthrough
has fired its list, re-entry, re-examination, repeated answer, or repeated
command delivery never dispatches that list again. Do not design progress around
replaying a prior reveal event.

### Reachability, cycle, and order policy

HPA-257 rejects every **positive dependency** self-cycle or multi-node cycle,
even when an external seed appears reachable. That includes cycles hidden in an
`or` or nested `at_least`; write a real seed and forward progression instead.
Free-order exploration choices are not themselves positive cycles, but an
order-sensitive story batch or primary transition can produce an ordering
warning. Make a prerequisite explicit or linearize the branch when its outcome
must be deterministic.

New HPA-257 mandatory content that cannot be reached is an error; optional
content warns when unreachable. Optionality never excuses unknown references,
an invalid atomic batch, or an order-sensitive primary transition. Legacy-only
content keeps its existing diagnostics until it opts into an HPA-257
predicate/target.

Do not author authorization:<id> granted as a production unlock gate in HPA-257/HPA-259 content. No production authority event can grant it until HPA-264; mandatory use fails compilation and optional use warns.

## Sub-location semantics

- **Entry point:** the first `## Sub-location:` block declared in the file is where the player starts. Its `Status` *must* be `unlocked`.
- **Persistence:** once unlocked, a sub-location stays unlocked for the rest of the scene. Backtracking is allowed.
- **Scene tag:** every sub-location must have its own `[場景：...]` tag immediately after the metadata. Different physical space → different AI image prompt.
- **Asset metadata:** `[場景：...]`, `Background Prompt`, and `Image Prompt` are semantic production prompts, not filesystem paths. Writers never author paths.
- **Sibling visual continuity:** sibling sub-locations can vary in angle/focus but preserve adjacency, hotspot readability, visible floor/standee clearance, and case props. Apply the base dialogue skill's purposeful-background rules rather than inventing local cast or expression guidance.
- **Transition dialogue:** the body of a sub-location block (between metadata and the first nested H3) plays once on first entry.
- **First-entry reveals:** `Reveals:` on a sub-location triggers when the player first enters it — useful for environmental discoveries not tied to a specific hotspot.
- **Character placement:** characters belong to exactly one sub-location. If the same person needs to be in two physical areas, declare them once per sub-location with topics appropriate to that location. Duplication is accepted; it keeps "who is here right now" trivially answerable.

## ID namespace rules

- **Evidence and statement IDs are game-global.** A single ID like `evidence:blue_umbrella` may be declared in only one scene file across the entire game (one chapter, one investigation scene). Compile-time duplicate declarations are an error.
- **Hotspot, topic, and sub-location IDs are scene-local.** They may repeat across different scene files freely. Cross-scene references to these kinds are not supported.
- **Scene-local `Reveals:` targets must resolve to a declaration in the *same scene file*** — this applies to the five local kinds (`evidence:`, `statement:`, `topic:`, `hotspot:`, `sublocation:`). A local reveal newly adds an item or unlocks a block, so its definition must be present in this scene's JSON output. The special `practice:` marker is the exception: it binds to a card on the immediately following Analysis scene, not to a declaration in this file. HPA-257 story targets instead resolve through `story_catalog.md` as documented above.
- **Scene-local `Unlock:` predicates must resolve to a declaration in the same scene file** in v1. HPA-257 global story predicates resolve through the story catalog rather than crossing into another scene's local IDs; fully qualified analysis predicates are production-supported when their catalog references resolve. Unresolved/placeholder analysis IDs fail catalog validation.

## Parser validation guarantees

The parser/validator checks the following — author with them in mind:

- Every scene-local `Reveals:` target resolves to a declared ID in the same file; every HPA-257 story target resolves to its typed story-catalog definition.
- Every scene-local `Unlock:` predicate references a declared ID in the same file; every HPA-257 story predicate resolves through its typed catalog contract.
- Every investigation evidence item declares `Source Sublocation`.
- Every evidence reveal happens from the evidence item's declared source sub-location.
- No positive dependency self-cycle or multi-node cycle, including one hidden
  inside `or` or `at_least`.
- Every block with `Status: locked` is unlockable via at least one path (`Unlock:` on itself **or** inbound `Reveals` from another block).
- The first `## Sub-location:` block in the file is `Status: unlocked`.
- No target has both an inbound `Reveals` and an `Unlock` (warning).
- Every Sub-location has exactly one `[場景：...]` tag in its body.
- Every Evidence Manifest entry has a `#### On Collect` sub-block.
- Every Statement Manifest entry has a `#### On Acquire` sub-block.

## Workflow

When asked to write an `investigation_scene_<N>.md`:

1. **Read the chapter's `_詳細計劃.md`** in full — characters, hotspots planned, clue placement, foreshadow seeds for this Part.
2. **Check `General Plan.md`** for foreshadowing pacing — which seeds belong to this chapter, which must NOT be revealed yet.
3. **Confirm scope with the user** — which Part is this scene, what are the sub-locations, what are the must-cover hotspots/topics/evidence/statements?
4. **Sketch the block list before writing dialogue:**
   - List sub-locations in order, marked locked/unlocked
   - List hotspots per sub-location with their reveal targets
   - List characters per sub-location with their topics
   - List evidence and statements with their IDs
   - Draw the unlock graph mentally — does every locked block have a path?
5. **Write the file in canonical order** (`## Intro` → Sub-locations with their nested H3s → Evidence Manifest → Statement Manifest → `## Outro`).
6. **Self-check before reporting done:**
   - Every dialogue line follows the base dialogue skill's format (≤100 chars, bracketed actions, etc.)
   - Every locked block has either an `Unlock` or an inbound `Reveals`
   - First sub-location is `Status: unlocked`
   - Every sub-location has a `[場景：...]` tag
   - Sibling sub-location views preserve adjacency, hotspot readability, visible floor/standee clearance, and case props while varying angle/focus only when useful
   - All `Reveals` and `Unlock` references resolve

## Common mistakes

| Mistake | Fix |
|---|---|
| Hotspots written at H2 (sibling of Sub-location) instead of H3 inside | Move inside the relevant Sub-location block |
| Topic dialogue written as separate H3 outside its Character | Nest Topic blocks as H4 under their Character (H3) |
| Sub-location missing its own `[場景：...]` tag | Add one — every physical area needs its own image prompt |
| Locked block with neither `Unlock` nor inbound `Reveals` | Add a path; otherwise it's permanently locked |
| Locked block with BOTH `Unlock` and inbound `Reveals` | Pick one; remove the other |
| First sub-location declared as `Status: locked` | Set to `unlocked` — the player must be able to enter |
| Evidence Manifest entry without `#### On Collect` | Add it; even one short line is required |
| Evidence Manifest entry without `Source Sublocation` | Add the exact sub-location ID where the evidence is discovered |
| Evidence revealed from a different sub-location than its `Source Sublocation` | Move the reveal to a local trigger or change the evidence source to the actual local sub-location |
| Hotspot names an exact document that is not visible in the background | Use a broader local trigger and mark the evidence `hidden`/`implied`, or make it derived from visible geometry/object placement |
| Manifest entries placed inline under their producing hotspot/topic | Move to the dedicated `## Evidence Manifest` / `## Statement Manifest` sections near the file bottom |
| Inline dialogue describes "present this evidence to the witness" | That belongs in the separate `interrogation_scene_<N>.md` format covered by `writing-interrogation-scene`; investigation scenes only collect, not confront |
| Dialogue line >100 Chinese characters | Split per the base dialogue skill |
| Action/expression written into a dialogue line | Move to a `[ ]` bracket on its own line |
| Field labels written in Chinese (e.g. `**狀態：**`) | Use English labels (`**Status:**`); only field *values* are Chinese |

## Worked example

A reduced fragment exercising every block type in canonical order. Use as a structural reference, not a content template.

```markdown
# Scene 1: 第一次現場調查 — 雨鐘咖啡館

## Intro

[相馬律與早坂茜跨過警戒線。]

**早坂茜**：黑瀨刑警在裡面。

## Sub-location: 咖啡館主廳 {#main_floor}
- **Status:** unlocked

[場景：吉祥寺雨鐘咖啡館主廳，深夜，雨夜，燈光昏黃，吧台上一個黃銅桌鈴。]

[黑瀨刑警站在吧台旁，神情疲憊。]

### Hotspot: 黃銅桌鈴 {#counter_bell}
- **Description:** 吧台上一個黃銅製桌鈴，看起來最近被用過。
- **Evidence Source:** visible
- **Scene Source Prompt:** Warm cafe coffee machine and brass counter bell as visible local source objects, no readable UI text.
- **Reveals:** [evidence:cooling_coffee, topic:hayasaka@victim_background]

[相馬律按了一下桌鈴，又把手背貼在咖啡機側面。]

**相馬律**：還是熱的。

### Character: 早坂茜 {#hayasaka}
- **Role:** 律師
- **Bio:** 男主角的合作搭檔，重視人證。

#### Topic: 案發時間 {#timeline}
- **Status:** unlocked
- **Reveals:** [statement:hayasaka_says_alive]

**早坂茜**：若槻蓮堅持，他離開時那個人還活著。

#### Topic: 死者背景 {#victim_background}
- **Status:** locked

**早坂茜**：增田圭是 KAGAMI 的資料審查員。

## Sub-location: 倉庫 {#storeroom}
- **Status:** locked
- **Unlock:** hotspot:counter_bell investigated and topic:hayasaka@timeline discussed
- **Reveals:** [evidence:wet_floor_marks]

[場景：倉庫，更冷，空氣中有金屬味，左側舊木門半掩。]

[兩人推開那扇舊門，相馬律抬手讓早坂先進。]

**相馬律**：這裡更冷。

### Hotspot: 滾輪貨架 {#wheeled_shelf}
- **Description:** 一座滾輪貨架，半遮住左側舊門。
- **Evidence Source:** visible
- **Scene Source Prompt:** Wheeled storage shelf with fresh floor scuff marks as the visible local source object.
- **Reveals:** [evidence:shelf_recently_moved]

[相馬律推了一下貨架，輪子順滑地滾動。]

**相馬律**：剛被推過。

#### On Reexamine

[相馬律又推了一下貨架。]

**相馬律**：輪子很順。已經被推過至少一次。

## Evidence Manifest

### evidence:cooling_coffee {#cooling_coffee}
- **Name:** 還溫的咖啡機
- **Description:** 一台仍微熱的咖啡機。
- **Details:** 機身溫度顯示在過去 15 分鐘內被使用過。
- **Source Sublocation:** main_floor

#### On Collect

**相馬律**：還是熱的。

**早坂茜**：表示有人剛沖過咖啡？

#### On Reexamine

[相馬律從口袋取出記事本。]

**相馬律**：21:14。死者死亡時間。咖啡機餘溫不對。

### evidence:wet_floor_marks {#wet_floor_marks}
- **Name:** 半濕的地板水痕
- **Description:** 倉庫地板上一灘剛擦過、仍微濕的水痕。
- **Details:** 水痕邊緣與一般雨水滲入的形狀不一致。
- **Source Sublocation:** storeroom

#### On Collect

[相馬律蹲下，用指尖碰了一下地面。]

**相馬律**：剛被擦過。

### evidence:shelf_recently_moved {#shelf_recently_moved}
- **Name:** 剛被推動過的貨架
- **Description:** 滾輪貨架的輪痕在地上留下半圓形刮痕。
- **Details:** 刮痕方向顯示貨架最近被往左推開了大約四十公分。
- **Source Sublocation:** storeroom

#### On Collect

**相馬律**：剛被推過。

## Statement Manifest

### statement:hayasaka_says_alive {#hayasaka_says_alive}
- **Speaker:** 早坂茜
- **Content:** 「若槻蓮堅持，他離開時那個人還活著。」

#### On Acquire

[早坂茜的語氣比之前更慎重。]

**早坂茜**：他不像是在撒謊。

## Outro
- **Unlock:** hotspot:wheeled_shelf investigated and statement:hayasaka_says_alive acquired

[相馬律站在倉庫門口回頭看了一眼。]

**相馬律**：走吧。
```

**Note on locked blocks:** locked sub-locations, hotspots, and topics are entirely hidden from the player until their unlock condition is satisfied. There is no "locked, look later" hint shown in-game. The `Unlock:` expression is parser-internal — it determines *when* the block becomes visible, never displayed.

## Related scene type

Confrontation (presenting evidence to characters / statements), deduction slot filling, and testimony cross-examination are **not** part of investigation scenes. They belong to the separate authored and compiler-validated `interrogation_scene_<N>.md` file format covered by `writing-interrogation-scene`.
