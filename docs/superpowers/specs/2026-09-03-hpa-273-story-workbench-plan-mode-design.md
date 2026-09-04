# HPA-273 Story Workbench Plan Mode Design

## Status

Planning design for **HPA-273 — [Story Workbench] Visualize the Story Bible and reveal progression**.

One ticket, one PR. This PR remains planning-only until implementation starts on the same branch.

## Goal

Add one read-only **Plan** mode that lets an author:

1. browse the canonical Story Bible and current chapter plans;
2. see the authored eight-chapter overview;
3. review the authored Aoba/青葉 reveal ladder and its must-establish / must-not-establish boundaries;
4. navigate long planning documents through a compact heading outline and copy stable source references.

Markdown stays canonical. Plan mode must not invent a second story model to make the UI work.

## Canonical source contract

Plan mode reads only root planning Markdown under `docs/stories_plan/`:

- required: `final_story_bible.md`;
- optional: exact root files matching `chapter_<positive integer>_plan.md`;
- playable `chapter_<N>/` directories are excluded;
- `characters.md` is not required for this v1 slice.

The two derived views use explicit Story Bible structures only.

### Eight-chapter overview

Exact heading:

```text
10. 章節總覽
```

Exact headers:

```text
章節 | 標題 | 案件類型 | 變體 | 主線誤導
```

Do not join §3, §14, or chapter-plan prose to synthesize more columns.

### Aoba reveal / boundary view

Exact addendum heading:

```text
18. Canon Addendum：第一幕青葉提問契約（2026-08-23）
```

Use only the first blockquote after that H1 and before exact `18.1 為什麼需要這個更新` as the override notice.

Exact reveal heading:

```text
18.5 第一幕 reveal ladder
```

Exact headers:

```text
章節 | 必須建立 | 絕對不能建立
```

The same authored rows power both the timeline and player-knowledge boundary display. In v1:

- `必須建立` expresses what should be established at that stage;
- `絕對不能建立` expresses explicit early-reveal prohibition / unresolved boundaries;
- later rows provide the later payoff/confirmation progression.

Do not create a separate four-state knowledge ontology.

Every Aoba row exposes a source action back to Story Bible §18.5. The same section anchor is correct for every row because that table is their canonical source. Do not add per-row chapter-plan links or a relationship sidecar merely for finer navigation.

## Architecture

```text
planning Markdown
    ↓
load_plan_workspace          Rust fixed-domain snapshot
    ↓
projectPlanWorkspace         Marked + strict TS projection
    ↓
plan-store.svelte.ts         Plan-only load/selection state
    ↓
PlanSidebar / PlanView
    ↓
App.svelte                   fourth-mode wiring only
```

### Why this shape

- `WorkbenchIndex` stays playable-scene-only; planning Markdown does not enter Reader/Assets/Stage navigation.
- Rust owns filesystem/domain boundaries; TypeScript owns Markdown projection and presentation semantics.
- `marked` is justified because the existing scene tokenizer does not parse GFM tables or render Markdown and the plans contain fenced blocks.
- Plan uses a dedicated rune store because its fixed snapshot must be shared by sidebar and detail slots; adding more Plan `$state` fields to the already-large `App.svelte` is unnecessary.
- No `story-links.yaml`, graph model, watcher, arbitrary path read, source editing, or AI is added.

## Rust boundary

Add one no-argument Tauri command:

```text
load_plan_workspace
```

Reuse existing `workspace_root()` and `read_text_source()`.

If useful, rename the internal Rust `AssetWorkspaceTextSource` struct to `WorkbenchTextSource`; serialized Assets data remains `{ path, content }`.

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

- Story Bible is first and required.
- Root chapter plans are numerically sorted.
- `chapter_0_plan.md`, malformed names, directories, symlinks, and nested playable Markdown are ignored.
- Missing Story Bible maps to `planStoryBibleNotFound`.
- Other reads preserve existing `notFound` / `readFailed` behavior.
- `id`, `kind`, and `chapterNumber` are derived in one Rust constructor/helper.

Directory-entry and discovered-file read errors must be propagated by implementation; do not add filesystem mocking or permission tricks solely to manufacture those rare failures in tests.

## TypeScript projection

Create `apps/layout-editor/src/lib/plan-workspace.ts`.

### Markdown rendering and heading identity

Use one Marked token tree per document for both extraction and rendering.

Heading rules:

- `PlanHeading.text` is plain display text derived from inline tokens, not raw Markdown markers;
- anchors keep Unicode letters/numbers, `_`, `-`, convert whitespace to `-`, strip punctuation, lowercase Latin/ASCII;
- duplicate anchors are suffixed `-1`, `-2`, ... using a per-document `seen` map;
- `planAnchor()` is deterministic for a given heading sequence but mutates that `seen` map;
- anchors are stable against Marked/plugin changes, not against inserting/reordering earlier duplicate headings.

Bind renderer IDs to the actual `Tokens.Heading` identity (for example with a `WeakMap`) rather than consuming a precomputed heading array by index. Nested headings must not shift later anchors.

Plan stores bare anchors because they are DOM IDs. Reader's existing `sourceAnchor` includes `#`; only the path/anchor ownership principle is shared.

```ts
function planSourceRef(path: string, anchor: string | null): string {
  return anchor ? `${path}#${anchor}` : path;
}
```

Raw Markdown HTML is not emitted verbatim. Override Marked's HTML renderer and escape raw HTML before the generated document string reaches Svelte `{@html}`. Do not add a sanitizer or heading plugin framework for repository-authored planning files.

### Public projection model

```ts
import type { CompileError } from "@lyra/scripts/compile-scenes/types";

type PlanDiagnosticCode =
  | "chapterOverviewMissing"
  | "chapterOverviewInvalid"
  | "chapterOverviewUnexpectedRows"
  | "aobaRevealLadderMissing"
  | "aobaRevealLadderInvalid";

type PlanDiagnostic = CompileError & { code: PlanDiagnosticCode };

type PlanHeading = {
  level: number;
  text: string;
  anchor: string;
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

There is no public generic `PlanTable[]` model.

### Drift behavior

- missing exact §10 → `chapterOverviewMissing`;
- malformed/missing exact §10 table → `chapterOverviewInvalid`;
- projected §10 chapter sequence other than exactly `1..8` → `chapterOverviewUnexpectedRows`, while authored rows remain visible;
- missing exact §18.5 → `aobaRevealLadderMissing`;
- malformed/missing exact §18.5 table → `aobaRevealLadderInvalid`.

Raw documents remain readable when a derived view fails. No nearby-table or prose fallback is allowed.

## Plan state

Create `apps/layout-editor/src/lib/plan-store.svelte.ts` with only Plan state:

```text
workspace
error
loading
surface: overview | document
selectedDocumentId
selectedAnchor
```

It owns:

```text
ensurePlanLoaded()
refreshPlan()
showPlanOverview()
selectPlanDocument(id)
selectPlanHeading(id, anchor)
navigatePlanSource(id, anchor)
```

Use a generation counter so stale refreshes cannot overwrite newer results. After refresh, preserve the selected document/anchor only when they still exist; otherwise fall back to Story Bible / no anchor.

Reuse `normalizeError()`. Do not introduce a generic mode store.

## Product UX

Add the explicit mode order:

```text
Reader | Assets | Plan | Stage
```

### Sidebar

Plan replaces the scene tree only while Plan mode is active.

Show:

- Overview;
- Story Bible;
- current chapter plans in numeric order;
- selected document outline.

The outline defaults to H1/H2 (`level <= 2`) because the real documents contain hundreds of headings. A local `Show all levels` toggle reveals H3+; no persisted preference or tree library.

This makes the real acceptance targets directly reachable:

- Chapter 1: `1. 全章前台證據包`;
- Chapter 2: `12. 最終審查會 Proof Order`.

Chapter 1 has proof-order guidance in prose but no dedicated Proof Order heading; Plan must not invent one.

### Overview

Show:

1. §18 override callout;
2. Plan diagnostics;
3. eight-chapter matrix;
4. Aoba reveal timeline;
5. Aoba boundary table.

The matrix remains a Story Bible overview; document navigation stays in the sidebar. Do not add row → chapter-plan navigation in v1.

Each Aoba row has an `Open source` action to Story Bible §18.5. Collection-level source actions may also jump to §10 / §18.5.

### Document

Show:

- repo-relative source path;
- rendered Markdown;
- selected-heading scroll/highlight;
- Copy source reference through `planSourceRef()`.

The single `{@html}` site receives a scoped `svelte/no-at-html-tags` exception explaining that repository-authored Markdown is rendered after raw HTML escaping. Task-local verification must lint the changed Plan files immediately rather than waiting for the final whole-repo gate.

Do not extract a shared `DiagnosticList.svelte` in this ticket. Reuse the diagnostic type; leave the existing Assets markup untouched.

## Real-corpus gate

Add `apps/layout-editor/scripts/verify-plan-real-content.ts` and run it in the existing `lint-frontend` CI job.

The verifier constructs its payload from exactly:

```text
docs/stories_plan/final_story_bible.md
docs/stories_plan/chapter_1_plan.md
docs/stories_plan/chapter_2_plan.md
```

Keep repo-relative `path` values separate from resolved filesystem read paths.

It verifies:

- Story Bible and Chapter 1/2 documents project with the expected source identities;
- Story Bible `10. 章節總覽` anchors to `10-章節總覽`;
- chapter sequence is exactly `1..8`;
- Aoba stage labels are exactly `第 1 章`, `第 2 章`, `第 3 章`, `第 4 章`, `第 5～7 章`, `第 8 章`;
- the override contains `以本節為準` and not the later `青葉火災已經結案` quote;
- expected §10 and §18.5 cells survive inside rendered `<table>` HTML;
- no Plan diagnostics are emitted.

Rust tests own directory discovery; the verifier must not reimplement it.

## Acceptance

HPA-273 is complete when:

- Story Bible/current chapter plans are readable with compact heading navigation and copyable source references;
- the eight-chapter matrix comes only from Story Bible §10;
- the Aoba timeline/boundaries come only from Story Bible §18.5 and each row can open that source section;
- the first §18 override blockquote is visible;
- authored drift produces diagnostics rather than inferred replacements;
- Chapter 1 `1. 全章前台證據包` and Chapter 2 `12. 最終審查會 Proof Order` are directly reachable;
- Reader, Assets, and Stage behavior remain unchanged;
- implementation stays in this one PR and the real-corpus gate passes.

## Non-goals

- source editing or AI;
- `story-links.yaml`, generic graph/knowledge model, or relationship database;
- Chapter 2 map/evidence-board visualization;
- Analysis hidden-answer preview;
- character browser;
- automatic canon reconciliation;
- watcher/polling;
- arbitrary path reads;
- generic diagnostics framework;
- row → chapter-plan navigation.

## Required checks

```text
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml
bun run --cwd apps/layout-editor test
bun run scenes:compile
bun run --cwd apps/layout-editor verify:reader-real-content
bun run --cwd apps/layout-editor verify:asset-real-content
bun run --cwd apps/layout-editor verify:plan-real-content
bun run check:scripts
bun run editor:check
bun run editor:build
bun run lint:all
```
