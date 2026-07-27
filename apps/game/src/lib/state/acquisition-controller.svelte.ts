import { tick } from "svelte";
import {
  acknowledgeAcquisitionEvent,
  asGameError,
  confirmAcquisitionWithoutSaving,
  prepareSaveThumbnail,
  reportSaveThumbnailFailure,
  submitSaveThumbnail,
} from "$lib/persistence/commands";
import {
  gameplayThumbnailCapture,
  pinThumbnailCaptureDeadline,
} from "$lib/persistence/thumbnail-capture";
import type {
  AcquisitionAcknowledgementPhase,
  GameplayCommandResultView,
  GameplayThumbnailCapture,
  PersistenceFailureTokenView,
  ThumbnailActivityView,
  ThumbnailCapturePurposeView,
  ThumbnailCaptureRequestView,
} from "$lib/persistence/types";
import type { GameStateView, PendingAcquisitionView } from "./types";
import { gameState } from "./game-client.svelte";

type AcquisitionControllerDependencies = {
  gameState: { value: GameStateView | null };
  prepare: (
    purpose: Extract<
      ThumbnailCapturePurposeView,
      { type: "acquisitionAcknowledgement" }
    >,
  ) => Promise<ThumbnailCaptureRequestView>;
  capture: GameplayThumbnailCapture;
  pinDeadline: (
    request: ThumbnailCaptureRequestView,
  ) => ThumbnailCaptureRequestView;
  submit: (ticket: string, bytes: Uint8Array) => Promise<ThumbnailActivityView>;
  report: (ticket: string) => Promise<ThumbnailActivityView>;
  acknowledge: (
    eventId: string,
    preparedThumbnailTicket: string,
  ) => Promise<GameplayCommandResultView>;
  confirmWithoutSaving: (
    eventId: string,
    failureToken: PersistenceFailureTokenView,
  ) => Promise<GameplayCommandResultView>;
};

export type AcquisitionController = {
  readonly current: PendingAcquisitionView | null;
  readonly blocking: boolean;
  readonly size: number;
  readonly phase: AcquisitionAcknowledgementPhase;
  dismissCurrent: (expectedEventId: string) => Promise<void>;
  retry: (expectedEventId: string) => Promise<void>;
  cancel: (expectedEventId: string) => void;
  continueWithoutSaving: (
    expectedEventId: string,
    failureToken: PersistenceFailureTokenView,
  ) => Promise<void>;
  clear: () => void;
};

const slowAcknowledgementMs = 2_000;

export function createAcquisitionController(
  dependencies: AcquisitionControllerDependencies,
): AcquisitionController {
  let phase = $state<AcquisitionAcknowledgementPhase>({ type: "idle" });
  let expectedEventId: string | null = null;
  let slowTimer: ReturnType<typeof setTimeout> | null = null;
  let slowWarningElapsed = false;

  function current(): PendingAcquisitionView | null {
    return dependencies.gameState.value?.pendingAcquisition ?? null;
  }

  function clearSlowTimer(): void {
    if (slowTimer !== null) {
      clearTimeout(slowTimer);
      slowTimer = null;
    }
  }

  function startSlowTimer(eventId: string): void {
    clearSlowTimer();
    slowWarningElapsed = false;
    slowTimer = setTimeout(() => {
      slowTimer = null;
      if (
        expectedEventId !== eventId ||
        !["preparing", "capturing", "saving"].includes(phase.type)
      ) {
        return;
      }
      slowWarningElapsed = true;
      phase = { type: "saving", slow: true };
      console.warn(
        "[Persistence] Acquisition acknowledgement is still saving.",
      );
    }, slowAcknowledgementMs);
  }

  function stillCurrent(eventId: string): boolean {
    return (
      expectedEventId === eventId &&
      dependencies.gameState.value?.pendingAcquisition?.id === eventId
    );
  }

  function setActivePhase(type: "preparing" | "capturing" | "saving"): void {
    phase =
      slowWarningElapsed || type === "saving"
        ? { type: "saving", slow: slowWarningElapsed }
        : { type };
  }

  async function reportCaptureFailure(ticket: string): Promise<void> {
    try {
      await dependencies.report(ticket);
    } catch (error) {
      console.warn(
        "[Persistence] Acquisition thumbnail failure report failed",
        error,
      );
    }
  }

  async function capturePreparedThumbnail(
    request: ThumbnailCaptureRequestView,
    eventId: string,
  ): Promise<void> {
    dependencies.pinDeadline(request);
    setActivePhase("capturing");
    await tick();
    if (!stillCurrent(eventId)) return;

    try {
      const capture = await dependencies.capture.capture(request);
      if (!stillCurrent(eventId)) return;
      if (capture.type === "available") {
        try {
          await dependencies.submit(request.ticket, capture.bytes);
        } catch {
          await reportCaptureFailure(request.ticket);
        }
      } else {
        await reportCaptureFailure(request.ticket);
      }
    } catch {
      if (stillCurrent(eventId)) {
        await reportCaptureFailure(request.ticket);
      }
    }
  }

  function commitResult(
    result: GameplayCommandResultView,
    eventId: string,
  ): void {
    dependencies.gameState.value = result.state;
    if (result.state.pendingAcquisition?.id !== eventId) {
      phase = { type: "idle" };
      expectedEventId = null;
    }
  }

  function fail(error: unknown, eventId: string): void {
    const diagnostic = asGameError(error);
    if (!stillCurrent(eventId)) {
      phase = { type: "idle" };
      expectedEventId = null;
      return;
    }
    phase = {
      type: "failed",
      diagnostic,
      failureToken: diagnostic.failureToken ?? null,
    };
  }

  async function acknowledge(eventId: string): Promise<void> {
    if (current()?.id !== eventId || phase.type !== "idle") return;
    expectedEventId = eventId;
    setActivePhase("preparing");
    startSlowTimer(eventId);
    try {
      const request = await dependencies.prepare({
        type: "acquisitionAcknowledgement",
        eventId,
      });
      if (!stillCurrent(eventId)) return;
      await capturePreparedThumbnail(request, eventId);
      if (!stillCurrent(eventId)) return;
      setActivePhase("saving");
      const result = await dependencies.acknowledge(eventId, request.ticket);
      if (!stillCurrent(eventId)) return;
      commitResult(result, eventId);
    } catch (error) {
      fail(error, eventId);
    } finally {
      clearSlowTimer();
    }
  }

  return {
    get current() {
      return current();
    },
    get blocking() {
      return current() !== null;
    },
    get size() {
      return current() ? 1 : 0;
    },
    get phase() {
      return phase;
    },
    dismissCurrent(expectedEventId) {
      return acknowledge(expectedEventId);
    },
    async retry(eventId) {
      if (
        current()?.id !== eventId ||
        expectedEventId !== eventId ||
        phase.type !== "failed"
      ) {
        return;
      }
      phase = { type: "idle" };
      await acknowledge(eventId);
    },
    cancel(eventId) {
      if (
        current()?.id !== eventId ||
        expectedEventId !== eventId ||
        phase.type !== "failed"
      ) {
        return;
      }
      clearSlowTimer();
      expectedEventId = null;
      slowWarningElapsed = false;
      phase = { type: "idle" };
    },
    async continueWithoutSaving(eventId, failureToken) {
      if (
        current()?.id !== eventId ||
        expectedEventId !== eventId ||
        phase.type !== "failed" ||
        phase.failureToken !== failureToken
      ) {
        return;
      }
      phase = { type: "saving", slow: false };
      startSlowTimer(eventId);
      try {
        const result = await dependencies.confirmWithoutSaving(
          eventId,
          failureToken,
        );
        if (!stillCurrent(eventId)) return;
        commitResult(result, eventId);
      } catch (error) {
        fail(error, eventId);
      } finally {
        clearSlowTimer();
      }
    },
    clear() {
      clearSlowTimer();
      expectedEventId = null;
      slowWarningElapsed = false;
      phase = { type: "idle" };
    },
  };
}

export const acquisitionController = createAcquisitionController({
  gameState,
  prepare: prepareSaveThumbnail,
  capture: gameplayThumbnailCapture,
  pinDeadline: pinThumbnailCaptureDeadline,
  submit: submitSaveThumbnail,
  report: reportSaveThumbnailFailure,
  acknowledge: acknowledgeAcquisitionEvent,
  confirmWithoutSaving: confirmAcquisitionWithoutSaving,
});
