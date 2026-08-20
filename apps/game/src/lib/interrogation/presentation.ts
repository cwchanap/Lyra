import type {
  DialogueItem,
  EvidenceRecord,
  Inventory,
  InterrogationPhaseView,
  Mode,
  SceneView,
  StatementRecord,
} from "$lib/state/types";
import { caseRecordProvenancePresentation } from "$lib/case-file/provenance-badges";

export type PresentableRecord = {
  kind: "evidence" | "statement";
  id: string;
  shortName: string;
  typeLabel: "物證 / EVIDENCE" | "證言 / STATEMENT";
  sourceTag: string;
  description: string;
  details: string | null;
  imageAssetId: string | null;
};

function presentSourceTag(
  record: EvidenceRecord | StatementRecord,
  typeLabel: PresentableRecord["typeLabel"],
): string {
  const provenanceSource =
    caseRecordProvenancePresentation(record).source?.trim() ?? "";
  const sceneTitle = record.acquisitionContext.sceneTitle.trim();
  return provenanceSource || sceneTitle || typeLabel;
}

export function isInterrogationPresentationActive(
  scene: SceneView,
  mode: Mode,
): boolean {
  return (
    scene.kind === "interrogation" &&
    (mode.type === "interrogation" ||
      (mode.type === "dialogue" && mode.queueToken.sceneId === scene.id))
  );
}

export function currentInterrogationPhase(
  scene: SceneView,
): InterrogationPhaseView | null {
  if (scene.kind !== "interrogation") return null;

  return (
    scene.visiblePhases.find((phase) => phase.id === scene.currentPhaseId) ??
    null
  );
}

export function brokenQuestionProgress(phase: InterrogationPhaseView | null): {
  broken: number;
  total: number;
} {
  const total = phase?.questions.length ?? 0;
  const broken =
    phase?.questions.filter((question) => question.broken).length ?? 0;

  return { broken, total };
}

export function interrogationLineText(items: DialogueItem[]): string {
  return items
    .filter((item) => item.kind === "line" || item.kind === "action")
    .map((item) => item.text)
    .join("");
}

export function presentableRecords(inventory: Inventory): PresentableRecord[] {
  return [
    ...inventory.evidence.map((record) => ({
      kind: "evidence" as const,
      id: record.id,
      shortName: record.name,
      typeLabel: "物證 / EVIDENCE" as const,
      sourceTag: presentSourceTag(record, "物證 / EVIDENCE"),
      description: record.description,
      details: record.details.trim() || null,
      imageAssetId: record.imageAssetId,
    })),
    ...inventory.statements.map((record) => ({
      kind: "statement" as const,
      id: record.id,
      shortName: record.speaker,
      typeLabel: "證言 / STATEMENT" as const,
      sourceTag: presentSourceTag(record, "證言 / STATEMENT"),
      description: record.content,
      details: null,
      imageAssetId: null,
    })),
  ];
}
