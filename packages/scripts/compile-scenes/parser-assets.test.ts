import { describe, expect, it } from "vitest";
import { isEmptyVisualAssetCue } from "./parser-assets";
import type { VisualAssetCue } from "./types";

function cue(overrides: Partial<VisualAssetCue> = {}): VisualAssetCue {
  return {
    backgroundPrompt: null,
    backgroundAssetId: null,
    bgm: null,
    bgs: null,
    ...overrides,
  };
}

describe("isEmptyVisualAssetCue", () => {
  it("is true for a null cue", () => {
    expect(isEmptyVisualAssetCue(null)).toBe(true);
  });

  it("is true when every visual field is absent", () => {
    expect(isEmptyVisualAssetCue(cue())).toBe(true);
  });

  it("is false when Background Prompt is present", () => {
    expect(isEmptyVisualAssetCue(cue({ backgroundPrompt: "night" }))).toBe(
      false,
    );
  });

  it("is false when Background Asset ID is present", () => {
    expect(
      isEmptyVisualAssetCue(cue({ backgroundAssetId: "background.x" })),
    ).toBe(false);
  });

  it("is false when BGM is authored even as none", () => {
    expect(
      isEmptyVisualAssetCue(cue({ bgm: { channel: "bgm", assetId: null } })),
    ).toBe(false);
  });

  it("is false when BGS is authored even as none", () => {
    expect(
      isEmptyVisualAssetCue(cue({ bgs: { channel: "bgs", assetId: null } })),
    ).toBe(false);
  });
});
