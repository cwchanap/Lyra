# HPA-256 Case-Record Provenance and Support-Lineage Design

**Status:** Ready for approval; revised after three focused codebase reviews and a final self-review  
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
immutable case-record supersession chains, explicit source-group identity, and
deterministic support-lineage queries. It builds on existing scene definitions,
the global story catalog, inventory, fact state, public views, and save contracts
instead of creating parallel stores.

This slice delivers:

- optional provenance authoring on every evidence and statement manifest entry;
- neutral defaults for existing unannotated records;
- a globally authored source-group registry whose membership is derived from
  record metadata;
- source-located, duplicate-safe, closed-key manifest metadata parsing;
- compiler and Rust validation of provenance and supersession;
- exact scene-definition ↔ catalog-index provenance equality;
- immutable lead → reacquired → exhibit chains;
- conservative source-independence semantics;
- deterministic direct and transitive fact-support closure;
- diagnostic and strict source-group closure APIs;
- explicit inventory-independent internal lineage and consumer-level filters;
- a compiler requirement seam for later analysis boards;
- spoiler-safe public inventory and fact-support projections;
- save/restore preservation through stable record IDs plus content identity;
- updated investigation/interrogation authoring guidance.

It does not add analysis-scene Markdown, threshold-board syntax, case-file UI,
new acquisition commands, automatic source inference, production story
provenance annotations, or a layout-editor provenance form.

## 2. Approved decisions

1. Provenance is immutable compiled definition data, not mutable save state.
2. Evidence and statements share one `CaseRecordProvenance` contract.
3. Provenance dimensions are orthogonal. No value in one dimension implies a
   value in another.
4. Omitted authored provenance compiles to explicit neutral defaults and causes
   no visible UI change.
5. Every neutral Rust enum default is designated explicitly; declaration order
   never determines semantic defaults.
6. A newer record points to its immediate predecessor through
   `supersedesRecordId`; older records are never mutated or removed.
7. Supersession is a chain, not a branching graph. A record may have at most one
   immediate successor.
8. Procedural status may stay equal or advance, but may not regress through a
   supersession edge.
9. `sourceGroupId` is the only source-independence identity. Labels,
   supersession, record kind, matching prose, and matching acquisition origin do
   not establish independence.
10. Every non-null `sourceGroupId` must resolve to one authored source-group
    definition in `story_catalog.md`.
11. Source-group identity and description are authored once in the global
    registry. Typed membership is authored only by each record's `Source Group`
    field and is derived by the compiler.
12. Emitted `sourceGroups[].members` is a deterministic audit projection, not a
    second authored source of truth.
13. An unused source-group definition is invalid. A legal singleton group is
    accepted but surfaced as a deterministic non-blocking
    `singletonSourceGroup` warning.
14. A missing source group means independence is unknown. It never counts as a
    synthetic one-record source.
15. Duplicate proof capabilities are rejected before normalization. Rust wire
    deserialization uses an ordered `Vec`; the validated domain uses a set.
16. Generated capability arrays use one explicit canonical rank. Runtime rejects
    duplicate or non-canonical arrays rather than silently repairing them.
17. Canonical wire ordering for typed record IDs uses an explicit
    evidence-before-statement comparator and never relies on Rust enum declaration
    order or derived `Ord`.
18. Facts retain HPA-255's direct typed supporting-record and supporting-fact
    edges. HPA-256 adds derived closure; it does not duplicate fact mutation.
19. Internal lineage is pure over asserted `StoryState` progress plus immutable
    `StoryCatalog` definitions. It does not implicitly filter by inventory.
20. Player-facing and selection-facing consumers apply their own acquired or
    selected-record boundary. Internal closure is never itself a possession
    count.
21. Derived source closure has two levels: a diagnostic result returns known
    groups plus records with missing groups; a strict complete-count operation
    fails while any supporting record has an unknown group.
22. HPA-262 MVP threshold boards count selected evidence/statement records
    directly. Facts and case notes are not eligible independent-source inputs in
    that ticket.
23. A supersession-chain query returns the complete containing chain, includes
    the target, and orders records oldest → newest.
24. Scene JSON and the catalog repeat provenance from one normalized compiler
    value. Same-ID copies must be structurally equal.
25. The catalog is authoritative for lineage, source-group, capability, and
    supersession queries. Scene definitions remain authoritative for record
    prose, images, acquisition dialogue, and acquisition-time lookup. Runtime
    validation rejects disagreement.
26. The generated story catalog advances to schema version 2. The existing
    minimal version-envelope pattern is reused rather than reinvented.
27. Rust rejects every catalog whose `schemaVersion` is not 2 before attempting
    v2 payload deserialization. Legacy scene defaults never make catalog v1
    acceptable.
28. The existing private Rust `CaseRecordDefinitionIndex` is replaced by a v2
    wire type plus a validated `CaseRecordDefinition` domain type; no parallel
    legacy index remains.
29. Save schema version 1 remains unchanged. Saves retain stable record IDs,
    acquisition locations, and direct support edges; immutable provenance rejoins
    from the exact content revision.
30. `SaveContentBundleV1` and `SaveContentManifestV1` remain version 1 because
    their version describes the manifest envelope and hash algorithm, not the
    nested story-catalog schema.
31. `save-content-manifest.ts` receives the required v2 catalog type-reference
    update. The canonical SHA-256 algorithm and `manifestVersion: 1` do not
    change.
32. A provenance-only or source-group-only content edit must change the package
    content revision.
33. Any future provenance wire-field addition, removal, or semantic
    reinterpretation requires another catalog schema-version bump.
34. `@lyra/scene-types` remains unchanged. Provenance is not yet an
    editor-shared layout contract.
35. `GameStateView` exposes an `InventoryView`; mutable `Inventory` is no longer
    a public serialization surface.
36. Public views do not reveal an unacquired predecessor or future successor ID.
37. Public `supersedesRecordId: null` intentionally means either no predecessor
    exists or the predecessor is unacquired and redacted.
38. Public redaction is recomputed on every `GameEngine::view()` build from the
    current inventory. It is not frozen at acquisition.
39. `FactView.supportingRecords` does not leak unacquired record IDs even though
    internal fact progress may legally reference them.
40. Public `supportingRecords: []` means no acquired direct supporting records
    are exposed; it does not prove internal progress has no direct support.
41. HPA-256 does not add a `hasHiddenSupportingRecords` flag because that flag
    would itself disclose locked content.
42. Provenance and lineage service APIs take their required catalog/state context
    and return the repository's `GameError` contract. Illustrative free functions
    and unconnected public error types are not accepted.
43. `acquisitionDefinitionMismatch`, `caseRecordDefinitionMismatch`, and
    `inventoryRecordDefinitionMismatch` have separate responsibilities; one code
    never ambiguously covers all three conditions.
44. The investigation and interrogation authoring skills document every
    provenance field, source-group registry requirement, neutral default, and
    explicit-status supersession warning.
45. `.claude/skills/` remains the repository-canonical authoring-skill path.

## 3. Current repository constraints

The current compiler:

- parses evidence and statement manifests through shared
  `parser-manifest.ts`, consumed by both investigation and interrogation parsers;
- currently collapses metadata into `Record<string, string>`, losing per-key
  lines, silently overwriting duplicate keys, and ignoring most unknown keys;
- emits full evidence/statement definitions inside scene JSON;
- independently emits lightweight evidence/statement indexes into
  `story_catalog.json`;
- parses `story_catalog.md` sections for facts, questions, objectives, and
  authorizations with source-located field maps;
- permits recognized story-catalog sections to be omitted while enforcing the
  order of sections that are present;
- treats evidence and statement IDs as separate game-global typed namespaces;
- computes one package content revision from the canonical emitted scene/catalog
  bundle in `save-content-manifest.ts`;
- already has a non-blocking compiler-warning channel suitable for author-review
  diagnostics.

The current runtime:

- already reads a minimal `StoryCatalogVersionEnvelope` before deserializing the
  version-specific catalog payload;
- currently accepts catalog schema version 1 and uses version 2 as an unsupported
  test sentinel;
- stores evidence and statement indexes in a private
  `CaseRecordDefinitionIndex` containing ID, chapter, and scene;
- deserializes evidence and statement definitions from scene JSON;
- copies acquired display data and acquisition locations into `Inventory`;
- currently serializes mutable `Inventory` directly in `GameStateView`;
- stores typed supporting records and supporting fact IDs inside sparse
  `StoryState` fact progress;
- validates supporting records only against catalog existence, while supporting
  facts must also have been asserted;
- serializes inventory as record IDs plus acquisition chapter/scene;
- serializes direct fact support in `StoryStateSnapshotV1`;
- reconstructs inventory and story state against installed content and demands
  exact recapture after restore.

HPA-256 preserves those seams while closing five silent-drift paths:

1. mistyped or undeclared source groups;
2. duplicate or unknown manifest metadata;
3. duplicate/non-canonical capability arrays at the Rust wire boundary;
4. declaration-order-dependent wire sorting;
5. public inventory or fact views leaking immutable unacquired definitions.

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
- `proceduralStatus`: where the immutable record sits in the acquisition/legal
  process;
- `completeness`: whether the represented material is whole or limited;
- `confidence`: its authored corroboration state;
- `sourceGroupId`: which declared underlying source it belongs to;
- `sourceLabel`: optional record-specific player-facing source wording;
- `proofCapabilities`: which positive authored requirements it may satisfy;
- `supersedesRecordId`: the immediate older immutable record.

The compiler and runtime never infer across dimensions. For example:

- `digital` does not imply `time`;
- `raw` does not imply `complete`, `corroborated`, or `exhibit`;
- `exhibit` does not imply `corroborated`;
- `complete` does not imply a proof capability;
- records in one supersession chain are not automatically independent;
- a statement may represent a physical, digital, testimony, or subjective
  originating source.

Proof capabilities are positive limits. An absent capability means the record
cannot satisfy that authored requirement; it does not prove the opposite claim.

### 4.2 Neutral defaults

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

`RepresentationLayer::None` intentionally serves both as the neutral default and
as the authored value for a record with no meaningful representation layer.
HPA-256 does not retain an “explicitly authored” bit. A consumer that requires a
concrete layer must require `raw`, `sync`, `summary`, or `composite`; it cannot
distinguish omitted `none` from deliberately authored `none`.

### 4.3 Explicit neutral enum defaults

Rust enum defaults are semantic declarations, not side effects of variant order:

```rust
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub enum SourceKind {
    Physical,
    Testimony,
    Digital,
    Subjective,
    #[default]
    Unspecified,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub enum RepresentationLayer {
    Raw,
    Sync,
    Summary,
    Composite,
    #[default]
    None,
}
```

The same explicit pattern applies to:

- `ProceduralStatus::Unspecified`;
- `Completeness::Unspecified`;
- `Confidence::Unspecified`.

Tests compare `CaseRecordProvenance::default()` field-for-field with the neutral
JSON literal. Merely proving that a legacy scene deserializes is insufficient.

### 4.4 Source-group definitions and derived membership

A source group represents one underlying source for independence counting. It is
not inferred from labels, record kind, chapter, scene, representation, or
supersession.

The authored registry owns identity and documentation only:

```ts
type ASTSourceGroupDefinition = Located<{
  id: string;
  label: string;
  summary: string;
}>;
```

Each record optionally owns one `sourceGroupId`. After all records parse, the
compiler derives the reverse typed membership projection:

```ts
type SourceGroupDefinition = {
  id: string;
  label: string;
  summary: string;
  members: InventoryTarget[];
};
```

Registry invariants:

- every group ID is a unique `^[a-z0-9_]+$` slug;
- every non-null record `sourceGroupId` resolves to exactly one registry group;
- one record belongs to at most one group because it has one field;
- membership is derived from typed record identity, preserving evidence and
  statement namespaces even when their slugs match;
- every authored group has at least one derived member;
- singleton groups are legal;
- emitted members use the explicit canonical typed-record comparator;
- record prose, `sourceLabel`, supersession, and physical proximity never add or
  merge membership.

A misspelled record group fails against the registry. An accidentally declared but
unused group fails as orphaned. A legal singleton group compiles and produces a
deterministic non-blocking `singletonSourceGroup` warning naming its member,
making suspicious splits visible without forcing authors to maintain the same
membership twice.

`sourceLabel` remains record-specific presentation text. It neither replaces the
registry label nor establishes source identity.

### 4.5 Immutable definition data versus mutable progress

Provenance, derived source-group membership, and supersession belong to immutable
content definitions. Mutable progress remains:

- whether a record has been acquired;
- where it was acquired;
- existing acquisition acknowledgement state;
- direct fact-support edges naming records and facts.

Acquiring a record does not upgrade procedural status. Reacquisition or admission
as an exhibit creates and acquires another immutable record.

### 4.6 Story-facing examples

The contract supports the narrative's required procedure:

- an informal screenshot may be a `lead`, while a separately fixed forensic copy
  is an `exhibit` that supersedes it;
- several Chapter 2 wall/composite-derived clips remain separate records but
  author the same declared `sourceGroupId`, so the compiler derives one source;
- a social repost lead, legally reacquired original, and hearing exhibit form one
  immutable chain;
- an anonymous or cropped record may prove `route` without proving `identity`;
- a complete raw export may remain `disputed` and lack a requested capability.

No story prose is parsed to infer these values automatically.

## 5. Authoring contract

### 5.1 Optional record fields

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

Statements use the same provenance fields with typed statement supersession:

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
- `Source Group`: one declared non-empty source-group slug;
- `Source Label`: non-empty display text;
- `Proof Capabilities`: bracketed comma-separated canonical values; `[]` is
  allowed;
- `Supersedes`: one typed `evidence:<id>` or `statement:<id>` reference.

A record that authors `Supersedes` should explicitly author `Procedural Status`.
If a predecessor is `lead`, `reacquired`, or `exhibit` and the successor omits
status, the successor normalizes to `unspecified` and correctly fails the
non-regression rule.

### 5.2 Source-group registry authoring

`story_catalog.md` may include a final canonical section after Authorizations:

```md
## Source Groups

### Source Group: 澀谷活動 Program Composite {#shibuya_program_composite}

- **Summary:** 同一活動方 Program Composite 輸出衍生的紀錄。
```

Rules:

- section heading: exactly `## Source Groups`;
- item heading: `### Source Group: <label> {#<id>}`;
- required field: `Summary`;
- group IDs are unique slugs;
- membership is not authored in this section;
- each record joins the group through its own `Source Group` field;
- an unused definition is an error;
- singleton definitions are legal and produce a non-blocking
  `singletonSourceGroup` warning;
- a record reference to an undeclared group is an error at the record's
  `Source Group` line.

The section is optional when no groups are declared. An existing
`story_catalog.md` without `## Source Groups` parses as `sourceGroups: []`. When
present, the section must appear after all other recognized sections.

If `story_catalog.md` is entirely absent, the compiler may still emit an empty v2
catalog only when no record names a `Source Group`. A source-group reference
without a registry remains an error.

### 5.3 Source-located, duplicate-safe metadata collection

The current `consumeMetadata` last-write-wins map is replaced for evidence and
statement entries by a source-preserving collector:

```ts
type MetadataValue = {
  value: string;
  line: number;
};

type ManifestMetadata = Map<string, MetadataValue>;
```

Equivalent `{ values, lines }` storage is acceptable, but the following behavior
is mandatory:

- retain the exact line of every metadata key;
- reject a duplicate on its second occurrence;
- include the first occurrence's line in the diagnostic message;
- reject unknown keys against an entry-specific allowlist;
- reject present-but-blank provenance fields;
- keep current required-field diagnostics for Name/Description/Details and
  Speaker/Content;
- preserve existing dialogue-block parsing behavior.

Evidence allowlist:

```text
Name
Description
Details
Source Sublocation
Image Prompt
Source Kind
Representation Layer
Procedural Status
Completeness
Confidence
Source Group
Source Label
Proof Capabilities
Supersedes
```

Statement allowlist:

```text
Speaker
Content
Source Kind
Representation Layer
Procedural Status
Completeness
Confidence
Source Group
Source Label
Proof Capabilities
Supersedes
```

Thus `Source Knid`, a repeated `Supersedes`, or `Image Prompt` on a statement is a
source-located compile error rather than a neutral default or silent overwrite.

The implementation should reuse the source-location pattern already present in
`parser-assets.ts` and the field-map approach already present in
`parser-story-catalog.ts`.

### 5.4 Source-located AST

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

type ASTSourceGroupDefinition = Located<{
  id: string;
  label: string;
  summary: string;
}>;
```

`ASTEvidence` and `ASTStatement` own provenance. `ASTStoryCatalog` gains
`sourceGroups`. Defaults are applied only after parsing and validation, so an
omitted value remains distinguishable from malformed authored input while
source-located diagnostics are still available.

### 5.5 Procedural-status ordering

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

### 5.6 Authoring-skill obligations

The implementation updates the repository-canonical files:

```text
.claude/skills/writing-investigation-scene/SKILL.md
.claude/skills/writing-interrogation-scene/SKILL.md
```

Both must:

- list every provenance field and allowed value;
- explain neutral defaults;
- explain that `none` conflates omitted and intentionally unlayered records;
- require source groups to be declared centrally while membership is authored on
  records and derived by the compiler;
- warn that `Supersedes` normally requires explicit procedural status;
- distinguish source grouping from supersession;
- describe proof capabilities as positive limits;
- preserve Traditional Chinese player-facing values and English parser-facing
  field names.

Non-normative implementation note: some local environments expose
`.agents/skills/` as a hardlinked or generated mirror. Editing the tracked
`.claude/skills/` source remains the repository contract; local mirrors may be
checked manually but are not a CI acceptance criterion.

## 6. Compiler and generated artifacts

### 6.1 Single normalization path and structural equality

The compiler introduces one pure normalization helper:

```ts
function emitCaseRecordProvenance(
  provenance: ASTCaseRecordProvenance,
): CaseRecordProvenance;
```

Each AST record is normalized once. Scene emission and story-catalog index
emission receive that normalized value; no second hand-written defaulting or
sorting path is allowed.

For every typed evidence/statement ID, tests assert structural equality:

```ts
assert.deepStrictEqual(
  sceneRecord.provenance,
  catalogIndexRecord.provenance,
);
```

A dedicated equality helper is also acceptable. Object-reference `===` is not the
contract. Focused tests cover both record kinds, omitted values, every enum,
capabilities, and supersession. A mismatch is a compiler defect and blocks all
output writes.

### 6.2 Scene JSON

Both emitted record definitions gain required normalized provenance:

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

### 6.3 Explicit canonical ordering

Capabilities use this semantic order:

```text
time, order, route, identity, access, motive,
source, credibility, procedure, causation
```

TypeScript owns an explicit rank table rather than relying on source-array or enum
order:

```ts
const PROOF_CAPABILITY_RANK: Record<ProofCapability, number> = {
  time: 0,
  order: 1,
  route: 2,
  identity: 3,
  access: 4,
  motive: 5,
  source: 6,
  credibility: 7,
  procedure: 8,
  causation: 9,
};
```

Typed record IDs use an explicit comparator:

```ts
function inventoryTargetSortKey(target: InventoryTarget): [number, string] {
  return target.kind === "evidence" ? [0, target.id] : [1, target.id];
}
```

The emitter only orders already valid duplicate-free values. Rust uses equivalent
rank and sort-key functions at strict wire boundaries and public serialization.
Internal `BTreeSet` ordering is not a normative wire contract.

### 6.4 Story catalog schema version 2

```ts
type StoryCatalogJsonV2 = {
  schemaVersion: 2;
  facts: FactDefinition[];
  questions: QuestionDefinition[];
  objectives: ObjectiveDefinition[];
  authorizations: AuthorizationDefinition[];
  sourceGroups: SourceGroupDefinition[];
  evidenceIndex: CaseRecordDefinitionIndex[];
  statementsIndex: CaseRecordDefinitionIndex[];
};

type CaseRecordDefinitionIndex = {
  id: string;
  chapterId: string;
  sceneId: string;
  provenance: CaseRecordProvenance;
};

type SourceGroupDefinition = {
  id: string;
  label: string;
  summary: string;
  members: InventoryTarget[];
};
```

The scene remains the owner of prose, image references, and acquisition dialogue.
The catalog repeats typed identity, immutable origin, and provenance from the same
normalized value. Source-group definitions contain authored identity/description
plus compiler-derived canonical members.

A missing `## Source Groups` section emits `sourceGroups: []`. A completely
missing authored `story_catalog.md` emits the required empty v2 artifact only when
no scene record names a `Source Group`.

### 6.5 Compiler validation and singleton audit

After all scenes and the story catalog parse, validation rejects:

- malformed, blank, repeated, or unknown record metadata;
- duplicate or unknown proof capabilities;
- non-canonical capabilities reaching a generated-resource validation boundary;
- invalid source-group slugs;
- a record group reference absent from the registry;
- an unused/orphaned source-group definition;
- malformed typed predecessor references;
- unknown, cross-kind, or self-supersession;
- supersession forks and cycles;
- procedural-status regression;
- scene/catalog provenance inequality;
- metadata that fails a later consumer's explicit requirement.

Diagnostics point to the most precise authored field:

- malformed `Supersedes` → the successor's `Supersedes` line;
- unknown `Source Group` → the record's `Source Group` line;
- orphaned group → the group heading;
- duplicate metadata → the second occurrence, naming the first line;
- unknown key → that metadata key's line.

After successful validation, the compiler derives members by typed record identity
and emits them in canonical order. It also emits deterministic
`singletonSourceGroup` warnings sorted by group ID. Each warning names the group
and its sole typed member. Singleton groups do not fail compilation.

### 6.6 Content identity and manifest versioning

The package content revision includes normalized scene provenance, catalog record
provenance, source-group definitions, and derived typed membership.

`save-content-manifest.ts` already hashes the canonical emitted scene/catalog
bundle, so the hash algorithm remains unchanged. Production code must update the
nested type reference:

```ts
export type SaveContentBundleV1 = {
  chapters: Array<{
    id: string;
    title: string;
    summary: string;
    scenes: EmittedSceneJsonV1[];
  }>;
  storyCatalog: StoryCatalogJsonV2;
};
```

The following remain unchanged:

```ts
export type SaveContentManifestV1 = {
  manifestVersion: 1;
  contentRevision: `sha256:${string}`;
};
```

`V1` names the manifest envelope and canonical hash contract, not the nested
catalog schema. Focused regressions prove that changing only one provenance value,
one group definition, or one record membership changes `contentRevision`.

`save-content-references.ts` remains the semantic asset-reference validator and
is not the hashing owner.

### 6.7 Metadata-requirement seam

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
null and assumes registry validation has already succeeded. Every required
capability must be present. Neutral defaults fail requirements that exclude them.
Diagnostics point to the requirement and identify the insufficient record.

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

### 7.2 Compilable catalog APIs

Supersession queries are catalog methods because they require validated global
definitions:

```rust
impl StoryCatalog {
    pub(crate) fn predecessor(
        &self,
        target: &InventoryTarget,
    ) -> Result<Option<InventoryTarget>, GameError>;

    pub(crate) fn successor(
        &self,
        target: &InventoryTarget,
    ) -> Result<Option<InventoryTarget>, GameError>;

    pub(crate) fn chain(
        &self,
        target: &InventoryTarget,
    ) -> Result<Vec<InventoryTarget>, GameError>;

    pub(crate) fn latest_definition(
        &self,
        target: &InventoryTarget,
    ) -> Result<InventoryTarget, GameError>;
}
```

`chain` returns the complete containing chain, includes the target, and orders
records oldest → newest. An unlinked record returns one element. A middle target
still returns the full chain. `latest_definition` is the final element.

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
acquisition validation, error constructors, and save capture/restore tests.
`GameEngine` does not gain a second provenance store.

### 8.2 Strict wire/domain provenance split

The validated domain keeps efficient set semantics:

```rust
#[derive(Clone, Debug, Default, PartialEq, Eq)]
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

Deserialization first uses a strict wire shape:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CaseRecordProvenanceWire {
    source_kind: SourceKind,
    representation_layer: RepresentationLayer,
    procedural_status: ProceduralStatus,
    completeness: Completeness,
    confidence: Confidence,
    source_group_id: Option<String>,
    source_label: Option<String>,
    proof_capabilities: Vec<ProofCapability>,
    supersedes_record_id: Option<String>,
}
```

Conversion from wire to domain:

1. rejects duplicate capabilities;
2. rejects unique but non-canonical ordering using explicit semantic ranks;
3. converts the validated array into `BTreeSet`;
4. validates non-empty optional strings and slugs where appropriate;
5. returns a typed validation failure instead of silently normalizing malformed
   packaged content.

`CaseRecordProvenance` may implement custom `Deserialize` through this wire type.
Its custom `Serialize` implementation walks the explicit canonical capability
list and emits present members in that order; it does not rely on `BTreeSet`
iteration or derived enum `Ord`.

Legacy scene compatibility applies only at the containing record field:

```rust
#[serde(default)]
pub provenance: CaseRecordProvenance,
```

An absent scene provenance object becomes the exact neutral default. A present
object is strict. Catalog-v2 provenance is always present and strict.

### 8.3 Reuse the existing catalog version envelope

`StoryCatalog::load` already reads `StoryCatalogVersionEnvelope` before the
payload. HPA-256 reuses it:

- set `STORY_CATALOG_SCHEMA_VERSION` to `2`;
- rename v1-oriented payload types/comments as appropriate;
- accept exactly version 2;
- reject version 1 before attempting v2 field validation;
- use version 3 as the unsupported-future test sentinel;
- prove `{ "schemaVersion": 1 }` returns
  `unsupportedStoryCatalogVersion`, not a malformed-payload error;
- prove `{ "schemaVersion": 3 }` is rejected before v2 field validation.

This is a version migration, not a new envelope architecture.

### 8.4 Replace the existing record-index type

The current private Rust `CaseRecordDefinitionIndex` is replaced, not wrapped or
retained:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CaseRecordDefinitionJsonV2 {
    id: String,
    chapter_id: String,
    scene_id: String,
    provenance: CaseRecordProvenanceWire,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::game) struct CaseRecordDefinition {
    pub id: String,
    pub chapter_id: String,
    pub scene_id: String,
    pub provenance: CaseRecordProvenance,
}
```

Catalog maps store validated `CaseRecordDefinition` values. Existing
`#[allow(dead_code)]` annotations on chapter/scene origin are removed once those
fields participate in scene/catalog equality checks.

Source groups use a strict v2 wire list and validated domain set:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceGroupDefinitionJsonV2 {
    id: String,
    label: String,
    summary: String,
    members: Vec<InventoryTarget>,
}

pub(in crate::game) struct SourceGroupDefinition {
    pub id: String,
    pub label: String,
    pub summary: String,
    pub members: BTreeSet<InventoryTarget>,
}
```

Wire-to-domain conversion rejects duplicate or non-canonically ordered members
using an explicit evidence-before-statement, then-ID comparator. It then converts
the validated list to the domain set. Derived `InventoryTarget::Ord` is not used
to define the catalog wire contract.

`StoryCatalog` stores a source-group index and validates that each emitted member
exists and names the matching `sourceGroupId`. This is defense in depth for the
compiler-derived catalog projection, not a second authored membership check.

### 8.5 Catalog resolver and equality validation

```rust
impl StoryCatalog {
    pub(in crate::game) fn case_record(
        &self,
        target: &InventoryTarget,
    ) -> Option<&CaseRecordDefinition>;

    pub(in crate::game) fn source_group(
        &self,
        id: &str,
    ) -> Option<&SourceGroupDefinition>;
}
```

The catalog is authoritative for lineage and metadata evaluation. The scene
record is authoritative for acquisition prose and dialogue. They must agree on
origin and provenance exactly.

Runtime comparison:

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
- again before evidence/statement acquisition mutates inventory;
- during restore while joining saved IDs to packaged definitions.

HPA-256 does not eagerly load every packaged scene during ordinary startup solely
for this check. Compiler whole-bundle validation is the package-wide guard;
runtime checks defend loaded/acquired/restored boundaries. A mismatch returns
`caseRecordDefinitionMismatch` and never silently chooses one copy.

### 8.6 Mutable inventory and constructor audit

`EvidenceRecord` and `StatementRecord` gain full internal provenance copied from
the validated scene definition. Acquisition chapter/scene remains a separate
origin. Acquiring a successor never mutates its predecessor.

The implementation plan inventories all Rust literals and constructors for:

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

Production constructors and public wire fields remain explicit. Complete evidence
or statement definitions do not gain misleading broad `Default` implementations
merely to avoid updating required fields.

### 8.7 Error contract

Public-in-game provenance and lineage services return `GameError`, preserving the
existing `{ code, message }` command contract. Private traversal/conversion errors
may exist only when immediately mapped before crossing a module API.

Required mappings:

| Failure | `GameError` contract |
|---|---|
| unknown root fact | existing `unknownStoryFact` |
| unknown supporting record | existing `unknownSupportingCaseRecord` |
| invalid/cyclic supporting fact | existing `invalidSupportingFact` |
| malformed catalog/source-group graph | existing `storyCatalogValidationFailed` |
| scene/catalog origin or provenance disagreement | new `caseRecordDefinitionMismatch` |
| acquired runtime record differs from catalog during capture/view | new `inventoryRecordDefinitionMismatch` |
| strict count with unknown source groups | new `missingCaseRecordSourceGroup` |
| pending acquisition event kind disagrees with owning scene record kind | existing `acquisitionDefinitionMismatch` |

The existing `acquisitionDefinitionMismatch` message is narrowed to pending-event
kind/owning-scene disagreement and no longer claims to cover provenance mismatch.
Generated-resource serde failures continue through the owning scene/catalog load
error with a precise detail message. They are not exposed as unrelated public
`ProvenanceError` or `LineageError` types.

## 9. Source independence and fact-support lineage

### 9.1 Source identity

`sourceGroupId` is a game-global reference to the authored registry. Records in
one declared group count as one source even when they differ in ID, kind,
representation, procedural status, chapter, scene, or supersession position.

Different registered IDs count independently. Null means unknown and never
creates a synthetic group. `sourceLabel` is presentation only.

Supersession and source grouping answer different questions. A successor does not
automatically inherit its predecessor's group. Authors normally reuse a group
when all chain members derive from one underlying source, but may declare a
different group when the newer record genuinely establishes another source.

### 9.2 Inventory-independent internal closure

HPA-255 permits asserted facts to reference valid catalog records that are not
currently acquired. HPA-256 preserves that contract.

Internal lineage operates over:

```text
StoryState fact progress → typed support edges → StoryCatalog definitions
```

It does not consult `Inventory`. Therefore an unacquired supporting record remains
part of authoritative direct/transitive record closure and contributes its known
registered group to internal source closure.

This is graph math, not automatically a player-visible possession claim.

### 9.3 Compilable lineage service

```rust
pub(crate) struct SupportLineage<'a> {
    catalog: &'a StoryCatalog,
    state: &'a StoryState,
}

impl<'a> SupportLineage<'a> {
    pub(crate) fn new(
        catalog: &'a StoryCatalog,
        state: &'a StoryState,
    ) -> Self;

    pub(crate) fn direct_records(
        &self,
        fact_id: &str,
    ) -> Result<BTreeSet<InventoryTarget>, GameError>;

    pub(crate) fn transitive_records(
        &self,
        fact_id: &str,
    ) -> Result<BTreeSet<InventoryTarget>, GameError>;

    pub(crate) fn transitive_facts(
        &self,
        fact_id: &str,
    ) -> Result<BTreeSet<String>, GameError>;

    pub(crate) fn transitive_source_group_closure(
        &self,
        fact_id: &str,
    ) -> Result<SourceGroupClosure, GameError>;

    pub(crate) fn transitive_source_groups(
        &self,
        fact_id: &str,
    ) -> Result<BTreeSet<String>, GameError>;
}
```

`transitive_records` includes direct records and records beneath recursively
supporting facts, deduplicated by typed identity. `transitive_facts` excludes the
queried root. Traversal retains visited tracking even though mutation and restore
already reject cycles.

### 9.4 Diagnostic and strict source closure

```rust
pub struct SourceGroupClosure {
    pub groups: BTreeSet<String>,
    pub missing_group_records: BTreeSet<InventoryTarget>,
}
```

The diagnostic closure:

- resolves every transitive record through the catalog;
- includes every registered known group;
- lists every record whose `sourceGroupId` is null;
- never drops unknowns;
- never manufactures a group.

The strict operation returns groups only when `missing_group_records` is empty;
otherwise it returns `missingCaseRecordSourceGroup` naming every missing typed
record.

Unknown facts/records and cycles remain typed errors at this read-only
defense-in-depth boundary.

### 9.5 Consumer filtering and HPA-262 boundary

A consumer declares its visibility/eligibility boundary:

- HPA-262 validates and counts selected evidence/statement records directly;
- an inventory case-file view intersects internal lineage with acquired IDs;
- public fact projections redact unacquired direct supporting records;
- a future fact-aware board states whether it imports the full closure or a
  selected/acquired subset and whether it needs diagnostic or strict counting.

No consumer may present internal source closure as “sources the player possesses”
without an acquired or selected-record filter.

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
practical so Rust cannot accidentally bypass redaction. Save capture continues
its explicit ID-only mapping and does not depend on public serialization.

The external JSON retains the existing property shape:

```ts
type Inventory = {
  evidence: EvidenceRecord[];
  statements: StatementRecord[];
};
```

Each public record gains `provenance`.

### 10.2 Dynamic lineage redaction

For every view build:

1. construct typed acquired-ID sets from current inventory;
2. clone internal provenance for each acquired record;
3. retain `supersedesRecordId` only when the typed predecessor is also acquired;
4. serialize capabilities and any typed-target lists with explicit canonical
   ordering;
5. serialize the redacted public record.

Required transition:

```text
Acquire B, where B supersedes A → public B.supersedesRecordId = null
Acquire A later                   → next view exposes B.supersedesRecordId = A
```

Acquiring A alone never reveals packaged future B. HPA-256 has no public
successor field.

### 10.3 Spoiler-safe facts and public ambiguity

`StoryState` stores every authoritative direct supporting record.
`FactView.supportingRecords` includes only currently acquired typed records and
uses the explicit typed-target comparator for public array order.
`supportingFactIds` remains unchanged because supporting facts must already be
asserted before they can be referenced.

The `StoryStateView` builder therefore receives an acquired-record set or a small
public-view context instead of blindly copying internal support targets.
Transitive closure is not added to the current public wire shape.

Public ambiguity is intentional:

```text
supportingRecords: []
```

means “no acquired direct supporting records are exposed.” It may mean either:

1. internal progress has no direct record support; or
2. every direct supporting record is currently unacquired and redacted.

No current component relies on distinguishing these states. HPA-256 does not add
a hidden-support flag because it would reveal the existence of locked content.
A later Rust-owned lineage view may distinguish them when story design permits.

### 10.4 Frontend mirror and fixture churn

Frontend types mirror every enum and provenance field exactly. Documentation on
`supersedesRecordId` and `supportingRecords` explains their redacted-or-absent
meanings.

The implementation plan inventories every frontend fixture and constructor for
public evidence/statement records. Shared neutral-provenance test factories are
allowed; production public fields remain explicit. Existing components do not
render provenance in this ticket, so DOM and accessible names remain unchanged.

### 10.5 Layout-editor compatibility

The layout editor intentionally reads investigation scene JSON through a narrower
structural type and writes only the separate layout sidecar. Additional compiled
provenance fields are ignored by plain structural JSON parsing and are never
written back into scene JSON.

HPA-256 therefore does not extend `@lyra/scene-types` or layout-editor provenance
types. A focused regression may load a compiled investigation scene containing
provenance and confirm saving changes only the sidecar.

## 11. Persistence and compatibility

### 11.1 Save shape remains version 1

The save already stores all mutable data required here:

- acquired record ID;
- acquisition chapter and scene;
- direct typed supporting record IDs;
- direct supporting fact IDs;
- exact package content revision.

It does not add provenance, source groups, capabilities, derived membership, or
supersession to `InventorySnapshotV1` or `StoryStateSnapshotV1`.

### 11.2 Capture

Capture validates:

- every acquired record resolves through the catalog;
- every acquired internal provenance equals the catalog definition;
- an acquired mismatch returns `inventoryRecordDefinitionMismatch`;
- every direct supporting record resolves;
- story state remains valid and acyclic.

### 11.3 Restore

Restore:

1. validates save schema and exact content revision;
2. loads and version-gates catalog-v2 definitions;
3. validates source-group definitions and emitted derived membership;
4. resolves saved record IDs to owning packaged scenes;
5. validates scene/catalog provenance equality;
6. reconstructs internal inventory records from definitions and saved acquisition
   locations;
7. reconstructs direct fact support;
8. recomputes provenance, supersession, and source closure;
9. recaptures the candidate and demands exact snapshot equality;
10. rebuilds public views and verifies spoiler-safe projections.

Because provenance is definition data, exact snapshot equality remains unchanged.
Dedicated tests compare pre-save/post-restore internal provenance, acquisition
origins, source-group identity, public redaction, and derived lineage.

### 11.4 Compatibility consequences

A pre-v2 package must regenerate resources. `StoryCatalog::load` rejects v1 rather
than defaulting missing catalog provenance or source groups. An older pre-release
save has a different content revision and is rejected by the existing
compatibility gate; no save-schema migration is needed.

A future shipped release that preserves saves across provenance or group edits
must add an explicit content migration.

## 12. Diagnostics and failure behavior

### 12.1 Compiler diagnostics

Stable source-located categories cover:

- malformed, blank, repeated, or unknown record metadata;
- duplicate or unknown proof capabilities;
- invalid source-group slug;
- missing source-group definition;
- unused/orphaned source-group definition;
- malformed typed predecessor reference;
- unknown, cross-kind, or self-supersession;
- supersession fork or cycle;
- procedural-status regression;
- scene/catalog provenance mismatch;
- metadata missing for an explicit consumer requirement.

The focused plan may refine exact code strings, but no category may collapse into
entry-heading-only diagnostics when a metadata line exists.

Singleton source groups are not compiler errors. They produce deterministic
`singletonSourceGroup` warnings with their derived typed member so a reviewer can
distinguish a legitimate singleton from a likely group-ID split.

### 12.2 Runtime failures

Typed runtime failures cover:

- unsupported catalog version;
- malformed strict provenance;
- duplicate/non-canonical capability array;
- duplicate/non-canonical source-group member array;
- invalid source-group registry or derived membership;
- invalid catalog supersession graph;
- scene/catalog definition mismatch;
- acquired inventory/catalog definition mismatch;
- pending acquisition event/scene kind mismatch;
- unknown lineage fact/record;
- lineage cycle at query boundary;
- strict complete-source request with missing groups.

Runtime never silently chooses scene or catalog provenance, repairs capabilities
or target order, drops unknown sources, creates synthetic groups, leaks an
unacquired ID, or installs a partially validated engine.

## 13. Verification and acceptance mapping

### 13.1 Compiler and parser tests

- Parse every provenance enum for evidence and statements.
- Parse all ten proof capabilities.
- Emit exact neutral defaults when authored fields are omitted.
- Refactor manifest metadata collection to preserve per-key lines.
- Reject a duplicate metadata key on the second occurrence and name the first
  line.
- Reject unknown evidence/statement metadata keys, including `Source Knid`.
- Reject `Image Prompt` on a statement.
- Reject blank provenance fields at their own line.
- Prove duplicate capabilities fail before emission.
- Emit canonical ordering only for valid duplicate-free capabilities.
- Prove canonical ordering uses the explicit rank table rather than declaration
  or input order.
- Parse an optional `## Source Groups` section with required `Summary`.
- Parse an existing catalog with no Source Groups section as `sourceGroups: []`.
- Reject a record group reference absent from the registry.
- Reject an unused/orphaned group definition.
- Accept a legal singleton group, derive its one member, and emit the
  non-blocking `singletonSourceGroup` warning.
- Derive multi-record membership from record metadata without an authored
  `Members` field.
- Emit typed members in explicit evidence-before-statement, then-ID order.
- Emit catalog schema version 2, including source groups and derived canonical
  members.
- Validate missing, cross-kind, self, forked, cyclic, and regressing chains.
- Normalize each record once for scene and catalog emission.
- Assert exact same-ID scene ↔ catalog structural provenance equality for
  evidence and statements, including neutral defaults.
- Prove same-group wall-derived clips remain distinct records but one declared
  source.
- Prove metadata requirements reject unspecified exhibit status, missing
  capabilities, and null source groups.
- Update `SaveContentBundleV1.storyCatalog` to `StoryCatalogJsonV2`.
- Prove provenance-only, group-definition-only, and membership-only edits change
  the content revision.
- Compile live existing chapters without authored provenance migration; their
  sourceGroups list is empty until production annotations land.
- Verify both writing skills document matching syntax, derived membership,
  `none` conflation, and explicit-status advice.

### 13.2 Rust tests

- Assert every neutral enum `Default` variant explicitly.
- Assert `CaseRecordProvenance::default()` equals the full neutral literal.
- Deserialize a legacy scene record by defaulting an absent provenance object and
  assert every field value.
- Reject a present provenance object with missing or unknown fields.
- Reject duplicate capability arrays before set conversion.
- Reject non-canonical unique capability arrays.
- Serialize validated capabilities with the explicit semantic rank, independent
  of enum declaration or set iteration order.
- Reuse the existing version envelope with accepted version 2.
- Reject catalog v1 before v2 payload deserialization.
- Reject future catalog v3 before v2 field validation.
- Replace the existing `CaseRecordDefinitionIndex` with v2 wire/domain types.
- Remove obsolete dead-code allowances from record origin fields.
- Deserialize source-group members through `Vec<InventoryTarget>`.
- Reject duplicate or non-canonical source-group member arrays before set
  conversion.
- Validate each emitted member against the record's matching group reference.
- Reject catalog-v2 corruption for every group and chain invariant.
- Resolve typed evidence/statement and source-group definitions through catalog.
- Reject a loaded scene whose provenance differs from its same-ID catalog entry.
- Reject acquisition mismatch before inventory mutation.
- Keep `acquisitionDefinitionMismatch`, `caseRecordDefinitionMismatch`, and
  `inventoryRecordDefinitionMismatch` behavior distinct.
- Return full supersession chains oldest → newest, including one-element chains
  and targets in the middle.
- Copy provenance into inventory without mutating acquisition origin.
- Keep predecessor and successor as separate acquired records.
- Audit all `EvidenceJson`, `StatementJson`, `EvidenceRecord`, and
  `StatementRecord` literal/constructor sites; use explicit values or approved
  test helpers.
- Compute internal record/source closure for an unacquired supporting record.
- Confirm diagnostic/strict closure includes its known group while public
  inventory hides the record.
- Return diagnostic source closure with known groups plus every missing record.
- Make strict source closure fail when any supporting record lacks a group.
- Deduplicate records and groups reached through several supporting facts.
- Preserve existing support-cycle and snapshot validation.
- Prove provenance/catalog/lineage service methods return the declared
  `GameError` mappings.
- Build `GameStateView` from `InventoryView`, never mutable `Inventory`.
- Hide an unacquired predecessor from successor public provenance.
- Recompute redaction after acquiring the predecessor later.
- Never expose a future successor when only the predecessor is acquired.
- Filter unacquired record IDs out of `FactView.supportingRecords` while retaining
  them in internal `StoryState`.
- Serialize public supporting records with the explicit typed-target comparator.
- Prove public empty `supportingRecords` remains deliberately ambiguous without a
  hidden-support flag.
- Capture/save/restore lead → reacquired → exhibit records and confirm identical
  definitions, group membership, acquisition origins, direct support, internal
  closure, public redaction, and exact recapture.

### 13.3 Frontend and regression tests

- Mirror every provenance enum and field in `state/types.ts`.
- Document the redacted-or-absent meaning of public null predecessor.
- Document that empty public `supportingRecords` means no acquired support is
  exposed, not necessarily no internal support.
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

Add focused structural or compile-time guards that fail if:

- `GameStateView.inventory` is changed back to mutable `Inventory`;
- mutable inventory records regain an unintended direct public serialization
  path;
- scene and catalog emission stop sharing one normalized provenance value;
- manifest metadata collection returns to last-write-wins or open-key behavior;
- source-group membership becomes dual-authored in record and registry Markdown;
- catalog v2 accepts a record group not present in the registry;
- strict provenance deserializes capabilities directly into a set;
- strict source-group definitions deserialize members directly into a set;
- serialized capabilities or typed targets rely on derived enum/set order;
- a public view exposes a catalog successor field or unacquired supporting record.

### 13.5 Required command gates

The implementation plan ends with at least:

```text
bun run scenes:compile
bun run check:scripts
bun run test
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run check
bun run --cwd apps/game check:e2e
bun run lint:all
```

Focused tests run first. Packaged Tauri `test:e2e` is required only if the
implementation changes a rendered flow or save command surface; the separate E2E
TypeScript check is always part of the floor because ordinary Svelte checking
excludes those files.

## 14. Expected file boundaries

Compiler and story catalog:

```text
Modify packages/scripts/compile-scenes/types.ts
Modify packages/scripts/compile-scenes/parser-manifest.ts
Modify packages/scripts/compile-scenes/parser-story-catalog.ts
Add    packages/scripts/compile-scenes/case-record-provenance.ts
Modify packages/scripts/compile-scenes/emitter.ts
Modify packages/scripts/compile-scenes/story-catalog.ts
Modify packages/scripts/compile-scenes/validator.ts
Modify packages/scripts/compile-scenes/orchestrator.ts as needed for source-group audit output
Modify packages/scripts/compile-scenes/save-content-manifest.ts
Modify packages/scripts/compile-scenes/save-content-manifest.test.ts
Modify parser-manifest, parser-story-catalog, emitter, validator, catalog, and orchestrator tests
Add/modify focused fixtures for metadata, groups, equality, ordering, and content identity
```

`save-content-references.ts` remains the semantic asset-reference validator.

Rust core:

```text
Add    apps/game/src-tauri/src/game/provenance.rs
Add    apps/game/src-tauri/src/game/support_lineage.rs
Modify apps/game/src-tauri/src/game/error.rs
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
```

Documentation:

```text
Add docs/superpowers/plans/2026-07-29-hpa-256-case-record-provenance-and-support-lineage-implementation-plan.md
```

The implementation plan may refine test filenames and split large Rust modules,
but it must preserve these authoring, registry, derivation, equality, canonical
ordering, validation, visibility, error, and persistence boundaries.

## 15. Non-goals and future ownership

HPA-256 does not implement:

- automatic provenance inference from names, prose, record kind, scene type, or
  acquisition source;
- automatic source-group creation from labels or record co-occurrence;
- automatic source-group inheritance through supersession;
- a second authored source-group member list in `story_catalog.md`;
- automatic capability inference from raw/composite/exhibit status;
- rejecting every singleton source group merely because it is a singleton;
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
- a public successor ID, hidden-support flag, or public transitive-lineage field.

Later tickets consume this contract rather than redefining source identity,
procedural status, proof capability, supersession, acquisition visibility, or
fact-support closure.
