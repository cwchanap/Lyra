# HPA-259 Analysis Scene Compiler Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-quality `analysis_scene_<K>.md` compiler contract that can express and validate the real Chapter 1 Beat 8.5 classify, order, and threshold boards, emit complete immutable runtime JSON, and pass Rust serde tests without implementing runtime evaluation or UI behavior.

**Architecture:** Markdown remains the only authored source. The compiler parses a closed `classify | order | threshold` union into source-located ASTs, validates it against the global story catalog and compiled case-record provenance, derives HPA-257 analysis definitions from parsed scenes, includes boards in fixed-point reachability, and emits deterministic answer-key-containing runtime definitions. Rust receives immutable serde definitions only; HPA-260 owns mutable scene state, evaluation, commands, persistence, and answer-key-free views.

**Tech Stack:** TypeScript 5.6, Bun 1.3.1, Vitest 4, the existing scene tokenizer/compiler pipeline, `@lyra/scene-types`, Rust, Serde, Tauri resources.

## Global Constraints

- The real Chapter 1 Beat 8.5 contract is the acceptance target. Do not design around Chapter 2 compare/route/chain or speculative later templates.
- Support only `classify`, `order`, and `threshold`.
- Keep accepted mappings, accepted orders, eligibility truth, and threshold constraints in compiler AST/runtime JSON only.
- `DialogueItem` remains outside `@lyra/scene-types`.
- Reuse HPA-257 positive expressions, ordered story reveals, and fixed-point reachability. Do not add another unlock language or graph engine.
- HPA-255 remains the owner of objective mutation. The acceptance fixture declares `prepare_narrow_lock_request` as a **secondary** objective and completes it through the existing `complete_objective` reveal.
- Analysis scenes have no represented authority. An authored `grant_authorization` on an analysis board must fail validation; Beat 8.5 cannot grant `narrow_lock_export`.
- Evidence and statements are game-global records. Facts, questions, objectives, and authorizations are game-global catalog definitions. Boards are scene-local and use durable `{chapterId, sceneId, boardId}` references.
- Threshold source-independence counting accepts evidence and statements only. Facts never manufacture an independent source.
- Do not modify the production `docs/stories_plan/chapter_1/chapter.md` or replace `scene_8_5.md`; HPA-265 owns final content insertion.
- Existing non-analysis chapters must compile and deserialize unchanged.
- Do not add extension registries, plugin APIs, generic graph abstractions, Svelte workbench code, runtime board evaluators, `AnalysisSceneState`, draft/save state, or gameplay commands.

---

## File Map

### Create

```text
packages/scripts/compile-scenes/parser-analysis-values.ts
packages/scripts/compile-scenes/parser-analysis-values.test.ts
packages/scripts/compile-scenes/parser-analysis.ts
packages/scripts/compile-scenes/parser-analysis.test.ts
packages/scripts/compile-scenes/validator-analysis.ts
packages/scripts/compile-scenes/validator-analysis.test.ts
packages/scripts/compile-scenes/analysis-type-boundaries.test.ts
packages/scripts/__fixtures__/analysis-valid/
packages/scripts/__fixtures__/analysis-invalid/
```

### Modify

```text
packages/scene-types/src/index.ts
packages/scripts/compile-scenes/types.ts
packages/scripts/compile-scenes/parser-unlock.ts
packages/scripts/compile-scenes/parser-reveals.ts
packages/scripts/compile-scenes/validator.ts
packages/scripts/compile-scenes/story-catalog.ts
packages/scripts/compile-scenes/analysis-definition-registry.ts
packages/scripts/compile-scenes/reachability.ts
packages/scripts/compile-scenes/emitter.ts
packages/scripts/compile-scenes/orchestrator.ts
packages/scripts/compile-scenes/save-content-manifest.ts
packages/scripts/compile-scenes/dialogue-segment-origins.ts
packages/scripts/compile-scenes/semantic-defaults.ts        # only if exhaustive
packages/scripts/compile-scenes/assets/enrich.ts            # only if exhaustive
packages/scripts/compile-scenes.test.ts
apps/game/src-tauri/src/game/schema.rs
apps/game/src-tauri/src/game/loader.rs
apps/game/src-tauri/src/game/navigation.rs
apps/game/src-tauri/src/game/test_support.rs
```

## Locked Markdown Shape

```markdown
# Scene 8.5: 短暫誤判整理點
- **Summary:** 相馬與早坂重新整理目前已證成的內容。

## Intro

[場景：警署走廊，自動販賣機旁。]
**早坂茜**：先把能證明的東西分開。

## Board: 證據包 {#evidence_packages}
- **Kind:** classify
- **Prompt:** 把每張卡放進它真正能支持的證據包。
- **Required:** true
- **Status:** unlocked
- **Reveals:** [assert_fact:miyake_known_lies_are_unrelated_to_murder]
- **Incomplete Feedback:** 還有必要卡片沒有放置。
- **Incorrect Feedback:** 至少有一張卡片放錯證據包。
- **Accepted Feedback:** 證據包已成立。
- **Hint:** 先問每一項資料真正能證明什麼。

### Card: 三宅母親通話紀錄 {#miyake_call}
- **Source:** evidence:miyake_call_record
- **Summary:** 證明三宅隱瞞的是私人通話。
- **Required:** true

### Group: 三宅的小謊 {#miyake_small_lies}
- **Description:** 與殺人無直接關係的隱瞞。
- **Accepted Cards:** [miyake_call]

### Result Dialogue

#### Segment: 分類完成 {#accepted}

**相馬律**：我們證明的是三宅為什麼說謊，不是誰殺了增田。

## Board: 本機事件順序 {#local_event_sequence}
- **Kind:** order
- **Prompt:** 把本機事件排回原始先後。
- **Required:** true
- **Status:** locked
- **Unlock:** analysis_board:chapter_1@analysis_scene_8_5@evidence_packages completed
- **Accepted Order:** [event_1841, event_1842, event_1843, event_1844]
- **Fixed Anchors:** [event_1841@1]
- **Reveals:** [assert_fact:merge_time_is_not_event_time]
- **Incomplete Feedback:** 所有必要事件都必須放入順序。
- **Incorrect Feedback:** 本機事件順序仍有錯誤。
- **Accepted Feedback:** 本機順序已成立。

### Card: 維護模式開啟 {#event_1841}
- **Source:** evidence:event_1841
- **Summary:** 本機事件 1841。
- **Required:** true

### Result Dialogue

#### Segment: 順序完成 {#accepted}

**早坂茜**：本機只告訴我們先後，沒有告訴我們精確秒數。

## Board: 有限調取申請基礎 {#narrow_request_basis}
- **Kind:** threshold
- **Prompt:** 選出足以支持有限調取申請的獨立矛盾。
- **Required:** true
- **Status:** locked
- **Unlock:** analysis_board:chapter_1@analysis_scene_8_5@local_event_sequence completed
- **Eligible Cards:** [lock_sequence, phone_notification, manager_timing]
- **Minimum Selected:** 2
- **Minimum Distinct Source Groups:** 2
- **Required Proof Capabilities:** [time, order]
- **Allowed Procedural Statuses:** [reacquired, exhibit]
- **Require Source Group:** true
- **Reveals:** [assert_fact:two_independent_lock_contradictions_identified, complete_objective:prepare_narrow_lock_request]
- **Incomplete Feedback:** 至少選出兩項紀錄。
- **Incorrect Feedback:** 這組紀錄不足以支持申請。
- **Accepted Feedback:** 有限調取申請基礎已成立。
- **Duplicate Source Feedback:** 這些紀錄沒有提供兩個獨立來源。
- **Ineligible Feedback:** 至少一項紀錄仍不符合程序要求。

### Card: 門鎖本機順序 {#lock_sequence}
- **Source:** evidence:lock_sequence
- **Summary:** 證明裝置只保留事件先後。
- **Required:** false

### Result Dialogue

#### Segment: 申請基礎完成 {#accepted}

**相馬律**：現在我們有兩條獨立矛盾，可以要求有限調取。

## Outro
- **Unlock:** auto

**早坂茜**：接下來，讓審查會決定是否批准。
```

Rules:

- H2 blocks are exactly `Intro`, one or more `Board: ... {#id}`, and `Outro`.
- Board H3 blocks are `Card:`, `Group:` for classify only, and `Result Dialogue`.
- Result Dialogue owns one or more H4 `Segment: ... {#id}` blocks.
- Card/group/result-segment IDs are board-local.
- `Source` accepts `evidence:<id>`, `statement:<id>`, or `fact:<id>`.
- `Fixed Anchors` uses one-based `card_id@position` values.
- `Unlock` is a story-only positive expression.
- `Reveals` is a story-target-only list.
- `Hint` is a single optional string; progressive hints remain HPA-263.
- Threshold capability requirements use aggregate union coverage. Procedural status and source-group presence are per-record eligibility rules.

---

### Task 1: Define the Compiler/Shared Type Boundaries

**Files:**
- Create: `packages/scripts/compile-scenes/analysis-type-boundaries.test.ts`
- Modify: `packages/scene-types/src/index.ts`
- Modify: `packages/scripts/compile-scenes/types.ts`
- Modify: `packages/scripts/compile-scenes/validator.ts`
- Modify: `packages/scripts/compile-scenes/save-content-manifest.ts`

**Interfaces:**
- Produces `AnalysisUnlockExpr`, `AnalysisCardSource`, `AnalysisBoardAst`, `ASTAnalysisScene`, `AnalysisBoardJson`, and `JSONAnalysisScene`.
- `@lyra/scene-types` produces only the `analysis` chapter-index discriminant and a minimal automatic-layout value.

- [ ] **Step 1: Add failing ownership tests**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  AnalysisBoardAst,
  AnalysisBoardJson,
  ASTAnalysisScene,
  JSONAnalysisScene,
} from "./types";
import type { AnalysisBoardLayout, ChaptersIndex } from "@lyra/scene-types";

void (null as unknown as AnalysisBoardAst);
void (null as unknown as AnalysisBoardJson);
void (null as unknown as ASTAnalysisScene);
void (null as unknown as JSONAnalysisScene);
void (null as unknown as AnalysisBoardLayout);
void (null as unknown as ChaptersIndex);

describe("analysis type ownership", () => {
  it("keeps hidden answers and runtime dialogue out of scene-types", () => {
    const source = readFileSync("packages/scene-types/src/index.ts", "utf8");
    expect(source).not.toMatch(/export type DialogueItem\b/);
    expect(source).not.toMatch(/export type StoryRevealTarget\b/);
    expect(source).not.toMatch(/acceptedCards|acceptedOrder|eligibleCardIds/);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/analysis-type-boundaries.test.ts
bun run check:scripts
```

Expected: missing analysis types/discriminant.

- [ ] **Step 3: Add the minimal shared subset**

```ts
export type AnalysisBoardLayout = { mode: "automatic" };
```

Extend `ChaptersIndex.scenes[].type` with `"analysis"`. Do not add board definitions, answers, reveals, dialogue, or feedback to the shared package.

- [ ] **Step 4: Add compiler AST types**

```ts
export type AnalysisUnlockExpr = PositiveExpression<StoryPredicate>;

export type AnalysisCardSource =
  | { kind: "evidence"; id: string }
  | { kind: "statement"; id: string }
  | { kind: "fact"; id: string };

export type ASTAnalysisCard = Located<{
  id: string;
  label: string;
  summary: string;
  source: Located<AnalysisCardSource>;
  required: boolean;
}>;

export type ASTAnalysisResultSegment = Located<{
  id: string;
  label: string;
  dialogue: DialogueItem[];
}>;

export type ASTAnalysisFeedback = {
  incomplete: Located<{ value: string }>;
  incorrect: Located<{ value: string }>;
  accepted: Located<{ value: string }>;
  duplicateSource: Located<{ value: string }> | null;
  ineligible: Located<{ value: string }> | null;
};
```

Define a source-located common board contract plus closed `ASTClassifyBoard`, `ASTOrderBoard`, and `ASTThresholdBoard` variants. Threshold stores eligible card IDs, minimum counts, proof capabilities, allowed procedural statuses, and `requireSourceGroup`.

- [ ] **Step 5: Add immutable JSON equivalents**

`AnalysisBoardJson` must contain the full accepted mapping/order/constraints and result dialogue. `JSONAnalysisScene` is:

```ts
export type JSONAnalysisScene = {
  type: "analysis";
  id: string;
  title: string;
  summary: string;
  intro: JSONDialogueItem[];
  boards: AnalysisBoardJson[];
  outro: {
    unlock: "auto" | AnalysisUnlockExpr;
    dialogue: JSONDialogueItem[];
  };
  assetRefs: AssetRef[];
};
```

- [ ] **Step 6: Extend compiler unions without behavior**

Add `ASTAnalysisScene` to `SceneRecord`; add `JSONAnalysisScene` to emitted-scene/save-content unions. Let TypeScript expose every exhaustive switch that later tasks must update.

- [ ] **Step 7: Verify and commit**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/analysis-type-boundaries.test.ts
bun run check:scripts
git add packages/scene-types/src/index.ts packages/scripts/compile-scenes/types.ts packages/scripts/compile-scenes/validator.ts packages/scripts/compile-scenes/save-content-manifest.ts packages/scripts/compile-scenes/analysis-type-boundaries.test.ts
git commit -m "feat: define analysis scene compiler contracts"
```

---

### Task 2: Parse Analysis Values and Scene Structure

**Files:**
- Create: `packages/scripts/compile-scenes/parser-analysis-values.ts`
- Create: `packages/scripts/compile-scenes/parser-analysis-values.test.ts`
- Create: `packages/scripts/compile-scenes/parser-analysis.ts`
- Create: `packages/scripts/compile-scenes/parser-analysis.test.ts`
- Modify: `packages/scripts/compile-scenes/parser-unlock.ts`
- Modify: `packages/scripts/compile-scenes/parser-reveals.ts`

**Interfaces:**
- Produces `parseAnalysisScene(source, sourceFile, id)`.
- Adds `parseStoryUnlockExpr(...)` by reusing the existing positive-expression parser.
- Adds reveal family `analysis`, returning `StoryRevealTarget[]` only.

- [ ] **Step 1: Write failing value-parser tests**

Cover strict booleans, positive integers, non-empty `[a, b]` lists, card sources, proof-capability/status lists, and `[event_1841@1]` anchors. Reject duplicates, trailing commas, zero/negative values, unknown prefixes, and malformed anchors with exact file/line diagnostics.

- [ ] **Step 2: Implement strict helpers**

```ts
export function parseAnalysisBoolean(input: LocatedText): ParseResult<boolean>;
export function parseAnalysisPositiveInt(input: LocatedText): ParseResult<number>;
export function parseAnalysisIdList(input: LocatedText): ParseResult<LocatedId[]>;
export function parseAnalysisCardSource(input: LocatedText): ParseResult<Located<AnalysisCardSource>>;
export function parseAnalysisFixedAnchors(input: LocatedText): ParseResult<LocatedAnchor[]>;
```

Use stable `analysis*` error codes.

- [ ] **Step 3: Export story-only unlock parsing**

```ts
export function parseStoryUnlockExpr(
  source: string,
  sourceFile: string,
  line: number,
): PositiveParseResult<StoryPredicate> {
  return parsePositiveExpression(source, sourceFile, line, parseStoryPredicate);
}
```

Do not copy precedence, parentheses, `at_least`, or predicate logic.

- [ ] **Step 4: Add an analysis reveal family**

Extend `RevealFamily` with `analysis`. Recognized story targets parse normally. Any local target returns `analysisRevealLocalTargetNotAllowed`.

- [ ] **Step 5: Write failing full-parser tests**

Assert the locked Markdown shape, source lines, all three board variants, cards/groups, accepted order/anchors, threshold constraints, feedback/hint, result segments, and outro. Add one focused structural error per test: unknown heading, missing anchor, unknown kind, locked without unlock, unlocked with unlock, missing feedback, missing/empty result dialogue, classify without group, order without accepted order, threshold missing a required field.

- [ ] **Step 6: Implement `parseAnalysisScene` with the existing cursor pattern**

Use `tokenize` and `parseSceneHeader`. Preserve metadata locations:

```ts
type AnalysisMetadata = Map<
  string,
  { value: string; sourceFile: string; line: number }
>;
```

Reject duplicate and unknown metadata keys at their own lines. Convert dialogue tokens exactly as the current scene parsers do.

- [ ] **Step 7: Verify and commit**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/parser-analysis-values.test.ts packages/scripts/compile-scenes/parser-analysis.test.ts
bun run check:scripts
git add packages/scripts/compile-scenes/parser-analysis-values.ts packages/scripts/compile-scenes/parser-analysis-values.test.ts packages/scripts/compile-scenes/parser-analysis.ts packages/scripts/compile-scenes/parser-analysis.test.ts packages/scripts/compile-scenes/parser-unlock.ts packages/scripts/compile-scenes/parser-reveals.ts
git commit -m "feat: parse analysis scene markdown"
```

---

### Task 3: Validate References, Solutions, and Threshold Satisfiability

**Files:**
- Create: `packages/scripts/compile-scenes/validator-analysis.ts`
- Create: `packages/scripts/compile-scenes/validator-analysis.test.ts`
- Modify: `packages/scripts/compile-scenes/validator.ts`
- Modify: `packages/scripts/compile-scenes/story-catalog.ts`

**Interfaces:**

```ts
export function validateAnalysisScenes(input: {
  scenes: SceneRecord[];
  catalog: ASTStoryCatalog;
  caseRecords: CompiledCaseRecordCorpus;
}): CompileError[];
```

- [ ] **Step 1: Write failing ID/reference tests**

Cover duplicate board/card/group/result IDs; unresolved evidence/statement/fact sources; unresolved story predicates/reveals; and `grantAuthorization` outside authority. Assert code, file, and exact line.

- [ ] **Step 2: Write failing solution tests**

Classify: required card missing, assigned twice, unknown accepted card, no groups.

Order: duplicate/missing/unknown cards, invalid anchor card/position, two anchors in one slot, anchor contradicting accepted order.

Threshold: unknown eligible card, fact used as eligible source, count impossible, distinct groups impossible, missing source group, disallowed/unspecified procedure, missing capability coverage, no satisfying subset.

- [ ] **Step 3: Implement cached indexes**

Build catalog and record maps once. Use the existing typed evidence/statement record key convention; do not repeatedly scan manifests inside board loops.

- [ ] **Step 4: Implement template validation**

- Classify required cards must occur in exactly one accepted group. Optional cards may remain unassigned; if assigned, they may occur only once.
- Accepted order must be an exact permutation of required cards plus any optional card explicitly included by the author.
- Anchor positions are one-based and must match the accepted order.

- [ ] **Step 5: Implement threshold eligibility/satisfiability**

Per-card eligibility checks allowed procedural status and required source-group presence. Selection-level checks minimum count, distinct non-null source groups, and union coverage of required proof capabilities.

Use deterministic DFS with early pruning and return only a boolean; do not emit or store accepted combinations.

- [ ] **Step 6: Reuse story catalog validators**

Extend `buildStoryRevealTargetBatches` with one batch per board using `representedAuthority: null`. Extend `buildStoryPredicateReferences` to walk board/outro story expressions. Existing HPA-255/HPA-257 validators remain authoritative for definitions and grants.

- [ ] **Step 7: Integrate after provenance compilation**

Run general scene/catalog validation, compile the case-record corpus, then call `validateAnalysisScenes`. Do not run analysis semantic validation before provenance exists.

- [ ] **Step 8: Verify and commit**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/validator-analysis.test.ts packages/scripts/compile-scenes/story-catalog.test.ts packages/scripts/compile-scenes/case-record-provenance.test.ts
bun run check:scripts
git add packages/scripts/compile-scenes/validator-analysis.ts packages/scripts/compile-scenes/validator-analysis.test.ts packages/scripts/compile-scenes/validator.ts packages/scripts/compile-scenes/story-catalog.ts
git commit -m "feat: validate analysis board semantics"
```

---

### Task 4: Discover Analysis Scenes and Replace the Synthetic Registry

**Files:**
- Modify: `packages/scripts/compile-scenes/orchestrator.ts`
- Modify: `packages/scripts/compile-scenes/analysis-definition-registry.ts`
- Modify: `packages/scripts/compile-scenes.test.ts`

**Interfaces:**
- Produces `createAnalysisDefinitionRegistryFromScenes(scenes)`.
- Removes `CompileOptions.analysisRegistry`.

- [ ] **Step 1: Write a failing end-to-end discovery test**

Compile a manifest containing `analysis_scene_8_5.md`; assert no unknown-prefix error and a later scene's qualified analysis predicate resolves without injected registry data.

- [ ] **Step 2: Add orchestrator parser dispatch**

```ts
} else if (file.startsWith("analysis_scene_")) {
  const parsed = parseAnalysisScene(source, sourceFileTag, sceneId);
  if (!parsed.ok) {
    errors.push(parsed.error);
    failedParseFiles.add(sourceFileTag);
  } else {
    scenes.push({ chapterId: dirName, file, ast: parsed.value });
  }
}
```

- [ ] **Step 3: Derive the registry from parsed scenes**

```ts
export function createAnalysisDefinitionRegistryFromScenes(
  scenes: readonly SceneRecord[],
): AnalysisDefinitionRegistry;
```

Register every analysis scene and board using chapter/scene/board IDs. Keep the low-level registry unit tests, but remove it as a production compiler input.

- [ ] **Step 4: Remove synthetic injection**

Delete `CompileOptions.analysisRegistry`. Migrate HPA-257 tests to minimal real analysis Markdown fixtures.

- [ ] **Step 5: Lock pipeline order**

```text
parse -> general validation -> case-record corpus -> analysis validation
     -> derived analysis registry -> story predicate validation
     -> fixed-point reachability -> dialogue origins/emission
```

- [ ] **Step 6: Verify and commit**

```bash
bun run test:scripts -- packages/scripts/compile-scenes.test.ts packages/scripts/compile-scenes/analysis-definition-registry.test.ts packages/scripts/compile-scenes/story-catalog.test.ts
bun run check:scripts
git add packages/scripts/compile-scenes/orchestrator.ts packages/scripts/compile-scenes/analysis-definition-registry.ts packages/scripts/compile-scenes.test.ts packages/scripts/compile-scenes/analysis-definition-registry.test.ts packages/scripts/compile-scenes/story-catalog.test.ts packages/scripts/__fixtures__
git commit -m "feat: register parsed analysis scene definitions"
```

---

### Task 5: Add Analysis Nodes to HPA-257 Reachability

**Files:**
- Modify: `packages/scripts/compile-scenes/reachability.ts`
- Modify: `packages/scripts/compile-scenes/reachability.test.ts`

**Interfaces:**
- Produces qualified board/scene completion atoms and applies existing ordered story reveal effects.

- [ ] **Step 1: Write failing analysis reachability tests**

Cover unlocked required board, board-to-board unlock, threshold output, auto outro, unavailable required record, optional-board-only mandatory output, self-reference, and two-board positive cycle.

- [ ] **Step 2: Add required-card prerequisites**

```ts
function analysisRequiredCardPredicates(
  board: AnalysisBoardAst,
): ReachabilityPredicate[] {
  return board.cards.filter((card) => card.required).map((card) => {
    switch (card.source.kind) {
      case "evidence":
        return { predicate: "atom", atom: `evidence_collected:${card.source.id}` };
      case "statement":
        return { predicate: "atom", atom: `statement_acquired:${card.source.id}` };
      case "fact":
        return { predicate: "atom", atom: `fact_asserted:${card.source.id}` };
    }
  });
}
```

- [ ] **Step 3: Implement `buildAnalysisNodes`**

Each board node:

- is mandatory iff `required`;
- is initially reachable iff `Status: unlocked`;
- uses the authored story-only unlock condition;
- has required-card atoms as implicit prerequisites;
- adds `analysis_board_completed:<chapter>@<scene>@<board>`;
- applies board reveals in authored order.

Auto outro requires all required board atoms and adds `analysis_scene_completed:<chapter>@<scene>`.

- [ ] **Step 4: Keep the solver unchanged**

Only add scene adaptation and normalization helpers. Do not alter HPA-257 scenario enumeration, cycle detection, transfer logic, or `at_least` evaluation.

- [ ] **Step 5: Verify and commit**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/reachability.test.ts packages/scripts/compile-scenes/story-catalog.test.ts
bun run check:scripts
git add packages/scripts/compile-scenes/reachability.ts packages/scripts/compile-scenes/reachability.test.ts packages/scripts/compile-scenes/orchestrator.ts
git commit -m "feat: analyze analysis board reachability"
```

---

### Task 6: Emit Deterministic JSON and Dialogue Origins

**Files:**
- Modify: `packages/scripts/compile-scenes/emitter.ts`
- Modify: `packages/scripts/compile-scenes/orchestrator.ts`
- Modify: `packages/scripts/compile-scenes/save-content-manifest.ts`
- Modify: `packages/scripts/compile-scenes/dialogue-segment-origins.ts`
- Modify: `packages/scripts/compile-scenes/dialogue-segment-origins.test.ts`
- Modify exhaustive semantic-default/asset files only when TypeScript requires it.

**Interfaces:**
- Produces `emitAnalysisScene(ast): JSONAnalysisScene`.
- Adds stable `analysisIntro`, `analysisResult`, and `analysisOutro` origins.

- [ ] **Step 1: Write failing emitter/origin tests**

Assert board/card/group/result order, hidden solutions, locations stripped, automatic layout, and deterministic output. Lock origins:

```ts
{ type: "analysisIntro", chapterId, sceneId }
{ type: "analysisResult", chapterId, sceneId, boardId, segmentId }
{ type: "analysisOutro", chapterId, sceneId }
```

- [ ] **Step 2: Implement pure AST-to-JSON emission**

Copy every array/value; never emit AST location fields. Preserve authored order. Add an explicit analysis branch to `emitSceneRecord`.

- [ ] **Step 3: Extend content revision/dialogue derivation**

Add `JSONAnalysisScene` to emitted bundles and include intro, board result segments, and outro in dialogue-origin collision validation/content hashing. Do not add mutable analysis save state.

- [ ] **Step 4: Close exhaustive switches without new semantics**

Reuse existing dialogue asset enrichment. Pass board definitions through unchanged; do not invent board asset or layout-editor rules.

- [ ] **Step 5: Verify and commit**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/emitter.test.ts packages/scripts/compile-scenes/dialogue-segment-origins.test.ts packages/scripts/compile-scenes.test.ts
bun run check:scripts
git add packages/scripts/compile-scenes/emitter.ts packages/scripts/compile-scenes/orchestrator.ts packages/scripts/compile-scenes/save-content-manifest.ts packages/scripts/compile-scenes/dialogue-segment-origins.ts packages/scripts/compile-scenes/dialogue-segment-origins.test.ts packages/scripts/compile-scenes/semantic-defaults.ts packages/scripts/compile-scenes/assets/enrich.ts packages/scripts/compile-scenes.test.ts
git commit -m "feat: emit analysis scene runtime definitions"
```

---

### Task 7: Add Rust Immutable Serde Types and Fail Closed

**Files:**
- Modify: `apps/game/src-tauri/src/game/schema.rs`
- Modify: `apps/game/src-tauri/src/game/loader.rs`
- Modify: `apps/game/src-tauri/src/game/navigation.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`

**Interfaces:**
- Produces immutable `AnalysisSceneJson`/`AnalysisBoardJson` serde definitions.
- Does not produce runtime state, evaluator, public view, command, or save types.

- [ ] **Step 1: Write failing Rust serde tests**

Deserialize the emitted valid fixture and assert all three variants, hidden solutions, feedback/hint, reveals, result dialogue, and constraints. Reject unknown fields/malformed variants. Assert `scene_dialogue_groups` includes intro, ordered result segments, and outro.

- [ ] **Step 2: Add scene/index variants**

```rust
pub enum SceneType {
    Linear,
    Investigation,
    Interrogation,
    Analysis,
}

pub enum SceneJson {
    Linear(LinearSceneJson),
    Investigation(InvestigationSceneJson),
    Interrogation(InterrogationSceneJson),
    Analysis(AnalysisSceneJson),
}
```

- [ ] **Step 3: Add a closed board enum**

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum AnalysisBoardJson {
    Classify { /* exact emitted fields */ },
    Order { /* exact emitted fields */ },
    Threshold { /* exact emitted fields */ },
}
```

Repeat common fields per variant if flattening would weaken `deny_unknown_fields` or change the compiler shape.

- [ ] **Step 4: Add loader defense-in-depth checks**

Reject duplicate local IDs, unresolved local solution references, malformed permutations/anchors, and obviously impossible minimums in hand-edited packaged JSON. Catalog/story references continue through existing validation seams.

- [ ] **Step 5: Fail closed before HPA-260**

When navigation tries to construct a runtime from `SceneJson::Analysis`, return a typed load error such as `analysis scene runtime requires HPA-260`. Do not auto-skip or map it to linear dialogue. Production Chapter 1 still uses `scene_8_5.md`, so existing gameplay remains unaffected.

- [ ] **Step 6: Verify and commit**

```bash
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
git add apps/game/src-tauri/src/game/schema.rs apps/game/src-tauri/src/game/loader.rs apps/game/src-tauri/src/game/navigation.rs apps/game/src-tauri/src/game/test_support.rs
git commit -m "feat: accept immutable analysis scene definitions in Rust"
```

---

### Task 8: Build the Chapter 1-Shaped Acceptance Corpus and Run Regression

**Files:**
- Create valid/invalid fixture corpora under `packages/scripts/__fixtures__/analysis-*`.
- Modify: `packages/scripts/compile-scenes.test.ts`
- Modify focused compiler/Rust tests as needed.

**Interfaces:**
- Produces the canonical HPA-259 fixture that HPA-260/HPA-261 can mirror.
- Does not alter production Chapter 1.

- [ ] **Step 1: Author the valid corpus**

Use these board/output contracts:

```text
evidence_packages
  -> miyake_known_lies_are_unrelated_to_murder
  -> earlier_external_entry_exists
local_event_sequence
  -> merge_time_is_not_event_time
narrow_request_basis
  -> two_independent_lock_contradictions_identified
  -> complete secondary objective prepare_narrow_lock_request
```

Do not grant `narrow_lock_export`.

Include records with at least two source groups, `reacquired`/`exhibit` statuses, and `time`/`order` capability coverage. Include an individually eligible same-source pair that cannot satisfy the distinct-source rule alone.

- [ ] **Step 2: Author focused invalid corpora**

One primary failure per corpus: duplicate ID, missing/unresolved card, incomplete classify/order solution, impossible count, impossible source groups, missing provenance, missing capability, disallowed procedure, unreachable required board/output, and grant outside authority.

- [ ] **Step 3: Add end-to-end acceptance tests**

Assert the valid corpus:

- compiles without synthetic registry input;
- emits one `analysis` scene and stable qualified board refs;
- emits byte-identical JSON on two runs;
- passes semantic/reachability/dialogue-origin validation;
- is accepted by Rust serde;
- contains all four facts and the request-readiness objective output.

- [ ] **Step 4: Lock legacy production behavior**

Assert production Chapter 1 still lists `scene_8_5.md`, not `analysis_scene_8_5.md`, and all existing scene types compile unchanged. Assert no hidden answer-key terms are exported from `@lyra/scene-types` or frontend source.

- [ ] **Step 5: Run the full gate**

```bash
bun run format:check
bun run check:scripts
bun run test:scripts
bun run scenes:compile
bun run check
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run lint:all
```

Expected: every command passes; production Chapter 1 remains on the existing linear Beat 8.5.

- [ ] **Step 6: Commit**

```bash
git add packages/scripts/__fixtures__/analysis-valid packages/scripts/__fixtures__/analysis-invalid packages/scripts/compile-scenes.test.ts packages/scripts/compile-scenes/*.test.ts apps/game/src-tauri/src/game
git commit -m "test: accept the Chapter 1 analysis compiler contract"
```

---

## Self-Review Checklist

- [ ] Every HPA-259 acceptance criterion maps to a task above.
- [ ] No `TBD`, generic plugin interface, future-template registry, or Chapter 2 field remains.
- [ ] Type names/property names match across parser, validator, emitter, and Rust tasks.
- [ ] Registry definitions derive only from parsed scenes.
- [ ] Threshold semantics distinguish per-record eligibility from aggregate selection requirements.
- [ ] `prepare_narrow_lock_request` is secondary in the acceptance fixture; `narrow_lock_export` is not granted.
- [ ] Source-location diagnostics are asserted for every invalid family.
- [ ] Shared/public types contain no accepted solution data.
- [ ] Production Chapter 1 authoring is untouched.

## Execution Handoff

Execute on:

```text
jack65786656/hpa-259-add-chapter-1-analysis-scene-markdown-schema-and-validation
```

Recommended mode: `superpowers:subagent-driven-development`, one implementation subagent per task, with specification-compliance review followed by code-quality review before advancing.