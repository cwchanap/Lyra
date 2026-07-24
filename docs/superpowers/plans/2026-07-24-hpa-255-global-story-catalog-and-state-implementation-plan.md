# HPA-255 Global Story Catalog and State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile an optional global story catalog and load it into a Rust-owned, sparse, monotonic fact/question/objective/authorization state with validated mutations, snapshots, rollback, and a filtered public view.

**Architecture:** `@lyra/scripts` discovers and compiles one optional root-level `story_catalog.md` into an always-present versioned `story_catalog.json`. A focused Rust `game/story/` subsystem owns the immutable catalog, validated mutable state, crate-internal mutations, snapshot conversion, and public view joining; `GameEngine` owns the catalog and state and includes state in command rollback.

**Tech Stack:** Bun 1.3.1, TypeScript, Vitest, SvelteKit/Svelte 5 contract types, Rust, Serde, Cargo.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-24-hpa-255-global-story-catalog-and-state-design.md` as the normative contract.
- Keep compiler AST and wire types in `@lyra/scripts`; do not broaden `@lyra/scene-types`.
- Do not add a production `story_catalog.md`, UI, save envelope/file I/O, reveal dispatch, predicates, fixed-point reachability, analysis runtime, or transitive support.
- Always emit `story_catalog.json` with `schemaVersion: 1`, including when no authored catalog exists.
- Keep story progress sparse and monotonic; presence means asserted, revealed, or granted.
- Keep all story mutations `pub(in crate::game)` and do not register them as Tauri commands.
- Validate complete mutation requests before the first write; failures leave `StoryState` byte-for-byte unchanged.
- Preserve the first fact/authorization origin and derive nullable chapter/scene fields from it.
- Expose only the applied `resolvedByFactId`; never expose immutable candidate `resolvedByFactIds`.
- Treat analysis-board references as structurally validatable only until HPA-259 supplies board definitions.
- Do not hand-edit generated JSON under `apps/game/src-tauri/resources/`.

---

## File map

### Compiler

- Create `packages/scripts/compile-scenes/parser-story-catalog.ts`: strict Markdown parser and catalog-specific source-location helpers.
- Create `packages/scripts/compile-scenes/parser-story-catalog.test.ts`: parser contract and diagnostic-line tests.
- Create `packages/scripts/compile-scenes/story-catalog.ts`: cross-corpus validation, case-record index derivation, primary-target and board-reference helpers.
- Create `packages/scripts/compile-scenes/story-catalog.test.ts`: catalog validation/helper tests.
- Modify `packages/scripts/compile-scenes/types.ts`: catalog AST and version-1 JSON wire types.
- Modify `packages/scripts/compile-scenes/emitter.ts`: deterministic `emitStoryCatalog`.
- Modify `packages/scripts/compile-scenes/emitter.test.ts`: emitted ordering and empty-artifact tests.
- Modify `packages/scripts/compile-scenes/validator.ts`: compiler-level duplicate scene-ID validation.
- Modify `packages/scripts/compile-scenes/validator.test.ts`: duplicate scene-ID coverage.
- Modify `packages/scripts/compile-scenes/orchestrator.ts`: merged-root catalog discovery, parse/validate integration, and surgical artifact write.
- Modify `packages/scripts/compile-scenes.test.ts`: absent, valid, duplicate-root, and no-partial-write orchestration coverage.

### Rust

- Create `apps/game/src-tauri/src/game/story/mod.rs`: in-game exports.
- Create `apps/game/src-tauri/src/game/story/catalog.rs`: Serde JSON shapes, loading, version validation, and immutable indexes.
- Create `apps/game/src-tauri/src/game/story/state.rs`: progress structs, origins, live state, snapshots, and validated snapshot join.
- Create `apps/game/src-tauri/src/game/story/mutations.rs`: atomic/idempotent crate-internal mutation methods.
- Create `apps/game/src-tauri/src/game/story/view.rs`: filtered, deterministically ordered public story view.
- Modify `apps/game/src-tauri/src/game/schema.rs`: add `PartialOrd`/`Ord` to `InventoryTarget`.
- Modify `apps/game/src-tauri/src/game/error.rs`: story catalog, mutation, and snapshot errors.
- Modify `apps/game/src-tauri/src/game/mod.rs`: module registration, engine ownership, startup loading, and view join.
- Modify `apps/game/src-tauri/src/game/command_tx.rs`: rollback capture/restore for `story_state`, explicit immutable classification for `story_catalog`.
- Modify `apps/game/src-tauri/src/game/view.rs`: add `story: StoryStateView`.
- Modify `apps/game/src-tauri/src/game/test_support.rs`: write the required empty catalog in shared resource fixtures.

### Frontend and guidance

- Modify `apps/game/src/lib/state/types.ts`: exact camelCase story view mirror.
- Modify all six hand-built `GameStateView` fixture files listed in Task 6.
- Modify `CLAUDE.md` (and therefore symlinked `AGENTS.md`): required generated catalog and stale-resource remedy.

---

### Task 1: Parse the authored story catalog

**Files:**

- Create: `packages/scripts/compile-scenes/parser-story-catalog.ts`
- Create: `packages/scripts/compile-scenes/parser-story-catalog.test.ts`
- Modify: `packages/scripts/compile-scenes/types.ts`

**Interfaces:**

- Consumes: existing `Located<T>` and `CompileError` from `packages/scripts/compile-scenes/types.ts`.
- Produces:

```ts
export type StoryCatalogParseResult =
  | { ok: true; value: ASTStoryCatalog }
  | { ok: false; errors: CompileError[] };

export function emptyStoryCatalog(sourceFile: string): ASTStoryCatalog;
export function parseStoryCatalog(
  source: string,
  sourceFile: string,
): StoryCatalogParseResult;
```

- [ ] **Step 1: Add the source-located catalog and version-1 JSON types**

Add exact definitions for `ASTStoryCatalog`, four located definition types,
located `resolvedByFactIds` references, `StoryCatalogJson`, and its definition
and case-record index entries. Use `resolvedByFactIds:
Array<Located<{ id: string }>>` in the AST so diagnostics point at the
metadata row; strip locations only in the emitter.

- [ ] **Step 2: Write failing parser tests for the canonical document**

Cover one full catalog, every omitted/empty H2 section, authored item order,
`Resolved By: []`, and exact metadata-line locations. The principal success
assertion must include:

```ts
expect(result).toMatchObject({
  ok: true,
  value: {
    facts: [{ id: "door_timeline_conflict", line: 5 }],
    questions: [
      {
        id: "who_changed_timeline",
        resolvedByFactIds: [
          { id: "door_timeline_conflict", line: 15 },
        ],
      },
    ],
    objectives: [{ id: "resolve_timeline", kind: "primary", sortOrder: 10 }],
    authorizations: [{ id: "access_lock_logs" }],
  },
});
```

- [ ] **Step 3: Run the parser tests and confirm the red state**

Run:

```bash
rtk bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/parser-story-catalog.test.ts
```

Expected: FAIL because `parser-story-catalog.ts` and its exports do not exist.

- [ ] **Step 4: Implement the strict top-down parser**

Implement a line walker with these exact rules:

- H1 must be `# Story Catalog`.
- Recognized H2s are `Facts`, `Questions`, `Objectives`, and
  `Authorizations`, each at most once and in that relative order.
- An H3 must match its active section:
  `### Fact: <label> {#<id>}`, `Question`, `Objective`, or `Authorization`.
- New catalog IDs and reference IDs match `^[a-z0-9_]+$`.
- Metadata keys are closed per item kind; required fields are non-empty.
- `Resolved By` parses bracketed comma-separated `fact:<id>` entries; only
  literal `[]` represents an empty list.
- `Sort Order` is a finite base-10 integer and `Kind` is `primary` or
  `secondary`.
- Accumulate independent item errors when safe, preserving exact
  `sourceFile` and one-based line numbers.

Return the stable codes from the design, including
`storyCatalogSectionOutOfOrder`, `storyCatalogDuplicateSection`,
`storyCatalogDuplicateField`, and `invalidGlobalDefinitionId`.

- [ ] **Step 5: Add failing malformed-input cases, then make them pass**

Add table-driven tests for malformed H1, unknown/out-of-order/repeated H2,
misplaced/mismatched H3, unknown/missing/repeated metadata, blank required
values, bad kind, bad sort order, blank `Resolved By`, malformed references,
uppercase IDs, hyphens, and Unicode IDs. Assert both diagnostic code and exact
line.

Run the focused test command again.

Expected: PASS with all parser cases green.

- [ ] **Step 6: Commit the parser slice**

```bash
rtk git add packages/scripts/compile-scenes/types.ts packages/scripts/compile-scenes/parser-story-catalog.ts packages/scripts/compile-scenes/parser-story-catalog.test.ts
rtk git commit -m "feat: parse global story catalog"
```

---

### Task 2: Validate, index, emit, and orchestrate the catalog

**Files:**

- Create: `packages/scripts/compile-scenes/story-catalog.ts`
- Create: `packages/scripts/compile-scenes/story-catalog.test.ts`
- Modify: `packages/scripts/compile-scenes/emitter.ts`
- Modify: `packages/scripts/compile-scenes/emitter.test.ts`
- Modify: `packages/scripts/compile-scenes/validator.ts`
- Modify: `packages/scripts/compile-scenes/validator.test.ts`
- Modify: `packages/scripts/compile-scenes/orchestrator.ts`
- Modify: `packages/scripts/compile-scenes.test.ts`

**Interfaces:**

- Consumes: `ASTStoryCatalog`, `StoryCatalogJson`, `SceneRecord[]`, and
  `ASTChapter[]`.
- Produces:

```ts
export type AnalysisBoardRef = {
  chapterId: string;
  sceneId: string;
  boardId: string;
};

export function validateStoryCatalog(
  catalog: ASTStoryCatalog,
  scenes: SceneRecord[],
): CompileError[];

export function validateAnalysisBoardRef(
  ref: AnalysisBoardRef,
  location: Located<unknown>,
): CompileError[];

export function validateSetPrimaryObjectiveTarget(
  catalog: ASTStoryCatalog,
  nextObjectiveId: string | null,
  location: Located<unknown>,
): CompileError[];

export function emitStoryCatalog(
  catalog: ASTStoryCatalog,
  scenes: SceneRecord[],
): StoryCatalogJson;
```

- [ ] **Step 1: Write failing validation and emitter tests**

Cover duplicate IDs independently for facts/questions/objectives/
authorizations, unresolved question facts, structurally invalid qualified board
references, null/unknown/secondary primary targets, deterministic objective
ordering, authored order for the other definitions, and evidence/statement
indexes sorted by ID with derived chapter/scene origins.

The empty emitter assertion is:

```ts
expect(emitStoryCatalog(emptyStoryCatalog("story_catalog.md"), [])).toEqual({
  schemaVersion: 1,
  facts: [],
  questions: [],
  objectives: [],
  authorizations: [],
  evidenceIndex: [],
  statementsIndex: [],
});
```

- [ ] **Step 2: Run focused tests and confirm the red state**

```bash
rtk bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/story-catalog.test.ts packages/scripts/compile-scenes/emitter.test.ts packages/scripts/compile-scenes/validator.test.ts
```

Expected: FAIL because catalog validation/emission and duplicate scene-ID
validation do not exist.

- [ ] **Step 3: Implement catalog validation and deterministic emission**

Build one `Map<string, LocatedDefinition>` per catalog kind. Diagnose duplicate
entries at the second definition with both locations in the message. Resolve
each question reference against the fact map. Derive evidence and statement
indexes from investigation/interrogation manifests; do not copy their prose.
Sort objectives by `(sortOrder, id)` and both case-record indexes by `id`.

`validateAnalysisBoardRef` checks only all three non-empty
`^[a-z0-9_]+$` segments. `validateSetPrimaryObjectiveTarget` accepts null;
otherwise it resolves an objective and requires `kind === "primary"`.

- [ ] **Step 4: Add compiler-level duplicate scene-ID validation**

In `validator.ts`, build a per-chapter scene-ID map from `SceneRecord.ast.id`.
Emit `duplicateSceneId` at the second scene when the same ID appears twice in
one chapter. Add a test proving the same scene ID in different chapters is
allowed.

- [ ] **Step 5: Add failing orchestrator tests for merged-root discovery**

Cover:

- no authored catalog emits the exact empty version-1 artifact;
- one catalog in either configured root compiles;
- two catalogs emit `duplicateStoryCatalog` at the second path and write no
  catalog artifact;
- an unreadable discovered catalog emits `storyCatalogUnreadable`;
- catalog validation failure leaves a sentinel pre-existing
  `story_catalog.json` unchanged;
- successful compilation replaces only `chapters.json`,
  `story_catalog.json`, and generated `chapter_*` directories.

- [ ] **Step 6: Integrate discovery, validation, and surgical writing**

Discover `<root>/story_catalog.md` while iterating configured source roots,
before chapter validation. Use `emptyStoryCatalog` when none exists. Parse the
sole discovered file, feed the AST and scene corpus into validation, and return
before filesystem writes when any error exists.

On success, include `story_catalog.json` in the orchestrator-owned surgical
delete set and write:

```ts
writeFileSync(
  resolve(opts.outputRoot, "story_catalog.json"),
  JSON.stringify(emitStoryCatalog(storyCatalog, scenes), null, 2) + "\n",
);
```

- [ ] **Step 7: Run compiler verification**

```bash
rtk bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/parser-story-catalog.test.ts packages/scripts/compile-scenes/story-catalog.test.ts packages/scripts/compile-scenes/emitter.test.ts packages/scripts/compile-scenes/validator.test.ts packages/scripts/compile-scenes.test.ts
rtk bun run check:scripts
rtk bun run scenes:compile
```

Expected: all focused tests pass, strict script type-checking exits 0, and live
Chapter 1 compilation emits an empty version-1 `story_catalog.json` without
requiring authored production content.

- [ ] **Step 8: Commit the compiler integration**

```bash
rtk git add packages/scripts/compile-scenes packages/scripts/compile-scenes.test.ts
rtk git commit -m "feat: compile global story catalog"
```

---

### Task 3: Load and validate the immutable Rust story catalog

**Files:**

- Create: `apps/game/src-tauri/src/game/story/mod.rs`
- Create: `apps/game/src-tauri/src/game/story/catalog.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`
- Modify: `apps/game/src-tauri/src/game/test_support.rs`

**Interfaces:**

- Consumes: `resources_dir.join("story_catalog.json")`.
- Produces:

```rust
pub(in crate::game) struct StoryCatalog;

impl StoryCatalog {
    pub(in crate::game) fn load(resources_dir: &Path) -> Result<Self, GameError>;
    pub(in crate::game) fn empty() -> Self;
}
```

The catalog exposes read-only lookup/order methods for the mutation and view
tasks: `fact`, `question`, `objective`, `authorization`,
`contains_inventory_target`, and iterators in public-view order.

- [ ] **Step 1: Write failing catalog loader tests**

Inside `story/catalog.rs`, add tests for empty and populated version-1 JSON,
missing/unreadable JSON, malformed JSON, unsupported schema version, duplicate
per-kind IDs, unresolved question facts, invalid objective kind, and duplicate
evidence/statement indexes.

Assert typed errors by code, for example:

```rust
let error = StoryCatalog::load(dir.path()).unwrap_err();
assert_eq!(error.code, "storyCatalogLoadFailed");
```

- [ ] **Step 2: Run the catalog tests and confirm the red state**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml story::catalog::tests
```

Expected: FAIL because the `story` module and loader do not exist.

- [ ] **Step 3: Implement the versioned JSON loader and immutable indexes**

Define private Serde JSON structs mirroring `StoryCatalogJson`. Reject every
schema version other than `1`. Preserve catalog arrays for view order and build
`BTreeMap`/`HashMap` lookup indexes without duplicating mutable progress.
Validate all cross-references before returning `StoryCatalog`.

Add focused `GameError` constructors for catalog load, version, and validation
failures. Error messages must include the resource path or conflicting ID.

- [ ] **Step 4: Make shared runtime fixtures emit the required empty catalog**

Add a single helper in `test_support.rs`:

```rust
pub fn write_empty_story_catalog(dir: &Path) {
    std::fs::write(
        dir.join("story_catalog.json"),
        r#"{
  "schemaVersion": 1,
  "facts": [],
  "questions": [],
  "objectives": [],
  "authorizations": [],
  "evidenceIndex": [],
  "statementsIndex": []
}
"#,
    )
    .unwrap();
}
```

Call it from the central resource-fixture constructors so existing
`GameEngine::new_started` tests remain explicit about the new required file.

- [ ] **Step 5: Load the catalog before the initial scene**

Register `mod story;`, add immutable `story_catalog: StoryCatalog` to
`GameEngine`, and call `StoryCatalog::load(&resources_dir)` after loading
chapters but before loading/priming the initial scene. A failure must prevent
engine construction.

- [ ] **Step 6: Run focused and full Rust tests**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml story::catalog::tests
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
```

Expected: catalog tests and the pre-existing Rust suite pass.

- [ ] **Step 7: Commit the catalog loader**

```bash
rtk git add apps/game/src-tauri/src/game/story apps/game/src-tauri/src/game/mod.rs apps/game/src-tauri/src/game/error.rs apps/game/src-tauri/src/game/test_support.rs
rtk git commit -m "feat: load immutable story catalog"
```

---

### Task 4: Implement validated sparse story state and mutations

**Files:**

- Create: `apps/game/src-tauri/src/game/story/state.rs`
- Create: `apps/game/src-tauri/src/game/story/mutations.rs`
- Modify: `apps/game/src-tauri/src/game/story/mod.rs`
- Modify: `apps/game/src-tauri/src/game/schema.rs`
- Modify: `apps/game/src-tauri/src/game/error.rs`

**Interfaces:**

- Consumes: immutable `StoryCatalog` lookups and existing
  `schema::InventoryTarget`.
- Produces the exact progress, origin, snapshot, `MutationOutcome`, and mutation
  method signatures from design §§7–8.

- [ ] **Step 1: Add ordering to the existing inventory target**

Extend `InventoryTarget` derives with `PartialOrd, Ord` and add a serialization
test proving its existing wire shape remains `{ "kind": "evidence" |
"statement", "id": "record_1" }`.

- [ ] **Step 2: Write failing state/snapshot tests**

Cover empty snapshot output, populated round-trip through
`StoryState::from_snapshot`, structural serialization of every
`StoryEventBlockKind`, and rejection of:

- unknown progress-map keys;
- unknown supporting records/facts;
- unasserted supporting facts;
- a question resolved by an unknown, unasserted, or non-candidate fact;
- mismatched origin-derived chapter/scene fields;
- malformed origin IDs;
- active primary missing, secondary, absent from progress, or completed.

For every rejection, keep the input snapshot available and assert no live
`StoryState` is returned.

- [ ] **Step 3: Implement live and snapshot state**

Define live progress fields without `Deserialize`. Define separate
camelCase snapshot structs with `Serialize`/`Deserialize`. Implement
`StoryState::snapshot` as a lossless clone into snapshot types and
`StoryState::from_snapshot` as a validate-then-construct join.

Use this exact origin Serde contract:

```rust
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
```

Re-derive nullable chapter/scene values from each origin and reject snapshots
whose stored values disagree.

- [ ] **Step 4: Run snapshot tests and confirm they pass**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml story::state::tests
```

Expected: PASS.

- [ ] **Step 5: Write failing mutation tests before each mutation family**

Add tests in `mutations.rs` for:

- fact assertion, support union, direct-support validation, first-origin
  preservation, same-input no-op, and failed-request byte equality;
- question reveal, valid resolution, same-resolver no-op, and different
  candidate resolver rejection;
- objective reveal/complete and every row of the primary transition table;
- authorization grant, same/different-origin repeat no-op, and migration-null
  location;
- unknown definition/support IDs for every applicable method.

Capture `let before = state.snapshot();` before every expected error and assert
`state.snapshot() == before`.

- [ ] **Step 6: Implement all seven crate-internal mutation methods**

Use the exact signatures from design §7.3. For each method:

1. resolve all definitions and support IDs;
2. validate origin structure and derive its nullable location;
3. validate the complete cross-field transition;
4. construct cloned candidate progress/maps;
5. replace live fields only after validation succeeds;
6. compare before/after to return `Changed` or `Unchanged`.

`resolve_question` stores the applied fact ID. A different resolver after
resolution is an error. `set_primary_objective` implements the full eight-row
table and remains the sole primary transition implementation.

- [ ] **Step 7: Run mutation tests and Rust lint**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml story::mutations::tests
rtk bun run rust:lint
```

Expected: all mutation tests pass and Clippy exits 0 with warnings denied.

- [ ] **Step 8: Commit state and mutations**

```bash
rtk git add apps/game/src-tauri/src/game/story apps/game/src-tauri/src/game/schema.rs apps/game/src-tauri/src/game/error.rs
rtk git commit -m "feat: add durable story state mutations"
```

---

### Task 5: Integrate rollback and the filtered Rust public view

**Files:**

- Create: `apps/game/src-tauri/src/game/story/view.rs`
- Modify: `apps/game/src-tauri/src/game/story/mod.rs`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Modify: `apps/game/src-tauri/src/game/command_tx.rs`
- Modify: `apps/game/src-tauri/src/game/view.rs`

**Interfaces:**

- Consumes: `StoryCatalog`, live `StoryState`, and immutable definition order.
- Produces: `StoryStateView`, `FactView`, `QuestionView`, `ObjectiveView`, and
  `AuthorizationView` with the exact camelCase wire fields from design §9.

- [ ] **Step 1: Write failing filtered-view tests**

Create a populated catalog and state, leaving at least one definition of every
kind untouched. Assert:

- untouched definitions are absent;
- open questions expose null `resolvedByFactId`;
- resolved questions expose only the applied resolver;
- no candidate resolver list is serialized;
- objectives sort by `(sortOrder, id)` and mark exactly the active primary;
- facts/questions/authorizations follow catalog order;
- supports use deterministic order;
- migration origins expose null chapter/scene.

- [ ] **Step 2: Run view tests and confirm the red state**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml story::view::tests
```

Expected: FAIL because story view structs/building do not exist.

- [ ] **Step 3: Implement the infallible catalog/state join**

Build each array by iterating immutable catalog order and selecting matching
progress entries. Compute `status`, `resolved_by_fact_id`, `completed`, and
`active_primary` from validated state. Do not use fallible lookups or expose
locked definitions/rules.

- [ ] **Step 4: Add state ownership and rollback classification**

Initialize `story_state: StoryState::default()` in `GameEngine::new_started`.
Update both exhaustive `GameEngine` destructures in `command_tx.rs`:

- bind `story_catalog: _` as immutable-after-load;
- clone `story_state` into `EngineRollbackSnapshot`;
- restore `story_state` symmetrically.

Add an engine test that mutates story state inside `rollback_scope`, returns a
forced error, and asserts the snapshot and view are restored.
Add a second engine test that asserts a fact, navigates to another scene and
chapter with the existing debug navigation seam, and confirms the same story
snapshot remains installed.

- [ ] **Step 5: Add the always-present story view to `GameStateView`**

Extend the Rust struct with `pub story: StoryStateView` and update
`GameEngine::view()` to call the infallible story-view builder. Assert a newly
started engine serializes:

```json
{
  "story": {
    "facts": [],
    "questions": [],
    "objectives": [],
    "authorizations": []
  }
}
```

- [ ] **Step 6: Pin foundation-only APIs with direct tests**

Ensure tests directly call all seven mutations,
`validateSetPrimaryObjectiveTarget`, the qualified board helper, both snapshot
directions, and serialization of every `StoryEventBlockKind`. These tests are
required even though HPA-257/HPA-259/HPA-129 are the first production
consumers.

- [ ] **Step 7: Run Rust verification**

```bash
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
rtk bun run rust:lint
```

Expected: the full Rust suite and warnings-denied Clippy pass.

- [ ] **Step 8: Commit engine integration**

```bash
rtk git add apps/game/src-tauri/src/game
rtk git commit -m "feat: expose rollback-safe story state"
```

---

### Task 6: Mirror the story view in TypeScript and update every fixture

**Files:**

- Modify: `apps/game/src/lib/state/types.ts`
- Modify: `apps/game/src/routes/page.test.ts`
- Modify: `apps/game/src/lib/components/GameShell.test.ts`
- Modify: `apps/game/src/lib/audio/sfx-events.test.ts`
- Modify: `apps/game/src/lib/components/SceneNavigationPanel.test.ts`
- Modify: `apps/game/src/lib/state/game-client-source.test.ts`
- Modify: `apps/game/src/lib/state/acquisition-notifications.test.ts`

**Interfaces:**

- Consumes: Rust camelCase `StoryStateView`.
- Produces: exact TypeScript types from design §9 and an always-present
  `GameStateView.story`.

- [ ] **Step 1: Add the exact TypeScript story view types**

Copy the design §9 aliases verbatim into `state/types.ts`: `StoryStateView`,
four entry views, `AssertionOrigin`, `StoryEventBlockKind`, and
`InventoryTarget`. Add `story: StoryStateView` to `GameStateView`.

- [ ] **Step 2: Run frontend type-checking and confirm the fixture breakage**

```bash
rtk bun run check
```

Expected: FAIL at hand-built `GameStateView` values missing required `story`.

- [ ] **Step 3: Update the complete fixture inventory**

Confirm the inventory:

```bash
rtk rg -l "GameStateView" apps/game/src --glob "*.test.ts"
rtk rg -l "dialogueHistory:" apps/game/src --glob "*.test.ts"
```

Both searches must resolve to the six test files in this task header, with each
file counted once. Add this exact value to every complete state fixture:

```ts
story: {
  facts: [],
  questions: [],
  objectives: [],
  authorizations: [],
},
```

- [ ] **Step 4: Add a source-contract test for resolver privacy**

In `game-client-source.test.ts`, construct a resolved question containing
`resolvedByFactId` and assert the client accepts it. Add a source assertion that
the public type has no `resolvedByFactIds` property.

- [ ] **Step 5: Run frontend verification**

```bash
rtk bun run check
rtk bun run --cwd apps/game test
```

Expected: Svelte/TypeScript checks and the game Vitest suite pass with no new
UI rendered.

- [ ] **Step 6: Commit the frontend contract**

```bash
rtk git add apps/game/src/lib/state/types.ts apps/game/src/routes/page.test.ts apps/game/src/lib
rtk git commit -m "feat: mirror story state view"
```

---

### Task 7: Document the generated-resource requirement and run the completion gate

**Files:**

- Modify: `CLAUDE.md`

**Interfaces:**

- Consumes: completed compiler/runtime/frontend slices.
- Produces: repository guidance and final verification evidence.

- [ ] **Step 1: Update repository guidance**

In the Scene Pipeline and command guidance, state that
`story_catalog.json` is always compiler-generated and required at runtime.
Document the stale-tree remedy exactly:

```bash
bun run scenes:compile
```

Do not edit `AGENTS.md` separately because it is a symlink to `CLAUDE.md`.

- [ ] **Step 2: Run the focused cross-stack regression set**

```bash
rtk bunx vitest run --config vitest.scripts.config.ts packages/scripts/compile-scenes/parser-story-catalog.test.ts packages/scripts/compile-scenes/story-catalog.test.ts packages/scripts/compile-scenes/emitter.test.ts packages/scripts/compile-scenes/validator.test.ts packages/scripts/compile-scenes.test.ts
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml story
rtk bun run --cwd apps/game test
```

Expected: all focused compiler, story-runtime, and frontend tests pass.

- [ ] **Step 3: Run the complete design gate**

```bash
rtk bun run scenes:compile
rtk bun run check:scripts
rtk cargo test --manifest-path apps/game/src-tauri/Cargo.toml
rtk bun run check
rtk bun run test
rtk bun run lint:all
```

Expected: every command exits 0. Packaged E2E is intentionally omitted because
HPA-255 adds no player-facing interaction.

- [ ] **Step 4: Audit scope and generated files**

```bash
rtk git status --short
rtk git diff --check
rtk git diff --stat
```

Expected: only source, tests, the focused plan/spec, and `CLAUDE.md` changes are
present. Generated resource JSON remains ignored and unstaged. No production
`story_catalog.md` exists.

- [ ] **Step 5: Commit documentation and final verification fixes**

```bash
rtk git add CLAUDE.md
rtk git commit -m "docs: explain generated story catalog"
```

- [ ] **Step 6: Request final whole-branch review**

Review the complete branch against the design, fix only verified findings, and
repeat the affected focused command plus the complete gate before claiming the
implementation complete.
