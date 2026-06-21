import { describe, expect, it } from "vitest";
import { enrichScenesWithAssets } from "./enrich";
import { emitLinearScene } from "../emitter";
import type { AssetConfig } from "./config";
import type { DialogueItem } from "../types";
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
        prompt: "portrait",
      },
      standee: {
        dimensions: [1024, 1536],
        format: "png",
        transparency: true,
        prompt: "standee",
      },
      evidence: {
        dimensions: [512, 512],
        format: "png",
        transparency: true,
        prompt: "evidence",
      },
      audio: { format: "ogg", loop: true, prompt: "" },
    },
    characters: {
      byId: new Map([[character.id, character]]),
      byDisplayName: new Map([["早坂茜", character]]),
    },
    audio: {
      bgm: new Map([
        [
          "rain_mystery_low",
          { id: "rain_mystery_low", prompt: "music", loop: true },
        ],
      ]),
      bgs: new Map([
        ["street_rain", { id: "street_rain", prompt: "rain", loop: true }],
      ]),
      sfx: new Map(),
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
            {
              kind: "line",
              speaker: "早坂茜",
              expression: "concerned",
              portrait: null,
              text: "你不舒服？",
            },
            {
              kind: "sceneTag",
              text: "咖啡館內",
              assetCue: {
                backgroundPrompt:
                  "Quiet cafe interior with rain on the windows.",
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
          evidenceManifest: [
            {
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
            },
          ],
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
    const linear =
      result.scenes[0]?.ast.kind === "linearScene"
        ? result.scenes[0].ast
        : null;
    const firstTag =
      linear?.queue[0]?.kind === "sceneTag" ? linear.queue[0] : null;
    const secondTag =
      linear?.queue[2]?.kind === "sceneTag" ? linear.queue[2] : null;
    const emitted = linear ? emitLinearScene(linear) : null;
    const emittedFirstTag =
      emitted?.queue[0]?.kind === "sceneTag" ? emitted.queue[0] : null;

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
    expect(firstTag?.assetCue?.bgm).toEqual({
      channel: "bgm",
      assetId: "audio.bgm.rain_mystery_low",
    });
    expect(firstTag?.assetCue?.bgs).toEqual({
      channel: "bgs",
      assetId: "audio.bgs.street_rain",
    });
    expect(secondTag?.assetCue?.bgm).toEqual({ channel: "bgm", assetId: null });
    expect(emittedFirstTag?.assetCue?.bgm).toEqual({
      channel: "bgm",
      assetId: "audio.bgm.rain_mystery_low",
    });
    expect(emittedFirstTag?.assetCue?.bgs).toEqual({
      channel: "bgs",
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
    expect(
      result.manifest.entries.find(
        (e) => e.assetId === "evidence.coffee_receipt",
      ),
    ).toMatchObject({
      type: "evidence",
      promptParts: {
        entryPrompt: "Cafe receipt isolated on transparent background.",
      },
    });
    expect(
      result.manifest.entries.find(
        (e) => e.assetId === "audio.bgm.rain_mystery_low",
      ),
    ).toMatchObject({
      type: "audio",
      promptParts: {
        entryPrompt: "music",
      },
    });
    expect(
      result.manifest.entries.find(
        (e) => e.assetId === "audio.bgs.street_rain",
      ),
    ).toMatchObject({
      type: "audio",
      promptParts: {
        entryPrompt: "rain",
      },
    });
    expect(
      result.scenes[1]?.ast.kind === "investigationScene"
        ? result.scenes[1].ast.evidenceManifest[0]?.imageCue.imageAssetId
        : null,
    ).toBe("evidence.coffee_receipt");
  });

  it("errors for unknown speakers with expression when assets are enabled", () => {
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
              kind: "line",
              speaker: "不存在",
              expression: "concerned",
              portrait: null,
              text: "hi",
            },
          ],
          assetRefs: [],
          sourceFile: "chapter_1/scene_0.md",
          line: 1,
        },
      },
    ];
    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors.some((e) => e.code === "assetUnknownSpeaker")).toBe(
      true,
    );
  });

  it("exempts narrator-style lines (unknown speaker, no expression) from character lookup", () => {
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
              kind: "line",
              speaker: "旁白",
              expression: null,
              portrait: null,
              text: "雨夜，街道無人。",
            },
          ],
          assetRefs: [],
          sourceFile: "chapter_1/scene_0.md",
          line: 1,
        },
      },
    ];
    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors.some((e) => e.code === "assetUnknownSpeaker")).toBe(
      false,
    );
    const line =
      result.scenes[0]?.ast.kind === "linearScene"
        ? result.scenes[0].ast.queue[0]
        : null;
    expect(line?.kind === "line" ? line.portrait : undefined).toBeNull();
  });

  it("errors for unknown expressions", () => {
    const scenes = [
      linearScene([
        {
          kind: "line",
          speaker: "早坂茜",
          expression: "angry",
          portrait: null,
          text: "hi",
        },
      ]),
    ];
    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors.some((e) => e.code === "assetUnknownExpression")).toBe(
      true,
    );
  });

  it("errors for expression on no-portrait speaker", () => {
    const noPortraitConfig = config();
    const noPortraitCharacter = {
      id: "narrator",
      displayNames: ["旁白"],
      portraitMode: "none" as const,
      visualPrompt: null,
      referenceAssetId: null,
      expressions: new Map(),
    };
    noPortraitConfig.characters.byId.set("narrator", noPortraitCharacter);
    noPortraitConfig.characters.byDisplayName.set("旁白", noPortraitCharacter);
    const scenes = [
      linearScene([
        {
          kind: "line",
          speaker: "旁白",
          expression: "concerned",
          portrait: null,
          text: "hi",
        },
      ]),
    ];
    const result = enrichScenesWithAssets({ scenes, config: noPortraitConfig });
    expect(
      result.errors.some(
        (e) => e.code === "assetExpressionOnNoPortraitSpeaker",
      ),
    ).toBe(true);
    const line =
      result.scenes[0]?.ast.kind === "linearScene"
        ? result.scenes[0].ast.queue[0]
        : null;
    expect(line?.kind === "line" ? line.portrait : undefined).toBeNull();
  });

  it("does not error for no-portrait speaker without expression", () => {
    const noPortraitConfig = config();
    const noPortraitCharacter = {
      id: "narrator",
      displayNames: ["旁白"],
      portraitMode: "none" as const,
      visualPrompt: null,
      referenceAssetId: null,
      expressions: new Map(),
    };
    noPortraitConfig.characters.byId.set("narrator", noPortraitCharacter);
    noPortraitConfig.characters.byDisplayName.set("旁白", noPortraitCharacter);
    const scenes = [
      linearScene([
        {
          kind: "line",
          speaker: "旁白",
          expression: null,
          portrait: null,
          text: "hi",
        },
      ]),
    ];
    const result = enrichScenesWithAssets({ scenes, config: noPortraitConfig });
    expect(
      result.errors.some(
        (e) => e.code === "assetExpressionOnNoPortraitSpeaker",
      ),
    ).toBe(false);
  });

  it("errors for unknown audio while still reporting missing background prompts", () => {
    const scenes = [
      linearScene([
        {
          kind: "sceneTag",
          text: "咖啡館外",
          assetCue: {
            backgroundPrompt: null,
            backgroundAssetId: null,
            bgm: { channel: "bgm", assetId: "missing_bgm" },
            bgs: { channel: "bgs", assetId: "missing_bgs" },
          },
        },
      ]),
    ];
    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors.map((e) => e.code)).toContain(
      "assetMissingBackgroundPrompt",
    );
    expect(
      result.errors.filter((e) => e.code === "assetUnknownAudio"),
    ).toHaveLength(2);
    expect(result.scenes[0]?.ast.assetRefs).toEqual([]);
    expect(result.manifest.entries).toEqual([]);
  });

  it("allows later scenes to omit BGM/BGS when an earlier scene already set them", () => {
    // Scene 1 sets BGM + BGS. Scene 2's first visual cue intentionally omits
    // them to keep the previous channel. The compiler must not require them.
    const scene1: SceneRecord = {
      chapterId: "chapter_1",
      file: "scene_0.md",
      ast: {
        kind: "linearScene",
        id: "scene_0",
        title: "場景一",
        queue: [
          {
            kind: "sceneTag",
            text: "咖啡館外",
            assetCue: {
              backgroundPrompt: "Rainy cafe.",
              backgroundAssetId: null,
              bgm: { channel: "bgm", assetId: "rain_mystery_low" },
              bgs: { channel: "bgs", assetId: "street_rain" },
            },
          },
        ],
        assetRefs: [],
        sourceFile: "chapter_1/scene_0.md",
        line: 1,
      },
    };
    const scene2: SceneRecord = {
      chapterId: "chapter_1",
      file: "scene_1.md",
      ast: {
        kind: "linearScene",
        id: "scene_1",
        title: "場景二",
        queue: [
          {
            kind: "sceneTag",
            text: "咖啡館內",
            assetCue: {
              backgroundPrompt: "Interior.",
              backgroundAssetId: null,
              bgm: null,
              bgs: null,
            },
          },
        ],
        assetRefs: [],
        sourceFile: "chapter_1/scene_1.md",
        line: 1,
      },
    };
    const result = enrichScenesWithAssets({
      scenes: [scene1, scene2],
      config: config(),
    });
    expect(
      result.errors.filter((e) => e.code === "assetFirstCueMissingBgm"),
    ).toHaveLength(0);
    expect(
      result.errors.filter((e) => e.code === "assetFirstCueMissingBgs"),
    ).toHaveLength(0);
  });

  it("errors for missing evidence image prompts", () => {
    const scenes = [investigationScene({ imagePrompt: null })];
    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(
      result.errors.some((e) => e.code === "assetMissingEvidenceImagePrompt"),
    ).toBe(true);
    expect(result.scenes[0]?.ast.assetRefs).toEqual([]);
    expect(result.manifest.entries).toEqual([]);
  });

  it("adds investigation evidence source guidance to sublocation background prompts", () => {
    const scenes: SceneRecord[] = [investigationSceneWithEvidenceSources()];
    const result = enrichScenesWithAssets({ scenes, config: config() });

    expect(result.errors).toEqual([]);
    const backgroundEntry = result.manifest.entries.find(
      (entry) =>
        entry.assetId ===
        "background.chapter_1.investigation_scene_1.security_room",
    );

    expect(backgroundEntry?.promptParts.entryPrompt).toContain(
      "Investigation source guidance:",
    );
    expect(backgroundEntry?.promptParts.entryPrompt).toContain("cctv_playback");
    expect(backgroundEntry?.promptParts.entryPrompt).toContain(
      "do not show the collected evidence image or readable evidence content",
    );
    expect(backgroundEntry?.promptParts.entryPrompt).toContain("timecard");
    expect(backgroundEntry?.promptParts.entryPrompt).toContain(
      "Do not show 三宅打卡紀錄",
    );
    expect(backgroundEntry?.promptParts.entryPrompt).not.toContain(
      "any visible evidence/source record",
    );
  });

  it("falls back to label:description when sceneSourcePrompt is null", () => {
    const scene = investigationSceneWithEvidenceSources();
    if (scene.ast.kind !== "investigationScene") {
      throw new Error("expected investigation scene fixture");
    }
    const cctv = scene.ast.sublocations[0]?.hotspots[0];
    if (!cctv) throw new Error("expected cctv hotspot fixture");
    cctv.sceneSourcePrompt = null;

    const result = enrichScenesWithAssets({
      scenes: [scene],
      config: config(),
    });
    expect(result.errors).toEqual([]);
    const backgroundEntry = result.manifest.entries.find(
      (entry) =>
        entry.assetId ===
        "background.chapter_1.investigation_scene_1.security_room",
    );
    expect(backgroundEntry?.promptParts.entryPrompt).toContain(
      "監視器回放: A wall of monitors showing old lobby footage.",
    );
  });

  it("falls back to label:description when sceneSourcePrompt is empty or whitespace", () => {
    // Defense-in-depth: the parser cannot produce an empty sceneSourcePrompt
    // today (the metadata regex requires ≥1 char), but the field type is
    // `string | null`. An empty/whitespace value must still fall back rather
    // than emit empty source guidance.
    for (const emptyValue of ["", "   "]) {
      const scene = investigationSceneWithEvidenceSources();
      if (scene.ast.kind !== "investigationScene") {
        throw new Error("expected investigation scene fixture");
      }
      const cctv = scene.ast.sublocations[0]?.hotspots[0];
      if (!cctv) throw new Error("expected cctv hotspot fixture");
      cctv.sceneSourcePrompt = emptyValue;

      const result = enrichScenesWithAssets({
        scenes: [scene],
        config: config(),
      });
      expect(result.errors).toEqual([]);
      const backgroundEntry = result.manifest.entries.find(
        (entry) =>
          entry.assetId ===
          "background.chapter_1.investigation_scene_1.security_room",
      );
      const prompt = backgroundEntry?.promptParts.entryPrompt ?? "";
      expect(prompt).toContain(
        "監視器回放: A wall of monitors showing old lobby footage.",
      );
    }
  });

  it("errors when an evidence-revealing hotspot omits evidenceSource", () => {
    const scene = investigationSceneWithEvidenceSources();
    if (scene.ast.kind !== "investigationScene") {
      throw new Error("expected investigation scene fixture");
    }
    const firstHotspot = scene.ast.sublocations[0]?.hotspots[0];
    if (!firstHotspot) throw new Error("expected hotspot fixture");
    firstHotspot.evidenceSource = null;

    const result = enrichScenesWithAssets({
      scenes: [scene],
      config: config(),
    });
    const error = result.errors.find(
      (item) => item.code === "hotspotEvidenceSourceMissing",
    );

    expect(error).toMatchObject({
      sourceFile: "chapter_1/investigation_scene_1.md",
      line: 30,
    });
    expect(error?.message).toContain("cctv_playback");
  });

  it("does not raise hotspotEvidenceSourceMissing when assets are disabled", () => {
    // Regression guard: the evidence-source validation must be gated behind the
    // enabled flag. A source-less, evidence-revealing hotspot is legal when
    // assets are off. Moving the validation before the guard would go undetected
    // without this test.
    const scene = investigationSceneWithEvidenceSources();
    if (scene.ast.kind !== "investigationScene") {
      throw new Error("expected investigation scene fixture");
    }
    const firstHotspot = scene.ast.sublocations[0]?.hotspots[0];
    if (!firstHotspot) throw new Error("expected hotspot fixture");
    firstHotspot.evidenceSource = null;

    const result = enrichScenesWithAssets({
      scenes: [scene],
      config: { ...config(), enabled: false },
    });

    expect(result.errors).toEqual([]);
  });

  it("returns empty manifest and asset refs when assets are disabled", () => {
    const disabled = { ...config(), enabled: false };
    const scenes = [
      linearScene([
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
      ]),
      investigationScene({
        imagePrompt: "Cafe receipt isolated on transparent background.",
      }),
    ];
    const result = enrichScenesWithAssets({ scenes, config: disabled });
    expect(result.errors).toEqual([]);
    expect(result.manifest).toEqual({ enabled: false, entries: [] });
    expect(result.scenes.map((scene) => scene.ast.assetRefs)).toEqual([[], []]);

    // Visual cues are stripped — no raw audio IDs leak into the AST.
    const linear =
      result.scenes[0]?.ast.kind === "linearScene"
        ? result.scenes[0].ast
        : null;
    const tag = linear?.queue[0]?.kind === "sceneTag" ? linear.queue[0] : null;
    expect(tag?.assetCue).toEqual({
      backgroundPrompt: null,
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    });

    // Evidence image cues are stripped too.
    const investigation =
      result.scenes[1]?.ast.kind === "investigationScene"
        ? result.scenes[1].ast
        : null;
    expect(investigation?.evidenceManifest[0]?.imageCue).toEqual({
      imagePrompt: null,
      imageAssetId: null,
    });
  });

  it("adds standee refs from character sprite layouts in investigation scenes", () => {
    const scenes: SceneRecord[] = [
      {
        chapterId: "chapter_1",
        file: "investigation_scene_1.md",
        ast: {
          kind: "investigationScene",
          id: "investigation_scene_1",
          title: "調查",
          intro: [
            {
              kind: "sceneTag",
              text: "辦公室",
              assetCue: {
                backgroundPrompt: "Office interior.",
                backgroundAssetId: null,
                bgm: { channel: "bgm", assetId: "rain_mystery_low" },
                bgs: { channel: "bgs", assetId: "street_rain" },
              },
            },
          ],
          sublocations: [
            {
              id: "office",
              label: "辦公室",
              assetCue: null,
              transitionDialogue: [],
              hotspots: [],
              characters: [
                {
                  id: "hayasaka",
                  name: "早坂茜",
                  role: "助手",
                  bio: "助手。",
                  topics: [],
                  layout: {
                    kind: "sprite",
                    assetId: "standee.hayasaka_akane.standard",
                    x: 0,
                    y: 0.18,
                    w: 0.19,
                    h: 0.82,
                    anchor: "bottomCenter" as const,
                  },
                  sourceFile: "chapter_1/investigation_scene_1.md",
                  line: 5,
                },
              ],
            },
          ],
          evidenceManifest: [],
          statementManifest: [],
          outro: { unlock: "auto", dialogue: [] },
          assetRefs: [],
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 1,
        },
      },
    ];

    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors).toEqual([]);

    const ast = result.scenes[0]?.ast;
    expect(ast?.kind).toBe("investigationScene");
    if (ast?.kind !== "investigationScene") return;

    // Standee ref added to assetRefs
    expect(ast.assetRefs).toContainEqual({
      type: "standee",
      assetId: "standee.hayasaka_akane.standard",
    });

    // Standee entry in manifest
    const manifestIds = result.manifest.entries.map((e) => e.assetId);
    expect(manifestIds).toContain("standee.hayasaka_akane.standard");

    // Standee manifest entry has correct metadata
    const standeeEntry = result.manifest.entries.find(
      (e) => e.assetId === "standee.hayasaka_akane.standard",
    );
    expect(standeeEntry).toMatchObject({
      type: "standee",
      expectedPath: "static/assets/standees/hayasaka_akane/standard.png",
      publicPath: "/assets/standees/hayasaka_akane/standard.png",
    });

    // Standee entry uses character visualPrompt as subjectPrompt and pose as entryPrompt
    expect(standeeEntry?.promptParts.subjectPrompt).toBe("attorney");
    expect(standeeEntry?.promptParts.entryPrompt).toBe("standard");
    // typePrompt comes from config, should NOT be duplicated in entryPrompt
    expect(standeeEntry?.promptParts.typePrompt).toBe("standee");
    expect(standeeEntry?.finalPrompt).toContain("attorney");
  });

  it("errors for malformed standee assetId in character layout", () => {
    const scenes: SceneRecord[] = [
      {
        chapterId: "chapter_1",
        file: "investigation_scene_1.md",
        ast: {
          kind: "investigationScene",
          id: "investigation_scene_1",
          title: "調查",
          intro: [],
          sublocations: [
            {
              id: "office",
              label: "辦公室",
              assetCue: null,
              transitionDialogue: [],
              hotspots: [],
              characters: [
                {
                  id: "hayasaka",
                  name: "早坂茜",
                  role: "助手",
                  bio: "助手。",
                  topics: [],
                  layout: {
                    kind: "sprite",
                    assetId: "standee.malformed",
                    x: 0,
                    y: 0.18,
                    w: 0.19,
                    h: 0.82,
                    anchor: "bottomCenter" as const,
                  },
                  sourceFile: "chapter_1/investigation_scene_1.md",
                  line: 5,
                },
              ],
            },
          ],
          evidenceManifest: [],
          statementManifest: [],
          outro: { unlock: "auto", dialogue: [] },
          assetRefs: [],
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 1,
        },
      },
    ];

    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors.some((e) => e.code === "assetInvalidStandeeId")).toBe(
      true,
    );
    expect(result.manifest.entries.map((e) => e.assetId)).not.toContain(
      "standee.malformed",
    );
  });

  it("errors for standee assetId with extra dot-separated segments", () => {
    const scenes: SceneRecord[] = [
      {
        chapterId: "chapter_1",
        file: "investigation_scene_1.md",
        ast: {
          kind: "investigationScene",
          id: "investigation_scene_1",
          title: "調查",
          intro: [],
          sublocations: [
            {
              id: "office",
              label: "辦公室",
              assetCue: null,
              transitionDialogue: [],
              hotspots: [],
              characters: [
                {
                  id: "hayasaka",
                  name: "早坂茜",
                  role: "助手",
                  bio: "助手。",
                  topics: [],
                  layout: {
                    kind: "sprite",
                    assetId: "standee.hayasaka_akane.standard.extra",
                    x: 0,
                    y: 0.18,
                    w: 0.19,
                    h: 0.82,
                    anchor: "bottomCenter" as const,
                  },
                  sourceFile: "chapter_1/investigation_scene_1.md",
                  line: 5,
                },
              ],
            },
          ],
          evidenceManifest: [],
          statementManifest: [],
          outro: { unlock: "auto", dialogue: [] },
          assetRefs: [],
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 1,
        },
      },
    ];

    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors.some((e) => e.code === "assetInvalidStandeeId")).toBe(
      true,
    );
    expect(result.manifest.entries.map((e) => e.assetId)).not.toContain(
      "standee.hayasaka_akane.standard.extra",
    );
  });

  it("errors for portrait assetId with extra dot-separated segments", () => {
    const scenes: SceneRecord[] = [
      {
        chapterId: "chapter_1",
        file: "investigation_scene_1.md",
        ast: {
          kind: "investigationScene",
          id: "investigation_scene_1",
          title: "調查",
          intro: [],
          sublocations: [
            {
              id: "office",
              label: "辦公室",
              assetCue: null,
              transitionDialogue: [],
              hotspots: [],
              characters: [
                {
                  id: "hayasaka",
                  name: "早坂茜",
                  role: "助手",
                  bio: "助手。",
                  topics: [],
                  layout: {
                    kind: "sprite",
                    assetId: "portrait.hayasaka_akane.concerned.extra",
                    x: 0,
                    y: 0.18,
                    w: 0.19,
                    h: 0.82,
                    anchor: "bottomCenter" as const,
                  },
                  sourceFile: "chapter_1/investigation_scene_1.md",
                  line: 5,
                },
              ],
            },
          ],
          evidenceManifest: [],
          statementManifest: [],
          outro: { unlock: "auto", dialogue: [] },
          assetRefs: [],
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 1,
        },
      },
    ];

    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(
      result.errors.some((e) => e.code === "assetInvalidPortraitLayoutId"),
    ).toBe(true);
    expect(result.manifest.entries.map((e) => e.assetId)).not.toContain(
      "portrait.hayasaka_akane.concerned.extra",
    );
  });

  it("registers portrait assetIds from character sprite layouts", () => {
    const scenes: SceneRecord[] = [
      {
        chapterId: "chapter_1",
        file: "investigation_scene_1.md",
        ast: {
          kind: "investigationScene",
          id: "investigation_scene_1",
          title: "調查",
          intro: [],
          sublocations: [
            {
              id: "office",
              label: "辦公室",
              assetCue: null,
              transitionDialogue: [],
              hotspots: [],
              characters: [
                {
                  id: "hayasaka",
                  name: "早坂茜",
                  role: "助手",
                  bio: "助手。",
                  topics: [],
                  layout: {
                    kind: "sprite",
                    assetId: "portrait.hayasaka_akane.standard",
                    x: 0,
                    y: 0.18,
                    w: 0.19,
                    h: 0.82,
                    anchor: "bottomCenter" as const,
                  },
                  sourceFile: "chapter_1/investigation_scene_1.md",
                  line: 5,
                },
              ],
            },
          ],
          evidenceManifest: [],
          statementManifest: [],
          outro: { unlock: "auto", dialogue: [] },
          assetRefs: [],
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 1,
        },
      },
    ];

    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors).toEqual([]);
    // Portrait assetIds in sprite layouts are registered as portrait manifest entries
    const portraitRefs = result.manifest.entries.filter(
      (e) => e.type === "portrait",
    );
    expect(portraitRefs).toHaveLength(1);
    expect(portraitRefs[0].assetId).toBe("portrait.hayasaka_akane.standard");

    // No standee ref — only portrait type should be registered
    const standeeRefs = result.manifest.entries.filter(
      (e) => e.type === "standee",
    );
    expect(standeeRefs).toEqual([]);
  });

  it("registers evidence assetIds from character sprite layouts", () => {
    const scenes: SceneRecord[] = [
      {
        chapterId: "chapter_1",
        file: "investigation_scene_1.md",
        ast: {
          kind: "investigationScene",
          id: "investigation_scene_1",
          title: "調查",
          intro: [],
          sublocations: [
            {
              id: "office",
              label: "辦公室",
              assetCue: null,
              transitionDialogue: [],
              hotspots: [],
              characters: [
                {
                  id: "hayasaka",
                  name: "早坂茜",
                  role: "助手",
                  bio: "助手。",
                  topics: [],
                  layout: {
                    kind: "sprite",
                    assetId: "evidence.knife",
                    x: 0.4,
                    y: 0.3,
                    w: 0.2,
                    h: 0.5,
                    anchor: "bottomCenter" as const,
                  },
                  sourceFile: "chapter_1/investigation_scene_1.md",
                  line: 5,
                },
              ],
            },
          ],
          evidenceManifest: [],
          statementManifest: [],
          outro: { unlock: "auto", dialogue: [] },
          assetRefs: [],
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 1,
        },
      },
    ];

    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors).toEqual([]);
    const evidenceRefs = result.manifest.entries.filter(
      (e) => e.type === "evidence",
    );
    expect(evidenceRefs).toHaveLength(1);
    expect(evidenceRefs[0].assetId).toBe("evidence.knife");
  });

  it("registers background assetIds from character sprite layouts", () => {
    const scenes: SceneRecord[] = [
      {
        chapterId: "chapter_1",
        file: "investigation_scene_1.md",
        ast: {
          kind: "investigationScene",
          id: "investigation_scene_1",
          title: "調查",
          intro: [],
          sublocations: [
            {
              id: "office",
              label: "辦公室",
              assetCue: null,
              transitionDialogue: [],
              hotspots: [],
              characters: [
                {
                  id: "hayasaka",
                  name: "早坂茜",
                  role: "助手",
                  bio: "助手。",
                  topics: [],
                  layout: {
                    kind: "sprite",
                    assetId: "background.chapter_1.crime_scene",
                    x: 0,
                    y: 0,
                    w: 1,
                    h: 1,
                    anchor: "bottomCenter" as const,
                  },
                  sourceFile: "chapter_1/investigation_scene_1.md",
                  line: 5,
                },
              ],
            },
          ],
          evidenceManifest: [],
          statementManifest: [],
          outro: { unlock: "auto", dialogue: [] },
          assetRefs: [],
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 1,
        },
      },
    ];

    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors).toEqual([]);
    const bgRefs = result.manifest.entries.filter(
      (e) => e.type === "background",
    );
    expect(bgRefs).toHaveLength(1);
    expect(bgRefs[0].assetId).toBe("background.chapter_1.crime_scene");
  });

  it("errors for malformed portrait assetId in character sprite layout", () => {
    const scenes: SceneRecord[] = [
      {
        chapterId: "chapter_1",
        file: "investigation_scene_1.md",
        ast: {
          kind: "investigationScene",
          id: "investigation_scene_1",
          title: "調查",
          intro: [],
          sublocations: [
            {
              id: "office",
              label: "辦公室",
              assetCue: null,
              transitionDialogue: [],
              hotspots: [],
              characters: [
                {
                  id: "hayasaka",
                  name: "早坂茜",
                  role: "助手",
                  bio: "助手。",
                  topics: [],
                  layout: {
                    kind: "sprite",
                    assetId: "portrait.malformed",
                    x: 0,
                    y: 0.18,
                    w: 0.19,
                    h: 0.82,
                    anchor: "bottomCenter" as const,
                  },
                  sourceFile: "chapter_1/investigation_scene_1.md",
                  line: 5,
                },
              ],
            },
          ],
          evidenceManifest: [],
          statementManifest: [],
          outro: { unlock: "auto", dialogue: [] },
          assetRefs: [],
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 1,
        },
      },
    ];

    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].code).toBe("assetInvalidPortraitLayoutId");
    expect(result.errors[0].message).toContain("portrait.malformed");
  });

  it("uses empty subjectPrompt for standee when character is not in config", () => {
    const scenes: SceneRecord[] = [
      {
        chapterId: "chapter_1",
        file: "investigation_scene_1.md",
        ast: {
          kind: "investigationScene",
          id: "investigation_scene_1",
          title: "調查",
          intro: [],
          sublocations: [
            {
              id: "office",
              label: "辦公室",
              assetCue: null,
              transitionDialogue: [],
              hotspots: [],
              characters: [
                {
                  id: "unknown_char",
                  name: "謎の人物",
                  role: "NPC",
                  bio: "NPC。",
                  topics: [],
                  layout: {
                    kind: "sprite",
                    assetId: "standee.unknown_char.standard",
                    x: 0,
                    y: 0.18,
                    w: 0.19,
                    h: 0.82,
                    anchor: "bottomCenter" as const,
                  },
                  sourceFile: "chapter_1/investigation_scene_1.md",
                  line: 5,
                },
              ],
            },
          ],
          evidenceManifest: [],
          statementManifest: [],
          outro: { unlock: "auto", dialogue: [] },
          assetRefs: [],
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 1,
        },
      },
    ];

    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors).toEqual([]);

    const standeeEntry = result.manifest.entries.find(
      (e) => e.assetId === "standee.unknown_char.standard",
    );
    expect(standeeEntry).toBeDefined();
    // Character not in config → subjectPrompt falls back to empty string
    expect(standeeEntry?.promptParts.subjectPrompt).toBe("");
    expect(standeeEntry?.promptParts.entryPrompt).toBe("standard");
  });
});

function linearScene(queue: DialogueItem[]): SceneRecord {
  return {
    chapterId: "chapter_1",
    file: "scene_0.md",
    ast: {
      kind: "linearScene",
      id: "scene_0",
      title: "接案",
      queue,
      assetRefs: [],
      sourceFile: "chapter_1/scene_0.md",
      line: 1,
    },
  };
}

function investigationScene(input: {
  imagePrompt: string | null;
}): SceneRecord {
  return {
    chapterId: "chapter_1",
    file: "investigation_scene_1.md",
    ast: {
      kind: "investigationScene",
      id: "investigation_scene_1",
      title: "調查",
      intro: [],
      sublocations: [],
      evidenceManifest: [
        {
          id: "coffee_receipt",
          name: "收據",
          description: "A cafe receipt.",
          details: "Printed shortly before the incident.",
          imageCue: {
            imagePrompt: input.imagePrompt,
            imageAssetId: null,
          },
          onCollect: [],
          onReexamine: null,
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 12,
        },
      ],
      statementManifest: [],
      outro: { unlock: "auto", dialogue: [] },
      assetRefs: [],
      sourceFile: "chapter_1/investigation_scene_1.md",
      line: 1,
    },
  };
}

function investigationSceneWithEvidenceSources(): SceneRecord {
  return {
    chapterId: "chapter_1",
    file: "investigation_scene_1.md",
    ast: {
      kind: "investigationScene",
      id: "investigation_scene_1",
      title: "調查",
      intro: [],
      sublocations: [
        {
          id: "security_room",
          label: "警衛室",
          status: "unlocked",
          unlock: null,
          reveals: [],
          sceneTag: "警衛室",
          assetCue: {
            backgroundPrompt: "Rain-soaked office security room.",
            backgroundAssetId: null,
            bgm: { channel: "bgm", assetId: "rain_mystery_low" },
            bgs: { channel: "bgs", assetId: "street_rain" },
          },
          transitionDialogue: [],
          hotspots: [
            {
              id: "cctv_playback",
              label: "監視器回放",
              description: "A wall of monitors showing old lobby footage.",
              status: "unlocked",
              unlock: null,
              reveals: [{ kind: "evidence", id: "cctv_still" }],
              evidenceSource: "implied",
              sceneSourcePrompt: "A wall-mounted CCTV playback console.",
              inspectDialogue: [],
              onReexamine: null,
              sourceFile: "chapter_1/investigation_scene_1.md",
              line: 30,
            },
            {
              id: "timecard",
              label: "打卡機",
              description: "Employee punch clock beside the staff door.",
              status: "unlocked",
              unlock: null,
              reveals: [{ kind: "evidence", id: "timecard_record" }],
              evidenceSource: "hidden",
              sceneSourcePrompt: null,
              inspectDialogue: [],
              onReexamine: null,
              sourceFile: "chapter_1/investigation_scene_1.md",
              line: 42,
            },
          ],
          characters: [],
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 20,
        },
      ],
      evidenceManifest: [
        {
          id: "cctv_still",
          name: "監視器截圖",
          description: "Still image from security camera playback.",
          details: "The timestamp places the suspect at the front desk.",
          imageCue: {
            imagePrompt: "CCTV still isolated as evidence.",
            imageAssetId: null,
          },
          onCollect: [],
          onReexamine: null,
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 60,
        },
        {
          id: "timecard_record",
          name: "三宅打卡紀錄",
          description: "A printed employee timecard record.",
          details: "The clock-in time contradicts the testimony.",
          imageCue: {
            imagePrompt: "Employee timecard record isolated as evidence.",
            imageAssetId: null,
          },
          onCollect: [],
          onReexamine: null,
          sourceFile: "chapter_1/investigation_scene_1.md",
          line: 70,
        },
      ],
      statementManifest: [],
      outro: { unlock: "auto", dialogue: [] },
      assetRefs: [],
      sourceFile: "chapter_1/investigation_scene_1.md",
      line: 1,
    },
  };
}

describe("enrichScenesWithAssets — asset existence warnings", () => {
  /** Config with clearly-fake asset IDs that will never match real files on disk. */
  function fakeFileConfig(): AssetConfig {
    const character = {
      id: "fake_char_zzz",
      displayNames: ["測試角色"],
      portraitMode: "portrait" as const,
      visualPrompt: "test",
      referenceAssetId: null,
      expressions: new Map([
        ["standard", { id: "standard", prompt: "neutral" }],
        ["concerned", { id: "concerned", prompt: "worried" }],
      ]),
    };
    return {
      enabled: true,
      globalStylePrompt: "test style",
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
          prompt: "portrait",
        },
        standee: {
          dimensions: [1024, 1536],
          format: "png",
          transparency: true,
          prompt: "standee",
        },
        evidence: {
          dimensions: [512, 512],
          format: "png",
          transparency: true,
          prompt: "evidence",
        },
        audio: { format: "ogg", loop: true, prompt: "" },
      },
      characters: {
        byId: new Map([[character.id, character]]),
        byDisplayName: new Map([["測試角色", character]]),
      },
      audio: {
        bgm: new Map([
          [
            "nonexistent_bgm_a1b2c3",
            { id: "nonexistent_bgm_a1b2c3", prompt: "music", loop: true },
          ],
        ]),
        bgs: new Map(),
        sfx: new Map(),
      },
    };
  }

  it("emits warnings for manifest entries whose expected files do not exist", () => {
    const cfg = fakeFileConfig();
    const scene: SceneRecord = {
      chapterId: "chapter_missing_asset_warning_test",
      file: "scene_missing_asset_warning_test.md",
      ast: {
        kind: "linearScene",
        id: "scene_missing_asset_warning_test",
        title: "Test",
        queue: [
          {
            kind: "sceneTag",
            text: "Street",
            assetCue: {
              backgroundPrompt: "city",
              backgroundAssetId: null,
              bgm: { channel: "bgm", assetId: "nonexistent_bgm_a1b2c3" },
              bgs: { channel: "bgs", assetId: null },
            },
          },
          {
            kind: "line",
            speaker: "測試角色",
            text: "Hi",
            expression: "concerned",
            portrait: null,
          },
        ],
        assetRefs: [],
        sourceFile:
          "chapter_missing_asset_warning_test/scene_missing_asset_warning_test.md",
        line: 1,
      },
    };
    const result = enrichScenesWithAssets({ scenes: [scene], config: cfg });
    expect(result.errors.length).toBe(0);
    // The asset files don't exist on disk, so we should get warnings
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.every((w) => w.code === "assetFileMissing")).toBe(
      true,
    );
    const paths = result.warnings.map((w) => w.sourceFile);
    expect(paths.some((p) => p.includes("assets/backgrounds"))).toBe(true);
    expect(paths.some((p) => p.includes("assets/audio"))).toBe(true);
    expect(paths.some((p) => p.includes("assets/portraits"))).toBe(true);
  });

  it("emits no warnings when disabled config produces empty manifest", () => {
    const disabledConfig: AssetConfig = {
      enabled: false,
      globalStylePrompt: "",
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
    const scene: SceneRecord = {
      chapterId: "chapter_1",
      file: "scene_0.md",
      ast: {
        kind: "linearScene",
        id: "scene_0",
        title: "Test",
        queue: [{ kind: "action", text: "test" }],
        assetRefs: [],
        sourceFile: "chapter_1/scene_0.md",
        line: 1,
      },
    };
    const result = enrichScenesWithAssets({
      scenes: [scene],
      config: disabledConfig,
    });
    expect(result.warnings.length).toBe(0);
  });
});

describe("enrichScenesWithAssets — interrogation scenes", () => {
  it("enriches inquiry phase with assetCue, entryDialogue, and question answerDialogue", () => {
    const scenes: SceneRecord[] = [interrogationScene("inquiry")];
    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors).toEqual([]);

    const ast = result.scenes[0]?.ast;
    expect(ast?.kind).toBe("interrogationScene");

    if (ast?.kind !== "interrogationScene") return;
    const phase = ast.phases[0];
    expect(phase?.kind).toBe("inquiry");

    if (phase?.kind !== "inquiry") return;

    // Phase assetCue enriched with background ref
    expect(phase.assetCue?.backgroundAssetId).toBe(
      "background.chapter_1.interrogation_scene_2.p",
    );
    expect(ast.assetRefs).toContainEqual({
      type: "background",
      assetId: "background.chapter_1.interrogation_scene_2.p",
    });

    // Entry dialogue enriched — speaker portrait
    const entryLine = phase.entryDialogue[0];
    expect(entryLine?.kind).toBe("line");
    if (entryLine?.kind === "line") {
      expect(entryLine.portrait?.assetId).toBe(
        "portrait.hayasaka_akane.concerned",
      );
    }

    // Question answer dialogue enriched
    const question = phase.questions[0];
    const answerLine = question?.answerDialogue[0];
    expect(answerLine?.kind).toBe("line");
    if (answerLine?.kind === "line") {
      expect(answerLine.portrait?.assetId).toBe(
        "portrait.hayasaka_akane.standard",
      );
    }

    // Manifest has background + 2 portraits (entry + question)
    const manifestIds = result.manifest.entries.map((e) => e.assetId);
    expect(manifestIds).toContain(
      "background.chapter_1.interrogation_scene_2.p",
    );
    expect(manifestIds).toContain("portrait.hayasaka_akane.concerned");
    expect(manifestIds).toContain("portrait.hayasaka_akane.standard");
  });

  it("enriches testimony phase with assetCue, statements (onPress/onPresent/onWrongPresent), and results", () => {
    const scenes: SceneRecord[] = [interrogationScene("testimony")];
    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors).toEqual([]);

    const ast = result.scenes[0]?.ast;
    if (ast?.kind !== "interrogationScene") return;
    const phase = ast.phases[0];
    if (phase?.kind !== "testimony") return;

    // Phase assetCue enriched
    expect(phase.assetCue?.backgroundAssetId).toBe(
      "background.chapter_1.interrogation_scene_2.p",
    );

    // Statement onPress enriched
    const stmt = phase.statements[0];
    const pressLine = stmt?.onPress?.[0];
    expect(pressLine?.kind).toBe("line");
    if (pressLine?.kind === "line") {
      expect(pressLine.portrait?.assetId).toBe(
        "portrait.hayasaka_akane.concerned",
      );
    }

    // Statement onPresent enriched
    const presentLine = stmt?.onPresent?.[0];
    expect(presentLine?.kind).toBe("line");
    if (presentLine?.kind === "line") {
      expect(presentLine.portrait?.assetId).toBe(
        "portrait.hayasaka_akane.standard",
      );
    }

    // Statement onWrongPresent enriched
    const wrongLine = stmt?.onWrongPresent?.[0];
    expect(wrongLine?.kind).toBe("line");
    if (wrongLine?.kind === "line") {
      expect(wrongLine.portrait?.assetId).toBe(
        "portrait.hayasaka_akane.standard",
      );
    }

    // Result dialogue enriched
    const res = phase.results[0];
    const resultLine = res?.dialogue[0];
    expect(resultLine?.kind).toBe("line");
    if (resultLine?.kind === "line") {
      expect(resultLine.portrait?.assetId).toBe(
        "portrait.hayasaka_akane.standard",
      );
    }
  });

  it("enriches interrogation evidence and intro/outro dialogue", () => {
    const scenes: SceneRecord[] = [interrogationScene("inquiry")];
    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors).toEqual([]);

    const ast = result.scenes[0]?.ast;
    if (ast?.kind !== "interrogationScene") return;

    // Evidence enriched
    const evidence = ast.evidenceManifest[0];
    expect(evidence?.imageCue.imageAssetId).toBe("evidence.bloody_knife");

    // Intro enriched
    const introLine = ast.intro[0];
    expect(introLine?.kind).toBe("line");
    if (introLine?.kind === "line") {
      expect(introLine.portrait?.assetId).toBe(
        "portrait.hayasaka_akane.standard",
      );
    }

    // Outro enriched
    const outroLine = ast.outro.dialogue[0];
    expect(outroLine?.kind).toBe("line");
    if (outroLine?.kind === "line") {
      expect(outroLine.portrait?.assetId).toBe(
        "portrait.hayasaka_akane.standard",
      );
    }
  });
});

function interrogationScene(phaseKind: "inquiry" | "testimony"): SceneRecord {
  const subject = {
    id: "suspect",
    name: "嫌疑人",
    role: "嫌疑人",
    bio: "沉默。",
    sourceFile: "chapter_1/interrogation_scene_2.md",
    line: 10,
  };

  const basePhase = {
    id: "p",
    label: "問話",
    subject,
    required: true,
    status: "unlocked" as const,
    unlock: null,
    reveals: [],
    sceneTag: "詢問室",
    assetCue: {
      backgroundPrompt: "Dark interrogation room.",
      backgroundAssetId: null,
      bgm: { channel: "bgm", assetId: null },
      bgs: { channel: "bgs", assetId: null },
    },
    entryDialogue: [
      {
        kind: "line" as const,
        speaker: "早坂茜",
        expression: "concerned",
        portrait: null,
        text: "你為什麼在這裡？",
      },
    ],
    sourceFile: "chapter_1/interrogation_scene_2.md",
    line: 20,
  };

  if (phaseKind === "inquiry") {
    return {
      chapterId: "chapter_1",
      file: "interrogation_scene_2.md",
      ast: {
        kind: "interrogationScene",
        id: "interrogation_scene_2",
        title: "詢問",
        intro: [
          {
            kind: "line" as const,
            speaker: "早坂茜",
            expression: null,
            portrait: null,
            text: "開始吧。",
          },
        ],
        phases: [
          {
            ...basePhase,
            kind: "inquiry" as const,
            complete: "auto" as const,
            questions: [
              {
                id: "q1",
                label: "動機",
                kind: "question" as const,
                parentQuestionId: null,
                status: "unlocked" as const,
                required: true,
                unlock: null,
                reveals: [],
                answerDialogue: [
                  {
                    kind: "line" as const,
                    speaker: "早坂茜",
                    expression: null,
                    portrait: null,
                    text: "說吧。",
                  },
                ],
                onReask: null,
                sourceFile: "chapter_1/interrogation_scene_2.md",
                line: 30,
              },
            ],
          },
        ],
        evidenceManifest: [
          {
            id: "bloody_knife",
            name: "血刀",
            description: "A blood-stained knife.",
            details: "Found at the scene.",
            imageCue: {
              imagePrompt: "Blood-stained knife on transparent background.",
              imageAssetId: null,
            },
            onCollect: [],
            onReexamine: null,
            sourceFile: "chapter_1/interrogation_scene_2.md",
            line: 40,
          },
        ],
        statementManifest: [],
        outro: {
          unlock: "auto" as const,
          dialogue: [
            {
              kind: "line" as const,
              speaker: "早坂茜",
              expression: null,
              portrait: null,
              text: "結束了。",
            },
          ],
        },
        assetRefs: [],
        sourceFile: "chapter_1/interrogation_scene_2.md",
        line: 1,
      },
    };
  }

  return {
    chapterId: "chapter_1",
    file: "interrogation_scene_2.md",
    ast: {
      kind: "interrogationScene",
      id: "interrogation_scene_2",
      title: "證言",
      intro: [],
      phases: [
        {
          ...basePhase,
          kind: "testimony" as const,
          statements: [
            {
              id: "s1",
              label: "不在場證明",
              content: "我那時候在家。",
              contradiction: null,
              onCorrect: null,
              onWrong: null,
              onPress: [
                {
                  kind: "line" as const,
                  speaker: "早坂茜",
                  expression: "concerned",
                  portrait: null,
                  text: "確定嗎？",
                },
              ],
              onPresent: [
                {
                  kind: "line" as const,
                  speaker: "早坂茜",
                  expression: null,
                  portrait: null,
                  text: "看看這個。",
                },
              ],
              onWrongPresent: [
                {
                  kind: "line" as const,
                  speaker: "早坂茜",
                  expression: null,
                  portrait: null,
                  text: "這不對。",
                },
              ],
              reveals: [],
              sourceFile: "chapter_1/interrogation_scene_2.md",
              line: 50,
            },
          ],
          results: [
            {
              id: "r1",
              label: "真相",
              reveals: [],
              dialogue: [
                {
                  kind: "line" as const,
                  speaker: "早坂茜",
                  expression: null,
                  portrait: null,
                  text: "就是這樣。",
                },
              ],
              sourceFile: "chapter_1/interrogation_scene_2.md",
              line: 60,
            },
          ],
        },
      ],
      evidenceManifest: [],
      statementManifest: [],
      outro: { unlock: "auto" as const, dialogue: [] },
      assetRefs: [],
      sourceFile: "chapter_1/interrogation_scene_2.md",
      line: 1,
    },
  };
}
