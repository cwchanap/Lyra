import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type {
  SaveBrowserView,
  SaveMetadataView,
  SaveSlotRef,
  SaveSlotView,
} from "$lib/persistence/types";
import SaveBrowser from "./SaveBrowser.svelte";

const unavailableThumbnail = {
  type: "unavailable",
  reason: "captureUnavailable",
} as const;

function metadata(reference: SaveSlotRef, saveId: string): SaveMetadataView {
  return {
    saveId,
    saveType: reference.type,
    schemaVersion: 1,
    contentRevision: `sha256:${"1".repeat(64)}`,
    savedAt: `2026-07-2${reference.slot}T12:00:00Z`,
    displayName: `${reference.type}-${reference.slot}`,
    thumbnail: unavailableThumbnail,
    summary: {
      chapterId: "chapter_1",
      chapterTitle: "第一章",
      chapterSummary: null,
      sceneId: "scene_1",
      sceneTitle: "雨夜",
      sceneSummary: null,
      activePrimaryObjectiveId: null,
      activePrimaryObjectiveLabel: null,
      activePrimaryObjectiveSummary: null,
    },
  };
}

function populatedBrowser(): SaveBrowserView {
  const slots: SaveSlotView[] = [
    {
      reference: { type: "manual", slot: 3 },
      modifiedAt: "2026-07-23T12:00:00Z",
      status: { type: "empty" },
    },
    ...Array.from({ length: 5 }, (_, index): SaveSlotView => {
      const reference = { type: "auto", slot: index + 1 } as const;
      return {
        reference,
        modifiedAt: `2026-07-2${index + 1}T12:00:00Z`,
        status: {
          type: "valid",
          metadata: metadata(
            reference,
            `11111111-1111-4111-8111-11111111111${index}`,
          ),
        },
      };
    }).reverse(),
    {
      reference: { type: "manual", slot: 2 },
      modifiedAt: "2026-07-22T12:00:00Z",
      status: {
        type: "invalid",
        metadata: {
          saveId: null,
          savedAt: "2026-07-22T12:00:00Z",
          displayName: "無法相容",
          thumbnail: unavailableThumbnail,
          summary: null,
        },
        diagnostic: {
          code: "incompatibleSaveContent",
          message: "內容版本不相容。",
        },
      },
    },
    {
      reference: { type: "manual", slot: 1 },
      modifiedAt: "2026-07-21T12:00:00Z",
      status: {
        type: "valid",
        metadata: metadata(
          { type: "manual", slot: 1 },
          "22222222-2222-4222-8222-222222222222",
        ),
      },
    },
  ];
  return { discovery: { type: "available" }, slots };
}

describe("SaveBrowser", () => {
  it("renders global discovery loading without fabricating slot failures", () => {
    render(SaveBrowser, {
      view: { discovery: { type: "loading" }, slots: [] },
      mode: "titleLoad",
      continueCandidate: null,
    });

    expect(screen.getByRole("status")).toHaveTextContent("讀取存檔中…");
    expect(screen.queryByText(/自動存檔 1/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders one global unavailable diagnostic and Retry without slot cards", async () => {
    const onRetry = vi.fn();
    render(SaveBrowser, {
      view: {
        discovery: {
          type: "unavailable",
          diagnostic: {
            code: "saveDiscoveryUnavailable",
            message: "無法讀取存檔目錄。",
          },
        },
        slots: [],
      },
      mode: "titleLoad",
      continueCandidate: null,
      onRetry,
    });

    expect(screen.getByRole("alert")).toHaveTextContent("無法讀取存檔目錄。");
    expect(screen.queryByText(/手動存檔 1/)).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "重試" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("orders five autosaves before three manuals and marks Rust's candidate", () => {
    render(SaveBrowser, {
      view: populatedBrowser(),
      mode: "titleLoad",
      continueCandidate: { type: "auto", slot: 4 },
    });

    const groups = screen.getAllByRole("group");
    const autoGroup = groups.find(
      (group) => group.getAttribute("aria-label") === "自動存檔",
    );
    const manualGroup = groups.find(
      (group) => group.getAttribute("aria-label") === "手動存檔",
    );
    expect(autoGroup).toBeDefined();
    expect(manualGroup).toBeDefined();
    expect(within(autoGroup!).getAllByText(/自動存檔 \d/)).toHaveLength(5);
    expect(within(manualGroup!).getAllByText(/手動存檔 \d/)).toHaveLength(3);
    expect(screen.getByText("最新").closest("article")).toHaveAttribute(
      "data-slot-number",
      "4",
    );
    expect(
      screen.getByText("自動存檔已滿時，將自動取代最舊的存檔。"),
    ).toBeInTheDocument();
  });

  it("starts title Load immediately only for a selected valid slot", async () => {
    const onSelect = vi.fn();
    const onLoad = vi.fn();
    render(SaveBrowser, {
      view: populatedBrowser(),
      mode: "titleLoad",
      continueCandidate: null,
      onSelect,
      onLoad,
    });

    await fireEvent.click(
      screen.getByRole("button", { name: "選擇手動存檔 1" }),
    );
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ reference: { type: "manual", slot: 1 } }),
      expect.any(HTMLElement),
    );
    expect(onLoad).toHaveBeenCalledWith(
      expect.objectContaining({ reference: { type: "manual", slot: 1 } }),
      expect.any(HTMLElement),
    );

    await fireEvent.click(
      screen.getByRole("button", { name: "選擇手動存檔 2" }),
    );
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it("shows only three manual positions in Save mode and delegates selection", async () => {
    const onSelect = vi.fn();
    const onLoad = vi.fn();
    render(SaveBrowser, {
      view: populatedBrowser(),
      mode: "manualSave",
      continueCandidate: { type: "auto", slot: 4 },
      onSelect,
      onLoad,
    });

    expect(screen.queryByText(/自動存檔 1/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("自動存檔已滿時，將自動取代最舊的存檔。"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText(/手動存檔 \d/)).toHaveLength(3);

    await fireEvent.click(
      screen.getByRole("button", { name: "選擇手動存檔 3" }),
    );
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ reference: { type: "manual", slot: 3 } }),
      expect.any(HTMLElement),
    );
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("routes in-game Load and delete requests through explicit controls", async () => {
    const onLoad = vi.fn();
    const onDelete = vi.fn();
    render(SaveBrowser, {
      view: populatedBrowser(),
      mode: "gameLoad",
      continueCandidate: null,
      onLoad,
      onDelete,
    });

    const validCard = screen
      .getByText("manual-1")
      .closest("article") as HTMLElement;
    await fireEvent.click(
      within(validCard).getByRole("button", { name: "載入手動存檔 1" }),
    );
    expect(onLoad).toHaveBeenCalledWith(
      expect.objectContaining({ reference: { type: "manual", slot: 1 } }),
      expect.any(HTMLElement),
    );

    const invalidCard = screen
      .getByText("無法相容")
      .closest("article") as HTMLElement;
    expect(
      within(invalidCard).getByRole("button", { name: "載入手動存檔 2" }),
    ).toBeDisabled();
    await fireEvent.click(
      within(invalidCard).getByRole("button", { name: "刪除手動存檔 2" }),
    );
    expect(onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ reference: { type: "manual", slot: 2 } }),
      expect.any(HTMLElement),
    );
  });
});
