# HPA-258 Case File, Primary Objective, Authorizations, and Continue Recap Design

**Status:** Revised after two technical reviews; ready for repository review  
**Issue:** HPA-258 — Build case file, primary objective, authorizations, and Continue recap UI  
**Parent:** HPA-254 — Detective gameplay systems program  
**Milestone:** P0 — Persistence and Story State  
**Date:** 2026-07-30  
**Review revision:** 2026-07-31, second technical pass

## 1. References and scope

This focused design refines:

- `docs/superpowers/specs/2026-07-19-detective-gameplay-systems-design.md`
  §§11, 16, 17, and 24;
- `docs/superpowers/plans/2026-07-19-detective-gameplay-systems-implementation-plan.md`
  epic P0.5;
- `docs/superpowers/specs/2026-07-24-hpa-255-global-story-catalog-and-state-design.md`;
- `docs/superpowers/specs/2026-07-29-hpa-256-case-record-provenance-and-support-lineage-design.md`;
- `docs/superpowers/specs/2026-07-25-hpa-129-save-load-autosave-continue-design.md`,
  as superseded and expanded by the HPA-392 persistence implementation;
- the approved narrative precedence in the program design:
  Chapter 1 Final Writing Plan V3.7, Chapter 2 Plan V0.7, Story Bible V6.5
  Canon Sync Patch, then Story Bible V6.4.

HPA-255, HPA-256, and HPA-129/HPA-392 are complete. HPA-258 consumes their
existing catalog, durable story-state, provenance, redaction, save-slot, and
Continue contracts rather than creating replacements.

HPA-258 delivers:

- one spoiler-safe Case File inside the existing Escape-menu stack;
- fixed sections for current objectives, evidence, statements, established
  facts, questions, and granted authorizations;
- provenance, proof-limit, source-group, acquisition-origin, support, and
  supersession presentation without exposing locked definitions;
- existing evidence and statement re-examination from the new Case File;
- one compact active-primary-objective HUD during gameplay;
- authored scene summaries in the compiler/runtime contract;
- richer save and Continue recap copy using authored chapter, scene, and
  objective summaries;
- an explicit save-envelope schema v2 with a real v1-to-v2 migration;
- keyboard, screen-reader, focus, Escape, inert, and 1280×720 coverage.

HPA-258 does not implement analysis scenes, analysis answers, request-readiness
rules, new story-state mutation kinds, people or location archives, or Chapter
1 Beat 8.5 progression. Those remain owned by their existing P1/P2 tickets.

## 2. Review-resolution decisions

Two focused technical reviews produced the following binding decisions.

1. **Kind-qualified supersession remains the existing contract.**
   `supersedesRecordId` is a string-encoded typed target such as
   `evidence:verified_clip` or `statement:witness_revision`; it is not a bare
   record slug. HPA-256 validates the encoded kind and Rust preserves it when
   redacting an unacquired predecessor. HPA-258 does not add cross-kind slug
   uniqueness and does not replace the field with a second object shape.
2. **Rust remains fail-closed for authoritative catalog/state failures.**
   `GameEngine::view()` already returns `Result<GameStateView, GameError>`.
   HPA-258 does require a new inner signature change:
   `StoryStateView::from_catalog_state` becomes fallible because it now resolves
   story origins through packaged location data, and `GameEngine::view()`
   propagates that result with `?`.
3. **Source-group absence is rejected before view construction.**
   Catalog loading already validates both directions of the source-group
   projection, and inventory view construction already validates inventory
   provenance against the catalog. An unresolved non-null group is therefore
   not an ordinary constructible view-time scenario. The view projection keeps
   a defense-in-depth invariant check, while acceptance coverage belongs to
   catalog/provenance validation rather than a fabricated public runtime path.
4. **Origin lookup is cached.** A read-only `StoryLocationIndex` is built once
   from packaged chapter/scene definitions and retained on `GameEngine`; it is
   never rebuilt on each `view()` call.
5. **Scene summaries use the tokenizer’s list-metadata syntax.** The authored
   form is `- **Summary:** ...`, not the dash-less chapter-manifest form.
   Dash-less `**Summary:** ...` is invalid for scene files.
6. **Linear scenes receive an explicit summary carve-out.** A shared scene
   header helper consumes the one allowed top-level `Summary` token immediately
   after H1 before `parser-linear.ts` applies its existing blanket rejection to
   every other top-level metadata token. Scene-tag asset metadata remains
   unchanged.
7. **`@lyra/scene-types` remains a shared-subset package, not the complete
   runtime scene schema.** Scene `summary` is runtime semantic metadata used by
   compiler, Rust, save capture, and frontend gameplay. The layout editor does
   not consume it, so it stays outside the shared package unless a later editor
   feature needs a byte-identical shared `SceneMetadata` atom.
8. **Existing save types are named explicitly.** The current unsuffixed Rust
   `SaveSummary` is renamed to `SaveSummaryV1`; `SaveEnvelopeV1` continues to
   contain it. HPA-258 adds `SaveSummaryV2` and `SaveEnvelopeV2`, bumps
   `SAVE_SCHEMA_VERSION` to 2, and routes both versions through the migration
   registry.
9. **Both public save-metadata projections move to V2.** Valid
   `SaveMetadataView.summary` and optional
   `ReadableSaveMetadataView.summary` expose `SaveSummaryV2` after decoding or
   migration. Frontend mirrors use the same nullable V2 recap fields.
10. **PR-B save incompatibility is intentional.** Adding scene summaries
    changes the canonical semantic bundle and therefore `contentRevision`.
    Pre-release saves produced against the old package remain incompatible even
    though the v1 envelope has a valid schema migration.
11. **Populated packaged-story acceptance remains HPA-265/HPA-266-owned.**
    HPA-258 uses synthetic compiler/Rust/frontend fixtures for all populated
    Case File states. Its packaged E2E verifies the currently authored package,
    menu/accessibility boundaries, and recap surfaces. The real Chapter 1
    supersession/objective/authorization/save-resume path lands later in the
    Chapter 1 vertical slice and packaged acceptance gate.
12. **The production E2E coupling point is part of PR A.** Renaming
    `物證檔案` to `案件檔案` requires updating
    `apps/game/e2e-tauri/production-anchors.ts` and every WDIO use of its old
    evidence-menu anchors in the same PR.
13. **Acquired records receive resolved location copy.** Evidence and statement
    public views gain `acquisitionContext: SceneLocationContextView`, so the
    Case File never renders raw chapter or scene slugs as player-facing prose.
14. **Cross-kind supersession is explicitly legal.** The synthetic fixture
    includes an acquired chain crossing evidence/statement kinds and proves the
    encoded kind controls navigation.
15. `summaryAuthored` is compiler-internal audit state and is never emitted.
16. Case File key normalization is specified once in §7 and reused everywhere.

## 3. Approved product decisions

1. The Case File is a read model over existing `GameStateView.inventory` and
   `GameStateView.story`. It is not another durable store.
2. Rust remains authoritative for definition visibility, acquired-record
   redaction, source-group resolution, and valid story origins.
3. Svelte may group, order, and navigate already-public values. It must not
   infer hidden definitions, mutation rules, answer keys, or internal support.
4. The existing Escape-menu Evidence submenu becomes one Case File submenu.
   HPA-258 adds neither a second modal nor a new top-level IPC workflow.
5. The Case File has six fixed MVP sections:
   Current Objective, Evidence, Statements, Established Facts, Questions, and
   Authorizations.
6. The fixed shell is intentionally not a generic archive-plugin registry.
   People, locations, chronology, social-media archives, and cross-case
   timelines remain deferred to HPA-274/P4.
7. Locked and untouched catalog definitions are absent from the public view,
   DOM, section counts, accessible names, empty-state copy, and relationship
   navigation.
8. Legacy all-neutral provenance produces no new metadata labels, chips, or
   “unspecified” rows.
9. A public `null` or empty array is never presented as proof that no hidden
   predecessor, successor, or supporting record exists.
10. Acquired supersession navigation is derived from acquired public records.
    Rust’s catalog owns a full `successor_by_target` index, but that index may
    name a future unacquired successor and therefore cannot be projected
    directly. The already-public acquired records plus HPA-256’s redacted
    predecessor edges are sufficient to reverse into a unique acquired-only
    successor map without adding another wire field or a second redaction path.
11. Facts remain conclusions. They are never converted to `InventoryTarget`,
    never offered as physical evidence, and never sent to a presentation or
    re-examination command.
12. Direct supporting records and facts are shown. A free-form or transitive
    evidence graph is out of scope.
13. The active primary objective is visually dominant. Incomplete secondary
    objectives and recently completed objectives remain subordinate.
14. Inactive, incomplete primary objectives are hidden. The single
    active-primary scalar is the only current primary objective.
15. “Recently completed” uses authored objective `sortOrder`, descending, with
    stable ID tie-breaking. HPA-258 does not add completion timestamps.
16. The Current Objective section initially shows the three latest completed
    objectives and offers an explicit disclosure for earlier completed items.
17. `AuthorizationDefinition.summary` is the player-facing description of the
    access or procedure that the authorization permits. HPA-258 does not add a
    duplicate `unlockSummary` field.
18. Cross-chapter question wording remains fully author-owned, neutral, and
    unmarked as a spoiler.
19. The primary-objective HUD is compact and non-interactive. The full summary
    remains in the Case File.
20. Scene recap copy is authored. No LLM-generated or runtime-generated prose is
    required.
21. Every currently supported scene type gains one static `summary` value.
    Existing legacy fixtures may compile through a deterministic title
    fallback, while production Chapter 1 is backfilled with authored summaries.
    HPA-259 adopts the same field for analysis scenes.
22. Scene-summary changes are static semantic-content changes and therefore
    change the package-wide `contentRevision`.
23. Save and Continue cards retain the authored recap copy that belonged to the
    save. They do not join an old save to current packaged prose.
24. The save envelope advances to schema version 2. The mutable gameplay
    snapshot remains `SaveSnapshotV1` because HPA-258 changes recap metadata,
    not gameplay progress.
25. The v1-to-v2 migration preserves existing IDs, titles, labels, and snapshot
    state and sets newly introduced recap-summary fields to `null`.
26. The migration never fabricates chapter, scene, or objective summaries from
    the currently installed package.
27. New saves always write schema v2 and populate every recap field available
    from current packaged definitions.
28. Continue keeps HPA-392 semantics: it targets the newest written save and
    stops on that save’s diagnostic if invalid. HPA-258 adds recap presentation
    but no fallback.
29. Save Browser and title Continue reuse one textual recap component.
    Thumbnail ownership remains in `SaveCard`; the title screen does not perform
    a second thumbnail fetch.
30. Player-facing HPA-258 copy and accessible labels use canonical Traditional
    Chinese. Existing decorative English labels may remain.
31. Case File navigation state is frontend-local and session-local. It is not
    saved.
32. The last selected Case File section survives closing and reopening the
    Escape menu during one mounted game session. Selected records do not have
    to survive load, new game, or return to title.
33. Game-complete presentation keeps the current evidence-menu boundary: the
    Case File is unavailable after `gameComplete`.
34. HPA-258 adds no production Tauri command. Existing game-state and
    persistence command results carry the required data.
35. Implementation lands as two reviewable PRs under HPA-258: Case File/HUD,
    then authored recap/save-v2/Continue.

## 4. Current repository baseline

### 4.1 Public story and inventory state

The current Rust `GameStateView` already exposes:

```text
GameStateView
├── inventory
│   ├── evidence[]
│   └── statements[]
└── story
    ├── facts[]
    ├── questions[]
    ├── objectives[]
    └── authorizations[]
```

HPA-255 filters untouched definitions. HPA-256 guarantees that:

- acquired evidence and statements retain acquisition order;
- immutable provenance rejoins through the catalog;
- an unacquired predecessor is redacted from public provenance;
- `supersedesRecordId`, when present, is a kind-qualified encoded target;
- public fact support contains acquired direct supporting records only;
- empty public support does not prove internal support is empty;
- the catalog owns source-group definitions and non-branching
  predecessor/successor indexes.

The frontend mirrors these values in `apps/game/src/lib/state/types.ts`.

### 4.2 Current Evidence submenu

`InventoryPanel.svelte` renders acquired evidence and statements inside the
Escape menu. It preserves acquisition order, resolves optional evidence images,
enables re-examination only in exploration and interrogation modes, and closes
the menu after re-examination installs dialogue.

`GameShell.svelte` already owns:

- the root menu and submenu stack;
- one-layer-per-Escape behavior;
- focus capture and restoration;
- submenu-back focus restoration;
- focus trapping;
- top-layer inert behavior for persistence and other overlays.

The packaged E2E coupling file currently pins `物證檔案` through both an entry
and panel anchor. HPA-258 reuses the menu mechanisms and updates that coupling
point as part of the rename.

### 4.3 Current objective and save metadata

The public objective view already includes immutable label, summary, kind,
`sortOrder`, completed state, and one `activePrimary` flag derived from the
scalar active-primary ID.

Rust save capture already records chapter ID/title, scene ID/title, and active
primary objective ID/label. Save UI already displays slot/save type, chapter,
scene, primary-objective label, save time, optional thumbnail, and invalid-save
diagnostics.

Both valid `SaveMetadataView` and partially readable invalid
`ReadableSaveMetadataView` currently embed the unsuffixed `SaveSummary` shape.

### 4.4 Current authored scene/token contract

Chapter manifests use a hand-written line scanner and accept dash-less
`**Summary:**` copy. Scene files do not use that parser.

All three current scene parsers call the shared tokenizer. Its metadata grammar
is the list form:

```markdown
- **Key:** value
```

A dash-less scene line such as `**Summary:** text` is neither metadata nor
full-width-colon dialogue and becomes an unknown token. In addition,
`parser-linear.ts` currently rejects every top-level metadata token before
handling scene-tag-local asset metadata. HPA-258 must therefore add an explicit
header-summary consumption seam; merely adding a field to AST types is
insufficient.

### 4.5 Current save and view fallibility

The current disk envelope is schema version 1 and contains an unsuffixed
`SaveSummary` plus `SaveSnapshotV1`. The migration registry recognizes only the
current version.

`GameEngine::view()` already returns `Result<GameStateView, GameError>` because
inventory/catalog disagreement is an authoritative invariant failure. However,
`StoryStateView::from_catalog_state` is currently infallible and its production
caller does not use `?`. HPA-258 extends the existing outer fail-closed boundary
by making that inner constructor fallible when it resolves story origins.

### 4.6 Existing source-group validation gates

Before any public record view is built:

1. catalog loading validates that every group member names the group and every
   non-null record `sourceGroupId` resolves back to a group containing that
   typed record;
2. inventory public-view construction validates that the acquired record’s
   immutable provenance equals its catalog definition.

A missing group is therefore rejected at catalog load or definition comparison,
not discovered as a normal Case File rendering condition.

## 5. Ownership and architecture

### 5.1 One-directional flow

```text
Authored Markdown
    ↓
Compiler AST and emitted scene JSON
    ↓
Rust packaged definitions + durable state
    ↓
Spoiler-safe GameStateView / save metadata
    ↓
Pure frontend Case File and recap presentation
```

The Case File never reads generated JSON directly. Svelte never loads
`story_catalog.json`, reconstructs locked catalog entries, or resolves immutable
definitions outside Rust’s public view.

### 5.2 No parallel Case File state

There is no serializable `CaseFileState`, Case File IPC command, or Case File
cache on disk.

The only frontend-local state is presentation state:

```ts
type CaseFileSection =
  | "objective"
  | "evidence"
  | "statements"
  | "facts"
  | "questions"
  | "authorizations";

type CaseFileNavigationState = {
  section: CaseFileSection;
  selectedKey: CaseFileKey | null;
  backTarget: {
    section: CaseFileSection;
    selectedKey: CaseFileKey | null;
  } | null;
};
```

`section` is hoisted to `+page.svelte` so it survives Escape-menu
close/reopen. A fresh game session defaults to `objective`; load, new game, and
return to title reset it. Selection resets when the target no longer exists
after state replacement.

### 5.3 Immutable cached location resolver

HPA-258 adds an immutable runtime helper:

```rust
struct StoryLocationIndex {
    chapters: HashMap<String, ChapterLocation>,
    scenes: HashMap<(String, String), SceneLocation>,
}
```

It is built once from validated packaged chapter and scene definitions during
`GameEngine::new_started` and candidate-engine restoration. It is retained on
`GameEngine` as immutable package-derived state.

Rules:

- `GameEngine::view()` performs no scene-file I/O for origin presentation.
- `GameEngine::view()` does not rebuild or clone the complete index.
- inventory and story view builders borrow `&StoryLocationIndex`.
- save capture classifies the index as immutable package state and does not
  serialize it.
- restore rebuilds it from the already compatibility-checked package.
- a missing scene named by an acquired record or non-migration origin is an
  authoritative typed invariant failure.

Required signatures:

```rust
impl InventoryView {
    fn from_inventory(
        catalog: &StoryCatalog,
        inventory: &Inventory,
        locations: &StoryLocationIndex,
    ) -> Result<Self, GameError>;
}

impl StoryStateView {
    fn from_catalog_state(
        catalog: &StoryCatalog,
        state: &StoryState,
        acquired_targets: &BTreeSet<InventoryTarget>,
        locations: &StoryLocationIndex,
    ) -> Result<Self, GameError>;
}
```

`GameEngine::view()` calls both with `?`. Existing direct unit-test callers are
updated to provide the index and unwrap or assert the expected error.

A later refactor may share this index with scene navigation, but HPA-258 does
not require unrelated navigation rewrites.

### 5.4 Shared-type boundary

`@lyra/scene-types` is the source of truth for values that are byte-identical
and consumed by both compiler and layout editor: chapters index, layout atoms,
reveal targets, and similar shared subsets. It is deliberately not the complete
runtime scene schema; full compiler scene JSON and the layout editor’s local
`InvestigationSceneJson` already differ intentionally.

Scene `summary` belongs to:

- compiler AST and emitted full scene JSON;
- package content hashing;
- Rust scene serde/domain values;
- `SceneView` and save recap capture;
- frontend gameplay types.

The layout editor does not display or mutate scene summaries, so adding the
field to its deliberately narrower structural view provides no shared contract
value. PR B updates repository guidance/comments to state this shared-subset
boundary explicitly. If a later editor feature consumes scene summary, that
feature may introduce a shared `SceneMetadata` atom then.

### 5.5 Focused modules

Recommended frontend boundaries:

```text
apps/game/src/lib/case-file/
  case-file-model.ts
  case-file-model.test.ts
  labels.ts
  types.ts

apps/game/src/lib/components/case-file/
  CaseFilePanel.svelte
  CaseFileSectionNav.svelte
  CaseFileItemList.svelte
  CaseFileRecordDetail.svelte
  CaseFileFactDetail.svelte
  CaseFileQuestionDetail.svelte
  CaseFileAuthorizationDetail.svelte
  CaseFileObjectiveSection.svelte

apps/game/src/lib/components/
  PrimaryObjectiveHud.svelte
  SaveRecapDetails.svelte
```

Recommended Rust changes stay inside existing view, story, navigation/package,
and save boundaries:

```text
apps/game/src-tauri/src/game/
  mod.rs
  view.rs
  story/view.rs
  navigation.rs or a focused story_location.rs
  save/schema.rs
  save/capture.rs
  save/migrations.rs
  save/storage.rs
  save/restore.rs
```

Compiler changes remain under `packages/scripts/compile-scenes/`.

## 6. Public-view refinements

### 6.1 Shared location context and acquired-record projection

Add one resolved location shape:

```ts
type SceneLocationContextView = {
  chapterId: string;
  chapterTitle: string;
  sceneId: string;
  sceneTitle: string;
};
```

Both public record views retain their existing stable IDs and gain resolved
player-facing context:

```ts
type EvidenceRecord = {
  // existing fields, including collectedInChapterId/collectedInSceneId
  acquisitionContext: SceneLocationContextView;
  sourceGroup: SourceGroupReferenceView | null;
};

type StatementRecord = {
  // existing fields, including acquiredInChapterId/acquiredInSceneId
  acquisitionContext: SceneLocationContextView;
  sourceGroup: SourceGroupReferenceView | null;
};
```

Rules:

- raw location IDs remain available for stable identity and command logic;
- player-facing copy uses `acquisitionContext`, never raw slugs;
- context resolves through the cached immutable `StoryLocationIndex`;
- a missing location is a typed whole-view invariant failure;
- the projection exposes no locked record or unrelated scene information.

### 6.2 Resolved source-group presentation

The frontend cannot safely resolve a source-group slug to authored copy. Add an
acquired-record-only projection:

```ts
type SourceGroupReferenceView = {
  id: string;
  label: string;
  summary: string;
};
```

Rules:

- it is resolved only for the acquired record being serialized;
- it exposes no membership list;
- null `sourceGroupId` produces null projection;
- catalog loading already proves every non-null ID resolves and membership is
  bidirectionally consistent;
- inventory definition validation already proves the acquired record carries
  the catalog provenance;
- projection may retain a defense-in-depth typed internal error if an impossible
  invalid catalog is injected, but this is not a normal runtime acceptance path;
- `provenance.sourceGroupId` remains in the canonical provenance projection;
- display prefers record-specific `sourceLabel`, then source-group label;
- source-group summary appears in details, not every compact row.

### 6.3 Origin context and explicit fallibility

Add a display projection without replacing exact `AssertionOrigin`:

```ts
type OriginContextView =
  | {
      type: "scene";
      originKind: "sceneEvent" | "analysisBoard";
      location: SceneLocationContextView;
    }
  | { type: "migration" };
```

`FactView` and `AuthorizationView` gain `originContext`.

Rules:

- `firstOrigin` remains the exact structured origin;
- scene and future analysis-board origins resolve through the cached immutable
  `StoryLocationIndex`;
- migration origins are a valid explicit domain variant and display neutral
  localized copy such as `已匯入的進度`;
- missing packaged chapter/scene context is a typed whole-view failure;
- HPA-258 does not resolve hotspot, topic, testimony-line, or board labels;
- `StoryStateView::from_catalog_state` changes from `Self` to
  `Result<Self, GameError>`;
- `GameEngine::view()` propagates it with `?`.

### 6.4 Fail-closed Rust, defensive frontend

Rust and Svelte have different trust responsibilities:

- Rust owns validated content and durable state. It must fail closed if an
  acquired location or scene origin cannot be resolved.
- Source-group referential integrity is normally rejected earlier at catalog
  load/inventory validation; any later failure is defense-in-depth only.
- Svelte consumes a wire value. Its pure model may skip a malformed relation,
  retain the current item, and surface a non-spoiling generic detail error so a
  hand-built test fixture or stale browser state does not crash the menu.
- Frontend defensive behavior does not make malformed Rust output acceptable.
- No per-record neutral Rust fallback is added for corrupted authoritative
  origins. Doing so could misstate where a fact was established or who granted
  an authorization.

Tests cover the actual boundaries: catalog validation for source groups, a typed
Rust origin/location resolution error, and non-crashing frontend handling of an
impossible malformed relation fixture.

### 6.5 Scene summaries in public views

Every current `SceneView` variant gains:

```ts
summary: string;
```

The summary comes from the validated packaged scene definition and is also
available to save capture through the current scene identity.

### 6.6 Supersession contract

The existing HPA-256 public field remains:

```ts
type EncodedInventoryTarget =
  | `evidence:${string}`
  | `statement:${string}`;

type CaseRecordProvenance = {
  // existing fields
  supersedesRecordId: EncodedInventoryTarget | null;
};
```

The runtime TypeScript annotation narrows the current `string | null` wire to
this semantic alias; the JSON representation remains a string.

Rules:

- evidence and statement slugs are not required to be cross-kind unique;
- the encoded kind is mandatory and validated at compiler and Rust boundaries;
- public redaction clears the complete encoded target when the predecessor is
  unacquired;
- the frontend parses the kind-qualified value before building a reverse map;
- malformed values are ignored defensively by Svelte but are invalid Rust wire;
- tests include evidence and statement records sharing the same slug and prove
  their keys do not collide;
- a synthetic acquired cross-kind chain is required and proves successor
  navigation follows the encoded kind rather than slug alone.

No new successor field is emitted. Rust’s full catalog successor accessor is
not itself safe public copy because it may identify an unacquired successor.
For acquired records, Svelte reverses only visible predecessor edges into a
unique acquired successor map. HPA-256 guarantees the full catalog chain is
non-branching, and the acquired public subset cannot introduce a branch.

## 7. Case File key normalization

All selection and relation navigation uses one normalized key family:

```ts
type CaseFileKey =
  | `evidence:${string}`
  | `statement:${string}`
  | `fact:${string}`
  | `question:${string}`
  | `objective:${string}`
  | `authorization:${string}`;

function recordKey(target: InventoryTarget): CaseFileKey {
  return `${target.kind}:${target.id}`;
}

function factKey(id: string): CaseFileKey {
  return `fact:${id}`;
}

function parseEncodedRecordTarget(
  value: string,
): InventoryTarget | null;
```

Normalization examples:

```text
supportingRecords: [{ kind: "evidence", id: "door_log" }]
    → evidence:door_log

supportingFactIds: ["merge_time_is_not_event_time"]
    → fact:merge_time_is_not_event_time

provenance.supersedesRecordId: "statement:revised_guard_account"
    → statement:revised_guard_account
```

The model never compares a bare record slug against a kind-qualified key.
Section-specific lookup maps use the normalized key as their only identity.

## 8. Case File information architecture

### 8.1 Menu placement

The Escape-menu root entry changes from `物證檔案 / EVIDENCE` to
`案件檔案 / CASE FILE`. It opens through the existing GameShell submenu stack.
There is no second modal, router state, or overlay coordinator.

The same implementation PR updates the packaged E2E coupling point:

```ts
// apps/game/e2e-tauri/production-anchors.ts
evidenceMenuEntry → caseFileMenuEntry
evidenceFile      → caseFile
"物證檔案"         → "案件檔案"
```

Every WDIO use of the old keys is updated in the same change; no compatibility
alias preserves the obsolete player-facing label.

Opening behavior:

- first open in a session defaults to Current Objective;
- reopening in the same mounted session restores the last section;
- load, new game, and return to title reset to Current Objective;
- selected item is retained only while it remains visible in the current view.

### 8.2 Layout

At 1280×720 the panel uses:

1. a fixed vertical section rail;
2. a selectable item list;
3. a detail pane.

On narrower layouts the list and detail pane may stack. There is one primary
scroll container per active panel state; essential controls must not be hidden
below an unreachable nested scroll region.

### 8.3 Section counts

Counts contain visible/revealed entries only. They never disclose total catalog
size or locked relationships.

## 9. Section behavior

### 9.1 Current Objective

Display order:

1. active primary objective;
2. incomplete secondary objectives, authored order;
3. three most recent completed objectives;
4. an explicit disclosure for earlier completed objectives.

Completed recency is deterministic: descending `sortOrder`, then stable ID.
Inactive incomplete primary objectives are omitted.

No active primary objective produces a neutral empty state rather than exposing
future primary definitions.

### 9.2 Evidence

Evidence retains acquisition order and existing image behavior. Details include:

- name, description, and full details;
- resolved acquisition chapter and scene titles from `acquisitionContext`;
- authored non-neutral provenance;
- source-group label/summary;
- positive proof capabilities;
- acquired supersession history;
- re-examination action when the current mode permits it.

A fully neutral legacy record renders exactly as the legacy dossier did apart
from its ordinary resolved acquisition location in the detail view.

### 9.3 Statements

Statements retain acquisition order and show:

- speaker and statement text;
- resolved acquisition chapter and scene titles from `acquisitionContext`;
- non-neutral provenance and source-group context;
- acquired supersession history;
- re-examination when permitted.

Neither section renders raw `chapter_1`/`scene_7`-style IDs as player copy.

### 9.4 Established Facts

Facts show:

- label, summary, details, and category;
- first assertion chapter/scene or migration origin;
- direct acquired supporting evidence/statements;
- direct supporting facts.

Support entries are internal Case File links, not presentation actions.

If no acquired direct record is visible, copy remains conservative:

> 沒有可顯示的已取得直接支持紀錄。

It must not claim that no internal support exists.

### 9.5 Questions

Open questions appear first, then resolved questions. A resolved question links
to its visible resolving fact. No section, badge, or accessible label marks a
question as a main-story spoiler.

### 9.6 Authorizations

Authorizations show:

- label;
- granting authority;
- summary as the concrete permitted access/procedure;
- grant chapter/scene or migration origin.

Example presentation:

```text
有限門鎖匯出權
授權機關：KAGAMI 證據摘要審查會
允許：調閱核准時段的後門門鎖摘錄
授權於：第 1 章 · 最終審查會
```

## 10. Provenance and supersession presentation

### 10.1 Neutral visibility

A provenance section appears only when at least one authored value is
player-meaningful:

- non-`unspecified` source kind;
- representation layer other than `none`;
- non-`unspecified` procedural status;
- non-`unspecified` completeness or confidence;
- source label/group;
- one or more proof capabilities;
- one acquired predecessor or successor.

Neutral values never render as chips.

### 10.2 Player-facing labels

| Domain field | Player wording |
| --- | --- |
| source kind | 來源類型 |
| representation layer | 呈現層 |
| procedural status | 程序狀態 |
| completeness | 完整程度 |
| confidence | 驗證狀態 |
| source group | 底層來源 |
| proof capabilities | 可證明 |
| supersession | 紀錄沿革 |

Proof capabilities are positive limits. The UI does not generate a negative
list of everything a record cannot prove.

### 10.3 Acquired-only chain

A superseded record remains inspectable and receives a restrained
`已被後續紀錄取代` status. It is not struck out or disabled.

The chain contains acquired public records only. It never renders placeholders
for hidden predecessors or future successors. Navigation offers previous/next
links and an explicit return action when entered from a support relationship.

The acquired successor map is derived by reversing the redacted public
predecessor edges. This is deliberate: projecting Rust’s complete successor
index would require another acquired-only redaction contract solely for this UI
and could otherwise leak the existence or identity of a future record.

## 11. Re-examination and mode behavior

Record inspection remains available whenever the Case File itself is available.
Re-examination is a distinct action:

- enabled in exploration and interrogation;
- disabled in dialogue and other unsupported modes with concise explanatory
  copy;
- never shown for facts, questions, objectives, or authorizations.

A successful re-examination closes the Escape menu and moves focus into the
installed dialogue using the existing `+page.svelte` orchestration. Errors also
close the menu so the existing gameplay error surface is not trapped behind the
scrim.

## 12. Primary-objective HUD

The active primary objective appears as a compact, non-interactive HUD:

```text
主要目標 / PRIMARY OBJECTIVE
證明門鎖合併時間不是事件時間
```

Placement:

- dialogue: beneath the chapter header;
- interrogation: beneath the chapter header;
- exploration: through `ExploreView`’s existing `hud` snippet beside
  sublocation navigation;
- game complete/title: hidden;
- no active primary objective: no placeholder.

The HUD shows the objective label only. Full summary and objective history stay
in the Case File.

## 13. Authored scene-summary contract

### 13.1 Authoring syntax

Every scene supports one list-metadata summary immediately after its H1:

```markdown
# Scene 7: 雨水留下的時間

- **Summary:** 相馬重新回到雨鐘後場，開始懷疑警方採用的門鎖時間不是實際開門時間。
```

This form intentionally matches the scene tokenizer’s existing metadata grammar.
The dash-less chapter-manifest form is invalid in a scene:

```markdown
**Summary:** 這不是合法的 scene summary 語法。
```

The rule applies to linear, investigation, and interrogation scenes. HPA-259
reuses the same header parser for analysis scenes.

### 13.2 Tokenizer and shared scene-header parser

Add one shared helper, for example:

```ts
type ParsedSceneHeader = {
  title: string;
  summary: string;
  summaryAuthored: boolean;
  nextTokenIndex: number;
};

function parseSceneHeader(
  source: string,
  sourceFile: string,
  tokens: Token[],
): Result<ParsedSceneHeader, CompileError>;
```

Ownership:

1. the existing tokenizer recognizes a non-empty
   `- **Summary:** value` as a `metadata` token;
2. a narrow summary-specific empty-value rule or pre-token header check recognizes
   `- **Summary:**` and returns a dedicated source-located blank-summary
   diagnostic instead of an unrelated unknown-line error;
3. `parseSceneHeader` validates the H1, consumes zero or one immediate
   `Summary` metadata token, and returns the first parser-specific token index;
4. it rejects dash-less summary syntax, duplicate Summary tokens, and Summary
   tokens outside the immediate post-H1 header position with dedicated
   source-located diagnostics;
5. parser-specific code never emits the Summary token as dialogue or treats it
   as scene-tag asset metadata.

The earlier wording that malformed summary copy might be “read as dialogue” is
incorrect. ASCII-colon `**Summary:**` cannot match the full-width-colon dialogue
rule; malformed summary syntax is rejected as unknown/header metadata before
any dialogue item is emitted.

### 13.3 Linear-scene carve-out

`parser-linear.ts` currently rejects every top-level metadata token. HPA-258
changes the control flow, not the general rule:

```text
tokenize source
    ↓
parseSceneHeader consumes H1 + optional immediate Summary
    ↓
linear queue loop starts at nextTokenIndex
    ↓
any remaining top-level metadata still fails linearSceneHasMetadata
```

Scene-tag-local visual/audio metadata remains consumed only by the existing
scene-tag block. The summary carve-out must not make arbitrary top-level
metadata legal in linear scenes.

Investigation and interrogation parsers likewise start their H2 block loops at
`nextTokenIndex`; an unconsumed Summary token must never reach the “expected H2”
branch.

### 13.4 Compiler AST and audit state

The shared helper supplies:

```ts
type ParsedSceneMetadata = {
  title: string;
  summary: string;
  summaryAuthored: boolean;
};
```

`summaryAuthored` exists only in compiler AST/audit state. It is not emitted to
scene JSON, Rust, `contentRevision`, public views, or saves.

Rules:

- duplicate Summary fields fail with source location;
- an explicitly present but blank Summary fails with a summary-specific
  diagnostic;
- dash-less Summary fails with a malformed-syntax diagnostic;
- a Summary after dialogue, a scene tag, or an H2 block fails as misplaced;
- legacy fixtures without Summary receive a deterministic title-based fallback
  and `summaryAuthored: false`;
- production Chapter 1 receives authored summaries for every manifested scene;
- a production audit test proves no Chapter 1 scene uses fallback;
- analysis scenes authored after HPA-259 require authored summary from day one.

A warning may flag unusually long summaries, but length is not a hard semantic
failure unless later UI evidence justifies a fixed limit.

### 13.5 Emitted and runtime shape

Every full emitted scene JSON gains:

```ts
summary: string;
```

Rust serde scene definitions and every `SceneView` variant mirror it. The layout
editor’s narrower structural scene view may ignore the extra JSON field.

### 13.6 Content identity

Scene summary is authored semantic copy. It participates in the canonical
emitted bundle and changes `contentRevision` when edited. `summaryAuthored` does
not participate because it is audit-only and not emitted.

## 14. Save-envelope schema v2

### 14.1 Explicit v1 naming

The existing Rust type is renamed without changing its wire shape:

```rust
struct SaveSummaryV1 {
    chapter_id: String,
    chapter_title: String,
    scene_id: String,
    scene_title: String,
    active_primary_objective_id: Option<String>,
    active_primary_objective_label: Option<String>,
}

struct SaveEnvelopeV1 {
    // existing fields
    summary: SaveSummaryV1,
    snapshot: SaveSnapshotV1,
}
```

Tests prove the rename does not change schema-v1 JSON.

### 14.2 V2 shape

```rust
struct SaveSummaryV2 {
    chapter_id: String,
    chapter_title: String,
    chapter_summary: Option<String>,
    scene_id: String,
    scene_title: String,
    scene_summary: Option<String>,
    active_primary_objective_id: Option<String>,
    active_primary_objective_label: Option<String>,
    active_primary_objective_summary: Option<String>,
}

struct SaveEnvelopeV2 {
    schema_version: u32, // 2
    content_revision: String,
    // existing envelope metadata
    summary: SaveSummaryV2,
    snapshot: SaveSnapshotV1,
}
```

Newly captured v2 saves populate chapter and scene summaries and the active
objective summary whenever the active objective exists. Null objective fields
remain valid when no primary objective is active.

### 14.3 Migration pipeline

`SAVE_SCHEMA_VERSION` becomes 2. The old current-only dispatch is replaced or
expanded into a sequential migration entry point:

```text
read minimal schema-version envelope
    ↓
version 1 → decode SaveEnvelopeV1 → migrate to SaveEnvelopeV2
version 2 → decode SaveEnvelopeV2
other     → unsupportedSaveSchemaVersion
    ↓
run current v2 validation and exact contentRevision gate
```

Migration registry requirements:

- both versions 1 and 2 are registered;
- a missing migration link returns `missingSaveSchemaMigration`;
- migration preserves save ID, type, slot, timestamps, display name, thumbnail,
  IDs, labels, and the complete `SaveSnapshotV1`;
- newly introduced summary fields become null;
- migration never reads packaged definitions to fill missing prose;
- discovery can expose readable v1 metadata after migration;
- load remains transactional.

### 14.4 Exact content compatibility remains independent

Schema migration and content compatibility answer different questions.
A structurally valid v1 envelope can migrate to v2 and still fail because its
`contentRevision` belongs to an older package.

Adding scene summary changes the canonical semantic bundle. Therefore ordinary
pre-release saves created before PR B are intentionally incompatible with the
new package. The loader must report the existing content-revision diagnostic;
it must not imply that schema migration restores semantic compatibility.

A migration unit fixture uses a matching synthetic revision to prove the v1-to-
v2 transformation itself. Production pre-release rollout tests separately prove
old-package saves are rejected for content mismatch.

### 14.5 Rust and frontend save-metadata projections

After decode/migration, both Rust public metadata paths use V2:

```rust
struct SaveMetadataView {
    // existing fields
    summary: SaveSummaryV2,
}

struct ReadableSaveMetadataView {
    // existing fields
    summary: Option<SaveSummaryV2>,
}
```

The optional readable path remains optional because an invalid file may not
contain enough trustworthy metadata to expose a summary at all. A readable v1
summary is migrated to V2 with the three new summary-copy fields set to null.

Frontend `SaveSummaryView`, `SaveMetadataView`, and
`ReadableSaveMetadataView` mirror those V2 fields. Invalid or migrated saves may
display retained titles and labels even when new summary copy is unavailable.
The UI omits missing summaries rather than inventing fallback prose such as
“No summary available.”

## 15. Save and Continue recap presentation

### 15.1 Shared textual component

Add `SaveRecapDetails.svelte`, responsible only for text:

- save type;
- saved time;
- chapter title and optional chapter summary;
- scene title and optional scene summary;
- active primary objective label and optional summary.

`SaveCard.svelte` retains thumbnail ownership, fetch, lifecycle, invalid-slot
styling, and actions. The title Continue surface renders the same text component
from the newest-written candidate’s already-discovered metadata and does not
fetch a second thumbnail.

### 15.2 Density

- Save Browser uses a compact form with clamped summary copy.
- Title Continue uses an expanded textual recap beside the Continue action.
- Accessible names include chapter, scene, save type, and saved time without
  repeating decorative English labels.

### 15.3 Invalid newest save

HPA-392 behavior is unchanged. If the newest-written candidate is corrupt or
incompatible, Continue opens its diagnostic path and offers Load Game. HPA-258
does not silently show or load an older candidate.

## 16. Accessibility, focus, Escape, and inert behavior

### 16.1 Section navigation

The section rail uses an ARIA tablist or an equivalent roving-focus control:

- opening focuses the active section control;
- Up/Down moves between section controls;
- Enter/Space activates where required by the chosen pattern;
- section counts belong to accessible names only when visible counts are useful;
- switching section does not unexpectedly move focus into details.

### 16.2 Item and relation navigation

- selecting a row updates details while list focus remains stable;
- following support/supersession links moves focus to the destination detail
  heading after render;
- an explicit `返回上一項` action returns to the previous entry;
- if the destination disappears after state replacement, focus returns to the
  active section heading or first visible row;
- defensive dangling relations never reveal IDs in player-facing copy.

### 16.3 Escape and layers

One physical Escape closes one layer:

1. persistence/acquisition/recovery top layer;
2. Case File internal relation detail if represented as a nested layer;
3. Case File submenu to Escape-menu root;
4. Escape menu to gameplay with original focus restoration.

HPA-258 adds no competing window-level Escape listener. `GameShell` and the
existing escape coordinator remain the owners.

Persistence overlays make the Case File inert. Opening an acquisition popup
while the menu is open follows the current focus redirection to gameplay root.

### 16.4 Motion and viewport

Decorative transitions respect reduced motion. At 1280×720 every section,
list, detail action, Back control, and re-examination control remains keyboard
reachable without inaccessible nested scrolling.

## 17. Error handling

### 17.1 Rust authoritative failures

The following are typed view-construction failures:

- an acquired record’s chapter/scene context missing from the immutable
  `StoryLocationIndex`;
- a scene/analysis origin referencing a missing packaged chapter or scene;
- malformed authoritative supersession target reaching Rust domain state;
- inventory/catalog definition disagreement;
- impossible story relationship that violates HPA-255/HPA-256 invariants.

Source-group integrity is normally rejected earlier by catalog loading and
inventory definition validation. If an impossible unresolved group reaches the
projection through a test-only or internal bypass, it is treated as an internal
invariant failure, not a recoverable player-facing state.

The command returns the existing `GameError` surface. It does not mutate engine
state or partially serialize a misleading Case File.

### 17.2 Frontend defensive degradation

The pure Case File model accepts that tests, stale local UI state, or a manually
constructed wire fixture may contain a missing link. It:

- omits only the unusable navigation edge;
- keeps the source entry inspectable;
- does not display the raw hidden-looking ID;
- may log a developer diagnostic;
- never invents a neutral authority or origin.

This is a presentation guard, not a second semantic policy.

### 17.3 Save recap degradation

Nullable migrated summary copy is omitted. Invalid slot diagnostics and
thumbnail placeholders retain HPA-392 behavior.

## 18. Testing strategy

### 18.1 Compiler

Tests cover:

- valid list-form `- **Summary:** ...` parsing for linear, investigation, and
  interrogation scenes;
- dash-less `**Summary:** ...` rejected with a source-located malformed-syntax
  diagnostic;
- shared scene-header parser use rather than three independent grammars;
- linear scenes accepting the one immediate header Summary while continuing to
  reject every other top-level metadata token;
- scene-tag asset metadata remaining valid and unchanged;
- investigation/interrogation H2 loops beginning after the consumed Summary;
- duplicate, blank, and misplaced Summary diagnostics with source locations;
- no malformed Summary becoming dialogue;
- deterministic legacy fallback;
- `summaryAuthored` retained only in AST/audit state and absent from JSON;
- production Chapter 1 audit with no fallback summaries;
- emitted JSON and Rust serde snapshots containing summary;
- a summary-only edit changing `contentRevision`;
- existing scene types compiling unchanged except for the additive field.

### 18.2 Rust public views

Synthetic fixtures cover:

- untouched definitions omitted;
- all-neutral provenance unchanged;
- catalog validation rejecting unknown or inconsistent source-group projection;
- source-group label/summary resolved for acquired records only after those
  validation gates;
- evidence and statement `acquisitionContext` resolving chapter/scene titles;
- missing acquired-record location failing the whole view with a typed error;
- `StoryStateView::from_catalog_state` returning `Result` and
  `GameEngine::view()` propagating its error;
- cached `StoryLocationIndex` reused without per-view scene loading;
- scene and future analysis origins resolving chapter/scene titles;
- unresolved non-migration origin failing the whole view;
- migration origin producing the explicit migration view variant;
- unacquired predecessors redacted;
- same slug used by evidence and statement without key collision;
- an acquired cross-kind predecessor chain;
- unacquired supporting records absent from facts;
- active primary hidden after completion;
- zero-or-one active primary preserved;
- every `SceneView` carrying summary.

No acceptance test fabricates an unresolved source group through a private
`StoryCatalog` backdoor solely to reach an otherwise impossible view state.
A source/instrumentation test proves `view()` does not build the location index
or read scene files on each refresh.

### 18.3 Frontend model

Pure model tests cover:

- all `CaseFileKey` normalization shapes from §7;
- acquired successor reverse mapping from kind-qualified predecessor strings;
- same-slug evidence/statement collision resistance;
- an evidence-to-statement or statement-to-evidence acquired chain;
- objective grouping and three-item completed disclosure;
- open/resolved question grouping;
- direct support navigation;
- malformed/dangling relation omission without crash or raw-ID leakage;
- neutral provenance visibility predicate;
- section counts containing visible entries only;
- state replacement clearing stale selection;
- record location display using resolved titles rather than raw IDs.

### 18.4 Component and page tests

Tests cover:

- keyboard-only access to every section and item;
- focus on open, section switch, relation navigation, Back, submenu close, and
  gameplay restoration;
- Escape one-layer behavior and repeat-key suppression;
- persistence overlays making Case File inert;
- re-examination enabled only in existing valid modes;
- re-examination closing the menu and installing dialogue;
- facts never exposing evidence/presentation actions;
- evidence/statement detail showing resolved acquisition context;
- active-objective HUD placement in dialogue, exploration, and interrogation;
- no HUD without active primary;
- 1280×720 layout and reduced-motion behavior;
- shared SaveRecapDetails rendering on Save Browser and title Continue;
- nullable migrated summaries omitted cleanly.

### 18.5 Save and migration tests

Tests cover:

- `SaveSummary` → `SaveSummaryV1` rename preserving exact v1 JSON;
- version envelope routing 1 and 2;
- v1-to-v2 migration preserving all existing fields and snapshot bytes;
- new summary fields becoming null;
- no packaged-prose lookup during migration;
- new captures writing v2 with authored summaries;
- valid `SaveMetadataView.summary` exposing V2;
- readable invalid metadata exposing `Option<SaveSummaryV2>` after migration;
- schema migration succeeding under a matching synthetic content revision;
- a real old-package save still failing exact content compatibility after
  migration;
- manual, auto, valid, invalid, and readable-metadata discovery;
- Continue remaining newest-written/no-fallback.

### 18.6 Synthetic populated acceptance fixture

HPA-258 owns a deterministic non-production fixture containing:

- one active primary objective;
- incomplete secondary objectives;
- more than three completed objectives;
- acquired evidence and statements, including same-slug cross-kind records;
- a visible acquired cross-kind supersession chain;
- one neutral legacy record;
- asserted facts with direct record and fact support;
- open and resolved questions;
- a granted authorization with granting authority and scope;
- at least one locked definition in every relevant catalog family.

The fixture is exercised by compiler tests, Rust view/save round trips, frontend
model tests, and component/page harnesses. It does not become production Chapter
1 story content.

### 18.7 Packaged E2E owned by HPA-258

Against the currently authored packaged game, HPA-258 verifies:

- `production-anchors.ts` and its consumers use the new
  `caseFileMenuEntry`/`caseFile` anchors and `案件檔案` copy;
- Case File replaces the Evidence submenu and opens/closes through GameShell;
- every currently non-empty section is reachable;
- empty sections are neutral and reveal no catalog totals;
- legacy record presentation remains unchanged;
- acquired record detail displays authored chapter/scene titles, not IDs;
- re-examination still works in a packaged supported mode;
- focus, Escape, inert, and 1280×720 behavior;
- primary-objective HUD is absent when no authored active objective exists;
- Save Browser and title Continue render the available recap fields;
- save schema v2 discovery and Continue behavior remain operational.

HPA-258 does **not** seed production story state or add an E2E-only gameplay
mutation command solely to fabricate later Chapter 1 progression.

### 18.8 Deferred packaged Chapter 1 acceptance

HPA-265/HPA-266 own the first real packaged populated flow:

1. acquire authored evidence/statements;
2. establish facts and resolve a question;
3. complete and replace primary objectives;
4. grant an authorization through the represented authority;
5. inspect the populated Case File and supersession history;
6. save, return to title, inspect Continue recap, Continue/load;
7. reopen the Case File and compare exact restored sections;
8. prove locked definitions remain absent.

This deferral does not block HPA-258 completion because the reusable contracts
and populated-state behavior are already accepted through the synthetic fixture.
HPA-266 remains the program’s packaged Chapter 1 acceptance gate.

## 19. Delivery decomposition and compatibility

### 19.1 PR A — Case File and primary-objective HUD

Scope:

1. cached `StoryLocationIndex`;
2. fallible inventory/story view integration and `?` propagation;
3. source-group, acquisition-context, and origin-context public views;
4. kind-qualified Case File key normalization and acquired-only supersession
   model, including a cross-kind chain;
5. six-section Case File replacing InventoryPanel;
6. `production-anchors.ts` rename from evidence-menu to Case File anchors plus
   all packaged WDIO consumers;
7. preserved re-examination;
8. primary-objective HUD;
9. accessibility and synthetic populated fixtures.

Compatibility:

- no scene JSON semantic change;
- no save schema change;
- no `contentRevision` change;
- existing saves remain compatible;
- additive public wire fields require frontend/Rust to land together in the PR.

### 19.2 PR B — Authored recap, save v2, and Continue

Scope:

1. list-form scene-summary syntax and shared scene-header parser;
2. explicit linear-scene metadata carve-out and parser diagnostics;
3. Chapter 1 authored summary backfill;
4. emitted/Rust/public scene summary;
5. explicit `SaveSummaryV1` rename;
6. `SaveSummaryV2`, `SaveEnvelopeV2`, and v1-to-v2 migration;
7. V2 valid and readable-invalid save metadata projections;
8. shared SaveRecapDetails;
9. Save Browser and title Continue recap;
10. repository guidance clarification for `@lyra/scene-types` shared-subset scope;
11. migration, content-identity, parser, and packaged persistence tests.

Compatibility:

- scene summary changes `contentRevision` intentionally;
- `SAVE_SCHEMA_VERSION` advances to 2;
- old v1 envelopes are structurally migratable;
- ordinary saves produced against the previous package remain content-
  incompatible after the semantic bundle changes;
- this is expected pre-release behavior and must be called out in PR notes and
  testing, not filed as an accidental regression.

HPA-258 remains open until both PRs land and the HPA-258-owned verification
matrix passes. It does not wait for HPA-265/HPA-266.

## 20. Acceptance mapping

| Acceptance criterion | Verification owner |
| --- | --- |
| Keyboard and screen-reader users reach every section and focus returns | PR A component/page tests + packaged E2E |
| Legacy unspecified provenance remains visually unchanged | PR A Rust/frontend regression + packaged E2E |
| Facts cannot be selected as physical evidence | PR A type/source/component tests |
| Superseded leads remain inspectable and linked | PR A synthetic populated fixture; real Chapter 1 path HPA-265/266 |
| Authorizations show grantor and permitted scope | PR A synthetic fixture; real Chapter 1 grant HPA-265/266 |
| Evidence/statements show authored acquisition location, not raw IDs | PR A Rust/component tests + packaged E2E |
| Continue/save cards show chapter, scene, primary objective, save type, time | PR B component + packaged persistence E2E |
| Save/load restores all Case File sections exactly | PR A/PR B Rust synthetic round trip; packaged real-story path HPA-266 |
| Locked definitions never leak | PR A Rust/model/component fixtures; HPA-266 real-story check |
| Primary objective appears in gameplay where active | PR A synthetic/page tests; real authored objective HPA-265/266 |
| Current scene summaries tokenize, compile, and are retained in saves | PR B parser/compiler audit + save capture/migration tests |

## 21. Non-goals

HPA-258 does not include:

- people or location archives;
- full chronology or cross-case timeline;
- social-media archive;
- search, filtering, tags, favorites, or player notes;
- free-form support graphs;
- objective completion timestamps;
- generic archive-section plugins;
- another inventory/story persistence model;
- LLM recap;
- full transitive support visualization;
- HPA-257 unlock/reachability implementation;
- HPA-259 analysis scene implementation;
- HPA-265 Chapter 1 Beat 8.5 authoring;
- production test-only mutation commands.

## 22. Design self-review

- Scene summary syntax is accepted by the actual tokenizer and has an explicit
  linear-parser carve-out.
- No durable Case File state duplicates inventory or story state.
- No locked-definition lookup is delegated to Svelte.
- Kind-qualified supersession preserves evidence/statement namespace identity,
  and cross-kind chains are accepted rather than hedged.
- Acquired successor derivation cannot expose a future catalog successor.
- Rust fail-closed behavior is consistent with existing whole-view fallibility,
  and the newly fallible story-view constructor is explicit.
- Source-group rejection is assigned to the existing catalog/inventory gates,
  not an artificial view-time test.
- Origin and acquisition-location resolution are cached rather than placed on a
  file-I/O hot path.
- Evidence and statement details receive titles rather than raw location IDs.
- The Case File rename includes the production E2E anchor coupling point.
- Scene-summary ownership respects the shared-subset `@lyra/scene-types`
  boundary.
- Save v1 naming, both V2 metadata projections, migration, and exact content
  compatibility are distinct and explicit.
- PR A is save-compatible; PR B intentionally invalidates old package saves.
- Synthetic populated acceptance is complete without reversing the HPA-258 →
  HPA-265 dependency.
- `summaryAuthored` is audit-only and absent from runtime output.
- Key normalization covers typed record targets and bare supporting fact IDs.
- Escape, focus, inert, and overlay ownership remain centralized in existing
  GameShell and persistence layers.
