import { fireEvent, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaveSlotView, SaveSummaryView } from "$lib/persistence/types";
import SaveNameDialog from "./SaveNameDialog.svelte";

const currentSummary: SaveSummaryView = {
  chapterId: "chapter_1",
  chapterTitle: "第一章",
  chapterSummary: "相馬接下雨夜中的第一宗委託。",
  sceneId: "scene_2",
  sceneTitle: "律師事務所",
  sceneSummary: "早坂帶來一份程序不明的調查摘要。",
  activePrimaryObjectiveId: "objective_1",
  activePrimaryObjectiveLabel: "詢問目擊者",
  activePrimaryObjectiveSummary: "釐清目擊者在雨夜看見的人影。",
};

const emptySlot: SaveSlotView = {
  reference: { type: "manual", slot: 1 },
  modifiedAt: null,
  status: { type: "empty" },
};

const occupiedSlot: SaveSlotView = {
  reference: { type: "manual", slot: 2 },
  modifiedAt: "2026-07-27T12:34:01Z",
  status: {
    type: "valid",
    metadata: {
      saveId: "11111111-1111-4111-8111-111111111111",
      saveType: "manual",
      schemaVersion: 1,
      contentRevision: `sha256:${"1".repeat(64)}`,
      savedAt: "2026-07-27T12:34:00Z",
      displayName: "既有名稱",
      thumbnail: { type: "unavailable", reason: "captureUnavailable" },
      summary: currentSummary,
    },
  },
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("SaveNameDialog", () => {
  it("prefills an empty slot from the current Rust summary and focuses the input", async () => {
    render(SaveNameDialog, {
      slot: emptySlot,
      currentSummary,
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });

    const input = screen.getByRole("textbox", { name: "存檔名稱" });
    expect(input).toHaveValue("第一章 · 律師事務所");
    await Promise.resolve();
    expect(document.activeElement).toBe(input);
    expect(screen.getByText("第一章")).toBeInTheDocument();
    expect(screen.getByText("律師事務所")).toBeInTheDocument();
  });

  it("prefills a readable occupied name and submits raw input with its closed observation", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(SaveNameDialog, {
      slot: occupiedSlot,
      currentSummary,
      onSubmit,
      onCancel: vi.fn(),
    });
    const input = screen.getByRole("textbox", { name: "存檔名稱" });
    expect(input).toHaveValue("既有名稱");

    await user.clear(input);
    await user.type(input, "  雨夜  ");
    await user.click(screen.getByRole("button", { name: "繼續" }));

    expect(onSubmit).toHaveBeenCalledWith(
      {
        displayName: "  雨夜  ",
        expectation: {
          type: "occupied",
          observation: {
            saveId: "11111111-1111-4111-8111-111111111111",
            modifiedAt: "2026-07-27T12:34:01Z",
          },
        },
      },
      expect.any(HTMLElement),
    );
  });

  it("uses readable invalid metadata and preserves its null save ID expectation", async () => {
    const onSubmit = vi.fn();
    const slot: SaveSlotView = {
      reference: { type: "manual", slot: 3 },
      modifiedAt: "2026-07-27T12:35:01Z",
      status: {
        type: "invalid",
        metadata: {
          saveId: null,
          savedAt: "2026-07-27T12:35:00Z",
          displayName: "可讀名稱",
          thumbnail: { type: "unavailable", reason: "corrupt" },
          summary: null,
        },
        diagnostic: {
          code: "malformedSaveJson",
          message: "存檔內容損毀。",
        },
      },
    };
    render(SaveNameDialog, {
      slot,
      currentSummary,
      onSubmit,
      onCancel: vi.fn(),
    });

    expect(screen.getByRole("textbox")).toHaveValue("可讀名稱");
    await fireEvent.submit(screen.getByRole("form"));
    expect(onSubmit).toHaveBeenCalledWith(
      {
        displayName: "可讀名稱",
        expectation: {
          type: "occupied",
          observation: {
            saveId: null,
            modifiedAt: "2026-07-27T12:35:01Z",
          },
        },
      },
      expect.any(HTMLElement),
    );
  });

  it("renders the same 39-grapheme plus ellipsis suggestion boundary", () => {
    const longSummary = {
      ...currentSummary,
      chapterTitle: "👩🏽‍💻".repeat(30),
      sceneTitle: "雨".repeat(30),
    };
    render(SaveNameDialog, {
      slot: emptySlot,
      currentSummary: longSummary,
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    const suggestion = (screen.getByRole("textbox") as HTMLInputElement).value;
    const graphemes = Array.from(
      new Intl.Segmenter("zh-Hant", { granularity: "grapheme" }).segment(
        suggestion,
      ),
    );

    expect(graphemes).toHaveLength(40);
    expect(suggestion).toMatch(/…$/);
  });

  it.each([
    ["", "請輸入存檔名稱。"],
    ["雨".repeat(41), "存檔名稱不可超過 40 個字元。"],
    ["雨\u2028夜", "存檔名稱包含不允許的字元。"],
  ])(
    "blocks invalid input %j with a specific message",
    async (input, message) => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      render(SaveNameDialog, {
        slot: emptySlot,
        currentSummary,
        onSubmit,
        onCancel: vi.fn(),
      });
      const textbox = screen.getByRole("textbox");
      await user.clear(textbox);
      if (input) await fireEvent.input(textbox, { target: { value: input } });
      await user.click(screen.getByRole("button", { name: "繼續" }));

      expect(screen.getByRole("alert")).toHaveTextContent(message);
      expect(onSubmit).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(textbox);
    },
  );

  it("traps Tab and Escape cancels one layer then restores the opener", async () => {
    const opener = document.createElement("button");
    opener.textContent = "open";
    document.body.append(opener);
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(SaveNameDialog, {
      slot: emptySlot,
      currentSummary,
      returnFocusTo: opener,
      onSubmit: vi.fn(),
      onCancel,
    });

    const input = screen.getByRole("textbox");
    const cancel = screen.getByRole("button", { name: "取消" });
    const submit = screen.getByRole("button", { name: "繼續" });
    input.focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(submit);
    submit.focus();
    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(input);

    cancel.focus();
    await user.keyboard("{Escape}");
    await Promise.resolve();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
  });

  it("disables every control and ignores submit, cancel, and Escape while pending", async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(SaveNameDialog, {
      slot: emptySlot,
      currentSummary,
      pending: true,
      onSubmit,
      onCancel,
    });

    const dialog = screen.getByRole("dialog");
    const input = screen.getByRole("textbox", { name: "存檔名稱" });
    const cancel = screen.getByRole("button", { name: "取消" });
    const submit = screen.getByRole("button", { name: "繼續" });
    expect(input).toBeDisabled();
    expect(cancel).toBeDisabled();
    expect(submit).toBeDisabled();
    expect(dialog).toHaveFocus();

    await fireEvent.submit(screen.getByRole("form"));
    await fireEvent.click(cancel);
    await fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(dialog).toHaveFocus();
  });

  it("moves focus from the input to the dialog when pending begins after mount", async () => {
    const props = {
      slot: emptySlot,
      currentSummary,
      pending: false,
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    };
    const rendered = render(SaveNameDialog, props);
    const dialog = screen.getByRole("dialog");
    const input = screen.getByRole("textbox", { name: "存檔名稱" });
    input.focus();

    await rendered.rerender({ ...props, pending: true });
    await tick();

    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "繼續" })).toBeDisabled();
    expect(dialog).toHaveFocus();
  });
});
