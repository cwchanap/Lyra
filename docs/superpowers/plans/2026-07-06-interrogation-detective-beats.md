# Interrogation Detective Beats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new required testimony-level fields — `Loop Prompt` and `Wrong Reply` — that guarantee a protagonist (detective 相馬律) dialogue beat when an interrogation testimony loops and when the player presents wrong evidence.

**Architecture:** The scene compiler (TypeScript) parses, validates, and emits the two fields; the Rust runtime deserializes them (`#[serde(default)]`) and splices them into the loop queue and the wrong-present queue. The writing skill documents them and Chapter 1 content authors them. The fields are required only on testimonies that have ≥1 `Contradiction` line, mirroring the existing `Challenge`/`On Correct`/`On Wrong Evidence` rule.

**Tech Stack:** TypeScript (Bun/Vitest) compiler under `packages/scripts`; Rust (Tauri) runtime under `apps/game/src-tauri`; authored Markdown under `docs/stories_plan/chapter_1`.

## Global Constraints

- Field markdown labels are English reserved keys: `Loop Prompt`, `Wrong Reply`. JSON/schema keys are camelCase: `loopPrompt`, `wrongReply`.
- Both fields are **required iff the testimony has ≥1 `Contradiction` line**; otherwise optional (may be omitted).
- The emitter emits these dialogue arrays as `[]` (never JSON `null`) — the Rust runtime uses `#[serde(default)] Vec<DialogueItem>`, which tolerates an absent key but not an explicit `null`.
- `Loop Prompt` plays on loop between the suspect's `On Loop` and line 0: `on_loop ++ loop_prompt ++ lines[0].content`.
- `Wrong Reply` plays after the suspect's wrong response on a wrong present: `on_wrong ++ wrong_reply`; the destination (resume the testimony via `return_to_line`) is unchanged.
- Player-facing dialogue is Traditional Chinese; the detective is 相馬律.
- Do NOT hand-edit generated JSON under `apps/game/src-tauri/resources/`; regenerate with `bun run scenes:compile`.
- New compile error codes: `interrogationMissingLoopPrompt`, `interrogationMissingWrongReply`.

---

### Task 1: Compiler — parse, validate, emit `loopPrompt` / `wrongReply`

**Files:**
- Modify: `packages/scripts/compile-scenes/types.ts` (`ASTTestimony` ~273, `JSONTestimony` ~445)
- Modify: `packages/scripts/compile-scenes/parser-interrogation.ts` (`TESTIMONY_FIELDS` ~563, testimony parse/validate ~578-650)
- Modify: `packages/scripts/compile-scenes/emitter.ts` (`emitTestimony` ~179)
- Modify: `packages/scripts/compile-scenes/assets/enrich.ts` (`enrichTestimony` ~246)
- Modify: `packages/scripts/__fixtures__/valid_interrogation/chapter_1/interrogation_scene_1.md` (`entered_storage` testimony)
- Create: `packages/scripts/__fixtures__/invalid/interrogation_missing_loop_prompt/` (chapter.md, scene_0.md, interrogation_scene_1.md, expected-error.txt)
- Create: `packages/scripts/__fixtures__/invalid/interrogation_missing_wrong_reply/` (same four files)
- Test: `packages/scripts/compile-scenes.test.ts` (valid_interrogation assertions ~107-132)

**Interfaces:**
- Consumes: existing `parseDialogueFieldValue`, `fail`, `emitDialogueItems`, `enrichNullableDialogue`.
- Produces: `ASTTestimony.loopPrompt: DialogueItem[] | null`, `ASTTestimony.wrongReply: DialogueItem[] | null`; `JSONTestimony.loopPrompt: JSONDialogueItem[]`, `JSONTestimony.wrongReply: JSONDialogueItem[]`.

- [ ] **Step 1: Add the AST + JSON type fields**

In `packages/scripts/compile-scenes/types.ts`, change `ASTTestimony`:

```ts
export type ASTTestimony = Located<{
  onLoop: DialogueItem[]; // required
  loopPrompt: DialogueItem[] | null; // detective loop beat; required iff a line has a Contradiction
  defaultChallenge: DialogueItem[] | null;
  defaultWrong: DialogueItem[] | null;
  wrongReply: DialogueItem[] | null; // detective wrong-present beat; required iff a line has a Contradiction
  lines: ASTTestimonyLine[]; // >= 1
}>;
```

and change `JSONTestimony`:

```ts
export type JSONTestimony = {
  onLoop: JSONDialogueItem[];
  loopPrompt: JSONDialogueItem[];
  defaultChallenge: JSONDialogueItem[] | null;
  defaultWrong: JSONDialogueItem[] | null;
  wrongReply: JSONDialogueItem[];
  lines: JSONTestimonyLine[];
};
```

- [ ] **Step 2: Parse the fields and enforce the required-iff-contradiction rule**

In `packages/scripts/compile-scenes/parser-interrogation.ts`, extend `TESTIMONY_FIELDS`:

```ts
const TESTIMONY_FIELDS = new Set([
  "On Loop",
  "Loop Prompt",
  "Default Challenge",
  "Default Wrong",
  "Wrong Reply",
]);
```

After the `defaultWrong` block (~608, before `const lines: ASTTestimonyLine[] = [];`), add:

```ts
  let loopPrompt: DialogueItem[] | null = null;
  if (meta.value["Loop Prompt"] !== undefined) {
    const r = parseDialogueFieldValue(
      meta.value["Loop Prompt"],
      cur.sourceFile,
      head.line,
    );
    if (!r.ok) return r;
    loopPrompt = r.value;
  }
  let wrongReply: DialogueItem[] | null = null;
  if (meta.value["Wrong Reply"] !== undefined) {
    const r = parseDialogueFieldValue(
      meta.value["Wrong Reply"],
      cur.sourceFile,
      head.line,
    );
    if (!r.ok) return r;
    wrongReply = r.value;
  }
```

After the `if (lines.length === 0)` guard (~632-638) and before the `return { ok: true, value: {` block, add the required-check:

```ts
  const hasContradiction = lines.some((line) => line.contradiction !== null);
  if (hasContradiction) {
    if (!loopPrompt)
      return fail(
        cur.sourceFile,
        head.line,
        "interrogationMissingLoopPrompt",
        `Question ${questionId}'s #### Testimony has a Contradiction line and requires Loop Prompt dialogue.`,
      );
    if (!wrongReply)
      return fail(
        cur.sourceFile,
        head.line,
        "interrogationMissingWrongReply",
        `Question ${questionId}'s #### Testimony has a Contradiction line and requires Wrong Reply dialogue.`,
      );
  }
```

In the returned `value` object (~642-649), add the two fields:

```ts
  return {
    ok: true,
    value: {
      onLoop: onLoop.value,
      loopPrompt,
      defaultChallenge,
      defaultWrong,
      wrongReply,
      lines,
      sourceFile: cur.sourceFile,
      line: head.line,
    },
  };
```

- [ ] **Step 3: Emit and enrich the fields**

In `packages/scripts/compile-scenes/emitter.ts`, change `emitTestimony` (~179):

```ts
function emitTestimony(ast: ASTTestimony): JSONTestimony {
  return {
    onLoop: emitDialogueItems(ast.onLoop),
    loopPrompt: emitDialogueItems(ast.loopPrompt ?? []),
    defaultChallenge: emitDialogueItems(ast.defaultChallenge ?? []),
    defaultWrong: emitDialogueItems(ast.defaultWrong ?? []),
    wrongReply: emitDialogueItems(ast.wrongReply ?? []),
    lines: ast.lines.map(emitTestimonyLine),
  };
}
```

In `packages/scripts/compile-scenes/assets/enrich.ts`, change `enrichTestimony` (~250-257) to add the two enriched fields (keep the existing ones):

```ts
    onLoop: enrichDialogue(testimony.onLoop, context),
    loopPrompt: enrichNullableDialogue(testimony.loopPrompt, context),
    defaultChallenge: enrichNullableDialogue(
      testimony.defaultChallenge,
      context,
    ),
    defaultWrong: enrichNullableDialogue(testimony.defaultWrong, context),
    wrongReply: enrichNullableDialogue(testimony.wrongReply, context),
```

- [ ] **Step 4: Update the valid_interrogation fixture so its contradiction testimony compiles**

In `packages/scripts/__fixtures__/valid_interrogation/chapter_1/interrogation_scene_1.md`, the `entered_storage` testimony (~25-27) has a `Contradiction` line (`l_cleaning`) and now needs the two fields. Replace its `#### Testimony` header block:

```markdown
#### Testimony

- **On Loop:** **相馬律**：還有哪裡對不上，再說一次。
- **Loop Prompt:** **相馬律**：從頭再聽一次。
- **Wrong Reply:** **相馬律**：不對，這不是關鍵。
```

Leave the `beans_follow_up` testimony (honest, no contradiction) unchanged.

- [ ] **Step 5: Add compiler emission assertions**

In `packages/scripts/compile-scenes.test.ts`, inside the "emits an interrogation scene" test, after the `cleaningLine.onWrongEvidence` assertion (~118) add:

```ts
      expect(enteredStorage.testimony.loopPrompt.length).toBeGreaterThan(0);
      expect(enteredStorage.testimony.wrongReply.length).toBeGreaterThan(0);
      const beansFollowUp = interrogation.phases[0].questions[1];
      expect(beansFollowUp.testimony.loopPrompt).toEqual([]);
      expect(beansFollowUp.testimony.wrongReply).toEqual([]);
```

- [ ] **Step 6: Create the two invalid fixtures**

Create `packages/scripts/__fixtures__/invalid/interrogation_missing_loop_prompt/chapter_1/chapter.md`:

```markdown
# Chapter 1: Missing Loop Prompt

**Summary:** Fixture.

## Scenes
1. scene_0.md
2. interrogation_scene_1.md
```

Create `packages/scripts/__fixtures__/invalid/interrogation_missing_loop_prompt/chapter_1/scene_0.md`:

```markdown
# Scene 0: Opening

**相馬律**：開始。
```

Create `packages/scripts/__fixtures__/invalid/interrogation_missing_loop_prompt/chapter_1/interrogation_scene_1.md` — a contradiction testimony with `Wrong Reply` present but `Loop Prompt` omitted:

```markdown
# Scene 1: Missing Loop Prompt

## Intro

**相馬律**：開始。

## Phase: 詢問 {#phase}

- **Kind:** inquiry
- **Required:** true

### Subject: 嫌疑人 {#suspect}

- **Role:** 店員
- **Bio:** 安靜。

### Question: 問題 {#q}

- **Status:** unlocked

#### Testimony

- **On Loop:** **嫌疑人**：沒別的了。
- **Wrong Reply:** **相馬律**：不對，這不是關鍵。

##### Line: 說法 {#l}

**嫌疑人**：我在店裡。

- **Contradiction:** evidence:log
- **Challenge:** **相馬律**：這對不上。
- **On Correct:** **嫌疑人**：好吧。
- **On Wrong Evidence:** **嫌疑人**：這能證明什麼？

## Evidence Manifest

### evidence:log {#log}

- **Name:** 紀錄
- **Description:** 紀錄。
- **Details:** 紀錄。

#### On Collect

**相馬律**：紀錄。

## Outro

**相馬律**：到這裡。
```

Create `packages/scripts/__fixtures__/invalid/interrogation_missing_loop_prompt/expected-error.txt`:

```
interrogationMissingLoopPrompt
```

Create `packages/scripts/__fixtures__/invalid/interrogation_missing_wrong_reply/` with the same `chapter.md`, `scene_0.md`, and an `interrogation_scene_1.md` identical to the one above **except** swap the `#### Testimony` block so `Loop Prompt` is present and `Wrong Reply` is omitted:

```markdown
#### Testimony

- **On Loop:** **嫌疑人**：沒別的了。
- **Loop Prompt:** **相馬律**：從頭再聽一次。
```

and `expected-error.txt`:

```
interrogationMissingWrongReply
```

- [ ] **Step 7: Run the compiler tests**

Run: `bun run --cwd packages/scripts test compile-scenes`
Expected: PASS — the valid_interrogation test now checks `loopPrompt`/`wrongReply`, and the auto-discovered `interrogation_missing_loop_prompt` / `interrogation_missing_wrong_reply` fixtures each fail with their expected code.

Then run: `bun run check:scripts`
Expected: PASS (no type errors from the new fields).

- [ ] **Step 8: Commit**

```bash
git add packages/scripts/compile-scenes/types.ts packages/scripts/compile-scenes/parser-interrogation.ts packages/scripts/compile-scenes/emitter.ts packages/scripts/compile-scenes/assets/enrich.ts packages/scripts/compile-scenes.test.ts packages/scripts/__fixtures__/valid_interrogation packages/scripts/__fixtures__/invalid/interrogation_missing_loop_prompt packages/scripts/__fixtures__/invalid/interrogation_missing_wrong_reply
git commit -m "feat(compiler): Loop Prompt / Wrong Reply testimony fields"
```

> **Note:** after this task the real Chapter 1 scenes (`interrogation_scene_4/_10`) will NOT compile via `bun run scenes:compile` until Task 4 authors the fields. This is expected mid-plan; the compiler unit tests (fixtures) are green.

---

### Task 2: Rust schema + runtime composition

**Files:**
- Modify: `apps/game/src-tauri/src/game/schema.rs` (`TestimonyJson` ~428-437)
- Modify: `apps/game/src-tauri/src/game/mod.rs` (`advance_playing_testimony` Loop branch; `present_interrogation_evidence` wrong branch; test fixtures `two_line_question_scene`, `empty_testimony`, others)
- Modify: `apps/game/src-tauri/src/game/scenes/interrogation.rs` (test `empty_testimony` + inline `TestimonyJson` literals)
- Test: `apps/game/src-tauri/src/game/mod.rs` (new runtime tests)

**Interfaces:**
- Consumes: `AdvanceOutcome`, `CrossExam`, the compiled `loopPrompt`/`wrongReply` JSON keys from Task 1.
- Produces: `TestimonyJson.loop_prompt: Vec<DialogueItem>`, `TestimonyJson.wrong_reply: Vec<DialogueItem>`.

- [ ] **Step 1: Add the schema fields**

In `apps/game/src-tauri/src/game/schema.rs`, change `TestimonyJson` (~430):

```rust
pub struct TestimonyJson {
    pub on_loop: Vec<DialogueItem>,
    #[serde(default)]
    pub loop_prompt: Vec<DialogueItem>,
    #[serde(default)]
    pub default_challenge: Vec<DialogueItem>,
    #[serde(default)]
    pub default_wrong: Vec<DialogueItem>,
    #[serde(default)]
    pub wrong_reply: Vec<DialogueItem>,
    pub lines: Vec<TestimonyLineJson>,
}
```

- [ ] **Step 2: Add the new fields to every inline TestimonyJson test fixture**

Run `cargo check --manifest-path apps/game/src-tauri/Cargo.toml --all-targets` — it lists each `TestimonyJson { ... }` literal now missing `loop_prompt` / `wrong_reply` (both `empty_testimony()` helpers in `mod.rs` ~3630 and `scenes/interrogation.rs` ~517, plus ~11 inline literals in `two_line_question_scene`, `single_required_question_scene`, `single_honest_question_scene`, the `correct_present_*` / `present_correct_*` / `honest_question_*` scenes, and the `scenes/interrogation.rs` fixtures).

For each, add `loop_prompt: vec![]` (after `on_loop`) and `wrong_reply: vec![]` (after `default_wrong`), EXCEPT in `two_line_question_scene()` (mod.rs ~3548) use distinguishable content so the runtime tests can assert on it:

```rust
                    testimony: TestimonyJson {
                        on_loop: vec![DialogueItem::Action {
                            text: "loop".into(),
                        }],
                        loop_prompt: vec![DialogueItem::Action {
                            text: "detective-loop".into(),
                        }],
                        default_challenge: vec![],
                        default_wrong: vec![],
                        wrong_reply: vec![DialogueItem::Action {
                            text: "detective-wrong".into(),
                        }],
                        lines: vec![
                            // ... unchanged ...
```

Re-run `cargo check --manifest-path apps/game/src-tauri/Cargo.toml --all-targets`.
Expected: compiles (no missing-field errors).

- [ ] **Step 3: Write the failing runtime tests**

In `apps/game/src-tauri/src/game/mod.rs`, after `draining_unbroken_testimony_loops_in_dialogue`, add:

```rust
    #[test]
    fn loop_plays_detective_prompt_after_on_loop() {
        let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);
        engine.prime_initial_queue().unwrap();
        engine.ask_interrogation_question("alibi").unwrap();
        // Drain line 0 -> line 1, drain line 1 -> loop installs
        // on_loop ++ loop_prompt ++ line0.
        let view = engine.advance_dialogue(token_from(&engine.view())).unwrap();
        let view = engine.advance_dialogue(token_from(&view)).unwrap();
        // The suspect's On Loop ("loop") plays first...
        match &view.mode {
            ModeView::Dialogue { current, .. } => assert!(
                matches!(current, DialogueItem::Action { text } if text == "loop"),
                "expected the suspect On Loop first, got {current:?}"
            ),
            other => panic!("expected Dialogue mode, got {other:?}"),
        }
        // ...then the detective's Loop Prompt.
        let view = engine.advance_dialogue(token_from(&view)).unwrap();
        match &view.mode {
            ModeView::Dialogue { current, .. } => assert!(
                matches!(current, DialogueItem::Action { text } if text == "detective-loop"),
                "expected the detective loop prompt after On Loop, got {current:?}"
            ),
            other => panic!("expected Dialogue mode, got {other:?}"),
        }
    }

    #[test]
    fn wrong_present_plays_detective_reply_after_rebuff() {
        let mut engine = empty_engine_with_interrogation_scene(two_line_question_scene(), 1);
        engine.inventory.evidence.push(EvidenceRecord {
            id: "unrelated".into(),
            name: "Unrelated".into(),
            description: "d".into(),
            details: "d".into(),
            image_asset_id: None,
            on_reexamine: None,
            collected_in_chapter_id: "chapter_1".into(),
            collected_in_scene_id: "prev".into(),
        });
        engine.prime_initial_queue().unwrap();
        engine.ask_interrogation_question("alibi").unwrap();
        let view = engine.challenge_interrogation_line("l_deny").unwrap();
        engine.advance_dialogue(token_from(&view)).unwrap();
        // Present the wrong evidence against the contradiction line.
        let view = engine
            .present_interrogation_evidence("l_deny", "evidence", "unrelated")
            .unwrap();
        // The suspect's On Wrong Evidence ("wrong") plays first...
        match &view.mode {
            ModeView::Dialogue { current, .. } => assert!(
                matches!(current, DialogueItem::Action { text } if text == "wrong"),
                "expected the suspect rebuff first, got {current:?}"
            ),
            other => panic!("expected Dialogue mode, got {other:?}"),
        }
        // ...then the detective's Wrong Reply.
        let view = engine.advance_dialogue(token_from(&view)).unwrap();
        match &view.mode {
            ModeView::Dialogue { current, .. } => assert!(
                matches!(current, DialogueItem::Action { text } if text == "detective-wrong"),
                "expected the detective wrong reply second, got {current:?}"
            ),
            other => panic!("expected Dialogue mode, got {other:?}"),
        }
    }
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml --lib loop_plays_detective_prompt_after_on_loop wrong_present_plays_detective_reply_after_rebuff`
Expected: FAIL — the runtime does not yet splice `loop_prompt` / `wrong_reply`.

- [ ] **Step 5: Splice `loop_prompt` into the loop queue**

In `apps/game/src-tauri/src/game/mod.rs`, in `advance_playing_testimony`, change the `AdvanceOutcome::Loop` branch:

```rust
                AdvanceOutcome::Loop => scene
                    .question(&question_id)
                    .map(|question| {
                        let mut items = question.testimony.on_loop.clone();
                        items.extend(question.testimony.loop_prompt.iter().cloned());
                        if let Some(first) = question.testimony.lines.first() {
                            items.extend(first.content.iter().cloned());
                        }
                        items
                    })
                    .unwrap_or_default(),
```

- [ ] **Step 6: Splice `wrong_reply` into the wrong-present queue**

In `apps/game/src-tauri/src/game/mod.rs`, in `present_interrogation_evidence`, change the wrong (`else`) branch:

```rust
                } else {
                    let default_wrong = scene
                        .question(&question_id)
                        .map(|question| question.testimony.default_wrong.clone())
                        .unwrap_or_default();
                    let mut on_wrong = line
                        .as_ref()
                        .map(|line| line.on_wrong_evidence.clone())
                        .filter(|dialogue| !dialogue.is_empty())
                        .unwrap_or(default_wrong);
                    // Append the required detective reaction after the suspect's rebuff.
                    if let Some(question) = scene.question(&question_id) {
                        on_wrong.extend(question.testimony.wrong_reply.iter().cloned());
                    }
                    scene.return_to_line();
                    on_wrong
                }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml`
Expected: PASS (all suites, including the two new tests and the existing interrogation suite).

Run: `cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
Expected: no warnings.

- [ ] **Step 8: Commit**

```bash
git add apps/game/src-tauri/src/game/schema.rs apps/game/src-tauri/src/game/mod.rs apps/game/src-tauri/src/game/scenes/interrogation.rs
git commit -m "feat(engine): play detective Loop Prompt / Wrong Reply beats"
```

---

### Task 3: Document the fields in the writing skill

**Files:**
- Modify: `.claude/skills/writing-interrogation-scene/SKILL.md` (testimony format section)

**Interfaces:**
- Consumes: nothing (documentation).
- Produces: authoring guidance consumed by Task 4.

- [ ] **Step 1: Add the fields to the testimony format documentation**

In `.claude/skills/writing-interrogation-scene/SKILL.md`, find the testimony field documentation (the section listing `On Loop`, `Default Challenge`, `Default Wrong`). Add documentation for the two new fields, stating verbatim:

- `Loop Prompt` (testimony-level, the detective 相馬律's line) plays on loop, after the suspect's `On Loop` and before the statement replays from the top.
- `Wrong Reply` (testimony-level, the detective's line) plays after the suspect's `On Wrong Evidence` / `Default Wrong` whenever the player presents wrong evidence.
- Both are **required iff the testimony has ≥1 `Contradiction` line** (an honest question may omit them). This mirrors the `Challenge`/`On Correct`/`On Wrong Evidence` rule.

Match the surrounding bullet style. Also update the "The unified model" bullet that describes the loop (`.claude/skills/writing-interrogation-scene/SKILL.md` "Reaching the end of a testimony … plays the testimony's On Loop line, then repeats") to note the detective's `Loop Prompt` plays between `On Loop` and the restart.

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/writing-interrogation-scene/SKILL.md
git commit -m "docs(skill): document Loop Prompt / Wrong Reply testimony fields"
```

---

### Task 4: Author Chapter 1 content and recompile

**Files:**
- Modify: `docs/stories_plan/chapter_1/interrogation_scene_4.md` (`q_whereabouts`, `q_backroom` testimonies)
- Modify: `docs/stories_plan/chapter_1/interrogation_scene_10.md` (all six contradiction testimonies)

**Interfaces:**
- Consumes: the compiler support from Task 1 and the authoring rules from Task 3.
- Produces: real scenes that compile with the new fields.

- [ ] **Step 1: Author scene_4 detective beats**

In `docs/stories_plan/chapter_1/interrogation_scene_4.md`, add a `Loop Prompt` and `Wrong Reply` line to each testimony that has a `Contradiction` line — `q_whereabouts` (~58) and `q_backroom` (~80). Insert them immediately after that testimony's `On Loop`, keeping the existing `Default Challenge` / `Default Wrong`:

For `q_whereabouts`:

```markdown
- **On Loop:** **三宅蒼太**：那個時間……你要問，我再想一次。
- **Loop Prompt:** **相馬律**：把那段時間，從頭再理一次。
- **Default Challenge:** **相馬律**：等一下，這句先讓我想想。
- **Default Wrong:** **三宅蒼太**：這句……應該沒問題吧？
- **Wrong Reply:** **相馬律**：不對，這對不上那個時間點。
```

For `q_backroom`:

```markdown
- **On Loop:** **三宅蒼太**：後場那趟……我說的都是真的。
- **Loop Prompt:** **相馬律**：後場那段，我再聽一次。
- **Default Challenge:** **相馬律**：這句，先停一下。
- **Default Wrong:** **三宅蒼太**：這……沒有不對吧？
- **Wrong Reply:** **相馬律**：不是這個。要對上的是後場那段畫面。
```

Leave `q_inner_storage` and `q_masuda` (no `Contradiction` line) unchanged.

- [ ] **Step 2: Author scene_10 detective beats**

In `docs/stories_plan/chapter_1/interrogation_scene_10.md`, every question's testimony has a `Contradiction` line, so add `Loop Prompt` and `Wrong Reply` to each, immediately after its `On Loop`. Use the detective 相馬律's voice — a "let me re-hear it" prompt for the loop and a "that's not the contradiction" reaction for the wrong reply. For each question in source order:

```markdown
# q_p1 (#summary_miyake_most_credible)
- **Loop Prompt:** **相馬律**：哪一句對不上，我再確認一次。
- **Wrong Reply:** **相馬律**：人格不是證據。這對不上那句謊話。

# q_p2 (#summary_death_after_miyake)
- **Loop Prompt:** **相馬律**：那條死亡時間，我再看一次。
- **Wrong Reply:** **相馬律**：這證不到死亡的那一分鐘。

# q_p3 (#summary_could_still_be_miyake)
- **Loop Prompt:** **相馬律**：把他放在那個位置的理由，再擺一次。
- **Wrong Reply:** **相馬律**：這對不到人。要靠工單和憑證。

# q_request_clip (#gate_hold_record)
- **Loop Prompt:** **相馬律**：要動那扇門，我把理由再理一次。
- **Wrong Reply:** **相馬律**：這動搖不了那行時間。

# q_p4 (#summary_doorlock_authentic)
- **Loop Prompt:** **相馬律**：這行時間，我再讀一次。
- **Wrong Reply:** **相馬律**：錯的不是紀錄，是摘要的讀法。

# q_p5 (#summary_cannot_prove_kitami)
- **Loop Prompt:** **相馬律**：把他放進那一刻，我再想一次。
- **Wrong Reply:** **相馬律**：人格不是不在場證明，反過來也一樣。
```

Insert each pair after that question's existing `On Loop` line (and before its `Default Challenge`/`Default Wrong` if present). Verify each question's actual `On Loop` line and anchor id in the file before inserting; adjust wording to fit the surrounding prose per the `writing-interrogation-scene` skill.

- [ ] **Step 3: Recompile and verify**

Run: `bun run scenes:compile`
Expected: `[compile-scenes] OK — 1 chapter(s), 13 scene(s).` (no `interrogationMissingLoopPrompt` / `interrogationMissingWrongReply` errors).

- [ ] **Step 4: Confirm the compiled JSON carries the beats**

Run:
```bash
python3 -c "
import json
d=json.load(open('apps/game/src-tauri/resources/scenes/chapter_1/interrogation_scene_4.json'))
for ph in d['phases']:
    for q in ph['questions']:
        t=q['testimony']
        has_c=any(l.get('contradiction') for l in t['lines'])
        print(q['id'],'contradiction' if has_c else 'honest','loopPrompt',len(t['loopPrompt']),'wrongReply',len(t['wrongReply']))
"
```
Expected: each contradiction question prints `loopPrompt` and `wrongReply` lengths ≥ 1; honest questions print 0.

- [ ] **Step 5: Commit**

```bash
git add docs/stories_plan/chapter_1/interrogation_scene_4.md docs/stories_plan/chapter_1/interrogation_scene_10.md
git commit -m "content(chapter_1): author detective Loop Prompt / Wrong Reply beats"
```

---

## Final verification (after all tasks)

- `bun run --cwd packages/scripts test` — compiler suite green.
- `bun run check:scripts` — compile-scripts type-check green.
- `cargo test --manifest-path apps/game/src-tauri/Cargo.toml` — Rust suite green.
- `cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — clean.
- `bun run scenes:compile` — real Chapter 1 content compiles.
- `bun run lint:all` — full lint gate green.
