import { invoke } from "@tauri-apps/api/core";
import { tick } from "svelte";
import { playGameplaySfxEvent } from "$lib/audio/gameplay-audio-runtime.svelte";
import {
  inferGameplaySfxEvents,
  type GameplayCommandName,
} from "$lib/audio/sfx-events";
import {
  asGameError,
  invokePersistenceCommand,
  reportSaveThumbnailFailure,
  submitSaveThumbnail,
} from "$lib/persistence/commands";
import {
  gameplayThumbnailCapture,
  pinThumbnailCaptureDeadline,
} from "$lib/persistence/thumbnail-capture";
import type {
  AcquisitionAcknowledgementPhase,
  ExitStatusView,
  GameplayCommandResultView,
  PersistenceFailureTokenView,
  SaveBrowserOpenResultView,
  SaveSlotRef,
} from "$lib/persistence/types";
import type {
  GameError,
  GameStateView,
  QueueToken,
  SceneNavigationIndex,
} from "./types";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const DEV_HTTP_BASE = "http://127.0.0.1:1421";

/**
 * Gameplay commands whose backend response is wrapped in
 * {@link GameplayCommandResultView} (state + thumbnail capture request).
 * The test harness uses this to simulate the backend wrapping for raw state
 * responses, keeping the set in sync with the client's command dispatch.
 */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- constant lookup table, not reactive state
export const MUTATING_GAMEPLAY_COMMANDS: ReadonlySet<string> = new Set<
  GameplayCommandName | "jump_to_scene"
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
]);

async function httpInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!import.meta.env.DEV) {
    throw new Error(
      "Tauri runtime unavailable; HTTP fallback is disabled in production builds.",
    );
  }
  const r = await fetch(`${DEV_HTTP_BASE}/${command}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });
  const text = await r.text();
  if (!r.ok) {
    try {
      throw JSON.parse(text);
    } catch (e) {
      // If JSON.parse threw SyntaxError, fall back to raw text.
      // Otherwise re-throw the parsed error object (preserves .message for normalizeError).
      if (e instanceof SyntaxError)
        throw new Error(text || `${command} failed (${r.status})`, {
          cause: e,
        });
      throw e;
    }
  }
  return JSON.parse(text) as T;
}

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
    return isTauri
      ? await invoke<T>(command, args)
      : await httpInvoke<T>(command, args);
  } catch (e) {
    gameState.error = normalizeError(e);
    return null;
  }
}

export async function refreshGameState(context: {
  acquisitionPhase: AcquisitionAcknowledgementPhase;
  exitStatus: ExitStatusView;
}): Promise<GameStateView | null> {
  try {
    const next = await invokePersistenceCommand<GameStateView>("get_state");
    gameState.value = next;
    gameState.error = null;
    return next;
  } catch (error) {
    const diagnostic = asGameError(error);
    const acquisitionIsSaving = context.acquisitionPhase.type === "saving";
    const exitIsSaving = context.exitStatus.type === "saving";
    if (
      diagnostic.code === "persistenceOperationInProgress" &&
      (acquisitionIsSaving || exitIsSaving)
    ) {
      return gameState.value;
    }
    gameState.error = normalizeError(diagnostic);
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
    return isTauri
      ? await invoke<SceneNavigationIndex>("list_scenes")
      : await httpInvoke<SceneNavigationIndex>("list_scenes");
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
  await dispatchGameCommand("ask_interrogation_question", { questionId });
}
export async function challengeInterrogationLine(lineId: string) {
  await dispatchGameCommand("challenge_interrogation_line", { lineId });
}
export async function presentInterrogationEvidence(
  lineId: string,
  itemKind: "evidence" | "statement",
  itemId: string,
) {
  await dispatchGameCommand("present_interrogation_evidence", {
    lineId,
    itemKind,
    itemId,
  });
}
export async function withdrawInterrogation() {
  await dispatchGameCommand("withdraw_interrogation", {});
}
export async function resumeInterrogationTestimony() {
  await dispatchGameCommand("resume_interrogation_testimony", {});
}
export async function completeInterrogationPhase() {
  await dispatchGameCommand("complete_interrogation_phase", {});
}
