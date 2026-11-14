import { fireEvent, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaveSlotView, SaveSummaryView } from "$lib/persistence/types";
import SaveConfirmationDialog from "./SaveConfirmationDialog.svelte";

const currentSummary: SaveSummaryView = {
  chapterId: "chapter_2",
  chapterTitle: "第二章",
  chapterSummary: "相馬追查雨夜證詞背後的程序漏洞。",
  sceneId: "scene_4",
  sceneTitle: "證物保管室",
  sceneSummary: "相馬比對保管紀錄與現存證物。",
  activePrimaryObjectiveId: "objective_4",
  activePrimaryObjectiveLabel: "比對證物",
  activePrimaryObjectiveSummary: "確認證物保管鏈是否遭到竄改。",
};

const validSlot: SaveSlotView = {
  reference: { type: "manual", slot: 1 },
  modifiedAt: "2026-07-27T12:34:01Z",
  status: {
    type: "valid",
    metadata: {
      saveId: "11111111-1111-4111-8111-111111111111",
      saveType: "manual",
      schemaVersion: 2,
      contentRevision: `sha256:${"1".repeat(64)}`,
      savedAt: "2026-07-27T12:34:00Z",
      displayName: "舊的雨夜",
      thumbnail: { type: "unavailable", reason: "captureUnavailable" },
      summary: {
        chapterId: "chapter_1",
        chapterTitle: "第一章",
        chapterSummary: null,
        sceneId: "scene_2",
        sceneTitle: "律師事務所",
        sceneSummary: null,
        activePrimaryObjectiveId: null,
        activePrimaryObjectiveLabel: null,
        activePrimaryObjectiveSummary: null,
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

  // Red regression for HPA-830: autofocus must land on 取消 for dangerous
  // kinds so a second Return cancels instead of deleting. The dialog also
  // owns Tab cycling unconditionally (jsdom/WebKit cannot rely on native
  // traversal) and no longer restores an opener itself — controllers and
  // page tests own opener focus restore.
  it("autofocuses cancel for a delete, cycles Tab in both directions, and Escape cancels once", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(SaveConfirmationDialog, {
      kind: "delete",
      slot: validSlot,
      onConfirm: vi.fn(),
      onCancel,
    });

    const cancel = screen.getByRole("button", { name: "取消" });
    const confirm = screen.getByRole("button", { name: "確認刪除" });
    expect(document.activeElement).toBe(cancel);

    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(confirm);

    // Tab on the last control wraps back to the first.
    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(cancel);

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(confirm);

    // Shift+Tab on the first control wraps forward to the last.
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(cancel);

    await user.keyboard("{Escape}");
    await Promise.resolve();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  // HPA-830: cycling between the two controls must be unconditional
  // JavaScript — WebKit native traversal cannot be relied on. user.keyboard
  // alone cannot prove this because its default browser-style traversal
  // moves focus even when the handler ignores the key. So for the two
  // non-boundary moves we dispatch a cancelable keydown (the no-synthetic-
  // keydown rule concerns Enter button activation, not the Tab handler) and
  // assert both defaultPrevented and the handler-driven resulting focus;
  // jsdom performs no native traversal, so any focus movement is the
  // handler's own.
  it("cancels non-boundary Tab key events and moves focus in JavaScript in both directions", () => {
    render(SaveConfirmationDialog, {
      kind: "delete",
      slot: validSlot,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });

    const cancel = screen.getByRole("button", { name: "取消" });
    const confirm = screen.getByRole("button", { name: "確認刪除" });
    cancel.focus();

    const forward = new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      bubbles: true,
      cancelable: true,
    });
    cancel.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(confirm);

    const reverse = new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    confirm.dispatchEvent(reverse);
    expect(reverse.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
  });

  it("autofocuses cancel for an overwrite so a second Return cannot overwrite", async () => {
    const user = userEvent.setup();
    render(SaveConfirmationDialog, {
      kind: "overwrite",
      slot: validSlot,
      currentSummary,
      pendingDisplayName: "新的名稱",
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });

    const cancel = screen.getByRole("button", { name: "取消" });
    const confirm = screen.getByRole("button", { name: "確認覆寫" });
    expect(document.activeElement).toBe(cancel);

    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(confirm);
  });

  it("keeps a valid Load's confirm as the autofocus so Load stays one Return away", async () => {
    render(SaveConfirmationDialog, {
      kind: "load",
      slot: validSlot,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "確認載入" }),
    );
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
