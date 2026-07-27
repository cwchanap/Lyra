import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GameError,
  GameplayCommandResultView,
  GameplayThumbnailCaptureResult,
  ThumbnailCaptureRequestView,
  ThumbnailActivityView,
} from "$lib/persistence/types";
import type { GameStateView, PendingAcquisitionView } from "./types";
import { createAcquisitionController } from "./acquisition-controller.svelte";

function acquisition(id = "event-1"): PendingAcquisitionView {
  return {
    id,
    recordKind: "evidence",
    recordId: "receipt",
    title: "咖啡收據",
    description: "收據上的時間被圈起。",
    details: "完整資料",
    imageAssetId: "evidence.receipt",
    createdByCommandId: 7,
    ordinal: 0,
  };
}

function state(
  pendingAcquisition: PendingAcquisitionView | null = acquisition(),
): GameStateView {
  return {
    chapter: {
      id: "chapter_1",
      title: "第一章",
      summary: "",
      index: 0,
      total: 1,
    },
    scene: {
      kind: "investigation",
      id: "investigation_scene_1",
      title: "雨夜",
      index: 0,
      total: 1,
      currentSublocationId: "main",
      visibleSublocations: [],
    },
    mode: {
      type: "explore",
      sublocationId: "main",
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    },
    inventory: { evidence: [], statements: [] },
    story: { facts: [], questions: [], objectives: [], authorizations: [] },
    dialogueHistory: [],
    pendingAcquisition,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup() {
  const gameState = { value: state() as GameStateView | null };
  const prepare =
    vi.fn<
      (purpose: {
        type: "acquisitionAcknowledgement";
        eventId: string;
      }) => Promise<ThumbnailCaptureRequestView>
    >();
  const capture =
    vi.fn<
      (
        request: ThumbnailCaptureRequestView,
      ) => Promise<GameplayThumbnailCaptureResult>
    >();
  const submit =
    vi.fn<
      (ticket: string, bytes: Uint8Array) => Promise<ThumbnailActivityView>
    >();
  const report = vi.fn<(ticket: string) => Promise<ThumbnailActivityView>>();
  const acknowledge =
    vi.fn<
      (eventId: string, ticket: string) => Promise<GameplayCommandResultView>
    >();
  const confirmWithoutSaving =
    vi.fn<
      (
        eventId: string,
        failureToken: string,
      ) => Promise<GameplayCommandResultView>
    >();
  const pinDeadline = vi.fn((request: ThumbnailCaptureRequestView) => request);
  prepare.mockResolvedValue({ ticket: "ticket-1", timeoutMs: 725 });
  capture.mockResolvedValue({
    type: "available",
    bytes: new Uint8Array([1, 2, 3]),
  });
  submit.mockResolvedValue({ type: "idle" });
  report.mockResolvedValue({ type: "idle" });
  acknowledge.mockResolvedValue({
    state: state(null),
    thumbnailCapture: null,
  });
  confirmWithoutSaving.mockResolvedValue({
    state: state(null),
    thumbnailCapture: null,
  });
  const controller = createAcquisitionController({
    gameState,
    prepare,
    capture: { capture },
    pinDeadline,
    submit,
    report,
    acknowledge,
    confirmWithoutSaving,
  });
  return {
    acknowledge,
    capture,
    confirmWithoutSaving,
    controller,
    gameState,
    pinDeadline,
    prepare,
    report,
    submit,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Rust-event-backed acquisition controller", () => {
  it("derives the only visible acquisition from the current Rust state", () => {
    const { controller, gameState } = setup();

    expect(controller.current).toEqual(acquisition());
    expect(controller.blocking).toBe(true);
    expect(controller.size).toBe(1);

    gameState.value = state(null);

    expect(controller.current).toBeNull();
    expect(controller.blocking).toBe(false);
    expect(controller.size).toBe(0);
  });

  it("keeps the event visible through prepare, capture, submit, and one acknowledgement", async () => {
    const setupResult = setup();
    const { acknowledge, controller, gameState, prepare, capture, submit } =
      setupResult;
    const acknowledgement = deferred<GameplayCommandResultView>();
    acknowledge.mockReturnValueOnce(acknowledgement.promise);

    const dismissal = controller.dismissCurrent("event-1");
    await vi.waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1));

    expect(controller.current?.id).toBe("event-1");
    expect(controller.blocking).toBe(true);
    expect(controller.phase).toEqual({ type: "saving", slow: false });
    expect(prepare).toHaveBeenCalledExactlyOnceWith({
      type: "acquisitionAcknowledgement",
      eventId: "event-1",
    });
    expect(capture).toHaveBeenCalledExactlyOnceWith({
      ticket: "ticket-1",
      timeoutMs: 725,
    });
    expect(submit).toHaveBeenCalledExactlyOnceWith(
      "ticket-1",
      new Uint8Array([1, 2, 3]),
    );
    expect(acknowledge).toHaveBeenCalledExactlyOnceWith("event-1", "ticket-1");

    acknowledgement.resolve({
      state: state(null),
      thumbnailCapture: null,
    });
    await dismissal;

    expect(gameState.value?.pendingAcquisition).toBeNull();
    expect(controller.current).toBeNull();
    expect(controller.phase).toEqual({ type: "idle" });
    expect(acknowledge).toHaveBeenCalledTimes(1);
  });

  it("reports an unavailable capture before acknowledging", async () => {
    const { acknowledge, capture, controller, report, submit } = setup();
    capture.mockResolvedValueOnce({
      type: "unavailable",
      reason: "fonts unavailable",
    });

    await controller.dismissCurrent("event-1");

    expect(report).toHaveBeenCalledExactlyOnceWith("ticket-1");
    expect(submit).not.toHaveBeenCalled();
    expect(acknowledge).toHaveBeenCalledExactlyOnceWith("event-1", "ticket-1");
  });

  it("marks one slow warning after 2 seconds without enabling dismissal", async () => {
    const { acknowledge, controller } = setup();
    const acknowledgement = deferred<GameplayCommandResultView>();
    acknowledge.mockReturnValueOnce(acknowledgement.promise);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const dismissal = controller.dismissCurrent("event-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.phase).toEqual({ type: "saving", slow: false });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(controller.phase).toEqual({ type: "saving", slow: false });
    await vi.advanceTimersByTimeAsync(1);

    expect(controller.phase).toEqual({ type: "saving", slow: true });
    expect(controller.blocking).toBe(true);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "[Persistence] Acquisition acknowledgement is still saving.",
    );

    acknowledgement.resolve({
      state: state(null),
      thumbnailCapture: null,
    });
    await dismissal;
  });

  it("keeps the slow state after a delayed prepare advances into capture and save", async () => {
    const { acknowledge, controller, prepare } = setup();
    const preparation = deferred<ThumbnailCaptureRequestView>();
    const acknowledgement = deferred<GameplayCommandResultView>();
    prepare.mockReturnValueOnce(preparation.promise);
    acknowledge.mockReturnValueOnce(acknowledgement.promise);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const dismissal = controller.dismissCurrent("event-1");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(controller.phase).toEqual({ type: "saving", slow: true });

    preparation.resolve({ ticket: "ticket-delayed", timeoutMs: 725 });
    await vi.waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1));
    expect(controller.phase).toEqual({ type: "saving", slow: true });

    acknowledgement.resolve({
      state: state(null),
      thumbnailCapture: null,
    });
    await dismissal;
  });

  it("preserves a typed failure and retries from a fresh prepare", async () => {
    const { acknowledge, controller, prepare } = setup();
    const failure: GameError = {
      code: "saveWriteFailed",
      message: "Save could not be written.",
      failureToken: "failure-token-1",
    };
    acknowledge.mockRejectedValueOnce(failure);

    await controller.dismissCurrent("event-1");

    expect(controller.phase).toEqual({
      type: "failed",
      diagnostic: failure,
      failureToken: "failure-token-1",
    });

    prepare.mockResolvedValueOnce({ ticket: "ticket-2", timeoutMs: 600 });
    await controller.retry("event-1");

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare).toHaveBeenLastCalledWith({
      type: "acquisitionAcknowledgement",
      eventId: "event-1",
    });
    expect(acknowledge).toHaveBeenLastCalledWith("event-1", "ticket-2");
    expect(controller.current).toBeNull();
  });

  it("cancel keeps the exact Rust event visible", async () => {
    const { acknowledge, controller } = setup();
    acknowledge.mockRejectedValueOnce({
      code: "saveWriteFailed",
      message: "Save could not be written.",
      failureToken: "failure-token-1",
    });
    await controller.dismissCurrent("event-1");

    controller.cancel("event-1");

    expect(controller.phase).toEqual({ type: "idle" });
    expect(controller.current?.id).toBe("event-1");
    expect(controller.blocking).toBe(true);
  });

  it("continues without saving only with the exact failed event and token", async () => {
    const { acknowledge, confirmWithoutSaving, controller, gameState } =
      setup();
    acknowledge.mockRejectedValueOnce({
      code: "saveWriteFailed",
      message: "Save could not be written.",
      failureToken: "failure-token-1",
    });
    await controller.dismissCurrent("event-1");

    await controller.continueWithoutSaving("event-1", "failure-token-1");

    expect(confirmWithoutSaving).toHaveBeenCalledExactlyOnceWith(
      "event-1",
      "failure-token-1",
    );
    expect(gameState.value?.pendingAcquisition).toBeNull();
    expect(controller.phase).toEqual({ type: "idle" });

    await controller.continueWithoutSaving("event-1", "failure-token-1");
    expect(confirmWithoutSaving).toHaveBeenCalledTimes(1);
  });

  it("ignores stale dismissals without issuing persistence work", async () => {
    const { acknowledge, controller, prepare } = setup();

    await controller.dismissCurrent("event-stale");

    expect(prepare).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();
    expect(controller.current?.id).toBe("event-1");
  });
});
