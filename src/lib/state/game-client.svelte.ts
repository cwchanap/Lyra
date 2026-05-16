import { invoke } from "@tauri-apps/api/core";
import type { GameError, GameStateView, QueueToken } from "./types";

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
    return await invoke<T>(command, args);
  } catch (e) {
    gameState.error = normalizeError(e);
    return null;
  }
}

export async function startGame() {
  gameState.loading = true;
  const v = await runCommand<GameStateView>("start_game");
  if (v) gameState.value = v;
  gameState.loading = false;
}

export async function resetGame() {
  gameState.loading = true;
  const v = await runCommand<GameStateView>("reset_game");
  if (v) gameState.value = v;
  gameState.loading = false;
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
