import type { AnalysisBoardView } from "$lib/state/types";

export type ClassifyBoardView = Extract<
  AnalysisBoardView,
  { kind: "classify" }
>;

export type ClassifyPlacementTarget =
  | { kind: "unassigned" }
  | { kind: "group"; groupId: string };

export function applyClassifyPlacement(
  board: ClassifyBoardView,
  groupByCard: Record<string, string>,
  cardId: string,
  target: ClassifyPlacementTarget,
): Record<string, string> | null {
  const card = board.cards.find((candidate) => candidate.id === cardId);
  if (!card || !card.available) return null;

  if (target.kind === "unassigned") {
    if (groupByCard[cardId] === undefined) return groupByCard;

    const next = { ...groupByCard };
    delete next[cardId];
    return next;
  }

  if (!board.groups.some((group) => group.id === target.groupId)) {
    return null;
  }
  if (groupByCard[cardId] === target.groupId) return groupByCard;

  return { ...groupByCard, [cardId]: target.groupId };
}
