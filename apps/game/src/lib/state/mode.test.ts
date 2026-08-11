import { describe, expect, it } from "vitest";
import { canReexamineCaseRecords, shouldShowCaseFile } from "./mode";
import type { Mode } from "./types";

describe("mode helpers", () => {
  it("shows the Case File in explore mode and enables reexamine", () => {
    const mode: Mode = {
      type: "explore",
      sublocationId: "cafe_floor",
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    };
    expect(shouldShowCaseFile(mode)).toBe(true);
    expect(canReexamineCaseRecords(mode)).toBe(true);
  });

  it("shows the Case File in interrogation mode and enables reexamine", () => {
    const mode: Mode = {
      type: "interrogation",
      phaseId: "wakatsuki_testimony",
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    };
    expect(shouldShowCaseFile(mode)).toBe(true);
    expect(canReexamineCaseRecords(mode)).toBe(true);
  });

  it("shows the Case File in dialogue mode but disables reexamine", () => {
    const mode: Mode = {
      type: "dialogue",
      crossExamLineId: null,
      current: { kind: "action", text: "Found evidence." },
      queueRemaining: 0,
      sceneTag: null,
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
      queueToken: { sceneId: "scene_1", queueGen: 1, cursor: 0 },
    };
    expect(shouldShowCaseFile(mode)).toBe(true);
    expect(canReexamineCaseRecords(mode)).toBe(false);
  });

  it("shows the Case File in Analysis mode but disables reexamine", () => {
    const mode: Mode = {
      type: "analysis",
      boardId: "analysis_board",
      activeBoardId: "analysis_board",
      actionToken: {
        sceneId: "analysis_scene",
        activeBoardId: "analysis_board",
        durableRevision: 1,
      },
      availableBoardIds: ["analysis_board"],
      feedback: null,
      lastFeedback: null,
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    };
    expect(shouldShowCaseFile(mode)).toBe(true);
    expect(canReexamineCaseRecords(mode)).toBe(false);
  });

  it("hides the Case File after game completion and disables reexamine", () => {
    const mode: Mode = { type: "gameComplete" };
    expect(shouldShowCaseFile(mode)).toBe(false);
    expect(canReexamineCaseRecords(mode)).toBe(false);
  });
});
