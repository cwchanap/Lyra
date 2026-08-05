# HPA-259 Analysis Scene Compiler Contract Implementation Plan

> **For implementation agents:** keep every commit buildable. Prefer direct code and closed enums over reusable frameworks. Review once after the compiler contract is green and once before the implementation PR is ready.

**Goal:** Add the smallest production-quality `analysis_scene_<K>.md` compiler contract needed for the real Chapter 1 Beat 8.5 classify, order, and threshold boards.

**Architecture:** Markdown is the authored source. TypeScript parses and validates author intent, resolves provenance and story references, normalizes hidden accepted answers into runtime-ready JSON, and adapts boards to the existing HPA-257 reachability solver. Rust consumes immutable definitions and validates packaged analysis references. HPA-260 owns mutable runtime state, submission evaluation, persistence, and answer-key-free public views.

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
- security hardening for hand-edited generated resources beyond normal serde shape and reference checks.

Breaking pre-release analysis changes may invalidate generated resources and local development saves. Update the compiler, canonical fixture, Rust schema, and downstream runtime together.

## 2. Scope and ownership boundaries

### In scope

- Accept `analysis_scene_<K>.md` in chapter manifests.
- Support only `classify`, `order`, and `threshold` boards.
- Parse scene, board, card, group, result-dialogue, minimal feedback, and optional hint fields used by Chapter 1.
- Reference existing evidence, statements, facts, questions, objectives, authorizations, and qualified analysis refs through existing story contracts.
- Validate IDs, references, solutions, provenance, threshold satisfiability, story outputs, and reachability.
- Derive compiler and packaged-runtime analysis-definition indexes from real parsed/emitted analysis scenes.
- Emit deterministic immutable JSON with normalized hidden answers.
- Add Rust serde definitions and the minimum fail-closed behavior before HPA-260.
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
Rust serde definitions + packaged definition index
    ↓ HPA-260
Rust runtime state and direct answer comparison
    ↓
Answer-key-free public view
```

- The compiler is authoritative for authored static definitions and hidden accepted answers.
- Rust is authoritative for packaged reference resolution and mutable player state.
- Svelte never receives accepted mappings, accepted order, or threshold answer sets.
- `DialogueItem` remains outside `@lyra/scene-types`.
- `@lyra/scene-types` gains only the `analysis` chapter-index discriminant in HPA-259.

### Intentional `AnalysisBoardLayout` deferral

Linear names `AnalysisBoardLayout` as the owner for genuinely shared editor/runtime geometry or presentation values. HPA-259 intentionally does **not** create that type because Chapter 1 has no authored analysis geometry and no second consumer. This is a deliberate YAGNI interpretation of the boundary, not an accidental omission. Add the type only when HPA-261 or a later editor feature introduces a byte-identical shared value.

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

- `Summary` is required. There is no `summaryAuthored` compatibility flag.
- H2 blocks are exactly `Intro`, one or more `Board: <label> {#id}`, and `Outro`.
- Every authored board is mandatory.
- No `Unlock` means initially available. An authored `Unlock` uses the existing story-only positive grammar.
- Chapter 1 is a board chain: the first board is initially available and each later board unlocks from prior completion. Completed boards remain definitionally available for HPA-260 to reopen read-only.
- HPA-259 does not add optional or free-order board policy. HPA-260 may still select any board that its authored unlocks currently make available.
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
- Every fixed anchor has a unique in-range one-based position and must satisfy `acceptedOrder[position - 1] === cardId`.
- `Eligible Cards` is non-empty, unique, and a subset of displayed threshold card IDs.
- The runtime/public view shows every displayed card. A displayed non-eligible card is a well-formed choice but cannot appear in an accepted selection, so HPA-260 reports ordinary incorrect feedback rather than an application error.
- The canonical Chapter 1 fixture currently makes every displayed threshold card eligible. Do not invent decoys solely to exercise the field.
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

### 4.2 Formal threshold semantics

Let `E` be the authored eligible-card set and `S` a proposed selected-card set.

Before enumeration, require:

- `1 <= minimumSelected <= |E|`;
- `1 <= minimumDistinctSourceGroups <= minimumSelected`;
- `|E| <= MAX_THRESHOLD_ELIGIBLE_CARDS`.

`S` is accepted exactly when:

1. `S ⊆ E`.
2. `|S| >= minimumSelected`.
3. Every selected record satisfies the authored allowed procedural statuses.
4. When `Require Source Group` is true, every selected record has a non-null `sourceGroupId`.
5. The number of distinct **non-null** `sourceGroupId` values in `S` is at least `minimumDistinctSourceGroups`. Null never becomes a synthetic independent source, even when `Require Source Group` is false.
6. The union of `proofCapabilities` across every record in `S` contains every `Required Proof Capabilities` value. Capabilities are aggregate across the selection; each individual record does not need to carry every required capability.

Reuse HPA-256's `validateCaseRecordRequirement` for per-record procedural-status and required-source-group checks. Pass an empty `requiredProofCapabilities` list to that helper because Chapter 1 capability coverage is selection-wide, then perform the capability-union check separately.

Every eligible card must pass the per-record requirement. A board with no satisfying subset is a compiler error.

### 4.3 Normalize answers before emitting JSON

The compiler validates authored constraints and then emits runtime-ready hidden answers once.

```text
Classify AST groups
    -> acceptedGroupByCard

Order AST
    -> acceptedOrder

Threshold AST + compiled provenance
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
- all and only selections satisfying §4.2 are emitted;
- source-group, procedural-status, and proof-capability rules remain compiler concerns and are not reinterpreted by Rust;
- set `MAX_THRESHOLD_ELIGIBLE_CARDS = 12` (at most 4,096 subsets). Reject a larger board with a focused compiler diagnostic and raise the limit only when real authored content requires it;
- do not add a generic constraint solver or optimization framework.

Rust HPA-260 canonicalizes the player's selection and compares it directly against `acceptedSelections`.

### 4.4 Shared package

Only extend the chapter index:

```ts
type: "linear" | "investigation" | "interrogation" | "analysis";
```

Do not add full board definitions, layout placeholders, dialogue, reveals, feedback, or answer keys to `@lyra/scene-types`.

### 4.5 Rust boundary

HPA-259 adds immutable serde counterparts and packaged definition resolution:

- `SceneType::Analysis`;
- `SceneJson::Analysis`;
- closed classify/order/threshold definitions;
- dialogue-group enumeration;
- one immutable packaged analysis scene/board definition index built once from emitted analysis JSON;
- validation of qualified analysis predicates against that packaged index;
- minimum fail-closed navigation handling before HPA-260.

Rust does not duplicate compiler validation for classify completeness, order permutations, anchor consistency, threshold provenance/satisfiability, or story-output reachability.

Until HPA-260, analysis-completion predicate evaluation remains false because no mutable analysis completion state exists. That is separate from resolving whether the referenced packaged scene/board definition exists.

## 5. Lean implementation sequence

### Task 1 — Compiler-only types and parser

**Create**

```text
packages/scripts/compile-scenes/parser-analysis.ts
packages/scripts/compile-scenes/parser-analysis.test.ts
```

**Modify**

```text
packages/scripts/compile-scenes/types.ts
packages/scripts/compile-scenes/parser-unlock.ts
packages/scripts/compile-scenes/parser-reveals.ts
```

Implementation:

- add source-located analysis AST types without yet adding production manifest dispatch;
- parse the complete canonical Markdown fixture;
- keep scalar/list/source/anchor helpers private inside `parser-analysis.ts`;
- reuse the existing tokenizer, cursor, dialogue conversion, positive-expression parser, and reveal parser;
- add an analysis reveal family that accepts story targets only;
- require scene summary;
- reject unknown/duplicate metadata, malformed headings/anchors, local reveal targets, duplicate local IDs, missing result dialogue, and missing board-family fields;
- assert representative exact source-file/line diagnostics.

Focused verification:

```bash
bun run test:scripts -- packages/scripts/compile-scenes/parser-analysis.test.ts
bun run check:scripts
```

Suggested commit: `feat: parse analysis scene markdown`

---

### Task 2 — Semantic validation, answer normalization, production integration, and emission

**Create**

```text
packages/scripts/compile-scenes/validator-analysis.ts
packages/scripts/compile-scenes/validator-analysis.test.ts
```

**Modify only where required**

```text
packages/scene-types/src/index.ts
packages/scripts/compile-scenes/validator.ts
packages/scripts/compile-scenes/story-catalog.ts
packages/scripts/compile-scenes/analysis-definition-registry.ts
packages/scripts/compile-scenes/emitter.ts
packages/scripts/compile-scenes/orchestrator.ts
packages/scripts/compile-scenes/save-content-manifest.ts
packages/scripts/compile-scenes/dialogue-segment-origins.ts
minimal exhaustive asset/default/layout-index consumers
packages/scripts/compile-scenes.test.ts
```

Implementation:

- make the orchestrator reorder a first-class deliverable:

```text
parse scenes
-> general structural validation
-> compile case-record provenance
-> validate + normalize analysis definitions once
-> derive analysis definition registry from parsed analysis scenes
-> validate story predicates/reveals
-> run fixed-point reachability
-> derive dialogue origins and emit
```

- do not emit unverified threshold answers in Task 1;
- classify/order normalization may use pure AST data, but threshold `acceptedSelections` is produced only in this catalog/provenance-aware stage;
- reuse `validateCaseRecordRequirement` as described in §4.2;
- validate global source/story refs, complete solutions, fixed anchors, authority restrictions, and formal threshold semantics;
- add `analysis_scene_` production dispatch only when validation, normalization, emission, and exhaustive consumers land together;
- derive the existing TypeScript `AnalysisDefinitionRegistry` from parsed scenes and remove synthetic production injection;
- emit dialogue origins exactly as:

```ts
{ type: "analysisIntro", chapterId, sceneId }
{ type: "analysisResult", chapterId, sceneId, boardId }
{ type: "analysisOutro", chapterId, sceneId }
```

- use TypeScript exhaustiveness plus one targeted grep for three-scene-type unions/switches. Add only fail-closed/pass-through branches required by the new discriminant; do not implement layout-editor or Svelte analysis UI.

Focused verification:

```bash
bun run test:scripts -- packages/scripts/compile-scenes/parser-analysis.test.ts packages/scripts/compile-scenes/validator-analysis.test.ts packages/scripts/compile-scenes/story-catalog.test.ts packages/scripts/compile-scenes/analysis-definition-registry.test.ts packages/scripts/compile-scenes/dialogue-segment-origins.test.ts packages/scripts/compile-scenes.test.ts
bun run check:scripts
```

**Review checkpoint 1:** review the Markdown, AST, normalized JSON, pipeline order, and hidden-answer boundary before Rust work.

Suggested commit: `feat: compile analysis scene definitions`

---

### Task 3 — HPA-257 reachability and Chapter 1 compiler acceptance

**Modify**

```text
packages/scripts/compile-scenes/reachability.ts
packages/scripts/compile-scenes/reachability.test.ts
packages/scripts/compile-scenes.test.ts
```

**Add one complete valid fixture corpus**

```text
packages/scripts/__fixtures__/analysis-chapter-1/
```

The valid corpus must include:

- a story catalog containing every referenced fact, objective, authorization, and at least two declared source groups;
- prior investigation/interrogation manifests defining every analysis card source;
- non-neutral HPA-256 provenance for threshold records: allowed procedural status, source-group IDs, and `time`/`order` capability coverage;
- an authored obtainment/reveal path for **every** analysis card source so implicit prerequisites are reachable;
- at least one pair of individually valid eligible records sharing a source group, plus another valid record from a second group, so some subsets fail independence and at least one subset succeeds;
- a later predicate referencing the packaged analysis scene/board without synthetic registry input;
- no `narrow_lock_export` grant.

Reachability adaptation:

- no `Unlock` means initially reachable once every card-source prerequisite is obtainable;
- authored `Unlock` is evaluated by the existing HPA-257 expression solver;
- every card source is an implicit evidence/statement prerequisite;
- board completion adds `analysis_board_completed:<chapter>@<scene>@<board>`;
- authored reveals apply in authored order;
- scene completion requires every board and adds `analysis_scene_completed:<chapter>@<scene>`;
- outro dialogue follows completion and is not a separate authored unlock node;
- do not change HPA-257's expression language, transfer logic, scenario enumeration, or cycle detection.

Focused verification:

```bash
bun run test:scripts -- packages/scripts/compile-scenes/reachability.test.ts packages/scripts/compile-scenes.test.ts
bun run scenes:compile
bun run check:scripts
```

Suggested commit: `feat: integrate analysis progression validation`

---

### Task 4 — Rust immutable schema, packaged analysis refs, and regression

**Modify only where required**

```text
apps/game/src-tauri/src/game/schema.rs
apps/game/src-tauri/src/game/loader.rs
apps/game/src-tauri/src/game/unlock.rs
apps/game/src-tauri/src/game/navigation.rs
apps/game/src-tauri/src/game/dialogue_queue.rs
apps/game/src-tauri/src/game/test_support.rs
minimal exhaustive Rust consumers
```

Implementation:

- add immutable analysis serde types matching normalized JSON;
- build one package-backed scene/board definition index from emitted analysis scenes during package loading rather than rereading files per predicate;
- replace HPA-257's temporary hard rejection for `analysis_scene_completed` and `analysis_board_completed` references with definition-existence checks against that index;
- reject unknown packaged analysis refs;
- keep analysis completion predicate evaluation false until HPA-260 adds mutable completion state;
- enumerate intro, one result dialogue per board, and outro dialogue;
- return a clear unsupported-runtime error if navigation reaches an analysis scene before HPA-260;
- run Rust/TypeScript compile checks and a targeted grep for exhaustive scene-type matches, including layout-editor/Svelte mirrors. Add only the minimum compile-safe/fail-closed handling; no frontend workbench behavior;
- deserialize the compiler fixture and load both emitted analysis scene JSON and `story_catalog.json` through the package path.

Rust does not revalidate accepted mappings, accepted order, fixed anchors, provenance, accepted threshold selection generation, or reachability.

Full verification gate:

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

Also verify production Chapter 1 still lists `scene_8_5.md`, existing scene types compile unchanged, generated analysis output is deterministic across two runs, and no answer-key fields appear in shared/frontend public types.

**Review checkpoint 2:** final compiler-to-Rust contract review before implementation PR readiness.

Suggested commit: `feat: accept packaged analysis scene definitions`

## 6. Linear acceptance criteria coverage

Invalid coverage may be table-driven inside focused tests; one fixture directory per error is not required.

| Linear requirement | Required test case |
|---|---|
| duplicate IDs | `analysis_duplicate_board_or_card_id` |
| missing cards | `analysis_classify_card_unassigned` and/or `analysis_order_card_missing` |
| unresolved references | `analysis_card_source_unresolved` and `analysis_qualified_ref_unresolved` |
| incomplete solutions | `analysis_classify_duplicate_assignment` and `analysis_order_not_permutation` |
| impossible thresholds | `analysis_threshold_no_accepted_selection` |
| missing required provenance | `analysis_threshold_record_requirement_failed` |
| unreachable outputs | `analysis_required_output_unreachable` |
| source-located diagnostics | assert exact file/line in one structural, one reference, one solution, and one reachability case |
| Rust scene/catalog acceptance | package-load test reads emitted analysis scene and story catalog |
| no hidden public answer key | type/public-source regression assertion |

## 7. Definition of done

- [ ] `analysis_scene_<K>.md` is accepted in chapter manifests.
- [ ] The canonical Chapter 1 fixture expresses complete classify/order/threshold boards.
- [ ] Threshold selection semantics exactly match §4.2.
- [ ] Parser/compiler diagnostics include accurate source file and line for representative error families.
- [ ] IDs, sources, solutions, fixed anchors, provenance, reveals, and story predicates validate.
- [ ] The valid fixture includes real HPA-256 provenance and obtainment paths for every card.
- [ ] Analysis validation runs after case-record provenance compilation.
- [ ] Parsed analysis scenes replace synthetic TypeScript registry input.
- [ ] Packaged Rust analysis scene/board refs replace HPA-257's temporary hard rejection.
- [ ] HPA-257 proves board/output/scene reachability without a second solver.
- [ ] Emitted JSON contains deterministic runtime-ready hidden answers.
- [ ] Rust serde/package loading accepts the emitted scene and story catalog.
- [ ] Rust does not implement evaluation or duplicate compiler semantics.
- [ ] Shared/public types expose no answer key.
- [ ] `AnalysisBoardLayout` remains intentionally absent until a real shared value exists.
- [ ] Existing Chapter 1 and legacy scene types compile unchanged.
- [ ] Production `scene_8_5.md` remains untouched.

## 8. Self-review checklist

- [ ] Every field is exercised by the real Chapter 1 fixture.
- [ ] No board/card optionality exists without a Chapter 1 use case.
- [ ] No placeholder layout type is emitted or shared.
- [ ] Result dialogue has no unused segment abstraction.
- [ ] Feedback remains minimal and HPA-263-owned polish is deferred.
- [ ] Threshold semantics distinguish per-record requirements from aggregate capability/source-independence requirements.
- [ ] Parser helpers remain private until a second consumer exists.
- [ ] Invalid tests map to every Linear acceptance bullet without multiplying fixture directories.
- [ ] Rust resolves packaged analysis definitions but does not duplicate compiler answer validation.
- [ ] Every commit remains buildable.

## 9. Execution handoff

Execute on:

```text
jack65786656/hpa-259-add-chapter-1-analysis-scene-markdown-schema-and-validation
```

Recommended implementation order: Task 1 through Task 4, with the two review checkpoints specified above.
