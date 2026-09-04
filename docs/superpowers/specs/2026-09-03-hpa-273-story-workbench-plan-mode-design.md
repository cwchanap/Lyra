# HPA-273 Story Workbench Plan Mode Design

## Status

Planning design for **HPA-273 — [Story Workbench] Visualize the Story Bible and reveal progression**.

One ticket, one PR. This PR starts with planning; implementation continues on the same branch after review.

## Goal

Add one read-only **Plan** mode so an author can:

1. browse the canonical Story Bible and existing chapter plans;
2. see the authored eight-chapter overview at a glance;
3. follow the authored Aoba/青葉 reveal progression;
4. see what each Aoba stage must establish and must not establish yet.

Do not create a second story model merely to visualize information already written in Markdown.

## Why this is next

HPA-639 defines the Story Workbench order as:

```text
Reader + Stage  →  Assets  →  Plan  →  Focused edits  →  AI review
HPA-634            HPA-134    HPA-273   HPA-135          HPA-136
```

HPA-634 and HPA-134 are complete. HPA-273 is blocked only by HPA-634, while Chapter 2 implementation remains deferred. Finishing Plan also removes one of HPA-136's remaining blockers.

## Current source contracts

Canonical planning files are root-level Markdown under `docs/stories_plan/`:

- required: `final_story_bible.md`;
- optional/current: files matching `chapter_<N>_plan.md`;
- playable `chapter_<N>/` scene directories stay outside Plan mode.

The current Story Bible already contains the two structures HPA-273 needs.

### Eight-chapter matrix

`# 10. 章節總覽` contains:

```text
章節 | 標題 | 案件類型 | 變體 | 主線誤導
```

This exact table is the v1 chapter-matrix source. Do **not** join §3 theme data, §14 duration data, or per-chapter prose just to create more columns.

### Aoba reveal/boundary view

`# 18. Canon Addendum：第一幕青葉提問契約（2026-08-23）` explicitly says it overrides conflicting older sections.

`## 18.5 第一幕 reveal ladder` contains:

```text
章節 | 必須建立 | 絕對不能建立
```

Rows cover Chapter 1, 2, 3, 4, 5–7, and 8. The same authored rows are enough for both the reveal timeline and the player-knowledge boundary view.

Chapter 1/2 plans remain readable as detailed source documents, but v1 does not merge their prose into another truth model.

## Approaches considered

### A. Fixed Plan snapshot + strict TypeScript projection — selected

```text
planning Markdown
    ↓
load_plan_workspace          # Rust: fixed-domain read
    ↓
projectPlanWorkspace         # TS: Markdown + exact table projection
    ↓
Plan sidebar / Plan view
```

This keeps Markdown authoritative, keeps playable scenes separate, and turns source drift into diagnostics rather than guesses.

### B. Add planning nodes to `WorkbenchIndex`

Rejected. `WorkbenchIndex` is the existing playable-scene navigation contract used by Reader/Assets/Stage. Mixing uncompiled planning docs into it creates unnecessary unions and coupling.

### C. Add `story-links.yaml` / generic graph data

Rejected for v1. It duplicates canon and adds synchronization work before the current Markdown proves insufficient.

## Architecture

### 1. Rust: fixed-domain read snapshot

Add a no-argument Tauri command:

```text
load_plan_workspace
```

It returns:

```ts
type PlanDocumentKind = "storyBible" | "chapterPlan";

type WorkbenchPlanDocument = {
  id: string;                  // story-bible | chapter-<N>-plan
  kind: PlanDocumentKind;
  chapterNumber: number | null;
  path: string;                // repo-relative canonical path
  content: string;             // raw Markdown
};

type WorkbenchPlanWorkspacePayload = {
  documents: WorkbenchPlanDocument[];
};
```

Rules:

- Story Bible is required and returned first.
- Discover only root-level exact `chapter_<positive integer>_plan.md` matches.
- Sort chapter plans numerically.
- Do not descend into playable chapter directories.
- No caller-supplied path.
- `characters.md` is intentionally out of v1; HPA-273 only lists it as optional when useful.

Errors:

- missing Story Bible → `planStoryBibleNotFound`;
- read failure → `planDocumentReadFailed`;
- absent chapter plans are valid.

### 2. TypeScript: one pure Plan projection

Create `apps/layout-editor/src/lib/plan-workspace.ts`.

Use one lightweight Markdown dependency (`marked`) for the existing GFM-like documents. Raw HTML is disabled/escaped. This module owns all Markdown structure used by Plan mode; Svelte components never parse source themselves.

Core output:

```ts
type PlanHeading = {
  level: number;
  text: string;
  anchor: string;
  sourceRef: string;
};

type PlanTable = {
  headers: string[];
  rows: string[][];
  sourceRef: string;           // containing heading
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

Heading anchors are deterministic per document; duplicate headings receive `-1`, `-2`, ... suffixes. Rendering and copied source references use the same slugger.

Source references are always:

```text
<repo-relative path>#<heading anchor>
```

### 3. Strict derived views

#### Chapter overview

Find exact heading `10. 章節總覽` and exact table headers:

```text
章節 | 標題 | 案件類型 | 變體 | 主線誤導
```

Project only those five columns. Current valid output is eight rows, chapters 1→8.

#### Aoba reveal ladder

Find exact heading `18.5 第一幕 reveal ladder` and exact headers:

```text
章節 | 必須建立 | 絕對不能建立
```

Project the authored row values directly. Do not invent `known`, `unknown`, or other generic knowledge states.

Also surface the authored blockquote immediately below Story Bible §18 as the **canon override note**. This is a fixed source callout for this Aoba slice, not a generic conflict-resolution engine.

If either expected table changes:

- raw documents still render;
- the affected derived view is omitted;
- a visible diagnostic explains the mismatch;
- no nearby table or prose is used as fallback.

Initial diagnostics:

```text
chapterOverviewMissing
chapterOverviewInvalid
chapterOverviewUnexpectedRows
aobaRevealLadderMissing
aobaRevealLadderInvalid
```

## Product UX

Add one explicit mode:

```text
Reader | Assets | Plan | Stage
```

No generic mode registry or router.

### Sidebar

When Plan is active, the existing left sidebar shows:

- Overview;
- Story Bible;
- existing chapter plans in numeric order;
- heading outline for the selected Plan document.

Reader/Assets/Stage retain their current scene tree. Entering Plan does not clear scene selection.

### Main Plan view

Two surfaces are enough.

**Overview**

- Story Bible §18 override callout;
- projection diagnostics;
- eight-chapter matrix;
- Aoba reveal timeline;
- Aoba `必須建立 / 絕對不能建立` boundary table.

**Document**

- canonical source path;
- rendered Markdown;
- selected heading scroll/highlight;
- Copy source reference.

`Open source` from Overview selects the Story Bible and scrolls to the source heading.

### Refresh

One explicit Refresh rereads the fixed Plan snapshot. No watcher, polling, persistence, or background sync. Fence overlapping loads with the same generation-counter pattern already used by Reader/Assets.

## Real-content contract

Add `apps/layout-editor/scripts/verify-plan-real-content.ts`, mirroring the existing Reader/Assets projection verifiers.

Against the current repository it checks:

- Story Bible loads;
- Chapter 1 and Chapter 2 plans are discovered;
- chapter overview is exactly 1→8;
- Aoba stages are exactly `第 1 章`, `第 2 章`, `第 3 章`, `第 4 章`, `第 5～7 章`, `第 8 章`;
- no required projection diagnostic is emitted.

Run it in the existing `lint-frontend` CI job after the Reader/Assets real-content checks. Do not create another CI job.

## Implementation surface

```text
apps/layout-editor/src-tauri/src/lib.rs
apps/layout-editor/src/lib/workbench-types.ts
apps/layout-editor/src/lib/workbench-api.ts
apps/layout-editor/src/lib/plan-workspace.ts
apps/layout-editor/src/lib/plan-workspace.test.ts
apps/layout-editor/src/lib/PlanSidebar.svelte
apps/layout-editor/src/lib/PlanSidebar.test.ts
apps/layout-editor/src/lib/PlanView.svelte
apps/layout-editor/src/lib/PlanView.test.ts
apps/layout-editor/src/App.svelte
apps/layout-editor/src/App.test.ts
apps/layout-editor/scripts/verify-plan-real-content.ts
apps/layout-editor/package.json
bun.lock
.github/workflows/ci.yml
```

Do not extract a shared planning package; no second consumer exists.

## Testing

- Rust: fixed-domain discovery/order, nested-scene exclusion, required Bible error, optional chapter plans.
- Projection: headings/duplicate anchors, GFM table extraction, exact chapter/Aoba contracts, no fallback, diagnostics.
- Components: Plan navigation, matrix/timeline/boundary rendering, source navigation/copy, diagnostics + document readability.
- App: fourth mode, Plan-specific sidebar, Refresh stale-response fencing, scene selection preserved across Plan.
- Real content: current Story Bible and chapter plans pass the strict projection.

## Non-goals

- Source editing or AI calls.
- `story-links.yaml` or another canon database.
- Generic story/fact/knowledge graph.
- Chapter 2 map/evidence-board visualization.
- Analysis answer-key preview.
- Character browser.
- Automatic canon reconciliation.
- File watchers/polling.
- Arbitrary path reads.

## Acceptance

HPA-273 is complete when:

- Story Bible/current chapter plans are readable with heading navigation and source references;
- chapter matrix comes only from Story Bible §10;
- Aoba timeline/boundaries come only from Story Bible §18.5;
- the authored §18 override note is visible;
- source drift produces diagnostics instead of inferred replacements;
- Chapter 1 evidence-package/proof-order headings are easy to reach in the document reader;
- Reader, Assets, and Stage remain unchanged;
- the current real-corpus Plan verifier passes;
- all implementation remains in this one PR.

## Required checks

```text
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run --cwd apps/layout-editor test
bun run --cwd apps/layout-editor verify:plan-real-content
bun run scenes:compile
bun run check:scripts
bun run editor:check
bun run editor:build
bun run lint:all
```
