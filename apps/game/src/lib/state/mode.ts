import type { Mode } from "./types";

export function shouldShowCaseFile(mode: Mode): boolean {
  return mode.type !== "gameComplete";
}

export function canReexamineCaseRecords(mode: Mode): boolean {
  return mode.type === "explore" || mode.type === "interrogation";
}
