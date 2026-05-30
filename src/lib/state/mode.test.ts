import { describe, expect, it } from "vitest";
import { canReexamineInventory, shouldShowInventoryPanel } from "./mode";
import type { Mode } from "./types";

describe("mode helpers", () => {
  it("shows the inventory panel in explore mode and enables reexamine", () => {
    const mode: Mode = {
      type: "explore",
      sublocationId: "cafe_floor",
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    };
    expect(shouldShowInventoryPanel(mode)).toBe(true);
    expect(canReexamineInventory(mode)).toBe(true);
  });

  it("shows the inventory panel in interrogation mode and enables reexamine", () => {
    const mode: Mode = {
      type: "interrogation",
      phaseId: "wakatsuki_testimony",
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    };
    expect(shouldShowInventoryPanel(mode)).toBe(true);
    expect(canReexamineInventory(mode)).toBe(true);
  });

  it("shows the inventory panel in dialogue mode but disables reexamine", () => {
    const mode: Mode = {
      type: "dialogue",
      current: { kind: "action", text: "Found evidence." },
      queueRemaining: 0,
      sceneTag: null,
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
      queueToken: { sceneId: "scene_1", queueGen: 1, cursor: 0 },
    };
    expect(shouldShowInventoryPanel(mode)).toBe(true);
    expect(canReexamineInventory(mode)).toBe(false);
  });

  it("hides the inventory panel after game completion and disables reexamine", () => {
    const mode: Mode = { type: "gameComplete" };
    expect(shouldShowInventoryPanel(mode)).toBe(false);
    expect(canReexamineInventory(mode)).toBe(false);
  });
});
