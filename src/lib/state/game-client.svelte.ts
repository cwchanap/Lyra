import { invoke } from "@tauri-apps/api/core";
import type { GameError, GameStateView, QueueToken } from "./types";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const DEV_HTTP_BASE = "http://127.0.0.1:1421";

async function httpInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!import.meta.env.DEV) {
    throw new Error("Tauri runtime unavailable; HTTP fallback is disabled in production builds.");
  }
  const r = await fetch(`${DEV_HTTP_BASE}/${command}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });
  const text = await r.text();
  if (!r.ok) {
    try { throw JSON.parse(text); } catch { throw new Error(text || `${command} failed (${r.status})`); }
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
  loading: true,
  inFlight: false,
});

function normalizeError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as GameError).message);
  if (typeof error === "string") return error;
  return "Game command failed.";
}

async function runCommand<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  gameState.error = null;
  try {
    return isTauri ? await invoke<T>(command, args) : await httpInvoke<T>(command, args);
  } catch (e) {
    gameState.error = normalizeError(e);
    return null;
  }
}

export async function startGame() {
  if (gameState.inFlight) return;
  gameState.inFlight = true;
  gameState.loading = true;
  try {
    const v = await runCommand<GameStateView>("start_game");
    if (v) gameState.value = v;
  } finally {
    gameState.loading = false;
    gameState.inFlight = false;
  }
}

export async function resetGame() {
  if (gameState.inFlight) return;
  gameState.inFlight = true;
  gameState.loading = true;
  try {
    const v = await runCommand<GameStateView>("reset_game");
    if (v) gameState.value = v;
  } finally {
    gameState.loading = false;
    gameState.inFlight = false;
  }
}

export async function advanceDialogue(expected: QueueToken) {
  if (gameState.inFlight) return;
  gameState.inFlight = true;
  try {
    const v = await runCommand<GameStateView>("advance_dialogue", { expected });
    if (v) gameState.value = v;
  } finally {
    gameState.inFlight = false;
  }
}

export async function inspectHotspot(hotspotId: string) {
  const v = await runCommand<GameStateView>("inspect_hotspot", { hotspotId });
  if (v) gameState.value = v;
}
export async function interviewTopic(characterId: string, topicId: string) {
  const v = await runCommand<GameStateView>("interview_topic", { characterId, topicId });
  if (v) gameState.value = v;
}
export async function enterSublocation(sublocationId: string) {
  const v = await runCommand<GameStateView>("enter_sublocation", { sublocationId });
  if (v) gameState.value = v;
}
export async function reexamineEvidence(evidenceId: string) {
  const v = await runCommand<GameStateView>("reexamine_evidence", { evidenceId });
  if (v) gameState.value = v;
}
export async function reexamineStatement(statementId: string) {
  const v = await runCommand<GameStateView>("reexamine_statement", { statementId });
  if (v) gameState.value = v;
}
