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
  | ({
      type: "analysis";
      boardId: string;
      activeBoardId: string | null;
      actionToken: AnalysisActionToken;
      availableBoardIds: string[];
      feedback: AnalysisFeedbackView | null;
      lastFeedback: string | null;
    } & VisualAssetCue)
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

export type CharacterLayout =
  | {
      kind: "sprite";
      assetId: string;
      x: number;
      y: number;
      w: number;
      h: number;
      anchor: "bottomCenter";
    }
  | {
      kind: "baked";
      x: number;
      y: number;
      w: number;
      h: number;
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
  portrait: PortraitRef | null;
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

export type AnalysisActionToken = {
  sceneId: string;
  activeBoardId: string | null;
  durableRevision: number;
};

export type AnalysisDraft =
  | { kind: "classify"; groupByCard: Record<string, string> }
  | { kind: "order"; cardIds: string[] }
  | { kind: "threshold"; selectedCardIds: string[] };

export type AnalysisFeedbackState = "incomplete" | "incorrect";

export type AnalysisFeedbackView = {
  state: AnalysisFeedbackState;
  message: string;
};

export type AnalysisCardSourceView =
  | {
      kind: "evidence";
      id: string;
      label: string | null;
      summary: string | null;
    }
  | {
      kind: "statement";
      id: string;
      label: string | null;
      summary: string | null;
    }
  | {
      kind: "practice";
      id: string;
      label: string | null;
      summary: string | null;
    };

export type AnalysisCardView = {
  id: string;
  label: string;
  summary: string;
  source: AnalysisCardSourceView;
  sourceLabel: string | null;
  sourceSummary: string | null;
  available: boolean;
};

type AnalysisBoardViewBase = {
  id: string;
  label: string;
  prompt: string;
  cards: AnalysisCardView[];
  available: boolean;
  completed: boolean;
  readOnly: boolean;
  draft: AnalysisDraft;
  feedback: AnalysisFeedbackView | null;
  hint: string | null;
};

export type AnalysisBoardView =
  | (AnalysisBoardViewBase & {
      kind: "classify";
      groups: Array<{ id: string; label: string; description: string }>;
    })
  | (AnalysisBoardViewBase & {
      kind: "order";
      fixedAnchors: Array<{ cardId: string; position: number }>;
    })
  | (AnalysisBoardViewBase & {
      kind: "threshold";
      minimumSelected: number;
      selectedCardIds: string[];
    });

export type SceneView =
  | {
      kind: "linear";
      id: string;
      title: string;
      summary: string;
      index: number;
      total: number;
    }
  | {
      kind: "investigation";
      id: string;
      title: string;
      summary: string;
      index: number;
      total: number;
      currentSublocationId: string | null;
      visibleSublocations: SublocationView[];
    }
  | {
      kind: "interrogation";
      id: string;
      title: string;
      summary: string;
      index: number;
      total: number;
      currentPhaseId: string | null;
      visiblePhases: InterrogationPhaseView[];
    }
  | {
      kind: "analysis";
      id: string;
      title: string;
      summary: string;
      index: number;
      total: number;
      activeBoardId: string | null;
      actionToken: AnalysisActionToken;
      availableBoardIds: string[];
      backgroundAssetId: string | null;
      bgm: AudioCue | null;
      bgs: AudioCue | null;
      visibleBoards: AnalysisBoardView[];
    };

export type SceneNavigationIndex = {
  chapters: Array<{
    id: string;
    title: string;
    index: number;
    scenes: Array<{
      id: string;
      title: string;
      type: "linear" | "investigation" | "interrogation" | "analysis";
      index: number;
    }>;
  }>;
};

export type SourceKind =
  | "physical"
  | "testimony"
  | "digital"
  | "subjective"
  | "unspecified";

export type RepresentationLayer =
  | "raw"
  | "sync"
  | "summary"
  | "composite"
  | "none";

export type ProceduralStatus =
  | "unspecified"
  | "lead"
  | "reacquired"
  | "exhibit";

export type Completeness = "complete" | "partial" | "cropped" | "unspecified";

export type Confidence =
  | "unverified"
  | "corroborated"
  | "disputed"
  | "unspecified";

export type ProofCapability =
  | "time"
  | "order"
  | "route"
  | "identity"
  | "access"
  | "motive"
  | "source"
  | "credibility"
  | "procedure"
  | "causation";

export type EncodedInventoryTarget =
  | `evidence:${string}`
  | `statement:${string}`;

export type SceneLocationContextView = {
  chapterId: string;
  chapterTitle: string;
  sceneId: string;
  sceneTitle: string;
};

export type SourceGroupReferenceView = {
  id: string;
  label: string;
  summary: string;
};

export type OriginContextView = {
  originKind: "sceneEvent" | "analysisBoard";
  location: SceneLocationContextView;
};

export type CaseRecordProvenance = {
  sourceKind: SourceKind;
  representationLayer: RepresentationLayer;
  proceduralStatus: ProceduralStatus;
  completeness: Completeness;
  confidence: Confidence;
  sourceGroupId: string | null;
  sourceLabel: string | null;
  /** Canonically ordered by the Rust public wire contract. */
  proofCapabilities: ProofCapability[];
  /**
   * The immediate predecessor's typed record ID when that predecessor is
   * acquired. Public null means either no predecessor exists or an existing
   * predecessor is unacquired and redacted; consumers cannot infer a lineage
   * root from null.
   */
  supersedesRecordId: EncodedInventoryTarget | null;
};

export type EvidenceRecord = {
  id: string;
  name: string;
  description: string;
  details: string;
  provenance: CaseRecordProvenance;
  imageAssetId: string | null;
  onReexamine: DialogueItem[] | null;
  collectedInChapterId: string;
  collectedInSceneId: string;
  acquisitionContext: SceneLocationContextView;
  sourceGroup: SourceGroupReferenceView | null;
};
export type StatementRecord = {
  id: string;
  speaker: string;
  content: string;
  provenance: CaseRecordProvenance;
  onReexamine: DialogueItem[] | null;
  acquiredInChapterId: string;
  acquiredInSceneId: string;
  acquisitionContext: SceneLocationContextView;
  sourceGroup: SourceGroupReferenceView | null;
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
  firstOrigin: AssertionOrigin;
  originContext: OriginContextView;
  /**
   * Direct supporting records currently acquired and exposed by the public
   * view. An empty array cannot be used to infer that internal story progress
   * has no direct record support.
   */
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
  firstOrigin: AssertionOrigin;
  originContext: OriginContextView;
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
    };

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

export type PendingAcquisitionView = {
  id: string;
  recordKind: "evidence" | "statement";
  recordId: string;
  title: string;
  description: string;
  details: string;
  imageAssetId: string | null;
  createdByCommandId: number;
  ordinal: number;
};

export type GameStateView = {
  mode: Mode;
  chapter: ChapterView;
  scene: SceneView;
  inventory: Inventory;
  story: StoryStateView;
  dialogueHistory: DialogueHistoryEntry[];
  pendingAcquisition: PendingAcquisitionView | null;
};

export type { GameError } from "$lib/persistence/types";
