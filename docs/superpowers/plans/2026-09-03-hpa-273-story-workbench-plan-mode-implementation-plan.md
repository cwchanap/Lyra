# HPA-273 Story Workbench Plan Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Story Workbench Plan mode that browses canonical planning Markdown, projects the explicit eight-chapter overview, and visualizes the authored Aoba reveal/boundary ladder without creating a second story model.

**Architecture:** Rust returns one fixed-domain planning snapshot by extending the existing text-source reader. TypeScript uses Marked plus a Plan-owned anchor helper to derive only two exact Story Bible tables and one exact override blockquote. Svelte adds a Plan-specific sidebar and Overview/Document view while preserving Reader/Assets/Stage scene state.

**Tech Stack:** Rust, Tauri 2, Svelte 5, TypeScript, Vitest, Testing Library, Bun, `marked`.

**Spec:** `docs/superpowers/specs/2026-09-03-hpa-273-story-workbench-plan-mode-design.md`

## Global Constraints

- One ticket, one PR.
- Story Markdown remains canonical.
- Matrix source: Story Bible `# 10. 章節總覽` only.
- Aoba source: Story Bible `## 18.5 第一幕 reveal ladder` only.
- Override callout: first blockquote after Story Bible `# 18` and before `## 18.1` only.
- Source drift → existing-shape diagnostic; never prose/table inference.
- Keep path and anchor separate; compose copy text through `planSourceRef()`.
- No public generic table model.
- No write path, AI, graph sidecar, Chapter 2 map visualization, watcher, or arbitrary path read.
- Reader/Assets/Stage behavior and selection remain intact.

---

## Task 1: Add a fixed-domain Plan snapshot by reusing text-source I/O

**Files**

- Modify `apps/layout-editor/src-tauri/src/lib.rs`
- Modify `apps/layout-editor/src/lib/workbench-types.ts`
- Modify `apps/layout-editor/src/lib/workbench-api.ts`

**Consumes**

- existing `workspace_root()`;
- existing `read_text_source()`;
- existing frontend `WorkbenchTextSource`.

**Produces**

```text
load_plan_workspace()
load_plan_workspace_at_root(root)
WorkbenchPlanWorkspacePayload
loadPlanWorkspace()
```

- [ ] **1. Write failing Rust tests**

Add tests beside the current Workbench/Assets fixtures:

```rust
#[test]
fn plan_workspace_reads_bible_then_numeric_chapter_plans() {
    let root = temp_workbench_root();
    fs::write(root.join("docs/stories_plan/final_story_bible.md"), "# Bible\n").unwrap();
    fs::write(root.join("docs/stories_plan/chapter_10_plan.md"), "# Ten\n").unwrap();
    fs::write(root.join("docs/stories_plan/chapter_2_plan.md"), "# Two\n").unwrap();

    let snapshot = load_plan_workspace_at_root(&root).unwrap();
    assert_eq!(
        snapshot.documents.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(),
        vec!["story-bible", "chapter-2-plan", "chapter-10-plan"]
    );
    assert_eq!(snapshot.documents[1].source.path, "docs/stories_plan/chapter_2_plan.md");
}

#[test]
fn plan_workspace_ignores_nested_playable_markdown() {
    let root = temp_workbench_root();
    fs::write(root.join("docs/stories_plan/final_story_bible.md"), "# Bible\n").unwrap();
    fs::write(root.join("docs/stories_plan/chapter_1/scene_a.md"), "# Scene\n").unwrap();
    assert_eq!(load_plan_workspace_at_root(&root).unwrap().documents.len(), 1);
}

#[test]
fn plan_workspace_maps_missing_required_bible_only() {
    let root = temp_workbench_root();
    assert_eq!(
        load_plan_workspace_at_root(&root).unwrap_err().code,
        "planStoryBibleNotFound"
    );

    fs::write(root.join("docs/stories_plan/final_story_bible.md"), "# Bible\n").unwrap();
    assert_eq!(load_plan_workspace_at_root(&root).unwrap().documents.len(), 1);
}
```

Also add one source-contract assertion or fixture that an ordinary discovered-file read failure stays on the existing `notFound` / `readFailed` family rather than introducing `planDocumentReadFailed`.

- [ ] **2. Confirm RED**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml plan_workspace -- --nocapture
```

Expected: compile failure because Plan types/helper do not exist.

- [ ] **3. Generalize the existing Rust text-source type, not its behavior**

Rename the internal asset-specific wire struct once:

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchTextSource {
    path: String,
    content: String,
}
```

Update the existing Assets config-source fields and `read_text_source()` return type to use this name. Serialized Assets payload remains exactly `{ path, content }`.

- [ ] **4. Add Plan wire structs over that source**

```rust
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
enum PlanDocumentKind {
    StoryBible,
    ChapterPlan,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchPlanDocument {
    id: String,
    kind: PlanDocumentKind,
    chapter_number: Option<u32>,
    #[serde(flatten)]
    source: WorkbenchTextSource,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchPlanWorkspace {
    documents: Vec<WorkbenchPlanDocument>,
}
```

Parse only exact root filenames, without a regex dependency:

```rust
fn chapter_plan_number(name: &str) -> Option<u32> {
    let raw = name.strip_prefix("chapter_")?.strip_suffix("_plan.md")?;
    let number = raw.parse::<u32>().ok()?;
    (number > 0).then_some(number)
}
```

- [ ] **5. Implement the fixed-domain loader through `read_text_source()`**

`load_plan_workspace_at_root()` must:

1. normalize the root once;
2. call `read_text_source()` for `docs/stories_plan/final_story_bible.md`;
3. map only that required file's `notFound` to `planStoryBibleNotFound`;
4. call `read_dir(docs/stories_plan)` once;
5. retain only regular root files accepted by `chapter_plan_number()`;
6. sort them by numeric chapter number;
7. call `read_text_source()` for each discovered chapter plan, preserving ordinary `notFound` / `readFailed` errors;
8. return Story Bible first.

Expose no path argument:

```rust
#[tauri::command]
fn load_plan_workspace() -> Result<WorkbenchPlanWorkspace, EditorError> {
    let root = workspace_root()?;
    load_plan_workspace_at_root(&root)
}
```

Register it in `tauri::generate_handler!`.

- [ ] **6. Add frontend wire types/API by extending `WorkbenchTextSource`**

`workbench-types.ts`:

```ts
export type PlanDocumentKind = "storyBible" | "chapterPlan";

export type WorkbenchPlanDocument = WorkbenchTextSource & {
  id: string;
  kind: PlanDocumentKind;
  chapterNumber: number | null;
};

export type WorkbenchPlanWorkspacePayload = {
  documents: WorkbenchPlanDocument[];
};
```

`workbench-api.ts`:

```ts
export const loadPlanWorkspace = () =>
  invoke<WorkbenchPlanWorkspacePayload>("load_plan_workspace");
```

- [ ] **7. Verify GREEN**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml plan_workspace -- --nocapture
bun run --cwd apps/layout-editor test
bun run editor:check
```

- [ ] **8. Commit**

```bash
git add apps/layout-editor/src-tauri/src/lib.rs apps/layout-editor/src/lib/workbench-types.ts apps/layout-editor/src/lib/workbench-api.ts
git commit -m "feat(layout-editor): load canonical planning documents"
```

---

## Task 2: Project Markdown with pinned anchors and exact source contracts

**Files**

- Create `apps/layout-editor/src/lib/plan-workspace.ts`
- Create `apps/layout-editor/src/lib/plan-workspace.test.ts`
- Modify `apps/layout-editor/package.json`
- Modify `bun.lock`

**Produces**

```ts
planAnchor(text, seen)
planSourceRef(path, anchor)
projectPlanWorkspace(payload)
```

- [ ] **1. Install the one Markdown dependency**

```bash
bun add --cwd apps/layout-editor marked
```

Do not add `github-slugger`, `marked-gfm-heading-id`, DOMPurify, or another Markdown plugin/framework.

- [ ] **2. Write failing tests for the stable helper boundaries first**

```ts
it("pins Plan heading anchors independently of Marked defaults", () => {
  const seen = new Map<string, number>();
  expect(planAnchor("10. 章節總覽", seen)).toBe("10-章節總覽");
  expect(planAnchor("重複", seen)).toBe("重複");
  expect(planAnchor("重複", seen)).toBe("重複-1");
  expect(planAnchor("Hello, World!", seen)).toBe("hello-world");
});

it("composes source references only at the copy/open boundary", () => {
  expect(planSourceRef("docs/stories_plan/final_story_bible.md", "10-章節總覽"))
    .toBe("docs/stories_plan/final_story_bible.md#10-章節總覽");
  expect(planSourceRef("docs/stories_plan/final_story_bible.md", null))
    .toBe("docs/stories_plan/final_story_bible.md");
});
```

- [ ] **3. Write failing strict-projection tests**

Cover all of these contracts:

```ts
it("projects only the exact section-10 chapter table", () => {
  const workspace = projectPlanWorkspace(validEightChapterBible());
  expect(workspace.chapterOverview?.rows.map((row) => row.chapter)).toEqual([
    "1", "2", "3", "4", "5", "6", "7", "8",
  ]);
  expect(workspace.chapterOverview?.anchor).toBe("10-章節總覽");
});

it("does not use a similar table outside section 10", () => {
  const workspace = projectPlanWorkspace(bible(similarTableUnderSection3Only));
  expect(workspace.chapterOverview).toBeNull();
  expect(workspace.diagnostics.map((d) => d.code)).toContain("chapterOverviewMissing");
});

it("projects the section-18.5 Aoba boundaries verbatim", () => {
  const workspace = projectPlanWorkspace(validAobaBible());
  expect(workspace.aobaReveal?.stages).toEqual([
    expect.objectContaining({ chapterLabel: "第 1 章", mustEstablish: "命名青葉" }),
    expect.objectContaining({ chapterLabel: "第 8 章", mustNotEstablish: "—" }),
  ]);
});

it("uses only the first section-18 blockquote before 18.1", () => {
  const workspace = projectPlanWorkspace(validAobaBibleWithLaterQuotes());
  expect(workspace.aobaOverrideNotice?.text).toContain("以本節為準");
  expect(workspace.aobaOverrideNotice?.text).not.toContain("青葉火災已經結案");
});
```

Also assert malformed headers emit `chapterOverviewInvalid` / `aobaRevealLadderInvalid` while the parsed Story Bible remains available.

- [ ] **4. Pin the diagnostic shape**

Add a test that diagnostics use the existing repository field family:

```ts
expect(workspace.diagnostics[0]).toEqual(
  expect.objectContaining({
    code: "chapterOverviewMissing",
    message: expect.any(String),
    sourceFile: "docs/stories_plan/final_story_bible.md",
    line: expect.any(Number),
  }),
);
```

Define exactly:

```ts
export type PlanDiagnostic = {
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
```

Do not import compiler validation policy; only reuse its field shape.

- [ ] **5. Confirm RED**

```bash
bunx vitest run apps/layout-editor/src/lib/plan-workspace.test.ts
```

Expected: module/functions do not exist.

- [ ] **6. Implement the pure helpers**

Use one Plan-owned algorithm:

```ts
export function planAnchor(text: string, seen: Map<string, number>): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
    .replace(/\s+/g, "-");
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

export function planSourceRef(path: string, anchor: string | null): string {
  return anchor ? `${path}#${anchor}` : path;
}
```

Do not delegate anchor semantics to Marked or a plugin.

- [ ] **7. Implement one Marked token walk with no public table model**

Public types are limited to:

```ts
export type PlanHeading = {
  level: number;
  text: string;
  anchor: string;
  line: number;
};

export type ParsedPlanDocument = WorkbenchPlanDocument & {
  renderedHtml: string;
  headings: PlanHeading[];
};

export type ChapterOverviewRow = {
  chapter: string;
  title: string;
  caseType: string;
  variant: string;
  mainMisdirection: string;
};

export type AobaRevealStage = {
  chapterLabel: string;
  mustEstablish: string;
  mustNotEstablish: string;
};

export type PlanWorkspace = {
  documents: ParsedPlanDocument[];
  chapterOverview: { anchor: string; rows: ChapterOverviewRow[] } | null;
  aobaReveal: { anchor: string; stages: AobaRevealStage[] } | null;
  aobaOverrideNotice: { anchor: string; text: string } | null;
  diagnostics: PlanDiagnostic[];
};
```

There is **no exported `PlanTable`**. Tables are local token-walk input used only by the two exact derived extractors.

Use Marked's direct lexer/parser path:

```ts
const tokens = marked.lexer(document.content, { gfm: true });
// walk top-level tokens once for heading/table/blockquote structure + line starts
const renderedHtml = marked.parser(tokens, { renderer });
```

Maintain `line` by starting at 1 and adding newline counts from each top-level token's `raw` after recording that token's start line.

- [ ] **8. Render headings with the already-extracted anchors and escape raw HTML**

Precompute `document.headings` with `planAnchor()`; the heading renderer consumes those anchors in the same source order instead of slugging again.

Use one custom Marked renderer:

```ts
const renderer = new marked.Renderer();
let headingIndex = 0;
renderer.heading = function ({ tokens, depth }) {
  const heading = headings[headingIndex++]!;
  const body = this.parser.parseInline(tokens);
  return `<h${depth} id="${escapeHtml(heading.anchor)}">${body}</h${depth}>`;
};
renderer.html = ({ text }) => escapeHtml(text);
```

`escapeHtml()` is a local tiny helper for `& < > " '`. Planning Markdown is repository-authored/trusted; no sanitizer dependency is added.

- [ ] **9. Implement only the exact §10 / §18 contracts**

Keep these constants local:

```ts
const CHAPTER_HEADING = "10. 章節總覽";
const CHAPTER_HEADERS = ["章節", "標題", "案件類型", "變體", "主線誤導"];
const AOBA_ADDENDUM_HEADING = "18. Canon Addendum：第一幕青葉提問契約（2026-08-23）";
const AOBA_18_1_HEADING = "18.1 為什麼需要這個更新";
const AOBA_HEADING = "18.5 第一幕 reveal ladder";
const AOBA_HEADERS = ["章節", "必須建立", "絕對不能建立"];
```

For §18 override:

- find the exact H1;
- before exact H2 `18.1 為什麼需要這個更新`, take the first top-level `blockquote` token only;
- require no generic blockquote collection;
- current real contract contains `以本節為準`.

For missing sections use diagnostic line 1. For malformed tables use the owning heading/table start line.

No fallback search.

- [ ] **10. Verify GREEN**

```bash
bunx vitest run apps/layout-editor/src/lib/plan-workspace.test.ts
bun run editor:check
```

- [ ] **11. Commit**

```bash
git add apps/layout-editor/src/lib/plan-workspace.ts apps/layout-editor/src/lib/plan-workspace.test.ts apps/layout-editor/package.json bun.lock
git commit -m "feat(layout-editor): project planning markdown"
```

---

## Task 3: Add a real-corpus Plan gate including rendered GFM tables

**Files**

- Create `apps/layout-editor/scripts/verify-plan-real-content.ts`
- Modify `apps/layout-editor/package.json`
- Modify `.github/workflows/ci.yml`

- [ ] **1. Build the payload from the explicit current files**

Do **not** reimplement Rust's chapter-plan directory discovery in TypeScript. Rust fixture tests already own numeric discovery and nested-file exclusion.

The verifier reads exactly:

```text
docs/stories_plan/final_story_bible.md
docs/stories_plan/chapter_1_plan.md
docs/stories_plan/chapter_2_plan.md
```

Construct the wire payload directly:

```ts
const payload: WorkbenchPlanWorkspacePayload = {
  documents: [
    { id: "story-bible", kind: "storyBible", chapterNumber: null, path: BIBLE, content: read(BIBLE) },
    { id: "chapter-1-plan", kind: "chapterPlan", chapterNumber: 1, path: CH1, content: read(CH1) },
    { id: "chapter-2-plan", kind: "chapterPlan", chapterNumber: 2, path: CH2, content: read(CH2) },
  ],
};
```

- [ ] **2. Assert both structural projection and rendered-document behavior**

After `projectPlanWorkspace(payload)` assert:

```ts
expectExact(workspace.chapterOverview?.rows.map((r) => r.chapter), [
  "1", "2", "3", "4", "5", "6", "7", "8",
]);
expectExact(workspace.aobaReveal?.stages.map((r) => r.chapterLabel), [
  "第 1 章", "第 2 章", "第 3 章", "第 4 章", "第 5～7 章", "第 8 章",
]);

const bible = expectDocument("story-bible");
expectHeadingAnchor(bible, "10. 章節總覽", "10-章節總覽");
expectTableContains(bible.renderedHtml, "雨鐘咖啡館殺人事件");
expectTableContains(bible.renderedHtml, "「2016 年青葉記憶研究所火災」名稱");

if (!workspace.aobaOverrideNotice?.text.includes("以本節為準")) {
  throw new Error("Story Bible §18 override notice not projected");
}
if (workspace.aobaOverrideNotice.text.includes("青葉火災已經結案")) {
  throw new Error("Story Bible §18 override notice absorbed a later blockquote");
}
if (workspace.diagnostics.length > 0) {
  throw new Error(formatDiagnostics(workspace.diagnostics));
}
```

Implement `expectDocument`, `expectExact`, `expectHeadingAnchor`, `expectTableContains`, and `formatDiagnostics` as tiny script-local helpers. `expectTableContains` must confirm the text appears between one `<table ...>` and its matching `</table>`, not merely elsewhere in the HTML.

- [ ] **3. Run the verifier directly**

```bash
bun run apps/layout-editor/scripts/verify-plan-real-content.ts
```

Expected: PASS against current canon. If it fails, fix the projector to match the explicit current headings/tables; do not edit story content merely to satisfy the verifier.

- [ ] **4. Wire package + existing CI job**

Add to `apps/layout-editor/package.json`:

```json
"verify:plan-real-content": "bun run scripts/verify-plan-real-content.ts"
```

Add after the Asset gate in `.github/workflows/ci.yml`:

```yaml
      - name: Verify Plan real-content projection
        run: bun run --cwd apps/layout-editor verify:plan-real-content
```

- [ ] **5. Run all Workbench real-content gates**

```bash
bun run scenes:compile
bun run --cwd apps/layout-editor verify:reader-real-content
bun run --cwd apps/layout-editor verify:asset-real-content
bun run --cwd apps/layout-editor verify:plan-real-content
```

- [ ] **6. Commit**

```bash
git add apps/layout-editor/scripts/verify-plan-real-content.ts apps/layout-editor/package.json .github/workflows/ci.yml
git commit -m "test(layout-editor): gate Plan projection on real canon"
```

---

## Task 4: Build Plan navigation and read-only views

**Files**

- Create `apps/layout-editor/src/lib/PlanSidebar.svelte`
- Create `apps/layout-editor/src/lib/PlanSidebar.test.ts`
- Create `apps/layout-editor/src/lib/PlanView.svelte`
- Create `apps/layout-editor/src/lib/PlanView.test.ts`

**Interfaces**

```ts
type PlanSurface = "overview" | "document";
```

`PlanSidebar` gets `workspace`, selection, and `onSelectOverview/onSelectDocument/onSelectHeading` callbacks.

`PlanView` gets `workspace`, `surface`, selected document/anchor, and `onNavigateSource(documentId, anchor)`.

Neither component loads files or parses Markdown.

- [ ] **1. Write failing component tests**

Cover:

```text
PlanSidebar
- Story Bible before Chapter 1/2 plans
- selected document expands its heading outline
- heading click emits the anchor already produced by projectPlanWorkspace()

PlanView
- Overview renders eight-chapter table
- Aoba timeline + 必須建立/絕對不能建立 boundaries render
- first §18 override callout renders
- Open source emits story-bible + the stored derived anchor
- diagnostics do not hide the Document view
- Copy source reference composes exact path#anchor through planSourceRef()
```

Example source-navigation assertion:

```ts
await user.click(screen.getAllByRole("button", { name: "Open source" })[0]!);
expect(onNavigateSource).toHaveBeenCalledWith("story-bible", "10-章節總覽");
```

- [ ] **2. Confirm RED**

```bash
bunx vitest run apps/layout-editor/src/lib/PlanSidebar.test.ts apps/layout-editor/src/lib/PlanView.test.ts
```

Expected: component modules do not exist.

- [ ] **3. Implement `PlanSidebar.svelte`**

Render only:

```text
Overview
Story Bible
  selected document headings...
Chapter 1 plan
Chapter 2 plan
```

Use `document.headings`; no parser or tree library. Heading indentation may use `level` only.

- [ ] **4. Implement `PlanView.svelte`**

Overview order:

1. exact first §18 override callout;
2. diagnostics using `code: message` and source file/line;
3. eight-chapter matrix;
4. Aoba reveal timeline;
5. Aoba boundary table.

Overview source buttons use the collection-level anchors:

```text
chapterOverview.anchor
→ onNavigateSource("story-bible", anchor)

aobaReveal.anchor
→ onNavigateSource("story-bible", anchor)
```

Document surface:

- canonical path from the selected document;
- Copy source reference via `planSourceRef(document.path, selectedAnchor)`;
- render `renderedHtml` with `{@html}`;
- scroll selected heading into view by its Plan-owned DOM `id`;
- style headings/tables/blockquotes/code locally.

For source `mustNotEstablish === "—"`, present `No additional early-reveal prohibition authored.` without changing the source model.

- [ ] **5. Verify GREEN**

```bash
bunx vitest run apps/layout-editor/src/lib/PlanSidebar.test.ts apps/layout-editor/src/lib/PlanView.test.ts
bun run editor:check
```

- [ ] **6. Commit**

```bash
git add apps/layout-editor/src/lib/PlanSidebar.svelte apps/layout-editor/src/lib/PlanSidebar.test.ts apps/layout-editor/src/lib/PlanView.svelte apps/layout-editor/src/lib/PlanView.test.ts
git commit -m "feat(layout-editor): render Story Workbench Plan views"
```

---

## Task 5: Integrate Plan as the fourth functional Workbench mode

**Files**

- Modify `apps/layout-editor/src/App.svelte`
- Modify `apps/layout-editor/src/App.test.ts`

- [ ] **1. Write failing App integration tests**

Extend the existing Tauri invoke mock with `load_plan_workspace` and test:

```text
- mode buttons are Reader | Assets | Plan | Stage
- Plan replaces the left scene tree with planning navigation
- entering/leaving Plan preserves selected scene
- first Plan entry loads once
- Refresh loads again
- overlapping Refresh calls use latest response only
- existing Assets/Stage load ownership tests still pass
```

- [ ] **2. Confirm RED**

```bash
bunx vitest run apps/layout-editor/src/App.test.ts
```

Expected: Plan mode does not exist.

- [ ] **3. Add explicit Plan state to `App.svelte`**

Extend only the existing union:

```ts
type WorkbenchMode = "reader" | "assets" | "plan" | "stage";
```

Add local state:

```ts
let planWorkspace = $state<PlanWorkspace | null>(null);
let planError = $state<string | null>(null);
let planLoading = $state(false);
let planLoadGeneration = 0;
let planSurface = $state<PlanSurface>("overview");
let selectedPlanDocumentId = $state("story-bible");
let selectedPlanAnchor = $state<string | null>(null);
```

Do **not** introduce a generic mode store.

- [ ] **4. Add first-load/Refresh ownership with generation fencing**

`refreshPlan()` follows the existing Reader/Assets generation-counter seam:

```ts
async function refreshPlan(): Promise<void> {
  const generation = ++planLoadGeneration;
  planLoading = true;
  planError = null;
  try {
    const payload = await loadPlanWorkspace();
    if (generation !== planLoadGeneration) return;
    planWorkspace = projectPlanWorkspace(payload);
  } catch (error) {
    if (generation !== planLoadGeneration) return;
    planError = normalizeError(error);
  } finally {
    if (generation === planLoadGeneration) planLoading = false;
  }
}
```

Preserve selected Plan document when still present; otherwise fall back to `story-bible`.

- [ ] **5. Add source navigation without fused path parsing**

Use document identity + anchor:

```ts
function navigatePlanSource(documentId: string, anchor: string): void {
  selectedPlanDocumentId = documentId;
  selectedPlanAnchor = anchor;
  planSurface = "document";
}
```

`PlanView` uses `planSourceRef()` only for copied text, not as an internal navigation protocol.

- [ ] **6. Extend mode ownership without touching scene behavior**

In `setMode()`:

```text
reader -> existing Reader load behavior
assets -> existing Assets ownership
plan   -> load Plan snapshot on first entry if absent, then return
stage  -> existing investigation-only Stage load behavior
```

Do not clear `selectedChapterId` / `selectedSceneId` on Plan entry.

Sidebar:

```svelte
{#if mode === "plan"}
  <PlanSidebar ... />
{:else}
  <!-- existing scene tree unchanged -->
{/if}
```

Detail branch order:

```text
Reader → Assets → Plan → Stage
```

Plan gets one explicit Refresh button.

- [ ] **7. Verify editor behavior**

```bash
bun run --cwd apps/layout-editor test
bun run editor:check
```

Expected: PASS, including all previous Reader/Assets/Stage tests.

- [ ] **8. Run full ticket checks**

```bash
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

- [ ] **9. Manual smoke against headings that actually exist**

Run `bun run dev:editor` and verify:

1. Reader still opens by default.
2. Plan lists Story Bible + current Chapter 1/2 plans.
3. Overview shows 8 rows and the six authored Aoba stages.
4. Open source jumps to Story Bible `10. 章節總覽` / `18.5 第一幕 reveal ladder` as appropriate.
5. Chapter 1 outline jumps to **`1. 全章前台證據包`**.
6. Chapter 2 outline jumps to **`12. 最終審查會 Proof Order`**.
7. Refresh reflects a harmless Markdown edit/revert.
8. Returning to Reader/Assets/Stage preserves the selected scene; Stage save still works for investigation scenes.

Do not invent a Chapter 1 `Proof Order` heading; the source does not contain one. Revert the harmless Markdown smoke edit.

- [ ] **10. Commit**

```bash
git add apps/layout-editor/src/App.svelte apps/layout-editor/src/App.test.ts
git commit -m "feat(layout-editor): add Story Workbench Plan mode"
```

---

## Final self-review

Before marking the draft PR ready:

- [ ] §10 is the only chapter-matrix source.
- [ ] §18.5 is the only Aoba timeline/boundary source.
- [ ] Only the first §18 blockquote before §18.1 becomes the override callout.
- [ ] `planAnchor()` owns every Plan heading ID; no slugger plugin/default leaks into the contract.
- [ ] Path and anchor remain separate until `planSourceRef()` copy composition.
- [ ] No public `PlanTable[]` model exists.
- [ ] Diagnostics use `{ code, message, sourceFile, line }`.
- [ ] Source drift gives diagnostics while raw documents still render.
- [ ] Rust reuses `read_text_source()`, exposes no Plan path argument, and does not descend into playable Markdown.
- [ ] Real-corpus verification includes rendered GFM-table content, not only extracted rows.
- [ ] No source editing, AI, graph sidecar, or generic knowledge model was introduced.
- [ ] `verify:plan-real-content` runs in the existing frontend CI job.
- [ ] Reader/Assets/Stage remain behaviorally unchanged.
- [ ] All full-ticket checks pass.