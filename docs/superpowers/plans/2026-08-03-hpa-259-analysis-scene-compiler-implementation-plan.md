# HPA-259 Analysis Scene Compiler Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-quality `analysis_scene_<K>.md` compiler contract that expresses and validates the real Chapter 1 Beat 8.5 classify, order, and threshold boards, emits complete immutable runtime JSON, and is accepted by Rust serde without implementing runtime evaluation or UI behavior.

**Architecture:** Markdown remains the sole authored source. The compiler parses a closed `classify | order | threshold` board union into compiler-only ASTs with source locations, validates references and satisfiability against the existing story catalog and case-record corpus, derives the HPA-257 analysis-definition registry from parsed scenes, and emits deterministic answer-key-containing runtime definitions. Rust receives immutable serde definitions only; HPA-260 owns mutable state, evaluation, commands, persistence, and answer-key-free views.

**Tech Stack:** TypeScript 5.6, Bun 1.3.1, Vitest 4, the existing line tokenizer and compiler pipeline, `@lyra/scene-types`, Rust/Serde, Tauri resources.

## Global Constraints

- The real Chapter 1 Beat 8.5 shape is the primary acceptance fixture; Chapter 2 compare/route/chain requirements must not influence this contract.
- Support only `classify`, `order`, and `threshold` boards.
- Keep accepted mappings, orders, eligible truth, and threshold constraints in compiler AST/runtime JSON; never expose them through `@lyra/scene-types`, a public view, or frontend fixture.
- `DialogueItem` remains defined outside `@lyra/scene-types`.
- HPA-257 owns positive expressions, ordered reveal dispatch, and fixed-point reachability. Reuse those contracts; do not add a second unlock parser or reachability engine.
- HPA-255 owns objective state transitions. Analysis boards may emit existing story reveal targets but must not duplicate objective mutation rules.
- Analysis scenes are not represented authorities. `grantAuthorization` authored on an analysis board must fail validation. Beat 8.5 may establish request-readiness facts/objectives but cannot grant `narrow_lock_export`.
- Evidence and statements remain game-global records; facts, questions, objectives, and authorizations remain game-global catalog definitions; boards are scene-local and use durable `{chapterId, sceneId, boardId}` references.
- Threshold independent-source counting uses evidence/statement records only. Facts cannot manufacture source independence.
- Do not modify `docs/stories_plan/chapter_1/chapter.md` or replace `scene_8_5.md` in this ticket. HPA-265 owns final production authoring and scene replacement.
- Existing chapters with no analysis scenes must compile and deserialize unchanged.
- Do not add extension registries, plugin APIs, generic graph models, freeform evaluators, Svelte components, `AnalysisSceneState`, drafts, save state, or runtime commands.

---

## File Structure

### New compiler files

- `packages/scripts/compile-scenes/parser-analysis-values.ts` — parses strict metadata scalars/lists, card sources, and fixed anchors.
- `packages/scripts/compile-scenes/parser-analysis-values.test.ts` — focused syntax/error coverage for those helpers.
- `packages/scripts/compile-scenes/parser-analysis.ts` — parses the analysis-scene heading hierarchy into source-located ASTs.
- `packages/scripts/compile-scenes/parser-analysis.test.ts` — valid and structurally invalid Markdown parser coverage.
- `packages/scripts/compile-scenes/validator-analysis.ts` — cross-file reference, solution-completeness, provenance, and satisfiability validation.
- `packages/scripts/compile-scenes/validator-analysis.test.ts` — focused semantic-invalid fixtures and exact diagnostic locations.
- `packages/scripts/compile-scenes/analysis-type-boundaries.test.ts` — guards against answer-key leakage into shared/public types.

### New fixtures

- `packages/scripts/__fixtures__/analysis-valid/` — complete mini-corpus with classify/order/threshold and HPA-257 unlock/reveal interaction.
- `packages/scripts/__fixtures__/analysis-invalid/` — one focused corpus per required compiler diagnostic.

### Modified compiler/shared files

- `packages/scene-types/src/index.ts`
- `packages/scripts/compile-scenes/types.ts`
- `packages/scripts/compile-scenes/parser-unlock.ts`
- `packages/scripts/compile-scenes/parser-reveals.ts`
- `packages/scripts/compile-scenes/validator.ts`
- `packages/scripts/compile-scenes/story-catalog.ts`
- `packages/scripts/compile-scenes/analysis-definition-registry.ts`
- `packages/scripts/compile-scenes/reachability.ts`
- `packages/scripts/compile-scenes/emitter.ts`
- `packages/scripts/compile-scenes/orchestrator.ts`
- `packages/scripts/compile-scenes/save-content-manifest.ts`
- `packages/scripts/compile-scenes/dialogue-segment-origins.ts`
- `packages/scripts/compile-scenes/semantic-defaults.ts` only if its exhaustive scene switch requires an explicit analysis pass-through.
- `packages/scripts/compile-scenes/assets/enrich.ts` only if its exhaustive scene switch requires an explicit analysis branch.
- `packages/scripts/compile-scenes.test.ts`

### Modified Rust files

- `apps/game/src-tauri/src/game/schema.rs` — immutable analysis scene/board serde types and dialogue-group enumeration.
- `apps/game/src-tauri/src/game/loader.rs` — defense-in-depth validation for immutable analysis definitions.
- `apps/game/src-tauri/src/game/navigation.rs` — explicit fail-closed handling before HPA-260 adds a runtime state.
- `apps/game/src-tauri/src/game/scenes/mod.rs` only if the existing construction seam requires a typed unsupported-analysis error; do not add an analysis runtime variant.
- `apps/game/src-tauri/src/game/test_support.rs` — serde/resource fixture helpers where needed.

---

## Locked Authoring Contract

The parser implemented by this plan accepts this exact heading hierarchy:

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

### Card: 三宅的說法 {#miyake_statement}
- **Source:** statement:miyake_statement
- **Summary:** 三宅承認進過後場，但只到前段走廊。
- **Required:** true

### Group: 三宅的小謊 {#miyake_small_lies}
- **Description:** 與殺人無直接關係的隱瞞。
- **Accepted Cards:** [miyake_call, miyake_statement]

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

### Card: 外包憑證開門 {#event_1842}
- **Source:** evidence:event_1842
- **Summary:** 本機事件 1842。
- **Required:** true

### Card: 員工憑證開門 {#event_1843}
- **Source:** evidence:event_1843
- **Summary:** 本機事件 1843。
- **Required:** true

### Card: 同步完成 {#event_1844}
- **Source:** evidence:event_1844
- **Summary:** 本機事件 1844。
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

### Card: 死者手機通知 {#phone_notification}
- **Source:** evidence:phone_notification
- **Summary:** 提供獨立的衝突時間錨。
- **Required:** false

### Card: 店長的時間證詞 {#manager_timing}
- **Source:** statement:manager_timing
- **Summary:** 提供另一個可被程序固定的時間來源。
- **Required:** false

### Result Dialogue

#### Segment: 申請基礎完成 {#accepted}

**相馬律**：現在我們有兩條獨立矛盾，可以要求有限調取。

## Outro
- **Unlock:** auto

**早坂茜**：接下來，讓審查會決定是否批准。
```

Authoring rules locked by this plan:

- H1 uses the existing tokenized scene header and immediate `- **Summary:**` syntax.
- Top-level H2 blocks are exactly `Intro`, one or more `Board: <label> {#id}`, and `Outro`.
- Board-local H3 blocks are `Card:`, `Group:` for classify only, and `Result Dialogue`.
- Result Dialogue owns one or more H4 `Segment: <label> {#id}` blocks.
- Card IDs, group IDs, and result-segment IDs are local to one board.
- `Source` accepts `evidence:<id>`, `statement:<id>`, or `fact:<id>` only. Chapter 1 threshold candidates must be evidence or statements.
- `Fixed Anchors` uses one-based author positions in `card_id@position` form.
- `Unlock` uses a story-only positive expression. No investigation/interrogation local predicates are valid inside analysis scenes.
- Board `Reveals` accepts story reveal targets only.
- `grant_authorization` parses through the common reveal grammar but fails semantic validation because an analysis board has no represented authority.
- `Hint` is a single optional authored string in HPA-259. Multi-level/progressive hints remain HPA-263.
- Threshold required proof capabilities are aggregate union coverage across the selected records. Allowed procedural status and required source group are per-record eligibility requirements.

---

### Task 1: Lock the Type Boundary and Add the Analysis Scene Discriminant

**Files:**
- Create: `packages/scripts/compile-scenes/analysis-type-boundaries.test.ts`
- Modify: `packages/scene-types/src/index.ts`
- Modify: `packages/scripts/compile-scenes/types.ts`

**Interfaces:**
- Produces `AnalysisUnlockExpr`, `AnalysisCardSource`, source-located analysis ASTs, immutable analysis JSON definitions, and the `analysis` chapter-index discriminant.
- Later tasks consume the exact type names and property names defined here.
- `@lyra/scene-types` produces only `AnalysisBoardLayout` presentation data and the chapter-index discriminant; it does not produce full board definitions.

- [ ] **Step 1: Write the failing type-boundary tests**

Create `analysis-type-boundaries.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  AnalysisBoardAst,
  AnalysisBoardJson,
  AnalysisCardSource,
  ASTAnalysisScene,
  JSONAnalysisScene,
} from "./types";
import type { AnalysisBoardLayout, ChaptersIndex } from "@lyra/scene-types";

void (null as unknown as AnalysisBoardAst);
void (null as unknown as AnalysisBoardJson);
void (null as unknown as AnalysisCardSource);
void (null as unknown as ASTAnalysisScene);
void (null as unknown as JSONAnalysisScene);
void (null as unknown as AnalysisBoardLayout);
void (null as unknown as ChaptersIndex);

describe("analysis type ownership", () => {
  it("keeps answer-key and dialogue contracts out of scene-types", () => {
    const shared = readFileSync("packages/scene-types/src/index.ts", "utf8");
    expect(shared).not.toMatch(/acceptedCards|acceptedOrder|eligibleCardIds/);
    expect(shared).not.toContain("DialogueItem");
    expect(shared).not.toContain("StoryRevealTarget");
  });

  it("adds analysis to the shared chapter index", () => {
    const shared = readFileSync("packages/scene-types/src/index.ts", "utf8");
    expect(shared).toContain(
      'type: "linear" | "investigation" | "interrogation" | "analysis"',
    );
  });
});
```

- [ ] **Step 2: Run the focused test and type-check to verify failure**

Run:

```bash
bun run test:scripts -- packages/scripts/compile-scenes/analysis-type-boundaries.test.ts
bun run check:scripts
```

Expected: FAIL because the analysis types and chapter-index discriminant do not exist.

- [ ] **Step 3: Add the minimal shared presentation boundary**

In `packages/scene-types/src/index.ts`, add:

```ts
export type AnalysisBoardLayout = {
  mode: "automatic";
};
```

Extend `ChaptersIndex.scenes[].type` to include `"analysis"`.

Do not add card, solution, reveal, dialogue, or feedback fields to this package.

- [ ] **Step 4: Add the compiler AST and immutable JSON types**

In `types.ts`, add the following exact public contracts:

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

export type ASTAnalysisFeedback = {
  incomplete: Located<{ value: string }>;
  incorrect: Located<{ value: string }>;
  accepted: Located<{ value: string }>;
  duplicateSource: Located<{ value: string }> | null;
  ineligible: Located<{ value: string }> | null;
};

export type ASTAnalysisResultSegment = Located<{
  id: string;
  label: string;
  dialogue: DialogueItem[];
}>;

export type ASTAnalysisBoardCommon = Located<{
  id: string;
  label: string;
  prompt: string;
  required: boolean;
  status: "locked" | "unlocked";
  unlock: AnalysisUnlockExpr | null;
  cards: ASTAnalysisCard[];
  reveals: StoryRevealTarget[];
  feedback: ASTAnalysisFeedback;
  hint: Located<{ value: string }> | null;
  resultDialogue: ASTAnalysisResultSegment[];
  layout: AnalysisBoardLayout;
}>;

export type ASTClassifyGroup = Located<{
  id: string;
  label: string;
  description: string;
  acceptedCardIds: Array<Located<{ id: string }>>;
}>;

export type ASTClassifyBoard = ASTAnalysisBoardCommon & {
  kind: "classify";
  groups: ASTClassifyGroup[];
};

export type ASTOrderBoard = ASTAnalysisBoardCommon & {
  kind: "order";
  acceptedOrder: Array<Located<{ id: string }>>;
  fixedAnchors: Array<Located<{ cardId: string; position: number }>>;
};

export type ASTThresholdBoard = ASTAnalysisBoardCommon & {
  kind: "threshold";
  eligibleCardIds: Array<Located<{ id: string }>>;
  minimumSelected: Located<{ value: number }>;
  minimumDistinctSourceGroups: Located<{ value: number }>;
  requiredProofCapabilities: Array<Located<{ value: ProofCapability }>>;
  allowedProceduralStatuses: Array<Located<{ value: ProceduralStatus }>>;
  requireSourceGroup: Located<{ value: boolean }>;
};

export type AnalysisBoardAst =
  | ASTClassifyBoard
  | ASTOrderBoard
  | ASTThresholdBoard;

export type ASTAnalysisScene = Located<{
  kind: "analysisScene";
  id: string;
  title: string;
  summary: string;
  summaryAuthored: boolean;
  intro: DialogueItem[];
  boards: AnalysisBoardAst[];
  outro: {
    unlock: "auto" | AnalysisUnlockExpr;
    dialogue: DialogueItem[];
  };
  assetRefs: AssetRef[];
}>;
```

Add JSON equivalents with no `Located` wrappers. The JSON board union must be discriminated by `kind` and must include full accepted solutions and threshold constraints. Add:

```ts
export type JSONAnalysisScene = {
  type: "analysis";
  id: string;
  title: string;
  summary: string;
  intro: JSONDialogueItem[];
  boards: AnalysisBoardJson[];
  outro: { unlock: "auto" | AnalysisUnlockExpr; dialogue: JSONDialogueItem[] };
  assetRefs: AssetRef[];
};
```

- [ ] **Step 5: Extend `SceneRecord` and emitted-scene unions only after types exist**

Update `validator.ts` and `save-content-manifest.ts` type unions to include `ASTAnalysisScene` and `JSONAnalysisScene`. Do not add behavior yet; exhaustive switches may remain failing until later tasks.

- [ ] **Step 6: Re-run the focused test and type-check**

Run:

```bash
bun run test:scripts -- packages/scripts/compile-scenes/analysis-type-boundaries.test.ts
bun run check:scripts
```

Expected: PASS for the ownership tests; type-check may now expose exhaustive switches that later tasks must close. Record those compiler errors as the exact work list for Tasks 4–7 rather than weakening types.

- [ ] **Step 7: Commit**

```bash
git add packages/scene-types/src/index.ts packages/scripts/compile-scenes/types.ts packages/scripts/compile-scenes/validator.ts packages/scripts/compile-scenes/save-content-manifest.ts packages/scripts/compile-scenes/analysis-type-boundaries.test.ts
git commit -m "feat: define analysis scene compiler contracts"
```

---

### Task 2: Parse Strict Analysis Metadata and Markdown Structure

**Files:**
- Create: `packages/scripts/compile-scenes/parser-analysis-values.ts`
- Create: `packages/scripts/compile-scenes/parser-analysis-values.test.ts`
- Create: `packages/scripts/compile-scenes/parser-analysis.ts`
- Create: `packages/scripts/compile-scenes/parser-analysis.test.ts`
- Modify: `packages/scripts/compile-scenes/parser-unlock.ts`
- Modify: `packages/scripts/compile-scenes/parser-reveals.ts`

**Interfaces:**
- Consumes the AST contracts from Task 1 and existing `tokenize`, `parseSceneHeader`, positive-expression parser, story reveal parser, and dialogue token conversion.
- Produces `parseAnalysisScene(source, sourceFile, id): AnalysisParseResult`.
- Produces `parseStoryUnlockExpr(...)` and an `analysis` reveal family that returns `StoryRevealTarget[]` only.

- [ ] **Step 1: Write failing helper tests**

Cover exact parsing and diagnostics for:

```ts
parseAnalysisBoolean("true") === true;
parseAnalysisPositiveInt("2") === 2;
parseAnalysisIdList("[a, b]") === ["a", "b"];
parseAnalysisCardSource("evidence:lock_sequence");
parseAnalysisFixedAnchors("[event_1841@1, event_1844@4]");
```

Also assert failure for empty lists where non-empty is required, duplicate IDs, zero/negative/non-integer positions, malformed card prefixes, and trailing commas.

- [ ] **Step 2: Run helper tests to verify failure**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/parser-analysis-values.test.ts
```

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement strict helper functions**

Implement functions with source-file/line inputs and `CompileError` outputs:

```ts
export function parseAnalysisBoolean(input: LocatedText): ParseResult<boolean>;
export function parseAnalysisPositiveInt(input: LocatedText): ParseResult<number>;
export function parseAnalysisIdList(input: LocatedText): ParseResult<LocatedId[]>;
export function parseAnalysisCardSource(input: LocatedText): ParseResult<Located<AnalysisCardSource>>;
export function parseAnalysisFixedAnchors(input: LocatedText): ParseResult<LocatedAnchor[]>;
export function parseAnalysisProofCapabilityList(input: LocatedText): ParseResult<LocatedValue<ProofCapability>[]>;
export function parseAnalysisProceduralStatusList(input: LocatedText): ParseResult<LocatedValue<ProceduralStatus>[]>;
```

Use stable error codes prefixed with `analysis`, for example `analysisListMalformed`, `analysisListDuplicateItem`, `analysisPositiveIntInvalid`, `analysisCardSourceMalformed`, and `analysisFixedAnchorMalformed`.

- [ ] **Step 4: Add a story-only unlock parser**

Export this function from `parser-unlock.ts` using the existing generic parser and existing `parseStoryPredicate`:

```ts
export function parseStoryUnlockExpr(
  source: string,
  sourceFile: string,
  line: number,
): PositiveParseResult<StoryPredicate> {
  return parsePositiveExpression(
    source,
    sourceFile,
    line,
    parseStoryPredicate,
  );
}
```

Do not duplicate precedence, `at_least`, cycle, or predicate parsing logic.

- [ ] **Step 5: Add an analysis reveal family**

Extend `RevealFamily` to:

```ts
export type RevealFamily = "investigation" | "interrogation" | "analysis";
```

Map `analysis` to `StoryRevealTarget`. When an item is not a recognized story target and the family is `analysis`, return `analysisRevealLocalTargetNotAllowed` rather than attempting investigation/interrogation local parsing.

- [ ] **Step 6: Write the failing full-scene parser tests**

Create an inline valid scene matching the locked contract and assert:

- summary and source line;
- intro dialogue;
- three board variants;
- cards and local IDs;
- classify groups and accepted card IDs;
- order accepted order and one-based fixed anchors;
- threshold constraints;
- story-only unlock expression;
- board reveals;
- feedback and optional hint;
- ordered result segments;
- outro.

Add structural failures for unknown H2/H3/H4, missing board anchor, unknown Kind, locked without Unlock, unlocked with Unlock, missing feedback, missing Result Dialogue, empty Result Dialogue, classify without groups, order without accepted order, and threshold without all required constraint fields.

- [ ] **Step 7: Run the parser test to verify failure**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/parser-analysis.test.ts
```

Expected: FAIL because `parseAnalysisScene` does not exist.

- [ ] **Step 8: Implement `parseAnalysisScene` using the existing cursor pattern**

Use `tokenize` and `parseSceneHeader`. Keep metadata in a map that preserves each token's line:

```ts
type AnalysisMetadata = Map<
  string,
  { value: string; sourceFile: string; line: number }
>;
```

Parse:

```text
H1 Scene
  H2 Intro
  H2 Board
    metadata
    H3 Card
    H3 Group (classify only)
    H3 Result Dialogue
      H4 Segment
  H2 Outro
```

Convert dialogue tokens exactly as existing scene parsers do. Reject duplicate metadata keys at the second key's line. Reject every unknown key instead of silently ignoring it.

- [ ] **Step 9: Run parser/helper tests and type-check**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/parser-analysis-values.test.ts packages/scripts/compile-scenes/parser-analysis.test.ts
bun run check:scripts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/scripts/compile-scenes/parser-analysis-values.ts packages/scripts/compile-scenes/parser-analysis-values.test.ts packages/scripts/compile-scenes/parser-analysis.ts packages/scripts/compile-scenes/parser-analysis.test.ts packages/scripts/compile-scenes/parser-unlock.ts packages/scripts/compile-scenes/parser-reveals.ts
git commit -m "feat: parse analysis scene markdown"
```

---

### Task 3: Validate Board References, Solutions, and Threshold Satisfiability

**Files:**
- Create: `packages/scripts/compile-scenes/validator-analysis.ts`
- Create: `packages/scripts/compile-scenes/validator-analysis.test.ts`
- Modify: `packages/scripts/compile-scenes/validator.ts`
- Modify: `packages/scripts/compile-scenes/story-catalog.ts`
- Modify: `packages/scripts/compile-scenes/case-record-provenance.ts` only if a read-only lookup helper is needed; do not change provenance semantics.

**Interfaces:**
- Consumes `ASTAnalysisScene`, `ASTStoryCatalog`, and `CompiledCaseRecordCorpus`.
- Produces `validateAnalysisScenes(input): CompileError[]`.
- Produces a deterministic satisfiability result without enumerating/storing accepted threshold combinations.

- [ ] **Step 1: Write failing duplicate/reference tests**

Add tests for:

- duplicate board IDs;
- duplicate card IDs inside one board;
- duplicate classify group IDs;
- duplicate result segment IDs;
- unresolved evidence, statement, and fact card sources;
- unresolved story reveal targets;
- unresolved story predicates;
- analysis `grantAuthorization` rejection at its `Reveals` line.

Each assertion must check `code`, `sourceFile`, and exact `line`.

- [ ] **Step 2: Write failing template-completeness tests**

Classify:

- required card omitted from all groups;
- required card assigned twice;
- unknown card in a group;
- zero groups.

Order:

- duplicate card in accepted order;
- required card missing;
- unknown card in order;
- fixed anchor unknown card;
- fixed position outside `1..cards.length`;
- two anchors in one position;
- fixed anchor contradicts accepted order.

Threshold:

- eligible card unknown;
- eligible fact card;
- minimum selected exceeds eligible count;
- distinct source minimum exceeds possible groups;
- eligible record lacks source group while `Require Source Group: true`;
- eligible record has an unspecified/disallowed procedural status;
- required capability union cannot be covered;
- no subset satisfies count + source + capability + procedure together.

- [ ] **Step 3: Run semantic tests to verify failure**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/validator-analysis.test.ts
```

Expected: FAIL because the validator does not exist.

- [ ] **Step 4: Implement deterministic scope/reference indexing**

Implement:

```ts
export function validateAnalysisScenes(input: {
  scenes: SceneRecord[];
  catalog: ASTStoryCatalog;
  caseRecords: CompiledCaseRecordCorpus;
}): CompileError[];
```

Build maps once:

```ts
const factsById = new Map(catalog.facts.map((fact) => [fact.id, fact]));
const recordsByKey = input.caseRecords.recordsByKey;
```

Use the existing inventory key convention for evidence/statement lookup. Do not search scene manifests repeatedly inside each board validator.

- [ ] **Step 5: Implement classify completeness**

Use a `Map<cardId, groupId[]>`. For every required card, require exactly one accepted group. Reject unknown accepted IDs immediately at the accepted-list source line. Optional cards may be unassigned, but if assigned they must still appear in exactly one group.

- [ ] **Step 6: Implement order completeness and anchors**

Validate the accepted order as an exact permutation of required card IDs plus any optional cards explicitly included by the author. For Chapter 1, every authored order card is required; retain the general rule without adding alternate-order support.

Anchor consistency:

```ts
const acceptedPosition = acceptedOrder.indexOf(anchor.cardId) + 1;
if (acceptedPosition !== anchor.position) {
  error("analysisOrderAnchorContradictsSolution", anchor.line);
}
```

- [ ] **Step 7: Implement threshold eligibility and satisfiability**

Filter each eligible card through per-record rules:

```ts
function recordEligible(
  record: CompiledCaseRecord,
  board: ASTThresholdBoard,
): boolean {
  const provenance = record.provenance;
  return (
    board.allowedProceduralStatuses.some(
      ({ value }) => value === provenance.proceduralStatus,
    ) &&
    (!board.requireSourceGroup.value || provenance.sourceGroupId !== null)
  );
}
```

Then search combinations only over the small authored eligible set. Use deterministic DFS with early exits; do not emit accepted combinations:

```ts
function hasSatisfyingThresholdSelection(
  candidates: ThresholdCandidate[],
  board: ASTThresholdBoard,
): boolean {
  const chosen: ThresholdCandidate[] = [];
  const visit = (index: number): boolean => {
    if (selectionSatisfies(chosen, board)) return true;
    if (index === candidates.length) return false;
    if (chosen.length + candidates.length - index < board.minimumSelected.value)
      return false;
    chosen.push(candidates[index]!);
    if (visit(index + 1)) return true;
    chosen.pop();
    return visit(index + 1);
  };
  return visit(0);
}
```

`selectionSatisfies` checks minimum selected, unique non-null source groups, and aggregate union coverage of all required proof capabilities.

- [ ] **Step 8: Integrate story target validation without duplicating it**

Extend `buildStoryRevealTargetBatches` so every analysis board contributes one batch with:

```ts
{
  targets: board.reveals,
  representedAuthority: null,
  location: board,
}
```

Extend `buildStoryPredicateReferences` to walk board unlocks and explicit analysis outro unlocks. Existing `validateStoryRevealTargets` and `validateStoryPredicateReferences` remain the authority for catalog definitions and grant restrictions.

- [ ] **Step 9: Integrate analysis validation into the general validator**

Add only local ID/scope checks that do not need catalog/provenance to `validate()`. Invoke `validateAnalysisScenes` from the orchestrator after `compileCaseRecordCorpus` succeeds, because threshold validation requires compiled provenance.

- [ ] **Step 10: Run semantic tests and all compiler tests**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/validator-analysis.test.ts packages/scripts/compile-scenes/story-catalog.test.ts packages/scripts/compile-scenes/case-record-provenance.test.ts
bun run check:scripts
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/scripts/compile-scenes/validator-analysis.ts packages/scripts/compile-scenes/validator-analysis.test.ts packages/scripts/compile-scenes/validator.ts packages/scripts/compile-scenes/story-catalog.ts packages/scripts/compile-scenes/case-record-provenance.ts
git commit -m "feat: validate analysis board semantics"
```

---

### Task 4: Discover Analysis Scenes and Derive the Definition Registry from Parsed Content

**Files:**
- Modify: `packages/scripts/compile-scenes/orchestrator.ts`
- Modify: `packages/scripts/compile-scenes/analysis-definition-registry.ts`
- Modify: `packages/scripts/compile-scenes.test.ts`

**Interfaces:**
- Consumes `parseAnalysisScene` and parsed `SceneRecord[]`.
- Produces `createAnalysisDefinitionRegistryFromScenes(scenes)`.
- Removes `CompileOptions.analysisRegistry`; production and tests use parsed definitions as the only registry source.

- [ ] **Step 1: Write the failing end-to-end discovery test**

Add a mini chapter manifest containing `analysis_scene_8_5.md`. Assert compile no longer reports `sceneFileUnknownType`, and `chapters.json` contains:

```json
{ "type": "analysis", "file": "analysis_scene_8_5.json" }
```

Add a story predicate in a later scene referencing the parsed board and assert it resolves without injecting `CompileOptions.analysisRegistry`.

- [ ] **Step 2: Run the focused compiler test to verify failure**

```bash
bun run test:scripts -- packages/scripts/compile-scenes.test.ts -t "derives analysis definitions from parsed scenes"
```

Expected: FAIL with unknown scene prefix or unresolved analysis predicate.

- [ ] **Step 3: Add orchestrator dispatch**

Import `parseAnalysisScene`. Insert the prefix branch after interrogation handling:

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

- [ ] **Step 4: Replace synthetic registry injection**

Delete `CompileOptions.analysisRegistry`. Add:

```ts
export function createAnalysisDefinitionRegistryFromScenes(
  scenes: readonly SceneRecord[],
): AnalysisDefinitionRegistry {
  const analysisScenes = scenes.filter(
    (record): record is SceneRecord & { ast: ASTAnalysisScene } =>
      record.ast.kind === "analysisScene",
  );
  return createAnalysisDefinitionRegistry({
    scenes: analysisScenes.map(({ chapterId, ast }) => ({
      chapterId,
      sceneId: ast.id,
    })),
    boards: analysisScenes.flatMap(({ chapterId, ast }) =>
      ast.boards.map((board) => ({
        chapterId,
        sceneId: ast.id,
        boardId: board.id,
      })),
    ),
  });
}
```

Build the registry after parsing all chapters, before story-predicate validation.

- [ ] **Step 5: Reorder semantic pipeline around provenance**

Use this exact order:

1. parse chapters/scenes/catalog;
2. materialize/enrich assets;
3. run general scene and story-catalog validation;
4. compile the case-record corpus;
5. run `validateAnalysisScenes` with the corpus;
6. derive analysis registry from parsed scenes;
7. validate story predicate references;
8. if no errors, run fixed-point reachability;
9. derive dialogue origins and emit.

Do not emit or run reachability over a partial/invalid analysis corpus.

- [ ] **Step 6: Migrate HPA-257 tests away from injected definitions**

For every test that passes `analysisRegistry`, create a minimal actual `analysis_scene_*.md` fixture and reference that parsed scene/board. Keep direct unit tests for `createAnalysisDefinitionRegistry` itself, but do not use it as a production compiler input.

- [ ] **Step 7: Run compiler tests**

```bash
bun run test:scripts -- packages/scripts/compile-scenes.test.ts packages/scripts/compile-scenes/story-catalog.test.ts packages/scripts/compile-scenes/analysis-definition-registry.test.ts
bun run check:scripts
```

Expected: PASS; no production call site accepts a synthetic registry.

- [ ] **Step 8: Commit**

```bash
git add packages/scripts/compile-scenes/orchestrator.ts packages/scripts/compile-scenes/analysis-definition-registry.ts packages/scripts/compile-scenes.test.ts packages/scripts/compile-scenes/story-catalog.test.ts packages/scripts/compile-scenes/analysis-definition-registry.test.ts packages/scripts/__fixtures__
git commit -m "feat: register parsed analysis scene definitions"
```

---

### Task 5: Add Analysis Boards to HPA-257 Fixed-Point Reachability

**Files:**
- Modify: `packages/scripts/compile-scenes/reachability.ts`
- Modify: `packages/scripts/compile-scenes/reachability.test.ts`

**Interfaces:**
- Consumes analysis ASTs in the ordered `SceneRecord` stream.
- Produces board-completed and scene-completed atoms using existing HPA-257 effect/reveal semantics.
- Required cards become implicit positive prerequisites; optional cards do not gate reachability.

- [ ] **Step 1: Write failing reachability tests**

Cover:

1. an initially unlocked required classify board produces its fact and board-completed atom;
2. a locked order board becomes reachable from the classify board predicate;
3. a threshold board produces a fact and completes `prepare_narrow_lock_request`;
4. auto outro requires all required boards but not optional boards;
5. a required board with an unavailable required evidence card is unreachable;
6. a required output produced only by an optional board fails mandatory reachability;
7. a board self-unlock reports `positiveSelfReference`;
8. two boards with a positive cycle report `positiveDependencyCycle`.

- [ ] **Step 2: Run focused reachability tests to verify failure**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/reachability.test.ts -t "analysis"
```

Expected: FAIL because `buildSceneNodes` has no analysis branch.

- [ ] **Step 3: Add analysis card prerequisite atoms**

Implement:

```ts
function analysisRequiredCardPredicates(
  board: AnalysisBoardAst,
): ReachabilityPredicate[] {
  return board.cards
    .filter((card) => card.required)
    .map((card) => {
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

- [ ] **Step 4: Add `buildAnalysisNodes`**

Create nodes in authored board order:

```text
scene entry
  -> board nodes (free order where conditions permit)
  -> scene outro
```

Each board node:

- is mandatory when `required: true`, otherwise optional;
- is initially reachable when `Status: unlocked`;
- uses normalized story-only `Unlock` as its condition;
- has required card atoms as implicit prerequisites;
- adds `analysis_board_completed:<chapter>@<scene>@<board>`;
- applies board story reveals in authored order;
- uses the board source file/line for diagnostics.

The auto outro has all required board-completed atoms as implicit prerequisites and adds `analysis_scene_completed:<chapter>@<scene>`.

- [ ] **Step 5: Extend atom normalization/helpers**

Add exact helpers:

```ts
function analysisBoardAtom(scope: SceneScope, boardId: string): string;
function analysisSceneAtom(scope: SceneScope): string;
function normalizeAnalysisExpression(
  expression: AnalysisUnlockExpr | null,
): PositiveExpression<ReachabilityPredicate> | null;
```

Do not change the HPA-257 scenario solver, effect transfer, positive-cycle detector, or `at_least` semantics.

- [ ] **Step 6: Remove unused registry input from reachability**

If `buildReachabilityNodes` no longer uses `analysisRegistry`, remove that parameter and update call sites/tests. The registry remains necessary for reference validation, not for reachability construction.

- [ ] **Step 7: Run focused and full reachability tests**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/reachability.test.ts packages/scripts/compile-scenes/story-catalog.test.ts
bun run check:scripts
```

Expected: PASS with HPA-257 legacy cases unchanged.

- [ ] **Step 8: Commit**

```bash
git add packages/scripts/compile-scenes/reachability.ts packages/scripts/compile-scenes/reachability.test.ts packages/scripts/compile-scenes/orchestrator.ts
git commit -m "feat: analyze analysis board reachability"
```

---

### Task 6: Emit Deterministic Analysis JSON and Dialogue Segment Origins

**Files:**
- Modify: `packages/scripts/compile-scenes/emitter.ts`
- Modify: `packages/scripts/compile-scenes/orchestrator.ts`
- Modify: `packages/scripts/compile-scenes/save-content-manifest.ts`
- Modify: `packages/scripts/compile-scenes/dialogue-segment-origins.ts`
- Modify: `packages/scripts/compile-scenes/dialogue-segment-origins.test.ts`
- Modify: `packages/scripts/compile-scenes/semantic-defaults.ts` if exhaustive.
- Modify: `packages/scripts/compile-scenes/assets/enrich.ts` if exhaustive.

**Interfaces:**
- Produces `emitAnalysisScene(ast): JSONAnalysisScene`.
- Adds stable dialogue origins for analysis intro, board result segments, and outro.
- Includes analysis definitions in content revision hashing.

- [ ] **Step 1: Write failing emitter snapshot tests**

Assert emitted JSON:

- uses `type: "analysis"`;
- preserves board authored order, card order, group order, accepted order, anchors, and result segment order;
- strips every `sourceFile`/`line` wrapper;
- emits `layout: { mode: "automatic" }`;
- emits threshold constraints in deterministic array order;
- emits no public-view or save-state fields.

- [ ] **Step 2: Write failing dialogue-origin tests**

Lock these origins:

```ts
{ type: "analysisIntro", chapterId, sceneId }
{ type: "analysisResult", chapterId, sceneId, boardId, segmentId }
{ type: "analysisOutro", chapterId, sceneId }
```

Assert duplicate segment IDs in one board are already rejected by semantic validation and distinct boards may both use segment ID `accepted` because `boardId` qualifies the origin.

- [ ] **Step 3: Run focused tests to verify failure**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/emitter.test.ts packages/scripts/compile-scenes/dialogue-segment-origins.test.ts
```

Expected: FAIL because analysis emission/origins do not exist.

- [ ] **Step 4: Implement pure AST-to-JSON emission**

Add `emitAnalysisScene`. Copy arrays rather than exposing AST objects. Convert all located references to strings/numbers. Preserve authored order; sort only set-like threshold capability/status arrays by their authored order after duplicate validation.

Extend `emitSceneRecord` with an explicit analysis branch rather than a default fallback.

- [ ] **Step 5: Extend save-content unions and dialogue origin derivation**

Add `JSONAnalysisScene` to `EmittedSceneJsonV1` and the bundle hash. Extend `DialogueSegmentOriginV1` and `deriveDialogueSegments` using the origins above.

Do not introduce mutable analysis save state; only immutable definitions and authored dialogue affect the content revision here.

- [ ] **Step 6: Close asset/default exhaustive switches explicitly**

Analysis intro/result/outro dialogue may contain existing scene tags and asset cues. Reuse existing dialogue enrichment where possible. If analysis has no board-level visual geometry or semantic asset defaults, pass board definitions through unchanged rather than inventing new asset rules.

- [ ] **Step 7: Run emitter/origin/compiler tests**

```bash
bun run test:scripts -- packages/scripts/compile-scenes/emitter.test.ts packages/scripts/compile-scenes/dialogue-segment-origins.test.ts packages/scripts/compile-scenes.test.ts
bun run check:scripts
```

Expected: PASS and deterministic snapshots.

- [ ] **Step 8: Commit**

```bash
git add packages/scripts/compile-scenes/emitter.ts packages/scripts/compile-scenes/orchestrator.ts packages/scripts/compile-scenes/save-content-manifest.ts packages/scripts/compile-scenes/dialogue-segment-origins.ts packages/scripts/compile-scenes/dialogue-segment-origins.test.ts packages/scripts/compile-scenes/semantic-defaults.ts packages/scripts/compile-scenes/assets/enrich.ts packages/scripts/compile-scenes.test.ts
git commit -m "feat: emit analysis scene runtime definitions"
```

---

### Task 7: Add Rust Immutable Serde Definitions and Fail Closed Before HPA-260

**Files:**
- Modify: `apps/game/src-tauri/src/game/schema.rs`
- Modify: `apps/game/src-tauri/src/game/loader.rs`
- Modify: `apps/game/src-tauri/src/game/navigation.rs`
- Modify: `apps/game/src-tauri/src/game/scenes/mod.rs` only if required for the unsupported-runtime error path.
- Modify: `apps/game/src-tauri/src/game/test_support.rs`

**Interfaces:**
- Consumes compiler-emitted `JSONAnalysisScene` byte shape.
- Produces immutable Rust `AnalysisSceneJson`, `AnalysisBoardJson`, and board variant structs.
- Does not produce `AnalysisSceneState`, public views, commands, evaluator functions, or save-state types.

- [ ] **Step 1: Write failing Rust serde tests**

Add tests that deserialize the exact emitted classify/order/threshold JSON snapshot and assert:

- `SceneType::Analysis`;
- `SceneJson::Analysis`;
- all cards, solutions, feedback, hint, reveals, result dialogue, and constraints survive;
- unknown fields fail where `deny_unknown_fields` is used;
- malformed board variants fail;
- `scene_dialogue_groups` returns intro, every result segment in authored order, and outro.

- [ ] **Step 2: Run focused Rust tests to verify failure**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml schema::tests::analysis
```

Expected: FAIL because Rust has no analysis schema variant.

- [ ] **Step 3: Add immutable serde structs**

Use tagged board variants:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum AnalysisBoardJson {
    Classify { /* common fields + groups */ },
    Order { /* common fields + accepted_order + fixed_anchors */ },
    Threshold { /* common fields + constraints */ },
}
```

Model common fields with a flattened `AnalysisBoardCommonJson` only if Serde's flattened tagged-enum shape exactly matches compiler output and tests prove unknown fields still fail. Otherwise repeat common fields in each closed variant; clarity is preferred over an abstraction that weakens validation.

- [ ] **Step 4: Add scene-index and scene JSON variants**

Extend:

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

- [ ] **Step 5: Add loader defense-in-depth validation**

Validate:

- board/card/group/result IDs are unique;
- classify accepted IDs exist;
- order solution and anchors reference cards;
- threshold minimums are nonzero and do not exceed emitted eligible cards;
- analysis board reveals are story reveals;
- story definition references continue through existing catalog validation.

The compiler remains the primary authoring validator; Rust rejects hand-edited/corrupt packaged JSON.

- [ ] **Step 6: Add explicit unsupported runtime behavior**

Where navigation converts `SceneJson` into `SceneRuntime`, return a typed error such as:

```rust
Err(GameError::scene_load_failed(
    "analysis scene runtime requires HPA-260".to_string(),
))
```

Do not convert analysis to a linear scene, auto-skip it, or add a partial runtime state. Production Chapter 1 still lists `scene_8_5.md`, so normal gameplay remains unchanged until HPA-265/HPA-262 integration.

- [ ] **Step 7: Update exhaustive non-runtime matches**

Update `scene_dialogue_groups`, scene identity helpers, catalog record validation, and test helpers. Analysis scenes contain no evidence/statement manifests of their own, so record-origin validation must treat them as references only.

- [ ] **Step 8: Run Rust tests**

```bash
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
```

Expected: PASS; existing runtime behavior unchanged, analysis JSON accepted, runtime entry fails closed.

- [ ] **Step 9: Commit**

```bash
git add apps/game/src-tauri/src/game/schema.rs apps/game/src-tauri/src/game/loader.rs apps/game/src-tauri/src/game/navigation.rs apps/game/src-tauri/src/game/scenes/mod.rs apps/game/src-tauri/src/game/test_support.rs
git commit -m "feat: accept immutable analysis scene definitions in Rust"
```

---

### Task 8: Add the Chapter 1-Shaped Acceptance Corpus and Run the Full Regression Gate

**Files:**
- Create: `packages/scripts/__fixtures__/analysis-valid/story_catalog.md`
- Create: `packages/scripts/__fixtures__/analysis-valid/chapter_1/chapter.md`
- Create: `packages/scripts/__fixtures__/analysis-valid/chapter_1/investigation_scene_records.md`
- Create: `packages/scripts/__fixtures__/analysis-valid/chapter_1/analysis_scene_8_5.md`
- Create focused files under `packages/scripts/__fixtures__/analysis-invalid/`.
- Modify: `packages/scripts/compile-scenes.test.ts`
- Modify: compiler/Rust snapshots generated by tests only; do not check in production generated resources unless the repository already tracks the specific snapshot file.

**Interfaces:**
- Provides the canonical HPA-259 acceptance fixture used by HPA-260/HPA-261 contract work.
- Does not replace production Chapter 1 content.

- [ ] **Step 1: Author the valid acceptance corpus with Chapter 1 outputs**

The fixture must include these board IDs and outputs:

```text
evidence_packages
  -> miyake_known_lies_are_unrelated_to_murder
  -> earlier_external_entry_exists

local_event_sequence
  -> merge_time_is_not_event_time

narrow_request_basis
  -> two_independent_lock_contradictions_identified
  -> complete prepare_narrow_lock_request
```

It must not grant `narrow_lock_export`.

Include real Chapter 1-shaped record provenance:

- at least two distinct `sourceGroupId` values;
- allowed `reacquired`/`exhibit` procedural statuses;
- `time` and `order` capabilities whose union satisfies threshold requirements;
- a same-source pair that is individually eligible but cannot satisfy distinct-source minimum by itself.

- [ ] **Step 2: Author one invalid corpus per acceptance diagnostic**

Create focused fixtures for:

- duplicate IDs;
- missing card;
- unresolved record/catalog reference;
- incomplete classify solution;
- incomplete/duplicate order solution;
- impossible threshold count;
- impossible distinct source groups;
- missing source group;
- missing required proof capability;
- disallowed/unspecified procedure;
- unreachable required board;
- unreachable output;
- grant outside authority.

Each fixture changes one reason only so tests can assert one stable primary error.

- [ ] **Step 3: Add compiler acceptance tests**

Assert the valid corpus:

- compiles without synthetic registry input;
- emits exactly one `analysis` scene;
- produces stable qualified board refs;
- emits deterministic JSON across two compiles;
- includes all four Chapter 1 facts and request-readiness objective outputs;
- passes dialogue-origin collision checks;
- passes fixed-point reachability;
- is deserializable by the Rust fixture test.

- [ ] **Step 4: Add legacy regression assertions**

Compile the existing production roots without modifying Chapter 1. Assert:

- `docs/stories_plan/chapter_1/chapter.md` still lists `scene_8_5.md` and not `analysis_scene_8_5.md`;
- all existing non-analysis scenes compile;
- scene count changes only in fixture corpora, not production content;
- no generated answer key appears in `packages/scene-types` or frontend source.

- [ ] **Step 5: Run the complete verification matrix**

Run in this order:

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

Expected: every command PASS. `bun run scenes:compile` must compile existing Chapter 1 unchanged because production Beat 8.5 replacement is deferred.

- [ ] **Step 6: Review the emitted wire contract for HPA-260/HPA-261 handoff**

Confirm from the valid fixture JSON:

- Rust receives the complete hidden solution;
- the shared package receives only `{ mode: "automatic" }` layout and scene index values;
- result segment IDs are stable and board-qualified through dialogue origins;
- no runtime mutable field exists;
- no Chapter 2 template field exists;
- no production synthetic registry seam remains.

- [ ] **Step 7: Commit**

```bash
git add packages/scripts/__fixtures__/analysis-valid packages/scripts/__fixtures__/analysis-invalid packages/scripts/compile-scenes.test.ts packages/scripts/compile-scenes/*.test.ts apps/game/src-tauri/src/game
git commit -m "test: accept the Chapter 1 analysis compiler contract"
```

---

## Pull Request Review Checklist

- [ ] `analysis_scene_<K>.md` is discovered from manifests and emitted as `type: "analysis"`.
- [ ] The valid fixture expresses the exact Chapter 1 classify/order/threshold shapes without scene-ID conditionals.
- [ ] The analysis definition registry is derived exclusively from parsed scenes.
- [ ] `CompileOptions.analysisRegistry` is removed.
- [ ] HPA-257 positive expressions, target ordering, cycles, and fixed-point logic are reused unchanged except for the new scene adapter.
- [ ] Classify required cards have one complete accepted assignment.
- [ ] Order solution is a complete permutation and fixed anchors are consistent.
- [ ] Threshold constraints are statically satisfiable using actual case-record provenance.
- [ ] Facts cannot count as independent threshold sources.
- [ ] Analysis boards cannot grant authorizations.
- [ ] Every invalid fixture reports the author source file and exact line.
- [ ] Emitted JSON is deterministic and Rust serde-compatible.
- [ ] Accepted solutions are absent from `@lyra/scene-types`, Svelte, and public-view types.
- [ ] No analysis runtime state, evaluation, command, or persistence code is included.
- [ ] Existing production Chapter 1 still uses `scene_8_5.md` and compiles unchanged.
- [ ] No compare, route, chain, graph, plugin, or layout-editor framework is introduced.

## Execution Handoff

After this plan is approved, execute it on branch:

```text
jack65786656/hpa-259-add-chapter-1-analysis-scene-markdown-schema-and-validation
```

Recommended execution mode: `superpowers:subagent-driven-development`, one fresh implementation subagent per task with a specification-compliance review followed by a code-quality review before advancing.