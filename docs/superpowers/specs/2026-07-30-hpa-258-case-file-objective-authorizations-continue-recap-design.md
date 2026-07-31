# HPA-258 Case File, Primary Objective, Authorizations, and Continue Recap Design

**Status:** Approved in conversation; written for repository review  
**Issue:** HPA-258 — Build case file, primary objective, authorizations, and Continue recap UI  
**Parent:** HPA-254 — Detective gameplay systems program  
**Milestone:** P0 — Persistence and Story State  
**Date:** 2026-07-30

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

HPA-255, HPA-256, and HPA-129/HPA-392 are complete. HPA-258 therefore
consumes their existing catalog, durable story-state, provenance, redaction,
save-slot, and Continue contracts rather than creating replacements.

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
rules, new story-state mutation kinds, new authored people or location
archives, or Chapter 1 Beat 8.5 progression. Those remain owned by their
existing P1/P2 tickets.

## 2. Approved product decisions

1. The Case File is a read model over existing `GameStateView.inventory` and
   `GameStateView.story`. It is not another durable store.
2. Rust remains authoritative for definition visibility, acquired-record
   redaction, source-group resolution, and valid story origins.
3. Svelte may group, order, and navigate already-public values. It must not
   infer hidden definitions, mutation rules, answer keys, or internal support.
4. The existing Escape-menu Evidence submenu becomes one Case File submenu.
   HPA-258 does not add a second modal or a new top-level IPC workflow.
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
10. Acquired supersession navigation is derived from the acquired public
    records. Rust does not add a redundant public successor field.
11. Facts remain conclusions. They are never converted to `InventoryTarget`,
    never offered as physical evidence, and never sent to a presentation or
    re-examination command.
12. Direct supporting records and facts are shown. A free-form or transitive
    evidence graph is out of scope.
13. The active primary objective is visually dominant. Incomplete secondary
    objectives and recently completed objectives remain subordinate.
14. Inactive, incomplete primary objectives are hidden even if some internal or
    public state anomaly reveals them. The single active-primary scalar is the
    only current primary objective.
15. “Recently completed” uses authored objective `sortOrder`, descending, with
    stable ID tie-breaking. HPA-258 does not add completion timestamps.
16. The Current Objective section initially shows the three latest completed
    objectives and provides an explicit disclosure for earlier completed
    objectives.
17. `AuthorizationDefinition.summary` is the player-facing description of the
    access or procedure that the authorization permits. HPA-258 does not add a
    duplicate `unlockSummary` field.
18. Cross-chapter question wording remains fully author-owned, neutral, and
    unmarked as a spoiler. HPA-258 adds no “main mystery” or spoiler metadata.
19. The primary-objective HUD is compact and non-interactive. The full summary
    remains in the Case File.
20. Scene recap copy is authored. No LLM-generated or runtime-generated prose is
    required.
21. Every currently supported scene type gains one static `summary` value.
    Existing legacy fixtures may compile through a deterministic title
    fallback, while production Chapter 1 is backfilled with authored
    summaries. HPA-259 must adopt the same field for analysis scenes.
22. Scene-summary changes are static semantic-content changes and therefore
    change the package-wide `contentRevision`.
23. Save and Continue cards store the authored recap copy that belonged to that
    save. They do not join an old save to current packaged prose.
24. The save envelope advances to schema version 2. The mutable gameplay
    snapshot remains the existing `SaveSnapshotV1` shape because HPA-258 changes
    recap metadata, not gameplay progress.
25. The v1-to-v2 migration preserves existing IDs, titles, labels, and snapshot
    state and sets newly introduced recap-summary fields to `null`.
26. The migration never fabricates chapter, scene, or objective summaries from
    the currently installed package.
27. New saves always write schema v2 and populate every recap field available
    from the current packaged definitions.
28. Continue keeps HPA-392 semantics: it targets the newest written save and
    stops on that save’s diagnostic if invalid. HPA-258 adds recap presentation
    but no fallback.
29. Save Browser and title Continue reuse one textual recap component. Thumbnail
    ownership remains in `SaveCard`; the title screen does not perform a second
    thumbnail fetch.
30. Player-facing HPA-258 copy and accessible labels use canonical Traditional
    Chinese. Existing decorative English labels may remain.
31. Case File navigation state is frontend-local and session-local. It is not
    saved.
32. The last selected Case File section survives closing and reopening the
    Escape menu during one mounted game session. Selected records do not have
    to survive load, new game, or return to title.
33. Game-complete presentation keeps the current evidence-menu boundary: the
    Case File is unavailable after `gameComplete`. Post-game archive browsing is
    deferred.
34. HPA-258 adds no new Tauri command. Existing game-state and persistence
    command results carry the required data.
35. Implementation may land as two reviewable PRs under HPA-258: Case File/HUD,
    then authored recap/save v2/Continue.

## 3. Current repository baseline

### 3.1 Story and inventory public state

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

HPA-255 guarantees that untouched definitions are filtered out. HPA-256
guarantees that:

- acquired evidence and statements retain acquisition order;
- immutable provenance rejoins through the catalog;
- an unacquired predecessor is redacted from public provenance;
- public fact support contains acquired direct supporting records only;
- empty public support does not prove that internal support is empty;
- the catalog already owns source-group definitions and non-branching
  predecessor/successor indexes.

The current frontend mirrors these values in
`apps/game/src/lib/state/types.ts`.

### 3.2 Current Evidence submenu

`InventoryPanel.svelte` currently renders acquired evidence and statements
inside the Escape menu. It:

- preserves acquisition order;
- resolves optional evidence images;
- enables re-examination only in exploration and interrogation modes;
- is mounted through the `menu` snippet in `+page.svelte`;
- closes the Escape menu after a re-examination command installs dialogue.

`GameShell.svelte` already owns:

- the root menu and submenu stack;
- one-layer-per-Escape behavior;
- focus capture and restoration;
- submenu-back focus restoration;
- focus trapping;
- top-layer inert behavior for persistence and other overlays.

HPA-258 reuses these mechanisms.

### 3.3 Current objective and save metadata

The public objective view already includes:

- immutable label, summary, kind, and `sortOrder`;
- completed state;
- one `activePrimary` flag derived from the scalar active-primary ID.

Rust save capture already records:

- chapter ID/title;
- scene ID/title;
- active-primary-objective ID/label.

The save UI already displays:

- slot/save type;
- chapter and scene;
- primary-objective label;
- save time;
- optional thumbnail;
- invalid-save diagnostics.

The missing product behavior is authored chapter/scene/objective recap copy on
the title Continue surface and richer save cards.

### 3.4 Current authored scene contract

Chapter manifests already require a chapter summary. Scene JSON currently
contains a title but no summary. The compiler has separate linear,
investigation, and interrogation parsers, all of which must converge on one
shared scene-metadata rule rather than implementing three subtly different
summary grammars.

### 3.5 Current save schema and compatibility

The current disk envelope is schema version 1 and contains `SaveSummary` plus
`SaveSnapshotV1`. Package compatibility is one exact compiler-owned
`contentRevision`.

The current migration registry recognizes only the current version. HPA-258 is
the first feature requiring an actual sequential save-envelope migration.

## 4. Ownership and architecture

### 4.1 One directional flow

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
`story_catalog.json`, never reconstructs locked catalog entries, and never
resolves immutable definitions outside Rust’s public view.

### 4.2 No parallel Case File state

There is no serializable `CaseFileState`, no Case File IPC command, and no
Case File cache on disk.

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
  selectedKey: string | null;
  backTarget: {
    section: CaseFileSection;
    selectedKey: string | null;
  } | null;
};
```

`section` is hoisted to `+page.svelte` so it survives Escape-menu
close/reopen. A fresh game session defaults to `objective`; load, new game, and
return to title reset the section to `objective`. `selectedKey` and
`backTarget` are reset when the selected item does not exist after state
replacement.

### 4.3 Focused modules

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

The exact component split may be tightened during planning. The fixed
responsibility boundaries are:

- `case-file-model.ts`: pure grouping, lookup, acquired supersession graph, and
  presentation ordering;
- `CaseFilePanel.svelte`: section/selection coordination and accessibility;
- detail components: rendering and semantic actions only;
- `PrimaryObjectiveHud.svelte`: compact active-primary copy;
- `SaveRecapDetails.svelte`: shared text recap, no thumbnail side effects.

Recommended Rust changes stay within existing view and save modules:

```text
apps/game/src-tauri/src/game/
  view.rs
  story/view.rs
  save/schema.rs
  save/capture.rs
  save/migrations.rs
  save/storage.rs          [decode/discovery integration only]
  save/restore.rs          [versioned envelope integration only]
```

Compiler changes remain under `packages/scripts/compile-scenes/` and do not add
scene-summary fields to `@lyra/scene-types`.

## 5. Public-view refinements

### 5.1 Resolved source-group presentation

The current provenance contains `sourceGroupId` and optional record-specific
`sourceLabel`, but the public frontend cannot resolve a group slug to its
authored label and summary.

Add one acquired-record-only projection:

```ts
type SourceGroupReferenceView = {
  id: string;
  label: string;
  summary: string;
};
```

Add to both public record views:

```ts
type EvidenceRecord = {
  // existing fields
  sourceGroup: SourceGroupReferenceView | null;
};

type StatementRecord = {
  // existing fields
  sourceGroup: SourceGroupReferenceView | null;
};
```

Rules:

- `sourceGroup` is resolved only for the acquired record being serialized.
- It exposes no membership list.
- A null `sourceGroupId` produces `sourceGroup: null`.
- A non-null `sourceGroupId` that does not resolve is an internal/catalog
  invariant failure, not a raw slug fallback.
- `provenance.sourceGroupId` remains in the canonical provenance projection.
- Player-facing source display prefers `provenance.sourceLabel`, then
  `sourceGroup.label`.
- `sourceGroup.summary` is available in the detail pane, not forced into every
  compact row.

### 5.2 Origin context

`AssertionOrigin` currently exposes stable IDs. The Case File needs
human-readable chapter and scene context without asking Svelte to load or
resolve the packaged chapter index.

Add:

```ts
type SceneLocationContextView = {
  chapterId: string;
  chapterTitle: string;
  sceneId: string;
  sceneTitle: string;
};

type OriginContextView =
  | {
      type: "scene";
      originKind: "sceneEvent" | "analysisBoard";
      location: SceneLocationContextView;
    }
  | {
      type: "migration";
    };
```

Add `originContext` to:

```ts
type FactView = {
  // existing fields
  originContext: OriginContextView;
};

type AuthorizationView = {
  // existing fields
  originContext: OriginContextView;
};
```

Rules:

- `firstOrigin` remains available as the exact structured origin.
- `GameEngine::view()` builds or reuses a read-only chapter/scene title index
  from packaged chapter manifests; it does not ask Svelte to resolve IDs.
- `StoryStateView::from_catalog_state` accepts that resolver and returns
  `Result<StoryStateView, GameError>`.
- Scene-event and future analysis-board origins resolve through packaged
  chapter/scene metadata.
- Missing chapter or scene metadata is a typed internal view-construction
  failure.
- Migration IDs are not converted into player-facing prose. The UI displays a
  neutral localized “已匯入的進度” origin.
- HPA-258 does not resolve hotspot, topic, testimony-line, or board labels.
  Chapter and scene context are sufficient for MVP.

### 5.3 Scene summaries in public views

Every `SceneView` variant gains:

```ts
summary: string;
```

The current `ChapterView.summary` remains unchanged.

`SceneNavigationIndex` does not gain summaries in HPA-258. Scene Select is not
being redesigned.

### 5.4 Acquired supersession graph stays frontend-derived

HPA-256 already serializes the immediate predecessor typed ID when that
predecessor is acquired. Therefore the Case File can safely build the reverse
acquired-successor index without another Rust field:

```text
for every acquired record R:
    if R.provenance.supersedesRecordId is public:
        acquiredSuccessorByPredecessor[predecessor] = R
```

Rules:

- Keys use canonical typed IDs: `evidence:<id>` and `statement:<id>`.
- A record is labeled superseded only when an acquired successor exists.
- An unacquired future successor creates no badge, placeholder, empty slot, or
  accessible hint.
- The acquired chain may contain evidence and statements if the validated
  catalog permits a cross-kind chain.
- Non-branching is inherited from HPA-256 compiler/runtime validation.
- The model preserves acquisition order in section lists. Chain order is
  oldest-to-newest.
- A malformed duplicate acquired successor is treated as an impossible public
  invariant in tests and a generic non-crashing relation fallback in
  production.

This refinement removes the redundant `supersededByRecord` field proposed
during early brainstorming while preserving the approved acquired-only
behavior.

## 6. Case File information architecture

### 6.1 Escape-menu integration

Rename the existing root action:

```text
物證檔案 / EVIDENCE
```

to:

```text
案件檔案 / CASE FILE
```

Change the internal GameShell panel key from `evidence` to `caseFile`.
A fresh mounted game session opens the Case File on Current Objective. Later
opens in that session return to the last selected section.

`GameShell` continues to own:

- opening and closing the submenu;
- Back to Menu;
- focus return to the root Case File button;
- Escape;
- focus trapping;
- inert behavior under persistence overlays.

`CaseFilePanel` does not register a global Escape listener.

The Case File is available in dialogue, exploration, and interrogation modes.
It is hidden in `gameComplete`, matching the current `shouldShowInventoryPanel`
boundary.

### 6.2 Desktop layout

At 1280×720, the submenu contains:

1. a vertical section rail;
2. an item list for the selected section;
3. a detail pane.

The Current Objective section may use the list/detail area as one semantic
objective overview instead of forcing an empty item list.

At narrower widths, list and detail may stack. There must be one predictable
scroll region per column and no required control outside the reachable
viewport.

The layout does not imitate a free-form corkboard. Relationships are ordinary
links and ordered chains.

### 6.3 Section rail and counts

The fixed order is:

1. Current Objective
2. Evidence
3. Statements
4. Established Facts
5. Questions
6. Authorizations

Counts include only public acquired/revealed values. No count is computed from
catalog totals.

The Objective tab uses an active marker rather than a total catalog count.
Other sections may show:

- evidence count;
- statement count;
- asserted fact count;
- open-question count with resolved count in secondary copy;
- granted-authorization count.

### 6.4 Empty states

Empty copy is section-specific and never hints at hidden totals:

- Evidence: `尚未取得證物。`
- Statements: `尚未取得證言。`
- Facts: `尚未建立可歸檔的事實。`
- Questions: `目前沒有已揭露的問題。`
- Authorizations: `目前沒有已核准的權限。`
- Objective: `目前沒有進行中的主要目標。`

The UI must not say “0 of N” or “locked entries remain.”

## 7. Section semantics

### 7.1 Current Objective

The section is partitioned as follows:

1. **Active primary objective**
   - exactly zero or one;
   - label and full summary;
   - primary visual emphasis;
   - no inactive incomplete primary objectives.
2. **Incomplete secondary objectives**
   - all public incomplete secondary objectives;
   - ordered by `sortOrder`, then ID.
3. **Recently completed objectives**
   - all public completed objectives, primary or secondary;
   - ordered by `sortOrder` descending, then ID;
   - first three visible by default;
   - earlier completed objectives behind an explicit disclosure.

No objective timestamp or completion-origin field is added.

If an objective is marked `activePrimary` and `completed`, the Rust public
contract is invalid; HPA-255 already prevents this.

### 7.2 Evidence

Compact rows preserve acquisition order and show:

- evidence name;
- description;
- optional existing thumbnail;
- optional authored procedural badge when non-neutral;
- optional superseded badge only when an acquired successor exists.

The detail pane shows:

- name, description, details, and image;
- acquisition chapter/scene IDs as secondary technical context only if the
  human-readable origin is not otherwise available;
- non-neutral provenance;
- resolved source group;
- positive proof capabilities;
- acquired supersession chain;
- re-examination action when valid.

### 7.3 Statements

Compact rows preserve acquisition order and show:

- speaker;
- statement content;
- optional authored procedural badge when non-neutral;
- optional superseded badge when an acquired successor exists.

The detail pane shows:

- speaker and full statement;
- non-neutral provenance;
- resolved source group;
- positive proof capabilities;
- acquired supersession chain;
- re-examination action when valid.

### 7.4 Neutral provenance display

A provenance detail block is shown only when at least one visible dimension is
non-neutral:

```text
sourceKind != unspecified
or representationLayer != none
or proceduralStatus != unspecified
or completeness != unspecified
or confidence != unspecified
or sourceLabel != null
or sourceGroup != null
or proofCapabilities is not empty
or an acquired predecessor/successor exists
```

HPA-256 intentionally cannot distinguish omitted `representationLayer: none`
from explicitly authored `none`; both remain visually absent.

Recommended Traditional Chinese labels:

| Domain value | Player-facing label |
| --- | --- |
| Source kind | 來源類型 |
| Representation layer | 呈現層 |
| Procedural status | 程序狀態 |
| Completeness | 完整程度 |
| Confidence | 核驗狀態 |
| Source group | 基礎來源 |
| Proof capabilities | 可證明 |
| Supersession | 紀錄沿革 |

Recommended procedural-status copy:

| Value | Copy |
| --- | --- |
| lead | 線索 |
| reacquired | 合法補件 |
| exhibit | 可採證物 |

`unspecified` is never rendered as a status chip.

Proof capabilities are positive limits. The UI says, for example:

```text
可證明：時間、先後次序
```

It never manufactures a negative list such as “cannot prove identity.”

### 7.5 Re-examination

Record inspection is always available while the Case File is available.
Re-examination remains a separate detail-pane action.

Use the existing mode rule:

- exploration: enabled;
- interrogation: enabled;
- dialogue: disabled;
- game complete: Case File unavailable.

When disabled, retain the control context with explanatory copy such as:

```text
可在調查或審問階段重新檢視。
```

The disabled control uses `aria-describedby`.

On successful re-examination:

1. the existing Rust command installs dialogue;
2. `+page.svelte` closes the Escape menu;
3. focus moves into the resulting gameplay dialogue through the existing render
   and focus path.

No record is consumed or mutated.

### 7.6 Acquired supersession

Every acquired chain member remains inspectable.

The detail pane presents the acquired chain oldest-to-newest:

```text
匿名影片線索
→ 已核驗原始影片
→ 聽證可採影片
```

Rules:

- the selected record is marked as current;
- predecessor and successor items are navigable;
- an earlier lead remains visible after supersession;
- a superseded record is not struck out or disabled;
- no locked node placeholder is rendered;
- public null does not become “this is the root” copy.

### 7.7 Established Facts

Facts preserve the Rust/catalog order and show:

- label;
- summary;
- details;
- category;
- first assertion chapter and scene;
- origin kind;
- direct acquired supporting evidence/statements;
- direct supporting facts.

Supporting records and facts are Case File navigation links. They are not
presentation buttons.

The UI does not render a transitive graph. A supporting fact can be opened to
continue tracing the chain.

When `supportingRecords` is empty, use conservative copy:

```text
目前沒有可顯示的已取得支援紀錄。
```

Do not say that the fact has no supporting records.

If a supporting typed record cannot be resolved in the public acquired
inventory, it is not rendered as a raw ID. The model records a generic
non-interactive unavailable relation for diagnostics and tests.

### 7.8 Questions

Questions are partitioned:

1. open;
2. resolved.

Within each group, preserve Rust/catalog order.

Each question shows:

- label;
- summary;
- status;
- resolving fact when resolved.

The resolving fact is a Case File link when public.

No question is tagged “main story,” “spoiler,” “cross-chapter,” or equivalent.
Authors must provide neutral labels and summaries.

### 7.9 Authorizations

Granted authorizations preserve Rust/catalog order and show:

- label;
- `summary` as the permission scope;
- granting authority;
- grant chapter and scene;
- origin kind.

Recommended presentation:

```text
限定門鎖原始匯出

核准機關
KAGAMI 證據摘要審查會

允許
取得獲准時段內的後門門鎖原始片段。

核准於
第 1 章 · 最終證據摘要審查
```

HPA-258 does not infer downstream unlock targets by scanning positive
predicates. The authored authorization summary is the player-facing contract.

The story-catalog authoring guidance is updated to state that:

- authorization Summary describes the permitted access/procedure;
- question labels and summaries must remain neutral and must not identify
  unrevealed main-story significance.

## 8. Case File navigation model

### 8.1 Stable public keys

Use typed keys for records:

```ts
type CaseRecordKey = `evidence:${string}` | `statement:${string}`;
```

Use prefixed keys for other sections:

```ts
type CaseFileItemKey =
  | CaseRecordKey
  | `fact:${string}`
  | `question:${string}`
  | `authorization:${string}`
  | `objective:${string}`;
```

These are frontend navigation keys, not new persisted IDs.

### 8.2 Pure model responsibilities

`buildCaseFileModel(gameState)`:

- derives the active primary objective;
- partitions incomplete secondary and completed objectives;
- preserves evidence and statement acquisition order;
- derives the acquired supersession graph;
- indexes public facts, questions, and authorizations;
- partitions questions;
- resolves direct public support links;
- computes visible section counts;
- provides first-selectable keys and validation helpers.

It does not:

- read the filesystem;
- invoke Tauri;
- mutate game state;
- inspect locked catalog definitions;
- compute transitive internal support;
- decide whether a deduction is correct.

### 8.3 Cross-section links and one-step return

Selecting a support or supersession link:

1. records the current section/key as one `backTarget`;
2. switches to the destination section;
3. selects the destination;
4. after render, focuses the destination detail heading.

The detail pane then provides one `返回上一項` action while `backTarget` is
present.

This is a one-step navigation aid, not a browser-history system. Section changes
made directly through the rail clear `backTarget`.

## 9. Primary-objective HUD

### 9.1 Content

The HUD renders only:

```text
PRIMARY OBJECTIVE
<active primary objective label>
```

The full objective summary remains in the Case File.

No active primary objective means no HUD element.

### 9.2 Placement

- Dialogue and interrogation: below the existing chapter header inside
  `GameShell`.
- Exploration: through the existing `ExploreView` `hud` snippet beside scene
  navigation.
- Game complete: hidden.
- Title screen: hidden.

Dialogue installed from an investigation or interrogation may use the normal
GameShell header placement because the active mode is dialogue.

### 9.3 Interaction and accessibility

The HUD is non-interactive and does not enter the tab order.

It uses a semantic region with an accessible Traditional Chinese label such as:

```text
目前主要目標
```

Decorative English copy remains `aria-hidden`.

Long labels wrap to at most two visual lines at 1280×720. The component does not
truncate its accessible name.

## 10. Authored scene summaries

### 10.1 Markdown grammar

Every currently supported linear, investigation, and interrogation scene
supports one scene summary immediately after the H1. The HPA-259 analysis
parser must consume the same shared metadata helper when analysis scenes are
introduced:

```markdown
# Scene 7: 雨水留下的時間

**Summary:** 相馬重新回到雨鐘後場，開始懷疑警方採用的門鎖時間不是實際開門時間。

[場景：……]
```

The common metadata contract is:

- exactly one H1 title;
- zero or one Summary field during legacy transition;
- Summary appears before the first scene body block;
- an explicit blank Summary is an error;
- a duplicate Summary is an error;
- authored copy is trimmed at both ends and otherwise preserved.

### 10.2 Shared parser ownership

Add one shared scene-metadata parser/helper consumed by every scene parser.
Linear, investigation, and interrogation parsers must not each implement
different Summary detection.

Illustrative compiler types:

```ts
type SceneMetadata = {
  title: string;
  summary: string;
  summaryAuthored: boolean;
};

type ASTLinearScene = Located<{
  kind: "linearScene";
  id: string;
  title: string;
  summary: string;
  // ...
}>;
```

Every emitted scene JSON variant gains required `summary: string`.

### 10.3 Legacy fallback and production authoring gate

For a missing Summary during transition:

```text
summary = scene title
```

The fallback is deterministic and participates in emitted semantic content.

HPA-258 also adds a production-content audit test that requires every playable
Chapter 1 scene listed by `docs/stories_plan/chapter_1/chapter.md` to contain an
authored Summary. Test fixtures and historical isolated parser fixtures may
continue using the title fallback unless their test specifically targets
summary authoring.

This avoids a repository-wide fixture rewrite while ensuring real save/Continue
cards do not ship title-as-summary placeholders.

### 10.4 Content identity

Scene summary is included in emitted scene JSON. The existing canonical
semantic-bundle hash therefore includes it automatically.

Changing a scene summary changes `contentRevision`, as does changing a chapter
summary or objective summary.

No separate summary digest is introduced.

### 10.5 Authoring guidance

Update the relevant repository authoring skills:

- linear detective dialogue;
- investigation scenes;
- interrogation scenes;
- future analysis-scene skill when introduced.

Guidance:

- summarize the player’s current narrative position, not hidden truth;
- use neutral language that remains valid on Continue;
- do not reveal a culprit, locked route, future fact, or answer key;
- prefer one sentence;
- target roughly 40–120 Traditional Chinese characters;
- avoid dynamic values such as the current clock or evidence count.

The compiler does not enforce a prose-quality or spoiler classifier.

## 11. Save schema v2

### 11.1 Why recap copy lives in the envelope

Save discovery and invalid-save presentation must remain useful without
restoring a live engine. Joining IDs to current package copy would also
misrepresent a save from a different `contentRevision`.

Therefore save metadata stores the authored copy visible at capture time.

### 11.2 Versioned summary shapes

Retain the exact v1 shape for decoding:

```rust
struct SaveSummaryV1 {
    chapter_id: String,
    chapter_title: String,
    scene_id: String,
    scene_title: String,
    active_primary_objective_id: Option<String>,
    active_primary_objective_label: Option<String>,
}
```

Add:

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
```

New valid captures populate chapter and scene summaries as `Some`. The active
objective summary is `Some` only when an active primary exists.

The fields remain optional so migrated v1 metadata can be represented honestly.

### 11.3 Versioned envelope

Add a v2 envelope:

```rust
struct SaveEnvelopeV2 {
    schema_version: u32, // 2
    content_revision: String,
    save_id: String,
    save_type: SaveType,
    slot: u8,
    saved_at: String,
    display_name: String,
    thumbnail: ThumbnailDescriptorV1,
    summary: SaveSummaryV2,
    snapshot: SaveSnapshotV1,
}
```

The nested thumbnail and mutable snapshot contracts do not change merely to
match the outer version suffix.

Set:

```rust
SAVE_SCHEMA_VERSION = 2;
```

Storage writes v2 only.

### 11.4 Decode and migration pipeline

Save discovery/load first reads a minimal version envelope, then:

```text
schemaVersion 1
    ↓ strict SaveEnvelopeV1 decode
migrate v1 → v2
    ↓
SaveEnvelopeV2
```

or:

```text
schemaVersion 2
    ↓ strict SaveEnvelopeV2 decode
SaveEnvelopeV2
```

Unknown versions remain unsupported.

The v1-to-v2 migration:

- copies envelope identity, slot, type, time, name, thumbnail, and snapshot;
- copies chapter/scene IDs and titles;
- copies active-primary ID and label;
- sets `chapterSummary`, `sceneSummary`, and
  `activePrimaryObjectiveSummary` to `None`;
- does not inspect current chapters, scenes, catalog definitions, or
  `contentRevision` to synthesize copy.

Compatibility checks continue after migration. A migrated v1 save whose
`contentRevision` does not equal the installed package is still incompatible.

### 11.5 Capture

Capture v2 resolves:

- chapter title and summary from the current `ChapterManifest`;
- scene title and summary from the current packaged scene;
- active primary label and summary from the story catalog.

Missing packaged definitions are capture errors, matching existing exact
capture behavior.

`SaveSnapshotV1` remains unchanged, so Case File state continues to restore
through existing inventory IDs and `StoryStateSnapshotV1`.

### 11.6 Public persistence views

Extend frontend persistence types:

```ts
type SaveSummaryView = {
  chapterId: string;
  chapterTitle: string;
  chapterSummary: string | null;
  sceneId: string;
  sceneTitle: string;
  sceneSummary: string | null;
  activePrimaryObjectiveId: string | null;
  activePrimaryObjectiveLabel: string | null;
  activePrimaryObjectiveSummary: string | null;
};
```

Valid v2 metadata normally has non-null chapter/scene summaries. Migrated or
partially readable older metadata may contain null.

Invalid-save readable metadata keeps the same nullable summary shape.

### 11.7 Existing behavior preserved

HPA-258 does not change:

- five visible rotating autosaves;
- three named manual slots;
- thumbnail sidecars;
- manual overwrite and delete confirmation;
- autosave scheduling;
- acquisition acknowledgement refresh;
- persistence health;
- newest-written Continue selection;
- no-fallback invalid-newest behavior;
- exact package-wide `contentRevision`.

## 12. Save Browser and Continue recap

### 12.1 Shared textual component

`SaveRecapDetails.svelte` accepts:

- slot/save type;
- saved time or fallback modified time;
- display name;
- `SaveSummaryView | null`;
- compact or expanded density;
- invalid/unavailable state.

It renders text only.

`SaveCard.svelte` retains:

- thumbnail request and object-URL ownership;
- thumbnail placeholder;
- select/load/delete actions;
- selected and invalid borders.

This prevents duplicate thumbnail fetching on the title screen.

### 12.2 Save Browser compact recap

Each occupied card shows:

1. Auto Save or Manual Save;
2. update time;
3. display name;
4. chapter title;
5. chapter summary when available;
6. scene title;
7. scene summary when available;
8. active primary objective label;
9. active primary objective summary when available.

Compact cards clamp visible summary copy, but the complete text remains
available to assistive technology or an explicit accessible description.

For migrated v1 metadata, omitted summary rows are not replaced with current
package copy.

### 12.3 Title Continue recap

`MainMenu.svelte` resolves the `continueCandidate` slot from the existing
discovery result and renders an expanded textual recap adjacent to Continue.

Valid candidate:

- save type;
- updated time;
- chapter title and summary;
- scene title and summary;
- active primary objective label and summary.

Invalid newest candidate:

- show any readable stored recap metadata;
- visually and semantically mark the save unavailable;
- show the existing diagnostic;
- preserve the current Continue command/error flow and Load Game recovery.

No candidate:

- no recap card;
- existing New Game and discovery behavior remain.

### 12.4 Time fallback

Display time uses:

1. metadata `savedAt` when readable;
2. slot filesystem `modifiedAt` when metadata time is unavailable;
3. localized `時間無法讀取` when neither exists.

The timestamp remains formatted through `Intl.DateTimeFormat("zh-Hant", ...)`.

### 12.5 Current manual-save preview

The frontend `currentSaveSummary` derived from `GameStateView` gains:

- chapter summary;
- scene summary;
- active-primary-objective summary.

This preview is presentation-only for the name and overwrite dialogs. Rust
capture remains authoritative for the actual written envelope.

## 13. Accessibility and interaction contract

### 13.1 Section navigation

Use a vertical tab pattern:

- rail: `role="tablist"`, `aria-orientation="vertical"`;
- each section: `role="tab"`, `aria-selected`, roving `tabindex`;
- content: `role="tabpanel"` and labelled by its tab;
- Arrow Up/Down moves and activates the adjacent section;
- Home/End moves to first/last section;
- Enter/Space also activates;
- switching sections leaves focus on the section tab.

Opening the Case File focuses the active section tab after render.

### 13.2 Item lists

Use semantic lists of buttons rather than ARIA listboxes. Items may contain
multi-line copy and lead to a separate detail pane, so ordinary button
semantics are clearer.

Selecting an item:

- updates detail content;
- keeps focus on the selected item;
- does not automatically move focus.

Cross-section support/supersession links intentionally move focus to the
destination detail heading and expose `返回上一項`.

### 13.3 Escape and focus return

The existing GameShell capture-phase Escape listener remains the sole Escape
owner:

1. persistence/acquisition top layer closes first;
2. Case File submenu returns to root menu;
3. root menu closes and restores the prior gameplay control.

Holding Escape triggers one action per physical press through the existing
repeat guard.

Case File components do not call `stopImmediatePropagation` for Escape.

### 13.4 Inert and layering

When persistence or acquisition top layers are open:

- the Escape menu and Case File are inert through existing `topLayerOpen` and
  `gameplayInert` contracts;
- no Case File action can invoke gameplay behind the overlay;
- focus remains trapped in the top layer.

### 13.5 Screen-reader behavior

- Section counts describe public entries only.
- Decorative English labels are `aria-hidden`.
- Provenance chips have one coherent textual summary, not ten repeated live
  announcements.
- Detail changes caused by item selection do not use an assertive live region.
- Re-examination disabled reason is connected with `aria-describedby`.
- Invalid save recap diagnostics retain `role="alert"` only on explicit error
  surfaces; ordinary invalid card copy is not repeatedly announced.
- The primary-objective HUD is a labelled region and not a live region. Normal
  game-state replacement is sufficient; objective transitions may use the
  existing gameplay/dialogue feedback rather than a second announcement.

### 13.6 Reduced motion and 1280×720

- Case File section and detail transitions honor reduced motion.
- No essential relationship is communicated only through animation or color.
- At 1280×720, the submenu heading, section rail, first list items, detail
  heading, Back button, and any re-examination action remain reachable without
  an inaccessible page-level overflow trap.
- Each scrollable pane has visible focus indication and a stable max height.

## 14. Error handling and defensive behavior

### 14.1 Rust view construction

Return typed errors when:

- a public record names a non-null missing source group;
- a fact or authorization scene origin cannot resolve to packaged chapter/scene
  metadata;
- current scene summary is missing after successful scene deserialization;
- active primary objective lacks its catalog definition during save capture.

These are invariant/content errors, not player-facing locked-item placeholders.

### 14.2 Frontend model

The frontend model must not crash the whole game on an impossible dangling
public relation.

For a missing public support destination or malformed acquired chain:

- do not show the raw hidden/stable ID;
- render a generic unavailable relation only in the detail pane;
- log one development diagnostic;
- keep all unrelated Case File sections usable.

Tests still treat such input as invalid fixture state.

### 14.3 Save migration

Malformed v1 or v2 envelopes remain invalid and preserved on disk.
A failed migration produces the existing typed migration diagnostic and never
partially replaces the live engine.

## 15. Testing and acceptance

### 15.1 Compiler tests

Cover:

- Summary parsing for linear, investigation, and interrogation scenes;
- shared helper use across all scene parsers;
- duplicate Summary rejection with source location;
- explicit blank Summary rejection with source location;
- title fallback for legacy fixtures;
- emitted JSON contains `summary`;
- Rust serde fixtures accept emitted summaries;
- a summary-only edit changes `contentRevision`;
- current Chapter 1 production scenes all author Summary;
- existing scene behavior and ordering remain unchanged.

### 15.2 Rust public-view tests

Cover:

- source-group reference resolves for an acquired record;
- source-group membership is not exposed;
- neutral records serialize with `sourceGroup: null`;
- unacquired predecessor remains redacted;
- acquired predecessor enables frontend-reconstructible chain data;
- untouched facts/questions/objectives/authorizations remain absent;
- fact support exposes acquired records only;
- origin context resolves chapter and scene titles;
- migration origin produces neutral origin context;
- missing source group or origin metadata fails with a typed error;
- every SceneView variant serializes summary.

### 15.3 Frontend model tests

Cover:

- one active primary objective;
- inactive incomplete primary objectives hidden;
- incomplete secondary ordering;
- completed-objective ordering and three-item disclosure;
- evidence and statement acquisition order;
- neutral provenance produces no metadata block;
- positive proof-capability labels;
- acquired-only supersession chain and no locked placeholder;
- cross-kind typed record chains;
- facts never become inventory/presentation targets;
- direct support links;
- open/resolved question partition;
- authorization summary/authority/origin presentation;
- section counts use public values only;
- stale selection resets safely after state replacement.

### 15.4 Svelte component tests

Cover:

- keyboard-only access to every section;
- Arrow/Home/End tab behavior;
- opening focus;
- submenu Back focus restoration;
- Escape returns to root menu, then gameplay;
- list selection retains focus;
- support link focuses destination and one-step Back returns;
- re-examination enabled in exploration/interrogation;
- re-examination disabled with reason in dialogue;
- successful re-examination closes the menu;
- persistence top layer makes Case File inert;
- reduced-motion class/behavior;
- 1280×720 layout anchors;
- objective HUD placement in dialogue, exploration, and interrogation;
- no HUD with no active objective or game complete;
- SaveRecapDetails compact/expanded/null-summary/invalid variants;
- MainMenu resolves and displays the newest-written Continue candidate.

### 15.5 Save tests

Cover:

- v2 capture writes chapter, scene, and objective summaries;
- v2 round-trip preserves the unchanged `SaveSnapshotV1`;
- strict v1 decode and v1-to-v2 migration;
- migrated summary fields are null;
- migration does not consult current packaged prose;
- migrated v1 still obeys exact `contentRevision`;
- invalid newest save remains the Continue target;
- readable invalid metadata retains stored recap copy;
- manual and autosave type/time rendering;
- save/load restores inventory and all four story-state collections exactly.

### 15.6 Integration and packaged acceptance

A focused fixture must exercise:

1. one active primary objective;
2. one incomplete secondary objective;
3. more than three completed objectives;
4. neutral legacy evidence;
5. annotated evidence and statement sharing a source group;
6. an acquired supersession chain;
7. two asserted facts with direct record/fact support;
8. one open and one resolved question;
9. one granted authorization;
10. one locked/untouched definition of every story kind.

Acceptance flow:

1. start the fixture;
2. open every Case File section keyboard-only;
3. verify neutral provenance is visually unchanged;
4. follow support and supersession links;
5. verify facts have no evidence action;
6. re-examine evidence and return to gameplay dialogue;
7. save manually;
8. return to title;
9. inspect the Continue recap;
10. Continue or Load;
11. reopen the Case File;
12. compare every visible section;
13. verify no locked definition appears in text, count, DOM, or accessible name.

The fixture may be split across Rust integration and frontend harness coverage if
production Chapter 1 has not yet authored HPA-255 story events. HPA-258 must not
prematurely implement HPA-257 or HPA-265 merely to seed the test.

A packaged Tauri E2E must at minimum prove:

- Escape → Case File → all section controls → Back → gameplay focus;
- save → title → Continue recap → Continue;
- no overlay or Case File content appears in save thumbnails;
- objective HUD appears in the appropriate runtime surfaces.

## 16. Delivery decomposition

### 16.1 PR A — Case File and objective HUD

Scope:

- source-group and origin-context public-view refinements;
- pure Case File model;
- six-section Case File UI;
- provenance, support, and acquired supersession presentation;
- re-examination preservation;
- primary-objective HUD;
- accessibility and component/integration coverage.

No scene-summary grammar or save schema change in this PR.

### 16.2 PR B — Authored recap, save schema v2, and Continue

Scope:

- shared scene Summary grammar;
- emitted/Rust/public scene summaries;
- Chapter 1 summary backfill;
- save envelope v2 and v1 migration;
- recap capture and persistence views;
- shared SaveRecapDetails;
- Save Browser and title Continue recap;
- persistence and packaged acceptance coverage.

HPA-258 remains open until both slices and the integrated acceptance flow pass.

## 17. Non-goals

HPA-258 does not add:

- people, locations, organizations, or full chronology sections;
- social-media archives;
- cross-case timeline;
- player notes, favorites, search, tags, or filters;
- free-form corkboard or graph editing;
- transitive support visualization;
- source-independence counts in the Case File;
- objective completion timestamps;
- a second objective mutation path;
- authorization unlock inference from predicates;
- analysis scene UI or answers;
- request-readiness scoring;
- evidence presentation from facts;
- LLM recap;
- screenshot changes;
- cloud save or cross-device state;
- a generic archive extension framework;
- post-game Case File access.

## 18. Acceptance mapping

| Linear acceptance criterion | Design contract |
| --- | --- |
| Keyboard and screen-reader users reach every section and focus returns correctly | §13 and component/E2E tests |
| Legacy unspecified provenance remains visually unchanged | §§7.4, 15.3 |
| Facts cannot be selected as physical evidence | §§2.11, 7.7, 15.3 |
| Superseded leads remain inspectable and linked | §§5.4, 7.6 |
| Authorizations show grantor and unlock scope | §§7.9, 2.17 |
| Continue/save cards show chapter, scene, objective, save type, update time | §§11–12 |
| Save/load restores all sections exactly | §§2.1, 11.5, 15.5–15.6 |
| Locked definitions remain hidden | §§2.7, 6.4, 15.6 |
| Existing evidence/statement re-examination remains available | §7.5 |
| Primary objective appears in gameplay | §9 |
| Authored chapter/scene summaries drive recap | §§10–12 |
| Cross-chapter questions remain neutral and unmarked | §7.8 |

## 19. Final design invariants

1. Case File visibility equals the spoiler-safe public game state; it never
   widens catalog visibility.
2. Saving the game, not opening the Case File, persists progress.
3. All relationship navigation is acquired/revealed-only.
4. Public null and empty values never disclose hidden structure.
5. Facts remain conclusions, not evidence items.
6. Authorizations describe represented authority and permitted scope.
7. Objective uniqueness remains HPA-255’s single scalar.
8. Scene and recap copy are authored static definitions.
9. Save metadata preserves the copy that belonged to the save.
10. Save v1 migration is explicit and never fabricates current prose.
11. Continue remains newest-written with no silent fallback.
12. Escape, focus, inert, and overlay ownership remain centralized in
    `GameShell` and existing persistence layers.
