import type {
  ASTStoryCatalog,
  CompileError,
  Located,
  StoryPredicate,
  StoryRevealTarget,
} from "./types";
import type { AnalysisDefinitionRegistry } from "./analysis-definition-registry";
import {
  buildStoryPredicateReferences,
  buildStoryRevealTargetBatches,
  type SceneRecord,
  type StoryPredicateReference,
} from "./validator";

export type AnalysisBoardRef = {
  chapterId: string;
  sceneId: string;
  boardId: string;
};

export type AnalysisSceneRef = {
  chapterId: string;
  sceneId: string;
};

type LocatedDefinition = {
  id: string;
  sourceFile: string;
  line: number;
};

const ID_RE = /^[a-z0-9_]+$/;

export function validateStoryCatalog(
  catalog: ASTStoryCatalog,
  scenes: SceneRecord[],
): CompileError[] {
  const errors: CompileError[] = [];
  const facts = indexDefinitions("Fact", catalog.facts, errors);
  indexDefinitions("Question", catalog.questions, errors);
  indexDefinitions("Objective", catalog.objectives, errors);
  indexDefinitions("Authorization", catalog.authorizations, errors);
  indexDefinitions("Source Group", catalog.sourceGroups, errors);

  for (const objective of catalog.objectives) {
    if (objective.id !== "null") continue;
    errors.push({
      code: "reservedObjectiveId",
      message:
        'Objective id "null" is reserved for set_primary_objective:null.',
      sourceFile: objective.sourceFile,
      line: objective.line,
    });
  }

  for (const question of catalog.questions) {
    for (const reference of question.resolvedByFactIds) {
      if (facts.has(reference.id)) continue;
      errors.push({
        code: "unresolvedStoryCatalogReference",
        message: `Question "${question.id}" references unknown fact "${reference.id}".`,
        sourceFile: reference.sourceFile,
        line: reference.line,
      });
    }
  }

  for (const batch of buildStoryRevealTargetBatches(scenes)) {
    errors.push(
      ...validateStoryRevealTargets({
        ...batch,
        catalog,
      }),
    );
  }

  return errors;
}

export function validateStoryRevealTargets(input: {
  targets: StoryRevealTarget[];
  catalog: ASTStoryCatalog;
  representedAuthority: string | null;
  location: Located<unknown>;
}): CompileError[] {
  const errors: CompileError[] = [];
  const factsById = new Set(input.catalog.facts.map((fact) => fact.id));
  const questionsById = new Map(
    input.catalog.questions.map((question) => [question.id, question]),
  );
  const objectivesById = new Map(
    input.catalog.objectives.map((objective) => [objective.id, objective]),
  );
  const authorizationsById = new Map(
    input.catalog.authorizations.map((authorization) => [
      authorization.id,
      authorization,
    ]),
  );
  const seenTargets = new Set<string>();
  const resolverByQuestion = new Map<string, string>();
  let primaryTransition: StoryRevealTarget | null = null;

  for (const target of input.targets) {
    errors.push(
      ...validateStoryRevealTargetDefinition({
        target,
        factsById,
        questionsById,
        objectivesById,
        authorizationsById,
        representedAuthority: input.representedAuthority,
        location: input.location,
        catalog: input.catalog,
      }),
    );

    const key = storyRevealTargetKey(target);
    const duplicate = seenTargets.has(key);
    if (duplicate) {
      errors.push(
        storyRevealTargetError(
          input.location,
          "duplicateStoryRevealTarget",
          `Duplicate story reveal target: ${key}`,
        ),
      );
    }

    if (target.kind === "resolveQuestion") {
      const previousFactId = resolverByQuestion.get(target.questionId);
      if (previousFactId !== undefined && previousFactId !== target.factId) {
        errors.push(
          storyRevealTargetError(
            input.location,
            "conflictingQuestionResolution",
            `Question ${target.questionId} resolves to both ${previousFactId} and ${target.factId}.`,
          ),
        );
      }
      resolverByQuestion.set(target.questionId, target.factId);
    }

    if (target.kind === "setPrimaryObjective") {
      if (primaryTransition !== null && !duplicate) {
        errors.push(
          storyRevealTargetError(
            input.location,
            "multiplePrimaryTransitions",
            "Reveal list contains multiple set_primary_objective targets.",
          ),
        );
      }
      if (primaryTransition === null) primaryTransition = target;
    }

    seenTargets.add(key);
  }

  return errors;
}

export function validateStoryPredicateReferences(input: {
  catalog: ASTStoryCatalog;
  scenes: SceneRecord[];
  analysisRegistry: AnalysisDefinitionRegistry;
  /**
   * Story-only predicate carriers outside the historical SceneRecord union.
   * Analysis scenes supply their board unlock references here until their
   * manifest dispatch joins the production scene-emission lifecycle.
   */
  additionalReferences?: readonly StoryPredicateReference[];
}): CompileError[] {
  const facts = new Set(input.catalog.facts.map((definition) => definition.id));
  const questions = new Set(
    input.catalog.questions.map((definition) => definition.id),
  );
  const objectives = new Set(
    input.catalog.objectives.map((definition) => definition.id),
  );
  const authorizations = new Set(
    input.catalog.authorizations.map((definition) => definition.id),
  );

  return [
    ...buildStoryPredicateReferences(input.scenes),
    ...(input.additionalReferences ?? []),
  ].flatMap(({ predicate, location }) =>
    validateStoryPredicateReference({
      predicate,
      location,
      facts,
      questions,
      objectives,
      authorizations,
      analysisRegistry: input.analysisRegistry,
    }),
  );
}

function validateStoryPredicateReference(input: {
  predicate: StoryPredicate;
  location: Located<unknown>;
  facts: ReadonlySet<string>;
  questions: ReadonlySet<string>;
  objectives: ReadonlySet<string>;
  authorizations: ReadonlySet<string>;
  analysisRegistry: AnalysisDefinitionRegistry;
}): CompileError[] {
  const { predicate, location } = input;
  switch (predicate.predicate) {
    case "fact_asserted":
      return input.facts.has(predicate.id)
        ? []
        : [unresolvedStoryPredicate(location, "fact", predicate.id)];
    case "question_resolved":
      return input.questions.has(predicate.id)
        ? []
        : [unresolvedStoryPredicate(location, "question", predicate.id)];
    case "objective_completed":
      return input.objectives.has(predicate.id)
        ? []
        : [unresolvedStoryPredicate(location, "objective", predicate.id)];
    case "authorization_granted":
      return input.authorizations.has(predicate.id)
        ? []
        : [unresolvedStoryPredicate(location, "authorization", predicate.id)];
    case "analysis_scene_completed": {
      const ref: AnalysisSceneRef = {
        chapterId: predicate.chapterId,
        sceneId: predicate.sceneId,
      };
      const shapeErrors = validateAnalysisSceneRef(ref, location);
      if (shapeErrors.length > 0) return shapeErrors;
      return input.analysisRegistry.hasScene(ref)
        ? []
        : [
            unresolvedAnalysisPredicate(
              location,
              "scene",
              `${ref.chapterId}@${ref.sceneId}`,
            ),
          ];
    }
    case "analysis_board_completed": {
      const ref: AnalysisBoardRef = {
        chapterId: predicate.chapterId,
        sceneId: predicate.sceneId,
        boardId: predicate.boardId,
      };
      const shapeErrors = validateAnalysisBoardRef(ref, location);
      if (shapeErrors.length > 0) return shapeErrors;
      return input.analysisRegistry.hasBoard(ref)
        ? []
        : [
            unresolvedAnalysisPredicate(
              location,
              "board",
              `${ref.chapterId}@${ref.sceneId}@${ref.boardId}`,
            ),
          ];
    }
  }
}

function unresolvedStoryPredicate(
  location: Located<unknown>,
  definitionKind: string,
  id: string,
): CompileError {
  return {
    code: "unresolvedStoryPredicate",
    message: `Story predicate references unknown ${definitionKind} "${id}".`,
    sourceFile: location.sourceFile,
    line: location.line,
  };
}

function unresolvedAnalysisPredicate(
  location: Located<unknown>,
  definitionKind: "scene" | "board",
  qualifiedId: string,
): CompileError {
  return {
    code: "unresolvedAnalysisPredicate",
    message: `Analysis ${definitionKind} predicate references unregistered definition "${qualifiedId}".`,
    sourceFile: location.sourceFile,
    line: location.line,
  };
}

export function validateAnalysisBoardRef(
  ref: AnalysisBoardRef,
  location: Located<unknown>,
): CompileError[] {
  if (hasValidAnalysisRefSegments(ref.chapterId, ref.sceneId, ref.boardId)) {
    return [];
  }

  return [
    {
      code: "invalidAnalysisBoardRef",
      message:
        "Analysis board references require non-empty slug chapterId, sceneId, and boardId segments.",
      sourceFile: location.sourceFile,
      line: location.line,
    },
  ];
}

export function validateAnalysisSceneRef(
  ref: AnalysisSceneRef,
  location: Located<unknown>,
): CompileError[] {
  if (hasValidAnalysisRefSegments(ref.chapterId, ref.sceneId)) return [];

  return [
    {
      code: "invalidAnalysisSceneRef",
      message:
        "Analysis scene references require non-empty slug chapterId and sceneId segments.",
      sourceFile: location.sourceFile,
      line: location.line,
    },
  ];
}

export function validateSetPrimaryObjectiveTarget(
  catalog: ASTStoryCatalog,
  nextObjectiveId: string | null,
  location: Located<unknown>,
): CompileError[] {
  if (nextObjectiveId === null) return [];

  const objective = catalog.objectives.find(
    (candidate) => candidate.id === nextObjectiveId,
  );
  if (objective?.kind === "primary") return [];

  return [
    {
      code: "invalidPrimaryObjectiveTarget",
      message: objective
        ? `Objective "${nextObjectiveId}" is secondary and cannot be the active primary objective.`
        : `Unknown primary objective "${nextObjectiveId}".`,
      sourceFile: location.sourceFile,
      line: location.line,
    },
  ];
}

function validateStoryRevealTargetDefinition(input: {
  target: StoryRevealTarget;
  factsById: ReadonlySet<string>;
  questionsById: ReadonlyMap<string, ASTStoryCatalog["questions"][number]>;
  objectivesById: ReadonlyMap<string, ASTStoryCatalog["objectives"][number]>;
  authorizationsById: ReadonlyMap<
    string,
    ASTStoryCatalog["authorizations"][number]
  >;
  representedAuthority: string | null;
  location: Located<unknown>;
  catalog: ASTStoryCatalog;
}): CompileError[] {
  const { target, location } = input;

  switch (target.kind) {
    case "assertFact":
      return input.factsById.has(target.factId)
        ? []
        : [storyRevealUnresolved(location, "fact", target.factId)];
    case "revealQuestion":
      return input.questionsById.has(target.questionId)
        ? []
        : [storyRevealUnresolved(location, "question", target.questionId)];
    case "resolveQuestion": {
      const errors: CompileError[] = [];
      const question = input.questionsById.get(target.questionId);
      if (!question) {
        errors.push(
          storyRevealUnresolved(location, "question", target.questionId),
        );
      }
      if (!input.factsById.has(target.factId)) {
        errors.push(storyRevealUnresolved(location, "fact", target.factId));
      } else if (
        question &&
        !question.resolvedByFactIds.some(
          (candidate) => candidate.id === target.factId,
        )
      ) {
        errors.push(
          storyRevealTargetError(
            location,
            "invalidQuestionResolutionTarget",
            `Fact "${target.factId}" cannot resolve question "${target.questionId}".`,
          ),
        );
      }
      return errors;
    }
    case "revealObjective":
      return input.objectivesById.has(target.objectiveId)
        ? []
        : [storyRevealUnresolved(location, "objective", target.objectiveId)];
    case "completeObjective": {
      const objective = input.objectivesById.get(target.objectiveId);
      if (!objective) {
        return [
          storyRevealUnresolved(location, "objective", target.objectiveId),
        ];
      }
      if (objective.kind === "secondary") return [];
      return [
        storyRevealTargetError(
          location,
          "primaryObjectiveCompletionRequiresSet",
          `Primary objective "${target.objectiveId}" must be completed through set_primary_objective.`,
        ),
      ];
    }
    case "setPrimaryObjective":
      return target.nextObjectiveId === null
        ? []
        : validateSetPrimaryObjectiveTarget(
            input.catalog,
            target.nextObjectiveId,
            location,
          );
    case "grantAuthorization": {
      const authorization = input.authorizationsById.get(
        target.authorizationId,
      );
      if (!authorization) {
        return [
          storyRevealUnresolved(
            location,
            "authorization",
            target.authorizationId,
          ),
        ];
      }
      if (input.representedAuthority === null) {
        return [
          storyRevealTargetError(
            location,
            "authorizationGrantOutsideAuthorityEvent",
            `Authorization "${target.authorizationId}" can only be granted by an authority event.`,
          ),
        ];
      }
      if (input.representedAuthority !== authorization.grantingAuthority) {
        return [
          storyRevealTargetError(
            location,
            "authorizationGrantAuthorityMismatch",
            `Authorization "${target.authorizationId}" requires authority "${authorization.grantingAuthority}", but this target is represented by "${input.representedAuthority}".`,
          ),
        ];
      }
      return [];
    }
  }
}

function storyRevealUnresolved(
  location: Located<unknown>,
  definitionKind: string,
  id: string,
): CompileError {
  return storyRevealTargetError(
    location,
    "storyRevealUnresolved",
    `Story reveal target references unknown ${definitionKind} "${id}".`,
  );
}

function storyRevealTargetError(
  location: Located<unknown>,
  code: string,
  message: string,
): CompileError {
  return {
    code,
    message,
    sourceFile: location.sourceFile,
    line: location.line,
  };
}

function storyRevealTargetKey(target: StoryRevealTarget): string {
  switch (target.kind) {
    case "assertFact":
      return `${target.kind}:${target.factId}`;
    case "revealQuestion":
      return `${target.kind}:${target.questionId}`;
    case "resolveQuestion":
      return `${target.kind}:${target.questionId}@${target.factId}`;
    case "revealObjective":
    case "completeObjective":
      return `${target.kind}:${target.objectiveId}`;
    case "setPrimaryObjective":
      return `${target.kind}:${target.nextObjectiveId ?? "null"}:${target.completeCurrent}`;
    case "grantAuthorization":
      return `${target.kind}:${target.authorizationId}`;
  }
}

function indexDefinitions<T extends LocatedDefinition>(
  kind: string,
  definitions: T[],
  errors: CompileError[],
): Map<string, T> {
  const index = new Map<string, T>();
  for (const definition of definitions) {
    const previous = index.get(definition.id);
    if (previous) {
      errors.push({
        code: "duplicateGlobalDefinitionId",
        message: `${kind} id "${definition.id}" declared twice: ${previous.sourceFile}:${previous.line} and ${definition.sourceFile}:${definition.line}.`,
        sourceFile: definition.sourceFile,
        line: definition.line,
      });
      continue;
    }
    index.set(definition.id, definition);
  }
  return index;
}

function hasValidAnalysisRefSegments(...segments: string[]): boolean {
  return segments.every((segment) => ID_RE.test(segment));
}
