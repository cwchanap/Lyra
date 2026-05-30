import { describe, expect, it } from "bun:test";
import { emitChaptersIndex, emitInterrogationScene, emitInvestigationScene, emitLinearScene } from "./emitter";
import type {
  ASTChapter,
  ASTInterrogationScene,
  ASTInvestigationScene,
  ASTLinearScene,
  JSONChaptersIndex,
} from "./types";

describe("emitter", () => {
  it("emits a linear scene JSON", () => {
    const ast: ASTLinearScene = {
      kind: "linearScene",
      id: "scene_0",
      title: "接案",
      queue: [
        { kind: "sceneTag", text: "街道" },
        { kind: "line", speaker: "A", text: "hi" },
        { kind: "line", speaker: "B", text: "worried", expression: "concerned" },
      ],
      assetRefs: [{ type: "background", assetId: "bg_street" }],
      sourceFile: "scene_0.md",
      line: 1,
    };
    const json = emitLinearScene(ast);
    expect(json).toEqual({
      type: "linear",
      id: "scene_0",
      title: "接案",
      queue: [
        { kind: "sceneTag", text: "街道" },
        { kind: "line", speaker: "A", text: "hi", expression: null, portrait: null },
        { kind: "line", speaker: "B", text: "worried", expression: "concerned", portrait: null },
      ],
      assetRefs: [{ type: "background", assetId: "bg_street" }],
    });
  });

  it("emits an investigation scene JSON with auto outro preserved", () => {
    const ast: ASTInvestigationScene = {
      kind: "investigationScene",
      id: "i",
      title: "t",
      intro: [],
      sublocations: [{
        id: "room",
        label: "Room",
        status: "unlocked",
        unlock: null,
        reveals: [],
        sceneTag: "a room",
        assetCue: {
          backgroundPrompt: "rainy room",
          backgroundAssetId: "bg_room",
          bgm: { channel: "bgm", assetId: "music_room" },
          bgs: { channel: "bgs", assetId: null },
        },
        transitionDialogue: [],
        hotspots: [],
        characters: [],
        sourceFile: "i.md",
        line: 4,
      }],
      evidenceManifest: [{
        id: "photo",
        name: "Photo",
        description: "A photo.",
        details: "Photo details.",
        imageCue: {
          imagePrompt: "wet photo",
          imageAssetId: "evidence_photo",
        },
        onCollect: [],
        onReexamine: null,
        sourceFile: "i.md",
        line: 12,
      }],
      statementManifest: [],
      outro: { unlock: "auto", dialogue: [] },
      assetRefs: [{ type: "evidence", assetId: "evidence_photo" }],
      sourceFile: "i.md",
      line: 1,
    };
    const json = emitInvestigationScene(ast);
    expect(json.outro.unlock).toBe("auto");
    expect(json.type).toBe("investigation");
    expect(json.assetRefs).toEqual([{ type: "evidence", assetId: "evidence_photo" }]);
    expect(json.sublocations[0]?.assetCue).toEqual({
      backgroundPrompt: "rainy room",
      backgroundAssetId: "bg_room",
      bgm: { channel: "bgm", assetId: "music_room" },
      bgs: { channel: "bgs", assetId: null },
    });
    expect(json.evidenceManifest[0]?.imageCue).toEqual({
      imagePrompt: "wet photo",
      imageAssetId: "evidence_photo",
    });
  });

  it("emits interrogation scene JSON", () => {
    const ast: ASTInterrogationScene = {
      kind: "interrogationScene",
      id: "interrogation_scene_1",
      title: "詢問",
      intro: [],
      phases: [{
        kind: "inquiry",
        id: "p",
        label: "問話",
        subject: { id: "suspect", name: "嫌疑人", role: "嫌疑人", bio: "沉默。", sourceFile: "x", line: 4 },
        required: true,
        status: "unlocked",
        unlock: null,
        reveals: [],
        sceneTag: "詢問室",
        assetCue: {
          backgroundPrompt: null,
          backgroundAssetId: "bg_interrogation_room",
          bgm: null,
          bgs: { channel: "bgs", assetId: "rain_loop" },
        },
        entryDialogue: [],
        complete: "auto",
        questions: [],
        sourceFile: "x",
        line: 2,
      }],
      evidenceManifest: [{
        id: "recording",
        name: "錄音",
        description: "走廊錄音。",
        details: "有雨聲。",
        imageCue: {
          imagePrompt: null,
          imageAssetId: "evidence_recording",
        },
        onCollect: [],
        onReexamine: null,
        sourceFile: "x",
        line: 8,
      }],
      statementManifest: [],
      outro: { unlock: "auto", dialogue: [] },
      assetRefs: [{ type: "audio", assetId: "rain_loop" }],
      sourceFile: "x",
      line: 1,
    };
    expect(emitInterrogationScene(ast)).toMatchObject({
      type: "interrogation",
      id: "interrogation_scene_1",
      assetRefs: [{ type: "audio", assetId: "rain_loop" }],
      phases: [{
        kind: "inquiry",
        id: "p",
        subject: { id: "suspect" },
        assetCue: {
          backgroundPrompt: null,
          backgroundAssetId: "bg_interrogation_room",
          bgm: null,
          bgs: { channel: "bgs", assetId: "rain_loop" },
        },
      }],
      evidenceManifest: [{
        id: "recording",
        imageCue: {
          imagePrompt: null,
          imageAssetId: "evidence_recording",
        },
      }],
    });
  });

  it("emits a chapters index", () => {
    const chapter: ASTChapter = {
      kind: "chapter",
      dirName: "chapter_1",
      number: 1,
      title: "t",
      summary: "s",
      sceneFiles: ["scene_0.md", "investigation_scene_1.md", "interrogation_scene_2.md"],
      sourceFile: "chapter_1/chapter.md",
      line: 1,
    };
    const idx: JSONChaptersIndex = emitChaptersIndex([chapter]);
    expect(idx).toEqual({
      chapters: [
        {
          id: "chapter_1",
          title: "t",
          summary: "s",
          scenes: [
            { type: "linear", file: "chapter_1/scene_0.json" },
            { type: "investigation", file: "chapter_1/investigation_scene_1.json" },
            { type: "interrogation", file: "chapter_1/interrogation_scene_2.json" },
          ],
        },
      ],
    });
  });
});
