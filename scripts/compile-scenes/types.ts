// =============================================================================
// scripts/compile-scenes/types.ts
//
// Public contract for the scene-pipeline compiler. Two type families:
//   - AST*  : intermediate representation built by the parsers.
//   - JSON* : final shape written to apps/game/src-tauri/resources/scenes/.
//
// The shape of JSON* matches the spec §3b 1:1. The Rust engine's serde
// types in Plan B's schema.rs are a direct mirror.
// =============================================================================

// ----- Shared atoms ----------------------------------------------------------

export type AssetRef = {
  type: "background" | "portrait" | "standee" | "evidence" | "audio";
  assetId: string;
};

export type PortraitRef = {
  characterId: string;
  expression: string;
  assetId: string;
};

export type AudioCue = {
  channel: "bgm" | "bgs";
  assetId: string | null;
};

// Keep in sync with apps/layout-editor/src/lib/layout-types.ts
export type EvidenceSource = "visible" | "implied" | "hidden";

export type VisualAssetCue = {
  backgroundPrompt: string | null;
  backgroundAssetId: string | null;
  bgm: AudioCue | null;
  bgs: AudioCue | null;
};

export type EvidenceImageCue = {
  imagePrompt: string | null;
  imageAssetId: string | null;
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

export type JSONVisualAssetCue = {
  backgroundAssetId: string | null;
  bgm: AudioCue | null;
  bgs: AudioCue | null;
};

export type DialogueItem =
  | {
      kind: "sceneTag";
      text: string;
      assetCue?: VisualAssetCue | null;
    }
  | { kind: "action"; text: string }
  | {
      kind: "line";
      speaker: string;
      text: string;
      expression?: string | null;
      portrait?: PortraitRef | null;
    };

export type JSONDialogueItem =
  | {
      kind: "sceneTag";
      text: string;
      assetCue?: JSONVisualAssetCue | null;
    }
  | { kind: "action"; text: string }
  | {
      kind: "line";
      speaker: string;
      text: string;
      expression: string | null;
      portrait: PortraitRef | null;
    };

export type RevealTarget =
  | { kind: "evidence"; id: string }
  | { kind: "statement"; id: string }
  | { kind: "topic"; characterId: string; topicId: string }
  | { kind: "hotspot"; id: string }
  | { kind: "sublocation"; id: string };

export type InventoryTarget =
  | { kind: "evidence"; id: string }
  | { kind: "statement"; id: string };

export type InterrogationRevealTarget =
  | InventoryTarget
  | { kind: "question"; id: string }
  | { kind: "phase"; id: string };

export type UnlockExpr =
  | { op: "and" | "or"; left: UnlockExpr; right: UnlockExpr }
  | { predicate: "evidence_collected"; id: string }
  | { predicate: "statement_acquired"; id: string }
  | { predicate: "topic_discussed"; characterId: string; topicId: string }
  | { predicate: "hotspot_investigated"; id: string };

export type InterrogationUnlockExpr =
  | {
      op: "and" | "or";
      left: InterrogationUnlockExpr;
      right: InterrogationUnlockExpr;
    }
  | { predicate: "evidence_collected"; id: string }
  | { predicate: "statement_acquired"; id: string }
  | { predicate: "question_answered"; id: string }
  | { predicate: "phase_completed"; id: string };

// ----- AST: per-file parser output -------------------------------------------

export type Located<T> = T & { sourceFile: string; line: number };

export type ASTChapter = Located<{
  kind: "chapter";
  dirName: string; // e.g., "chapter_1"
  number: number; // parsed from the H1
  title: string;
  summary: string;
  sceneFiles: string[]; // ordered, raw filenames as written in the manifest
}>;

export type ASTLinearScene = Located<{
  kind: "linearScene";
  id: string; // derived from filename without .md
  title: string;
  queue: DialogueItem[];
  assetRefs: AssetRef[];
}>;

export type ASTInvestigationScene = Located<{
  kind: "investigationScene";
  id: string;
  title: string;
  intro: DialogueItem[];
  sublocations: ASTSublocation[];
  evidenceManifest: ASTEvidence[];
  statementManifest: ASTStatement[];
  outro: ASTOutro;
  assetRefs: AssetRef[];
}>;

export type ASTSublocation = Located<{
  id: string;
  label: string;
  status: "locked" | "unlocked";
  unlock: UnlockExpr | null;
  reveals: RevealTarget[];
  sceneTag: string;
  assetCue: VisualAssetCue | null;
  transitionDialogue: DialogueItem[];
  hotspots: ASTHotspot[];
  characters: ASTCharacter[];
}>;

export type ASTHotspot = Located<{
  id: string;
  label: string;
  description: string;
  status: "locked" | "unlocked";
  unlock: UnlockExpr | null;
  reveals: RevealTarget[];
  evidenceSource: EvidenceSource | null;
  sceneSourcePrompt: string | null;
  inspectDialogue: DialogueItem[];
  onReexamine: DialogueItem[] | null;
  layout?: RectLayout | null;
}>;

export type ASTCharacter = Located<{
  id: string;
  name: string;
  role: string;
  bio: string;
  topics: ASTTopic[];
  layout?: SpriteLayout | null;
}>;

export type ASTTopic = Located<{
  id: string;
  label: string;
  status: "locked" | "unlocked";
  unlock: UnlockExpr | null;
  reveals: RevealTarget[];
  topicDialogue: DialogueItem[];
  onReexamine: DialogueItem[] | null;
}>;

export type ASTEvidence = Located<{
  id: string;
  name: string;
  description: string;
  details: string;
  imageCue: EvidenceImageCue;
  onCollect: DialogueItem[];
  onReexamine: DialogueItem[] | null;
}>;

export type ASTStatement = Located<{
  id: string;
  speaker: string;
  content: string;
  onAcquire: DialogueItem[];
  onReexamine: DialogueItem[] | null;
}>;

export type ASTOutro = {
  unlock: UnlockExpr | "auto";
  dialogue: DialogueItem[];
};

export type ASTInterrogationScene = Located<{
  kind: "interrogationScene";
  id: string;
  title: string;
  intro: DialogueItem[];
  phases: ASTInterrogationPhase[];
  evidenceManifest: ASTEvidence[];
  statementManifest: ASTStatement[];
  outro: ASTInterrogationOutro;
  assetRefs: AssetRef[];
}>;

export type ASTSubject = Located<{
  id: string;
  name: string;
  role: string;
  bio: string;
}>;

export type ASTInterrogationPhase = ASTInquiryPhase | ASTTestimonyPhase;

export type ASTInquiryPhase = Located<{
  kind: "inquiry";
  id: string;
  label: string;
  subject: ASTSubject;
  required: boolean;
  status: "locked" | "unlocked";
  unlock: InterrogationUnlockExpr | null;
  reveals: InterrogationRevealTarget[];
  sceneTag: string;
  assetCue: VisualAssetCue | null;
  entryDialogue: DialogueItem[];
  complete: "auto" | InterrogationUnlockExpr;
  questions: ASTInquiryQuestion[];
}>;

export type ASTInquiryQuestion = Located<{
  id: string;
  label: string;
  kind: "question" | "followUp";
  parentQuestionId: string | null;
  status: "locked" | "unlocked";
  required: boolean;
  unlock: InterrogationUnlockExpr | null;
  reveals: InterrogationRevealTarget[];
  answerDialogue: DialogueItem[];
  onReask: DialogueItem[] | null;
}>;

export type ASTTestimonyPhase = Located<{
  kind: "testimony";
  id: string;
  label: string;
  subject: ASTSubject;
  required: boolean;
  status: "locked" | "unlocked";
  unlock: InterrogationUnlockExpr | null;
  reveals: InterrogationRevealTarget[];
  sceneTag: string;
  assetCue: VisualAssetCue | null;
  entryDialogue: DialogueItem[];
  statements: ASTTestimonyStatement[];
  results: ASTTestimonyResult[];
}>;

export type ASTTestimonyStatement = Located<{
  id: string;
  label: string;
  content: string;
  contradiction: InventoryTarget | null;
  onCorrect: string | null;
  onWrong: string | null;
  onPress: DialogueItem[] | null;
  onPresent: DialogueItem[] | null;
  onWrongPresent: DialogueItem[] | null;
  reveals: InterrogationRevealTarget[];
}>;

export type ASTTestimonyResult = Located<{
  id: string;
  label: string;
  reveals: InterrogationRevealTarget[];
  dialogue: DialogueItem[];
}>;

export type ASTInterrogationOutro = {
  unlock: "auto" | InterrogationUnlockExpr;
  dialogue: DialogueItem[];
};

// ----- JSON: emitter output (mirrors spec §3b) -------------------------------

export type JSONChaptersIndex = {
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

export type JSONLinearScene = {
  type: "linear";
  id: string;
  title: string;
  queue: JSONDialogueItem[];
  assetRefs: AssetRef[];
};

export type JSONHotspotLayout = RectLayout;
export type JSONCharacterLayout = SpriteLayout;

export type JSONInvestigationScene = {
  type: "investigation";
  id: string;
  title: string;
  intro: JSONDialogueItem[];
  assetRefs: AssetRef[];
  sublocations: Array<{
    id: string;
    label: string;
    status: "locked" | "unlocked";
    unlock: UnlockExpr | null;
    reveals: RevealTarget[];
    sceneTag: string;
    backgroundAssetId: string | null;
    bgm: AudioCue | null;
    bgs: AudioCue | null;
    transitionDialogue: JSONDialogueItem[];
    hotspots: Array<{
      id: string;
      label: string;
      description: string;
      status: "locked" | "unlocked";
      unlock: UnlockExpr | null;
      reveals: RevealTarget[];
      evidenceSource: EvidenceSource | null;
      sceneSourcePrompt: string | null;
      inspectDialogue: JSONDialogueItem[];
      onReexamine: JSONDialogueItem[] | null;
      layout: JSONHotspotLayout | null;
    }>;
    characters: Array<{
      id: string;
      name: string;
      role: string;
      bio: string;
      layout: JSONCharacterLayout | null;
      topics: Array<{
        id: string;
        label: string;
        status: "locked" | "unlocked";
        unlock: UnlockExpr | null;
        reveals: RevealTarget[];
        topicDialogue: JSONDialogueItem[];
        onReexamine: JSONDialogueItem[] | null;
      }>;
    }>;
  }>;
  evidenceManifest: Array<{
    id: string;
    name: string;
    description: string;
    details: string;
    imageAssetId: string | null;
    onCollect: JSONDialogueItem[];
    onReexamine: JSONDialogueItem[] | null;
  }>;
  statementManifest: Array<{
    id: string;
    speaker: string;
    content: string;
    onAcquire: JSONDialogueItem[];
    onReexamine: JSONDialogueItem[] | null;
  }>;
  outro: {
    unlock: "auto" | UnlockExpr;
    dialogue: JSONDialogueItem[];
  };
};

export type JSONInterrogationScene = {
  type: "interrogation";
  id: string;
  title: string;
  intro: JSONDialogueItem[];
  assetRefs: AssetRef[];
  phases: JSONInterrogationPhase[];
  evidenceManifest: Array<{
    id: string;
    name: string;
    description: string;
    details: string;
    imageAssetId: string | null;
    onCollect: JSONDialogueItem[];
    onReexamine: JSONDialogueItem[] | null;
  }>;
  statementManifest: Array<{
    id: string;
    speaker: string;
    content: string;
    onAcquire: JSONDialogueItem[];
    onReexamine: JSONDialogueItem[] | null;
  }>;
  outro: {
    unlock: "auto" | InterrogationUnlockExpr;
    dialogue: JSONDialogueItem[];
  };
};

export type JSONSubject = {
  id: string;
  name: string;
  role: string;
  bio: string;
};

export type JSONInterrogationPhase =
  | {
      kind: "inquiry";
      id: string;
      label: string;
      subject: JSONSubject;
      required: boolean;
      status: "locked" | "unlocked";
      unlock: InterrogationUnlockExpr | null;
      reveals: InterrogationRevealTarget[];
      sceneTag: string;
      backgroundAssetId: string | null;
      bgm: AudioCue | null;
      bgs: AudioCue | null;
      entryDialogue: JSONDialogueItem[];
      complete: "auto" | InterrogationUnlockExpr;
      questions: JSONInquiryQuestion[];
    }
  | {
      kind: "testimony";
      id: string;
      label: string;
      subject: JSONSubject;
      required: boolean;
      status: "locked" | "unlocked";
      unlock: InterrogationUnlockExpr | null;
      reveals: InterrogationRevealTarget[];
      sceneTag: string;
      backgroundAssetId: string | null;
      bgm: AudioCue | null;
      bgs: AudioCue | null;
      entryDialogue: JSONDialogueItem[];
      statements: JSONTestimonyStatement[];
      results: JSONTestimonyResult[];
    };

export type JSONInquiryQuestion = {
  id: string;
  label: string;
  kind: "question" | "followUp";
  parentQuestionId: string | null;
  status: "locked" | "unlocked";
  required: boolean;
  unlock: InterrogationUnlockExpr | null;
  reveals: InterrogationRevealTarget[];
  answerDialogue: JSONDialogueItem[];
  onReask: JSONDialogueItem[] | null;
};

export type JSONTestimonyStatement = {
  id: string;
  label: string;
  content: string;
  contradiction: InventoryTarget | null;
  onCorrect: string | null;
  onWrong: string | null;
  onPress: JSONDialogueItem[] | null;
  onPresent: JSONDialogueItem[] | null;
  onWrongPresent: JSONDialogueItem[] | null;
  reveals: InterrogationRevealTarget[];
};

export type JSONTestimonyResult = {
  id: string;
  label: string;
  reveals: InterrogationRevealTarget[];
  dialogue: JSONDialogueItem[];
};

// ----- Compile errors --------------------------------------------------------

export type CompileError = {
  code: string; // stable identifier, e.g., "unresolvedRevealTarget"
  message: string; // human-readable, with file:line context
  sourceFile: string;
  line: number;
};
