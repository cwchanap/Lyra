import { describe, expect, it } from "vitest";
import {
  planAnchor,
  planSourceRef,
  projectPlanWorkspace,
} from "./plan-workspace";
import type { WorkbenchPlanWorkspacePayload } from "./workbench-types";

const BIBLE_PATH = "docs/stories_plan/final_story_bible.md";

function bible(content: string): WorkbenchPlanWorkspacePayload {
  return {
    documents: [
      {
        id: "bible",
        kind: "storyBible",
        path: BIBLE_PATH,
        content,
        chapterNumber: null,
      },
    ],
  };
}

function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

const CHAPTER_HEADERS = ["章節", "標題", "案件類型", "變體", "主線誤導"];
const AOBA_HEADERS = ["章節", "必須建立", "絕對不能建立"];
const AOBA_ADDENDUM_HEADING =
  "18. Canon Addendum：第一幕青葉提問契約（2026-08-23）";

function chapterRows(chapters: string[]): string[][] {
  return chapters.map((chapter) => [
    chapter,
    `t${chapter}`,
    "密室",
    "變體",
    "誤導",
  ]);
}

describe("projectPlanWorkspace", () => {
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

  it("anchors headings nested inside list items instead of throwing", () => {
    const workspace = projectPlanWorkspace(
      bible(
        "Intro\n\n- # Heading in list\n\n- item\n  - ## Deep nested\n\n## After\n",
      ),
    );
    const document = workspace.documents[0]!;

    expect(document.headings.map((heading) => heading.text)).toEqual([
      "Heading in list",
      "Deep nested",
      "After",
    ]);
    expect(document.renderedHtml).toContain('id="heading-in-list"');
    expect(document.renderedHtml).toContain('id="deep-nested"');
    expect(document.renderedHtml).toContain('id="after"');
  });

  it("pins duplicate anchors and source-ref composition", () => {
    const seen = new Map<string, number>();
    expect(planAnchor("10. 章節總覽", seen)).toBe("10-章節總覽");
    expect(planAnchor("重複", seen)).toBe("重複");
    expect(planAnchor("重複", seen)).toBe("重複-1");
    expect(
      planSourceRef("docs/stories_plan/final_story_bible.md", "10-章節總覽"),
    ).toBe("docs/stories_plan/final_story_bible.md#10-章節總覽");
  });

  it("escapes authored raw html before document rendering", () => {
    const workspace = projectPlanWorkspace(bible("<script>alert(1)</script>"));
    expect(workspace.documents[0]!.renderedHtml).not.toContain("<script>");
    expect(workspace.documents[0]!.renderedHtml).toContain("&lt;script&gt;");
  });

  it("projects the exact §10 overview into chapters 1..8", () => {
    const content = `# 10. 章節總覽\n\n${table(
      CHAPTER_HEADERS,
      chapterRows(["1", "2", "3", "4", "5", "6", "7", "8"]),
    )}\n`;
    const workspace = projectPlanWorkspace(bible(content));

    expect(
      workspace.diagnostics
        .map((d) => d.code)
        .filter((code) => code.startsWith("chapterOverview")),
    ).toEqual([]);
    expect(workspace.chapterOverview?.anchor).toBe("10-章節總覽");
    expect(workspace.chapterOverview?.rows.map((row) => row.chapter)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);
    expect(workspace.chapterOverview?.rows[0]).toEqual({
      chapter: "1",
      title: "t1",
      caseType: "密室",
      variant: "變體",
      mainMisdirection: "誤導",
    });
  });

  it("does not use a similar §10-like table elsewhere", () => {
    const content = `# 9. 相似表格\n\n${table(
      CHAPTER_HEADERS,
      chapterRows(["1", "2", "3", "4", "5", "6", "7", "8"]),
    )}\n`;
    const workspace = projectPlanWorkspace(bible(content));

    expect(workspace.chapterOverview).toBeNull();
    expect(workspace.diagnostics.map((d) => d.code)).toContain(
      "chapterOverviewMissing",
    );
  });

  it("reports chapterOverviewInvalid for malformed §10 headers", () => {
    const content = `# 10. 章節總覽\n\n${table(
      ["章節", "標題", "案件類型", "變體", "誤導"],
      [["1", "t1", "密室", "變體", "誤導"]],
    )}\n`;
    const workspace = projectPlanWorkspace(bible(content));

    expect(workspace.chapterOverview).toBeNull();
    expect(workspace.diagnostics.map((d) => d.code)).toContain(
      "chapterOverviewInvalid",
    );
  });

  it("keeps §10 rows visible when chapters are not exactly 1..8", () => {
    const content = `# 10. 章節總覽\n\n${table(
      CHAPTER_HEADERS,
      chapterRows(["1", "2", "3"]),
    )}\n`;
    const workspace = projectPlanWorkspace(bible(content));

    expect(workspace.diagnostics.map((d) => d.code)).toContain(
      "chapterOverviewUnexpectedRows",
    );
    expect(workspace.chapterOverview?.rows.map((row) => row.chapter)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("projects exact §18.5 rows verbatim", () => {
    const rows = [
      ["第 1 章", "青葉火災名稱", "不說知名畫面是重演"],
      ["第 8 章", "左側逃生鏈 + A-90 雙鑰鏈推翻官方故事", "—"],
    ];
    const content = `## 18.5 第一幕 reveal ladder\n\n${table(
      AOBA_HEADERS,
      rows,
    )}\n`;
    const workspace = projectPlanWorkspace(bible(content));

    expect(workspace.aobaReveal?.stages).toEqual([
      {
        chapter: "第 1 章",
        mustEstablish: "青葉火災名稱",
        mustNotEstablish: "不說知名畫面是重演",
      },
      {
        chapter: "第 8 章",
        mustEstablish: "左側逃生鏈 + A-90 雙鑰鏈推翻官方故事",
        mustNotEstablish: "—",
      },
    ]);
    expect(
      workspace.diagnostics
        .map((d) => d.code)
        .filter((code) => code.startsWith("aobaRevealLadder")),
    ).toEqual([]);
  });

  it("reports aobaRevealLadderInvalid for malformed §18.5", () => {
    const content = `## 18.5 第一幕 reveal ladder\n\n${table(
      ["章節", "必須建立"],
      [["第 1 章", "x"]],
    )}\n`;
    const workspace = projectPlanWorkspace(bible(content));

    expect(workspace.aobaReveal).toBeNull();
    expect(workspace.diagnostics.map((d) => d.code)).toContain(
      "aobaRevealLadderInvalid",
    );
  });

  it("takes only the first §18 blockquote before §18.1 as the override notice", () => {
    const content = [
      `# ${AOBA_ADDENDUM_HEADING}`,
      "",
      "> 第一則 override。",
      "",
      "> 第二則 override。",
      "",
      "## 18.1 為什麼需要這個更新",
      "",
      "> 後面的 blockquote 不算。",
      "",
    ].join("\n");
    const workspace = projectPlanWorkspace(bible(content));
    const addendumAnchor = workspace.documents[0]!.headings.find(
      (heading) => heading.text === AOBA_ADDENDUM_HEADING,
    )?.anchor;

    expect(addendumAnchor).toBeDefined();
    expect(workspace.aobaOverrideNotice).toEqual({
      anchor: addendumAnchor,
      text: "第一則 override。",
    });
  });

  it("reports the corresponding Missing diagnostics for absent exact headings", () => {
    const workspace = projectPlanWorkspace(bible("# 其他\n"));

    expect(workspace.chapterOverview).toBeNull();
    expect(workspace.aobaReveal).toBeNull();
    expect(workspace.aobaOverrideNotice).toBeNull();
    const codes = workspace.diagnostics.map((d) => d.code);
    expect(codes).toContain("chapterOverviewMissing");
    expect(codes).toContain("aobaRevealLadderMissing");
  });

  it("diagnostics reuse the compiler CompileError shape", () => {
    const workspace = projectPlanWorkspace(bible("# 其他\n"));
    const missing = workspace.diagnostics.find(
      (d) => d.code === "chapterOverviewMissing",
    )!;

    expect(missing.message).toEqual(expect.any(String));
    expect(missing.sourceFile).toBe(BIBLE_PATH);
    expect(missing.line).toEqual(expect.any(Number));
  });
});
