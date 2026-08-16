import { describe, expect, it } from "vitest";
import { beat85CompilerAnalysisSceneFixture } from "./test-fixtures";
import {
  applyClassifyPlacement,
  type ClassifyBoardView,
  type ClassifyPlacementTarget,
} from "./classify-draft";

function requireClassifyBoard(): ClassifyBoardView {
  const board = beat85CompilerAnalysisSceneFixture.visibleBoards.find(
    (candidate): candidate is ClassifyBoardView =>
      candidate.kind === "classify",
  );
  if (!board) {
    throw new Error(
      "The compiler analysis fixture must contain a classify board",
    );
  }
  return board;
}

const board = requireClassifyBoard();
const unavailableBoard: ClassifyBoardView = {
  ...board,
  cards: board.cards.map((card) =>
    card.id === "miyake_call" ? { ...card, available: false } : card,
  ),
};

type PlacementCase = {
  name: string;
  board?: ClassifyBoardView;
  groupByCard: Record<string, string>;
  cardId: string;
  target: ClassifyPlacementTarget;
  expected: Record<string, string> | null;
  sameObject?: boolean;
};

const placementCases: PlacementCase[] = [
  {
    name: "assigns an available card to a known group",
    groupByCard: { l_corridor_replay: "earlier_third_party" },
    cardId: "miyake_call",
    target: { kind: "group", groupId: "miyake_small_lies" },
    expected: {
      l_corridor_replay: "earlier_third_party",
      miyake_call: "miyake_small_lies",
    },
  },
  {
    name: "moves a card from one group to another",
    groupByCard: {
      miyake_call: "miyake_small_lies",
      l_corridor_replay: "earlier_third_party",
    },
    cardId: "miyake_call",
    target: { kind: "group", groupId: "earlier_third_party" },
    expected: {
      miyake_call: "earlier_third_party",
      l_corridor_replay: "earlier_third_party",
    },
  },
  {
    name: "unassigns a card from its current group",
    groupByCard: {
      miyake_call: "miyake_small_lies",
      l_corridor_replay: "earlier_third_party",
    },
    cardId: "miyake_call",
    target: { kind: "unassigned" },
    expected: { l_corridor_replay: "earlier_third_party" },
  },
  {
    name: "returns the same object for a same-group placement",
    groupByCard: { miyake_call: "miyake_small_lies" },
    cardId: "miyake_call",
    target: { kind: "group", groupId: "miyake_small_lies" },
    expected: { miyake_call: "miyake_small_lies" },
    sameObject: true,
  },
  {
    name: "returns the same object when an already-unassigned card is unassigned",
    groupByCard: { l_corridor_replay: "earlier_third_party" },
    cardId: "miyake_call",
    target: { kind: "unassigned" },
    expected: { l_corridor_replay: "earlier_third_party" },
    sameObject: true,
  },
  {
    name: "returns null for an unknown card",
    groupByCard: {},
    cardId: "unknown_card",
    target: { kind: "group", groupId: "miyake_small_lies" },
    expected: null,
  },
  {
    name: "returns null for an unavailable card",
    board: unavailableBoard,
    groupByCard: {},
    cardId: "miyake_call",
    target: { kind: "group", groupId: "miyake_small_lies" },
    expected: null,
  },
  {
    name: "returns null for an unknown group",
    groupByCard: {},
    cardId: "miyake_call",
    target: { kind: "group", groupId: "unknown_group" },
    expected: null,
  },
];

describe("applyClassifyPlacement", () => {
  it.each(placementCases)("$name", (testCase) => {
    const result = applyClassifyPlacement(
      testCase.board ?? board,
      testCase.groupByCard,
      testCase.cardId,
      testCase.target,
    );

    expect(result).toEqual(testCase.expected);
    if (testCase.sameObject) {
      expect(result).toBe(testCase.groupByCard);
    }
  });
});
