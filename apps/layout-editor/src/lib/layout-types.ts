export type SceneIndex = {
  chapters: Array<{
    id: string;
    title: string;
    summary: string;
    scenes: Array<{
      type: "linear" | "investigation" | "interrogation";
      file: string;
    }>;
  }>;
};

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
        topicDialogue: DialogueItem[];
      }>;
    }>;
  }>;
  evidenceManifest: Array<{
    id: string;
    name: string;
    description: string;
    imageAssetId: string | null;
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

export type RevealTarget =
  | { kind: "evidence"; id: string }
  | { kind: "statement"; id: string }
  | { kind: "topic"; characterId: string; topicId: string }
  | { kind: "hotspot"; id: string }
  | { kind: "sublocation"; id: string };

export type RectLayout = {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
};

export type SpriteLayout = {
  kind: "sprite";
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  anchor: "bottomCenter";
};

export type InvestigationLayoutSidecar = {
  version: 1;
  sceneId: string;
  sublocations: Record<
    string,
    {
      hotspots: Record<string, RectLayout>;
      characters: Record<string, SpriteLayout>;
    }
  >;
};
