import { describe, expect, it } from "vitest";
import { emptyStoryCatalog } from "./parser-story-catalog";
import {
  validateAnalysisBoardRef,
  validateSetPrimaryObjectiveTarget,
  validateStoryCatalog,
} from "./story-catalog";
import type { ASTStoryCatalog, Located } from "./types";

function catalogWithDuplicate(
  kind: "fact" | "question" | "objective" | "authorization",
): ASTStoryCatalog {
  const catalog = emptyStoryCatalog("story_catalog.md");
  const first = { id: "same_id", sourceFile: "story_catalog.md", line: 3 };
  const second = { id: "same_id", sourceFile: "story_catalog.md", line: 9 };

  switch (kind) {
    case "fact":
      catalog.facts = [
        {
          ...first,
          label: "First fact",
          summary: "First.",
          details: "First details.",
          category: "test",
        },
        {
          ...second,
          label: "Second fact",
          summary: "Second.",
          details: "Second details.",
          category: "test",
        },
      ];
      break;
    case "question":
      catalog.questions = [
        {
          ...first,
          label: "First question",
          summary: "First.",
          resolvedByFactIds: [],
        },
        {
          ...second,
          label: "Second question",
          summary: "Second.",
          resolvedByFactIds: [],
        },
      ];
      break;
    case "objective":
      catalog.objectives = [
        {
          ...first,
          label: "First objective",
          summary: "First.",
          kind: "primary",
          sortOrder: 1,
        },
        {
          ...second,
          label: "Second objective",
          summary: "Second.",
          kind: "secondary",
          sortOrder: 2,
        },
      ];
      break;
    case "authorization":
      catalog.authorizations = [
        {
          ...first,
          label: "First authorization",
          summary: "First.",
          grantingAuthority: "Authority A",
        },
        {
          ...second,
          label: "Second authorization",
          summary: "Second.",
          grantingAuthority: "Authority B",
        },
      ];
      break;
  }

  return catalog;
}

describe("story catalog validation", () => {
  it.each(["fact", "question", "objective", "authorization"] as const)(
    "rejects duplicate %s IDs at the second definition",
    (kind) => {
      const errors = validateStoryCatalog(catalogWithDuplicate(kind), []);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        code: "duplicateGlobalDefinitionId",
        sourceFile: "story_catalog.md",
        line: 9,
      });
      expect(errors[0]?.message).toContain("story_catalog.md:3");
      expect(errors[0]?.message).toContain("story_catalog.md:9");
    },
  );

  it("rejects unresolved question fact references at the reference location", () => {
    const catalog = emptyStoryCatalog("story_catalog.md");
    catalog.questions.push({
      id: "who_entered",
      label: "Who entered?",
      summary: "Find the visitor.",
      resolvedByFactIds: [
        {
          id: "missing_fact",
          sourceFile: "story_catalog.md",
          line: 14,
        },
      ],
      sourceFile: "story_catalog.md",
      line: 11,
    });

    expect(validateStoryCatalog(catalog, [])).toContainEqual(
      expect.objectContaining({
        code: "unresolvedStoryCatalogReference",
        sourceFile: "story_catalog.md",
        line: 14,
      }),
    );
  });
});

describe("analysis board reference validation", () => {
  const location: Located<unknown> = {
    sourceFile: "scene.md",
    line: 27,
  };

  it("accepts a fully qualified slug-only reference", () => {
    expect(
      validateAnalysisBoardRef(
        {
          chapterId: "chapter_1",
          sceneId: "investigation_scene_2",
          boardId: "timeline_board",
        },
        location,
      ),
    ).toEqual([]);
  });

  it.each([
    ["chapterId", ""],
    ["chapterId", "Chapter_1"],
    ["sceneId", "scene-1"],
    ["boardId", "board space"],
  ] as const)("rejects an invalid %s segment", (field, value) => {
    const ref = {
      chapterId: "chapter_1",
      sceneId: "investigation_scene_2",
      boardId: "timeline_board",
      [field]: value,
    };

    expect(validateAnalysisBoardRef(ref, location)).toEqual([
      expect.objectContaining({
        code: "invalidAnalysisBoardRef",
        sourceFile: "scene.md",
        line: 27,
      }),
    ]);
  });
});

describe("primary objective target validation", () => {
  const location: Located<unknown> = {
    sourceFile: "scene.md",
    line: 31,
  };
  const catalog = emptyStoryCatalog("story_catalog.md");
  catalog.objectives = [
    {
      id: "find_truth",
      label: "Find the truth",
      summary: "Resolve the contradiction.",
      kind: "primary",
      sortOrder: 1,
      sourceFile: "story_catalog.md",
      line: 20,
    },
    {
      id: "check_alibi",
      label: "Check the alibi",
      summary: "Confirm the timeline.",
      kind: "secondary",
      sortOrder: 2,
      sourceFile: "story_catalog.md",
      line: 25,
    },
  ];

  it("accepts null and a known primary objective", () => {
    expect(validateSetPrimaryObjectiveTarget(catalog, null, location)).toEqual(
      [],
    );
    expect(
      validateSetPrimaryObjectiveTarget(catalog, "find_truth", location),
    ).toEqual([]);
  });

  it.each(["missing_objective", "check_alibi"])(
    "rejects invalid primary target %s",
    (target) => {
      expect(
        validateSetPrimaryObjectiveTarget(catalog, target, location),
      ).toEqual([
        expect.objectContaining({
          code: "invalidPrimaryObjectiveTarget",
          sourceFile: "scene.md",
          line: 31,
        }),
      ]);
    },
  );
});
