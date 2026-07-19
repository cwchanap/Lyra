import { render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import DialogueHistoryPanel from "./DialogueHistoryPanel.svelte";
import type { DialogueHistoryEntry } from "../state/types";

const history: DialogueHistoryEntry[] = [
  {
    id: 1,
    kind: "line",
    speaker: "相馬律",
    text: "雨聲太乾淨了。",
    chapterTitle: "雨夜的第一份證詞",
    sceneTitle: "Opening",
  },
  {
    id: 2,
    kind: "action",
    text: "他把錄音筆放回口袋。",
    chapterTitle: "雨夜的第一份證詞",
    sceneTitle: "Opening",
  },
];

function dialogueHistoryPanelSource() {
  return readFileSync(
    join(process.cwd(), "src/lib/components/DialogueHistoryPanel.svelte"),
    "utf8",
  );
}

describe("DialogueHistoryPanel", () => {
  it("uses non-modal dialog semantics with focus trapped on the panel only", () => {
    render(DialogueHistoryPanel, { history, onClose: vi.fn() });

    // aria-modal="false" because only the dialogue .wrapper is inerted, not
    // the whole game shell — the panel is a non-modal overlay, not a true
    // modal dialog.
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "false");
  });

  it("renders spoken lines and narration in play order", () => {
    render(DialogueHistoryPanel, { history, onClose: vi.fn() });

    const entries = screen.getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent("相馬律");
    expect(entries[0]).toHaveTextContent("雨聲太乾淨了。");
    expect(entries[1]).toHaveTextContent("敘述");
    expect(entries[1]).toHaveTextContent("他把錄音筆放回口袋。");
  });

  it("renders an empty state when no entries are available", () => {
    render(DialogueHistoryPanel, { history: [], onClose: vi.fn() });

    expect(screen.getByText("尚無對話紀錄")).toBeInTheDocument();
  });

  it("uses a fixed responsive panel height with a high-opacity backdrop", () => {
    const source = dialogueHistoryPanelSource();

    expect(source).toContain("height: min(460px, calc(100dvh - 220px));");
    expect(source).toContain("height: min(440px, calc(100dvh - 190px));");
    expect(source).not.toContain("max-height:");
    expect(source).toContain("background: rgba(8, 8, 14, 0.99);");
  });

  it("calls onClose from the close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(DialogueHistoryPanel, { history, onClose });

    await user.click(screen.getByRole("button", { name: "關閉對話紀錄" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("traps Tab focus between panel controls and the scrollable list", async () => {
    const user = userEvent.setup();
    render(DialogueHistoryPanel, { history, onClose: vi.fn() });

    const closeButton = screen.getByRole("button", { name: "關閉對話紀錄" });
    const list = screen.getByRole("list", { name: "對話紀錄列表" });

    // The panel auto-focuses the CLOSE button on mount (so keyboard users
    // who open history via the LOG button can reach the panel's Tab cycle).
    // Focus explicitly to set a known baseline for the Tab-trap assertions.
    closeButton.focus();
    expect(closeButton).toHaveFocus();

    // The first forward Tab moves into the scrollable list — keyboard-only
    // users can now reach it and scroll older entries with arrow/PageUp/
    // PageDown keys.
    await user.tab();
    expect(list).toHaveFocus();

    // Tabbing forward from the last focusable element (the list) wraps back
    // to the first (the close button).
    await user.tab();
    expect(closeButton).toHaveFocus();

    // Shift+Tab from the close button wraps back to the list.
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(list).toHaveFocus();

    // Shift+Tab from the list wraps back to the close button.
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(closeButton).toHaveFocus();
  });

  it("auto-focuses the CLOSE button on mount", async () => {
    render(DialogueHistoryPanel, { history, onClose: vi.fn() });

    const closeButton = screen.getByRole("button", { name: "關閉對話紀錄" });
    // onMount hands focus to the close button so keyboard users who open
    // history via the LOG button can reach the panel's Tab cycle without
    // reverse-tabbing out of the dialogue surface.
    await waitFor(() => {
      expect(closeButton).toHaveFocus();
    });
  });

  it("exposes the scrollable history list with a keyboard-reachable tabindex", () => {
    render(DialogueHistoryPanel, { history, onClose: vi.fn() });

    const list = screen.getByRole("list", { name: "對話紀錄列表" });
    expect(list).toHaveAttribute("tabindex", "0");
  });

  it("does not trap Tab when focus rests on the panel container itself", () => {
    render(DialogueHistoryPanel, { history, onClose: vi.fn() });

    const panel = screen.getByRole("dialog");
    panel.focus();
    expect(panel).toHaveFocus();

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    panel.dispatchEvent(event);

    // Focus is neither the first nor last focusable element, so the trap
    // leaves the default Tab traversal untouched.
    expect(event.defaultPrevented).toBe(false);
  });
});
