# HPA-273 Story Workbench Plan Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Story Workbench Plan mode that browses canonical planning Markdown, projects the explicit eight-chapter overview, and visualizes the authored Aoba reveal/boundary ladder without creating a second story model.

**Architecture:** Rust returns one fixed-domain planning snapshot. TypeScript parses Markdown and derives only two exact Story Bible tables. Svelte adds a Plan-specific sidebar and Overview/Document view while preserving Reader/Assets/Stage scene state.

**Tech Stack:** Rust, Tauri 2, Svelte 5, TypeScript, Vitest, Testing Library, Bun, `marked`.

**Spec:** `docs/superpowers/specs/2026-09-03-hpa-273-story-workbench-plan-mode-design.md`

## Global Constraints

- One ticket, one PR.
- Story Markdown remains canonical.
- Matrix source: Story Bible `# 10. 章節總覽` only.
- Aoba source: Story Bible `## 18.5 第一幕 reveal ladder` only.
- Source drift → diagnostic; never prose/table inference.
- No write path, AI, graph sidecar, Chapter 2 map visualization, watcher, or arbitrary path read.
- Reader/Assets/Stage behavior and selection remain intact.

---

## Task 1: Add a fixed-domain Plan snapshot

**Files**

- Modify `apps/layout-editor/src-tauri/src/lib.rs`
- Modify `apps/layout-editor/src/lib/workbench-types.ts`
- Modify `apps/layout-editor/src/lib/workbench-api.ts`

**Produces**

```text
load_plan_workspace()
load_plan_workspace_at_root(root)
WorkbenchPlanWorkspacePayload
loadPlanWorkspace()
```

- [ ] **1. Write failing Rust tests**

Add tests beside the existing Workbench/Assets tests:

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
}

#[test]
fn plan_workspace_ignores_nested_playable_markdown() {
    let root = temp_workbench_root();
    fs::write(root.join("docs/stories_plan/final_story_bible.md"), "# Bible\n").unwrap();
    fs::write(root.join("docs/stories_plan/chapter_1/scene_a.md"), "# Scene\n").unwrap();
    assert_eq!(load_plan_workspace_at_root(&root).unwrap().documents.len(), 1);
}

#[test]
fn plan_workspace_requires_only_the_story_bible() {
    let root = temp_workbench_root();
    assert_eq!(
        load_plan_workspace_at_root(&root).unwrap_err().code,
        "planStoryBibleNotFound"
    );
    fs::write(root.join("docs/stories_plan/final_story_bible.md"), "# Bible\n").unwrap();
    assert_eq!(load_plan_workspace_at_root(&root).unwrap().documents.len(), 1);
}
```

- [ ] **2. Confirm RED**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml plan_workspace -- --nocapture
```

Expected: compile failure; Plan types/helper do not exist.

- [ ] **3. Implement the Rust boundary**

Add wire structs:

```rust
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
enum PlanDocumentKind { StoryBible, ChapterPlan }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchPlanDocument {
    id: String,
    kind: PlanDocumentKind,
    chapter_number: Option<u32>,
    path: String,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchPlanWorkspace { documents: Vec<WorkbenchPlanDocument> }
```

Parse only exact root filenames, without a regex dependency:

```rust
fn chapter_plan_number(name: &str) -> Option<u32> {
    let raw = name.strip_prefix("chapter_")?.strip_suffix("_plan.md")?;
    let number = raw.parse::<u32>().ok()?;
    (number > 0).then_some(number)
}
```

`load_plan_workspace_at_root()` must:

1. read fixed `docs/stories_plan/final_story_bible.md` or return `planStoryBibleNotFound` / `planDocumentReadFailed`;
2. `read_dir(docs/stories_plan)` once, propagating directory-entry errors rather than dropping them;
3. keep only regular root files accepted by `chapter_plan_number()`;
4. sort by numeric chapter number;
5. read each discovered file or return `planDocumentReadFailed`;
6. return Story Bible first.

Expose no path argument:

```rust
#[tauri::command]
fn load_plan_workspace() -> Result<WorkbenchPlanWorkspace, EditorError> {
    load_plan_workspace_at_root(&workspace_root()?)
}
```

Register it in `tauri::generate_handler!`.

- [ ] **4. Add frontend wire types/API**

`workbench-types.ts`:

```ts
export type PlanDocumentKind = "storyBible" | "chapterPlan";
export type WorkbenchPlanDocument = {
  id: string;
  kind: PlanDocumentKind;
  chapterNumber: number | null;
  path: string;
  content: string;
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

- [ ] **5. Verify GREEN**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml plan_workspace -- --nocapture
bun run editor:check
```

- [ ] **6. Commit**

```bash
git add apps/layout-editor/src-tauri/src/lib.rs apps/layout-editor/src/lib/workbench-types.ts apps/layout-editor/src/lib/workbench-api.ts
git commit -m "feat(layout-editor): load canonical planning documents"
```

---

## Task 2: Project Markdown into exact source-backed Plan data

**Files**

- Create `apps/layout-editor/src/lib/plan-workspace.ts`
- Create `apps/layout-editor/src/lib/plan-workspace.test.ts`
- Modify `apps/layout-editor/package.json`
- Modify `bun.lock`

**Produces**

```ts
projectPlanWorkspace(payload: WorkbenchPlanWorkspacePayload): PlanWorkspace
```

- [ ] **1. Install the one Markdown dependency**

```bash
bun add --cwd apps/layout-editor marked
```

- [ ] **2. Write failing projection tests**

Minimum tests:

```ts
it("creates stable duplicate heading anchors", () => {
  const workspace = projectPlanWorkspace(bible("# 重複\n## 重複\n## 重複\n"));
  expect(workspace.documents[0]!.headings.map((h) => h.anchor)).toEqual([
    "重複", "重複-1", "重複-2",
  ]);
});

it("projects only the exact section-10 chapter table", () => {
  const workspace = projectPlanWorkspace(validEightChapterBible());
  expect(workspace.chapterOverview?.map((row) => row.chapter)).toEqual([
    "1", "2", "3", "4", "5", "6", "7", "8",
  ]);
  expect(workspace.chapterOverview?.[0]?.sourceRef).toContain("#10-章節總覽");
});

it("does not use a similar table outside section 10", () => {
  const workspace = projectPlanWorkspace(bible(similarTableUnderSection3Only));
  expect(workspace.chapterOverview).toBeNull();
  expect(workspace.diagnostics.map((d) => d.code)).toContain("chapterOverviewMissing");
});

it("projects the section-18.5 Aoba boundaries verbatim", () => {
  const workspace = projectPlanWorkspace(validAobaBible());
  expect(workspace.aobaRevealStages).toEqual([
    expect.objectContaining({ chapterLabel: "第 1 章", mustEstablish: "命名青葉" }),
    expect.objectContaining({ chapterLabel: "第 8 章", mustNotEstablish: "—" }),
  ]);
  expect(workspace.aobaOverrideNotice).toContain("以本節為準");
});
```

Also test malformed headers emit `chapterOverviewInvalid` / `aobaRevealLadderInvalid` while parsed documents remain available.

- [ ] **3. Confirm RED**

```bash
bunx vitest run apps/layout-editor/src/lib/plan-workspace.test.ts
```

- [ ] **4. Implement one pure projection owner**

Public model:

```ts
export type PlanHeading = { level: number; text: string; anchor: string; sourceRef: string };
export type PlanTable = { headers: string[]; rows: string[][]; sourceRef: string };
export type ParsedPlanDocument = {
  id: string;
  kind: PlanDocumentKind;
  chapterNumber: number | null;
  path: string;
  renderedHtml: string;
  headings: PlanHeading[];
  tables: PlanTable[];
};
export type ChapterOverviewRow = {
  chapter: string; title: string; caseType: string; variant: string;
  mainMisdirection: string; sourceRef: string;
};
export type AobaRevealStage = {
  chapterLabel: string; mustEstablish: string; mustNotEstablish: string;
  sourceRef: string;
};
export type PlanWorkspace = {
  documents: ParsedPlanDocument[];
  chapterOverview: ChapterOverviewRow[] | null;
  aobaRevealStages: AobaRevealStage[] | null;
  aobaOverrideNotice: string | null;
  diagnostics: PlanDiagnostic[];
};
```

Use `marked` once per document to:

- render GFM with raw HTML escaped/disabled;
- collect ATX headings in source order;
- collect tables and associate each with its containing heading;
- use one per-document slugger for both rendered heading IDs and `sourceRef`.

Keep the strict contracts local:

```ts
const CHAPTER_HEADING = "10. 章節總覽";
const CHAPTER_HEADERS = ["章節", "標題", "案件類型", "變體", "主線誤導"];
const AOBA_HEADING = "18.5 第一幕 reveal ladder";
const AOBA_HEADERS = ["章節", "必須建立", "絕對不能建立"];
```

Extract the §18 override blockquote directly from that exact Story Bible addendum while parsing the same token stream. Do not build a generic conflict engine.

Diagnostics are exactly:

```text
chapterOverviewMissing
chapterOverviewInvalid
chapterOverviewUnexpectedRows
aobaRevealLadderMissing
aobaRevealLadderInvalid
```

No fallback search.

- [ ] **5. Verify GREEN**

```bash
bunx vitest run apps/layout-editor/src/lib/plan-workspace.test.ts
bun run editor:check
```

- [ ] **6. Commit**

```bash
git add apps/layout-editor/src/lib/plan-workspace.ts apps/layout-editor/src/lib/plan-workspace.test.ts apps/layout-editor/package.json bun.lock
git commit -m "feat(layout-editor): project planning markdown"
```

---

## Task 3: Add a real-corpus Plan gate

**Files**

- Create `apps/layout-editor/scripts/verify-plan-real-content.ts`
- Modify `apps/layout-editor/package.json`
- Modify `.github/workflows/ci.yml`

- [ ] **1. Write the headless verifier**

Mirror the existing Reader/Assets verifier pattern: read Story Bible plus exact root `chapter_<N>_plan.md` files, construct `WorkbenchPlanWorkspacePayload`, call `projectPlanWorkspace()`.

Assert:

```ts
expectDocument("chapter-1-plan");
expectDocument("chapter-2-plan");
expectExact(workspace.chapterOverview?.map((r) => r.chapter), [
  "1", "2", "3", "4", "5", "6", "7", "8",
]);
expectExact(workspace.aobaRevealStages?.map((r) => r.chapterLabel), [
  "第 1 章", "第 2 章", "第 3 章", "第 4 章", "第 5～7 章", "第 8 章",
]);
if (workspace.diagnostics.length > 0) throw new Error(formatDiagnostics(workspace.diagnostics));
```

Implement those three tiny local helpers in the script; do not add a reusable verifier framework.

- [ ] **2. Run it directly**

```bash
bun run apps/layout-editor/scripts/verify-plan-real-content.ts
```

Expected: PASS against current canon. If it fails, fix the projector to match the explicit current headings/tables; do not edit story content to satisfy the test.

- [ ] **3. Wire package + existing CI job**

Add:

```json
"verify:plan-real-content": "bun run scripts/verify-plan-real-content.ts"
```

Add after the Asset gate in `.github/workflows/ci.yml`:

```yaml
      - name: Verify Plan real-content projection
        run: bun run --cwd apps/layout-editor verify:plan-real-content
```

- [ ] **4. Run all Workbench real-content gates**

```bash
bun run scenes:compile
bun run --cwd apps/layout-editor verify:reader-real-content
bun run --cwd apps/layout-editor verify:asset-real-content
bun run --cwd apps/layout-editor verify:plan-real-content
```

- [ ] **5. Commit**

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

`PlanView` gets `workspace`, `surface`, selected document/anchor, and `onNavigateSource(sourceRef)`.

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
- §18 override callout renders
- Open source emits the existing sourceRef
- diagnostics do not hide the Document view
- Copy source reference writes exact path#anchor
```

Example source-navigation assertion:

```ts
await user.click(screen.getAllByRole("button", { name: "Open source" })[0]!);
expect(onNavigateSource).toHaveBeenCalledWith(
  expect.stringContaining("docs/stories_plan/final_story_bible.md#"),
);
```

- [ ] **2. Confirm RED**

```bash
bunx vitest run apps/layout-editor/src/lib/PlanSidebar.test.ts apps/layout-editor/src/lib/PlanView.test.ts
```

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

1. explicit §18 override callout;
2. diagnostics;
3. eight-chapter matrix;
4. Aoba reveal timeline;
5. Aoba boundary table.

Each derived row has `Open source` using its stored `sourceRef`.

Document surface:

- canonical path;
- Copy source reference;
- render `renderedHtml`;
- scroll selected heading into view by existing DOM `id`;
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

- [ ] **4. Add `refreshPlan()` and source navigation**

`refreshPlan()` follows the current Assets generation-counter pattern:

```ts
const generation = ++planLoadGeneration;
const payload = await loadPlanWorkspace();
if (generation !== planLoadGeneration) return;
planWorkspace = projectPlanWorkspace(payload);
```

Preserve errors/loading and selected Plan document when still present.

Add small helpers:

```text
selectPlanDocument(id)
selectPlanHeading(id, anchor)
navigatePlanSource(path#anchor)
```

All only update Plan state.

- [ ] **5. Extend mode ownership without touching scene behavior**

In `setMode()`:

```text
reader -> existing Reader load behavior
assets -> existing Assets ownership
plan   -> load Plan snapshot on first entry, then return
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

- [ ] **6. Verify editor behavior**

```bash
bun run --cwd apps/layout-editor test
bun run editor:check
```

Expected: PASS, including all previous Reader/Assets/Stage tests.

- [ ] **7. Run full ticket checks**

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

- [ ] **8. Manual smoke**

Run `bun run dev:editor` and verify:

1. Reader still opens by default.
2. Plan lists Story Bible + current Chapter 1/2 plans.
3. Overview shows 8 rows and the six authored Aoba stages.
4. Open source jumps to the correct Story Bible heading.
5. Chapter 1 plan outline makes evidence/proof-order sections easy to reach.
6. Refresh reflects a harmless Markdown edit/revert.
7. Returning to Reader/Assets/Stage preserves the selected scene; Stage save still works for investigation scenes.

Revert the harmless Markdown smoke edit.

- [ ] **9. Commit**

```bash
git add apps/layout-editor/src/App.svelte apps/layout-editor/src/App.test.ts
git commit -m "feat(layout-editor): add Story Workbench Plan mode"
```

---

## Final self-review

Before marking the draft PR ready:

- [ ] §10 is the only chapter-matrix source.
- [ ] §18.5 is the only Aoba timeline/boundary source.
- [ ] §18 override is visible, not silently reconciled.
- [ ] Source drift gives diagnostics while raw documents still render.
- [ ] Rust exposes no Plan path argument and does not descend into playable Markdown.
- [ ] No source editing, AI, graph sidecar, or generic knowledge model was introduced.
- [ ] `verify:plan-real-content` runs in the existing frontend CI job.
- [ ] Reader/Assets/Stage remain behaviorally unchanged.
- [ ] All full-ticket checks pass.
