import type { ASTStoryCatalog, CompileError, Located } from "./types";
import type { SceneRecord } from "./validator";

export type AnalysisBoardRef = {
  chapterId: string;
  sceneId: string;
  boardId: string;
};

type LocatedDefinition = {
  id: string;
  sourceFile: string;
  line: number;
};

const ID_RE = /^[a-z0-9_]+$/;

export function validateStoryCatalog(
  catalog: ASTStoryCatalog,
  _scenes: SceneRecord[],
): CompileError[] {
  const errors: CompileError[] = [];
  const facts = indexDefinitions("Fact", catalog.facts, errors);
  indexDefinitions("Question", catalog.questions, errors);
  indexDefinitions("Objective", catalog.objectives, errors);
  indexDefinitions("Authorization", catalog.authorizations, errors);

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

  return errors;
}

export function validateAnalysisBoardRef(
  ref: AnalysisBoardRef,
  location: Located<unknown>,
): CompileError[] {
  if (
    ID_RE.test(ref.chapterId) &&
    ID_RE.test(ref.sceneId) &&
    ID_RE.test(ref.boardId)
  ) {
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
