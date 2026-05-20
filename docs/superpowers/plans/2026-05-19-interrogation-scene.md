# Interrogation Scene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add playable `interrogation_scene_<K>.md` support for suspect inquiry and testimony cross-examination in one scene file.

**Architecture:** Extend the existing scene pipeline rather than replacing it: Bun parses authored interrogation markdown into typed JSON, Rust adds a third `SceneRuntime` variant that owns interrogation state and commands, and Svelte adds an interrogation action view while reusing the existing dialogue queue and inventory panel. The implementation keeps inquiry and testimony as phase kinds inside one scene type.

**Tech Stack:** Bun (`bun:test`) and TypeScript for the compiler, Rust 2021 + serde for the Tauri engine, Svelte 5 runes and Vitest for the frontend.

**Spec reference:** [`docs/superpowers/specs/2026-05-19-interrogation-scene-design.md`](../specs/2026-05-19-interrogation-scene-design.md).

---

## Scope Check

This spec spans compiler, runtime, frontend, and writer-skill work, but it is one coherent feature because each layer is needed for a playable interrogation scene. The plan is split so each task produces a testable slice and a commit.

The largest risk is cross-scene evidence validation. Keep it conservative: if the compiler cannot prove that a cross-scene evidence or statement is guaranteed before an interrogation needs it, fail the build and require the author to make the prerequisite explicit.

## Files And Responsibilities

**Compiler files**

- Modify `scripts/compile-scenes/types.ts`: add interrogation AST/JSON types, inventory targets, interrogation reveal targets, and interrogation unlock expressions.
- Modify `scripts/compile-scenes/parser-unlock.ts`: add `parseInterrogationUnlockExpr` while leaving investigation `parseUnlockExpr` behavior unchanged.
- Create `scripts/compile-scenes/parser-interrogation.ts`: parse `interrogation_scene_<K>.md`.
- Modify `scripts/compile-scenes/orchestrator.ts`: dispatch `interrogation_scene_` files to the new parser.
- Modify `scripts/compile-scenes/emitter.ts`: emit interrogation scene JSON and include it in `chapters.json`.
- Modify `scripts/compile-scenes/validator.ts`: validate interrogation-local IDs, reveal targets, result targets, completion paths, and cross-scene inventory guarantees.
- Add tests and fixtures under `scripts/compile-scenes/*.test.ts` and `scripts/__fixtures__/`.

**Authoring skill files**

- Create `.claude/skills/writing-interrogation-scene/SKILL.md`: canonical writer instructions for the new scene type.
- Modify `.claude/skills/writing-chapter-manifest/SKILL.md`: mark `interrogation_scene_*.md` as playable once implemented.
- Modify `CLAUDE.md`: mention the new skill in the project-domain section.

**Rust files**

- Modify `src-tauri/src/game/schema.rs`: mirror interrogation JSON via serde types.
- Modify `src-tauri/src/game/unlock.rs`: add interrogation unlock evaluation.
- Modify `src-tauri/src/game/reveals.rs`: add interrogation reveal application without allowing hotspot/topic/sublocation targets.
- Create `src-tauri/src/game/scenes/interrogation.rs`: own interrogation phase state.
- Modify `src-tauri/src/game/scenes/mod.rs`: add `SceneRuntime::Interrogation`.
- Modify `src-tauri/src/game/mod.rs`: load, advance, view, and command-dispatch interrogation scenes.
- Modify `src-tauri/src/game/view.rs`: add `ModeView::Interrogation` and `SceneView::Interrogation`.
- Modify `src-tauri/src/game/error.rs`: add typed errors for unknown/locked phase, question, testimony, result, and inventory target problems.
- Modify `src-tauri/src/lib.rs`: register new Tauri commands.

**Frontend files**

- Modify `src/lib/state/types.ts`: mirror new Rust view and mode types.
- Modify `src/lib/state/game-client.svelte.ts`: add invoke wrappers.
- Modify `src/lib/state/mode.ts` and `src/lib/state/mode.test.ts`: inventory visibility rules for interrogation.
- Create `src/lib/components/InterrogationView.svelte`: render inquiry questions and testimony actions.
- Modify `src/routes/+page.svelte`: route `mode.type === "interrogation"` to the new view.

**Playable content and acceptance files**

- Add valid/invalid compiler fixtures for interrogation scenes under `scripts/__fixtures__/`.
- Add `static/stories_plan/chapter_1/interrogation_scene_2.md` and update `static/stories_plan/chapter_1/chapter.md` only after compiler/runtime support exists.
- Modify `src-tauri/tests/full_playthrough.rs`: include inquiry, press, wrong present, correct present, and scene advancement.

---

### Task 1: Add Compiler Types And Interrogation Unlock Parsing

**Files:**
- Modify: `scripts/compile-scenes/types.ts`
- Modify: `scripts/compile-scenes/parser-unlock.ts`
- Modify: `scripts/compile-scenes/parser-unlock.test.ts`

- [ ] **Step 1: Write failing unlock parser tests**

Append these tests to `scripts/compile-scenes/parser-unlock.test.ts`:

```ts
import { parseInterrogationUnlockExpr } from "./parser-unlock";

describe("parseInterrogationUnlockExpr", () => {
  it("parses question_answered and phase_completed predicates", () => {
    const result = parseInterrogationUnlockExpr(
      "question:hidden_discarded_beans answered and phase:wakatsuki_inquiry completed",
      "interrogation_scene_2.md",
      12,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        op: "and",
        left: { predicate: "question_answered", id: "hidden_discarded_beans" },
        right: { predicate: "phase_completed", id: "wakatsuki_inquiry" },
      },
    });
  });

  it("keeps interrogation unlocks limited to inventory, question, and phase predicates", () => {
    const result = parseInterrogationUnlockExpr(
      "hotspot:counter investigated",
      "interrogation_scene_2.md",
      20,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unlockUnknownPredicate");
  });
});
```

- [ ] **Step 2: Run the parser test and confirm it fails**

Run: `bun test scripts/compile-scenes/parser-unlock.test.ts`

Expected: failure because `parseInterrogationUnlockExpr` is not exported.

- [ ] **Step 3: Add interrogation type definitions**

Add these exports to `scripts/compile-scenes/types.ts` near the shared atoms:

```ts
export type InventoryTarget =
  | { kind: "evidence"; id: string }
  | { kind: "statement"; id: string };

export type InterrogationRevealTarget =
  | InventoryTarget
  | { kind: "question"; id: string }
  | { kind: "phase"; id: string };

export type InterrogationUnlockExpr =
  | { op: "and" | "or"; left: InterrogationUnlockExpr; right: InterrogationUnlockExpr }
  | { predicate: "evidence_collected"; id: string }
  | { predicate: "statement_acquired"; id: string }
  | { predicate: "question_answered"; id: string }
  | { predicate: "phase_completed"; id: string };
```

- [ ] **Step 4: Implement `parseInterrogationUnlockExpr`**

In `scripts/compile-scenes/parser-unlock.ts`, keep `parseUnlockExpr` unchanged. Add a generic predicate mode and export:

```ts
export type InterrogationParseResult =
  | { ok: true; value: import("./types").InterrogationUnlockExpr }
  | { ok: false; error: CompileError };

export function parseInterrogationUnlockExpr(
  source: string,
  sourceFile: string,
  line: number,
): InterrogationParseResult {
  const tokens = new Tokens(source.trim(), sourceFile, line);
  if (tokens.atEnd()) {
    return failure(sourceFile, line, "unlockEmpty", "Unlock expression is empty.");
  }
  const expr = parseInterrogationOr(tokens);
  if (!expr.ok) return expr;
  if (!tokens.atEnd()) {
    return failure(sourceFile, line, "unlockTrailing", `Trailing tokens after parsed expression: "${tokens.peek()}"`);
  }
  return expr;
}
```

Implement `parseInterrogationOr`, `parseInterrogationAnd`, `parseInterrogationAtom`, and `parseInterrogationPredicate` by copying the current recursive descent shape and changing only the predicate set:

```ts
function parseInterrogationPredicate(t: Tokens): InterrogationParseResult {
  if (t.consume("evidence:")) {
    const id = t.consumeId();
    if (!id) return failure(t.sourceFile, t.line, "unlockMissingId", "Missing evidence id.");
    if (!t.consumeWord("collected")) return failure(t.sourceFile, t.line, "unlockMissingVerb", `Expected "collected" after evidence:${id}.`);
    return { ok: true, value: { predicate: "evidence_collected", id } };
  }
  if (t.consume("statement:")) {
    const id = t.consumeId();
    if (!id) return failure(t.sourceFile, t.line, "unlockMissingId", "Missing statement id.");
    if (!t.consumeWord("acquired")) return failure(t.sourceFile, t.line, "unlockMissingVerb", `Expected "acquired" after statement:${id}.`);
    return { ok: true, value: { predicate: "statement_acquired", id } };
  }
  if (t.consume("question:")) {
    const id = t.consumeId();
    if (!id) return failure(t.sourceFile, t.line, "unlockMissingId", "Missing question id.");
    if (!t.consumeWord("answered")) return failure(t.sourceFile, t.line, "unlockMissingVerb", `Expected "answered" after question:${id}.`);
    return { ok: true, value: { predicate: "question_answered", id } };
  }
  if (t.consume("phase:")) {
    const id = t.consumeId();
    if (!id) return failure(t.sourceFile, t.line, "unlockMissingId", "Missing phase id.");
    if (!t.consumeWord("completed")) return failure(t.sourceFile, t.line, "unlockMissingVerb", `Expected "completed" after phase:${id}.`);
    return { ok: true, value: { predicate: "phase_completed", id } };
  }
  return failure(t.sourceFile, t.line, "unlockUnknownPredicate", `Unknown predicate prefix at: "${t.peek()}"`);
}
```

- [ ] **Step 5: Run the parser test**

Run: `bun test scripts/compile-scenes/parser-unlock.test.ts`

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/compile-scenes/types.ts scripts/compile-scenes/parser-unlock.ts scripts/compile-scenes/parser-unlock.test.ts
git commit -m "feat(compiler): parse interrogation unlock expressions"
```

---

### Task 2: Parse Interrogation Scene Markdown

**Files:**
- Modify: `scripts/compile-scenes/types.ts`
- Create: `scripts/compile-scenes/parser-interrogation.ts`
- Create: `scripts/compile-scenes/parser-interrogation.test.ts`

- [ ] **Step 1: Add interrogation AST and JSON types**

Add these exports to `scripts/compile-scenes/types.ts` after `ASTInvestigationScene` and before JSON scene types:

```ts
export type ASTInterrogationScene = Located<{
  kind: "interrogationScene";
  id: string;
  title: string;
  intro: DialogueItem[];
  phases: ASTInterrogationPhase[];
  evidenceManifest: ASTEvidence[];
  statementManifest: ASTStatement[];
  outro: ASTInterrogationOutro;
}>;

export type ASTSubject = Located<{
  id: string;
  name: string;
  role: string;
  bio: string;
}>;

export type ASTInterrogationPhase =
  | ASTInquiryPhase
  | ASTTestimonyPhase;

export type ASTInquiryPhase = Located<{
  kind: "inquiry";
  id: string;
  label: string;
  subject: ASTSubject;
  required: boolean;
  status: "locked" | "unlocked";
  unlock: InterrogationUnlockExpr | null;
  reveals: InterrogationRevealTarget[];
  sceneTag: string;
  entryDialogue: DialogueItem[];
  complete: "auto" | InterrogationUnlockExpr;
  questions: ASTInquiryQuestion[];
}>;

export type ASTInquiryQuestion = Located<{
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
}>;

export type ASTTestimonyPhase = Located<{
  kind: "testimony";
  id: string;
  label: string;
  subject: ASTSubject;
  required: boolean;
  status: "locked" | "unlocked";
  unlock: InterrogationUnlockExpr | null;
  reveals: InterrogationRevealTarget[];
  sceneTag: string;
  entryDialogue: DialogueItem[];
  statements: ASTTestimonyStatement[];
  results: ASTTestimonyResult[];
}>;

export type ASTTestimonyStatement = Located<{
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
}>;

export type ASTTestimonyResult = Located<{
  id: string;
  label: string;
  reveals: InterrogationRevealTarget[];
  dialogue: DialogueItem[];
}>;

export type ASTInterrogationOutro = {
  unlock: "auto" | InterrogationUnlockExpr;
  dialogue: DialogueItem[];
};
```

Add `JSONInterrogationScene` and matching JSON aliases using the same shapes without `sourceFile` and `line`. Use the names from the spec: `JSONInterrogationScene`, `JSONInterrogationPhase`, `JSONInquiryQuestion`, `JSONTestimonyStatement`, and `JSONTestimonyResult`.

- [ ] **Step 2: Write parser tests for a mixed inquiry plus testimony scene**

Create `scripts/compile-scenes/parser-interrogation.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { parseInterrogationScene } from "./parser-interrogation";

const VALID_SOURCE = `# Scene 2: 第一次詢問與交叉詢問

## Intro

**相馬律**：先從若槻開始。

## Phase: 若槻蓮初步詢問 {#wakatsuki_inquiry}
- **Kind:** inquiry
- **Required:** true

[場景：警視廳臨時詢問室，深夜，白色日光燈刺眼。]

### Subject: 若槻蓮 {#wakatsuki_ren}
- **Role:** 第一嫌疑人
- **Bio:** 雨鐘咖啡館兼職店員。

### Question: 進倉庫的理由 {#entered_storage}
- **Status:** unlocked
- **Reveals:** [statement:wakatsuki_entered_for_beans]

**相馬律**：你為什麼進倉庫？

**若槻蓮**：我只是去拿咖啡豆。

#### On Reask

**若槻蓮**：我說過了，是咖啡豆。

## Phase: 若槻蓮的行動證詞 {#wakatsuki_testimony}
- **Kind:** testimony
- **Required:** true
- **Unlock:** statement:wakatsuki_entered_for_beans acquired

[場景：警視廳臨時證據審查室，深夜，投影幕顯示 KAGAMI 門鎖時間線。]

### Subject: 若槻蓮 {#wakatsuki_ren}
- **Role:** 第一嫌疑人
- **Bio:** 雨鐘咖啡館兼職店員。

### Testimony

#### Statement: 清潔鍵 {#cleaning_button}
- **Content:** 我出來後，立刻按下清潔鍵。
- **Contradiction:** evidence:coffee_machine_cleaning_log
- **On Correct:** breakthrough_cleaning_time
- **On Wrong:** wrong_time_record

##### On Press

**相馬律**：你說立刻？

##### On Present

**相馬律**：這份清潔紀錄能說明時間。

##### On Wrong Present

**神谷澪**：那份資料不夠。

### Result: breakthrough_cleaning_time {#breakthrough_cleaning_time}
- **Reveals:** [statement:kagami_timeline_inconsistent]

**相馬律**：這和門鎖時間線矛盾。

### Result: wrong_time_record {#wrong_time_record}

**早坂茜**：還不夠。

## Evidence Manifest

### evidence:coffee_machine_cleaning_log {#coffee_machine_cleaning_log}
- **Name:** 咖啡機清潔紀錄
- **Description:** 咖啡機自動記錄的清潔模式啟動時間。
- **Details:** 清潔模式啟動時間為 21:13:29。

#### On Collect

**相馬律**：時間不一致。

## Statement Manifest

### statement:wakatsuki_entered_for_beans {#wakatsuki_entered_for_beans}
- **Speaker:** 若槻蓮
- **Content:** 「我進倉庫只是拿咖啡豆。」

#### On Acquire

**若槻蓮**：我只是拿咖啡豆。

### statement:kagami_timeline_inconsistent {#kagami_timeline_inconsistent}
- **Speaker:** 相馬律
- **Content:** 「門鎖時間線和咖啡機紀錄不一致。」

#### On Acquire

**相馬律**：至少有一份時間紀錄不成立。

## Outro

**相馬律**：先到這裡。
`;

describe("parseInterrogationScene", () => {
  it("parses inquiry and testimony phases in one scene", () => {
    const parsed = parseInterrogationScene(VALID_SOURCE, "chapter_1/interrogation_scene_2.md", "interrogation_scene_2");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.kind).toBe("interrogationScene");
    expect(parsed.value.phases.map((p) => p.kind)).toEqual(["inquiry", "testimony"]);
    expect(parsed.value.phases[0]!.id).toBe("wakatsuki_inquiry");
    expect(parsed.value.phases[1]!.id).toBe("wakatsuki_testimony");
    expect(parsed.value.evidenceManifest[0]!.id).toBe("coffee_machine_cleaning_log");
    expect(parsed.value.statementManifest.map((s) => s.id)).toContain("kagami_timeline_inconsistent");
  });

  it("rejects a phase without a subject", () => {
    const source = VALID_SOURCE.replace(/### Subject:[\\s\\S]*?### Question:/, "### Question:");
    const parsed = parseInterrogationScene(source, "bad.md", "interrogation_scene_2");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe("interrogationPhaseMissingSubject");
  });
});
```

- [ ] **Step 3: Run the parser test and confirm it fails**

Run: `bun test scripts/compile-scenes/parser-interrogation.test.ts`

Expected: failure because `parser-interrogation.ts` does not exist.

- [ ] **Step 4: Implement `parser-interrogation.ts`**

Create `scripts/compile-scenes/parser-interrogation.ts`. Follow the `parser-investigation.ts` cursor style exactly. Export:

```ts
export type InterrogationParseResult =
  | { ok: true; value: ASTInterrogationScene }
  | { ok: false; error: CompileError };

export function parseInterrogationScene(
  source: string,
  sourceFile: string,
  id: string,
): InterrogationParseResult;
```

Parser behavior:

- H1 must match the current `# Scene N: <title>` pattern.
- H2 accepts only `Intro`, `Phase:`, `Evidence Manifest`, `Statement Manifest`, and `Outro`.
- Reuse the existing evidence/statement manifest parsing code by extracting shared manifest parsers from `parser-investigation.ts` into a new `scripts/compile-scenes/parser-manifest.ts`.
- Reuse `DialogueItem` consumption semantics from `parser-investigation.ts`: scene tags, actions, and `**Speaker**：text` are valid; stray metadata and unknown lines are hard errors.
- Add local helpers:
  - `parseInterrogationRevealsList(raw, sourceFile, line)`
  - `parseInventoryTarget(raw, sourceFile, line)`
  - `parseSubject(cur)`
  - `parseInquiryPhase(cur, phaseMeta)`
  - `parseTestimonyPhase(cur, phaseMeta)`
  - `parseInquiryQuestion(cur, parentQuestionId)`
  - `parseTestimonyStatement(cur)`
  - `parseTestimonyResult(cur)`

Use these stable error codes:

```ts
"interrogationSceneMissingTitle"
"interrogationSceneUnknownH2"
"interrogationPhaseMissingAnchor"
"interrogationPhaseMalformedHeading"
"interrogationPhaseMissingKind"
"interrogationPhaseUnknownKind"
"interrogationPhaseNoSceneTag"
"interrogationPhaseDuplicateSceneTag"
"interrogationPhaseMissingSubject"
"interrogationSubjectMissingAnchor"
"interrogationSubjectMissingMetadata"
"interrogationQuestionMissingAnchor"
"interrogationQuestionMalformedHeading"
"testimonyMissingContainer"
"testimonyStatementMissingContent"
"testimonyStatementMissingAnchor"
"testimonyResultMissingAnchor"
"testimonyUnknownH5"
"interrogationRevealUnknownTarget"
"interrogationContradictionMalformed"
"interrogationSceneMissingOutro"
```

- [ ] **Step 5: Run parser tests**

Run: `bun test scripts/compile-scenes/parser-interrogation.test.ts scripts/compile-scenes/parser-investigation.test.ts`

Expected: pass. The investigation parser must still pass after manifest parser extraction.

- [ ] **Step 6: Commit**

```bash
git add scripts/compile-scenes/types.ts scripts/compile-scenes/parser-interrogation.ts scripts/compile-scenes/parser-interrogation.test.ts scripts/compile-scenes/parser-investigation.ts scripts/compile-scenes/parser-manifest.ts
git commit -m "feat(compiler): parse interrogation scenes"
```

---

### Task 3: Emit Interrogation JSON And Include It In Chapter Output

**Files:**
- Modify: `scripts/compile-scenes/orchestrator.ts`
- Modify: `scripts/compile-scenes/emitter.ts`
- Modify: `scripts/compile-scenes/emitter.test.ts`
- Modify: `scripts/compile-scenes/compile-scenes.test.ts`
- Add: `scripts/__fixtures__/valid_interrogation/chapter_1/chapter.md`
- Add: `scripts/__fixtures__/valid_interrogation/chapter_1/scene_0.md`
- Add: `scripts/__fixtures__/valid_interrogation/chapter_1/interrogation_scene_1.md`

- [ ] **Step 1: Add an emitter test**

Append to `scripts/compile-scenes/emitter.test.ts`:

```ts
import type { ASTInterrogationScene } from "./types";
import { emitInterrogationScene } from "./emitter";

it("emits interrogation scene JSON", () => {
  const ast: ASTInterrogationScene = {
    kind: "interrogationScene",
    id: "interrogation_scene_1",
    title: "詢問",
    intro: [],
    phases: [{
      kind: "inquiry",
      id: "p",
      label: "問話",
      subject: { id: "suspect", name: "嫌疑人", role: "嫌疑人", bio: "沉默。", sourceFile: "x", line: 4 },
      required: true,
      status: "unlocked",
      unlock: null,
      reveals: [],
      sceneTag: "詢問室",
      entryDialogue: [],
      complete: "auto",
      questions: [],
      sourceFile: "x",
      line: 2,
    }],
    evidenceManifest: [],
    statementManifest: [],
    outro: { unlock: "auto", dialogue: [] },
    sourceFile: "x",
    line: 1,
  };
  expect(emitInterrogationScene(ast)).toMatchObject({
    type: "interrogation",
    id: "interrogation_scene_1",
    phases: [{ kind: "inquiry", id: "p", subject: { id: "suspect" } }],
  });
});
```

- [ ] **Step 2: Run emitter tests and confirm they fail**

Run: `bun test scripts/compile-scenes/emitter.test.ts`

Expected: failure because `emitInterrogationScene` is not exported.

- [ ] **Step 3: Implement emitter support**

In `scripts/compile-scenes/emitter.ts`:

- Import `ASTInterrogationScene` and `JSONInterrogationScene`.
- Add `emitInterrogationScene(ast: ASTInterrogationScene): JSONInterrogationScene`.
- Update `emitChaptersIndex` so `interrogation_scene_*.md` emits `{ type: "interrogation", file: "chapter_N/interrogation_scene_K.json" }`.
- Update `inferType` to return `"linear" | "investigation" | "interrogation"`.
- Remove `interrogation_scene_` from `isReservedSceneFile`.

- [ ] **Step 4: Wire the orchestrator**

In `scripts/compile-scenes/orchestrator.ts`:

- import `parseInterrogationScene`,
- dispatch `file.startsWith("interrogation_scene_")` to the new parser,
- remove the old reserved-skip warning path for interrogation scenes,
- call `emitInterrogationScene` when `rec.ast.kind === "interrogationScene"`.

- [ ] **Step 5: Add a focused valid fixture**

Create `scripts/__fixtures__/valid_interrogation/chapter_1/chapter.md`:

```markdown
# Chapter 1: 測試章

**Summary:** 測試 interrogation scene。

## Scenes
1. scene_0.md
2. interrogation_scene_1.md
```

Create `scripts/__fixtures__/valid_interrogation/chapter_1/scene_0.md`:

```markdown
# Scene 0: 開場

[場景：測試走廊，夜晚。]

**旁白**：開始。
```

Create `scripts/__fixtures__/valid_interrogation/chapter_1/interrogation_scene_1.md` by copying `VALID_SOURCE` from Task 2 and changing the H1 to `# Scene 1: 測試詢問`.

- [ ] **Step 6: Add an orchestrator snapshot test**

In `scripts/compile-scenes.test.ts`, add a test that compiles `scripts/__fixtures__/valid_interrogation` to a temp directory and asserts:

```ts
expect(readJson("chapters.json").chapters[0].scenes[1]).toEqual({
  type: "interrogation",
  file: "chapter_1/interrogation_scene_1.json",
});
expect(readJson("chapter_1/interrogation_scene_1.json").type).toBe("interrogation");
```

Use the existing fixture compile helper style already in that test file.

- [ ] **Step 7: Run compiler tests**

Run: `bun test scripts/compile-scenes/emitter.test.ts scripts/compile-scenes/compile-scenes.test.ts`

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add scripts/compile-scenes scripts/__fixtures__/valid_interrogation
git commit -m "feat(compiler): emit interrogation scene JSON"
```

---

### Task 4: Validate Interrogation IDs, Flow, And Cross-Scene Inventory

**Files:**
- Modify: `scripts/compile-scenes/validator.ts`
- Modify: `scripts/compile-scenes/validator.test.ts`
- Add invalid fixtures as needed under `scripts/__fixtures__/invalid/`

- [ ] **Step 1: Add validator helper tests**

Append these cases to `scripts/compile-scenes/validator.test.ts` using local AST builders:

```ts
it("accepts an interrogation scene whose testimony uses same-scene evidence revealed by an earlier inquiry", () => {
  const scene = mkInterrogationScene({
    phases: [
      mkInquiryPhase({
        id: "inquiry",
        questions: [mkQuestion({ id: "q", reveals: [{ kind: "evidence", id: "log" }] })],
      }),
      mkTestimonyPhase({
        id: "testimony",
        statements: [mkTestimonyStatement({ id: "s", contradiction: { kind: "evidence", id: "log" }, onCorrect: "win" })],
        results: [mkResult({ id: "win" })],
      }),
    ],
    evidenceManifest: [mkEvidence("log")],
  });
  const errors = validate({
    chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
    scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
  });
  expect(errors).toEqual([]);
});

it("rejects unresolved testimony result references", () => {
  const scene = mkInterrogationScene({
    phases: [mkTestimonyPhase({
      statements: [mkTestimonyStatement({ id: "s", contradiction: { kind: "evidence", id: "log" }, onCorrect: "missing" })],
      results: [],
    })],
    evidenceManifest: [mkEvidence("log")],
  });
  const errors = validate({
    chapters: [mkChapter(1, ["interrogation_scene_1.md"])],
    scenes: [{ chapterId: "chapter_1", file: "interrogation_scene_1.md", ast: scene }],
  });
  expect(errors.find((e) => e.code === "interrogationResultUnresolved")).toBeDefined();
});

it("rejects cross-scene evidence that is not guaranteed by an earlier scene", () => {
  const sourceInvestigation = mkInvestigationScene({ id: "investigation_scene_1" });
  sourceInvestigation.evidenceManifest = [mkEvidence("optional_log")];
  const interrogation = mkInterrogationScene({
    phases: [mkTestimonyPhase({
      statements: [mkTestimonyStatement({
        id: "s",
        contradiction: { kind: "evidence", id: "optional_log" },
        onCorrect: "win",
      })],
      results: [mkResult({ id: "win" })],
    })],
  });
  const errors = validate({
    chapters: [mkChapter(1, ["investigation_scene_1.md", "interrogation_scene_2.md"])],
    scenes: [
      { chapterId: "chapter_1", file: "investigation_scene_1.md", ast: sourceInvestigation },
      { chapterId: "chapter_1", file: "interrogation_scene_2.md", ast: interrogation },
    ],
  });
  expect(errors.find((e) => e.code === "crossSceneInventoryNotGuaranteed")).toBeDefined();
});
```

Add the helper builders inside `validator.test.ts`: `mkInterrogationScene`, `mkInquiryPhase`, `mkTestimonyPhase`, `mkQuestion`, `mkTestimonyStatement`, `mkResult`, `mkEvidence`, and `mkStatement`. Keep them minimal and typed.

- [ ] **Step 2: Run validator tests and confirm they fail**

Run: `bun test scripts/compile-scenes/validator.test.ts`

Expected: failure because the validator does not understand `interrogationScene`.

- [ ] **Step 3: Update validator input types**

In `scripts/compile-scenes/validator.ts`, update `SceneRecord.ast` to include `ASTInterrogationScene`. Update global evidence and statement passes to include manifests from both investigation and interrogation scenes.

- [ ] **Step 4: Add interrogation per-scene validation**

Add `validateInterrogationScene(rec, errors, corpusContext)` and call it from `validate`.

Validate:

- duplicate phase IDs,
- duplicate question IDs across the scene,
- duplicate testimony statement IDs across the scene,
- duplicate result IDs within a phase,
- subject ID repeated with different name, role, or bio,
- `Reveals` targets resolve to local question/phase or local manifest inventory item,
- `Unlock` predicates resolve to local question/phase or known inventory item,
- `Contradiction` resolves to a known evidence/statement ID,
- `On Correct` and `On Wrong` resolve to results in the same testimony phase,
- testimony statement with `Contradiction` has `On Correct`,
- locked phase/question has either inbound reveal or self unlock, but not both.

Use stable error codes:

```ts
"duplicateInterrogationId"
"interrogationSubjectConflict"
"interrogationRevealUnresolved"
"interrogationUnlockUnresolved"
"interrogationContradictionUnresolved"
"interrogationResultUnresolved"
"interrogationContradictionMissingCorrectResult"
"interrogationLockedBlockUnreachable"
"interrogationRevealsAndUnlockBoth"
"crossSceneInventoryNotGuaranteed"
```

- [ ] **Step 5: Add conservative cross-scene guarantee analysis**

Inside `validate`, build scene order from chapter manifests. Track a cumulative set:

```ts
const guaranteedInventoryBeforeScene = new Map<string, Set<string>>();
```

Keys are `${chapterId}/${file}`. Inventory atoms are `evidence:<id>` and `statement:<id>`.

For v1, mark inventory as guaranteed only when one of these is true:

- An earlier interrogation inquiry required question reveals the item before the phase can complete.
- An earlier interrogation testimony correct result reveals the item and that testimony phase is required.
- An earlier investigation scene has an explicit `Outro Unlock` requiring that exact item.
- An earlier investigation scene has `outro.unlock === "auto"` and the item is revealed by an initially unlocked hotspot or topic. This is intentionally conservative; it does not try to prove every multi-step reveal chain.

When a later interrogation contradiction or phase unlock references `evidence:<id>` or `statement:<id>` not declared in the same scene, require it in the cumulative guaranteed set. If absent, emit `crossSceneInventoryNotGuaranteed`.

- [ ] **Step 6: Run validator and compile tests**

Run:

```bash
bun test scripts/compile-scenes/validator.test.ts scripts/compile-scenes/compile-scenes.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/compile-scenes/validator.ts scripts/compile-scenes/validator.test.ts scripts/__fixtures__/invalid
git commit -m "feat(compiler): validate interrogation scene flow"
```

---

### Task 5: Add The Writing Interrogation Scene Skill

**Files:**
- Create: `.claude/skills/writing-interrogation-scene/SKILL.md`
- Modify: `.claude/skills/writing-chapter-manifest/SKILL.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Create the skill**

Create `.claude/skills/writing-interrogation-scene/SKILL.md` with this header and sections:

```markdown
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
```

- [ ] **Step 2: Update chapter manifest skill**

In `.claude/skills/writing-chapter-manifest/SKILL.md`, replace the reserved `interrogation_scene_<K>.md` wording with: `interrogation_scene_<K>.md` is a playable interrogation scene authored by `writing-interrogation-scene`.

- [ ] **Step 3: Update `CLAUDE.md` project domain section**

Add one bullet near the existing scene file descriptions:

```markdown
- `interrogation_scene_<K>.md` — suspect inquiry and testimony cross-examination scenes. Authored via `writing-interrogation-scene`.
```

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/writing-interrogation-scene/SKILL.md .claude/skills/writing-chapter-manifest/SKILL.md CLAUDE.md
git commit -m "docs(skills): add interrogation scene authoring skill"
```

---

### Task 6: Add Rust Schema, Unlock, And Reveal Support

**Files:**
- Modify: `src-tauri/src/game/schema.rs`
- Modify: `src-tauri/src/game/unlock.rs`
- Modify: `src-tauri/src/game/reveals.rs`
- Modify: `src-tauri/src/game/scenes/mod.rs`

- [ ] **Step 1: Add Rust schema tests first**

Append tests to `src-tauri/src/game/schema.rs`:

```rust
#[test]
fn deserializes_interrogation_scene() {
    let json = r#"{
        "type": "interrogation",
        "id": "interrogation_scene_2",
        "title": "詢問",
        "intro": [],
        "phases": [{
            "kind": "inquiry",
            "id": "p",
            "label": "問話",
            "subject": { "id": "suspect", "name": "嫌疑人", "role": "嫌疑人", "bio": "沉默。" },
            "required": true,
            "status": "unlocked",
            "unlock": null,
            "reveals": [],
            "sceneTag": "詢問室",
            "entryDialogue": [],
            "complete": "auto",
            "questions": []
        }],
        "evidenceManifest": [],
        "statementManifest": [],
        "outro": { "unlock": "auto", "dialogue": [] }
    }"#;
    let parsed: SceneJson = serde_json::from_str(json).unwrap();
    assert!(matches!(parsed, SceneJson::Interrogation(_)));
}

#[test]
fn deserializes_interrogation_question_reveal() {
    let json = r#"{"kind":"question","id":"hidden"}"#;
    let parsed: InterrogationRevealTarget = serde_json::from_str(json).unwrap();
    assert!(matches!(parsed, InterrogationRevealTarget::Question { id } if id == "hidden"));
}
```

- [ ] **Step 2: Run Rust schema tests and confirm failure**

Run: `cd src-tauri && cargo test game::schema::tests::deserializes_interrogation_scene`

Expected: failure because schema variants do not exist.

- [ ] **Step 3: Implement Rust serde types**

In `src-tauri/src/game/schema.rs`, add:

- `SceneType::Interrogation`
- `SceneJson::Interrogation(InterrogationSceneJson)`
- `InterrogationSceneJson`
- `InterrogationPhaseJson`
- `SubjectJson`
- `InquiryQuestionJson`
- `TestimonyStatementJson`
- `TestimonyResultJson`
- `InventoryTarget`
- `InterrogationRevealTarget`
- `InterrogationUnlockExpr`
- `InterrogationOutroUnlock`

Use these serde attributes:

```rust
#[serde(rename_all = "camelCase")]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[serde(untagged)]
```

Follow the existing `UnlockExpr` marker-enum approach for predicate deserialization. Do not reuse `RevealTarget` for interrogation reveals because that would allow hotspots, topics, and sublocations.

- [ ] **Step 4: Add interrogation unlock evaluator**

In `src-tauri/src/game/unlock.rs`, add:

```rust
pub trait InterrogationUnlockContext {
    fn evidence_collected(&self, id: &str) -> bool;
    fn statement_acquired(&self, id: &str) -> bool;
    fn question_answered(&self, id: &str) -> bool;
    fn phase_completed(&self, id: &str) -> bool;
}

pub fn evaluate_interrogation(
    expr: &InterrogationUnlockExpr,
    ctx: &dyn InterrogationUnlockContext,
) -> bool {
    match expr {
        InterrogationUnlockExpr::Combinator { op, left, right } => match op {
            Combinator::And => evaluate_interrogation(left, ctx) && evaluate_interrogation(right, ctx),
            Combinator::Or => evaluate_interrogation(left, ctx) || evaluate_interrogation(right, ctx),
        },
        InterrogationUnlockExpr::EvidenceCollected { id, .. } => ctx.evidence_collected(id),
        InterrogationUnlockExpr::StatementAcquired { id, .. } => ctx.statement_acquired(id),
        InterrogationUnlockExpr::QuestionAnswered { id, .. } => ctx.question_answered(id),
        InterrogationUnlockExpr::PhaseCompleted { id, .. } => ctx.phase_completed(id),
    }
}
```

Add unit tests matching the TypeScript unlock parser tests.

- [ ] **Step 5: Add interrogation reveal helper**

In `src-tauri/src/game/reveals.rs`, add:

```rust
pub fn apply_interrogation_reveals_and_build_queue(
    scene: &mut InterrogationSceneState,
    inventory: &mut Inventory,
    trigger_body: Vec<DialogueItem>,
    reveals: &[InterrogationRevealTarget],
    chapter_id: &str,
) -> Vec<DialogueItem>
```

Behavior:

- evidence: clone from `scene.def.evidence_manifest`, add to inventory, append `on_collect` only if newly added,
- statement: clone from `scene.def.statement_manifest`, add to inventory, append `on_acquire` only if newly added,
- question: call `scene.unlock_override("question:<id>")`,
- phase: call `scene.unlock_override("phase:<id>")`.

- [ ] **Step 6: Add scene runtime variant**

In `src-tauri/src/game/scenes/mod.rs`, add:

```rust
pub mod interrogation;

#[derive(Debug, Clone)]
pub enum SceneRuntime {
    Linear(LinearSceneState),
    Investigation(Box<InvestigationSceneState>),
    Interrogation(Box<InterrogationSceneState>),
}
```

Preserve the existing `Linear` and `Investigation` variants.

- [ ] **Step 7: Run Rust tests**

Run: `cd src-tauri && cargo test game::schema game::unlock game::reveals`

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/game/schema.rs src-tauri/src/game/unlock.rs src-tauri/src/game/reveals.rs src-tauri/src/game/scenes/mod.rs
git commit -m "feat(engine): add interrogation schema primitives"
```

---

### Task 7: Implement Interrogation Runtime State And Commands

**Files:**
- Create: `src-tauri/src/game/scenes/interrogation.rs`
- Modify: `src-tauri/src/game/mod.rs`
- Modify: `src-tauri/src/game/view.rs`
- Modify: `src-tauri/src/game/error.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add runtime unit tests**

In `src-tauri/src/game/scenes/interrogation.rs`, write tests for the state object:

```rust
#[test]
fn inquiry_phase_completes_after_required_question_answered() {
    let mut scene = InterrogationSceneState::from_json(one_question_inquiry_scene(), 1);
    assert_eq!(scene.current_phase_id().as_deref(), Some("inquiry"));
    scene.record_question_answered("reason");
    scene.refresh_phase_completion(&Inventory::default());
    assert!(scene.completed_phases.contains("inquiry"));
}

#[test]
fn testimony_wrong_present_does_not_complete_phase() {
    let mut scene = InterrogationSceneState::from_json(one_testimony_scene(), 1);
    scene.record_wrong_present("cleaning_button");
    assert!(!scene.completed_phases.contains("testimony"));
}

#[test]
fn testimony_correct_present_completes_phase() {
    let mut scene = InterrogationSceneState::from_json(one_testimony_scene(), 1);
    scene.record_correct_present("testimony");
    assert!(scene.completed_phases.contains("testimony"));
}
```

Use local helper constructors inside the test module. Each helper should build minimal `InterrogationSceneJson` directly, matching the schema from Task 6.

- [ ] **Step 2: Run runtime tests and confirm failure**

Run: `cd src-tauri && cargo test game::scenes::interrogation`

Expected: failure because the module is not implemented.

- [ ] **Step 3: Implement `InterrogationSceneState`**

Create `src-tauri/src/game/scenes/interrogation.rs` with:

```rust
#[derive(Debug, Clone)]
pub struct InterrogationSceneState {
    pub def: InterrogationSceneJson,
    pub intro_played: bool,
    pub outro_played: bool,
    pub current_phase_id: Option<String>,
    pub pending_queue: Option<DialogueQueue>,
    pub intro_queue_gen: u64,
    pub completed_phases: HashSet<String>,
    pub answered_questions: HashSet<String>,
    pub pressed_statements: HashSet<String>,
    pub unlocked_overrides: HashSet<String>,
}
```

Implement:

- `from_json(def, intro_queue_gen)`,
- `id()`,
- `title()`,
- `current_phase_id()`,
- `record_question_answered(id)`,
- `record_statement_pressed(id)`,
- `record_wrong_present(statement_id)`,
- `record_correct_present(phase_id)`,
- `unlock_override(key)`,
- `is_phase_unlocked(phase, ctx)`,
- `is_question_unlocked(question, ctx)`,
- `phase_complete(phase, ctx)`,
- `outro_satisfied(ctx)`.

For v1, phase selection is ordered: choose the first unlocked incomplete required phase. Optional phase selection can be added later only with a UI plan.

- [ ] **Step 4: Add view types**

In `src-tauri/src/game/view.rs`, add:

```rust
Interrogation { phase_id: String }
```

to `ModeView`, and add:

```rust
Interrogation {
    id: String,
    title: String,
    index: usize,
    total: usize,
    current_phase_id: Option<String>,
    visible_phases: Vec<InterrogationPhaseView>,
}
```

to `SceneView`.

Define:

```rust
pub struct InterrogationPhaseView { pub id: String, pub label: String, pub kind: String, pub subject: SubjectView, pub questions: Vec<InquiryQuestionView>, pub testimony: Vec<TestimonyStatementView> }
pub struct SubjectView { pub id: String, pub name: String, pub role: String, pub bio: String }
pub struct InquiryQuestionView { pub id: String, pub label: String, pub answered: bool }
pub struct TestimonyStatementView { pub id: String, pub label: String, pub content: String, pub pressed: bool }
```

Use `#[serde(rename_all = "camelCase")]` on every struct.

- [ ] **Step 5: Add engine methods**

In `src-tauri/src/game/mod.rs`, update:

- `load_scene_runtime` to load `SceneJson::Interrogation`,
- `prime_initial_queue` for interrogation intro,
- `on_queue_exhausted` for interrogation phase advancement,
- `mode_view` to return `ModeView::Interrogation`,
- `scene_view` to expose visible phases,
- `advance_scene` to preserve existing behavior.

Add public methods:

```rust
pub fn answer_interrogation_question(&mut self, question_id: &str) -> Result<GameStateView, GameError>
pub fn press_testimony_statement(&mut self, statement_id: &str) -> Result<GameStateView, GameError>
pub fn present_testimony_item(&mut self, statement_id: &str, item_kind: &str, item_id: &str) -> Result<GameStateView, GameError>
```

Rules:

- reject if not in interrogation scene,
- reject if dialogue queue active,
- reject unknown or locked question/statement,
- wrong existing item plays wrong-present queue and leaves phase incomplete,
- correct item plays on-present plus result queue, applies result reveals, and completes the phase.

- [ ] **Step 6: Add typed errors**

In `src-tauri/src/game/error.rs`, add constructors:

```rust
unknown_interrogation_phase(id: &str)
locked_interrogation_phase(id: &str)
unknown_interrogation_question(id: &str)
locked_interrogation_question(id: &str)
unknown_testimony_statement(id: &str)
unknown_inventory_target(kind: &str, id: &str)
```

Use codes:

```rust
"unknownInterrogationPhase"
"lockedInterrogationPhase"
"unknownInterrogationQuestion"
"lockedInterrogationQuestion"
"unknownTestimonyStatement"
"unknownInventoryTarget"
```

- [ ] **Step 7: Register Tauri commands**

In `src-tauri/src/lib.rs`, add commands:

```rust
#[tauri::command]
fn answer_interrogation_question(state: tauri::State<'_, AppState>, question_id: String) -> Result<GameStateView, GameError> { ... }

#[tauri::command]
fn press_testimony_statement(state: tauri::State<'_, AppState>, statement_id: String) -> Result<GameStateView, GameError> { ... }

#[tauri::command]
fn present_testimony_item(state: tauri::State<'_, AppState>, statement_id: String, item_kind: String, item_id: String) -> Result<GameStateView, GameError> { ... }
```

Register them in `tauri::generate_handler!`.

- [ ] **Step 8: Run focused Rust tests**

Run:

```bash
cd src-tauri && cargo test interrogation
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/game src-tauri/src/lib.rs
git commit -m "feat(engine): run interrogation scenes"
```

---

### Task 8: Add Frontend Interrogation Mode

**Files:**
- Modify: `src/lib/state/types.ts`
- Modify: `src/lib/state/game-client.svelte.ts`
- Modify: `src/lib/state/mode.ts`
- Modify: `src/lib/state/mode.test.ts`
- Create: `src/lib/components/InterrogationView.svelte`
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Add mode helper test**

Add to `src/lib/state/mode.test.ts`:

```ts
it("shows the inventory panel in interrogation mode and enables reexamine", () => {
  const mode: Mode = { type: "interrogation", phaseId: "wakatsuki_testimony" };
  expect(shouldShowInventoryPanel(mode)).toBe(true);
  expect(canReexamineInventory(mode)).toBe(true);
});
```

- [ ] **Step 2: Run frontend unit tests and confirm failure**

Run: `bun run test -- src/lib/state/mode.test.ts`

Expected: TypeScript failure because `interrogation` is not in `Mode`.

- [ ] **Step 3: Update frontend types**

In `src/lib/state/types.ts`, add:

```ts
export type Mode =
  | { type: "dialogue"; current: DialogueItem; queueRemaining: number; sceneTag: string | null; queueToken: QueueToken }
  | { type: "explore"; sublocationId: string }
  | { type: "interrogation"; phaseId: string }
  | { type: "gameComplete" };

export type InterrogationPhaseView = {
  id: string;
  label: string;
  kind: "inquiry" | "testimony";
  subject: SubjectView;
  questions: InquiryQuestionView[];
  testimony: TestimonyStatementView[];
};
export type SubjectView = { id: string; name: string; role: string; bio: string };
export type InquiryQuestionView = { id: string; label: string; answered: boolean };
export type TestimonyStatementView = { id: string; label: string; content: string; pressed: boolean };
```

Add an `interrogation` variant to `SceneView`.

- [ ] **Step 4: Update mode helpers**

In `src/lib/state/mode.ts`, make `shouldShowInventoryPanel` and `canReexamineInventory` return true for `mode.type === "interrogation"`.

- [ ] **Step 5: Add client commands**

In `src/lib/state/game-client.svelte.ts`, add:

```ts
export async function answerInterrogationQuestion(questionId: string) {
  await dispatchGameCommand("answer_interrogation_question", { questionId });
}

export async function pressTestimonyStatement(statementId: string) {
  await dispatchGameCommand("press_testimony_statement", { statementId });
}

export async function presentTestimonyItem(statementId: string, itemKind: "evidence" | "statement", itemId: string) {
  await dispatchGameCommand("present_testimony_item", { statementId, itemKind, itemId });
}
```

- [ ] **Step 6: Create `InterrogationView.svelte`**

Create `src/lib/components/InterrogationView.svelte`:

```svelte
<script lang="ts">
  import type { Inventory, SceneView } from "$lib/state/types";

  let {
    scene,
    inventory,
    onAnswerQuestion,
    onPressStatement,
    onPresentItem,
    disabled,
  }: {
    scene: SceneView;
    inventory: Inventory;
    onAnswerQuestion: (questionId: string) => void | Promise<void>;
    onPressStatement: (statementId: string) => void | Promise<void>;
    onPresentItem: (statementId: string, itemKind: "evidence" | "statement", itemId: string) => void | Promise<void>;
    disabled: boolean;
  } = $props();

  const interrogationScene = $derived(scene.kind === "interrogation" ? scene : null);
  const currentPhase = $derived(
    interrogationScene?.visiblePhases.find((phase) => phase.id === interrogationScene.currentPhaseId) ?? null,
  );
</script>

{#if interrogationScene && currentPhase}
  <section class="interrogation" aria-label="interrogation">
    <header>
      <p class="eyebrow">{currentPhase.kind === "inquiry" ? "詢問" : "證詞"}</p>
      <h2>{currentPhase.label}</h2>
      <p>{currentPhase.subject.name} · {currentPhase.subject.role}</p>
    </header>

    {#if currentPhase.kind === "inquiry"}
      <div class="actions">
        {#each currentPhase.questions as question}
          <button type="button" disabled={disabled} onclick={() => onAnswerQuestion(question.id)}>
            <span>{question.label}</span>
            {#if question.answered}<small>已詢問</small>{/if}
          </button>
        {/each}
      </div>
    {:else}
      <div class="testimony">
        {#each currentPhase.testimony as statement}
          <article>
            <p>{statement.content}</p>
            <div class="row">
              <button type="button" disabled={disabled} onclick={() => onPressStatement(statement.id)}>
                {statement.pressed ? "再次追問" : "追問"}
              </button>
              {#each inventory.evidence as item}
                <button type="button" disabled={disabled} onclick={() => onPresentItem(statement.id, "evidence", item.id)}>
                  提示：{item.name}
                </button>
              {/each}
              {#each inventory.statements as item}
                <button type="button" disabled={disabled} onclick={() => onPresentItem(statement.id, "statement", item.id)}>
                  證言：{item.speaker}
                </button>
              {/each}
            </div>
          </article>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .interrogation { display: grid; gap: 16px; padding: 24px; }
  .eyebrow { margin: 0; color: #8b949e; font-size: 0.8rem; text-transform: uppercase; }
  h2 { margin: 0; }
  .actions, .testimony { display: grid; gap: 12px; }
  button { text-align: left; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  article { border: 1px solid #30363d; border-radius: 8px; padding: 12px; background: #161b22; }
</style>
```

- [ ] **Step 7: Route page rendering**

In `src/routes/+page.svelte`, import the component and commands, then add:

```svelte
{:else if gameState.value.mode.type === "interrogation"}
  <InterrogationView
    scene={gameState.value.scene}
    inventory={gameState.value.inventory}
    onAnswerQuestion={answerInterrogationQuestion}
    onPressStatement={pressTestimonyStatement}
    onPresentItem={presentTestimonyItem}
    disabled={gameState.inFlight}
  />
```

- [ ] **Step 8: Run frontend checks**

Run:

```bash
bun run test -- src/lib/state/mode.test.ts
bun run check
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib src/routes/+page.svelte
git commit -m "feat(frontend): render interrogation mode"
```

---

### Task 9: Add Playable Chapter 1 Interrogation Fixture

**Files:**
- Modify: `static/stories_plan/chapter_1/chapter.md`
- Create: `static/stories_plan/chapter_1/interrogation_scene_2.md`
- Modify: `src-tauri/tests/full_playthrough.rs`

- [ ] **Step 1: Add the chapter scene entry**

Update `static/stories_plan/chapter_1/chapter.md`:

```markdown
## Scenes
1. scene_0.md
2. investigation_scene_1.md
3. interrogation_scene_2.md
```

- [ ] **Step 2: Create the interrogation scene**

Create `static/stories_plan/chapter_1/interrogation_scene_2.md` with the valid mixed inquiry/testimony structure from Task 2. Use Chapter 1 detail-plan content:

- inquiry question: 若槻 enters storage for coffee beans,
- testimony contradiction: coffee machine cleaning log,
- correct result: KAGAMI timeline inconsistent.

If the current investigation scene does not already guarantee `coffee_machine_cleaning_log`, declare and reveal it in this interrogation scene before the testimony phase through the required inquiry. This keeps the fixture valid under conservative cross-scene validation.

- [ ] **Step 3: Compile scenes**

Run: `bun run scenes:compile`

Expected: succeeds and emits `src-tauri/resources/scenes/chapter_1/interrogation_scene_2.json`.

- [ ] **Step 4: Extend Rust full playthrough**

In `src-tauri/tests/full_playthrough.rs`, add calls after the investigation scene completes:

```rust
let view = engine.answer_interrogation_question("entered_storage").unwrap();
advance_all_dialogue(&mut engine, view);

let view = engine.press_testimony_statement("cleaning_button").unwrap();
advance_all_dialogue(&mut engine, view);

let view = engine.present_testimony_item("cleaning_button", "evidence", "discarded_beans_note").unwrap();
advance_all_dialogue(&mut engine, view);

let view = engine.present_testimony_item("cleaning_button", "evidence", "coffee_machine_cleaning_log").unwrap();
advance_all_dialogue(&mut engine, view);
```

Use the actual wrong evidence ID present in inventory if `discarded_beans_note` is not available. The assertion after correct present should confirm the engine reaches the next scene or `GameComplete`.

- [ ] **Step 5: Run acceptance tests**

Run:

```bash
bun run scenes:compile
cd src-tauri && cargo test full_playthrough
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add static/stories_plan/chapter_1/chapter.md static/stories_plan/chapter_1/interrogation_scene_2.md src-tauri/tests/full_playthrough.rs
git commit -m "test: add playable interrogation scene fixture"
```

---

### Task 10: Final Verification And Cleanup

**Files:**
- Modify only files required by failing checks.

- [ ] **Step 1: Run compiler tests**

Run:

```bash
bun test scripts/compile-scenes/parser-unlock.test.ts scripts/compile-scenes/parser-interrogation.test.ts scripts/compile-scenes/emitter.test.ts scripts/compile-scenes/validator.test.ts scripts/compile-scenes/compile-scenes.test.ts
```

Expected: pass.

- [ ] **Step 2: Run frontend tests and checks**

Run:

```bash
bun run test
bun run check
bun run build
```

Expected: pass.

- [ ] **Step 3: Run Rust checks**

Run:

```bash
cd src-tauri && cargo test && cargo check
```

Expected: pass.

- [ ] **Step 4: Run compile and packaged resource check**

Run:

```bash
bun run scenes:compile
bun run tauri build
```

Expected: scenes compile and Tauri build completes. If local packaging fails for signing or host-specific bundling, capture the exact error and still report the previous successful `bun run build`, `cargo test`, and `cargo check` evidence.

- [ ] **Step 5: Inspect git status**

Run: `git status -sb`

Expected: only intentional changed files are present.

- [ ] **Step 6: Commit final fixes if any**

If Step 1-4 required fixes after Task 9, return to the task whose files failed, rerun that task's verification command, and use that task's explicit staging command. Then commit with:

```bash
git commit -m "fix: complete interrogation scene verification"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage: Tasks 1-4 cover compiler schema, parsing, emission, validation, manifests, and cross-scene inventory. Task 5 covers authoring skill. Tasks 6-7 cover Rust schema, unlock, reveals, runtime, commands, and typed errors. Task 8 covers frontend mode, commands, and inventory visibility. Task 9 covers a playable mixed inquiry/testimony scene. Task 10 covers final verification.
- Placeholder scan: no unresolved implementation markers are intentionally left in this plan.
- Type consistency: TypeScript names use `InterrogationUnlockExpr`, `InterrogationRevealTarget`, `InventoryTarget`, `ASTInterrogationScene`, and `JSONInterrogationScene`; Rust mirrors these as `InterrogationUnlockExpr`, `InterrogationRevealTarget`, `InventoryTarget`, and `InterrogationSceneJson`.
- Scope check: inquiry and testimony remain phase kinds inside one scene type; deduction slots, penalties, and courtroom-specific UI are not included.
