import { describe, expect, it } from "bun:test";
import { emitChaptersIndex, emitInterrogationScene, emitInvestigationScene, emitLinearScene } from "./emitter";
import type { ASTChapter, ASTInterrogationScene, ASTInvestigationScene, ASTLinearScene } from "./types";

describe("emitter", () => {
  it("emits a linear scene JSON", () => {
    const ast: ASTLinearScene = {
      kind: "linearScene",
      id: "scene_0",
      title: "接案",
      queue: [
        { kind: "sceneTag", text: "街道" },
        { kind: "line", speaker: "A", text: "hi" },
      ],
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
        { kind: "line", speaker: "A", text: "hi" },
      ],
    });
  });

  it("emits an investigation scene JSON with auto outro preserved", () => {
    const ast: ASTInvestigationScene = {
      kind: "investigationScene",
      id: "i",
      title: "t",
      intro: [],
      sublocations: [],
      evidenceManifest: [],
      statementManifest: [],
      outro: { unlock: "auto", dialogue: [] },
      sourceFile: "i.md",
      line: 1,
    };
    const json = emitInvestigationScene(ast);
    expect(json.outro.unlock).toBe("auto");
    expect(json.type).toBe("investigation");
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
        entryDialogue: [],
        complete: "auto",
        questions: [],
        sourceFile: "x",
        line: 2,
      }],
      evidenceManifest: [],
      statementManifest: [],
      outro: { unlock: "auto", dialogue: [] },
      sourceFile: "x",
      line: 1,
    };
    expect(emitInterrogationScene(ast)).toMatchObject({
      type: "interrogation",
      id: "interrogation_scene_1",
      phases: [{ kind: "inquiry", id: "p", subject: { id: "suspect" } }],
    });
  });

  it("emits a chapters index", () => {
    const chapter: ASTChapter = {
      kind: "chapter",
      dirName: "chapter_1",
      number: 1,
      title: "t",
      summary: "s",
      sceneFiles: ["scene_0.md", "investigation_scene_1.md"],
      sourceFile: "chapter_1/chapter.md",
      line: 1,
    };
    const idx = emitChaptersIndex([chapter]);
    expect(idx).toEqual({
      chapters: [
        {
          id: "chapter_1",
          title: "t",
          summary: "s",
          scenes: [
            { type: "linear", file: "chapter_1/scene_0.json" },
            { type: "investigation", file: "chapter_1/investigation_scene_1.json" },
          ],
        },
      ],
    });
  });
});
