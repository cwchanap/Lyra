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

  it("uses a dynamic panel bottom with a high-opacity backdrop", () => {
    const source = dialogueHistoryPanelSource();

    // The panel's `bottom` is driven by a CSS custom property set from the
    // `bottom` prop (default 180), which DialogueBox measures from the
    // wrapper's actual height so the panel always clears the LOG button.
    expect(source).toContain("bottom?: number;");
    expect(source).toContain("bottom = 180");
    expect(source).toContain("--history-panel-bottom: {bottom}px");
    // Height formula references the clamped custom property so the panel
    // shrinks as `bottom` grows, keeping a 24px top margin within the
    // viewport. Match the meaningful fragments (Prettier wraps the
    // declaration across lines).
    expect(source).toContain("min(");
    expect(source).toContain("460px,");
    expect(source).toContain("440px,");
    expect(source).toContain(
      "calc(100dvh - var(--history-panel-bottom-clamped) - 24px)",
    );
    expect(source).toContain("box-sizing: border-box;");
    expect(source).not.toContain("max-height:");
    expect(source).toContain("background: rgba(8, 8, 14, 0.99);");
  });

  it("clamps panel bottom and height so a tall dialogue wrapper cannot collapse the popup", () => {
    const source = dialogueHistoryPanelSource();

    // When a long wrapped action/testimony grows the dialogue wrapper past
    // its 160px min-height, DialogueBox measures a large `bottom` and the
    // panel's `calc(100dvh - bottom - 24px)` height would go negative —
    // clipping the history list and CLOSE control inside `overflow: hidden`.
    // The CSS caps `bottom` at `calc(100dvh - 184px)` (so the panel never
    // slips off the top) and floors `height` at 160px (so header + CLOSE +
    // a few rows stay visible). 184px = 160px min panel height + 24px top
    // margin.
    expect(source).toContain("calc(100dvh - 184px)");
    expect(source).toContain("160px,");
    // Both the base and mobile (max-width: 720px) height declarations must
    // floor with `max(160px, ...)`.
    const baseHeight = source.indexOf("height: max(");
    const mobileHeight = source.indexOf("height: max(", baseHeight + 1);
    expect(baseHeight).toBeGreaterThan(-1);
    expect(mobileHeight).toBeGreaterThan(-1);
  });

  it("clamps --history-panel-bottom before the height calc so a tall wrapper on a short viewport cannot clip history", () => {
    const source = dialogueHistoryPanelSource();

    // Regression guard: the incoming `--history-panel-bottom` (set from the
    // `bottom` prop, which DialogueBox measures from the dialogue wrapper's
    // height) is clamped once into `--history-panel-bottom-clamped` via
    // `min(var, calc(100dvh - 184px))`, and BOTH `bottom` and `height`
    // reference the clamped value. This ensures that when a long wrapped
    // action/testimony line grows the wrapper past the viewport on a short
    // window (e.g. 800x600 Tauri), the height formula never receives an
    // out-of-range bottom value that would collapse the panel inside
    // `overflow: hidden` and clip the history list + CLOSE control.
    expect(source).toContain("--history-panel-bottom-clamped: min(");
    expect(source).toContain("var(--history-panel-bottom, 180px)");
    expect(source).toContain("calc(100dvh - 184px)");
    // `bottom` must consume the clamped value.
    expect(source).toContain("bottom: var(--history-panel-bottom-clamped);");
    // Both base (460px) and mobile (440px) height formulas must reference
    // the clamped var, not the raw incoming var.
    expect(source).toContain(
      "calc(100dvh - var(--history-panel-bottom-clamped) - 24px)",
    );
    // The raw incoming var (with its 180px fallback) must NOT appear inside
    // a height calc — only inside the clamp definition. Counting occurrences
    // guards against a regression that reverts the height formula to the
    // unclamped var.
    const rawVarRefs =
      source.match(/var\(--history-panel-bottom, 180px\)/gu)?.length ?? 0;
    expect(rawVarRefs).toBe(1);
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
