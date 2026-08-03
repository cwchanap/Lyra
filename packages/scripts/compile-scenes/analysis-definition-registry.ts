import type { AnalysisBoardRef, AnalysisSceneRef } from "./story-catalog";

export type AnalysisDefinitionRegistry = {
  hasScene(ref: AnalysisSceneRef): boolean;
  hasBoard(ref: AnalysisBoardRef): boolean;
};

export function createAnalysisDefinitionRegistry(input: {
  scenes: AnalysisSceneRef[];
  boards: AnalysisBoardRef[];
}): AnalysisDefinitionRegistry {
  const scenes = new Set<string>();
  for (const ref of input.scenes) {
    const key = sceneKey(ref);
    if (scenes.has(key)) {
      throw new Error(`Duplicate analysis scene definition: ${key}.`);
    }
    scenes.add(key);
  }

  const boards = new Set<string>();
  for (const ref of input.boards) {
    const key = boardKey(ref);
    if (boards.has(key)) {
      throw new Error(`Duplicate analysis board definition: ${key}.`);
    }
    boards.add(key);
  }

  return {
    hasScene: (ref) => scenes.has(sceneKey(ref)),
    hasBoard: (ref) => boards.has(boardKey(ref)),
  };
}

function sceneKey(ref: AnalysisSceneRef): string {
  return JSON.stringify([ref.chapterId, ref.sceneId]);
}

function boardKey(ref: AnalysisBoardRef): string {
  return JSON.stringify([ref.chapterId, ref.sceneId, ref.boardId]);
}
