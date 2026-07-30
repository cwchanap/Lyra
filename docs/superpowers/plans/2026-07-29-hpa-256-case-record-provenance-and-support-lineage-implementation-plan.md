# HPA-256 Case-Record Provenance and Support-Lineage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Follow every red-green-refactor checkpoint and commit boundary in order.

**Goal:** Add strict orthogonal provenance to evidence and statements; compile immutable supersession and source-group definitions into story-catalog schema version 2; derive fact-support lineage; expose spoiler-safe public projections; and preserve the existing version-1 save contract through stable IDs and exact content identity.

**Architecture:** The TypeScript compiler parses source-located provenance and a global source-group registry, normalizes every case record once into one compiled corpus, and feeds that same value to scene and catalog emission. Rust separates strict JSON wire parsing from validated domain values, makes `StoryCatalog` authoritative for provenance/source groups/supersession, derives lineage from `StoryState`, and rebuilds public inventory/fact views against the current acquired set. Save snapshots stay ID-only version 1 and restore immutable metadata from the exact package before exact recapture.

**Tech stack:** Bun 1.3.1, TypeScript, Vitest, SvelteKit/Svelte 5 contract types, Rust 2021, Serde, Cargo tests, WebdriverIO type checks.

## Global constraints

- Treat `docs/superpowers/specs/2026-07-29-hpa-256-case-record-provenance-and-support-lineage-design.md` as normative.
- Use strict TDD: write one failing behavior test, run it and confirm the intended failure, add the minimum implementation, rerun focused tests, refactor only while green, then commit.
- Human-approved test-quality ruling: do not test writer-skill prose or implementation source text with grep/change-detector assertions. Verify documentation against a manual contract checklist, and express architectural guarantees through observable compiler/runtime/wire behavior. When a Task 13 regression protects behavior already implemented by earlier slices, prove that it catches the break with a narrow temporary mutation, then restore the production code before committing.
- Keep compiler AST, normalized case-record types, and generated wire types under `packages/scripts`; do not broaden `@lyra/scene-types`.
- Omitted authored provenance must normalize exactly to `unspecified` / `none` / empty / null values and must not change existing UI.
- Never infer one provenance dimension from another, from record prose, record kind, scene, acquisition location, filename, or supersession.
- Author source-group identity and `Summary` once in `story_catalog.md`; author membership only through each record's `Source Group`; derive emitted typed members. Never add an authored `Members` field.
- Reject undeclared and unused source groups. Accept a legal singleton but emit one deterministic non-blocking `singletonSourceGroup` warning.
- Parse manifest metadata with exact per-key lines, closed evidence/statement allowlists, duplicate-key rejection at the second occurrence, and no last-write-wins behavior.
- Reject duplicate proof capabilities before normalization. Use explicit semantic rank functions for capability and typed-record wire ordering; never rely on enum declaration, derived `Ord`, `localeCompare`, or set iteration.
- Normalize each case record once. Scene and catalog emission must consume that same compiled value and assert structural equality.
- Emit `story_catalog.json` with `schemaVersion: 2`. Reuse the existing minimal version envelope. Reject versions 1 and 3 before v2 payload deserialization.
- Keep `SaveContentBundleV1`, `SaveContentManifestV1`, `manifestVersion: 1`, save schema version 1, and the canonical SHA-256 algorithm unchanged.
- Keep provenance, groups, derived membership, capabilities, and supersession out of saves. Definition-only edits change `contentRevision`.
- Catalog definitions are authoritative for lineage, groups, capabilities, and supersession. Scene definitions remain authoritative for prose, image, and acquisition dialogue. Runtime rejects origin/provenance disagreement.
- Internal lineage reads asserted `StoryState` plus `StoryCatalog` and does not filter by inventory. Player-facing and selection-facing consumers apply acquired/selected filtering.
- `GameStateView` exposes an `InventoryView`, never mutable `Inventory`. Remove direct public serialization from mutable inventory records once the projection is wired.
- Public state never exposes an unacquired predecessor, a future successor, an unacquired supporting record, a hidden-support flag, or transitive lineage.
- Preserve distinct errors:
  - `acquisitionDefinitionMismatch`: pending acquisition event kind disagrees with the owning scene definition.
  - `caseRecordDefinitionMismatch`: scene origin/provenance disagrees with the catalog.
  - `inventoryRecordDefinitionMismatch`: acquired runtime record disagrees with the catalog.
  - `missingCaseRecordSourceGroup`: strict source counting encounters null groups.
- Do not add production Chapter 1/2 provenance annotations, analysis-scene Markdown, board runtime/UI, case-file redesign, automatic inference, editor provenance controls, or branching supersession.
- Update only tracked `.claude/skills/` sources; do not create a second `.agents/skills/` copy.
- Do not hand-edit or commit generated JSON under `apps/game/src-tauri/resources/`.

## Locked compiler contracts

Add these shared TypeScript types in `packages/scripts/compile-scenes/types.ts`:

```ts
export type SourceKind =
  | "physical"
  | "testimony"
  | "digital"
  | "subjective"
  | "unspecified";

export type RepresentationLayer =
  | "raw"
  | "sync"
  | "summary"
  | "composite"
  | "none";

export type ProceduralStatus =
  | "unspecified"
  | "lead"
  | "reacquired"
  | "exhibit";

export type Completeness =
  | "complete"
  | "partial"
  | "cropped"
  | "unspecified";

export type Confidence =
  | "unverified"
  | "corroborated"
  | "disputed"
  | "unspecified";

export type ProofCapability =
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

export type CaseRecordProvenance = {
  sourceKind: SourceKind;
  representationLayer: RepresentationLayer;
  proceduralStatus: ProceduralStatus;
  completeness: Completeness;
  confidence: Confidence;
  sourceGroupId: string | null;
  sourceLabel: string | null;
  proofCapabilities: ProofCapability[];
  supersedesRecordId: string | null;
};

export type ASTCaseRecordProvenance = {
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

export type ASTSourceGroupDefinition = Located<{
  id: string;
  label: string;
  summary: string;
}>;

export type SourceGroupDefinition = {
  id: string;
  label: string;
  summary: string;
  members: InventoryTarget[];
};
```

The compiled corpus contract is:

```ts
export type CompiledCaseRecord = {
  target: InventoryTarget;
  chapterId: string;
  sceneId: string;
  provenance: CaseRecordProvenance;
  sourceFile: string;
  line: number;
};

export type CompiledCaseRecordCorpus = {
  recordsByKey: ReadonlyMap<string, CompiledCaseRecord>;
  evidenceIndex: CaseRecordDefinitionIndex[];
  statementsIndex: CaseRecordDefinitionIndex[];
  sourceGroups: SourceGroupDefinition[];
  warnings: CompileError[];
};

export type CompileCaseRecordCorpusResult =
  | { ok: true; value: CompiledCaseRecordCorpus }
  | { ok: false; errors: CompileError[] };
```

Use canonical typed keys `evidence:<id>` and `statement:<id>`.

New compiler diagnostic codes:

```text
caseRecordMetadataDuplicateKey
caseRecordMetadataUnknownKey
caseRecordMetadataBlank
caseRecordProvenanceInvalidValue
caseRecordProofCapabilityDuplicate
caseRecordProofCapabilityMalformed
caseRecordSupersedesMalformed
caseRecordSourceGroupUnknown
caseRecordSourceGroupUnused
singletonSourceGroup
caseRecordSupersessionUnknown
caseRecordSupersessionKindMismatch
caseRecordSupersessionSelf
caseRecordSupersessionFork
caseRecordSupersessionCycle
caseRecordProceduralStatusRegression
caseRecordRequirementFailed
caseRecordEmissionMismatch
```

## Locked Rust contracts

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

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::game) struct CaseRecordDefinition {
    pub id: String,
    pub chapter_id: String,
    pub scene_id: String,
    pub provenance: CaseRecordProvenance,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::game) struct SourceGroupDefinition {
    pub id: String,
    pub label: String,
    pub summary: String,
    pub members: BTreeSet<InventoryTarget>,
}

pub(crate) struct SupportLineage<'a> {
    catalog: &'a StoryCatalog,
    state: &'a StoryState,
}

pub struct SourceGroupClosure {
    pub groups: BTreeSet<String>,
    pub missing_group_records: BTreeSet<InventoryTarget>,
}
```

`InventorySnapshotV1`, `EvidenceInventoryEntryV1`, `StatementInventoryEntryV1`, `StoryStateSnapshotV1`, and `SAVE_SCHEMA_VERSION` do not gain provenance-related fields.

---

## Task 1: Parse strict source-located provenance in both record manifests

**Files**

- Modify `packages/scripts/compile-scenes/types.ts`
- Create `packages/scripts/compile-scenes/case-record-provenance.ts`
- Create `packages/scripts/compile-scenes/case-record-provenance.test.ts`
- Modify `packages/scripts/compile-scenes/parser-manifest.ts`
- Modify `packages/scripts/compile-scenes/parser-investigation.test.ts`
- Modify `packages/scripts/compile-scenes/parser-interrogation.test.ts`

- [ ] **Red: parse every field with exact locations**

Add one investigation evidence and one interrogation statement containing every provenance field. Assert all parsed values and one-based lines. Add unannotated records and assert the AST keeps `null`/empty values instead of prematurely defaulting.

- [ ] **Red: reject malformed metadata at the authored line**

Table-test:

- `Source Knid` → `caseRecordMetadataUnknownKey`;
- duplicate `Source Kind` → `caseRecordMetadataDuplicateKey` on the second line and message names the first line;
- blank provenance values → `caseRecordMetadataBlank`;
- invalid enum → `caseRecordProvenanceInvalidValue`;
- duplicate capability → `caseRecordProofCapabilityDuplicate`;
- unbracketed or empty-entry list → `caseRecordProofCapabilityMalformed`;
- malformed `Supersedes` → `caseRecordSupersedesMalformed`;
- `Image Prompt` on a statement → `caseRecordMetadataUnknownKey`.

- [ ] **Run red tests**

```bash
rtk bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/case-record-provenance.test.ts \
  packages/scripts/compile-scenes/parser-investigation.test.ts \
  packages/scripts/compile-scenes/parser-interrogation.test.ts
```

Expected: fail because the AST and strict collector do not exist.

- [ ] **Implement source-located closed metadata collection**

Replace `consumeMetadata(): Record<string, string>` with a map of exact values and locations:

```ts
type ManifestMetadata = Map<string, Located<{ value: string }>>;
```

Use exact allowlists:

```ts
const EVIDENCE_METADATA_KEYS = [
  "Name",
  "Description",
  "Details",
  "Source Sublocation",
  "Image Prompt",
  ...CASE_RECORD_PROVENANCE_METADATA_KEYS,
] as const;

const STATEMENT_METADATA_KEYS = [
  "Speaker",
  "Content",
  ...CASE_RECORD_PROVENANCE_METADATA_KEYS,
] as const;
```

Reject an unknown key before required-field checks and reject duplicates before overwrite.

- [ ] **Implement strict provenance parsing and neutral normalization**

Parse exact lower-case enum values, non-empty labels/groups, bracketed capabilities, and typed supersession. Duplicate detection occurs before ordering. `emitCaseRecordProvenance` applies the exact neutral defaults and orders an already-valid capability list with an explicit rank table; it never deduplicates.

- [ ] **Green**

```bash
rtk bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/case-record-provenance.test.ts \
  packages/scripts/compile-scenes/parser-investigation.test.ts \
  packages/scripts/compile-scenes/parser-interrogation.test.ts
rtk bun run check:scripts
```

- [ ] **Commit**

```bash
rtk git add \
  packages/scripts/compile-scenes/types.ts \
  packages/scripts/compile-scenes/case-record-provenance.ts \
  packages/scripts/compile-scenes/case-record-provenance.test.ts \
  packages/scripts/compile-scenes/parser-manifest.ts \
  packages/scripts/compile-scenes/parser-investigation.test.ts \
  packages/scripts/compile-scenes/parser-interrogation.test.ts
rtk git commit -m "feat: parse case record provenance"
```

---

## Task 2: Parse the optional source-group registry

**Files**

- Modify `packages/scripts/compile-scenes/types.ts`
- Modify `packages/scripts/compile-scenes/parser-story-catalog.ts`
- Modify `packages/scripts/compile-scenes/parser-story-catalog.test.ts`
- Modify fixtures under `packages/scripts/__fixtures__/story_catalog/`

- [ ] **Red: canonical and compatibility cases**

Cover a final `## Source Groups` section with `### Source Group: <label> {#<id>}` and required `Summary`; an existing catalog without the section yielding `sourceGroups: []`; an empty AST yielding `[]`; and section ordering after Authorizations.

- [ ] **Red: malformed cases**

Cover duplicate H2, out-of-order section, malformed H3, blank label, invalid slug, missing/blank/repeated/unknown Summary, and authored `Members` rejected as `storyCatalogUnknownField`.

- [ ] **Run red**

```bash
rtk bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/parser-story-catalog.test.ts
```

- [ ] **Implement parser extension**

Extend `Section`, `ItemKind`, `SECTION_ORDER`, `ITEM_KIND_BY_SECTION`, and `FIELDS_BY_KIND`. Add `sourceGroups` to `emptyStoryCatalog` and `ASTStoryCatalog`. Preserve current accumulated diagnostics.

- [ ] **Green**

```bash
rtk bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/parser-story-catalog.test.ts
rtk bun run check:scripts
```

- [ ] **Commit**

```bash
rtk git add \
  packages/scripts/compile-scenes/types.ts \
  packages/scripts/compile-scenes/parser-story-catalog.ts \
  packages/scripts/compile-scenes/parser-story-catalog.test.ts \
  packages/scripts/__fixtures__/story_catalog
rtk git commit -m "feat: parse source group registry"
```

---

## Task 3: Compile one validated case-record corpus

**Files**

- Modify `packages/scripts/compile-scenes/case-record-provenance.ts`
- Modify `packages/scripts/compile-scenes/case-record-provenance.test.ts`
- Modify `packages/scripts/compile-scenes/story-catalog.ts`
- Modify `packages/scripts/compile-scenes/story-catalog.test.ts`
- Modify `packages/scripts/compile-scenes/types.ts`

- [ ] **Red: corpus and group derivation**

Build small `SceneRecord[]` values and assert:

- neutral and annotated records become compiled records;
- evidence and statement namespaces may reuse the same ID;
- indexes sort independently by ID;
- a declared group derives mixed typed members in evidence-before-statement, then-ID order;
- no authored member list is required;
- origin/file/line are retained.

- [ ] **Red: group validation and warnings**

Cover duplicate group IDs through the existing global-definition checker, undeclared group at the record's `Source Group` line, unused group at its heading, a successful singleton plus exact `singletonSourceGroup` warning, warning order by group ID, and null-group records excluded from groups.

- [ ] **Red: supersession graph**

Cover valid equal/advancing status; unknown predecessor; cross-kind predecessor; self; fork; two-node and longer cycles; and procedural regression, including explicit status superseded by omitted/default `unspecified`. Diagnostics point to the successor's `Supersedes` line.

- [ ] **Red: metadata requirement seam**

Independently fail source kind, layer, allowed/prohibited procedure, completeness, confidence, required source group, and required capabilities with `caseRecordRequirementFailed`.

- [ ] **Run red**

```bash
rtk bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/case-record-provenance.test.ts \
  packages/scripts/compile-scenes/story-catalog.test.ts
```

- [ ] **Implement exact keys, ranks, and comparators**

```ts
export function inventoryTargetKey(target: InventoryTarget): string {
  return `${target.kind}:${target.id}`;
}

export function compareInventoryTargets(
  left: InventoryTarget,
  right: InventoryTarget,
): number {
  const leftRank = left.kind === "evidence" ? 0 : 1;
  const rightRank = right.kind === "evidence" ? 0 : 1;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
```

Use an explicit procedure rank only for supersession:

```ts
const PROCEDURAL_STATUS_RANK: Record<ProceduralStatus, number> = {
  unspecified: 0,
  lead: 1,
  reacquired: 2,
  exhibit: 3,
};
```

- [ ] **Implement one-shot corpus construction**

Extend `validateStoryCatalog` to index source-group IDs with the existing duplicate checker. `compileCaseRecordCorpus` walks every investigation/interrogation record once, normalizes once, derives group membership, rejects undeclared/unused groups, builds deterministic warnings, validates chains, and returns indexes. No other function rebuilds this corpus.

- [ ] **Green**

```bash
rtk bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/case-record-provenance.test.ts \
  packages/scripts/compile-scenes/story-catalog.test.ts
rtk bun run check:scripts
```

- [ ] **Commit**

```bash
rtk git add \
  packages/scripts/compile-scenes/types.ts \
  packages/scripts/compile-scenes/case-record-provenance.ts \
  packages/scripts/compile-scenes/case-record-provenance.test.ts \
  packages/scripts/compile-scenes/story-catalog.ts \
  packages/scripts/compile-scenes/story-catalog.test.ts
rtk git commit -m "feat: validate case record corpus"
```

---

## Task 4: Emit catalog v2 and hash the shared corpus

**Files**

- Modify `packages/scripts/compile-scenes/types.ts`
- Modify `packages/scripts/compile-scenes/emitter.ts`
- Modify `packages/scripts/compile-scenes/emitter.test.ts`
- Modify `packages/scripts/compile-scenes/orchestrator.ts`
- Modify `packages/scripts/compile-scenes.test.ts`
- Modify `packages/scripts/compile-scenes/save-content-manifest.ts`
- Modify `packages/scripts/compile-scenes/save-content-manifest.test.ts`
- Modify `packages/scripts/compile-scenes/dialogue-segment-origins.test.ts`

Use these signatures:

```ts
export function emitInvestigationScene(
  ast: ASTInvestigationScene,
  caseRecords: CompiledCaseRecordCorpus,
): JSONInvestigationScene;

export function emitInterrogationScene(
  ast: ASTInterrogationScene,
  caseRecords: CompiledCaseRecordCorpus,
): JSONInterrogationScene;

export function emitStoryCatalog(
  catalog: ASTStoryCatalog,
  caseRecords: CompiledCaseRecordCorpus,
): StoryCatalogJsonV2;
```

- [ ] **Red: scene/catalog structural equality**

Emit evidence and statements from one corpus and use `assert.deepStrictEqual` for the scene/catalog provenance copies. Cover neutral and full values; object-reference identity is not required.

- [ ] **Red: exact catalog v2 and ordering**

Assert `schemaVersion: 2`, required `sourceGroups`, required provenance on every record index, canonical members, and canonical capabilities.

- [ ] **Red: orchestrator behavior**

Cover omitted registry → `sourceGroups: []`; absent catalog with no grouped records → empty v2 catalog; undeclared/unused group → fail before writes; singleton → warning; failed corpus leaves sentinel outputs untouched; successful scene/catalog copies agree.

- [ ] **Red: content identity**

Changing only one provenance value, one group Summary, or one record membership changes `contentRevision`; identical semantic bundles remain stable.

- [ ] **Run red**

```bash
rtk bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/emitter.test.ts \
  packages/scripts/compile-scenes.test.ts \
  packages/scripts/compile-scenes/save-content-manifest.test.ts \
  packages/scripts/compile-scenes/dialogue-segment-origins.test.ts
```

- [ ] **Implement v2 wire types and one corpus flow**

Add `StoryCatalogJsonV2` with literal version 2. Add required provenance to scene records and catalog indexes. In the orchestrator, run existing validation, compile the corpus exactly once, append errors/warnings, return before writes on errors, and pass the corpus to every scene/catalog emitter. A missing/mis-originated record in emission is `caseRecordEmissionMismatch`.

- [ ] **Keep manifest envelope v1**

Change only:

```ts
export type SaveContentBundleV1 = {
  // existing chapters
  storyCatalog: StoryCatalogJsonV2;
};
```

Do not change the hash algorithm or `manifestVersion`.

- [ ] **Green**

```bash
rtk bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/case-record-provenance.test.ts \
  packages/scripts/compile-scenes/story-catalog.test.ts \
  packages/scripts/compile-scenes/emitter.test.ts \
  packages/scripts/compile-scenes.test.ts \
  packages/scripts/compile-scenes/save-content-manifest.test.ts \
  packages/scripts/compile-scenes/dialogue-segment-origins.test.ts
rtk bun run check:scripts
```

- [ ] **Commit**

```bash
rtk git add \
  packages/scripts/compile-scenes/types.ts \
  packages/scripts/compile-scenes/emitter.ts \
  packages/scripts/compile-scenes/emitter.test.ts \
  packages/scripts/compile-scenes/orchestrator.ts \
  packages/scripts/compile-scenes.test.ts \
  packages/scripts/compile-scenes/save-content-manifest.ts \
  packages/scripts/compile-scenes/save-content-manifest.test.ts \
  packages/scripts/compile-scenes/dialogue-segment-origins.test.ts
rtk git commit -m "feat: emit provenance catalog v2"
```

---

## Task 5: Add strict Rust provenance wire/domain types

**Files**

- Create `apps/game/src-tauri/src/game/provenance.rs`
- Modify `apps/game/src-tauri/src/game/mod.rs`
- Modify `apps/game/src-tauri/src/game/schema.rs`
- Modify `apps/game/src-tauri/src/game/error.rs`

- [ ] **Red: exact neutral defaults and legacy omission**

Assert every enum's designated default and full `CaseRecordProvenance::default()`. Deserialize an old scene record without the entire provenance field and assert every neutral value.

- [ ] **Red: strict present object**

Cover all enum values; any missing field; unknown field; blank label/group; invalid slug; duplicate capabilities; unique non-canonical capabilities; canonical capabilities; exact camelCase keys; canonical capability serialization.

- [ ] **Red: explicit target ordering**

Assert evidence-before-statement, then ID, independent of enum declaration and set insertion.

- [ ] **Run red**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::provenance::tests -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::schema::tests -- --nocapture
```

- [ ] **Implement explicit defaults and strict nullable keys**

Each enum marks only the neutral variant `#[default]`. Use a non-optional wrapper around nullable JSON fields so omission fails while explicit `null` succeeds:

```rust
#[derive(Deserialize)]
#[serde(transparent)]
struct RequiredNullable<T>(Option<T>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CaseRecordProvenanceWire {
    source_kind: SourceKind,
    representation_layer: RepresentationLayer,
    procedural_status: ProceduralStatus,
    completeness: Completeness,
    confidence: Confidence,
    source_group_id: RequiredNullable<String>,
    source_label: RequiredNullable<String>,
    proof_capabilities: Vec<ProofCapability>,
    supersedes_record_id: RequiredNullable<String>,
}
```

Implement custom domain deserialization through this wire, rejecting duplicates and non-canonical order before set conversion. Implement custom serialization by walking an explicit capability list; do not serialize by set iteration.

- [ ] **Add scene fields**

```rust
#[serde(default)]
pub provenance: CaseRecordProvenance,
```

Add this to evidence and statements. The containing field defaults only when the entire object is absent; a present object remains strict.

- [ ] **Green**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::provenance::tests -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::schema::tests -- --nocapture
rtk cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml -- --check
```

- [ ] **Commit**

```bash
rtk git add \
  apps/game/src-tauri/src/game/provenance.rs \
  apps/game/src-tauri/src/game/mod.rs \
  apps/game/src-tauri/src/game/schema.rs \
  apps/game/src-tauri/src/game/error.rs
rtk git commit -m "feat: add strict provenance schema"
```

---

## Task 6: Load catalog v2, source groups, and supersession chains

**Files**

- Modify `apps/game/src-tauri/src/game/story/catalog.rs`
- Modify `apps/game/src-tauri/src/game/story/mod.rs`
- Modify `apps/game/src-tauri/src/game/error.rs`
- Modify `apps/game/src-tauri/src/game/test_support.rs`

- [ ] **Red: version migration**

Replace v1 fixtures with v2. Assert v2 loads; v1 and v3 fail from the existing envelope before payload-field validation; v2 requires provenance and `sourceGroups`; unknown payload/record/provenance/group fields fail at the owning load boundary.

- [ ] **Red: strict group wire**

Cover duplicate members, non-canonical member order, missing target, target with null/different group, grouped record omitted from group, empty group, duplicate group ID, and canonical mixed group.

- [ ] **Red: chains and corruption**

Load lead → reacquired → exhibit and assert predecessor, successor, full oldest-to-newest chain for every member, and latest definition. Reject unknown, cross-kind, self, fork, cycle, and procedural regression as `storyCatalogValidationFailed`.

- [ ] **Run red**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::story::catalog::tests -- --nocapture
```

- [ ] **Implement v2 envelope and validated definitions**

Reuse `StoryCatalogVersionEnvelope`; set accepted version to 2 and future test sentinel to 3. Apply `deny_unknown_fields` to the v2 payload and wire records. Replace the old private index with:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CaseRecordDefinitionJsonV2 {
    id: String,
    chapter_id: String,
    scene_id: String,
    provenance: CaseRecordProvenance,
}
```

The nested domain type invokes Task 5's strict deserializer. Remove dead-code allowances once origins are used.

- [ ] **Implement strict groups and supersession maps**

Deserialize group members as `Vec<InventoryTarget>`, reject duplicates and explicit-order violations, then convert to the domain set. Validate reciprocal record/group membership. Build predecessor and reverse successor maps and validate all graph invariants before installing the catalog.

- [ ] **Add queries and errors**

Add `case_record`, `source_group`, `predecessor`, `successor`, `chain`, and `latest_definition`. Add exact error-code tests for `caseRecordDefinitionMismatch`, `inventoryRecordDefinitionMismatch`, and `missingCaseRecordSourceGroup`. Narrow `acquisitionDefinitionMismatch` to pending-event kind/scene disagreement.

- [ ] **Green**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::story::catalog::tests -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::error::tests -- --nocapture
```

- [ ] **Commit**

```bash
rtk git add \
  apps/game/src-tauri/src/game/story/catalog.rs \
  apps/game/src-tauri/src/game/story/mod.rs \
  apps/game/src-tauri/src/game/error.rs \
  apps/game/src-tauri/src/game/test_support.rs
rtk git commit -m "feat: load provenance catalog v2"
```

---

## Task 7: Enforce scene/catalog integrity at load and acquisition

**Files**

- Modify `apps/game/src-tauri/src/game/provenance.rs`
- Modify `apps/game/src-tauri/src/game/loader.rs`
- Modify `apps/game/src-tauri/src/game/navigation.rs`
- Modify `apps/game/src-tauri/src/game/acquisition.rs`
- Modify `apps/game/src-tauri/src/game/reveals.rs`
- Modify `apps/game/src-tauri/src/game/state.rs`
- Modify `apps/game/src-tauri/src/game/mod.rs`
- Modify `apps/game/src-tauri/src/game/scenes/investigation.rs`
- Modify `apps/game/src-tauri/src/game/scenes/interrogation.rs`
- Modify `apps/game/src-tauri/src/game/command_tx.rs`
- Modify `apps/game/src-tauri/src/game/test_support.rs`
- Audit every literal in `apps/game/src-tauri` matching `EvidenceJson {`, `StatementJson {`, `EvidenceRecord {`, or `StatementRecord {`.

- [ ] **Inventory constructor sites before edits**

```bash
rtk rg -n \
  'EvidenceJson \{|StatementJson \{|EvidenceRecord \{|StatementRecord \{' \
  apps/game/src-tauri
```

Record every path. Production constructors remain explicit; tests may use focused helpers. Do not add broad defaults to complete records.

- [ ] **Red: scene/catalog mismatch**

For a same typed ID, independently change chapter, scene, and provenance. Assert `caseRecordDefinitionMismatch`. Matching neutral/full definitions load.

- [ ] **Red: acquisition atomicity**

A mismatched definition must leave inventory, pending events, and ordinal unchanged. A valid acquisition copies exact provenance.

- [ ] **Run red**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::loader::tests -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::acquisition::tests -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::reveals::tests -- --nocapture
```

- [ ] **Implement shared comparison**

```rust
pub(in crate::game) fn validate_scene_records_against_catalog(
    catalog: &StoryCatalog,
    chapter_id: &str,
    scene: &SceneJson,
) -> Result<(), GameError>;
```

Compare typed identity, chapter, scene, and provenance exactly.

- [ ] **Make production scene loading catalog-aware**

Update startup, advance/jump, scene-navigation index, packaged acquisition lookup, debug grant-all, dialogue-origin packaged loads, and restore definition loading. Keep a clearly named low-level JSON decoder only for tests that intentionally exercise pre-catalog parsing. Every production route that installs or exposes an investigation/interrogation definition must validate it. Linear scenes remain unaffected.

- [ ] **Make acquisition fallible before mutation**

Add `catalog: &StoryCatalog` to `AcquisitionCtx`. Change evidence/statement acquisition to `Result<bool, GameError>`. Validate before pushing inventory/event or incrementing ordinal. Make reveal helpers return `Result<Vec<DialogueSegment>, GameError>` and propagate `?` through all callers.

- [ ] **Copy immutable provenance into internal inventory**

Add provenance to `EvidenceRecord` and `StatementRecord`, keeping acquisition chapter/scene separate. Update every constructor site and rerun the literal inventory.

- [ ] **Green**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::state::tests -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::acquisition::tests -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::reveals::tests -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::navigation::tests -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::loader::tests -- --nocapture
```

- [ ] **Commit**

```bash
rtk git add apps/game/src-tauri/src/game
rtk git commit -m "feat: validate acquired record definitions"
```

---

## Task 8: Derive inventory-independent support lineage

**Files**

- Create `apps/game/src-tauri/src/game/support_lineage.rs`
- Modify `apps/game/src-tauri/src/game/mod.rs`
- Modify `apps/game/src-tauri/src/game/story/mod.rs`
- Modify `apps/game/src-tauri/src/game/story/state.rs`
- Modify `apps/game/src-tauri/src/game/error.rs`

- [ ] **Red: direct/transitive closure**

Use `fact_a → evidence:a`, `fact_b → fact_a + statement:b`, `fact_c → fact_b + evidence:c`. Assert direct records, transitive records, transitive facts excluding the root, and deduplication over repeated paths.

- [ ] **Red: inventory independence**

Do not acquire supporting records. Internal record and source-group closure must still include them through catalog definitions.

- [ ] **Red: diagnostic/strict groups**

All grouped → strict set; one null group → diagnostic known groups plus missing record; repeated paths dedupe; strict error lists every missing typed record in explicit order.

- [ ] **Red: defense in depth**

Unknown root fact, unknown support fact, unknown support record, and cycle map to existing `unknownStoryFact`, `invalidSupportingFact`, and `unknownSupportingCaseRecord` contracts.

- [ ] **Run red**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::support_lineage::tests -- --nocapture
```

- [ ] **Add narrow read-only accessors**

```rust
impl StoryState {
    pub(in crate::game) fn fact_progress(
        &self,
        id: &str,
    ) -> Option<&FactProgress>;
}

impl FactProgress {
    pub(in crate::game) fn supporting_records(
        &self,
    ) -> &BTreeSet<InventoryTarget>;

    pub(in crate::game) fn supporting_fact_ids(
        &self,
    ) -> &BTreeSet<String>;
}
```

Do not expose maps or change snapshots.

- [ ] **Implement deterministic traversal and closures**

Use stack/visited traversal. Resolve every typed record through the catalog. Diagnostic closure never drops null groups; strict closure errors unless none are missing. Internal sets may be `BTreeSet`, but errors/public vectors use the explicit comparator.

- [ ] **Green**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::support_lineage::tests -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::story::state::tests -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::story::mutations::tests -- --nocapture
```

- [ ] **Commit**

```bash
rtk git add \
  apps/game/src-tauri/src/game/support_lineage.rs \
  apps/game/src-tauri/src/game/mod.rs \
  apps/game/src-tauri/src/game/story/mod.rs \
  apps/game/src-tauri/src/game/story/state.rs \
  apps/game/src-tauri/src/game/error.rs
rtk git commit -m "feat: derive case record support lineage"
```

---

## Task 9: Build spoiler-safe Rust public inventory and fact views

**Files**

- Modify `apps/game/src-tauri/src/game/view.rs`
- Modify `apps/game/src-tauri/src/game/state.rs`
- Modify `apps/game/src-tauri/src/game/story/view.rs`
- Modify `apps/game/src-tauri/src/game/mod.rs`
- Modify `apps/game/src-tauri/src/game/provenance.rs`
- Modify `apps/game/src-tauri/src/game/error.rs`

Add:

```rust
pub struct InventoryView {
    pub evidence: Vec<EvidenceRecordView>,
    pub statements: Vec<StatementRecordView>,
}

impl InventoryView {
    pub(in crate::game) fn from_inventory(
        catalog: &StoryCatalog,
        inventory: &Inventory,
    ) -> Result<Self, GameError>;
}

impl Inventory {
    pub(in crate::game) fn acquired_targets(
        &self,
    ) -> BTreeSet<InventoryTarget>;
}
```

- [ ] **Red: dynamic predecessor redaction**

Neutral/full provenance serializes; acquire B superseding absent A → public null; acquire A later → next view exposes A; acquire A alone → no future successor; capability arrays stay canonical.

- [ ] **Red: inventory mismatch**

Mutate internal acquired provenance and assert `inventoryRecordDefinitionMismatch`, not the scene/catalog error.

- [ ] **Red: fact filtering/order**

Internal fact supports unacquired evidence A and acquired statement B. Public state exposes only B. After A acquisition, next view exposes A then B by explicit comparator. Empty array remains legal; no hidden-support field; supporting fact IDs unchanged.

- [ ] **Run red**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::story::view::tests -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::view::tests -- --nocapture
```

- [ ] **Implement public projection**

Add record-view types mirroring current display/acquisition fields plus public provenance. Remove `Serialize` from mutable `Inventory`, `EvidenceRecord`, and `StatementRecord`. During projection, validate each internal record against catalog provenance and origin, build public records, and redact predecessor unless acquired. Never expose successor.

- [ ] **Filter fact support**

Change `StoryStateView::from_catalog_state` to accept the acquired target set, filter direct records, and sort explicitly.

- [ ] **Wire `GameEngine::view`**

Build `InventoryView` first; after successful validation obtain `self.inventory.acquired_targets()` and pass it to `StoryStateView`. Preserve pending acquisition and all other fields.

- [ ] **Green**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::story::view::tests -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::view::tests -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::tests -- --nocapture
```

- [ ] **Commit**

```bash
rtk git add \
  apps/game/src-tauri/src/game/view.rs \
  apps/game/src-tauri/src/game/state.rs \
  apps/game/src-tauri/src/game/story/view.rs \
  apps/game/src-tauri/src/game/mod.rs \
  apps/game/src-tauri/src/game/provenance.rs \
  apps/game/src-tauri/src/game/error.rs
rtk git commit -m "feat: expose spoiler safe inventory provenance"
```

---

## Task 10: Mirror the public contract in TypeScript without UI changes

**Files**

- Modify `apps/game/src/lib/state/types.ts`
- Create `apps/game/src/lib/state/test-fixtures.ts`
- Modify fixture-heavy tests and `apps/game/e2e-tauri/save-fixtures.ts`
- Inventory every additional `EvidenceRecord`, `StatementRecord`, `GameStateView`, and `inventory: {` fixture before editing.

- [ ] **Inventory fixtures**

```bash
rtk rg -n \
  'EvidenceRecord|StatementRecord|GameStateView|inventory:\s*\{' \
  apps/game/src apps/game/e2e-tauri
```

Record every fixture path.

- [ ] **Red: frontend contract with unchanged rendering**

Add an annotated provenance object to `InventoryPanel.test.ts`; import the not-yet-defined type and assert the component still renders only existing inventory content, with no provenance label or accessible-name change.

- [ ] **Run red**

```bash
rtk bun run --cwd apps/game test \
  src/lib/components/InventoryPanel.test.ts
```

- [ ] **Add exact frontend types and test-only factories**

Mirror every enum and field. Document the dual meaning of public null predecessor and public empty supporting records. Keep external property name `inventory`. Put `neutralCaseRecordProvenance()` and record/view factories in `apps/game/src/lib/state/test-fixtures.ts`, never in production state classes.

- [ ] **Update all fixtures and prove UI unchanged**

```bash
rtk bun run --cwd apps/game test \
  src/lib/components/InventoryPanel.test.ts \
  src/lib/state/acquisition-controller.test.ts \
  src/lib/components/SceneNavigationPanel.test.ts \
  src/lib/components/GameShell.test.ts \
  src/lib/components/InterrogationView.test.ts \
  src/routes/page.test.ts \
  src/lib/state/game-client-source.test.ts \
  src/lib/persistence/types.test.ts \
  src/lib/audio/sfx-events.test.ts
```

- [ ] **Green checks**

```bash
rtk bun run check
rtk bun run --cwd apps/game check:e2e
```

Rerun the fixture inventory and confirm every hand-built record has provenance and no component renders it.

- [ ] **Commit**

```bash
rtk git add apps/game/src apps/game/e2e-tauri/save-fixtures.ts
rtk git commit -m "feat: mirror case record provenance types"
```

---

## Task 11: Preserve save schema v1 while rejoining immutable provenance

**Files**

- Modify `apps/game/src-tauri/src/game/save/capture.rs`
- Modify `apps/game/src-tauri/src/game/save/restore.rs`
- Modify inline tests in `apps/game/src-tauri/src/game/save/schema.rs`
- Modify `apps/game/src-tauri/src/game/test_support.rs`

- [ ] **Red: save shape remains ID-only**

Serialize a save with lead/reacquired/exhibit records. Assert inventory entries contain only ID and acquisition chapter/scene and have no provenance/group/capability/supersession/member keys. Assert `SAVE_SCHEMA_VERSION == 1`.

- [ ] **Red: capture mismatch**

Acquire a valid record, alter internal provenance, and assert capture fails with `inventoryRecordDefinitionMismatch` before constructing a snapshot.

- [ ] **Red: restore/rejoin**

Use v2 resources with a chain, group, and direct/transitive support. Capture/restore and assert origins, internal provenance, chain, source closure, public redaction, and exact recapture are identical.

- [ ] **Red: packaged definition mismatch**

Align the content-identity fixture while corrupting a scene relative to its catalog; restore must fail with `caseRecordDefinitionMismatch` before candidate installation.

- [ ] **Run red**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::capture::tests -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::restore::tests -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::schema::tests -- --nocapture
```

- [ ] **Strengthen capture and current-definition loading**

For each acquired record, require catalog origin, owning scene provenance, and internal provenance to agree. Use `inventoryRecordDefinitionMismatch` for internal/catalog disagreement and retain `caseRecordDefinitionMismatch` for scene/catalog disagreement. `load_current_definitions` validates every scene against catalog before insertion.

- [ ] **Reconstruct through definitions, not save data**

`restore_inventory` continues resolving saved ID and acquisition scene; the selected scene is catalog-validated and `add_*_from_def` copies provenance. Do not add save-owned immutable data. Preserve final recapture and public-view validation.

- [ ] **Green**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::capture::tests -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::save::restore::tests -- --nocapture
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
```

- [ ] **Commit**

```bash
rtk git add \
  apps/game/src-tauri/src/game/save \
  apps/game/src-tauri/src/game/test_support.rs
rtk git commit -m "feat: restore immutable record provenance"
```

---

## Task 12: Update authoring guidance and live-corpus compatibility

**Files**

- Modify `.claude/skills/writing-investigation-scene/SKILL.md`
- Modify `.claude/skills/writing-interrogation-scene/SKILL.md`
- Modify `packages/scripts/compile-scenes/case-record-provenance.test.ts`
- Modify `packages/scripts/compile-scenes.test.ts`

- [ ] **Review the skill contract**

Read both tracked skills and manually check every field/enum, exact neutral defaults, `none` conflation, central group declaration with derived membership, positive capability semantics, explicit-status supersession warning, and absence of an authored Members instruction. Record the completed checklist in the task report. Do not add tests that grep or assert prose/source text.

- [ ] **Update both skills**

The investigation skill contains canonical Traditional Chinese-facing guidance with exact English parser keys and compact examples. The interrogation skill keeps delegation but updates its local record skeleton so it cannot teach a contradictory abbreviated manifest.

- [ ] **Add live-corpus compatibility**

Current production chapters and current `story_catalog.md` compile with neutral provenance and `sourceGroups: []` without story Markdown edits.

Add or strengthen compiler behavior tests only where they exercise this emitted/runtime input contract. Do not use those tests as proxies for the wording of the writer skills.

- [ ] **Green**

```bash
rtk bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/case-record-provenance.test.ts \
  packages/scripts/compile-scenes.test.ts
rtk bun run scenes:compile
rtk bun run check:scripts
rtk git status --short
```

Generated runtime JSON must not be staged or committed.

- [ ] **Verify canonical skill root**

```bash
rtk git ls-files \
  '.claude/skills/writing-investigation-scene/SKILL.md' \
  '.claude/skills/writing-interrogation-scene/SKILL.md' \
  '.agents/skills/writing-investigation-scene/SKILL.md' \
  '.agents/skills/writing-interrogation-scene/SKILL.md'
```

Expected: only repository-canonical tracked sources; no divergent duplicate.

- [ ] **Commit**

```bash
rtk git add \
  .claude/skills/writing-investigation-scene/SKILL.md \
  .claude/skills/writing-interrogation-scene/SKILL.md \
  packages/scripts/compile-scenes/case-record-provenance.test.ts \
  packages/scripts/compile-scenes.test.ts
rtk git commit -m "docs: document case record provenance"
```

---

## Task 13: Add end-to-end guards and run the full verification floor

**Files**

- Create `apps/game/src-tauri/src/game/case_record_integration_tests.rs`
- Modify `apps/game/src-tauri/src/game/mod.rs`
- Create `packages/scripts/compile-scenes/case-record-provenance.integration.test.ts`

- [ ] **Red: cross-layer Rust integration**

Create compiler-shaped temp resources with catalog v2, lead/reacquired/exhibit, one statement, a mixed group, and direct/transitive fact support. Start `GameEngine`, acquire successor-first, assert dynamic redaction and internal lineage, capture/restore, and assert identical public/internal behavior.

- [ ] **Add narrow behavioral and wire-contract guards**

Exercise public compiler/runtime behavior that fails if:

- scene/catalog output stops using the same normalized provenance;
- duplicate or unknown manifest metadata becomes last-write-wins;
- catalog v2 output loses provenance or source groups;
- source-group Markdown accepts `Members`;
- strict wire capabilities or group members silently deduplicate or reorder invalid arrays;
- the serialized `GameStateView.inventory` payload bypasses the spoiler-safe inventory projection;
- public JSON exposes successor or hidden-support fields;
- canonical output changes with input insertion order or enum/set declaration details.

Do not grep TypeScript/Rust source or assert private type/derive spelling. The existing task-scoped tests may already cover individual failures; this task adds only integration-level gaps and avoids duplicating their logic.

- [ ] **Run integration and behavioral-contract tests**

```bash
rtk bunx vitest run --config vitest.scripts.config.ts \
  packages/scripts/compile-scenes/case-record-provenance.integration.test.ts
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml \
  game::case_record_integration_tests -- --nocapture
```

Confirm the intended red failure for each newly introduced integration guard. When earlier tasks already implement the behavior, use a narrow temporary mutation to prove the test catches that break, restore the production code, and rerun green.

- [ ] **Commit guards before the full floor**

```bash
rtk git add \
  apps/game/src-tauri/src/game/case_record_integration_tests.rs \
  apps/game/src-tauri/src/game/mod.rs \
  packages/scripts/compile-scenes/case-record-provenance.integration.test.ts
rtk git commit -m "test: cover provenance lineage integration"
```

- [ ] **Run compiler generation/static checks on the committed tree**

```bash
rtk bun run scenes:compile
rtk bun run check:scripts
```

- [ ] **Run all automated tests**

```bash
rtk bun run test
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
```

- [ ] **Run frontend and E2E TypeScript checks**

```bash
rtk bun run check
rtk bun run --cwd apps/game check:e2e
```

- [ ] **Run formatting/lint gates**

```bash
rtk bun run lint:all
```

- [ ] **Decide packaged Tauri E2E**

```bash
rtk git diff --name-only main...HEAD
```

Run `rtk bun run test:e2e` if a rendered workflow, acquisition popup behavior, or save command surface changed beyond type-only payload additions. Otherwise record why `check:e2e` is sufficient.

- [ ] **Confirm scope cleanliness**

```bash
rtk git status --short
rtk git diff --check
rtk git diff --name-only main...HEAD
```

Expected: clean worktree after restoring/removing generated changes; no generated runtime JSON committed; no `.agents/skills` duplicate; no Chapter 1/2 production annotations; only approved compiler/runtime/view/save/guidance boundaries.

- [ ] **Record verification in PR #29**

Post every command and result, packaged-E2E decision, integration-guard commit SHA, and final `git status --short`. Do not mark HPA-256 complete until every required gate is green.

## Review gates

1. **Tasks 1–4 — compiler:** source locations, closed metadata, derived groups, chain validation, one corpus, catalog v2, content identity.
2. **Tasks 5–7 — runtime definitions:** strict wire/domain serde, v2 validation, error ownership, scene equality, acquisition atomicity.
3. **Task 8 — lineage:** inventory independence and diagnostic/strict source semantics.
4. **Tasks 9–10 — public contract:** no spoilers, dynamic redaction, mutable/public separation, exact frontend mirror, unchanged UI.
5. **Task 11 — persistence:** save v1 unchanged; immutable metadata rejoins through exact content.
6. **Tasks 12–13 — handoff/integration:** current story needs no migration, skills match parser, all gates green.

## Completion criteria

HPA-256 is complete only when:

- current unannotated chapters compile and play with neutral provenance;
- annotated fixtures cover every dimension and capability;
- groups are declared once and members are derived;
- catalog v1/v3 are rejected and v2 loads strictly;
- scene/catalog origin and provenance agree at compile, load, acquisition, capture, and restore boundaries;
- lead → reacquired → exhibit chains are immutable and deterministic;
- internal lineage includes valid unacquired support;
- public inventory/facts hide unacquired definitions and recompute redaction per view;
- save JSON remains schema version 1 and ID-only;
- content revision changes for provenance/group edits;
- no current component renders provenance;
- authoring skills match the shipped parser;
- every required command gate passes.
