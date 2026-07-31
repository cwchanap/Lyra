import type {
  CaseRecordProvenance,
  EvidenceRecord,
  StatementRecord,
} from "./types";

export function neutralCaseRecordProvenance(): CaseRecordProvenance {
  return {
    sourceKind: "unspecified",
    representationLayer: "none",
    proceduralStatus: "unspecified",
    completeness: "unspecified",
    confidence: "unspecified",
    sourceGroupId: null,
    sourceLabel: null,
    proofCapabilities: [],
    supersedesRecordId: null,
  };
}

const neutralAcquisitionContext = {
  chapterId: "chapter_fixture",
  chapterTitle: "測試章節",
  sceneId: "scene_fixture",
  sceneTitle: "測試場景",
} as const;

export function neutralEvidenceRecordView(
  record: Omit<
    EvidenceRecord,
    "provenance" | "acquisitionContext" | "sourceGroup"
  >,
): EvidenceRecord {
  return {
    ...record,
    provenance: neutralCaseRecordProvenance(),
    acquisitionContext: neutralAcquisitionContext,
    sourceGroup: null,
  };
}

export function neutralStatementRecordView(
  record: Omit<
    StatementRecord,
    "provenance" | "acquisitionContext" | "sourceGroup"
  >,
): StatementRecord {
  return {
    ...record,
    provenance: neutralCaseRecordProvenance(),
    acquisitionContext: neutralAcquisitionContext,
    sourceGroup: null,
  };
}
