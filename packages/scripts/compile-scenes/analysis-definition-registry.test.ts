import { describe, expect, it } from "vitest";
import { createAnalysisDefinitionRegistry } from "./analysis-definition-registry";

describe("createAnalysisDefinitionRegistry", () => {
  it("checks fully qualified scene and board definitions independently", () => {
    const registry = createAnalysisDefinitionRegistry({
      scenes: [
        { chapterId: "chapter_1", sceneId: "analysis_scene_8_5" },
        { chapterId: "chapter_2", sceneId: "analysis_scene_2_1" },
      ],
      boards: [
        {
          chapterId: "chapter_1",
          sceneId: "analysis_scene_8_5",
          boardId: "source_board",
        },
      ],
    });

    expect(
      registry.hasScene({
        chapterId: "chapter_1",
        sceneId: "analysis_scene_8_5",
      }),
    ).toBe(true);
    expect(
      registry.hasScene({
        chapterId: "chapter_1",
        sceneId: "analysis_scene_2_1",
      }),
    ).toBe(false);
    expect(
      registry.hasBoard({
        chapterId: "chapter_1",
        sceneId: "analysis_scene_8_5",
        boardId: "source_board",
      }),
    ).toBe(true);
    expect(
      registry.hasBoard({
        chapterId: "chapter_1",
        sceneId: "analysis_scene_8_5",
        boardId: "different_board",
      }),
    ).toBe(false);
  });

  it.each([
    {
      name: "duplicate scene",
      scenes: [
        { chapterId: "chapter_1", sceneId: "analysis_scene_8_5" },
        { chapterId: "chapter_1", sceneId: "analysis_scene_8_5" },
      ],
      boards: [],
    },
    {
      name: "duplicate board",
      scenes: [],
      boards: [
        {
          chapterId: "chapter_1",
          sceneId: "analysis_scene_8_5",
          boardId: "source_board",
        },
        {
          chapterId: "chapter_1",
          sceneId: "analysis_scene_8_5",
          boardId: "source_board",
        },
      ],
    },
  ])("rejects duplicate qualified definitions ($name)", (input) => {
    expect(() => createAnalysisDefinitionRegistry(input)).toThrow(
      /Duplicate analysis (scene|board) definition/,
    );
  });
});
