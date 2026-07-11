import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeTopmostEscapeClaim,
  resetEscapeCoordinator,
} from "$lib/state/escape-coordinator";
import type { AcquisitionNotification } from "$lib/state/acquisition-notifications";
import AcquisitionPopup from "./AcquisitionPopup.svelte";

const storyAssetMocks = vi.hoisted(() => ({
  placeholderForMissingStoryAsset: vi.fn(),
  resolveStoryAsset: vi.fn(),
}));

vi.mock("$lib/assets/story-assets", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("$lib/assets/story-assets")>();
  storyAssetMocks.placeholderForMissingStoryAsset.mockImplementation(
    (assetId, type) => actual.placeholderForMissingStoryAsset(assetId, type),
  );
  storyAssetMocks.resolveStoryAsset.mockImplementation((assetId, type) =>
    actual.resolveStoryAsset(assetId, type),
  );
  return {
    ...actual,
    placeholderForMissingStoryAsset:
      storyAssetMocks.placeholderForMissingStoryAsset,
    resolveStoryAsset: storyAssetMocks.resolveStoryAsset,
  };
});

const testDir = dirname(fileURLToPath(import.meta.url));

const evidenceNotification: AcquisitionNotification = {
  key: "evidence:receipt",
  kind: "evidence",
  record: {
    id: "receipt",
    name: "咖啡收據",
    description: "收據上的時間被圈起。",
    details: "不應顯示的詳細資料",
    imageAssetId: "evidence.receipt_component_test",
    onReexamine: null,
    collectedInChapterId: "chapter_1",
    collectedInSceneId: "investigation_scene_1",
  },
};

const statementNotification: AcquisitionNotification = {
  key: "statement:alibi",
  kind: "statement",
  record: {
    id: "alibi",
    speaker: "若月",
    content: "我一直在店內。",
    onReexamine: null,
    acquiredInChapterId: "chapter_1",
    acquiredInSceneId: "investigation_scene_1",
  },
};

afterEach(() => {
  cleanup();
  resetEscapeCoordinator();
  vi.clearAllMocks();
});

describe("AcquisitionPopup", () => {
  it("renders evidence copy, description, and resolved image without details", async () => {
    const { container } = render(AcquisitionPopup, {
      notification: evidenceNotification,
      returnFocusTo: null,
      onContinue: vi.fn(() => false),
    });

    expect(screen.getByRole("dialog", { name: "物證取得" })).toHaveAttribute(
      "aria-modal",
      "true",
    );
    expect(screen.getByText("EVIDENCE ACQUIRED")).toBeInTheDocument();
    expect(screen.getByText("咖啡收據")).toBeInTheDocument();
    expect(screen.getByText("收據上的時間被圈起。")).toBeInTheDocument();
    expect(screen.queryByText("不應顯示的詳細資料")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector("img.evidence-image")).toHaveAttribute(
        "src",
        "/assets/evidence/receipt_component_test.png",
      );
    });
  });

  it("uses a generic evidence placeholder for a null image ID", async () => {
    const noImage = {
      ...evidenceNotification,
      record: { ...evidenceNotification.record, imageAssetId: null },
    };
    const { container } = render(AcquisitionPopup, {
      notification: noImage,
      returnFocusTo: null,
      onContinue: vi.fn(() => false),
    });

    await waitFor(() => {
      expect(container.querySelector("img.evidence-image")).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
    });
  });

  it("falls back when a resolved evidence image emits an error", async () => {
    const { container } = render(AcquisitionPopup, {
      notification: evidenceNotification,
      returnFocusTo: null,
      onContinue: vi.fn(() => false),
    });
    const image = await waitFor(() => {
      const result = container.querySelector("img.evidence-image");
      expect(result).toBeInTheDocument();
      return result as HTMLImageElement;
    });

    image.dispatchEvent(new Event("error"));

    await waitFor(() => {
      expect(container.querySelector("img.evidence-image")).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
    });
  });

  it("renders statement copy, speaker, content, and no raster image", () => {
    const { container } = render(AcquisitionPopup, {
      notification: statementNotification,
      returnFocusTo: null,
      onContinue: vi.fn(() => false),
    });

    expect(
      screen.getByRole("dialog", { name: "證言取得" }),
    ).toBeInTheDocument();
    expect(screen.getByText("STATEMENT ACQUIRED")).toBeInTheDocument();
    expect(screen.getByText("若月")).toBeInTheDocument();
    expect(screen.getByText("我一直在店內。")).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector(".statement-seal")).toBeInTheDocument();
  });

  it("focuses Continue, traps Tab, and forwards the current key", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn(() => false);
    render(AcquisitionPopup, {
      notification: evidenceNotification,
      returnFocusTo: null,
      onContinue,
    });
    const button = screen.getByRole("button", { name: "CONTINUE / 繼續" });

    await waitFor(() => expect(button).toHaveFocus());
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onContinue).toHaveBeenCalledExactlyOnceWith("evidence:receipt");
  });

  it("dismisses from a pointer click", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn(() => false);
    render(AcquisitionPopup, {
      notification: evidenceNotification,
      returnFocusTo: null,
      onContinue,
    });

    await user.click(screen.getByRole("button", { name: "CONTINUE / 繼續" }));

    expect(onContinue).toHaveBeenCalledExactlyOnceWith("evidence:receipt");
  });

  it("dismisses from Space on the focused native button", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn(() => false);
    render(AcquisitionPopup, {
      notification: evidenceNotification,
      returnFocusTo: null,
      onContinue,
    });
    const button = screen.getByRole("button", { name: "CONTINUE / 繼續" });

    await waitFor(() => expect(button).toHaveFocus());
    await user.keyboard(" ");

    expect(onContinue).toHaveBeenCalledExactlyOnceWith("evidence:receipt");
  });

  it("does not double-dismiss when Space fires on a non-final item", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn(() => true);
    render(AcquisitionPopup, {
      notification: evidenceNotification,
      returnFocusTo: null,
      onContinue,
    });
    const button = screen.getByRole("button", { name: "CONTINUE / 繼續" });

    await waitFor(() => expect(button).toHaveFocus());
    await user.keyboard(" ");

    expect(onContinue).toHaveBeenCalledExactlyOnceWith("evidence:receipt");
  });

  it("routes Escape through the coordinator and releases on the final item", async () => {
    const onContinue = vi.fn(() => false);
    render(AcquisitionPopup, {
      notification: evidenceNotification,
      returnFocusTo: null,
      onContinue,
    });

    await waitFor(() => {
      expect(closeTopmostEscapeClaim()).toBe(true);
    });
    expect(onContinue).toHaveBeenCalledExactlyOnceWith("evidence:receipt");
    expect(closeTopmostEscapeClaim()).toBe(false);
  });

  it("does not dismiss from a backdrop click", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn(() => false);
    const { container } = render(AcquisitionPopup, {
      notification: evidenceNotification,
      returnFocusTo: null,
      onContinue,
    });

    await user.click(container.querySelector(".acquisition-scrim")!);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("restores a connected focus target after unmount", async () => {
    const target = document.createElement("button");
    document.body.append(target);
    target.focus();
    const result = render(AcquisitionPopup, {
      notification: evidenceNotification,
      returnFocusTo: target,
      onContinue: vi.fn(() => false),
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "CONTINUE / 繼續" }),
      ).toHaveFocus();
    });
    result.unmount();
    await waitFor(() => expect(target).toHaveFocus());
    target.remove();
  });

  it("disables the entrance animation for reduced motion", () => {
    const source = readFileSync(
      join(testDir, "AcquisitionPopup.svelte"),
      "utf8",
    );
    expect(source).toContain(
      "animation: acquisition-enter 180ms ease-out both",
    );
    expect(source).toContain("@media (prefers-reduced-motion: reduce)");
    expect(source).toContain("animation: none");
    expect(source).toContain("max-height: min(220px, 32dvh)");
    expect(source).toContain("overflow-y: auto");
    expect(source).toContain("!cancelled && notification.key === key");
    expect(source).toContain("if (target?.isConnected) target.focus()");
  });
});
