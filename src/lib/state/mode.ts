import type { Mode } from "./types";

export function shouldShowInventoryPanel(mode: Mode): boolean {
  return mode.type !== "gameComplete";
}

export function canReexamineInventory(mode: Mode): boolean {
  return mode.type === "explore";
}
