# HPA-273 Story Workbench Plan Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Story Workbench Plan mode that browses canonical planning Markdown, renders the explicit eight-chapter overview, and visualizes the authored Aoba reveal/boundary ladder without creating a second story model.

**Architecture:** Rust returns one fixed-domain planning snapshot through the existing text-source reader. TypeScript uses Marked plus Plan-owned heading/source semantics to project only Story Bible §10, §18.5, and the first §18 override blockquote. A Plan-specific Svelte rune store owns snapshot/selection state; `App.svelte` only wires the fourth mode.

**Tech Stack:** Rust, Tauri 2, Svelte 5, TypeScript, Vitest, Testing Library, Bun, `marked`.

**Spec:** `docs/superpowers/specs/2026-09-03-hpa-273-story-workbench-plan-mode-design.md`

## Global constraints

- One ticket, one PR.
- Story Markdown stays canonical.
- Matrix source is Story Bible `10. 章節總覽` only.
- Aoba source is Story Bible `18.5 第一幕 reveal ladder` only; every Aoba row may link back to that same source section.
- Source drift becomes a diagnostic; never infer a replacement from nearby prose/tables.
- No write path, AI, graph/relationship sidecar, Chapter 2 map visualization, watcher, arbitrary path read, or row → chapter-plan navigation.
- Reader/Assets/Stage behavior remains unchanged.

---

## Task 1: Load the fixed planning snapshot

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

- [ ] **1. Write focused Rust boundary tests**

Add tests beside current Workbench/Assets fixtures for the actual domain contract:

```rust
#[test]
fn plan_workspace_reads_bible_then_numeric_chapter_plans() {
    let root = temp_workbench_root();
    fs::write(root.join("docs/stories_plan/final_story_bible.md"), "# Bible\n").unwrap();
    fs::write(root.join("docs/stories_plan/chapter_10_plan.md"), "# Ten\n").unwrap();
    fs::write(root.join("docs/stories_plan/chapter_2_plan.md"), "# Two\n").unwrap();

    let snapshot = load_plan_workspace_at_root(&root).unwrap();
    assert_eq!(
        snapshot.documents.iter().map(|document| document.id.as_str()).collect::<Vec<_>>(),
        vec!["story-bible", "chapter-2-plan", "chapter-10-plan"]
    );
}

#[test]
fn plan_workspace_ignores_nested_and_invalid_chapter_plan_names() {
    let root = temp_workbench_root();
    fs::write(root.join("docs/stories_plan/final_story_bible.md"), "# Bible\n").unwrap();
    fs::write(root.join("docs/stories_plan/chapter_0_plan.md"), "# Zero\n").unwrap();
    fs::write(root.join("docs/stories_plan/chapter_x_plan.md"), "# X\n").unwrap();
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

Do not add filesystem mocks or permission tricks to force rare `read_dir` entry races. Implementation must use `entry?`/normal error propagation and reuse `read_text_source()`; review that directly.

- [ ] **2. Confirm RED**

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml plan_workspace -- --nocapture
```

Expected: compile failure because Plan types/functions do not exist.

- [ ] **3. Reuse the existing text-source boundary**

If needed, rename the internal Rust-only asset text-source struct to:

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchTextSource {
    path: String,
    content: String,
}
```

Keep existing Assets serialization unchanged.

Add:

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

Centralize identity derivation in one helper/constructor so `id`, `kind`, and `chapter_number` are not recomputed in multiple places.

Use a tiny filename parser:

```rust
fn chapter_plan_number(name: &str) -> Option<u32> {
    let raw = name.strip_prefix("chapter_")?.strip_suffix("_plan.md")?;
    let number = raw.parse::<u32>().ok()?;
    (number > 0).then_some(number)
}
```

`load_plan_workspace_at_root()` must:

1. read fixed `docs/stories_plan/final_story_bible.md` through `read_text_source()`;
2. map only its missing-file error to `planStoryBibleNotFound`;
3. scan only the root planning directory;
4. propagate directory-entry errors;
5. keep only regular root chapter-plan files accepted by `chapter_plan_number()`;
6. sort numerically;
7. read discovered plans through `read_text_source()` and preserve its normal errors;
8. return Story Bible first.

Expose only:

```rust
#[tauri::command]
fn load_plan_workspace() -> Result<WorkbenchPlanWorkspace, EditorError> {
    let root = workspace_root()?;
    load_plan_workspace_at_root(&root)
}
```

Register the command.

- [ ] **4. Add frontend wire types/API**

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

## Task 2: Project Markdown and exact Story Bible structures

**Files**

- Create `apps/layout-editor/src/lib/plan-workspace.ts`
- Create `apps/layout-editor/src/lib/plan-workspace.test.ts`
- Modify `apps/layout-editor/package.json`
- Modify `bun.lock`

**Produces**

```text
planAnchor(text, seen)
planSourceRef(path, anchor)
projectPlanWorkspace(payload)
```

- [ ] **1. Add the one Markdown dependency**

```bash
bun add --cwd apps/layout-editor marked
```

Do not add a heading slugger/plugin or sanitizer framework.

- [ ] **2. Write one focused projection test group**

Cover the boundaries that can actually break the product:

```ts
it("owns heading text/anchors and binds rendered ids to heading token identity", () => {
  const workspace = projectPlanWorkspace(
    bible("## 18.6 `ZW_A16.lock` 與青葉\n\n> ## Nested\n\n## After\n"),
  );
  const document = workspace.documents[0]!;

  expect(document.headings.map((heading) => heading.text)).toEqual([
    "18.6 ZW_A16.lock 與青葉",
    "Nested",
    "After",
  ]);
  expect(document.renderedHtml).toContain('id="186-zw_a16lock-與青葉"');
  expect(document.renderedHtml).toContain('id="nested"');
  expect(document.renderedHtml).toContain('id="after"');
});

it("pins duplicate anchors and source-ref composition", () => {
  const seen = new Map<string, number>();
  expect(planAnchor("10. 章節總覽", seen)).toBe("10-章節總覽");
  expect(planAnchor("重複", seen)).toBe("重複");
  expect(planAnchor("重複", seen)).toBe("重複-1");
  expect(planSourceRef("docs/stories_plan/final_story_bible.md", "10-章節總覽"))
    .toBe("docs/stories_plan/final_story_bible.md#10-章節總覽");
});

it("escapes authored raw html before document rendering", () => {
  const workspace = projectPlanWorkspace(bible("<script>alert(1)</script>"));
  expect(workspace.documents[0]!.renderedHtml).not.toContain("<script>");
  expect(workspace.documents[0]!.renderedHtml).toContain("&lt;script&gt;");
});
```

Add strict source-contract cases for:

```text
- exact §10 headers project chapters 1..8;
- similar §10-like table elsewhere is not used;
- malformed §10 headers -> chapterOverviewInvalid;
- §10 chapters not exactly 1..8 -> chapterOverviewUnexpectedRows while rows remain visible;
- exact §18.5 rows project verbatim;
- malformed §18.5 -> aobaRevealLadderInvalid;
- only the first §18 blockquote before §18.1 becomes the override notice;
- missing exact headings use the corresponding Missing diagnostic.
```

One representative diagnostic assertion is enough to pin the reused `CompileError` shape.

- [ ] **3. Confirm RED**

```bash
bunx vitest run apps/layout-editor/src/lib/plan-workspace.test.ts
```

Expected: projection module/functions do not exist.

- [ ] **4. Implement heading/source semantics**

Use:

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

Document that `planAnchor()` mutates its per-document `seen` map and that duplicate suffixes can change after content edits.

Lex each document once. Recursively walk the actual Marked token tree to derive plain heading text and allocate anchors. Bind each anchor to the exact heading token identity (for example `WeakMap<Tokens.Heading, string>`), then render the same token array.

```ts
const renderer = new marked.Renderer();
renderer.heading = function (token) {
  const anchor = anchorByHeadingToken.get(token);
  if (!anchor) throw new Error("Plan heading token missing anchor");
  return `<h${token.depth} id="${escapeHtml(anchor)}">${this.parser.parseInline(token.tokens)}</h${token.depth}>`;
};
renderer.html = ({ text }) => escapeHtml(text);
```

Plan anchors are bare DOM ids; Reader's existing source anchors include `#`.

- [ ] **5. Implement the small public projection model + strict extractors**

```ts
import type { CompileError } from "@lyra/scripts/compile-scenes/types";

export type PlanDiagnosticCode =
  | "chapterOverviewMissing"
  | "chapterOverviewInvalid"
  | "chapterOverviewUnexpectedRows"
  | "aobaRevealLadderMissing"
  | "aobaRevealLadderInvalid";

export type PlanDiagnostic = CompileError & { code: PlanDiagnosticCode };

export type PlanHeading = {
  level: number;
  text: string;
  anchor: string;
};

export type ParsedPlanDocument = WorkbenchPlanDocument & {
  renderedHtml: string;
  headings: PlanHeading[];
};
```

Keep table tokens internal. Public derived data is only:

```text
chapterOverview: { anchor, rows } | null
aobaReveal: { anchor, stages } | null
aobaOverrideNotice: { anchor, text } | null
diagnostics
```

Use exact constants:

```ts
const CHAPTER_HEADING = "10. 章節總覽";
const CHAPTER_HEADERS = ["章節", "標題", "案件類型", "變體", "主線誤導"];
const EXPECTED_CHAPTERS = ["1", "2", "3", "4", "5", "6", "7", "8"];
const AOBA_ADDENDUM_HEADING = "18. Canon Addendum：第一幕青葉提問契約（2026-08-23）";
const AOBA_18_1_HEADING = "18.1 為什麼需要這個更新";
const AOBA_HEADING = "18.5 第一幕 reveal ladder";
const AOBA_HEADERS = ["章節", "必須建立", "絕對不能建立"];
```

No fallback search.

- [ ] **6. Verify GREEN**

```bash
bunx vitest run apps/layout-editor/src/lib/plan-workspace.test.ts
bun run editor:check
```

- [ ] **7. Commit**

```bash
git add apps/layout-editor/src/lib/plan-workspace.ts apps/layout-editor/src/lib/plan-workspace.test.ts apps/layout-editor/package.json bun.lock
git commit -m "feat(layout-editor): project planning markdown"
```

---

## Task 3: Gate the projection against current canon

**Files**

- Create `apps/layout-editor/scripts/verify-plan-real-content.ts`
- Modify `apps/layout-editor/package.json`
- Modify `.github/workflows/ci.yml`

- [ ] **1. Build an explicit current-corpus payload**

Do not duplicate Rust discovery in TypeScript.

```ts
const BIBLE_PATH = "docs/stories_plan/final_story_bible.md";
const CH1_PATH = "docs/stories_plan/chapter_1_plan.md";
const CH2_PATH = "docs/stories_plan/chapter_2_plan.md";

function readSource(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}
```

Construct `WorkbenchPlanWorkspacePayload` with those repo-relative `path` values and `readSource(...)` contents.

- [ ] **2. Assert only the real-corpus contract**

After `projectPlanWorkspace(payload)` verify:

```text
- document source paths remain BIBLE_PATH / CH1_PATH / CH2_PATH;
- Story Bible heading `10. 章節總覽` anchors to `10-章節總覽`;
- chapter rows are exactly 1..8;
- Aoba stages are exactly 第 1, 2, 3, 4, 5～7, 8 章;
- override contains `以本節為準` and excludes `青葉火災已經結案`;
- `雨鐘咖啡館殺人事件` survives inside rendered `<table>...</table>`;
- the §18.5 Chapter 1 text survives inside rendered `<table>...</table>`;
- diagnostics are empty.
```

Keep helper functions script-local; do not create a verifier framework.

- [ ] **3. Run and wire the gate**

```bash
bun run apps/layout-editor/scripts/verify-plan-real-content.ts
```

Add:

```json
"verify:plan-real-content": "bun run scripts/verify-plan-real-content.ts"
```

Then add the existing `lint-frontend` CI step after Reader/Assets real-content verification:

```yaml
- name: Verify Plan real-content projection
  run: bun run --cwd apps/layout-editor verify:plan-real-content
```

- [ ] **4. Verify all Workbench real-content gates**

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

## Task 4: Add Plan state and read-only UI

**Files**

- Create `apps/layout-editor/src/lib/plan-store.svelte.ts`
- Create `apps/layout-editor/src/lib/plan-store.test.ts`
- Create `apps/layout-editor/src/lib/PlanSidebar.svelte`
- Create `apps/layout-editor/src/lib/PlanSidebar.test.ts`
- Create `apps/layout-editor/src/lib/PlanView.svelte`
- Create `apps/layout-editor/src/lib/PlanView.test.ts`

### Store contract

```ts
export type PlanSurface = "overview" | "document";

export const planState = $state({
  workspace: null as PlanWorkspace | null,
  error: null as string | null,
  loading: false,
  surface: "overview" as PlanSurface,
  selectedDocumentId: "story-bible",
  selectedAnchor: null as string | null,
});
```

Functions:

```text
ensurePlanLoaded()
refreshPlan()
showPlanOverview()
selectPlanDocument(id)
selectPlanHeading(id, anchor)
navigatePlanSource(id, anchor)
```

- [ ] **1. Write the minimal store/UI tests**

`plan-store.test.ts` needs only the stateful failure boundaries:

```text
- two overlapping refreshes keep the newer result;
- valid selected document/anchor survives refresh, invalid selection falls back to story-bible/no anchor.
```

`PlanSidebar.test.ts`:

```text
- selected document defaults to H1/H2 outline;
- Show all levels reveals H3+;
- Chapter 1 `1. 全章前台證據包` and Chapter 2 `12. 最終審查會 Proof Order` are reachable in compact mode.
```

`PlanView.test.ts`:

```text
- Overview renders chapter matrix + Aoba boundaries + override + diagnostics;
- every Aoba row can emit Open source -> (story-bible, aobaReveal.anchor);
- Document renders projected HTML and Copy source reference uses path + selected bare anchor;
- diagnostics do not hide the Document view.
```

Do not add row → chapter-plan tests; that navigation is intentionally out of v1.

- [ ] **2. Confirm RED**

```bash
bunx vitest run apps/layout-editor/src/lib/plan-store.test.ts apps/layout-editor/src/lib/PlanSidebar.test.ts apps/layout-editor/src/lib/PlanView.test.ts
```

- [ ] **3. Implement the Plan store**

Use one private generation counter. `refreshPlan()` must ignore stale success/error/finally writes and reconcile selection against the new workspace.

Reuse `normalizeError()`; do not add another error abstraction.

`ensurePlanLoaded()` loads only when there is no workspace and no active load.

- [ ] **4. Implement the compact sidebar**

Render:

```text
Overview
Story Bible
  selected-document H1/H2 headings...
  [Show all levels] when H3+ exists
Chapter 1 plan
Chapter 2 plan
...
```

Use `document.headings`; no parser/tree library. `showAllLevels` is local component state.

- [ ] **5. Implement Overview + Document surfaces**

Overview order:

1. first §18 override callout;
2. Plan diagnostics;
3. eight-chapter matrix;
4. Aoba timeline;
5. Aoba boundary table.

The matrix is display-only in v1. For each Aoba row, provide `Open source` using:

```text
onNavigateSource("story-bible", workspace.aobaReveal.anchor)
```

Document surface:

```text
repo-relative path
Copy source reference
rendered Markdown
selected-heading scroll/highlight
```

At the single HTML render site:

```svelte
<!-- eslint-disable-next-line svelte/no-at-html-tags -- repo-authored Markdown; raw HTML is escaped by plan-workspace renderer -->
{@html document.renderedHtml}
```

Keep Plan diagnostics markup local; do not refactor `AssetsView.svelte` for this ticket.

- [ ] **6. Verify GREEN with a task-local lint gate**

```bash
bunx vitest run apps/layout-editor/src/lib/plan-store.test.ts apps/layout-editor/src/lib/PlanSidebar.test.ts apps/layout-editor/src/lib/PlanView.test.ts
bun run editor:check
bunx eslint \
  apps/layout-editor/src/lib/plan-store.svelte.ts \
  apps/layout-editor/src/lib/plan-store.test.ts \
  apps/layout-editor/src/lib/PlanSidebar.svelte \
  apps/layout-editor/src/lib/PlanSidebar.test.ts \
  apps/layout-editor/src/lib/PlanView.svelte \
  apps/layout-editor/src/lib/PlanView.test.ts
```

- [ ] **7. Commit**

```bash
git add apps/layout-editor/src/lib/plan-store.svelte.ts apps/layout-editor/src/lib/plan-store.test.ts apps/layout-editor/src/lib/PlanSidebar.svelte apps/layout-editor/src/lib/PlanSidebar.test.ts apps/layout-editor/src/lib/PlanView.svelte apps/layout-editor/src/lib/PlanView.test.ts
git commit -m "feat(layout-editor): add Story Workbench Plan views"
```

---

## Task 5: Wire Plan into the Workbench shell

**Files**

- Modify `apps/layout-editor/src/App.svelte`
- Modify `apps/layout-editor/src/App.test.ts`

Plan loading/selection remains in the store; App owns only mode/layout integration.

- [ ] **1. Write only App-owned integration tests**

Cover:

```text
- mode controls are Reader | Assets | Plan | Stage and Plan replaces the scene-tree/detail slots;
- entering/leaving Plan preserves the selected gameplay chapter/scene;
- first Plan entry triggers one store-backed snapshot load.
```

Do not duplicate store generation/selection tests in `App.test.ts`.

- [ ] **2. Confirm RED**

```bash
bunx vitest run apps/layout-editor/src/App.test.ts
```

- [ ] **3. Integrate the fourth mode**

Extend only:

```ts
type WorkbenchMode = "reader" | "assets" | "plan" | "stage";
```

In `setMode()`:

```text
reader -> existing Reader behavior
assets -> existing Assets ownership
plan   -> ensurePlanLoaded(); return
stage  -> existing Stage behavior
```

Do not add Plan `$state` fields/generation counters to `App.svelte` and do not clear gameplay selection on Plan entry.

Sidebar:

```svelte
{#if mode === "plan"}
  <PlanSidebar ... />
{:else}
  <!-- existing scene tree -->
{/if}
```

Detail order remains explicit:

```text
Reader → Assets → Plan → Stage
```

Pass Plan state/actions into `PlanSidebar` and `PlanView`; components do not load/parse files.

- [ ] **4. Verify editor integration**

```bash
bun run --cwd apps/layout-editor test
bun run editor:check
```

- [ ] **5. Run full ticket verification**

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

- [ ] **6. Manual smoke against real authored documents**

Run `bun run dev:editor` and verify:

1. Reader still opens by default.
2. Plan lists Story Bible + current chapter plans.
3. Compact outline shows H1/H2; Show all levels exposes H3+.
4. Overview shows 8 chapter rows and the six Aoba stages.
5. Every Aoba row opens Story Bible §18.5.
6. Collection source actions jump to §10 / §18.5.
7. Chapter 1 compact outline reaches `1. 全章前台證據包`.
8. Chapter 2 compact outline reaches `12. 最終審查會 Proof Order`.
9. Refresh reflects a harmless Markdown edit/revert and preserves valid Plan selection.
10. Returning to Reader/Assets/Stage preserves gameplay selection; Stage save still works for investigation scenes.

Chapter 1 has no dedicated Proof Order heading; do not invent one.

- [ ] **7. Commit**

```bash
git add apps/layout-editor/src/App.svelte apps/layout-editor/src/App.test.ts
git commit -m "feat(layout-editor): add Story Workbench Plan mode"
```

---

## Final implementation review

Before marking PR #82 ready, confirm only the high-value invariants:

- §10 and §18.5 are the sole derived-view sources; no heuristic joins exist.
- Heading IDs come from the same Marked token identities that are rendered; raw HTML is escaped.
- Aoba rows source back to §18.5 without a second relationship model.
- Drift remains visible through `PlanDiagnostic` while raw documents stay readable.
- Plan state lives outside `App.svelte`; Reader/Assets/Stage behavior is unchanged.
- Chapter 1 `1. 全章前台證據包` and Chapter 2 `12. 最終審查會 Proof Order` are reachable.
- No row → chapter-plan navigation, source editing, AI, graph sidecar, watcher, or generic diagnostics framework was introduced.
- The real-corpus verifier and full ticket checks pass.
