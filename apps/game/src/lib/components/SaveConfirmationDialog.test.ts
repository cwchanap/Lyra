import { fireEvent, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaveSlotView, SaveSummaryView } from "$lib/persistence/types";
import SaveConfirmationDialog from "./SaveConfirmationDialog.svelte";

const currentSummary: SaveSummaryView = {
  chapterId: "chapter_2",
  chapterTitle: "第二章",
  sceneId: "scene_4",
  sceneTitle: "證物保管室",
  activePrimaryObjectiveId: "objective_4",
  activePrimaryObjectiveLabel: "比對證物",
};

const validSlot: SaveSlotView = {
  reference: { type: "manual", slot: 1 },
  modifiedAt: "2026-07-27T12:34:01Z",
  status: {
    type: "valid",
    metadata: {
      saveId: "11111111-1111-4111-8111-111111111111",
      saveType: "manual",
      schemaVersion: 1,
      contentRevision: `sha256:${"1".repeat(64)}`,
      savedAt: "2026-07-27T12:34:00Z",
      displayName: "舊的雨夜",
      thumbnail: { type: "unavailable", reason: "captureUnavailable" },
      summary: {
        chapterId: "chapter_1",
        chapterTitle: "第一章",
        sceneId: "scene_2",
        sceneTitle: "律師事務所",
        activePrimaryObjectiveId: null,
        activePrimaryObjectiveLabel: null,
      },
    },
  },
};

const invalidSlot: SaveSlotView = {
  reference: { type: "manual", slot: 2 },
  modifiedAt: "2026-07-27T12:35:01Z",
  status: {
    type: "invalid",
    metadata: {
      saveId: null,
      savedAt: "2026-07-27T12:35:00Z",
      displayName: "損毀存檔",
      thumbnail: { type: "unavailable", reason: "corrupt" },
      summary: null,
    },
    diagnostic: {
      code: "malformedSaveJson",
      message: "存檔內容損毀。",
    },
  },
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("SaveConfirmationDialog", () => {
  it("compares old slot and current-game metadata before a stale-safe overwrite", async () => {
    const onConfirm = vi.fn();
    render(SaveConfirmationDialog, {
      kind: "overwrite",
      slot: validSlot,
      currentSummary,
      pendingDisplayName: "新的名稱",
      onConfirm,
      onCancel: vi.fn(),
    });

    expect(
      screen.getByRole("dialog", { name: "覆寫手動存檔 1" }),
    ).toBeInTheDocument();
    expect(screen.getByText("舊的雨夜")).toBeInTheDocument();
    expect(screen.getByText("新的名稱")).toBeInTheDocument();
    expect(screen.getByText("第二章")).toBeInTheDocument();
    expect(screen.getByText("證物保管室")).toBeInTheDocument();
    expect(screen.getByText("比對證物")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "確認覆寫" }));
    expect(onConfirm).toHaveBeenCalledWith(
      {
        type: "overwrite",
        expectation: {
          saveId: "11111111-1111-4111-8111-111111111111",
          modifiedAt: "2026-07-27T12:34:01Z",
        },
      },
      expect.any(HTMLElement),
    );
  });

  it("keeps an invalid occupied slot deletable with its null-ID observation", async () => {
    const onConfirm = vi.fn();
    render(SaveConfirmationDialog, {
      kind: "delete",
      slot: invalidSlot,
      onConfirm,
      onCancel: vi.fn(),
    });

    expect(screen.getByText("損毀存檔")).toBeInTheDocument();
    expect(screen.getByText("存檔內容損毀。")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "確認刪除" }));
    expect(onConfirm).toHaveBeenCalledWith(
      {
        type: "delete",
        expectation: {
          saveId: null,
          modifiedAt: "2026-07-27T12:35:01Z",
        },
      },
      expect.any(HTMLElement),
    );
  });

  it("confirms in-game Load with only the observed valid save ID", async () => {
    const onConfirm = vi.fn();
    render(SaveConfirmationDialog, {
      kind: "load",
      slot: validSlot,
      onConfirm,
      onCancel: vi.fn(),
    });

    expect(
      screen.getByText("目前未儲存的進度將先嘗試儲存。"),
    ).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "確認載入" }));
    expect(onConfirm).toHaveBeenCalledWith(
      {
        type: "load",
        observedSaveId: "11111111-1111-4111-8111-111111111111",
      },
      expect.any(HTMLElement),
    );
  });

  it("cannot confirm Load for an invalid slot and keeps focus inside the modal", async () => {
    const user = userEvent.setup();
    render(SaveConfirmationDialog, {
      kind: "load",
      slot: invalidSlot,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });

    const dialog = screen.getByRole("dialog");
    const cancel = screen.getByRole("button", { name: "取消" });
    expect(screen.getByRole("button", { name: "確認載入" })).toBeDisabled();
    expect(document.activeElement).toBe(cancel);
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(cancel);
  });

  it("autofocuses the action, traps Tab, and Escape restores its opener", async () => {
    const opener = document.createElement("button");
    opener.textContent = "open";
    document.body.append(opener);
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(SaveConfirmationDialog, {
      kind: "delete",
      slot: validSlot,
      returnFocusTo: opener,
      onConfirm: vi.fn(),
      onCancel,
    });

    const cancel = screen.getByRole("button", { name: "取消" });
    const confirm = screen.getByRole("button", { name: "確認刪除" });
    expect(document.activeElement).toBe(confirm);
    confirm.focus();
    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(cancel);
    cancel.focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(confirm);

    await user.keyboard("{Escape}");
    await Promise.resolve();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
  });

  it("disables every action and ignores confirm, cancel, and Escape while pending", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(SaveConfirmationDialog, {
      kind: "delete",
      slot: validSlot,
      pending: true,
      onConfirm,
      onCancel,
    });

    const dialog = screen.getByRole("dialog");
    const cancel = screen.getByRole("button", { name: "取消" });
    const confirm = screen.getByRole("button", { name: "確認刪除" });
    expect(cancel).toBeDisabled();
    expect(confirm).toBeDisabled();
    expect(dialog).toHaveFocus();

    await fireEvent.click(confirm);
    await fireEvent.click(cancel);
    await fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(dialog).toHaveFocus();
  });

  it("moves focus from the action to the dialog when pending begins after mount", async () => {
    const props = {
      kind: "delete" as const,
      slot: validSlot,
      pending: false,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    };
    const rendered = render(SaveConfirmationDialog, props);
    const dialog = screen.getByRole("dialog");
    const confirm = screen.getByRole("button", { name: "確認刪除" });
    confirm.focus();

    await rendered.rerender({ ...props, pending: true });
    await tick();

    expect(confirm).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    expect(dialog).toHaveFocus();
  });
});
