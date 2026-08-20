import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeTopmostEscapeClaim,
  resetEscapeCoordinator,
} from "$lib/state/escape-coordinator";
import type { DialogueHistoryEntry } from "../state/types";
import DialogueHistoryOverlay from "./DialogueHistoryOverlay.svelte";

const history: DialogueHistoryEntry[] = [
  {
    id: 1,
    kind: "line",
    speaker: "相馬律",
    text: "雨聲太乾淨了。",
    chapterTitle: "雨夜的第一份證詞",
    sceneTitle: "Opening",
  },
];

afterEach(() => {
  cleanup();
  resetEscapeCoordinator();
});

describe("DialogueHistoryOverlay", () => {
  it("hosts a non-modal history panel behind a visual-only backdrop", () => {
    render(DialogueHistoryOverlay, {
      history,
      bottom: 180,
      onClose: vi.fn(),
    });

    const backdrop = document.querySelector(".history-backdrop");
    expect(backdrop).toHaveAttribute("aria-hidden", "true");
    expect(backdrop).not.toBeNull();
    expect(getComputedStyle(backdrop!).pointerEvents).toBe("none");
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "false");
  });

  it("omits the L shortcut hint for a host without the DialogueBox shortcut", () => {
    render(DialogueHistoryOverlay, {
      history,
      bottom: 180,
      onClose: vi.fn(),
      showCloseShortcutHint: false,
    });

    expect(
      screen.getByRole("button", { name: "關閉對話紀錄" }),
    ).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText("按 L 關閉")).toBeNull();
  });

  it("releases its Escape claim when unmounted without invoking onClose", () => {
    const onClose = vi.fn();
    const view = render(DialogueHistoryOverlay, {
      history,
      bottom: 180,
      onClose,
    });

    view.unmount();
    expect(closeTopmostEscapeClaim()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("releases its Escape claim before invoking onClose", () => {
    let claimStillPresentDuringClose = false;
    const onClose = vi.fn(() => {
      claimStillPresentDuringClose = closeTopmostEscapeClaim();
    });
    render(DialogueHistoryOverlay, {
      history,
      bottom: 180,
      onClose,
    });

    expect(closeTopmostEscapeClaim()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(claimStillPresentDuringClose).toBe(false);
  });
});
