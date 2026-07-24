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

export type DialogueHistoryEntry =
  | {
      id: number;
      kind: "line";
      speaker: string;
      text: string;
      chapterTitle: string;
      sceneTitle: string;
    }
  | {
      id: number;
      kind: "action";
      text: string;
      chapterTitle: string;
      sceneTitle: string;
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
      /** While an interrogation testimony plays in the dialogue box, the id of
       * the line the inline `反駁` challenge targets; null otherwise. */
      crossExamLineId: string | null;
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
  subject: SubjectView;
  questions: InquiryQuestionView[];
  crossExam: CrossExamView | null;
  canComplete: boolean;
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
  broken: boolean;
};
export type CrossExamView = {
  questionId: string;
  lineId: string;
  lineLabel: string;
  lineContent: DialogueItem[];
  lineIndex: number;
  lineTotal: number;
  presenting: boolean;
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

export type StoryStateView = {
  facts: FactView[];
  questions: QuestionView[];
  objectives: ObjectiveView[];
  authorizations: AuthorizationView[];
};

export type FactView = {
  id: string;
  label: string;
  summary: string;
  details: string;
  category: string;
  assertedInChapterId: string | null;
  assertedInSceneId: string | null;
  firstOrigin: AssertionOrigin;
  supportingRecords: InventoryTarget[];
  supportingFactIds: string[];
};

export type QuestionView = {
  id: string;
  label: string;
  summary: string;
  status: "open" | "resolved";
  resolvedByFactId: string | null;
};

export type ObjectiveView = {
  id: string;
  label: string;
  summary: string;
  kind: "primary" | "secondary";
  sortOrder: number;
  completed: boolean;
  activePrimary: boolean;
};

export type AuthorizationView = {
  id: string;
  label: string;
  summary: string;
  grantingAuthority: string;
  grantedInChapterId: string | null;
  grantedInSceneId: string | null;
  firstOrigin: AssertionOrigin;
};

export type AssertionOrigin =
  | {
      type: "sceneEvent";
      chapterId: string;
      sceneId: string;
      blockKind: StoryEventBlockKind;
      blockId: string;
    }
  | {
      type: "analysisBoard";
      chapterId: string;
      sceneId: string;
      boardId: string;
    }
  | { type: "migration"; migrationId: string };

export type StoryEventBlockKind =
  | "sublocation"
  | "hotspot"
  | "topic"
  | "interrogationPhase"
  | "inquiryQuestion"
  | "testimonyLine"
  | "storyEvent";

export type InventoryTarget =
  | { kind: "evidence"; id: string }
  | { kind: "statement"; id: string };

export type GameStateView = {
  mode: Mode;
  chapter: ChapterView;
  scene: SceneView;
  inventory: Inventory;
  story: StoryStateView;
  dialogueHistory: DialogueHistoryEntry[];
};

export type GameError = {
  code: string;
  message: string;
};
