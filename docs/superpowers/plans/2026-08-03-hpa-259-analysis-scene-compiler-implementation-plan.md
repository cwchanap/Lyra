# HPA-259 Analysis Scene Compiler Contract Implementation Plan

> **For implementation agents:** keep every commit buildable. Prefer direct code and closed enums over reusable frameworks. Review once after the compiler contract is green and once before the implementation PR is ready.

**Goal:** Add the smallest production-quality `analysis_scene_<K>.md` compiler contract needed for the real Chapter 1 Beat 8.5 classify, order, and threshold boards.

**Architecture:** Markdown is the authored source. TypeScript parses and validates author intent, resolves provenance and story references, normalizes hidden accepted answers into simple runtime-ready JSON, and adapts boards to the existing HPA-257 reachability solver. Rust consumes immutable definitions and compares player drafts against normalized answers. HPA-260 owns mutable runtime state, evaluation commands, persistence, and answer-key-free public views.

## 1. Project priorities

This is a hobby project under active pre-release development.

Apply these priorities throughout HPA-259:

1. Fast feature iteration and low maintenance cost.
2. Clear ownership and small modules.
3. Straightforward code that is easy to replace.
4. Enough validation to catch real authoring mistakes.
5. No speculative architecture for unreleased chapters.

Explicitly do **not** add:

- compatibility layers for an older analysis schema;
- analysis schema versions or migrations;
- parser fallbacks for legacy analysis Markdown;
- plugin registries or dynamic evaluator dispatch;
- generic puzzle, graph, or constraint engines;
- duplicate TypeScript and Rust semantic validation;
- placeholder layout types without a current consumer;
- security hardening for hand-edited generated resources beyond normal serde shape checks;
- exhaustive handling of hypothetical large-card-count boards.

Breaking pre-release analysis changes may invalidate generated resources and local development saves. Update the compiler, fixture, Rust schema, and downstream runtime together.

## 2. Scope and ownership boundaries

### In scope

- Accept `analysis_scene_<K>.md` in chapter manifests.
- Support only `classify`, `order`, and `threshold` boards.
- Parse scene, board, card, group, result-dialogue, minimal feedback, and optional hint fields used by Chapter 1.
- Reference existing evidence, statements, facts, questions, objectives, authorizations, and qualified analysis refs through existing story contracts.
- Validate IDs, references, solutions, provenance, threshold satisfiability, story outputs, and reachability.
- Derive the existing analysis-definition registry from parsed scenes.
- Emit deterministic immutable JSON with normalized hidden answers.
- Add Rust serde definitions and the minimum fail-closed handling before HPA-260.
- Keep existing non-analysis chapters compiling unchanged.

### Deferred

- optional boards;
- optional classify/order cards;
- compare, route, chain, and freeform boards;
- interactive layout-editor authoring;
- progressive hint history;
- specialized wrong-answer copy per threshold failure reason;
- Chapter 2 fixture families;
- runtime state, commands, drafts, saves, and public views;
- final Chapter 1 content insertion.

### Layer ownership

```text
Authored Markdown
    ↓
TypeScript parser + source-located AST
    ↓
TypeScript semantic validation + answer normalization
    ↓
Immutable analysis JSON + story catalog
    ↓
Rust serde definitions
    ↓ HPA-260
Rust runtime state and direct answer comparison
    ↓
Answer-key-free public view
```

- The compiler is authoritative for authored static definitions.
- Rust is authoritative for mutable player state and submissions.
- Svelte never receives accepted mappings, accepted order, or threshold answer sets.
- `DialogueItem` remains outside `@lyra/scene-types`.
- `@lyra/scene-types` gains only the `analysis` chapter-index discriminant in HPA-259.

## 3. Minimal authored Markdown contract

```markdown
# Scene 8.5: 短暫誤判整理點
- **Summary:** 相馬與早坂整理目前真正成立的命題。

## Intro

[場景：雨鐘後場，相馬臨時整理板前。]
**早坂茜**：先把我們能證明的東西分開。

## Board: 證據包整理 {#evidence_packages}
- **Kind:** classify
- **Prompt:** 把每張卡放進它真正支持的命題。
- **Reveals:** [assert_fact:miyake_known_lies_are_unrelated_to_murder, assert_fact:earlier_external_entry_exists]
- **Incomplete Feedback:** 每張卡都必須放進一個證據包。
- **Incorrect Feedback:** 至少有一張卡被放進錯誤命題。
- **Hint:** 先問每一項資料真正能證明什麼。

### Card: 三宅母親通話紀錄 {#miyake_call}
- **Source:** evidence:miyake_call_record
- **Summary:** 解釋三宅隱瞞通話的原因。

### Card: L 型後場視角重演 {#l_corridor_replay}
- **Source:** evidence:l_corridor_replay
- **Summary:** 證明三宅當時站位看不見內側倉庫。

### Card: 外包憑證事件 {#external_credential_event}
- **Source:** evidence:external_credential_event
- **Summary:** 證明有人比三宅更早從承包商動線進入。

### Group: 三宅的小謊 {#miyake_small_lies}
- **Description:** 只解釋生活壓力造成的隱瞞。
- **Accepted Cards:** [miyake_call]

### Group: 更早的第三者 {#earlier_third_party}
- **Description:** 支持更早外部進入者存在的資料。
- **Accepted Cards:** [l_corridor_replay, external_credential_event]

### Result Dialogue

**早坂茜**：我們洗掉的是三宅那段錯誤故事。
**相馬律**：但還沒證明誰該被放回時間線。

## Board: 本機事件順序 {#local_event_sequence}
- **Kind:** order
- **Prompt:** 把本機事件排回原始先後。
- **Unlock:** analysis_board:chapter_1@analysis_scene_8_5@evidence_packages completed
- **Accepted Order:** [event_1841, event_1842, event_1843, event_1844]
- **Fixed Anchors:** [event_1841@1]
- **Reveals:** [assert_fact:merge_time_is_not_event_time]
- **Incomplete Feedback:** 所有事件都必須放進時間線。
- **Incorrect Feedback:** 本機事件順序仍有錯誤。

### Card: 維護模式開啟 {#event_1841}
- **Source:** evidence:event_1841
- **Summary:** 本機事件 1841。

### Card: 外包憑證開門 {#event_1842}
- **Source:** evidence:event_1842
- **Summary:** 本機事件 1842。

### Card: 員工憑證開門 {#event_1843}
- **Source:** evidence:event_1843
- **Summary:** 本機事件 1843。

### Card: 伺服器合併完成 {#event_1844}
- **Source:** evidence:event_1844
- **Summary:** 本機事件 1844。

### Result Dialogue

**相馬律**：本機只告訴我們先後，沒有告訴我們精確秒數。

## Board: 有限調取申請基礎 {#narrow_request_basis}
- **Kind:** threshold
- **Prompt:** 選出足以支持有限調取申請的獨立矛盾。
- **Unlock:** analysis_board:chapter_1@analysis_scene_8_5@local_event_sequence completed
- **Eligible Cards:** [lock_sequence, phone_notification, manager_timing]
- **Minimum Selected:** 2
- **Minimum Distinct Source Groups:** 2
- **Required Proof Capabilities:** [time, order]
- **Allowed Procedural Statuses:** [reacquired, exhibit]
- **Require Source Group:** true
- **Reveals:** [assert_fact:two_independent_lock_contradictions_identified, complete_objective:prepare_narrow_lock_request]
- **Incomplete Feedback:** 至少選出兩項紀錄。
- **Incorrect Feedback:** 這組紀錄仍不足以支持申請。

### Card: 門鎖本機順序 {#lock_sequence}
- **Source:** evidence:lock_sequence
- **Summary:** 提供事件先後與摘要時間不一致的證明。

### Card: 死者手機通知 {#phone_notification}
- **Source:** evidence:phone_notification
- **Summary:** 提供獨立時間錨。

### Card: 店長時間證詞 {#manager_timing}
- **Source:** statement:manager_timing
- **Summary:** 提供另一個可被程序固定的時間來源。

### Result Dialogue

**早坂茜**：現在有兩條獨立矛盾，可以把申請送進審查。

## Outro

**相馬律**：我們只證明了第三者存在。下一步才是把那個空位填上。
```

### Contract rules

- `Summary` is required for every analysis scene. There is no `summaryAuthored` compatibility flag.
- H2 blocks are exactly `Intro`, one or more `Board: <label> {#id}`, and `Outro`.
- Every authored board is mandatory.
- No `Unlock` means the board is initially available.
- An authored `Unlock` uses the existing story-only positive expression grammar.
- The scene completes after every board completes.
- H3 blocks are `Card:`, `Group:` for classify only, and exactly one `Result Dialogue`.
- Result dialogue directly contains dialogue items. There are no result-segment IDs.
- Card and group IDs are board-local. Board IDs are scene-local.
- Card `Source` accepts `evidence:<id>` or `statement:<id>` only.
- Every authored card source must be obtainable before the board is reachable.
- `Reveals` contains story reveal targets only.
- An analysis board may complete the secondary objective `prepare_narrow_lock_request`.
- `grant_authorization` is rejected because an analysis scene has no represented authority.
- `Hint` is one optional string.
- Successful result dialogue serves as accepted feedback.
- First-version authored feedback contains only incomplete and incorrect copy.
- Every classify card appears in exactly one accepted group.
- Accepted order is an exact permutation of every order card.
- `Fixed Anchors` is optional and uses one-based `card_id@position` values.
- For Chapter 1, every displayed threshold card is eligible. Keep `Eligible Cards` because the Linear contract requires the set, but do not invent decoy content to exercise it.
- Threshold source independence counts evidence and statement records only.

## 4. Compiler AST and normalized runtime JSON

### 4.1 Source-located compiler AST

Keep authored constraints and source locations in `packages/scripts/compile-scenes/types.ts`.

```ts
export type AnalysisCardSource =
  | { kind: "evidence"; id: string }
  | { kind: "statement"; id: string };

export type ASTAnalysisCard = Located<{
  id: string;
  label: string;
  summary: string;
  source: Located<AnalysisCardSource>;
}>;

export type ASTAnalysisFeedback = {
  incomplete: Located<{ value: string }>;
  incorrect: Located<{ value: string }>;
  hint: Located<{ value: string }> | null;
};

export type ASTAnalysisBoardCommon = Located<{
  id: string;
  label: string;
  prompt: string;
  unlock: PositiveExpression<StoryPredicate> | null;
  cards: ASTAnalysisCard[];
  reveals: StoryRevealTarget[];
  feedback: ASTAnalysisFeedback;
  resultDialogue: DialogueItem[];
}>;
```

Use a closed union:

```ts
type AnalysisBoardAst =
  | ASTClassifyBoard
  | ASTOrderBoard
  | ASTThresholdBoard;
```

The threshold AST retains authored validation inputs:

- eligible card IDs;
- minimum selected;
- minimum distinct source groups;
- required proof capabilities;
- allowed procedural statuses;
- require-source-group flag.

`ASTAnalysisScene` contains `id`, `title`, required `summary`, intro, ordered boards, outro, source location, and asset refs. It has no version, compatibility, or authored-summary fallback fields.

### 4.2 Normalize answers before emitting JSON

The compiler validates authored constraints, then emits runtime-ready hidden answers.

```text
Classify AST groups
    -> acceptedGroupByCard

Order AST
    -> acceptedOrder

Threshold AST + provenance
    -> acceptedSelections
```

Recommended immutable board shapes:

```ts
type ClassifyBoardJson = AnalysisBoardJsonCommon & {
  kind: "classify";
  groups: Array<{
    id: string;
    label: string;
    description: string;
  }>;
  acceptedGroupByCard: Record<string, string>;
};

type OrderBoardJson = AnalysisBoardJsonCommon & {
  kind: "order";
  acceptedOrder: string[];
  fixedAnchors: Array<{ cardId: string; position: number }>;
};

type ThresholdBoardJson = AnalysisBoardJsonCommon & {
  kind: "threshold";
  minimumSelected: number;
  acceptedSelections: string[][];
};
```

Rules for `acceptedSelections`:

- each selection contains sorted unique card IDs;
- the outer array is deterministically sorted;
- only selections satisfying all authored threshold constraints are emitted;
- source-group, procedural-status, and proof-capability rules remain compiler concerns and are not reinterpreted by Rust;
- straightforward subset enumeration is sufficient for the small Chapter 1 board;
- do not add a generic constraint solver or speculative optimization framework.

Rust HPA-260 can canonicalize the player's selection and compare it directly against `acceptedSelections`.

### 4.3 Shared package

Only extend the chapter index:

```ts
type: "linear" | "investigation" | "interrogation" | "analysis";
```

Do not add full board definitions, layout placeholders, dialogue, reveals, feedback, or answer keys to `@lyra/scene-types`.

### 4.4 Rust boundary

HPA-259 adds immutable serde counterparts only:

- `SceneType::Analysis`;
- `SceneJson::Analysis`;
- closed classify/order/threshold definitions;
- dialogue-group enumeration;
- minimum fail-closed handling before HPA-260.

Rust does not duplicate compiler validation for:

- classify completeness;
- order permutations;
- anchor consistency;
- threshold provenance or satisfiability;
- story-output reachability.

Serde shape validation is sufficient for packaged immutable definitions in this pre-release project.

## 5. Lean implementation sequence

### Task 1 — Parser, types, normalization, and emission

**Create**

```text
packages/scripts/compile-scenes/parser-analysis.ts
packages/scripts/compile-scenes/parser-analysis.test.ts
```

**Modify only where required**

```text
packages/scene-types/src/index.ts
packages/scripts/compile-scenes/types.ts
packages/scripts/compile-scenes/parser-unlock.ts
packages/scripts/compile-scenes/parser-reveals.ts
packages/scripts/compile-scenes/emitter.ts
packages/scripts/compile-scenes/orchestrator.ts
packages/scripts/compile-scenes/save-content-manifest.ts
packages/scripts/compile-scenes/dialogue-segment-origins.ts
minimal exhaustive asset/default consumers
```

Implementation:

- parse the complete canonical Markdown fixture;
- keep scalar/list/source/anchor helpers private inside `parser-analysis.ts`;
- reuse the existing tokenizer, cursor, dialogue conversion, positive-expression parser, and reveal parser;
- add an analysis reveal family that accepts story targets only;
- require scene summary;
- emit normalized answer fields;
- use stable dialogue origins:

```ts
{ type: "analysisIntro", chapterId, sceneId }
{ type: "analysisResult", chapterId, sceneId, boardId }
{ type: "analysisOutro", chapterId, sceneId }
```

Representative tests:

- one complete valid scene;
- one structural parser error with exact source line;
- one malformed board-family field with exact source line;
- deterministic normalized JSON;
- hidden answers absent from shared types.

Focused verification:

```bash
bun run test:scripts -- packages/scripts/compile-scenes/parser-analysis.test.ts packages/scripts/compile-scenes/emitter.test.ts packages/scripts/compile-scenes/dialogue-segment-origins.test.ts
bun run check:scripts
```

Suggested commit:

```text
feat: add analysis scene compiler contract
```

### Task 2 — Semantic validation and production registry

**Create**

```text
packages/scripts/compile-scenes/validator-analysis.ts
packages/scripts/compile-scenes/validator-analysis.test.ts
```

**Modify**

```text
packages/scripts/compile-scenes/validator.ts
packages/scripts/compile-scenes/story-catalog.ts
packages/scripts/compile-scenes/analysis-definition-registry.ts
packages/scripts/compile-scenes/orchestrator.ts
packages/scripts/compile-scenes.test.ts
```

Validate:

- scene/board/card/group ID scopes;
- evidence and statement sources;
- story unlock predicates and reveal targets;
- no authorization grant from an analysis board;
- non-empty result dialogue;
- complete classify mappings;
- complete order permutation and valid anchors;
- threshold eligible set, counts, provenance, and at least one satisfying selection;
- deterministic generation of normalized threshold answers.

Registry work:

- add `createAnalysisDefinitionRegistryFromScenes(scenes)`;
- remove `CompileOptions.analysisRegistry` as a production input;
- migrate synthetic-registry compiler tests to minimal real analysis Markdown;
- keep the existing small registry abstraction because HPA-257 already consumes it.

Pipeline order:

```text
parse
-> structural validation
-> compile case-record provenance
-> analysis semantic validation + answer normalization
-> derive analysis registry
-> validate story predicates/reveals
-> fixed-point reachability
-> dialogue origins + emission
```

Representative tests:

- one unresolved card source with exact line;
- one incomplete solution with exact line;
- one impossible threshold with exact line;
- one invalid authorization output;
- one qualified analysis reference resolved without injected registry data.

Focused verification:

```bash
bun run test:scripts -- packages/scripts/compile-scenes/validator-analysis.test.ts packages/scripts/compile-scenes/story-catalog.test.ts packages/scripts/compile-scenes/analysis-definition-registry.test.ts packages/scripts/compile-scenes.test.ts
bun run check:scripts
```

Suggested commit:

```text
feat: validate and normalize analysis definitions
```

### Checkpoint review

Review the Markdown contract and emitted JSON now, before writing Rust code. Confirm that HPA-260 can evaluate all three board types by direct comparison without interpreting authoring-time provenance rules.

### Task 3 — Reachability and compiler acceptance

**Modify**

```text
packages/scripts/compile-scenes/reachability.ts
packages/scripts/compile-scenes/reachability.test.ts
packages/scripts/compile-scenes.test.ts
```

**Add one complete fixture corpus**

```text
packages/scripts/__fixtures__/analysis-chapter-1/
```

Reachability adapter:

- no `Unlock` means initially available;
- authored unlock uses the existing HPA-257 expression solver;
- every card source is an implicit availability prerequisite;
- completion adds the qualified board-completed atom;
- reveals apply in authored order;
- scene completion requires all board-completed atoms;
- scene completion adds the qualified scene-completed atom;
- outro is presentation after scene completion, not another unlock node.

Do not change HPA-257's solver, scenario model, cycle detection, or transfer rules.

Canonical outputs:

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

Representative tests:

- first board initially available;
- board-to-board unlock;
- unavailable card source;
- self-reference or positive cycle;
- unreachable output with exact line;
- qualified board/scene predicate resolution;
- deterministic emitted scene and story-catalog snapshots.

Focused verification:

```bash
bun run test:scripts -- packages/scripts/compile-scenes/reachability.test.ts packages/scripts/compile-scenes.test.ts
bun run scenes:compile
bun run check:scripts
```

Suggested commit:

```text
feat: integrate analysis scenes with progression validation
```

### Task 4 — Rust wire compatibility and regression

**Modify only where exhaustive handling requires it**

```text
apps/game/src-tauri/src/game/schema.rs
apps/game/src-tauri/src/game/dialogue_queue.rs
apps/game/src-tauri/src/game/navigation.rs
apps/game/src-tauri/src/game/test_support.rs
apps/game/src-tauri/src/game/loader.rs
```

Implementation:

- add immutable analysis serde types matching normalized JSON;
- deserialize the compiled scene and story catalog together;
- assert classify mapping, order, and threshold accepted selections are loaded;
- enumerate intro, one result dialogue per board, and outro;
- return a clear unsupported-runtime error when navigation reaches analysis before HPA-260;
- do not add runtime state, save snapshots, commands, evaluators, or public views.

Focused verification:

```bash
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
```

Suggested commit:

```text
feat: accept analysis definitions in Rust
```

## 6. Verification and review cadence

During development, run focused tests for the task being changed.

Run the full repository gate once before the implementation PR is ready:

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

Use two architecture/code-review checkpoints:

1. After Tasks 1 and 2: authored contract and normalized runtime JSON.
2. Final implementation PR review: compiler → reachability → Rust wire path.

Do not require separate specification and code-quality review passes after every task unless a task uncovers a material architectural uncertainty.

## 7. Definition of done

- [ ] `analysis_scene_<K>.md` is accepted in chapter manifests.
- [ ] The real Chapter 1 classify/order/threshold shape is representable without chapter-specific parser branches.
- [ ] Summary is required; no legacy analysis fallback or compatibility flag exists.
- [ ] Parser and semantic diagnostics report useful source file and line data.
- [ ] IDs, sources, solutions, threshold provenance, story outputs, and qualified refs validate.
- [ ] Threshold constraints normalize into deterministic accepted selections.
- [ ] Parsed scenes replace synthetic production registry input.
- [ ] HPA-257 proves board/output/scene reachability without a second solver.
- [ ] Runtime JSON contains simple normalized hidden answers.
- [ ] Rust serde accepts emitted scene and catalog snapshots.
- [ ] Rust does not duplicate compiler semantic validation.
- [ ] Shared/public types expose no hidden answer data.
- [ ] Existing Chapter 1 and non-analysis scenes compile unchanged.
- [ ] Production `scene_8_5.md` remains untouched until HPA-265.
- [ ] No schema version, migration, plugin interface, generic evaluator, or layout placeholder is introduced.

## 8. Execution handoff

Execute on:

```text
jack65786656/hpa-259-add-chapter-1-analysis-scene-markdown-schema-and-validation
```

Implementation order: Task 1 → Task 2 → checkpoint review → Task 3 → Task 4 → final review.
