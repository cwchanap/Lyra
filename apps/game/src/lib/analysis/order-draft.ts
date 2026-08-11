import type { AnalysisBoardView, AnalysisCardView } from "$lib/state/types";

export type OrderBoardView = Extract<AnalysisBoardView, { kind: "order" }>;

export type OrderBoardBlockReason =
  | "unsupportedAnchors"
  | "fixedAnchorUnavailable"
  | null;

type PrefixAnchor = { cardId: string; position: number };

/**
 * Return fixed anchors only when the public board describes a supported,
 * contiguous prefix.  The runtime wire is trusted by TypeScript, but this
 * helper deliberately checks the shape again so stale views cannot make the
 * renderer throw or move a fixed card.
 */
function prefixAnchors(board: OrderBoardView): PrefixAnchor[] | null {
  const value = board as unknown as { fixedAnchors?: unknown };
  if (!Array.isArray(value.fixedAnchors)) return null;

  const anchors: PrefixAnchor[] = [];
  const cardIds = new Set<string>();
  const positions = new Set<number>();
  for (const candidate of value.fixedAnchors) {
    if (!candidate || typeof candidate !== "object") return null;
    const anchor = candidate as {
      cardId?: unknown;
      position?: unknown;
    };
    if (
      typeof anchor.cardId !== "string" ||
      typeof anchor.position !== "number" ||
      !Number.isSafeInteger(anchor.position) ||
      anchor.position < 1 ||
      cardIds.has(anchor.cardId) ||
      positions.has(anchor.position)
    ) {
      return null;
    }
    cardIds.add(anchor.cardId);
    positions.add(anchor.position);
    anchors.push({ cardId: anchor.cardId, position: anchor.position });
  }

  anchors.sort((left, right) => left.position - right.position);
  if (anchors.some((anchor, index) => anchor.position !== index + 1)) {
    return null;
  }
  return anchors;
}

function publicCards(board: OrderBoardView): AnalysisCardView[] {
  const value = board as unknown as { cards?: unknown };
  if (!Array.isArray(value.cards)) return [];
  return value.cards.filter(
    (candidate): candidate is AnalysisCardView =>
      Boolean(candidate) &&
      typeof candidate === "object" &&
      typeof (candidate as { id?: unknown }).id === "string",
  );
}

export function orderBoardBlockReason(
  board: OrderBoardView,
): OrderBoardBlockReason {
  const anchors = prefixAnchors(board);
  if (!anchors) return "unsupportedAnchors";

  const cardsById = new Map(publicCards(board).map((card) => [card.id, card]));
  if (anchors.some(({ cardId }) => cardsById.get(cardId)?.available !== true)) {
    return "fixedAnchorUnavailable";
  }
  return null;
}

/**
 * Materialize a structural draft with the fixed prefix prepended exactly once.
 * Unknown or unavailable stale card ids are omitted rather than emitted.
 */
export function materializePrefixAnchors(
  board: OrderBoardView,
  cardIds: string[],
): string[] | null {
  if (orderBoardBlockReason(board) !== null) return null;
  const anchors = prefixAnchors(board);
  if (!anchors) return null;

  const cardsById = new Map(publicCards(board).map((card) => [card.id, card]));
  const fixedIds = new Set(anchors.map(({ cardId }) => cardId));
  const result = anchors.map(({ cardId }) => cardId);
  const emitted = new Set(result);

  for (const cardId of cardIds) {
    if (emitted.has(cardId)) continue;
    if (cardsById.get(cardId)?.available !== true) continue;
    emitted.add(cardId);
    result.push(cardId);
  }

  // Keep this explicit to document the prefix boundary for callers that add
  // more anchors in a future contract revision.
  for (const cardId of fixedIds) emitted.add(cardId);
  return result;
}

export function addOrderCard(
  board: OrderBoardView,
  cardIds: string[],
  cardId: string,
): string[] | null {
  const card = publicCards(board).find((candidate) => candidate.id === cardId);
  if (!card || card.available !== true) return null;

  const materialized = materializePrefixAnchors(board, cardIds);
  if (!materialized) return null;
  if (materialized.includes(cardId)) return materialized;
  return [...materialized, cardId];
}

export function moveOrderCard(
  board: OrderBoardView,
  cardIds: string[],
  cardId: string,
  direction: -1 | 1,
): string[] | null {
  const card = publicCards(board).find((candidate) => candidate.id === cardId);
  if (!card || card.available !== true) return null;

  const materialized = materializePrefixAnchors(board, cardIds);
  if (!materialized) return null;
  const anchors = prefixAnchors(board);
  if (!anchors) return null;
  const prefixLength = anchors.length;
  const index = materialized.indexOf(cardId);
  if (index < prefixLength || index < 0) return materialized;

  const nextIndex = index + direction;
  if (nextIndex < prefixLength || nextIndex >= materialized.length) {
    return materialized;
  }
  const next = [...materialized];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

export function removeOrderCard(
  board: OrderBoardView,
  cardIds: string[],
  cardId: string,
): string[] | null {
  const materialized = materializePrefixAnchors(board, cardIds);
  if (!materialized) return null;
  const anchors = prefixAnchors(board);
  if (!anchors) return null;
  if (anchors.some((anchor) => anchor.cardId === cardId)) return materialized;

  const index = materialized.indexOf(cardId);
  if (index < 0) return materialized;
  return materialized.filter((candidate) => candidate !== cardId);
}
