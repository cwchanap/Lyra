import { describe, expect, it } from "vitest";
import type { EvidenceRecord, GameStateView, StatementRecord } from "./types";
import { inferAcquisitionNotifications } from "./acquisition-notifications";

function evidence(id: string): EvidenceRecord {
  return {
    id,
    name: `Evidence ${id}`,
    description: `Description ${id}`,
    details: `Details ${id}`,
    imageAssetId: null,
    onReexamine: null,
    collectedInChapterId: "chapter_1",
    collectedInSceneId: "investigation_scene_1",
  };
}

function statement(id: string): StatementRecord {
  return {
    id,
    speaker: `Speaker ${id}`,
    content: `Statement ${id}`,
    onReexamine: null,
    acquiredInChapterId: "chapter_1",
    acquiredInSceneId: "investigation_scene_1",
  };
}

function state(
  evidenceRecords: EvidenceRecord[] = [],
  statementRecords: StatementRecord[] = [],
): GameStateView {
  return {
    chapter: {
      id: "chapter_1",
      title: "Chapter 1",
      summary: "",
      index: 0,
      total: 1,
    },
    scene: {
      kind: "investigation",
      id: "investigation_scene_1",
      title: "Investigation",
      index: 0,
      total: 1,
      currentSublocationId: "main",
      visibleSublocations: [],
    },
    mode: {
      type: "explore",
      sublocationId: "main",
      backgroundAssetId: null,
      bgm: null,
      bgs: null,
    },
    inventory: {
      evidence: evidenceRecords,
      statements: statementRecords,
    },
    dialogueHistory: [],
  };
}

describe("inferAcquisitionNotifications", () => {
  it("treats a missing previous state as hydration", () => {
    expect(
      inferAcquisitionNotifications(null, state([evidence("existing")], [])),
    ).toEqual([]);
  });

  it("returns new evidence before new statements while preserving array order", () => {
    const previous = state([evidence("known")], [statement("known")]);
    const next = state(
      [evidence("known"), evidence("photo"), evidence("receipt")],
      [statement("known"), statement("alibi"), statement("timeline")],
    );

    expect(inferAcquisitionNotifications(previous, next)).toEqual([
      {
        key: "evidence:photo",
        kind: "evidence",
        record: next.inventory.evidence[1],
      },
      {
        key: "evidence:receipt",
        kind: "evidence",
        record: next.inventory.evidence[2],
      },
      {
        key: "statement:alibi",
        kind: "statement",
        record: next.inventory.statements[1],
      },
      {
        key: "statement:timeline",
        kind: "statement",
        record: next.inventory.statements[2],
      },
    ]);
  });

  it("deduplicates repeated next-state IDs", () => {
    const duplicate = evidence("receipt");
    const notifications = inferAcquisitionNotifications(
      state(),
      state([duplicate, duplicate], []),
    );

    expect(notifications.map((notification) => notification.key)).toEqual([
      "evidence:receipt",
    ]);
  });

  it("ignores unchanged records, removals, and reset-to-empty transitions", () => {
    const previous = state([evidence("receipt")], [statement("alibi")]);

    expect(inferAcquisitionNotifications(previous, previous)).toEqual([]);
    expect(
      inferAcquisitionNotifications(previous, state([], [statement("alibi")])),
    ).toEqual([]);
    expect(inferAcquisitionNotifications(previous, state())).toEqual([]);
  });
});
