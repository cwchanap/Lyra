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

  it("closes through its Escape claim and releases the claim on destroy", () => {
    const onClose = vi.fn();
    const view = render(DialogueHistoryOverlay, {
      history,
      bottom: 180,
      onClose,
    });

    expect(closeTopmostEscapeClaim()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(closeTopmostEscapeClaim()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
