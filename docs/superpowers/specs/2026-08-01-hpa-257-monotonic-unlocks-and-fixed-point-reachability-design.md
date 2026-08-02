# HPA-257 Monotonic Unlocks and Fixed-Point Reachability Design

**Status:** Ready for review; revised after codebase alignment, self-review, and two PR-feedback passes  
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
gates. It adds a compiler-wide positive reachability analysis, ordered abstract
reveal-batch interpretation, and a conservative primary-objective analysis that
accounts for both strict sequencing and free-order exploration.

This slice delivers:

- shared parsing of `and`, `or`, parentheses, and first-class nested
  `at_least(count, ...)`;
- positive predicates for asserted facts, resolved global questions, completed
  objectives, completed qualified analysis scenes/boards, and granted
  authorizations;
- explicit story-state reveal targets delegated to HPA-255 mutations;
- one atomic/idempotent reveal pipeline shared by investigation,
  interrogation, and future scene runtimes;
- exact authored-order abstract interpretation of targets inside one reveal
  list;
- explicit authority-origin validation for authorization grants;
- normalized whole-corpus positive reachability over existing specialized scene
  analyses;
- adapter-defined strict-order and free-order execution relations;
- conservative may/must primary-objective state without exhaustive ordering
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
   story-target grammar by default in HPA-257. There is no per-file opt-in flag.
9. Linear scenes do not opt in because their current format has no unlock or
   reveal metadata.
10. HPA-257 defines analysis reference/adapter interfaces and synthetic fixtures;
    HPA-259 owns production analysis definitions and authoring.
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
25. Compiler startup validation and the Rust dispatcher both reject a primary
    `completeObjective` target before calling HPA-255.
26. Question resolution is explicit. Asserting a resolver-candidate fact does not
    automatically resolve a question.
27. Fact targets name propositions only. Scene/analysis adapters supply assertion
    origin and support materialization.
28. Current investigation/interrogation adapters provide no represented authority
    context. A `grant_authorization` target in either family is therefore a
    compile error in HPA-257.
29. HPA-264 owns the production authority-event surface. HPA-257 owns target
    parsing, runtime dispatch, authority matching, and grant-path validation.
30. Existing specialized investigation/interrogation analyzers remain
    authoritative for local gameplay semantics and guaranteed-flow results.
31. The whole-corpus layer consumes normalized outputs from those analyzers; it
    does not replace them.
32. Positive dependency self-reference and multi-node cycles are rejected
    strictly, even if an external branch could seed a member.
33. Free-order execution relations are not positive dependency edges and are not
    rejected as cycles. Mutual may-before relationships are expected in an
    exploration region.
34. Primary-objective flow is not a post-processing pass over a completed
    positive fixed point. Positive reachability and primary abstract state are
    solved together because primary completion may unlock more content.
35. Scene adapters explicitly provide strict-order predecessors and conservative
    may-execute-before relationships. The generic analyzer does not infer
    free-order behavior from graph shape alone.
36. Free-order events are one-shot. A mutual may-before relation means either
    event may run first; it never licenses abstract replay such as A -> B -> A.
37. The primary abstract domain tracks possible and guaranteed active/completed
    values. It does not enumerate every event permutation.
38. Free-order ambiguity cannot cause a dynamic order-dependent hard error unless
    invalidity is proven for all valid modeled inputs.
39. A transition that succeeds for some modeled orders and fails for others emits
    a deterministic warning and contributes effects only to the successful
    abstract paths.
40. A mandatory path that depends on an order-conditional primary effect is not
    silently accepted; its producer warning identifies the ambiguity.
41. Unknown/secondary primary targets and reserved IDs are order-independent hard
    errors.
42. A next primary that is guaranteed already completed is an always-invalid hard
    error. A next primary that may already be completed is order-dependent and
    warns.
43. Compiler primary analysis assumes a valid HPA-255 state. Corrupt states whose
    active ID is absent from objective progress remain runtime/restore errors and
    are not treated as authorable paths.
44. Existing legacy local reachability diagnostics retain their codes and
    severity.
45. Newly modeled unreachable mandatory content is an error; explicitly optional
    unreachable content is a warning.
46. Migration-origin mutations are not authored reachability producers unless a
    fixture explicitly seeds their resulting progress.
47. The story catalog schema remains version 2. HPA-257 adds validation but no
    catalog field.
48. The save schema remains version 2. HPA-257 adds no generic applied-event
    ledger; subsystem trigger progress remains authoritative.
49. `@lyra/scene-types` continues to own only the current scene-local editor
    contract. Global story mutations and hidden analysis data remain outside it.
50. HPA-257 adds no frontend component, IPC command, or production story edit.
51. TypeScript and Rust expression evaluators are separate implementations but
    must pass one semantics-parity fixture corpus.

## 3. Current repository constraints

### 3.1 Compiler

The current compiler:

- has parallel investigation/interrogation recursive-descent paths in
  `parser-unlock.ts`;
- supports binary `and`/`or` and parentheses but no threshold node;
- uses `consumeWord` with a current boundary of whitespace or parentheses, so
  comma must become a delimiter for `at_least` or the parser must switch to an
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

HPA-257's compiler models the first four author-reachable conditions. The fifth
is excluded by the valid-state invariant and remains runtime defense-in-depth.

### 3.3 Free-order gameplay

Investigation blocks are often executable in either order after entering a
location. Interrogation also contains authored choices whose runtime order is not
fully represented by a producer-to-consumer unlock graph.

Therefore this graph is insufficient by itself:

```text
entry -> hotspot_a
entry -> hotspot_b
```

If both hotspots contain primary transitions, either may precede the other at
runtime even though neither has an unlock edge to its sibling. Scene adapters
must provide that execution relationship explicitly.

### 3.4 Legacy behavior

Existing Chapter 1 content uses only legacy local predicates/targets. HPA-257
must not:

- reorder or flatten existing expression trees;
- rewrite existing reveal lists;
- change local question/phase meanings;
- change required/unreachable classification;
- change first-use versus re-examination dialogue ordering;
- change generated content revision when new syntax is unused.

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
E(state) = true  =>  E(m(state)) = true
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

The implementation plan must explicitly update comma tokenization/word-boundary
behavior and add no-whitespace comma tests.

### 5.2 Scene-family matrix

| Scene/runtime family | Story predicates | Story targets | Authority grant in HPA-257 |
|---|---|---|---|
| Investigation | enabled by default | enabled by default | parsed, then rejected because authority context is null |
| Interrogation | enabled by default | enabled by default | parsed, then rejected because authority context is null |
| Linear scene | not supported; no unlock/reveal metadata | not supported | not supported |
| Synthetic analysis fixture | enabled through analysis registry adapter | enabled through fixture adapter | allowed only when fixture registers matching authority context |
| Production analysis | HPA-259 | HPA-259 runtime integration | no institutional grant unless a later authority adapter supplies context |
| Production request/hearing | future HPA-264 adapter | future HPA-264 adapter | allowed with matching represented authority |

There is no `Enable Story Predicates` metadata flag.

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

Emitted references are structured:

```ts
type AnalysisSceneRef = {
  chapterId: string;
  sceneId: string;
};

type AnalysisBoardRef = {
  chapterId: string;
  sceneId: string;
  boardId: string;
};
```

Every segment matches `^[a-z0-9_]+$`. Missing, extra, empty, or bare local
segments fail. HPA-257 fixtures register definitions through the
`AnalysisDefinitionRegistry` hook named in §15.1; HPA-259 provides production
registrations.

### 5.6 `at_least` validation

Reject:

- zero, negative, signed, decimal, hexadecimal, or fractional counts;
- an empty child list;
- count larger than child count;
- structurally duplicate normalized children;
- malformed delimiters.

Structural equality compares emitted child trees after redundant parentheses are
removed. It does not reorder commutative children. Therefore these remain
accepted as structurally different:

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

`null` is reserved only in `set_primary_objective`. Compiler catalog validation
rejects objective heading `{#null}` at its source line; Rust rejects the same
catalog condition. Other typed namespaces may use slug `null`.

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

- Two targets with the same discriminant and identical normalized fields are
  exact duplicates and fail `duplicateStoryRevealTarget`.
- Two `assertFact` targets for the same fact are duplicates.
- Two `resolveQuestion` targets with the same question and fact are duplicates.
- Two `resolveQuestion` targets with the same question but different facts are
  conflicting and fail `conflictingQuestionResolution`.
- More than one `setPrimaryObjective` target is invalid regardless of whether
  fields are equal; exact equality reports duplicate, differing fields report
  `multiplePrimaryTransitions`.
- Different discriminants are not duplicates. For example,
  `revealObjective:X` followed by `completeObjective:X` is interpreted in order.
- Existing local-target duplicate behavior is unchanged.

### 7.5 Context-free validation

Before reachability:

- resolve every target definition;
- validate question resolver membership in `resolvedByFactIds`;
- validate non-null set-primary target kind;
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

Inside one command transaction, the runtime:

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

The secondary-objective check is repeated in Rust even though HPA-255's internal
`complete_objective` can complete a primary. Authored resources intentionally use
a narrower contract than the internal mutation API.

### 8.3 Authority context

A grant requires:

1. an authorization definition;
2. a non-null represented authority supplied by a registered adapter;
3. equality with `grantingAuthority`;
4. a valid assertion origin.

Investigation and interrogation supply `representedAuthority = null` in
HPA-257. Therefore every grant target in those families fails compilation and
runtime startup validation. Synthetic fixtures may register authority context;
production authority events arrive with HPA-264.

Migration APIs may call HPA-255 directly. Migration progress is not an authored
producer in static analysis unless explicitly included in fixture seeds.

### 8.4 Atomicity

Target methods may validate/mutate one effect at a time, but command-level
rollback owns batch atomicity. A failure on the final target restores:

- trigger progress;
- local scene progress/overrides;
- inventory and acquisition events;
- story facts/questions/objectives/authorizations;
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

Evaluation is side-effect-free and may short-circuit.

A shared fixture corpus is evaluated by TypeScript and Rust against identical
truth assignments. Expected Boolean results must match for legacy predicates,
story predicates, nesting, thresholds, and mixed combinators.

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
  initiallyReachable: boolean;
  condition: PositiveExpression<ReachabilityPredicate> | null;
  implicitPrerequisites: ReachabilityPredicate[];
  effects: ReachabilityEffect[]; // authored order retained
  representedAuthority: string | null;

  // Runtime ordering supplied by the scene adapter.
  strictPredecessorKeys: string[];
  mayExecuteBeforeKeys: string[];
  freeOrderRegionId: string | null;

  sourceFile: string;
  line: number;
};
```

`strictPredecessorKeys` means the predecessor must execute/complete before this
node on every runtime path represented by the adapter.

`mayExecuteBeforeKeys` is a conservative superset of other one-shot nodes that
can execute before this node on at least one legal path/order. It excludes the
node itself, includes strict predecessors and eligible free-order peers, and is
interpreted as an ordering relation—not as permission to replay a member.

A compact region representation is allowed internally, but normalized tests
assert the same relation.

`freeOrderRegionId` groups mutually orderable exploration events for diagnostics
and fixture readability. Membership alone does not imply every pair is
orderable; the adapter's may-before relation is authoritative.

### 10.3 Edge ownership

Primary-flow ordering uses four distinct sources:

1. **Strict scene/chapter sequencing** supplied by adapters, including earlier
   scene completion before later scene entry.
2. **Positive prerequisite producers** that can satisfy unlock conditions or
   implicit prerequisites.
3. **Free-order may-before pairs** supplied by specialized adapters for events
   that players can execute in either order.
4. **Authored target order inside one node**, handled locally by §11.4 and not
   represented as inter-node edges.

The generic analyzer must not infer free-order siblings merely because two nodes
share an entry predecessor. Investigation/interrogation adapters know their
runtime navigation and provide the relation.

Positive dependency SCC validation uses prerequisite edges only. It does not run
on mutual free-order may-before pairs.

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

A primary transition may complete an objective; that objective may unlock a new
node; that node may produce another primary transition. Therefore the compiler
cannot finish positive reachability first and run primary flow only afterward.

The implementation solves a finite joint abstract state until stable.

### 11.2 Per-node abstract state

```ts
type PrimaryCandidate = string | null;
type KnownPrimary = PrimaryCandidate | "unknown";

type NodeAbstractState = {
  mayAtoms: Set<ReachabilityAtom>;
  mustAtoms: Set<ReachabilityAtom>;

  mayActivePrimaryIds: Set<PrimaryCandidate>;
  mustActivePrimaryId: KnownPrimary;
  mayCompletedPrimaryIds: Set<string>;
  mustCompletedPrimaryIds: Set<string>;

  orderAmbiguous: boolean;
};
```

Meaning:

- `may*` contains every value/progress the analysis conservatively believes can
  occur before the node on some modeled path/order.
- `must*` contains only values/progress guaranteed before the node on every
  modeled path/order represented by strict predecessors.
- free-order peer effects contribute to `may*`, not `must*`, unless the adapter
  also marks a strict relation.
- `mustActivePrimaryId` is a concrete value only when all strict inputs agree and
  no may-before primary transition can intervene; otherwise it is `unknown`.

The domain is path-insensitive but not corpus-global. Unrelated nodes that cannot
execute before this node do not contribute.

### 11.3 Free-order policy and one-shot region summaries

HPA-257 chooses a conservative hybrid of over-approximation and narrowed hard
claims:

1. Scene adapters include every other primary transition that may execute earlier
   in `mayExecuteBeforeKeys`, including free-order peers.
2. A free-order region is summarized as one-shot member possibilities. For a
   node N, the summary may include effects from a subset of other members that
   can legally precede N; N's own output never feeds back into N through a
   mutual relation.
3. The analyzer does not traverse mutual may-before pairs as an executable cycle
   and does not model A -> B -> A. Each trigger/event appears at most once in a
   modeled ordering.
4. Positive prerequisite edges inside a region still establish strict order. If
   B requires an atom produced by A, A -> B is handled as a prerequisite, not as
   an unconstrained peer permutation.
5. When exact correlation among several independent members would require
   enumerating permutations, the region summary widens `may*`, clears affected
   `must*`, marks `orderAmbiguous`, and emits/propagates the ordering warning.
6. Free-order peer effects never establish `mustActive` or `mustCompleted` by
   themselves.
7. A hard dynamic error is emitted only when invalidity follows from catalog
   facts plus `must*` state and no modeled valid input remains.
8. Effects from at least one modeled successful order may contribute to positive
   may-reachability; the warning remains attached to the producer and is included
   in mandatory-path diagnostics.

This preserves free exploration without pretending to prove all permutations.
It also prevents both the earlier under-approximation—where sibling hotspot A
could change the active primary before B but B saw only scene entry—and the
opposite replay bug where mutual may-before relations would execute a one-shot
trigger twice.

Authors are encouraged—but not required—to linearize primary transitions. A
primary transition in a free-order region is acceptable when its order-dependent
behavior is intentional and reviewed.

### 11.4 Ordered reveal-batch simulation

For each reachable node, the analyzer creates a provisional copy of its input
abstract state and interprets targets in authored list order.

Rules:

1. Earlier target effects are immediately visible to later targets in the same
   provisional batch.
2. An implicit prerequisite may be satisfied by input state or an earlier target.
3. A target that is impossible for every modeled provisional input makes the
   complete batch always invalid.
4. A target that succeeds for some inputs and fails for others makes the batch
   order-dependent.
5. Provisional effects are committed to the node output only after at least one
   modeled input completes the entire list.
6. If no input completes, no target from the list contributes an atom or primary
   output, mirroring runtime rollback.
7. After a may-fail target, later `must*` outputs are retained only when they hold
   on every surviving successful abstract input.

Therefore:

```text
[resolve_question:q@f, assert_fact:f]
```

is always invalid when `f` is not already available before the node, while:

```text
[assert_fact:f, resolve_question:q@f]
```

is valid because the first target satisfies the second target's prerequisite.

Diagnostics:

- no modeled input completes the batch:
  `storyRevealBatchAlwaysInvalid` error;
- some inputs complete and some fail:
  `storyRevealBatchOrderDependent` warning.

A reachable optional node is not exempt from an always-invalid batch: executing
it would still fail at runtime. An unreachable optional node receives its normal
unreachable warning and is not used to derive dynamic batch conclusions.

### 11.5 Positive expression may/must evaluation

For each expression `E`:

- `mayTrue(E)` asks whether `E` can be true using may-atoms;
- `mustTrue(E)` asks whether `E` is true using must-atoms.

For binary nodes, apply normal Boolean rules. For `at_least(n, children)`:

- may-true when at least `n` children are may-true;
- must-true when at least `n` children are must-true.

Node may-reachability uses may-true. Existing specialized guaranteed-flow
analysis remains authoritative where all-path proof is required.

### 11.6 Primary transfer: no transition

A node without `setPrimaryObjective` passes primary abstract state through. Its
other ordered targets may still add completed-secondary atoms.

### 11.7 Primary transfer: `completeCurrent = false`

For `setPrimaryObjective(false, X)`:

Order-independent validation first ensures `X` is null or an existing primary.

Dynamic cases:

- non-null `X` in `mustCompletedPrimaryIds`:
  `primaryObjectiveTransitionAlwaysInvalid`; no successful output;
- non-null `X` in `mayCompletedPrimaryIds` but not must-completed:
  `primaryObjectiveOrderingNotExhaustive`; successful abstract paths produce
  active `X`;
- otherwise: successful paths produce active `X`.

A non-null successful next target also produces internal
`objective_revealed:X`.

### 11.8 Primary transfer: `completeCurrent = true`

For `setPrimaryObjective(true, X)`, an input is invalid when:

- non-null next `X` is already completed on that input; or
- current active is the same non-null `X`.

Compiler classification:

- `X` in must-completed, or concrete `mustActive == X`:
  always invalid hard error;
- `X` in may-completed but not must-completed, or `mayActive` contains `X` while
  another valid current candidate/null is possible:
  ordering warning;
- only valid candidates:
  no transition warning.

On successful abstract paths:

- each possible non-null current ID other than `X` becomes may-completed;
- an ID becomes must-completed only when every surviving successful input has
  that same current ID;
- output active becomes `X`, including null;
- non-null `X` becomes revealed.

The analysis does not credit outputs from invalid candidates.

### 11.9 Valid-state assumption

The compiler does not model an active ID absent from objective progress. Such a
state cannot be authored through HPA-255's valid mutation sequence. Runtime
mutation, snapshot restore, and catalog/state validation retain defense-in-depth
for corrupt or hand-edited state.

### 11.10 Outer fixed point and convergence

Conceptually:

```text
initialize seed node states

repeat
  recompute node input may/must summaries from:
    strict predecessors,
    positive prerequisite producers,
    one-shot adapter-provided free-order region summaries,
    current successful node outputs

  mark nodes whose conditions/prerequisites are may-satisfiable

  for each newly reachable or changed-input node:
    simulate its complete ordered reveal batch provisionally
    publish successful may/must positive and primary outputs

until the product-lattice state is unchanged
```

The finite domains are:

- parsed node keys;
- finite positive atoms;
- finite objective IDs plus null;
- finite may/must membership bits;
- finite concrete-or-unknown active values.

Convergence uses the normal product order:

- `may*` sets grow by inclusion;
- `must*` sets shrink by reverse inclusion as additional paths/orders are found;
- concrete `mustActive` may degrade to `unknown` and never becomes concrete again
  within the same analysis run;
- reachable-node membership only grows.

Every component has finite height. The one-shot region summary prevents a mutual
may-before relation from creating an unbounded event-replay sequence. No authored
iteration cap is required.

### 11.11 Mandatory-path reporting under ambiguity

The fixed point is existence-oriented. If a mandatory consumer becomes reachable
only through a producer carrying `storyRevealBatchOrderDependent` or
`primaryObjectiveOrderingNotExhaustive`, compilation succeeds with the warning;
the warning message lists the mandatory consumer(s) relying on that conditional
output.

HPA-257 does not claim every free-order execution succeeds. It does guarantee
that order ambiguity is not silent and that hard always-invalid claims are made
only when supported by the abstract `must*` state.

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

An external seed does not legalize the dependency cycle.

### 12.3 Free-order relation is separate

Mutual `mayExecuteBeforeKeys` pairs are execution-order possibilities, not
positive prerequisites. They may be symmetric, are summarized as one-shot region
possibilities, and must not trigger `positiveDependencyCycle`.

### 12.4 Diagnostics

Emit one canonical cycle diagnostic per SCC with a stable minimal path. Suppress
duplicate generic reachability errors where a legacy specialized validator has
already reported the same block.

## 13. Mandatory, optional, and authorization reachability

### 13.1 Classification

Adapters classify:

- existing entry/completion according to current specialized semantics;
- existing locked investigation/interrogation blocks with current error behavior;
- future required analysis nodes as mandatory;
- future side content as optional;
- grant outputs required by mandatory consumers as mandatory producers.

Catalog definitions alone are not gameplay nodes.

### 13.2 Post-convergence diagnostics

- unreachable new mandatory node: `requiredContentUnreachable` error;
- unreachable optional node: `optionalContentUnreachable` warning;
- mandatory authorization with no reachable matching grant:
  `mandatoryAuthorizationUnreachable` error;
- reachable batch with no successful abstract input:
  `storyRevealBatchAlwaysInvalid` error;
- order-conditional batch/primary transition: deterministic warning;
- unsatisfied semantic references/kinds: source-located hard error regardless of
  optionality.

### 13.3 Authorization path

For a mandatory `authorization:<id> granted` condition, verify:

1. definition exists;
2. a grant producer exists;
3. producer's represented authority matches `grantingAuthority`;
4. at least one matching producer is reachable.

Investigation/interrogation grant targets are not candidates because their
adapter authority context is null.

## 14. Validation and diagnostic contract

### 14.1 Reference validation

Validate typed references against:

- `StoryCatalog.facts`;
- `StoryCatalog.questions`;
- `StoryCatalog.objectives`;
- `StoryCatalog.authorizations`;
- `AnalysisDefinitionRegistry` for qualified analysis refs.

Typed namespaces may reuse a slug except objective ID `null`, which is reserved.

### 14.2 New/reserved diagnostic codes

| Code | Severity | Meaning |
|---|---|---|
| `unlockAtLeastInvalidCount` | error | count is not a positive base-10 integer |
| `unlockAtLeastEmptyConditions` | error | no child expression |
| `unlockAtLeastCountExceedsConditions` | error | count exceeds child count |
| `unlockAtLeastDuplicateCondition` | error | structurally duplicate child |
| `unresolvedStoryPredicate` | error | typed story predicate reference missing |
| `unresolvedAnalysisPredicate` | error | qualified analysis reference missing |
| `storyRevealUnresolved` | error | story target reference missing |
| `reservedObjectiveId` | error | objective ID `null` is reserved |
| `invalidQuestionResolutionTarget` | error | fact cannot resolve named question |
| `primaryObjectiveCompletionRequiresSet` | error | authored complete target names primary |
| `invalidPrimaryObjectiveTarget` | error | next target missing or secondary |
| `duplicateStoryRevealTarget` | error | exact normalized duplicate |
| `conflictingQuestionResolution` | error | one question has different resolvers in one batch |
| `multiplePrimaryTransitions` | error | batch contains multiple set-primary targets |
| `authorizationGrantOutsideAuthorityEvent` | error | represented authority absent |
| `authorizationGrantAuthorityMismatch` | error | represented authority differs from definition |
| `storyRevealBatchAlwaysInvalid` | error | no modeled input completes ordered batch |
| `storyRevealBatchOrderDependent` | warning | some modeled inputs complete and some fail |
| `primaryObjectiveTransitionAlwaysInvalid` | error | transition invalid for all modeled inputs |
| `primaryObjectiveOrderingNotExhaustive` | warning | free/branch order can change transition validity |
| `positiveSelfReference` | error | effect/condition depends on itself |
| `positiveDependencyCycle` | error | positive prerequisite SCC |
| `requiredContentUnreachable` | error | mandatory node not reached |
| `mandatoryAuthorizationUnreachable` | error | required grant path missing |
| `optionalContentUnreachable` | warning | optional node not reached |

Legacy codes remain unchanged where they already cover the same local condition.

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
  parser-story-catalog.ts           # existing catalog parser/validation owner
  analysis-definition-registry.ts   # narrow HPA-257 synthetic/production hook
  validator.ts                      # retains specialized validation
  reachability.ts                   # normalized nodes, SCCs, joint fixed point
  emitter.ts
```

Exact private filenames may be refined by the implementation plan, but the plan
must use the existing `parser-story-catalog.ts` name rather than introducing a
parallel `story-catalog.ts` parser.

`AnalysisDefinitionRegistry` minimally resolves qualified scene/board refs and
exposes fixture registration. It contains no hidden production solution data;
HPA-259 owns production population.

### 15.2 Adapter contract

Investigation/interrogation adapters must expose:

- normalized local conditions/effects;
- mandatory/optional classification;
- possible and guaranteed local outputs already computed by specialized logic;
- strict predecessor keys;
- conservative may-execute-before keys/free-order region identity;
- one-shot member identity so region summaries cannot replay a trigger;
- represented authority, currently null;
- source file/line and stable target indexes.

Two adapter implementations presented the same scene AST must emit deterministic
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
- matching-revision recapture must reproduce the same public state;
- consumed triggers remain consumed after restore.

### 16.2 Content identity

Legacy content emits byte-identical resources and keeps its content revision.
Using a new expression or target naturally changes emitted resources and package
content revision through the existing manifest algorithm.

### 16.3 Round-trip fixture

A synthetic integration path must:

1. collect evidence;
2. assert a fact;
3. resolve a question;
4. complete a secondary objective;
5. execute valid and order-conditional primary transitions;
6. grant authorization from a matching synthetic authority event;
7. unlock later content through nested `at_least`;
8. save/restart/load;
9. preserve positive progress, active objective, trigger consumption, and
   unlocked content;
10. repeat the original command and prove no redispatch.

No previously unlocked block may become locked after restore.

## 17. Test strategy

### 17.1 Legacy characterization

- snapshot every current valid expression/tree;
- prove current associativity and precedence;
- compile existing Chapter 1 unchanged;
- assert existing reveal arrays/dialogue ordering unchanged;
- assert content revision unchanged when new syntax is unused.

### 17.2 Parser and `at_least`

Cover:

- no-whitespace commas;
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
- mandatory consumer dependency is named by the producer warning;
- exact duplicate/conflict target rules.

### 17.5 Free-order primary behavior

Synthetic investigation fixture: two initially available hotspots in one
free-order region.

Cover both runtime orders for:

1. hotspot A sets primary A; hotspot B completes current and sets B;
2. hotspot A sets primary A; hotspot B completes current and sets A;
3. hotspot A completes A; hotspot B later attempts to set A;
4. B before A and A before B;
5. a strict dependency edge A -> B turning a may condition into must state;
6. two unrelated regions not contaminating each other's candidate sets;
7. mutual may-before pairs never feed A's output back into A or model A -> B -> A;
8. three free-order one-shot members widen to an ambiguity warning without
   enumerating permutations.

Expected diagnostics:

- free-order valid/invalid mix: warning, never false always-invalid error;
- strict same-current/next: always-invalid error;
- strict completed-next: always-invalid error;
- free-order maybe-completed next: warning;
- unrelated disjoint branch: no warning.

### 17.6 Positive reachability

Cover:

- multi-iteration evidence -> fact -> question -> objective -> grant chain;
- threshold branches contributing across iterations;
- direct self-reference and longer SCCs;
- externally seeded dependency cycle still rejected;
- unreachable mandatory and optional nodes;
- authority producer absent, mismatched, unreachable, and reachable;
- no duplicate legacy/generic diagnostics.

### 17.7 Runtime defense and ownership

- Rust rejects primary `completeObjective` at resource validation and dispatcher;
- unknown/secondary/completed next primary follows HPA-255 behavior;
- corrupt active-without-progress remains a runtime/restore error fixture, not a
  compiler authoring state;
- mixed-batch final failure rolls back every transaction field;
- repeated gameplay command skips consumed trigger;
- source test proves dispatcher calls `set_primary_objective` and contains no
  direct writes to objective maps/active field.

### 17.8 TypeScript/Rust semantic parity

One serialized fixture corpus provides expression trees, truth assignments, and
expected results. Both implementations run it. Include legacy nodes, every story
predicate, nested `at_least`, mixed operators, and short-circuit-equivalent cases.

### 17.9 Verification gate

Implementation PR must pass:

- `bun run scenes:compile`;
- complete compiler/workspace tests;
- complete Rust tests;
- TypeScript/Svelte/Rust checks;
- ESLint, Prettier, rustfmt, and warnings-denied Clippy;
- content-revision goldens;
- targeted save/restore integration.

Packaged Tauri E2E is required only if implementation changes an existing
player-visible authored path or command timing; the implementation plan must make
that decision explicitly.

## 18. Authoring guidance changes

Update:

- `.claude/skills/writing-investigation-scene/SKILL.md`;
- `.claude/skills/writing-interrogation-scene/SKILL.md`;
- the future HPA-259 analysis skill.

Guidance must include:

- exact story predicates/targets and scene-family matrix;
- qualified analysis reference syntax;
- comma-safe `at_least` examples and invalid counts;
- no generic negative gates;
- reserved objective ID `null`;
- objective revealed is not an author predicate;
- primary completion only through set-primary;
- ordered target-list semantics and atomic rollback;
- one-shot trigger ownership;
- investigation/interrogation cannot grant authorization;
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

Rejected because trigger-level idempotence preserves HPA-255's valid rejection
rules without objective-history heuristics.

### 19.6 Treat reveal targets inside one list as an unordered set

Rejected because runtime is authored-order sensitive and atomic. Static analysis
must interpret the same sequence provisionally.

### 19.7 Primary flow from unlock dependencies only

Rejected because free-order siblings can execute before one another without an
unlock edge. Adapters must expose runtime ordering.

### 19.8 Traverse mutual may-before pairs as a normal graph cycle

Rejected because it replays one-shot events abstractly and can invent A -> B -> A.
Free-order regions use one-shot summaries instead.

### 19.9 Require total linearization of all primary transitions

Rejected because it would unnecessarily remove investigation freedom. The
chosen may/must analysis warns on order dependence and hard-fails only proven
invalid transitions.

### 19.10 Exhaustive objective-order state-space search

Rejected because the parent contract explicitly excludes exhaustive ordering
proof. HPA-257 uses finite path-insensitive may/must summaries.

### 19.11 Corpus-global possible-primary set

Rejected because unrelated branches polluted warnings and did not model local
runtime ordering accurately.

### 19.12 Compiler-only primary `completeObjective` restriction

Rejected because hand-edited resources could invoke HPA-255's broader internal
API. Rust repeats the authored-contract check.

### 19.13 Replace specialized scene analysis

Rejected because existing validators encode stronger gameplay-specific facts.

### 19.14 Generic applied-event ledger or save bump

Rejected because subsystem trigger progress already owns replay state.

## 20. Acceptance-criteria mapping

| HPA-257 requirement | Design mechanism |
|---|---|
| Legacy unlock behavior unchanged | §§3.4, 6, 17.1 |
| Positive fact/question/objective/analysis/grant predicates | §§5–6 |
| Nested `at_least` and invalid counts | §§5.1, 5.6, 17.2 |
| Atomic/idempotent reveal dispatch | §§8, 11.4, 17.4/17.7 |
| HPA-255 owns primary transitions | §§2, 8.2, 17.7 |
| Fixed point accounts for `setPrimaryObjective` | §11 joint analysis |
| No exhaustive ordering claim | §§11.3, 11.11, 19.10 |
| Free-order investigation represented | §§10.2–10.3, 11.3, 17.5 |
| Invalid refs/counts/self-reference/cycles fail with locations | §§5, 12, 14 |
| Required unreachable paths fail | §13 |
| Authority gates need matching grant path | §§8.3, 13.3 |
| No relock after mutation/save | §§4.1, 16.3 |
| Compiler/Rust semantics remain aligned | §§9, 17.8 |

## 21. Implementation-plan handoff

The implementation plan must use small TDD slices and name exact current files.
At minimum:

1. characterize legacy parser/emission/runtime behavior;
2. extract shared combinator parser and fix comma delimiter handling;
3. add `at_least` types/emission/Rust serde/parity fixtures;
4. add shared story predicates and typed reference validation;
5. add story target parser, duplicate/conflict rules, and scene-family matrix;
6. add reserved objective ID and Rust authored-target defense;
7. define `AnalysisDefinitionRegistry` and normalized scene adapters;
8. expose strict/may-before ordering and one-shot region identity from
   investigation/interrogation analyses;
9. implement ordered provisional batch simulation and diagnostics;
10. implement joint positive/primary may/must fixed point with one-shot region
    summaries;
11. add free-order, strict-order, completed-next, no-replay, and disjoint-region
    fixtures;
12. integrate runtime dispatcher, authority validation, and trigger guard;
13. add ownership/source tests, atomic rollback, and save/restore coverage;
14. update authoring skills and run final whole-branch verification.

The implementation plan may refine private helper names, but it may not change
the grammar, wire shapes, scene-family matrix, ordered-batch semantics,
free-order one-shot policy, mutation ownership, cycle policy, or compatibility
decisions fixed here.
