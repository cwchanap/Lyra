import { describe, expect, it } from "vitest";
import { beat85CompilerAnalysisSceneFixture } from "./test-fixtures";
import {
  addOrderCard,
  materializePrefixAnchors,
  moveOrderCard,
  orderBoardBlockReason,
  removeOrderCard,
} from "./order-draft";
import type { AnalysisBoardView } from "$lib/state/types";

type OrderBoardView = Extract<AnalysisBoardView, { kind: "order" }>;

function requireFixtureBoard(): OrderBoardView {
  const board = beat85CompilerAnalysisSceneFixture.visibleBoards.find(
    (candidate): candidate is OrderBoardView => candidate.kind === "order",
  );
  if (!board) {
    throw new Error(
      "The compiler analysis fixture must contain an order board",
    );
  }
  return board;
}

const fixtureBoard = requireFixtureBoard();

function boardWith(overrides: Partial<OrderBoardView> = {}): OrderBoardView {
  return { ...fixtureBoard, ...overrides };
}

describe("order draft algebra", () => {
  it("pins the compiler fixture's prefix anchor", () => {
    expect(fixtureBoard.fixedAnchors).toEqual([
      { cardId: "event_1841", position: 1 },
    ]);
  });

  it("adds an available movable card after the fixed prefix", () => {
    expect(addOrderCard(fixtureBoard, ["event_1841"], "event_1842")).toEqual([
      "event_1841",
      "event_1842",
    ]);
  });

  it("moves movable cards without crossing the fixed prefix", () => {
    const draft = ["event_1841", "event_1842", "event_1843", "event_1844"];
    expect(moveOrderCard(fixtureBoard, draft, "event_1843", -1)).toEqual([
      "event_1841",
      "event_1843",
      "event_1842",
      "event_1844",
    ]);
  });

  it("removes a movable card while retaining the fixed prefix", () => {
    expect(
      removeOrderCard(fixtureBoard, ["event_1841", "event_1842"], "event_1842"),
    ).toEqual(["event_1841"]);
  });

  it("reports a non-prefix public view without throwing", () => {
    const staleBoard = boardWith({
      fixedAnchors: [{ cardId: "event_1843", position: 3 }],
    });

    expect(() => orderBoardBlockReason(staleBoard)).not.toThrow();
    expect(orderBoardBlockReason(staleBoard)).toBe("unsupportedAnchors");
    expect(materializePrefixAnchors(staleBoard, ["event_1841"])).toBeNull();
  });

  it("blocks materialization when a fixed anchor is unavailable", () => {
    const unavailableBoard = boardWith({
      cards: fixtureBoard.cards.map((card) =>
        card.id === "event_1841" ? { ...card, available: false } : card,
      ),
    });

    expect(orderBoardBlockReason(unavailableBoard)).toBe(
      "fixedAnchorUnavailable",
    );
    expect(materializePrefixAnchors(unavailableBoard, [])).toBeNull();
  });

  it("does not add unavailable movable cards", () => {
    const unavailableBoard = boardWith({
      cards: fixtureBoard.cards.map((card) =>
        card.id === "event_1842" ? { ...card, available: false } : card,
      ),
    });

    expect(
      addOrderCard(unavailableBoard, ["event_1841"], "event_1842"),
    ).toBeNull();
  });
});
