# HPA-257 Monotonic Unlocks and Fixed-Point Reachability Design

**Status:** Ready for review; revised after codebase alignment, self-review, and PR feedback  
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
- the merged HPA-258 Case File, active-objective HUD, and save-recap work.

HPA-257 extends Lyra's existing positive unlock grammar and reveal pipeline so
content can depend on durable story state without introducing mutable negative
gates. It also adds compiler-wide positive fixed-point analysis that proves
mandatory progression has an authored path and identifies optional dead content.

This slice delivers:

- shared parsing of `and`, `or`, parentheses, and `at_least`;
- positive predicates for asserted facts, resolved global questions, completed
  objectives, completed qualified analysis scenes/boards, and granted
  authorizations;
- source-located validation of every new reference and count;
- story-state reveal targets materialized through HPA-255 mutations;
- one atomic/idempotent reveal pipeline shared by existing and future scene
  runtimes;
- explicit authority-origin validation for authorization grants;
- a normalized whole-corpus reachability graph and finite positive fixed point;
- a separate per-node primary-objective abstract dataflow over the acyclic
  dependency graph;
- required-content errors and optional-content warnings;
- strict self-reference and positive dependency-cycle rejection;
- compiler, Rust, source-boundary, compatibility, and save/restore tests.

It does not add analysis-scene Markdown, analysis runtime/UI, request-denial
mechanics, production story-state content, generic flags, arbitrary negation,
revocation, frontend progression logic, or exhaustive objective-order model
checking.

## 2. Approved decisions

1. Ordinary authored progression remains positive and monotonic. Once a block
   becomes visible or unlocked, no supported mutation can hide or re-lock it.
2. The language does not add generic `not`, inequality, absence predicates,
   mutable negative flags, or active-primary-objective predicates.
3. Existing investigation and interrogation expression strings compile to the
   same JSON trees and retain the same runtime meaning.
4. `and` continues to bind more tightly than `or`; parentheses continue to
   override precedence.
5. `at_least(count, conditions...)` is a first-class n-ary expression node and
   is not expanded into combinations of binary `and`/`or` nodes.
6. `at_least` requires a positive base-10 integer count, a non-empty condition
   list, and `count <= conditions.length`.
7. Structurally duplicate child conditions inside one `at_least` are invalid;
   one true condition cannot be authored twice to inflate the threshold.
8. Nested `at_least`, `and`, `or`, and parentheses are supported in every unlock
   context.
9. The compiler shares combinator parsing internally but preserves separate
   context-specific predicate unions. A predicate valid in one scene family is
   not automatically valid in every scene family.
10. Durable fact, global-question, objective, and authorization references use
    game-global catalog IDs.
11. Analysis scene and board completion references are always qualified. The
    authoring form uses `@` separators and the emitted form uses structured
    chapter/scene/board fields.
12. HPA-257 defines qualified analysis reference types and registry interfaces;
    HPA-259 supplies production analysis definitions and completes their
    referential validation.
13. Existing `question:<id> answered` remains the interrogation-local predicate.
    The new global predicate is `question:<id> resolved`.
14. Existing scene-local reveal target syntax remains valid without migration.
15. New story reveal targets use explicit mutation-oriented prefixes such as
    `assert_fact:` and `grant_authorization:`.
16. An authored reveal batch is ordered for deterministic runtime processing but
    becomes externally visible only after the whole command commits.
17. Unlock conditions are re-evaluated after the reveal transaction, not between
    individual targets in the same list.
18. Runtime atomicity is owned by the existing `EngineRollbackSnapshot` command
    transaction. Any failed target restores all rollback-tracked state.
19. Runtime idempotence is composed from durable one-shot trigger state,
    inventory/local-set behavior, and HPA-255's
    `MutationOutcome::Changed | Unchanged` results.
20. A reveal list is dispatched only when its owning trigger transitions from
    not-consumed to consumed/completed. Re-examination, re-entry, repeated
    correct submission, or repeated command delivery does not invoke the list a
    second time.
21. HPA-255 remains the sole owner of every story-state mutation.
22. HPA-257's dispatcher calls `StoryState::set_primary_objective`; it never
    writes objective progress or `active_primary_objective_id` directly.
23. HPA-257 does not weaken HPA-255's rejection of
    `completeCurrent: true` when the current and next primary are identical. The
    one-shot trigger guard prevents an already-committed transition from being
    re-invoked as a replay.
24. Authored `complete_objective` may target only secondary objectives. Primary
    completion is expressed through `set_primary_objective` with
    `completeCurrent: true`.
25. `reveal_objective` may reveal either objective kind without activating it.
26. `set_primary_objective` accepts a primary objective ID or the reserved
    literal `null`, plus an optional `complete_current` marker.
27. Objective ID `null` is reserved and invalid in `story_catalog.md`. Compiler
    and Rust catalog validation reject it so the clear-primary literal cannot
    shadow a real objective.
28. Question resolution is explicit. Asserting a candidate fact does not
    automatically resolve questions that list it.
29. An `assert_fact` target carries the fact intent only. The caller supplies
    assertion origin and context-derived supporting records/facts.
30. Existing investigation/interrogation scene-event assertions may use empty
    support. Analysis templates may impose stronger support rules.
31. Authorization grants require a represented authority context whose identity
    matches the definition's `grantingAuthority`.
32. Current investigation/interrogation blocks do not implicitly represent an
    authority. HPA-264 owns the production request/hearing surface.
33. Reachability is a finite, positive, existence-oriented may-analysis: it asks
    whether at least one authored positive path can reach content.
34. Existing investigation/interrogation specialized analyzers remain
    authoritative for contradiction availability, forced optional phases,
    guaranteed inventory intersections, and outro completion.
35. The whole-corpus layer consumes normalized outputs from those analyzers; it
    does not reimplement them.
36. Direct self-reference and multi-node positive dependency cycles are rejected
    strictly, even if a separate branch could seed one member.
37. Existing legacy scene-local reachability errors retain their current error
    behavior and codes.
38. Newly modeled optional content produces a warning when unreachable;
    mandatory content produces an error.
39. A mandatory authorization requirement with no reachable matching authority
    grant is an error.
40. The compiler does not claim exhaustive proof of every possible ordering of
    `setPrimaryObjective` events.
41. Primary-objective analysis is a per-node, path-insensitive finite dataflow.
    Candidate primaries are propagated only along dependency paths that can feed
    the node, rather than through one corpus-global candidate set.
42. At real merge points, candidate sets are unioned without retaining complete
    path correlation. Ambiguous completion therefore remains conservative and
    is surfaced as a warning.
43. Runtime uniqueness remains structural through HPA-255's single
    `activePrimaryObjectiveId` scalar.
44. The story catalog schema remains version 2; reserving one semantic objective
    ID does not add or remove a wire field.
45. The save schema remains version 2. HPA-257 adds no generic reveal-event
    ledger; one-shot ownership stays in subsystem progress state.
46. Existing authored chapters require no migration and emit byte-identical
    unlock/reveal JSON where they do not opt into new syntax.
47. `@lyra/scene-types` does not gain global story definitions, hidden analysis
    data, or the whole story reveal union.
48. HPA-257 adds no frontend component or IPC command.
49. No production `story_catalog.md` or Chapter 1 story file is changed in this
    slice.

## 3. Current repository constraints

### 3.1 Compiler

The current compiler:

- parses investigation and interrogation unlock expressions through parallel
  recursive-descent paths in `parser-unlock.ts`;
- supports binary `and`/`or`, parentheses, and context-specific predicates;
- models investigation and interrogation expressions as separate recursive
  unions in `types.ts`;
- parses reveal lists independently in investigation and interrogation parsers;
- validates scene-local references and global evidence/statement IDs in
  `validator.ts`;
- contains specialized fixed-point logic for investigation block reachability,
  guaranteed inventory, interrogation completion, contradiction availability,
  and forced optional phases;
- already has a non-blocking warning channel;
- emits generated scene JSON without a standalone scene-schema version;
- computes package content identity from canonical emitted resources.

HPA-257 closes three duplication risks without erasing scene-local scope:

1. combinator parsing is duplicated between scene families;
2. expression evaluation is duplicated in compiler helpers and Rust evaluators;
3. reveal application is split between investigation and interrogation paths.

### 3.2 Runtime

The current runtime:

- mirrors the two expression trees in `game/schema.rs`;
- evaluates them through separate traits/functions in `game/unlock.rs`;
- applies scene reveals in `game/reveals.rs`;
- owns command rollback through the extracted transaction seam;
- owns inventory acquisition and durable acquisition events through the shared
  acquisition context;
- owns sparse durable story state and the active-primary scalar in `game/story/`;
- exposes HPA-255 mutation methods only inside `crate::game`;
- persists story state, scene progress, inventory, dialogue, and acquisitions
  through the existing save system.

`StoryState` fields are not a public mutation surface for `game/reveals.rs`.
Rust module privacy and an explicit source-level test protect that boundary.

### 3.3 Existing scene behavior

Existing Chapter 1 content uses only legacy local predicates and targets. Its
compiled expression/reveal JSON is a compatibility golden. HPA-257 must not:

- reorder or flatten existing binary expression nodes;
- rewrite legacy reveal lists;
- change the meaning of `question answered` or `phase completed`;
- change which existing blocks are required or unreachable;
- change existing dialogue/acquisition ordering.

## 4. Goals and invariants

### 4.1 Positive monotonicity

Every author-visible predicate observes state that can move only from false to
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
- analysis board completed;
- analysis scene completed;
- authorization granted.

`setPrimaryObjective` may replace or clear the active scalar, but active state is
not an unlock predicate. It may reveal a next objective and complete the current
objective; neither removes positive progress.

For every supported expression `E` and valid authored mutation `m`:

```text
E(state) = true  ⇒  E(m(state)) = true
```

### 4.2 Definitions, progress, and effects remain separate

- Catalog and scene files define IDs, copy, expressions, and effects.
- Runtime state stores acquired/revealed/completed/granted progress only.
- Unlock expressions inspect progress and never mutate it.
- Reveal targets describe effects without copying catalog prose.
- Saves store stable IDs and progress, not expression source text.

### 4.3 One mutation owner

The reveal layer resolves targets and supplies context, while mutation semantics
remain owned by:

- `Inventory`/`AcquisitionCtx` for evidence and statements;
- scene-state methods for local visibility/completion;
- HPA-255 `StoryState` methods for story targets.

No second fact, question, objective, or authorization state machine is added.

## 5. Positive expression authoring grammar

### 5.1 Grammar

The shared parser recognizes this grammar, parameterized by the allowed
predicate set:

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

The comma after `count` and at least one child expression are required.
Whitespace may appear around delimiters and operators. `at_least(...)` is an
atom; each child is a full expression.

### 5.2 Legacy predicates

Investigation continues to allow:

```text
evidence:<id> collected
statement:<id> acquired
topic:<character_id>@<topic_id> discussed
hotspot:<id> investigated
```

Interrogation continues to allow:

```text
evidence:<id> collected
statement:<id> acquired
question:<local_question_id> answered
phase:<local_phase_id> completed
```

### 5.3 Shared story predicates

A scene family that opts into the shared story set may use:

```text
fact:<id> asserted
question:<id> resolved
objective:<id> completed
authorization:<id> granted
analysis_scene:<chapter_id>@<scene_id> completed
analysis_board:<chapter_id>@<scene_id>@<board_id> completed
```

Examples:

```text
fact:door_timeline_conflict asserted and
objective:prepare_narrow_lock_request completed

at_least(
  2,
  fact:door_timeline_conflict asserted,
  question:who_entered_first resolved,
  authorization:narrow_lock_export granted
)

at_least(
  2,
  fact:a asserted,
  (fact:b asserted or fact:c asserted),
  at_least(
    1,
    objective:request_ready completed,
    authorization:limited_export granted
  )
)
```

### 5.4 Qualified analysis references

Authoring uses slug segments separated by `@`:

```text
analysis_scene:chapter_1@analysis_scene_8_5 completed
analysis_board:chapter_1@analysis_scene_8_5@source_board completed
```

Emitted values are structured:

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

Every segment uses `^[a-z0-9_]+$`. Missing, extra, empty, or bare local segments
are errors. Until HPA-259 registers production definitions, a production
analysis predicate is unresolved; synthetic HPA-257 fixtures register qualified
definitions directly.

### 5.5 `at_least` validation and meaning

The compiler rejects:

- count `0`;
- negative, signed, decimal, hexadecimal, or fractional counts;
- an empty condition list;
- count larger than the child count;
- structurally duplicate normalized child expressions;
- missing commas or closing parentheses.

Structural duplicate means equality of emitted child trees after redundant
parentheses are removed. The compiler deliberately does not reorder commutative
`and`/`or` children or prove general Boolean equivalence. Therefore these are
structurally different and remain accepted:

```text
(fact:a asserted or fact:b asserted)
(fact:b asserted or fact:a asserted)
```

This tradeoff avoids a Boolean-normalization subsystem. It catches the common
accidental duplicate while permitting semantically overlapping expressions.
Runtime counts child positions whose expressions evaluate true.

Valid edges include:

```text
at_least(1, fact:a asserted)
at_least(3, fact:a asserted, fact:b asserted, fact:c asserted)
```

### 5.6 No negative forms

These remain invalid:

```text
not fact:a asserted
fact:a not asserted
objective:a incomplete
authorization:a missing
active_primary_objective:a
```

Temporary presentation state, active selection, the current primary, and absence
are not authored unlock conditions.

## 6. Compiler and wire expression model

### 6.1 Compiler-internal generic core

The compiler may use:

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

Concrete context unions remain separate:

```ts
type InvestigationUnlockExpr = PositiveExpression<
  InvestigationLocalPredicate | StoryPredicate
>;

type InterrogationUnlockExpr = PositiveExpression<
  InterrogationLocalPredicate | StoryPredicate
>;
```

The generic is compiler-internal; it does not require generic published wire
types or movement into `@lyra/scene-types`.

### 6.2 Emitted JSON

Legacy binary nodes remain byte-identical. The new n-ary node is:

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

New predicate shapes are:

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

### 6.3 Rust schema and startup validation

Rust keeps concrete investigation/interrogation enums so serde rejects
context-invalid predicates. Both gain `AtLeast` and shared story predicate
variants.

Defense-in-depth startup validation checks:

- positive count, non-empty conditions, and count not exceeding length;
- no structurally duplicate children;
- qualified slug segments;
- referenced catalog/analysis definitions;
- reserved objective ID `null` in the loaded catalog.

The compiler remains responsible for source-located authoring diagnostics.

## 7. Story reveal authoring contract

### 7.1 Existing local targets

Current bracketed forms remain valid in their existing scene contexts:

```text
[evidence:<id>]
[statement:<id>]
[topic:<character_id>@<topic_id>]
[hotspot:<id>]
[sublocation:<id>]
[question:<local_question_id>]
[phase:<local_phase_id>]
```

### 7.2 New story targets and reserved `null`

New forms are:

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

`null` is a reserved literal only for `set_primary_objective`; it means clear the
active primary. It is not an objective ID. Because `null` otherwise satisfies
the repository slug grammar, HPA-257 adds explicit catalog validation:

- an objective heading with `{#null}` fails at the heading line;
- the runtime rejects a hand-edited catalog containing objective ID `null`;
- other typed namespaces may still use slug `null` because they do not collide
  with this target grammar.

Target items remain comma-separated in the existing `Reveals` list. The
semicolon belongs only to `complete_current`.

Examples:

```text
- **Reveals:** [assert_fact:door_timeline_conflict, resolve_question:who_entered_first@door_timeline_conflict]

- **Reveals:** [complete_objective:prepare_request, set_primary_objective:present_request; complete_current]

- **Reveals:** [grant_authorization:narrow_lock_export]
```

### 7.3 Emitted story target union

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

Compiler scene JSON composes the existing local target union with this story
union. `@lyra/scene-types` retains the local subset.

### 7.4 Fact support materialization

`assertFact` names the proposition; it does not copy support into the token. The
runtime dispatcher receives:

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

For current scene events, absent support materializes as empty lists. Future
analysis resolution supplies accepted support through the same interface.
HPA-257 never infers support from nearby inventory or dialogue.

### 7.5 Context-free batch validation

Before reachability analysis, one reveal list is validated without assuming a
current primary objective. The compiler rejects:

- duplicate identical story targets;
- two different `resolveQuestion` targets for one question;
- more than one `setPrimaryObjective` target;
- `completeObjective` targeting a primary objective;
- unresolved target definitions;
- an authorization grant outside registered authority context;
- authority mismatch.

This phase does **not** reject
`set_primary_objective:X; complete_current` merely because `X` could be current.
Whether that transition is always invalid, conditionally invalid, or valid
depends on primary-objective dataflow and is decided in §11.

### 7.6 Flow-informed transition validation

After positive reachability and dependency-cycle validation, the primary
abstract pass evaluates each reachable `setPrimaryObjective` producer against
its per-node input candidates:

- no valid candidate state: hard error;
- valid and invalid candidate states: conservative ordering warning, and only
  valid candidates contribute abstract outputs;
- all candidate states valid: no transition diagnostic.

This keeps local batch validation independent from fixed-point state while still
catching a uniquely provable runtime rejection.

## 8. Runtime reveal pipeline

### 8.1 Trigger guard and shared dispatcher

Every reveal list has a durable one-shot trigger supplied by its scene runtime,
including first investigation entry/inspection/discussion, first interrogation
breakthrough, future board completion, and future authority events.

The owner checks and transitions consumed/completed state inside the same command
transaction before invoking the shared dispatcher. Re-examination and completed
review paths do not invoke reveals.

Conceptually:

```rust
fn apply_story_reveals(
    catalog: &StoryCatalog,
    state: &mut StoryState,
    targets: &[StoryRevealTarget],
    context: &StoryRevealMaterializationContext,
) -> Result<StoryRevealOutcome, GameError>;
```

Existing investigation/interrogation functions remain thin wrappers that:

1. verify the owning trigger has not fired;
2. transition durable trigger progress;
3. begin with authored trigger dialogue;
4. process targets in authored order;
5. delegate inventory targets to `AcquisitionCtx`;
6. delegate local targets to scene state;
7. delegate story targets to `apply_story_reveals`;
8. append first-acquisition dialogue only on change;
9. return ordered dialogue segments to the existing queue installer.

No generic `appliedStoryEventIds` ledger is added.

### 8.2 Mutation mapping

| Story target | HPA-255 mutation |
|---|---|
| `assertFact` | `StoryState::assert_fact` |
| `revealQuestion` | `StoryState::reveal_question` |
| `resolveQuestion` | `StoryState::resolve_question` |
| `revealObjective` | `StoryState::reveal_objective` |
| `completeObjective` | `StoryState::complete_objective` |
| `setPrimaryObjective` | `StoryState::set_primary_objective` |
| `grantAuthorization` | `StoryState::grant_authorization` |

The dispatcher adds only context validation not owned by HPA-255, such as
represented-authority matching and fact-support materialization.

### 8.3 Assertion origin

Story mutations receive a durable origin built from the triggering block:

- investigation sublocation, hotspot, or topic;
- interrogation phase, inquiry question, or testimony line;
- future story event or analysis board.

The existing HPA-255 `StoryEventBlockKind` contract is reused. HPA-257 does not
add an origin variant.

### 8.4 Authority context

`grantAuthorization` requires:

1. an authorization definition;
2. non-null represented-authority identity from the caller's registered event;
3. exact equality with `grantingAuthority`;
4. a normal scene/analysis assertion origin.

Mismatch fails the transaction. Ordinary hotspots, topics, and analysis
workbenches cannot grant institutional authority merely by listing the target.
Migrations continue to call HPA-255 directly.

### 8.5 Atomicity

Trigger transition and reveal dispatch run in the same command transaction. If
the final effect fails, the trigger remains unconsumed and no earlier local,
inventory, story, acquisition, or dialogue effect remains installed.

The dispatcher never exposes partial success.

### 8.6 Idempotence

Idempotence is defined at the complete authored-event boundary:

- consumed/completed triggers skip dispatch;
- repeated command delivery returns existing state without replay;
- distinct valid fact events may union support while preserving first origin;
- repeated question reveal/resolution and grants use HPA-255 semantics;
- resolver replacement remains invalid;
- repeated inventory targets do not append acquisition dialogue/events;
- local override sets do not duplicate entries;
- a committed `completeCurrent` transition is never replayed, so HPA-255's
  same-current/next rejection remains intact.

## 9. Runtime expression evaluation

### 9.1 Context split

Rust retains scene-local evaluation methods and composes them with:

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

HPA-259 supplies analysis completion state.

### 9.2 `at_least`

```text
true_count = number of child conditions evaluating true
result = true_count >= count
```

The evaluator may short-circuit and has no side effects.

### 9.3 Monotonic property tests

Representative expression trees receive every supported positive mutation.
Once true, an expression must remain true. Tests include nested thresholds,
local/story predicates, and mixed binary trees. Active-primary replacement
cannot affect truth because active status is not observable.

## 10. Whole-corpus reachability architecture

### 10.1 Specialized analysis remains authoritative

The generic graph does not reimplement:

- investigation sublocation/hotspot/topic reachability;
- guaranteed versus obtainable entry reveals;
- contradiction target availability;
- intersections across alternative correct lines;
- required/effectively-forced optional phases;
- explicit/automatic outro completion.

Specialized analyzers expose normalized nodes and effects.

### 10.2 Normalized node model

```ts
type ReachabilityRequirement = "mandatory" | "optional";

type ReachabilityNode = {
  key: string;
  requirement: ReachabilityRequirement;
  initiallyReachable: boolean;
  condition: PositiveExpression<ReachabilityPredicate> | null;
  implicitPrerequisites: ReachabilityPredicate[];
  effects: ReachabilityEffect[];
  representedAuthority: string | null;
  sourceFile: string;
  line: number;
};
```

Adapters provide stable keys, locations, conditions, prerequisites, effects, and
requirement classification. The normalized module does not parse Markdown.

### 10.3 Positive atoms

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
objective_revealed:<id>
objective_completed:<id>
authorization_granted:<id>
analysis_scene_completed:<chapter>@<scene>
analysis_board_completed:<chapter>@<scene>@<board>
```

Internal atoms such as objective revealed or node reached need not become
user-visible predicates.

### 10.4 Seeds

Seeds include:

- the first playable story entry according to current sequencing;
- authored `unlocked` blocks within an entered scene;
- initial/auto state supplied by specialized analyzers.

Catalog definitions alone do not seed facts, questions, objectives, or grants.

### 10.5 Positive fixed-point algorithm

```text
reachable_nodes := initially reachable nodes
positive_atoms  := guaranteed effects of initial nodes

repeat
  for each not-yet-reachable node in deterministic key order
    if condition and implicit prerequisites are satisfied
      mark node reachable

  for each newly reachable node in deterministic key order
    validate/apply positive non-primary effects to abstract state

until no node or positive atom is added
```

Node and atom domains are finite and only grow, so convergence is guaranteed.
An implementation guard may detect compiler bugs but is not an authored-content
iteration limit.

Primary-objective effects participate in reachability through target validation,
objective-revealed outputs, and the separate dataflow in §11. The positive
fixed point does not use one corpus-global active-primary set.

### 10.6 Implicit effect prerequisites

Examples:

- `resolveQuestion(q, f)` requires `fact_asserted:f`;
- explicit supporting facts require assertion;
- grants require matching authority context;
- analysis effects may require accepted board completion;
- scene completion requires specialized proof of completable state.

Adapters expose these prerequisites so the graph never credits an effect that
runtime would reject.

### 10.7 Possible versus guaranteed results

| Question | Owner |
|---|---|
| Can some valid positive path reach this node/effect? | HPA-257 fixed point |
| Is a record/reveal unavoidable before a legacy scene? | specialized guaranteed-flow analysis |
| Which primary can be active before this particular node? | §11 per-node may-dataflow |
| Does every transition ordering complete the same primary? | not promised |
| Does runtime keep zero or one active primary? | HPA-255 scalar mutation |

## 11. Primary-objective abstract dataflow

### 11.1 Target and reserved-ID validation

Before the dataflow:

- objective ID `null` is rejected in compiler and Rust catalog validation;
- a non-null target must exist and be primary;
- `completeObjective` may not target a primary;
- one batch may contain at most one primary transition.

### 11.2 Dataflow domain

After strict dependency-cycle validation, the reachability dependency graph is
acyclic. The compiler evaluates a finite path-insensitive dataflow over reachable
nodes in deterministic topological order.

For each node:

```ts
type PrimaryCandidate = string | null;

type PrimaryFlow = {
  before: Set<PrimaryCandidate>;
  after: Set<PrimaryCandidate>;
};
```

Initial entry nodes begin with `{ null }`. A node's `before` set is the union of
`after` sets from reachable dependency predecessors that can feed it. This means
unrelated disjoint branches do not pollute each other merely because both exist
somewhere in the corpus.

At a real dependency merge, union is intentionally path-insensitive. The pass
retains possible scalar values, not complete event-order histories.

### 11.3 Transfer without a primary transition

A node with no `setPrimaryObjective` effect passes candidates through unchanged:

```text
after := before
```

### 11.4 Transfer for `completeCurrent = false`

For:

```text
setPrimaryObjective(false, X)
```

all valid incoming paths produce:

```text
after := { X }
```

where `X` may be `null`. A non-null `X` also produces
`objective_revealed:X`.

### 11.5 Transfer for `completeCurrent = true`

For:

```text
setPrimaryObjective(true, X)
```

an incoming candidate is invalid only when it is non-null and equals non-null
`X`, matching HPA-255's current-equals-next rejection. `null` input is valid;
there is simply no current objective to complete.

Partition `before` into valid and invalid candidates:

- every valid non-null current candidate is possibly completed;
- valid inputs produce `after := { X }`;
- invalid candidates produce no abstract output because runtime rejects them.

Diagnostics:

1. **All candidates invalid:** `primaryObjectiveTransitionAlwaysInvalid` error.
   The transition has no runtime-valid path.
2. **Some valid, some invalid:**
   `primaryObjectiveOrderingNotExhaustive` warning. The existence-oriented
   analysis credits outputs from valid candidates only.
3. **All candidates valid:** no transition diagnostic.

This is the flow-informed validation previously left ambiguous in local batch
rules.

### 11.6 Conservative merge warning

The warning is intentionally conservative at merge points. If two predecessor
paths can feed the same completion node with different current primaries, the
pass unions them and does not prove which transition happened last.

It no longer warns because of a completely unrelated branch that cannot feed the
node. It may still warn when branches merge or when independent prerequisites
can be achieved in multiple orders.

There is no warning-suppression directive in HPA-257. Authors reduce ambiguity by
placing `complete_current` on a branch-specific event before the merge, or by
adding an explicit transition event whose incoming dependencies establish a
single valid current primary. If the story intentionally permits several valid
orders, the non-blocking warning remains accepted documentation of that fact.

This preserves the non-goal of exhaustive combinatorial objective model
checking while keeping warning signal useful.

## 12. Cycle and self-reference validation

### 12.1 Dependency graph

The compiler creates producer-to-consumer edges for positive atoms and implicit
prerequisites. Local identities are qualified; global state can cross scenes and
chapters. Every producer referenced by `or` or `at_least` participates in strict
cycle analysis.

### 12.2 Rejection policy

Reject:

- a node depending on an atom produced only by itself;
- fact support transitively depending on the asserted fact;
- a strongly connected component with multiple nodes;
- a self-loop in a one-node component.

An external seed does not legalize a cycle. Authors must introduce a one-way seed
or remove the backward dependency.

### 12.3 Diagnostics

One canonical diagnostic is emitted per SCC with a stable minimal cycle path.
Legacy `lockedBlockUnreachable` errors remain and duplicate generic errors are
suppressed for the same legacy block.

## 13. Mandatory, optional, and authorization reachability

### 13.1 Requirement classification

Adapters classify nodes:

- legacy entry/completion retains specialized semantics;
- legacy locked blocks retain current error behavior;
- required analysis boards/cards are mandatory;
- optional boards/cards are optional;
- grants required by mandatory content are mandatory outputs;
- catalog definitions alone are not gameplay nodes.

### 13.2 Post-convergence diagnostics

After convergence:

- unreachable new mandatory node: error;
- unreachable new optional node: warning;
- mandatory atom with no reachable producer: error;
- reachable effect with unsatisfied implicit prerequisites: error;
- optional atom noise is represented by its optional consumer warning, not a
  second duplicate warning.

### 13.3 Authorization gates

For mandatory `authorization:<id> granted` conditions, verify:

1. definition exists;
2. a `grantAuthorization` producer exists;
3. producer authority matches;
4. at least one matching producer is reachable.

Failure is `mandatoryAuthorizationUnreachable`. Optional gates use
`optionalContentUnreachable`.

## 14. Reference and semantic validation

### 14.1 Story predicates

Resolve facts, global questions, objectives, authorizations, and qualified
analysis refs against their typed registries. Typed namespaces may reuse slugs.

### 14.2 Catalog reservation

HPA-257 extends catalog semantic validation with:

```text
objective id "null" is reserved by set_primary_objective and cannot be authored
```

Compiler diagnostics use the objective heading source location. Rust catalog
loading rejects the same condition as defense-in-depth. The catalog wire version
remains 2.

### 14.3 Story reveal targets

Validate:

- every target definition;
- question resolver membership in `resolvedByFactIds`;
- secondary kind for `completeObjective`;
- primary kind for non-null set-primary targets;
- matching authority context;
- context-supplied support references and support acyclicity.

### 14.4 Source locations and warnings

Every compiler diagnostic includes source file and one-based line. Metadata
errors use the metadata line; the reserved objective ID uses its heading line.

Warnings are deterministic and non-blocking:

- `optionalContentUnreachable`;
- `primaryObjectiveOrderingNotExhaustive`.

## 15. Diagnostic code contract

| Code | Severity | Meaning |
|---|---|---|
| `unlockAtLeastInvalidCount` | error | count is not a positive base-10 integer |
| `unlockAtLeastEmptyConditions` | error | no child condition |
| `unlockAtLeastCountExceedsConditions` | error | count exceeds child count |
| `unlockAtLeastDuplicateCondition` | error | structurally duplicate child |
| `unresolvedStoryPredicate` | error | global typed reference missing |
| `unresolvedAnalysisPredicate` | error | qualified analysis reference missing |
| `storyRevealUnresolved` | error | story target definition missing |
| `invalidQuestionResolutionTarget` | error | fact cannot resolve question |
| `reservedObjectiveId` | error | objective ID `null` is reserved |
| `primaryObjectiveCompletionRequiresSet` | error | direct complete names primary |
| `invalidPrimaryObjectiveTarget` | error | set-primary target missing/secondary |
| `primaryObjectiveTransitionAlwaysInvalid` | error | every incoming candidate causes HPA-255 rejection |
| `duplicateStoryRevealTarget` | error | duplicate/contradictory local batch target |
| `authorizationGrantOutsideAuthorityEvent` | error | no authority context |
| `authorizationGrantAuthorityMismatch` | error | authority differs from definition |
| `positiveSelfReference` | error | direct positive self-dependency |
| `positiveDependencyCycle` | error | multi-node positive SCC |
| `requiredContentUnreachable` | error | mandatory new node unreachable |
| `mandatoryAuthorizationUnreachable` | error | required grant path unreachable |
| `optionalContentUnreachable` | warning | optional new node unreachable |
| `primaryObjectiveOrderingNotExhaustive` | warning | some incoming primary candidates are ambiguous or invalid |

Legacy codes remain where applicable.

## 16. Module ownership

### 16.1 Compiler

Expected focused changes:

```text
packages/scripts/compile-scenes/
  types.ts                 concrete predicates/targets and shared aliases
  parser-unlock.ts         shared recursion + context predicate adapters
  parser-investigation.ts  shared reveal-target parser consumer
  parser-interrogation.ts  shared reveal-target parser consumer
  parser-reveals.ts        shared local/story reveal grammar
  validator.ts             retain specialized validation; invoke corpus passes
  reachability.ts          positive fixed point, cycles, per-node primary flow
  story-catalog.ts         target validation + reserved objective ID
  emitter.ts               emit new nodes; preserve legacy output
```

The implementation plan may refine private helper filenames but may not duplicate
the story grammar in each parser.

### 16.2 Shared package boundary

`packages/scene-types/src/index.ts` continues to own editor-shared local values.
The current union may be renamed internally to `SceneLocalRevealTarget` while
retaining `RevealTarget` as a compatibility alias. Story targets stay in compiler
and runtime schema ownership.

### 16.3 Rust

```text
apps/game/src-tauri/src/game/
  schema.rs                new expression/target wire variants
  unlock.rs                story predicates and at_least evaluation
  reveals.rs               shared dispatcher and scene adapters
  story/catalog.rs         reserved objective ID defense-in-depth
  story/mutations.rs       HPA-255 implementation remains sole owner
  save/                    tests only; no version change
```

### 16.4 Frontend and IPC

No new frontend type, component, or command is required. Existing commands return
new views after committed mutations.

## 17. Save, restore, and content compatibility

### 17.1 Save schema

HPA-257 adds no generic mutable field. Saves already contain the relevant
inventory, scene progress, story state, dialogue/acquisition state, and future
analysis progress through HPA-260 ownership.

Therefore:

- current save schema remains version 2;
- no migration is added;
- `StoryState::from_snapshot` remains the story-state validation gate;
- restore remains transactional;
- recapture must reproduce the same public view.

### 17.2 Content identity

Legacy content emits identical JSON, so compiler refactoring alone does not alter
content revision. Authored use of a new predicate, target, or `at_least` changes
the emitted resource and therefore the existing content revision naturally.

### 17.3 Round-trip requirement

A fixture must:

1. collect evidence;
2. assert a fact;
3. resolve a question;
4. complete a secondary objective;
5. transition the primary through HPA-255;
6. grant authorization from matching authority context;
7. unlock content through nested `at_least`;
8. save, restart, load, and preserve story, trigger, and unlocked state;
9. repeat the gameplay command and prove the consumed trigger prevents
   redispatch.

No previously unlocked block may become locked after restore.

## 18. Test strategy

### 18.1 Parser compatibility

- snapshot every existing legacy expression;
- preserve associativity and precedence;
- compile Chapter 1 and all legacy fixtures unchanged;
- reject shared predicates in contexts that have not opted in.

### 18.2 `at_least`

Cover one-of-one, all-of-N, nested thresholds, mixed binary children, thresholds
inside binary expressions, invalid counts, empty lists, structural duplicates,
and Rust short-circuit behavior.

Include an explicit accepted case proving that commutatively reordered binary
children are not treated as structural duplicates. This locks the intentional
tradeoff without adding semantic equivalence solving.

### 18.3 Reference, catalog, and target validation

Cover:

- unresolved typed and qualified refs;
- malformed analysis refs;
- duplicate synthetic analysis definitions;
- objective ID `null` rejected at catalog heading and Rust load;
- invalid question resolver;
- secondary set-primary target;
- direct primary completion;
- duplicate story targets;
- grant context absence/mismatch.

### 18.4 Reachability and cycles

Cover:

- multi-iteration positive chains;
- nested `at_least` fed by separate branches;
- direct and multi-node cycles;
- seeded-but-cyclic rejection;
- unreachable mandatory/optional nodes;
- authorization producer absent, unreachable, and reachable;
- no duplicate generic diagnostics for legacy blocks.

### 18.5 Primary-objective dataflow

Cover:

- null → A;
- A → B with and without completion;
- A → null with completion;
- invalid secondary target;
- uniquely known A → A with completion produces
  `primaryObjectiveTransitionAlwaysInvalid`;
- candidate `{A, B}` entering `completeCurrent,next=A` produces one conservative
  warning and credits only the B path;
- disjoint A and B branches that never feed the same node do **not** warn;
- a real merge of A/B candidates warns;
- branch-specific completion before merge avoids the warning;
- runtime zero-or-one invariant after every transition;
- replay of a consumed completion trigger skips dispatch.

### 18.6 Atomicity and idempotence

A mixed batch forced to fail on its final target must roll back trigger progress,
inventory, acquisitions, local overrides, story state, active primary, dialogue,
and generation state. A repeated successful gameplay command must skip dispatch
and create no duplicate effect.

### 18.7 Ownership guard

Tests prove:

1. dispatcher behavior matches HPA-255 transition outcomes;
2. source contains a call to `set_primary_objective` and no direct writes to
   objective progress or `active_primary_objective_id`;
3. Rust privacy continues to enforce the field boundary.

### 18.8 Verification gate

The implementation PR passes scene compilation, full compiler/Rust/workspace
tests, TypeScript/Svelte/Rust checks, formatting/linting, content-revision
goldens, and targeted save/restore coverage. Packaged E2E is required only if an
existing player-visible path or command timing changes.

## 19. Authoring guidance changes

Update canonical investigation/interrogation skills and the future analysis
skill with:

- shared story predicates;
- qualified analysis syntax;
- `at_least` examples and invalid counts;
- structural rather than semantic duplicate detection;
- the prohibition on negative gates;
- story reveal target forms;
- `null` reserved as an objective ID;
- primary mutation ownership and one-shot replay behavior;
- context-free batch validation versus flow-informed transition validation;
- authority-event grant restriction;
- strict cycle policy;
- optional-unreachable warnings;
- the conservative merge nature of
  `primaryObjectiveOrderingNotExhaustive`;
- guidance to move completion before a merge or establish a unique primary when
  practical;
- the statement that definitions do not imply initial progress.

No duplicate `.agents/skills` source is introduced without a separate repository
policy change.

## 20. Rejected alternatives

### 20.1 One unrestricted expression union

Rejected because local predicates cannot be evaluated in every scene family.

### 20.2 Expand `at_least` into binary Boolean combinations

Rejected due combinatorial expansion and damaged diagnostics.

### 20.3 Generic `not` or string flags

Rejected because they break monotonic truth or duplicate typed state.

### 20.4 Semantic Boolean-equivalence detection

Rejected. Structural duplicate detection catches common author mistakes without
normalizing commutative/associative Boolean expressions or introducing a theorem
solver.

### 20.5 Duplicate primary-objective mutation logic

Rejected because HPA-255 owns validation, replacement/completion, and the scalar.

### 20.6 Make low-level `completeCurrent` independently replayable

Rejected. Idempotence belongs to the owning durable event; HPA-255's invalid
same-current/next rule remains unchanged.

### 20.7 Automatic question resolution

Rejected because resolver choice and story timing are authored decisions.

### 20.8 Let any block grant authorization

Rejected because represented institutions, not internal analysis, grant access.

### 20.9 Replace specialized reachability analysis

Rejected because existing analyzers encode gameplay semantics the generic graph
must consume rather than reconstruct.

### 20.10 Allow externally seeded cycles

Rejected for deterministic authoring and diagnostics.

### 20.11 One corpus-global possible-primary set

Rejected because unrelated disjoint branches would pollute every later
completion warning. Per-node propagation reduces false positives while retaining
path-insensitive union at actual merges.

### 20.12 Exhaustive objective state-space search

Rejected because the contract promises structural runtime uniqueness, not proof
of every event ordering.

### 20.13 Generic applied-story-event ledger or save bump

Rejected because subsystem-owned trigger progress and existing story fields
already persist the resulting state.

## 21. Acceptance-criteria mapping

| HPA-257 acceptance criterion | Design mechanism |
|---|---|
| Existing expressions compile/behave identically | context wrappers and legacy JSON goldens |
| Invalid counts fail with locations | §5.5 and diagnostic contract |
| Unresolved/ambiguous refs fail | §§5.4, 14 |
| Cycles/self-reference fail | §12 strict SCC policy |
| Unreachable required content fails | §13 |
| Authority gates without grant paths fail | §13.3 |
| Primary transitions included in fixed analysis | §11 per-node dataflow |
| No exhaustive ordering claim | §§10.7, 11.6 |
| Objective mutation delegated | §§8.2, 18.7 |
| No re-locking | §4.1 property |
| Atomic/idempotent dispatch | §§8.1, 8.5–8.6, 18.6 |
| Nested `at_least` compiler/Rust tested | §18.2 |
| Save/load preserves monotonic state | §17.3 |

## 22. Implementation-plan handoff

The executable TDD plan must separate:

1. legacy parser characterization and shared combinator extraction;
2. `at_least` parser/types/emission/Rust serde;
3. shared story predicates and reference validation;
4. shared story reveal target parsing and catalog validation, including reserved
   objective ID `null`;
5. normalized positive reachability and strict cycle diagnostics;
6. investigation/interrogation adapters without deleting specialized analyses;
7. per-node primary-objective dataflow and transition diagnostics;
8. Rust story predicate evaluation;
9. one-shot trigger integration, atomic dispatch, and authority validation;
10. primary-objective delegation/source guard;
11. save/restore, compatibility, authoring guidance, and whole-branch gates.

The implementation plan must re-read `main` and name exact files/tests. It may
refine private helper names but may not change the grammar, wire shapes,
ownership, reserved-ID rule, cycle policy, primary dataflow semantics,
trigger-idempotence boundary, or compatibility decisions fixed here.
