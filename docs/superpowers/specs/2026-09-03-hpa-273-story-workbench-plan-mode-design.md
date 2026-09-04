# HPA-273 Story Workbench Plan Mode Design

## Status

Planning design for **HPA-273 — [Story Workbench] Visualize the Story Bible and reveal progression**.

One ticket, one PR. This PR starts with planning; implementation continues on this same branch after review.

## Goal

Add one read-only **Plan** mode so an author can:

1. browse the canonical Story Bible and existing chapter plans;
2. see the authored eight-chapter overview at a glance;
3. follow the authored Aoba/青葉 reveal progression;
4. see what each Aoba stage must establish and must not establish yet;
5. jump from structured Story Bible rows to the corresponding chapter plan when that plan exists.

Do not create a second story model merely to visualize information already written in Markdown.

## Why this is next

HPA-639 defines the Story Workbench order as:

```text
Reader + Stage  →  Assets  →  Plan  →  Focused edits  →  AI review
HPA-634            HPA-134    HPA-273   HPA-135          HPA-136
```

HPA-634 and HPA-134 are complete. HPA-273 is unblocked while Chapter 2 implementation remains deferred. Finishing Plan also removes one of HPA-136's remaining blockers.

## Current source contracts

Canonical planning files are root-level Markdown under `docs/stories_plan/`:

- required: `final_story_bible.md`;
- optional/current: exact files matching `chapter_<positive integer>_plan.md`;
- playable `chapter_<N>/` scene directories stay outside Plan mode.

The current Story Bible already contains the two structures HPA-273 needs.

### Eight-chapter matrix

`# 10. 章節總覽` contains exactly:

```text
章節 | 標題 | 案件類型 | 變體 | 主線誤導
```

This exact table is the v1 chapter-matrix source. Do **not** join §3 theme data, §14 duration data, or per-chapter prose just to create more columns.

### Aoba reveal/boundary view

`# 18. Canon Addendum：第一幕青葉提問契約（2026-08-23）` explicitly says it overrides conflicting older sections.

The **first blockquote after that H1 and before `## 18.1`** is the v1 override notice. Do not collect later blockquotes in the addendum.

`## 18.5 第一幕 reveal ladder` contains exactly:

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
projectPlanWorkspace         # TS: Marked + exact source contracts
    ↓
plan-store.svelte.ts         # Plan-only load/selection state
    ↓
PlanSidebar / PlanView
```

This keeps Markdown authoritative, keeps playable scenes separate, turns source drift into diagnostics rather than guesses, and keeps Plan state out of the already-large `App.svelte`.

### B. Add planning nodes to `WorkbenchIndex`

Rejected. `WorkbenchIndex` is the existing playable-scene navigation contract used by Reader/Assets/Stage. Mixing uncompiled planning docs into it creates unnecessary unions and coupling.

### C. Add `story-links.yaml` / generic graph data

Rejected for v1. It duplicates canon and adds synchronization work before the current Markdown proves insufficient.

### D. Keep all Plan state in `App.svelte`

Rejected after review. Reader state belongs in `App.svelte` because it is driven by shared scene selection and chapter/scene cache ownership. Plan is a no-argument fixed snapshot closer to Assets. The only cross-layout requirement is sharing Plan state between the sidebar and detail pane, and the repo already has a module-level rune-store pattern in `layout-store.svelte.ts`.

Use one Plan-specific store rather than adding seven more `$state` fields and generation bookkeeping to `App.svelte`.

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

`id`, `kind`, and `chapterNumber` are related wire fields. Keep them because they serve different frontend needs (stable key, document semantics, numeric ordering/navigation), but derive them in **one Rust constructor/helper** so there is only one author of that relationship.

### 2. TypeScript: one pure Plan projection owner

Create `apps/layout-editor/src/lib/plan-workspace.ts`.

Use one lightweight Markdown dependency (`marked`) for the existing GFM-like planning files. The compiler tokenizer is deliberately not reused: it is a scene dialect and does not own GFM tables or HTML rendering; the current plans also contain fenced blocks that a naïve heading line scanner must not misread.

Do not add a heading-ID plugin or a sanitizer framework.

Repository planning Markdown is trusted author input, but raw Markdown HTML is still disabled explicitly: override Marked's `renderer.html` to return escaped text instead of verbatim HTML before Svelte renders the generated document HTML.

#### Heading display text

`PlanHeading.text` is **plain display text**, not the raw Markdown heading string. Derive it from the heading's inline tokens so headings such as:

```text
## 18.6 `ZW_A16.lock` 與青葉...
```

appear in the sidebar without literal backticks/emphasis markers. The same plain text is the input to Plan anchor generation.

#### Heading anchors: one pinned, stateful per-document algorithm

Anchor behavior is a Plan-owned stable contract, not a Marked/plugin default.

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

`planAnchor()` mutates its per-document `seen` map; it is deterministic for a given heading sequence, but it is **not** a mathematically pure function. Document that explicitly rather than calling it pure.

This contract prevents a Marked/plugin upgrade from silently changing Plan anchors. It does **not** make copied anchors permanent across content edits: inserting an earlier duplicate heading can renumber later `-N` suffixes.

#### Renderer binding: token identity, never array index

Do not precompute one heading array and later consume it with `headings[headingIndex++]` in a separate parser traversal. Nested headings inside blockquotes/lists can make those traversal orders diverge.

Instead:

1. recursively walk the actual Marked token tree in document order;
2. when a `heading` token is encountered, derive its plain text + anchor;
3. store the anchor by that exact heading token identity, e.g. `WeakMap<Tokens.Heading, string>`;
4. render the **same token array** with `marked.parser(tokens, { renderer })`;
5. `renderer.heading` looks up the anchor using the heading token it receives.

A projection test must include a nested heading followed by a top-level heading and prove neither anchor shifts or becomes undefined.

The exact §10 / §18 source contracts are top-level authored sections, so diagnostic line calculation may continue to use top-level token start lines; nested outline headings do not need a public line field.

#### Source-reference composition: one helper

Keep path and anchor separate in the public projection.

```ts
export function planSourceRef(path: string, anchor: string | null): string {
  return anchor ? `${path}#${anchor}` : path;
}
```

Plan stores **bare anchors** because they double as DOM `id`s. This differs intentionally from Reader, whose `sourceAnchor` already includes the leading `#`. The ownership principle is shared (path and anchor stay separate); the literal anchor representation is not identical.

Do not store fused `sourceRef` strings on headings, tables, or every derived row.

#### Public projection shape

Reuse the existing compiler diagnostic type directly rather than copying its fields:

```ts
import type { CompileError } from "@lyra/scripts/compile-scenes/types";

type PlanDiagnosticCode =
  | "chapterOverviewMissing"
  | "chapterOverviewInvalid"
  | "chapterOverviewUnexpectedRows"
  | "aobaRevealLadderMissing"
  | "aobaRevealLadderInvalid";

type PlanDiagnostic = CompileError & {
  code: PlanDiagnosticCode;
};

type PlanHeading = {
  level: number;
  text: string;                // plain display text
  anchor: string;              // bare DOM/source anchor
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

type PlanWorkspace = {
  documents: ParsedPlanDocument[];
  chapterOverview: { anchor: string; rows: ChapterOverviewRow[] } | null;
  aobaReveal: { anchor: string; stages: AobaRevealStage[] } | null;
  aobaOverrideNotice: { anchor: string; text: string } | null;
  diagnostics: PlanDiagnostic[];
};
```

This reuses `CompileError` as a structural type only; compiler validation policy is not run or imported into Plan projection behavior.

Do **not** expose `PlanTable[]` on `ParsedPlanDocument`. Tables are local extraction input for the two derived views; the Document view already owns rendered Markdown.

### 3. Strict derived views

#### Chapter overview

Find exact heading `10. 章節總覽` and exact table headers:

```text
章節 | 標題 | 案件類型 | 變體 | 主線誤導
```

Project only those five columns and store the containing heading anchor once on `chapterOverview`.

The authored story contract is chapters `1` through `8`, in order. If the exact table/header exists but its chapter cells are not exactly:

```text
1, 2, 3, 4, 5, 6, 7, 8
```

emit `chapterOverviewUnexpectedRows`. Keep the extracted rows visible so the author can inspect the drift; the diagnostic makes the mismatch loud and the real-corpus gate rejects it.

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
- the affected derived view is omitted only when its section/table shape cannot be projected;
- a visible diagnostic explains the mismatch;
- no nearby table or prose is used as fallback.

### 4. Plan state: dedicated rune store

Create `apps/layout-editor/src/lib/plan-store.svelte.ts`.

It owns only Plan state:

```ts
type PlanSurface = "overview" | "document";

planState = {
  workspace,
  error,
  loading,
  surface,
  selectedDocumentId,
  selectedAnchor,
};
```

It also owns the load generation counter and functions for:

```text
ensurePlanLoaded()
refreshPlan()
showPlanOverview()
selectPlanDocument(id)
selectPlanHeading(id, anchor)
navigatePlanSource(id, anchor)
```

`refreshPlan()` uses the same generation-fence pattern already established by Assets/Stage. Reconcile selection after refresh:

- preserve the selected document when it still exists;
- preserve the selected anchor only when that heading still exists;
- otherwise fall back to `story-bible` / no selected anchor.

The store may reuse the existing `normalizeError()` helper; do not add an error framework.

`PlanSidebar` and `PlanView` remain presentation components. `App.svelte` reads the shared Plan store and passes state/callbacks to both layout slots; the components do not load files or parse Markdown themselves.

### 5. Product UX

Add one explicit mode:

```text
Reader | Assets | Plan | Stage
```

No generic mode registry or router.

#### Sidebar

When Plan is active, the existing left sidebar shows:

- Overview;
- Story Bible;
- existing chapter plans in numeric order;
- heading outline for the selected Plan document.

The current Bible/chapter plans contain hundreds of headings, so a flat all-level outline is not useful navigation. Default the outline to **H1/H2 (`level <= 2`) only**. Add one local `Show all levels` toggle in `PlanSidebar` to reveal H3+ when needed. No tree library or persisted preference.

The acceptance targets are both H2, so the default outline keeps them directly reachable:

- Chapter 1: `1. 全章前台證據包`;
- Chapter 2: `12. 最終審查會 Proof Order`.

Reader/Assets/Stage retain their current scene tree. Entering Plan does not clear scene selection.

#### Overview

Show, in order:

1. Story Bible §18 override callout;
2. projection diagnostics;
3. eight-chapter matrix;
4. Aoba reveal timeline;
5. Aoba `必須建立 / 絕對不能建立` boundary table.

Structured rows should do something the raw Document view cannot:

- each §10 matrix row links to the matching `chapterNumber` plan document when that document exists; otherwise it stays plain text;
- an Aoba stage label matching exact single-chapter form `第 N 章` links to that chapter plan when it exists;
- range labels such as `第 5～7 章` stay plain text rather than inventing multi-document behavior.

`Open source` still jumps back to the exact Story Bible section that authored the derived view.

#### Diagnostics UI

Plan diagnostics render locally in `PlanView` using the same simple visual convention (`code: message`, source file/line) as Assets.

**Do not extract a shared `DiagnosticList.svelte` in this ticket.** The existing Assets markup is roughly a dozen lines, changing Assets solely to share that presentation would widen the regression surface, and Plan wants source file/line while current Assets markup does not. Reusing the diagnostic **type** is valuable; abstracting this tiny UI after only two slightly different consumers is not.

#### Document

Show:

- canonical source path;
- rendered Markdown;
- selected heading scroll/highlight;
- Copy source reference composed with `planSourceRef(document.path, anchor)`.

Rendering uses `{@html}` only for `renderedHtml` produced by the Plan projection. The repo enables `svelte/no-at-html-tags` through the recommended ESLint config, so put one **scoped `eslint-disable-next-line svelte/no-at-html-tags`** immediately at that render site with a justification: repository-authored Markdown, raw HTML escaped by the Plan renderer. Do not disable the rule for the file or repo.

Task-level verification must run `bun run lint` when this view is introduced; do not wait until final `lint:all` to discover a rendering-rule failure.

#### Refresh

One explicit Refresh rereads the fixed Plan snapshot. No watcher, polling, persistence, or background sync. The Plan store owns stale-response fencing and selection reconciliation.

## Real-content contract

Add `apps/layout-editor/scripts/verify-plan-real-content.ts`, mirroring the existing Reader/Assets projection verifiers.

The verifier intentionally does **not** duplicate Rust directory discovery. Construct its payload from the explicit current canonical files:

```text
docs/stories_plan/final_story_bible.md
docs/stories_plan/chapter_1_plan.md
docs/stories_plan/chapter_2_plan.md
```

Keep repo-relative source identity separate from filesystem reads:

```ts
const BIBLE_PATH = "docs/stories_plan/final_story_bible.md";
const content = readFileSync(resolve(repoRoot, BIBLE_PATH), "utf8");
// payload.path remains BIBLE_PATH
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
apps/layout-editor/src/lib/plan-store.svelte.ts
apps/layout-editor/src/lib/plan-store.test.ts
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

Do not extract a shared planning package or generic diagnostics component.

## Testing

- Rust: reuse `read_text_source`; fixed-domain discovery/order, nested-scene exclusion, required Bible error, optional chapter plans, one constructor for document identity fields.
- Projection: plain heading display text; pinned `planAnchor`; `planSourceRef`; duplicate anchors; nested-heading token-identity binding; GFM table extraction; exact chapter/Aoba contracts; `chapterOverviewUnexpectedRows`; exact first §18 blockquote; no fallback; `CompileError`-based diagnostics.
- Plan store: first-load ownership, refresh generation fence, selection/anchor reconciliation, source navigation.
- Components: H1/H2 outline default + show-all toggle, matrix/timeline/boundary rendering, row→chapter navigation, source navigation/copy, diagnostics + document readability, scoped `{@html}` lint exception.
- App: fourth mode, Plan-specific sidebar/detail branch, selected gameplay scene preserved across Plan. Snapshot/fence behavior is tested at the Plan store, not repeated through the large App invoke harness.
- Real content: explicit Bible + Chapter 1/2 files, repo-relative source paths, exact rows/anchors, and rendered GFM-table smoke.

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
- Permanent source anchors across future heading insertion/reordering.
- Generic diagnostics component extraction.

## Acceptance

HPA-273 is complete when:

- Story Bible/current chapter plans are readable with heading navigation and source references;
- chapter matrix comes only from Story Bible §10 and diagnoses any departure from chapters 1→8;
- Aoba timeline/boundaries come only from Story Bible §18.5;
- the first authored §18 override blockquote is visible;
- source drift produces `CompileError`-shaped Plan diagnostics instead of inferred replacements;
- available chapter plans are reachable from corresponding structured overview rows;
- default outline keeps H1/H2 manageable and can expand to all levels;
- Chapter 1 outline can navigate directly to `1. 全章前台證據包`;
- Chapter 2 outline can navigate directly to `12. 最終審查會 Proof Order`;
- Reader, Assets, and Stage remain behaviorally unchanged;
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
