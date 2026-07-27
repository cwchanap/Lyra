import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AcquisitionAcknowledgementPhase,
  PersistenceFailureTokenView,
} from "$lib/persistence/types";
import {
  closeTopmostEscapeClaim,
  resetEscapeCoordinator,
} from "$lib/state/escape-coordinator";
import type { PendingAcquisitionView } from "$lib/state/types";
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

const idle = { type: "idle" } satisfies AcquisitionAcknowledgementPhase;

function failedPhase(
  failureToken = "failure-token-1",
): AcquisitionAcknowledgementPhase {
  return {
    type: "failed",
    diagnostic: {
      code: "saveWriteFailed",
      message: "無法寫入存檔。",
      failureToken,
    },
    failureToken,
  };
}

function props(
  notification: PendingAcquisitionView = evidence,
  phase: AcquisitionAcknowledgementPhase = idle,
) {
  return {
    notification,
    phase,
    returnFocusTo: null,
    fallbackFocusTarget: null,
    onContinue: vi.fn<(eventId: string) => Promise<void>>(
      async () => undefined,
    ),
    onRetry: vi.fn<(eventId: string) => Promise<void>>(async () => undefined),
    onCancel: vi.fn<(eventId: string) => void>(),
    onContinueWithoutSaving: vi.fn<
      (
        eventId: string,
        failureToken: PersistenceFailureTokenView,
      ) => Promise<void>
    >(async () => undefined),
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

  it("focuses Continue and forwards only the exact Rust event ID", async () => {
    const user = userEvent.setup();
    const input = props();
    render(AcquisitionPopup, input);
    const button = screen.getByRole("button", { name: "CONTINUE / 繼續" });

    await waitFor(() => expect(button).toHaveFocus());
    await user.click(button);

    expect(input.onContinue).toHaveBeenCalledExactlyOnceWith("event-evidence");
  });

  it("shows saving immediately and the slow-saving message after the controller threshold", () => {
    const input = props(evidence, { type: "saving", slow: false });
    const result = render(AcquisitionPopup, input);

    expect(screen.getByRole("button", { name: "儲存中…" })).toBeDisabled();

    result.rerender({
      ...input,
      phase: { type: "saving", slow: true },
    });

    expect(
      screen.getByRole("button", { name: "仍在儲存，請稍候…" }),
    ).toBeDisabled();
  });

  it("disables button, keyboard, and Escape dismissal while saving", async () => {
    const user = userEvent.setup();
    const input = props(evidence, { type: "capturing" });
    render(AcquisitionPopup, input);
    const button = screen.getByRole("button", { name: "儲存中…" });

    expect(button).toBeDisabled();
    await user.keyboard("{Enter} ");
    expect(closeTopmostEscapeClaim()).toBe(true);
    expect(input.onContinue).not.toHaveBeenCalled();
  });

  it("renders typed failure actions and keeps Cancel on the same event", async () => {
    const user = userEvent.setup();
    const failureToken = "failure-token-1";
    const input = props(evidence, {
      type: "failed",
      diagnostic: {
        code: "saveWriteFailed",
        message: "無法寫入存檔。",
        failureToken,
      },
      failureToken,
    });
    render(AcquisitionPopup, input);

    expect(screen.getByRole("alert")).toHaveTextContent("無法寫入存檔。");
    await user.click(screen.getByRole("button", { name: "重試" }));
    expect(input.onRetry).toHaveBeenCalledExactlyOnceWith("event-evidence");
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(input.onCancel).toHaveBeenCalledExactlyOnceWith("event-evidence");
  });

  it("requires a second confirmation before continuing with the exact token", async () => {
    const user = userEvent.setup();
    const failureToken = "failure-token-1";
    const input = props(evidence, {
      type: "failed",
      diagnostic: {
        code: "saveWriteFailed",
        message: "無法寫入存檔。",
        failureToken,
      },
      failureToken,
    });
    render(AcquisitionPopup, input);

    await user.click(screen.getByRole("button", { name: "不儲存並繼續" }));
    expect(input.onContinueWithoutSaving).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "此取得通知可能會在重新啟動後再次出現。",
    );
    await user.click(screen.getByRole("button", { name: "確認不儲存並繼續" }));

    expect(input.onContinueWithoutSaving).toHaveBeenCalledExactlyOnceWith(
      "event-evidence",
      failureToken,
    );
  });

  it("focuses Retry on failure and lets native Enter activate it once", async () => {
    const user = userEvent.setup();
    const input = props(evidence, failedPhase());
    render(AcquisitionPopup, input);
    const retry = screen.getByRole("button", { name: "重試" });

    await waitFor(() => expect(retry).toHaveFocus());
    await user.keyboard("{Enter}");

    expect(input.onRetry).toHaveBeenCalledExactlyOnceWith("event-evidence");
  });

  it("lets native Space activate Cancel once", async () => {
    const user = userEvent.setup();
    const input = props(evidence, failedPhase());
    render(AcquisitionPopup, input);
    const retry = screen.getByRole("button", { name: "重試" });
    const cancel = screen.getByRole("button", { name: "取消" });
    await waitFor(() => expect(retry).toHaveFocus());
    cancel.focus();

    await user.keyboard(" ");

    expect(input.onCancel).toHaveBeenCalledExactlyOnceWith("event-evidence");
  });

  it("lets native Space and Enter drive the two-step continue action", async () => {
    const user = userEvent.setup();
    const input = props(evidence, failedPhase());
    render(AcquisitionPopup, input);
    const firstStep = screen.getByRole("button", {
      name: "不儲存並繼續",
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重試" })).toHaveFocus(),
    );
    firstStep.focus();

    await user.keyboard(" ");
    expect(input.onContinueWithoutSaving).not.toHaveBeenCalled();
    const confirmation = screen.getByRole("button", {
      name: "確認不儲存並繼續",
    });
    expect(confirmation).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(input.onContinueWithoutSaving).toHaveBeenCalledExactlyOnceWith(
      "event-evidence",
      "failure-token-1",
    );
  });

  it("cycles Tab and Shift+Tab over the currently mounted failure controls", async () => {
    const user = userEvent.setup();
    render(AcquisitionPopup, props(evidence, failedPhase()));
    const retry = screen.getByRole("button", { name: "重試" });
    const cancel = screen.getByRole("button", { name: "取消" });
    const continueWithoutSaving = screen.getByRole("button", {
      name: "不儲存並繼續",
    });

    await waitFor(() => expect(retry).toHaveFocus());
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(continueWithoutSaving).toHaveFocus();
    await user.tab();
    expect(retry).toHaveFocus();
    await user.tab({ shift: true });
    expect(continueWithoutSaving).toHaveFocus();
  });

  it("resets the two-step confirmation when the token changes or failure ends", async () => {
    const user = userEvent.setup();
    const input = props(evidence, failedPhase("failure-token-1"));
    const result = render(AcquisitionPopup, input);

    await user.click(screen.getByRole("button", { name: "不儲存並繼續" }));
    expect(
      screen.getByRole("button", { name: "確認不儲存並繼續" }),
    ).toBeInTheDocument();

    await result.rerender({
      ...input,
      phase: failedPhase("failure-token-2"),
    });
    expect(
      screen.getByRole("button", { name: "不儲存並繼續" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "此取得通知可能會在重新啟動後再次出現。",
    );

    await user.click(screen.getByRole("button", { name: "不儲存並繼續" }));
    await result.rerender({ ...input, phase: idle });
    await result.rerender({
      ...input,
      phase: failedPhase("failure-token-2"),
    });
    expect(
      screen.getByRole("button", { name: "不儲存並繼續" }),
    ).toBeInTheDocument();
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
