import { describe, expect, it } from "vitest";
import {
  imageStoryAssetTypeForId,
  placeholderForMissingStoryAsset,
  placeholderForStoryAsset,
  publicPathForStoryAsset,
  resolveStoryAsset,
} from "./story-assets";

// Cross-check: these test cases MUST produce the same output as publicPath()
// in packages/scripts/compile-scenes/assets/manifest.ts. If you change either function,
// update both and keep both test suites passing.

describe("story asset resolver helpers", () => {
  it("maps portrait IDs to public asset paths", () => {
    expect(
      publicPathForStoryAsset("portrait.hayasaka_akane.concerned", "portrait"),
    ).toBe("/assets/portraits/hayasaka_akane/concerned.png");
  });

  it("maps standee IDs to full-body scene portrait public paths", () => {
    expect(publicPathForStoryAsset("standee.witness.standard", "standee")).toBe(
      "/assets/standees/witness/standard.png",
    );
  });

  it("maps background IDs to nested public paths", () => {
    expect(
      publicPathForStoryAsset(
        "background.chapter_1.scene_0.tag_001",
        "background",
      ),
    ).toBe("/assets/backgrounds/chapter_1/scene_0/tag_001.png");
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
    expect(placeholderForStoryAsset("background").url).toContain(
      "data:image/svg+xml",
    );
    expect(placeholderForStoryAsset("portrait").placeholder).toBe(true);
    expect(placeholderForStoryAsset("evidence").placeholder).toBe(true);
    expect(placeholderForStoryAsset("standee").placeholder).toBe(true);
  });

  it("returns null for nullish asset IDs", async () => {
    await expect(resolveStoryAsset(null, "background")).resolves.toBeNull();
    await expect(resolveStoryAsset(undefined, "portrait")).resolves.toBeNull();
  });

  it("resolves image assets to public URLs", async () => {
    await expect(
      resolveStoryAsset("background.chapter_1.scene_0.available", "background"),
    ).resolves.toMatchObject({
      url: "/assets/backgrounds/chapter_1/scene_0/available.png",
      placeholder: false,
    });
  });

  it("resolves audio assets to public URLs", async () => {
    await expect(
      resolveStoryAsset("audio.bgs.street_rain", "audio"),
    ).resolves.toEqual({
      assetId: "audio.bgs.street_rain",
      type: "audio",
      url: "/assets/audio/bgs/street_rain.ogg",
      placeholder: false,
    });
  });

  it("returns the same promise on repeated calls (cache hit)", async () => {
    const first = resolveStoryAsset("background.cache_test.hit", "background");
    const second = resolveStoryAsset("background.cache_test.hit", "background");
    expect(first).toBe(second);
    const result = await first;
    expect(result?.assetId).toBe("background.cache_test.hit");
  });

  it("throws for malformed portrait assetIds with too few segments", () => {
    expect(() => publicPathForStoryAsset("portrait-only", "portrait")).toThrow(
      /expected exactly 3/,
    );
  });

  it("throws for malformed audio assetIds with too few segments", () => {
    expect(() => publicPathForStoryAsset("audio", "audio")).toThrow(
      /expected exactly 3/,
    );
  });

  it("throws for malformed standee assetIds with too few segments", () => {
    expect(() => publicPathForStoryAsset("standee-only", "standee")).toThrow(
      /expected exactly 3/,
    );
  });

  it("maps imageStoryAssetTypeForId for standee prefix", () => {
    expect(imageStoryAssetTypeForId("standee.witness.standard")).toBe(
      "standee",
    );
  });

  it("maps imageStoryAssetTypeForId for evidence prefix", () => {
    expect(imageStoryAssetTypeForId("evidence.coffee_receipt")).toBe(
      "evidence",
    );
  });

  it("maps imageStoryAssetTypeForId for background prefix", () => {
    expect(imageStoryAssetTypeForId("background.chapter_1.scene_0.rain")).toBe(
      "background",
    );
  });

  it("maps imageStoryAssetTypeForId for portrait prefix", () => {
    expect(imageStoryAssetTypeForId("portrait.hayasaka_akane.concerned")).toBe(
      "portrait",
    );
  });

  it("throws for imageStoryAssetTypeForId with unknown prefix", () => {
    expect(() => imageStoryAssetTypeForId("something_unknown")).toThrow(
      /Unknown image asset type prefix/,
    );
  });

  it("placeholderForMissingStoryAsset preserves the original assetId", () => {
    const result = placeholderForMissingStoryAsset(
      "background.chapter_1.scene_0.cafe",
      "background",
    );
    expect(result.assetId).toBe("background.chapter_1.scene_0.cafe");
    expect(result.placeholder).toBe(true);
    expect(result.url).toContain("data:image/svg+xml");
  });

  it("resolves portrait assets through the full pipeline", async () => {
    await expect(
      resolveStoryAsset("portrait.hayasaka_akane.concerned", "portrait"),
    ).resolves.toMatchObject({
      assetId: "portrait.hayasaka_akane.concerned",
      url: "/assets/portraits/hayasaka_akane/concerned.png",
      placeholder: false,
    });
  });

  it("resolves evidence assets through the full pipeline", async () => {
    await expect(
      resolveStoryAsset("evidence.coffee_receipt", "evidence"),
    ).resolves.toMatchObject({
      assetId: "evidence.coffee_receipt",
      url: "/assets/evidence/coffee_receipt.png",
      placeholder: false,
    });
  });

  it("evicts cache and rethrows when resolution fails", async () => {
    await expect(
      resolveStoryAsset("portrait-only", "portrait"),
    ).rejects.toThrow(/expected exactly 3/);

    const second = resolveStoryAsset("portrait-only", "portrait");
    await expect(second).rejects.toThrow(/expected exactly 3/);
  });
});
