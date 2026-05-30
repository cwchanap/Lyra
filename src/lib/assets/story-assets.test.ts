import { describe, expect, it } from "vitest";
import {
  placeholderForStoryAsset,
  publicPathForStoryAsset,
  resolveStoryAsset,
} from "./story-assets";

// Cross-check: these test cases MUST produce the same output as publicPath()
// in scripts/compile-scenes/assets/manifest.ts. If you change either function,
// update both and keep both test suites passing.

describe("story asset resolver helpers", () => {
  it("maps portrait IDs to public asset paths", () => {
    expect(publicPathForStoryAsset("portrait.hayasaka_akane.concerned", "portrait")).toBe(
      "/assets/portraits/hayasaka_akane/concerned.png",
    );
  });

  it("maps background IDs to nested public paths", () => {
    expect(publicPathForStoryAsset("background.chapter_1.scene_0.tag_001", "background")).toBe(
      "/assets/backgrounds/chapter_1/scene_0/tag_001.png",
    );
  });

  it("maps evidence IDs without the evidence prefix", () => {
    expect(publicPathForStoryAsset("evidence.coffee_receipt", "evidence")).toBe(
      "/assets/evidence/coffee_receipt.png",
    );
  });

  it("maps audio IDs to channel-specific ogg paths", () => {
    expect(publicPathForStoryAsset("audio.bgm.rain_mystery_low", "audio")).toBe(
      "/assets/audio/bgm/rain_mystery_low.ogg",
    );
  });

  it("provides placeholders by image type", () => {
    expect(placeholderForStoryAsset("background").url).toContain("data:image/svg+xml");
    expect(placeholderForStoryAsset("portrait").placeholder).toBe(true);
    expect(placeholderForStoryAsset("evidence").placeholder).toBe(true);
  });

  it("returns null for nullish asset IDs", async () => {
    await expect(resolveStoryAsset(null, "background")).resolves.toBeNull();
    await expect(resolveStoryAsset(undefined, "portrait")).resolves.toBeNull();
  });

  it("resolves image assets to public URLs", async () => {
    await expect(resolveStoryAsset("background.chapter_1.scene_0.available", "background")).resolves.toMatchObject({
      url: "/assets/backgrounds/chapter_1/scene_0/available.png",
      placeholder: false,
    });
  });

  it("resolves audio assets to public URLs", async () => {
    await expect(resolveStoryAsset("audio.bgs.street_rain", "audio")).resolves.toEqual({
      assetId: "audio.bgs.street_rain",
      type: "audio",
      url: "/assets/audio/bgs/street_rain.ogg",
      placeholder: false,
    });
  });
});
