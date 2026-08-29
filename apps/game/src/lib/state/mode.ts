import type { Mode } from "./types";

/**
 * Returns true if the case file should be visible in the given game mode.
 */
export function shouldShowCaseFile(mode: Mode): boolean {
  return mode.type !== "gameComplete";
}

/**
 * Returns true if the player can re-examine case records in the given mode.
 */
export function canReexamineCaseRecords(mode: Mode): boolean {
  return mode.type === "explore" || mode.type === "interrogation";
}
