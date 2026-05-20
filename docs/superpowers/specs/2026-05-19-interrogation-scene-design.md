# Interrogation Scene Design

**Date:** 2026-05-19
**Status:** Approved design; implementation plan to follow
**Related specs:** [`2026-05-13-scene-pipeline-design.md`](./2026-05-13-scene-pipeline-design.md), [`2026-05-13-investigation-scene-skill-design.md`](./2026-05-13-investigation-scene-skill-design.md)

## Goal

Add a third authored scene type, `interrogation_scene_<K>.md`, for suspect questioning and Ace Attorney-style cross-examination in the Lyra scene pipeline.

An interrogation scene must support both of these in one file:

1. **Inquiry:** the player asks a suspect questions and can obtain evidence, statements, follow-up questions, or later phases from the answers.
2. **Testimony:** the player reviews testimony lines, presses for detail, and presents evidence or statements to break a contradiction.

The design follows the existing pipeline: writers author markdown under `static/stories_plan/`, Bun compiles that markdown into typed JSON under `src-tauri/resources/scenes/`, Rust owns the authoritative scene state, and Svelte renders the current mode. No markdown parsing reaches the frontend or Rust runtime.

## Scope

### In scope

- A phase-based `interrogation_scene_<K>.md` schema.
- Two phase kinds in v1: `inquiry` and `testimony`.
- Shared evidence and statement manifests, reusing the investigation scene inventory model.
- Interrogation-local reveal targets for questions and phases.
- Cross-scene inventory predicates for evidence and statements, with compile-time soft-lock protection.
- Runtime commands for answering questions, pressing testimony, and presenting inventory items.
- A future `writing-interrogation-scene` skill that inherits the base dialogue rules.

### Out of scope

- Courtroom-specific UI beyond testimony interaction.
- Health bars, penalties, scoring, confidence meters, or fail states.
- Free-form node graphs or arbitrary jumps between phases.
- Multiple simultaneous suspects in a single phase.
- Deduction slot filling. This can become a later third phase kind if needed.
- Save/load persistence beyond the current in-memory game engine.

## Authoring Model

### File identity

`interrogation_scene_<K>.md` is a playable scene file listed in `chapter_<N>/chapter.md`.

The filename participates in the same chapter scene order as existing files:

```markdown
## Scenes
1. scene_0.md
2. investigation_scene_1.md
3. interrogation_scene_2.md
4. investigation_scene_3.md
```

The compiler currently treats this prefix as reserved and skipped. Implementing this design turns it into a real emitted scene type.

### Canonical file order

```markdown
# Scene 2: 第一次詢問與交叉詢問

## Intro

## Phase: 若槻蓮初步詢問 {#wakatsuki_inquiry}
- **Kind:** inquiry

## Phase: 若槻蓮的行動證詞 {#wakatsuki_testimony}
- **Kind:** testimony

## Evidence Manifest

## Statement Manifest

## Outro
```

Allowed H2 blocks:

| H2 block | Purpose |
| --- | --- |
| `## Intro` | Linear dialogue before the first phase. |
| `## Phase: <label> {#id}` | One ordered interrogation phase. |
| `## Evidence Manifest` | New evidence this scene can reveal. |
| `## Statement Manifest` | New statements this scene can reveal. |
| `## Outro` | Linear dialogue after required phases complete. |

Every phase has exactly one `[場景：...]` tag immediately after phase metadata. Any phase body dialogue between the scene tag and the first nested H3 is `entryDialogue` and plays when the phase begins.

## Shared Rules

### Language

The same language split from `writing-investigation-scene` applies:

- Player-facing content is Traditional Chinese: dialogue, scene tags, action brackets, names, descriptions, details, testimony content, and result dialogue.
- Parser-facing structure is English: heading labels, metadata field labels, reserved values, reveal target prefixes, and unlock predicates.

Dialogue lines still follow `writing-detective-game-dialogue`: `**角色名**：內容`, one line per beat, bracketed actions outside dialogue, and no long prose paragraphs.

### Subject

Each phase declares one subject as its first H3 block:

```markdown
### Subject: 若槻蓮 {#wakatsuki_ren}
- **Role:** 第一嫌疑人
- **Bio:** 雨鐘咖啡館兼職店員，被 KAGAMI 門鎖紀錄指向案發現場。
```

Subject IDs are scene-local. If the same subject appears in more than one phase, repeat the subject block in each phase. The validator accepts repeated subject IDs across phases only when the displayed name, role, and bio match exactly. This keeps phases self-contained while preventing accidental subject drift.

### Phase fields

All phases share these fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `Kind` | yes | `inquiry` or `testimony`. |
| `Required` | no | Defaults to `true`. Required phases count toward `Outro` auto-completion. |
| `Status` | no | Defaults to `unlocked`; may be `locked`. |
| `Unlock` | if locked and no inbound reveal | Boolean unlock expression. |
| `Reveals` | no | Things unlocked or collected when the phase is first entered. |

Phase progression is source-ordered. The engine presents the earliest unlocked incomplete required phase. Optional phases can be exposed as selectable side phases later, but v1 should keep authored scenes simple and use `Required: true` unless there is a concrete UI plan for skipping optional material.

## Inquiry Phase

An `inquiry` phase is suspect Q&A. The player chooses questions, hears answers, and can gain evidence, statements, follow-ups, or future phases.

```markdown
## Phase: 若槻蓮初步詢問 {#wakatsuki_inquiry}
- **Kind:** inquiry
- **Required:** true

[場景：警視廳臨時詢問室，深夜，白色日光燈刺眼。若槻蓮坐在桌對面，雙手握緊紙杯。]

### Subject: 若槻蓮 {#wakatsuki_ren}
- **Role:** 第一嫌疑人
- **Bio:** 雨鐘咖啡館兼職店員，被 KAGAMI 門鎖紀錄指向案發現場。

### Question: 進倉庫的理由 {#entered_storage}
- **Status:** unlocked
- **Required:** true
- **Reveals:** [statement:wakatsuki_entered_for_beans]

**相馬律**：你為什麼進倉庫？

**若槻蓮**：我只是去拿咖啡豆。

### Question: 和死者爭吵 {#argument}
- **Status:** unlocked
- **Required:** true
- **Reveals:** [question:hidden_discarded_beans]

**相馬律**：你和增田先生吵過？

**若槻蓮**：他以為我偷資料。

#### Follow-up: 報廢咖啡豆 {#hidden_discarded_beans}
- **Status:** locked
- **Required:** true
- **Reveals:** [evidence:discarded_beans_note]

**相馬律**：你真正隱瞞的是咖啡豆，對吧？

**若槻蓮**：我只是拿了要丟掉的豆子。
```

### Inquiry headings

| Heading | Level | Meaning |
| --- | --- | --- |
| `### Subject: ... {#id}` | H3 | The suspect/person being questioned. |
| `### Question: ... {#id}` | H3 | A selectable question. |
| `#### Follow-up: ... {#id}` | H4 | A selectable question unlocked from another answer. |
| `#### On Reask` | H4 under Question | Dialogue for answered questions. |
| `##### On Reask` | H5 under Follow-up | Dialogue for answered follow-ups. |

Question and follow-up fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `Status` | no | Defaults to `unlocked`; may be `locked`. |
| `Required` | no | Defaults to `true`; required questions count toward inquiry auto-completion. |
| `Unlock` | if locked and no inbound reveal | Boolean unlock expression. |
| `Reveals` | no | Evidence, statements, questions, or phases revealed when first answered. |

An inquiry phase completes when every reachable required question and follow-up in that phase has been answered, unless the phase defines an explicit `Complete` expression.

Optional phase field:

```markdown
- **Complete:** question:entered_storage answered and evidence:discarded_beans_note collected
```

When `Complete` is omitted, the compiler emits `"auto"` for that phase.

## Testimony Phase

A `testimony` phase is the cross-examination loop. The suspect gives a numbered statement list. The player can press any line and present inventory items on a line.

```markdown
## Phase: 若槻蓮的行動證詞 {#wakatsuki_action_testimony}
- **Kind:** testimony
- **Required:** true
- **Unlock:** statement:wakatsuki_entered_for_beans acquired

[場景：警視廳臨時證據審查室，深夜。投影幕顯示 KAGAMI 門鎖時間線。]

### Subject: 若槻蓮 {#wakatsuki_ren}
- **Role:** 第一嫌疑人
- **Bio:** 雨鐘咖啡館兼職店員，被 KAGAMI 門鎖紀錄指向案發現場。

### Testimony

#### Statement: 進倉庫前 {#before_storage}
- **Content:** 我進倉庫前，咖啡機還沒進入清潔模式。

##### On Press

**相馬律**：你確定是進倉庫前？

**若槻蓮**：我記得很清楚。

#### Statement: 清潔鍵 {#cleaning_button}
- **Content:** 我出來後，立刻按下清潔鍵。
- **Contradiction:** evidence:coffee_machine_cleaning_log
- **On Correct:** breakthrough_cleaning_time
- **On Wrong:** wrong_time_record

##### On Press

**相馬律**：你說「立刻」是幾秒內？

**若槻蓮**：真的很快。我手還濕著。

##### On Present

**相馬律**：這份咖啡機清潔紀錄，和你的話一致。

**神谷澪**：不，和門鎖時間線不一致。

##### On Wrong Present

**神谷澪**：那份資料無法證明他已經離開倉庫。

#### Statement: 店長提醒 {#manager_reminder}
- **Content:** 清潔模式啟動時，店長還叫我別忘了擦吧台。

##### On Press

**若槻蓮**：店長從主廳那邊喊我的。

### Result: breakthrough_cleaning_time {#breakthrough_cleaning_time}
- **Reveals:** [statement:kagami_timeline_inconsistent]

**相馬律**：若槻不可能同時在倉庫裡，又按下吧台咖啡機。

### Result: wrong_time_record {#wrong_time_record}

**相馬律**：這能推翻門鎖紀錄嗎？

**早坂茜**：還不夠。這只能說明別的事情。
```

### Testimony headings

| Heading | Level | Meaning |
| --- | --- | --- |
| `### Subject: ... {#id}` | H3 | The witness or suspect giving testimony. |
| `### Testimony` | H3 | Container for testimony lines. |
| `#### Statement: ... {#id}` | H4 | One testimony line. |
| `##### On Press` | H5 | Dialogue played when the player presses the line. |
| `##### On Present` | H5 | Dialogue played before the correct result. |
| `##### On Wrong Present` | H5 | Dialogue played before the wrong result. |
| `### Result: ... {#id}` | H3 | Named result dialogue reached by `On Correct` or `On Wrong`. |

Testimony statement fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `Content` | yes | The line shown in the testimony list. |
| `Contradiction` | no | One inventory target: `evidence:<id>` or `statement:<id>`. |
| `On Correct` | if `Contradiction` exists | Result block ID reached by presenting the correct target. |
| `On Wrong` | no | Result block ID reached by presenting a wrong item. If absent, engine fallback dialogue plays. |
| `Reveals` | no | Optional reveals after pressing this line for the first time. |

A testimony phase completes when the player presents the correct contradiction and its `On Correct` result finishes. If a testimony phase needs multiple breakthroughs, write multiple testimony phases in source order.

Wrong presentations never complete a testimony phase and never collect reveal targets. They play `On Wrong Present`, then the `On Wrong` result if one is configured, and return to the same testimony phase.

## Reveals And Unlocks

Interrogation scenes reuse the existing reveal syntax for inventory:

```markdown
- **Reveals:** [evidence:coffee_machine_cleaning_log, statement:kagami_timeline_inconsistent]
```

They add two scene-local target kinds:

| Target | Effect |
| --- | --- |
| `question:<id>` | Unlocks a locked question or follow-up in the same interrogation scene. |
| `phase:<id>` | Unlocks a locked phase in the same interrogation scene. |

Interrogation unlock predicates support existing inventory predicates and new scene-local predicates:

```markdown
- **Unlock:** evidence:coffee_machine_cleaning_log collected
- **Unlock:** statement:wakatsuki_entered_for_beans acquired
- **Unlock:** question:hidden_discarded_beans answered
- **Unlock:** phase:wakatsuki_inquiry completed
```

Supported predicates:

| Predicate | Scope |
| --- | --- |
| `evidence:<id> collected` | Game-global inventory, with validation rules below. |
| `statement:<id> acquired` | Game-global inventory, with validation rules below. |
| `question:<id> answered` | Scene-local. |
| `phase:<id> completed` | Scene-local. |

Hotspot, topic, and sub-location predicates remain investigation-only and are not valid inside interrogation scene unlocks.

## Evidence And Statement Manifests

Interrogation scenes use the same manifest entries as investigation scenes.

```markdown
## Evidence Manifest

### evidence:coffee_machine_cleaning_log {#coffee_machine_cleaning_log}
- **Name:** 咖啡機清潔紀錄
- **Description:** 咖啡機自動記錄的清潔模式啟動時間。
- **Details:** 清潔模式啟動時間為 21:13:29。

#### On Collect

**相馬律**：這個時間，和門鎖紀錄不可能同時成立。

#### On Reexamine

**相馬律**：21:13:29。若槻說他已經回到吧台。

## Statement Manifest

### statement:wakatsuki_entered_for_beans {#wakatsuki_entered_for_beans}
- **Speaker:** 若槻蓮
- **Content:** 「我進倉庫只是拿咖啡豆。」

#### On Acquire

**若槻蓮**：我真的只是去拿咖啡豆。
```

Evidence and statement IDs remain game-global across all scene types. The inventory still stores self-contained snapshots, so a clue collected in an investigation scene can be presented later in an interrogation scene.

## Cross-Scene Inventory Rules

Interrogation is the first scene type that needs cross-scene inventory predicates. A testimony contradiction may depend on evidence collected in an earlier investigation scene, and a phase may unlock only when that evidence is already in inventory.

To avoid soft-locks:

1. `Contradiction: evidence:<id>` or `Contradiction: statement:<id>` must resolve to either:
   - an item declared in the same interrogation scene and proven obtainable before the testimony can complete, or
   - an item declared in an earlier playable scene and proven guaranteed by that earlier scene's completion path.
2. Any phase `Unlock` that references cross-scene evidence or statements follows the same guarantee rule.
3. If the compiler cannot prove the item is guaranteed, it must fail with a clear error. The author can fix it by making the previous scene require that item, moving the item into the interrogation scene, or changing the interrogation phase order.
4. Cross-scene references are only valid for evidence and statements. Questions, phases, testimony statements, results, hotspots, topics, and sub-locations are scene-local.

The compiler already has the chapter manifest order, scene order, and global evidence/statement registry. The implementation plan should add the missing guarantee analysis for interrogation predicates instead of allowing best-effort runtime checks.

## JSON Contract

The compile output adds a third scene JSON variant.

```ts
type JSONInterrogationScene = {
  type: "interrogation";
  id: string;
  title: string;
  intro: DialogueItem[];
  phases: InterrogationPhase[];
  evidenceManifest: EvidenceJson[];
  statementManifest: StatementJson[];
  outro: {
    unlock: "auto" | InterrogationUnlockExpr;
    dialogue: DialogueItem[];
  };
};
```

Phase JSON is a tagged union.

```ts
type SubjectJson = {
  id: string;
  name: string;
  role: string;
  bio: string;
};

type InterrogationPhase =
  | {
      kind: "inquiry";
      id: string;
      label: string;
      subject: SubjectJson;
      required: boolean;
      status: "locked" | "unlocked";
      unlock: InterrogationUnlockExpr | null;
      reveals: InterrogationRevealTarget[];
      sceneTag: string;
      entryDialogue: DialogueItem[];
      complete: "auto" | InterrogationUnlockExpr;
      questions: InquiryQuestionJson[];
    }
  | {
      kind: "testimony";
      id: string;
      label: string;
      subject: SubjectJson;
      required: boolean;
      status: "locked" | "unlocked";
      unlock: InterrogationUnlockExpr | null;
      reveals: InterrogationRevealTarget[];
      sceneTag: string;
      entryDialogue: DialogueItem[];
      statements: TestimonyStatementJson[];
      results: TestimonyResultJson[];
    };
```

Question JSON:

```ts
type InquiryQuestionJson = {
  id: string;
  label: string;
  kind: "question" | "followUp";
  parentQuestionId: string | null;
  status: "locked" | "unlocked";
  required: boolean;
  unlock: InterrogationUnlockExpr | null;
  reveals: InterrogationRevealTarget[];
  answerDialogue: DialogueItem[];
  onReask: DialogueItem[] | null;
};
```

Testimony JSON:

```ts
type TestimonyStatementJson = {
  id: string;
  label: string;
  content: string;
  contradiction: InventoryTarget | null;
  onCorrect: string | null;
  onWrong: string | null;
  onPress: DialogueItem[] | null;
  onPresent: DialogueItem[] | null;
  onWrongPresent: DialogueItem[] | null;
  reveals: InterrogationRevealTarget[];
};

type TestimonyResultJson = {
  id: string;
  label: string;
  reveals: InterrogationRevealTarget[];
  dialogue: DialogueItem[];
};

type InventoryTarget =
  | { kind: "evidence"; id: string }
  | { kind: "statement"; id: string };
```

Interrogation-specific reveal and unlock atoms:

```ts
type InventoryRevealTarget =
  | { kind: "evidence"; id: string }
  | { kind: "statement"; id: string };

type InterrogationRevealTarget =
  | InventoryRevealTarget
  | { kind: "question"; id: string }
  | { kind: "phase"; id: string };

type InterrogationUnlockExpr =
  | { op: "and" | "or"; left: InterrogationUnlockExpr; right: InterrogationUnlockExpr }
  | { predicate: "evidence_collected"; id: string }
  | { predicate: "statement_acquired"; id: string }
  | { predicate: "question_answered"; id: string }
  | { predicate: "phase_completed"; id: string };
```

The Rust serde structs mirror this JSON with `#[serde(rename_all = "camelCase")]`, matching the existing scene schema contract.

## Runtime Contract

Rust adds:

- `SceneType::Interrogation`
- `SceneJson::Interrogation(InterrogationSceneJson)`
- `SceneRuntime::Interrogation(Box<InterrogationSceneState>)`
- an interrogation state module under `src-tauri/src/game/scenes/interrogation.rs`

`InterrogationSceneState` owns:

- immutable phase definitions,
- `intro_played` and `outro_played`,
- `pending_queue`,
- completed phase IDs,
- answered question IDs,
- pressed testimony statement IDs,
- phase/question unlock overrides from `Reveals`,
- the current phase ID.

The engine adds commands:

```rust
answer_interrogation_question(question_id: String)
press_testimony_statement(statement_id: String)
present_testimony_item(statement_id: String, item_kind: String, item_id: String)
```

All three commands return `Result<GameStateView, GameError>` and follow the existing command conventions:

- reject while dialogue is active,
- reject in the wrong scene mode,
- map locked or unknown IDs to typed `GameError`,
- build dialogue queues with the existing queue token/idempotency model,
- apply reveals through the same inventory snapshot logic used by investigation scenes.

## Frontend Contract

`ModeView` gains a new mode:

```ts
type Mode =
  | { type: "dialogue"; current: DialogueItem; queueRemaining: number; sceneTag: string | null; queueToken: QueueToken }
  | { type: "explore"; sublocationId: string }
  | { type: "interrogation"; phaseId: string }
  | { type: "gameComplete" };
```

`SceneView` gains an `interrogation` variant with visible phase data:

```ts
type SceneView =
  | { kind: "linear"; id: string; title: string; index: number; total: number }
  | { kind: "investigation"; id: string; title: string; index: number; total: number; currentSublocationId: string | null; visibleSublocations: SublocationView[] }
  | {
      kind: "interrogation";
      id: string;
      title: string;
      index: number;
      total: number;
      currentPhaseId: string | null;
      visiblePhases: InterrogationPhaseView[];
    };
```

The frontend renders:

- `DialogueBox` for all intro, phase entry, question answer, press, present, result, and outro queues.
- `InterrogationView` when `mode.type === "interrogation"`.
- `InventoryPanel` during interrogation, because testimony presentation requires access to collected evidence and statements.

Presentation logic stays passive. The frontend asks the engine to answer, press, or present; the engine decides whether the action is valid and returns the next state snapshot.

## Validation

The compiler should reject:

- missing H1 title,
- unknown H2 blocks,
- unknown phase `Kind`,
- phase without exactly one scene tag,
- phase without exactly one `Subject` block,
- duplicate phase IDs in a scene,
- duplicate question/follow-up IDs in a scene,
- duplicate testimony statement IDs in a scene,
- duplicate result IDs within a testimony phase,
- repeated subject ID with different name, role, or bio,
- locked phase/question/follow-up with no `Unlock` and no inbound `Reveals`,
- inbound `Reveals` and self `Unlock` both used for the same locked target,
- `Reveals` targets that do not resolve,
- `Unlock` predicates that do not resolve,
- `Contradiction` targets that do not resolve,
- `On Correct` or `On Wrong` references that do not resolve to a result block in the same testimony phase,
- testimony statement with `Contradiction` but no `On Correct`,
- required inquiry phase with no completable required question path,
- testimony phase with no valid contradiction path,
- `Outro` condition that can never be satisfied,
- cross-scene evidence/statement predicates that are not guaranteed by earlier completion paths.

The compiler should warn, not fail, on:

- dialogue line over the base skill's length target,
- `Required: false` phase before a required phase while no skip/phase-select UI exists,
- testimony line with no `On Press`,
- result block that is never referenced.

Wrong present attempts are always recoverable at runtime. They may produce a typed error only when the requested statement or inventory item does not exist; presenting the wrong existing item is normal gameplay and returns to the same testimony phase.

## Authoring Skill

Create `.claude/skills/writing-interrogation-scene/SKILL.md` when implementation begins.

The skill should:

- require familiarity with `writing-detective-game-dialogue`,
- reuse the evidence and statement manifest rules from `writing-investigation-scene`,
- own only the interrogation wrapper: `Phase`, `Subject`, `Question`, `Follow-up`, `Testimony`, testimony `Statement`, `Result`, `Contradiction`, phase completion, and wrong-present handling,
- require writers to sketch phases before dialogue,
- require every contradiction to name the exact evidence or statement that breaks it,
- remind writers that investigation scenes collect clues automatically, while interrogation scenes require explicit questioning or presentation.

## Implementation Notes

The implementation should follow the existing extension points instead of rewriting the scene pipeline:

1. Add compiler AST and JSON types.
2. Add a parser for `interrogation_scene_<K>.md`.
3. Update orchestrator and emitter so `interrogation_scene_` is no longer skipped.
4. Extend global validation for interrogation-specific reveal, unlock, contradiction, and cross-scene guarantee rules.
5. Mirror JSON structs in Rust schema.
6. Add `InterrogationSceneState` and engine commands.
7. Add frontend types, client commands, and an `InterrogationView`.
8. Add focused fixtures and Rust tests for inquiry completion, testimony correct/wrong present, cross-scene evidence use, and scene advancement.

This should remain one scene type. Do not split inquiry and testimony into separate top-level scene types unless a later design finds a runtime reason stronger than authoring convenience.
