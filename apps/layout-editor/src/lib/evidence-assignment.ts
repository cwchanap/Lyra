import type { InvestigationSceneJson } from "./layout-types";

export type EvidenceHotspotSummary = {
  id: string;
  label: string;
  sublocationId: string;
  sublocationLabel: string;
};

export type SceneEvidenceAssignment = {
  evidence: InvestigationSceneJson["evidenceManifest"][number];
  hotspots: EvidenceHotspotSummary[];
};

export type EvidenceCarrier =
  | { kind: "hotspot"; sublocationId: string; hotspotId: string }
  | {
      kind: "topic";
      sublocationId: string;
      characterId: string;
      topicId: string;
    }
  | { kind: "standalone_hotspot"; sublocationId: string };

export type EvidenceCarrierOption = {
  label: string;
  carrier: EvidenceCarrier;
};

type EvidenceManifestItem = InvestigationSceneJson["evidenceManifest"][number];

function isGeneratedStandaloneHotspotId(id: string): boolean {
  return /^evidence_source_[a-z0-9_]+$/.test(id);
}

export function generatedStandaloneHotspotId(evidenceId: string): string {
  return `evidence_source_${evidenceId}`;
}

export function carrierOptionsForEvidence(
  scene: InvestigationSceneJson,
  evidence: EvidenceManifestItem,
): EvidenceCarrierOption[] {
  const options: EvidenceCarrierOption[] = [];

  for (const sublocation of scene.sublocations) {
    if (
      evidence.sourceSublocationId &&
      sublocation.id !== evidence.sourceSublocationId
    ) {
      continue;
    }

    for (const hotspot of sublocation.hotspots) {
      if (hotspot.evidenceSource === null) continue;
      if (isGeneratedStandaloneHotspotId(hotspot.id)) continue;
      options.push({
        label: `${sublocation.label} / ${hotspot.label}`,
        carrier: {
          kind: "hotspot",
          sublocationId: sublocation.id,
          hotspotId: hotspot.id,
        },
      });
    }

    for (const character of sublocation.characters) {
      for (const topic of character.topics) {
        options.push({
          label: `${sublocation.label} / ${character.name} / ${topic.label}`,
          carrier: {
            kind: "topic",
            sublocationId: sublocation.id,
            characterId: character.id,
            topicId: topic.id,
          },
        });
      }
    }

    options.push({
      label: "Create standalone hotspot",
      carrier: {
        kind: "standalone_hotspot",
        sublocationId: sublocation.id,
      },
    });
  }

  return options;
}

export function evidenceAssignmentsForScene(
  scene: InvestigationSceneJson,
): SceneEvidenceAssignment[] {
  return scene.evidenceManifest.map((evidence) => ({
    evidence,
    hotspots: scene.sublocations.flatMap((sublocation) =>
      sublocation.hotspots
        .filter((hotspot) =>
          hotspot.reveals.some(
            (reveal) => reveal.kind === "evidence" && reveal.id === evidence.id,
          ),
        )
        .map((hotspot) => ({
          id: hotspot.id,
          label: hotspot.label,
          sublocationId: sublocation.id,
          sublocationLabel: sublocation.label,
        })),
    ),
  }));
}
