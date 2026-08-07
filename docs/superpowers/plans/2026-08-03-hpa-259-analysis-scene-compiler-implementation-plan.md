# HPA-259 Analysis Scene Compiler Contract Implementation Plan

> **For implementation agents:** keep each commit buildable. Prefer direct code, closed enums, and existing ownership seams over new frameworks. Review once after compiler validation/normalization is green and once before the implementation PR is ready.

**Goal:** Add the smallest production-quality `analysis_scene_<K>.md` compiler contract needed for the real Chapter 1 Beat 8.5 classify, order, and threshold boards.

**Architecture:** Markdown is the authored source. TypeScript parses author intent, validates references and provenance, normalizes hidden accepted answers into runtime-ready JSON, registers qualified analysis definitions in the existing story catalog, and adapts boards to HPA-257’s existing reachability solver. Rust reuses `StoryCatalog`, consumes immutable scene definitions, and validates player drafts in HPA-260. Svelte never receives accepted answers.

## 1. Project priorities

This is a hobby project under active pre-release development.

Prioritize:

1. Fast feature iteration and low maintenance cost.
2. Clear layer ownership and small replaceable modules.
3. Straightforward code over generic infrastructure.
4. Enough validation to catch real authoring mistakes.
5. Clean extension seams for a reviewed future board variant, not speculative support for unknown variants.

Do **not** add:

- analysis schema versions, migrations, or legacy Markdown fallbacks;
- compatibility adapters for unreleased analysis resources or development saves;
- plugin registries or dynamic evaluator dispatch;
- generic puzzle, graph, or constraint engines;
- duplicate TypeScript and Rust authoring validation;
- placeholder layout types without a current shared value;
- result-segment IDs or a rich feedback taxonomy;
- optional boards/cards before actual content needs them.

Breaking analysis changes may update the compiler, fixture, story-catalog wire, Rust schema, and HPA-260 runtime together.

## 2. Scope and ownership boundaries

### In scope

- Accept `analysis_scene_<K>.md` in chapter manifests.
- Support only `classify`, `order`, and `threshold`.
- Parse the Chapter 1 scene, board, card, group, result-dialogue, minimal feedback, and optional hint fields.
- Reference existing evidence, statements, facts, questions, objectives, authorizations, and qualified analysis refs.
- Validate IDs, references, accepted solutions, provenance, threshold satisfiability, story outputs, and reachability.
- Derive the existing TypeScript `AnalysisDefinitionRegistry` from parsed scenes.
- Emit qualified analysis scene/board refs into `story_catalog.json` for Rust lookup.
- Emit deterministic immutable analysis JSON with normalized hidden answers.
- Add immutable Rust serde definitions and the minimum fail-closed handling before HPA-260.
- Keep existing non-analysis chapters compiling unchanged.

### Deferred

- optional boards and optional classify/order cards;
- compare, route, chain, and freeform boards;
- interactive layout-editor authoring;
- progressive hint history;
- specialized wrong-answer copy per threshold failure reason;
- Chapter 2 fixture families;
- mutable analysis state, commands, saves, and public views;
- final Chapter 1 content insertion.

### Layer ownership

```text
Authored Markdown
    ↓
TypeScript parser + source-located AST
    ↓
Existing structural/catalog validation
    ↓
Compiled case-record provenance
    ↓
Analysis validation + hidden-answer normalization
    ↓
Analysis scene JSON + qualified refs in story_catalog.json
    ↓
Rust StoryCatalog + immutable scene serde
    ↓ HPA-260
Rust mutable state and answer evaluation
    ↓
Answer-key-free public view
```

- The compiler is authoritative for authored static definitions and provenance interpretation.
- Rust is authoritative for mutable player state and command execution.
- `DialogueItem` remains outside `@lyra/scene-types`.
- `@lyra/scene-types` gains only the `analysis` chapter-index discriminant.
- `AnalysisBoardLayout` is intentionally deferred despite appearing in the Linear boundary list. Add it only when editor/runtime genuinely share geometry or presentation values.

## 3. Reuse before new code

Reuse the current repository seams:

- `analysis-definition-registry.ts` for TypeScript qualified scene/board lookup;
- `story-catalog.ts` qualified analysis-reference validation;
- `parser-unlock.ts` analysis scene/board predicate grammar;
- `case-record-provenance.ts::validateCaseRecordRequirement` for per-record status/source-group rules;
- HPA-257 `reachability.ts` for positive fixed-point analysis;
- Rust `StoryCatalog` for package-wide immutable definition indexes;
- Rust analysis predicate schema/evaluation hooks already present in `schema.rs` and `unlock.rs`.

Create only:

- the analysis AST/parser;
- analysis-specific semantic validation and normalization;
- the scene-to-reachability adapter;
- immutable scene serde variants.

## 4. Small parser-common extraction

The investigation and interrogation parsers already duplicate the same token/cursor helpers. Adding `parser-analysis.ts` would create another copy.

Before adding analysis parsing, create a narrow `parser-common.ts` that owns only the mechanically shared helpers:

- `consumeMetadata`;
- `consumeDialogueUntilHeading`;
- `describeToken`;
- `parseFailure`.

Migrate the existing investigation/interrogation call sites and linear `fail` call where applicable. Preserve current error codes, source lines, scene-tag asset parsing, and heading-stop behavior. Verify with existing parser tests before adding analysis behavior.

Do not extract:

- analysis card-source parsing;
- fixed-anchor parsing;
- threshold fields;
- generic scene/block frameworks;
- parser-manifest’s location-aware case-record metadata logic.

## 5. Minimal authored Markdown contract

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

- `Summary` is required; there is no `summaryAuthored` compatibility flag.
- H2 blocks are exactly `Intro`, one or more `Board: <label> {#id}`, and `Outro`.
- Every authored board is mandatory.
- No `Unlock` means initially available; otherwise use the existing story-only positive expression grammar.
- Chapter 1 is a sequential chain: the first board is available, each later board unlocks from the previous completion, and completed boards remain available for HPA-260’s read-only reopen behavior.
- The scene completes after every board completes.
- Board H3 blocks are `Card:`, `Group:` for classify only, and exactly one `Result Dialogue`.
- Result dialogue contains dialogue directly; there are no segment IDs.
- Card/group IDs are board-local; board IDs are scene-local.
- Card `Source` accepts `evidence:<id>` or `statement:<id>` only.
- Every card source must be obtainable before its board is reachable.
- `Reveals` contains story reveal targets only.
- An analysis board may complete `prepare_narrow_lock_request` but cannot grant authorization.
- Authored feedback contains incomplete, incorrect, and optional hint copy only. Result dialogue is accepted feedback.
- Every classify card appears in exactly one accepted group.
- Accepted order is an exact permutation of every order card.
- Fixed anchors are one-based, unique, in range, and must satisfy `acceptedOrder[position - 1] === cardId`.
- `Eligible Cards` is a non-empty unique subset of displayed threshold cards. Chapter 1 currently makes every displayed threshold card eligible; do not invent a decoy only to exercise the subset rule.
- All displayed cards remain visible. A selected displayed card outside `Eligible Cards` is ordinary incorrect gameplay, not malformed input.

## 6. Threshold semantics and normalization

For an authored threshold board, let `E` be the eligible card IDs and `S` a candidate selection.

`S` is accepted exactly when:

1. `S` contains unique IDs and `S ⊆ E`.
2. `|S| >= minimumSelected`.
3. Every selected record has an allowed procedural status.
4. When `Require Source Group` is true, every selected record has a non-null `sourceGroupId`.
5. The number of distinct **non-null** source-group IDs in `S` is at least `minimumDistinctSourceGroups`; null never creates an independent source, even when source groups are not required per record.
6. The union of all selected records’ `proofCapabilities` contains every `Required Proof Capability`.

Use `validateCaseRecordRequirement` for rules 3–4 with:

- the authored allowed procedural statuses;
- the authored `requireSourceGroup` value;
- `requiredProofCapabilities: []`.

Validate rule 6 separately because the helper’s capability check is per record while Beat 8.5 capability coverage is selection-wide.

### Runtime normalization

The compiler emits:

```ts
type ClassifyBoardJson = {
  kind: "classify";
  common: AnalysisBoardJsonCommon;
  groups: Array<{ id: string; label: string; description: string }>;
  acceptedGroupByCard: Record<string, string>;
};

type OrderBoardJson = {
  kind: "order";
  common: AnalysisBoardJsonCommon;
  acceptedOrder: string[];
  fixedAnchors: Array<{ cardId: string; position: number }>;
};

type ThresholdBoardJson = {
  kind: "threshold";
  common: AnalysisBoardJsonCommon;
  minimumSelected: number;
  acceptedSelections: string[][];
};
```

`acceptedSelections` rules:

- enumerate all and only accepted `S` values;
- sort IDs inside each selection;
- deterministically sort the outer array;
- emit no provenance rule language for Rust to reinterpret.

Set:

```ts
const MAX_THRESHOLD_ELIGIBLE_CARDS = 6;
```

This is a **materialization budget**, not a general game-engine limit. It caps one board at 64 subsets and comfortably covers the three-card Chapter 1 board. Reject a larger authored threshold board with a clear compiler diagnostic and revisit the wire representation only when real content requires it. Do not add a generic solver.

## 7. Type and story-catalog boundaries

### Compiler AST

Add source-located closed analysis types in `packages/scripts/compile-scenes/types.ts`:

- `ASTAnalysisScene`;
- common board/card/feedback fields;
- `ASTClassifyBoard`;
- `ASTOrderBoard`;
- `ASTThresholdBoard`.

The threshold AST retains the authored provenance constraints. The emitted threshold JSON contains normalized answers instead.

### Shared package

Only extend:

```ts
type: "linear" | "investigation" | "interrogation" | "analysis";
```

Do not add board definitions, layouts, dialogue, reveals, feedback, or hidden answers to `@lyra/scene-types`.

### Existing TypeScript registry

Add:

```ts
createAnalysisDefinitionRegistryFromScenes(scenes)
```

Delete `CompileOptions.analysisRegistry` and its empty production default. Keep the small existing registry abstraction because HPA-257 already consumes it.

Rewrite the existing positive compiler test that currently injects a synthetic registry so it compiles a genuine parsed analysis scene and resolves a later qualified reference. Keep the negative `hpa_257_absent_analysis_registration` fixture.

### Rust reuse through StoryCatalog

Do **not** create a separate Rust analysis-definition index or eager all-scenes directory walk.

Extend emitted `story_catalog.json` with deterministic qualified-ref arrays:

```ts
analysisScenes: Array<{ chapterId: string; sceneId: string }>;
analysisBoards: Array<{ chapterId: string; sceneId: string; boardId: string }>;
```

Keep the current story-catalog schema version; this is an unreleased coordinated wire change with no migration.

Extend Rust `StoryCatalog` with two sets and read-only methods:

```rust
fn has_analysis_scene(&self, chapter_id: &str, scene_id: &str) -> bool;
fn has_analysis_board(&self, chapter_id: &str, scene_id: &str, board_id: &str) -> bool;
```

Change the existing Rust analysis predicate validators to accept `&StoryCatalog`, matching the fact/question/objective/authorization validators beside them. Replace HPA-257’s temporary “unavailable before HPA-259” rejection with catalog membership checks. Predicate evaluation remains `false` until HPA-260 adds mutable completion state.

## 8. Compiler pipeline and commit sequence

Preserve current error ordering as much as possible. Do not move case-record compilation ahead of existing structural/catalog/story-reference validation.

Final order:

```text
parse scenes/catalog
-> existing structural validation
-> existing story-catalog validation
-> derive parsed-scene analysis registry
-> existing story predicate/reveal reference validation
-> compile case-record corpus
-> analysis provenance/solution validation + normalization
-> HPA-257 reachability
-> dialogue-origin validation and emission
```

### Commit A — mechanical parser helper extraction

- create `parser-common.ts`;
- migrate existing duplicated helper call sites;
- run existing linear/investigation/interrogation parser tests;
- no analysis behavior.

### Commit B — analysis AST and parser

- create `parser-analysis.ts` and focused parser tests;
- parse all three closed board variants;
- keep analysis-specific scalar/source/anchor helpers private;
- no production dispatch or emission yet.

### Commit C — standalone pipeline reorder

- move `compileCaseRecordCorpus` before reachability but after existing structural/catalog/story-ref validation;
- preserve existing diagnostic precedence;
- run the complete current invalid-fixture suite before adding analysis semantic validation.

### Commit D — analysis validation and normalization

- create `validator-analysis.ts` and tests;
- validate references, solutions, threshold rules, and provenance;
- call `validateCaseRecordRequirement` for per-record checks;
- produce compiler-only normalized answers;
- derive the production TypeScript registry;
- remove synthetic `CompileOptions.analysisRegistry` injection;
- emit qualified analysis refs into the story catalog.

**Checkpoint review:** review the authored contract, normalized JSON, story-catalog ownership, and error behavior before wiring runtime-facing emission.

### Commit E — production compiler integration

- add `analysis_scene_` orchestrator dispatch;
- emit analysis JSON using the normalized result from Commit D;
- add dialogue origins:

```ts
{ type: "analysisIntro", chapterId, sceneId }
{ type: "analysisResult", chapterId, sceneId, boardId }
{ type: "analysisOutro", chapterId, sceneId }
```

- extend save-content hashing/bundles;
- extend the chapter-index discriminant;
- grep exhaustive scene-type switches in compiler, layout editor, Svelte, and Rust; add explicit fail-closed branches only where required.

### Commit F — reachability and Chapter 1 acceptance corpus

- adapt analysis boards into existing HPA-257 nodes;
- every card source is an implicit prerequisite;
- board completion adds qualified board atoms and authored story effects;
- scene completion requires every board atom and adds the qualified scene atom;
- do not alter the solver.

Create one complete `analysis-chapter-1` fixture containing:

- all classify/order/threshold cards;
- actual source-group definitions;
- non-neutral `reacquired`/`exhibit` provenance;
- `time`/`order` proof capabilities;
- at least two distinct source groups;
- an obtainment path for every card source;
- a later qualified analysis predicate resolved from the parsed scene, not injected data.

Use table-driven mutations for focused invalid cases unless a cross-file corpus is genuinely necessary.

### Commit G — Rust wire and fail-closed handoff

- add immutable analysis scene/board serde variants;
- extend `StoryCatalogJsonV2` and `StoryCatalog` with qualified analysis refs;
- replace temporary analysis-predicate hard failures with `StoryCatalog` membership checks;
- enumerate analysis intro/result/outro dialogue definitions;
- navigation returns an explicit unsupported-runtime error until HPA-260.

`DialogueSegmentOriginV1` is persisted. Because HPA-259 cannot run an analysis scene yet:

- capture must treat analysis origins as unreachable and return an invariant/capture error if encountered;
- restore must reject analysis origins/progress as unsupported until HPA-260 adds `SceneProgressSnapshot::Analysis`;
- do not add a save migration or temporary analysis save representation.

## 9. Validation matrix

Map every HPA-259 invalid-fixture acceptance criterion to a named test:

| Linear criterion | Required test case |
|---|---|
| duplicate IDs | `analysis_duplicate_ids` |
| missing cards | `analysis_missing_card` |
| unresolved references | `analysis_unresolved_reference` |
| incomplete classify solution | `analysis_classify_incomplete` |
| incomplete order solution | `analysis_order_incomplete` |
| impossible threshold | `analysis_threshold_unsatisfiable` |
| missing required provenance | `analysis_threshold_missing_provenance` |
| unreachable outputs | `analysis_output_unreachable` |

Also cover:

- malformed/contradictory fixed anchors;
- eligible IDs not displayed on the board;
- more than six eligible threshold cards;
- unauthorized `grant_authorization` output;
- analysis self-reference and positive cycle;
- deterministic normalized output;
- positive parsed-scene registration replacing synthetic injection.

Representative source-line assertions are sufficient:

- one structural parser error;
- one unresolved reference;
- one invalid solution/provenance error;
- one unreachable output.

## 10. Verification

Focused during development:

```bash
bun run test:scripts -- packages/scripts/compile-scenes/parser-linear.test.ts packages/scripts/compile-scenes/parser-investigation.test.ts packages/scripts/compile-scenes/parser-interrogation.test.ts
bun run test:scripts -- packages/scripts/compile-scenes/parser-analysis.test.ts packages/scripts/compile-scenes/validator-analysis.test.ts
bun run test:scripts -- packages/scripts/compile-scenes/reachability.test.ts packages/scripts/compile-scenes.test.ts
bun run check:scripts
```

Final gate before implementation PR review:

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

Verify specifically:

- production Chapter 1 still uses `scene_8_5.md`;
- existing non-analysis scenes compile unchanged;
- scene and story-catalog JSON are both accepted by Rust;
- no hidden answer data appears in shared/frontend types;
- no separate Rust analysis-definition lifecycle exists;
- no analysis save state or migration exists;
- output is deterministic across two compiler runs.

## 11. Definition of done

- [ ] `analysis_scene_<K>.md` is accepted in manifests.
- [ ] The exact Chapter 1 classify/order/threshold shapes compile.
- [ ] Source-located diagnostics cover real authoring failures.
- [ ] Existing parser duplication is reduced without a generic parser framework.
- [ ] Existing structural/catalog diagnostic precedence remains stable.
- [ ] Analysis definitions derive from parsed scenes, not synthetic production input.
- [ ] Threshold semantics are formal and satisfiable selections normalize deterministically.
- [ ] `story_catalog.json` carries qualified analysis refs used by Rust `StoryCatalog`.
- [ ] HPA-257 proves board/output/scene reachability without a second solver.
- [ ] Rust serde accepts scene and catalog output.
- [ ] Rust loader resolves qualified analysis predicates from `StoryCatalog`.
- [ ] Rust navigation/save paths remain fail-closed until HPA-260.
- [ ] Shared/public types expose no hidden answers.
- [ ] Existing Chapter 1 and legacy scene types compile unchanged.
- [ ] Production `scene_8_5.md` remains untouched.

## 12. Execution handoff

Execute on:

```text
jack65786656/hpa-259-add-chapter-1-analysis-scene-markdown-schema-and-validation
```

Implementation order:

```text
A parser-common extraction
→ B analysis parser
→ C pipeline reorder
→ D validation/normalization/catalog refs
→ checkpoint review
→ E compiler integration
→ F reachability/fixture
→ G Rust handoff
→ final review
```
