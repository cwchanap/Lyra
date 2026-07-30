// =============================================================================
// packages/scripts/compile-scenes/types.ts
//
// Public contract for the scene-pipeline compiler. Two type families:
//   - AST*  : intermediate representation built by the parsers.
//   - JSON* : final shape written to apps/game/src-tauri/resources/scenes/.
//
// The shape of JSON* matches the spec §3b 1:1. The Rust engine's serde
// types in Plan B's schema.rs are a direct mirror.
// =============================================================================

// Shared scene-graph wire types live in @lyra/scene-types (single source of
// truth across the compiler and the layout editor). The four atoms below are
// also referenced by other declarations in this file, so they are imported
// for a local binding and re-exported; JSONChaptersIndex and
// InvestigationLayoutSidecar are pure re-exports. See packages/scene-types.
import type {
  EvidenceSource,
  RectLayout,
  RevealTarget,
  SpriteLayout,
} from "@lyra/scene-types";
export type { EvidenceSource, RectLayout, RevealTarget, SpriteLayout };
export type {
  ChaptersIndex as JSONChaptersIndex,
  IntentionalHotspotOverlap,
  InvestigationLayoutSidecar,
} from "@lyra/scene-types";

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
      portrait: PortraitRef | null;
    };

export type InventoryTarget =
  | { kind: "evidence"; id: string }
  | { kind: "statement"; id: string };

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

export type CaseRecordProvenance = {
  sourceKind: SourceKind;
  representationLayer: RepresentationLayer;
  proceduralStatus: ProceduralStatus;
  completeness: Completeness;
  confidence: Confidence;
  sourceGroupId: string | null;
  sourceLabel: string | null;
  proofCapabilities: ProofCapability[];
  supersedesRecordId: string | null;
};

export type CaseRecordMetadataRequirement = {
  allowedSourceKinds: SourceKind[] | null;
  allowedRepresentationLayers: RepresentationLayer[] | null;
  allowedProceduralStatuses: ProceduralStatus[] | null;
  prohibitedProceduralStatuses: ProceduralStatus[];
  allowedCompleteness: Completeness[] | null;
  allowedConfidence: Confidence[] | null;
  requireSourceGroup: boolean;
  requiredProofCapabilities: ProofCapability[];
};

export type ASTCaseRecordProvenance = {
  sourceKind: Located<{ value: SourceKind }> | null;
  representationLayer: Located<{ value: RepresentationLayer }> | null;
  proceduralStatus: Located<{ value: ProceduralStatus }> | null;
  completeness: Located<{ value: Completeness }> | null;
  confidence: Located<{ value: Confidence }> | null;
  sourceGroupId: Located<{ value: string }> | null;
  sourceLabel: Located<{ value: string }> | null;
  proofCapabilities: Array<Located<{ value: ProofCapability }>>;
  supersedes: Located<InventoryTarget> | null;
};

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

export type ASTStoryCatalog = Located<{
  facts: ASTFactDefinition[];
  questions: ASTQuestionDefinition[];
  objectives: ASTObjectiveDefinition[];
  authorizations: ASTAuthorizationDefinition[];
  sourceGroups: ASTSourceGroupDefinition[];
}>;

export type ASTFactDefinition = Located<{
  id: string;
  label: string;
  summary: string;
  details: string;
  category: string;
}>;

export type ASTQuestionDefinition = Located<{
  id: string;
  label: string;
  summary: string;
  resolvedByFactIds: Array<Located<{ id: string }>>;
}>;

export type ASTObjectiveDefinition = Located<{
  id: string;
  label: string;
  summary: string;
  kind: "primary" | "secondary";
  sortOrder: number;
}>;

export type ASTAuthorizationDefinition = Located<{
  id: string;
  label: string;
  summary: string;
  grantingAuthority: string;
}>;

export type ASTSourceGroupDefinition = Located<{
  id: string;
  label: string;
  summary: string;
}>;

export type SourceGroupDefinition = {
  id: string;
  label: string;
  summary: string;
  members: InventoryTarget[];
};

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
  sourceSublocationId: string | null;
  provenance?: ASTCaseRecordProvenance;
  onCollect: DialogueItem[];
  onReexamine: DialogueItem[] | null;
}>;

export type ASTStatement = Located<{
  id: string;
  speaker: string;
  content: string;
  provenance?: ASTCaseRecordProvenance;
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

export type ASTInterrogationPhase = ASTInquiryPhase; // testimony kind removed

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
  status: "locked" | "unlocked";
  required: boolean;
  unlock: InterrogationUnlockExpr | null;
  reveals: InterrogationRevealTarget[];
  testimony: ASTTestimony;
}>;

export type ASTTestimony = Located<{
  onLoop: DialogueItem[]; // required
  loopPrompt: DialogueItem[] | null; // detective loop beat; required iff a line has a Contradiction
  defaultChallenge: DialogueItem[] | null;
  defaultWrong: DialogueItem[] | null;
  wrongReply: DialogueItem[] | null; // detective wrong-present beat; required iff a line has a Contradiction
  lines: ASTTestimonyLine[]; // >= 1
}>;

export type ASTTestimonyLine = Located<{
  id: string;
  label: string;
  content: DialogueItem[]; // the suspect's line(s), played as dialogue
  contradiction: InventoryTarget | null;
  challenge: DialogueItem[] | null; // required iff contradiction != null
  onCorrect: DialogueItem[] | null; // required iff contradiction != null
  onWrongEvidence: DialogueItem[] | null; // required iff contradiction != null
  reveals: InterrogationRevealTarget[]; // applied on correct present
}>;

export type ASTInterrogationOutro = {
  unlock: "auto" | InterrogationUnlockExpr;
  dialogue: DialogueItem[];
};

// ----- JSON: emitter output (mirrors spec §3b) -------------------------------

// JSONChaptersIndex is re-exported from @lyra/scene-types (see top of file).

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
    sourceSublocationId: string | null;
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

export type JSONInterrogationPhase = {
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
};

export type JSONInquiryQuestion = {
  id: string;
  label: string;
  status: "locked" | "unlocked";
  required: boolean;
  unlock: InterrogationUnlockExpr | null;
  reveals: InterrogationRevealTarget[];
  testimony: JSONTestimony;
};

export type JSONTestimony = {
  onLoop: JSONDialogueItem[];
  loopPrompt: JSONDialogueItem[];
  defaultChallenge: JSONDialogueItem[];
  defaultWrong: JSONDialogueItem[];
  wrongReply: JSONDialogueItem[];
  lines: JSONTestimonyLine[];
};

export type JSONTestimonyLine = {
  id: string;
  label: string;
  content: JSONDialogueItem[];
  contradiction: InventoryTarget | null;
  challenge: JSONDialogueItem[];
  onCorrect: JSONDialogueItem[];
  onWrongEvidence: JSONDialogueItem[];
  reveals: InterrogationRevealTarget[];
};

export type StoryCatalogJson = {
  schemaVersion: 1;
  facts: FactDefinition[];
  questions: QuestionDefinition[];
  objectives: ObjectiveDefinition[];
  authorizations: AuthorizationDefinition[];
  evidenceIndex: CaseRecordDefinitionIndex[];
  statementsIndex: CaseRecordDefinitionIndex[];
};

export type FactDefinition = {
  id: string;
  label: string;
  summary: string;
  details: string;
  category: string;
};

export type QuestionDefinition = {
  id: string;
  label: string;
  summary: string;
  resolvedByFactIds: string[];
};

export type ObjectiveDefinition = {
  id: string;
  label: string;
  summary: string;
  kind: "primary" | "secondary";
  sortOrder: number;
};

export type AuthorizationDefinition = {
  id: string;
  label: string;
  summary: string;
  grantingAuthority: string;
};

export type CaseRecordDefinitionIndex = {
  id: string;
  chapterId: string;
  sceneId: string;
};

export type CompiledCaseRecord = {
  target: InventoryTarget;
  chapterId: string;
  sceneId: string;
  provenance: CaseRecordProvenance;
  sourceFile: string;
  line: number;
};

export type CompiledCaseRecordCorpus = {
  recordsByKey: ReadonlyMap<string, CompiledCaseRecord>;
  evidenceIndex: CaseRecordDefinitionIndex[];
  statementsIndex: CaseRecordDefinitionIndex[];
  sourceGroups: SourceGroupDefinition[];
  warnings: CompileError[];
};

export type CompileCaseRecordCorpusResult =
  | { ok: true; value: CompiledCaseRecordCorpus }
  | { ok: false; errors: CompileError[] };

// ----- Compile errors --------------------------------------------------------

export type CompileError = {
  code: string; // stable identifier, e.g., "unresolvedRevealTarget"
  message: string; // human-readable, with file:line context
  sourceFile: string;
  line: number;
};
