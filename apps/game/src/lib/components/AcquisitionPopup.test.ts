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
import type { PendingAcquisitionView } from "$lib/state/types";
import AcquisitionPopupBusyHarness from "$lib/test-harnesses/AcquisitionPopupBusyHarness.svelte";
import AcquisitionPopup from "./AcquisitionPopup.svelte";

const testDir = dirname(fileURLToPath(import.meta.url));

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

const evidence: PendingAcquisitionView = {
  id: "event-evidence",
  recordKind: "evidence",
  recordId: "receipt",
  title: "咖啡收據",
  description: "收據上的時間被圈起。",
  details: "不應顯示的詳細資料",
  imageAssetId: "evidence.receipt_component_test",
  createdByCommandId: 7,
  ordinal: 0,
};

const statement: PendingAcquisitionView = {
  id: "event-statement",
  recordKind: "statement",
  recordId: "alibi",
  title: "若月",
  description: "我一直在店內。",
  details: "我一直在店內。",
  imageAssetId: null,
  createdByCommandId: 8,
  ordinal: 0,
};

function props(
  notification: PendingAcquisitionView = evidence,
  overrides: { busy?: boolean; error?: string | null } = {},
) {
  return {
    notification,
    busy: false,
    error: null,
    returnFocusTo: null,
    fallbackFocusTarget: null,
    onContinue: vi.fn<(eventId: string) => Promise<void>>(
      async () => undefined,
    ),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  resetEscapeCoordinator();
  vi.clearAllMocks();
});

describe("AcquisitionPopup", () => {
  it("renders Rust-provided evidence presentation without details", async () => {
    const { container } = render(AcquisitionPopup, props());

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

  it("renders Rust-provided statement presentation without a raster image", () => {
    const { container } = render(AcquisitionPopup, props(statement));

    expect(
      screen.getByRole("dialog", { name: "證言取得" }),
    ).toBeInTheDocument();
    expect(screen.getByText("STATEMENT ACQUIRED")).toBeInTheDocument();
    expect(screen.getByText("若月")).toBeInTheDocument();
    expect(screen.getByText("我一直在店內。")).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector(".statement-seal")).toBeInTheDocument();
  });

  it("focuses the single Continue button and forwards only the exact Rust event ID", async () => {
    const user = userEvent.setup();
    const input = props();
    render(AcquisitionPopup, input);
    const button = screen.getByRole("button", { name: "CONTINUE / 繼續" });

    await waitFor(() => expect(button).toHaveFocus());
    await user.click(button);

    expect(input.onContinue).toHaveBeenCalledExactlyOnceWith("event-evidence");
  });

  it("offers exactly one Continue button and no retry/cancel/bypass controls", () => {
    render(AcquisitionPopup, props(evidence, { error: "存檔失敗。" }));

    expect(
      screen.getAllByRole("button", { name: "CONTINUE / 繼續" }),
    ).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "重試" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取消" })).toBeNull();
    expect(screen.queryByRole("button", { name: "不儲存並繼續" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "確認不儲存並繼續" }),
    ).toBeNull();
  });

  it("disables Continue and shows one concise processing label while busy", () => {
    const input = props(evidence, { busy: true });
    render(AcquisitionPopup, input);

    expect(screen.getByRole("button", { name: "確認中…" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "CONTINUE / 繼續" }),
    ).toBeNull();
  });

  it("disables button, keyboard, and Escape dismissal while busy", async () => {
    const user = userEvent.setup();
    const input = props(evidence, { busy: true });
    render(AcquisitionPopup, input);
    const button = screen.getByRole("button", { name: "確認中…" });

    expect(button).toBeDisabled();
    await user.keyboard("{Enter} ");
    expect(closeTopmostEscapeClaim()).toBe(true);
    expect(input.onContinue).not.toHaveBeenCalled();
  });

  it("renders the shared error inside the dialog with role=alert", () => {
    const input = props(evidence, { error: "尚未呈現的取得事件無法確認。" });
    render(AcquisitionPopup, input);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("尚未呈現的取得事件無法確認。");
    expect(alert.closest("[role=dialog]")).not.toBeNull();
  });

  it("keeps Continue enabled after an error so pressing it retries the same onContinue", async () => {
    const user = userEvent.setup();
    const input = props(evidence, { error: "存檔失敗。" });
    render(AcquisitionPopup, input);
    const button = screen.getByRole("button", { name: "CONTINUE / 繼續" });

    expect(button).toBeEnabled();
    await waitFor(() => expect(button).toHaveFocus());
    await user.click(button);

    expect(input.onContinue).toHaveBeenCalledExactlyOnceWith("event-evidence");
  });

  it("refocuses Continue when busy flips to idle on the same mounted event", async () => {
    // Regression: $effect must synchronously track `busy` so a fine-grained
    // busy -> idle transition on the same event reruns the focus effect.
    // Reading busy only inside tick().then(...) would not be tracked, so an
    // acknowledgement failure that flips busy true -> false (leaving the same
    // event mounted) would leave Continue usable but never refocused.
    //
    // The harness holds busy as its own $state field (mirroring
    // acquisition-controller.svelte.ts) so flipping it does NOT reassign the
    // popup's other props. @testing-library/svelte's rerender reassigns the
    // whole props object and cannot reproduce this fine-grained case.
    const onContinue = vi.fn<(eventId: string) => Promise<void>>(
      async () => undefined,
    );
    const user = userEvent.setup();
    render(AcquisitionPopupBusyHarness, {
      notification: evidence,
      onContinue,
    });

    // While busy, Continue is disabled and not focused.
    const busyButton = screen.getByRole("button", { name: "確認中…" });
    expect(busyButton).toBeDisabled();
    expect(busyButton).not.toHaveFocus();

    // Flip only busy -> idle, same event still mounted.
    await user.click(screen.getByRole("button", { name: "go idle" }));

    const idleButton = await screen.findByRole("button", {
      name: "CONTINUE / 繼續",
    });
    expect(idleButton).toBeEnabled();
    await waitFor(() => expect(idleButton).toHaveFocus());
  });

  it("uses a generic evidence placeholder for a null image ID", async () => {
    const { container } = render(
      AcquisitionPopup,
      props({ ...evidence, imageAssetId: null }),
    );

    await waitFor(() => {
      expect(container.querySelector("img.evidence-image")).toHaveAttribute(
        "src",
        expect.stringContaining("data:image/svg+xml"),
      );
    });
  });

  it("falls back when a resolved evidence image emits an error", async () => {
    const { container } = render(AcquisitionPopup, props());
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

  it("focuses Continue, traps Tab, and forwards the current key", async () => {
    const user = userEvent.setup();
    const input = props();
    render(AcquisitionPopup, input);
    const button = screen.getByRole("button", { name: "CONTINUE / 繼續" });

    await waitFor(() => expect(button).toHaveFocus());
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(input.onContinue).toHaveBeenCalledExactlyOnceWith("event-evidence");
  });

  it("dismisses from a pointer click", async () => {
    const user = userEvent.setup();
    const input = props();
    render(AcquisitionPopup, input);

    await user.click(screen.getByRole("button", { name: "CONTINUE / 繼續" }));

    expect(input.onContinue).toHaveBeenCalledExactlyOnceWith("event-evidence");
  });

  it("dismisses from Space on the focused native button", async () => {
    const user = userEvent.setup();
    const input = props();
    render(AcquisitionPopup, input);
    const button = screen.getByRole("button", { name: "CONTINUE / 繼續" });

    await waitFor(() => expect(button).toHaveFocus());
    await user.keyboard(" ");

    expect(input.onContinue).toHaveBeenCalledExactlyOnceWith("event-evidence");
  });

  it("does not double-dismiss when Space fires while the save begins", async () => {
    const user = userEvent.setup();
    const input = props();
    render(AcquisitionPopup, input);
    const button = screen.getByRole("button", { name: "CONTINUE / 繼續" });

    await waitFor(() => expect(button).toHaveFocus());
    await user.keyboard(" ");

    expect(input.onContinue).toHaveBeenCalledExactlyOnceWith("event-evidence");
  });

  it("routes Escape through the coordinator while idle", async () => {
    const input = props();
    render(AcquisitionPopup, input);

    await waitFor(() => {
      expect(closeTopmostEscapeClaim()).toBe(true);
    });
    expect(input.onContinue).toHaveBeenCalledExactlyOnceWith("event-evidence");
  });

  it("does not dismiss from a backdrop click", async () => {
    const user = userEvent.setup();
    const input = props();
    const { container } = render(AcquisitionPopup, input);

    await user.click(container.querySelector(".acquisition-scrim")!);
    expect(input.onContinue).not.toHaveBeenCalled();
  });

  it("restores a connected focus target after unmount", async () => {
    const target = document.createElement("button");
    document.body.append(target);
    target.focus();
    const result = render(AcquisitionPopup, {
      ...props(),
      returnFocusTo: target,
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

  it("falls back to fallbackFocusTarget when returnFocusTo is document.body", async () => {
    const fallback = document.createElement("div");
    fallback.tabIndex = -1;
    document.body.append(fallback);
    const result = render(AcquisitionPopup, {
      ...props(),
      returnFocusTo: document.body,
      fallbackFocusTarget: fallback,
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "CONTINUE / 繼續" }),
      ).toHaveFocus();
    });

    result.unmount();
    await waitFor(() => expect(fallback).toHaveFocus());
    expect(document.body).not.toHaveFocus();
    fallback.remove();
  });

  it("restores focus to the stable gameplay fallback after authoritative closure", async () => {
    const primary = document.createElement("button");
    const fallback = document.createElement("div");
    fallback.tabIndex = -1;
    document.body.append(primary, fallback);
    const result = render(AcquisitionPopup, {
      ...props(),
      returnFocusTo: primary,
      fallbackFocusTarget: fallback,
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "CONTINUE / 繼續" }),
      ).toHaveFocus(),
    );
    primary.remove();

    result.unmount();

    await waitFor(() => expect(fallback).toHaveFocus());
    fallback.remove();
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
    expect(source).toContain("!cancelled && notification.id === eventId");
  });
});
