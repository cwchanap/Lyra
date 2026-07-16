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

// Module-level buffer for acquisition notifications deferred while an authored
// item-dialogue queue is playing. Deliberately a plain (non-$state) array: it
// is an internal implementation detail of enqueueAcquisitions/flushPendingAcquisitions,
// not something the UI binds to. Reactivity is driven by acquisitionController,
// which this buffer feeds into via enqueue() — making this $state would cause
// spurious reactivity with no consumer.
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

// Detect that an advance_dialogue command exhausted the previous dialogue
// queue (and possibly installed a new one), by checking the returned
// mode/queue transition — NOT previous.queueRemaining. The queueRemaining
// heuristic is unsound for two reasons:
//  1. Rust advance_dialogue returns the UNCHANGED view for a stale
//     QueueToken (mod.rs: current_token != expected -> Ok(self.view())),
//     so queueRemaining === 0 on the previous frame would false-positive
//     and flush the popup while the same item is still displayed.
//  2. Queues ending in auto-skipped SceneTags have queueRemaining > 0 at
//     the last real line (the trailing tags are counted). advance_dialogue
//     skips them (consume_scene_tags_at_cursor) and on_queue_exhausted may
//     install a NEW dialogue queue (e.g. an investigation outro) with a
//     fresh queueGen — deferring the popup through that whole dialogue.
//
// alloc_queue_gen is monotonic and every queue installation calls it, so a
// queueGen or sceneId change in `next` reliably signals the previous queue
// exhausted and a new one was installed. A normal in-queue advance keeps
// the same queueGen/sceneId and only increments cursor.
function dialogueQueueExhausted(
  previous: GameStateView | null,
  next: GameStateView,
): boolean {
  if (!previous || previous.mode.type !== "dialogue") return false;
  if (next.mode.type !== "dialogue") return true;
  return (
    next.mode.queueToken.sceneId !== previous.mode.queueToken.sceneId ||
    next.mode.queueToken.queueGen !== previous.mode.queueToken.queueGen
  );
}

function enqueueAcquisitions(
  previous: GameStateView | null,
  next: GameStateView,
  command: GameplayCommandName,
) {
  try {
    // Flush any pending acquisition notifications BEFORE inferring new ones
    // whenever a command leaves dialogue. This ordering matters: the same
    // command that empties the queue (or otherwise exits dialogue) may also
    // produce new notifications (e.g. an on_collect dialogue queues more
    // items, or an interrogation resolution both exits dialogue and acquires),
    // and we want the previously-buffered popups to surface first so the
    // player sees acquisitions in the order they were earned, not interleaved
    // with — or reordered after — the new batch.
    const advancedFromDialogue =
      command === "advance_dialogue" && previous?.mode.type === "dialogue";
    const leavingDialogue =
      (advancedFromDialogue && dialogueQueueExhausted(previous, next)) ||
      (previous?.mode.type === "dialogue" && next.mode.type !== "dialogue");
    if (leavingDialogue) {
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

// Silently DISCARDS (does not flush) any acquisition notifications buffered
// while an authored item-dialogue queue was playing. Navigation commands
// (startGame/resetGame/returnToMainMenu/jumpToScene) reset the game state to a
// different scene/mode, so previously-buffered popups no longer belong to the
// context the player is leaving — they are dropped intentionally, not surfaced.
// Contrast flushPendingAcquisitions, which drains the same buffer into
// acquisitionController so the popups are shown.
function clearPendingAcquisitions() {
  pendingAcquisitionNotifications = [];
}

// Test-only: drains the module-level pending buffer so tests don't leak
// buffered acquisition notifications across cases. Mirrors the
// __resetStoryClearanceWarningLatches pattern in story-clearance.ts.
export function __clearPendingAcquisitionsForTest(): void {
  pendingAcquisitionNotifications = [];
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
      result = v;
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
  if (gameState.inFlight) return;
  // Clear buffered acquisition popups and the controller only after the
  // navigation command succeeds (see jumpToScene). If start_game fails, the
  // player remains in the previous state and both the pending buffer and any
  // visible popup must survive so they surface when the current dialogue
  // exhausts. dispatchGameCommand calls enqueueAcquisitions, which may flush
  // the pending buffer into the controller if the previous state was dialogue
  // — the post-success acquisitionController.clear() wipes those too, so no
  // old popups leak into the new state.
  const v = await dispatchGameCommand("start_game", undefined, true);
  if (v) {
    clearPendingAcquisitions();
    acquisitionController.clear();
  }
}

export async function resetGame() {
  if (gameState.inFlight) return;
  // Same post-success clear pattern as startGame/jumpToScene: on failure the
  // player remains in the previous state and both the pending buffer and any
  // visible popup must survive.
  const v = await dispatchGameCommand("reset_game", undefined, true);
  if (v) {
    clearPendingAcquisitions();
    acquisitionController.clear();
  }
}

export function returnToMainMenu() {
  if (gameState.inFlight) return;
  // Navigation resets context: drop buffered acquisition popups (see
  // clearPendingAcquisitions) rather than surfacing them in the new state.
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
  if (gameState.inFlight) return;
  // Clear buffered acquisition popups only after the jump succeeds. If the
  // jump fails, gameState.value is unchanged (the player remains in the
  // previous dialogue) and the buffered popups must survive so they surface
  // when the current dialogue exhausts. dispatchStateCommand does not call
  // enqueueAcquisitions, so there are no new notifications to preserve on
  // success — clearing after the dispatch is safe.
  const v = await dispatchStateCommand(
    "jump_to_scene",
    { chapterId, sceneId },
    true,
  );
  if (v) {
    clearPendingAcquisitions();
    acquisitionController.clear();
  }
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
