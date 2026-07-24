# HPA-255 Global Story Catalog and State Design

**Status:** Approved in conversation  
**Issue:** HPA-255 — Add global story catalog and durable fact/question/objective/authorization state  
**Date:** 2026-07-24

## 1. References and scope

This focused design refines:

- `docs/superpowers/specs/2026-07-19-detective-gameplay-systems-design.md`
  §§7.3, 9, and 11;
- `docs/superpowers/plans/2026-07-19-detective-gameplay-systems-implementation-plan.md`
  epic P0.1;
- the HPA-55 engine seams now present in `game/command_tx.rs`,
  `game/dialogue.rs`, and `game/navigation.rs`.

HPA-255 separates immutable compiled definitions from Rust-owned mutable
progress. It delivers:

- one optional authored global story catalog;
- a versioned generated catalog artifact;
- global and qualified ID validation;
- Rust catalog loading, mutable story state, and typed mutations;
- a filtered public story-state view;
- serialization-ready mutable state for HPA-129.

It does not implement save files, scene reveal dispatch, new unlock predicates,
fixed-point reachability, analysis scenes, case-file UI, or production story
catalog content.

## 2. Approved decisions

1. Authors use one optional top-level `story_catalog.md`.
2. Exactly one catalog may exist across the merged `static/stories_plan/` and
   `docs/stories_plan/` roots.
3. A missing authored catalog compiles to a versioned empty artifact.
4. HPA-255 publishes a filtered `StoryStateView` now, but adds no UI.
5. Every mutable story-state category begins empty. Initial progress is not
   authored in the catalog.
6. HPA-257 owns authored reveal dispatch. HPA-255 owns the typed story-state
   mutation APIs, including the sole `setPrimaryObjective` implementation.
7. The implementation uses one dedicated catalog artifact and one cohesive
   `StoryState` aggregate rather than separate per-category stores or a generic
   flag map.
8. Supporting case records refine the parent design's untyped
   `supportingRecordIds: string[]` into typed evidence/statement references.
   This is an approved compatibility refinement: evidence and statement
   namespaces may reuse a slug, and the existing `InventoryTarget` wire shape
   already carries the required target kind.
9. A resolved question exposes only its applied `resolvedByFactId` after
   resolution. The immutable candidate `resolvedByFactIds` list remains hidden.

## 3. Current constraints

The existing compiler:

- merges chapter directories from two optional source roots;
- parses Markdown into source-located AST values;
- validates all parsed scenes together;
- emits `chapters.json` and per-scene JSON;
- already treats evidence and statement IDs as game-global;
- keeps scene-local reveal targets qualified by target kind.

The existing runtime:

- loads chapter and scene definitions from Tauri resources;
- owns mutable gameplay state in `GameEngine`;
- rolls commands back through `EngineRollbackSnapshot`;
- builds an infallible `GameStateView`;
- applies current investigation/interrogation reveals in `game/reveals.rs`.

HPA-255 must extend those boundaries without duplicating authored definitions
inside mutable state or bypassing the HPA-55 transaction seam.

## 4. Authoring contract

### 4.1 Location and discovery

The compiler looks for:

```text
<source-root>/story_catalog.md
```

for every configured source root.

- No file: use an empty AST catalog.
- One file: parse it.
- More than one file: emit `duplicateStoryCatalog` at the second file and name
  both source paths in the message.
- An unreadable discovered file: emit `storyCatalogUnreadable`.

Catalog discovery occurs before validation but does not change chapter
discovery. Existing chapter trees compile without an authored migration.

### 4.2 Markdown shape

The canonical shape is:

```md
# Story Catalog

## Facts

### Fact: 門鎖時間線不一致 {#door_timeline_conflict}

- **Summary:** 兩份時間紀錄無法同時成立。
- **Details:** 門鎖與咖啡機紀錄存在矛盾。
- **Category:** timeline

## Questions

### Question: 誰修改了時間紀錄？ {#who_changed_timeline}

- **Summary:** 確認哪份紀錄遭到修改。
- **Resolved By:** [fact:door_timeline_conflict]

## Objectives

### Objective: 查明時間線矛盾 {#resolve_timeline}

- **Summary:** 比對所有可驗證的時間來源。
- **Kind:** primary
- **Sort Order:** 10

## Authorizations

### Authorization: 調閱門鎖紀錄 {#access_lock_logs}

- **Summary:** 允許取得原始門鎖稽核資料。
- **Granting Authority:** 警視廳搜查一課
```

Rules:

- The H1 is exactly `Story Catalog`.
- The optional H2 sections use the canonical order shown above. This is a hard
  parser rule: present sections must appear in that relative order. A section
  may be omitted or present with no entries.
- Every H2 may appear at most once.
- Each H3 belongs to the immediately preceding canonical H2. H3 entries may use
  any authored order within their section, but may not appear before an H2 or
  be interleaved across sections.
- Item labels come from their H3 headings; IDs come from `{#lowercase_slug}`.
  Every new catalog ID and qualified-reference segment validated by this slice
  uses the exact existing slug expression `^[a-z0-9_]+$`.
- Metadata keys are exact and closed. Unknown, missing, or repeated keys are
  source-located errors.
- `Summary`, `Details`, `Category`, and `Granting Authority` must be non-empty.
- `Kind` is `primary` or `secondary`.
- `Sort Order` is a base-10 integer. Equal values are allowed; runtime/public
  ordering uses `(sortOrder, id)` for a deterministic tie-break.
- `Resolved By` is a required list of `fact:<id>` references. It may be empty
  for a deliberately still-open question; HPA-257 owns reachability checks for
  questions that must resolve. The concrete empty form is
  `- **Resolved By:** []`; a blank metadata value is malformed.
- The file contains definitions only. It has no `Status`, `Revealed`,
  `Completed`, `Granted`, or active-primary metadata.

No production `story_catalog.md` is added in HPA-255. Parser fixtures establish
the format while the live Chapter 1 sources exercise the absent-file path.

## 5. Compiler model and emitted artifact

### 5.1 AST ownership

Compiler-only AST and JSON wire types remain in `@lyra/scripts`. HPA-255 does
not broaden `@lyra/scene-types`, whose current contract is editor-shared
scene/layout data.

The new source-located AST contains:

```ts
type ASTStoryCatalog = Located<{
  facts: ASTFactDefinition[];
  questions: ASTQuestionDefinition[];
  objectives: ASTObjectiveDefinition[];
  authorizations: ASTAuthorizationDefinition[];
}>;
```

Each definition retains its source file and heading line. References also
retain their metadata line so unresolved-reference diagnostics point to the
authored use rather than only the containing item.

### 5.2 Generated JSON

The compiler always emits:

```text
apps/game/src-tauri/resources/scenes/story_catalog.json
```

with this version-1 shape:

```ts
type StoryCatalogJson = {
  schemaVersion: 1;
  facts: FactDefinition[];
  questions: QuestionDefinition[];
  objectives: ObjectiveDefinition[];
  authorizations: AuthorizationDefinition[];
  evidenceIndex: CaseRecordDefinitionIndex[];
  statementsIndex: CaseRecordDefinitionIndex[];
};

type FactDefinition = {
  id: string;
  label: string;
  summary: string;
  details: string;
  category: string;
};

type QuestionDefinition = {
  id: string;
  label: string;
  summary: string;
  resolvedByFactIds: string[];
};

type ObjectiveDefinition = {
  id: string;
  label: string;
  summary: string;
  kind: "primary" | "secondary";
  sortOrder: number;
};

type AuthorizationDefinition = {
  id: string;
  label: string;
  summary: string;
  grantingAuthority: string;
};

type CaseRecordDefinitionIndex = {
  id: string;
  chapterId: string;
  sceneId: string;
};
```

Facts, questions, and authorizations preserve authored order in the artifact.
Objectives emit in deterministic `(sortOrder, id)` order. Evidence and
statement indexes are derived from parsed scene manifests and sorted by `id`.
Each typed record ID is already game-global-unique, so chapter/scene values are
origins rather than meaningful sort tie-breakers.

Evidence and statement prose remains owned by its scene definition. The global
artifact is an index, not a second authored copy.

### 5.3 Namespace and reference validation

The compiler constructs typed definition indexes after every chapter and scene
has parsed successfully enough to contribute definitions.

Validation rules:

- fact IDs are unique game-wide;
- question IDs are unique game-wide;
- objective IDs are unique game-wide;
- authorization IDs are unique game-wide;
- evidence IDs remain unique game-wide;
- statement IDs remain unique game-wide;
- scene IDs are unique within a chapter;
- typed namespaces may reuse the same slug because references carry a target
  kind;
- every `resolvedByFactIds` value resolves to a fact;
- all durable analysis board references use
  `{chapterId, sceneId, boardId}`—never a bare board ID.

HPA-255 introduces the qualified `AnalysisBoardRef` type and validation helper,
but does not introduce board definitions. Until HPA-259 supplies a board
definition index, the helper can validate only the qualified shape, exact slug
syntax, and non-empty fields; it cannot prove that the named board exists.
HPA-259 consumes the contract and adds referential validation.

`duplicateSceneId` is new compiler validation in HPA-255. The runtime already
rejects duplicate scene IDs, but the current compiler does not diagnose them
globally within a chapter.

The compiler also exposes a source-located
`validateSetPrimaryObjectiveTarget(catalog, nextObjectiveId, location)` helper.
It accepts `null`; otherwise the target must exist and have `kind: primary`.
HPA-257 calls this helper when it introduces authored reveal dispatch.

Emission occurs only after parsing and validation have no errors. A failed
catalog compile cannot partially update `story_catalog.json`.

## 6. Rust architecture

HPA-255 adds a focused `game/story/` subsystem:

```text
story/
  mod.rs        public-in-game exports
  catalog.rs    JSON schema, loading, and definition indexes
  state.rs      sparse mutable progress and durable origins
  mutations.rs  validated atomic/idempotent state changes
  view.rs       filtered public view construction
```

### 6.1 Engine ownership

`GameEngine` gains:

```text
story_catalog: StoryCatalog
story_state: StoryState
```

`story_catalog` is immutable after startup. `story_state` is mutable and
rollback-tracked.

`EngineRollbackSnapshot` keeps its exhaustive field classification:

- `story_catalog` is explicitly destructured but not copied;
- `story_state` is captured and restored symmetrically.

This keeps the compiler-enforced list of mutable engine state authoritative for
HPA-129.

### 6.2 Startup

`GameEngine::new_started` loads and validates `chapters.json`,
`story_catalog.json`, and the initial scene before returning an engine.

The runtime requires `story_catalog.json`; the compiler's unconditional empty
artifact is the compatibility path. Missing, unreadable, unsupported-version,
or internally invalid catalog data produces a typed startup error and no engine
is installed in `AppState`.

Developers running against a pre-HPA-255 local resource tree must run
`bun run scenes:compile` once to create the required empty catalog. Packaged
builds already compile scenes through Tauri's `beforeBuildCommand`.

Runtime validation is defense-in-depth for packaged resource corruption. It
checks schema version, per-kind duplicate IDs, question fact references,
objective kinds, and case-record index duplicates. The compiler remains
responsible for source-level diagnostics.

## 7. Mutable story state

### 7.1 Representation

`StoryState` is a cohesive, sparse, monotonic aggregate keyed by stable IDs:

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::game) struct FactProgress {
    asserted_in_chapter_id: Option<String>,
    asserted_in_scene_id: Option<String>,
    first_origin: AssertionOrigin,
    supporting_records: BTreeSet<InventoryTarget>,
    supporting_fact_ids: BTreeSet<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::game) struct QuestionProgress {
    // None means open; Some(id) means resolved by that asserted fact.
    resolved_by_fact_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::game) struct ObjectiveProgress {
    completed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::game) struct AuthorizationProgress {
    granted_in_chapter_id: Option<String>,
    granted_in_scene_id: Option<String>,
    first_origin: AssertionOrigin,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoryState {
    facts: BTreeMap<String, FactProgress>,
    questions: BTreeMap<String, QuestionProgress>,
    objectives: BTreeMap<String, ObjectiveProgress>,
    authorizations: BTreeMap<String, AuthorizationProgress>,
    active_primary_objective_id: Option<String>,
}
```

Presence means the definition has entered durable player state:

- a fact entry is asserted;
- a question entry is revealed;
- an objective entry is revealed;
- an authorization entry is granted.

Progress never moves backward. The state stores no labels, summaries, ordering,
granting authorities, resolution rules, or other authored definition data.

Live `StoryState` must satisfy these cross-field invariants:

- every progress-map key resolves to a definition of the matching kind;
- every stored supporting record/fact resolves and every supporting fact is
  asserted;
- every resolved question names a valid asserted resolver fact from its
  definition;
- `active_primary_objective_id` is either null or resolves to a primary
  objective whose progress entry exists, is revealed, and is incomplete.

Serialization uses these separate untrusted shapes:

```rust
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoryStateSnapshot {
    pub facts: BTreeMap<String, FactProgressSnapshot>,
    pub questions: BTreeMap<String, QuestionProgressSnapshot>,
    pub objectives: BTreeMap<String, ObjectiveProgressSnapshot>,
    pub authorizations: BTreeMap<String, AuthorizationProgressSnapshot>,
    pub active_primary_objective_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FactProgressSnapshot {
    pub asserted_in_chapter_id: Option<String>,
    pub asserted_in_scene_id: Option<String>,
    pub first_origin: AssertionOrigin,
    pub supporting_records: BTreeSet<InventoryTarget>,
    pub supporting_fact_ids: BTreeSet<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuestionProgressSnapshot {
    pub resolved_by_fact_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ObjectiveProgressSnapshot {
    pub completed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthorizationProgressSnapshot {
    pub granted_in_chapter_id: Option<String>,
    pub granted_in_scene_id: Option<String>,
    pub first_origin: AssertionOrigin,
}
```

Raw deserialization never constructs live `StoryState`; the live aggregate and
progress structs do not derive `Deserialize`.
`StoryState::from_snapshot(&StoryCatalog, StoryStateSnapshot)` validates every
catalog reference, structurally validates origins, re-derives and compares
their nullable locations, and validates every cross-field invariant before
returning live state. Failure returns a typed error without exposing a partial
state. `StoryState::snapshot()` produces the serializable form.

```rust
impl StoryState {
    pub(crate) fn snapshot(&self) -> StoryStateSnapshot;

    pub(crate) fn from_snapshot(
        catalog: &StoryCatalog,
        snapshot: StoryStateSnapshot,
    ) -> Result<Self, GameError>;
}
```

This snapshot is not the HPA-129 `SaveSnapshot` envelope contract. HPA-129 may
wrap or migrate it explicitly, but must pass restored progress through the same
validating constructor before installing it.

### 7.2 Durable origins

Facts and authorizations record the first durable origin:

```rust
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AssertionOrigin {
    SceneEvent {
        chapter_id: String,
        scene_id: String,
        block_kind: StoryEventBlockKind,
        block_id: String,
    },
    AnalysisBoard {
        chapter_id: String,
        scene_id: String,
        board_id: String,
    },
    Migration {
        migration_id: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StoryEventBlockKind {
    Sublocation,
    Hotspot,
    Topic,
    InterrogationPhase,
    InquiryQuestion,
    TestimonyLine,
    StoryEvent,
}
```

The listed `StoryEventBlockKind` variants are the complete HPA-255 wire
contract. The enum is not a generic string flag. Adding another serialized
variant requires an explicit catalog/save compatibility decision.

Fact and authorization progress also retain nullable chapter/scene location
fields for the parent design's public/save contract. Those fields are derived
from the origin, never accepted as independent mutation arguments:

- `SceneEvent` and `AnalysisBoard` produce their embedded chapter and scene;
- `Migration` produces null chapter and scene.

This prevents an origin and separately supplied location from disagreeing.

Supporting case records use the existing typed inventory-target shape
(`evidence` or `statement` plus ID), avoiding ambiguity when two typed
namespaces reuse a slug. HPA-255 adds `PartialOrd` and `Ord` derives to
`InventoryTarget` so it can be stored in a deterministic `BTreeSet`.
Supporting facts use global fact IDs.

At this foundation stage, origin validation is structural. In particular,
`AnalysisBoard` can validate the qualified IDs and location consistency but
cannot prove `board_id` exists until HPA-259 supplies board definitions.

### 7.3 Mutation result

The mutation surface is restricted to `crate::game`; it is not registered as
Tauri IPC. HPA-257's reveal dispatcher is the first production caller. These
are the complete HPA-255 signatures:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::game) enum MutationOutcome {
    Changed,
    Unchanged,
}

impl StoryState {
    pub(in crate::game) fn assert_fact(
        &mut self,
        catalog: &StoryCatalog,
        fact_id: &str,
        origin: AssertionOrigin,
        supporting_records: &[InventoryTarget],
        supporting_fact_ids: &[String],
    ) -> Result<MutationOutcome, GameError>;

    pub(in crate::game) fn reveal_question(
        &mut self,
        catalog: &StoryCatalog,
        question_id: &str,
    ) -> Result<MutationOutcome, GameError>;

    pub(in crate::game) fn resolve_question(
        &mut self,
        catalog: &StoryCatalog,
        question_id: &str,
        fact_id: &str,
    ) -> Result<MutationOutcome, GameError>;

    pub(in crate::game) fn reveal_objective(
        &mut self,
        catalog: &StoryCatalog,
        objective_id: &str,
    ) -> Result<MutationOutcome, GameError>;

    pub(in crate::game) fn complete_objective(
        &mut self,
        catalog: &StoryCatalog,
        objective_id: &str,
    ) -> Result<MutationOutcome, GameError>;

    pub(in crate::game) fn set_primary_objective(
        &mut self,
        catalog: &StoryCatalog,
        complete_current: bool,
        next_objective_id: Option<&str>,
    ) -> Result<MutationOutcome, GameError>;

    pub(in crate::game) fn grant_authorization(
        &mut self,
        catalog: &StoryCatalog,
        authorization_id: &str,
        origin: AssertionOrigin,
    ) -> Result<MutationOutcome, GameError>;
}
```

Callers can use the outcome for future dialogue/acquisition decisions without
reimplementing deduplication. Slice inputs are read-only; each method validates
the complete request and constructs any candidate progress value before its
first write.

## 8. Mutation semantics

Every mutation takes `&StoryCatalog`, resolves and validates every input first,
and only then changes `StoryState`. Expected failures use typed `GameError`
codes rather than panics.

### 8.1 Facts

`assert_fact`:

1. requires the target fact definition;
2. validates every supporting evidence/statement against the derived indexes;
3. requires every supporting fact to exist in the catalog and already be
   asserted;
4. creates the fact with its assertion location and first origin, or
   monotonically unions new supporting records/facts into an existing fact;
5. never replaces the first origin.

Repeating the same assertion and support is `Unchanged`.

HPA-255 validates only that a supporting record exists in the corresponding
catalog index. It does not require the record to be present in the player's
inventory and does not compute transitive support closure; HPA-256 owns those
semantics.

Supporting record and fact collections use deterministic set ordering. A later
assertion may add support, but it never changes the first assertion's chapter,
scene, or origin.

### 8.2 Questions

`reveal_question` creates an open question if needed.

`resolve_question(question_id, fact_id)` requires:

- the question definition;
- an asserted fact;
- membership of `fact_id` in the question's `resolvedByFactIds`.

Resolution also reveals the question and stores the chosen fact ID. Repeating
resolution with that same fact is `Unchanged`; attempting to replace it with a
different candidate fact is an invalid monotonic transition and is rejected
before mutation.

### 8.3 Objectives

`reveal_objective` reveals either objective kind.

`complete_objective` reveals and completes the objective. Completing the
currently active primary objective also clears
`active_primary_objective_id`.

`set_primary_objective(complete_current, next_objective_id)` validates the
entire request before mutation:

- `next_objective_id`, when present, must resolve to a primary objective;
- `complete_current: true` plus the current objective as the next objective is
  contradictory and rejected;
- if requested, the current primary is completed;
- a non-null next primary is revealed and becomes active;
- a null next primary clears the scalar;
- selecting the already-active primary without completing it is `Unchanged`;
- replacing without completion leaves the previous objective revealed,
  incomplete, and inactive.

The complete transition table is:

| Current | `completeCurrent` | Next | Result |
|---|---:|---|---|
| none | false/true | none | unchanged |
| none | false/true | B | reveal and activate B |
| A | false | none | clear A without completing it |
| A | true | none | complete A and clear it |
| A | false | A | unchanged |
| A | true | A | reject before mutation |
| A | false | B | leave A incomplete; reveal and activate B |
| A | true | B | complete A; reveal and activate B |

The single scalar structurally permits zero or one active primary objective.
No second primary-objective mutation implementation is allowed in HPA-257.

### 8.4 Authorizations

`grant_authorization` requires the definition and records its chapter, scene,
and first origin. Repeated grants are `Unchanged` and never replace the first
grant origin. Chapter and scene are derived from that origin as specified in
§7.2; a migration-origin grant has no chapter/scene location.

The state API has no revoke, hide, reopen, uncomplete, or re-lock operations.

## 9. Public view

`GameStateView` gains an always-present `story: StoryStateView`.
The Rust view structs serialize with `#[serde(rename_all = "camelCase")]`; this
is the exact TypeScript mirror:

```ts
type StoryStateView = {
  facts: FactView[];
  questions: QuestionView[];
  objectives: ObjectiveView[];
  authorizations: AuthorizationView[];
};

type FactView = {
  id: string;
  label: string;
  summary: string;
  details: string;
  category: string;
  assertedInChapterId: string | null;
  assertedInSceneId: string | null;
  firstOrigin: AssertionOrigin;
  supportingRecords: InventoryTarget[];
  supportingFactIds: string[];
};

type QuestionView = {
  id: string;
  label: string;
  summary: string;
  status: "open" | "resolved";
  resolvedByFactId: string | null;
};

type ObjectiveView = {
  id: string;
  label: string;
  summary: string;
  kind: "primary" | "secondary";
  sortOrder: number;
  completed: boolean;
  activePrimary: boolean;
};

type AuthorizationView = {
  id: string;
  label: string;
  summary: string;
  grantingAuthority: string;
  grantedInChapterId: string | null;
  grantedInSceneId: string | null;
  firstOrigin: AssertionOrigin;
};

type AssertionOrigin =
  | {
      type: "sceneEvent";
      chapterId: string;
      sceneId: string;
      blockKind: StoryEventBlockKind;
      blockId: string;
    }
  | {
      type: "analysisBoard";
      chapterId: string;
      sceneId: string;
      boardId: string;
    }
  | { type: "migration"; migrationId: string };

type StoryEventBlockKind =
  | "sublocation"
  | "hotspot"
  | "topic"
  | "interrogationPhase"
  | "inquiryQuestion"
  | "testimonyLine"
  | "storyEvent";

type InventoryTarget =
  | { kind: "evidence"; id: string }
  | { kind: "statement"; id: string };
```

`InventoryTarget` is the existing `kind`-tagged wire type. Supporting
collections retain deterministic set order when converted to view arrays.

The view omits:

- untouched definitions;
- immutable candidate `resolvedByFactIds` lists;
- mutation rules and target-validation data;
- locked definitions of every category.

For an open question, `status` is `"open"` and `resolvedByFactId` is null. For
a resolved question, `status` is `"resolved"` and `resolvedByFactId` is the
single asserted resolver fact actually applied. The view never exposes the
other authored candidates.

Objectives use definition-owned `(sortOrder, id)` ordering. The other
categories use generated catalog order. Mutable state never owns display
ordering.

No Svelte component consumes these types in HPA-255. Every hand-built
`GameStateView` fixture must add the empty story value
`{ facts: [], questions: [], objectives: [], authorizations: [] }`. The
implementation inventory uses
`rg -l 'GameStateView' apps/game/src --glob '*.test.ts'` and updates every
matching fixture, including route, client-state, audio, notification,
navigation, and shell/component tests.

`GameEngine::view()` remains infallible because startup, every mutation, and
`StoryState::from_snapshot` preserve the catalog/state invariant. In
particular, an objective can never be both `completed: true` and
`activePrimary: true`. HPA-129 must use the validating snapshot constructor
before transactionally installing loaded state; stale IDs or inconsistent
cross-field progress never become a view concern.

## 10. Error contract

Compiler diagnostics use stable codes and authored source lines, including:

- `duplicateStoryCatalog`;
- `storyCatalogMalformed`;
- `storyCatalogUnknownSection`;
- `storyCatalogSectionOutOfOrder`;
- `storyCatalogUnknownField`;
- `storyCatalogMissingField`;
- `storyCatalogDuplicateSection`;
- `storyCatalogDuplicateField`;
- `invalidGlobalDefinitionId`;
- `duplicateGlobalDefinitionId`;
- `unresolvedStoryCatalogReference`;
- `duplicateSceneId`;
- `invalidAnalysisBoardRef`;
- `invalidPrimaryObjectiveTarget`.

Runtime errors add focused `GameError` constructors for:

- catalog load/version/validation failure;
- unknown fact, question, objective, or authorization;
- unknown supporting case record;
- invalid supporting fact;
- invalid question resolution fact or resolver replacement;
- invalid primary-objective transition;
- invalid story-state snapshot/catalog join.

Existing evidence/statement duplicate diagnostics retain their current stable
codes rather than being collapsed into `duplicateGlobalDefinitionId`.

Mutation errors leave state byte-for-byte unchanged. When HPA-257 dispatches
mutations through `command_tx`, the normal engine rollback remains a second
atomicity boundary.

## 11. Downstream boundaries

### HPA-256

Consumes fact support hooks and case-record indexes to add provenance,
supersession, proof capabilities, and transitive support closure. HPA-255
validates only direct support.

### HPA-257

Adds positive predicates, authored reveal parsing/dispatch, and fixed-point
reachability. It calls HPA-255 mutation and compiler-validation APIs.

### HPA-129

Stores a mutable `StoryStateSnapshot`, not `StoryCatalog`. Load constructs live
state through `StoryState::from_snapshot`, including active-primary
cross-field validation, before replacing the engine. Catalog schema versioning
is separate from save-envelope schema versioning.

### HPA-258

Renders the already-filtered `StoryStateView`; it does not reproduce visibility
or active-primary logic in Svelte.

### HPA-259/HPA-260

Use qualified analysis board references and the `AnalysisBoard` assertion
origin. HPA-255 introduces no analysis scene/runtime behavior.

### Foundation-slice integration risk

HPA-255 intentionally lands APIs before their production dispatch/load
consumers. Story mutations, origin variants, qualified board helpers, and
primary-target validation are exercised by focused tests until HPA-257,
HPA-259, and HPA-129 connect them. Adding a thin production consumer here would
cross those issues' ownership boundaries, so this slice accepts the temporary
runtime-dead surface and pins its contracts with direct unit tests. Those tests
must call every mutation, `validateSetPrimaryObjectiveTarget`, the qualified
analysis-board helper, both snapshot conversion directions, and every
`StoryEventBlockKind` serialization variant so unused foundation APIs cannot
silently rot.

## 12. Verification

### 12.1 Compiler tests

Add focused parser, validator, emitter, and orchestrator coverage for:

- a complete catalog;
- every optional or empty section;
- absent catalog to versioned empty artifact;
- duplicate catalog files across roots;
- malformed, missing, unknown, and repeated fields;
- out-of-order H2 sections and misplaced H3 entries;
- exact `^[a-z0-9_]+$` ID validation;
- explicit duplicate-section and duplicate-field diagnostic codes;
- `Resolved By: []` as the only valid empty-list spelling;
- exact diagnostic source lines;
- duplicate IDs in every global namespace;
- unresolved question fact references;
- duplicate scene IDs within a chapter;
- deterministic objective and record-index ordering;
- derived evidence/statement origins;
- qualified board-reference validation;
- missing and secondary primary-objective targets;
- unchanged live Chapter 1 compilation.

### 12.2 Rust tests

Add unit and engine-level coverage for:

- empty and populated catalog loading;
- unsupported schema and invalid generated catalog rejection;
- monotonic/idempotent behavior for every mutation;
- resolved-question same-fact no-op and different-fact replacement rejection;
- direct-support validation and first-origin preservation;
- valid primary selection, replacement, completion, clearing, and no-op;
- contradictory primary transition rejection;
- byte-for-byte unchanged state after every failed mutation class;
- cross-scene and cross-chapter story-state persistence;
- `EngineRollbackSnapshot` restoration of story state;
- filtered views hiding every untouched definition and all mutation rules;
- `StoryStateSnapshot` serialization round-trip followed by a successful
  validating catalog join;
- rejection of snapshots whose active primary is missing, secondary,
  unrevealed, or completed;
- rejection of every other invalid progress-map/reference invariant without
  constructing live state.

### 12.3 Frontend contract tests

Update TypeScript fixtures and source tests for the always-present empty
`story` view using the repository-wide fixture inventory in §9. Existing
components must continue rendering without new UI.

### 12.4 Repository guidance

The implementation updates `CLAUDE.md`/`AGENTS.md` with the new required
`story_catalog.json` resource and the one-time `bun run scenes:compile` remedy
for stale local resource trees. Because `AGENTS.md` is a symlink, edit only the
canonical file.

### 12.5 Completion gate

Run focused tests during implementation, then:

```bash
bun run scenes:compile
bun run check:scripts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run check
bun run test
bun run lint:all
```

Packaged E2E is not required because HPA-255 adds no player-facing interaction.

## 13. Non-goals

- save envelopes, slots, autosave, migrations, or file I/O;
- production `story_catalog.md` content;
- scene reveal dispatch or new reveal syntax;
- new unlock predicates or fixed-point reachability;
- provenance/supersession implementation or transitive support closure;
- analysis scene/compiler/runtime behavior;
- case-file, objective, authorization, or Continue UI;
- people/location archive, generic flags, arbitrary negation, or numeric
  credibility.
