# HPA-273 Story Workbench Plan Mode Design

## Status

Planning design for **HPA-273 — [Story Workbench] Visualize the Story Bible and reveal progression**.

This remains one ticket and one PR. Planning lands first; implementation continues on this same branch/PR after review.

## Goal

Add one read-only **Plan** mode to Lyra Story Workbench so an author can answer four questions without opening several Markdown files manually:

1. What planning documents currently define the story?
2. What is the explicit eight-chapter structure in the Story Bible?
3. How does the authored Aoba/青葉 question progress across chapters?
4. At each authored stage, what is explicitly established and what is explicitly forbidden from early confirmation?

Do this without a second story database, relationship sidecar, generic graph editor, AI inference, or Chapter 2 map/board authoring framework.

## Why HPA-273 is next

The Story Workbench program explicitly sequences read-only author workflows before source editing:

```text
HPA-634  Reader + Stage        DONE
   ├─> HPA-134  Assets        DONE
   └─> HPA-273  Plan          NEXT

HPA-634 + HPA-134
   └─> HPA-135  focused edits

HPA-634 + HPA-134 + HPA-273 + HPA-135
   └─> HPA-136  AI review
```

HPA-273 is blocked only by HPA-634, which is complete. Chapter 2 implementation remains explicitly deferred. HPA-135 is also technically unblocked now, but HPA-639 deliberately puts Plan before write paths, and HPA-273 is one of HPA-136's remaining prerequisites.

## Current source reality

The implementation should use the repository as it exists rather than create a cleaner parallel canon model.

Canonical planning sources are root-level files under `docs/stories_plan/`:

- `final_story_bible.md` — story-level canon;
- existing `chapter_<N>_plan.md` files — chapter construction plans;
- playable `chapter_<N>/` scene directories remain compiler input and are not Plan documents.

The current Story Bible is intentionally not fully normalized. It contains older base sections plus explicit later override/addendum sections. That is useful evidence for the product requirement: Plan mode must **surface authored overrides and missing structures rather than silently reconcile them**.

Two current Story Bible structures are already sufficient to prove the product without inference:

### Eight-chapter overview source

`# 10. 章節總覽` contains one explicit table:

```text
章節 | 標題 | 案件類型 | 變體 | 主線誤導
```

This table alone is the v1 chapter matrix source. Do not join it to the separate theme matrix, duration section, or per-chapter prose merely to fill more columns.

### Aoba reveal/boundary source

`# 18. Canon Addendum：第一幕青葉提問契約（2026-08-23）` explicitly declares that it overrides conflicting older sections.

Within it, `## 18.5 第一幕 reveal ladder` contains one explicit table:

```text
章節 | 必須建立 | 絕對不能建立
```

Its rows already cover:

- 第 1 章;
- 第 2 章;
- 第 3 章;
- 第 4 章;
- 第 5～7 章;
- 第 8 章.

That one table is both the v1 Aoba timeline and the v1 player-knowledge boundary source. The UI does not need to invent a reveal ontology.

Chapter 1 also has `附錄 E：第一幕青葉提問契約`; Chapter 2 has its own detailed Aoba public-record construction rules. They remain readable in the document browser, but v1 does not merge their prose into a second derived truth model.

## Approaches considered

### A. Fixed planning snapshot + exact source-backed projection — selected

```text
fixed planning Markdown files
        ↓
load_plan_workspace           # Rust: fixed-domain file read only
        ↓
projectPlanWorkspace          # TypeScript: headings/tables/source refs
        ↓
Plan sidebar + Plan view
```

Advantages:

- preserves Markdown as source of truth;
- does not contaminate the playable-scene index;
- uses current explicit tables directly;
- missing/changed source structures can become diagnostics instead of guesses;
- small enough for one PR and easy for HPA-136 to read later.

Cost: Plan has its own small read-only snapshot, analogous to Assets.

### B. Add planning documents to `WorkbenchIndex`

This would mix two different domains in one tree: compiled playable scenes and uncompiled planning Markdown. It would force every existing Reader/Assets/Stage consumer to understand non-scene nodes or introduce a union whose only purpose is navigation.

Rejected: more coupling for no product benefit.

### C. Introduce `story-links.yaml` / a generic story graph

This could model arbitrary foreshadowing, facts, objectives, and relationships cleanly, but it immediately creates a second maintained canon representation and asks authors to keep Markdown and graph data synchronized.

Rejected for v1: the current Story Bible already contains the required explicit chapter and Aoba structures. Add a relationship sidecar only if later real content proves the authored Markdown cannot represent the needed view.

## Selected architecture

```text
docs/stories_plan/final_story_bible.md
existing docs/stories_plan/chapter_<N>_plan.md
        │
        ▼
Rust load_plan_workspace()
  - fixed paths / numeric chapter-plan discovery
  - no caller-supplied path
  - raw UTF-8 content only
        │
        ▼
WorkbenchPlanWorkspacePayload
        │
        ▼
TypeScript projectPlanWorkspace()
  ├─ parsed documents + heading outline
  ├─ explicit #10 chapter overview table
  ├─ explicit #18.5 Aoba reveal ladder
  └─ diagnostics; never prose inference
        │
        ├──────────────┐
        ▼              ▼
PlanSidebar        PlanView
(documents +       (Overview / Document)
 headings)
```

Rust remains the filesystem/domain boundary. TypeScript owns author-facing projection. Story Markdown remains canonical.

## 1. Fixed-domain Plan snapshot

Add one command:

```text
load_plan_workspace
```

It takes **no path argument**.

### Files included

Required:

- `docs/stories_plan/final_story_bible.md`.

Discovered, optional:

- root-level files matching exactly `chapter_<positive integer>_plan.md`.

Sort chapter plans by numeric chapter number, not lexicographic filename order.

Do not include:

- playable `chapter_<N>/` directories;
- historical/versioned planning files elsewhere;
- `docs/superpowers/**`;
- arbitrary `.md` files;
- `characters.md` in this first slice. HPA-273 only names it as optional when useful, and none of the acceptance criteria require character navigation.

### Wire shape

```ts
type PlanDocumentKind = "storyBible" | "chapterPlan";

type WorkbenchPlanDocument = {
  id: string;                 // "story-bible" or "chapter-<N>-plan"
  kind: PlanDocumentKind;
  chapterNumber: number | null;
  path: string;               // repo-relative canonical source path
  content: string;            // raw UTF-8 Markdown
};

type WorkbenchPlanWorkspacePayload = {
  documents: WorkbenchPlanDocument[];
};
```

The backend constructs IDs and paths. The frontend never supplies an arbitrary filesystem path.

### Backend errors

- missing required Story Bible: `planStoryBibleNotFound` with the expected repo-relative path;
- unreadable required or discovered file: `planDocumentReadFailed` with the canonical repo-relative path;
- malformed discovered filename is simply not a Plan document; discovery only recognizes the exact numeric pattern.

A missing `chapter_3_plan.md` is not an error. Only currently existing chapter plans appear.

## 2. Markdown parsing and source anchors

Plan mode is a planning reader, not a Markdown authoring framework.

Use one established Markdown parser (`marked`) inside `@lyra/layout-editor` for the current GFM-like documents. Configure rendering so raw HTML is escaped/disabled; Plan only needs repository-authored Markdown presentation.

A pure TypeScript module owns Plan parsing/projection:

```text
apps/layout-editor/src/lib/plan-workspace.ts
```

It produces:

```ts
type PlanHeading = {
  level: number;
  text: string;
  anchor: string;
  sourceRef: string;          // "docs/stories_plan/...md#anchor"
};

type PlanTable = {
  headers: string[];
  rows: string[][];
  sourceRef: string;          // containing heading
};

type ParsedPlanDocument = {
  id: string;
  kind: PlanDocumentKind;
  chapterNumber: number | null;
  path: string;
  renderedHtml: string;
  headings: PlanHeading[];
  tables: PlanTable[];
};
```

### Anchor rules

Generate heading anchors deterministically from heading text and preserve duplicate headings with `-1`, `-2`, ... suffixes. Rendering and extraction must use the same slugger so copied references scroll to the exact rendered heading.

Source references are always:

```text
<repo-relative path>#<heading anchor>
```

A table row does not invent a pseudo-line or row anchor; it links to its containing authored heading.

## 3. Strict chapter-matrix projection

The eight-chapter overview is an explicit source projection, not an aggregate query.

Find the Story Bible heading whose normalized text is exactly:

```text
10. 章節總覽
```

Under that heading, require a table with this exact header family:

```text
章節 | 標題 | 案件類型 | 變體 | 主線誤導
```

Project it to:

```ts
type ChapterOverviewRow = {
  chapter: string;
  title: string;
  caseType: string;
  variant: string;
  mainMisdirection: string;
  sourceRef: string;
};
```

Do not pull duration from §14, evidence-misread text from §3, or later chapter prose into the same row. Those remain readable in the source document.

### Validation

The current expected product is eight rows numbered 1 through 8. If the heading/table/header/row shape changes:

- keep the document browser functional;
- omit the invalid derived matrix;
- emit a visible diagnostic explaining the missing/changed authored structure;
- do not search other tables for a “close enough” substitute.

## 4. Strict Aoba reveal/boundary projection

Use the current authoritative addendum instead of reconciling older Aoba sections.

Find:

```text
18. Canon Addendum：第一幕青葉提問契約（2026-08-23）
  → 18.5 第一幕 reveal ladder
```

Require:

```text
章節 | 必須建立 | 絕對不能建立
```

Project each authored row to:

```ts
type AobaRevealStage = {
  chapterLabel: string;
  mustEstablish: string;
  mustNotEstablish: string;
  sourceRef: string;
};
```

The same rows power two presentations:

1. **Reveal timeline** — chapter/stage order + `mustEstablish` as the authored progression.
2. **Boundary view** — `mustEstablish` beside `mustNotEstablish`.

Do not classify phrases into a generic `known/unresolved/prohibited/payoff` ontology. The authored column names already carry the useful distinction.

For the Chapter 8 em dash (`—`) in `絕對不能建立`, render “No additional early-reveal prohibition authored” rather than inventing one.

### Explicit override notice

The Overview should also surface the blockquote directly below Story Bible `# 18`, which explicitly says that this addendum overrides conflicting older sections. This is a source callout, not a conflict-resolution algorithm.

The product therefore communicates:

> an override exists and this projection uses it

rather than pretending the source corpus has no historical contradictions.

## 5. Plan document browser UX

Add `plan` to the explicit Workbench mode union and mode bar:

```text
Reader | Assets | Plan | Stage
```

Do not add a router, docking system, generic tab registry, or placeholder modes.

### Sidebar ownership

When `mode === "plan"`, the existing left Workbench sidebar switches from scene navigation to Plan navigation:

- Story Bible;
- existing chapter plans in numeric order;
- heading outline for the selected planning document.

Reader/Assets/Stage keep the current scene tree exactly as today.

Scene selection is preserved while Plan is open, so returning to Reader/Assets/Stage resumes the prior scene context.

Plan selection is separate local state:

- selected Plan document ID;
- selected heading anchor;
- default document: Story Bible.

### Main Plan view

Two small views are enough:

#### Overview

- eight-chapter matrix;
- Aoba reveal timeline;
- Aoba reveal-boundary table;
- explicit canon override callout;
- projection diagnostics.

#### Document

- rendered Markdown document;
- canonical source path;
- selected heading highlighted/scrolled into view;
- “Copy source reference” for the current document/heading.

A source link from Overview switches to Document and scrolls to the referenced heading.

No file editing or OS-open action is added.

### Refresh

Provide one explicit Plan Refresh action. It rereads the fixed snapshot and reprojects it.

No watcher, polling, persistence, or background sync.

Use the same generation-fencing pattern already used by Reader/Assets so an older slow refresh cannot replace a newer snapshot.

## 6. Diagnostics and source drift

Derived visualizations are conveniences over canonical Markdown. Source drift must fail visibly, not silently.

Initial diagnostic codes:

```text
chapterOverviewMissing
chapterOverviewInvalid
chapterOverviewUnexpectedRows
aobaRevealLadderMissing
aobaRevealLadderInvalid
```

Each diagnostic contains:

- message;
- relevant document path;
- sourceRef when a containing heading is available.

Rules:

- required Story Bible file missing → backend command error;
- optional chapter-plan file missing → simply absent;
- Story Bible readable but expected derived table changed → Plan document still renders + diagnostic;
- no AI/prose fallback;
- no cross-table heuristic reconciliation;
- no mutation of authored source.

## 7. Real-content contract

Because this feature intentionally depends on exact authored structures, add a real-content verifier analogous to the existing Reader and Assets verifiers:

```text
apps/layout-editor/scripts/verify-plan-real-content.ts
```

It reads the current planning files, constructs the same payload as the Rust command, and runs `projectPlanWorkspace()` headlessly.

Required assertions on the current corpus:

- Story Bible is present;
- current Chapter 1 and Chapter 2 plan documents are discovered;
- chapter overview projects exactly eight rows in 1→8 order;
- Aoba ladder projects the authored stages `第 1 章`, `第 2 章`, `第 3 章`, `第 4 章`, `第 5～7 章`, `第 8 章` in order;
- the required projections emit no structural diagnostic.

Wire it into the existing `lint-frontend` CI job after scene compilation and the Reader/Assets real-content checks. It does not need scene compiler output, but keeping the three Workbench projection gates together makes drift visible in one place.

## 8. Testing strategy

### Rust

Test fixed-domain snapshot ownership:

- required Story Bible is returned first;
- chapter plans are numeric and ordered;
- nested playable Markdown is never included;
- missing required Bible fails with `planStoryBibleNotFound`;
- missing optional chapter plans are valid.

### Pure TypeScript projection

Test:

- heading extraction and duplicate-anchor stability;
- GFM table extraction and containing source references;
- chapter overview exact projection;
- no heuristic fallback when overview changes;
- Aoba ladder order and authored boundary text;
- explicit Chapter 8 em-dash presentation rule;
- diagnostics when required derived sections are absent or malformed.

### Svelte components

Test:

- document and heading navigation;
- Overview matrix/timeline/boundary rendering;
- source-link → document/anchor navigation;
- copied source reference;
- diagnostics stay visible while raw document remains readable;
- Refresh generation fencing.

### App integration

Test:

- mode bar becomes `Reader | Assets | Plan | Stage`;
- Plan uses planning navigation, not the scene tree;
- switching through Plan does not clear Reader/Assets scene selection or Stage selection behavior;
- existing Reader/Assets/Stage tests remain unchanged except for the new fourth mode control.

## 9. Files and ownership

Expected implementation surface:

```text
apps/layout-editor/src-tauri/src/lib.rs
  fixed-domain load_plan_workspace + tests

apps/layout-editor/src/lib/workbench-types.ts
apps/layout-editor/src/lib/workbench-api.ts
  wire types + one Tauri call

apps/layout-editor/src/lib/plan-workspace.ts
apps/layout-editor/src/lib/plan-workspace.test.ts
  pure parse/projection/diagnostics

apps/layout-editor/src/lib/PlanSidebar.svelte
apps/layout-editor/src/lib/PlanSidebar.test.ts
  planning document + heading navigation

apps/layout-editor/src/lib/PlanView.svelte
apps/layout-editor/src/lib/PlanView.test.ts
  Overview + Document rendering

apps/layout-editor/src/App.svelte
apps/layout-editor/src/App.test.ts
  fourth functional mode + mode-specific sidebar ownership

apps/layout-editor/scripts/verify-plan-real-content.ts
apps/layout-editor/package.json
bun.lock
.github/workflows/ci.yml
  one Markdown dependency + real-content gate
```

Do not introduce a shared `planning` package unless another app actually needs this projection later.

## 10. Non-goals

- No source editing.
- No AI calls or AI-derived canon.
- No proposal queue.
- No `story-links.yaml`.
- No relationship database.
- No generic mystery/fact/knowledge ontology.
- No node/whiteboard graph framework.
- No Facts/Objectives/Authorizations graph.
- No public Analysis answer-key preview.
- No Chapter 2 staged map/evidence-board visualization.
- No character browser in Plan v1.
- No automatic source reconciliation.
- No file watcher/polling.
- No arbitrary path read command.
- No automatic Git commit/branch/PR behavior from the Workbench.

## 11. Acceptance criteria

HPA-273 is done when:

- Story Bible and existing chapter plans are readable/navigable in Plan mode with heading outlines and copyable source references;
- the eight-chapter matrix comes only from the explicit `# 10. 章節總覽` table;
- the Aoba timeline and boundary view come only from the explicit `# 18.5 第一幕 reveal ladder` table;
- the explicit Story Bible §18 override note is visible;
- missing or changed derived structures produce diagnostics without disabling the source document reader;
- Chapter 1 evidence-package/proof-order sections remain easy to reach through the heading outline rather than a new case-logic model;
- Reader, Assets, and Stage behavior remain unchanged;
- the real current planning corpus passes the Plan projection verifier;
- the implementation remains in this single HPA-273 PR.

## 12. Required verification

Implementation closeout should run:

```text
bun run --cwd apps/layout-editor test
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run --cwd apps/layout-editor verify:plan-real-content
bun run scenes:compile
bun run check:scripts
bun run editor:check
bun run editor:build
bun run lint:all
```

The existing Reader and Assets real-content checks remain part of CI and should also stay green.
