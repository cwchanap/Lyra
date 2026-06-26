import { invoke } from "@tauri-apps/api/core";
import { playGameplaySfxEvent } from "$lib/audio/gameplay-audio-runtime.svelte";
import {
  inferGameplaySfxEvents,
  type GameplayCommandName,
} from "$lib/audio/sfx-events";
import type { GameError, GameStateView, QueueToken } from "./types";

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

export async function startGame() {
  await dispatchGameCommand("start_game", undefined, true);
}

export async function resetGame() {
  await dispatchGameCommand("reset_game", undefined, true);
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
export async function answerInterrogationQuestion(questionId: string) {
  await dispatchGameCommand("answer_interrogation_question", { questionId });
}
export async function pressTestimonyStatement(statementId: string) {
  await dispatchGameCommand("press_testimony_statement", { statementId });
}
export async function presentTestimonyItem(
  statementId: string,
  itemKind: "evidence" | "statement",
  itemId: string,
) {
  await dispatchGameCommand("present_testimony_item", {
    statementId,
    itemKind,
    itemId,
  });
}
