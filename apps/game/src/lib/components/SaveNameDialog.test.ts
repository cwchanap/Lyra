import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
      schemaVersion: 2,
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

  it("traps Tab and Escape cancels one layer", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(SaveNameDialog, {
      slot: emptySlot,
      currentSummary,
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
  });

  it("leaves composing and WebKit keyCode-229 Escape keydowns to the IME", async () => {
    const onCancel = vi.fn();
    render(SaveNameDialog, {
      slot: emptySlot,
      currentSummary,
      onSubmit: vi.fn(),
      onCancel,
    });

    const input = screen.getByRole("textbox", { name: "存檔名稱" });
    input.focus();

    const composingEscape = new KeyboardEvent("keydown", {
      key: "Escape",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    expect(input.dispatchEvent(composingEscape)).toBe(true);
    expect(composingEscape.defaultPrevented).toBe(false);

    const webkitImeEscape = new KeyboardEvent("keydown", {
      key: "Escape",
      keyCode: 229,
      isComposing: false,
      bubbles: true,
      cancelable: true,
    });
    expect(input.dispatchEvent(webkitImeEscape)).toBe(true);
    expect(webkitImeEscape.defaultPrevented).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();

    const plainEscape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(plainEscape);
    await Promise.resolve();
    expect(plainEscape.defaultPrevented).toBe(true);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  // HPA-830: cycling between all dialog controls (including input -> buttons)
  // must be unconditional JavaScript so macOS WebKit with Keyboard navigation
  // off cannot skip the buttons and leave the dialog from the name input.
  it("cycles non-boundary Tab in JavaScript across input, cancel, and submit in both directions", () => {
    render(SaveNameDialog, {
      slot: emptySlot,
      currentSummary,
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });

    const input = screen.getByRole("textbox", { name: "存檔名稱" });
    const cancel = screen.getByRole("button", { name: "取消" });
    const submit = screen.getByRole("button", { name: "繼續" });
    input.focus();

    for (const expected of [cancel, submit, input]) {
      const forward = new KeyboardEvent("keydown", {
        key: "Tab",
        code: "Tab",
        bubbles: true,
        cancelable: true,
      });
      (document.activeElement ?? input).dispatchEvent(forward);
      expect(forward.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(expected);
    }

    for (const expected of [submit, cancel, input]) {
      const reverse = new KeyboardEvent("keydown", {
        key: "Tab",
        code: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      (document.activeElement ?? input).dispatchEvent(reverse);
      expect(reverse.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(expected);
    }
  });

  it("gives the input and action buttons a clear keyboard focus ring", () => {
    const source = readFileSync(
      resolve(import.meta.dirname!, "SaveNameDialog.svelte"),
      "utf8",
    );

    // HPA-830: 命名存檔 controls must show a visible keyboard focus ring
    // (jsdom does not compute :focus-visible; the source rule is the
    // authority).
    expect(source).toMatch(
      /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--cyan/,
    );
    expect(source).toMatch(/:focus-visible\s*\{[^}]*outline-offset:/);
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
