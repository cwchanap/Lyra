import { render, screen } from "@testing-library/svelte";
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
  it("uses modal dialog semantics while focus is trapped", () => {
    render(DialogueHistoryPanel, { history, onClose: vi.fn() });

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
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

  it("traps Tab focus between panel controls", async () => {
    const user = userEvent.setup();
    render(DialogueHistoryPanel, { history, onClose: vi.fn() });

    const closeButton = screen.getByRole("button", { name: "關閉對話紀錄" });
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(closeButton).toHaveFocus();
  });
});
