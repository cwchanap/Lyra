import { describe, expect, it } from "vitest";
import { emptyStoryCatalog } from "./parser-story-catalog";
import {
  validateAnalysisBoardRef,
  validateAnalysisSceneRef,
  validateSetPrimaryObjectiveTarget,
  validateStoryCatalog,
  validateStoryRevealTargets,
} from "./story-catalog";
import type { ASTStoryCatalog, Located, StoryRevealTarget } from "./types";

function catalogWithDuplicate(
  kind: "fact" | "question" | "objective" | "authorization" | "sourceGroup",
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
    case "sourceGroup":
      catalog.sourceGroups = [
        {
          ...first,
          label: "First group",
          summary: "First.",
        },
        {
          ...second,
          label: "Second group",
          summary: "Second.",
        },
      ];
      break;
  }

  return catalog;
}

function catalogForStoryRevealTargets(): ASTStoryCatalog {
  const catalog = emptyStoryCatalog("story_catalog.md");
  catalog.facts = [
    {
      id: "fact_a",
      label: "Fact A",
      summary: "First fact.",
      details: "First fact details.",
      category: "test",
      sourceFile: "story_catalog.md",
      line: 3,
    },
    {
      id: "fact_b",
      label: "Fact B",
      summary: "Second fact.",
      details: "Second fact details.",
      category: "test",
      sourceFile: "story_catalog.md",
      line: 9,
    },
  ];
  catalog.questions = [
    {
      id: "question_a",
      label: "Question A",
      summary: "Resolve with Fact A.",
      resolvedByFactIds: [
        { id: "fact_a", sourceFile: "story_catalog.md", line: 16 },
      ],
      sourceFile: "story_catalog.md",
      line: 13,
    },
    {
      id: "question_b",
      label: "Question B",
      summary: "Resolve with either fact.",
      resolvedByFactIds: [
        { id: "fact_a", sourceFile: "story_catalog.md", line: 24 },
        { id: "fact_b", sourceFile: "story_catalog.md", line: 25 },
      ],
      sourceFile: "story_catalog.md",
      line: 21,
    },
  ];
  catalog.objectives = [
    {
      id: "primary_a",
      label: "Primary A",
      summary: "Primary objective.",
      kind: "primary",
      sortOrder: 1,
      sourceFile: "story_catalog.md",
      line: 30,
    },
    {
      id: "secondary_a",
      label: "Secondary A",
      summary: "Secondary objective.",
      kind: "secondary",
      sortOrder: 2,
      sourceFile: "story_catalog.md",
      line: 36,
    },
  ];
  catalog.authorizations = [
    {
      id: "search_warrant",
      label: "Search warrant",
      summary: "A test authorization.",
      grantingAuthority: "Inspector Kuroda",
      sourceFile: "story_catalog.md",
      line: 42,
    },
  ];
  return catalog;
}

describe("story catalog validation", () => {
  it.each([
    "fact",
    "question",
    "objective",
    "authorization",
    "sourceGroup",
  ] as const)("rejects duplicate %s IDs at the second definition", (kind) => {
    const errors = validateStoryCatalog(catalogWithDuplicate(kind), []);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: "duplicateGlobalDefinitionId",
      sourceFile: "story_catalog.md",
      line: 9,
    });
    expect(errors[0]?.message).toContain("story_catalog.md:3");
    expect(errors[0]?.message).toContain("story_catalog.md:9");
  });

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

  it("rejects hand-built objectives with the reserved null ID", () => {
    const catalog = emptyStoryCatalog("story_catalog.md");
    catalog.objectives.push({
      id: "null",
      label: "Clear the active objective",
      summary: "Reserved sentinel.",
      kind: "primary",
      sortOrder: 1,
      sourceFile: "story_catalog.md",
      line: 17,
    });

    expect(validateStoryCatalog(catalog, [])).toContainEqual(
      expect.objectContaining({
        code: "reservedObjectiveId",
        sourceFile: "story_catalog.md",
        line: 17,
      }),
    );
  });
});

describe("analysis scene reference validation", () => {
  const location: Located<unknown> = {
    sourceFile: "scene.md",
    line: 7,
  };

  it("accepts a fully qualified slug-only reference", () => {
    expect(
      validateAnalysisSceneRef(
        { chapterId: "chapter_1", sceneId: "analysis_scene_8_5" },
        location,
      ),
    ).toEqual([]);
  });

  it.each([
    ["chapterId", ""],
    ["chapterId", "Chapter_1"],
    ["sceneId", "scene-1"],
    ["sceneId", "scene space"],
  ] as const)("rejects an invalid %s segment", (field, value) => {
    const ref = {
      chapterId: "chapter_1",
      sceneId: "analysis_scene_8_5",
      [field]: value,
    };

    expect(validateAnalysisSceneRef(ref, location)).toEqual([
      expect.objectContaining({
        code: "invalidAnalysisSceneRef",
        sourceFile: "scene.md",
        line: 7,
      }),
    ]);
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

describe("story reveal target validation", () => {
  const catalog = catalogForStoryRevealTargets();
  const location: Located<unknown> = {
    sourceFile: "story-reveals.md",
    line: 51,
  };

  const validateTargets = (
    targets: StoryRevealTarget[],
    representedAuthority: string | null = null,
  ) =>
    validateStoryRevealTargets({
      targets,
      catalog,
      representedAuthority,
      location,
    });

  it("accepts every resolved target with matching synthetic authority", () => {
    expect(
      validateTargets(
        [
          { kind: "assertFact", factId: "fact_a" },
          { kind: "revealQuestion", questionId: "question_a" },
          {
            kind: "resolveQuestion",
            questionId: "question_a",
            factId: "fact_a",
          },
          { kind: "revealObjective", objectiveId: "secondary_a" },
          { kind: "completeObjective", objectiveId: "secondary_a" },
          {
            kind: "setPrimaryObjective",
            nextObjectiveId: "primary_a",
            completeCurrent: true,
          },
          { kind: "grantAuthorization", authorizationId: "search_warrant" },
        ],
        "Inspector Kuroda",
      ),
    ).toEqual([]);
  });

  it("reports missing typed story target references at the reveal location", () => {
    expect(
      validateTargets([
        { kind: "assertFact", factId: "missing_fact" },
        { kind: "revealQuestion", questionId: "missing_question" },
        {
          kind: "resolveQuestion",
          questionId: "question_a",
          factId: "missing_fact",
        },
        { kind: "revealObjective", objectiveId: "missing_objective" },
        { kind: "completeObjective", objectiveId: "missing_objective" },
        {
          kind: "grantAuthorization",
          authorizationId: "missing_authorization",
        },
      ]),
    ).toEqual(
      Array.from({ length: 6 }, () =>
        expect.objectContaining({
          code: "storyRevealUnresolved",
          sourceFile: "story-reveals.md",
          line: 51,
        }),
      ),
    );
  });

  it("rejects a resolver fact that is not listed for its question", () => {
    expect(
      validateTargets([
        {
          kind: "resolveQuestion",
          questionId: "question_a",
          factId: "fact_b",
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        code: "invalidQuestionResolutionTarget",
        sourceFile: "story-reveals.md",
        line: 51,
      }),
    ]);
  });

  it("requires primary objective completion to use set-primary", () => {
    expect(
      validateTargets([
        { kind: "completeObjective", objectiveId: "primary_a" },
      ]),
    ).toEqual([
      expect.objectContaining({
        code: "primaryObjectiveCompletionRequiresSet",
        sourceFile: "story-reveals.md",
        line: 51,
      }),
    ]);
  });

  it("delegates non-null set-primary targets to the existing helper", () => {
    expect(
      validateTargets([
        {
          kind: "setPrimaryObjective",
          nextObjectiveId: "secondary_a",
          completeCurrent: false,
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        code: "invalidPrimaryObjectiveTarget",
        sourceFile: "story-reveals.md",
        line: 51,
      }),
    ]);
  });

  it("requires matching represented authority for authorization grants", () => {
    const target: StoryRevealTarget = {
      kind: "grantAuthorization",
      authorizationId: "search_warrant",
    };

    expect(validateTargets([target])).toEqual([
      expect.objectContaining({
        code: "authorizationGrantOutsideAuthorityEvent",
        sourceFile: "story-reveals.md",
        line: 51,
      }),
    ]);
    expect(validateTargets([target], "Deputy Sato")).toEqual([
      expect.objectContaining({
        code: "authorizationGrantAuthorityMismatch",
        sourceFile: "story-reveals.md",
        line: 51,
      }),
    ]);
    expect(validateTargets([target], "Inspector Kuroda")).toEqual([]);
  });

  it("defends hand-built batches against duplicate, resolver, and primary conflicts", () => {
    expect(
      validateTargets([
        { kind: "assertFact", factId: "fact_a" },
        { kind: "assertFact", factId: "fact_a" },
        {
          kind: "resolveQuestion",
          questionId: "question_b",
          factId: "fact_a",
        },
        {
          kind: "resolveQuestion",
          questionId: "question_b",
          factId: "fact_b",
        },
        {
          kind: "setPrimaryObjective",
          nextObjectiveId: "primary_a",
          completeCurrent: false,
        },
        {
          kind: "setPrimaryObjective",
          nextObjectiveId: null,
          completeCurrent: false,
        },
      ]).map((error) => error.code),
    ).toEqual([
      "duplicateStoryRevealTarget",
      "conflictingQuestionResolution",
      "multiplePrimaryTransitions",
    ]);
  });
});
