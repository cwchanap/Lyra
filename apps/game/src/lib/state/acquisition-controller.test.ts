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
      summary: "",
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
  const retryAcknowledge =
    vi.fn<
      (
        eventId: string,
        failureToken: string,
      ) => Promise<ThumbnailCaptureRequestView>
    >();
  const cancelFailure =
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
  retryAcknowledge.mockResolvedValue({ ticket: "ticket-2", timeoutMs: 600 });
  cancelFailure.mockResolvedValue({
    state: state(),
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
    retryAcknowledge,
    cancelFailure,
    confirmWithoutSaving,
  });
  return {
    acknowledge,
    capture,
    cancelFailure,
    confirmWithoutSaving,
    controller,
    gameState,
    pinDeadline,
    prepare,
    report,
    retryAcknowledge,
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

  it("preserves a typed failure and retries by consuming the failure token", async () => {
    const { acknowledge, controller, retryAcknowledge } = setup();
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

    await controller.retry("event-1");

    expect(retryAcknowledge).toHaveBeenCalledExactlyOnceWith(
      "event-1",
      "failure-token-1",
    );
    expect(acknowledge).toHaveBeenLastCalledWith("event-1", "ticket-2");
    expect(controller.current).toBeNull();
  });

  it("cancel consumes the failure token and keeps the exact Rust event visible", async () => {
    const { acknowledge, cancelFailure, controller } = setup();
    acknowledge.mockRejectedValueOnce({
      code: "saveWriteFailed",
      message: "Save could not be written.",
      failureToken: "failure-token-1",
    });
    await controller.dismissCurrent("event-1");

    await controller.cancel("event-1");

    expect(cancelFailure).toHaveBeenCalledExactlyOnceWith(
      "event-1",
      "failure-token-1",
    );
    expect(controller.phase).toEqual({ type: "idle" });
    expect(controller.current?.id).toBe("event-1");
    expect(controller.blocking).toBe(true);
  });

  it("cancel blocks further actions with a cancelling phase until the command settles", async () => {
    const { acknowledge, cancelFailure, controller } = setup();
    acknowledge.mockRejectedValueOnce({
      code: "saveWriteFailed",
      message: "Save could not be written.",
      failureToken: "failure-token-1",
    });
    await controller.dismissCurrent("event-1");

    const cancellation = deferred<GameplayCommandResultView>();
    cancelFailure.mockReturnValueOnce(cancellation.promise);

    const pending = controller.cancel("event-1");
    await vi.waitFor(() => expect(cancelFailure).toHaveBeenCalledTimes(1));

    // While cancel is in flight the phase is "cancelling" and a new
    // acknowledgement cannot start.
    expect(controller.phase).toEqual({ type: "cancelling" });
    expect(controller.blocking).toBe(true);
    const acknowledgeBefore = acknowledge.mock.calls.length;
    await controller.dismissCurrent("event-1");
    expect(acknowledge.mock.calls.length).toBe(acknowledgeBefore);

    cancellation.resolve({ state: state(null), thumbnailCapture: null });
    await pending;

    expect(controller.phase).toEqual({ type: "idle" });
    expect(controller.current).toBeNull();
  });

  it("cancel does not overwrite a newer state when ownership is lost mid-flight", async () => {
    const { acknowledge, cancelFailure, controller, gameState } = setup();
    acknowledge.mockRejectedValueOnce({
      code: "saveWriteFailed",
      message: "Save could not be written.",
      failureToken: "failure-token-1",
    });
    await controller.dismissCurrent("event-1");

    const cancellation = deferred<GameplayCommandResultView>();
    cancelFailure.mockReturnValueOnce(cancellation.promise);

    const pending = controller.cancel("event-1");
    await vi.waitFor(() => expect(cancelFailure).toHaveBeenCalledTimes(1));

    // Simulate the event changing (e.g. a newer Rust event) while cancel is
    // still running. The stale cancel result must not clobber the new state.
    gameState.value = state(acquisition("event-2"));

    cancellation.resolve({ state: state(), thumbnailCapture: null });
    await pending;

    expect(gameState.value?.pendingAcquisition?.id).toBe("event-2");
  });

  it("cancel restores the failed phase with the original token when the command fails", async () => {
    const { acknowledge, cancelFailure, controller } = setup();
    const failure: GameError = {
      code: "saveWriteFailed",
      message: "Save could not be written.",
      failureToken: "failure-token-1",
    };
    acknowledge.mockRejectedValueOnce(failure);
    await controller.dismissCurrent("event-1");

    cancelFailure.mockRejectedValueOnce({
      code: "stalePersistenceFailureToken",
      message: "The failure token is no longer valid.",
    });

    await controller.cancel("event-1");

    expect(controller.phase).toEqual({
      type: "failed",
      diagnostic: {
        code: "stalePersistenceFailureToken",
        message: "The failure token is no longer valid.",
      },
      failureToken: "failure-token-1",
    });
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

  it("relinquishes a stale attempt when the event changes during prepare", async () => {
    const { acknowledge, capture, controller, gameState, prepare } = setup();
    const preparation = deferred<ThumbnailCaptureRequestView>();
    prepare.mockReturnValueOnce(preparation.promise);

    const staleDismissal = controller.dismissCurrent("event-1");
    gameState.value = state(acquisition("event-2"));
    preparation.resolve({ ticket: "ticket-stale", timeoutMs: 725 });
    await staleDismissal;

    expect(controller.phase).toEqual({ type: "idle" });
    expect(capture).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();

    await controller.dismissCurrent("event-2");
    expect(acknowledge).toHaveBeenCalledExactlyOnceWith("event-2", "ticket-1");
  });

  it("relinquishes a stale attempt when the event changes during capture", async () => {
    const { acknowledge, capture, controller, gameState, submit } = setup();
    const captureResult = deferred<GameplayThumbnailCaptureResult>();
    capture.mockReturnValueOnce(captureResult.promise);

    const staleDismissal = controller.dismissCurrent("event-1");
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
    gameState.value = state(acquisition("event-2"));
    captureResult.resolve({
      type: "available",
      bytes: new Uint8Array([9]),
    });
    await staleDismissal;

    expect(controller.phase).toEqual({ type: "idle" });
    expect(submit).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();

    await controller.dismissCurrent("event-2");
    expect(acknowledge).toHaveBeenCalledExactlyOnceWith("event-2", "ticket-1");
  });

  it("does not report or acknowledge when submit rejects after the event changes", async () => {
    const { acknowledge, controller, gameState, report, submit } = setup();
    const submission = deferred<ThumbnailActivityView>();
    submit.mockReturnValueOnce(submission.promise);

    const staleDismissal = controller.dismissCurrent("event-1");
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    gameState.value = state(acquisition("event-2"));
    submission.reject(new Error("late submit failure"));
    await staleDismissal;

    expect(controller.phase).toEqual({ type: "idle" });
    expect(report).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();

    await controller.dismissCurrent("event-2");
    expect(acknowledge).toHaveBeenCalledExactlyOnceWith("event-2", "ticket-1");
  });

  it("rechecks ownership after a terminal capture report", async () => {
    const { acknowledge, capture, controller, gameState, report } = setup();
    const reporting = deferred<ThumbnailActivityView>();
    capture.mockResolvedValueOnce({
      type: "unavailable",
      reason: "capture unavailable",
    });
    report.mockReturnValueOnce(reporting.promise);

    const staleDismissal = controller.dismissCurrent("event-1");
    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    gameState.value = state(acquisition("event-2"));
    reporting.resolve({ type: "idle" });
    await staleDismissal;

    expect(controller.phase).toEqual({ type: "idle" });
    expect(acknowledge).not.toHaveBeenCalled();

    await controller.dismissCurrent("event-2");
    expect(acknowledge).toHaveBeenCalledExactlyOnceWith("event-2", "ticket-1");
  });

  it("does not commit a stale acknowledgement response over the next event", async () => {
    const { acknowledge, controller, gameState } = setup();
    const acknowledgement = deferred<GameplayCommandResultView>();
    acknowledge.mockReturnValueOnce(acknowledgement.promise);

    const staleDismissal = controller.dismissCurrent("event-1");
    await vi.waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1));
    gameState.value = state(acquisition("event-2"));
    acknowledgement.resolve({
      state: state(null),
      thumbnailCapture: null,
    });
    await staleDismissal;

    expect(gameState.value?.pendingAcquisition?.id).toBe("event-2");
    expect(controller.phase).toEqual({ type: "idle" });

    await controller.dismissCurrent("event-2");
    expect(acknowledge).toHaveBeenLastCalledWith("event-2", "ticket-1");
    expect(acknowledge).toHaveBeenCalledTimes(2);
  });

  it("clear invalidates same-ID work and an old finally cannot cancel the new attempt", async () => {
    const { acknowledge, capture, controller, prepare, submit } = setup();
    const oldPreparation = deferred<ThumbnailCaptureRequestView>();
    const newAcknowledgement = deferred<GameplayCommandResultView>();
    prepare.mockReturnValueOnce(oldPreparation.promise);
    acknowledge.mockReturnValueOnce(newAcknowledgement.promise);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const oldDismissal = controller.dismissCurrent("event-1");
    controller.clear();
    const newDismissal = controller.dismissCurrent("event-1");
    await vi.waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1));

    oldPreparation.resolve({ ticket: "ticket-old", timeoutMs: 725 });
    await oldDismissal;
    await vi.advanceTimersByTimeAsync(2_000);

    expect(controller.phase).toEqual({ type: "saving", slow: true });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenCalledExactlyOnceWith("event-1", "ticket-1");

    newAcknowledgement.resolve({
      state: state(null),
      thumbnailCapture: null,
    });
    await newDismissal;
  });
});
