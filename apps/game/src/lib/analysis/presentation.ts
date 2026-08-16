import type { AnalysisBoardView, Mode, SceneView } from "$lib/state/types";
import { materializePrefixAnchors } from "./order-draft";

export type AnalysisBoardProgress = {
  current: number;
  target: number;
  percent: number;
};

function availableCardIds(board: AnalysisBoardView): Set<string> {
  return new Set(
    board.cards
      .filter((card) => card.available === true)
      .map((card) => card.id),
  );
}

function progress(
  current: number,
  target: number,
  completed: boolean,
): AnalysisBoardProgress {
  if (completed) return { current, target, percent: 100 };
  if (target <= 0) return { current, target, percent: 0 };
  return { current, target, percent: Math.min(100, (current / target) * 100) };
}

export function isAnalysisPresentationActive(
  scene: SceneView,
  mode: Mode,
): boolean {
  return (
    scene.kind === "analysis" &&
    (mode.type === "analysis" ||
      (mode.type === "dialogue" && mode.queueToken.sceneId === scene.id))
  );
}

export function analysisBoardProgress(
  board: AnalysisBoardView,
): AnalysisBoardProgress {
  const availableIds = availableCardIds(board);

  switch (board.kind) {
    case "classify": {
      const groupIds = new Set(board.groups.map((group) => group.id));
      const groupByCard =
        board.draft.kind === "classify" ? board.draft.groupByCard : {};
      const current = [...availableIds].filter((cardId) =>
        groupIds.has(groupByCard[cardId]),
      ).length;
      return progress(current, availableIds.size, board.completed);
    }
    case "order": {
      const cardIds = board.draft.kind === "order" ? board.draft.cardIds : [];
      const materialized = materializePrefixAnchors(board, cardIds) ?? [];
      const current = new Set(
        materialized.filter((cardId) => availableIds.has(cardId)),
      ).size;
      return progress(current, availableIds.size, board.completed);
    }
    case "threshold": {
      const selectedCardIds =
        board.draft.kind === "threshold" ? board.draft.selectedCardIds : [];
      const current = new Set(
        selectedCardIds.filter((cardId) => availableIds.has(cardId)),
      ).size;
      return progress(current, board.minimumSelected, board.completed);
    }
  }
}

export function analysisOverallProgress(
  boards: AnalysisBoardView[],
): AnalysisBoardProgress {
  const current = boards.filter((board) => board.completed).length;
  return progress(current, boards.length, false);
}
