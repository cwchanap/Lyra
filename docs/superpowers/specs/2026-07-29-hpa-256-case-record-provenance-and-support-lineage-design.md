# HPA-256 Case-Record Provenance and Support-Lineage Design

**Status:** Approved in conversation  
**Issue:** HPA-256 — Add orthogonal case-record provenance, immutable supersession, and support lineage  
**Date:** 2026-07-29

## 1. References and scope

This focused design refines:

- `docs/superpowers/specs/2026-07-19-detective-gameplay-systems-design.md`
  §§10–11.1;
- `docs/superpowers/plans/2026-07-19-detective-gameplay-systems-implementation-plan.md`
  epic P0.2;
- the merged HPA-55 transaction/dialogue/navigation seams;
- the merged HPA-255 global catalog and durable story-state contract;
- the merged HPA-129/HPA-392 save, restore, content-identity, and exact-recapture
  implementation.

HPA-256 adds one shared provenance vocabulary for evidence and statements,
immutable case-record supersession chains, and deterministic support-lineage
queries. It deliberately builds on the existing catalog, inventory, fact state,
and save contracts rather than creating parallel stores.

This slice delivers:

- optional provenance authoring on every evidence and statement manifest entry;
- neutral defaults for all existing unannotated records;
- compiler and Rust validation of provenance and supersession;
- catalog-backed provenance lookup for evidence and statements;
- immutable lead → reacquired → exhibit chains;
- source-group independence semantics;
- deterministic direct and transitive fact-support closure;
- a compiler requirement seam for later analysis boards;
- public/frontend provenance types without a case-file redesign;
- save/restore preservation through stable record IDs plus content identity.

It does not add analysis-scene Markdown, threshold-board syntax, case-file UI,
new record-acquisition commands, automatic source inference, or production
story provenance annotations.

## 2. Approved decisions

1. Provenance is immutable compiled definition data, not mutable save state.
2. Evidence and statements use the same `CaseRecordProvenance` contract.
3. The provenance dimensions are orthogonal. No value in one dimension implies a
   value in another.
4. Omitted provenance compiles to neutral legacy defaults and causes no visible
   UI change.
5. A newer record points to the immediate older record through
   `supersedesRecordId`; older records are never mutated or removed.
6. Supersession is a chain, not a branching graph. A record may have at most one
   immediate successor.
7. Procedural status may stay equal or advance, but may not regress through a
   supersession edge.
8. `sourceGroupId` is the only source-independence identity. Labels,
   supersession, record kind, and matching prose do not establish independence.
9. A missing source group means independence is unknown. It never counts as a
   unique independent source.
10. Facts retain their existing direct typed supporting-record and
    supporting-fact edges. HPA-256 adds derived closure; it does not duplicate
    or replace HPA-255 fact mutation.
11. The generated story catalog advances to schema version 2 because the global
    case-record indexes gain provenance.
12. Save schema version 1 remains unchanged. Saves retain stable record IDs,
    acquisition locations, and direct support edges; provenance and
    supersession rejoin from the exact content revision.
13. A provenance-only content edit must change the package content revision.
14. `@lyra/scene-types` remains unchanged. Provenance is compiler/runtime/game
    state data and is not yet an editor-shared layout contract.
15. Public views do not reveal an unacquired predecessor or successor ID.

## 3. Current repository constraints

The current compiler:

- parses evidence and statement manifests through the shared
  `parser-manifest.ts` path;
- emits full record definitions inside scene JSON;
- emits lightweight evidence and statement indexes into `story_catalog.json`;
- treats evidence IDs and statement IDs as separate game-global typed
  namespaces;
- computes one package content revision for save compatibility.

The current runtime:

- deserializes evidence and statement definitions from scene JSON;
- loads immutable record indexes through `StoryCatalog`;
- copies acquired record display data and acquisition locations into
  `Inventory`;
- stores typed supporting records and supporting fact IDs inside sparse
  `StoryState` fact progress;
- validates support existence and supporting-fact acyclicity;
- serializes inventory as record IDs plus acquisition chapter/scene;
- serializes direct fact support in `StoryStateSnapshotV1`;
- reconstructs inventory and story state against the installed package and
  demands exact recapture after restore.

HPA-256 must preserve those boundaries. In particular, it must not copy authored
record prose or immutable provenance into saves merely to make persistence look
self-contained.

## 4. Domain invariants

### 4.1 Orthogonality

The shared provenance shape is:

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

Every dimension answers a different question:

- `sourceKind`: what kind of originating source this record represents;
- `representationLayer`: which representation or processing layer is shown;
- `proceduralStatus`: where this immutable record sits in the legal/acquisition
  process;
- `completeness`: whether the represented material is whole or limited;
- `confidence`: its currently authored corroboration state;
- `sourceGroupId`: which underlying source it belongs to for independence;
- `sourceLabel`: optional player-facing source wording;
- `proofCapabilities`: which positive claims this record may support;
- `supersedesRecordId`: the immediate older immutable record.

The compiler and runtime never infer across dimensions. Examples:

- `digital` does not imply `time`;
- `raw` does not imply `complete`, `corroborated`, or `exhibit`;
- `exhibit` does not imply `corroborated`;
- `complete` does not imply any proof capability;
- two records in one supersession chain are not automatically independent;
- a statement record may still describe a digital, physical, or subjective
  source when that is what the authored record represents.

Proof capabilities are positive limits. An absent capability means “this record
cannot satisfy that authored proof requirement”; it does not prove the opposite
claim.

### 4.2 Neutral legacy defaults

An evidence or statement entry with no provenance metadata emits:

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

These defaults preserve existing gameplay and presentation but do not satisfy an
explicit metadata requirement. In particular:

- `unspecified` does not satisfy `exhibit`;
- an empty capability set satisfies no capability requirement;
- a null source group contributes no independent source;
- `none` does not satisfy a requirement for `raw`, `sync`, `summary`, or
  `composite`.

A physical record may intentionally use `representationLayer: none`. The emitted
value does not retain a separate “explicitly authored” bit; consumers must state
through their requirement whether `none` is acceptable.

### 4.3 Definition data versus mutable state

Provenance and supersession belong to immutable definitions. The mutable record
state remains:

- whether the record has been acquired;
- where it was acquired;
- any existing acquisition acknowledgement state;
- direct fact-support references that name the record.

Acquiring a record does not upgrade its `proceduralStatus`. Reacquisition or
admission as an exhibit creates and acquires another immutable record.

## 5. Authoring contract

### 5.1 Optional metadata

Evidence and statement entries accept these exact optional fields alongside
their current required metadata:

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

Statements use the same fields and a typed statement supersession reference:

```md
- **Supersedes:** statement:initial_witness_account
```

Authors may omit the whole provenance set or any individual field. Omission uses
the neutral default for that field.

### 5.2 Values and syntax

- `Source Kind`: `physical`, `testimony`, `digital`, `subjective`, or
  `unspecified`.
- `Representation Layer`: `raw`, `sync`, `summary`, `composite`, or `none`.
- `Procedural Status`: `unspecified`, `lead`, `reacquired`, or `exhibit`.
- `Completeness`: `complete`, `partial`, `cropped`, or `unspecified`.
- `Confidence`: `unverified`, `corroborated`, `disputed`, or `unspecified`.
- `Source Group`: one non-empty `^[a-z0-9_]+$` slug.
- `Source Label`: non-empty display text.
- `Proof Capabilities`: a bracketed comma-separated list using only the ten
  canonical capability values; `[]` is allowed explicitly.
- `Supersedes`: exactly one typed `evidence:<id>` or `statement:<id>` reference.

Present-but-blank metadata is invalid. Repeated metadata is invalid. Duplicate
proof capabilities are invalid rather than silently deduplicated.

The manifest parser closes evidence/statement metadata to the union of the
existing documented fields, evidence-image fields where applicable, and these
provenance fields. Unknown fields produce source-located diagnostics instead of
being ignored. The implementation may refactor metadata collection so repeated
keys retain both line locations; it must not change dialogue-block parsing.

### 5.3 AST representation

Compiler AST records gain a source-located provenance object:

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

`ASTEvidence` and `ASTStatement` both own `provenance`. The emitter converts
omissions to defaults only after parsing and validation, so diagnostics can
still distinguish omitted metadata from an explicitly authored value.

### 5.4 Story-facing validation examples

The contract supports story patterns already required by the narrative:

- a store-owner phone screenshot may be a `lead`, while the independently fixed
  police/forensic capture is a separate `exhibit` that supersedes it;
- several clips cut from one broadcast wall remain separate records but share
  one `sourceGroupId`;
- a social repost lead, a legally reacquired original, and a hearing exhibit are
  three records in one immutable chain;
- an anonymous or cropped source may prove `route` without proving `identity`;
- a complete raw export can remain `disputed` and still lack a particular proof
  capability.

No story prose is parsed to create these values automatically.

## 6. Compiler and generated artifacts

### 6.1 Scene JSON

Both emitted evidence and statement definitions gain a required normalized
`provenance` field. The field is always present in generated JSON, including for
legacy records.

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

Proof capabilities emit in this canonical order, independent of author order:

```text
time, order, route, identity, access, motive,
source, credibility, procedure, causation
```

This makes generated JSON, definition hashing, and Rust set behavior
deterministic.

### 6.2 Story catalog schema version 2

`story_catalog.json` advances from version 1 to version 2:

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

The scene definition remains the owner of record prose, image references, and
acquisition dialogue. The catalog index repeats only origin and provenance from
the same compiler AST so runtime services can resolve provenance without loading
every scene on demand.

A missing authored `story_catalog.md` still emits a required empty version-2
artifact. Catalog facts, questions, objectives, and authorizations otherwise
retain their current version-1 behavior.

### 6.3 Compiler validation

After all scenes have parsed, the compiler validates:

- every superseded target exists;
- evidence supersedes only evidence and statements supersede only statements;
- no record supersedes itself;
- the supersession graph is acyclic;
- one predecessor has at most one immediate successor;
- procedural status does not regress across an edge;
- all IDs and source groups use the existing slug rule;
- proof-capability values are known and unique;
- emitted provenance is normalized and deterministic.

Supersession is validated game-wide after typed evidence and statement indexes
exist. Diagnostics point to the newer record’s `Supersedes` metadata line and
name the conflicting older/newer records.

### 6.4 Procedural-status ordering

Status progression uses this rank only for supersession validation:

```text
unspecified < lead < reacquired < exhibit
```

Allowed examples:

- `unspecified → unspecified`;
- `unspecified → lead`;
- `lead → lead`;
- `lead → reacquired`;
- `lead → exhibit`;
- `reacquired → reacquired`;
- `reacquired → exhibit`;
- `exhibit → exhibit`.

Rejected examples include `reacquired → lead`, `exhibit → reacquired`, and any
explicit status superseded by `unspecified`.

The ordering does not imply confidence, completeness, source identity, or proof
capability.

### 6.5 Content identity

The package content revision must include normalized scene/catalog provenance.
Tests must prove that changing only one provenance value changes the content
revision. This is the compatibility condition that permits save schema version
1 to keep record IDs rather than copying immutable provenance.

## 7. Immutable supersession semantics

### 7.1 Edge direction

The newer record owns the pointer to its immediate predecessor:

```text
anonymous_social_clip
        ↑ superseded by
verified_original_clip
        ↑ superseded by
hearing_exhibit_clip
```

In JSON:

```json
{
  "id": "verified_original_clip",
  "provenance": {
    "supersedesRecordId": "anonymous_social_clip"
  }
}
```

Earlier records remain valid immutable definitions and, once acquired, remain in
inventory. Acquiring a successor never deletes or rewrites its predecessor.

### 7.2 Chain rather than graph

Each record has at most one predecessor because it stores one pointer. Compiler
validation also permits at most one successor for any predecessor. This creates
one linear audit trail per record family and avoids ambiguous “current version”
selection.

If future story content genuinely needs one source to branch into several
independent derived records, those records use source grouping and explicit
support relationships; they do not overload supersession.

### 7.3 Definition and inventory queries

`game/provenance.rs` exposes internal deterministic queries:

```rust
fn predecessor(target: &InventoryTarget) -> Option<InventoryTarget>;
fn successor(target: &InventoryTarget) -> Option<InventoryTarget>;
fn chain(target: &InventoryTarget) -> Result<Vec<InventoryTarget>, ProvenanceError>;
fn latest_definition(target: &InventoryTarget) -> Result<InventoryTarget, ProvenanceError>;
```

Inventory-aware helpers separately answer whether a predecessor or successor is
currently acquired. Definition-level knowledge is never copied directly into a
public view when doing so would reveal locked or unacquired content.

### 7.4 Public no-spoiler rule

An acquired successor may publicly expose `supersedesRecordId` only when that
predecessor is also acquired. An acquired predecessor does not expose the ID of
a packaged future successor until the successor is acquired.

This preserves immutable lineage without leaking a future record name through
the case file or ordinary inventory view. Internal compiler/runtime evaluators
may use the complete validated definition chain.

## 8. Rust architecture

### 8.1 Module ownership

HPA-256 adds:

```text
apps/game/src-tauri/src/game/
  provenance.rs       provenance enums, defaults, validation, definition lookup
  support_lineage.rs  transitive fact/record/source closure
```

And extends:

```text
schema.rs             evidence/statement JSON provenance field
state.rs              acquired evidence/statement provenance projection
story/catalog.rs      catalog-v2 case-record definitions and typed lookup
story/state.rs        reuse/move support traversal helpers without changing state shape
story/view.rs         retain direct fact lineage; no new archive UI
view.rs               serialize acquired record provenance
save/capture.rs       validation and round-trip tests; no new snapshot field
save/restore.rs       exact rejoin tests; no new snapshot field
```

`GameEngine` does not gain a second provenance store. `StoryCatalog` and scene
definitions remain immutable; `Inventory` contains acquired projections.

### 8.2 Rust provenance types

`provenance.rs` owns serde-compatible enums and the shared struct. Enums derive
`Copy`, `Ord`, serialization, and deserialization where appropriate.

```rust
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaseRecordProvenance {
    #[serde(default)]
    pub source_kind: SourceKind,
    #[serde(default)]
    pub representation_layer: RepresentationLayer,
    #[serde(default)]
    pub procedural_status: ProceduralStatus,
    #[serde(default)]
    pub completeness: Completeness,
    #[serde(default)]
    pub confidence: Confidence,
    #[serde(default)]
    pub source_group_id: Option<String>,
    #[serde(default)]
    pub source_label: Option<String>,
    #[serde(default)]
    pub proof_capabilities: BTreeSet<ProofCapability>,
    #[serde(default)]
    pub supersedes_record_id: Option<String>,
}
```

Every enum’s `Default` is the neutral value defined in §4.2. Legacy hand-built
Rust fixtures and legacy generated scene JSON therefore deserialize without
manual provenance fields.

The runtime still validates all compiler invariants while loading the catalog as
defense in depth, including supersession existence, kind, cycle, fork, slug,
and status-order checks.

### 8.3 Catalog record resolver

The current catalog’s evidence and statement indexes become complete immutable
record definitions:

```rust
pub(in crate::game) struct CaseRecordDefinition {
    pub id: String,
    pub chapter_id: String,
    pub scene_id: String,
    pub provenance: CaseRecordProvenance,
}
```

The catalog exposes typed lookup so evidence and statement namespaces may reuse
a slug safely:

```rust
fn case_record(&self, target: &InventoryTarget)
    -> Option<&CaseRecordDefinition>;
```

All support and threshold services resolve through this method rather than
searching scene arrays or comparing untyped strings.

### 8.4 Acquired record projection

`EvidenceRecord` and `StatementRecord` gain `provenance` copied from their
immutable scene definition when acquired.

The acquisition chapter/scene remains a separate mutable origin:

- provenance says what the record is and its procedural/representation status;
- `collectedInChapterId` / `acquiredInChapterId` says where this instance entered
  the player’s case file.

A lead, reacquired record, and exhibit each retain their own acquisition origin.
No acquisition path mutates an earlier record.

The copy keeps the acquired runtime record self-contained for re-examination and
command handling. Save capture does not serialize it; restore reconstructs the
same projection from the current exact definitions.

Because `GameStateView` currently serializes `Inventory` directly, HPA-256
introduces a separate `InventoryView`/record-view projection in `game/view.rs`.
It is built from `Inventory` plus the acquired ID sets and applies the no-spoiler
rule without weakening the internal immutable provenance. The external JSON
shape remains an `inventory` object with evidence and statement arrays.

## 9. Source independence and proof evaluation

### 9.1 Source-group identity

`sourceGroupId` is a game-global semantic key across both evidence and statement
records. Records with the same non-null value count as one underlying source,
even when they:

- have different record IDs;
- are different record kinds;
- use different representation layers;
- appear at different procedural statuses;
- occur in different scenes or chapters;
- are linked through supersession.

Different non-null group IDs count independently. A null group is unknown and
never creates a synthetic one-record group.

`sourceLabel` is display text only. Matching labels do not merge groups, and
conflicting or missing labels do not change independence semantics.

### 9.2 Supersession is not independence

Supersession and source grouping answer separate questions:

- supersession: which immutable record replaced which earlier case-file record;
- source group: which underlying source the record derives from.

The compiler does not automatically inherit or rewrite a source group along a
supersession chain. Authors normally reuse a group when a lead, reacquired
original, and exhibit derive from one underlying source, but may author a
changed group when the newer record genuinely establishes a different source.

### 9.3 Capability/status checks

Reusable runtime helpers perform exact membership checks:

```rust
fn has_capabilities(record, required) -> bool;
fn status_allowed(record, allowed, prohibited) -> bool;
fn source_group(record) -> Result<&str, MissingSourceGroup>;
```

No helper substitutes confidence, completeness, source kind, or representation
layer for a missing capability.

## 10. Fact support lineage

### 10.1 Existing direct state remains authoritative

HPA-255 already owns:

- typed direct `supporting_records`;
- direct `supporting_fact_ids`;
- support-target existence validation;
- self-support and transitive cycle rejection;
- snapshot serialization and restore validation;
- direct support in `FactView`.

HPA-256 does not add a second fact graph or a second assertion mutation. It may
move the shared graph walk into `support_lineage.rs` if that reduces duplication,
but the wire and save shapes remain unchanged.

### 10.2 Derived closure

`support_lineage.rs` exposes deterministic, read-only queries:

```rust
fn direct_records(fact_id: &str) -> Result<BTreeSet<InventoryTarget>, LineageError>;
fn transitive_records(fact_id: &str) -> Result<BTreeSet<InventoryTarget>, LineageError>;
fn transitive_facts(fact_id: &str) -> Result<BTreeSet<String>, LineageError>;
fn transitive_source_groups(fact_id: &str) -> Result<BTreeSet<String>, LineageError>;
```

`transitive_records` includes records directly supporting the target fact and
records supporting every recursively referenced fact. It never adds a fact as a
record and deduplicates typed record identities deterministically.

`transitive_facts` returns supporting facts only; it does not include the queried
root fact.

`transitive_source_groups` first computes record closure, then resolves every
record through the catalog. If any record lacks `sourceGroupId`, it returns a
typed error listing those records instead of silently dropping or uniquely
counting them.

The traversal uses visited tracking even though live mutation and restore
validation already reject cycles. Unknown fact or record references remain typed
errors at this defense-in-depth boundary.

### 10.3 Evaluator semantics

For source-independent thresholds:

- selectable evidence and statements count through their non-null source groups;
- a fact contributes only the transitive evidence/statement closure beneath it;
- two facts supported by the same source group still contribute one source;
- a lead and its exhibit do not contribute twice when they share a group;
- free case notes never create source groups.

HPA-262 consumes these services. HPA-256 supplies and tests the semantics but
does not implement a threshold board.

## 11. Compiler metadata-requirement seam

HPA-259 will introduce analysis-board authoring. HPA-256 establishes the shared
compiler-only requirement contract now without inventing board Markdown:

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

Rules:

- an allowed list uses exact membership;
- a prohibited status always wins;
- `requireSourceGroup` rejects null;
- every required capability must be present;
- neutral defaults fail any explicit requirement that excludes them;
- diagnostics point to the board/requirement location and identify the record
  whose metadata is insufficient.

When a later board requires independent source groups, HPA-259 calls this helper
for every resolved selectable candidate. A board cannot compile with an
eligible candidate whose source group is unknown and then guess at runtime.

## 12. Public and frontend contract

### 12.1 Public inventory

`GameStateView` exposes a dedicated `InventoryView` rather than serializing the
mutable `Inventory` aggregate directly. Each acquired public record includes a
provenance object, and frontend mirrors define all enums and fields exactly:

```ts
export type EvidenceRecord = {
  // existing fields
  provenance: CaseRecordProvenance;
};

export type StatementRecord = {
  // existing fields
  provenance: CaseRecordProvenance;
};
```

The public projection applies the no-spoiler rule in §7.4 to
`supersedesRecordId`; internal inventory and catalog definitions retain the full
validated pointer.

### 12.2 Facts

`FactView` keeps its existing direct `supportingRecords` and
`supportingFactIds`. HPA-256 does not expose transitive closure as a new public
field because no current UI consumes it. Later case-file/analysis work may call
a dedicated Rust-owned view builder rather than recomputing closure in Svelte.

### 12.3 No visible redesign

No current component renders provenance badges, source groups, procedural
status, or supersession. Existing evidence trays, re-examination, acquisition
popups, dialogue, and Chapter 1/2 presentation remain visually unchanged.

Frontend fixture objects gain neutral provenance where required by the wire
type. Regression tests assert that a legacy record’s rendered DOM and accessible
name remain unchanged.

`@lyra/scene-types` is not extended in this ticket. HPA-273 may later add an
editor-facing subset after the authoring UI is designed.

## 13. Persistence and compatibility

### 13.1 Save shape remains version 1

The save already stores everything mutable needed for this feature:

- acquired record ID;
- acquisition chapter and scene;
- direct typed supporting record IDs;
- direct supporting fact IDs;
- exact package content revision.

It therefore does not add provenance, source group, capabilities, or
supersession fields to `InventorySnapshotV1` or `StoryStateSnapshotV1`.

### 13.2 Capture and restore

Capture validates:

- every acquired record resolves through the current catalog;
- the acquired runtime record matches its immutable definition provenance;
- every direct supporting record resolves;
- story state remains valid and acyclic.

Restore:

1. validates schema and exact content revision;
2. loads catalog-v2 definitions;
3. reconstructs inventory records from saved IDs and acquisition locations;
4. reconstructs direct fact support from the save;
5. recomputes provenance/supersession/source closure from definitions;
6. recaptures the candidate and demands exact snapshot equality.

Because provenance is definition data, exact snapshot equality remains unchanged.
Dedicated tests additionally compare the pre-save and post-restore public
provenance and derived lineage results.

### 13.3 Compatibility consequences

A package built before catalog schema version 2 must regenerate scene resources.
An older pre-release save has a different content revision and is rejected by the
existing compatibility gate; no save-schema migration is needed.

A future shipped release that wants to preserve saves across provenance edits
must add an explicit content migration. HPA-256 does not weaken content-revision
checks.

## 14. Diagnostics and failure behavior

Compiler diagnostics use stable codes and source locations. The focused plan may
refine exact names, but must cover these categories:

- malformed or unknown provenance value;
- blank provenance metadata;
- repeated provenance metadata;
- malformed or duplicate proof capability;
- invalid source-group slug;
- malformed typed supersession reference;
- unknown superseded record;
- cross-kind supersession;
- self-supersession;
- supersession fork;
- supersession cycle;
- procedural-status regression;
- missing metadata required by a consumer.

Runtime catalog corruption produces typed startup failure; it does not silently
drop invalid provenance or install a partially validated engine.

Lineage queries return typed errors for unknown facts/records, cycles detected at
the query boundary, and missing source groups. Threshold consumers must surface
an authored/configuration error, not reinterpret missing metadata as player
failure.

## 15. Verification and acceptance mapping

### 15.1 Compiler tests

- Parse every enum value for evidence and statements.
- Parse all ten proof capabilities.
- Emit neutral defaults when all provenance fields are omitted.
- Reject blank, repeated, unknown, malformed, and duplicate metadata.
- Reject invalid source groups and typed supersession references.
- Emit canonical capability ordering.
- Emit story catalog schema version 2.
- Validate missing, cross-kind, self, forked, cyclic, and regressing chains.
- Prove same-group wall-derived clips remain distinct records in emitted JSON.
- Prove the metadata-requirement helper rejects unspecified exhibit status,
  missing capabilities, and null source groups.
- Prove a provenance-only change changes the content revision.
- Compile the live existing chapters without authored provenance migration.

### 15.2 Rust tests

- Deserialize legacy scene records through defaults.
- Round-trip every provenance enum and field through serde.
- Reject catalog-v2 corruption for every chain invariant.
- Resolve typed evidence/statement provenance through the catalog.
- Copy provenance into acquired inventory without mutating acquisition origin.
- Keep predecessor and successor as separate acquired records.
- Hide unacquired lineage IDs from public views.
- Deduplicate several records with one source group.
- Treat null source group as a typed independence error.
- Compute direct and multi-level transitive record/fact closure.
- Deduplicate one record reached through several supporting facts.
- Preserve existing cycle rejection and snapshot validation.
- Capture/save/restore lead → reacquired → exhibit records and confirm identical
  provenance, acquisition origins, direct support, transitive closure, and source
  groups after restore.
- Preserve exact save recapture with no new snapshot fields.

### 15.3 Frontend/regression tests

- Mirror every provenance enum and field in `state/types.ts`.
- Update state fixtures with neutral provenance.
- Confirm current evidence/statement rendering ignores neutral provenance and is
  visually/accessibly unchanged.
- Confirm acquisition popup behavior is unchanged.
- Run the existing Chapter 1 full-playthrough regression.

### 15.4 Required command gates

The implementation plan must end with at least:

```text
bun run scenes:compile
bun run check:scripts
bun run test
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run check
bun run lint:all
```

Focused tests run first. Packaged Tauri E2E is required only if implementation
changes a currently rendered flow or save command surface; otherwise existing
save capture/restore integration and full-playthrough coverage are the P0 gate.

## 16. Expected file boundaries

Compiler:

```text
Modify packages/scripts/compile-scenes/types.ts
Modify packages/scripts/compile-scenes/parser-manifest.ts
Add    packages/scripts/compile-scenes/case-record-provenance.ts
Modify packages/scripts/compile-scenes/emitter.ts
Modify packages/scripts/compile-scenes/story-catalog.ts
Modify packages/scripts/compile-scenes/validator.ts
Modify packages/scripts/compile-scenes/save-content-references.ts or the
       current content-revision input boundary if required
Add/modify focused compiler fixtures and tests
```

Rust:

```text
Add    apps/game/src-tauri/src/game/provenance.rs
Add    apps/game/src-tauri/src/game/support_lineage.rs
Modify apps/game/src-tauri/src/game/mod.rs
Modify apps/game/src-tauri/src/game/schema.rs
Modify apps/game/src-tauri/src/game/state.rs
Modify apps/game/src-tauri/src/game/story/catalog.rs
Modify apps/game/src-tauri/src/game/story/state.rs
Modify apps/game/src-tauri/src/game/story/view.rs as needed for shared helpers
Modify apps/game/src-tauri/src/game/view.rs (add `InventoryView` projection)
Modify apps/game/src-tauri/src/game/save/capture.rs
Modify apps/game/src-tauri/src/game/save/restore.rs
Modify Rust fixtures and focused tests
```

Frontend:

```text
Modify apps/game/src/lib/state/types.ts
Modify state/component fixtures and regression tests
```

Documentation:

```text
Add docs/superpowers/plans/2026-07-29-hpa-256-case-record-provenance-and-support-lineage-implementation-plan.md
```

The implementation plan may refine test filenames and split a large Rust module,
but it must preserve the ownership boundaries in this design.

## 17. Non-goals and future ownership

HPA-256 does not implement:

- automatic provenance inference from names, prose, record kind, or scene type;
- automatic source-group inheritance through supersession;
- automatic capability inference from raw/composite/exhibit status;
- analysis-scene Markdown or accepted solutions (HPA-259);
- Rust analysis drafts/evaluation (HPA-260);
- workbench or case-file visual redesign (HPA-258/HPA-261);
- classify/order/threshold board behavior (HPA-262);
- procedural request/grant behavior (HPA-264);
- production Chapter 1/2 provenance authoring (HPA-265/HPA-271);
- people/location/social archives or broad case-file migration hardening
  (HPA-274);
- editor authoring controls (HPA-273);
- branching supersession graphs;
- generic confidence scores or probabilistic evidence weighting.

Later tickets consume this contract rather than redefining source identity,
procedural status, proof capability, or fact-support closure.
