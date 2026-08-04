# HPA-259 Analysis Scene Compiler Contract Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Keep every implementation commit buildable and reviewable.

**Goal:** Add the smallest production-quality `analysis_scene_<K>.md` compiler contract needed for the real Chapter 1 Beat 8.5 classify, order, and threshold boards. Emit complete immutable definitions, validate them against the existing story/case-record contracts, integrate them with HPA-257 reachability, and prove Rust serde compatibility without implementing runtime evaluation or UI.

**Architecture:** Markdown remains the only authored source. The compiler owns parsing, semantic validation, hidden solutions, qualified analysis references, reachability adaptation, and deterministic emission. Rust owns only immutable serde definitions in HPA-259. HPA-260 owns mutable runtime state, evaluation, commands, persistence, and answer-key-free views.

**YAGNI revision:** This plan deliberately removes optional-board policy, authored status flags, conditional scene outros, placeholder layout types, segmented result dialogue, contextual feedback taxonomies, duplicate Rust semantic validation, reusable parser-helper modules with only one consumer, and one-directory-per-error fixtures.

## 1. Scope and non-negotiable boundaries

- Support only `classify`, `order`, and `threshold`.
- The Chapter 1 Beat 8.5 contract is the acceptance target.
- Do not design around Chapter 2 compare/route/chain or later freeform templates.
- Every authored board is mandatory in HPA-259.
- A board with no `Unlock` is initially available.
- A board with `Unlock` becomes available through HPA-257's existing positive-expression machinery.
- The scene completes after every authored board completes.
- Every authored card source must be obtainable before its board is considered reachable.
- Accepted mappings, accepted order, eligibility truth, and threshold rules remain in compiler AST/runtime JSON only.
- `DialogueItem` remains outside `@lyra/scene-types`.
- Do not add an `AnalysisBoardLayout` payload until a real editor/runtime-shared geometry or presentation value exists.
- `@lyra/scene-types` gains only the `analysis` chapter-index discriminant in this ticket.
- Analysis scenes are not represented authorities. `grant_authorization` authored on an analysis board must fail validation.
- Beat 8.5 may complete the secondary objective `prepare_narrow_lock_request`; it must not grant `narrow_lock_export`.
- Threshold independent-source counting uses evidence/statement records only. Facts do not manufacture source independence.
- Do not replace production `scene_8_5.md` or edit the Chapter 1 manifest. HPA-265 owns final content insertion.
- Do not add runtime state, evaluator, public board view, save state, Svelte workbench code, commands, plugin APIs, template registries, or generic graph abstractions.

## 2. Minimal authored contract

### 2.1 Scene structure

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

### Card: KAGAMI 摘要時間 {#summary_timestamp}
- **Source:** evidence:summary_timestamp
- **Summary:** 顯示摘要時間，但不能獨立證明本機事件時間。

### Result Dialogue

**早坂茜**：現在有兩條獨立矛盾，可以把申請送進審查。

## Outro

**相馬律**：我們只證明了第三者存在。下一步才是把那個空位填上。
```

### 2.2 Contract rules

- Top-level H2 blocks are exactly `Intro`, one or more `Board: <label> {#id}`, and `Outro`.
- Board-local H3 blocks are `Card:`, `Group:` for classify only, and one `Result Dialogue`.
- `Result Dialogue` directly contains dialogue items; there are no result segment IDs in HPA-259.
- Card/group IDs are local to one board. Board IDs are local to one analysis scene.
- `Source` accepts `evidence:<id>` or `statement:<id>` only.
- `Unlock` is optional and uses a story-only positive expression.
- `Reveals` contains story reveal targets only.
- `Hint` is one optional string.
- Successful result dialogue is the accepted feedback. HPA-259 has only `Incomplete Feedback`, `Incorrect Feedback`, and optional `Hint`.
- `Fixed Anchors` is optional and uses one-based `card_id@position` values.
- Every classify card appears in exactly one accepted group.
- Accepted order is an exact permutation of every order card.
- `Eligible Cards` is a non-empty unique subset of displayed threshold cards. Displayed cards outside the set are ordinary decoys and use the same generic incorrect feedback when selected.
- A successful threshold answer selects only eligible cards and satisfies the authored minimums and provenance constraints.
- Threshold capability requirements are aggregate union coverage across the selected records.
- Allowed procedural status and required source-group presence are per-record eligibility constraints.
- Every authored card source, including threshold decoys, is a reachability prerequisite for its board. Card availability and answer selection are separate concerns.
- Scene completion is implicit after all board-completion atoms are reachable; no authored outro unlock exists in HPA-259.

## 3. Type boundaries

### Compiler-only AST

Use source-located types in `packages/scripts/compile-scenes/types.ts`:

```ts
export type AnalysisUnlockExpr = PositiveExpression<StoryPredicate>;

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
  unlock: AnalysisUnlockExpr | null;
  cards: ASTAnalysisCard[];
  reveals: StoryRevealTarget[];
  feedback: ASTAnalysisFeedback;
  resultDialogue: DialogueItem[];
}>;
```

Define closed `ASTClassifyBoard`, `ASTOrderBoard`, and `ASTThresholdBoard` variants. Keep accepted mappings/order/eligibility and threshold constraints in these compiler-owned types.

`ASTAnalysisScene` contains:

```ts
export type ASTAnalysisScene = Located<{
  kind: "analysisScene";
  id: string;
  title: string;
  summary: string;
  summaryAuthored: boolean;
  intro: DialogueItem[];
  boards: AnalysisBoardAst[];
  outro: DialogueItem[];
  assetRefs: AssetRef[];
}>;
```

### Emitted runtime JSON

Define matching non-located immutable JSON types. `AnalysisBoardJson` contains complete hidden solutions. `JSONAnalysisScene` contains `type: "analysis"`, intro, boards, outro, summary, and asset refs.

### Shared package

In `@lyra/scene-types`, extend only:

```ts
type: "linear" | "investigation" | "interrogation" | "analysis";
```

Do not add `AnalysisBoardLayout`, card definitions, answer keys, reveals, feedback, or dialogue to the shared package in HPA-259.

### Rust boundary

Rust adds immutable serde counterparts only. Do not add `AnalysisBoardView`, `AnalysisBoardSaveState`, runtime state, or evaluator in this ticket.

## 4. Lean implementation sequence

### Task 1: Add the contract, parser, and deterministic emitter

**Create**

```text
packages/scripts/compile-scenes/parser-analysis.ts
packages/scripts/compile-scenes/parser-analysis.test.ts
```

**Modify as required by exhaustive handling**

```text
packages/scene-types/src/index.ts
packages/scripts/compile-scenes/types.ts
packages/scripts/compile-scenes/parser-unlock.ts
packages/scripts/compile-scenes/parser-reveals.ts
packages/scripts/compile-scenes/emitter.ts
packages/scripts/compile-scenes/orchestrator.ts
packages/scripts/compile-scenes/save-content-manifest.ts
packages/scripts/compile-scenes/dialogue-segment-origins.ts
packages/scripts/compile-scenes/semantic-defaults.ts
packages/scripts/compile-scenes/assets/enrich.ts
```

#### Tests first

- Parse the complete canonical Markdown shape above.
- Assert source file and line for scene, boards, cards, groups, metadata, and result dialogue.
- Reject unknown/duplicate metadata, unknown board kind, malformed anchors, local reveal targets, duplicate IDs, missing result dialogue, and missing board-family fields.
- Assert emitted JSON preserves authored order and strips all source locations.
- Assert dialogue origins are exactly:

```ts
{ type: "analysisIntro", chapterId, sceneId }
{ type: "analysisResult", chapterId, sceneId, boardId }
{ type: "analysisOutro", chapterId, sceneId }
```

#### Implementation constraints

- Keep boolean, integer, list, source, and anchor parsing helpers private in `parser-analysis.ts` until another parser needs them.
- Reuse the existing tokenizer/cursor/dialogue conversion patterns.
- Export a story-only unlock parser by reusing HPA-257's existing positive-expression implementation.
- Extend reveal parsing with an `analysis` family that permits story targets only.
- Add `analysis_scene_` dispatch in the orchestrator.
- Add the new discriminant and exhaustive branches in the same buildable task; do not intentionally leave broken unions for later tasks.
- Do not emit layout state.

#### Focused verification

```bash
bun run test:scripts -- packages/scripts/compile-scenes/parser-analysis.test.ts packages/scripts/compile-scenes/emitter.test.ts packages/scripts/compile-scenes/dialogue-segment-origins.test.ts
bun run check:scripts
```

Suggested commit:

```text
feat: add analysis scene compiler contract
```

---

### Task 2: Add semantic validation and derive production definitions

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

#### Validation matrix

**All boards**

- unique board IDs within the scene
- unique card IDs within the board
- source evidence/statement resolves in the compiled case-record corpus
- unlock predicates resolve through existing catalog/analysis references
- story reveal targets resolve
- `grantAuthorization` is rejected because represented authority is null
- result dialogue exists and is non-empty

**Classify**

- at least one group exists
- group IDs are unique
- every accepted card ID resolves
- every card appears in exactly one accepted group

**Order**

- accepted order contains every card exactly once
- no unknown or duplicate card IDs
- anchor positions are in range
- no two anchors occupy one position
- every anchor agrees with the accepted order

**Threshold**

- eligible IDs are non-empty, unique, and resolve to displayed threshold cards
- displayed cards outside the eligible set are permitted decoys
- all eligible cards source evidence or statements
- minimum selected is positive and no greater than eligible count
- minimum distinct groups is positive and no greater than minimum selected
- every eligible record satisfies authored procedural/source-group eligibility rules
- at least one subset of eligible cards can satisfy minimum count, distinct source groups, and aggregate proof capabilities

The implementation may use any clear deterministic satisfiability method. Do not lock the plan to DFS, dynamic programming, or a generic constraint engine.

#### Registry replacement

Add:

```ts
createAnalysisDefinitionRegistryFromScenes(scenes)
```

- Register parsed analysis scenes and boards using qualified chapter/scene/board IDs.
- Remove `CompileOptions.analysisRegistry` as a production input.
- Convert HPA-257 tests that inject synthetic analysis definitions to minimal real analysis Markdown fixtures.
- Keep the small registry abstraction because HPA-257 already consumes it; do not add another registry layer.

#### Pipeline order

```text
parse scenes
-> general structural validation
-> compile case-record provenance
-> validate analysis semantics
-> derive analysis definition registry
-> validate story predicates/reveals
-> run fixed-point reachability
-> derive dialogue origins and emit
```

#### Focused verification

```bash
bun run test:scripts -- packages/scripts/compile-scenes/validator-analysis.test.ts packages/scripts/compile-scenes/story-catalog.test.ts packages/scripts/compile-scenes/analysis-definition-registry.test.ts packages/scripts/compile-scenes.test.ts
bun run check:scripts
```

Suggested commit:

```text
feat: validate analysis scene definitions
```

---

### Task 3: Adapt HPA-257 reachability and add compiler acceptance

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

Use table-driven inline Markdown mutations or a small fixture builder for invalid cases. Do not create one directory for every diagnostic unless a failure genuinely requires a distinct cross-file corpus.

#### Reachability adaptation

For each board:

- no `Unlock` means initially available
- authored `Unlock` is evaluated by the existing HPA-257 expression solver
- every card source adds an implicit evidence/statement availability prerequisite
- completion adds `analysis_board_completed:<chapter>@<scene>@<board>`
- authored reveals apply in authored order

For the scene:

- completion requires every board-completion atom
- completion adds `analysis_scene_completed:<chapter>@<scene>`
- outro dialogue is presentation following scene completion, not a separate authored unlock node

Do not alter HPA-257's positive-expression language, transfer logic, scenario enumeration, or cycle detection.

#### Acceptance fixture outputs

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

The fixture must include:

- complete classify/order/threshold definitions
- at least two source groups
- `reacquired` and/or `exhibit` procedural status
- `time` and `order` proof-capability coverage
- at least one displayed non-eligible threshold decoy
- a same-source pair that is individually eligible but cannot satisfy the distinct-source rule alone
- a later predicate that resolves a qualified analysis board/scene reference without synthetic registry input

#### Reachability tests

- initially available first board
- board-to-board unlock
- all-card inventory prerequisites, including threshold decoys
- ordered story outputs
- scene completion after all boards
- unavailable card source
- self-reference
- positive cycle
- unresolved qualified analysis reference
- unreachable required output

#### Focused verification

```bash
bun run test:scripts -- packages/scripts/compile-scenes/reachability.test.ts packages/scripts/compile-scenes.test.ts
bun run scenes:compile
bun run check:scripts
```

Suggested commit:

```text
feat: integrate analysis scenes with progression validation
```

---

### Task 4: Add immutable Rust serde support and run regression

**Modify only where required**

```text
apps/game/src-tauri/src/game/schema.rs
apps/game/src-tauri/src/game/navigation.rs
apps/game/src-tauri/src/game/dialogue_queue.rs
apps/game/src-tauri/src/game/test_support.rs
apps/game/src-tauri/src/game/loader.rs       # exhaustive decode/reference branch only
```

#### Rust scope

- Add `SceneType::Analysis`.
- Add `SceneJson::Analysis(AnalysisSceneJson)`.
- Add closed immutable classify/order/threshold serde types matching emitted JSON.
- Use `deny_unknown_fields` where consistent with existing schema conventions.
- Include analysis intro, one result dialogue per board, and outro in dialogue-group enumeration.
- Deserialize the compiler acceptance fixture and assert all three variants and hidden solution data.
- Add the smallest explicit fail-closed branch when runtime construction/navigation encounters an analysis scene before HPA-260.

#### Explicit non-scope

Do not reimplement compiler semantic validation in Rust. In particular, Rust does not duplicate:

- classify completeness checks
- accepted-order permutation validation
- anchor consistency validation
- threshold satisfiability/provenance rules
- story-catalog output reachability

The TypeScript compiler is authoritative for authored static definitions. Rust proves wire compatibility and rejects malformed serde shape, not a second copy of the authoring rules.

#### Full verification gate

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

Also verify:

- production Chapter 1 still lists `scene_8_5.md`
- existing non-analysis scenes compile unchanged
- no hidden solution fields appear in `@lyra/scene-types` or frontend public types
- emitted analysis JSON is deterministic across two compiler runs

Suggested commit:

```text
feat: accept analysis scene definitions in Rust
```

## 5. Expected file footprint

### New files

```text
packages/scripts/compile-scenes/parser-analysis.ts
packages/scripts/compile-scenes/parser-analysis.test.ts
packages/scripts/compile-scenes/validator-analysis.ts
packages/scripts/compile-scenes/validator-analysis.test.ts
packages/scripts/__fixtures__/analysis-chapter-1/
```

### Expected modified areas

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
packages/scripts/compile-scenes.test.ts
apps/game/src-tauri/src/game/schema.rs
minimal exhaustive Rust consumers
```

The list is a forecast, not a requirement to touch every file. Modify semantic-default, asset, save-reference, loader, navigation, or dialogue files only when the new discriminant makes an existing exhaustive branch require it.

## 6. Definition of done

- [ ] `analysis_scene_<K>.md` is accepted in chapter manifests.
- [ ] The canonical Chapter 1 fixture expresses complete classify/order/threshold boards.
- [ ] Parser diagnostics include accurate source file and line.
- [ ] IDs, sources, solutions, threshold rules, provenance, reveals, and story predicates validate.
- [ ] Parsed analysis scenes replace synthetic production registry input.
- [ ] Qualified analysis scene/board predicates resolve.
- [ ] HPA-257 proves board/output/scene reachability without a second solver.
- [ ] Emitted JSON contains complete immutable hidden solutions.
- [ ] Rust serde accepts the emitted fixture.
- [ ] Rust does not implement evaluation or duplicate compiler semantics.
- [ ] Shared/public types expose no answer key.
- [ ] Existing Chapter 1 and legacy scene types compile unchanged.
- [ ] Production `scene_8_5.md` remains untouched.

## 7. Self-review checklist

- [ ] Every field is exercised by the real Chapter 1 fixture.
- [ ] No board/card optionality exists without a Chapter 1 use case.
- [ ] No placeholder layout type is emitted or shared.
- [ ] Result dialogue has no unused segment abstraction.
- [ ] Feedback remains minimal and HPA-263-owned polish is deferred.
- [ ] Threshold eligibility remains meaningful through at least one displayed decoy.
- [ ] Parser helpers remain private until a second consumer exists.
- [ ] Invalid tests are table-driven unless cross-file setup is necessary.
- [ ] Rust is a wire-contract consumer, not a second authoring validator.
- [ ] Every commit remains buildable.

## 8. Execution handoff

Execute on:

```text
jack65786656/hpa-259-add-chapter-1-analysis-scene-markdown-schema-and-validation
```

Recommended implementation order: Task 1 through Task 4, with one specification-compliance review and one code-quality review after each green task.