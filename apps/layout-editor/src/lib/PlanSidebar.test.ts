// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PlanSidebar from "./PlanSidebar.svelte";
import { projectPlanWorkspace, type PlanWorkspace } from "./plan-workspace";
import type { WorkbenchPlanWorkspacePayload } from "./workbench-types";

const BIBLE = [
  "# 10. 章節總覽",
  "",
  "## 18.5 第一幕 reveal ladder",
  "",
  "### 深層小節",
  "",
].join("\n");

const CHAPTER_1 = ["## 1. 全章前台證據包", "", "### 隱藏深層小節", ""].join(
  "\n",
);

const CHAPTER_2 = [
  "## 12. 最終審查會 Proof Order",
  "",
  "### 隱藏深層小節二",
  "",
].join("\n");

type SidebarProps = {
  workspace: PlanWorkspace | null;
  surface: "overview" | "document";
  selectedDocumentId: string;
  selectedAnchor: string | null;
  onRefresh: () => void;
  onShowOverview: () => void;
  onSelectDocument: (id: string) => void;
  onSelectHeading: (id: string, anchor: string) => void;
};

function workspaceFixture(): PlanWorkspace {
  const payload: WorkbenchPlanWorkspacePayload = {
    documents: [
      {
        id: "story-bible",
        kind: "storyBible",
        path: "docs/stories_plan/final_story_bible.md",
        content: BIBLE,
        chapterNumber: null,
      },
      {
        id: "chapter-1-plan",
        kind: "chapterPlan",
        path: "docs/stories_plan/chapter_1_plan.md",
        content: CHAPTER_1,
        chapterNumber: 1,
      },
      {
        id: "chapter-2-plan",
        kind: "chapterPlan",
        path: "docs/stories_plan/chapter_2_plan.md",
        content: CHAPTER_2,
        chapterNumber: 2,
      },
    ],
  };
  return projectPlanWorkspace(payload);
}

function anchorOf(
  workspace: PlanWorkspace,
  documentId: string,
  text: string,
): string {
  const doc = workspace.documents.find(
    (candidate) => candidate.id === documentId,
  );
  const heading = doc?.headings.find((candidate) => candidate.text === text);
  if (!heading) throw new Error(`missing heading fixture: ${text}`);
  return heading.anchor;
}

function sidebarProps(overrides: Partial<SidebarProps> = {}): SidebarProps {
  return {
    workspace: workspaceFixture(),
    surface: "document",
    selectedDocumentId: "story-bible",
    selectedAnchor: null,
    onRefresh: vi.fn(),
    onShowOverview: vi.fn(),
    onSelectDocument: vi.fn(),
    onSelectHeading: vi.fn(),
    ...overrides,
  };
}

describe("PlanSidebar", () => {
  it("Refresh plan invokes the store refresh callback once", async () => {
    const user = userEvent.setup();
    const props = sidebarProps();
    render(PlanSidebar, props);

    await user.click(screen.getByRole("button", { name: "Refresh plan" }));

    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("selected document defaults to H1/H2 outline", () => {
    render(PlanSidebar, sidebarProps());

    expect(
      screen.getByRole("button", { name: "Overview" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Story Bible" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Chapter 1 plan" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Chapter 2 plan" }),
    ).toBeInTheDocument();

    const outline = screen.getByLabelText("Document outline");
    expect(
      within(outline).getByRole("button", { name: "10. 章節總覽" }),
    ).toBeInTheDocument();
    expect(
      within(outline).getByRole("button", {
        name: "18.5 第一幕 reveal ladder",
      }),
    ).toBeInTheDocument();
    expect(
      within(outline).queryByRole("button", { name: "深層小節" }),
    ).not.toBeInTheDocument();

    // The document has H3 headings, so the compact-mode toggle is offered.
    expect(
      screen.getByRole("button", { name: "Show all levels" }),
    ).toBeInTheDocument();
  });

  it("Show all levels reveals H3+", async () => {
    const user = userEvent.setup();
    render(PlanSidebar, sidebarProps());

    expect(
      screen.queryByRole("button", { name: "深層小節" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show all levels" }));

    const outline = screen.getByLabelText("Document outline");
    expect(
      within(outline).getByRole("button", { name: "深層小節" }),
    ).toBeInTheDocument();
  });

  it("Chapter 1 `1. 全章前台證據包` and Chapter 2 `12. 最終審查會 Proof Order` are reachable in compact mode", async () => {
    const user = userEvent.setup();

    const workspace = workspaceFixture();
    const firstProps = sidebarProps({
      workspace,
      selectedDocumentId: "chapter-1-plan",
    });
    const first = render(PlanSidebar, firstProps);
    const chapter1Anchor = anchorOf(
      workspace,
      "chapter-1-plan",
      "1. 全章前台證據包",
    );
    expect(
      screen.queryByRole("button", { name: "隱藏深層小節" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "1. 全章前台證據包" }));
    expect(firstProps.onSelectHeading).toHaveBeenCalledExactlyOnceWith(
      "chapter-1-plan",
      chapter1Anchor,
    );
    first.unmount();

    const secondProps = sidebarProps({
      workspace,
      selectedDocumentId: "chapter-2-plan",
    });
    render(PlanSidebar, secondProps);
    const chapter2Anchor = anchorOf(
      workspace,
      "chapter-2-plan",
      "12. 最終審查會 Proof Order",
    );
    await user.click(
      screen.getByRole("button", { name: "12. 最終審查會 Proof Order" }),
    );
    expect(secondProps.onSelectHeading).toHaveBeenCalledExactlyOnceWith(
      "chapter-2-plan",
      chapter2Anchor,
    );
  });
});
