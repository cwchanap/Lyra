# HPA-257 Monotonic Unlocks and Fixed-Point Reachability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Lyra's investigation and interrogation unlock/reveal systems with monotonic story-state predicates, ordered atomic story effects, nested `at_least`, and compiler-wide reachability that remains compatible with free-order exploration and HPA-255 objective semantics.

**Architecture:** Keep the existing scene-family AST/wire/runtime types concrete while extracting shared positive-expression and story-effect kernels. The compiler continues running its current investigation/interrogation validators, then feeds deterministic normalized nodes into a separate whole-corpus analyzer that combines positive reachability, ordered reveal-batch simulation, strict dependency SCC validation, and a finite may/must primary-objective fixed point. Rust mirrors the concrete wire types, evaluates story predicates against `StoryState`, and dispatches story effects only through HPA-255 mutation methods inside existing command transactions.

**Tech Stack:** Bun 1.3.1, TypeScript 5.6, Vitest 4, existing scene compiler, Rust/Serde, Tauri 2 game runtime, existing save schema v2.

## Global Constraints

- Existing investigation/interrogation expressions, reveal arrays, emitted JSON, diagnostics, warning count, and `contentRevision` remain byte-for-byte unchanged when new syntax is unused.
- `and` binds more tightly than `or`; parentheses override precedence.
- `at_least(count, conditions...)` is an n-ary node; `count` is a positive base-10 integer, child list is non-empty, and `count <= conditions.length`.
- No generic `not`, absence predicate, active-primary predicate, revocation, relock, or generic string flag is added.
- Investigation and interrogation accept story predicates/targets by default; linear scenes remain unsupported because they have no unlock/reveal metadata.
- Objective ID `null` is reserved; `set_primary_objective:null` clears the active primary.
- HPA-255 remains the sole story-state mutation owner. HPA-257 calls its methods and never writes objective/fact/question/authorization maps or `active_primary_objective_id` directly.
- `complete_objective` is secondary-only at compiler, Rust startup, and Rust dispatch boundaries.
- Investigation/interrogation have no authority context. Production authorization grants remain unavailable until HPA-264; required grant gates fail and optional grant gates warn.
- Positive dependency cycles fail even when externally seeded. Free-order may-before relations are not dependency edges and may be symmetric.
- Reveal targets execute in authored order against provisional state. Earlier targets may satisfy later prerequisites; any failure rolls back the whole batch.
- Free-order summaries include every adapter-listed may-before member, exclude self-feedback, and never replay one-shot events.
- Primary completion publishes the ordinary `objective_completed:<id>` atom used by authored unlock predicates.
- May sets grow by union; must sets update by meet/intersection after first publication; unknown must-active state never becomes concrete again in one analysis run.
- Catalog schema stays version 2. Save schema stays version 2. No frontend state, IPC command, or production story file changes.
- New diagnostics sort by normalized source path, line, code, node key, then target index.
- TypeScript and Rust evaluate the same versioned fixture bytes from `packages/shared/fixtures/unlock-expression-semantics.json`.

## File and Responsibility Map

### New compiler files

- `packages/scripts/compile-scenes/parser-reveals.ts` — shared investigation/interrogation local-target parsing plus story-target grammar.
- `packages/scripts/compile-scenes/parser-reveals.test.ts` — target syntax, duplicate/conflict, family-matrix, and modifier tests.
- `packages/scripts/compile-scenes/parser-story-catalog.test.ts` — parser-level reserved-ID and source-location tests.
- `packages/scripts/compile-scenes/analysis-definition-registry.ts` — qualified analysis scene/board resolution and deterministic fixture registration.
- `packages/scripts/compile-scenes/analysis-definition-registry.test.ts` — registry duplicate and lookup tests.
- `packages/scripts/compile-scenes/reachability.ts` — normalized nodes, dependency SCCs, ordered abstract batches, free-order summaries, and joint fixed point.
- `packages/scripts/compile-scenes/reachability.test.ts` — synthetic graph tests covering every new diagnostic and objective-order case.
- `packages/shared/fixtures/unlock-expression-semantics.json` — one data-only expression corpus consumed by TypeScript and Rust.

### Existing compiler owners

- `packages/scripts/compile-scenes/types.ts` — concrete AST/JSON expression and reveal unions; analysis-reference fields remain inline in story predicate variants to avoid reversing the existing `story-catalog.ts` dependency.
- `packages/scripts/compile-scenes/parser-unlock.ts` — shared recursive parser with family-specific predicate adapters.
- `packages/scripts/compile-scenes/parser-investigation.ts` — investigation AST integration only; private reveal parser removed.
- `packages/scripts/compile-scenes/parser-interrogation.ts` — interrogation AST integration only; private reveal parser removed.
- `packages/scripts/compile-scenes/parser-story-catalog.ts` — Markdown/source-line parsing, including objective `{#null}` rejection.
- `packages/scripts/compile-scenes/story-catalog.ts` — semantic catalog/ref/target validation; owns `AnalysisSceneRef`, existing `AnalysisBoardRef`, and their validators.
- `packages/scripts/compile-scenes/validator.ts` — existing specialized local gameplay validation plus deterministic adapter data.
- `packages/scripts/compile-scenes/orchestrator.ts` — accepts optional synthetic analysis definitions, invokes the new analyzer, and merges errors/warnings.
- `packages/scripts/compile-scenes/emitter.ts` — emits the expanded concrete unions without rewriting legacy nodes.

### Existing Rust owners

- `apps/game/src-tauri/src/game/schema.rs` — concrete Serde enums for thresholds, story predicates, and story reveal targets.
- `apps/game/src-tauri/src/game/loader.rs` — structural/local/global startup validation and authored-contract defense.
- `apps/game/src-tauri/src/game/unlock.rs` — shared story context plus concrete family evaluators.
- `apps/game/src-tauri/src/game/scenes/investigation.rs` — passes story progress into investigation availability checks.
- `apps/game/src-tauri/src/game/scenes/interrogation.rs` — passes story progress into interrogation availability/completion checks.
- `apps/game/src-tauri/src/game/reveals.rs` — story-effect dispatcher and existing local/inventory orchestration.
- `apps/game/src-tauri/src/game/mod.rs` — transaction-owned trigger guards and materialization contexts.
- `apps/game/src-tauri/src/game/story/mutations.rs` — unchanged HPA-255 mutation semantics.
- `apps/game/src-tauri/src/game/save/capture.rs` and `restore.rs` — focused round-trip tests only; no schema change.

---

### Task 1: Lock Legacy Compiler and Runtime Behavior

**Files:**
- Modify: `packages/scripts/compile-scenes/parser-unlock.test.ts`
- Modify: `packages/scripts/compile-scenes.test.ts`
- Modify: `apps/game/src-tauri/src/game/unlock.rs`
- Test: `packages/scripts/compile-scenes/parser-unlock.test.ts`
- Test: `packages/scripts/compile-scenes.test.ts`
- Test: inline Rust tests in `apps/game/src-tauri/src/game/unlock.rs`

**Interfaces:**
- Consumes: current `parseUnlockExpr`, `parseInterrogationUnlockExpr`, `compile`, `evaluate`, and `evaluate_interrogation` behavior.
- Produces: baseline snapshots and characterization tests that every later task must keep green.

- [ ] **Step 1: Add exact legacy parser characterizations before changing production code**

Add tests that lock left associativity, precedence, parentheses, family rejection, and source locations:

```ts
it("keeps legacy binary trees left-associated", () => {
  expect(
    parseUnlockExpr(
      "hotspot:a investigated and hotspot:b investigated and hotspot:c investigated",
      "legacy.md",
      17,
    ),
  ).toEqual({
    ok: true,
    value: {
      op: "and",
      left: {
        op: "and",
        left: { predicate: "hotspot_investigated", id: "a" },
        right: { predicate: "hotspot_investigated", id: "b" },
      },
      right: { predicate: "hotspot_investigated", id: "c" },
    },
  });
});

it("keeps parentheses authoritative", () => {
  const result = parseInterrogationUnlockExpr(
    "question:q answered and (phase:p completed or evidence:e collected)",
    "legacy.md",
    23,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value).toMatchObject({ op: "and" });
});
```

- [ ] **Step 2: Capture the current end-to-end compiler baseline**

In `compile-scenes.test.ts`, compile `docs/stories_plan` to a temporary directory and snapshot only stable contract data:

```ts
expect({
  warnings: result.warnings,
  manifest: JSON.parse(
    readFileSync(resolve(outRoot, "save_content_manifest.json"), "utf-8"),
  ),
}).toMatchSnapshot();
```

Run the snapshot update while production code is still unchanged:

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes.test.ts -u
```

Expected: PASS and a committed snapshot showing the current Chapter 1 compile has zero new HPA-257 warnings.

- [ ] **Step 3: Add Rust legacy evaluator characterizations**

Add a serde round-trip test and retain the current truth-table tests:

```rust
#[test]
fn legacy_unlock_json_round_trips_without_shape_change() {
    let raw = r#"{"op":"and","left":{"predicate":"evidence_collected","id":"receipt"},"right":{"predicate":"hotspot_investigated","id":"desk"}}"#;
    let parsed: UnlockExpr = serde_json::from_str(raw).unwrap();
    assert_eq!(serde_json::to_string(&parsed).unwrap(), raw);
}
```

- [ ] **Step 4: Run the baseline gate**

```bash
bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/parser-unlock.test.ts \
  packages/scripts/compile-scenes.test.ts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::unlock::tests
```

Expected: all selected tests pass before feature implementation begins.

- [ ] **Step 5: Commit**

```bash
git add packages/scripts/compile-scenes/parser-unlock.test.ts \
  packages/scripts/compile-scenes.test.ts \
  packages/scripts/__snapshots__ \
  apps/game/src-tauri/src/game/unlock.rs
git commit -m "test: lock legacy unlock and compiler behavior"
```

---

### Task 2: Extract the Positive Parser Core and Add `at_least`

**Files:**
- Modify: `packages/scripts/compile-scenes/types.ts:150-205`
- Modify: `packages/scripts/compile-scenes/parser-unlock.ts`
- Modify: `packages/scripts/compile-scenes/parser-unlock.test.ts`

**Interfaces:**
- Consumes: existing public wrappers `parseUnlockExpr` and `parseInterrogationUnlockExpr`.
- Produces: `PositiveExpression<P>`, concrete family expressions, and first-class `at_least` nodes while preserving wrapper names and legacy output.

- [ ] **Step 1: Write failing threshold and delimiter tests**

```ts
it("parses nested at_least with no whitespace around commas", () => {
  expect(
    parseUnlockExpr(
      "at_least(2,hotspot:a investigated,at_least(1,evidence:b collected))",
      "threshold.md",
      8,
    ),
  ).toEqual({
    ok: true,
    value: {
      op: "at_least",
      count: 2,
      conditions: [
        { predicate: "hotspot_investigated", id: "a" },
        {
          op: "at_least",
          count: 1,
          conditions: [{ predicate: "evidence_collected", id: "b" }],
        },
      ],
    },
  });
});

it.each([
  ["at_least(0,hotspot:a investigated)", "unlockAtLeastInvalidCount"],
  ["at_least(2,hotspot:a investigated)", "unlockAtLeastCountExceedsConditions"],
  ["at_least(1)", "unlockAtLeastEmptyConditions"],
  ["at_least(2,hotspot:a investigated,hotspot:a investigated)", "unlockAtLeastDuplicateCondition"],
])("rejects invalid threshold %s", (source, code) => {
  const result = parseUnlockExpr(source, "threshold.md", 9);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
});
```

- [ ] **Step 2: Run the parser tests and confirm failure**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/parser-unlock.test.ts
```

Expected: FAIL because `at_least` is currently an unknown predicate and comma is not a word delimiter.

- [ ] **Step 3: Add the shared recursive type and parser**

In `types.ts`:

```ts
export type PositiveExpression<P> =
  | { op: "and" | "or"; left: PositiveExpression<P>; right: PositiveExpression<P> }
  | { op: "at_least"; count: number; conditions: PositiveExpression<P>[] }
  | P;

export type InvestigationLocalPredicate =
  | { predicate: "evidence_collected"; id: string }
  | { predicate: "statement_acquired"; id: string }
  | { predicate: "topic_discussed"; characterId: string; topicId: string }
  | { predicate: "hotspot_investigated"; id: string };

export type InterrogationLocalPredicate =
  | { predicate: "evidence_collected"; id: string }
  | { predicate: "statement_acquired"; id: string }
  | { predicate: "question_answered"; id: string }
  | { predicate: "phase_completed"; id: string };

export type UnlockExpr = PositiveExpression<InvestigationLocalPredicate>;
export type InterrogationUnlockExpr = PositiveExpression<InterrogationLocalPredicate>;
```

In `parser-unlock.ts`, keep the public wrappers and extract one generic recursive parser. Update the boundary check so comma terminates words:

```ts
/\s|[(),]/
```

Parse thresholds as atoms, validate the count before constructing the node, and detect duplicate children with `JSON.stringify(child)` after parentheses have been discarded by parsing. Do not reorder `and`/`or` children.

- [ ] **Step 4: Run focused and baseline tests**

```bash
bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/parser-unlock.test.ts \
  packages/scripts/compile-scenes.test.ts
bun run check:scripts
```

Expected: threshold tests pass; legacy snapshots and script type-check remain unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/scripts/compile-scenes/types.ts \
  packages/scripts/compile-scenes/parser-unlock.ts \
  packages/scripts/compile-scenes/parser-unlock.test.ts
git commit -m "feat: add shared positive unlock parser and thresholds"
```

---

### Task 3: Add Story Predicates and Catalog/Analysis Reference Contracts

**Files:**
- Modify: `packages/scripts/compile-scenes/types.ts`
- Modify: `packages/scripts/compile-scenes/parser-unlock.ts`
- Modify: `packages/scripts/compile-scenes/parser-unlock.test.ts`
- Modify: `packages/scripts/compile-scenes/parser-story-catalog.ts`
- Create: `packages/scripts/compile-scenes/parser-story-catalog.test.ts`
- Modify: `packages/scripts/compile-scenes/story-catalog.ts`
- Modify: `packages/scripts/compile-scenes/story-catalog.test.ts`
- Create: `packages/scripts/compile-scenes/analysis-definition-registry.ts`
- Create: `packages/scripts/compile-scenes/analysis-definition-registry.test.ts`

**Interfaces:**
- Consumes: `PositiveExpression<P>`, existing `AnalysisBoardRef`, `validateAnalysisBoardRef`, `validateSetPrimaryObjectiveTarget`, and `validateStoryCatalog`.
- Produces: inline analysis predicate wire fields in `types.ts`, plus `AnalysisSceneRef`, `validateAnalysisSceneRef`, and `AnalysisDefinitionRegistry` from their existing catalog/registry owners.

- [ ] **Step 1: Write failing parser and catalog tests**

Add story predicate cases to both family wrappers:

```ts
it.each([
  ["fact:door_conflict asserted", { predicate: "fact_asserted", id: "door_conflict" }],
  ["question:who_entered resolved", { predicate: "question_resolved", id: "who_entered" }],
  ["objective:prepare_request completed", { predicate: "objective_completed", id: "prepare_request" }],
  ["authorization:narrow_export granted", { predicate: "authorization_granted", id: "narrow_export" }],
])("parses story predicate %s", (source, expected) => {
  expect(parseUnlockExpr(source, "story.md", 4)).toEqual({ ok: true, value: expected });
  expect(parseInterrogationUnlockExpr(source, "story.md", 4)).toEqual({ ok: true, value: expected });
});
```

Add qualified scene/board tests and parser-level `{#null}` rejection:

```ts
expect(validateAnalysisSceneRef(
  { chapterId: "chapter_1", sceneId: "analysis_scene_8_5" },
  { sourceFile: "scene.md", line: 7 },
)).toEqual([]);
```

```ts
const result = parseStoryCatalog(sourceWithObjectiveIdNull, "story_catalog.md");
expect(result.ok).toBe(false);
if (!result.ok) expect(result.errors).toContainEqual(expect.objectContaining({
  code: "reservedObjectiveId",
  line: 5,
}));
```

- [ ] **Step 2: Run tests and confirm missing contracts**

```bash
bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/parser-unlock.test.ts \
  packages/scripts/compile-scenes/parser-story-catalog.test.ts \
  packages/scripts/compile-scenes/story-catalog.test.ts \
  packages/scripts/compile-scenes/analysis-definition-registry.test.ts
```

Expected: FAIL because story predicates, scene refs, reserved ID handling, and registry do not exist.

- [ ] **Step 3: Implement the concrete story predicate union without reversing catalog dependencies**

In `types.ts`, keep qualified reference fields inline:

```ts
export type StoryPredicate =
  | { predicate: "fact_asserted"; id: string }
  | { predicate: "question_resolved"; id: string }
  | { predicate: "objective_completed"; id: string }
  | { predicate: "authorization_granted"; id: string }
  | {
      predicate: "analysis_scene_completed";
      chapterId: string;
      sceneId: string;
    }
  | {
      predicate: "analysis_board_completed";
      chapterId: string;
      sceneId: string;
      boardId: string;
    };

export type UnlockExpr = PositiveExpression<InvestigationLocalPredicate | StoryPredicate>;
export type InterrogationUnlockExpr = PositiveExpression<InterrogationLocalPredicate | StoryPredicate>;
```

Do not import `AnalysisBoardRef` from `story-catalog.ts` into `types.ts`, because `story-catalog.ts` already imports compiler AST types. Extend both predicate adapters in `parser-unlock.ts`; keep `question:<id> answered` local and `question:<id> resolved` global by matching the final verb.

- [ ] **Step 4: Extend existing catalog owners and add the registry**

In `parser-story-catalog.ts`, reject objective ID `null` at the heading line. In `story-catalog.ts`, also reject hand-built AST entries with ID `null`, reuse existing board validation, and add:

```ts
export type AnalysisSceneRef = { chapterId: string; sceneId: string };

export function validateAnalysisSceneRef(
  ref: AnalysisSceneRef,
  location: Located<unknown>,
): CompileError[];
```

Create a deterministic registry that imports both reference types from `story-catalog.ts`:

```ts
export type AnalysisDefinitionRegistry = {
  hasScene(ref: AnalysisSceneRef): boolean;
  hasBoard(ref: AnalysisBoardRef): boolean;
};

export function createAnalysisDefinitionRegistry(input: {
  scenes: AnalysisSceneRef[];
  boards: AnalysisBoardRef[];
}): AnalysisDefinitionRegistry;
```

Reject duplicate qualified definitions in the registry constructor; do not store hidden solution content.

- [ ] **Step 5: Run the focused gate and commit**

```bash
bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/parser-unlock.test.ts \
  packages/scripts/compile-scenes/parser-story-catalog.test.ts \
  packages/scripts/compile-scenes/story-catalog.test.ts \
  packages/scripts/compile-scenes/analysis-definition-registry.test.ts
bun run check:scripts
git add packages/scripts/compile-scenes
git commit -m "feat: add story predicates and analysis reference contracts"
```

---

### Task 4: Create the Shared Story Reveal Parser and Concrete Target Unions

**Files:**
- Modify: `packages/scripts/compile-scenes/types.ts:150-205,260-520`
- Create: `packages/scripts/compile-scenes/parser-reveals.ts`
- Create: `packages/scripts/compile-scenes/parser-reveals.test.ts`
- Modify: `packages/scripts/compile-scenes/parser-investigation.ts:500-900`
- Modify: `packages/scripts/compile-scenes/parser-interrogation.ts:700-1350`

**Interfaces:**
- Consumes: `RevealTarget` from `@lyra/scene-types` as the investigation-local union and the existing interrogation-local four variants.
- Produces: `StoryRevealTarget`, `InvestigationRevealTarget`, `InterrogationLocalRevealTarget`, `InterrogationRevealTarget`, and `parseRevealsList`.

- [ ] **Step 1: Write failing grammar tests**

```ts
expect(parseRevealsList({
  family: "investigation",
  raw: "[assert_fact:door_conflict, resolve_question:who_entered@door_conflict, set_primary_objective:present_request; complete_current]",
  sourceFile: "scene.md",
  line: 10,
})).toEqual({
  ok: true,
  value: [
    { kind: "assertFact", factId: "door_conflict" },
    { kind: "resolveQuestion", questionId: "who_entered", factId: "door_conflict" },
    { kind: "setPrimaryObjective", nextObjectiveId: "present_request", completeCurrent: true },
  ],
});
```

Cover every story target, `null`, malformed modifiers, local-family restrictions, exact duplicates, different-resolver conflict, and multiple primary transitions.

- [ ] **Step 2: Run and confirm failure**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/parser-reveals.test.ts
```

Expected: FAIL because the shared module and story-target types do not exist.

- [ ] **Step 3: Add concrete target unions**

```ts
export type StoryRevealTarget =
  | { kind: "assertFact"; factId: string }
  | { kind: "revealQuestion"; questionId: string }
  | { kind: "resolveQuestion"; questionId: string; factId: string }
  | { kind: "revealObjective"; objectiveId: string }
  | { kind: "completeObjective"; objectiveId: string }
  | { kind: "setPrimaryObjective"; completeCurrent: boolean; nextObjectiveId: string | null }
  | { kind: "grantAuthorization"; authorizationId: string };

export type InvestigationRevealTarget = RevealTarget | StoryRevealTarget;
export type InterrogationLocalRevealTarget =
  | InventoryTarget
  | { kind: "question"; id: string }
  | { kind: "phase"; id: string };
export type InterrogationRevealTarget = InterrogationLocalRevealTarget | StoryRevealTarget;
```

Change investigation/interrogation AST and JSON `reveals` arrays to the concrete combined types. Keep `@lyra/scene-types` unchanged.

- [ ] **Step 4: Implement one parser and remove the private duplicates**

`parser-reveals.ts` parses the bracket list, dispatches local prefixes by family, parses story prefixes for both families, normalizes target fields, and returns source-located parse errors. It performs syntax-level duplicate/conflict checks; catalog-dependent validation remains Task 5.

Replace private `parseRevealsList` and `parseInterrogationRevealsList` calls in the scene parsers with the shared function. Delete the private parser functions only after all parser tests pass.

- [ ] **Step 5: Run parser compatibility and commit**

```bash
bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/parser-reveals.test.ts \
  packages/scripts/compile-scenes/parser-unlock.test.ts \
  packages/scripts/compile-scenes.test.ts
bun run check:scripts
git add packages/scripts/compile-scenes
git commit -m "feat: add shared story reveal grammar"
```

---

### Task 5: Add Context-Free Story Target Validation and Authority Rules

**Files:**
- Modify: `packages/scripts/compile-scenes/story-catalog.ts`
- Modify: `packages/scripts/compile-scenes/story-catalog.test.ts`
- Modify: `packages/scripts/compile-scenes/validator.ts`
- Modify: `packages/scripts/compile-scenes/validator.test.ts`

**Interfaces:**
- Consumes: parsed `StoryRevealTarget[]`, `ASTStoryCatalog`, existing set-primary and analysis-ref helpers.
- Produces: `validateStoryRevealTargets` and source-located semantic diagnostics before reachability.

- [ ] **Step 1: Write failing semantic tests**

Cover:

```ts
validateStoryRevealTargets({
  targets: [{ kind: "completeObjective", objectiveId: "primary_a" }],
  catalog,
  representedAuthority: null,
  location,
})
```

Expected code: `primaryObjectiveCompletionRequiresSet`.

Also cover unresolved refs, resolver fact not listed in `resolvedByFactIds`, investigation/interrogation grant with null authority, authority mismatch, valid synthetic authority, exact duplicate, conflicting resolvers, and multiple set-primary targets.

- [ ] **Step 2: Run and verify failure**

```bash
bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/story-catalog.test.ts \
  packages/scripts/compile-scenes/validator.test.ts
```

Expected: FAIL because story target semantic validation is absent.

- [ ] **Step 3: Implement validation using existing owners**

Add:

```ts
export function validateStoryRevealTargets(input: {
  targets: StoryRevealTarget[];
  catalog: ASTStoryCatalog;
  representedAuthority: string | null;
  location: Located<unknown>;
}): CompileError[];
```

Rules:

- `assertFact`, question, objective, authorization IDs resolve in typed registries.
- `resolveQuestion` fact is in the question's `resolvedByFactIds`.
- `completeObjective` resolves and is secondary.
- `setPrimaryObjective` delegates non-null validation to `validateSetPrimaryObjectiveTarget`.
- `grantAuthorization` requires non-null exact `grantingAuthority` match.
- Parser-normalized duplicate/conflict rules are rechecked for hand-built AST defense.

- [ ] **Step 4: Thread the catalog through the compiler validation boundary**

Do not add catalog state to every legacy helper. Add a focused story-target pass invoked by the normalized adapter builder. Investigation/interrogation pass `representedAuthority: null`; synthetic analysis registrations supply a matching authority only in tests.

- [ ] **Step 5: Run and commit**

```bash
bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/story-catalog.test.ts \
  packages/scripts/compile-scenes/validator.test.ts
bun run check:scripts
git add packages/scripts/compile-scenes/story-catalog.ts \
  packages/scripts/compile-scenes/story-catalog.test.ts \
  packages/scripts/compile-scenes/validator.ts \
  packages/scripts/compile-scenes/validator.test.ts
git commit -m "feat: validate story reveal targets"
```

---

### Task 6: Preserve Emission Compatibility While Wiring New Compiler Types

**Files:**
- Modify: `packages/scripts/compile-scenes/emitter.ts`
- Modify: `packages/scripts/compile-scenes.test.ts`
- Create fixture: `packages/scripts/__fixtures__/hpa_257_valid/`

**Interfaces:**
- Consumes: expanded AST/JSON expression and reveal unions.
- Produces: emitted story predicates, `at_least`, and story targets with unchanged legacy serialization.

- [ ] **Step 1: Add a focused valid fixture**

Create one chapter containing:

- an investigation scene with nested `at_least`, fact/question/objective predicates, and ordered story targets;
- an interrogation scene using the same story predicate grammar;
- a story catalog with referenced facts/questions/primary/secondary objectives and authorizations;
- no production grant target, because investigation/interrogation authority is null.

- [ ] **Step 2: Write failing emitted-JSON assertions**

```ts
expect(investigation.sublocations[0].hotspots[0].unlock).toEqual({
  op: "at_least",
  count: 2,
  conditions: [
    { predicate: "fact_asserted", id: "door_conflict" },
    { predicate: "objective_completed", id: "prepare_request" },
  ],
});
expect(investigation.sublocations[0].hotspots[0].reveals).toContainEqual({
  kind: "setPrimaryObjective",
  completeCurrent: true,
  nextObjectiveId: "present_request",
});
```

- [ ] **Step 3: Run and verify the fixture fails before emission support**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes.test.ts
```

Expected: FAIL on new fixture compile or output assertion.

- [ ] **Step 4: Make emitter mappings exhaustive without rewriting nodes**

Use the AST values directly where possible. Add explicit `at_least` and story-target branches to any helper switch that transforms the unions. Do not flatten expressions, sort children, reorder targets, or copy catalog prose into scene JSON.

- [ ] **Step 5: Run snapshots and commit**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes.test.ts
bun run check:scripts
git add packages/scripts/compile-scenes/emitter.ts \
  packages/scripts/compile-scenes.test.ts \
  packages/scripts/__fixtures__/hpa_257_valid
git commit -m "feat: emit HPA-257 expressions and story targets"
```

Expected: new fixture passes; pre-HPA-257 snapshots remain unchanged.

---

### Task 7: Produce Deterministic Normalized Scene Nodes and Ordering Relations

**Files:**
- Create: `packages/scripts/compile-scenes/reachability.ts`
- Create: `packages/scripts/compile-scenes/reachability.test.ts`
- Modify: `packages/scripts/compile-scenes/validator.ts`
- Modify: `packages/scripts/compile-scenes/validator.test.ts`

**Interfaces:**
- Consumes: scene ASTs, existing specialized investigation/interrogation analysis results, catalog, and analysis registry.
- Produces: explicit reachability atom/predicate/effect types and `ReachabilityNode[]` with stable keys, authored target order, strict predecessors, complete may-before sets, one-shot region identity, and legacy classification.

- [ ] **Step 1: Write adapter tests before implementing the model**

Use a synthetic investigation scene with two initially available hotspots and assert:

```ts
expect(nodesByKey.get("chapter_1/investigation_scene_1/hotspot:a")).toMatchObject({
  legacyCompatibilityMode: false,
  strictPredecessorKeys: ["chapter_1/investigation_scene_1/entry"],
  mayExecuteBeforeKeys: ["chapter_1/investigation_scene_1/hotspot:b"],
  freeOrderRegionId: "chapter_1/investigation_scene_1/main",
});
```

Add deterministic-order and unrelated-region tests.

- [ ] **Step 2: Run and verify failure**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/reachability.test.ts
```

Expected: FAIL because normalized nodes do not exist.

- [ ] **Step 3: Define every normalized type before using it**

```ts
export type ReachabilityAtom = string;

export type ReachabilityPredicate = {
  predicate: "atom";
  atom: ReachabilityAtom;
};

export type ReachabilityEffect =
  | {
      kind: "addAtom";
      atom: ReachabilityAtom;
      targetIndex: number;
    }
  | {
      kind: "story";
      target: StoryRevealTarget;
      targetIndex: number;
    };

export type ReachabilityNode = {
  key: string;
  requirement: "mandatory" | "optional";
  legacyCompatibilityMode: boolean;
  initiallyReachable: boolean;
  condition: PositiveExpression<ReachabilityPredicate> | null;
  implicitPrerequisites: ReachabilityPredicate[];
  effects: ReachabilityEffect[];
  representedAuthority: string | null;
  strictPredecessorKeys: string[];
  mayExecuteBeforeKeys: string[];
  freeOrderRegionId: string | null;
  sourceFile: string;
  line: number;
};
```

The adapter converts every local/story predicate to a canonical atom string before analysis, so the fixed point never needs scene-family-specific switches.

- [ ] **Step 4: Expose one deterministic builder and reuse specialized analysis**

```ts
export function buildReachabilityNodes(input: {
  chapters: ASTChapter[];
  scenes: SceneRecord[];
  catalog: ASTStoryCatalog;
  analysisRegistry: AnalysisDefinitionRegistry;
}): ReachabilityNode[];
```

Extract only the minimum pure summaries currently calculated inside `validator.ts` so both existing diagnostics and the adapter consume the same results. Preserve current validator error codes and behavior. Mark nodes using only legacy syntax as `legacyCompatibilityMode: true`; these nodes may feed analysis but receive no new optional/order warnings.

- [ ] **Step 5: Run and commit**

```bash
bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/reachability.test.ts \
  packages/scripts/compile-scenes/validator.test.ts \
  packages/scripts/compile-scenes.test.ts
bun run check:scripts
git add packages/scripts/compile-scenes/reachability.ts \
  packages/scripts/compile-scenes/reachability.test.ts \
  packages/scripts/compile-scenes/validator.ts \
  packages/scripts/compile-scenes/validator.test.ts
git commit -m "feat: normalize scene reachability and ordering"
```

---

### Task 8: Add Positive Dependency Validation and Base Reachability

**Files:**
- Modify: `packages/scripts/compile-scenes/reachability.ts`
- Modify: `packages/scripts/compile-scenes/reachability.test.ts`

**Interfaces:**
- Consumes: normalized nodes from Task 7.
- Produces: positive producer indexes, strict SCC diagnostics, may/must expression evaluation, base reachability, required/optional diagnostics, and authority-path checks.

- [ ] **Step 1: Write failing graph tests**

Cover:

- direct self-reference;
- two-node and longer SCCs;
- externally seeded cycle still rejected;
- nested `at_least` becoming may-true across iterations;
- unreachable mandatory node error;
- unreachable optional node warning;
- mandatory authorization with no producer, mismatch, unreachable producer, and reachable synthetic producer;
- no new diagnostic on legacy-only nodes.

- [ ] **Step 2: Run and verify failure**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/reachability.test.ts
```

Expected: FAIL because producer indexing, SCC checks, and positive fixed-point evaluation are not implemented.

- [ ] **Step 3: Implement producer indexing and SCC detection**

Create producer-to-consumer edges only for authored positive atoms and implicit prerequisites. Keep `mayExecuteBeforeKeys` out of SCC input. Emit one stable `positiveDependencyCycle` per SCC and one `positiveSelfReference` for a single-node self-loop.

- [ ] **Step 4: Implement positive may/must evaluation**

```ts
export function evaluateMay(
  expression: PositiveExpression<ReachabilityPredicate>,
  atoms: ReadonlySet<ReachabilityAtom>,
): boolean;

export function evaluateMust(
  expression: PositiveExpression<ReachabilityPredicate>,
  atoms: ReadonlySet<ReachabilityAtom>,
): boolean;
```

For `at_least`, count may-true or must-true children respectively. Run deterministic iterations until no reachable node or atom changes.

- [ ] **Step 5: Run and commit**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/reachability.test.ts
bun run check:scripts
git add packages/scripts/compile-scenes/reachability.ts \
  packages/scripts/compile-scenes/reachability.test.ts
git commit -m "feat: add positive dependency and reachability analysis"
```

---

### Task 9: Implement Ordered Batch Simulation and Joint Primary Fixed Point

**Files:**
- Modify: `packages/scripts/compile-scenes/reachability.ts`
- Modify: `packages/scripts/compile-scenes/reachability.test.ts`

**Interfaces:**
- Consumes: base positive graph and normalized authored-order effects.
- Produces: provisional whole-batch transfer, primary may/must state, complete self-excluding free-order summaries, objective completion atoms, and order diagnostics.

- [ ] **Step 1: Write the ordered-batch tests**

```ts
const bad = analyzeSyntheticNode([
  { kind: "resolveQuestion", questionId: "q", factId: "f" },
  { kind: "assertFact", factId: "f" },
]);
expect(bad.errors).toContainEqual(expect.objectContaining({
  code: "storyRevealBatchAlwaysInvalid",
}));

const good = analyzeSyntheticNode([
  { kind: "assertFact", factId: "f" },
  { kind: "resolveQuestion", questionId: "q", factId: "f" },
]);
expect(good.mayAtoms).toContain("question_resolved:q");
```

Also prove a final failing target publishes none of the earlier provisional atoms.

- [ ] **Step 2: Write free-order and HPA-255 transition tests**

Use two initially available hotspots and cover both concrete orders for:

- A sets primary A; B completes current and sets B;
- A sets primary A; B completes current and sets A;
- A completes A; B later attempts to set A;
- strict A → B versus free-order A/B;
- unrelated regions;
- three one-shot peers;
- no abstract A → B → A replay;
- primary completion publishing `objective_completed:A` into `mayAtoms`/`mustAtoms`.

- [ ] **Step 3: Run and verify failure**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/reachability.test.ts
```

Expected: FAIL because ordered batch transfer and primary abstract state are not implemented.

- [ ] **Step 4: Implement the lattice and self-excluding equations**

Use:

```ts
type MustActivePrimary =
  | { kind: "uninitialized" }
  | { kind: "known"; id: string | null }
  | { kind: "unknown" };
```

For node `N`, include every reachable `M` in `N.mayExecuteBeforeKeys`, maintain `outN[M]`, exclude M's own prior output from `inN[M]`, and solve with union/meet updates. Publish `objective_completed:<id>` whenever primary completion enters the helper sets.

Implement transition diagnostics:

- unknown/secondary target: existing hard validation;
- next must-completed or current must-equals-next: `primaryObjectiveTransitionAlwaysInvalid`;
- next may-completed or may-equals-next with another successful input: `primaryObjectiveOrderingNotExhaustive`;
- no full-batch successful input: `storyRevealBatchAlwaysInvalid`;
- mixed full-batch success/failure: `storyRevealBatchOrderDependent`.

- [ ] **Step 5: Run and commit**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/reachability.test.ts
bun run check:scripts
git add packages/scripts/compile-scenes/reachability.ts \
  packages/scripts/compile-scenes/reachability.test.ts
git commit -m "feat: add joint story progression fixed point"
```

---

### Task 10: Integrate Reachability into the Compiler and Stabilize Diagnostics

**Files:**
- Modify: `packages/scripts/compile-scenes/orchestrator.ts:1-430`
- Modify: `packages/scripts/compile-scenes.test.ts`
- Modify: `packages/scripts/compile-scenes/validator.test.ts`
- Create fixtures under: `packages/scripts/__fixtures__/invalid/`
- Create warning fixtures under: `packages/scripts/__fixtures__/hpa_257_warnings/`

**Interfaces:**
- Consumes: `buildReachabilityNodes`, `analyzeReachability`, `createAnalysisDefinitionRegistry`, and optional synthetic definitions on `CompileOptions`.
- Produces: compiler errors/warnings merged through the existing `CompileResult` contract with stable ordering.

- [ ] **Step 1: Add end-to-end failing fixtures for every severity**

Add focused invalid fixture directories whose `expected-error.txt` names:

- `positiveSelfReference`;
- `positiveDependencyCycle`;
- `requiredContentUnreachable`;
- `mandatoryAuthorizationUnreachable`;
- `storyRevealBatchAlwaysInvalid`;
- `primaryObjectiveTransitionAlwaysInvalid`.

Add valid-warning fixtures for optional unreachable and order-dependent primary flow.

- [ ] **Step 2: Run the compiler suite and verify failures**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes.test.ts
```

Expected: new fixtures do not yet produce the required results.

- [ ] **Step 3: Add explicit registry injection and invoke the analyzer**

Extend `CompileOptions`:

```ts
export type CompileOptions = {
  sourceRoot: string | string[];
  outputRoot: string;
  assetConfigRoot?: string;
  assetOutputRoot?: string;
  repoRoot?: string;
  analysisRegistry?: AnalysisDefinitionRegistry;
};
```

Construct the production-empty default once:

```ts
const analysisRegistry =
  opts.analysisRegistry ??
  createAnalysisDefinitionRegistry({ scenes: [], boards: [] });
```

After existing `validate(...)` and `validateStoryCatalog(...)` succeed for referenced targets, call:

```ts
const nodes = buildReachabilityNodes({
  chapters,
  scenes,
  catalog: storyCatalog,
  analysisRegistry,
});
const progression = analyzeReachability({ nodes, catalog: storyCatalog });
errors.push(...progression.errors);
warnings.push(...progression.warnings);
```

Do not run effect simulation for unresolved or semantically invalid targets. Sort final new diagnostics with the contract order before returning. Production CLI calls do not supply `analysisRegistry`; tests inject synthetic definitions; HPA-259 later supplies production registrations.

- [ ] **Step 4: Assert legacy zero-diagnostic compatibility**

The production Chapter 1 baseline snapshot from Task 1 must remain byte-identical. Add explicit assertions that no new HPA-257 code appears for a legacy-only node.

- [ ] **Step 5: Run the full compiler gate and commit**

```bash
bun run test:scripts
bun run check:scripts
bun run scenes:compile
git add packages/scripts/compile-scenes/orchestrator.ts \
  packages/scripts/compile-scenes.test.ts \
  packages/scripts/compile-scenes/validator.test.ts \
  packages/scripts/__fixtures__
git commit -m "feat: integrate monotonic reachability into scene compilation"
```

---

### Task 11: Add Rust Wire Types and Startup Validation

**Files:**
- Modify: `apps/game/src-tauri/src/game/schema.rs:120-300`
- Modify: `apps/game/src-tauri/src/game/loader.rs:1-420`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`
- Test: inline tests in `schema.rs` and `loader.rs`

**Interfaces:**
- Consumes: emitted JSON shapes from Tasks 2-6 and loaded `StoryCatalog`.
- Produces: concrete Rust expression/reveal enums and defense-in-depth resource validation.

- [ ] **Step 1: Write failing serde tests**

Deserialize nested thresholds, every story predicate, every story target, `null` next objective, and malformed counts. Prove legacy JSON still round-trips exactly.

- [ ] **Step 2: Write failing loader-defense tests**

Create hand-edited resource JSON cases for:

- unknown fact/question/objective/authorization;
- malformed qualified refs;
- primary `completeObjective`;
- investigation/interrogation grant target;
- invalid/duplicate threshold child;
- unknown/secondary set-primary target;
- objective ID `null` in catalog.

For analysis predicates, HPA-257 startup validates wire shape and slug segments but rejects packaged investigation/interrogation content because no runtime analysis registry exists yet. HPA-259 must replace that rejection with resolution against its production registry rather than changing the wire shape.

- [ ] **Step 3: Run and verify failure**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::schema
cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::loader
```

Expected: FAIL because the Rust wire variants and story-aware loader checks are absent.

- [ ] **Step 4: Implement concrete Serde contracts**

Add `AtLeast { count, conditions }` to both concrete unlock enums and story predicate variants to each. Add:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum StoryRevealTarget { /* exact variants listed in the design §7.3 */ }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum InvestigationRevealTarget {
    Local(RevealTarget),
    Story(StoryRevealTarget),
}
```

Use the equivalent wrapper for interrogation. Change scene JSON reveal arrays to the combined wrappers.

Extend `load_scene_with_catalog` to validate story predicates/targets against the loaded catalog after structural/local validation. Keep `decode_scene_json_without_catalog_for_test` limited to structural checks.

- [ ] **Step 5: Run and commit**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::schema
cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::loader
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
git add apps/game/src-tauri/src/game/schema.rs \
  apps/game/src-tauri/src/game/loader.rs \
  apps/game/src-tauri/src/game/test_support.rs
git commit -m "feat: add HPA-257 runtime wire validation"
```

---

### Task 12: Implement Rust Story Predicate Evaluation and Shared Semantic Parity

**Files:**
- Modify: `apps/game/src-tauri/src/game/unlock.rs`
- Modify: `apps/game/src-tauri/src/game/scenes/investigation.rs`
- Modify: `apps/game/src-tauri/src/game/scenes/interrogation.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Create: `packages/shared/fixtures/unlock-expression-semantics.json`
- Modify: `packages/scripts/compile-scenes/parser-unlock.test.ts`

**Interfaces:**
- Consumes: Rust schema variants and existing local context traits.
- Produces: `StoryUnlockContext`, threshold evaluation, story-aware availability checks, and one fixture corpus executed by TS and Rust.

- [ ] **Step 1: Add the shared data fixture**

Use schema version 1 with valid complete wire expressions, normalized atom-key truth assignments, and expected results. Include legacy predicates, all story predicates, nested thresholds, mixed operators, and threshold short-circuit-equivalent cases.

- [ ] **Step 2: Write failing TypeScript and Rust fixture runners**

TypeScript reads the fixture via `readFileSync`; Rust uses:

```rust
const CASES: &str = include_str!(
    "../../../../../packages/shared/fixtures/unlock-expression-semantics.json"
);
```

Both deserialize the same bytes and evaluate every case.

- [ ] **Step 3: Run and verify failure**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/parser-unlock.test.ts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml unlock_expression_semantics
```

Expected: FAIL because the fixture, threshold evaluator, and story context are absent.

- [ ] **Step 4: Implement shared story context composition**

```rust
pub trait StoryUnlockContext {
    fn fact_asserted(&self, id: &str) -> bool;
    fn question_resolved(&self, id: &str) -> bool;
    fn objective_completed(&self, id: &str) -> bool;
    fn analysis_scene_completed(&self, chapter_id: &str, scene_id: &str) -> bool;
    fn analysis_board_completed(&self, chapter_id: &str, scene_id: &str, board_id: &str) -> bool;
    fn authorization_granted(&self, id: &str) -> bool;
}
```

Change evaluator signatures to accept local and story contexts. Implement `AtLeast` with a true-count short circuit. Update investigation/interrogation scene methods and GameEngine call sites to pass `StoryState` or a focused read adapter. HPA-257 returns false for analysis completion because HPA-259/HPA-260 do not yet provide runtime completion state; packaged investigation/interrogation analysis predicates are rejected at startup by Task 11, so this fallback is reachable only in direct synthetic evaluator tests.

- [ ] **Step 5: Run and commit**

```bash
bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/parser-unlock.test.ts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::unlock
cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::scenes
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
git add packages/shared/fixtures/unlock-expression-semantics.json \
  packages/scripts/compile-scenes/parser-unlock.test.ts \
  apps/game/src-tauri/src/game/unlock.rs \
  apps/game/src-tauri/src/game/scenes \
  apps/game/src-tauri/src/game/mod.rs
git commit -m "feat: evaluate story unlock predicates in Rust"
```

---

### Task 13: Add the Atomic Story Reveal Dispatcher and Trigger Integration

**Files:**
- Modify: `apps/game/src-tauri/src/game/reveals.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Modify: `apps/game/src-tauri/src/game/scenes/investigation.rs`
- Modify: `apps/game/src-tauri/src/game/scenes/interrogation.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`

**Interfaces:**
- Consumes: `StoryRevealTarget`, `StoryCatalog`, mutable `StoryState`, HPA-255 mutation methods, existing `AcquisitionCtx`, and trigger-derived origins.
- Produces: ordered story dispatch, authority/support materialization, whole-command atomicity, and trigger-level idempotence.

- [ ] **Step 1: Write dispatcher tests before implementation**

Cover each target-to-mutation mapping, secondary-only completion, resolver prerequisites, authority match/mismatch, first-origin preservation, fact support union, and set-primary transitions.

- [ ] **Step 2: Write mixed-batch rollback and replay tests**

Create a batch whose final grant fails and assert exact restoration of inventory, acquisition events/ordinals, local overrides, story state, active primary, dialogue segments, trigger progress, and command generation state. Repeat a successful gameplay command and assert the consumed trigger skips dispatch entirely.

- [ ] **Step 3: Run and verify failure**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::reveals
cargo test --manifest-path apps/game/src-tauri/Cargo.toml story_reveal_transaction
```

Expected: FAIL because story dispatch and the transaction-level fixture do not exist.

- [ ] **Step 4: Implement the dispatcher without duplicating HPA-255**

Add focused materialization types:

```rust
pub(super) struct FactSupport {
    pub supporting_records: Vec<InventoryTarget>,
    pub supporting_fact_ids: Vec<String>,
}

pub(super) struct StoryRevealMaterializationContext<'a> {
    pub origin: AssertionOrigin,
    pub fact_support_by_id: &'a BTreeMap<String, FactSupport>,
    pub represented_authority: Option<&'a str>,
}
```

Implement `apply_story_reveal`/`apply_story_reveals` that call `assert_fact`, `reveal_question`, `resolve_question`, `reveal_objective`, `complete_objective`, `set_primary_objective`, and `grant_authorization`. Validate the authored restrictions before delegation. Keep target order identical to the authored array.

Update the two existing reveal orchestration functions to match local/inventory wrappers and delegate story variants. In `mod.rs`, build the assertion origin and mark the owning one-shot trigger inside the existing `command_tx` closure before dispatch. Rollback remains owned by `EngineRollbackSnapshot`.

- [ ] **Step 5: Add the source-boundary guard and commit**

```rust
#[test]
fn reveal_dispatcher_delegates_primary_mutation() {
    let source = include_str!("reveals.rs");
    assert!(source.contains(".set_primary_objective("));
    assert!(!source.contains("active_primary_objective_id ="));
    assert!(!source.contains("objectives.insert("));
}
```

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::reveals
cargo test --manifest-path apps/game/src-tauri/Cargo.toml story_reveal_transaction
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
git add apps/game/src-tauri/src/game/reveals.rs \
  apps/game/src-tauri/src/game/mod.rs \
  apps/game/src-tauri/src/game/scenes \
  apps/game/src-tauri/src/game/test_support.rs
git commit -m "feat: dispatch atomic monotonic story reveals"
```

---

### Task 14: Prove Save/Restore Monotonicity and Runtime/Compiler Order Agreement

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/capture.rs`
- Modify: `apps/game/src-tauri/src/game/save/restore.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`
- Modify: `packages/scripts/compile-scenes/reachability.test.ts`

**Interfaces:**
- Consumes: existing save schema v2 capture/restore, new story effects, and synthetic free-order fixtures.
- Produces: evidence that no new save field/migration is required and that restored positive progress never relocks content.

- [ ] **Step 1: Write a concrete successful round-trip test**

Add focused inline tests in `capture.rs` and `restore.rs`. Drive a synthetic game through evidence acquisition, fact assertion, question resolution, secondary completion, one valid primary transition order, synthetic authority grant, and nested-threshold unlock. Save, reconstruct the engine, restore, and compare the exact public view and relevant internal trigger/story snapshots.

- [ ] **Step 2: Write concrete free-order runtime tests**

Execute A-before-B and B-before-A separately for the synthetic primary fixtures used by the compiler. Assert each concrete result matches the compiler fixture's valid/invalid-order expectation; do not attempt to serialize the compiler's abstract warning state.

- [ ] **Step 3: Run and verify failure**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml hpa_257
```

Expected: FAIL because the focused HPA-257 round-trip and order tests have not been added.

- [ ] **Step 4: Add only test support required for exact recapture**

Do not change `SAVE_SCHEMA_VERSION`, save envelope fields, or migration code. Reuse existing inventory/local progress/StoryState snapshot fields. Expose any new setup or inspection helper only under `#[cfg(test)]` from `test_support.rs`.

- [ ] **Step 5: Run and commit**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml hpa_257
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
git add apps/game/src-tauri/src/game/save/capture.rs \
  apps/game/src-tauri/src/game/save/restore.rs \
  apps/game/src-tauri/src/game/test_support.rs \
  packages/scripts/compile-scenes/reachability.test.ts
git commit -m "test: prove HPA-257 save and order semantics"
```

---

### Task 15: Update Authoring Guidance and Run the Whole-Branch Gate

**Files:**
- Modify: `.claude/skills/writing-investigation-scene/SKILL.md`
- Modify: `.claude/skills/writing-interrogation-scene/SKILL.md`
- Update: PR description/checklist

**Interfaces:**
- Consumes: final compiler/runtime syntax and diagnostics.
- Produces: canonical author guidance and final evidence for merge readiness.

- [ ] **Step 1: Update both authoring skills**

Document exact story predicates/targets, nested `at_least`, no-whitespace comma support, reserved `null`, explicit question resolution, secondary-only direct completion, ordered atomic target lists, one-shot triggers, strict positive-cycle policy, optional/order warnings, and the absence of production grants before HPA-264.

Include this explicit warning:

```text
Do not author authorization:<id> granted as a production unlock gate in HPA-257/HPA-259 content. No production authority event can grant it until HPA-264; mandatory use fails compilation and optional use warns.
```

- [ ] **Step 2: Run formatter checks on documentation and code**

```bash
bun run format:check
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
```

- [ ] **Step 3: Run the complete compiler/workspace gate**

```bash
bun run scenes:compile
bun run check:scripts
bun run test:scripts
bun run test
bun run check
bun run --cwd apps/game check:e2e
```

Expected: all commands exit 0; production Chapter 1 compiles with the same zero-warning legacy snapshot.

- [ ] **Step 4: Run the complete Rust/lint gate**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run lint:all
```

Expected: all Rust tests pass; ESLint, Prettier, rustfmt, and warnings-denied Clippy pass.

Packaged Tauri E2E is not required because this plan uses synthetic content and does not change a production player path or command timing. A discovered production-path or timing change is a scope change: stop, return to design review, and add a separate packaged E2E gate before continuing.

- [ ] **Step 5: Review the complete diff and commit guidance**

Verify:

```bash
git diff --check
git status --short
git diff --stat main...HEAD
```

Confirm there is no catalog/save schema bump, frontend/IPC change, production story edit, generated resource JSON, direct HPA-255 field mutation, or duplicate `.agents/skills` source.

```bash
git add .claude/skills/writing-investigation-scene/SKILL.md \
  .claude/skills/writing-interrogation-scene/SKILL.md
git commit -m "docs: document monotonic story progression authoring"
```

## Final Spec-Coverage Checklist

- Tasks 1-2: legacy compatibility, parser sharing, comma handling, nested `at_least`, invalid counts, structural duplicates.
- Tasks 3-5: story predicates, catalog ownership, qualified analysis refs, reserved `null`, target grammar, resolver/authority/kind validation.
- Task 6: emitted wire shapes and byte-identical legacy output.
- Tasks 7-10: specialized-adapter preservation, strict SCCs, fixed-point reachability, ordered batches, free-order one-shot summaries, primary may/must state, stable diagnostics, required/optional/authority behavior.
- Tasks 11-13: Rust serde/startup defense, TS/Rust semantic parity, runtime predicate evaluation, HPA-255 delegation, atomicity, idempotence, source-boundary guard.
- Task 14: concrete order agreement and save/load monotonicity without schema changes.
- Task 15: author guidance and complete verification.

No implementation task may relax a behavior fixed by the design. A discovered behavior-level conflict returns to design review before code proceeds.