import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { SaveSummaryView } from "$lib/persistence/types";
import SaveRecapDetails from "./SaveRecapDetails.svelte";

const { readSaveThumbnail } = vi.hoisted(() => ({
  readSaveThumbnail: vi.fn(),
}));

vi.mock("$lib/persistence/commands", () => ({ readSaveThumbnail }));

const completeSummary: SaveSummaryView = {
  chapterId: "chapter_1",
  chapterTitle: "第一章　雨中的證言",
  chapterSummary: "相馬律接下雨夜中的第一宗委託。",
  sceneId: "scene_2",
  sceneTitle: "律師事務所",
  sceneSummary: "早坂帶來一份程序不明的調查摘要。",
  activePrimaryObjectiveId: "objective_1",
  activePrimaryObjectiveLabel: "詢問目擊者",
  activePrimaryObjectiveSummary: "釐清目擊者在雨夜看見的人影。",
};

describe("SaveRecapDetails", () => {
  it("renders a compact manual-save recap with clamped authored copy", () => {
    render(SaveRecapDetails, {
      slotType: "manual",
      savedAt: "2026-07-27T12:34:00Z",
      summary: completeSummary,
    });

    expect(screen.getByText("手動存檔")).toBeInTheDocument();
    expect(screen.getByTestId("saved-at")).toHaveTextContent("2026");
    expect(screen.getByText(/第一章.*雨中的證言/)).toBeInTheDocument();
    expect(
      screen.getByText("相馬律接下雨夜中的第一宗委託。"),
    ).toBeInTheDocument();
    expect(screen.getByText("律師事務所")).toBeInTheDocument();
    expect(
      screen.getByText("早坂帶來一份程序不明的調查摘要。"),
    ).toBeInTheDocument();
    expect(screen.getByText("主要目標")).toBeInTheDocument();
    expect(screen.getByText("詢問目擊者")).toBeInTheDocument();
    expect(
      screen.getByText("釐清目擊者在雨夜看見的人影。"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("save-recap-details")).toHaveClass("compact");
    expect(screen.getAllByTestId("recap-summary-copy")).toHaveLength(3);
    for (const copy of screen.getAllByTestId("recap-summary-copy")) {
      expect(copy).toHaveClass("compact-clamp");
      expect(copy).not.toHaveClass("expanded-copy");
    }
    expect(readSaveThumbnail).not.toHaveBeenCalled();
  });

  it("renders an expanded autosave recap without compact clamping", () => {
    render(SaveRecapDetails, {
      slotType: "auto",
      savedAt: "2026-07-27T12:34:00Z",
      summary: completeSummary,
      density: "expanded",
    });

    expect(screen.getByText("自動存檔")).toBeInTheDocument();
    expect(screen.getByTestId("save-recap-details")).toHaveClass("expanded");
    for (const copy of screen.getAllByTestId("recap-summary-copy")) {
      expect(copy).toHaveClass("expanded-copy");
      expect(copy).not.toHaveClass("compact-clamp");
    }
    expect(readSaveThumbnail).not.toHaveBeenCalled();
  });

  it("omits nullable recap copy and time without inventing fallback prose", () => {
    render(SaveRecapDetails, {
      slotType: "manual",
      savedAt: null,
      summary: {
        ...completeSummary,
        chapterSummary: null,
        sceneSummary: null,
        activePrimaryObjectiveId: null,
        activePrimaryObjectiveLabel: null,
        activePrimaryObjectiveSummary: null,
      },
    });

    expect(screen.getByText(/第一章.*雨中的證言/)).toBeInTheDocument();
    expect(screen.getByText("律師事務所")).toBeInTheDocument();
    expect(screen.getByText("沒有進行中的主要目標")).toBeInTheDocument();
    expect(screen.queryByTestId("saved-at")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("recap-summary-copy")).toHaveLength(0);
    expect(screen.queryByText(/沒有摘要|No summary/i)).not.toBeInTheDocument();
    expect(readSaveThumbnail).not.toHaveBeenCalled();
  });
});
