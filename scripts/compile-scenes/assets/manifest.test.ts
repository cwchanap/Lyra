import { describe, expect, it } from "vitest";
import { expectedPath, publicPath } from "./manifest";

// Cross-check: these test cases MUST produce the same output as
// publicPathForStoryAsset() in src/lib/assets/story-assets.ts.
// If you change either function, update both and keep these tests passing.
const CROSS_CHECK_CASES: Array<{
  assetId: string;
  type: "background" | "portrait" | "standee" | "evidence" | "audio";
  expected: string;
}> = [
  {
    assetId: "portrait.hayasaka_akane.concerned",
    type: "portrait",
    expected: "/assets/portraits/hayasaka_akane/concerned.png",
  },
  {
    assetId: "standee.hayasaka_akane.standard",
    type: "standee",
    expected: "/assets/standees/hayasaka_akane/standard.png",
  },
  {
    assetId: "background.chapter_1.scene_0.tag_001",
    type: "background",
    expected: "/assets/backgrounds/chapter_1/scene_0/tag_001.png",
  },
  {
    assetId: "audio.bgm.rain_mystery_low",
    type: "audio",
    expected: "/assets/audio/bgm/rain_mystery_low.ogg",
  },
  {
    assetId: "audio.bgs.street_rain",
    type: "audio",
    expected: "/assets/audio/bgs/street_rain.ogg",
  },
  {
    assetId: "evidence.coffee_receipt",
    type: "evidence",
    expected: "/assets/evidence/coffee_receipt.png",
  },
];

describe("story asset manifest paths", () => {
  it("maps portrait asset IDs to typed static asset paths", () => {
    expect(publicPath("portrait.hayasaka_akane.concerned", "portrait")).toBe(
      "/assets/portraits/hayasaka_akane/concerned.png",
    );
    expect(expectedPath("portrait.hayasaka_akane.concerned", "portrait")).toBe(
      "static/assets/portraits/hayasaka_akane/concerned.png",
    );
  });

  it("maps standee asset IDs to typed static asset paths", () => {
    expect(publicPath("standee.hayasaka_akane.standard", "standee")).toBe(
      "/assets/standees/hayasaka_akane/standard.png",
    );
    expect(expectedPath("standee.hayasaka_akane.standard", "standee")).toBe(
      "static/assets/standees/hayasaka_akane/standard.png",
    );
  });

  it("maps background asset IDs to nested background paths", () => {
    expect(
      publicPath("background.chapter_1.scene_0.tag_001", "background"),
    ).toBe("/assets/backgrounds/chapter_1/scene_0/tag_001.png");
    expect(
      expectedPath("background.chapter_1.scene_0.tag_001", "background"),
    ).toBe("static/assets/backgrounds/chapter_1/scene_0/tag_001.png");
  });

  it("maps audio asset IDs by channel", () => {
    expect(publicPath("audio.bgm.rain_mystery_low", "audio")).toBe(
      "/assets/audio/bgm/rain_mystery_low.ogg",
    );
    expect(expectedPath("audio.bgm.rain_mystery_low", "audio")).toBe(
      "static/assets/audio/bgm/rain_mystery_low.ogg",
    );
  });

  it("maps evidence asset IDs to evidence paths", () => {
    expect(publicPath("evidence.coffee_receipt", "evidence")).toBe(
      "/assets/evidence/coffee_receipt.png",
    );
    expect(expectedPath("evidence.coffee_receipt", "evidence")).toBe(
      "static/assets/evidence/coffee_receipt.png",
    );
  });

  it("cross-check: publicPath matches publicPathForStoryAsset contract", () => {
    for (const { assetId, type, expected } of CROSS_CHECK_CASES) {
      expect(publicPath(assetId, type)).toBe(expected);
    }
  });

  it("throws for malformed portrait assetIds with too few segments", () => {
    expect(() => publicPath("portrait-only", "portrait")).toThrow(
      /expected exactly 3/,
    );
  });

  it("throws for malformed standee assetIds with too few segments", () => {
    expect(() => publicPath("standee-only", "standee")).toThrow(
      /expected exactly 3/,
    );
  });

  it("throws for malformed audio assetIds with too few segments", () => {
    expect(() => publicPath("audio", "audio")).toThrow(/expected exactly 3/);
  });
});
