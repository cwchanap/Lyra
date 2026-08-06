import type { AnalysisBoardRef, AnalysisSceneRef } from "./story-catalog";
import type { AnalysisSceneRecord } from "./types";

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

/**
 * The compiler owns analysis definition registration from parsed scene ASTs.
 * Duplicate authored IDs are reported by semantic validation with source
 * locations, so this factory deliberately collapses repeated qualified keys
 * before constructing the small Set-backed registry.
 */
export function createAnalysisDefinitionRegistryFromScenes(
  scenes: readonly AnalysisSceneRecord[],
): AnalysisDefinitionRegistry {
  const sceneRefs: AnalysisSceneRef[] = [];
  const boardRefs: AnalysisBoardRef[] = [];
  const seenScenes = new Set<string>();
  const seenBoards = new Set<string>();

  for (const scene of scenes) {
    const sceneRef = {
      chapterId: scene.chapterId,
      sceneId: scene.ast.id,
    };
    const sceneRefKey = sceneKey(sceneRef);
    if (!seenScenes.has(sceneRefKey)) {
      seenScenes.add(sceneRefKey);
      sceneRefs.push(sceneRef);
    }

    for (const board of scene.ast.boards) {
      const boardRef = { ...sceneRef, boardId: board.id };
      const boardRefKey = boardKey(boardRef);
      if (seenBoards.has(boardRefKey)) continue;
      seenBoards.add(boardRefKey);
      boardRefs.push(boardRef);
    }
  }

  return createAnalysisDefinitionRegistry({
    scenes: sceneRefs,
    boards: boardRefs,
  });
}

function sceneKey(ref: AnalysisSceneRef): string {
  return JSON.stringify([ref.chapterId, ref.sceneId]);
}

function boardKey(ref: AnalysisBoardRef): string {
  return JSON.stringify([ref.chapterId, ref.sceneId, ref.boardId]);
}
