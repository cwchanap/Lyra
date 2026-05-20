// Mirrors the Rust GameStateView via Tauri's invoke() serialization.

export type DialogueItem =
  | { kind: "sceneTag"; text: string }
  | { kind: "action"; text: string }
  | { kind: "line"; speaker: string; text: string };

export type QueueToken = {
  sceneId: string;
  queueGen: number;
  cursor: number;
};

export type Mode =
  | { type: "dialogue"; current: DialogueItem; queueRemaining: number; sceneTag: string | null; queueToken: QueueToken }
  | { type: "explore"; sublocationId: string }
  | { type: "interrogation"; phaseId: string }
  | { type: "gameComplete" };

export type ChapterView = {
  id: string;
  title: string;
  summary: string;
  index: number;
  total: number;
};

export type HotspotView = {
  id: string;
  label: string;
  description: string;
  inspected: boolean;
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

export type EvidenceRecord = {
  id: string;
  name: string;
  description: string;
  details: string;
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
