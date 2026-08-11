import type { EvidenceRecord, StatementRecord } from "$lib/state/types";
import {
  completenessLabels,
  confidenceLabels,
  proceduralStatusLabels,
  proofCapabilityLabels,
  representationLayerLabels,
  sourceKindLabels,
} from "./labels";

export type CaseRecordProvenancePresentation = {
  sourceKind: string | null;
  representationLayer: string | null;
  proceduralStatus: string | null;
  completeness: string | null;
  confidence: string | null;
  source: string | null;
  sourceGroup: string | null;
  sourceGroupSummary: string | null;
  proofCapabilities: string | null;
};

export function caseRecordProvenancePresentation(
  record: EvidenceRecord | StatementRecord,
): CaseRecordProvenancePresentation {
  const provenance = record.provenance;
  return {
    sourceKind: sourceKindLabels[provenance.sourceKind],
    representationLayer:
      representationLayerLabels[provenance.representationLayer],
    proceduralStatus: proceduralStatusLabels[provenance.proceduralStatus],
    completeness: completenessLabels[provenance.completeness],
    confidence: confidenceLabels[provenance.confidence],
    source: provenance.sourceLabel ?? record.sourceGroup?.label ?? null,
    sourceGroup:
      record.sourceGroup !== null && provenance.sourceLabel !== null
        ? record.sourceGroup.label
        : null,
    sourceGroupSummary: record.sourceGroup?.summary ?? null,
    proofCapabilities:
      provenance.proofCapabilities.length > 0
        ? provenance.proofCapabilities
            .map((capability) => proofCapabilityLabels[capability])
            .join("、")
        : null,
  };
}
