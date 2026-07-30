# HPA-256 Case-Record Provenance and Support-Lineage Design

**Status:** Ready for approval; revised after focused codebase reviews  
**Issue:** HPA-256 — Add orthogonal case-record provenance, immutable supersession, and support lineage  
**Date:** 2026-07-29

## 1. References and scope

This focused design refines:

- `docs/superpowers/specs/2026-07-19-detective-gameplay-systems-design.md`
  §§10–11.1, 16, and 17;
- `docs/superpowers/plans/2026-07-19-detective-gameplay-systems-implementation-plan.md`
  epic P0.2;
- the merged HPA-55 transaction, dialogue, and navigation seams;
- the merged HPA-255 global catalog and durable story-state contract;
- the merged HPA-129/HPA-392 save, restore, content-identity, and exact-recapture
  implementation.

HPA-256 adds one shared provenance vocabulary for evidence and statements,
immutable case-record supersession chains, and deterministic support-lineage
queries. It builds on the existing scene definitions, global story catalog,
inventory, fact state, public views, and save contract instead of creating
parallel stores.

This slice delivers:

- optional provenance authoring on every evidence and statement manifest entry;
- neutral defaults for existing unannotated records;
- compiler and Rust validation of provenance and supersession;
- exact scene-definition ↔ catalog-index provenance equality;
- catalog-backed provenance lookup for evidence and statements;
- immutable lead → reacquired → exhibit chains;
- source-group independence semantics;
- deterministic direct and transitive fact-support closure;
- diagnostic and strict source-group closure APIs;
- explicit inventory-independent internal lineage and consumer-level filters;
- a compiler requirement seam for later analysis boards;
- spoiler-safe public inventory and fact-support projections;
- save/restore preservation through stable record IDs plus content identity;
- updated investigation/interrogation authoring guidance.

It does not add analysis-scene Markdown, threshold-board syntax, case-file UI,
new record-acquisition commands, automatic source inference, production story
provenance annotations, or a layout-editor provenance form.

## 2. Approved decisions

1. Provenance is immutable compiled definition data, not mutable save state.
2. Evidence and statements use the same `CaseRecordProvenance` contract.
3. Provenance dimensions are orthogonal. No value in one dimension implies a
   value in another.
4. Omitted authored provenance compiles to neutral defaults and causes no visible
   UI change.
5. A newer record points to its immediate predecessor through
   `supersedesRecordId`; older records are never mutated or removed.
6. Supersession is a chain, not a branching graph. A record may have at most one
   immediate successor.
7. Procedural status may stay equal or advance, but may not regress through a
   supersession edge.
8. `sourceGroupId` is the only source-independence identity. Labels,
   supersession, record kind, matching prose, and matching acquisition origin do
   not establish independence.
9. A missing source group means independence is unknown. It never counts as a
   synthetic one-record source.
10. Facts retain HPA-255's direct typed supporting-record and supporting-fact
    edges. HPA-256 adds derived closure; it does not duplicate fact mutation.
11. Internal lineage is pure over asserted `StoryState` progress plus immutable
    catalog definitions. It does not implicitly filter by current inventory.
12. Player-facing and selection-facing consumers must apply their own acquired or
    selected-record boundary. Internal closure must never be mistaken for a
    player-visible count.
13. Derived source closure has two levels: a diagnostic result returns known
    groups plus records with missing groups; a strict complete-count operation
    fails while any supporting record has an unknown group.
14. HPA-262 MVP threshold boards count selected evidence/statement records
    directly. Facts and case notes are not eligible independent-source inputs in
    that ticket.
15. A supersession chain query returns the complete containing chain, includes
    the target, and orders records oldest → newest.
16. Scene JSON and the story-catalog index repeat provenance from one normalized
    compiler value. Same-ID copies must be exactly equal.
17. The catalog is authoritative for lineage, source-group, capability, and
    supersession queries. The scene definition remains authoritative for record
    prose, images, acquisition dialogue, and acquisition-time record lookup.
    Runtime validation rejects any disagreement between their provenance copies.
18. The generated story catalog advances to schema version 2 because its global
    case-record indexes gain required provenance.
19. Rust rejects any catalog whose `schemaVersion` is not 2 before deserializing
    the v2 payload. Legacy scene defaults never make catalog v1 acceptable.
20. Save schema version 1 remains unchanged. Saves retain stable record IDs,
    acquisition locations, and direct support edges; immutable provenance rejoins
    from the exact content revision.
21. A provenance-only content edit must change the package content revision.
22. Any future provenance wire-field addition, removal, or semantic
    reinterpretation requires another catalog schema-version bump.
23. `@lyra/scene-types` remains unchanged. Provenance is not yet an editor-shared
    layout contract.
24. `GameStateView` exposes an `InventoryView`; mutable `Inventory` is no longer a
    public serialization surface.
25. Public views do not reveal an unacquired predecessor or future successor ID.
26. Public `supersedesRecordId: null` is intentionally ambiguous: it may mean no
    predecessor exists or that the predecessor is unacquired and therefore
    redacted.
27. Public redaction is recomputed on every `GameEngine::view()` build from the
    current inventory. It is not frozen when a record is acquired.
28. `FactView.supportingRecords` must not leak unacquired record IDs even though
    internal fact progress may legally reference them.
29. Duplicate proof capabilities are rejected during parsing/validation;
    canonical capability ordering is an emitter concern and never repairs invalid
    authored input.
30. The investigation and interrogation authoring skills must document every
    provenance field and warn that a superseding record should explicitly author
    `Procedural Status`.
31. `.claude/skills/` is the repository-canonical authoring-skill path. A local
    `.agents/skills/` hardlink or generated mirror may be verified after editing,
    but HPA-256 does not create a second divergent tracked copy.

## 3. Current repository constraints

The current compiler:

- parses evidence and statement manifests through shared
  `parser-manifest.ts`, consumed by both investigation and interrogation parsers;
- emits full evidence/statement definitions inside scene JSON;
- independently emits lightweight evidence/statement indexes into
  `story_catalog.json`;
- treats evidence and statement IDs as separate game-global typed namespaces;
- computes one package content revision from the canonical emitted scene/catalog
  bundle in `save-content-manifest.ts`.

The current runtime:

- deserializes evidence and statement definitions from scene JSON;
- loads immutable case-record indexes through `StoryCatalog`;
- copies acquired display data and acquisition locations into `Inventory`;
- currently serializes mutable `Inventory` directly in `GameStateView`;
- stores typed supporting records and supporting fact IDs inside sparse
  `StoryState` fact progress;
- validates support existence and supporting-fact acyclicity in live mutation and
  restore, but does not require supporting records to be acquired;
- serializes inventory as record IDs plus acquisition chapter/scene;
- serializes direct fact support in `StoryStateSnapshotV1`;
- reconstructs inventory and story state against the installed package and
  demands exact recapture after restore.

HPA-256 preserves those boundaries while closing two existing spoiler seams:
mutable inventory must stop being a public wire type, and public fact support must
not expose unacquired record IDs.

## 4. Domain contract

### 4.1 Orthogonal provenance shape

```ts
type CaseRecordProvenance = {
  sourceKind:
    | "physical"
    | "testimony"
    | "digital"
    | "subjective"
    | "unspecified";
  representationLayer: "raw" | "sync" | "summary" | "composite" | "none";
  proceduralStatus: "unspecified" | "lead" | "reacquired" | "exhibit";
  completeness: "complete" | "partial" | "cropped" | "unspecified";
  confidence: "unverified" | "corroborated" | "disputed" | "unspecified";
  sourceGroupId: string | null;
  sourceLabel: string | null;
  proofCapabilities: ProofCapability[];
  supersedesRecordId: string | null;
};

type ProofCapability =
  | "time"
  | "order"
  | "route"
  | "identity"
  | "access"
  | "motive"
  | "source"
  | "credibility"
  | "procedure"
  | "causation";
```

Each dimension answers a different question:

- `sourceKind`: what kind of originating source the record represents;
- `representationLayer`: which processing or representation layer is shown;
- `proceduralStatus`: where this immutable record sits in the acquisition/legal
  process;
- `completeness`: whether the represented material is whole or limited;
- `confidence`: its authored corroboration state;
- `sourceGroupId`: which underlying source it belongs to for independence;
- `sourceLabel`: optional player-facing source wording;
- `proofCapabilities`: which positive authored requirements it may satisfy;
- `supersedesRecordId`: the immediate older immutable record.

The compiler and runtime never infer across dimensions. For example:

- `digital` does not imply `time`;
- `raw` does not imply `complete`, `corroborated`, or `exhibit`;
- `exhibit` does not imply `corroborated`;
- `complete` does not imply any proof capability;
- records in one supersession chain are not automatically independent;
- a statement record may describe a physical, digital, testimony, or subjective
  originating source.

Proof capabilities are positive limits. An absent capability means the record
cannot satisfy that authored requirement; it does not prove the opposite claim.

### 4.2 Neutral authored defaults

An evidence or statement entry with omitted provenance emits:

```json
{
  "sourceKind": "unspecified",
  "representationLayer": "none",
  "proceduralStatus": "unspecified",
  "completeness": "unspecified",
  "confidence": "unspecified",
  "sourceGroupId": null,
  "sourceLabel": null,
  "proofCapabilities": [],
  "supersedesRecordId": null
}
```

Neutral values preserve legacy gameplay but do not satisfy an explicit metadata
requirement:

- `unspecified` does not satisfy `exhibit`;
- an empty capability set satisfies no capability requirement;
- a null source group contributes no independent source;
- `none` does not satisfy a requirement for `raw`, `sync`, `summary`, or
  `composite`.

### 4.3 Immutable definition data versus mutable progress

Provenance and supersession belong to immutable definitions. Mutable progress
remains:

- whether a record has been acquired;
- where it was acquired;
- existing acquisition acknowledgement state;
- direct fact-support edges naming the record.

Acquiring a record does not upgrade its procedural status. Reacquisition or
admission as an exhibit creates and acquires a separate immutable record.

### 4.4 Story-facing examples

The contract supports the narrative's required procedure:

- an informal screenshot may be a `lead`, while a separately fixed forensic copy
  is an `exhibit` that supersedes it;
- several Chapter 2 wall/composite-derived clips remain separate records but
  share one `sourceGroupId`, so they do not masquerade as independent sources;
- a social repost lead, legally reacquired original, and hearing exhibit form one
  immutable chain;
- an anonymous or cropped record may prove `route` without proving `identity`;
- a complete raw export may remain `disputed` and lack a requested capability.

No story prose is parsed to infer these values automatically.

## 5. Authoring contract

### 5.1 Optional fields

Evidence and statement entries accept these exact optional fields alongside their
current required metadata:

```md
### evidence:verified_wall_clip {#verified_wall_clip}

- **Name:** 經核實直播牆原檔
- **Description:** 從活動方重新取得的完整輸出。
- **Details:** 保留原始時間碼及輸出來源。
- **Source Kind:** digital
- **Representation Layer:** composite
- **Procedural Status:** reacquired
- **Completeness:** complete
- **Confidence:** corroborated
- **Source Group:** shibuya_program_composite
- **Source Label:** 澀谷活動 Program Composite
- **Proof Capabilities:** [time, source, procedure]
- **Supersedes:** evidence:anonymous_wall_clip

#### On Collect
...
```

Statements use the same fields with a typed statement predecessor:

```md
- **Supersedes:** statement:initial_witness_account
```

Allowed syntax:

- `Source Kind`: `physical`, `testimony`, `digital`, `subjective`, or
  `unspecified`;
- `Representation Layer`: `raw`, `sync`, `summary`, `composite`, or `none`;
- `Procedural Status`: `unspecified`, `lead`, `reacquired`, or `exhibit`;
- `Completeness`: `complete`, `partial`, `cropped`, or `unspecified`;
- `Confidence`: `unverified`, `corroborated`, `disputed`, or `unspecified`;
- `Source Group`: one non-empty `^[a-z0-9_]+$` slug;
- `Source Label`: non-empty display text;
- `Proof Capabilities`: bracketed comma-separated canonical values; `[]` is
  allowed;
- `Supersedes`: exactly one typed `evidence:<id>` or `statement:<id>` reference.

Present-but-blank metadata, repeated metadata, unknown values, and duplicate
capabilities are errors. Duplicate rejection occurs while source locations are
available. Emission only sorts an already valid duplicate-free list.

A record that authors `Supersedes` should explicitly author `Procedural Status`.
If a predecessor is `lead`, `reacquired`, or `exhibit` and the successor omits
status, the successor normalizes to `unspecified` and correctly fails the
non-regression rule.

### 5.2 Source-located AST

```ts
type ASTCaseRecordProvenance = {
  sourceKind: Located<{ value: SourceKind }> | null;
  representationLayer: Located<{ value: RepresentationLayer }> | null;
  proceduralStatus: Located<{ value: ProceduralStatus }> | null;
  completeness: Located<{ value: Completeness }> | null;
  confidence: Located<{ value: Confidence }> | null;
  sourceGroupId: Located<{ value: string }> | null;
  sourceLabel: Located<{ value: string }> | null;
  proofCapabilities: Array<Located<{ value: ProofCapability }>>;
  supersedes: Located<InventoryTarget> | null;
};
```

`ASTEvidence` and `ASTStatement` both own this source-located object. Omitted
fields become defaults only after parsing and validation, so diagnostics can
still distinguish omission from an explicitly authored value.

### 5.3 Procedural-status ordering

Status progression uses this rank only for supersession validation:

```text
unspecified < lead < reacquired < exhibit
```

Allowed examples include equal status, `unspecified → lead`, `lead → reacquired`,
`lead → exhibit`, and `reacquired → exhibit`. Rejected examples include
`reacquired → lead`, `exhibit → reacquired`, and any explicit status superseded
by `unspecified`.

The ordering implies nothing about confidence, completeness, source identity, or
proof capability.

### 5.4 Authoring-skill obligations and dual-root handling

The implementation updates the repository-canonical files:

```text
.claude/skills/writing-investigation-scene/SKILL.md
.claude/skills/writing-interrogation-scene/SKILL.md
```

Both must:

- list every provenance field and allowed value;
- explain neutral defaults;
- warn that `Supersedes` normally requires explicit procedural status;
- distinguish source grouping from supersession;
- describe proof capabilities as positive limits;
- preserve Traditional Chinese player-facing values and English parser-facing
  field names.

Some local agent environments expose `.agents/skills/` as a hardlinked or
generated mirror. The implementation verifies that mirror when present, but does
not create or commit a second divergent copy unless it becomes repository-tracked.

## 6. Compiler and generated artifacts

### 6.1 Single normalization path and equality invariant

The compiler introduces one pure normalization/emission helper, for example:

```ts
function emitCaseRecordProvenance(
  provenance: ASTCaseRecordProvenance,
): CaseRecordProvenance;
```

Both scene emission and story-catalog index emission must call this helper. No
second hand-written defaulting or sorting path is allowed.

For every typed evidence/statement ID, the compiler asserts:

```text
sceneRecord.provenance === catalogIndexRecord.provenance
```

using deep exact equality after normalization. Focused tests cover both record
kinds and neutral/non-neutral values. A mismatch is a compiler defect and blocks
emission; partial resources are never written.

### 6.2 Scene JSON

Both emitted record definitions gain a required normalized `provenance` object:

```ts
type JSONEvidence = {
  // existing fields
  provenance: CaseRecordProvenance;
};

type JSONStatement = {
  // existing fields
  provenance: CaseRecordProvenance;
};
```

Capabilities emit in canonical order:

```text
time, order, route, identity, access, motive,
source, credibility, procedure, causation
```

### 6.3 Story catalog schema version 2

```ts
type StoryCatalogJsonV2 = {
  schemaVersion: 2;
  facts: FactDefinition[];
  questions: QuestionDefinition[];
  objectives: ObjectiveDefinition[];
  authorizations: AuthorizationDefinition[];
  evidenceIndex: CaseRecordDefinitionIndex[];
  statementsIndex: CaseRecordDefinitionIndex[];
};

type CaseRecordDefinitionIndex = {
  id: string;
  chapterId: string;
  sceneId: string;
  provenance: CaseRecordProvenance;
};
```

The scene remains the owner of prose, image references, and acquisition dialogue.
The catalog repeats only typed identity, immutable origin, and provenance from the
same normalized value so lineage services need not load every scene.

A missing authored `story_catalog.md` still emits a required empty v2 artifact.

### 6.4 Compiler validation

After all scenes have parsed, validation rejects:

- malformed, blank, repeated, or unknown provenance metadata;
- duplicate or unknown proof capabilities;
- invalid source-group slugs;
- malformed typed predecessor references;
- unknown, cross-kind, or self-supersession;
- supersession forks and cycles;
- procedural-status regression;
- scene/catalog provenance inequality;
- metadata that fails a later consumer's explicit requirement.

Supersession diagnostics point to the newer record's `Supersedes` metadata line
and name the involved typed records.

### 6.5 Content identity

The package content revision includes normalized scene and catalog provenance.
`save-content-manifest.ts` already hashes the canonical emitted scene/catalog
bundle, so production code should not be edited merely for ceremony if the new
fields naturally enter that bundle.

A focused regression test must prove that changing only one provenance value
changes `contentRevision`. If the versioned bundle/input type truly requires a
production adjustment, that change belongs in `save-content-manifest.ts`.
`save-content-references.ts` remains the semantic asset-reference validator.

### 6.6 Metadata-requirement seam

HPA-256 defines a compiler-only helper without inventing analysis-board Markdown:

```ts
type CaseRecordMetadataRequirement = {
  allowedSourceKinds: SourceKind[] | null;
  allowedRepresentationLayers: RepresentationLayer[] | null;
  allowedProceduralStatuses: ProceduralStatus[] | null;
  prohibitedProceduralStatuses: ProceduralStatus[];
  allowedCompleteness: Completeness[] | null;
  allowedConfidence: Confidence[] | null;
  requireSourceGroup: boolean;
  requiredProofCapabilities: ProofCapability[];
};

function validateCaseRecordRequirement(
  record: CaseRecordDefinitionIndex,
  requirement: CaseRecordMetadataRequirement,
  requirementLocation: SourceLocation,
): CompileError[];
```

Exact membership applies. Prohibited status wins. `requireSourceGroup` rejects
null. Every required capability must be present. Neutral defaults fail explicit
requirements that exclude them. Diagnostics point to the requirement and identify
the insufficient record.

HPA-259 later calls this helper for resolved selectable candidates. HPA-262 MVP
uses it per eligible evidence/statement candidate and does not import fact closure.

## 7. Immutable supersession semantics

### 7.1 Edge direction and chain constraints

The newer record owns the pointer to its immediate predecessor:

```text
anonymous_social_clip
        ↑ superseded by
verified_original_clip
        ↑ superseded by
hearing_exhibit_clip
```

Each record has at most one predecessor because it stores one pointer. Validation
also permits at most one successor per predecessor, producing a linear audit
trail. Branching derivations use source groups and explicit support edges instead.

### 7.2 Deterministic queries

```rust
fn predecessor(target: &InventoryTarget) -> Option<InventoryTarget>;
fn successor(target: &InventoryTarget) -> Option<InventoryTarget>;
fn chain(target: &InventoryTarget) -> Result<Vec<InventoryTarget>, ProvenanceError>;
fn latest_definition(target: &InventoryTarget) -> Result<InventoryTarget, ProvenanceError>;
```

`chain` returns the complete containing chain, includes the target, and orders
records oldest → newest. An unlinked record returns one element. A target in the
middle still returns the full chain. `latest_definition` is the final element.

### 7.3 Public no-spoiler rule

An acquired successor publicly exposes `supersedesRecordId` only when its
predecessor is also acquired. An acquired predecessor never exposes a packaged
future successor; the public record shape has no successor field.

Public `supersedesRecordId: null` therefore means either:

1. no predecessor exists; or
2. a predecessor exists but is unacquired and redacted.

Frontend code must not infer lineage-root status from public null.

## 8. Rust architecture and definition integrity

### 8.1 Module ownership

HPA-256 adds:

```text
apps/game/src-tauri/src/game/provenance.rs
apps/game/src-tauri/src/game/support_lineage.rs
```

and extends scene schema, mutable inventory, story catalog/state/view, public view,
acquisition validation, and save capture/restore tests. `GameEngine` does not gain
a second provenance store.

### 8.2 Strict provenance types and version gates

```rust
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaseRecordProvenance {
    pub source_kind: SourceKind,
    pub representation_layer: RepresentationLayer,
    pub procedural_status: ProceduralStatus,
    pub completeness: Completeness,
    pub confidence: Confidence,
    pub source_group_id: Option<String>,
    pub source_label: Option<String>,
    pub proof_capabilities: BTreeSet<ProofCapability>,
    pub supersedes_record_id: Option<String>,
}
```

Legacy compatibility applies to the containing scene-record field:

```rust
#[serde(default)]
pub provenance: CaseRecordProvenance,
```

An absent scene provenance object becomes neutral. A present object is strict:
individual fields are required and unknown fields fail. Catalog-v2 provenance is
always required and never defaulted.

`StoryCatalog::load` first reads a minimal version envelope. It accepts exactly
version 2 and rejects v1 or future versions before v2 payload deserialization.

### 8.3 Catalog resolver and authoritative ownership

```rust
pub(in crate::game) struct CaseRecordDefinition {
    pub id: String,
    pub chapter_id: String,
    pub scene_id: String,
    pub provenance: CaseRecordProvenance,
}

fn case_record(&self, target: &InventoryTarget)
    -> Option<&CaseRecordDefinition>;
```

The catalog is authoritative for lineage and metadata evaluation. The scene
record is authoritative for acquisition prose and dialogue. They must agree on
provenance exactly.

Runtime validation uses a shared typed comparison:

```rust
fn validate_scene_record_against_catalog(
    catalog: &StoryCatalog,
    chapter_id: &str,
    scene_id: &str,
    target: &InventoryTarget,
    scene_provenance: &CaseRecordProvenance,
) -> Result<(), GameError>;
```

Validation occurs:

- whenever an investigation/interrogation scene definition is loaded;
- again at evidence/statement acquisition before mutating inventory;
- during save restore while joining saved IDs to packaged definitions.

HPA-256 does not force eager loading of every scene during ordinary startup solely
for this check. Compiler whole-bundle validation remains the package-wide guard;
runtime checks defend each loaded/acquired/restored boundary. A mismatch produces
a typed `caseRecordDefinitionMismatch`-class error and never silently chooses one
copy.

### 8.4 Mutable inventory and constructor audit

`EvidenceRecord` and `StatementRecord` gain the full internal provenance copied
from the validated scene definition. Acquisition chapter/scene remains a separate
origin. Acquiring a successor never mutates its predecessor.

The implementation plan must inventory all Rust literals and constructors for:

```text
EvidenceJson {
StatementJson {
EvidenceRecord {
StatementRecord {
```

This includes production and test sites in engine, acquisition/reveal paths,
command tests, save capture/restore, coordinator tests, and shared test support.
`#[serde(default)]` does not populate Rust struct literals.

Focused test helpers may reduce mechanical churn:

```rust
fn neutral_provenance() -> CaseRecordProvenance;
fn evidence_json(id: &str) -> EvidenceJson;
fn statement_json(id: &str) -> StatementJson;
```

Production constructors and public wire fields remain explicit. Do not derive a
misleading `Default` for complete evidence/statement definitions merely to avoid
updating required fields.

## 9. Source independence and fact-support lineage

### 9.1 Source identity

`sourceGroupId` is a game-global semantic key across evidence and statements.
Records with one non-null group count as one source even when they differ in ID,
kind, representation, procedural status, chapter, scene, or supersession position.

Different non-null IDs count independently. Null means unknown and never creates a
synthetic group. `sourceLabel` is presentation only.

Supersession and source grouping answer different questions. A successor does not
automatically inherit its predecessor's group. Authors normally reuse the group
when all chain members derive from one underlying source, but may change it when
the newer record genuinely establishes a different source.

### 9.2 Inventory-independent internal closure

HPA-255 already permits asserted facts to reference valid catalog records that are
not currently acquired. HPA-256 preserves that contract.

Internal lineage queries operate over:

```text
StoryState fact progress → typed support edges → StoryCatalog definitions
```

They do not consult `Inventory`. Therefore an unacquired supporting record remains
part of authoritative direct/transitive record closure and contributes its known
source group to internal source closure.

This is intentional graph math, not automatically a player-visible claim.

### 9.3 Derived APIs

```rust
pub struct SourceGroupClosure {
    pub groups: BTreeSet<String>,
    pub missing_group_records: BTreeSet<InventoryTarget>,
}

fn direct_records(fact_id: &str)
    -> Result<BTreeSet<InventoryTarget>, LineageError>;
fn transitive_records(fact_id: &str)
    -> Result<BTreeSet<InventoryTarget>, LineageError>;
fn transitive_facts(fact_id: &str)
    -> Result<BTreeSet<String>, LineageError>;
fn transitive_source_group_closure(fact_id: &str)
    -> Result<SourceGroupClosure, LineageError>;
fn transitive_source_groups(fact_id: &str)
    -> Result<BTreeSet<String>, LineageError>;
```

`transitive_records` includes direct records and records beneath recursively
supporting facts, deduplicated by typed identity. `transitive_facts` excludes the
queried root.

The diagnostic source closure returns every known group plus every record lacking
a group. It never drops unknowns or invents groups. The strict operation returns a
complete set only when no records are missing groups; otherwise it returns a typed
error listing them.

Unknown fact/record references and cycles remain typed errors at this
read-only defense-in-depth boundary.

### 9.4 Consumer filtering

A consumer must declare its visibility/eligibility boundary:

- HPA-262 validates and counts the selected evidence/statement records directly;
- an inventory case-file view intersects internal lineage with acquired typed IDs;
- public fact projections redact unacquired direct supporting records;
- a future fact-aware board must state whether it imports the full closure or a
  selected/acquired subset and whether it needs diagnostic or strict counting.

No consumer may present internal source closure as “sources the player possesses”
without applying an acquired or selected-record filter.

## 10. Public and frontend contract

### 10.1 `InventoryView` is the only public inventory wire type

```rust
pub struct GameStateView {
    // existing fields
    pub inventory: InventoryView,
}
```

`InventoryView` contains evidence/statement record-view arrays with public
provenance. It is rebuilt from mutable inventory on every `GameEngine::view()`.

`Inventory`, `EvidenceRecord`, and `StatementRecord` are engine state, not public
wire types. Once `InventoryView` is wired, remove their `Serialize` derives where
practical so Rust cannot accidentally bypass redaction by embedding mutable
inventory in another public view. Save capture continues its explicit ID-only
mapping and does not depend on public serialization.

The external JSON remains:

```ts
type Inventory = {
  evidence: EvidenceRecord[];
  statements: StatementRecord[];
};
```

with each public record including `provenance`.

### 10.2 Dynamic lineage redaction

For every view build:

1. construct typed acquired-ID sets from current inventory;
2. clone internal provenance for each acquired record;
3. retain `supersedesRecordId` only when the typed predecessor is also acquired;
4. serialize the redacted public record.

Required transition:

```text
Acquire B, where B supersedes A → public B.supersedesRecordId = null
Acquire A later                   → next view exposes B.supersedesRecordId = A
```

Acquiring A alone never reveals that packaged future B exists. There is no public
successor field in HPA-256.

### 10.3 Spoiler-safe facts

`StoryState` continues to store every authoritative direct supporting record.
`FactView.supportingRecords`, however, includes only currently acquired typed
records. `supportingFactIds` remains unchanged because facts are themselves public
only after assertion.

The `StoryStateView` builder therefore receives an acquired-record set or a small
public-view context instead of blindly copying every internal support target.
Transitive closure is not added to the current public wire shape.

### 10.4 Frontend mirror and fixture churn

Frontend types mirror every enum and provenance field exactly. Documentation on
`supersedesRecordId` explains the redacted-or-absent dual meaning.

The implementation plan inventories every frontend fixture and constructor for
public evidence/statement records. Shared neutral-provenance test factories are
allowed; production public fields remain explicit. Existing components do not
render provenance in this ticket, so their DOM and accessible names remain
unchanged.

### 10.5 Layout-editor compatibility

The layout editor intentionally reads investigation scene JSON through a narrower
structural type and writes only the separate layout sidecar. Additional compiled
provenance fields are ignored by structural JSON parsing and are never written
back into scene JSON.

HPA-256 therefore does not extend `@lyra/scene-types` or layout-editor provenance
types. A focused compatibility regression may load a compiled investigation scene
containing provenance and confirm that saving changes only the sidecar.

## 11. Persistence and compatibility

### 11.1 Save shape remains version 1

The save already stores all mutable data required here:

- acquired record ID;
- acquisition chapter and scene;
- direct typed supporting record IDs;
- direct supporting fact IDs;
- exact package content revision.

It does not add provenance, source groups, capabilities, or supersession to
`InventorySnapshotV1` or `StoryStateSnapshotV1`.

### 11.2 Capture

Capture validates:

- every acquired record resolves through the catalog;
- every acquired internal provenance equals the catalog definition;
- every direct supporting record resolves;
- story state remains valid and acyclic.

### 11.3 Restore

Restore:

1. validates save schema and exact content revision;
2. loads and version-gates catalog-v2 definitions;
3. resolves saved record IDs to the owning packaged scenes;
4. validates scene/catalog provenance equality;
5. reconstructs internal inventory records from definitions and saved acquisition
   locations;
6. reconstructs direct fact support;
7. recomputes provenance, supersession, and source closure;
8. recaptures the candidate and demands exact snapshot equality;
9. rebuilds public views and verifies spoiler-safe projections.

Because provenance is definition data, exact snapshot equality remains unchanged.
Dedicated tests compare pre-save/post-restore internal provenance, acquisition
origins, public redaction, and derived lineage.

### 11.4 Compatibility consequences

A pre-v2 package must regenerate resources. `StoryCatalog::load` rejects v1 rather
than defaulting missing catalog provenance. An older pre-release save has a
different content revision and is rejected by the existing compatibility gate; no
save-schema migration is needed.

A future shipped release that preserves saves across provenance edits must add an
explicit content migration.

## 12. Diagnostics and failure behavior

Compiler diagnostics use stable codes and source locations for:

- malformed, blank, repeated, or unknown provenance metadata;
- duplicate or unknown proof capabilities;
- invalid source-group slug;
- malformed typed predecessor reference;
- unknown, cross-kind, or self-supersession;
- supersession fork or cycle;
- procedural-status regression;
- scene/catalog provenance mismatch;
- metadata missing for an explicit consumer requirement.

Runtime failures are typed for:

- unsupported catalog version;
- malformed strict provenance;
- invalid catalog supersession graph;
- scene/catalog provenance mismatch;
- unknown lineage fact/record;
- lineage cycle at query boundary;
- strict complete-source request with missing groups;
- attempted public-view construction from inconsistent inventory definitions.

Runtime never silently chooses scene or catalog provenance, drops unknown sources,
creates synthetic groups, leaks an unacquired lineage ID, or installs a partially
validated engine.

## 13. Verification and acceptance mapping

### 13.1 Compiler tests

- Parse every enum value for evidence and statements.
- Parse all ten proof capabilities.
- Emit neutral defaults when authored fields are omitted.
- Reject blank, repeated, unknown, malformed, and duplicate metadata.
- Prove duplicate capabilities fail before emission.
- Emit canonical ordering only for valid duplicate-free capabilities.
- Reject invalid source groups and typed supersession references.
- Emit catalog schema version 2.
- Validate missing, cross-kind, self, forked, cyclic, and regressing chains.
- Use one normalized provenance helper for scene and catalog emission.
- Assert exact same-ID scene ↔ catalog provenance equality for evidence and
  statements, including neutral defaults.
- Prove same-group wall-derived clips remain distinct records in emitted JSON.
- Prove metadata requirements reject unspecified exhibit status, missing
  capabilities, and null source groups.
- Prove a provenance-only change changes the `save-content-manifest` hash.
- Compile live existing chapters without an authored provenance migration.
- Verify both writing skills document matching syntax and explicit-status advice.

### 13.2 Rust tests

- Deserialize a legacy scene record by defaulting an absent provenance object.
- Reject a present provenance object with missing or unknown fields.
- Reject catalog v1 before v2 payload deserialization.
- Round-trip every provenance enum and field through serde.
- Reject catalog-v2 corruption for every chain invariant.
- Resolve typed evidence/statement definitions through the catalog.
- Reject a loaded scene whose provenance differs from its same-ID catalog entry.
- Reject acquisition when scene/catalog provenance differs before inventory
  mutation.
- Return full supersession chains oldest → newest, including one-element chains
  and targets in the middle.
- Copy provenance into inventory without mutating acquisition origin.
- Keep predecessor and successor as separate acquired records.
- Audit all Rust `EvidenceJson`, `StatementJson`, `EvidenceRecord`, and
  `StatementRecord` literal/constructor sites; use explicit values or approved
  test helpers.
- Compute internal record/source closure for an unacquired supporting record.
- Confirm diagnostic/strict closure includes that record's known group while
  public inventory hides the record.
- Return diagnostic source closure with known groups plus every missing record.
- Make strict source closure fail when any supporting record lacks a group.
- Deduplicate records and source groups reached through several supporting facts.
- Preserve existing support-cycle and snapshot validation.
- Build `GameStateView` from `InventoryView`, never mutable `Inventory`.
- Hide an unacquired predecessor from a successor's public provenance.
- Recompute redaction: acquire successor first, then predecessor, and expose the
  predecessor on the next view.
- Never expose a future successor when only the predecessor is acquired.
- Filter unacquired record IDs out of `FactView.supportingRecords` while retaining
  them in internal `StoryState`.
- Capture/save/restore lead → reacquired → exhibit records and confirm identical
  definitions, acquisition origins, direct support, internal closure, public
  redaction, and exact recapture.

### 13.3 Frontend and regression tests

- Mirror every provenance enum and field in `state/types.ts`.
- Document the redacted-or-absent meaning of public null predecessor.
- Inventory and update every public record fixture/constructor with neutral
  provenance or a shared factory.
- Confirm current evidence/statement rendering ignores neutral provenance and is
  visually/accessibly unchanged.
- Confirm acquisition popup behavior is unchanged.
- Confirm public fact fixtures do not include unacquired support IDs.
- Run the existing Chapter 1 full-playthrough regression.
- If shared compiled scene loading is touched, confirm the layout editor accepts
  extra provenance and writes only its sidecar.

### 13.4 Structural guards

Add a focused structural or compile-time guard that fails if:

- `GameStateView.inventory` is changed back to mutable `Inventory`;
- mutable inventory records regain an unintended direct public serialization path;
- scene and catalog emission stop sharing the normalization helper;
- a public view exposes a catalog successor field or unacquired supporting record.

### 13.5 Required command gates

The implementation plan ends with at least:

```text
bun run scenes:compile
bun run check:scripts
bun run test
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run check
bun run lint:all
```

Focused tests run first. Packaged Tauri E2E is required only if implementation
changes a rendered flow or save command surface; otherwise save integration,
public-view tests, layout compatibility where relevant, and the full-playthrough
regression are the P0 gate.

## 14. Expected file boundaries

Compiler:

```text
Modify packages/scripts/compile-scenes/types.ts
Modify packages/scripts/compile-scenes/parser-manifest.ts
Add    packages/scripts/compile-scenes/case-record-provenance.ts
Modify packages/scripts/compile-scenes/emitter.ts
Modify packages/scripts/compile-scenes/story-catalog.ts
Modify packages/scripts/compile-scenes/validator.ts
Modify packages/scripts/compile-scenes/save-content-manifest.test.ts
Modify packages/scripts/compile-scenes/save-content-manifest.ts
       only if the versioned bundle/input boundary needs a production change
Add/modify focused compiler fixtures and equality tests
```

Rust core:

```text
Add    apps/game/src-tauri/src/game/provenance.rs
Add    apps/game/src-tauri/src/game/support_lineage.rs
Modify apps/game/src-tauri/src/game/mod.rs
Modify apps/game/src-tauri/src/game/schema.rs
Modify apps/game/src-tauri/src/game/state.rs
Modify apps/game/src-tauri/src/game/acquisition.rs and/or reveal acquisition seam
Modify apps/game/src-tauri/src/game/story/catalog.rs
Modify apps/game/src-tauri/src/game/story/state.rs
Modify apps/game/src-tauri/src/game/story/view.rs
Modify apps/game/src-tauri/src/game/view.rs
Modify apps/game/src-tauri/src/game/save/capture.rs
Modify apps/game/src-tauri/src/game/save/restore.rs
Modify apps/game/src-tauri/src/game/test_support.rs and focused fixtures as needed
Audit command/reveal/coordinator test constructors found by literal search
```

Frontend:

```text
Modify apps/game/src/lib/state/types.ts
Modify state/component fixtures and regression tests
```

Layout editor:

```text
No provenance contract change expected.
Add/adjust only a narrow load/sidecar regression if shared output tests require it.
```

Authoring guidance:

```text
Modify .claude/skills/writing-investigation-scene/SKILL.md
Modify .claude/skills/writing-interrogation-scene/SKILL.md
Verify local .agents/skills mirror when present; do not commit a duplicate copy.
```

Documentation:

```text
Add docs/superpowers/plans/2026-07-29-hpa-256-case-record-provenance-and-support-lineage-implementation-plan.md
```

The implementation plan may refine test filenames and split large Rust modules,
but it must preserve these ownership, equality, visibility, and persistence
boundaries.

## 15. Non-goals and future ownership

HPA-256 does not implement:

- automatic provenance inference from names, prose, record kind, scene type, or
  acquisition source;
- automatic source-group inheritance through supersession;
- automatic capability inference from raw/composite/exhibit status;
- eager loading of every packaged scene solely to validate equality at ordinary
  startup;
- analysis-scene Markdown or accepted solutions (HPA-259);
- Rust analysis drafts/evaluation (HPA-260);
- workbench or case-file visual redesign (HPA-258/HPA-261);
- classify/order/threshold board behavior (HPA-262);
- procedural request/grant behavior (HPA-264);
- production Chapter 1/2 provenance authoring (HPA-265/HPA-271);
- editor provenance authoring controls (HPA-273);
- people/location/social archives or broad case-file migration hardening
  (HPA-274);
- branching supersession graphs;
- generic confidence scores or probabilistic evidence weighting;
- a public successor ID or a new public transitive-lineage field.

Later tickets consume this contract rather than redefining source identity,
procedural status, proof capability, supersession, acquisition visibility, or
fact-support closure.
