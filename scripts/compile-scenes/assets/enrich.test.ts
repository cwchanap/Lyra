import { describe, expect, it } from "bun:test";
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
    const linear = result.scenes[0]?.ast.kind === "linearScene" ? result.scenes[0].ast : null;
    const firstTag = linear?.queue[0]?.kind === "sceneTag" ? linear.queue[0] : null;
    const secondTag = linear?.queue[2]?.kind === "sceneTag" ? linear.queue[2] : null;
    const emitted = linear ? emitLinearScene(linear) : null;
    const emittedFirstTag = emitted?.queue[0]?.kind === "sceneTag" ? emitted.queue[0] : null;

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
    expect(firstTag?.assetCue?.bgm).toEqual({ channel: "bgm", assetId: "audio.bgm.rain_mystery_low" });
    expect(firstTag?.assetCue?.bgs).toEqual({ channel: "bgs", assetId: "audio.bgs.street_rain" });
    expect(secondTag?.assetCue?.bgm).toEqual({ channel: "bgm", assetId: null });
    expect(emittedFirstTag?.assetCue?.bgm).toEqual({ channel: "bgm", assetId: "audio.bgm.rain_mystery_low" });
    expect(emittedFirstTag?.assetCue?.bgs).toEqual({ channel: "bgs", assetId: "audio.bgs.street_rain" });
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

  it("errors for unknown expressions", () => {
    const scenes = [linearScene([
      { kind: "line", speaker: "早坂茜", expression: "angry", portrait: null, text: "hi" },
    ])];
    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors.some((e) => e.code === "assetUnknownExpression")).toBe(true);
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
    const scenes = [linearScene([
      { kind: "line", speaker: "旁白", expression: "concerned", portrait: null, text: "hi" },
    ])];
    const result = enrichScenesWithAssets({ scenes, config: noPortraitConfig });
    expect(result.errors.some((e) => e.code === "assetExpressionOnNoPortraitSpeaker")).toBe(true);
    const line = result.scenes[0]?.ast.kind === "linearScene" ? result.scenes[0].ast.queue[0] : null;
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
    const scenes = [linearScene([
      { kind: "line", speaker: "旁白", expression: null, portrait: null, text: "hi" },
    ])];
    const result = enrichScenesWithAssets({ scenes, config: noPortraitConfig });
    expect(result.errors.some((e) => e.code === "assetExpressionOnNoPortraitSpeaker")).toBe(false);
  });

  it("errors for unknown audio while still reporting missing background prompts", () => {
    const scenes = [linearScene([
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
    ])];
    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors.map((e) => e.code)).toContain("assetMissingBackgroundPrompt");
    expect(result.errors.filter((e) => e.code === "assetUnknownAudio")).toHaveLength(2);
    expect(result.scenes[0]?.ast.assetRefs).toEqual([]);
    expect(result.manifest.entries).toEqual([]);
  });

  it("errors for missing evidence image prompts", () => {
    const scenes = [investigationScene({ imagePrompt: null })];
    const result = enrichScenesWithAssets({ scenes, config: config() });
    expect(result.errors.some((e) => e.code === "assetMissingEvidenceImagePrompt")).toBe(true);
    expect(result.scenes[0]?.ast.assetRefs).toEqual([]);
    expect(result.manifest.entries).toEqual([]);
  });

  it("returns empty manifest and asset refs when assets are disabled", () => {
    const disabled = { ...config(), enabled: false };
    const scenes = [
      linearScene([{
        kind: "sceneTag",
        text: "咖啡館外",
        assetCue: {
          backgroundPrompt: "Rainy Tokyo cafe exterior.",
          backgroundAssetId: null,
          bgm: { channel: "bgm", assetId: "rain_mystery_low" },
          bgs: { channel: "bgs", assetId: "street_rain" },
        },
      }]),
      investigationScene({ imagePrompt: "Cafe receipt isolated on transparent background." }),
    ];
    const result = enrichScenesWithAssets({ scenes, config: disabled });
    expect(result.errors).toEqual([]);
    expect(result.manifest).toEqual({ enabled: false, entries: [] });
    expect(result.scenes.map((scene) => scene.ast.assetRefs)).toEqual([[], []]);
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

function investigationScene(input: { imagePrompt: string | null }): SceneRecord {
  return {
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
          imagePrompt: input.imagePrompt,
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
        background: { dimensions: [1920, 1080], format: "png", transparency: false, prompt: "wide bg" },
        portrait: { dimensions: [768, 1024], format: "png", transparency: true, prompt: "portrait" },
        evidence: { dimensions: [512, 512], format: "png", transparency: true, prompt: "evidence" },
        audio: { format: "ogg", loop: true, prompt: "" },
      },
      characters: {
        byId: new Map([[character.id, character]]),
        byDisplayName: new Map([["測試角色", character]]),
      },
      audio: {
        bgm: new Map([["nonexistent_bgm_a1b2c3", { id: "nonexistent_bgm_a1b2c3", prompt: "music", loop: true }]]),
        bgs: new Map(),
      },
    };
  }

  it("emits warnings for manifest entries whose expected files do not exist", () => {
    const cfg = fakeFileConfig();
    const scene: SceneRecord = {
      chapterId: "chapter_1",
      file: "scene_0.md",
      ast: {
        kind: "linearScene",
        id: "scene_0",
        title: "Test",
        queue: [
          { kind: "sceneTag", text: "Street", assetCue: { backgroundPrompt: "city", backgroundAssetId: null, bgm: { channel: "bgm", assetId: "nonexistent_bgm_a1b2c3" }, bgs: { channel: "bgs", assetId: null } } },
          { kind: "line", speaker: "測試角色", text: "Hi", expression: "concerned", portrait: null },
        ],
        assetRefs: [],
        sourceFile: "chapter_1/scene_0.md",
        line: 1,
      },
    };
    const result = enrichScenesWithAssets({ scenes: [scene], config: cfg });
    expect(result.errors.length).toBe(0);
    // The asset files don't exist on disk, so we should get warnings
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.every((w) => w.code === "assetFileMissing")).toBe(true);
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
        background: { dimensions: [1920, 1080], format: "png", transparency: false, prompt: "" },
        portrait: { dimensions: [768, 1024], format: "png", transparency: true, prompt: "" },
        evidence: { dimensions: [512, 512], format: "png", transparency: true, prompt: "" },
        audio: { format: "ogg", loop: true, prompt: "" },
      },
      characters: { byId: new Map(), byDisplayName: new Map() },
      audio: { bgm: new Map(), bgs: new Map() },
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
    const result = enrichScenesWithAssets({ scenes: [scene], config: disabledConfig });
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
    expect(phase.assetCue?.backgroundAssetId).toBe("background.chapter_1.interrogation_scene_2.p");
    expect(ast.assetRefs).toContainEqual({
      type: "background",
      assetId: "background.chapter_1.interrogation_scene_2.p",
    });

    // Entry dialogue enriched — speaker portrait
    const entryLine = phase.entryDialogue[0];
    expect(entryLine?.kind).toBe("line");
    if (entryLine?.kind === "line") {
      expect(entryLine.portrait?.assetId).toBe("portrait.hayasaka_akane.concerned");
    }

    // Question answer dialogue enriched
    const question = phase.questions[0];
    const answerLine = question?.answerDialogue[0];
    expect(answerLine?.kind).toBe("line");
    if (answerLine?.kind === "line") {
      expect(answerLine.portrait?.assetId).toBe("portrait.hayasaka_akane.standard");
    }

    // Manifest has background + 2 portraits (entry + question)
    const manifestIds = result.manifest.entries.map((e) => e.assetId);
    expect(manifestIds).toContain("background.chapter_1.interrogation_scene_2.p");
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
    expect(phase.assetCue?.backgroundAssetId).toBe("background.chapter_1.interrogation_scene_2.p");

    // Statement onPress enriched
    const stmt = phase.statements[0];
    const pressLine = stmt?.onPress?.[0];
    expect(pressLine?.kind).toBe("line");
    if (pressLine?.kind === "line") {
      expect(pressLine.portrait?.assetId).toBe("portrait.hayasaka_akane.concerned");
    }

    // Statement onPresent enriched
    const presentLine = stmt?.onPresent?.[0];
    expect(presentLine?.kind).toBe("line");
    if (presentLine?.kind === "line") {
      expect(presentLine.portrait?.assetId).toBe("portrait.hayasaka_akane.standard");
    }

    // Statement onWrongPresent enriched
    const wrongLine = stmt?.onWrongPresent?.[0];
    expect(wrongLine?.kind).toBe("line");
    if (wrongLine?.kind === "line") {
      expect(wrongLine.portrait?.assetId).toBe("portrait.hayasaka_akane.standard");
    }

    // Result dialogue enriched
    const res = phase.results[0];
    const resultLine = res?.dialogue[0];
    expect(resultLine?.kind).toBe("line");
    if (resultLine?.kind === "line") {
      expect(resultLine.portrait?.assetId).toBe("portrait.hayasaka_akane.standard");
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
      expect(introLine.portrait?.assetId).toBe("portrait.hayasaka_akane.standard");
    }

    // Outro enriched
    const outroLine = ast.outro.dialogue[0];
    expect(outroLine?.kind).toBe("line");
    if (outroLine?.kind === "line") {
      expect(outroLine.portrait?.assetId).toBe("portrait.hayasaka_akane.standard");
    }
  });
});

function interrogationScene(phaseKind: "inquiry" | "testimony"): SceneRecord {
  const subject = { id: "suspect", name: "嫌疑人", role: "嫌疑人", bio: "沉默。", sourceFile: "chapter_1/interrogation_scene_2.md", line: 10 };

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
      { kind: "line" as const, speaker: "早坂茜", expression: "concerned", portrait: null, text: "你為什麼在這裡？" },
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
          { kind: "line" as const, speaker: "早坂茜", expression: null, portrait: null, text: "開始吧。" },
        ],
        phases: [{
          ...basePhase,
          kind: "inquiry" as const,
          complete: "auto" as const,
          questions: [{
            id: "q1",
            label: "動機",
            kind: "question" as const,
            parentQuestionId: null,
            status: "unlocked" as const,
            required: true,
            unlock: null,
            reveals: [],
            answerDialogue: [
              { kind: "line" as const, speaker: "早坂茜", expression: null, portrait: null, text: "說吧。" },
            ],
            onReask: null,
            sourceFile: "chapter_1/interrogation_scene_2.md",
            line: 30,
          }],
        }],
        evidenceManifest: [{
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
        }],
        statementManifest: [],
        outro: {
          unlock: "auto" as const,
          dialogue: [
            { kind: "line" as const, speaker: "早坂茜", expression: null, portrait: null, text: "結束了。" },
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
      phases: [{
        ...basePhase,
        kind: "testimony" as const,
        statements: [{
          id: "s1",
          label: "不在場證明",
          content: "我那時候在家。",
          contradiction: null,
          onCorrect: null,
          onWrong: null,
          onPress: [
            { kind: "line" as const, speaker: "早坂茜", expression: "concerned", portrait: null, text: "確定嗎？" },
          ],
          onPresent: [
            { kind: "line" as const, speaker: "早坂茜", expression: null, portrait: null, text: "看看這個。" },
          ],
          onWrongPresent: [
            { kind: "line" as const, speaker: "早坂茜", expression: null, portrait: null, text: "這不對。" },
          ],
          reveals: [],
          sourceFile: "chapter_1/interrogation_scene_2.md",
          line: 50,
        }],
        results: [{
          id: "r1",
          label: "真相",
          reveals: [],
          dialogue: [
            { kind: "line" as const, speaker: "早坂茜", expression: null, portrait: null, text: "就是這樣。" },
          ],
          sourceFile: "chapter_1/interrogation_scene_2.md",
          line: 60,
        }],
      }],
      evidenceManifest: [],
      statementManifest: [],
      outro: { unlock: "auto" as const, dialogue: [] },
      assetRefs: [],
      sourceFile: "chapter_1/interrogation_scene_2.md",
      line: 1,
    },
  };
}
