// =============================================================================
// apps/layout-editor/scripts/verify-plan-real-content.ts
//
// Real-corpus verifier for the Plan workbench projection. Mirrors
// verify-reader-real-content.ts / verify-asset-real-content.ts: constructs
// WorkbenchPlanWorkspacePayload directly from the repo's authored planning
// documents (no Rust discovery duplication) and asserts that
// projectPlanWorkspace() keeps the current canon intact.
//
// Checks (canonical content this gate pins):
//   1. Document source paths stay the exact repo-relative constants, and each
//      document keeps the Rust loader's identity triple (id/kind/chapterNumber).
//   2. Story Bible §10「章節總覽」anchors to `10-章節總覽` with chapter rows
//      exactly 1..8.
//   3. §18.5 reveal-ladder stages stay 第 1, 2, 3, 4, 5～7, 8 章.
//   4. The §18 override blockquote contains「以本節為準」and does not absorb
//      the later「青葉火災已經結案」block from §18.1.
//   5. Canon strings survive inside rendered <table> output: the §10 case
//      title and the §18.5 Chapter 1 row text.
//   6. Diagnostics are empty for the current corpus.
// =============================================================================

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectPlanWorkspace } from "../src/lib/plan-workspace";
import type { WorkbenchPlanDocument } from "../src/lib/workbench-types";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const BIBLE_PATH = "docs/stories_plan/final_story_bible.md";
const CH1_PATH = "docs/stories_plan/chapter_1_plan.md";
const CH2_PATH = "docs/stories_plan/chapter_2_plan.md";

function readSource(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

// id/kind/chapterNumber mirror the Rust loader's identity triple
// (apps/layout-editor/src-tauri/src/lib.rs).
const documents: WorkbenchPlanDocument[] = [
  {
    id: "story-bible",
    kind: "storyBible",
    path: BIBLE_PATH,
    content: readSource(BIBLE_PATH),
    chapterNumber: null,
  },
  {
    id: "chapter-1-plan",
    kind: "chapterPlan",
    path: CH1_PATH,
    content: readSource(CH1_PATH),
    chapterNumber: 1,
  },
  {
    id: "chapter-2-plan",
    kind: "chapterPlan",
    path: CH2_PATH,
    content: readSource(CH2_PATH),
    chapterNumber: 2,
  },
];

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function renderedTables(html: string): string[] {
  return html.match(/<table>[\s\S]*?<\/table>/g) ?? [];
}

const workspace = projectPlanWorkspace({ documents });

assert(
  workspace.documents.map(({ path }) => path).join("\n") ===
    [BIBLE_PATH, CH1_PATH, CH2_PATH].join("\n"),
  `document source paths changed: ${workspace.documents.map(({ path }) => path).join(", ")}`,
);

// Real-corpus gate: each projected document must keep the Rust loader's
// identity triple (apps/layout-editor/src-tauri/src/lib.rs).
function assertDocumentIdentity(
  path: string,
  id: string,
  kind: WorkbenchPlanDocument["kind"],
  chapterNumber: number | null,
): void {
  const document = workspace.documents.find(
    (candidate) => candidate.path === path,
  );
  assert(
    document !== undefined &&
      document.id === id &&
      document.kind === kind &&
      document.chapterNumber === chapterNumber,
    `document identity drifted for ${path}: ${JSON.stringify({
      id: document?.id,
      kind: document?.kind,
      chapterNumber: document?.chapterNumber,
    })}`,
  );
}

assertDocumentIdentity(BIBLE_PATH, "story-bible", "storyBible", null);
assertDocumentIdentity(CH1_PATH, "chapter-1-plan", "chapterPlan", 1);
assertDocumentIdentity(CH2_PATH, "chapter-2-plan", "chapterPlan", 2);

// Real-corpus navigation acceptance: the ticket requires these headings to be
// directly reachable in compact mode (H1/H2). If either is renamed or demoted
// below H2, the component test's manufactured fixtures would still pass but
// the real acceptance contract breaks. Pin them here.
function assertDocumentHasHeading(path: string, expectedText: string): void {
  const document = workspace.documents.find(
    (candidate) => candidate.path === path,
  );
  assert(document !== undefined, `document missing from projection: ${path}`);
  const heading = document.headings.find(
    (candidate) => candidate.text === expectedText,
  );
  assert(
    heading !== undefined && heading.level <= 2,
    `heading「${expectedText}」missing or demoted below H2 in ${path}: ` +
      `${JSON.stringify(heading ?? { missing: true })}`,
  );
}

assertDocumentHasHeading(CH1_PATH, "1. 全章前台證據包");
assertDocumentHasHeading(CH2_PATH, "12. 最終審查會 Proof Order");

const bible = workspace.documents.find(({ path }) => path === BIBLE_PATH);
assert(bible !== undefined, "Story Bible document missing from projection");
const overviewHeading = bible.headings.find(
  ({ text }) => text === "10. 章節總覽",
);
assert(
  overviewHeading?.anchor === "10-章節總覽",
  `「10. 章節總覽」anchor drifted: ${overviewHeading?.anchor ?? "heading missing"}`,
);

const chapterOverview = workspace.chapterOverview;
assert(chapterOverview !== null, "§10 chapter overview not projected");
assert(
  chapterOverview.rows.map(({ chapter }) => chapter).join(",") ===
    "1,2,3,4,5,6,7,8",
  `chapter rows drifted: ${chapterOverview.rows.map(({ chapter }) => chapter).join(", ")}`,
);

const aobaReveal = workspace.aobaReveal;
assert(aobaReveal !== null, "§18.5 reveal ladder not projected");
assert(
  aobaReveal.stages.map(({ chapterLabel }) => chapterLabel).join(",") ===
    "第 1 章,第 2 章,第 3 章,第 4 章,第 5～7 章,第 8 章",
  `Aoba stages drifted: ${aobaReveal.stages.map(({ chapterLabel }) => chapterLabel).join(", ")}`,
);

const override = workspace.aobaOverrideNotice;
assert(override !== null, "§18 override blockquote not extracted");
assert(override.text.includes("以本節為準"), "override lost「以本節為準」");
assert(
  !override.text.includes("青葉火災已經結案"),
  "override absorbed the §18.1「青葉火災已經結案」block",
);

const tables = renderedTables(bible.renderedHtml);
assert(
  tables.some((table) => table.includes("雨鐘咖啡館殺人事件")),
  "「雨鐘咖啡館殺人事件」missing from rendered §10 table",
);
assert(
  tables.some((table) => table.includes("2016 年青葉記憶研究所火災")),
  "§18.5 Chapter 1 row text missing from rendered table",
);

assert(
  workspace.diagnostics.length === 0,
  `unexpected diagnostics: ${JSON.stringify(workspace.diagnostics)}`,
);

console.log(
  `verify-plan-real-content: OK — ${documents.length} document(s), ` +
    `${chapterOverview.rows.length} chapter row(s), ` +
    `${aobaReveal.stages.length} reveal stage(s)`,
);
