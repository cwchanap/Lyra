import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { enrichScenesWithAssets } from "./enrich";
import { emitLinearScene } from "../emitter";
import type { AssetConfig } from "./config";
import type {
  ASTAnalysisBoard,
  ASTAnalysisScene,
  ASTInterrogationPhase,
  AnalysisSceneRecord,
  DialogueItem,
  VisualAssetCue,
} from "../types";
import type { SceneRecord } from "../validator";
import type { OrderedAssetScene } from "./enrich";

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

function visualCue(backgroundPrompt: string): VisualAssetCue {
  return {
    backgroundPrompt,
    backgroundAssetId: null,
    bgm: { channel: "bgm", assetId: "rain_mystery_low" },
    bgs: { channel: "bgs", assetId: "street_rain" },
  };
}

function linearSceneWithCue(id: string, cue: VisualAssetCue): SceneRecord {
  return {
    chapterId: "chapter_1",
    file: `${id}.md`,
    ast: {
      kind: "linearScene",
      id,
      title: id,
      summary: id,
      summaryAuthored: false,
      queue: [{ kind: "sceneTag", text: id, assetCue: cue }],
      assetRefs: [],
      sourceFile: `chapter_1/${id}.md`,
      line: 1,
    },
  };
}

function analysisSceneWithCue(
  id: string,
  cue: VisualAssetCue,
): AnalysisSceneRecord {
  const ast: ASTAnalysisScene = {
    kind: "analysisScene",
    id,
    title: id,
    summary: id,
    intro: [{ kind: "sceneTag", text: id, assetCue: cue }],
    boards: [],
    outro: [],
    assetRefs: [],
    sourceFile: `chapter_1/${id}.md`,
    line: 1,
  };
  return { chapterId: "chapter_1", file: `${id}.md`, ast };
}

type AnalysisDialogueCarrier = "intro" | "result dialogue" | "outro";

function analysisSceneWithDialogueCarrier(
  carrier: AnalysisDialogueCarrier,
  dialogue: DialogueItem[],
): AnalysisSceneRecord {
  const scene = analysisSceneWithCue(
    "analysis_scene_dialogue",
    visualCue("Analysis room."),
  );

  if (carrier === "intro") {
    return { ...scene, ast: { ...scene.ast, intro: dialogue } };
  }

  if (carrier === "outro") {
    return { ...scene, ast: { ...scene.ast, outro: dialogue } };
  }

  const board: ASTAnalysisBoard = {
    kind: "classify",
    id: "board",
    label: "Board",
    prompt: {
      value: "Choose the evidence.",
      sourceFile: "chapter_1/analysis_scene_dialogue.md",
      line: 2,
    },
    unlock: null,
    reveals: {
      value: [],
      sourceFile: "chapter_1/analysis_scene_dialogue.md",
      line: 3,
    },
    feedback: {
      incomplete: {
        value: "Incomplete.",
        sourceFile: "chapter_1/analysis_scene_dialogue.md",
        line: 4,
      },
      incorrect: {
        value: "Incorrect.",
        sourceFile: "chapter_1/analysis_scene_dialogue.md",
        line: 5,
      },
      hint: null,
      incorrectSelections: [],
    },
    cards: [],
    resultDialogue: dialogue,
    groups: [],
    sourceFile: "chapter_1/analysis_scene_dialogue.md",
    line: 1,
  };

  return { ...scene, ast: { ...scene.ast, boards: [board] } };
}

function noPortraitConfig(): AssetConfig {
  const configured = config();
  const narrator = {
    id: "narrator",
    displayNames: ["旁白"],
    portraitMode: "none" as const,
    visualPrompt: null,
    referenceAssetId: null,
    expressions: new Map(),
  };
  configured.characters.byId.set(narrator.id, narrator);
  configured.characters.byDisplayName.set("旁白", narrator);
  return configured;
}

function noPortraitLine(): Extract<DialogueItem, { kind: "line" }> {
  return {
    kind: "line",
    speaker: "旁白",
    expression: null,
    portrait: null,
    text: "雨夜，街道無人。",
  };
}

describe("enrichScenesWithAssets", () => {
  it("preserves manifest order when an analysis scene is the first visual cue", () => {
    const analysisScene = analysisSceneWithCue("analysis_scene_1", {
      ...visualCue("Analysis room."),
      bgm: null,
      bgs: null,
    });
    const scene = linearSceneWithCue("scene_2", visualCue("Hallway."));
    const orderedScenes: OrderedAssetScene[] = [
      { kind: "analysis", record: analysisScene },
      { kind: "scene", record: scene },
    ];

    const result = enrichScenesWithAssets({
      scenes: [scene],
      analysisScenes: [analysisScene],
      orderedScenes,
      config: config(),
    });

    expect(
      result.errors.filter((error) => error.code === "assetFirstCueMissingBgm"),
    ).toHaveLength(1);
    expect(
      result.errors.filter((error) => error.code === "assetFirstCueMissingBgs"),
    ).toHaveLength(1);
    // enrichAnalysisScene still writes the background ref even when BGM/BGS
    // are omitted on the first cue.
    expect(result.analysisScenes[0]?.ast.assetRefs).toContainEqual({
      type: "background",
      assetId: "background.chapter_1.analysis_scene_1.tag_001",
    });
  });

  it("keeps an analysis scene between ordinary scenes in manifest order", () => {
    const first = linearSceneWithCue("scene_1", visualCue("First."));
    const analysisScene = analysisSceneWithCue(
      "analysis_scene_2",
      visualCue("Analysis room."),
    );
    const last = linearSceneWithCue("scene_3", {
      ...visualCue("Last."),
      bgm: null,
      bgs: null,
    });
    const orderedScenes: OrderedAssetScene[] = [
      { kind: "scene", record: first },
      { kind: "analysis", record: analysisScene },
      { kind: "scene", record: last },
    ];

    const result = enrichScenesWithAssets({
      scenes: [first, last],
      analysisScenes: [analysisScene],
      orderedScenes,
      config: config(),
    });
    const backgroundIds = result.manifest.entries
      .filter((entry) => entry.type === "background")
      .map((entry) => entry.assetId);

    expect(backgroundIds).toEqual([
      "background.chapter_1.scene_1.tag_001",
      "background.chapter_1.analysis_scene_2.tag_001",
      "background.chapter_1.scene_3.tag_001",
    ]);
    expect(result.errors).toEqual([]);
    // enrichAnalysisScene writes background + audio refs for the full cue.
    expect(result.analysisScenes[0]?.ast.assetRefs).toContainEqual({
      type: "background",
      assetId: "background.chapter_1.analysis_scene_2.tag_001",
    });
    expect(result.analysisScenes[0]?.ast.assetRefs).toContainEqual({
      type: "audio",
      assetId: "audio.bgm.rain_mystery_low",
    });
    expect(result.analysisScenes[0]?.ast.assetRefs).toContainEqual({
      type: "audio",
      assetId: "audio.bgs.street_rain",
    });
  });

  it("strips analysis-scene cues, portraits, and assetRefs when assets are disabled", () => {
    const ast: ASTAnalysisScene = {
      kind: "analysisScene",
      id: "analysis_scene_disabled",
      title: "Disabled",
      summary: "Disabled",
      intro: [
        {
          kind: "sceneTag",
          text: "Analysis room",
          assetCue: visualCue("Analysis room."),
        },
        {
          kind: "line",
          speaker: "早坂茜",
          expression: "concerned",
          portrait: null,
          text: "線索在這裡。",
        },
      ],
      boards: [],
      outro: [],
      assetRefs: [],
      sourceFile: "chapter_1/analysis_scene_disabled.md",
      line: 1,
    };
    const analysisScene: AnalysisSceneRecord = {
      chapterId: "chapter_1",
      file: "analysis_scene_disabled.md",
      ast,
    };
    const disabled = { ...config(), enabled: false };

    const result = enrichScenesWithAssets({
      scenes: [],
      analysisScenes: [analysisScene],
      config: disabled,
    });

    expect(result.errors).toEqual([]);
    expect(result.manifest).toEqual({ enabled: false, entries: [] });
    const enriched = result.analysisScenes[0];
    expect(enriched?.ast.assetRefs).toEqual([]);
    const introTag =
      enriched?.ast.intro[0]?.kind === "sceneTag"
        ? enriched.ast.intro[0]
        : null;
    expect(introTag?.assetCue).toEqual({
      backgroundPrompt: null,
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    });
    const introLine =
      enriched?.ast.intro[1]?.kind === "line" ? enriched.ast.intro[1] : null;
    expect(introLine?.portrait).toBeNull();
  });

  it("adds background, portrait, evidence, audio refs, and manifest requests", () => {
    const scenes: SceneRecord[] = [
      {
        chapterId: "chapter_1",
        file: "scene_0.md",
        ast: {
          kind: "linearScene",
          id: "scene_0",
          title: "接案",
          summary: "接案",
          summaryAuthored: false,
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
          summary: "調查",
          summaryAuthored: false,
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
              sourceSublocationId: null,
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
          summary: "接案",
          summaryAuthored: false,
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

  it("errors for unknown speakers without expression when assets are enabled", () => {
    const scenes = [
      linearScene([
        {
          kind: "line",
          speaker: "未登錄人物",
          expression: null,
          portrait: null,
          text: "這個身分不在目錄中。",
        },
      ]),
    ];
    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors.some((e) => e.code === "assetUnknownSpeaker")).toBe(
      true,
    );
  });

  it.each(["intro", "result dialogue", "outro"] as const)(
    "errors for unknown speakers without expression in analysis %s",
    (carrier) => {
      const analysisScene = analysisSceneWithDialogueCarrier(carrier, [
        {
          kind: "line",
          speaker: "未登錄人物",
          expression: null,
          portrait: null,
          text: "這個身分不在目錄中。",
        },
      ]);

      const result = enrichScenesWithAssets({
        scenes: [],
        analysisScenes: [analysisScene],
        config: config(),
      });

      expect(result.errors.map((error) => error.code)).toContain(
        "assetUnknownSpeaker",
      );
    },
  );

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

  it.each([
    {
      carrier: "linear queue",
      run: () => {
        const result = enrichScenesWithAssets({
          scenes: [linearScene([noPortraitLine()])],
          config: noPortraitConfig(),
        });
        const scene = result.scenes[0]?.ast;
        return {
          result,
          line: scene?.kind === "linearScene" ? scene.queue[0] : undefined,
        };
      },
    },
    {
      carrier: "investigation dialogue carrier",
      run: () => {
        const scene = investigationScene({ imagePrompt: "Receipt." });
        if (scene.ast.kind !== "investigationScene") {
          throw new Error("Expected investigation scene fixture.");
        }
        scene.ast.intro = [noPortraitLine()];
        const result = enrichScenesWithAssets({
          scenes: [scene],
          config: noPortraitConfig(),
        });
        const enriched = result.scenes[0]?.ast;
        return {
          result,
          line:
            enriched?.kind === "investigationScene"
              ? enriched.intro[0]
              : undefined,
        };
      },
    },
    {
      carrier: "interrogation dialogue carrier",
      run: () => {
        const scene = interrogationScene();
        if (scene.ast.kind !== "interrogationScene") {
          throw new Error("Expected interrogation scene fixture.");
        }
        scene.ast.intro = [noPortraitLine()];
        const result = enrichScenesWithAssets({
          scenes: [scene],
          config: noPortraitConfig(),
        });
        const enriched = result.scenes[0]?.ast;
        return {
          result,
          line:
            enriched?.kind === "interrogationScene"
              ? enriched.intro[0]
              : undefined,
        };
      },
    },
    {
      carrier: "analysis Intro",
      run: () => {
        const analysisScene = analysisSceneWithDialogueCarrier("intro", [
          noPortraitLine(),
        ]);
        const result = enrichScenesWithAssets({
          scenes: [],
          analysisScenes: [analysisScene],
          config: noPortraitConfig(),
        });
        return { result, line: result.analysisScenes[0]?.ast.intro[0] };
      },
    },
    {
      carrier: "analysis Result Dialogue",
      run: () => {
        const analysisScene = analysisSceneWithDialogueCarrier(
          "result dialogue",
          [noPortraitLine()],
        );
        const result = enrichScenesWithAssets({
          scenes: [],
          analysisScenes: [analysisScene],
          config: noPortraitConfig(),
        });
        return {
          result,
          line: result.analysisScenes[0]?.ast.boards[0]?.resultDialogue[0],
        };
      },
    },
    {
      carrier: "analysis Outro",
      run: () => {
        const analysisScene = analysisSceneWithDialogueCarrier("outro", [
          noPortraitLine(),
        ]);
        const result = enrichScenesWithAssets({
          scenes: [],
          analysisScenes: [analysisScene],
          config: noPortraitConfig(),
        });
        return { result, line: result.analysisScenes[0]?.ast.outro[0] };
      },
    },
  ])(
    "keeps catalogued no-portrait speakers portraitless in $carrier",
    ({ run }) => {
      const { result, line } = run();
      const errorCodes = result.errors.map((error) => error.code);

      expect(errorCodes).not.toContain("assetUnknownSpeaker");
      expect(errorCodes).not.toContain("assetExpressionOnNoPortraitSpeaker");
      expect(line?.kind === "line" ? line.portrait : undefined).toBeNull();
    },
  );

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
        summary: "場景一",
        summaryAuthored: false,
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
        summary: "場景二",
        summaryAuthored: false,
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
          summary: "調查",
          summaryAuthored: false,
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
              status: "unlocked",
              unlock: null,
              reveals: [],
              sceneTag: "tag",
              sourceFile: "investigation_scene_1.md",
              line: 1,
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
          summary: "調查",
          summaryAuthored: false,
          intro: [],
          sublocations: [
            {
              id: "office",
              label: "辦公室",
              status: "unlocked",
              unlock: null,
              reveals: [],
              sceneTag: "tag",
              sourceFile: "investigation_scene_1.md",
              line: 1,
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
          summary: "調查",
          summaryAuthored: false,
          intro: [],
          sublocations: [
            {
              id: "office",
              label: "辦公室",
              status: "unlocked",
              unlock: null,
              reveals: [],
              sceneTag: "tag",
              sourceFile: "investigation_scene_1.md",
              line: 1,
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
          summary: "調查",
          summaryAuthored: false,
          intro: [],
          sublocations: [
            {
              id: "office",
              label: "辦公室",
              status: "unlocked",
              unlock: null,
              reveals: [],
              sceneTag: "tag",
              sourceFile: "investigation_scene_1.md",
              line: 1,
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
          summary: "調查",
          summaryAuthored: false,
          intro: [],
          sublocations: [
            {
              id: "office",
              label: "辦公室",
              status: "unlocked",
              unlock: null,
              reveals: [],
              sceneTag: "tag",
              sourceFile: "investigation_scene_1.md",
              line: 1,
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
    expect(portraitRefs[0]!.assetId).toBe("portrait.hayasaka_akane.standard");

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
          summary: "調查",
          summaryAuthored: false,
          intro: [],
          sublocations: [
            {
              id: "office",
              label: "辦公室",
              status: "unlocked",
              unlock: null,
              reveals: [],
              sceneTag: "tag",
              sourceFile: "investigation_scene_1.md",
              line: 1,
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
    expect(evidenceRefs[0]!.assetId).toBe("evidence.knife");
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
          summary: "調查",
          summaryAuthored: false,
          intro: [],
          sublocations: [
            {
              id: "office",
              label: "辦公室",
              status: "unlocked",
              unlock: null,
              reveals: [],
              sceneTag: "tag",
              sourceFile: "investigation_scene_1.md",
              line: 1,
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
    expect(bgRefs[0]!.assetId).toBe("background.chapter_1.crime_scene");
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
          summary: "調查",
          summaryAuthored: false,
          intro: [],
          sublocations: [
            {
              id: "office",
              label: "辦公室",
              status: "unlocked",
              unlock: null,
              reveals: [],
              sceneTag: "tag",
              sourceFile: "investigation_scene_1.md",
              line: 1,
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
    expect(result.errors[0]!.code).toBe("assetInvalidPortraitLayoutId");
    expect(result.errors[0]!.message).toContain("portrait.malformed");
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
          summary: "調查",
          summaryAuthored: false,
          intro: [],
          sublocations: [
            {
              id: "office",
              label: "辦公室",
              status: "unlocked",
              unlock: null,
              reveals: [],
              sceneTag: "tag",
              sourceFile: "investigation_scene_1.md",
              line: 1,
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
      summary: "接案",
      summaryAuthored: false,
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
      summary: "調查",
      summaryAuthored: false,
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
          sourceSublocationId: null,
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
      summary: "調查",
      summaryAuthored: false,
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
          sourceSublocationId: null,
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
          sourceSublocationId: null,
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
        summary: "Test",
        summaryAuthored: false,
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

  it("resolves expectedPath against repoRoot so files present on disk are not false-positive missing", () => {
    // Regression: after the --cwd packages/scripts migration, existsSync ran
    // against cwd (packages/scripts), not the repo root, so every asset file
    // was reported missing even when it existed. enrichScenesWithAssets must
    // resolve expectedPath against an explicit repoRoot.
    const repoRoot = mkdtempSync(join(tmpdir(), "lyra-enrich-reporoot-"));
    // Create a real audio file at <repoRoot>/static/assets/audio/bgm/<id>.ogg
    const bgmId = "bgm_real_file_xyz";
    const bgmRelPath = `static/assets/audio/bgm/${bgmId}.ogg`;
    mkdirSync(join(repoRoot, "static/assets/audio/bgm"), { recursive: true });
    writeFileSync(
      join(repoRoot, bgmRelPath),
      Buffer.from([0x4f, 0x67, 0x67, 0x53]),
    );

    const cfg: AssetConfig = {
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
      characters: { byId: new Map(), byDisplayName: new Map() },
      audio: {
        bgm: new Map([[bgmId, { id: bgmId, prompt: "music", loop: true }]]),
        bgs: new Map(),
        sfx: new Map(),
      },
    };

    const scene: SceneRecord = {
      chapterId: "chapter_repo_root_test",
      file: "scene_repo_root_test.md",
      ast: {
        kind: "linearScene",
        id: "scene_repo_root_test",
        title: "Test",
        summary: "Test",
        summaryAuthored: false,
        queue: [
          {
            kind: "sceneTag",
            text: "Street",
            assetCue: {
              backgroundPrompt: "city",
              backgroundAssetId: null,
              bgm: { channel: "bgm", assetId: bgmId },
              bgs: { channel: "bgs", assetId: null },
            },
          },
        ],
        assetRefs: [],
        sourceFile: "chapter_repo_root_test/scene_repo_root_test.md",
        line: 1,
      },
    };

    // Without repoRoot, the file is reported missing (cwd-relative lookup fails).
    const withoutRepoRoot = enrichScenesWithAssets({
      scenes: [scene],
      config: cfg,
    });
    expect(
      withoutRepoRoot.warnings.some(
        (w) =>
          w.code === "assetFileMissing" && w.sourceFile.includes(bgmRelPath),
      ),
    ).toBe(true);

    // With repoRoot pointing at the real file, no false-positive warning.
    const withRepoRoot = enrichScenesWithAssets({
      scenes: [scene],
      config: cfg,
      repoRoot,
    });
    const bgmWarnings = withRepoRoot.warnings.filter((w) =>
      w.sourceFile.includes(bgmRelPath),
    );
    expect(bgmWarnings).toEqual([]);
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
        summary: "Test",
        summaryAuthored: false,
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
  it("enriches inquiry phase assetCue, entryDialogue, and every question-testimony dialogue array", () => {
    const scenes: SceneRecord[] = [interrogationScene()];
    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors).toEqual([]);

    const ast = result.scenes[0]?.ast;
    expect(ast?.kind).toBe("interrogationScene");

    if (ast?.kind !== "interrogationScene") {
      throw new Error(
        `expected interrogationScene ast, got ${ast?.kind ?? "undefined"}`,
      );
    }
    const phase = ast.phases[0];

    if (phase?.kind !== "inquiry") {
      throw new Error(
        `expected inquiry phase, got ${phase?.kind ?? "undefined"}`,
      );
    }

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

    const testimony = phase.questions[0]?.testimony;

    // Testimony onLoop enriched
    const onLoopLine = testimony?.onLoop[0];
    expect(onLoopLine?.kind).toBe("line");
    if (onLoopLine?.kind === "line") {
      expect(onLoopLine.portrait?.assetId).toBe(
        "portrait.hayasaka_akane.standard",
      );
    }

    // Testimony defaultChallenge/defaultWrong enriched, staying non-null
    const defaultChallengeLine = testimony?.defaultChallenge?.[0];
    expect(defaultChallengeLine?.kind).toBe("line");
    if (defaultChallengeLine?.kind === "line") {
      expect(defaultChallengeLine.portrait?.assetId).toBe(
        "portrait.hayasaka_akane.concerned",
      );
    }
    const defaultWrongLine = testimony?.defaultWrong?.[0];
    expect(defaultWrongLine?.kind).toBe("line");
    if (defaultWrongLine?.kind === "line") {
      expect(defaultWrongLine.portrait?.assetId).toBe(
        "portrait.hayasaka_akane.standard",
      );
    }

    // Honest line (no Contradiction): content enriched, challenge/onCorrect/
    // onWrongEvidence stay null rather than becoming [].
    const honestLine = testimony?.lines[0];
    const honestContentLine = honestLine?.content[0];
    expect(honestContentLine?.kind).toBe("line");
    if (honestContentLine?.kind === "line") {
      expect(honestContentLine.portrait?.assetId).toBe(
        "portrait.hayasaka_akane.standard",
      );
    }
    expect(honestLine?.challenge).toBeNull();
    expect(honestLine?.onCorrect).toBeNull();
    expect(honestLine?.onWrongEvidence).toBeNull();

    // Contradiction line: content, challenge, onCorrect, onWrongEvidence all enriched
    const contradictionLine = testimony?.lines[1];
    const contentLine = contradictionLine?.content[0];
    expect(contentLine?.kind).toBe("line");
    if (contentLine?.kind === "line") {
      expect(contentLine.portrait?.assetId).toBe(
        "portrait.hayasaka_akane.standard",
      );
    }
    const challengeLine = contradictionLine?.challenge?.[0];
    expect(challengeLine?.kind).toBe("line");
    if (challengeLine?.kind === "line") {
      expect(challengeLine.portrait?.assetId).toBe(
        "portrait.hayasaka_akane.concerned",
      );
    }
    const onCorrectLine = contradictionLine?.onCorrect?.[0];
    expect(onCorrectLine?.kind).toBe("line");
    if (onCorrectLine?.kind === "line") {
      expect(onCorrectLine.portrait?.assetId).toBe(
        "portrait.hayasaka_akane.standard",
      );
    }
    const onWrongEvidenceLine = contradictionLine?.onWrongEvidence?.[0];
    expect(onWrongEvidenceLine?.kind).toBe("line");
    if (onWrongEvidenceLine?.kind === "line") {
      expect(onWrongEvidenceLine.portrait?.assetId).toBe(
        "portrait.hayasaka_akane.standard",
      );
    }

    // Manifest has background + both portrait expressions used above
    const manifestIds = result.manifest.entries.map((e) => e.assetId);
    expect(manifestIds).toContain(
      "background.chapter_1.interrogation_scene_2.p",
    );
    expect(manifestIds).toContain("portrait.hayasaka_akane.concerned");
    expect(manifestIds).toContain("portrait.hayasaka_akane.standard");
  });

  it("enriches interrogation evidence and intro/outro dialogue", () => {
    const scenes: SceneRecord[] = [interrogationScene()];
    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors).toEqual([]);

    const ast = result.scenes[0]?.ast;
    if (ast?.kind !== "interrogationScene") {
      throw new Error(
        `expected interrogationScene ast, got ${ast?.kind ?? "undefined"}`,
      );
    }

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

function interrogationScene(): SceneRecord {
  const subject = {
    id: "suspect",
    name: "嫌疑人",
    role: "嫌疑人",
    bio: "沉默。",
    sourceFile: "chapter_1/interrogation_scene_2.md",
    line: 10,
  };

  return {
    chapterId: "chapter_1",
    file: "interrogation_scene_2.md",
    ast: {
      kind: "interrogationScene",
      id: "interrogation_scene_2",
      title: "詢問",
      summary: "詢問",
      summaryAuthored: false,
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
          kind: "inquiry" as const,
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
          complete: "auto" as const,
          questions: [
            {
              id: "q1",
              label: "動機",
              status: "unlocked" as const,
              required: true,
              unlock: null,
              reveals: [],
              testimony: {
                onLoop: [
                  {
                    kind: "line" as const,
                    speaker: "早坂茜",
                    expression: null,
                    portrait: null,
                    text: "還有哪裡對不上，再說一次。",
                  },
                ],
                loopPrompt: null,
                defaultChallenge: [
                  {
                    kind: "line" as const,
                    speaker: "早坂茜",
                    expression: "concerned",
                    portrait: null,
                    text: "等等，這句話讓我想想。",
                  },
                ],
                defaultWrong: [
                  {
                    kind: "line" as const,
                    speaker: "早坂茜",
                    expression: null,
                    portrait: null,
                    text: "這句話沒問題吧？",
                  },
                ],
                wrongReply: null,
                lines: [
                  {
                    id: "l_honest",
                    label: "老實的說法",
                    content: [
                      {
                        kind: "line" as const,
                        speaker: "早坂茜",
                        expression: null,
                        portrait: null,
                        text: "八點就下班了。",
                      },
                    ],
                    contradiction: null,
                    challenge: null,
                    onCorrect: null,
                    onWrongEvidence: null,
                    reveals: [],
                    sourceFile: "chapter_1/interrogation_scene_2.md",
                    line: 31,
                  },
                  {
                    id: "l_contradiction",
                    label: "矛盾的說法",
                    content: [
                      {
                        kind: "line" as const,
                        speaker: "早坂茜",
                        expression: null,
                        portrait: null,
                        text: "那台機器我根本沒碰過。",
                      },
                    ],
                    contradiction: { kind: "evidence", id: "bloody_knife" },
                    challenge: [
                      {
                        kind: "line" as const,
                        speaker: "早坂茜",
                        expression: "concerned",
                        portrait: null,
                        text: "這句話對不上。",
                      },
                    ],
                    onCorrect: [
                      {
                        kind: "line" as const,
                        speaker: "早坂茜",
                        expression: null,
                        portrait: null,
                        text: "好吧，我碰過。",
                      },
                    ],
                    onWrongEvidence: [
                      {
                        kind: "line" as const,
                        speaker: "早坂茜",
                        expression: null,
                        portrait: null,
                        text: "這能證明什麼？",
                      },
                    ],
                    reveals: [],
                    sourceFile: "chapter_1/interrogation_scene_2.md",
                    line: 32,
                  },
                ],
                sourceFile: "chapter_1/interrogation_scene_2.md",
                line: 30,
              },
              sourceFile: "chapter_1/interrogation_scene_2.md",
              line: 30,
            },
          ],
          sourceFile: "chapter_1/interrogation_scene_2.md",
          line: 20,
        } as ASTInterrogationPhase,
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
          sourceSublocationId: null,
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
