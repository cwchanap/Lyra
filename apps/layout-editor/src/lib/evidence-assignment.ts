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

// ID convention for editor-generated standalone evidence-source hotspots.
// Hoisted to a single constant so the generator and the detector below share
// one source of truth and cannot drift apart. The prefix is a fixed literal;
// escaping it when building the regex keeps the contract safe even if a future
// prefix ever contains a regex metacharacter.
const STANDALONE_HOTSPOT_ID_PREFIX = "evidence_source_";
const STANDALONE_HOTSPOT_ID_RE = new RegExp(
  `^${escapeRegExp(STANDALONE_HOTSPOT_ID_PREFIX)}[a-z0-9_]+$`,
);

export function isGeneratedStandaloneHotspotId(id: string): boolean {
  return STANDALONE_HOTSPOT_ID_RE.test(id);
}

export function generatedStandaloneHotspotId(evidenceId: string): string {
  return `${STANDALONE_HOTSPOT_ID_PREFIX}${evidenceId}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    // NOTE: a "Create standalone hotspot" option used to be emitted here for
    // the editor's assignment write-back. That write-back was retracted (the
    // Evidence Sources panel is now read-only), so there is no longer a code
    // path that creates a standalone hotspot from the panel. Generated
    // standalone hotspots are still *detected* for label display via
    // `generatedStandaloneHotspotId` in EvidenceAssignmentPanel.svelte; only
    // the create-option was dead and is intentionally omitted.
  }

  return options;
}

/**
 * Look up a hotspot carrier label directly from the scene, bypassing the
 * `evidenceSource` filter in {@link carrierOptionsForEvidence}. This is used
 * to label the *current* assignment even when the hotspot lacks Evidence
 * Source metadata (the audit-flagged case): `carrierOptionsForEvidence`
 * filters such hotspots out, which would otherwise hide the actual carrier
 * behind "Unassigned" and leave the user unable to see what to tag.
 */
export function hotspotCarrierLabel(
  scene: InvestigationSceneJson,
  sublocationId: string,
  hotspotId: string,
): string | null {
  for (const sublocation of scene.sublocations) {
    if (sublocation.id !== sublocationId) continue;
    for (const hotspot of sublocation.hotspots) {
      if (hotspot.id === hotspotId) {
        return `${sublocation.label} / ${hotspot.label}`;
      }
    }
  }
  return null;
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
