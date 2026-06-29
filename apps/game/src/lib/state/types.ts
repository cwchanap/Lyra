// Mirrors the Rust GameStateView via Tauri's invoke() serialization.

export type PortraitRef = {
  characterId: string;
  expression: string;
  assetId: string;
};

export type AudioCue = {
  channel: "bgm" | "bgs";
  assetId: string | null;
};

export type VisualAssetCue = {
  backgroundAssetId: string | null;
  bgm: AudioCue | null;
  bgs: AudioCue | null;
};

export type DialogueItem =
  | { kind: "sceneTag"; text: string; assetCue?: VisualAssetCue | null }
  | { kind: "action"; text: string }
  | {
      kind: "line";
      speaker: string;
      text: string;
      portrait?: PortraitRef | null;
    };

export type QueueToken = {
  sceneId: string;
  queueGen: number;
  cursor: number;
};

export type Mode =
  | ({
      type: "dialogue";
      current: DialogueItem;
      queueRemaining: number;
      sceneTag: string | null;
      queueToken: QueueToken;
    } & VisualAssetCue)
  | ({ type: "explore"; sublocationId: string } & VisualAssetCue)
  | ({ type: "interrogation"; phaseId: string } & VisualAssetCue)
  | { type: "gameComplete" };

export type ChapterView = {
  id: string;
  title: string;
  summary: string;
  index: number;
  total: number;
};

export type HotspotLayout = {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
};

export type CharacterLayout = {
  kind: "sprite";
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  anchor: "bottomCenter";
};

export type HotspotView = {
  id: string;
  label: string;
  description: string;
  inspected: boolean;
  layout: HotspotLayout | null;
};
export type TopicView = {
  id: string;
  label: string;
  discussed: boolean;
};
export type CharacterView = {
  id: string;
  name: string;
  role: string;
  bio: string;
  topics: TopicView[];
  layout: CharacterLayout | null;
};
export type SublocationView = {
  id: string;
  label: string;
  sceneTag: string;
  hotspots: HotspotView[];
  characters: CharacterView[];
};
export type InterrogationPhaseView = {
  id: string;
  label: string;
  kind: "inquiry" | "testimony";
  subject: SubjectView;
  questions: InquiryQuestionView[];
  testimony: TestimonyStatementView[];
};
export type SubjectView = {
  id: string;
  name: string;
  role: string;
  bio: string;
};
export type InquiryQuestionView = {
  id: string;
  label: string;
  answered: boolean;
};
export type TestimonyStatementView = {
  id: string;
  label: string;
  content: string;
  pressed: boolean;
};

export type SceneView =
  | { kind: "linear"; id: string; title: string; index: number; total: number }
  | {
      kind: "investigation";
      id: string;
      title: string;
      index: number;
      total: number;
      currentSublocationId: string | null;
      visibleSublocations: SublocationView[];
    }
  | {
      kind: "interrogation";
      id: string;
      title: string;
      index: number;
      total: number;
      currentPhaseId: string | null;
      visiblePhases: InterrogationPhaseView[];
    };

export type SceneNavigationIndex = {
  chapters: Array<{
    id: string;
    title: string;
    index: number;
    scenes: Array<{
      id: string;
      title: string;
      type: "linear" | "investigation" | "interrogation";
      index: number;
    }>;
  }>;
};

export type EvidenceRecord = {
  id: string;
  name: string;
  description: string;
  details: string;
  imageAssetId: string | null;
  onReexamine: DialogueItem[] | null;
  collectedInChapterId: string;
  collectedInSceneId: string;
};
export type StatementRecord = {
  id: string;
  speaker: string;
  content: string;
  onReexamine: DialogueItem[] | null;
  acquiredInChapterId: string;
  acquiredInSceneId: string;
};
export type Inventory = {
  evidence: EvidenceRecord[];
  statements: StatementRecord[];
};

export type GameStateView = {
  mode: Mode;
  chapter: ChapterView;
  scene: SceneView;
  inventory: Inventory;
};

export type GameError = {
  code: string;
  message: string;
};
