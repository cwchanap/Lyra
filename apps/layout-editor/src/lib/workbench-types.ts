import type { AssetManifest } from "@lyra/scripts/compile-scenes/assets/manifest";
import type { AssetReport } from "@lyra/scripts/compile-scenes/orchestrator";
import type {
  AudioCue,
  JSONAnalysisScene,
  JSONDialogueItem,
  JSONInterrogationScene,
  JSONInvestigationScene,
  JSONLinearScene,
  JSONVisualAssetCue,
  PortraitRef,
} from "@lyra/scripts/compile-scenes/types";

export type SceneType =
  | "linear"
  | "investigation"
  | "interrogation"
  | "analysis";

export type WorkbenchIndex = {
  chapters: Array<{
    id: string;
    title: string;
    summary: string;
    scenes: Array<{
      id: string;
      type: SceneType;
      sourcePath: string;
      stageCapable: boolean;
    }>;
  }>;
};

type AnalysisBoard = JSONAnalysisScene["boards"][number];
type AnalysisCommon = AnalysisBoard["common"];

type PublicAnalysisCommon = Pick<
  AnalysisCommon,
  "id" | "label" | "prompt" | "cards" | "resultDialogue"
> & {
  feedback: Pick<
    AnalysisCommon["feedback"],
    "incomplete" | "incorrect" | "hint"
  >;
};

type PublicClassifyBoard = {
  kind: "classify";
  common: PublicAnalysisCommon;
  groups: Extract<AnalysisBoard, { kind: "classify" }>["groups"];
};

type PublicOrderBoard = {
  kind: "order";
  common: PublicAnalysisCommon;
  fixedAnchors: Extract<AnalysisBoard, { kind: "order" }>["fixedAnchors"];
};

type PublicThresholdBoard = {
  kind: "threshold";
  common: PublicAnalysisCommon;
};

export type PublicAnalysisScene = Pick<
  JSONAnalysisScene,
  "type" | "id" | "title" | "summary" | "intro" | "outro"
> & {
  boards: Array<PublicClassifyBoard | PublicOrderBoard | PublicThresholdBoard>;
};

export type WorkbenchScenePayload =
  | JSONLinearScene
  | JSONInvestigationScene
  | JSONInterrogationScene
  | PublicAnalysisScene;

export type WorkbenchSceneBundle = { scene: WorkbenchScenePayload };

export type WorkbenchTextSource = {
  path: string;
  content: string;
};

export type PlanDocumentKind = "storyBible" | "chapterPlan";

export type WorkbenchPlanDocument = WorkbenchTextSource & {
  id: string;
  kind: PlanDocumentKind;
  chapterNumber: number | null;
};

export type WorkbenchPlanWorkspacePayload = {
  documents: WorkbenchPlanDocument[];
};

export type WorkbenchAssetScenePayload = {
  chapterId: string;
  sceneId: string;
  sourcePath: string;
  scene: WorkbenchScenePayload;
};

export type WorkbenchAssetWorkspacePayload = {
  manifest: AssetManifest;
  report: AssetReport;
  configSources: {
    characters: WorkbenchTextSource;
    audio: WorkbenchTextSource;
  };
  scenes: WorkbenchAssetScenePayload[];
  existingAssetPaths: string[];
};

export type ReaderGroupKind =
  | "intro"
  | "outro"
  | "sublocation"
  | "hotspot"
  | "topic"
  | "evidence"
  | "statement"
  | "phase"
  | "question"
  | "line"
  | "branch"
  | "board"
  | "card"
  | "group"
  | "result";

export type ReaderFlow = "main" | "branch";

export type ReaderItem =
  | { kind: "sceneTag"; text: string }
  | { kind: "action"; text: string }
  | { kind: "line"; speaker: string; text: string }
  | {
      kind: "notice";
      noticeKind:
        | "reveal"
        | "evidence"
        | "statement"
        | "contradiction"
        | "prompt"
        | "card"
        | "group"
        | "feedback"
        | "constraint";
      text: string;
    };

export type ReaderGroup = {
  id: string;
  kind: ReaderGroupKind;
  label: string;
  flow: ReaderFlow;
  sourceAnchor: string | null;
  items: ReaderItem[];
  children: ReaderGroup[];
};

/**
 * Sibling presentation stream produced by the single `projectReaderScene()`
 * walk. Reader-visible groups/items never carry this data; the Assets
 * workbench consumes it instead of re-walking scenes. Values are raw compiler
 * data (carrier IDs are the existing Reader carrier IDs).
 */
export type ReaderPresentationFact =
  | {
      kind: "dialogueAssetCue";
      carrierId: string;
      /** Index of the sceneTag item inside its carrier's item array. */
      itemIndex: number;
      cue: JSONVisualAssetCue;
    }
  | {
      kind: "dialoguePortrait";
      carrierId: string;
      /** Index of the line item inside its carrier's item array. */
      itemIndex: number;
      portrait: PortraitRef;
    }
  | {
      kind: "structuralVisualCue";
      carrierId: string;
      backgroundAssetId: string | null;
      bgm: AudioCue | null;
      bgs: AudioCue | null;
    }
  | {
      kind: "subjectPortrait";
      carrierId: string;
      portrait: PortraitRef;
    }
  | {
      kind: "evidenceImage";
      carrierId: string;
      imageAssetId: string;
    }
  | {
      kind: "sprite";
      carrierId: string;
      characterId: string;
      /** Raw sprite layout asset ID; asset kind resolves via manifest join. */
      assetId: string;
    };

export type ReaderScene = {
  id: string;
  type: SceneType;
  title: string;
  sourcePath: string;
  groups: ReaderGroup[];
  presentation: ReaderPresentationFact[];
};

export type CompilerDialogueItem = JSONDialogueItem;
