import { describe, expect, it } from "vitest";
import type { Mode, SceneView } from "$lib/state/types";
import {
  beat85CompilerAnalysisModeFixture,
  beat85CompilerAnalysisSceneFixture,
} from "./test-fixtures";
import {
  analysisBoardProgress,
  analysisOverallProgress,
  isAnalysisPresentationActive,
} from "./presentation";

const analysisScene = beat85CompilerAnalysisSceneFixture;
const analysisMode = beat85CompilerAnalysisModeFixture;

const dialogueMode: Extract<Mode, { type: "dialogue" }> = {
  type: "dialogue",
  current: { kind: "action", text: "場景切換" },
  queueRemaining: 0,
  sceneTag: null,
  queueToken: { sceneId: "another_scene", queueGen: 9, cursor: 0 },
  crossExamLineId: null,
  backgroundAssetId: null,
  bgm: null,
  bgs: null,
};

const investigationScene: SceneView = {
  kind: "investigation",
  id: "investigation_scene_1",
  title: "調查",
  summary: "調查場景",
  index: 0,
  total: 1,
  currentSublocationId: null,
  map: null,
  visibleSublocations: [],
};

describe("Analysis presentation helpers", () => {
  describe("isAnalysisPresentationActive", () => {
    it("keeps Analysis presentation active for Analysis mode", () => {
      expect(isAnalysisPresentationActive(analysisScene, analysisMode)).toBe(
        true,
      );
    });

    it("keeps Analysis presentation active for same-scene Dialogue", () => {
      expect(
        isAnalysisPresentationActive(analysisScene, {
          ...dialogueMode,
          queueToken: { sceneId: analysisScene.id, queueGen: 9, cursor: 0 },
        }),
      ).toBe(true);
    });

    it("leaves Analysis presentation for Dialogue from another scene", () => {
      expect(isAnalysisPresentationActive(analysisScene, dialogueMode)).toBe(
        false,
      );
    });

    it("leaves Analysis presentation when the scene is not Analysis", () => {
      expect(
        isAnalysisPresentationActive(investigationScene, dialogueMode),
      ).toBe(false);
    });
  });

  describe("analysisBoardProgress", () => {
    it("counts only available cards assigned to authored groups", () => {
      const board = analysisScene.visibleBoards.find(
        (candidate) => candidate.kind === "classify",
      );
      if (!board || board.kind !== "classify") throw new Error("missing board");

      expect(
        analysisBoardProgress({
          ...board,
          cards: board.cards.map((card) =>
            card.id === "external_credential_event"
              ? { ...card, available: false }
              : card,
          ),
          draft: {
            kind: "classify",
            groupByCard: {
              miyake_call: "miyake_small_lies",
              l_corridor_replay: "unknown_group",
              external_credential_event: "earlier_third_party",
              unknown_card: "miyake_small_lies",
            },
          },
        }),
      ).toEqual({
        current: 1,
        target: 2,
        percent: (1 / 2) * 100,
      });
    });

    it("materializes the fixed Order prefix once and ignores stale IDs", () => {
      const board = analysisScene.visibleBoards.find(
        (candidate) => candidate.kind === "order",
      );
      if (!board || board.kind !== "order") throw new Error("missing board");

      expect(
        analysisBoardProgress({
          ...board,
          draft: {
            kind: "order",
            cardIds: ["event_1841", "event_1841", "event_1842", "unknown"],
          },
        }),
      ).toEqual({
        current: 2,
        target: 4,
        percent: 50,
      });
    });

    it("caps Threshold participation at the minimum", () => {
      const board = analysisScene.visibleBoards.find(
        (candidate) => candidate.kind === "threshold",
      );
      if (!board || board.kind !== "threshold") {
        throw new Error("missing board");
      }

      expect(
        analysisBoardProgress({
          ...board,
          draft: {
            kind: "threshold",
            selectedCardIds: [
              "lock_sequence",
              "phone_notification",
              "manager_timing",
              "unknown",
            ],
          },
        }),
      ).toEqual({
        current: 3,
        target: 2,
        percent: 100,
      });
    });

    it("reports a completed board as 100 percent", () => {
      const board = analysisScene.visibleBoards[0];
      expect(
        analysisBoardProgress({
          ...board,
          completed: true,
          draft: { kind: "classify", groupByCard: {} },
        }).percent,
      ).toBe(100);
    });

    it("reports zero progress when no cards are available", () => {
      const board = analysisScene.visibleBoards.find(
        (candidate) => candidate.kind === "classify",
      );
      if (!board || board.kind !== "classify") throw new Error("missing board");

      expect(
        analysisBoardProgress({
          ...board,
          cards: board.cards.map((card) => ({ ...card, available: false })),
          draft: { kind: "classify", groupByCard: {} },
        }),
      ).toEqual({ current: 0, target: 0, percent: 0 });
    });

    it("falls back to an empty groupByCard for a stale non-classify draft", () => {
      const board = analysisScene.visibleBoards.find(
        (candidate) => candidate.kind === "classify",
      );
      if (!board || board.kind !== "classify") throw new Error("missing board");

      expect(
        analysisBoardProgress({
          ...board,
          draft: { kind: "order", cardIds: [] },
        }),
      ).toEqual({ current: 0, target: 3, percent: 0 });
    });

    it("falls back to an empty cardIds list for a stale non-order draft", () => {
      const board = analysisScene.visibleBoards.find(
        (candidate) => candidate.kind === "order",
      );
      if (!board || board.kind !== "order") throw new Error("missing board");

      expect(
        analysisBoardProgress({
          ...board,
          draft: { kind: "classify", groupByCard: {} },
        }),
      ).toEqual({ current: 1, target: 4, percent: 25 });
    });

    it("falls back to an empty materialized list when the order board is blocked", () => {
      const board = analysisScene.visibleBoards.find(
        (candidate) => candidate.kind === "order",
      );
      if (!board || board.kind !== "order") throw new Error("missing board");

      expect(
        analysisBoardProgress({
          ...board,
          fixedAnchors: [{ cardId: "event_1843", position: 3 }],
          draft: { kind: "order", cardIds: ["event_1841", "event_1842"] },
        }),
      ).toEqual({ current: 0, target: 4, percent: 0 });
    });

    it("falls back to an empty selectedCardIds list for a stale non-threshold draft", () => {
      const board = analysisScene.visibleBoards.find(
        (candidate) => candidate.kind === "threshold",
      );
      if (!board || board.kind !== "threshold") {
        throw new Error("missing board");
      }

      expect(
        analysisBoardProgress({
          ...board,
          draft: { kind: "classify", groupByCard: {} },
        }),
      ).toEqual({ current: 0, target: 2, percent: 0 });
    });
  });

  describe("analysisOverallProgress", () => {
    it("counts completed visible boards", () => {
      const [classify, order, threshold] = analysisScene.visibleBoards;
      expect(
        analysisOverallProgress([
          classify,
          { ...order, completed: true },
          threshold,
        ]),
      ).toEqual({
        current: 1,
        target: 3,
        percent: (1 / 3) * 100,
      });
    });
  });
});
