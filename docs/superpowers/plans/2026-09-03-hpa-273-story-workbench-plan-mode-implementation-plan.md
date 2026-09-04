# HPA-273 Story Workbench Plan Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Story Workbench Plan mode that browses canonical planning Markdown, projects the explicit eight-chapter overview, visualizes the authored Aoba reveal/boundary ladder, and links structured rows to existing chapter plans without creating a second story model.

**Architecture:** Rust returns one fixed-domain planning snapshot through the existing text-source reader. TypeScript uses Marked plus Plan-owned heading semantics to derive only two exact Story Bible tables and one exact override blockquote. A Plan-specific Svelte rune store owns snapshot/selection state; `App.svelte` only wires the fourth mode into its two layout slots.

**Tech Stack:** Rust, Tauri 2, Svelte 5, TypeScript, Vitest, Testing Library, Bun, `marked`.

**Spec:** `docs/superpowers/specs/2026-09-03-hpa-273-story-workbench-plan-mode-design.md`

## Global constraints

- One ticket, one PR.
- Story Markdown remains canonical.
- Matrix source: Story Bible `# 10. 章節總覽` only.
- Aoba source: Story Bible `## 18.5 第一幕 reveal ladder` only.
- Override callout: first blockquote after exact Story Bible `# 18` and before exact `## 18.1` only.
- Source drift → Plan diagnostic; never prose/table inference.
- Keep path and bare anchor separate; compose copy text through `planSourceRef()`.
- Reuse `CompileError` structurally; do not run compiler validation policy.
- No public generic table model.
- No write path, AI, graph sidecar, Chapter 2 map visualization, watcher, or arbitrary path read.
- Reader/Assets/Stage behavior and gameplay selection remain intact.
- Do not extract a shared `DiagnosticList.svelte` in this ticket.

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

- [ ] **1. Write failing Rust boundary tests**

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
fn plan_workspace_maps_only_missing_required_bible_to_plan_error() {
    let root = temp_workbench_root();
    assert_eq!(
        load_plan_workspace_at_root(&root).unwrap_err().code,
        "planStoryBibleNotFound"
    );

    fs::write(root.join("docs/stories_plan/final_story_bible.md"), "# Bible\n").unwrap();
    assert_eq!(load_plan_workspace_at_root(&root).unwrap().documents.len(), 1);
}
```

Also cover:

```text
- chapter_0_plan.md is ignored;
- non-numeric chapter names are ignored;
- read_dir entry failures are propagated rather than filter_map(Result::ok)-dropped;
- ordinary discovered-file read errors remain existing notFound/readFailed errors;
- a valid Bible with zero chapter-plan files is valid.
```

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

Update existing Assets config-source fields and `read_text_source()` return type to use this name. Serialized Assets payload stays exactly `{ path, content }`.

- [ ] **4. Add Plan wire structs with one identity constructor**

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

Do not scatter derivation of `id` / `kind` / `chapter_number`. Add one constructor/helper that creates either:

```text
story-bible   / StoryBible  / None
chapter-N-plan / ChapterPlan / Some(N)
```

Parse only exact root filenames, without a regex dependency:

```rust
fn chapter_plan_number(name: &str) -> Option<u32> {
    let raw = name.strip_prefix("chapter_")?.strip_suffix("_plan.md")?;
    let number = raw.parse::<u32>().ok()?;
    (number > 0).then_some(number)
}
```

- [ ] **5. Implement the loader through `read_text_source()`**

`load_plan_workspace_at_root()` must:

1. normalize the root once;
2. call `read_text_source()` for `docs/stories_plan/final_story_bible.md`;
3. map only that required file's `notFound` to `planStoryBibleNotFound`;
4. call `read_dir(docs/stories_plan)` once;
5. propagate directory-entry errors;
6. retain only regular root files accepted by `chapter_plan_number()`;
7. sort them by numeric chapter number;
8. call `read_text_source()` for each chapter plan, preserving ordinary `notFound` / `readFailed` errors;
9. return Story Bible first.

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

## Task 2: Project Markdown with stable Plan semantics and exact source contracts

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

- [ ] **1. Install the one Markdown dependency**

```bash
bun add --cwd apps/layout-editor marked
```

Do not add `github-slugger`, `marked-gfm-heading-id`, DOMPurify, or another Markdown plugin/framework.

- [ ] **2. Write failing anchor/source-ref tests**

`planAnchor()` is deterministic for a given per-document sequence but mutates the supplied `seen` map. Tests pin that behavior rather than calling the helper pure:

```ts
it("pins Plan heading anchors independently of Marked defaults", () => {
  const seen = new Map<string, number>();
  expect(planAnchor("10. 章節總覽", seen)).toBe("10-章節總覽");
  expect(planAnchor("重複", seen)).toBe("重複");
  expect(planAnchor("重複", seen)).toBe("重複-1");
  expect(planAnchor("Hello, World!", seen)).toBe("hello-world");
});

it("composes a hash only at the Plan source-ref boundary", () => {
  expect(planSourceRef("docs/stories_plan/final_story_bible.md", "10-章節總覽"))
    .toBe("docs/stories_plan/final_story_bible.md#10-章節總覽");
  expect(planSourceRef("docs/stories_plan/final_story_bible.md", null))
    .toBe("docs/stories_plan/final_story_bible.md");
});
```

Document in code that Plan anchors are bare DOM IDs, unlike Reader's already-`#`-prefixed `sourceAnchor` representation.

- [ ] **3. Write failing heading-token tests before renderer code**

Cover plain display text and the traversal mismatch that an index-based renderer would miss:

```ts
it("uses rendered/plain heading text in the outline", () => {
  const workspace = projectPlanWorkspace(bible("## 18.6 `ZW_A16.lock` 與青葉\n"));
  expect(workspace.documents[0]!.headings[0]!.text)
    .toBe("18.6 ZW_A16.lock 與青葉");
});

it("binds renderer anchors to heading token identity, including nested headings", () => {
  const workspace = projectPlanWorkspace(
    bible("> ## Nested\n\n## After\n"),
  );
  const document = workspace.documents[0]!;

  expect(document.headings.map((heading) => heading.anchor)).toEqual([
    "nested",
    "after",
  ]);
  expect(document.renderedHtml).toContain('id="nested"');
  expect(document.renderedHtml).toContain('id="after"');
});
```

Do **not** implement `headings[headingIndex++]` across a separate renderer traversal.

- [ ] **4. Write failing strict-projection tests**

Cover exact §10 and §18 contracts:

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

it("diagnoses section-10 rows that are not exactly chapters 1 through 8", () => {
  const workspace = projectPlanWorkspace(eightChapterTableWithChapter7Missing());
  expect(workspace.chapterOverview).not.toBeNull();
  expect(workspace.diagnostics.map((d) => d.code))
    .toContain("chapterOverviewUnexpectedRows");
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

- [ ] **5. Reuse the existing diagnostic type directly**

```ts
import type { CompileError } from "@lyra/scripts/compile-scenes/types";

export type PlanDiagnosticCode =
  | "chapterOverviewMissing"
  | "chapterOverviewInvalid"
  | "chapterOverviewUnexpectedRows"
  | "aobaRevealLadderMissing"
  | "aobaRevealLadderInvalid";

export type PlanDiagnostic = CompileError & {
  code: PlanDiagnosticCode;
};
```

Add a shape test:

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

Import only the type. Do not run compiler validators.

- [ ] **6. Confirm RED**

```bash
bunx vitest run apps/layout-editor/src/lib/plan-workspace.test.ts
```

Expected: module/functions do not exist.

- [ ] **7. Implement Plan anchor/source helpers**

```ts
/**
 * Returns the next deterministic anchor for this per-document heading sequence.
 * Mutates `seen` to allocate duplicate suffixes.
 */
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

Anchor stability is library-stable, **not content-edit stable**: inserting an earlier duplicate can renumber later `-N` suffixes.

- [ ] **8. Implement one token tree + token-identity renderer binding**

Public Plan types stay small:

```ts
export type PlanHeading = {
  level: number;
  text: string;   // plain display text
  anchor: string; // bare DOM/source anchor
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

There is **no exported `PlanTable`**.

Implementation shape:

```ts
const tokens = marked.lexer(document.content, { gfm: true });
const seen = new Map<string, number>();
const anchorByHeadingToken = new WeakMap<Tokens.Heading, string>();

// Recursively visit the actual Marked token tree in document order.
// For every heading token:
//   1. flatten its inline tokens to plain display text;
//   2. allocate planAnchor(displayText, seen);
//   3. push PlanHeading;
//   4. anchorByHeadingToken.set(token, anchor).

const renderer = new marked.Renderer();
renderer.heading = function (token) {
  const anchor = anchorByHeadingToken.get(token);
  if (!anchor) throw new Error("Plan heading token missing assigned anchor");
  return `<h${token.depth} id="${escapeHtml(anchor)}">${this.parser.parseInline(token.tokens)}</h${token.depth}>`;
};
renderer.html = ({ text }) => escapeHtml(text);

const renderedHtml = marked.parser(tokens, { renderer });
```

Use the **same token array** for assignment and rendering. The recursive walk must cover standard nested block token carriers (not only top-level `tokens`) so blockquote/list headings cannot shift later IDs.

`escapeHtml()` is a tiny local helper for `& < > " '`. Add a test proving authored raw HTML such as `<script>` is escaped rather than emitted as an element.

Exact §10 / §18 contracts are top-level authored sections. Keep a top-level-token line cursor for diagnostic line numbers; nested outline headings do not need a public line field.

- [ ] **9. Implement only the exact §10 / §18 contracts**

Keep these constants local:

```ts
const CHAPTER_HEADING = "10. 章節總覽";
const CHAPTER_HEADERS = ["章節", "標題", "案件類型", "變體", "主線誤導"];
const EXPECTED_CHAPTERS = ["1", "2", "3", "4", "5", "6", "7", "8"];
const AOBA_ADDENDUM_HEADING = "18. Canon Addendum：第一幕青葉提問契約（2026-08-23）";
const AOBA_18_1_HEADING = "18.1 為什麼需要這個更新";
const AOBA_HEADING = "18.5 第一幕 reveal ladder";
const AOBA_HEADERS = ["章節", "必須建立", "絕對不能建立"];
```

Rules:

- missing exact §10 heading → `chapterOverviewMissing`;
- exact heading but absent/malformed expected table/header → `chapterOverviewInvalid`;
- valid §10 table/header but chapter values != `EXPECTED_CHAPTERS` → `chapterOverviewUnexpectedRows`, while keeping extracted rows visible;
- missing exact §18.5 heading → `aobaRevealLadderMissing`;
- exact §18.5 heading but absent/malformed expected table/header → `aobaRevealLadderInvalid`;
- §18 override uses only the first top-level blockquote after exact H1 and before exact H2 `18.1 為什麼需要這個更新`;
- no fallback to nearby tables/prose.

Missing-section diagnostics use line 1; malformed/row diagnostics use the relevant top-level heading/table start line.

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

- [ ] **1. Build the payload from explicit repo-relative paths**

Do **not** reimplement Rust's chapter-plan directory discovery in TypeScript. Rust fixture tests own numeric discovery and nested-file exclusion.

Use constants that are always repo-relative source identities:

```ts
const BIBLE_PATH = "docs/stories_plan/final_story_bible.md";
const CH1_PATH = "docs/stories_plan/chapter_1_plan.md";
const CH2_PATH = "docs/stories_plan/chapter_2_plan.md";

function readSource(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}
```

Construct the wire payload with repo-relative `path` and absolute/resolved reads kept separate:

```ts
const payload: WorkbenchPlanWorkspacePayload = {
  documents: [
    {
      id: "story-bible",
      kind: "storyBible",
      chapterNumber: null,
      path: BIBLE_PATH,
      content: readSource(BIBLE_PATH),
    },
    {
      id: "chapter-1-plan",
      kind: "chapterPlan",
      chapterNumber: 1,
      path: CH1_PATH,
      content: readSource(CH1_PATH),
    },
    {
      id: "chapter-2-plan",
      kind: "chapterPlan",
      chapterNumber: 2,
      path: CH2_PATH,
      content: readSource(CH2_PATH),
    },
  ],
};
```

- [ ] **2. Assert structural projection + rendered-document behavior**

After `projectPlanWorkspace(payload)` assert:

```ts
expectExact(workspace.chapterOverview?.rows.map((row) => row.chapter), [
  "1", "2", "3", "4", "5", "6", "7", "8",
]);
expectExact(workspace.aobaReveal?.stages.map((row) => row.chapterLabel), [
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

Also assert:

```ts
bible.path === BIBLE_PATH
expectDocument("chapter-1-plan").path === CH1_PATH
expectDocument("chapter-2-plan").path === CH2_PATH
```

Implement `expectDocument`, `expectExact`, `expectHeadingAnchor`, `expectTableContains`, and `formatDiagnostics` as tiny script-local helpers. `expectTableContains` must confirm the text occurs inside a `<table ...>...</table>` region, not merely elsewhere in the HTML.

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

Do not add another CI job.

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

## Task 4: Add the Plan store and read-only Plan UI

**Files**

- Create `apps/layout-editor/src/lib/plan-store.svelte.ts`
- Create `apps/layout-editor/src/lib/plan-store.test.ts`
- Create `apps/layout-editor/src/lib/PlanSidebar.svelte`
- Create `apps/layout-editor/src/lib/PlanSidebar.test.ts`
- Create `apps/layout-editor/src/lib/PlanView.svelte`
- Create `apps/layout-editor/src/lib/PlanView.test.ts`

### 4A. Plan state ownership

- [ ] **1. Write failing Plan-store tests**

Mock `loadPlanWorkspace()` and cover:

```text
- ensurePlanLoaded() loads only when workspace is absent and no load is active
- refreshPlan() explicitly reloads even when a workspace already exists
- slower old refresh cannot overwrite a newer refresh
- selected document survives refresh when still present
- selected anchor survives only when that heading still exists
- missing selected document falls back to story-bible and clears its anchor
- navigatePlanSource(id, anchor) selects that document/anchor and document surface
- showPlanOverview() changes only Plan surface/anchor state
```

The generation counter belongs here, not in `App.test.ts`.

- [ ] **2. Confirm store RED**

```bash
bunx vitest run apps/layout-editor/src/lib/plan-store.test.ts
```

Expected: store module does not exist.

- [ ] **3. Implement `plan-store.svelte.ts`**

Keep the store closed to Plan:

```ts
export type PlanSurface = "overview" | "document";

export const planState = $state<{
  workspace: PlanWorkspace | null;
  error: string | null;
  loading: boolean;
  surface: PlanSurface;
  selectedDocumentId: string;
  selectedAnchor: string | null;
}>({
  workspace: null,
  error: null,
  loading: false,
  surface: "overview",
  selectedDocumentId: "story-bible",
  selectedAnchor: null,
});

let loadGeneration = 0;
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

`refreshPlan()`:

1. increments `loadGeneration`;
2. calls fixed `loadPlanWorkspace()`;
3. ignores stale success/error/finally writes;
4. projects through `projectPlanWorkspace()`;
5. reconciles selected document + anchor against the new projection.

Reuse existing `normalizeError()` rather than adding a new error framework.

Do not introduce a generic mode store.

### 4B. Presentation components

- [ ] **4. Write failing `PlanSidebar` tests**

Cover:

```text
- Story Bible appears before Chapter 1/2 plans
- default selected-document outline shows only level <= 2 headings
- H3+ headings are hidden by default
- Show all levels reveals H3+
- toggling back restores the compact outline
- heading click emits the anchor already produced by projectPlanWorkspace()
- Chapter 1 `1. 全章前台證據包` and Chapter 2 `12. 最終審查會 Proof Order` are reachable in compact mode
```

`showAllLevels` is local component state; do not persist it in the Plan store.

- [ ] **5. Write failing `PlanView` tests**

Cover:

```text
- Overview renders eight-chapter table
- Aoba timeline + 必須建立/絕對不能建立 boundaries render
- first §18 override callout renders
- Open source emits story-bible + stored derived anchor
- §10 row navigates to matching chapter-plan document when it exists
- §10 row stays plain when no chapter plan exists
- exact single-chapter Aoba label navigates when matching plan exists
- Aoba range label `第 5～7 章` stays plain
- diagnostics do not hide Document view
- diagnostic markup includes code/message/sourceFile/line
- Copy source reference composes exact path#anchor through planSourceRef()
- renderedHtml is displayed as the document body
```

The component may locate a target document with existing `document.chapterNumber`; do not add another row-to-document model.

- [ ] **6. Confirm component RED**

```bash
bunx vitest run apps/layout-editor/src/lib/PlanSidebar.test.ts apps/layout-editor/src/lib/PlanView.test.ts
```

Expected: component modules do not exist.

- [ ] **7. Implement `PlanSidebar.svelte`**

Render:

```text
Overview
Story Bible
  H1/H2 headings by default...
  [Show all levels]
Chapter 1 plan
Chapter 2 plan
```

Use `document.headings`; no parser/tree library. Heading indentation may use `level` only.

When `showAllLevels` is false:

```ts
headings.filter((heading) => heading.level <= 2)
```

Only show the toggle when the selected document actually has H3+ headings.

- [ ] **8. Implement `PlanView.svelte`**

Overview order:

1. exact first §18 override callout;
2. Plan-local diagnostics;
3. eight-chapter matrix;
4. Aoba reveal timeline;
5. Aoba boundary table.

Do **not** refactor `AssetsView.svelte` into a new shared diagnostics component. Reuse the diagnostic type; keep Plan's small markup local because it includes source file/line and this ticket otherwise leaves Assets untouched.

Overview source buttons:

```text
chapterOverview.anchor
→ onNavigateSource("story-bible", anchor)

aobaReveal.anchor
→ onNavigateSource("story-bible", anchor)
```

Row-to-plan navigation:

```text
§10 row.chapter = "N"
→ find workspace.documents chapterNumber === N
→ document button if present, plain text otherwise

Aoba chapterLabel = exact `第 N 章`
→ same lookup

Aoba range / non-exact label
→ plain text
```

Document surface:

- canonical path from selected document;
- Copy source reference via `planSourceRef(document.path, selectedAnchor)`;
- render `renderedHtml`;
- scroll selected heading into view by its Plan-owned DOM `id`;
- style headings/tables/blockquotes/code locally.

At the one `{@html}` render site, add a scoped rule exception, not a file/global disable:

```svelte
<!-- eslint-disable-next-line svelte/no-at-html-tags -- repo-authored Markdown; raw HTML is escaped by plan-workspace renderer -->
{@html document.renderedHtml}
```

The repo's recommended Svelte ESLint config enables `svelte/no-at-html-tags`; the comment is part of the rendering contract, not optional cleanup.

For source `mustNotEstablish === "—"`, presentation may say `No additional early-reveal prohibition authored.` without changing the source model.

- [ ] **9. Verify store + components GREEN, including the lint boundary now**

```bash
bunx vitest run apps/layout-editor/src/lib/plan-store.test.ts apps/layout-editor/src/lib/PlanSidebar.test.ts apps/layout-editor/src/lib/PlanView.test.ts
bun run editor:check
bun run lint
```

Do not defer `bun run lint` until Task 5; this is where `{@html}` enters the repo.

- [ ] **10. Commit**

```bash
git add apps/layout-editor/src/lib/plan-store.svelte.ts apps/layout-editor/src/lib/plan-store.test.ts apps/layout-editor/src/lib/PlanSidebar.svelte apps/layout-editor/src/lib/PlanSidebar.test.ts apps/layout-editor/src/lib/PlanView.svelte apps/layout-editor/src/lib/PlanView.test.ts
git commit -m "feat(layout-editor): add Story Workbench Plan views"
```

---

## Task 5: Integrate Plan as the fourth Workbench mode

**Files**

- Modify `apps/layout-editor/src/App.svelte`
- Modify `apps/layout-editor/src/App.test.ts`

The Plan store owns snapshot/refresh/selection details. Do not recreate them in App.

- [ ] **1. Write only the App integration tests that App actually owns**

Extend the existing invoke mock with a minimal valid `load_plan_workspace` response and cover:

```text
- mode buttons are Reader | Assets | Plan | Stage and Plan renders Plan sidebar/detail slots
- first Plan entry reaches ensurePlanLoaded() / one fixed snapshot load
- entering/leaving Plan preserves selected gameplay chapter/scene
```

Keep all existing Reader/Assets/Stage tests unchanged. Do **not** duplicate generation-fence or Plan selection-refresh tests here; those belong to `plan-store.test.ts`.

- [ ] **2. Confirm RED**

```bash
bunx vitest run apps/layout-editor/src/App.test.ts
```

Expected: Plan mode does not exist.

- [ ] **3. Extend only the explicit mode union**

```ts
type WorkbenchMode = "reader" | "assets" | "plan" | "stage";
```

Import Plan presentation + store functions/state. Do **not** add Plan `$state` fields or a Plan generation counter to `App.svelte`.

- [ ] **4. Extend mode ownership without changing gameplay scene behavior**

`setMode()`:

```text
reader -> existing Reader load behavior
assets -> existing Assets ownership
plan   -> ensurePlanLoaded(); return
stage  -> existing investigation-only Stage behavior
```

Do not clear `selectedChapterId` / `selectedSceneId` on Plan entry.

The existing scene selection handler should treat Plan like Assets for gameplay loading: update shared selected chapter/scene if a scene-tree interaction is ever reachable, but do not start Reader/Stage loads from Plan.

- [ ] **5. Wire Plan store into the two layout slots**

Sidebar:

```svelte
{#if mode === "plan"}
  <PlanSidebar
    workspace={planState.workspace}
    surface={planState.surface}
    selectedDocumentId={planState.selectedDocumentId}
    selectedAnchor={planState.selectedAnchor}
    ...callbacks
  />
{:else}
  <!-- existing scene tree unchanged -->
{/if}
```

Detail branch order:

```text
Reader → Assets → Plan → Stage
```

`PlanView` receives:

```text
planState.workspace/error/loading/surface/selection
refreshPlan
showPlanOverview
selectPlanDocument
selectPlanHeading/navigatePlanSource
```

The components do not load or parse sources themselves.

- [ ] **6. Verify editor behavior**

```bash
bun run --cwd apps/layout-editor test
bun run editor:check
bun run lint
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

- [ ] **8. Manual smoke against the real corpus**

Run `bun run dev:editor` and verify:

1. Reader still opens by default.
2. Plan lists Story Bible + current Chapter 1/2 plans.
3. Compact outline shows H1/H2 without hundreds of lower-level headings.
4. `Show all levels` reveals H3+ and can collapse again.
5. Overview shows 8 chapter rows and the six authored Aoba stages.
6. Chapter 1/2 matrix rows navigate to their chapter-plan documents; unavailable later chapters remain plain.
7. Single-chapter Aoba rows navigate when their plan exists; `第 5～7 章` remains plain.
8. `Open source` jumps to Story Bible `10. 章節總覽` / `18.5 第一幕 reveal ladder` as appropriate.
9. Chapter 1 compact outline jumps to **`1. 全章前台證據包`**.
10. Chapter 2 compact outline jumps to **`12. 最終審查會 Proof Order`**.
11. Refresh reflects a harmless Markdown edit/revert while preserving valid Plan selection.
12. Returning to Reader/Assets/Stage preserves the gameplay scene selection; Stage save still works for investigation scenes.

Do not invent a Chapter 1 `Proof Order` heading. Revert the harmless Markdown smoke edit.

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
- [ ] Only the first §18 blockquote before §18.1 becomes the override callout.
- [ ] `planAnchor()` owns every Plan heading ID and is documented as mutating its per-document `seen` map.
- [ ] Nested headings are bound to renderer IDs by heading-token identity, never array index.
- [ ] Heading sidebar text is plain display text, not raw inline Markdown.
- [ ] Plan keeps bare anchors; `planSourceRef()` adds `#` only when composing copied refs.
- [ ] Anchor stability is not claimed across future duplicate-heading insertion/reordering.
- [ ] No public `PlanTable[]` model exists.
- [ ] `PlanDiagnostic` extends `CompileError` with a Plan-specific code union.
- [ ] `chapterOverviewUnexpectedRows` has a concrete producer/test for any chapter sequence other than 1→8.
- [ ] Source drift gives diagnostics while readable documents remain available.
- [ ] Rust reuses `read_text_source()`, centralizes document identity derivation, exposes no Plan path argument, and does not descend into playable Markdown.
- [ ] Real-corpus verifier keeps repo-relative `path` separate from resolved filesystem reads.
- [ ] Real-corpus verification includes rendered GFM-table content, not only extracted rows.
- [ ] Plan snapshot/load/selection state lives in `plan-store.svelte.ts`, not `App.svelte`.
- [ ] Overview rows navigate to existing chapter plans without a new story-link model.
- [ ] Outline defaults to H1/H2 and expands locally on demand.
- [ ] The only `{@html}` use has a scoped `svelte/no-at-html-tags` exception justified by the Plan renderer boundary.
- [ ] Task 4 runs `bun run lint` immediately after introducing `{@html}`.
- [ ] Assets diagnostics markup was not refactored solely for this ticket.
- [ ] No source editing, AI, graph sidecar, generic knowledge model, watcher, or diagnostics framework was introduced.
- [ ] `verify:plan-real-content` runs in the existing frontend CI job.
- [ ] Reader/Assets/Stage remain behaviorally unchanged.
- [ ] All full-ticket checks pass.
