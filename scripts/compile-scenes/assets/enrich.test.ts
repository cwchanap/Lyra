import { describe, expect, it } from "bun:test";
import { enrichScenesWithAssets } from "./enrich";
import type { AssetConfig } from "./config";
import type { SceneRecord } from "../validator";

function config(): AssetConfig {
  const character = {
    id: "hayasaka_akane",
    displayNames: ["早坂茜"],
    portraitMode: "portrait" as const,
    visualPrompt: "attorney",
    referenceAssetId: null,
    expressions: new Map([
      ["standard", { id: "standard", prompt: "neutral" }],
      ["concerned", { id: "concerned", prompt: "worried" }],
    ]),
  };
  return {
    enabled: true,
    globalStylePrompt: "noir style",
    types: {
      background: { dimensions: [1920, 1080], format: "png", transparency: false, prompt: "wide bg" },
      portrait: { dimensions: [768, 1024], format: "png", transparency: true, prompt: "portrait" },
      evidence: { dimensions: [512, 512], format: "png", transparency: true, prompt: "evidence" },
      audio: { format: "ogg", loop: true, prompt: "" },
    },
    characters: {
      byId: new Map([[character.id, character]]),
      byDisplayName: new Map([["早坂茜", character]]),
    },
    audio: {
      bgm: new Map([["rain_mystery_low", { id: "rain_mystery_low", prompt: "music", loop: true }]]),
      bgs: new Map([["street_rain", { id: "street_rain", prompt: "rain", loop: true }]]),
    },
  };
}

describe("enrichScenesWithAssets", () => {
  it("adds background, portrait, evidence, audio refs, and manifest requests", () => {
    const scenes: SceneRecord[] = [
      {
        chapterId: "chapter_1",
        file: "scene_0.md",
        ast: {
          kind: "linearScene",
          id: "scene_0",
          title: "接案",
          queue: [
            {
              kind: "sceneTag",
              text: "咖啡館外",
              assetCue: {
                backgroundPrompt: "Rainy Tokyo cafe exterior.",
                backgroundAssetId: null,
                bgm: { channel: "bgm", assetId: "rain_mystery_low" },
                bgs: { channel: "bgs", assetId: "street_rain" },
              },
            },
            { kind: "line", speaker: "早坂茜", expression: "concerned", portrait: null, text: "你不舒服？" },
            {
              kind: "sceneTag",
              text: "咖啡館內",
              assetCue: {
                backgroundPrompt: "Quiet cafe interior with rain on the windows.",
                backgroundAssetId: null,
                bgm: { channel: "bgm", assetId: null },
                bgs: null,
              },
            },
          ],
          assetRefs: [],
          sourceFile: "chapter_1/scene_0.md",
          line: 1,
        },
      },
      {
        chapterId: "chapter_1",
        file: "investigation_scene_1.md",
        ast: {
          kind: "investigationScene",
          id: "investigation_scene_1",
          title: "調查",
          intro: [],
          sublocations: [],
          evidenceManifest: [{
            id: "coffee_receipt",
            name: "收據",
            description: "A cafe receipt.",
            details: "Printed shortly before the incident.",
            imageCue: {
              imagePrompt: "Cafe receipt isolated on transparent background.",
              imageAssetId: null,
            },
            onCollect: [],
            onReexamine: null,
            sourceFile: "chapter_1/investigation_scene_1.md",
            line: 12,
          }],
          statementManifest: [],
          outro: { unlock: "auto", dialogue: [] },
          assetRefs: [],
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 1,
        },
      },
    ];

    const result = enrichScenesWithAssets({ scenes, config: config() });
    const linearRefs = result.scenes[0]?.ast.assetRefs ?? [];
    const investigationRefs = result.scenes[1]?.ast.assetRefs ?? [];
    const manifestIds = result.manifest.entries.map((e) => e.assetId);

    expect(result.errors).toEqual([]);
    expect(linearRefs).toContainEqual({
      type: "background",
      assetId: "background.chapter_1.scene_0.tag_001",
    });
    expect(linearRefs).toContainEqual({
      type: "portrait",
      assetId: "portrait.hayasaka_akane.concerned",
    });
    expect(investigationRefs).toContainEqual({
      type: "evidence",
      assetId: "evidence.coffee_receipt",
    });
    expect(linearRefs).toContainEqual({
      type: "audio",
      assetId: "audio.bgm.rain_mystery_low",
    });
    expect(linearRefs).toContainEqual({
      type: "audio",
      assetId: "audio.bgs.street_rain",
    });
    expect(linearRefs).not.toContainEqual({
      type: "audio",
      assetId: "audio.bgm.null",
    });
    expect(manifestIds).toContain("background.chapter_1.scene_0.tag_001");
    expect(manifestIds).toContain("portrait.hayasaka_akane.concerned");
    expect(manifestIds).toContain("evidence.coffee_receipt");
    expect(manifestIds).toContain("audio.bgm.rain_mystery_low");
    expect(manifestIds).toContain("audio.bgs.street_rain");
    expect(manifestIds).not.toContain("audio.bgm.null");
    expect(result.manifest.entries.find((e) => e.assetId === "evidence.coffee_receipt")).toMatchObject({
      type: "evidence",
      promptParts: {
        entryPrompt: "Cafe receipt isolated on transparent background.",
      },
    });
    expect(result.manifest.entries.find((e) => e.assetId === "audio.bgm.rain_mystery_low")).toMatchObject({
      type: "audio",
      promptParts: {
        entryPrompt: "music",
      },
    });
    expect(result.manifest.entries.find((e) => e.assetId === "audio.bgs.street_rain")).toMatchObject({
      type: "audio",
      promptParts: {
        entryPrompt: "rain",
      },
    });
    expect(result.scenes[1]?.ast.kind === "investigationScene" ? result.scenes[1].ast.evidenceManifest[0]?.imageCue.imageAssetId : null).toBe("evidence.coffee_receipt");
  });

  it("errors for unknown speakers when assets are enabled", () => {
    const scenes: SceneRecord[] = [{
      chapterId: "chapter_1",
      file: "scene_0.md",
      ast: {
        kind: "linearScene",
        id: "scene_0",
        title: "接案",
        queue: [{ kind: "line", speaker: "不存在", expression: null, portrait: null, text: "hi" }],
        assetRefs: [],
        sourceFile: "chapter_1/scene_0.md",
        line: 1,
      },
    }];
    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors.some((e) => e.code === "assetUnknownSpeaker")).toBe(true);
  });
});
