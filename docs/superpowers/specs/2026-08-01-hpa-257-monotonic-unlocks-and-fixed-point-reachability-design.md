# HPA-257 Monotonic Unlocks and Fixed-Point Reachability Design

**Status:** Ready for review; revised after codebase alignment, self-review, and three PR-feedback passes  
**Issue:** HPA-257 — Extend monotonic reveal/unlock expressions and add fixed-point reachability  
**Date:** 2026-08-01

## 1. References and scope

This focused design refines:

- `docs/superpowers/specs/2026-07-19-detective-gameplay-systems-design.md`
  §§7.2, 9, 11, 14, and 15;
- `docs/superpowers/plans/2026-07-19-detective-gameplay-systems-implementation-plan.md`
  epic P0.3;
- the merged HPA-55 command transaction, dialogue, acquisition, and navigation
  seams;
- the merged HPA-255 global story catalog, sparse durable story state, and sole
  primary-objective mutation contract;
- the merged HPA-129/HPA-392 save, restore, content-identity, and transactional
  recapture implementation;
- the merged HPA-256 provenance, source-group, immutable supersession, and
  support-lineage contract;
- the merged HPA-258 Case File, objective HUD, and save-recap work.

HPA-257 extends Lyra's existing positive unlock grammar and reveal pipeline so
content can depend on durable story state without introducing mutable negative
gates. It adds compiler-wide positive reachability, authored-order abstract
reveal-batch interpretation, and a conservative primary-objective analysis that
accounts for strict sequencing and free-order exploration.

This slice delivers:

- shared parsing of `and`, `or`, parentheses, and first-class nested
  `at_least(count, ...)`;
- positive predicates for asserted facts, resolved global questions, completed
  objectives, completed qualified analysis scenes/boards, and granted
  authorizations;
- explicit story-state reveal targets delegated to HPA-255 mutations;
- one atomic/idempotent reveal pipeline shared by investigation,
  interrogation, and future scene runtimes;
- exact authored-order interpretation of targets inside one reveal list;
- explicit authority-origin validation for authorization grants;
- normalized whole-corpus positive reachability above existing specialized scene
  analyses;
- adapter-defined strict-order and free-order execution relations;
- a finite may/must primary-objective abstraction without exhaustive event-order
  enumeration;
- source-located errors for impossible required paths and deterministic warnings
  for order-dependent paths;
- compiler, Rust, ownership, compatibility, and save/restore tests.

It does not add analysis-scene Markdown, analysis runtime/UI, request-denial
mechanics, production story-state content, generic flags, arbitrary negation,
revocation, frontend progression logic, or exhaustive objective-order model
checking.

## 2. Approved decisions

1. Ordinary authored progression remains positive and monotonic. Once content is
   visible or unlocked, no supported mutation hides or re-locks it.
2. The language does not add generic `not`, inequality, absence predicates,
   mutable negative flags, or active-primary-objective predicates.
3. Existing investigation/interrogation unlock expressions retain byte-identical
   emitted JSON and runtime meaning.
4. `and` binds more tightly than `or`; parentheses override precedence.
5. `at_least` is an n-ary wire node and is never expanded into combinations of
   binary `and`/`or` nodes.
6. `at_least` requires a positive base-10 integer count, a non-empty child list,
   and `count <= conditions.length`.
7. Structurally duplicate `at_least` children are invalid. General Boolean
   equivalence and commutative normalization are explicit non-goals.
8. Investigation and interrogation opt into the shared story predicate and
   story-target grammar by default. There is no per-file opt-in flag.
9. Linear scenes do not opt in because their current format has no unlock or
   reveal metadata.
10. HPA-257 extends the existing analysis-reference validation seam and defines
    adapter/fixture hooks; HPA-259 owns production analysis definitions and
    authoring.
11. Existing interrogation-local `question:<id> answered` remains distinct from
    global `question:<id> resolved`.
12. Analysis scene/board references are fully qualified and never inferred from
    a bare local ID.
13. New story targets use mutation-oriented prefixes such as `assert_fact:` and
    `set_primary_objective:` rather than overloading local target syntax.
14. Objective ID `null` is reserved and invalid in `story_catalog.md` because
    `set_primary_objective:null` means clear the active primary.
15. Reveal targets are processed in authored list order, but their effects become
    externally visible only if the whole gameplay command commits.
16. Earlier targets in one list may satisfy prerequisites of later targets.
17. If a later target fails, runtime rollback and compiler abstract simulation
    discard every provisional effect from that list.
18. Unlock conditions are re-evaluated after the complete reveal transaction,
    never between targets in the same list.
19. Runtime idempotence is owned by durable one-shot trigger progress plus
    existing inventory/local-set behavior and HPA-255 mutation outcomes.
20. A consumed trigger never redispatches its reveal list on re-examination,
    re-entry, repeated correct submission, or repeated command delivery.
21. HPA-255 remains the sole owner of story-state mutation semantics.
22. The dispatcher calls `StoryState::set_primary_objective`; it never writes
    objective progress or `active_primary_objective_id` directly.
23. HPA-257 preserves HPA-255's rejection of completing the current primary while
    retaining that same primary as next.
24. Authored `complete_objective` may target only a secondary objective.
25. Compiler semantic validation, Rust startup validation, and the Rust
    dispatcher all reject a primary `completeObjective` target before HPA-255 is
    called.
26. Question resolution is explicit. Asserting a resolver-candidate fact does not
    automatically resolve a question.
27. Fact targets name propositions only. Scene/analysis adapters supply assertion
    origin and support materialization.
28. Current investigation/interrogation adapters provide no represented authority
    context. A `grant_authorization` target in either family is a compile/startup
    error in HPA-257.
29. No production HPA-257 or HPA-259 adapter can grant authorization. HPA-264 owns
    the first production authority-event surface.
30. The `authorization:<id> granted` predicate remains in the grammar for forward
    compatibility and synthetic fixtures. Until HPA-264, a production mandatory
    authorization gate is unreachable and fails compilation; an optional one
    warns. Authors must not add production grant gates in this slice.
31. Existing specialized investigation/interrogation analyzers remain
    authoritative for local gameplay semantics and guaranteed-flow results.
32. The whole-corpus layer consumes normalized outputs from those analyzers; it
    does not replace them.
33. Positive dependency self-reference and multi-node cycles are rejected
    strictly, even if an external branch could seed a member.
34. Free-order execution relations are not positive dependency edges and are not
    rejected as cycles. Mutual may-before relationships are expected in an
    exploration region.
35. Primary-objective flow is not a post-processing pass over a completed
    positive fixed point. Positive reachability and primary abstract state are
    solved together because primary completion may unlock more content.
36. Scene adapters explicitly provide strict-order predecessors and conservative
    may-execute-before relationships. The generic analyzer does not infer
    free-order behavior from graph shape alone.
37. Free-order events are one-shot. A mutual may-before relation means either
    event may run first; it never licenses abstract replay such as A → B → A.
38. For a node N, every reachable member listed in N's may-before relation is
    included in N's free-order summary. The analyzer may over-approximate
    correlations, but it must not choose an arbitrary smaller subset.
39. The primary abstract domain tracks possible and guaranteed active/completed
    values. It does not enumerate every event permutation.
40. Free-order ambiguity cannot cause a dynamic order-dependent hard error unless
    invalidity is proven for all modeled valid inputs.
41. A transition that succeeds for some modeled orders and fails for others emits
    a deterministic warning and contributes effects only to successful abstract
    paths.
42. A mandatory path that depends on an order-conditional primary effect is not
    silently accepted; its producer warning identifies the ambiguity.
43. Unknown/secondary primary targets and reserved IDs are order-independent hard
    errors.
44. A next primary that is guaranteed already completed is an always-invalid hard
    error. A next primary that may already be completed is order-dependent and
    warns.
45. Compiler primary analysis assumes a valid HPA-255 state. Corrupt states whose
    active ID is absent from objective progress remain runtime/restore errors and
    are not authorable paths.
46. Completing a primary in the primary helper domain also publishes the normal
    `objective_completed:<id>` positive atom used by author-visible predicates.
47. Existing legacy local reachability diagnostics retain their codes and
    severity.
48. Legacy-only content receives no new HPA-257 errors or warnings. The current
    Chapter 1 compile diagnostic snapshot, generated JSON, and content revision
    remain unchanged when no new syntax is authored.
49. Newly modeled unreachable mandatory content is an error; explicitly optional
    unreachable content is a warning.
50. Migration-origin mutations are not authored reachability producers unless a
    fixture explicitly seeds their resulting progress.
51. The story catalog schema remains version 2. HPA-257 adds validation but no
    catalog field.
52. The save schema remains version 2. HPA-257 adds no generic applied-event
    ledger; subsystem trigger progress remains authoritative.
53. `@lyra/scene-types` continues to own only the current scene-local editor
    contract. Global story mutations and hidden analysis data remain outside it.
54. TypeScript and Rust expression evaluators are separate implementations but
    run one shared serialized semantics fixture.
55. HPA-257 adds no frontend component, IPC command, or production story edit.

## 3. Current repository constraints

### 3.1 Compiler parser and catalog ownership

The current compiler:

- has parallel investigation/interrogation recursive-descent paths in
  `parser-unlock.ts`;
- supports binary `and`/`or` and parentheses but no threshold node;
- uses `consumeWord` with a current boundary of whitespace or parentheses, so
  comma must become a delimiter for `at_least` or the parser must move to an
  equivalent token-kind implementation;
- models investigation and interrogation expressions as separate recursive
  unions in `types.ts`;
- parses reveal lists separately in `parser-investigation.ts` and
  `parser-interrogation.ts`;
- contains substantial specialized reachability logic for investigation blocks,
  inventory guarantees, interrogation completion, contradiction availability,
  and forced optional phases;
- has a deterministic non-blocking warning channel;
- computes package content identity from canonical emitted resources.

Catalog work is already split across two existing modules:

- `parser-story-catalog.ts` parses `story_catalog.md`, owns heading/field syntax,
  source lines, `ID_RE`, and AST construction;
- `story-catalog.ts` owns semantic validation and already exports
  `AnalysisBoardRef`, `validateAnalysisBoardRef`,
  `validateSetPrimaryObjectiveTarget`, and `validateStoryCatalog`.

HPA-257 extends both owners instead of introducing a replacement or parallel
catalog module:

- parser-level `{#null}` rejection belongs in `parser-story-catalog.ts` so the
  heading line is reported even before a valid objective AST entry is emitted;
- semantic reserved-ID validation, target-kind validation, analysis-reference
  validation, and hand-built AST defense belong in `story-catalog.ts`;
- the existing `AnalysisBoardRef`, `validateAnalysisBoardRef`,
  `invalidAnalysisBoardRef`, `validateSetPrimaryObjectiveTarget`, and
  `invalidPrimaryObjectiveTarget` contracts are reused and extended, not
  redefined as new HPA-257 APIs.

The implementation must share combinator and story-target parsing without
flattening context-specific predicate/target validity.

### 3.2 Runtime

The current runtime:

- mirrors scene-specific expression trees in `game/schema.rs`;
- evaluates them through separate Rust paths in `game/unlock.rs`;
- applies investigation/interrogation reveals in `game/reveals.rs`;
- processes current reveal targets in authored order;
- owns atomic command rollback through `EngineRollbackSnapshot`;
- owns evidence/statement acquisition through `AcquisitionCtx`;
- stores facts, questions, objectives, authorizations, and the one active primary
  in `game/story/`;
- exposes HPA-255 mutation methods with `pub(in crate::game)` visibility;
- persists local trigger progress, story state, inventory, dialogue, and
  acquisition state through save schema v2.

HPA-255 currently rejects:

- unknown next objective IDs;
- secondary next objectives;
- next primaries already completed;
- `completeCurrent` when current and next are the same non-null ID;
- completing an active objective whose progress entry is missing.

HPA-257 models the first four author-reachable conditions. The fifth is excluded
by the valid-state invariant and remains runtime/restore defense-in-depth.

HPA-255's internal `complete_objective` can complete a primary and clear the
active scalar. HPA-257 intentionally exposes a narrower authored contract and
repeats the secondary-only check at compiler, startup, and dispatch boundaries.

### 3.3 Free-order gameplay

Investigation blocks are often executable in either order after entering a
location. Interrogation also contains choices whose runtime order is not fully
represented by a producer-to-consumer unlock graph.

Therefore this graph is insufficient by itself:

```text
entry → hotspot_a
entry → hotspot_b
```

If both hotspots contain primary transitions, either may precede the other even
though neither has an unlock edge to its sibling. Scene adapters must provide
that execution relationship explicitly.

### 3.4 Legacy compatibility

Existing Chapter 1 content uses only legacy local predicates/targets. HPA-257
must not:

- reorder or flatten existing expression trees;
- rewrite existing reveal lists;
- change local question/phase meanings;
- change required/unreachable classification;
- change first-use versus re-examination dialogue ordering;
- change generated content revision when new syntax is unused;
- emit a new `optionalContentUnreachable`, ordering, or whole-corpus diagnostic
  for a legacy-only node.

The implementation captures the current Chapter 1 error/warning snapshot before
adding the joint analyzer and asserts it remains byte-for-byte identical. The
current zero-warning compile remains zero-warning.

## 4. Goals and invariants

### 4.1 Positive monotonicity

Every author-visible unlock predicate observes progress that only moves false to
true:

- evidence collected;
- statement acquired;
- hotspot investigated;
- topic discussed;
- interrogation question answered;
- interrogation phase completed;
- fact asserted;
- global question resolved;
- objective completed;
- analysis scene/board completed;
- authorization granted.

Active-primary replacement is not observable by unlock expressions. For every
supported expression `E` and valid positive mutation `m`:

```text
E(state) = true  ⇒  E(m(state)) = true
```

### 4.2 Definition, progress, and effect separation

- Catalog/scene files define IDs, labels, conditions, and effects.
- Runtime state stores acquired/revealed/completed/granted progress.
- Expressions inspect progress and never mutate it.
- Targets describe effects and never copy catalog prose.
- Saves store stable IDs/progress, not expression source text.

### 4.3 One mutation owner

Mutation semantics remain owned by:

- `Inventory`/`AcquisitionCtx` for evidence and statements;
- local scene-state methods for local visibility/completion;
- HPA-255 `StoryState` methods for global progress.

The reveal layer resolves targets, supplies context, and enforces authored-target
restrictions that are intentionally narrower than HPA-255's internal API.

## 5. Positive expression authoring grammar

### 5.1 Grammar

```text
expr          := or_expr
or_expr       := and_expr ("or" and_expr)*
and_expr      := atom ("and" atom)*
atom          := "(" expr ")"
               | at_least
               | predicate
at_least      := "at_least" "(" count "," expr ("," expr)* ")"
count         := base-10 positive integer
```

`and > or`. `at_least` is an atom, while each child is a full expression.
Whitespace is optional around commas and parentheses. The parser must accept:

```text
at_least(1,fact:a asserted)
at_least(2, fact:a asserted,fact:b asserted)
```

The implementation plan must update comma tokenization/word-boundary behavior and
add no-whitespace comma tests.

### 5.2 Scene-family matrix and authorization availability

| Scene/runtime family | Story predicates | Story targets | Authority grant in HPA-257 |
|---|---|---|---|
| Investigation | enabled by default | enabled by default | parsed, then rejected because authority context is null |
| Interrogation | enabled by default | enabled by default | parsed, then rejected because authority context is null |
| Linear scene | unsupported; no unlock/reveal metadata | unsupported | unsupported |
| Synthetic analysis fixture | enabled through registry adapter | enabled through fixture adapter | allowed only with matching fixture authority context |
| Production analysis | HPA-259 | HPA-259 runtime integration | no institutional grant |
| Production request/hearing | future HPA-264 adapter | future HPA-264 adapter | allowed with matching represented authority |

There is no `Enable Story Predicates` metadata flag.

The authorization predicate is syntactically valid now so future HPA-264 content
will not require another grammar change. It has no production grant producer in
HPA-257/HPA-259. Consequently:

- a mandatory production gate on `authorization:<id> granted` fails
  `mandatoryAuthorizationUnreachable`;
- an optional production gate warns `optionalContentUnreachable`;
- authoring guidance tells authors not to add production authorization gates
  until HPA-264 supplies a represented-authority event.

### 5.3 Legacy predicates

Investigation:

```text
evidence:<id> collected
statement:<id> acquired
topic:<character_id>@<topic_id> discussed
hotspot:<id> investigated
```

Interrogation:

```text
evidence:<id> collected
statement:<id> acquired
question:<local_question_id> answered
phase:<local_phase_id> completed
```

### 5.4 Shared story predicates

```text
fact:<id> asserted
question:<id> resolved
objective:<id> completed
authorization:<id> granted
analysis_scene:<chapter_id>@<scene_id> completed
analysis_board:<chapter_id>@<scene_id>@<board_id> completed
```

`objective_revealed:<id>` is an internal reachability atom only. There is no
`objective:<id> revealed` authoring predicate in HPA-257.

### 5.5 Qualified analysis references

Authoring uses `@`-qualified slug segments:

```text
analysis_scene:chapter_1@analysis_scene_8_5 completed
analysis_board:chapter_1@analysis_scene_8_5@source_board completed
```

The existing compiler already owns:

```ts
type AnalysisBoardRef = {
  chapterId: string;
  sceneId: string;
  boardId: string;
};
```

in `story-catalog.ts`, together with `validateAnalysisBoardRef` and the existing
`invalidAnalysisBoardRef` diagnostic. HPA-257 reuses that type and validator.

HPA-257 may add the parallel scene-level form when required:

```ts
type AnalysisSceneRef = {
  chapterId: string;
  sceneId: string;
};
```

Every segment matches `^[a-z0-9_]+$`. Missing, extra, empty, or bare local
segments fail with the existing board diagnostic or a parallel
`invalidAnalysisSceneRef` for scene-only refs. HPA-257 fixtures register
resolvable definitions through the `AnalysisDefinitionRegistry` hook named in
§15.1; HPA-259 provides production registrations.

### 5.6 `at_least` validation

Reject:

- zero, negative, signed, decimal, hexadecimal, or fractional counts;
- an empty child list;
- count larger than child count;
- structurally duplicate normalized children;
- malformed delimiters.

Structural equality compares emitted child trees after redundant parentheses are
removed. It does not reorder commutative children. These remain accepted as
structurally different:

```text
(fact:a asserted or fact:b asserted)
(fact:b asserted or fact:a asserted)
```

Runtime counts true child positions.

### 5.7 No negative or active forms

These remain invalid:

```text
not fact:a asserted
objective:a incomplete
authorization:a missing
active_primary_objective:a
```

## 6. Compiler and wire expression model

### 6.1 Compiler core

```ts
type PositiveExpression<Predicate> =
  | {
      op: "and" | "or";
      left: PositiveExpression<Predicate>;
      right: PositiveExpression<Predicate>;
    }
  | {
      op: "at_least";
      count: number;
      conditions: PositiveExpression<Predicate>[];
    }
  | Predicate;
```

Concrete unions remain context-specific:

```ts
type InvestigationUnlockExpr = PositiveExpression<
  InvestigationLocalPredicate | StoryPredicate
>;

type InterrogationUnlockExpr = PositiveExpression<
  InterrogationLocalPredicate | StoryPredicate
>;
```

### 6.2 Emitted JSON

Legacy binary nodes remain byte-identical. New threshold shape:

```json
{
  "op": "at_least",
  "count": 2,
  "conditions": [
    { "predicate": "fact_asserted", "id": "fact_a" },
    { "predicate": "question_resolved", "id": "question_a" },
    { "predicate": "authorization_granted", "id": "authorization_a" }
  ]
}
```

New story predicate shapes:

```ts
type StoryPredicate =
  | { predicate: "fact_asserted"; id: string }
  | { predicate: "question_resolved"; id: string }
  | { predicate: "objective_completed"; id: string }
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
    }
  | { predicate: "authorization_granted"; id: string };
```

### 6.3 Rust schema/startup validation

Rust keeps concrete investigation/interrogation enums so serde rejects
context-invalid local predicates. Both gain `AtLeast` and story variants.

Startup semantic validation checks:

- threshold count/children/duplicates;
- qualified slug segments;
- catalog/analysis references;
- reserved objective ID `null`;
- primary `completeObjective` targets;
- target kind restrictions and authority context registered in the emitted
  definition.

Compiler diagnostics remain source-located; runtime loading protects against
hand-edited resources.

### 6.4 Shared semantics fixture

Both implementations load exactly:

```text
packages/shared/fixtures/unlock-expression-semantics.json
```

The JSON contract is versioned and data-only:

```json
{
  "schemaVersion": 1,
  "cases": [
    {
      "name": "nested threshold",
      "expression": { "op": "at_least", "count": 1, "conditions": [] },
      "truths": { "fact_asserted:fact_a": true },
      "expected": true
    }
  ]
}
```

The illustrative expression above is shortened; committed cases must contain
valid complete wire trees. Each case contains a unique name, one concrete wire
expression, a normalized atom-key-to-Boolean truth assignment, and one expected
Boolean result. TypeScript and Rust deserialize and evaluate the same bytes.
Neither test suite maintains a translated copy.

## 7. Story reveal authoring contract

### 7.1 Existing local targets

Current forms remain valid in their current families:

```text
[evidence:<id>]
[statement:<id>]
[topic:<character_id>@<topic_id>]
[hotspot:<id>]
[sublocation:<id>]
[question:<local_question_id>]
[phase:<local_phase_id>]
```

### 7.2 Story targets

```text
[assert_fact:<fact_id>]
[reveal_question:<question_id>]
[resolve_question:<question_id>@<fact_id>]
[reveal_objective:<objective_id>]
[complete_objective:<secondary_objective_id>]
[set_primary_objective:<primary_objective_id>]
[set_primary_objective:<primary_objective_id>; complete_current]
[set_primary_objective:null]
[set_primary_objective:null; complete_current]
[grant_authorization:<authorization_id>]
```

`null` is reserved only in `set_primary_objective`. Parser validation rejects an
objective heading `{#null}` at its source line; semantic compiler validation and
Rust loading reject the same condition for hand-built or edited resources. Other
typed namespaces may use slug `null`.

### 7.3 Wire union

```ts
type StoryRevealTarget =
  | { kind: "assertFact"; factId: string }
  | { kind: "revealQuestion"; questionId: string }
  | { kind: "resolveQuestion"; questionId: string; factId: string }
  | { kind: "revealObjective"; objectiveId: string }
  | { kind: "completeObjective"; objectiveId: string }
  | {
      kind: "setPrimaryObjective";
      completeCurrent: boolean;
      nextObjectiveId: string | null;
    }
  | { kind: "grantAuthorization"; authorizationId: string };
```

Compiler scene JSON composes the local union with `StoryRevealTarget` without
moving the global union into `@lyra/scene-types`.

### 7.4 Exact duplicate/conflict rules

Normalize every story target to its discriminant and fields.

- Same discriminant and identical normalized fields:
  `duplicateStoryRevealTarget`.
- Two `assertFact` targets for the same fact are duplicates.
- Two `resolveQuestion` targets with the same question and fact are duplicates.
- Two `resolveQuestion` targets with the same question but different facts:
  `conflictingQuestionResolution`.
- More than one `setPrimaryObjective` is invalid. Exact equality reports
  duplicate; differing fields report `multiplePrimaryTransitions`.
- Different discriminants are not duplicates. `revealObjective:X` followed by
  `completeObjective:X` is interpreted in order.
- Existing local-target duplicate behavior is unchanged.

### 7.5 Context-free validation

Before reachability:

- resolve every target definition;
- validate question resolver membership in `resolvedByFactIds`;
- validate non-null set-primary target kind through the existing
  `validateSetPrimaryObjectiveTarget` helper;
- reject primary `completeObjective`;
- enforce duplicate/conflict rules;
- enforce authority-context presence/match.

This phase does not assume a current primary or completed-objective set.

### 7.6 Fact support materialization

```ts
type FactSupport = {
  supportingRecords: InventoryTarget[];
  supportingFactIds: string[];
};

type StoryRevealMaterializationContext = {
  origin: AssertionOrigin;
  factSupportById: Map<string, FactSupport>;
  representedAuthority: string | null;
};
```

Current scene events may supply empty support. Future analysis adapters supply
accepted support. HPA-257 never infers support from nearby inventory/dialogue.

## 8. Runtime reveal pipeline

### 8.1 Trigger guard

Every reveal list has an owning durable one-shot trigger, including first
sublocation entry, first hotspot inspection, first topic discussion, first
interrogation breakthrough, and future board/authority-event completion.

Inside one command transaction, runtime:

1. verifies the trigger is unconsumed;
2. transitions trigger progress provisionally;
3. processes targets in authored order;
4. installs dialogue/results only after successful processing;
5. rolls back trigger and every other field on error.

No generic `appliedStoryEventIds` ledger is added.

### 8.2 Shared dispatcher and mutation map

`game/reveals.rs` remains the integration owner.

| Story target | Runtime action |
|---|---|
| `assertFact` | validate materialization, call `StoryState::assert_fact` |
| `revealQuestion` | call `StoryState::reveal_question` |
| `resolveQuestion` | call `StoryState::resolve_question` |
| `revealObjective` | call `StoryState::reveal_objective` |
| `completeObjective` | verify secondary, then call `StoryState::complete_objective` |
| `setPrimaryObjective` | call `StoryState::set_primary_objective` |
| `grantAuthorization` | verify represented authority, then call `StoryState::grant_authorization` |

The secondary-objective check is repeated in Rust because HPA-255's internal
`complete_objective` has a broader contract and can complete a primary.

### 8.3 Authority context

A grant requires:

1. an authorization definition;
2. a non-null represented authority supplied by a registered adapter;
3. equality with `grantingAuthority`;
4. a valid assertion origin.

Investigation and interrogation supply `representedAuthority = null`. Synthetic
fixtures may register authority context. No production HPA-257/HPA-259 node is an
authority event; production grant behavior begins with HPA-264.

Migration APIs may call HPA-255 directly. Migration progress is not an authored
producer in static analysis unless explicitly included in fixture seeds.

### 8.4 Atomicity

Target methods may validate/mutate one effect at a time, but command-level
rollback owns batch atomicity. A failure on the final target restores:

- trigger progress;
- local scene progress/overrides;
- inventory and acquisition events;
- facts/questions/objectives/authorizations;
- active primary;
- dialogue/history and command generation state.

### 8.5 Idempotence

Idempotence is defined at the authored-event boundary:

- consumed triggers skip dispatch;
- distinct valid fact events may union support while preserving first origin;
- repeated question reveal/resolution and grant use HPA-255 outcomes;
- resolver replacement remains invalid;
- repeated inventory targets do not append acquisition dialogue/events;
- local sets do not duplicate entries;
- committed `completeCurrent` transitions are never replayed.

## 9. Runtime expression evaluation

Rust composes scene-local contexts with:

```rust
trait StoryUnlockContext {
    fn fact_asserted(&self, id: &str) -> bool;
    fn question_resolved(&self, id: &str) -> bool;
    fn objective_completed(&self, id: &str) -> bool;
    fn analysis_scene_completed(&self, chapter_id: &str, scene_id: &str) -> bool;
    fn analysis_board_completed(
        &self,
        chapter_id: &str,
        scene_id: &str,
        board_id: &str,
    ) -> bool;
    fn authorization_granted(&self, id: &str) -> bool;
}
```

For `at_least`:

```text
true_count := number of true child expressions
result := true_count >= count
```

Evaluation is side-effect-free and may short-circuit. The shared fixture in §6.4
keeps TypeScript and Rust semantics aligned.

## 10. Normalized reachability and ordering model

### 10.1 Specialized analysis remains authoritative

Existing scene analyzers continue to decide:

- local block reachability;
- guaranteed versus obtainable inventory;
- contradiction availability;
- intersections across alternative correct lines;
- required/effectively forced optional phases;
- scene outro completion.

They export normalized nodes rather than being replaced.

### 10.2 Node model

```ts
type ReachabilityRequirement = "mandatory" | "optional";

type ReachabilityNode = {
  key: string;
  requirement: ReachabilityRequirement;
  legacyCompatibilityMode: boolean;
  initiallyReachable: boolean;
  condition: PositiveExpression<ReachabilityPredicate> | null;
  implicitPrerequisites: ReachabilityPredicate[];
  effects: ReachabilityEffect[]; // authored order retained
  representedAuthority: string | null;

  strictPredecessorKeys: string[];
  mayExecuteBeforeKeys: string[];
  freeOrderRegionId: string | null;

  sourceFile: string;
  line: number;
};
```

`legacyCompatibilityMode` marks nodes using only pre-HPA-257 local syntax. The
joint analyzer may consume their specialized outputs, but it does not emit new
HPA-257 optional/order diagnostics for them.

`strictPredecessorKeys` means the predecessor executes/completes before this node
on every runtime path represented by the adapter.

`mayExecuteBeforeKeys` is a conservative superset of other one-shot nodes that
can execute before this node on at least one legal path/order. It excludes the
node itself and includes strict predecessors and eligible free-order peers.

`freeOrderRegionId` groups mutually orderable exploration events for diagnostics.
Membership alone does not imply every pair is orderable; the adapter's may-before
relation is authoritative.

### 10.3 Edge ownership

Primary-flow ordering uses four distinct sources:

1. strict scene/chapter sequencing supplied by adapters;
2. positive prerequisite producers satisfying unlock or implicit prerequisites;
3. free-order may-before pairs supplied by specialized adapters;
4. authored target order inside one node, handled locally by §11.4.

The generic analyzer must not infer free-order siblings merely because two nodes
share an entry predecessor. Positive dependency SCC validation uses prerequisite
edges only, not mutual free-order pairs.

### 10.4 Positive atoms

The finite atom set includes:

```text
evidence:<id>
statement:<id>
hotspot:<chapter>@<scene>@<id>
topic:<chapter>@<scene>@<character>@<topic>
question_answered:<chapter>@<scene>@<id>
phase_completed:<chapter>@<scene>@<id>
fact_asserted:<id>
question_resolved:<id>
objective_revealed:<id>       # internal only
objective_completed:<id>
authorization_granted:<id>
analysis_scene_completed:<chapter>@<scene>
analysis_board_completed:<chapter>@<scene>@<board>
```

### 10.5 Seeds

Seeds include:

- first playable story entry under current sequencing;
- authored initially unlocked local blocks once their scene is entered;
- initial/automatic progress reported by specialized analyzers;
- explicit synthetic fixture progress.

Catalog definitions and migration possibilities do not seed progress.

## 11. Joint positive and primary abstract interpretation

### 11.1 Why the analyses are joint

A primary transition may complete an objective; that completion publishes
`objective_completed:<id>`; that atom may unlock a new node containing another
primary transition. Positive reachability and primary flow therefore stabilize
together.

### 11.2 Per-node abstract state

```ts
type PrimaryCandidate = string | null;
type MustActivePrimary =
  | { kind: "uninitialized" }
  | { kind: "known"; id: PrimaryCandidate }
  | { kind: "unknown" };

type NodeAbstractState = {
  mayAtoms: Set<ReachabilityAtom>;
  mustAtoms: Set<ReachabilityAtom>;

  mayActivePrimaryIds: Set<PrimaryCandidate>;
  mustActivePrimary: MustActivePrimary;
  mayCompletedPrimaryIds: Set<string>;
  mustCompletedPrimaryIds: Set<string>;

  orderAmbiguous: boolean;
};
```

Meaning:

- `may*` contains every value/progress that can occur before the node on some
  modeled path/order;
- `must*` contains only value/progress guaranteed before the node on every
  modeled path/order;
- free-order peer effects contribute to `may*`, not `must*`, unless a strict edge
  also exists;
- the primary completion helper sets and the positive atom sets are synchronized
  invariants, not independent sources of truth.

For every primary objective ID `C`:

```text
C ∈ mayCompletedPrimaryIds
  ⇔ objective_completed:C ∈ mayAtoms

C ∈ mustCompletedPrimaryIds
  ⇔ objective_completed:C ∈ mustAtoms
```

The domain is path-insensitive but not corpus-global. Unrelated nodes that cannot
execute before this node do not contribute.

### 11.3 Complete free-order one-shot summary

For node `N`, define:

```text
P_N = every reachable M in N.mayExecuteBeforeKeys where M != N
```

The analyzer includes **all** members of `P_N`; it never chooses an arbitrary
subset for convenience.

Let `entry_N` be N's abstract state from strict scene/chapter predecessors and
positive-prerequisite producers before free-order peers are considered. For each
member `M ∈ P_N`, maintain an N-specific member summary `out_N[M]`.

The summary equations are:

```text
in_N[M] = entry_N join join(out_N[K] for every K in P_N where K != M)
out_N[M] = abstract_transfer_once(M, in_N[M])
before_N = entry_N join join(out_N[M] for every M in P_N)
```

They are solved to the least fixed point using the lattice update rules in
§11.11. Important constraints:

1. `M`'s own prior output is excluded from `in_N[M]`. Re-evaluating M's summary
   after another member widens the input is analysis refinement, not runtime
   replay.
2. Each member is represented once in the equations. The analysis never composes
   `M → ... → M`.
3. Evaluating a member against joined outputs from other members intentionally
   over-approximates cross-member correlation. This may add warnings or clear
   must facts, but it does not under-approximate a legal may-before member.
4. Positive prerequisite edges inside a region remain strict. If B requires an
   atom produced by A, A → B is handled as a prerequisite, not merely as an
   unconstrained peer relation.
5. Any state component that any may-before member can change is removed from the
   corresponding free-order-derived `must*` result. A peer transition can add
   `mayActive`, `mayCompleted`, or `mayAtoms`, but never establishes a new must
   fact by itself.
6. `mustActivePrimary` becomes `unknown` when any may-before member can change the
   active primary or when incoming concrete values disagree.
7. The self-excluding equations may conservatively represent combinations that
   no single concrete order realizes. Such widening sets `orderAmbiguous` and
   produces/propagates the ordering warning rather than a hard claim.

This policy handles all legal may-before peers, captures interactions among
distinct one-shot members, prevents event replay, and avoids exhaustive
permutation enumeration.

### 11.4 Ordered reveal-batch simulation

For each reachable node, the analyzer copies its input abstract state and
interprets targets in authored list order.

1. Earlier target effects are immediately visible to later targets.
2. An implicit prerequisite may be satisfied by input state or an earlier target.
3. A target impossible for every modeled provisional input makes the complete
   batch always invalid.
4. A target succeeding for some inputs and failing for others makes the batch
   order-dependent.
5. Provisional effects publish only after at least one modeled input completes
   the entire list.
6. If no input completes, no target contributes an atom or primary output,
   matching runtime rollback.
7. After a may-fail target, later must outputs survive only when true on every
   surviving successful abstract input.

Thus:

```text
[resolve_question:q@f, assert_fact:f]
```

is always invalid when `f` is not available before the batch, while:

```text
[assert_fact:f, resolve_question:q@f]
```

is valid.

Diagnostics:

- no modeled input completes: `storyRevealBatchAlwaysInvalid`;
- some inputs complete and some fail: `storyRevealBatchOrderDependent`.

A reachable optional node is not exempt from an always-invalid batch. An
unreachable optional node receives its ordinary unreachable warning and is not
used to derive dynamic batch conclusions.

### 11.5 Positive expression may/must evaluation

For expression `E`:

- `mayTrue(E)` asks whether E can be true using may atoms;
- `mustTrue(E)` asks whether E is true using must atoms.

For `at_least(n, children)`:

- may-true when at least n children are may-true;
- must-true when at least n children are must-true.

Node may-reachability uses may-true. Existing specialized guaranteed-flow
analysis remains authoritative where all-path proof is required.

### 11.6 Primary transfer: no transition

A node without `setPrimaryObjective` passes primary state through. Its ordered
non-primary targets may still add completed-secondary objective atoms.

### 11.7 Primary transfer: `completeCurrent = false`

For `setPrimaryObjective(false, X)`, order-independent validation first ensures X
is null or an existing primary.

Dynamic cases:

- non-null X in `mustCompletedPrimaryIds`:
  `primaryObjectiveTransitionAlwaysInvalid`; no successful output;
- non-null X in `mayCompletedPrimaryIds` but not must-completed:
  `primaryObjectiveOrderingNotExhaustive`; successful paths produce active X;
- otherwise successful paths produce active X.

A non-null successful target also produces internal `objective_revealed:X`.

### 11.8 Primary transfer: `completeCurrent = true`

For `setPrimaryObjective(true, X)`, an input is invalid when:

- non-null next X is already completed on that input; or
- current active is the same non-null X.

Classification:

- X must-completed, or concrete must-active equal to X:
  always-invalid hard error;
- X may-completed but not must-completed, or may-active contains X while another
  valid current/null is possible:
  ordering warning;
- only valid candidates:
  no transition warning.

On successful paths:

- every possible non-null current ID C other than X becomes may-completed;
- if every surviving successful input has the same non-null current C, C becomes
  must-completed;
- for every C added to `mayCompletedPrimaryIds`, publish
  `objective_completed:C` into `mayAtoms`;
- for every C added to `mustCompletedPrimaryIds`, publish
  `objective_completed:C` into `mustAtoms`;
- output active becomes X, including null;
- non-null X becomes revealed.

The analyzer credits no output from invalid candidates. If current is null,
`completeCurrent` completes no objective and publishes no completion atom.

### 11.9 Valid-state assumption

The compiler does not model an active ID absent from objective progress. Such a
state cannot be authored through HPA-255's valid mutation sequence. Runtime
mutation, snapshot restore, and catalog/state validation retain defense-in-depth
for corrupt or hand-edited state.

### 11.10 Mandatory-path reporting under ambiguity

If a mandatory consumer becomes reachable only through a producer carrying
`storyRevealBatchOrderDependent` or
`primaryObjectiveOrderingNotExhaustive`, compilation retains the warning and
names the mandatory consumer(s) relying on that conditional output.

The analysis does not claim every free-order execution succeeds. It guarantees
that order ambiguity is not silent and that hard always-invalid claims require
must-state proof.

### 11.11 Lattice updates and convergence

The analysis uses monotone lattice updates; it never replaces a published must
state with a freshly recomputed stronger state.

For each node and each N-specific free-order member summary:

```text
nextMay  = previousMay union computedMay
nextMust = previousMust intersection computedMust
```

A must component is installed directly only on its first successful publication.
After that first publication, every update uses meet/intersection.

`mustActivePrimary` uses this meet:

```text
meet(uninitialized, x) = x
meet(known(a), known(a)) = known(a)
meet(known(a), known(b)) = unknown       when a != b
meet(known(_), unknown) = unknown
meet(unknown, _) = unknown
```

It never changes from `unknown` back to concrete during one analysis run.

Conceptually:

```text
initialize seed node states

repeat
  compute strict/prerequisite entry states
  solve each N-specific self-excluding free-order summary using all may-before members
  mark nodes whose conditions/prerequisites are may-satisfiable
  simulate every newly reachable or changed-input ordered reveal batch
  publish outputs only through union/meet updates
until the product-lattice state is unchanged
```

The domains are finite:

- parsed node keys;
- finite positive atoms;
- finite objective IDs plus null;
- finite may/must membership bits;
- finite uninitialized/known/unknown active values.

May sets only grow, must sets only shrink after first publication, concrete
must-active only degrades, and reachable membership only grows. The
self-excluding one-shot equations prevent unbounded event replay. Convergence is
therefore guaranteed without an authored iteration cap.

## 12. Cycle and self-reference validation

### 12.1 Positive dependency graph

Create producer-to-consumer edges for positive expression atoms and implicit
prerequisites. Qualify local identities by chapter/scene/block.

For `or` and `at_least`, every referenced producer participates in strict cycle
analysis. The policy is intentionally conservative.

### 12.2 Rejection

Reject:

- direct node self-dependency;
- fact support transitively depending on the asserted fact;
- a multi-node positive-dependency SCC;
- a one-node SCC with a self-loop.

An external seed does not legalize a dependency cycle.

### 12.3 Free-order relation is separate

Mutual `mayExecuteBeforeKeys` pairs are execution-order possibilities, not
positive prerequisites. They may be symmetric, are summarized by §11.3's
self-excluding one-shot equations, and do not trigger
`positiveDependencyCycle`.

### 12.4 Diagnostics

Emit one canonical cycle diagnostic per SCC with a stable minimal path. Suppress
duplicate generic diagnostics where a legacy specialized validator already
reported the same block.

## 13. Mandatory, optional, and authorization reachability

### 13.1 Classification and legacy suppression

Adapters classify:

- existing entry/completion according to current specialized semantics;
- existing locked investigation/interrogation blocks with current error behavior;
- future required analysis nodes as mandatory;
- future side content as optional;
- grant outputs required by mandatory consumers as mandatory producers.

Catalog definitions alone are not gameplay nodes. New whole-corpus optional and
ordering diagnostics are suppressed for `legacyCompatibilityMode` nodes unless
they opt into a new HPA-257 predicate/target. Existing specialized errors remain
unchanged.

### 13.2 Post-convergence diagnostics

- unreachable new mandatory node: `requiredContentUnreachable`;
- unreachable optional new node: `optionalContentUnreachable`;
- mandatory authorization with no reachable matching grant:
  `mandatoryAuthorizationUnreachable`;
- reachable batch with no successful abstract input:
  `storyRevealBatchAlwaysInvalid`;
- order-conditional batch/primary transition: deterministic warning;
- unsatisfied semantic references/kinds: source-located hard error regardless of
  optionality.

### 13.3 Authorization path

For mandatory `authorization:<id> granted`, verify:

1. definition exists;
2. a grant producer exists;
3. producer authority matches `grantingAuthority`;
4. at least one matching producer is reachable.

No production grant producer exists before HPA-264. Investigation,
interrogation, and production analysis grant targets are not candidates.

## 14. Validation and diagnostic contract

### 14.1 Reference validation and existing helpers

Validate typed references against:

- `StoryCatalog.facts`;
- `StoryCatalog.questions`;
- `StoryCatalog.objectives`;
- `StoryCatalog.authorizations`;
- `AnalysisDefinitionRegistry` for qualified analysis refs.

Typed namespaces may reuse a slug except objective ID `null`.

Existing compiler contracts reused by HPA-257:

| Existing code/API | Continued responsibility |
|---|---|
| `invalidAnalysisBoardRef` / `validateAnalysisBoardRef` | malformed qualified board-ref segments |
| `invalidPrimaryObjectiveTarget` / `validateSetPrimaryObjectiveTarget` | unknown or secondary non-null set-primary target |
| `validateStoryCatalog` | cross-definition semantic validation and reserved-ID defense |
| `AnalysisBoardRef` | structured chapter/scene/board reference type |

HPA-257 adds a parallel `invalidAnalysisSceneRef` only if the new scene-level
reference cannot reuse a more general ref validator without weakening the
existing board diagnostic.

### 14.2 New diagnostic codes

| Code | Severity | Meaning |
|---|---|---|
| `unlockAtLeastInvalidCount` | error | count is not a positive base-10 integer |
| `unlockAtLeastEmptyConditions` | error | no child expression |
| `unlockAtLeastCountExceedsConditions` | error | count exceeds child count |
| `unlockAtLeastDuplicateCondition` | error | structurally duplicate child |
| `unresolvedStoryPredicate` | error | typed story predicate reference missing |
| `unresolvedAnalysisPredicate` | error | qualified analysis definition missing |
| `invalidAnalysisSceneRef` | error | malformed qualified analysis-scene ref |
| `storyRevealUnresolved` | error | story target reference missing |
| `reservedObjectiveId` | error | objective ID `null` is reserved |
| `invalidQuestionResolutionTarget` | error | fact cannot resolve named question |
| `primaryObjectiveCompletionRequiresSet` | error | authored complete target names primary |
| `duplicateStoryRevealTarget` | error | exact normalized duplicate |
| `conflictingQuestionResolution` | error | one question has different resolvers in one batch |
| `multiplePrimaryTransitions` | error | batch contains multiple set-primary targets |
| `authorizationGrantOutsideAuthorityEvent` | error | represented authority absent |
| `authorizationGrantAuthorityMismatch` | error | represented authority differs from definition |
| `storyRevealBatchAlwaysInvalid` | error | no modeled input completes ordered batch |
| `storyRevealBatchOrderDependent` | warning | some modeled inputs complete and some fail |
| `primaryObjectiveTransitionAlwaysInvalid` | error | transition invalid for all modeled inputs |
| `primaryObjectiveOrderingNotExhaustive` | warning | free/branch order changes transition validity |
| `positiveSelfReference` | error | effect/condition depends on itself |
| `positiveDependencyCycle` | error | positive prerequisite SCC |
| `requiredContentUnreachable` | error | mandatory new node not reached |
| `mandatoryAuthorizationUnreachable` | error | required grant path missing |
| `optionalContentUnreachable` | warning | optional new node not reached |

Legacy and existing semantic codes remain unchanged where they already cover the
condition.

### 14.3 Stable ordering

Errors/warnings sort by:

1. normalized source path;
2. one-based line;
3. diagnostic code;
4. stable node key;
5. target index when applicable.

This order is part of compiler golden tests and prevents warning flapping.

## 15. Module ownership

### 15.1 Compiler

Expected focused changes:

```text
packages/scripts/compile-scenes/
  types.ts
  parser-unlock.ts
  parser-investigation.ts
  parser-interrogation.ts
  parser-reveals.ts                 # new shared local/story target parser
  parser-story-catalog.ts           # existing Markdown parser/source-line owner
  story-catalog.ts                  # existing semantic validator/ref helper owner
  analysis-definition-registry.ts   # narrow HPA-257 fixture/production hook
  validator.ts                      # retains specialized validation
  reachability.ts                   # nodes, SCCs, ordered batches, joint fixed point
  emitter.ts

packages/shared/fixtures/
  unlock-expression-semantics.json  # shared TS/Rust data fixture
```

Ownership is binding:

- extend `parser-story-catalog.ts` for heading-level reserved-ID diagnostics;
- extend `story-catalog.ts` for semantic reserved-ID defense and reuse its
  existing `AnalysisBoardRef`, `validateAnalysisBoardRef`,
  `validateSetPrimaryObjectiveTarget`, and `validateStoryCatalog` exports;
- do not introduce a third catalog parser or duplicate the existing validators;
- `analysis-definition-registry.ts` resolves qualified scene/board definitions
  and exposes deterministic fixture registration; HPA-259 owns production
  population.

### 15.2 Adapter contract

Investigation/interrogation adapters expose:

- normalized local conditions/effects;
- mandatory/optional and legacy-compatibility classification;
- possible and guaranteed local outputs from specialized logic;
- strict predecessor keys;
- the complete conservative may-execute-before set;
- free-order region and one-shot member identity;
- represented authority, currently null;
- source file/line and stable target indexes.

Two adapter implementations presented the same AST must emit deterministic
normalized output.

### 15.3 Shared package boundary

`packages/scene-types/src/index.ts` retains its current scene-local reveal union.
A compatibility alias may rename it `SceneLocalRevealTarget`, but global story
mutations remain compiler/runtime-owned.

### 15.4 Rust

Expected focused changes:

```text
apps/game/src-tauri/src/game/
  schema.rs
  unlock.rs
  reveals.rs
  story/              # reuse HPA-255 mutations; narrow accessors/tests only
  save/               # integration tests only; no HPA-257 schema bump
```

`reveals.rs` or a nearby focused helper owns authored-target restrictions,
authority validation, support materialization, and dispatch. HPA-255 mutation
implementations stay in `story/mutations.rs`.

### 15.5 Frontend/IPC

No frontend state type or command registration changes are required. Existing
commands return refreshed `GameStateView` after committed mutations.

## 16. Save, restore, and content compatibility

### 16.1 Save schema

HPA-257 adds no generic mutable field. Current saves already contain:

- inventory/acquisition state;
- investigation/interrogation trigger/local progress;
- facts/questions/objectives/authorizations/active primary;
- dialogue and transaction-related persisted state.

Future analysis trigger progress remains owned by HPA-260. Therefore:

- save schema remains version 2 for HPA-257;
- no migration is added;
- restore remains transactional;
- matching-revision recapture reproduces the same public state;
- consumed triggers remain consumed after restore.

### 16.2 Content identity

Legacy content emits byte-identical resources and keeps its content revision.
Using a new expression or target naturally changes emitted resources and package
content revision through the existing manifest algorithm.

### 16.3 Round-trip fixtures

Runtime fixtures execute concrete orders; they do not attempt to reproduce the
compiler's abstract notion of order-conditionality.

A concrete successful integration path must:

1. collect evidence;
2. assert a fact;
3. resolve a question;
4. complete a secondary objective;
5. execute one valid concrete primary-transition order;
6. grant authorization from a matching synthetic authority event;
7. unlock later content through nested `at_least`;
8. save/restart/load;
9. preserve positive progress, active objective, trigger consumption, and
   unlocked content;
10. repeat the original command and prove no redispatch.

Separate runtime tests execute both concrete orders of free-order primary
fixtures and compare each result with the compiler fixture's valid/invalid-order
expectation. No previously unlocked block may become locked after restore.

## 17. Test strategy

### 17.1 Legacy characterization

- snapshot every current valid expression/tree;
- prove current associativity and precedence;
- compile existing Chapter 1 unchanged;
- assert the complete existing error/warning snapshot remains identical, with
  zero new whole-corpus or optional warnings;
- assert existing reveal arrays/dialogue ordering unchanged;
- assert content revision unchanged when new syntax is unused.

### 17.2 Parser and `at_least`

Cover:

- no-whitespace commas after verbs and between children;
- one-of-one and all-of-N;
- nested thresholds and mixed binary children;
- invalid counts/empty children/duplicates;
- reordered semantically equivalent `or` children remain accepted;
- malformed delimiters and trailing tokens.

### 17.3 Scene-family matrix

- investigation story predicate/target accepted without opt-in flag;
- interrogation story predicate/target accepted without flag;
- linear metadata rejected as today;
- investigation/interrogation grants rejected for null authority context;
- mandatory production authorization predicate fails without a producer;
- optional production authorization predicate warns;
- synthetic authority fixture accepted when authority matches;
- production analysis ref unresolved until registry registration.

### 17.4 Ordered batch semantics

Compiler and Rust fixtures cover:

```text
[resolve_question:q@f, assert_fact:f]  # fail if f absent before batch
[assert_fact:f, resolve_question:q@f]  # succeed
```

Also cover:

- a later failure discards every earlier provisional effect;
- some valid/some invalid abstract inputs emit order-dependent warning;
- no valid input emits always-invalid error and no output atoms;
- mandatory consumer dependency is named by producer warning;
- exact duplicate/conflict target rules.

### 17.5 Free-order primary behavior

Synthetic investigation fixture: two initially available hotspots in one
free-order region.

Cover both concrete runtime orders and the compiler summary for:

1. A sets primary A; B completes current and sets B;
2. A sets primary A; B completes current and sets A;
3. A completes A; B later attempts to set A;
4. strict dependency A → B turning a may condition into must state;
5. unrelated regions not contaminating candidate sets;
6. mutual may-before pairs never feeding a member's own output back into itself;
7. three free-order one-shot members widening to ambiguity without permutation
   enumeration;
8. every adapter-listed may-before member appearing in the summary;
9. primary completion publishing the matching `objective_completed:<id>` atom and
   unlocking a dependent node.

Expected diagnostics:

- free-order valid/invalid mix: warning, not false always-invalid error;
- strict same-current/next: always-invalid error;
- strict completed-next: always-invalid error;
- free-order maybe-completed next: warning;
- unrelated disjoint branch: no warning.

### 17.6 Positive reachability

Cover:

- multi-iteration evidence → fact → question → objective → grant chain;
- threshold branches contributing across iterations;
- direct self-reference and longer SCCs;
- externally seeded dependency cycle still rejected;
- unreachable mandatory and optional nodes;
- authority producer absent, mismatched, unreachable, and synthetic-reachable;
- no duplicate legacy/generic diagnostics.

### 17.7 Runtime defense and ownership

- Rust rejects primary `completeObjective` at resource validation and dispatcher;
- unknown/secondary/completed next primary follows HPA-255 behavior;
- corrupt active-without-progress remains a runtime/restore error fixture;
- mixed-batch final failure rolls back every transaction field;
- repeated gameplay command skips consumed trigger;
- source test proves dispatcher calls `set_primary_objective` and contains no
  direct writes to objective maps/active field.

### 17.8 TypeScript/Rust semantic parity

Both suites load
`packages/shared/fixtures/unlock-expression-semantics.json` directly. The fixture
contains schema version 1, uniquely named cases, concrete wire expression trees,
normalized atom truth assignments, and expected Boolean results. Include legacy
nodes, every story predicate, nested `at_least`, mixed operators, and
short-circuit-equivalent cases.

A fixture-schema validation test fails unknown fields, duplicate names, malformed
wire trees, and unsupported schema versions before either evaluator runs.

### 17.9 Lattice and convergence tests

- a recomputed stronger must candidate cannot strengthen previously published
  must state;
- `mustActivePrimary` never changes from unknown back to concrete;
- member-summary recomputation can widen from another member but excludes its own
  prior output;
- finite free-order fixtures reach a stable product-lattice state;
- diagnostic output remains stable across node input order permutations.

### 17.10 Verification gate

Implementation PR must pass:

- `bun run scenes:compile`;
- complete compiler/workspace tests;
- complete Rust tests;
- TypeScript/Svelte/Rust checks;
- ESLint, Prettier, rustfmt, and warnings-denied Clippy;
- content-revision and diagnostic goldens;
- targeted save/restore integration.

Packaged Tauri E2E is required only if implementation changes an existing
player-visible authored path or command timing; the implementation plan states
that decision explicitly.

## 18. Authoring guidance changes

Update:

- `.claude/skills/writing-investigation-scene/SKILL.md`;
- `.claude/skills/writing-interrogation-scene/SKILL.md`;
- the future HPA-259 analysis skill.

Guidance includes:

- exact story predicates/targets and scene-family matrix;
- qualified analysis reference syntax;
- comma-safe `at_least` examples and invalid counts;
- no generic negative gates;
- reserved objective ID `null`;
- objective revealed is not an author predicate;
- primary completion only through set-primary;
- ordered target-list semantics and atomic rollback;
- one-shot trigger ownership;
- investigation/interrogation/production analysis cannot grant authorization;
- do not author production authorization gates until HPA-264;
- strict positive-cycle policy;
- free-order primary warnings and recommended branch linearization;
- deterministic optional-unreachable warnings;
- definitions/migrations do not imply initial progress.

## 19. Rejected alternatives

### 19.1 One unrestricted expression union

Rejected because local predicates need context-specific validation.

### 19.2 Expand thresholds into binary trees

Rejected because expansion is combinatorial and harms diagnostics.

### 19.3 Generic negation or string flags

Rejected because it breaks monotonicity and duplicates typed state.

### 19.4 Duplicate primary mutation logic

Rejected because HPA-255 owns transition semantics and the active scalar.

### 19.5 Make low-level `completeCurrent` independently replayable

Rejected because trigger-level idempotence preserves HPA-255's rejection rules
without objective-history heuristics.

### 19.6 Treat reveal targets inside one list as an unordered set

Rejected because runtime is authored-order sensitive and atomic.

### 19.7 Primary flow from unlock dependencies only

Rejected because free-order siblings execute before one another without unlock
edges. Adapters must expose runtime ordering.

### 19.8 Choose an arbitrary subset of may-before members

Rejected because omitting an adapter-listed member under-approximates legal
runtime orders. Every listed member participates in the N-specific summary.

### 19.9 Evaluate every free-order member only against raw region entry

Rejected because it misses interactions among distinct peers, such as one peer
setting a primary before another completes it. The self-excluding equations
allow peer-to-peer widening without member replay.

### 19.10 Traverse mutual may-before pairs as a normal execution cycle

Rejected because it replays one-shot events and invents A → B → A.

### 19.11 Require total linearization of all primary transitions

Rejected because it unnecessarily removes investigation freedom. May/must
analysis warns on order dependence and hard-fails only proven invalidity.

### 19.12 Exhaustive objective-order state-space search

Rejected because the parent contract excludes exhaustive ordering proof.

### 19.13 Corpus-global possible-primary set

Rejected because unrelated branches polluted warnings.

### 19.14 Compiler-only primary `completeObjective` restriction

Rejected because hand-edited resources could reach HPA-255's broader internal
API. Rust repeats the authored-contract check.

### 19.15 Replace specialized scene analysis

Rejected because existing validators encode stronger gameplay-specific facts.

### 19.16 Generic applied-event ledger or save bump

Rejected because subsystem trigger progress already owns replay state.

### 19.17 One catalog file owner

Rejected because the repository already separates Markdown parsing in
`parser-story-catalog.ts` from semantic validation in `story-catalog.ts`.

## 20. Acceptance-criteria mapping

| HPA-257 requirement | Design mechanism |
|---|---|
| Legacy unlock behavior and diagnostics unchanged | §§3.4, 10.2, 13.1, 17.1 |
| Positive fact/question/objective/analysis/grant predicates | §§5–6 |
| Nested `at_least` and invalid counts | §§5.1, 5.6, 17.2 |
| Atomic/idempotent reveal dispatch | §§8, 11.4, 17.4/17.7 |
| HPA-255 owns primary transitions | §§2, 8.2, 17.7 |
| Fixed point accounts for primary completion | §§11.1, 11.8, 17.5 |
| Primary completion reaches normal objective predicate | §§11.2, 11.8 |
| No exhaustive ordering claim | §§11.3, 19.12 |
| Free-order investigation represented completely | §§10.2–10.3, 11.3, 17.5 |
| Invalid refs/counts/self-reference/cycles fail with locations | §§5, 12, 14 |
| Required unreachable paths fail | §13 |
| Authority gates need matching production path | §§5.2, 8.3, 13.3 |
| No relock after mutation/save | §§4.1, 16.3 |
| Compiler/Rust semantics aligned | §§6.4, 9, 17.8 |
| Abstract interpretation converges monotonically | §§11.11, 17.9 |

## 21. Implementation-plan handoff

The implementation plan uses small TDD slices and names exact current files. At
minimum:

1. characterize legacy parser/emission/runtime diagnostics;
2. extract shared combinator parser and fix comma delimiter handling;
3. add `at_least` types/emission/Rust serde and the shared parity fixture;
4. add story predicates and typed reference validation by extending the existing
   `story-catalog.ts` helpers;
5. add story target parser, duplicate/conflict rules, and scene-family matrix;
6. extend `parser-story-catalog.ts` and `story-catalog.ts` for reserved `null` at
   their respective syntax/semantic boundaries;
7. add Rust authored-target defense;
8. define `AnalysisDefinitionRegistry` and normalized scene adapters;
9. expose strict/may-before ordering, complete member sets, region IDs, and
   one-shot member identity;
10. implement ordered provisional batch simulation and diagnostics;
11. implement joint positive/primary may/must interpretation with N-specific,
    self-excluding all-member free-order summaries;
12. publish primary completions into normal `objective_completed` atoms;
13. enforce union/meet lattice updates and add convergence tests;
14. add free-order, strict-order, completed-next, no-replay, disjoint-region, and
    legacy-zero-warning fixtures;
15. integrate runtime dispatcher, authority validation, and trigger guard;
16. add ownership/source tests, atomic rollback, concrete-order runtime tests,
    and save/restore coverage;
17. update authoring skills and run final whole-branch verification.

The implementation plan may refine private helper names, but it may not change
the grammar, wire shapes, parser/semantic catalog ownership, scene-family matrix,
ordered-batch semantics, complete self-excluding free-order policy, primary atom
bridge, mutation ownership, cycle policy, lattice update direction, or
compatibility decisions fixed here.