# Interrogation Cross-Examination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two interrogation phase kinds (inquiry + testimony) with a single cross-examinable inquiry model where every question's answer is a testimony the player cross-examines line-by-line, presenting evidence to break a lie and unlock follow-ups.

**Architecture:** Author markdown → compiler (parser/validator/emitter) emits new `interrogation` JSON → Rust runtime deserializes it, drives a per-line cross-examination state machine, and returns a view → SvelteKit `InterrogationView` renders the menu / playback / evidence-tray states, delivering all suspect/detective speech through the existing `DialogueBox`. Built strictly bottom-up: nothing downstream compiles until the layer below emits the new shape.

**Tech Stack:** TypeScript (Vitest) for `packages/scripts` compiler; Rust (Tauri 2, `cargo test`) for the engine; Svelte 5 runes + Vitest for the frontend; markdown for authored scenes and the writing skill.

**Reference spec:** `docs/superpowers/specs/2026-07-04-interrogation-cross-examination-design.md` (authoritative for the format and flow; this plan implements it).

## Global Constraints

- Package manager **bun@1.3.1**; run compiler tests with `bun run --cwd packages/scripts test <file>` and type-check with `bun run check:scripts`.
- **SPA-only**: no SSR, no `+page.server.ts`/`+server.ts`. Frontend↔Rust is `invoke("command_name", { camelCaseArgs })`; Tauri converts JS camelCase keys to Rust snake_case params.
- All serializable Rust domain types in `schema.rs`/`view.rs` use `#[serde(rename_all = "camelCase")]`; new Rust commands return `Result<T, GameError>` and are registered in `tauri::generate_handler![...]` in `apps/game/src-tauri/src/lib.rs`.
- **Do NOT** add interrogation types to `@lyra/scene-types` (same exception as `DialogueItem`); they stay compiler-internal (`packages/scripts/compile-scenes/types.ts`) + Rust.
- **Never hand-edit** generated JSON under `apps/game/src-tauri/resources/`; regenerate with `bun run scenes:compile`.
- Player-facing scene text is **Traditional Chinese**; field labels/reserved values are English.
- **Contradiction-reachability guarantee** must hold: a required breakthrough's `Contradiction` must be provably satisfiable with guaranteed-available inventory (the "Beat-10 compile trap" — reveals only reachable through an *optional* breakthrough are NOT guaranteed downstream).
- Commit after every green task. Conventional-commit messages. Work stays on branch `interrogation-cross-examination`.

---

## File Structure

**Compiler (`packages/scripts/compile-scenes/`)**
- `types.ts` — AST + JSON interrogation types (rewrite the inquiry/testimony section).
- `parser-interrogation.ts` — parse `## Phase → ### Question → #### Testimony → ##### Line`.
- `emitter.ts` — emit `JSONInterrogationScene` (interrogation branch only).
- `validator.ts` — structural checks + `analyzeInterrogationInventory` guarantee retarget.
- `__fixtures__/valid_interrogation/`, `__fixtures__/invalid/<case>/` — rewritten + new fixtures.

**Rust runtime (`apps/game/src-tauri/src/game/`)**
- `schema.rs` — deserialization types (remove testimony variant; add testimony-line model).
- `scenes/interrogation.rs` — cross-examination state machine + completion.
- `view.rs` — `SceneView::Interrogation` view + new cross-exam sub-view; `ModeView::Interrogation`.
- `mod.rs` — view builder + IPC command bodies.
- `lib.rs` — `generate_handler!` registration.
- `reveals.rs` / `unlock.rs` — reuse; `question:<id> answered` ⇒ "broken".

**Frontend (`apps/game/src/`)**
- `lib/state/types.ts` — view/mode TS types.
- `lib/state/game-client.svelte.ts` — IPC wrappers.
- `lib/state/mode.ts` — mode predicates.
- `lib/components/InterrogationView.svelte` — cross-examination surface.
- `lib/audio/sfx-events.ts` — challenge/correct/wrong/loop cues.
- `routes/+page.svelte` — mode wiring.

**Skill + sample**
- `.claude/skills/writing-interrogation-scene/SKILL.md` — rewrite.
- `static/stories_plan/chapter_<N>/interrogation_scene_<K>.md` — a smoke-test sample (if a suitable chapter exists).

---

## PHASE 1 — Compiler

### Task 1: New interrogation AST + JSON types

**Files:**
- Modify: `packages/scripts/compile-scenes/types.ts:245-310` (AST), `:438-505` (JSON)
- Test: covered by Task 2/3 fixtures (type-only change; `bun run check:scripts` gates it)

**Interfaces — Produces (used by Tasks 2,3,4):**

```ts
// AST — replaces ASTInterrogationPhase union, ASTTestimonyPhase/Statement/Result,
// and the ASTInquiryQuestion follow-up fields.
export type ASTInterrogationPhase = ASTInquiryPhase; // testimony kind removed

export type ASTInquiryPhase = Located<{
  kind: "inquiry";
  id: string; label: string; subject: ASTSubject;
  required: boolean; status: "locked" | "unlocked";
  unlock: InterrogationUnlockExpr | null;
  reveals: InterrogationRevealTarget[];
  sceneTag: string; assetCue: VisualAssetCue | null;
  entryDialogue: DialogueItem[];
  complete: "auto" | InterrogationUnlockExpr;
  questions: ASTInquiryQuestion[];
}>;

export type ASTInquiryQuestion = Located<{
  id: string; label: string;
  status: "locked" | "unlocked"; required: boolean;
  unlock: InterrogationUnlockExpr | null;
  reveals: InterrogationRevealTarget[];
  testimony: ASTTestimony;
}>;

export type ASTTestimony = Located<{
  onLoop: DialogueItem[];                 // required
  defaultChallenge: DialogueItem[] | null;
  defaultWrong: DialogueItem[] | null;
  lines: ASTTestimonyLine[];              // >= 1
}>;

export type ASTTestimonyLine = Located<{
  id: string; label: string;
  content: DialogueItem[];                // the suspect's line(s), played as dialogue
  contradiction: InventoryTarget | null;
  challenge: DialogueItem[] | null;       // required iff contradiction != null
  onCorrect: DialogueItem[] | null;       // required iff contradiction != null
  onWrongEvidence: DialogueItem[] | null; // required iff contradiction != null
  reveals: InterrogationRevealTarget[];   // applied on correct present
}>;

// JSON — mirror with JSONDialogueItem, single-kind phase.
export type JSONInterrogationPhase = {
  kind: "inquiry";
  id: string; label: string; subject: JSONSubject;
  required: boolean; status: "locked" | "unlocked";
  unlock: InterrogationUnlockExpr | null;
  reveals: InterrogationRevealTarget[];
  sceneTag: string; backgroundAssetId: string | null;
  bgm: AudioCue | null; bgs: AudioCue | null;
  entryDialogue: JSONDialogueItem[];
  complete: "auto" | InterrogationUnlockExpr;
  questions: JSONInquiryQuestion[];
};
export type JSONInquiryQuestion = {
  id: string; label: string;
  status: "locked" | "unlocked"; required: boolean;
  unlock: InterrogationUnlockExpr | null;
  reveals: InterrogationRevealTarget[];
  testimony: JSONTestimony;
};
export type JSONTestimony = {
  onLoop: JSONDialogueItem[];
  defaultChallenge: JSONDialogueItem[] | null;
  defaultWrong: JSONDialogueItem[] | null;
  lines: JSONTestimonyLine[];
};
export type JSONTestimonyLine = {
  id: string; label: string;
  content: JSONDialogueItem[];
  contradiction: InventoryTarget | null;
  challenge: JSONDialogueItem[] | null;
  onCorrect: JSONDialogueItem[] | null;
  onWrongEvidence: JSONDialogueItem[] | null;
  reveals: InterrogationRevealTarget[];
};
```

- [ ] **Step 1: Delete removed types.** In `types.ts` remove `ASTTestimonyPhase`, `ASTTestimonyStatement`, `ASTTestimonyResult`, `JSONTestimonyStatement`, `JSONTestimonyResult`, the `kind`/`parentQuestionId`/`answerDialogue`/`onReask` fields of `ASTInquiryQuestion`, and the `testimony` union arm of `JSONInterrogationPhase`.

- [ ] **Step 2: Add the new types** exactly as in the Interfaces block above (both AST and JSON). Keep `ASTSubject`, `JSONSubject`, `InterrogationUnlockExpr`, `InterrogationRevealTarget`, `InventoryTarget` as-is.

- [ ] **Step 3: Type-check.** Run: `bun run check:scripts`
  Expected: FAIL — parser/emitter/validator still reference removed types (expected; fixed in Tasks 2–4). Note the referencing sites; they are the checklist for the next tasks.

- [ ] **Step 4: Commit.**
```bash
git add packages/scripts/compile-scenes/types.ts
git commit -m "refactor(compiler): unify interrogation AST/JSON types to testimony-line model"
```

---

### Task 2: Parser — Question → Testimony → Line

**Files:**
- Modify: `packages/scripts/compile-scenes/parser-interrogation.ts` (rewrite `parseInquiryPhase`; delete `parseTestimonyPhase`, `Follow-up:`/`On Reask` handling; add `parseTestimony`, `parseTestimonyLine`; update the header doc comment)
- Create: `packages/scripts/__fixtures__/valid_interrogation_xexam/` (input `.md` + is compiled by the test)
- Test: `packages/scripts/compile-scenes/parser-interrogation.test.ts` (add cases; create if absent)

**Interfaces — Consumes:** Task 1 AST types. **Produces (used by Task 3,4):** `parseInterrogationScene` now returns `ASTInterrogationScene` whose phases are `ASTInquiryPhase` with `questions[].testimony`.

- [ ] **Step 1: Write the failing test.** Add to `parser-interrogation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseInterrogationScene } from "./parser-interrogation";

const SRC = `# Scene 1: 訊問

## Intro

## Phase: 訊問若槻 {#press}
- **Kind:** inquiry
[場景：審訊室、深夜]

### Subject: 若槻悠真 {#wakatsuki}
- **Role:** 清掃員
- **Bio:** 值夜班的清潔工。

### Question: 當晚行蹤 {#alibi}
- **Status:** unlocked

#### Testimony
- **On Loop:** **相馬律**：還有哪裡對不上。再說一次。

##### Line: 下班時間 {#l_off}
**若槻悠真**：八點就下班了。

##### Line: 否認接觸 {#l_deny}
**若槻悠真**：那台機器我根本沒碰過。
- **Contradiction:** evidence:cleaning_log
- **Challenge:** **相馬律**：這句話對不上。
- **On Correct:** **若槻悠真**：好吧，我碰過。
  - **Reveals:** [question:cleaning_time]
- **On Wrong Evidence:** **若槻悠真**：這能證明什麼？

### Question: 追問清掃 {#cleaning_time}
- **Status:** locked
#### Testimony
- **On Loop:** **相馬律**：別想混過去。
##### Line: 交代 {#l_ct}
**若槻悠真**：我只是忘了關電源。

## Evidence Manifest

## Statement Manifest

## Outro
`;

it("parses questions with testimony lines and contradiction metadata", () => {
  const res = parseInterrogationScene(SRC, "interrogation_scene_1.md");
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  const phase = res.value.phases[0];
  expect(phase.kind).toBe("inquiry");
  const q = phase.questions[0];
  expect(q.id).toBe("alibi");
  expect(q.testimony.onLoop.length).toBeGreaterThan(0);
  expect(q.testimony.lines.map((l) => l.id)).toEqual(["l_off", "l_deny"]);
  const deny = q.testimony.lines[1];
  expect(deny.contradiction).toEqual({ kind: "evidence", id: "cleaning_log" });
  expect(deny.challenge).not.toBeNull();
  expect(deny.onCorrect).not.toBeNull();
  expect(deny.onWrongEvidence).not.toBeNull();
  expect(deny.reveals).toContainEqual({ kind: "question", id: "cleaning_time" });
  expect(phase.questions[1].status).toBe("locked");
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `bun run --cwd packages/scripts test parser-interrogation`
  Expected: FAIL (parser still emits `answerDialogue`/testimony phases; `testimony` undefined).

- [ ] **Step 3: Rewrite the parser.** In `parser-interrogation.ts`:
  - Update the top doc comment's heading table to: `H3: ### Subject: | ### Question:` · `H4: #### Testimony` · `H5: ##### Line:`.
  - In `parsePhase`, remove the `testimony` dispatch; every phase is inquiry. Delete `parseTestimonyPhase` and its statement/result helpers.
  - Rewrite `parseInquiryPhase` so each `### Question:` requires one `#### Testimony` child and no longer parses `#### Follow-up:` / `On Reask` / `answerDialogue`.
  - Add helpers (place after `parseSubject`):

```ts
function parseTestimony(
  cur: Cursor,
  ctx: ParseCtx,
): { ok: true; value: ASTTestimony } | { ok: false; error: CompileError } {
  const start = cur.token(); // at the "#### Testimony" heading
  let onLoop: DialogueItem[] = [];
  let defaultChallenge: DialogueItem[] | null = null;
  let defaultWrong: DialogueItem[] | null = null;
  const lines: ASTTestimonyLine[] = [];
  cur.advance();
  // metadata fields on the Testimony block
  for (const field of readFieldList(cur)) {
    if (field.key === "On Loop") onLoop = field.dialogue;
    else if (field.key === "Default Challenge") defaultChallenge = field.dialogue;
    else if (field.key === "Default Wrong") defaultWrong = field.dialogue;
    else return err(field.line, "interrogationBadTestimonyField", `Unknown Testimony field "${field.key}".`);
  }
  if (onLoop.length === 0)
    return err(start.line, "interrogationMissingOnLoop", "#### Testimony requires On Loop dialogue.");
  while (cur.token()?.kind === "h5" && cur.token()!.text.startsWith("Line:")) {
    const line = parseTestimonyLine(cur, ctx);
    if (!line.ok) return line;
    lines.push(line.value);
  }
  if (lines.length === 0)
    return err(start.line, "interrogationEmptyTestimony", "#### Testimony needs at least one ##### Line.");
  return { ok: true, value: located(start, { onLoop, defaultChallenge, defaultWrong, lines }) };
}

function parseTestimonyLine(
  cur: Cursor,
  ctx: ParseCtx,
): { ok: true; value: ASTTestimonyLine } | { ok: false; error: CompileError } {
  const head = cur.token()!; // "##### Line: <label> {#id}"
  const { label, id } = parseHeadingLabelAndAnchor(head, "Line");
  cur.advance();
  const content = readLeadingDialogue(cur); // bold-label suspect line(s) before any "- **" field
  if (content.length === 0)
    return err(head.line, "interrogationEmptyLine", `##### Line "${id}" needs suspect dialogue.`);
  let contradiction: InventoryTarget | null = null;
  let challenge: DialogueItem[] | null = null;
  let onCorrect: DialogueItem[] | null = null;
  let onWrongEvidence: DialogueItem[] | null = null;
  let reveals: InterrogationRevealTarget[] = [];
  for (const field of readFieldList(cur)) {
    switch (field.key) {
      case "Contradiction": contradiction = parseInventoryTarget(field.value, field.line); break;
      case "Challenge": challenge = field.dialogue; break;
      case "On Correct":
        onCorrect = field.dialogue;
        reveals = field.nestedReveals ?? []; // "- **Reveals:** [...]" nested under On Correct
        break;
      case "On Wrong Evidence": onWrongEvidence = field.dialogue; break;
      default: return err(field.line, "interrogationBadLineField", `Unknown Line field "${field.key}".`);
    }
  }
  if (contradiction !== null) {
    if (!challenge) return err(head.line, "interrogationMissingChallenge", `Line "${id}" with Contradiction needs Challenge.`);
    if (!onCorrect) return err(head.line, "interrogationMissingOnCorrect", `Line "${id}" with Contradiction needs On Correct.`);
    if (!onWrongEvidence) return err(head.line, "interrogationMissingOnWrongEvidence", `Line "${id}" with Contradiction needs On Wrong Evidence.`);
  }
  return { ok: true, value: located(head, { id, label, content, contradiction, challenge, onCorrect, onWrongEvidence, reveals }) };
}
```

  Reuse the file's existing dialogue/field/heading helpers (`readFieldList`, `readLeadingDialogue`, `parseInventoryTarget`, `parseHeadingLabelAndAnchor`, `located`, `err`); if a helper name differs, adapt to the existing one rather than inventing a new API. `nestedReveals` on a field is how the parser already threads `- **Reveals:**` under `On Correct` (mirror the pre-rewrite On-Correct/Result reveals handling).

- [ ] **Step 4: Run to verify it passes.** Run: `bun run --cwd packages/scripts test parser-interrogation`
  Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/scripts/compile-scenes/parser-interrogation.ts packages/scripts/compile-scenes/parser-interrogation.test.ts
git commit -m "feat(compiler): parse interrogation questions as cross-examinable testimonies"
```

---

### Task 3: Emitter — new interrogation JSON

**Files:**
- Modify: `packages/scripts/compile-scenes/emitter.ts` (interrogation branch)
- Test: `packages/scripts/compile-scenes/emitter.test.ts` (add case)

**Interfaces — Consumes:** Task 1 JSON types, Task 2 AST. **Produces:** `JSONInterrogationScene` with `phases[].questions[].testimony.lines[]`.

- [ ] **Step 1: Write the failing test.** Compile the Task-2 `SRC` through the full `compile`/emit path (mirror the existing emitter test harness) and assert:

```ts
it("emits interrogation testimony lines with contradiction + reveals", () => {
  const json = emitInterrogationFixture(); // helper: parse SRC then emit (copy pattern from existing test)
  const phase = json.phases[0];
  expect(phase.kind).toBe("inquiry");
  const deny = phase.questions[0].testimony.lines[1];
  expect(deny.contradiction).toEqual({ kind: "evidence", id: "cleaning_log" });
  expect(deny.onCorrect?.length).toBeGreaterThan(0);
  expect(deny.reveals).toContainEqual({ kind: "question", id: "cleaning_time" });
  expect(phase.questions[0].testimony.onLoop.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `bun run --cwd packages/scripts test emitter`
  Expected: FAIL (emitter emits removed testimony shape / references deleted types).

- [ ] **Step 3: Rewrite the emitter interrogation branch.** Map AST→JSON 1:1 with `emitDialogue(...)` for every dialogue array (`onLoop`, `defaultChallenge`, `defaultWrong`, each line's `content`/`challenge`/`onCorrect`/`onWrongEvidence`), pass `contradiction`/`reveals` through unchanged, and drop the testimony-phase/statement/result emit code. Emit `backgroundAssetId`/`bgm`/`bgs` for the phase exactly as the pre-rewrite inquiry branch did.

- [ ] **Step 4: Run to verify it passes.** Run: `bun run --cwd packages/scripts test emitter`
  Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/scripts/compile-scenes/emitter.ts packages/scripts/compile-scenes/emitter.test.ts
git commit -m "feat(compiler): emit unified interrogation testimony-line JSON"
```

---

### Task 4: Validator — structural checks + contradiction guarantee

**Files:**
- Modify: `packages/scripts/compile-scenes/validator.ts` (interrogation section + `analyzeInterrogationInventory`)
- Create: `packages/scripts/__fixtures__/invalid/interrogation_unguaranteed_contradiction/` (+ `expected-error.txt`), `.../invalid/interrogation_missing_on_correct/` (+ `expected-error.txt`)
- Test: `packages/scripts/compile-scenes/validator.test.ts` (add cases) + the fixture-driven invalid suite

**Interfaces — Consumes:** Tasks 1–3. **Produces:** validated `ASTInterrogationScene`; `question:<id> answered` predicate keyed by question break.

- [ ] **Step 1: Write the failing tests.** Add positive + negative cases:

```ts
it("rejects a contradiction line missing On Correct", () => {
  const res = compileSource(MISSING_ON_CORRECT_SRC); // Contradiction present, no On Correct
  expect(res.ok).toBe(false);
  if (res.ok) return;
  expect(res.errors[0].code).toBe("interrogationMissingOnCorrect");
});

it("rejects a required breakthrough whose contradiction is never guaranteed", () => {
  const res = compileSource(UNGUARANTEED_SRC); // Contradiction: evidence:x, x never collected in any guaranteed path
  expect(res.ok).toBe(false);
  if (res.ok) return;
  expect(res.errors.some((e) => e.code === "interrogationUnguaranteedContradiction")).toBe(true);
});

it("accepts a contradiction satisfied by a guaranteed prior-scene evidence", () => {
  const res = compileCorpus(GUARANTEED_CORPUS); // evidence collected in an earlier guaranteed scene
  expect(res.ok).toBe(true);
});
```

- [ ] **Step 2: Run to verify they fail.** Run: `bun run --cwd packages/scripts test validator`
  Expected: FAIL.

- [ ] **Step 3: Retarget the validator.** In `validator.ts`:
  - **ID uniqueness:** collect ids for phases, questions, and testimony **lines** (replace the testimony-statement/result id collection). Keep evidence/statement manifest id checks.
  - **Reveal/unlock resolution:** `interrogationRevealKey` and reference resolution now walk `phase.questions[].testimony.lines[].reveals` and `.onCorrect`, and question-level `reveals`. A `question:<id> answered` unlock/complete predicate resolves against question ids (satisfied when the question is broken at runtime).
  - **Reachability:** locked questions must be unlockable via a `Reveals:[question:id]` chain (from a line `onCorrect` or a question `reveals`) or an `Unlock` expr — reuse the existing locked-block reachability pass, feeding it the new reveal edges.
  - **Guarantee (`analyzeInterrogationInventory`, both default and `mode:"guaranteed"`):** a line's `Contradiction` is *challengeable* once its question is reachable; the challenge is *satisfiable* only if the `Contradiction` target is in the guaranteed inventory at that point (from `guaranteedInventoryBeforeScene` or an earlier guaranteed breakthrough's `onCorrect` reveals in this scene). For each **required** phase, require ≥1 reachable line whose `Contradiction` is guaranteed-satisfiable and whose `onCorrect` fires; otherwise emit `interrogationUnguaranteedContradiction`. In the `guaranteed` pass, a line's `onCorrect` reveals count as guaranteed **only** if that line is the required, guaranteed breakthrough (optional breakthroughs do not propagate guaranteed inventory — preserve the current testimony behavior).
  - Add the structural error codes surfaced by the parser in Task 2 to the error catalog/tests if the validator re-checks them.

- [ ] **Step 4: Run to verify they pass.** Run: `bun run --cwd packages/scripts test validator`
  Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/scripts/compile-scenes/validator.ts packages/scripts/compile-scenes/validator.test.ts packages/scripts/__fixtures__/invalid/interrogation_*
git commit -m "feat(compiler): validate testimony-line contradictions and reachability guarantee"
```

---

### Task 5: Rewrite interrogation fixtures + full compile

**Files:**
- Modify: `packages/scripts/__fixtures__/valid_interrogation/` (rewrite to new format), any other interrogation fixtures referenced by tests
- Test: existing compiler suite + `bun run scenes:compile` + `bun run check:scripts`

- [ ] **Step 1: Rewrite `valid_interrogation/` inputs** to the Question→Testimony→Line format (use the spec §3 skeleton as the template). Delete `### Testimony`/`#### Statement:`/`### Result:` blocks.

- [ ] **Step 2: Run the full compiler suite.** Run: `bun run --cwd packages/scripts test`
  Expected: PASS (all interrogation tests green).

- [ ] **Step 3: Type-check scripts.** Run: `bun run check:scripts`
  Expected: PASS (no dangling references to removed types).

- [ ] **Step 4: One-shot compile.** Run: `bun run scenes:compile`
  Expected: success; no interrogation scenes in the live tree yet, so this proves the pipeline builds.

- [ ] **Step 5: Commit.**
```bash
git add packages/scripts/__fixtures__
git commit -m "test(compiler): port interrogation fixtures to cross-examination format"
```

---

## PHASE 2 — Rust runtime

### Task 6: Deserialization schema

**Files:**
- Modify: `apps/game/src-tauri/src/game/schema.rs:389-475` (interrogation types)

**Interfaces — Produces (used by Tasks 7–9):**

```rust
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum InterrogationPhaseJson {
    Inquiry {
        id: String, label: String, subject: SubjectJson,
        required: bool, status: LockStatus,
        unlock: Option<InterrogationUnlockExpr>,
        reveals: Vec<InterrogationRevealTarget>,
        scene_tag: String,
        #[serde(flatten)] flattened_asset_cue: VisualAssetCueJson,
        entry_dialogue: Vec<DialogueItem>,
        complete: InterrogationOutroUnlock,
        questions: Vec<InquiryQuestionJson>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InquiryQuestionJson {
    pub id: String, pub label: String,
    pub status: LockStatus, pub required: bool,
    pub unlock: Option<InterrogationUnlockExpr>,
    pub reveals: Vec<InterrogationRevealTarget>,
    pub testimony: TestimonyJson,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestimonyJson {
    pub on_loop: Vec<DialogueItem>,
    #[serde(default)] pub default_challenge: Vec<DialogueItem>,
    #[serde(default)] pub default_wrong: Vec<DialogueItem>,
    pub lines: Vec<TestimonyLineJson>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestimonyLineJson {
    pub id: String, pub label: String,
    pub content: Vec<DialogueItem>,
    pub contradiction: Option<InventoryTarget>,
    #[serde(default)] pub challenge: Vec<DialogueItem>,
    #[serde(default)] pub on_correct: Vec<DialogueItem>,
    #[serde(default)] pub on_wrong_evidence: Vec<DialogueItem>,
    #[serde(default)] pub reveals: Vec<InterrogationRevealTarget>,
}
```

- [ ] **Step 1: Replace types.** Remove `InterrogationPhaseJson::Testimony`, `TestimonyStatementJson`, `TestimonyResultJson`, `InquiryQuestionKind`, and `InquiryQuestionJson`'s `kind`/`parent_question_id`/`answer_dialogue`/`on_reask`; add the types above. Keep `SubjectJson`.

- [ ] **Step 2: Simplify phase accessors.** In `scenes/interrogation.rs`, `phase_id`/`phase_label`/`phase_required`/`phase_status`/`phase_unlock` now match a single `Inquiry {..}` arm (drop the `Testimony` arm). `InterrogationPhaseJson::visual_asset_cue` likewise.

- [ ] **Step 3: Compile.** Run: `cargo check --manifest-path apps/game/src-tauri/Cargo.toml`
  Expected: FAIL — engine/view/mod still reference removed types (expected; fixed in Tasks 7–9).

- [ ] **Step 4: Commit.**
```bash
git add apps/game/src-tauri/src/game/schema.rs apps/game/src-tauri/src/game/scenes/interrogation.rs
git commit -m "refactor(engine): deserialize unified interrogation testimony-line schema"
```

---

### Task 7: Cross-examination state machine

**Files:**
- Modify: `apps/game/src-tauri/src/game/scenes/interrogation.rs` (state fields + methods + rewrite the `#[cfg(test)]` module)

**Interfaces — Produces (used by Tasks 8,9):**

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CrossExam {
    Idle,                                                    // question menu
    Playing { question_id: String, line_index: usize },     // showing a line + controls
    Presenting { question_id: String, line_id: String },    // evidence tray open
}

impl InterrogationSceneState {
    pub fn cross_exam(&self) -> &CrossExam;
    pub fn question<'a>(&'a self, id: &str) -> Option<&'a InquiryQuestionJson>;
    pub fn line<'a>(&'a self, question_id: &str, line_id: &str) -> Option<&'a TestimonyLineJson>;
    pub fn is_question_broken(&self, id: &str) -> bool;      // -> question:<id> answered predicate
    pub fn begin_question(&mut self, question_id: &str);     // CrossExam=Playing{q,0}
    pub fn advance_line(&mut self) -> AdvanceOutcome;        // NextLine{index} | Loop
    pub fn begin_present(&mut self, line_id: &str);          // Playing -> Presenting
    pub fn record_break(&mut self, question_id: &str);       // broken_questions.insert; CrossExam=Idle
    pub fn return_to_line(&mut self);                        // Presenting -> Playing at same line
    pub fn withdraw(&mut self);                              // CrossExam=Idle
}

pub enum AdvanceOutcome { NextLine(usize), Loop }
```

- [ ] **Step 1: Write failing unit tests.** Replace the testimony tests in the `#[cfg(test)]` module with:

```rust
#[test]
fn advance_past_last_line_loops() {
    let mut scene = InterrogationSceneState::from_json(two_line_question_scene(), 1);
    scene.begin_question("alibi");
    assert_eq!(*scene.cross_exam(), CrossExam::Playing { question_id: "alibi".into(), line_index: 0 });
    assert!(matches!(scene.advance_line(), AdvanceOutcome::NextLine(1)));
    assert!(matches!(scene.advance_line(), AdvanceOutcome::Loop));
    assert_eq!(*scene.cross_exam(), CrossExam::Playing { question_id: "alibi".into(), line_index: 0 });
}

#[test]
fn recording_break_marks_question_and_returns_to_menu() {
    let mut scene = InterrogationSceneState::from_json(two_line_question_scene(), 1);
    scene.begin_question("alibi");
    scene.begin_present("l_deny");
    scene.record_break("alibi");
    assert!(scene.is_question_broken("alibi"));
    assert_eq!(*scene.cross_exam(), CrossExam::Idle);
}

#[test]
fn wrong_present_returns_to_same_line() {
    let mut scene = InterrogationSceneState::from_json(two_line_question_scene(), 1);
    scene.begin_question("alibi");
    scene.advance_line(); // now at line 1 (l_deny)
    scene.begin_present("l_deny");
    scene.return_to_line();
    assert_eq!(*scene.cross_exam(), CrossExam::Playing { question_id: "alibi".into(), line_index: 1 });
}

#[test]
fn phase_completes_when_all_required_questions_broken() {
    let mut scene = InterrogationSceneState::from_json(two_line_question_scene(), 1);
    scene.record_break("alibi");
    scene.refresh_phase_completion(&Inventory::default());
    assert!(scene.completed_phases.contains("press"));
}
```

  Add a `two_line_question_scene()` builder (adapt the removed `one_question_inquiry_scene`/`one_testimony_scene` builders to the new schema; question `alibi` with lines `l_off` (no contradiction) and `l_deny` (contradiction `evidence:cleaning_log`, non-empty `on_correct`/`challenge`/`on_wrong_evidence`), phase id `press`).

- [ ] **Step 2: Run to verify they fail.** Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml scenes::interrogation`
  Expected: FAIL (types/methods absent).

- [ ] **Step 3: Implement.** In `InterrogationSceneState`: remove `pressed_statements`, `wrong_presented_statements`; add `cross_exam: CrossExam` (default `Idle`) and `broken_questions: HashSet<String>`. Implement the methods above. `advance_line`: increment `line_index`; if it reaches `lines.len()`, reset to 0 and return `Loop`, else return `NextLine(index)`. `phase_complete` for `Inquiry`: `Auto` ⇒ all `required` questions are in `broken_questions` **and** no unlocked-unanswered required question remains (a question with no contradiction line is "broken" once fully advanced — track via `begin_question`/full-loop, OR treat a no-contradiction question as auto-broken on first `begin_question`; choose the latter for simplicity and note it in the doc comment). `Expr` ⇒ evaluate against the context. Update `InterrogationSceneAndInventoryCtx::question_answered` to call `is_question_broken`.

- [ ] **Step 4: Run to verify they pass.** Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml scenes::interrogation`
  Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add apps/game/src-tauri/src/game/scenes/interrogation.rs
git commit -m "feat(engine): cross-examination state machine (play/present/break/loop)"
```

---

### Task 8: View model + builder

**Files:**
- Modify: `apps/game/src-tauri/src/game/view.rs:191-233` (view types), `apps/game/src-tauri/src/game/mod.rs:1820-1889` (builder)

**Interfaces — Produces (used by Task 9 + frontend):**

```rust
// view.rs
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterrogationPhaseView {
    pub id: String, pub label: String,
    pub subject: SubjectView,
    pub questions: Vec<InquiryQuestionView>,
    pub cross_exam: Option<CrossExamView>, // Some when a testimony is active
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InquiryQuestionView { pub id: String, pub label: String, pub broken: bool }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossExamView {
    pub question_id: String,
    pub line_id: String,
    pub line_label: String,
    pub line_content: Vec<DialogueItem>, // echoed current line, rendered in DialogueBox styling
    pub line_index: usize,
    pub line_total: usize,
    pub presenting: bool,                // true => show evidence tray
}
```

- [ ] **Step 1: Write a failing view test** (in `mod.rs` tests or a view test): after `begin_question("alibi")`, building the view yields `SceneView::Interrogation` whose current phase `cross_exam` is `Some` with `line_index == 0`, `presenting == false`, and `questions` includes `alibi` with `broken == false`.

- [ ] **Step 2: Run to verify it fails.** Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml interrogation_view`
  Expected: FAIL.

- [ ] **Step 3: Implement.** Remove `InquiryQuestionView.answered`→add `broken`; delete `TestimonyStatementView`; add `CrossExamView`. In the `mod.rs` builder, drop the `Testimony` match arm, map questions with `broken: scene.is_question_broken(id)` and `is_question_unlocked` filtering, and build `cross_exam` from `scene.cross_exam()` (looking up the active question/line and echoing `line_content`). Keep `ModeView::Interrogation` as-is (the sub-state lives in `SceneView`).

- [ ] **Step 4: Run to verify it passes.** Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml interrogation_view`
  Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add apps/game/src-tauri/src/game/view.rs apps/game/src-tauri/src/game/mod.rs
git commit -m "feat(engine): interrogation view with cross-examination sub-state"
```

---

### Task 9: IPC commands

**Files:**
- Modify: `apps/game/src-tauri/src/game/mod.rs` (replace `answer_interrogation_question`/`press_testimony_statement`/`present_testimony_item` with the new engine methods + command bodies), `apps/game/src-tauri/src/lib.rs` (`generate_handler!`)

**Interfaces — Produces (used by frontend):** commands (JS name → Rust fn):
- `ask_interrogation_question` ← `{ questionId }`
- `proceed_interrogation_line` ← `{}`
- `challenge_interrogation_line` ← `{ lineId }`
- `present_interrogation_evidence` ← `{ lineId, itemKind: "evidence"|"statement", itemId }`
- `withdraw_interrogation` ← `{}`
Each returns `Result<GameStateView, GameError>`.

- [ ] **Step 1: Write failing command tests** (mirror the existing engine-command tests): asking a question installs line 0's `content` as a dialogue queue (mode `Dialogue`); after draining, mode is `Interrogation` with `cross_exam.line_index == 0`. Challenging installs the `challenge` lead-in and, after draining, sets `presenting == true`. Presenting the correct `evidence:cleaning_log` on `l_deny` installs `on_correct`, applies reveals (unlocks `cleaning_time`), marks `alibi` broken, and returns to menu. Presenting wrong evidence installs `on_wrong_evidence` and returns to the same line.

- [ ] **Step 2: Run to verify they fail.** Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml interrogation_cmd`
  Expected: FAIL.

- [ ] **Step 3: Implement the command bodies** on the engine, reusing the existing pattern from the old `answer_interrogation_question` (snapshot → guard dialogue-active → mutate → `install_scene_queue`/`on_queue_exhausted` → `refresh_phase_completion` → `restore_on_error`):
  - `ask`: guard not mid-dialogue; `begin_question`; enqueue line-0 `content`.
  - `proceed`: `advance_line`; on `NextLine(i)` enqueue that line's `content`; on `Loop` enqueue `on_loop` then wrap.
  - `challenge`: require `Playing`; `begin_present`; enqueue the line's `challenge` (fallback `testimony.default_challenge`).
  - `present`: require `Presenting`; if `itemKind/itemId` matches the line's `contradiction` → `apply_interrogation_reveals_and_build_queue(on_correct, line.reveals)`, `record_break`; else enqueue `on_wrong_evidence` (fallback `default_wrong`) and `return_to_line`.
  - `withdraw`: require `Playing`/`Presenting`; `withdraw`; empty queue → `on_queue_exhausted`.
  Add typed errors (`not_in_cross_examination`, reuse `locked_interrogation_question`, `unknown_interrogation_question`, `dialogue_active`). Register all five in `generate_handler!` and remove the three old handlers.

- [ ] **Step 4: Run to verify they pass, then the full engine suite.** Run: `cargo test --manifest-path apps/game/src-tauri/Cargo.toml`
  Expected: PASS.

- [ ] **Step 5: Lint + commit.** Run: `bun run rust:lint` (expect clean), then:
```bash
git add apps/game/src-tauri/src/game/mod.rs apps/game/src-tauri/src/lib.rs
git commit -m "feat(engine): cross-examination IPC commands (ask/proceed/challenge/present/withdraw)"
```

---

## PHASE 3 — Frontend

### Task 10: Frontend view + mode types

**Files:**
- Modify: `apps/game/src/lib/state/types.ts:118-142`

**Interfaces — Produces:**

```ts
export type InterrogationPhaseView = {
  id: string; label: string;
  subject: SubjectView;
  questions: InquiryQuestionView[];
  crossExam: CrossExamView | null;
};
export type InquiryQuestionView = { id: string; label: string; broken: boolean };
export type CrossExamView = {
  questionId: string; lineId: string; lineLabel: string;
  lineContent: DialogueItem[];
  lineIndex: number; lineTotal: number;
  presenting: boolean;
};
```

- [ ] **Step 1:** Replace `InterrogationPhaseView.questions`/`testimony`, `InquiryQuestionView.answered`, and delete `TestimonyStatementView`; add the types above. Keep `SubjectView`. Remove `kind` from `InterrogationPhaseView` (single kind now).
- [ ] **Step 2: Type-check.** Run: `bun run check`
  Expected: FAIL — `InterrogationView.svelte` + `game-client` still reference removed shapes (fixed in Tasks 11–12).
- [ ] **Step 3: Commit.**
```bash
git add apps/game/src/lib/state/types.ts
git commit -m "refactor(web): interrogation view types for cross-examination"
```

---

### Task 11: IPC client wrappers

**Files:**
- Modify: `apps/game/src/lib/state/game-client.svelte.ts:210-` (replace the three interrogation wrappers)

**Interfaces — Produces:**

```ts
export async function askInterrogationQuestion(questionId: string) {
  await dispatchGameCommand("ask_interrogation_question", { questionId });
}
export async function proceedInterrogationLine() {
  await dispatchGameCommand("proceed_interrogation_line", {});
}
export async function challengeInterrogationLine(lineId: string) {
  await dispatchGameCommand("challenge_interrogation_line", { lineId });
}
export async function presentInterrogationEvidence(lineId: string, itemKind: "evidence" | "statement", itemId: string) {
  await dispatchGameCommand("present_interrogation_evidence", { lineId, itemKind, itemId });
}
export async function withdrawInterrogation() {
  await dispatchGameCommand("withdraw_interrogation", {});
}
```

- [ ] **Step 1:** Replace `answerInterrogationQuestion`/`pressTestimonyStatement`/`presentTestimonyItem` with the five wrappers above (match the existing `dispatchGameCommand` signature/style).
- [ ] **Step 2: Type-check.** Run: `bun run check` — expect only `InterrogationView.svelte`/`+page.svelte` errors remaining.
- [ ] **Step 3: Commit.**
```bash
git add apps/game/src/lib/state/game-client.svelte.ts
git commit -m "feat(web): cross-examination IPC client wrappers"
```

---

### Task 12: InterrogationView — cross-examination surface

**Files:**
- Rewrite: `apps/game/src/lib/components/InterrogationView.svelte`
- Rewrite: `apps/game/src/lib/components/InterrogationView.test.ts`

**Interfaces — Consumes:** Task 10 types, Task 11 wrappers.

Props:
```ts
let { scene, inventory, onAsk, onProceed, onChallenge, onPresent, onWithdraw, disabled = false }: {
  scene: SceneView; inventory: Inventory;
  onAsk: (questionId: string) => void | Promise<void>;
  onProceed: () => void | Promise<void>;
  onChallenge: (lineId: string) => void | Promise<void>;
  onPresent: (lineId: string, itemKind: "evidence" | "statement", itemId: string) => void | Promise<void>;
  onWithdraw: () => void | Promise<void>;
  disabled?: boolean;
} = $props();
```

- [ ] **Step 1: Write failing component tests.** In `InterrogationView.test.ts` (mirror the existing test harness / render helper):

```ts
it("shows the question menu when no cross-exam is active", async () => {
  const { getByText } = renderView(sceneWithMenu()); // crossExam: null, one question "當晚行蹤"
  expect(getByText("當晚行蹤")).toBeTruthy();
});

it("shows 反駁/繼續/退下 controls during playback", () => {
  const { getByRole } = renderView(sceneInPlayback()); // crossExam.presenting === false
  expect(getByRole("button", { name: /反駁/ })).toBeTruthy();
  expect(getByRole("button", { name: /繼續/ })).toBeTruthy();
  expect(getByRole("button", { name: /退下/ })).toBeTruthy();
});

it("shows the evidence tray when presenting", () => {
  const { getByText } = renderView(sceneInPresenting()); // crossExam.presenting === true, inventory has 清掃日誌
  expect(getByText("清掃日誌")).toBeTruthy();
});

it("calls onPresent with line + item on tray click", async () => {
  const onPresent = vi.fn();
  const { getByText } = renderView(sceneInPresenting(), { onPresent });
  await fireEvent.click(getByText("清掃日誌"));
  expect(onPresent).toHaveBeenCalledWith("l_deny", "evidence", "cleaning_log");
});
```

- [ ] **Step 2: Run to verify they fail.** Run: `bun run --cwd apps/game test InterrogationView`
  Expected: FAIL.

- [ ] **Step 3: Implement the component.** Three exclusive states derived from `phase.crossExam`:

```svelte
<script lang="ts">
  import type { Inventory, SceneView, DialogueItem } from "../state/types";
  let { scene, inventory, onAsk, onProceed, onChallenge, onPresent, onWithdraw, disabled = false } = $props();
  let interrogation = $derived(scene.kind === "interrogation" ? scene : null);
  let phase = $derived(
    interrogation?.visiblePhases.find((p) => p.id === interrogation.currentPhaseId) ?? null,
  );
  let xexam = $derived(phase?.crossExam ?? null);
  function lineText(items: DialogueItem[]): string {
    return items.map((i) => (i.kind === "line" ? i.text : "")).join("");
  }
</script>

{#if phase}
  <section class="interrogation" aria-label="interrogation">
    <header class="subject">
      <strong>{phase.subject.name}</strong><small>{phase.subject.role}</small>
      {#if phase.subject.bio}<p class="bio">{phase.subject.bio}</p>{/if}
    </header>

    {#if xexam}
      <article class="line-card" class:presenting={xexam.presenting}>
        <div class="prog">{xexam.lineIndex + 1} / {xexam.lineTotal} · ↻</div>
        <p class="line">{lineText(xexam.lineContent)}</p>

        {#if xexam.presenting}
          <p class="tray-label">針對此句提出證據</p>
          <div class="tray">
            {#each inventory.evidence as item (item.id)}
              <button type="button" {disabled} onclick={() => onPresent(xexam.lineId, "evidence", item.id)}>
                <span class="k">證</span>{item.name}
              </button>
            {/each}
            {#each inventory.statements as item (item.id)}
              <button type="button" {disabled} onclick={() => onPresent(xexam.lineId, "statement", item.id)}>
                <span class="k alt">言</span>{item.speaker}
              </button>
            {/each}
            <button class="ghost" type="button" {disabled} onclick={() => onWithdraw()}>收回</button>
          </div>
        {:else}
          <div class="controls">
            <button class="primary" type="button" {disabled} onclick={() => onChallenge(xexam.lineId)}>反駁</button>
            <button type="button" {disabled} onclick={() => onProceed()}>繼續聆聽 ▸</button>
            <button class="ghost" type="button" {disabled} onclick={() => onWithdraw()}>退下</button>
          </div>
        {/if}
      </article>
    {:else}
      <ul class="menu">
        {#each phase.questions as q (q.id)}
          <li>
            <button class="qbtn" class:broken={q.broken} type="button" {disabled} onclick={() => onAsk(q.id)}>
              <span class="ql">{q.label}</span>
              <span class="qs">{q.broken ? "已破" : "提問"}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{:else if interrogation}
  <p class="muted">尚未進入任何訊問階段。</p>
{/if}
```

  Add CSS reusing the existing `--crimson`/`--cyan`/`--bone`/`--char`/`--rule*`/`--display-jp`/`--serif-jp`/`--mono` tokens (port the visual language from the previous component: crimson accents, dialogue-box-styled `.line-card`, tray buttons like the old `.statement-actions button`). The `lineText` helper assumes `DialogueItem` has a `kind: "line"` arm with `text`; confirm against `state/types.ts` and adjust if the action arm differs.

- [ ] **Step 4: Run to verify they pass.** Run: `bun run --cwd apps/game test InterrogationView`
  Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add apps/game/src/lib/components/InterrogationView.svelte apps/game/src/lib/components/InterrogationView.test.ts
git commit -m "feat(web): cross-examination interrogation surface (menu/playback/tray)"
```

---

### Task 13: Wire +page, mode predicates, SFX

**Files:**
- Modify: `apps/game/src/routes/+page.svelte:263-275` (interrogation branch + imports), `apps/game/src/lib/state/mode.ts`, `apps/game/src/lib/audio/sfx-events.ts`

- [ ] **Step 1: Update `+page.svelte`.** Replace the imports `answerInterrogationQuestion`/`pressTestimonyStatement`/`presentTestimonyItem` with the five new wrappers, and the `<InterrogationView … />` props with `onAsk={askInterrogationQuestion} onProceed={proceedInterrogationLine} onChallenge={challengeInterrogationLine} onPresent={presentInterrogationEvidence} onWithdraw={withdrawInterrogation}`.

- [ ] **Step 2: SFX.** In `sfx-events.ts` add cue mappings for challenge (reuse `ui:menu-confirm`), correct/breakthrough, wrong, and loop; wire the correct/wrong cues where `onPresent` resolves if the current SFX pattern is event-driven (follow the existing `playGameplaySfxEvent` usage). `mode.ts` `canReexamineInventory`/`shouldShowInventoryPanel` keep returning true for `"interrogation"` — verify no change needed.

- [ ] **Step 3: Type-check + component suite.** Run: `bun run check` then `bun run --cwd apps/game test`
  Expected: PASS.

- [ ] **Step 4: Commit.**
```bash
git add apps/game/src/routes/+page.svelte apps/game/src/lib/state/mode.ts apps/game/src/lib/audio/sfx-events.ts
git commit -m "feat(web): wire cross-examination commands and SFX into the page"
```

---

## PHASE 4 — Writing skill + smoke

### Task 14: Rewrite `writing-interrogation-scene` skill

**Files:**
- Rewrite: `.claude/skills/writing-interrogation-scene/SKILL.md`

- [ ] **Step 1: Rewrite the skill** around the unified model, porting the authoritative rules from spec §2–§3 and §7. Required changes:
  - **File Skeleton** → the spec §3 skeleton (`## Phase` `Kind: inquiry` → `### Subject` → `### Question` → `#### Testimony` with `On Loop`/`Default Challenge`/`Default Wrong` → `##### Line` with `Content`/`Contradiction`/`Challenge`/`On Correct`(+`Reveals`)/`On Wrong Evidence`).
  - **Heading Hierarchy** table → `H4: #### Testimony`; `H5: ##### Line:`. Delete `#### Follow-up:`, `#### On Reask`, `#### Statement:`, `### Result:`, `##### On Press/Present/Wrong Present`.
  - **Block schemas** → document Question (no follow-up), Testimony (required `On Loop`; optional defaults), Line (contradiction ⇒ `Challenge`+`On Correct`+`On Wrong Evidence` required; honest lines use testimony defaults).
  - **Follow-ups** → "a follow-up is a locked `### Question` unlocked by a line's `On Correct` → `Reveals:[question:<id>]`; same-testimony-deeper vs different-question is which ids you reveal."
  - Keep the reused rules: Traditional Chinese, `**角色名**：內容`, `[場景：…]`, exact `evidence:`/`statement:` targets, and the contradiction-must-be-guaranteed rule (link the Beat-10 trap).
  - Update **Workflow** and **Common Mistakes** (drop testimony-statement/follow-up rows; add "Contradiction line missing Challenge/On Correct/On Wrong Evidence" and "Testimony missing On Loop").
- [ ] **Step 2: Sanity check** the skill's skeleton compiles: create a scratch scene from it under a temp fixture and run the Task-2 parser on it (or reuse the Task-5 fixture as the canonical example inside the skill).
- [ ] **Step 3: Commit.**
```bash
git add .claude/skills/writing-interrogation-scene/SKILL.md
git commit -m "docs(skill): rewrite writing-interrogation-scene for cross-examination"
```

---

### Task 15: Authored sample + full-stack smoke

**Files:**
- Create (only if a chapter is a natural host): `static/stories_plan/chapter_<N>/interrogation_scene_<K>.md` + register it in that chapter's `chapter.md` manifest

- [ ] **Step 1:** Author one small interrogation scene via the rewritten skill (one phase, one contradiction line whose `Contradiction` is guaranteed by a prior scene's evidence, one revealed follow-up). If no chapter suits it yet, skip this task and rely on fixtures — note the skip.
- [ ] **Step 2: Compile.** Run: `bun run scenes:compile`
  Expected: success; the new scene JSON appears under `apps/game/src-tauri/resources/scenes/` (not committed).
- [ ] **Step 3: Smoke test.** Run: `bun run dev:game`, open the scene, and exercise: ask → proceed to loop → challenge wrong evidence (rebuff → loop) → challenge right line/right evidence (breakthrough → follow-up unlocks) → 退下. Confirm all speech renders in the normal dialogue box.
- [ ] **Step 4: Commit** (only the authored `.md` + manifest, never generated JSON).
```bash
git add static/stories_plan/chapter_<N>/interrogation_scene_<K>.md static/stories_plan/chapter_<N>/chapter.md
git commit -m "content: sample cross-examination interrogation scene"
```

---

## Final verification

- [ ] `bun run --cwd packages/scripts test` — compiler suite green
- [ ] `bun run check:scripts` — compiler types green
- [ ] `bun run scenes:compile` — pipeline builds
- [ ] `cargo test --manifest-path apps/game/src-tauri/Cargo.toml` — engine green
- [ ] `bun run rust:lint` — clippy/fmt clean
- [ ] `bun run check` — frontend types green
- [ ] `bun run --cwd apps/game test` — frontend suite green
- [ ] `bun run test` — full root suite (scripts + turbo) green
- [ ] `bun run lint:all` — ESLint/Prettier/Rust checks clean

## Self-review notes (against the spec)

- Spec §2 model → Tasks 1,6,7. §2.1 flow → Task 7 (state machine) + Task 9 (commands). §2.2 UI → Task 12. §3 format → Tasks 1,2,5,14. §4 compiler → Tasks 1–5. §5 runtime → Tasks 6–9. §6 frontend → Tasks 10–13. §7 skill → Task 14. §8 decisions are baked into the task behaviors (退下 = `withdraw`; no penalty; auto-complete on broken required questions). §9 `Default Challenge`/`Default Wrong` optional with parser default → Task 2 (`#[serde(default)]` in Task 6). §11 verification → Final verification.
- Type consistency: `crossExam`/`CrossExamView`, `broken`, `lineContent`, and the five command names are used identically across Rust (Tasks 8,9), TS types (Task 10), client (Task 11), and component (Task 12).
