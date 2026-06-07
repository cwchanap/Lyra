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
  sublocations: Array<{
    id: string;
    label: string;
    sceneTag: string;
    backgroundAssetId: string | null;
    hotspots: Array<{
      id: string;
      label: string;
      description: string;
    }>;
    characters: Array<{
      id: string;
      name: string;
      role: string;
      bio: string;
      topics: Array<{
        id: string;
        label: string;
      }>;
    }>;
  }>;
};

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
