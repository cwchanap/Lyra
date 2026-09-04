# HPA-273 Story Workbench Plan Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Story Workbench Plan mode that browses canonical planning Markdown, renders the explicit eight-chapter overview, and visualizes the authored Aoba reveal/boundary ladder without creating a second story model.

**Architecture:** Rust owns one no-argument fixed-domain planning snapshot containing `final_story_bible.md` plus existing root `chapter_<N>_plan.md` files. A pure TypeScript projection parses Markdown, derives only the exact Story Bible §10 chapter table and §18.5 Aoba table, and reports source drift instead of inferring replacements. Svelte adds Plan-specific sidebar/content UI while preserving the current Reader/Assets/Stage scene selection and behavior.

**Tech Stack:** Rust + Tauri 2, Svelte 5, TypeScript, Vitest, Testing Library, Bun, `marked` for read-only GFM rendering.

**Spec:** `docs/superpowers/specs/2026-09-03-hpa-273-story-workbench-plan-mode-design.md`

## Global Constraints

- Deliver **HPA-273 in one PR**; planning and implementation stay on this branch.
- `docs/stories_plan/final_story_bible.md` and existing `docs/stories_plan/chapter_<N>_plan.md` files remain source of truth.
- Do not add `story-links.yaml`, a story database, generic graph/node model, source editing, AI calls, or Chapter 2 map/board visualization.
- Rust accepts no caller-supplied Plan path; it returns only the fixed Story Bible and exact root `chapter_<N>_plan.md` matches.
- The eight-chapter matrix derives only from Story Bible `# 10. 章節總覽` with headers `章節 | 標題 | 案件類型 | 變體 | 主線誤導`.
- The Aoba timeline/boundary view derives only from Story Bible `## 18.5 第一幕 reveal ladder` with headers `章節 | 必須建立 | 絕對不能建立`.
- Missing/changed derived structures produce diagnostics; never fall back to prose inference or a “similar” table.
- Plan is read-only. No watcher/polling; explicit Refresh only.
- Reader, Assets, and Stage must preserve their current scene selection, loading, sanitizer, and layout behavior.

---

## File Structure

### Backend/domain boundary

- Modify `apps/layout-editor/src-tauri/src/lib.rs`
  - fixed Plan document discovery/read command;
  - command registration;
  - Rust fixture tests.

### Frontend wire + pure projection

- Modify `apps/layout-editor/src/lib/workbench-types.ts`
  - raw Plan snapshot wire types.
- Modify `apps/layout-editor/src/lib/workbench-api.ts`
  - `loadPlanWorkspace()` Tauri call.
- Create `apps/layout-editor/src/lib/plan-workspace.ts`
  - Markdown parsing;
  - deterministic heading anchors;
  - strict Story Bible projections;
  - diagnostics.
- Create `apps/layout-editor/src/lib/plan-workspace.test.ts`
  - all pure projection tests.
- Modify `apps/layout-editor/package.json`
  - add `marked`.
- Modify `bun.lock`
  - lock dependency.

### Plan UI

- Create `apps/layout-editor/src/lib/PlanSidebar.svelte`
- Create `apps/layout-editor/src/lib/PlanSidebar.test.ts`
- Create `apps/layout-editor/src/lib/PlanView.svelte`
- Create `apps/layout-editor/src/lib/PlanView.test.ts`
- Modify `apps/layout-editor/src/App.svelte`
- Modify `apps/layout-editor/src/App.test.ts`

### Real-corpus gate

- Create `apps/layout-editor/scripts/verify-plan-real-content.ts`
- Modify `.github/workflows/ci.yml`

---

### Task 1: Add the fixed-domain planning snapshot

**Files:**
- Modify: `apps/layout-editor/src-tauri/src/lib.rs`
- Modify: `apps/layout-editor/src/lib/workbench-types.ts`
- Modify: `apps/layout-editor/src/lib/workbench-api.ts`

**Interfaces:**
- Produces Rust command: `load_plan_workspace() -> Result<WorkbenchPlanWorkspace, EditorError>`
- Produces testable helper: `load_plan_workspace_at_root(root: &Path) -> Result<WorkbenchPlanWorkspace, EditorError>`
- Produces frontend type: `WorkbenchPlanWorkspacePayload`
- Produces frontend API: `loadPlanWorkspace(): Promise<WorkbenchPlanWorkspacePayload>`
- Later tasks consume the payload unchanged; no derived story semantics belong in Rust.

- [ ] **Step 1: Add failing Rust tests for fixed document ownership and ordering**

In the existing `#[cfg(test)]` module in `apps/layout-editor/src-tauri/src/lib.rs`, extend `temp_workbench_root()` with root-level planning files and add tests equivalent to:

```rust
#[test]
fn plan_workspace_reads_story_bible_then_numeric_chapter_plans() {
    let root = temp_workbench_root();
    fs::write(
        root.join("docs/stories_plan/final_story_bible.md"),
        "# Story Bible\n",
    )
    .unwrap();
    fs::write(
        root.join("docs/stories_plan/chapter_10_plan.md"),
        "# Chapter 10\n",
    )
    .unwrap();
    fs::write(
        root.join("docs/stories_plan/chapter_2_plan.md"),
        "# Chapter 2\n",
    )
    .unwrap();
    fs::write(
        root.join("docs/stories_plan/chapter_notes.md"),
        "# Not a canonical chapter plan\n",
    )
    .unwrap();

    let snapshot = load_plan_workspace_at_root(&root).unwrap();
    assert_eq!(
        snapshot
            .documents
            .iter()
            .map(|document| document.id.as_str())
            .collect::<Vec<_>>(),
        vec!["story-bible", "chapter-2-plan", "chapter-10-plan"]
    );
    assert_eq!(snapshot.documents[0].path, "docs/stories_plan/final_story_bible.md");
    assert_eq!(snapshot.documents[1].chapter_number, Some(2));
    assert_eq!(snapshot.documents[2].chapter_number, Some(10));
}

#[test]
fn plan_workspace_ignores_nested_playable_markdown() {
    let root = temp_workbench_root();
    fs::write(
        root.join("docs/stories_plan/final_story_bible.md"),
        "# Story Bible\n",
    )
    .unwrap();
    fs::write(
        root.join("docs/stories_plan/chapter_1/scene_a.md"),
        "# Playable scene\n",
    )
    .unwrap();

    let snapshot = load_plan_workspace_at_root(&root).unwrap();
    assert_eq!(snapshot.documents.len(), 1);
    assert_eq!(snapshot.documents[0].id, "story-bible");
}

#[test]
fn plan_workspace_requires_story_bible_but_not_chapter_plans() {
    let root = temp_workbench_root();
    let error = load_plan_workspace_at_root(&root).unwrap_err();
    assert_eq!(error.code, "planStoryBibleNotFound");

    fs::write(
        root.join("docs/stories_plan/final_story_bible.md"),
        "# Story Bible\n",
    )
    .unwrap();
    let snapshot = load_plan_workspace_at_root(&root).unwrap();
    assert_eq!(snapshot.documents.len(), 1);
}
```

Keep nested `chapter_1/scene_a.md` available because the existing workbench fixture already creates that directory.

- [ ] **Step 2: Run the focused Rust tests and confirm they fail**

Run:

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml plan_workspace -- --nocapture
```

Expected: compile/test failure because `load_plan_workspace_at_root` and the Plan structs do not exist.

- [ ] **Step 3: Implement fixed no-argument Plan discovery in Rust**

Near the existing Workbench index structs, add:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
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
    path: String,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchPlanWorkspace {
    documents: Vec<WorkbenchPlanDocument>,
}
```

Add a small filename parser with no regex dependency:

```rust
fn chapter_plan_number(file_name: &str) -> Option<u32> {
    let raw = file_name
        .strip_prefix("chapter_")?
        .strip_suffix("_plan.md")?;
    let number = raw.parse::<u32>().ok()?;
    (number > 0).then_some(number)
}
```

Add the command and helper:

```rust
#[tauri::command]
fn load_plan_workspace() -> Result<WorkbenchPlanWorkspace, EditorError> {
    let root = workspace_root()?;
    load_plan_workspace_at_root(&root)
}

fn load_plan_workspace_at_root(root: &Path) -> Result<WorkbenchPlanWorkspace, EditorError> {
    let canonical_root = normalize_existing_root(root)?;
    let planning_root = canonical_root.join(STORY_SOURCE_RELATIVE_ROOT);
    let bible_path = planning_root.join("final_story_bible.md");
    let bible_content = fs::read_to_string(&bible_path).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            EditorError::new(
                "planStoryBibleNotFound",
                "file not found: docs/stories_plan/final_story_bible.md",
            )
        } else {
            EditorError::new(
                "planDocumentReadFailed",
                format!("failed to read docs/stories_plan/final_story_bible.md: {error}"),
            )
        }
    })?;

    let mut documents = vec![WorkbenchPlanDocument {
        id: "story-bible".to_string(),
        kind: PlanDocumentKind::StoryBible,
        chapter_number: None,
        path: "docs/stories_plan/final_story_bible.md".to_string(),
        content: bible_content,
    }];

    let mut chapter_paths = fs::read_dir(&planning_root)
        .map_err(|error| {
            EditorError::new(
                "planDocumentReadFailed",
                format!("failed to read docs/stories_plan: {error}"),
            )
        })?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_name = entry.file_name();
            let file_name = file_name.to_str()?;
            let chapter_number = chapter_plan_number(file_name)?;
            entry.file_type().ok()?.is_file().then_some((chapter_number, entry.path()))
        })
        .collect::<Vec<_>>();
    chapter_paths.sort_by_key(|(chapter_number, _)| *chapter_number);

    for (chapter_number, path) in chapter_paths {
        let relative = format!("docs/stories_plan/chapter_{chapter_number}_plan.md");
        let content = fs::read_to_string(&path).map_err(|error| {
            EditorError::new(
                "planDocumentReadFailed",
                format!("failed to read {relative}: {error}"),
            )
        })?;
        documents.push(WorkbenchPlanDocument {
            id: format!("chapter-{chapter_number}-plan"),
            kind: PlanDocumentKind::ChapterPlan,
            chapter_number: Some(chapter_number),
            path: relative,
            content,
        });
    }

    Ok(WorkbenchPlanWorkspace { documents })
}
```

Do not recursively descend `docs/stories_plan`; the root-only `read_dir` is the containment rule for chapter plans.

Register `load_plan_workspace` beside `load_workbench_index`, `load_scene_bundle`, and `load_asset_workspace` in `tauri::generate_handler!`.

- [ ] **Step 4: Add matching frontend wire types and API call**

Append to `apps/layout-editor/src/lib/workbench-types.ts`:

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

Update `apps/layout-editor/src/lib/workbench-api.ts` imports and add:

```ts
export const loadPlanWorkspace = () =>
  invoke<WorkbenchPlanWorkspacePayload>("load_plan_workspace");
```

No path argument is accepted.

- [ ] **Step 5: Run backend and frontend type checks**

Run:

```bash
cargo test --manifest-path apps/layout-editor/src-tauri/Cargo.toml plan_workspace -- --nocapture
bun run editor:check
```

Expected: Rust Plan tests PASS; Svelte/TypeScript check PASS.

- [ ] **Step 6: Commit the fixed snapshot boundary**

```bash
git add apps/layout-editor/src-tauri/src/lib.rs \
  apps/layout-editor/src/lib/workbench-types.ts \
  apps/layout-editor/src/lib/workbench-api.ts
git commit -m "feat(layout-editor): load canonical planning documents"
```

---

### Task 2: Build the pure source-backed Plan projection

**Files:**
- Create: `apps/layout-editor/src/lib/plan-workspace.ts`
- Create: `apps/layout-editor/src/lib/plan-workspace.test.ts`
- Modify: `apps/layout-editor/package.json`
- Modify: `bun.lock`

**Interfaces:**
- Consumes: `WorkbenchPlanWorkspacePayload`
- Produces: `projectPlanWorkspace(payload: WorkbenchPlanWorkspacePayload): PlanWorkspace`
- Produces parsed documents, strict `chapterOverview`, strict `aobaRevealStages`, explicit override callout, and diagnostics.
- Tasks 3–5 consume only the `PlanWorkspace` projection; they must not parse Story Bible prose themselves.

- [ ] **Step 1: Install the single Markdown dependency**

Run from repo root:

```bash
bun add --cwd apps/layout-editor marked
```

Expected: `apps/layout-editor/package.json` and `bun.lock` update; no other runtime dependency is added.

- [ ] **Step 2: Write failing tests for headings, anchors, exact tables, and diagnostics**

Create `apps/layout-editor/src/lib/plan-workspace.test.ts` with compact source fixtures. Include at least these tests:

```ts
import { describe, expect, it } from "vitest";
import type { WorkbenchPlanWorkspacePayload } from "./workbench-types";
import { projectPlanWorkspace } from "./plan-workspace";

const bible = (content: string): WorkbenchPlanWorkspacePayload => ({
  documents: [
    {
      id: "story-bible",
      kind: "storyBible",
      chapterNumber: null,
      path: "docs/stories_plan/final_story_bible.md",
      content,
    },
  ],
});

it("projects duplicate heading anchors deterministically", () => {
  const workspace = projectPlanWorkspace(
    bible("# 重複\n\n## 重複\n\n## 重複\n"),
  );
  expect(workspace.documents[0]!.headings.map(({ anchor }) => anchor)).toEqual([
    "重複",
    "重複-1",
    "重複-2",
  ]);
});

it("projects the exact authored eight-chapter overview", () => {
  const rows = Array.from({ length: 8 }, (_, index) =>
    `| ${index + 1} | Chapter ${index + 1} | Case ${index + 1} | Variant ${index + 1} | Misdirection ${index + 1} |`,
  ).join("\n");
  const workspace = projectPlanWorkspace(
    bible(`# Story\n\n# 10. 章節總覽\n\n| 章節 | 標題 | 案件類型 | 變體 | 主線誤導 |\n|---|---|---|---|---|\n${rows}\n`),
  );
  expect(workspace.chapterOverview?.map(({ chapter }) => chapter)).toEqual([
    "1", "2", "3", "4", "5", "6", "7", "8",
  ]);
  expect(workspace.chapterOverview?.[0]?.sourceRef).toBe(
    "docs/stories_plan/final_story_bible.md#10-章節總覽",
  );
});

it("does not substitute another table when the chapter overview changes", () => {
  const workspace = projectPlanWorkspace(
    bible(`# Story\n\n# 3. 全篇主題\n\n| 章節 | 標題 | 案件類型 | 變體 | 主線誤導 |\n|---|---|---|---|---|\n| 1 | Wrong source | x | x | x |\n`),
  );
  expect(workspace.chapterOverview).toBeNull();
  expect(workspace.diagnostics.map(({ code }) => code)).toContain(
    "chapterOverviewMissing",
  );
});

it("uses the explicit Aoba reveal ladder without inventing states", () => {
  const workspace = projectPlanWorkspace(
    bible(`# Story\n\n# 18. Canon Addendum：第一幕青葉提問契約（2026-08-23）\n\n> 本節直接更新舊描述，以本節為準。\n\n## 18.5 第一幕 reveal ladder\n\n| 章節 | 必須建立 | 絕對不能建立 |\n|---|---|---|\n| 第 1 章 | 命名青葉 | 不揭露舊案身份 |\n| 第 8 章 | 推翻官方故事 | — |\n`),
  );
  expect(workspace.aobaRevealStages).toEqual([
    expect.objectContaining({
      chapterLabel: "第 1 章",
      mustEstablish: "命名青葉",
      mustNotEstablish: "不揭露舊案身份",
    }),
    expect.objectContaining({
      chapterLabel: "第 8 章",
      mustEstablish: "推翻官方故事",
      mustNotEstablish: "—",
    }),
  ]);
  expect(workspace.aobaOverrideNotice).toContain("以本節為準");
});
```

Also add malformed-header tests that expect `chapterOverviewInvalid` / `aobaRevealLadderInvalid` while `workspace.documents[0]` still exists and contains rendered content.

- [ ] **Step 3: Run the focused projection tests and confirm they fail**

Run:

```bash
bunx vitest run apps/layout-editor/src/lib/plan-workspace.test.ts
```

Expected: FAIL because `plan-workspace.ts` does not exist.

- [ ] **Step 4: Implement the Plan projection types and deterministic slugger**

Create `apps/layout-editor/src/lib/plan-workspace.ts` with the public model:

```ts
import { Marked, Renderer, type Token, type Tokens } from "marked";
import type {
  PlanDocumentKind,
  WorkbenchPlanDocument,
  WorkbenchPlanWorkspacePayload,
} from "./workbench-types";

export type PlanHeading = {
  level: number;
  text: string;
  anchor: string;
  sourceRef: string;
};

export type PlanTable = {
  headers: string[];
  rows: string[][];
  sourceRef: string;
};

export type ParsedPlanDocument = Omit<WorkbenchPlanDocument, "content"> & {
  renderedHtml: string;
  headings: PlanHeading[];
  tables: PlanTable[];
};

export type ChapterOverviewRow = {
  chapter: string;
  title: string;
  caseType: string;
  variant: string;
  mainMisdirection: string;
  sourceRef: string;
};

export type AobaRevealStage = {
  chapterLabel: string;
  mustEstablish: string;
  mustNotEstablish: string;
  sourceRef: string;
};

export type PlanDiagnosticCode =
  | "chapterOverviewMissing"
  | "chapterOverviewInvalid"
  | "chapterOverviewUnexpectedRows"
  | "aobaRevealLadderMissing"
  | "aobaRevealLadderInvalid";

export type PlanDiagnostic = {
  code: PlanDiagnosticCode;
  message: string;
  path: string;
  sourceRef: string | null;
};

export type PlanWorkspace = {
  documents: ParsedPlanDocument[];
  chapterOverview: ChapterOverviewRow[] | null;
  aobaRevealStages: AobaRevealStage[] | null;
  aobaOverrideNotice: string | null;
  diagnostics: PlanDiagnostic[];
};
```

Implement a local slugger whose only state is a per-document occurrence map:

```ts
function baseHeadingAnchor(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .trim()
    .replace(/\s+/g, "-");
}

function nextHeadingAnchor(
  text: string,
  occurrences: Map<string, number>,
): string {
  const base = baseHeadingAnchor(text) || "section";
  const count = occurrences.get(base) ?? 0;
  occurrences.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}
```

Use the same anchor list when generating heading `id` attributes in `renderedHtml`; do not derive a second slug in the Svelte components.

- [ ] **Step 5: Parse Markdown once and associate tables with authored headings**

Use `Marked`/`Renderer` for GFM rendering and `marked.lexer` token order for structural extraction. Raw HTML tokens must be escaped rather than injected unchanged.

The parsing loop should maintain the current heading and emit tables with that heading's `sourceRef`:

```ts
function parsePlanDocument(document: WorkbenchPlanDocument): ParsedPlanDocument {
  const tokens = marked.lexer(document.content, { gfm: true });
  const occurrences = new Map<string, number>();
  const headings: PlanHeading[] = [];
  const tables: PlanTable[] = [];
  let currentHeading: PlanHeading | null = null;

  for (const token of tokens) {
    if (token.type === "heading") {
      const anchor = nextHeadingAnchor(token.text, occurrences);
      currentHeading = {
        level: token.depth,
        text: token.text,
        anchor,
        sourceRef: `${document.path}#${anchor}`,
      };
      headings.push(currentHeading);
    }
    if (token.type === "table" && currentHeading) {
      tables.push({
        headers: token.header.map((cell) => cell.text.trim()),
        rows: token.rows.map((row) => row.map((cell) => cell.text.trim())),
        sourceRef: currentHeading.sourceRef,
      });
    }
  }

  return {
    id: document.id,
    kind: document.kind,
    chapterNumber: document.chapterNumber,
    path: document.path,
    headings,
    tables,
    renderedHtml: renderMarkdownWithHeadingIds(document.content, headings),
  };
}
```

If the installed `marked` token cell type exposes inline tokens rather than a direct `.text`, keep one local `plainText(cell)` adapter in `plan-workspace.ts`; do not leak Marked token types into components.

- [ ] **Step 6: Implement exact Story Bible projections and diagnostics**

Use exact normalized heading/header contracts:

```ts
const CHAPTER_OVERVIEW_HEADING = "10. 章節總覽";
const CHAPTER_OVERVIEW_HEADERS = [
  "章節",
  "標題",
  "案件類型",
  "變體",
  "主線誤導",
] as const;

const AOBA_ADDENDUM_HEADING =
  "18. Canon Addendum：第一幕青葉提問契約（2026-08-23）";
const AOBA_LADDER_HEADING = "18.5 第一幕 reveal ladder";
const AOBA_LADDER_HEADERS = ["章節", "必須建立", "絕對不能建立"] as const;
```

Implement `projectPlanWorkspace()` so it:

1. parses every document;
2. finds `kind === "storyBible"`;
3. finds the exact table under `CHAPTER_OVERVIEW_HEADING`;
4. validates exact headers and 8 rows / chapter values `1`…`8`;
5. finds the exact table under `AOBA_LADDER_HEADING`;
6. validates exact headers;
7. takes the blockquote immediately under `AOBA_ADDENDUM_HEADING` as `aobaOverrideNotice` when present;
8. returns diagnostics rather than using nearby prose/tables as fallback.

The row projections are direct index mappings only:

```ts
const chapterOverview = table.rows.map((row) => ({
  chapter: row[0]!,
  title: row[1]!,
  caseType: row[2]!,
  variant: row[3]!,
  mainMisdirection: row[4]!,
  sourceRef: table.sourceRef,
}));

const aobaRevealStages = table.rows.map((row) => ({
  chapterLabel: row[0]!,
  mustEstablish: row[1]!,
  mustNotEstablish: row[2]!,
  sourceRef: table.sourceRef,
}));
```

Do not extract duration/theme columns from other Story Bible sections.

- [ ] **Step 7: Run projection tests, editor tests, and type checks**

Run:

```bash
bunx vitest run apps/layout-editor/src/lib/plan-workspace.test.ts
bun run --cwd apps/layout-editor test
bun run editor:check
```

Expected: all PASS.

- [ ] **Step 8: Commit the pure projection**

```bash
git add apps/layout-editor/src/lib/plan-workspace.ts \
  apps/layout-editor/src/lib/plan-workspace.test.ts \
  apps/layout-editor/package.json bun.lock
git commit -m "feat(layout-editor): project planning markdown"
```

---

### Task 3: Gate the projection against the real planning corpus

**Files:**
- Create: `apps/layout-editor/scripts/verify-plan-real-content.ts`
- Modify: `apps/layout-editor/package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `projectPlanWorkspace()` from Task 2.
- Produces package script: `verify:plan-real-content`.
- CI uses this as a real-source drift gate; it does not create another production parser.

- [ ] **Step 1: Create a failing headless verifier against current repo files**

Create `apps/layout-editor/scripts/verify-plan-real-content.ts` following the existing Reader/Assets verifier style:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectPlanWorkspace } from "../src/lib/plan-workspace";
import type { WorkbenchPlanWorkspacePayload } from "../src/lib/workbench-types";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const planningRoot = resolve(repoRoot, "docs/stories_plan");

const chapterPlans = readdirSync(planningRoot)
  .map((name) => {
    const match = /^chapter_(\d+)_plan\.md$/.exec(name);
    return match ? { name, chapterNumber: Number(match[1]) } : null;
  })
  .filter((entry): entry is { name: string; chapterNumber: number } => entry !== null)
  .sort((a, b) => a.chapterNumber - b.chapterNumber);

const payload: WorkbenchPlanWorkspacePayload = {
  documents: [
    {
      id: "story-bible",
      kind: "storyBible",
      chapterNumber: null,
      path: "docs/stories_plan/final_story_bible.md",
      content: readFileSync(
        resolve(planningRoot, "final_story_bible.md"),
        "utf8",
      ),
    },
    ...chapterPlans.map(({ name, chapterNumber }) => ({
      id: `chapter-${chapterNumber}-plan`,
      kind: "chapterPlan" as const,
      chapterNumber,
      path: `docs/stories_plan/${name}`,
      content: readFileSync(resolve(planningRoot, name), "utf8"),
    })),
  ],
};

const workspace = projectPlanWorkspace(payload);

if (!payload.documents.some(({ id }) => id === "chapter-1-plan")) {
  throw new Error("current Chapter 1 plan is missing");
}
if (!payload.documents.some(({ id }) => id === "chapter-2-plan")) {
  throw new Error("current Chapter 2 plan is missing");
}
if (workspace.diagnostics.length > 0) {
  throw new Error(
    `Plan projection diagnostics:\n${workspace.diagnostics
      .map(({ code, message }) => `${code}: ${message}`)
      .join("\n")}`,
  );
}

const chapters = workspace.chapterOverview?.map(({ chapter }) => chapter);
if (chapters?.join(",") !== "1,2,3,4,5,6,7,8") {
  throw new Error(`unexpected chapter overview: ${chapters?.join(",") ?? "missing"}`);
}

const aobaStages = workspace.aobaRevealStages?.map(({ chapterLabel }) => chapterLabel);
const expectedAobaStages = [
  "第 1 章",
  "第 2 章",
  "第 3 章",
  "第 4 章",
  "第 5～7 章",
  "第 8 章",
];
if (aobaStages?.join("|") !== expectedAobaStages.join("|")) {
  throw new Error(`unexpected Aoba reveal ladder: ${aobaStages?.join("|") ?? "missing"}`);
}

console.log(
  `verify-plan-real-content: OK — ${payload.documents.length} planning document(s), ` +
    `${chapters.length} chapter row(s), ${aobaStages.length} Aoba stage(s)`,
);
```

- [ ] **Step 2: Run the verifier before wiring the script and confirm the projection is honest**

Run:

```bash
bun run apps/layout-editor/scripts/verify-plan-real-content.ts
```

Expected after Task 2: PASS on current `main`-derived story content. If it fails because the exact current headings/table cells differ, fix **the projector contract to match the actual authored structure described by the spec**; do not edit story canon merely to make the verifier green.

- [ ] **Step 3: Add the package script**

In `apps/layout-editor/package.json` add next to the existing real-content verifiers:

```json
"verify:reader-real-content": "bun run scripts/verify-reader-real-content.ts",
"verify:asset-real-content": "bun run scripts/verify-asset-real-content.ts",
"verify:plan-real-content": "bun run scripts/verify-plan-real-content.ts"
```

- [ ] **Step 4: Wire the Plan verifier into the existing frontend CI job**

In `.github/workflows/ci.yml`, immediately after the Asset projection gate add:

```yaml
      - name: Verify Plan real-content projection
        run: bun run --cwd apps/layout-editor verify:plan-real-content
```

Do not create another CI job.

- [ ] **Step 5: Run all three Workbench real-content gates**

Run:

```bash
bun run scenes:compile
bun run --cwd apps/layout-editor verify:reader-real-content
bun run --cwd apps/layout-editor verify:asset-real-content
bun run --cwd apps/layout-editor verify:plan-real-content
```

Expected: all PASS.

- [ ] **Step 6: Commit the real-source contract**

```bash
git add apps/layout-editor/scripts/verify-plan-real-content.ts \
  apps/layout-editor/package.json .github/workflows/ci.yml
git commit -m "test(layout-editor): gate Plan projection on real canon"
```

---

### Task 4: Build the read-only Plan sidebar and content views

**Files:**
- Create: `apps/layout-editor/src/lib/PlanSidebar.svelte`
- Create: `apps/layout-editor/src/lib/PlanSidebar.test.ts`
- Create: `apps/layout-editor/src/lib/PlanView.svelte`
- Create: `apps/layout-editor/src/lib/PlanView.test.ts`

**Interfaces:**
- Consumes: `PlanWorkspace` from Task 2.
- `PlanSidebar` produces navigation callbacks only; it owns no loading or parsing.
- `PlanView` displays either `overview` or `document`; it owns no file I/O.
- Task 5 owns shared state and connects source references to both components.

Use these explicit component contracts:

```ts
export type PlanSurface = "overview" | "document";

// PlanSidebar props
{
  workspace: PlanWorkspace;
  selectedDocumentId: string;
  selectedAnchor: string | null;
  onSelectOverview: () => void;
  onSelectDocument: (documentId: string) => void;
  onSelectHeading: (documentId: string, anchor: string) => void;
}

// PlanView props
{
  workspace: PlanWorkspace;
  surface: PlanSurface;
  selectedDocumentId: string;
  selectedAnchor: string | null;
  onNavigateSource: (sourceRef: string) => void;
}
```

- [ ] **Step 1: Write failing sidebar tests for document and heading navigation**

Create `PlanSidebar.test.ts` using a small projected fixture and Testing Library. Cover:

```ts
it("lists the Story Bible before numeric chapter plans", async () => {
  render(PlanSidebar, { props: fixtureProps });
  const buttons = screen.getAllByRole("button");
  expect(buttons.map((button) => button.textContent)).toEqual(
    expect.arrayContaining(["Overview", "Story Bible", "Chapter 1 plan", "Chapter 2 plan"]),
  );
});

it("emits the selected heading anchor", async () => {
  const onSelectHeading = vi.fn();
  render(PlanSidebar, {
    props: { ...fixtureProps, onSelectHeading },
  });
  await user.click(screen.getByRole("button", { name: /18\.5 第一幕 reveal ladder/i }));
  expect(onSelectHeading).toHaveBeenCalledWith(
    "story-bible",
    "185-第一幕-reveal-ladder",
  );
});
```

Use the actual slug returned by the fixture's `projectPlanWorkspace()` rather than hard-coding a second slug algorithm in the test helper.

- [ ] **Step 2: Write failing Plan view tests for overview, boundaries, diagnostics, and source navigation**

Create `PlanView.test.ts` with tests equivalent to:

```ts
it("renders the explicit chapter overview and Aoba boundaries", () => {
  render(PlanView, { props: overviewProps });
  expect(screen.getByRole("heading", { name: "Eight-chapter overview" })).toBeInTheDocument();
  expect(screen.getByText("第 5～7 章")).toBeInTheDocument();
  expect(screen.getByText("必須建立")).toBeInTheDocument();
  expect(screen.getByText("絕對不能建立")).toBeInTheDocument();
});

it("navigates a source-backed overview row", async () => {
  const onNavigateSource = vi.fn();
  render(PlanView, { props: { ...overviewProps, onNavigateSource } });
  await user.click(screen.getAllByRole("button", { name: /Open source/i })[0]!);
  expect(onNavigateSource).toHaveBeenCalledWith(
    expect.stringContaining("docs/stories_plan/final_story_bible.md#"),
  );
});

it("keeps the raw document readable when a derived structure has diagnostics", () => {
  render(PlanView, { props: diagnosticDocumentProps });
  expect(screen.getByText(/chapterOverviewMissing/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /Story Bible/ })).toBeInTheDocument();
});
```

Add a clipboard test by stubbing `navigator.clipboard.writeText` and asserting the exact `<path>#<anchor>` string.

- [ ] **Step 3: Run the new component tests and confirm they fail**

Run:

```bash
bunx vitest run \
  apps/layout-editor/src/lib/PlanSidebar.test.ts \
  apps/layout-editor/src/lib/PlanView.test.ts
```

Expected: FAIL because the components do not exist.

- [ ] **Step 4: Implement `PlanSidebar.svelte` as explicit Plan navigation**

The sidebar should render:

```text
Plan
  Overview
  Story Bible
    <heading outline>
  Chapter 1 plan
  Chapter 2 plan
```

Only expand the selected document's heading outline. Use `document.headings` from `PlanWorkspace`; do not parse Markdown in the component.

Heading indentation can be a simple left padding based on `heading.level - 1`. Keep native buttons; no tree library.

Label documents with one helper local to the component:

```ts
function documentLabel(document: ParsedPlanDocument): string {
  if (document.kind === "storyBible") return "Story Bible";
  return `Chapter ${document.chapterNumber} plan`;
}
```

The component does not mutate scene selection.

- [ ] **Step 5: Implement `PlanView.svelte` Overview**

Overview order:

1. heading `Plan overview`;
2. explicit §18 override callout when `aobaOverrideNotice !== null`;
3. diagnostics callout list when non-empty;
4. `Eight-chapter overview` table;
5. `Aoba reveal timeline` ordered cards/rows;
6. `Aoba reveal boundaries` table.

Each matrix/timeline/boundary row gets a small `Open source` button wired to its existing `sourceRef`.

For Chapter 8 `mustNotEstablish === "—"`, display:

```text
No additional early-reveal prohibition authored.
```

Do not change the stored source value.

- [ ] **Step 6: Implement `PlanView.svelte` Document view**

For the selected document:

- show canonical `document.path`;
- show `Copy source reference` using the selected heading when present, otherwise path only;
- render `document.renderedHtml` in one `.plan-markdown` container;
- after render/anchor change, use `document.getElementById(selectedAnchor)?.scrollIntoView({ block: "start" })` inside a Svelte effect guarded for browser availability;
- visually mark the selected heading with a small CSS class or `:target`-style treatment without modifying Markdown text.

The `renderedHtml` was produced from repository-owned Markdown with raw HTML disabled in Task 2; the component does not run another parser.

Style headings, tables, blockquotes, lists, and code blocks using component-local Tailwind/global descendant classes. Do not add a general Markdown theme package.

- [ ] **Step 7: Run component tests and editor checks**

Run:

```bash
bunx vitest run \
  apps/layout-editor/src/lib/PlanSidebar.test.ts \
  apps/layout-editor/src/lib/PlanView.test.ts
bun run editor:check
```

Expected: PASS.

- [ ] **Step 8: Commit the Plan presentation**

```bash
git add apps/layout-editor/src/lib/PlanSidebar.svelte \
  apps/layout-editor/src/lib/PlanSidebar.test.ts \
  apps/layout-editor/src/lib/PlanView.svelte \
  apps/layout-editor/src/lib/PlanView.test.ts
git commit -m "feat(layout-editor): render Story Workbench Plan views"
```

---

### Task 5: Integrate Plan as the fourth functional Workbench mode

**Files:**
- Modify: `apps/layout-editor/src/App.svelte`
- Modify: `apps/layout-editor/src/App.test.ts`

**Interfaces:**
- Consumes: `loadPlanWorkspace()`, `projectPlanWorkspace()`, `PlanSidebar`, `PlanView`.
- Produces user-facing mode order: `Reader | Assets | Plan | Stage`.
- Owns one Plan snapshot/load generation, Plan selection, Plan surface, and Refresh action.
- Existing scene selection remains the single Reader/Assets/Stage scene context.

- [ ] **Step 1: Add failing App tests for the fourth mode and mode-specific sidebar**

Extend the existing Tauri invoke mock in `App.test.ts` with `load_plan_workspace` returning a minimal valid payload.

Add tests equivalent to:

```ts
it("shows Reader, Assets, Plan, and Stage as functional modes", async () => {
  render(App);
  expect(screen.getByRole("button", { name: "Reader" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Assets" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Plan" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Stage" })).toBeInTheDocument();
});

it("switches the sidebar to planning documents without losing scene selection", async () => {
  render(App);
  await selectKnownScene();
  await user.click(screen.getByRole("button", { name: "Plan" }));
  expect(screen.getByRole("button", { name: "Story Bible" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Story workbench scenes")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Reader" }));
  expect(screen.getByRole("button", { name: knownSceneLabel })).toHaveClass("selected");
});

it("refreshes Plan with generation fencing", async () => {
  const first = deferred<WorkbenchPlanWorkspacePayload>();
  const second = deferred<WorkbenchPlanWorkspacePayload>();
  mockInvokePlanLoads(first.promise, second.promise);

  render(App);
  await user.click(screen.getByRole("button", { name: "Plan" }));
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  second.resolve(validPlanPayload("new"));
  await screen.findByText("new");
  first.resolve(validPlanPayload("old"));
  expect(screen.queryByText("old")).not.toBeInTheDocument();
});
```

Also retain existing tests that prove Assets does not trigger Reader/Stage loads and Stage only loads investigation scenes.

- [ ] **Step 2: Run the focused App tests and confirm they fail**

Run:

```bash
bunx vitest run apps/layout-editor/src/App.test.ts
```

Expected: new Plan assertions FAIL; existing tests remain green until the new expectations.

- [ ] **Step 3: Add explicit Plan state without creating a mode framework**

Update imports:

```ts
import PlanSidebar from "./lib/PlanSidebar.svelte";
import PlanView, { type PlanSurface } from "./lib/PlanView.svelte";
import { projectPlanWorkspace, type PlanWorkspace } from "./lib/plan-workspace";
import {
  loadAssetWorkspace,
  loadPlanWorkspace,
  loadSceneBundle,
  loadWorkbenchIndex,
} from "./lib/workbench-api";
```

Extend only the union:

```ts
type WorkbenchMode = "reader" | "assets" | "plan" | "stage";
```

Add Plan state near the Reader state:

```ts
let planWorkspace = $state<PlanWorkspace | null>(null);
let planError = $state<string | null>(null);
let planLoading = $state(false);
let planLoadGeneration = 0;
let planSurface = $state<PlanSurface>("overview");
let selectedPlanDocumentId = $state("story-bible");
let selectedPlanAnchor = $state<string | null>(null);
```

Do not put this into a generic `modeStore`; three existing modes do not need one.

- [ ] **Step 4: Add one refresh function with stale-response fencing**

```ts
async function refreshPlan(): Promise<void> {
  const generation = ++planLoadGeneration;
  planLoading = true;
  planError = null;
  try {
    const payload = await loadPlanWorkspace();
    if (generation !== planLoadGeneration) return;
    const next = projectPlanWorkspace(payload);
    planWorkspace = next;
    if (!next.documents.some(({ id }) => id === selectedPlanDocumentId)) {
      selectedPlanDocumentId = next.documents[0]?.id ?? "story-bible";
      selectedPlanAnchor = null;
    }
  } catch (error) {
    if (generation !== planLoadGeneration) return;
    planError = normalizeError(error);
  } finally {
    if (generation === planLoadGeneration) planLoading = false;
  }
}
```

On component destroy, increment `planLoadGeneration` along with existing cleanup so a late Plan promise cannot update destroyed state.

- [ ] **Step 5: Extend `setMode()` only for Plan ownership**

Preserve the current Reader cache epoch behavior. Add a Plan branch before Stage loading:

```ts
function setMode(next: WorkbenchMode): void {
  if (mode === next) return;
  if (mode === "reader") cacheWriteEpoch += 1;
  mode = next;

  if (next === "reader") {
    if (readerScope === "scene") void loadCurrentReaderScene();
    return;
  }
  if (next === "assets") return;
  if (next === "plan") {
    if (planWorkspace === null && !planLoading) void refreshPlan();
    return;
  }

  const scene = selectedScene;
  if (
    scene &&
    scene.type === "investigation" &&
    selectedChapterId &&
    selectedSceneId
  ) {
    void loadInvestigationScene(selectedChapterId, selectedSceneId);
  } else {
    clearStage();
  }
}
```

Do not clear `selectedChapterId` / `selectedSceneId` when entering Plan.

- [ ] **Step 6: Add Plan source/document navigation helpers**

```ts
function selectPlanDocument(documentId: string): void {
  selectedPlanDocumentId = documentId;
  selectedPlanAnchor = null;
  planSurface = "document";
}

function selectPlanHeading(documentId: string, anchor: string): void {
  selectedPlanDocumentId = documentId;
  selectedPlanAnchor = anchor;
  planSurface = "document";
}

function navigatePlanSource(sourceRef: string): void {
  if (!planWorkspace) return;
  const hashIndex = sourceRef.indexOf("#");
  const path = hashIndex >= 0 ? sourceRef.slice(0, hashIndex) : sourceRef;
  const anchor = hashIndex >= 0 ? sourceRef.slice(hashIndex + 1) : null;
  const document = planWorkspace.documents.find(
    (candidate) => candidate.path === path,
  );
  if (!document) return;
  selectedPlanDocumentId = document.id;
  selectedPlanAnchor = anchor || null;
  planSurface = "document";
}
```

An unknown source ref is ignored; source refs are produced by the same workspace projection, so this is defensive rather than a new resolution layer.

- [ ] **Step 7: Switch the existing sidebar between scene and Plan navigation**

Keep the title/error area. Replace only the current scene-list block with:

```svelte
{#if mode === "plan"}
  {#if planWorkspace}
    <PlanSidebar
      workspace={planWorkspace}
      {selectedPlanDocumentId}
      {selectedPlanAnchor}
      onSelectOverview={() => (planSurface = "overview")}
      onSelectDocument={selectPlanDocument}
      onSelectHeading={selectPlanHeading}
    />
  {:else}
    <p class="empty m-0 text-[#7d3c2f]">
      {planLoading ? "Loading planning documents…" : "Planning documents unavailable."}
    </p>
  {/if}
{:else}
  <!-- existing scene tree unchanged -->
{/if}
```

Do not duplicate the scene tree inside Plan.

- [ ] **Step 8: Add the Plan button and Plan detail branch**

Mode order:

```svelte
Reader | Assets | Plan | Stage
```

Only Plan shows the Plan Refresh button:

```svelte
{#if mode === "plan"}
  <button type="button" disabled={planLoading} onclick={refreshPlan}>
    {planLoading ? "Refreshing…" : "Refresh"}
  </button>
{/if}
```

Add a detail branch between Assets and Stage:

```svelte
{:else if mode === "plan"}
  {#if planError}
    <p class="error">{planError}</p>
  {/if}
  {#if planWorkspace}
    <PlanView
      workspace={planWorkspace}
      surface={planSurface}
      {selectedPlanDocumentId}
      {selectedPlanAnchor}
      onNavigateSource={navigatePlanSource}
    />
  {:else}
    <div class="placeholder">
      <p class="eyebrow">Plan</p>
      <p>{planLoading ? "Loading planning documents…" : "Open Plan to load planning documents."}</p>
    </div>
  {/if}
```

Reader/Assets/Stage branches remain otherwise untouched.

- [ ] **Step 9: Run all editor tests and fix only Plan-caused regressions**

Run:

```bash
bun run --cwd apps/layout-editor test
bun run editor:check
```

Expected: PASS. Do not perform unrelated `App.svelte` refactors while fixing tests.

- [ ] **Step 10: Run the complete HPA-273 verification set**

Run:

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

Expected: every command PASS. If `editor:build` or `lint:all` changes generated/format files, review the diff and keep only changes caused by HPA-273.

- [ ] **Step 11: Manual Workbench smoke on real content**

Launch:

```bash
bun run dev:editor
```

Verify manually:

1. Reader opens as the default and still reads the currently selected scene.
2. Assets still loads its existing snapshot and scene usage links.
3. Plan shows Story Bible + current Chapter 1/2 plan documents.
4. The Overview displays 8 chapter rows from §10 only.
5. The Aoba view displays the six authored §18.5 stages and the explicit §18 override callout.
6. Clicking `Open source` switches to the Story Bible document and scrolls to the expected heading.
7. Chapter 1 plan heading outline can jump directly to its evidence-package/proof-order sections without a case-logic graph.
8. Refresh reflects a harmless planning-Markdown edit/revert without restarting the app.
9. Returning to Reader/Assets/Stage preserves the previously selected scene.
10. Stage still edits/saves an investigation layout only for investigation scenes.

Revert the harmless planning-Markdown smoke edit before committing.

- [ ] **Step 12: Commit the integrated functional mode**

```bash
git add apps/layout-editor/src/App.svelte apps/layout-editor/src/App.test.ts
git commit -m "feat(layout-editor): add Story Workbench Plan mode"
```

---

## Self-review checklist

Before marking HPA-273 implementation ready for review:

- [ ] Every derived chapter cell traces to Story Bible `# 10. 章節總覽`; no §3/§14 join exists.
- [ ] Every Aoba stage traces to Story Bible `## 18.5 第一幕 reveal ladder`; no prose inference exists.
- [ ] The §18 authored override notice is visible rather than silently reconciled.
- [ ] A changed/missing table leaves the document reader usable and emits a diagnostic.
- [ ] Rust accepts no Plan file path argument.
- [ ] Root-only chapter-plan discovery cannot descend into playable scene Markdown.
- [ ] Plan adds no write command.
- [ ] Plan adds no generic graph/knowledge ontology.
- [ ] Reader/Assets/Stage behavior remains unchanged.
- [ ] `verify:plan-real-content` runs in the existing frontend CI job.
- [ ] All required checks pass before converting the draft PR to ready-for-review.
