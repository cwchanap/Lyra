// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PlanView from "./PlanView.svelte";
import {
  projectPlanWorkspace,
  type PlanDiagnostic,
  type PlanWorkspace,
} from "./plan-workspace";
import type { WorkbenchPlanWorkspacePayload } from "./workbench-types";

const clipboardWriteText = vi.fn();

// userEvent.setup() attaches its own jsdom clipboard stub over ours, so a
// test that asserts clipboard writes must re-stub AFTER its last setup call.
function stubClipboardWrite(): void {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWriteText },
    configurable: true,
  });
}

const CHAPTER_HEADERS = ["章節", "標題", "案件類型", "變體", "主線誤導"];
const AOBA_HEADERS = ["章節", "必須建立", "絕對不能建立"];

function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

const BIBLE = [
  "# 18. Canon Addendum：第一幕青葉提問契約（2026-08-23）",
  "",
  "> 第一幕以本節為準。",
  "",
  "## 18.1 為什麼需要這個更新",
  "",
  "## 10. 章節總覽",
  "",
  table(
    CHAPTER_HEADERS,
    Array.from({ length: 8 }, (_, index) => [
      String(index + 1),
      `標題${index + 1}`,
      "密室",
      "變體",
      "誤導",
    ]),
  ),
  "",
  "## 18.5 第一幕 reveal ladder",
  "",
  table(AOBA_HEADERS, [
    ["第 1 章", "青葉火災名稱", "不說知名畫面是重演"],
    ["第 8 章", "逃生鏈推翻官方故事", "—"],
  ]),
  "",
].join("\n");

const BIBLE_PATH = "docs/stories_plan/final_story_bible.md";

function workspaceFixture(): PlanWorkspace {
  const payload: WorkbenchPlanWorkspacePayload = {
    documents: [
      {
        id: "story-bible",
        kind: "storyBible",
        path: BIBLE_PATH,
        content: BIBLE,
        chapterNumber: null,
      },
    ],
  };
  return projectPlanWorkspace(payload);
}

/** Same projection with one injected diagnostic, so the four Overview facts coexist. */
function workspaceWithDiagnostic(): PlanWorkspace {
  const diagnostic: PlanDiagnostic = {
    code: "chapterOverviewUnexpectedRows",
    message: "章節總覽章節欄應為 1、2、3、4、5、6、7、8。",
    sourceFile: BIBLE_PATH,
    line: 1,
  };
  return { ...workspaceFixture(), diagnostics: [diagnostic] };
}

type PlanViewProps = {
  workspace: PlanWorkspace | null;
  error: string | null;
  loading: boolean;
  surface: "overview" | "document";
  selectedDocumentId: string;
  selectedAnchor: string | null;
  onNavigateSource: (documentId: string, anchor: string | null) => void;
};

function planViewProps(overrides: Partial<PlanViewProps> = {}): PlanViewProps {
  return {
    workspace: workspaceFixture(),
    error: null,
    loading: false,
    surface: "overview",
    selectedDocumentId: "story-bible",
    selectedAnchor: null,
    onNavigateSource: vi.fn(),
    ...overrides,
  };
}

describe("PlanView", () => {
  it("Overview renders chapter matrix + Aoba boundaries + override + diagnostics", () => {
    render(PlanView, planViewProps({ workspace: workspaceWithDiagnostic() }));

    expect(screen.getByText("第一幕以本節為準。")).toBeInTheDocument();
    expect(
      screen.getByText(/chapterOverviewUnexpectedRows/u),
    ).toBeInTheDocument();

    const matrix = screen.getByLabelText("Chapter overview matrix");
    expect(within(matrix).getAllByRole("row")).toHaveLength(9); // header + 8
    expect(within(matrix).getByText("標題1")).toBeInTheDocument();
    expect(within(matrix).getByText("標題8")).toBeInTheDocument();

    const timeline = screen.getByLabelText("Aoba reveal timeline");
    expect(within(timeline).getByText(/青葉火災名稱/u)).toBeInTheDocument();

    const boundaries = screen.getByLabelText("Aoba boundary table");
    expect(
      within(boundaries).getByText("不說知名畫面是重演"),
    ).toBeInTheDocument();
    expect(
      within(boundaries).getByText("逃生鏈推翻官方故事"),
    ).toBeInTheDocument();
  });

  it("every Aoba row can emit Open source -> (story-bible, aobaReveal.anchor)", async () => {
    const user = userEvent.setup();
    const props = planViewProps();
    render(PlanView, props);
    const anchor = props.workspace!.aobaReveal!.anchor;

    const buttons = screen.getAllByRole("button", { name: "Open source" });
    expect(buttons).toHaveLength(2);

    for (const button of buttons) {
      await user.click(button);
    }
    expect(props.onNavigateSource).toHaveBeenCalledTimes(2);
    expect(props.onNavigateSource).toHaveBeenNthCalledWith(
      1,
      "story-bible",
      anchor,
    );
    expect(props.onNavigateSource).toHaveBeenNthCalledWith(
      2,
      "story-bible",
      anchor,
    );
  });

  it("Document renders projected HTML and Copy source reference uses path + selected bare anchor", async () => {
    const user = userEvent.setup();
    render(
      PlanView,
      planViewProps({
        surface: "document",
        selectedAnchor: "10-章節總覽",
      }),
    );

    expect(screen.getByText(BIBLE_PATH)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "10. 章節總覽" }),
    ).toBeInTheDocument();

    stubClipboardWrite();
    await user.click(
      screen.getByRole("button", { name: "Copy source reference" }),
    );
    await waitFor(() =>
      expect(clipboardWriteText).toHaveBeenLastCalledWith(
        `${BIBLE_PATH}#10-章節總覽`,
      ),
    );
    expect(await screen.findByText("Copied source")).toBeInTheDocument();
  });

  it("diagnostics do not hide the Document view", () => {
    render(
      PlanView,
      planViewProps({
        workspace: workspaceWithDiagnostic(),
        surface: "document",
      }),
    );

    expect(screen.getByText(BIBLE_PATH)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "18. Canon Addendum：第一幕青葉提問契約（2026-08-23）",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy source reference" }),
    ).toBeInTheDocument();
  });
});
