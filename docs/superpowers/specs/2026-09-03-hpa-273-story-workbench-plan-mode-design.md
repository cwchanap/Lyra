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

The **first blockquote after that H1 and before `## 18.1`** is the v1 override notice. Do not collect later blockquotes in the addendum.

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

Reuse the existing `read_text_source()` filesystem boundary rather than adding Plan-specific file reading. Its `{ path, content }` wire shape is already represented in TypeScript as `WorkbenchTextSource`.

If needed, rename the Rust-only `AssetWorkspaceTextSource` struct to `WorkbenchTextSource`; preserve the serialized `{ path, content }` shape used by Assets.

Frontend wire shape:

```ts
type PlanDocumentKind = "storyBible" | "chapterPlan";

type WorkbenchPlanDocument = WorkbenchTextSource & {
  id: string;                  // story-bible | chapter-<N>-plan
  kind: PlanDocumentKind;
  chapterNumber: number | null;
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

- missing required Story Bible → map the existing `notFound` read to `planStoryBibleNotFound`;
- other file I/O keeps existing `notFound` / `readFailed` behavior from `read_text_source()`;
- absent chapter plans are valid.

Do not add a parallel `planDocumentReadFailed` family.

### 2. TypeScript: one pure Plan projection

Create `apps/layout-editor/src/lib/plan-workspace.ts`.

Use one lightweight Markdown dependency (`marked`) for the existing GFM-like planning files. The compiler tokenizer is deliberately not reused: it is a scene dialect and does not own GFM tables or HTML rendering.

Use a per-document `Marked` renderer/token pass; do not add a heading-ID plugin or a sanitizer framework.

Repository planning Markdown is trusted author input, but raw HTML is still disabled explicitly: override Marked's `renderer.html` to return escaped text instead of verbatim HTML before `{@html}` rendering.

#### Heading anchors: one pinned algorithm

Anchor behavior is a Plan-owned stable contract, not a Marked/plugin default.

Expose one pure helper:

```ts
export function planAnchor(text: string, seen: Map<string, number>): string;
```

Rules:

1. trim and lowercase ASCII/Latin text;
2. keep Unicode letters/numbers including CJK plus `_` and `-`;
3. strip other punctuation;
4. convert each whitespace run to one `-`;
5. first occurrence is unsuffixed; duplicates become `-1`, `-2`, ... .

Example:

```text
10. 章節總覽  →  10-章節總覽
重複          →  重複, 重複-1, 重複-2
```

The same helper feeds both rendered heading IDs and heading extraction. A future Marked major or plugin choice therefore cannot silently change copied Plan anchors.

#### Source-reference composition: one helper

Keep path and anchor separate in the public projection, matching Reader's existing `sourcePath + sourceAnchor` ownership.

```ts
export function planSourceRef(path: string, anchor: string | null): string {
  return anchor ? `${path}#${anchor}` : path;
}
```

Do not store fused `sourceRef` strings on headings, tables, or every derived row.

#### Public projection shape

```ts
type PlanHeading = {
  level: number;
  text: string;
  anchor: string;
  line: number;
};

type ParsedPlanDocument = WorkbenchPlanDocument & {
  renderedHtml: string;
  headings: PlanHeading[];
};

type ChapterOverviewRow = {
  chapter: string;
  title: string;
  caseType: string;
  variant: string;
  mainMisdirection: string;
};

type AobaRevealStage = {
  chapterLabel: string;
  mustEstablish: string;
  mustNotEstablish: string;
};

type PlanDiagnostic = {
  code:
    | "chapterOverviewMissing"
    | "chapterOverviewInvalid"
    | "chapterOverviewUnexpectedRows"
    | "aobaRevealLadderMissing"
    | "aobaRevealLadderInvalid";
  message: string;
  sourceFile: string;
  line: number;
};

type PlanWorkspace = {
  documents: ParsedPlanDocument[];
  chapterOverview: { anchor: string; rows: ChapterOverviewRow[] } | null;
  aobaReveal: { anchor: string; stages: AobaRevealStage[] } | null;
  aobaOverrideNotice: { anchor: string; text: string } | null;
  diagnostics: PlanDiagnostic[];
};
```

`PlanDiagnostic` deliberately reuses the repository's existing `{ code, message, sourceFile, line }` diagnostic field shape while keeping Plan's code union independent from compiler validation policy.

Line numbers come from the same top-level Marked token walk: accumulate each token's `raw` newline count and record the starting line for headings/tables. Missing-section diagnostics use line 1; malformed-section diagnostics use the owning heading/table line.

Do **not** expose `PlanTable[]` on `ParsedPlanDocument`. Tables are local extraction input for the two derived views; the Document view already owns rendered Markdown.

### 3. Strict derived views

#### Chapter overview

Find exact heading `10. 章節總覽` and exact table headers:

```text
章節 | 標題 | 案件類型 | 變體 | 主線誤導
```

Project only those five columns. Current valid output is eight rows, chapters 1→8. Store the heading anchor once on `chapterOverview`, not on every row.

#### Aoba reveal ladder

Find exact heading `18.5 第一幕 reveal ladder` and exact headers:

```text
章節 | 必須建立 | 絕對不能建立
```

Project the authored row values directly. Do not invent `known`, `unknown`, or other generic knowledge states. Store the heading anchor once on `aobaReveal`.

#### Aoba override notice

Find exact H1:

```text
18. Canon Addendum：第一幕青葉提問契約（2026-08-23）
```

Take only the **first blockquote token after that H1 and before exact `18.1 為什麼需要這個更新`**. The current contract is expected to contain `以本節為準`; later addendum blockquotes are not part of this callout.

If either expected table changes:

- raw documents still render;
- the affected derived view is omitted;
- a visible diagnostic explains the mismatch;
- no nearby table or prose is used as fallback.

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
- Copy source reference composed with `planSourceRef(document.path, anchor)`.

`Open source` from Overview selects the Story Bible and scrolls to the derived view's stored heading anchor.

### Refresh

One explicit Refresh rereads the fixed Plan snapshot. No watcher, polling, persistence, or background sync. Fence overlapping loads with the same generation-counter pattern already used by Reader/Assets.

## Real-content contract

Add `apps/layout-editor/scripts/verify-plan-real-content.ts`, mirroring the existing Reader/Assets projection verifiers.

The verifier intentionally does **not** duplicate Rust directory discovery. Construct the payload from the explicit current canonical files:

```text
docs/stories_plan/final_story_bible.md
docs/stories_plan/chapter_1_plan.md
docs/stories_plan/chapter_2_plan.md
```

Rust fixture tests own numeric discovery and nested-file exclusion.

Against the current repository the verifier checks:

- Story Bible + Chapter 1/2 plan payloads project;
- Story Bible heading `10. 章節總覽` anchors to `10-章節總覽`;
- chapter overview is exactly 1→8;
- Aoba stages are exactly `第 1 章`, `第 2 章`, `第 3 章`, `第 4 章`, `第 5～7 章`, `第 8 章`;
- the override notice contains `以本節為準` and not the later `青葉火災已經結案` blockquote;
- Story Bible `renderedHtml` contains a `<table>...</table>` containing `雨鐘咖啡館殺人事件`;
- Story Bible `renderedHtml` contains a `<table>...</table>` containing the §18.5 Chapter 1 text `「2016 年青葉記憶研究所火災」名稱`;
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

- Rust: reuse `read_text_source`; fixed-domain discovery/order, nested-scene exclusion, required Bible error, optional chapter plans.
- Projection: pinned `planAnchor`, `planSourceRef`, duplicate anchors, GFM table extraction, exact chapter/Aoba contracts, exact first §18 blockquote, no fallback, existing-shape diagnostics.
- Components: Plan navigation, matrix/timeline/boundary rendering, source navigation/copy, diagnostics + document readability.
- App: fourth mode, Plan-specific sidebar, Refresh stale-response fencing, scene selection preserved across Plan.
- Real content: explicit Bible + Chapter 1/2 files, exact rows/anchors, and rendered GFM-table smoke.

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
- the first authored §18 override blockquote is visible;
- source drift produces existing-shape diagnostics instead of inferred replacements;
- Chapter 1 outline can navigate directly to `1. 全章前台證據包`;
- Chapter 2 outline can navigate directly to `12. 最終審查會 Proof Order`;
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