// =============================================================================
// packages/scripts/compile-scenes/assets/prompt-source.test.ts
//
// HPA-135 Task 1.4: scene-owned background/evidence manifest sources carry
// the exact authored prompt line + literal authored prompt. The Workbench
// consumes the manifest's actual unitId (including tag_NNN) — it never
// reconstructs enrichment tag counting.
// =============================================================================

import { describe, expect, it } from "vitest";
import { enrichScenesWithAssets } from "./enrich";
import type { AssetConfig } from "./config";
import type { ASTInvestigationScene, VisualAssetCue } from "../types";
import type { SceneRecord } from "../validator";

function config(): AssetConfig {
  const honestSuspect = {
    id: "miyake_sota",
    displayNames: ["三宅蒼太"],
    portraitMode: "none" as const,
    visualPrompt: null,
    referenceAssetId: null,
    expressions: new Map(),
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
      byId: new Map([[honestSuspect.id, honestSuspect]]),
      byDisplayName: new Map([["三宅蒼太", honestSuspect]]),
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

function cue(backgroundPrompt: string, promptLine: number): VisualAssetCue {
  return {
    backgroundPrompt,
    backgroundPromptLine: promptLine,
    backgroundAssetId: null,
    bgm: { channel: "bgm", assetId: "rain_mystery_low" },
    bgs: { channel: "bgs", assetId: "street_rain" },
  };
}

function linearSceneWithCue(id: string, sceneCue: VisualAssetCue): SceneRecord {
  return {
    chapterId: "chapter_1",
    file: `${id}.md`,
    ast: {
      kind: "linearScene",
      id,
      title: id,
      summary: id,
      summaryAuthored: false,
      queue: [{ kind: "sceneTag", text: id, assetCue: sceneCue }],
      assetRefs: [],
      sourceFile: `chapter_1/${id}.md`,
      line: 1,
    },
  };
}

function investigationScene(input: {
  sublocationCue: VisualAssetCue;
  evidenceImagePrompt: string;
  evidenceImagePromptLine: number;
}): SceneRecord {
  const ast: ASTInvestigationScene = {
    kind: "investigationScene",
    id: "investigation_scene_1",
    title: "調查",
    summary: "調查",
    summaryAuthored: false,
    mapId: null,
    intro: [],
    sublocations: [
      {
        id: "security_room",
        label: "警衛室",
        status: "unlocked",
        unlock: null,
        reveals: [],
        sceneTag: "警衛室",
        assetCue: input.sublocationCue,
        transitionDialogue: [],
        hotspots: [
          {
            id: "cctv_playback",
            label: "監視器回放",
            description: "A wall of monitors.",
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
        ],
        characters: [],
        sourceFile: "chapter_1/investigation_scene_1.md",
        line: 9,
      },
    ],
    evidenceManifest: [
      {
        id: "cctv_still",
        name: "監視器畫面",
        description: "A still from the lobby camera.",
        details: "Timestamped 23:09.",
        imageCue: {
          imagePrompt: input.evidenceImagePrompt,
          imagePromptLine: input.evidenceImagePromptLine,
          imageAssetId: null,
        },
        sourceSublocationId: "security_room",
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
  };
  return { chapterId: "chapter_1", file: "investigation_scene_1.md", ast };
}

function interrogationSceneWithPhaseCue(phaseCue: VisualAssetCue): SceneRecord {
  return {
    chapterId: "chapter_1",
    file: "interrogation_scene_2.md",
    ast: {
      kind: "interrogationScene",
      id: "interrogation_scene_2",
      title: "詢問",
      summary: "詢問",
      summaryAuthored: false,
      intro: [],
      phases: [
        {
          kind: "inquiry",
          id: "p",
          label: "問話",
          subject: {
            id: "suspect",
            name: "三宅蒼太",
            role: "嫌疑人",
            bio: "沉默。",
            portrait: null,
            sourceFile: "chapter_1/interrogation_scene_2.md",
            line: 10,
          },
          required: true,
          status: "unlocked",
          unlock: null,
          reveals: [],
          sceneTag: "詢問室",
          assetCue: phaseCue,
          entryDialogue: [],
          complete: "auto",
          questions: [
            {
              id: "q1",
              label: "動機",
              status: "unlocked",
              required: true,
              unlock: null,
              reveals: [],
              testimony: {
                onLoop: [
                  {
                    kind: "line",
                    speaker: "三宅蒼太",
                    text: "我只是去拿咖啡豆。",
                    portrait: null,
                  },
                ],
                loopPrompt: null,
                defaultChallenge: null,
                defaultWrong: null,
                wrongReply: null,
                lines: [
                  {
                    id: "l1",
                    label: "說詞",
                    content: [
                      {
                        kind: "line",
                        speaker: "三宅蒼太",
                        text: "我一直沒有離開店裡。",
                        portrait: null,
                      },
                    ],
                    contradiction: null,
                    challenge: null,
                    onCorrect: null,
                    onWrongEvidence: null,
                    reveals: [],
                    sourceFile: "chapter_1/interrogation_scene_2.md",
                    line: 20,
                  },
                ],
                sourceFile: "chapter_1/interrogation_scene_2.md",
                line: 14,
              },
              sourceFile: "chapter_1/interrogation_scene_2.md",
              line: 12,
            },
          ],
          sourceFile: "chapter_1/interrogation_scene_2.md",
          line: 4,
        },
      ],
      evidenceManifest: [],
      statementManifest: [],
      outro: { unlock: "auto", dialogue: [] },
      assetRefs: [],
      sourceFile: "chapter_1/interrogation_scene_2.md",
      line: 1,
    },
  };
}

describe("scene-owned prompt identity in the typed asset manifest", () => {
  it("carries unitId + promptLine + authoredPrompt for scene-tag backgrounds", () => {
    const result = enrichScenesWithAssets({
      scenes: [linearSceneWithCue("scene_1", cue("Rainy street.", 12))],
      config: config(),
    });
    expect(result.errors).toEqual([]);
    const entry = result.manifest.entries.find(
      ({ assetId }) => assetId === "background.chapter_1.scene_1.tag_001",
    );
    if (entry?.type !== "background")
      throw new Error("expected background entry");
    expect(entry.source).toEqual({
      chapterId: "chapter_1",
      sceneId: "scene_1",
      unitId: "tag_001",
      promptLine: 12,
      authoredPrompt: "Rainy street.",
    });
  });

  it("keeps authoredPrompt literal while entryPrompt carries guidance suffix", () => {
    const result = enrichScenesWithAssets({
      scenes: [
        investigationScene({
          sublocationCue: cue("Rain-soaked office security room.", 6),
          evidenceImagePrompt: "A still from the lobby camera.",
          evidenceImagePromptLine: 17,
        }),
      ],
      config: config(),
    });
    expect(result.errors).toEqual([]);
    const entry = result.manifest.entries.find(
      ({ assetId }) =>
        assetId === "background.chapter_1.investigation_scene_1.security_room",
    );
    if (entry?.type !== "background")
      throw new Error("expected background entry");
    const source = entry.source;
    if (!("unitId" in source)) throw new Error("expected scene-owned source");
    // source.authoredPrompt stays the literal authored metadata value...
    expect(source).toEqual({
      chapterId: "chapter_1",
      sceneId: "investigation_scene_1",
      unitId: "security_room",
      promptLine: 6,
      authoredPrompt: "Rain-soaked office security room.",
    });
    // ...while promptParts.entryPrompt may append enrichment guidance.
    expect(entry.promptParts.entryPrompt).toContain(
      "Rain-soaked office security room.",
    );
    expect(entry.promptParts.entryPrompt).toContain(
      "Investigation source guidance:",
    );
    expect(entry.promptParts.entryPrompt).not.toBe(source.authoredPrompt);
  });

  it("carries unitId + promptLine + authoredPrompt for interrogation phases", () => {
    const result = enrichScenesWithAssets({
      scenes: [
        interrogationSceneWithPhaseCue(cue("Dark interrogation room.", 7)),
      ],
      config: config(),
    });
    expect(result.errors).toEqual([]);
    const entry = result.manifest.entries.find(
      ({ assetId }) =>
        assetId === "background.chapter_1.interrogation_scene_2.p",
    );
    if (entry?.type !== "background")
      throw new Error("expected background entry");
    expect(entry.source).toEqual({
      chapterId: "chapter_1",
      sceneId: "interrogation_scene_2",
      unitId: "p",
      promptLine: 7,
      authoredPrompt: "Dark interrogation room.",
    });
  });

  it("carries evidenceId + promptLine + authoredPrompt for evidence image prompts", () => {
    const result = enrichScenesWithAssets({
      scenes: [
        investigationScene({
          sublocationCue: cue("Rain-soaked office security room.", 6),
          evidenceImagePrompt: "A still from the lobby camera.",
          evidenceImagePromptLine: 17,
        }),
      ],
      config: config(),
    });
    expect(result.errors).toEqual([]);
    const entry = result.manifest.entries.find(
      ({ assetId }) => assetId === "evidence.cctv_still",
    );
    if (entry?.type !== "evidence") throw new Error("expected evidence entry");
    expect(entry.source).toEqual({
      chapterId: "chapter_1",
      sceneId: "investigation_scene_1",
      evidenceId: "cctv_still",
      promptLine: 17,
      authoredPrompt: "A still from the lobby camera.",
    });
  });
});
