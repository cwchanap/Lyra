import { invoke } from "@tauri-apps/api/core";
import { playGameplaySfxEvent } from "$lib/audio/gameplay-audio-runtime.svelte";
import {
  inferGameplaySfxEvents,
  type GameplayCommandName,
} from "$lib/audio/sfx-events";
import { acquisitionController } from "./acquisition-controller.svelte";
import { inferAcquisitionNotifications } from "./acquisition-notifications";
import type { AcquisitionNotification } from "./acquisition-notifications";
import type {
  GameError,
  GameStateView,
  QueueToken,
  SceneNavigationIndex,
} from "./types";

let pendingAcquisitionNotifications: AcquisitionNotification[] = [];

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const DEV_HTTP_BASE = "http://127.0.0.1:1421";

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

function enqueueAcquisitions(
  previous: GameStateView | null,
  next: GameStateView,
  command: GameplayCommandName,
) {
  try {
    const finishedDialogue =
      command === "advance_dialogue" &&
      previous?.mode.type === "dialogue" &&
      previous.mode.queueRemaining === 0;
    if (finishedDialogue) {
      flushPendingAcquisitions();
    }

    const notifications = inferAcquisitionNotifications(previous, next);
    if (notifications.length > 0) {
      // Rust adds an item's authored on_collect/on_acquire dialogue to the
      // same queue that is returned with the inventory update. Keep the
      // notification pending while that queue is visible so the popup comes
      // after the player finishes the authored item dialogue.
      if (next.mode.type === "dialogue") {
        pendingAcquisitionNotifications.push(...notifications);
      } else {
        acquisitionController.enqueue(notifications);
      }
    }

    if (next.mode.type !== "dialogue") flushPendingAcquisitions();
  } catch (error) {
    console.warn(`[AcquisitionPopup] inference failed for ${command}`, error);
  }
}

function flushPendingAcquisitions() {
  if (pendingAcquisitionNotifications.length === 0) return;
  const pending = pendingAcquisitionNotifications;
  acquisitionController.enqueue(pending);
  pendingAcquisitionNotifications = [];
}

function clearPendingAcquisitions() {
  pendingAcquisitionNotifications = [];
}

async function dispatchGameCommand(
  command: GameplayCommandName,
  args?: Record<string, unknown>,
  loading = false,
) {
  if (gameState.inFlight) return;
  gameState.inFlight = true;
  if (loading) gameState.loading = true;
  try {
    const previous = gameState.value;
    const v = await runCommand<GameStateView>(command, args);
    if (v) {
      gameState.value = v;
      enqueueAcquisitions(previous, v, command);
      // Audio is a non-essential side effect of a successful game-state update:
      // the new state is already committed. An unexpected throw from SFX
      // inference/playback must not propagate to the caller and break the game
      // flow, so isolate it from the dispatch path.
      //
      // Inference and playback are isolated separately: inference is pure logic
      // over the Rust GameStateView, so a throw there signals a contract bug
      // (e.g. a field shape changed on the Rust side — note inferGameplaySfxEvents
      // reads next.inventory.evidence.length with only `state?` guarded, not
      // `inventory`). Absorbing inference into the same catch as playback would
      // hide that drift behind a generic playback warning that is effectively
      // invisible in a packaged WKWebView build. Log inference failures
      // distinctly with the command so the drift is diagnosable.
      let events: ReturnType<typeof inferGameplaySfxEvents>;
      try {
        events = inferGameplaySfxEvents(previous, v, command);
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
    }
  } finally {
    if (loading) gameState.loading = false;
    gameState.inFlight = false;
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
    const v = await runCommand<GameStateView>(command, args);
    if (v) {
      gameState.value = v;
    }
    return v;
  } finally {
    if (loading) gameState.loading = false;
    gameState.inFlight = false;
  }
}

export async function startGame() {
  clearPendingAcquisitions();
  acquisitionController.clear();
  await dispatchGameCommand("start_game", undefined, true);
}

export async function resetGame() {
  clearPendingAcquisitions();
  acquisitionController.clear();
  await dispatchGameCommand("reset_game", undefined, true);
}

export function returnToMainMenu() {
  if (gameState.inFlight) return;
  clearPendingAcquisitions();
  acquisitionController.clear();
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
  clearPendingAcquisitions();
  acquisitionController.clear();
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
