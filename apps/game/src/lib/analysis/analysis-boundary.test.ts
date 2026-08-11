import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  beat85CompilerAnalysisInventoryFixture,
  beat85CompilerAnalysisSceneFixture,
  p1PracticeAnalysisModeFixture,
  p1PracticeAnalysisSceneFixture,
} from "./test-fixtures";

const FEATURE_FILES = [
  "./test-fixtures.ts",
  "./order-draft.ts",
  "../components/analysis/AnalysisCard.svelte",
  "../components/analysis/ClassifyBoard.svelte",
  "../components/analysis/OrderBoard.svelte",
  "../components/analysis/ThresholdBoard.svelte",
  "../components/analysis/AnalysisWorkbench.svelte",
] as const;

describe("Analysis UI public fixtures", () => {
  it("keeps the P1 practice scene and mode on the public wire", () => {
    expect(p1PracticeAnalysisSceneFixture.id).toBe("analysis_scene_p1_5");
    expect(p1PracticeAnalysisSceneFixture.activeBoardId).toBe(
      "p1_reprint_time_board",
    );
    expect(p1PracticeAnalysisSceneFixture.visibleBoards).toHaveLength(1);
    const board = p1PracticeAnalysisSceneFixture.visibleBoards[0];
    expect(board.kind).toBe("threshold");
    if (board.kind !== "threshold") return;
    expect(board.id).toBe("p1_reprint_time_board");
    expect(board.cards).toHaveLength(4);
    expect(board.cards.every((card) => card.source.kind === "practice")).toBe(
      true,
    );
    expect(board.cards.every((card) => card.available)).toBe(true);
    expect(board.draft).toEqual({ kind: "threshold", selectedCardIds: [] });
    expect(board.selectedCardIds).toEqual([]);
    expect(p1PracticeAnalysisModeFixture).toMatchObject({
      type: "analysis",
      boardId: "p1_reprint_time_board",
      activeBoardId: "p1_reprint_time_board",
      actionToken: {
        sceneId: "analysis_scene_p1_5",
        activeBoardId: "p1_reprint_time_board",
        durableRevision: 3,
      },
    });
  });

  it("pins the public compiler-contract board union", () => {
    expect(
      beat85CompilerAnalysisSceneFixture.visibleBoards.map((board) => [
        board.id,
        board.kind,
      ]),
    ).toEqual([
      ["evidence_packages", "classify"],
      ["local_event_sequence", "order"],
      ["narrow_request_basis", "threshold"],
    ]);

    const [classify, order, threshold] =
      beat85CompilerAnalysisSceneFixture.visibleBoards;
    expect(classify.draft).toEqual({ kind: "classify", groupByCard: {} });
    expect(order.draft).toEqual({ kind: "order", cardIds: ["event_1841"] });
    expect(order.kind === "order" ? order.fixedAnchors : null).toEqual([
      { cardId: "event_1841", position: 1 },
    ]);
    expect(threshold.draft).toEqual({
      kind: "threshold",
      selectedCardIds: ["lock_sequence"],
    });
    expect(
      threshold.kind === "threshold" ? threshold.minimumSelected : null,
    ).toBe(2);
    expect(
      beat85CompilerAnalysisSceneFixture.visibleBoards.every(
        (board) =>
          board.available &&
          !board.completed &&
          !board.readOnly &&
          board.cards.every((card) => card.available),
      ),
    ).toBe(true);
  });

  it("exposes threshold records through neutral public inventory builders", () => {
    const { evidence, statements } = beat85CompilerAnalysisInventoryFixture;
    const lock = evidence.find((record) => record.id === "lock_sequence");
    const manager = statements.find((record) => record.id === "manager_timing");

    expect(lock?.provenance.sourceGroupId).toBe("door-lock");
    expect(lock?.provenance.sourceLabel).toBe("雨鐘後場門鎖");
    expect(lock?.sourceGroup).toEqual({
      id: "door-lock",
      label: "門鎖本機",
      summary: "雨鐘後場門鎖的本機資料。",
    });
    expect(manager?.provenance.sourceGroupId).toBe("manager-interview");
    expect(
      evidence.filter(
        (record) => record.provenance.sourceGroupId === "door-lock",
      ),
    ).toHaveLength(2);
  });

  it("keeps accepted answers out of Analysis UI fixtures", () => {
    const fixture = JSON.stringify(beat85CompilerAnalysisSceneFixture);
    expect(fixture).not.toMatch(
      /acceptedGroupByCard|acceptedOrder|acceptedSelections/,
    );
  });

  it("keeps accepted answers out of all frontend Analysis source", () => {
    const sources = FEATURE_FILES.map((relativePath) =>
      readFileSync(
        fileURLToPath(new URL(relativePath, import.meta.url)),
        "utf8",
      ),
    );

    expect(sources).toHaveLength(FEATURE_FILES.length);
    expect(sources.join("\n")).not.toMatch(
      /acceptedGroupByCard|acceptedOrder|acceptedSelections/,
    );
  });
});
