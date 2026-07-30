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

export function neutralEvidenceRecordView(
  record: Omit<EvidenceRecord, "provenance">,
): EvidenceRecord {
  return {
    ...record,
    provenance: neutralCaseRecordProvenance(),
  };
}

export function neutralStatementRecordView(
  record: Omit<StatementRecord, "provenance">,
): StatementRecord {
  return {
    ...record,
    provenance: neutralCaseRecordProvenance(),
  };
}
