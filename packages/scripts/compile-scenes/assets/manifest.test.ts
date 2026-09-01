import { describe, expect, it } from "vitest";
import {
  buildAssetManifest,
  expectedPath,
  publicPath,
  type AssetManifestEntry,
  type ManifestEntryInput,
} from "./manifest";
import type { AssetConfig } from "./config";
import {
  parsePortraitAssetId,
  portraitAssetId,
  publicPathForAssetId,
  type AssetPathType,
} from "@lyra/asset-paths";

// Cross-check: these test cases MUST produce the same output as
// publicPathForStoryAsset() in apps/game/src/lib/assets/story-assets.ts
// and publicPathForEditorAsset() in apps/layout-editor/src/lib/editor-assets.ts.
// All three now delegate to publicPathForAssetId() from @lyra/asset-paths.
const CROSS_CHECK_CASES: Array<{
  assetId: string;
  type: AssetPathType;
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

  it("maps SFX asset IDs to static audio paths", () => {
    expect(publicPath("audio.sfx.plastic_bag_crinkle", "audio")).toBe(
      "/assets/audio/sfx/plastic_bag_crinkle.ogg",
    );
    expect(expectedPath("audio.sfx.plastic_bag_crinkle", "audio")).toBe(
      "static/assets/audio/sfx/plastic_bag_crinkle.ogg",
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
      // Also verify the shared module directly
      expect(publicPathForAssetId(assetId, type)).toBe(expected);
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

  it("throws for audio assetIds with unsupported channels", () => {
    expect(() => publicPath("audio.voice.line_001", "audio")).toThrow(
      /expected channel bgm, bgs, or sfx, got "voice"/,
    );
  });

  it("builds and parses portrait asset ids through one owner", () => {
    expect(portraitAssetId("hayasaka_akane", "concerned")).toBe(
      "portrait.hayasaka_akane.concerned",
    );
    expect(parsePortraitAssetId("portrait.hayasaka_akane.concerned")).toEqual({
      characterId: "hayasaka_akane",
      expression: "concerned",
    });
    expect(() => parsePortraitAssetId("portrait.hayasaka_akane")).toThrow(
      /expected exactly 3/,
    );
    expect(() =>
      parsePortraitAssetId("portrait.hayasaka_akane.concerned.extra"),
    ).toThrow(/expected exactly 3/);
  });

  it("serializes typed manifest sources with the legacy key order", () => {
    const config: AssetConfig = {
      enabled: true,
      globalStylePrompt: "style",
      types: {
        background: {
          dimensions: [1920, 1080],
          format: "png",
          transparency: false,
          prompt: "",
        },
        portrait: {
          dimensions: [768, 1024],
          format: "png",
          transparency: true,
          prompt: "",
        },
        standee: {
          dimensions: [1024, 1536],
          format: "png",
          transparency: true,
          prompt: "",
        },
        evidence: {
          dimensions: [512, 512],
          format: "png",
          transparency: true,
          prompt: "",
        },
        audio: { format: "ogg", loop: true, prompt: "" },
      },
      characters: { byId: new Map(), byDisplayName: new Map() },
      audio: { bgm: new Map(), bgs: new Map(), sfx: new Map() },
    };
    const entries: ManifestEntryInput[] = [
      {
        assetId: "background.chapter_1.scene_p0.tag_001",
        type: "background",
        source: {
          chapterId: "chapter_1",
          sceneId: "scene_p0",
          unitId: "tag_001",
        },
        prompt: "p",
      },
      {
        assetId: "background.chapter_1.scene_p0.standee_char",
        type: "background",
        source: {
          chapterId: "chapter_1",
          sceneId: "scene_p0",
          characterId: "char",
        },
        prompt: "p",
      },
      {
        assetId: "portrait.soma_ritsu.standard",
        type: "portrait",
        source: {
          chapterId: "chapter_1",
          sceneId: "scene_p0",
          characterId: "soma_ritsu",
          expression: "standard",
        },
        prompt: "p",
      },
      {
        assetId: "standee.hayasaka_akane.standard",
        type: "standee",
        source: {
          chapterId: "chapter_1",
          sceneId: "scene_p0",
          characterId: "char",
        },
        prompt: "p",
      },
      {
        assetId: "evidence.coffee_receipt",
        type: "evidence",
        source: {
          chapterId: "chapter_1",
          sceneId: "scene_p0",
          evidenceId: "coffee_receipt",
        },
        prompt: "p",
      },
      {
        assetId: "evidence.knife",
        type: "evidence",
        source: {
          chapterId: "chapter_1",
          sceneId: "scene_p0",
          characterId: "char",
        },
        prompt: "p",
      },
      {
        assetId: "audio.bgm.rain_mystery_low",
        type: "audio",
        source: {
          chapterId: "chapter_1",
          sceneId: "scene_p0",
          channel: "bgm",
          id: "rain_mystery_low",
        },
        prompt: "p",
      },
    ];

    const manifest = buildAssetManifest({ entries, config });

    // No new discriminator (e.g. source.kind) is serialized, and the JSON key
    // order matches the pre-union manifest exactly.
    for (const entry of manifest.entries) {
      expect(JSON.stringify(entry)).toBe(
        JSON.stringify({
          assetId: entry.assetId,
          type: entry.type,
          source: entry.source,
          expectedPath: entry.expectedPath,
          publicPath: entry.publicPath,
          promptParts: entry.promptParts,
          finalPrompt: entry.finalPrompt,
        }),
      );
      expect(JSON.stringify(entry)).not.toContain("kind");
      expect(Object.keys(entry.source)).not.toContain("kind");
    }

    // The parent `type` discriminator narrows `source` for consumers.
    const audio: AssetManifestEntry | undefined = manifest.entries.find(
      (candidate) => candidate.assetId === "audio.bgm.rain_mystery_low",
    );
    if (audio?.type !== "audio") throw new Error("expected audio entry");
    const channel: string = audio.source.channel;
    expect(channel).toBe("bgm");
    const audioId: string = audio.source.id;
    expect(audioId).toBe("rain_mystery_low");
  });
});

describe("global city-map background source (HPA-601)", () => {
  const config: AssetConfig = {
    enabled: true,
    globalStylePrompt: "style",
    types: {
      background: {
        dimensions: [1920, 1080],
        format: "png",
        transparency: false,
        prompt: "wide bg",
      },
      portrait: {
        dimensions: [768, 1024],
        format: "png",
        transparency: true,
        prompt: "",
      },
      standee: {
        dimensions: [1024, 1536],
        format: "png",
        transparency: true,
        prompt: "",
      },
      evidence: {
        dimensions: [512, 512],
        format: "png",
        transparency: true,
        prompt: "",
      },
      audio: { format: "ogg", loop: true, prompt: "" },
    },
    characters: { byId: new Map(), byDisplayName: new Map() },
    audio: { bgm: new Map(), bgs: new Map(), sfx: new Map() },
  };

  it("keeps a background entry's global-file source and city_map paths", () => {
    const entries: ManifestEntryInput[] = [
      {
        assetId: "background.city_map.tokyo",
        type: "background",
        source: { globalFile: "docs/stories_plan/city_map.json" },
        prompt: "Tokyo map prompt",
      },
    ];

    const manifest = buildAssetManifest({ entries, config });
    expect(manifest.entries).toHaveLength(1);
    const entry = manifest.entries[0]!;
    expect(entry.source).toEqual({
      globalFile: "docs/stories_plan/city_map.json",
    });
    expect(entry.expectedPath).toBe(
      "static/assets/backgrounds/city_map/tokyo.png",
    );
    expect(entry.publicPath).toBe("/assets/backgrounds/city_map/tokyo.png");
    // No fake chapter/scene source fields leak into the serialized form.
    expect(JSON.stringify(entry)).not.toContain("chapterId");
    expect(JSON.stringify(entry)).not.toContain("sceneId");
  });
});
