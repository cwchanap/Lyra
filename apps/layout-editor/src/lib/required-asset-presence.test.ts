import { describe, expect, it } from "vitest";
import type { AssetManifest } from "@lyra/scripts/compile-scenes/assets/manifest";
import {
  findMissingRequiredAssets,
  formatMissingRequiredAssets,
  REQUIRED_REAL_FILE_ASSET_IDS,
} from "./required-asset-presence";

const TOKYO_PATH = "static/assets/backgrounds/city_map/tokyo.png";

const manifestWith = (entries: { assetId: string; expectedPath: string }[]) =>
  ({ enabled: true, entries }) as unknown as AssetManifest;

describe("findMissingRequiredAssets", () => {
  it("returns empty when every required asset's expectedPath is present", () => {
    const manifest = manifestWith([
      { assetId: "background.city_map.tokyo", expectedPath: TOKYO_PATH },
    ]);
    expect(findMissingRequiredAssets(manifest, [TOKYO_PATH])).toEqual([]);
  });

  it("flags a required asset whose expectedPath is absent from existingAssetPaths", () => {
    const manifest = manifestWith([
      { assetId: "background.city_map.tokyo", expectedPath: TOKYO_PATH },
    ]);
    expect(findMissingRequiredAssets(manifest, [])).toEqual([
      {
        assetId: "background.city_map.tokyo",
        expectedPath: TOKYO_PATH,
        reason: "fileMissing",
      },
    ]);
  });

  it("flags a required asset with no manifest entry", () => {
    expect(findMissingRequiredAssets(manifestWith([]), [])).toEqual([
      {
        assetId: "background.city_map.tokyo",
        expectedPath: "",
        reason: "noManifestEntry",
      },
    ]);
  });

  it("ignores non-required manifest entries that are missing from disk", () => {
    const manifest = manifestWith([
      {
        assetId: "background.chapter_1.scene_0.tag_001",
        expectedPath: "static/assets/backgrounds/chapter_1/scene_0/tag_001.png",
      },
      { assetId: "background.city_map.tokyo", expectedPath: TOKYO_PATH },
    ]);
    // Only the Tokyo raster is present; the historical background is missing
    // but is not in the required list, so it is not flagged.
    expect(findMissingRequiredAssets(manifest, [TOKYO_PATH])).toEqual([]);
  });

  it("accepts an explicit requiredAssetIds override", () => {
    const manifest = manifestWith([
      {
        assetId: "portrait.hayasaka_akane.concerned",
        expectedPath: "static/assets/portraits/hayasaka_akane/concerned.png",
      },
    ]);
    expect(
      findMissingRequiredAssets(
        manifest,
        [],
        ["portrait.hayasaka_akane.concerned"],
      ),
    ).toEqual([
      {
        assetId: "portrait.hayasaka_akane.concerned",
        expectedPath: "static/assets/portraits/hayasaka_akane/concerned.png",
        reason: "fileMissing",
      },
    ]);
  });

  it("includes background.city_map.tokyo in the default required list", () => {
    expect(REQUIRED_REAL_FILE_ASSET_IDS).toContain("background.city_map.tokyo");
  });
});

describe("formatMissingRequiredAssets", () => {
  it("formats a fileMissing entry with its expectedPath", () => {
    expect(
      formatMissingRequiredAssets([
        {
          assetId: "background.city_map.tokyo",
          expectedPath: TOKYO_PATH,
          reason: "fileMissing",
        },
      ]),
    ).toEqual([
      "background.city_map.tokyo -> static/assets/backgrounds/city_map/tokyo.png (file not found under static/assets)",
    ]);
  });

  it("formats a noManifestEntry entry", () => {
    expect(
      formatMissingRequiredAssets([
        {
          assetId: "background.city_map.tokyo",
          expectedPath: "",
          reason: "noManifestEntry",
        },
      ]),
    ).toEqual(["background.city_map.tokyo (no manifest entry)"]);
  });
});
