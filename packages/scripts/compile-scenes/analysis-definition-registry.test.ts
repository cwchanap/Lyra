import { describe, expect, it } from "vitest";
import {
  createAnalysisDefinitionRegistry,
  createAnalysisDefinitionRegistryFromScenes,
} from "./analysis-definition-registry";
import { parseAnalysisScene } from "./parser-analysis";
import { emptyStoryCatalog } from "./parser-story-catalog";
import { validateStoryPredicateReferences } from "./story-catalog";

function parsedScene(id: string, boardId: string, unlock?: string) {
  const result = parseAnalysisScene(
    [
      "# Scene 1: 分析",
      "- **Summary:** 測試分析。",
      "## Intro",
      "**相馬律**：開始吧。",
      `## Board: 分析 {#${boardId}}`,
      "- **Kind:** classify",
      "- **Prompt:** 整理卡片。",
      ...(unlock ? [`- **Unlock:** ${unlock}`] : []),
      "- **Reveals:** []",
      "- **Incomplete Feedback:** 尚未完成。",
      "- **Incorrect Feedback:** 不正確。",
      "### Card: 卡片 {#card_a}",
      "- **Source:** evidence:record_a",
      "- **Summary:** 材料摘要。",
      "### Group: 分類 {#group_a}",
      "- **Description:** 分類說明。",
      "- **Accepted Cards:** [card_a]",
      "### Result Dialogue",
      "**相馬律**：完成。",
      "## Outro",
      "**相馬律**：下一步。",
    ].join("\n"),
    `chapter_1/${id}.md`,
    id,
  );
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

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

  it("derives real parsed definitions so a later qualified predicate resolves", () => {
    // Break caught: a synthetic CompileOptions registry could pass a fixture
    // while real authored analysis definitions never entered the registry.
    const earlier = parsedScene("analysis_scene_1", "board_1");
    const later = parsedScene(
      "analysis_scene_2",
      "board_2",
      "analysis_board:chapter_1@analysis_scene_1@board_1 completed",
    );
    const scenes = [
      { chapterId: "chapter_1", file: "analysis_scene_1.md", ast: earlier },
      { chapterId: "chapter_1", file: "analysis_scene_2.md", ast: later },
    ];
    const registry = createAnalysisDefinitionRegistryFromScenes(scenes);
    const unlock = later.boards[0]?.unlock;
    if (!unlock || "op" in unlock.value)
      throw new Error("expected leaf unlock");

    expect(
      validateStoryPredicateReferences({
        catalog: emptyStoryCatalog("story_catalog.md"),
        scenes: [],
        analysisRegistry: registry,
        additionalReferences: [
          {
            predicate: unlock.value,
            location: unlock,
          },
        ],
      }),
    ).toEqual([]);
  });
});
