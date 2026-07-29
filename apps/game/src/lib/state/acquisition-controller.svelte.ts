import { tick } from "svelte";
import {
  acknowledgeAcquisitionEvent,
  asGameError,
  cancelAcquisitionFailure,
  confirmAcquisitionWithoutSaving,
  prepareSaveThumbnail,
  reportSaveThumbnailFailure,
  retryAcquisitionAcknowledgement,
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
  retryAcknowledge: (
    eventId: string,
    failureToken: PersistenceFailureTokenView,
  ) => Promise<ThumbnailCaptureRequestView>;
  cancelFailure: (
    eventId: string,
    failureToken: PersistenceFailureTokenView,
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
  cancel: (expectedEventId: string) => Promise<void>;
  continueWithoutSaving: (
    expectedEventId: string,
    failureToken: PersistenceFailureTokenView,
  ) => Promise<void>;
  clear: () => void;
};

const slowAcknowledgementMs = 2_000;

type AcquisitionAttempt = {
  generation: number;
  eventId: string;
  slowTimer: ReturnType<typeof setTimeout> | null;
  slowWarningElapsed: boolean;
};

export function createAcquisitionController(
  dependencies: AcquisitionControllerDependencies,
): AcquisitionController {
  let phase = $state<AcquisitionAcknowledgementPhase>({ type: "idle" });
  let generation = 0;
  let activeAttempt: AcquisitionAttempt | null = null;

  function current(): PendingAcquisitionView | null {
    return dependencies.gameState.value?.pendingAcquisition ?? null;
  }

  function owns(attempt: AcquisitionAttempt): boolean {
    return activeAttempt === attempt && attempt.generation === generation;
  }

  function clearAttemptTimer(attempt: AcquisitionAttempt): void {
    if (attempt.slowTimer !== null) {
      clearTimeout(attempt.slowTimer);
      attempt.slowTimer = null;
    }
  }

  function releaseAttempt(attempt: AcquisitionAttempt): void {
    if (!owns(attempt)) return;
    clearAttemptTimer(attempt);
    activeAttempt = null;
    generation += 1;
    phase = { type: "idle" };
  }

  function ownsCurrent(attempt: AcquisitionAttempt): boolean {
    if (
      owns(attempt) &&
      dependencies.gameState.value?.pendingAcquisition?.id === attempt.eventId
    ) {
      return true;
    }
    releaseAttempt(attempt);
    return false;
  }

  function startSlowTimer(attempt: AcquisitionAttempt): void {
    clearAttemptTimer(attempt);
    attempt.slowWarningElapsed = false;
    attempt.slowTimer = setTimeout(() => {
      attempt.slowTimer = null;
      if (!ownsCurrent(attempt)) return;
      if (!["preparing", "capturing", "saving"].includes(phase.type)) return;
      attempt.slowWarningElapsed = true;
      phase = { type: "saving", slow: true };
      console.warn(
        "[Persistence] Acquisition acknowledgement is still saving.",
      );
    }, slowAcknowledgementMs);
  }

  function setActivePhase(
    attempt: AcquisitionAttempt,
    type: "preparing" | "capturing" | "saving",
  ): void {
    if (!owns(attempt)) return;
    phase =
      attempt.slowWarningElapsed || type === "saving"
        ? { type: "saving", slow: attempt.slowWarningElapsed }
        : { type };
  }

  function beginAttempt(
    eventId: string,
    initialPhase: "preparing" | "saving",
  ): AcquisitionAttempt | null {
    if (current()?.id !== eventId) return null;
    if (activeAttempt && activeAttempt.eventId !== eventId) {
      releaseAttempt(activeAttempt);
    }
    if (activeAttempt || phase.type !== "idle") return null;
    generation += 1;
    const attempt: AcquisitionAttempt = {
      generation,
      eventId,
      slowTimer: null,
      slowWarningElapsed: false,
    };
    activeAttempt = attempt;
    setActivePhase(attempt, initialPhase);
    startSlowTimer(attempt);
    return attempt;
  }

  async function reportCaptureFailure(
    attempt: AcquisitionAttempt,
    ticket: string,
  ): Promise<boolean> {
    if (!ownsCurrent(attempt)) return false;
    try {
      await dependencies.report(ticket);
    } catch (error) {
      if (!ownsCurrent(attempt)) return false;
      console.warn(
        "[Persistence] Acquisition thumbnail failure report failed",
        error,
      );
    }
    return ownsCurrent(attempt);
  }

  async function capturePreparedThumbnail(
    request: ThumbnailCaptureRequestView,
    attempt: AcquisitionAttempt,
  ): Promise<boolean> {
    dependencies.pinDeadline(request);
    setActivePhase(attempt, "capturing");
    await tick();
    if (!ownsCurrent(attempt)) return false;

    let capture;
    try {
      capture = await dependencies.capture.capture(request);
    } catch {
      if (!ownsCurrent(attempt)) return false;
      return reportCaptureFailure(attempt, request.ticket);
    }
    if (!ownsCurrent(attempt)) return false;

    if (capture.type === "unavailable") {
      return reportCaptureFailure(attempt, request.ticket);
    }

    try {
      await dependencies.submit(request.ticket, capture.bytes);
    } catch {
      if (!ownsCurrent(attempt)) return false;
      return reportCaptureFailure(attempt, request.ticket);
    }
    return ownsCurrent(attempt);
  }

  function commitResult(
    result: GameplayCommandResultView,
    attempt: AcquisitionAttempt,
  ): void {
    if (!ownsCurrent(attempt)) return;
    dependencies.gameState.value = result.state;
    if (result.state.pendingAcquisition?.id !== attempt.eventId) {
      releaseAttempt(attempt);
    }
  }

  function fail(error: unknown, attempt: AcquisitionAttempt): void {
    if (!ownsCurrent(attempt)) return;
    const diagnostic = asGameError(error);
    phase = {
      type: "failed",
      diagnostic,
      failureToken: diagnostic.failureToken ?? null,
    };
  }

  async function acknowledge(eventId: string): Promise<void> {
    const attempt = beginAttempt(eventId, "preparing");
    if (!attempt) return;
    try {
      const request = await dependencies.prepare({
        type: "acquisitionAcknowledgement",
        eventId,
      });
      if (!ownsCurrent(attempt)) return;
      if (!(await capturePreparedThumbnail(request, attempt))) return;
      if (!ownsCurrent(attempt)) return;
      setActivePhase(attempt, "saving");
      const result = await dependencies.acknowledge(eventId, request.ticket);
      if (!ownsCurrent(attempt)) return;
      commitResult(result, attempt);
    } catch (error) {
      fail(error, attempt);
    } finally {
      if (owns(attempt)) clearAttemptTimer(attempt);
    }
  }

  async function retryAcknowledge(
    eventId: string,
    failureToken: PersistenceFailureTokenView,
  ): Promise<void> {
    const attempt = beginAttempt(eventId, "preparing");
    if (!attempt) return;
    try {
      const request = await dependencies.retryAcknowledge(
        eventId,
        failureToken,
      );
      if (!ownsCurrent(attempt)) return;
      if (!(await capturePreparedThumbnail(request, attempt))) return;
      if (!ownsCurrent(attempt)) return;
      setActivePhase(attempt, "saving");
      const result = await dependencies.acknowledge(eventId, request.ticket);
      if (!ownsCurrent(attempt)) return;
      commitResult(result, attempt);
    } catch (error) {
      fail(error, attempt);
    } finally {
      if (owns(attempt)) clearAttemptTimer(attempt);
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
      if (activeAttempt && current()?.id !== activeAttempt.eventId) {
        return { type: "idle" } as const;
      }
      return phase;
    },
    dismissCurrent(expectedEventId) {
      return acknowledge(expectedEventId);
    },
    async retry(eventId) {
      if (
        current()?.id !== eventId ||
        activeAttempt?.eventId !== eventId ||
        phase.type !== "failed"
      ) {
        return;
      }
      const failureToken = phase.failureToken;
      if (!failureToken) return;
      releaseAttempt(activeAttempt);
      await retryAcknowledge(eventId, failureToken);
    },
    async cancel(eventId) {
      if (
        current()?.id !== eventId ||
        activeAttempt?.eventId !== eventId ||
        phase.type !== "failed"
      ) {
        return;
      }
      const failureToken = phase.failureToken;
      const attempt = activeAttempt;
      if (!failureToken || !attempt) {
        releaseAttempt(attempt);
        return;
      }
      // Keep the attempt owned and disable further actions while the
      // cancellation command is in flight. Releasing before the await would
      // flip the phase to idle, exposing an enabled Continue button and
      // allowing a concurrent acknowledgement whose result a late cancel
      // response could then overwrite.
      phase = { type: "cancelling" };
      try {
        const result = await dependencies.cancelFailure(eventId, failureToken);
        if (!ownsCurrent(attempt)) return;
        dependencies.gameState.value = result.state;
        releaseAttempt(attempt);
      } catch (error) {
        if (!ownsCurrent(attempt)) return;
        // Restore the visible failed phase so the user can retry, cancel, or
        // continue without saving. Preserve the original failure token so the
        // bypass actions remain available even if the cancel error itself
        // carries no token.
        const diagnostic = asGameError(error);
        phase = {
          type: "failed",
          diagnostic,
          failureToken,
        };
      } finally {
        if (owns(attempt)) clearAttemptTimer(attempt);
      }
    },
    async continueWithoutSaving(eventId, failureToken) {
      if (
        current()?.id !== eventId ||
        activeAttempt?.eventId !== eventId ||
        phase.type !== "failed" ||
        phase.failureToken !== failureToken
      ) {
        return;
      }
      releaseAttempt(activeAttempt);
      const attempt = beginAttempt(eventId, "saving");
      if (!attempt) return;
      try {
        const result = await dependencies.confirmWithoutSaving(
          eventId,
          failureToken,
        );
        if (!ownsCurrent(attempt)) return;
        commitResult(result, attempt);
      } catch (error) {
        fail(error, attempt);
      } finally {
        if (owns(attempt)) clearAttemptTimer(attempt);
      }
    },
    clear() {
      generation += 1;
      if (activeAttempt) clearAttemptTimer(activeAttempt);
      activeAttempt = null;
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
  retryAcknowledge: retryAcquisitionAcknowledgement,
  cancelFailure: cancelAcquisitionFailure,
  confirmWithoutSaving: confirmAcquisitionWithoutSaving,
});
