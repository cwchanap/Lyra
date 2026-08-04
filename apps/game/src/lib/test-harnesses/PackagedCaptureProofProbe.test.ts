import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SaveBrowserOpenResultView,
  SaveBrowserView,
} from "$lib/persistence/types";
import type { PackagedCaptureProofStatus } from "$lib/persistence/thumbnail-capture";
import PackagedCaptureProofProbe from "./PackagedCaptureProofProbe.svelte";

const mocks = vi.hoisted(() => ({
  invokePersistenceCommand: vi.fn(),
  readSaveThumbnail: vi.fn(),
}));

vi.mock("$lib/persistence/commands", () => ({
  invokePersistenceCommand: mocks.invokePersistenceCommand,
  readSaveThumbnail: mocks.readSaveThumbnail,
}));

function browser(savedAt: string, saveId = "auto-save-1"): SaveBrowserView {
  return {
    discovery: { type: "available" as const },
    slots: [
      {
        reference: { type: "manual" as const, slot: 1 },
        modifiedAt: "2026-01-02T00:00:00Z",
        status: {
          type: "valid" as const,
          metadata: {
            saveId: "manual-save",
            saveType: "manual" as const,
            schemaVersion: 2,
            contentRevision: "revision",
            savedAt: "2026-01-02T00:00:00Z",
            displayName: "Manual",
            thumbnail: { type: "available" as const, width: 480, height: 360 },
            summary: {
              chapterId: "chapter_1",
              chapterTitle: "Chapter",
              chapterSummary: null,
              sceneId: "scene_1",
              sceneTitle: "Scene",
              sceneSummary: null,
              activePrimaryObjectiveId: null,
              activePrimaryObjectiveLabel: null,
              activePrimaryObjectiveSummary: null,
            },
          },
        },
      },
      {
        reference: { type: "auto" as const, slot: 2 },
        modifiedAt: savedAt,
        status: {
          type: "valid" as const,
          metadata: {
            saveId,
            saveType: "auto" as const,
            schemaVersion: 2,
            contentRevision: "revision",
            savedAt,
            displayName: "Autosave",
            thumbnail: { type: "available" as const, width: 480, height: 360 },
            summary: {
              chapterId: "chapter_1",
              chapterTitle: "Chapter",
              chapterSummary: null,
              sceneId: "scene_1",
              sceneTitle: "Scene",
              sceneSummary: null,
              activePrimaryObjectiveId: null,
              activePrimaryObjectiveLabel: null,
              activePrimaryObjectiveSummary: null,
            },
          },
        },
      },
    ],
  };
}

function openResult(
  savedAt: string,
  saveId = "auto-save-1",
): SaveBrowserOpenResultView {
  return {
    browser: browser(savedAt, saveId),
    continueCandidate: null,
    preflight: { type: "ready" },
  };
}

beforeEach(() => {
  mocks.invokePersistenceCommand.mockReset();
  mocks.readSaveThumbnail.mockReset();
  vi.spyOn(URL, "createObjectURL")
    .mockReturnValueOnce("blob:proof-1")
    .mockReturnValueOnce("blob:proof-2");
  vi.spyOn(URL, "revokeObjectURL");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PackagedCaptureProofProbe", () => {
  it("reads the newest autosave through typed commands and revokes Blob URLs on replace/unmount", async () => {
    mocks.invokePersistenceCommand
      .mockResolvedValueOnce(openResult("2026-01-03T00:00:00Z", "auto-save-1"))
      .mockResolvedValueOnce(openResult("2026-01-04T00:00:00Z", "auto-save-2"));
    mocks.readSaveThumbnail
      .mockResolvedValueOnce(new Uint8Array([1]))
      .mockResolvedValueOnce(new Uint8Array([2]));
    const rendered = render(PackagedCaptureProofProbe, {
      onForceNextCaptureUnavailable: vi.fn(),
    });

    const refresh = rendered.getByRole("button", {
      name: "Refresh capture proof",
    });
    await fireEvent.click(refresh);
    await waitFor(() =>
      expect(
        rendered.container.querySelector("[data-capture-proof-thumbnail]"),
      ).toHaveAttribute("src", "blob:proof-1"),
    );
    expect(mocks.invokePersistenceCommand).toHaveBeenCalledWith("list_saves");
    expect(mocks.readSaveThumbnail).toHaveBeenLastCalledWith(
      { type: "auto", slot: 2 },
      "auto-save-1",
    );

    await fireEvent.click(refresh);
    await waitFor(() =>
      expect(
        rendered.container.querySelector("[data-capture-proof-thumbnail]"),
      ).toHaveAttribute("src", "blob:proof-2"),
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:proof-1");

    rendered.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:proof-2");
  });

  it("exposes one closed force-next control without a generic command bridge", async () => {
    const forceNext = vi.fn();
    const rendered = render(PackagedCaptureProofProbe, {
      onForceNextCaptureUnavailable: forceNext,
    });

    await fireEvent.click(
      rendered.getByRole("button", {
        name: "Force next capture unavailable",
      }),
    );

    expect(forceNext).toHaveBeenCalledOnce();
  });

  it("exposes the closed owning-command settlement status", async () => {
    const rendered = render(PackagedCaptureProofProbe, {
      onForceNextCaptureUnavailable: vi.fn(),
      captureCommandInFlight: true,
    });

    expect(
      rendered.container.querySelector("[data-capture-proof]"),
    ).toHaveAttribute("data-capture-proof-command-status", "capturing");
    expect(
      rendered.container.querySelector("[data-capture-proof]"),
    ).toHaveAttribute("data-capture-proof-completed-generation", "0");

    await rendered.rerender({ captureCommandInFlight: false });
    await waitFor(() =>
      expect(
        rendered.container.querySelector("[data-capture-proof]"),
      ).toHaveAttribute("data-capture-proof-completed-generation", "1"),
    );
    expect(
      rendered.container.querySelector("[data-capture-proof]"),
    ).toHaveAttribute("data-capture-proof-command-status", "idle");
  });

  it("publishes the persistent capture wrapper status when the owning command settles", async () => {
    let captureStatus: PackagedCaptureProofStatus = {
      calls: 0,
      available: 0,
      lastClosedReason: "",
      lastRenderDiagnostic: "",
      embeddedFontCssBytes: 0,
      embeddedFontChunkCount: 0,
      embeddedZhHantCodePointCount: 0,
    };
    const rendered = render(PackagedCaptureProofProbe, {
      onForceNextCaptureUnavailable: vi.fn(),
      captureCommandInFlight: true,
      captureStatus: () => captureStatus,
    });

    captureStatus = {
      calls: 1,
      available: 1,
      lastClosedReason: "",
      lastRenderDiagnostic: "errorEvent",
      embeddedFontCssBytes: 175_000,
      embeddedFontChunkCount: 3,
      embeddedZhHantCodePointCount: 12,
    };
    await rendered.rerender({ captureCommandInFlight: false });

    await waitFor(() =>
      expect(
        rendered.container.querySelector("[data-capture-proof]"),
      ).toHaveAttribute("data-capture-proof-calls", "1"),
    );
    expect(
      rendered.container.querySelector("[data-capture-proof]"),
    ).toHaveAttribute("data-capture-proof-available", "1");
    expect(
      rendered.container.querySelector("[data-capture-proof]"),
    ).toHaveAttribute(
      "data-capture-proof-last-render-diagnostic",
      "errorEvent",
    );
    expect(
      rendered.container.querySelector("[data-capture-proof]"),
    ).toHaveAttribute("data-capture-proof-last-closed-reason", "");
    expect(
      rendered.container.querySelector("[data-capture-proof]"),
    ).toHaveAttribute("data-capture-proof-font-css-bytes", "175000");
    expect(
      rendered.container.querySelector("[data-capture-proof]"),
    ).toHaveAttribute("data-capture-proof-font-chunks", "3");
    expect(
      rendered.container.querySelector("[data-capture-proof]"),
    ).toHaveAttribute("data-capture-proof-font-zh-hant-code-points", "12");
  });

  it("reports the newest autosave's unavailable thumbnail without falling back", async () => {
    const unavailable = openResult("2026-01-05T00:00:00Z", "auto-unavailable");
    const auto = unavailable.browser.slots[1];
    if (auto?.status.type !== "valid") throw new Error("invalid fixture");
    auto.status.metadata.thumbnail = {
      type: "unavailable",
      reason: "captureUnavailable",
    };
    mocks.invokePersistenceCommand.mockResolvedValueOnce(unavailable);
    const rendered = render(PackagedCaptureProofProbe, {
      onForceNextCaptureUnavailable: vi.fn(),
      captureUnavailableReason: () => "renderDeadlineExpired",
    });

    await fireEvent.click(
      rendered.getByRole("button", { name: "Refresh capture proof" }),
    );

    await waitFor(() =>
      expect(
        rendered.container.querySelector("[data-capture-proof]"),
      ).toHaveAttribute("data-capture-proof-status", "unavailable"),
    );
    expect(mocks.readSaveThumbnail).not.toHaveBeenCalled();
    expect(
      rendered.container.querySelector("[data-capture-proof]"),
    ).toHaveAttribute(
      "data-capture-proof-unavailable-reason",
      "renderDeadlineExpired",
    );
  });

  it("exposes a closed diagnostic when persistence commands fail", async () => {
    mocks.invokePersistenceCommand.mockRejectedValueOnce({
      code: "saveDiscoveryUnavailable",
      message: "list saves failed",
    });
    const rendered = render(PackagedCaptureProofProbe, {
      onForceNextCaptureUnavailable: vi.fn(),
    });

    await fireEvent.click(
      rendered.getByRole("button", { name: "Refresh capture proof" }),
    );

    await waitFor(() =>
      expect(
        rendered.container.querySelector("[data-capture-proof]"),
      ).toHaveAttribute(
        "data-capture-proof-error-code",
        "saveDiscoveryUnavailable",
      ),
    );
    expect(
      rendered.container.querySelector("[data-capture-proof]"),
    ).toHaveAttribute("data-capture-proof-error-message", "list saves failed");
    expect(
      rendered.container.querySelector("[data-capture-proof]"),
    ).toHaveAttribute("data-capture-proof-error-stage", "listSaves");
  });

  it("selects the newest autosave when Array.prototype.toSorted is unavailable", async () => {
    const toSortedDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "toSorted",
    );
    Object.defineProperty(Array.prototype, "toSorted", {
      configurable: true,
      value: undefined,
    });
    mocks.invokePersistenceCommand.mockResolvedValueOnce(
      openResult("2026-01-05T00:00:00Z", "auto-without-to-sorted"),
    );
    mocks.readSaveThumbnail.mockResolvedValueOnce(new Uint8Array([1]));

    try {
      const rendered = render(PackagedCaptureProofProbe, {
        onForceNextCaptureUnavailable: vi.fn(),
      });
      await fireEvent.click(
        rendered.getByRole("button", { name: "Refresh capture proof" }),
      );
      await waitFor(() =>
        expect(
          rendered.container.querySelector("[data-capture-proof-thumbnail]"),
        ).toHaveAttribute("src", "blob:proof-1"),
      );
    } finally {
      if (toSortedDescriptor) {
        Object.defineProperty(Array.prototype, "toSorted", toSortedDescriptor);
      } else {
        delete (Array.prototype as { toSorted?: unknown }).toSorted;
      }
    }
  });
});
