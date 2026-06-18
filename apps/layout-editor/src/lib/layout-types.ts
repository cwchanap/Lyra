// Shared scene-graph wire types live in @lyra/scene-types (single source of
// truth across the layout editor and the compiler). The four atoms below are
// also referenced by InvestigationSceneJson below, so they are imported for a
// local binding and re-exported; SceneIndex and InvestigationLayoutSidecar are
// pure re-exports. See packages/scene-types.
import type {
  EvidenceSource,
  RectLayout,
  RevealTarget,
  SpriteLayout,
} from "@lyra/scene-types";
export type { EvidenceSource, RectLayout, RevealTarget, SpriteLayout };
export type {
  ChaptersIndex as SceneIndex,
  InvestigationLayoutSidecar,
} from "@lyra/scene-types";

export type InvestigationSceneJson = {
  type: "investigation";
  id: string;
  title: string;
  intro: DialogueItem[];
  sublocations: Array<{
    id: string;
    label: string;
    sceneTag: string;
    backgroundAssetId: string | null;
    transitionDialogue: DialogueItem[];
    hotspots: Array<{
      id: string;
      label: string;
      description: string;
      evidenceSource: EvidenceSource | null;
      sceneSourcePrompt: string | null;
      reveals: RevealTarget[];
      inspectDialogue: DialogueItem[];
      layout: RectLayout | null;
    }>;
    characters: Array<{
      id: string;
      name: string;
      role: string;
      bio: string;
      layout: SpriteLayout | null;
      topics: Array<{
        id: string;
        label: string;
        reveals: RevealTarget[];
        topicDialogue: DialogueItem[];
      }>;
    }>;
  }>;
  evidenceManifest: Array<{
    id: string;
    name: string;
    description: string;
    imageAssetId: string | null;
    sourceSublocationId: string | null;
  }>;
};

export type DialogueItem =
  | { kind: "sceneTag"; text: string }
  | { kind: "action"; text: string }
  | {
      kind: "line";
      speaker: string;
      text: string;
      portrait?: {
        assetId: string;
      } | null;
    };

// RevealTarget, RectLayout, SpriteLayout, and InvestigationLayoutSidecar are
// re-exported from @lyra/scene-types (see top of file). DialogueItem stays
// local: the editor's rendering view is intentionally narrower than the
// compiler's (no assetCue, simplified portrait, no expression).
