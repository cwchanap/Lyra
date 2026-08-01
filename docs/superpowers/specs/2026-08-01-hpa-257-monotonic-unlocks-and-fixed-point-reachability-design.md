# HPA-257 Monotonic Unlocks and Fixed-Point Reachability Design

**Status:** Ready for review after codebase alignment and self-review  
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
gates. It also adds one compiler-wide positive fixed-point analysis that proves
mandatory progression has an authored path and identifies optional dead content.

This slice delivers:

- shared parsing of `and`, `or`, parentheses, and `at_least`;
- positive predicates for asserted facts, resolved global questions, completed
  objectives, completed qualified analysis scenes/boards, and granted
  authorizations;
- source-located validation of every new reference and count;
- story-state reveal targets that materialize through HPA-255 mutations;
- one atomic/idempotent reveal dispatcher shared by existing and future scene
  runtimes;
- explicit authority-origin validation for authorization grants;
- a normalized whole-corpus reachability graph and finite positive fixed point;
- required-content errors and optional-content warnings;
- strict self-reference and positive dependency-cycle rejection;
- conservative, existence-oriented handling of primary-objective transitions;
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
4. `and` continues to bind more tightly than `or`.
5. Parentheses continue to override precedence.
6. `at_least(count, conditions...)` is a first-class n-ary expression node; it
   is not expanded into combinations of binary `and`/`or` nodes.
7. `at_least` requires a positive base-10 integer count, a non-empty condition
   list, and `count <= conditions.length`.
8. Structurally duplicate child conditions inside one `at_least` are invalid;
   one true condition cannot be authored twice to inflate the threshold.
9. Nested `at_least`, `and`, `or`, and parentheses are supported in every unlock
   context.
10. The compiler shares combinator parsing internally but preserves separate
    context-specific predicate unions. A predicate valid in one scene family is
    not automatically valid in every scene family.
11. Durable fact, global-question, objective, and authorization references use
    game-global catalog IDs.
12. Analysis scene and board completion references are always qualified. The
    authoring form uses `@` separators and the emitted form uses structured
    chapter/scene/board fields.
13. A bare analysis scene or board ID is never accepted.
14. HPA-257 defines qualified analysis reference types and registry interfaces.
    HPA-259 supplies production analysis scene/board definitions and completes
    their referential validation.
15. Existing `question:<id> answered` remains the interrogation-local predicate.
    The new global predicate is `question:<id> resolved`; the distinct verb
    prevents namespace ambiguity.
16. Existing scene-local reveal target syntax remains valid without migration.
17. New story reveal targets use explicit mutation-oriented prefixes such as
    `assert_fact:` and `grant_authorization:`. They do not overload existing
    local `question:` or `phase:` reveal tokens.
18. An authored reveal batch is ordered for deterministic runtime processing but
    becomes externally visible only after the whole command commits.
19. Unlock conditions are re-evaluated after the reveal transaction, not between
    individual targets in the same list.
20. Runtime atomicity is owned by the existing `EngineRollbackSnapshot` command
    transaction. Any failed target restores story state, local scene state,
    inventory, acquisition events, dialogue segments, and every other rollback
    field.
21. Runtime idempotence is composed from existing inventory/local-set behavior
    and HPA-255's `MutationOutcome::Changed | Unchanged` results.
22. Repeating an already-applied story target does not replay acquisition or
    result dialogue and does not replace first assertion/grant origins.
23. HPA-255 remains the sole owner of every story-state mutation.
24. HPA-257's dispatcher calls `StoryState::set_primary_objective`; it never
    writes objective progress or `active_primary_objective_id` directly.
25. Authored `complete_objective` may target only secondary objectives. Primary
    objective completion is expressed through `set_primary_objective` with
    `completeCurrent: true`.
26. `reveal_objective` may reveal either objective kind without activating it.
27. `set_primary_objective` accepts a primary objective ID or `null`, and an
    optional `complete_current` marker.
28. The compiler validates every non-null primary target through HPA-255's
    catalog contract. Runtime delegates the actual transition to HPA-255.
29. Question resolution is explicit. Asserting a candidate fact does not
    automatically resolve every question that lists it.
30. `resolve_question` requires the question, the resolver fact, membership in
    `resolvedByFactIds`, and an asserted resolver fact at runtime.
31. An `assert_fact` target carries the fact intent only. The caller supplies
    assertion origin and any context-derived supporting records/facts.
32. Existing investigation/interrogation scene-event assertions may use empty
    support. HPA-259/HPA-262 may impose stronger board-specific support rules and
    materialize accepted board support without changing this dispatcher.
33. Authorization grants require a represented authority context whose identity
    matches the authorization definition's `grantingAuthority`.
34. Current investigation/interrogation blocks do not implicitly represent an
    authority. A grant authored outside a registered authority-event context is
    invalid.
35. HPA-264 owns the production request/hearing authoring surface that supplies
    authority-event context. HPA-257 owns grant dispatch and grant-path
    reachability validation.
36. Reachability is a finite, positive, existence-oriented may-analysis: it asks
    whether at least one authored positive path can reach content.
37. Existing investigation/interrogation specialized analyzers remain
    authoritative for their gameplay semantics, including contradiction
    availability, forced optional phases, guaranteed inventory intersections,
    and outro completion.
38. The new whole-corpus reachability module consumes normalized outputs from
    those analyzers; it does not reimplement them.
39. Direct self-reference is always an error.
40. Multi-node positive dependency cycles are rejected strictly, even when a
    separate branch could seed one member. Authors must express progression as
    an acyclic positive dependency graph.
41. Existing legacy scene-local reachability errors retain their current error
    behavior and codes. HPA-257 does not downgrade them to warnings.
42. Newly modeled content explicitly marked optional produces a deterministic
    warning when unreachable; mandatory content produces an error.
43. An authorization definition is not inherently mandatory. It becomes
    mandatory when required content depends on it or an adapter declares its
    grant output mandatory.
44. A mandatory authorization requirement with no reachable matching authority
    grant is an error.
45. The compiler does not claim exhaustive proof of every possible ordering of
    `setPrimaryObjective` events.
46. Static primary-objective analysis tracks possible active IDs and credits a
    reachable `completeCurrent` transition with possible completion of every
    currently possible non-null active ID. Ambiguous ordering is surfaced as a
    warning rather than represented as a proof that every ordering succeeds.
47. Runtime uniqueness remains structural through HPA-255's single
    `activePrimaryObjectiveId` scalar.
48. The story catalog schema remains version 2. HPA-257 adds no catalog fields.
49. The save schema remains version 2. HPA-257 adds no durable mutable field;
    resulting state already lives in inventory, local scene state, and
    `StoryStateSnapshot`.
50. Existing authored chapters require no migration and must emit byte-identical
    unlock/reveal JSON where they do not opt into new syntax.
51. `@lyra/scene-types` does not gain global story definitions, hidden analysis
    data, or the whole story reveal union.
52. The current shared local `RevealTarget` contract may be retained as a
    compatibility alias, while compiler/runtime scene JSON composes it with a
    separate `StoryRevealTarget` union.
53. HPA-257 adds no frontend component or IPC command.
54. No production `story_catalog.md` or Chapter 1 story file is changed in this
    slice.

## 3. Current repository constraints

### 3.1 Compiler

The current compiler:

- parses investigation and interrogation unlock expressions through two
  parallel recursive-descent paths in `parser-unlock.ts`;
- supports binary `and`/`or`, parentheses, and context-specific predicates;
- models investigation and interrogation expressions as separate recursive
  unions in `types.ts`;
- parses investigation reveal lists inside `parser-investigation.ts` and
  interrogation reveal lists inside `parser-interrogation.ts`;
- validates scene-local references and global evidence/statement IDs in
  `validator.ts`;
- contains substantial specialized fixed-point logic for investigation block
  reachability, guaranteed inventory, interrogation completion, contradiction
  availability, and forced optional phases;
- already has a non-blocking warning channel;
- emits generated scene JSON without a standalone scene-schema version;
- computes package content identity from canonical emitted resources.

The current implementation has three duplication risks HPA-257 must close:

1. combinator parsing is duplicated between scene families;
2. expression evaluation is duplicated in compiler helpers and Rust evaluators;
3. reveal application is split between investigation and interrogation paths.

The solution is a shared positive kernel plus thin scene adapters—not one
unrestricted expression/reveal union that erases local scope rules.

### 3.2 Runtime

The current runtime:

- mirrors investigation/interrogation expression trees in `game/schema.rs`;
- evaluates them through separate traits/functions in `game/unlock.rs`;
- applies investigation/interrogation reveals in `game/reveals.rs`;
- owns atomic command rollback through the extracted transaction seam;
- owns inventory acquisition and durable acquisition events through the shared
  acquisition context;
- owns sparse durable facts, questions, objectives, authorizations, and the
  active primary scalar in `game/story/`;
- exposes validated HPA-255 mutation methods only inside `crate::game`;
- persists story state, local scene progress, inventory, dialogue, and
  acquisitions through the existing save system.

`StoryState` fields are not a public mutation surface for `game/reveals.rs`.
Rust module privacy is part of the ownership boundary; tests add an explicit
source-level guard rather than relying on convention alone.

### 3.3 Existing scene behavior

Existing Chapter 1 content uses only legacy local predicates and targets. Its
compiled expression/reveal JSON is a compatibility golden. HPA-257 must not:

- reorder binary expression nodes;
- flatten existing `and`/`or` trees;
- rewrite existing reveal lists;
- change the meaning of `question answered` or `phase completed`;
- change which existing blocks are treated as required/unreachable;
- change current dialogue/acquisition ordering.

## 4. Goals and invariants

### 4.1 Positive monotonicity

Every predicate observes a state that can move only from absent/false to
present/true:

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
not an unlock predicate. The transition may reveal a next objective and may
complete the current objective; neither operation removes positive progress.

Therefore, for every supported expression `E` and every valid authored mutation
`m`:

```text
E(state) = true  ⇒  E(m(state)) = true
```

This property is required in compiler reasoning and Rust tests.

### 4.2 Definitions, progress, and effects remain separate

- Catalog and scene files define IDs, labels, rules, expressions, and effects.
- Runtime state stores acquired/revealed/completed/granted progress only.
- Unlock expressions inspect progress; they never mutate it.
- Reveal targets describe effects; they do not contain copied catalog prose.
- Saves store stable IDs and progress, not expression source text or authored
  labels.

### 4.3 One mutation owner

The reveal layer resolves targets and supplies context, but mutation semantics
remain owned by:

- `Inventory`/`AcquisitionCtx` for evidence and statements;
- scene-state local override/completion methods for local targets;
- HPA-255 `StoryState` mutation methods for story targets.

No second objective, fact, question, or authorization state machine is added.

## 5. Positive expression authoring grammar

### 5.1 Grammar

The shared parser recognizes this grammar, parameterized by an allowed predicate
set:

```text
expr          := or_expr
or_expr       := and_expr ("or" and_expr)*
and_expr      := atom ("and" atom)*
atom          := "(" expr ")"
               | at_least
               | predicate
at_least      := "at_least" "(" count "," expr ("," expr)+ ")"
count         := base-10 positive integer
```

The grammar deliberately requires at least one comma after `count`; an empty
condition list is malformed. Whitespace may appear around delimiters and
operators.

Operator behavior remains:

```text
and > or
```

`at_least(...)` is an atom. Its child conditions are full expressions, so
nesting and mixed combinators require no additional precedence rule.

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

Every scene family that opts into the shared story predicate set may use:

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
fact:door_timeline_conflict asserted

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

Authoring uses exact slug segments separated by `@`:

```text
analysis_scene:chapter_1@analysis_scene_8_5 completed
analysis_board:chapter_1@analysis_scene_8_5@source_board completed
```

The emitted values are structured:

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

Each segment uses the existing exact slug rule `^[a-z0-9_]+$`. Missing, extra,
or empty segments are parse errors. The compiler never attempts to infer a
chapter or scene from a bare board ID.

HPA-257 introduces a definition-registry interface capable of resolving these
refs. Until HPA-259 registers production analysis definitions, an authored
analysis predicate in production content is unresolved and fails normally.
Synthetic HPA-257 fixtures register qualified scene/board definitions directly.

### 5.5 `at_least` validation and meaning

The compiler rejects:

- count `0`;
- negative, signed, decimal, hexadecimal, or fractional counts;
- an empty condition list;
- a count larger than the number of conditions;
- structurally duplicate normalized child expressions;
- missing commas or closing parentheses.

Valid edge cases include:

```text
at_least(1, fact:a asserted)
at_least(3, fact:a asserted, fact:b asserted, fact:c asserted)
```

Runtime evaluation counts child expressions whose Boolean result is true. It
counts expression positions, not distinct underlying atoms. The duplicate-child
rule prevents the simplest accidental double count while still allowing
legitimately different expressions that share some atoms.

### 5.6 No negative forms

The following remain invalid:

```text
not fact:a asserted
fact:a not asserted
objective:a incomplete
authorization:a missing
active_primary_objective:a
```

Temporary presentation state, current selection, current active objective, and
absence are not authored unlock conditions.

## 6. Compiler and wire expression model

### 6.1 Compiler-internal generic core

The compiler may implement the shared recursion as:

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

This is a compiler implementation type, not a requirement to publish generic
wire types or to move the contract into `@lyra/scene-types`.

Concrete predicate unions remain context-specific:

```ts
type InvestigationUnlockExpr = PositiveExpression<
  InvestigationLocalPredicate | StoryPredicate
>;

type InterrogationUnlockExpr = PositiveExpression<
  InterrogationLocalPredicate | StoryPredicate
>;
```

Public parser wrappers retain their current names and return types so existing
call sites and tests do not change unnecessarily.

### 6.2 Emitted JSON

Existing binary nodes remain byte-identical:

```json
{
  "op": "and",
  "left": { "predicate": "evidence_collected", "id": "receipt" },
  "right": { "predicate": "hotspot_investigated", "id": "desk" }
}
```

The new n-ary node is:

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

New predicate wire shapes are:

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

### 6.3 Rust schema

Rust keeps concrete investigation and interrogation enums so serde rejects
context-invalid predicates. Both gain:

- an `AtLeast` variant with `count` and non-empty validated conditions;
- the shared story predicate variants.

Packaged-resource loading validates defense-in-depth:

- count is positive;
- conditions are non-empty;
- count does not exceed length;
- duplicate child conditions are absent;
- every qualified segment is a valid slug;
- every referenced definition resolves through the loaded catalog/scene
  registry.

Compiler validation remains responsible for source-located diagnostics; runtime
startup errors protect against corrupt or hand-edited resources.

## 7. Story reveal authoring contract

### 7.1 Existing local targets

Current bracketed target forms remain valid, including:

```text
[evidence:<id>]
[statement:<id>]
[topic:<character_id>@<topic_id>]
[hotspot:<id>]
[sublocation:<id>]
[question:<local_question_id>]
[phase:<local_phase_id>]
```

The allowed local subset still depends on the scene family.

### 7.2 New story targets

New mutation-oriented target forms are:

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

`null` is a reserved literal only in the `set_primary_objective` target. It is
not interpreted as an objective ID.

Target items remain comma-separated inside the existing `Reveals` list. The
semicolon belongs only to the optional `complete_current` modifier, so it does
not conflict with list separation.

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

Investigation and interrogation JSON compose their existing local target union
with `StoryRevealTarget`. `@lyra/scene-types` retains the scene-local subset; it
does not become the owner of catalog mutations.

### 7.4 Fact support materialization

`assertFact` names the durable proposition but does not copy support into the
authored target token. The runtime dispatcher receives a materialization
context:

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

For current investigation/interrogation scene events, an absent support entry
materializes as two empty lists. Future analysis resolution supplies accepted
record/fact support through the same interface. HPA-262's threshold and support
rules remain separate from this generic target parser.

The compiler validates explicitly listed supporting facts when a future adapter
provides them as implicit prerequisites. HPA-257 does not invent support from
nearby inventory or dialogue.

### 7.5 Batch validation

For new story targets in one authored reveal list, the compiler rejects:

- duplicate identical story targets;
- two different `resolveQuestion` targets for the same question;
- more than one `setPrimaryObjective` target;
- `completeObjective` targeting a primary objective;
- contradictory primary transitions such as completing and retaining the same
  uniquely known current primary;
- an authorization grant outside a registered authority-event context;
- an authority-event identity that does not match `grantingAuthority`.

Existing duplicate local reveal behavior is not changed by this slice.

All references are resolved before emission. Runtime performs equivalent
catalog checks as defense-in-depth.

## 8. Runtime reveal dispatch

### 8.1 Shared dispatcher

`game/reveals.rs` remains the integration owner named by the program plan. It
introduces a shared story-target dispatcher used by investigation,
interrogation, and future analysis resolution.

Conceptually:

```rust
fn apply_story_reveals(
    catalog: &StoryCatalog,
    state: &mut StoryState,
    targets: &[StoryRevealTarget],
    context: &StoryRevealMaterializationContext,
) -> Result<StoryRevealOutcome, GameError>;
```

Existing investigation/interrogation functions remain thin orchestration
wrappers that:

1. begin with any authored trigger dialogue segment;
2. process targets in authored order;
3. delegate evidence/statements to `AcquisitionCtx`;
4. delegate local visibility targets to scene-state methods;
5. delegate story targets to `apply_story_reveals`;
6. append first-acquisition dialogue only when acquisition changed;
7. return the ordered dialogue segments to the existing queue installer.

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

The dispatcher does not duplicate validation already owned by those methods. It
adds only reveal-context validation that HPA-255 cannot own, such as represented
authority matching and fact-support materialization.

### 8.3 Assertion origin

Every story mutation receives a durable origin built from the triggering block:

- investigation sublocation;
- investigation hotspot;
- investigation topic;
- interrogation phase;
- inquiry question;
- testimony line;
- future story event;
- future analysis board.

The existing HPA-255 `StoryEventBlockKind` wire contract is reused. Adding an
origin variant remains a separate save-compatibility decision; HPA-257 does not
add one.

### 8.4 Authority context

`grantAuthorization` requires:

1. an authorization definition;
2. a non-null represented-authority identity supplied by the caller's registered
   authority-event definition;
3. exact equality with the catalog definition's `grantingAuthority`;
4. a normal scene/analysis assertion origin.

The matching check occurs before the HPA-255 grant mutation. A mismatch fails the
whole transaction. An ordinary hotspot, topic, or analysis workbench completion
cannot grant institutional authority merely because it lists the target.

Migrations may continue to use HPA-255's migration-origin API directly; they do
not pass through authored reveal dispatch.

### 8.5 Atomicity

The reveal dispatcher runs only inside the existing command transaction.
Per-target mutation methods validate before their own writes, but batch
atomicity is provided by rollback of the complete engine snapshot.

If this list fails on its final item:

```text
[assert_fact:a, resolve_question:q@a, set_primary_objective:primary_b; complete_current, grant_authorization:x]
```

then no fact, question, objective, authorization, acquisition event, local
unlock, or dialogue segment from the command remains installed.

The dispatcher does not expose a partial-success result.

### 8.6 Idempotence

A repeated target may produce `Unchanged`, but that is successful. Rules:

- repeated fact assertions union any new validated support and preserve the first
  origin;
- repeated open-question reveal is unchanged;
- repeated resolution by the same fact is unchanged;
- attempting to replace a resolver fact fails;
- repeated objective reveal/completion follows HPA-255 semantics;
- repeated identical primary selection without completion is unchanged;
- repeated grant preserves the first grant origin;
- repeated evidence/statement reveal does not append acquisition dialogue or a
  new acquisition event;
- local override sets do not duplicate entries.

Story targets do not create a second generic notification queue. Future analysis
result dialogue remains an authored ordered dialogue segment owned by the
analysis runtime.

## 9. Runtime expression evaluation

### 9.1 Context split

Rust retains scene-family context traits for local predicates and composes them
with a shared story context:

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

Investigation and interrogation evaluation keep their local methods and receive
access to the shared story context. HPA-259 supplies the analysis completion
state implementation.

### 9.2 `at_least`

Runtime evaluation is:

```text
true_count = number of child conditions that evaluate true
result = true_count >= count
```

The evaluator may short-circuit once `count` true children are found or once the
remaining children cannot meet the threshold. Evaluation has no side effects.

### 9.3 Monotonic property tests

Rust tests generate or enumerate representative expression trees and apply every
supported positive mutation. Once an expression becomes true, later mutations
must not make it false. The test matrix includes nested `at_least`, local
predicates, story predicates, and mixed `and`/`or` trees.

Active-primary replacement is included as a mutation but no expression can
observe active status, so replacement cannot reverse truth.

## 10. Whole-corpus reachability architecture

### 10.1 Separation from specialized gameplay analysis

The existing validator already understands details that a generic graph must not
reimplement:

- whether an investigation hotspot/topic is actually reachable inside a
  reachable sublocation;
- which entry reveals are guaranteed versus merely obtainable;
- whether a contradiction target can be held when an inquiry line is reached;
- intersections across alternative correct contradiction lines;
- required versus effectively forced optional interrogation phases;
- explicit and automatic outro completion.

Those algorithms remain in their focused modules during HPA-257. They emit
normalized reachability facts/nodes to the whole-corpus layer.

### 10.2 Normalized node model

`packages/scripts/compile-scenes/reachability.ts` owns a scene-neutral model:

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

Adapters provide stable qualified node keys, source locations, conditions,
implicit mutation prerequisites, effects, and mandatory/optional classification.
The normalized module does not parse Markdown or inspect scene-specific AST
internals.

### 10.3 Positive atoms

The fixed point tracks a finite set of positive atoms, including:

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

Only atoms with authored predicates need evaluator forms. Additional internal
atoms such as objective revealed or node reached may support transition analysis
without becoming author-visible predicates.

### 10.4 Seeds

The corpus adapter seeds:

- the first playable story entry according to current chapter/scene sequencing;
- blocks currently authored `unlocked` within an entered scene;
- existing scene-local initial/auto state supplied by specialized analyzers;
- no facts, questions, objectives, or authorizations merely because their
  definitions exist.

Story catalog definitions are not progress. A primary objective must be revealed
or set by an authored reachable event.

### 10.5 Fixed-point algorithm

The core algorithm is:

```text
reachable_nodes := all initially reachable nodes
positive_atoms  := effects guaranteed by initial nodes
possible_active_primary_ids := { null }

repeat
  snapshot the current positive atoms and possible primary candidates

  for each not-yet-reachable node in deterministic key order
    if its condition and implicit prerequisites are satisfied
      mark it reachable

  for each newly reachable node in deterministic key order
    validate/apply its positive effects to the abstract state

until no node, atom, or possible-primary candidate is added
```

The domain is finite:

- node keys come from finite parsed content;
- atoms come from finite definitions/local blocks;
- possible primary IDs come from finite catalog objectives;
- effects only add abstract facts.

Convergence is therefore guaranteed without an iteration cap. An internal guard
may still detect implementation bugs, but reaching it is an internal compiler
failure, not an authored-content diagnostic.

### 10.6 Implicit effect prerequisites

Some effects have prerequisites not written as unlock expressions:

- `resolveQuestion(q, f)` requires `fact_asserted:f`;
- explicit supporting facts for `assertFact` require those facts asserted;
- `grantAuthorization` requires a matching represented-authority context;
- analysis-derived effects may require the board's accepted completion;
- scene completion effects require the specialized scene analyzer to report the
  scene completable.

Adapters expose these as `implicitPrerequisites` so the fixed point cannot credit
an effect that runtime would reject.

### 10.7 Possible versus guaranteed results

The whole-corpus fixed point proves possible positive reachability. It does not
replace existing guaranteed-inventory and mandatory-completion analyses.

Use the two concepts as follows:

| Question | Owner |
|---|---|
| Can some valid positive path reach this block/effect? | HPA-257 whole-corpus fixed point |
| Is this evidence/reveal unavoidable before a later existing scene? | existing specialized guaranteed-flow analysis |
| Does every objective-transition ordering complete the same primary? | not promised |
| Does runtime keep zero or one active primary? | HPA-255 scalar mutation |

This distinction prevents HPA-257 from becoming an exponential state-space
model checker while retaining the stronger existing guarantees where they
already exist.

## 11. Primary-objective abstract reachability

### 11.1 Target validation

Every `setPrimaryObjective` effect is validated before fixed-point execution:

- null is allowed;
- a non-null ID must exist;
- a non-null target must be `kind: primary`;
- `completeObjective` may not target a primary;
- a batch may contain at most one primary transition.

### 11.2 Possible active candidates

The fixed point maintains a monotonic set:

```text
possibleActivePrimaryObjectiveIds: Set<string | null>
```

It begins with `null` because HPA-255 story state begins empty.

For a reachable transition:

```text
setPrimaryObjective(completeCurrent = false, next = X)
```

the analyzer adds `X` (or `null`) to the possible set and marks a non-null next
objective revealed.

For:

```text
setPrimaryObjective(completeCurrent = true, next = X)
```

it additionally marks every currently possible non-null active candidate as
possibly completed, then adds the next candidate.

The analyzer does not remove older candidates because this is a monotonic
may-analysis over alternative paths. It does not claim all candidates coexist at
runtime.

### 11.3 Ordering warning

When a `completeCurrent` transition sees more than one possible non-null current
ID, the compiler emits one deterministic warning:

```text
primaryObjectiveOrderingNotExhaustive
```

The warning states that reachability is existence-oriented and runtime outcome
depends on the scalar objective active on the executed path. It does not fail
compilation merely because more than one ordering is possible.

A uniquely known current objective may satisfy a downstream
`objective:<id> completed` path without this warning.

This fulfills HPA-257's requirement to account for HPA-255 transitions while
preserving the explicit non-goal of exhaustive combinatorial proof.

## 12. Cycle and self-reference validation

### 12.1 Dependency graph

After all references resolve, the compiler constructs a directed dependency
graph from producers to consumers:

- a node depending on a positive atom has edges from every authored producer of
  that atom;
- implicit effect prerequisites create equivalent edges;
- local reveal/unlock dependencies are qualified by scene/block identity;
- global story-state dependencies may cross scene and chapter boundaries.

For `or` and `at_least`, every referenced producer participates in dependency
analysis. The graph is intentionally strict rather than trying to prove a
cyclic branch is avoidable.

### 12.2 Rejection policy

The compiler rejects:

- a node whose condition depends on an atom produced only by itself;
- a fact assertion whose explicit support transitively depends on that same
  fact;
- any strongly connected component containing more than one reachability node;
- a self-loop in a one-node component.

An external seed does not legalize an authored cycle. This makes dependency
review deterministic and keeps future content from becoming order-sensitive.
Authors break the cycle by introducing a one-directional seed event or by
removing the backwards dependency.

### 12.3 Diagnostics

Cycle errors point at one authored dependency use and include a stable minimal
cycle path, for example:

```text
fact:a → board:chapter_1@analysis_scene_1@board_b → fact:b → board:chapter_1@analysis_scene_1@board_a → fact:a
```

The compiler emits one canonical diagnostic per strongly connected component,
not one error for every edge.

Existing `lockedBlockUnreachable` diagnostics remain for legacy scene-local
content. The validator suppresses duplicate generic reachability errors for the
same legacy block when the specialized validator has already reported it.

## 13. Mandatory, optional, and authorization reachability

### 13.1 Requirement classification

Adapters classify normalized nodes:

- existing scene entry/completion requirements retain current specialized
  semantics;
- existing locked investigation/interrogation blocks retain current error
  behavior;
- future required analysis boards/cards are mandatory;
- future optional boards/cards are optional;
- authority grants required by mandatory content are mandatory outputs;
- catalog definitions alone are neither mandatory nor optional gameplay nodes.

### 13.2 Post-convergence diagnostics

After convergence:

- each unreachable new mandatory node is an error;
- each unreachable new optional node is a warning;
- each mandatory predicate atom with no reachable producer is an error;
- an optional unreachable atom produces a warning only through the optional node
  that requires it, avoiding duplicate noise;
- a reachable node whose runtime effect has unsatisfied implicit prerequisites
  is an error at the effect source.

### 13.3 Authorization gates

For every mandatory content condition containing
`authorization:<id> granted`, the compiler verifies:

1. the authorization definition exists;
2. at least one `grantAuthorization` producer exists;
3. each candidate producer represents the matching authority;
4. at least one matching producer is reachable at the fixed point.

Failure code:

```text
mandatoryAuthorizationUnreachable
```

The message names the authorization, its granting authority, the mandatory
consumer, and the closest authored grant producer if one exists but is
unreachable.

An optional authorization-gated node with no reachable grant produces
`optionalContentUnreachable`, not a hard error.

## 14. Reference and semantic validation

### 14.1 Story predicates

The compiler validates:

- facts against `StoryCatalog.facts`;
- global questions against `StoryCatalog.questions`;
- objectives against `StoryCatalog.objectives`;
- authorizations against `StoryCatalog.authorizations`;
- qualified analysis refs against the registered analysis definition index.

Typed namespaces may reuse a slug; the predicate kind determines the registry.

### 14.2 Story reveal targets

The compiler validates:

- every target definition exists;
- each question resolver fact is listed in that question's `resolvedByFactIds`;
- every `completeObjective` target is secondary;
- every non-null primary target is primary;
- every grant's authority context matches the authorization definition;
- any context-supplied supporting record/fact reference resolves;
- supporting facts do not form cycles.

### 14.3 Source locations

Every diagnostic includes `sourceFile` and one-based `line`. HPA-257 does not add
column tracking. For expressions and reveal lists, the metadata line is the
source location. Qualified analysis references retain the containing metadata
line until HPA-259 provides finer-grained board-field locations.

### 14.4 Warnings

New warning codes are deterministic and non-blocking:

- `optionalContentUnreachable`;
- `primaryObjectiveOrderingNotExhaustive`.

Warnings sort using the compiler's existing canonical source-path/line/code
ordering and participate in existing warning snapshots.

## 15. Diagnostic code contract

HPA-257 adds or reserves these compiler codes:

| Code | Severity | Meaning |
|---|---|---|
| `unlockAtLeastInvalidCount` | error | count is not a positive base-10 integer |
| `unlockAtLeastEmptyConditions` | error | no child condition is present |
| `unlockAtLeastCountExceedsConditions` | error | count is larger than child count |
| `unlockAtLeastDuplicateCondition` | error | structurally duplicate child condition |
| `unresolvedStoryPredicate` | error | global fact/question/objective/authorization ref missing |
| `unresolvedAnalysisPredicate` | error | qualified analysis scene/board ref missing |
| `storyRevealUnresolved` | error | story reveal target definition missing |
| `invalidQuestionResolutionTarget` | error | fact cannot resolve the named question |
| `primaryObjectiveCompletionRequiresSet` | error | direct complete target names a primary objective |
| `invalidPrimaryObjectiveTarget` | error | non-null target missing or secondary |
| `duplicateStoryRevealTarget` | error | duplicate/contradictory new target in one batch |
| `authorizationGrantOutsideAuthorityEvent` | error | grant lacks represented authority context |
| `authorizationGrantAuthorityMismatch` | error | context authority differs from definition |
| `positiveSelfReference` | error | node/effect depends on itself |
| `positiveDependencyCycle` | error | multi-node positive dependency SCC |
| `requiredContentUnreachable` | error | mandatory new node not reached |
| `mandatoryAuthorizationUnreachable` | error | required authorization has no reachable matching grant |
| `optionalContentUnreachable` | warning | optional new node not reached |
| `primaryObjectiveOrderingNotExhaustive` | warning | possible active-primary set is ambiguous at completion |

Legacy parser/validator errors retain their existing codes where applicable.
The implementation plan may split a parse code into more specific syntax codes
only if tests and authoring guidance remain deterministic; it may not collapse
semantic errors into a generic `invalidUnlock` message.

## 16. Module ownership

### 16.1 Compiler

Expected focused changes:

```text
packages/scripts/compile-scenes/
  types.ts                 extend concrete predicates/targets and shared aliases
  parser-unlock.ts         shared recursive parser + context predicate adapters
  parser-investigation.ts  consume shared reveal-target parser
  parser-interrogation.ts  consume shared reveal-target parser
  parser-reveals.ts        new shared local/story reveal list parser
  validator.ts             retain specialized validation; invoke corpus analysis
  reachability.ts          new normalized graph, cycles, fixed point, diagnostics
  story-catalog.ts         reuse target validation helpers
  emitter.ts               emit new nodes without changing legacy output
```

The implementation plan may choose a nearby filename for the shared reveal
parser, but it must not duplicate the story-target grammar in every scene parser.

### 16.2 Shared package boundary

`packages/scene-types/src/index.ts` continues to own only values required
byte-identically by its current editor/runtime consumers. The existing local
reveal union may be exposed as:

```ts
type SceneLocalRevealTarget = ...;
type RevealTarget = SceneLocalRevealTarget; // compatibility alias
```

Compiler scene JSON composes `SceneLocalRevealTarget | StoryRevealTarget` in its
own types. Global catalog mutations and hidden analysis solutions do not move to
`@lyra/scene-types`.

### 16.3 Rust

Expected focused changes:

```text
apps/game/src-tauri/src/game/
  schema.rs                add expression/target wire variants
  unlock.rs                evaluate shared story predicates and at_least
  reveals.rs               shared story-target dispatcher and scene adapters
  story/                   reuse existing catalog/state/mutations unchanged except
                           narrowly required accessors or test support
  save/                    tests only; no schema field/version change
```

A small helper module under `game/` is acceptable if `reveals.rs` would otherwise
mix parsing-independent dispatch, authority validation, and dialogue assembly.
HPA-255 mutation implementations remain in `story/mutations.rs`.

### 16.4 Frontend and IPC

No frontend state type changes are required because HPA-258 already exposes the
resulting story progress. No new command is registered. Unlock refresh remains a
consequence of existing gameplay commands returning a new `GameStateView`.

## 17. Save, restore, and content compatibility

### 17.1 Save schema

HPA-257 adds no mutable field. Existing saves already contain:

- inventory IDs and acquisition state;
- investigation/interrogation local progress and override sets;
- story facts, questions, objectives, authorizations, and active primary;
- dialogue/acquisition queues and generation state.

Therefore:

- save schema remains version 2;
- no migration is added;
- `StoryState::from_snapshot` remains the validation gate;
- restore remains transactional;
- recapture after restore must reproduce the same public view.

### 17.2 Content identity

Existing content that does not use new expression/target variants emits the same
canonical scene JSON. Compiler implementation changes alone do not alter the
content revision.

Once authored content uses a new predicate, `at_least`, or story reveal target,
the emitted resource naturally changes and therefore changes the package content
revision through the existing manifest algorithm. HPA-257 does not special-case
or mask that change.

### 17.3 Round-trip requirement

A save/load integration fixture must demonstrate:

1. collect evidence;
2. assert a fact;
3. resolve a question;
4. complete a secondary objective;
5. transition the primary objective through HPA-255;
6. grant an authorization from a matching authority event;
7. unlock later content through a nested `at_least` expression;
8. save, restart, load, and observe every positive state and unlocked block
   preserved;
9. repeat the original reveal command and observe no duplicated effect.

No previously unlocked block may become locked after restore.

## 18. Test strategy

### 18.1 Parser compatibility

- snapshot every existing valid legacy expression;
- prove binary tree associativity and `and` precedence remain unchanged;
- run the existing Chapter 1 scene compile golden unchanged;
- compile every existing investigation/interrogation fixture without migration;
- reject new story predicates in a context that has not opted into the shared
  story predicate set.

### 18.2 `at_least`

Compiler and Rust tests cover:

- one-of-one;
- all-of-N;
- nested threshold expressions;
- thresholds containing binary `and`/`or` children;
- thresholds nested inside binary expressions;
- invalid zero/negative/fractional/oversized counts;
- empty conditions;
- duplicate normalized conditions;
- runtime short-circuit behavior without side effects.

### 18.3 Reference and target validation

Fixtures cover:

- unresolved fact, question, objective, and authorization refs;
- malformed and unresolved qualified analysis refs;
- duplicate qualified analysis definitions supplied by a synthetic registry;
- invalid question resolver candidate;
- primary target naming a secondary objective;
- direct completion of a primary objective;
- duplicate/contradictory story targets in one batch;
- grant outside authority context;
- grant authority mismatch.

### 18.4 Reachability

Synthetic whole-corpus fixtures cover:

- initial node → evidence → fact → resolved question → objective → grant → later
  content;
- reveal chains that require more than one fixed-point iteration;
- nested `at_least` becoming true only after separate branches contribute;
- direct self-reference;
- two-node and longer cycles;
- a seeded but syntactically cyclic branch, which still fails under the strict
  cycle policy;
- unreachable mandatory content;
- unreachable optional content warning;
- mandatory authorization with no grant producer;
- matching grant producer that exists but is unreachable;
- matching reachable authority grant;
- existing legacy specialized diagnostics without duplicate generic errors.

### 18.5 Primary objective

Compiler/Rust tests cover:

- null → primary A;
- A → B without completing A;
- A → B while completing A;
- A → null while completing A;
- invalid secondary next target;
- attempting to complete and retain the same current objective;
- downstream `objective:A completed` reachability through a unique chain;
- ambiguous possible-current warning;
- runtime zero-or-one active invariant after every transition.

### 18.6 Atomicity and idempotence

A Rust integration test applies a mixed batch and forces the last effect to fail.
It asserts exact rollback of:

- inventory;
- acquisition events and ordinals;
- local unlock overrides;
- facts/questions/objectives/authorizations;
- active primary objective;
- dialogue segments/history;
- command generation state covered by the transaction.

A second test repeats a successful mixed batch and proves no duplicate
acquisition, grant, origin, dialogue, or objective transition effect.

### 18.7 Ownership guard

HPA-257 adds both behavioral and source-boundary coverage:

1. behavioral tests assert the dispatcher produces the exact HPA-255 transition
   table outcomes;
2. a focused source test asserts the reveal dispatcher calls
   `set_primary_objective` and does not contain direct writes to
   `active_primary_objective_id` or the objective progress map;
3. Rust privacy continues to prevent sibling modules from accessing HPA-255's
   private mutation fields.

This satisfies the ticket's explicit requirement to prove delegation rather
than merely reproducing equivalent behavior.

### 18.8 Verification gate

The implementation PR must pass:

- `bun run scenes:compile`;
- the complete script/compiler test suite;
- the complete Rust test suite;
- frontend/workspace tests, even though no UI behavior changes;
- TypeScript/Svelte/Rust checks;
- ESLint, Prettier, rustfmt, and warnings-denied Clippy;
- content-revision golden checks;
- targeted save/restore integration coverage.

Packaged Tauri E2E is required only if implementation changes an existing
player-visible authored path or command timing. The focused implementation plan
must state whether its synthetic runtime fixture is sufficient or whether a
packaged opt-in story fixture is added.

## 19. Authoring guidance changes

The canonical repository authoring skills are updated after implementation:

- `.claude/skills/writing-investigation-scene/SKILL.md`;
- `.claude/skills/writing-interrogation-scene/SKILL.md`;
- the future analysis-scene skill added by HPA-259.

Guidance must include:

- all shared story predicates;
- exact qualified analysis reference syntax;
- `at_least` examples and invalid counts;
- the prohibition on negative gates;
- exact story reveal target forms;
- primary-objective transition ownership;
- authority-event grant restriction;
- strict cycle policy;
- optional-unreachable warning behavior;
- the statement that definitions do not imply initial progress.

No duplicate `.agents/skills` source is introduced unless a separate repository
policy change establishes it as canonical.

## 20. Rejected alternatives

### 20.1 One unrestricted expression union

Rejected because it would allow investigation-only topics, interrogation-only
phases, and future analysis-only predicates in contexts that cannot evaluate
them. Shared recursion and context-specific predicates provide reuse without
weakening validation.

### 20.2 Expand `at_least` into `and`/`or`

Rejected because the expansion is combinatorial, damages source diagnostics,
and would make nested threshold expressions impractical.

### 20.3 Generic `not`

Rejected because it breaks monotonic truth, complicates static reachability and
save compatibility, and creates content that may re-lock after valid progress.

### 20.4 A generic string flag map

Rejected because facts, questions, objectives, authorizations, inventory, and
scene completion already have typed definitions, state, validation, views, and
save contracts.

### 20.5 Duplicate primary-objective logic in reveals

Rejected because HPA-255 already owns validation, completion/replacement, and the
single active scalar. A second implementation would drift and violate the ticket
ownership contract.

### 20.6 Automatic question resolution from asserted facts

Rejected because one fact may be a resolver candidate for multiple questions,
questions may have multiple candidates, and story timing requires explicit
authored resolution.

### 20.7 Let any block grant authorization

Rejected because analysis establishes readiness but represented institutions
grant access. The dispatcher requires authority context and HPA-264 supplies the
production hearing/request surface.

### 20.8 Replace existing specialized reachability code

Rejected because current investigation/interrogation analyses encode gameplay
semantics that a generic graph cannot safely reconstruct. The whole-corpus layer
consumes adapters instead.

### 20.9 Allow externally seeded cycles

Rejected for this slice. Strict acyclicity is easier to review, diagnose, and
maintain. A future design may relax the rule without invalidating existing
acyclic content; accepting cycles now would make later tightening breaking.

### 20.10 Exhaustive objective state-space search

Rejected because the program contract explicitly uses one runtime scalar for
uniqueness and does not promise proof of every transition ordering. HPA-257 uses
finite may-analysis plus ambiguity warnings.

### 20.11 Save-schema bump

Rejected because every resulting mutation already has an owned persisted field.
Adding expression syntax does not itself create new mutable save data.

## 21. Acceptance-criteria mapping

| HPA-257 acceptance criterion | Design mechanism |
|---|---|
| Existing unlock expressions compile and behave identically | parser wrappers, concrete context unions, legacy JSON golden |
| Invalid counts fail with locations | §5.5, §15 diagnostics |
| Unresolved/ambiguous refs fail | §5.4, §14 |
| Cycles and self-reference fail | §12 strict SCC policy |
| Unreachable required content fails | §13 mandatory diagnostics |
| Authority gates without grant paths fail | §13.3 |
| Fixed point accounts for primary transitions | §11 possible-active abstraction |
| No exhaustive ordering claim | §10.7 and §11.3 warning |
| Delegates objective mutation | §8.2 mapping and §18.7 source guard |
| No mutation re-locks content | §4.1 invariant/property tests |
| Reveal dispatch atomic/idempotent | §8.5–8.6 and §18.6 |
| Nested `at_least` compiler/Rust tested | §18.2 |
| Save/load preserves monotonic state | §17.3 round-trip fixture |

## 22. Implementation-plan handoff

The executable implementation plan should decompose this design into small TDD
slices rather than one broad parser/validator rewrite. At minimum it should
separate:

1. legacy parser characterization and shared combinator extraction;
2. `at_least` parser/types/emission/Rust serde;
3. shared story predicates and reference validation;
4. shared story reveal target parsing and catalog validation;
5. normalized reachability model and strict cycle diagnostics;
6. investigation/interrogation adapters without deleting specialized analyses;
7. Rust story predicate evaluation;
8. atomic/idempotent story reveal dispatch and authority validation;
9. primary-objective delegation/source guard;
10. save/restore and compatibility gates;
11. authoring guidance and final whole-branch verification.

The implementation plan must name exact files and tests after re-reading `main`.
It may refine private helper names, but it may not change the behavior, ownership,
wire shapes, grammar, cycle policy, or compatibility decisions fixed here.
