import { invoke } from "@tauri-apps/api/core";
import { tick } from "svelte";
import { playGameplaySfxEvent } from "$lib/audio/gameplay-audio-runtime.svelte";
import {
  inferGameplaySfxEvents,
  type GameplayCommandName,
} from "$lib/audio/sfx-events";
import {
  invokePersistenceCommand,
  reportSaveThumbnailFailure,
  submitSaveThumbnail,
} from "$lib/persistence/commands";
import {
  gameplayThumbnailCapture,
  pinThumbnailCaptureDeadline,
} from "$lib/persistence/thumbnail-capture";
import {
  coordinateE2eCheckpointLoad,
  type E2eCheckpointId,
  type E2eCheckpointProjection,
  type E2eLoadCheckpointResult,
} from "$lib/e2e/checkpoints";
import type {
  GameplayCommandResultView,
  PersistenceFailureTokenView,
  SaveBrowserOpenResultView,
  SaveSlotRef,
} from "$lib/persistence/types";
import type {
  GameError,
  GameStateView,
  AnalysisActionToken,
  AnalysisDraft,
  QueueToken,
  SceneNavigationIndex,
} from "./types";

/**
 * Gameplay commands whose backend response is wrapped in
 * {@link GameplayCommandResultView} (state + thumbnail capture request).
 * The test harness uses this to simulate the backend wrapping for raw state
 * responses, keeping the set in sync with the client's command dispatch.
 */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- constant lookup table, not reactive state
export const MUTATING_GAMEPLAY_COMMANDS: ReadonlySet<string> = new Set<
  GameplayCommandName | "jump_to_scene" | "acknowledge_acquisition_event"
>([
  "start_game",
  "reset_game",
  "jump_to_scene",
  "advance_dialogue",
  "inspect_hotspot",
  "interview_topic",
  "enter_sublocation",
  "reexamine_evidence",
  "reexamine_statement",
  "ask_interrogation_question",
  "challenge_interrogation_line",
  "present_interrogation_evidence",
  "withdraw_interrogation",
  "resume_interrogation_testimony",
  "complete_interrogation_phase",
  "select_analysis_board",
  "update_analysis_draft",
  "submit_analysis_board",
  "acknowledge_acquisition_event",
]);

export const gameState = $state<{
  value: GameStateView | null;
  error: string | null;
  loading: boolean;
  inFlight: boolean;
}>({
  value: null,
  error: null,
  loading: false,
  inFlight: false,
});

export const presentationState = $state({ sessionEpoch: 0 });

function normalizeError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as Partial<GameError>).message;
    if (typeof message === "string") return message;
  }
  if (typeof error === "string") return error;
  return "Game command failed.";
}

async function runCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  gameState.error = null;
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    gameState.error = normalizeError(e);
    return null;
  }
}

async function finishThumbnailCapture(
  result: GameplayCommandResultView,
  committedIdentity: GameStateView,
): Promise<void> {
  const request = result.thumbnailCapture;
  if (!request) return;
  await tick();
  if (gameState.value !== committedIdentity) return;

  let captureResult;
  try {
    captureResult = await gameplayThumbnailCapture.capture(request);
  } catch (error) {
    console.warn("[Persistence] Thumbnail capture failed", error);
    if (gameState.value !== committedIdentity) return;
    try {
      await reportSaveThumbnailFailure(request.ticket);
    } catch (reportError) {
      console.warn(
        "[Persistence] Thumbnail failure report failed",
        reportError,
      );
    }
    return;
  }

  if (gameState.value !== committedIdentity) return;
  try {
    if (captureResult.type === "available") {
      await submitSaveThumbnail(request.ticket, captureResult.bytes);
    } else {
      await reportSaveThumbnailFailure(request.ticket);
    }
  } catch (error) {
    console.warn("[Persistence] Thumbnail submission failed", error);
  }
}

async function applyGameplayCommandResult(
  result: GameplayCommandResultView,
  onApplied?: (state: GameStateView) => void,
): Promise<GameStateView> {
  const request = result.thumbnailCapture;
  if (request) pinThumbnailCaptureDeadline(request);
  gameState.value = result.state;
  const committedIdentity = gameState.value;
  onApplied?.(result.state);
  await tick();
  // Thumbnail capture/submission is detached so the inFlight guard can be
  // released after the committed state and frame synchronization complete.
  // The committedIdentity check inside finishThumbnailCapture prevents stale
  // captures from affecting later state.
  void finishThumbnailCapture(
    { ...result, thumbnailCapture: request },
    committedIdentity,
  ).catch((error) => {
    console.warn("[Persistence] Detached thumbnail capture failed", error);
  });
  return result.state;
}

export async function loadE2eCheckpointThroughClient(
  id: E2eCheckpointId,
  previousGeneration: number,
  hooks: {
    applyProjection: (projection: E2eCheckpointProjection) => void;
    publishGeneration: (generation: number) => void;
  },
): Promise<E2eLoadCheckpointResult> {
  if (!import.meta.env.VITE_E2E) {
    throw new Error("Packaged checkpoints are unavailable in this build.");
  }
  if (gameState.inFlight) {
    throw new Error("A game command is already in progress.");
  }

  gameState.inFlight = true;
  gameState.loading = true;
  try {
    return await coordinateE2eCheckpointLoad(id, previousGeneration, {
      load: (selectedId) =>
        invoke<E2eLoadCheckpointResult>("e2e_load_checkpoint", {
          id: selectedId,
        }),
      applyState: async (state) => {
        presentationState.sessionEpoch += 1;
        gameState.error = null;
        await applyGameplayCommandResult({
          state,
          thumbnailCapture: null,
        });
      },
      applyProjection: hooks.applyProjection,
      settleProjection: tick,
      publishGeneration: hooks.publishGeneration,
    });
  } catch (error) {
    gameState.error = normalizeError(error);
    throw error;
  } finally {
    gameState.loading = false;
    gameState.inFlight = false;
  }
}

async function dispatchGameCommand(
  command: GameplayCommandName,
  args?: Record<string, unknown>,
  loading = false,
): Promise<GameStateView | null> {
  if (gameState.inFlight) return null;
  gameState.inFlight = true;
  if (loading) gameState.loading = true;
  let result: GameStateView | null = null;
  try {
    const previous = gameState.value;
    const v = await runCommand<GameplayCommandResultView>(command, args);
    if (v) {
      result = await applyGameplayCommandResult(v, (next) => {
        // Audio is a non-essential side effect of a successful game-state update:
        // the new state is already committed. An unexpected throw from SFX
        // inference/playback must not propagate to the caller and break the game
        // flow, so isolate it from the dispatch path.
        let events: ReturnType<typeof inferGameplaySfxEvents>;
        try {
          events = inferGameplaySfxEvents(previous, next, command);
        } catch (inferenceError) {
          console.warn(
            `[GameplayAudio] SFX inference failed for ${command}`,
            inferenceError,
          );
          events = [];
        }
        for (const event of events) {
          try {
            playGameplaySfxEvent(event);
          } catch (playbackError) {
            console.warn("[GameplayAudio] SFX playback failed", playbackError);
          }
        }
      });
    }
  } finally {
    if (loading) gameState.loading = false;
    gameState.inFlight = false;
  }
  return result;
}

async function dispatchAnalysisCommand(
  command: Extract<
    GameplayCommandName,
    "select_analysis_board" | "update_analysis_draft" | "submit_analysis_board"
  >,
  args: Record<string, unknown>,
): Promise<GameStateView | null> {
  try {
    return await dispatchGameCommand(command, args);
  } catch (error) {
    // runCommand owns backend failures, while this catches failures from the
    // remaining state-application path (for example, frame synchronization).
    // Keep both paths on the shared ErrorBanner surface.
    gameState.error = normalizeError(error);
    return null;
  }
}

async function dispatchStateCommand(
  command: string,
  args?: Record<string, unknown>,
  loading = false,
) {
  if (gameState.inFlight) return null;
  gameState.inFlight = true;
  if (loading) gameState.loading = true;
  try {
    const v = await runCommand<GameplayCommandResultView>(command, args);
    if (v) {
      return await applyGameplayCommandResult(v);
    }
    return null;
  } finally {
    if (loading) gameState.loading = false;
    gameState.inFlight = false;
  }
}

export async function startGame() {
  if (gameState.inFlight) return;
  await dispatchGameCommand("start_game", undefined, true);
}

async function dispatchPersistenceTransition(
  command: string,
  args?: Record<string, unknown>,
  resetPresentation = false,
): Promise<GameStateView> {
  if (gameState.inFlight) {
    throw {
      code: "persistenceOperationInProgress",
      message: "Persistence operation is already in progress.",
    } satisfies GameError;
  }
  gameState.inFlight = true;
  gameState.loading = true;
  try {
    const result = await invokePersistenceCommand<GameplayCommandResultView>(
      command,
      args,
    );
    if (resetPresentation) presentationState.sessionEpoch += 1;
    gameState.error = null;
    return await applyGameplayCommandResult(result);
  } finally {
    gameState.loading = false;
    gameState.inFlight = false;
  }
}

export function startPersistedGame(): Promise<GameStateView> {
  return dispatchPersistenceTransition("start_game");
}

export function startGameWithoutSaving(
  failureToken: PersistenceFailureTokenView,
): Promise<GameStateView> {
  return dispatchPersistenceTransition("start_game_without_saving", {
    failureToken,
  });
}

export function continuePersistedGame(): Promise<GameStateView> {
  return dispatchPersistenceTransition("continue_game", undefined, true);
}

export function loadPersistedGame(
  reference: SaveSlotRef,
  observedSaveId: string,
): Promise<GameStateView> {
  return dispatchPersistenceTransition(
    "load_save",
    { reference, observedSaveId },
    true,
  );
}

export function loadPersistedGameDiscardingCurrent(
  reference: SaveSlotRef,
  observedSaveId: string,
  failureToken: PersistenceFailureTokenView,
): Promise<GameStateView> {
  return dispatchPersistenceTransition(
    "load_save_discarding_current",
    { reference, observedSaveId, failureToken },
    true,
  );
}

async function dispatchReturnToTitle(
  command: "return_to_title" | "return_to_title_without_saving",
  args?: Record<string, unknown>,
): Promise<SaveBrowserOpenResultView> {
  if (gameState.inFlight) {
    throw {
      code: "persistenceOperationInProgress",
      message: "Persistence operation is already in progress.",
    } satisfies GameError;
  }
  gameState.inFlight = true;
  try {
    return await invokePersistenceCommand<SaveBrowserOpenResultView>(
      command,
      args,
    );
  } finally {
    gameState.inFlight = false;
  }
}

export function returnPersistedToTitle(): Promise<SaveBrowserOpenResultView> {
  return dispatchReturnToTitle("return_to_title");
}

export function returnPersistedToTitleWithoutSaving(
  failureToken: PersistenceFailureTokenView,
): Promise<SaveBrowserOpenResultView> {
  return dispatchReturnToTitle("return_to_title_without_saving", {
    failureToken,
  });
}

export async function settlePreparedThumbnailCapture(
  request: GameplayCommandResultView["thumbnailCapture"],
): Promise<void> {
  if (!request || !gameState.value) return;
  pinThumbnailCaptureDeadline(request);
  const committedIdentity = gameState.value;
  await finishThumbnailCapture(
    { state: committedIdentity, thumbnailCapture: request },
    committedIdentity,
  );
}

export function resetFrontendForTitle(): void {
  presentationState.sessionEpoch += 1;
  gameState.value = null;
  gameState.error = null;
  gameState.loading = false;
  gameState.inFlight = false;
}

export async function resetGame() {
  if (gameState.inFlight) return;
  await dispatchGameCommand("reset_game", undefined, true);
}

export function returnToMainMenu() {
  if (gameState.inFlight) return;
  gameState.value = null;
  gameState.error = null;
  gameState.loading = false;
}

export async function listScenes(): Promise<SceneNavigationIndex | null> {
  // Read-only scene-index query. Routed through a local try/catch (not
  // runCommand) deliberately: runCommand clears and writes gameState.error,
  // which is the shared surface for game-command failures rendered by the
  // global ErrorBanner. The SceneNavigationPanel owns its own error/retry
  // surface (sceneNavigationError), so routing a list_scenes failure through
  // gameState.error would (a) double-report the same failure via ErrorBanner
  // + panel, and (b) wipe a pre-existing game-command error on every call.
  try {
    return await invoke<SceneNavigationIndex>("list_scenes");
  } catch {
    return null;
  }
}

export async function jumpToScene(chapterId: string, sceneId: string) {
  if (gameState.inFlight) return;
  await dispatchStateCommand("jump_to_scene", { chapterId, sceneId }, true);
}

export async function advanceDialogue(expected: QueueToken) {
  await dispatchGameCommand("advance_dialogue", { expected });
}

export async function inspectHotspot(hotspotId: string) {
  await dispatchGameCommand("inspect_hotspot", { hotspotId });
}
export async function interviewTopic(characterId: string, topicId: string) {
  await dispatchGameCommand("interview_topic", { characterId, topicId });
}
export async function enterSublocation(sublocationId: string) {
  await dispatchGameCommand("enter_sublocation", { sublocationId });
}
export async function reexamineEvidence(evidenceId: string) {
  await dispatchGameCommand("reexamine_evidence", { evidenceId });
}
export async function reexamineStatement(statementId: string) {
  await dispatchGameCommand("reexamine_statement", { statementId });
}
export async function askInterrogationQuestion(questionId: string) {
  try {
    await dispatchGameCommand("ask_interrogation_question", { questionId });
  } catch (error) {
    gameState.error = normalizeError(error);
  }
}
export async function challengeInterrogationLine(lineId: string) {
  try {
    await dispatchGameCommand("challenge_interrogation_line", { lineId });
  } catch (error) {
    gameState.error = normalizeError(error);
  }
}
export async function presentInterrogationEvidence(
  lineId: string,
  itemKind: "evidence" | "statement",
  itemId: string,
) {
  try {
    await dispatchGameCommand("present_interrogation_evidence", {
      lineId,
      itemKind,
      itemId,
    });
  } catch (error) {
    gameState.error = normalizeError(error);
  }
}
export async function withdrawInterrogation() {
  try {
    await dispatchGameCommand("withdraw_interrogation", {});
  } catch (error) {
    gameState.error = normalizeError(error);
  }
}
export async function resumeInterrogationTestimony() {
  try {
    await dispatchGameCommand("resume_interrogation_testimony", {});
  } catch (error) {
    gameState.error = normalizeError(error);
  }
}
export async function completeInterrogationPhase() {
  try {
    await dispatchGameCommand("complete_interrogation_phase", {});
  } catch (error) {
    gameState.error = normalizeError(error);
  }
}
export async function selectAnalysisBoard(
  actionToken: AnalysisActionToken,
  boardId: string,
): Promise<GameStateView | null> {
  return dispatchAnalysisCommand("select_analysis_board", {
    expected: actionToken,
    boardId,
  });
}

export async function updateAnalysisDraft(
  actionToken: AnalysisActionToken,
  draft: AnalysisDraft,
): Promise<GameStateView | null> {
  return dispatchAnalysisCommand("update_analysis_draft", {
    expected: actionToken,
    draft,
  });
}

export async function submitAnalysisBoard(
  actionToken: AnalysisActionToken,
): Promise<GameStateView | null> {
  return dispatchAnalysisCommand("submit_analysis_board", {
    expected: actionToken,
  });
}

export function acknowledgeAcquisitionEvent(
  eventId: string,
): Promise<GameStateView | null> {
  return dispatchStateCommand("acknowledge_acquisition_event", { eventId });
}
