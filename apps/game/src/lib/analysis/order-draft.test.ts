import { describe, expect, it } from "vitest";
import { beat85CompilerAnalysisSceneFixture } from "./test-fixtures";
import {
  addOrderCard,
  materializePrefixAnchors,
  moveOrderCard,
  orderBoardBlockReason,
  placeOrderCardBefore,
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

  describe("prefixAnchors validation", () => {
    it("treats a missing fixedAnchors array as unsupported", () => {
      const noAnchors = boardWith({
        fixedAnchors: undefined as unknown as never,
      });
      expect(orderBoardBlockReason(noAnchors)).toBe("unsupportedAnchors");
    });

    it("rejects a non-array fixedAnchors value", () => {
      const badAnchors = boardWith({
        fixedAnchors: "not-an-array" as unknown as never,
      });
      expect(orderBoardBlockReason(badAnchors)).toBe("unsupportedAnchors");
    });

    it("rejects a non-object anchor entry", () => {
      const badAnchor = boardWith({
        fixedAnchors: ["not-an-object" as unknown as never],
      });
      expect(orderBoardBlockReason(badAnchor)).toBe("unsupportedAnchors");
    });

    it("rejects an anchor with a non-string cardId", () => {
      const badAnchor = boardWith({
        fixedAnchors: [{ cardId: 123, position: 1 } as unknown as never],
      });
      expect(orderBoardBlockReason(badAnchor)).toBe("unsupportedAnchors");
    });

    it("rejects an anchor with a non-number position", () => {
      const badAnchor = boardWith({
        fixedAnchors: [
          { cardId: "event_1841", position: "1" } as unknown as never,
        ],
      });
      expect(orderBoardBlockReason(badAnchor)).toBe("unsupportedAnchors");
    });

    it("rejects a non-integer position", () => {
      const badAnchor = boardWith({
        fixedAnchors: [{ cardId: "event_1841", position: 1.5 }],
      });
      expect(orderBoardBlockReason(badAnchor)).toBe("unsupportedAnchors");
    });

    it("rejects a position below 1", () => {
      const badAnchor = boardWith({
        fixedAnchors: [{ cardId: "event_1841", position: 0 }],
      });
      expect(orderBoardBlockReason(badAnchor)).toBe("unsupportedAnchors");
    });

    it("rejects duplicate cardIds in fixed anchors", () => {
      const dup = boardWith({
        fixedAnchors: [
          { cardId: "event_1841", position: 1 },
          { cardId: "event_1841", position: 2 },
        ],
      });
      expect(orderBoardBlockReason(dup)).toBe("unsupportedAnchors");
    });

    it("rejects duplicate positions in fixed anchors", () => {
      const dup = boardWith({
        fixedAnchors: [
          { cardId: "event_1841", position: 1 },
          { cardId: "event_1842", position: 1 },
        ],
      });
      expect(orderBoardBlockReason(dup)).toBe("unsupportedAnchors");
    });

    it("rejects a non-contiguous prefix (gap)", () => {
      const gap = boardWith({
        fixedAnchors: [{ cardId: "event_1841", position: 2 }],
      });
      expect(orderBoardBlockReason(gap)).toBe("unsupportedAnchors");
    });

    it("accepts a contiguous multi-anchor prefix", () => {
      const contiguous = boardWith({
        fixedAnchors: [
          { cardId: "event_1841", position: 1 },
          { cardId: "event_1842", position: 2 },
        ],
      });
      expect(orderBoardBlockReason(contiguous)).toBeNull();
    });
  });

  describe("publicCards shape tolerance", () => {
    it("treats a missing cards array as empty", () => {
      const noCards = boardWith({ cards: undefined as unknown as never });
      // With no cards, the fixed anchor card cannot be found -> unavailable.
      expect(orderBoardBlockReason(noCards)).toBe("fixedAnchorUnavailable");
    });

    it("filters out non-card entries from a malformed cards array", () => {
      const malformed = boardWith({
        cards: [
          null,
          "not-a-card",
          { id: "event_1841", label: "x", summary: "y", available: true },
        ] as unknown as never,
      });
      expect(orderBoardBlockReason(malformed)).toBeNull();
    });
  });

  describe("addOrderCard", () => {
    it("returns the materialized draft unchanged when the card is already included", () => {
      expect(
        addOrderCard(fixtureBoard, ["event_1841", "event_1842"], "event_1842"),
      ).toEqual(["event_1841", "event_1842"]);
    });

    it("returns null for an unknown card id", () => {
      expect(
        addOrderCard(fixtureBoard, ["event_1841"], "unknown_card"),
      ).toBeNull();
    });

    it("returns null when the board has unsupported anchors", () => {
      const blockedBoard = boardWith({
        fixedAnchors: [{ cardId: "event_1843", position: 3 }],
      });
      // event_1842 is a valid available card, but materialization is blocked.
      expect(
        addOrderCard(blockedBoard, ["event_1841"], "event_1842"),
      ).toBeNull();
    });
  });

  describe("moveOrderCard", () => {
    it("moves a card down (direction +1)", () => {
      const draft = ["event_1841", "event_1842", "event_1843", "event_1844"];
      expect(moveOrderCard(fixtureBoard, draft, "event_1842", 1)).toEqual([
        "event_1841",
        "event_1843",
        "event_1842",
        "event_1844",
      ]);
    });

    it("returns the draft unchanged when moving the last card down", () => {
      const draft = ["event_1841", "event_1842", "event_1843", "event_1844"];
      expect(moveOrderCard(fixtureBoard, draft, "event_1844", 1)).toEqual(
        draft,
      );
    });

    it("returns the draft unchanged when moving up at the prefix boundary", () => {
      const draft = ["event_1841", "event_1842", "event_1843"];
      // event_1842 is at index 1, prefix length is 1, so moving up would
      // target index 0 which is < prefixLength — no move.
      expect(moveOrderCard(fixtureBoard, draft, "event_1842", -1)).toEqual(
        draft,
      );
    });

    it("returns the draft unchanged when the card is not in the draft", () => {
      const draft = ["event_1841", "event_1842"];
      expect(moveOrderCard(fixtureBoard, draft, "event_1843", -1)).toEqual(
        draft,
      );
    });

    it("returns null for an unknown card id", () => {
      expect(
        moveOrderCard(fixtureBoard, ["event_1841"], "unknown_card", 1),
      ).toBeNull();
    });

    it("returns null for an unavailable card", () => {
      const unavailableBoard = boardWith({
        cards: fixtureBoard.cards.map((card) =>
          card.id === "event_1842" ? { ...card, available: false } : card,
        ),
      });
      expect(
        moveOrderCard(unavailableBoard, ["event_1841"], "event_1842", 1),
      ).toBeNull();
    });

    it("returns null when the board has unsupported anchors", () => {
      const blockedBoard = boardWith({
        fixedAnchors: [{ cardId: "event_1843", position: 3 }],
      });
      // event_1842 is a valid available card, but materialization is blocked.
      expect(
        moveOrderCard(blockedBoard, ["event_1841"], "event_1842", 1),
      ).toBeNull();
    });
  });

  describe("removeOrderCard", () => {
    it("returns the draft unchanged when removing a fixed anchor card", () => {
      const draft = ["event_1841", "event_1842"];
      expect(removeOrderCard(fixtureBoard, draft, "event_1841")).toEqual(draft);
    });

    it("returns the draft unchanged when the card is not present", () => {
      const draft = ["event_1841", "event_1842"];
      expect(removeOrderCard(fixtureBoard, draft, "event_1843")).toEqual(draft);
    });

    it("returns null when the board has unsupported anchors", () => {
      const blockedBoard = boardWith({
        fixedAnchors: [{ cardId: "event_1843", position: 3 }],
      });
      expect(
        removeOrderCard(blockedBoard, ["event_1841"], "event_1842"),
      ).toBeNull();
    });
  });

  describe("materializePrefixAnchors", () => {
    it("omits stale card ids that are not in the public card list", () => {
      expect(
        materializePrefixAnchors(fixtureBoard, [
          "event_1841",
          "stale_id",
          "event_1842",
        ]),
      ).toEqual(["event_1841", "event_1842"]);
    });

    it("omits unavailable movable card ids", () => {
      const unavailableBoard = boardWith({
        cards: fixtureBoard.cards.map((card) =>
          card.id === "event_1842" ? { ...card, available: false } : card,
        ),
      });
      // The board is still valid (fixed anchor event_1841 is available), but
      // event_1842 is unavailable so it is omitted from the materialized list.
      expect(
        materializePrefixAnchors(unavailableBoard, [
          "event_1841",
          "event_1842",
        ]),
      ).toEqual(["event_1841"]);
    });

    it("does not duplicate a movable card id that matches a fixed anchor", () => {
      expect(
        materializePrefixAnchors(fixtureBoard, ["event_1841", "event_1841"]),
      ).toEqual(["event_1841"]);
    });
  });

  describe("placeOrderCardBefore", () => {
    it("inserts a pending card before a movable card", () => {
      expect(
        placeOrderCardBefore(
          fixtureBoard,
          ["event_1841", "event_1843"],
          "event_1842",
          "event_1843",
        ),
      ).toEqual(["event_1841", "event_1842", "event_1843"]);
    });

    it("reorders an existing movable card before another movable card", () => {
      expect(
        placeOrderCardBefore(
          fixtureBoard,
          ["event_1841", "event_1842", "event_1843"],
          "event_1843",
          "event_1842",
        ),
      ).toEqual(["event_1841", "event_1843", "event_1842"]);
    });

    it("appends a pending card when the target is the end", () => {
      expect(
        placeOrderCardBefore(
          fixtureBoard,
          ["event_1841", "event_1842"],
          "event_1843",
          null,
        ),
      ).toEqual(["event_1841", "event_1842", "event_1843"]);
    });

    it("returns an unchanged draft for a valid no-op", () => {
      const draft = ["event_1841", "event_1842", "event_1843"];
      expect(
        placeOrderCardBefore(fixtureBoard, draft, "event_1842", "event_1843"),
      ).toEqual(draft);
    });

    it.each([
      ["unknown source", "unknown_card"],
      ["unavailable source", "event_1842"],
    ])("rejects an %s", (_label, sourceId) => {
      const board =
        sourceId === "event_1842"
          ? boardWith({
              cards: fixtureBoard.cards.map((card) =>
                card.id === sourceId ? { ...card, available: false } : card,
              ),
            })
          : fixtureBoard;

      expect(
        placeOrderCardBefore(
          board,
          ["event_1841", "event_1843"],
          sourceId,
          "event_1843",
        ),
      ).toBeNull();
    });

    it("rejects a fixed-anchor source", () => {
      expect(
        placeOrderCardBefore(
          fixtureBoard,
          ["event_1841", "event_1842"],
          "event_1841",
          "event_1842",
        ),
      ).toBeNull();
    });

    it.each(["unknown_card", "event_1841"])(
      "rejects an unknown or fixed-prefix target: %s",
      (targetId) => {
        expect(
          placeOrderCardBefore(
            fixtureBoard,
            ["event_1841", "event_1842"],
            "event_1843",
            targetId,
          ),
        ).toBeNull();
      },
    );

    it("returns null when the board has unsupported anchors", () => {
      const blockedBoard = boardWith({
        fixedAnchors: [{ cardId: "event_1843", position: 3 }],
      });
      expect(
        placeOrderCardBefore(
          blockedBoard,
          ["event_1841"],
          "event_1842",
          "event_1843",
        ),
      ).toBeNull();
    });

    it("returns null when beforeCardId is a valid movable card not in the materialized draft", () => {
      // event_1843 is a valid available movable card but is not in the
      // materialized draft, so targetIndex < 0 rejects the placement.
      expect(
        placeOrderCardBefore(
          fixtureBoard,
          ["event_1841", "event_1842"],
          "event_1842",
          "event_1843",
        ),
      ).toBeNull();
    });

    it("returns the unchanged materialized draft when placing a card before itself", () => {
      const draft = ["event_1841", "event_1842", "event_1843"];
      expect(
        placeOrderCardBefore(fixtureBoard, draft, "event_1842", "event_1842"),
      ).toEqual(draft);
    });

    it("appends an existing timeline card to the end when beforeCardId is null", () => {
      expect(
        placeOrderCardBefore(
          fixtureBoard,
          ["event_1841", "event_1842", "event_1843"],
          "event_1842",
          null,
        ),
      ).toEqual(["event_1841", "event_1843", "event_1842"]);
    });
  });
});
