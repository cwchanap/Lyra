import { describe, expect, it } from "vitest";
import {
  neutralCaseRecordProvenance,
  neutralEvidenceRecordView,
  neutralStatementRecordView,
} from "$lib/state/test-fixtures";
import { caseRecordProvenancePresentation } from "./provenance-badges";

describe("caseRecordProvenancePresentation", () => {
  it("maps provenance and source-group metadata to Case File labels", () => {
    const record = neutralEvidenceRecordView({
      id: "register-export",
      name: "收銀紀錄",
      description: "原始匯出。",
      details: "十七點四十二分。",
      imageAssetId: null,
      onReexamine: null,
      collectedInChapterId: "chapter_1",
      collectedInSceneId: "scene_1",
    });
    record.provenance = {
      ...neutralCaseRecordProvenance(),
      sourceKind: "digital",
      representationLayer: "raw",
      proceduralStatus: "exhibit",
      completeness: "complete",
      confidence: "corroborated",
      sourceGroupId: "register",
      sourceLabel: "鑑識原始匯出",
      proofCapabilities: ["time", "order"],
    };
    record.sourceGroup = {
      id: "register",
      label: "店內收銀紀錄",
      summary: "同一台收銀機的匯出紀錄。",
    };

    const presentation = caseRecordProvenancePresentation(record);

    expect(presentation.source).toBe("鑑識原始匯出");
    expect(presentation.sourceGroup).toBe("店內收銀紀錄");
    expect(presentation.proceduralStatus).toBe("正式證物");
    expect(presentation.proofCapabilities).toBe("時間、順序");
    expect(presentation).toMatchObject({
      sourceKind: "數位紀錄",
      representationLayer: "原始紀錄",
      completeness: "完整",
      confidence: "已佐證",
      sourceGroupSummary: "同一台收銀機的匯出紀錄。",
    });
  });

  it("uses a source-group label as the source without duplicating the group", () => {
    const record = neutralStatementRecordView({
      id: "witness",
      speaker: "目擊者",
      content: "我在店內。",
      onReexamine: null,
      acquiredInChapterId: "chapter_1",
      acquiredInSceneId: "scene_1",
    });
    record.provenance = {
      ...neutralCaseRecordProvenance(),
      sourceKind: "testimony",
      sourceGroupId: "witnesses",
      sourceLabel: null,
    };
    record.sourceGroup = {
      id: "witnesses",
      label: "現場目擊者",
      summary: "同一時段在店內的人。",
    };

    const presentation = caseRecordProvenancePresentation(record);

    expect(presentation.source).toBe("現場目擊者");
    expect(presentation.sourceGroup).toBeNull();
  });
});
