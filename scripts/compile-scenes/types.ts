// =============================================================================
// scripts/compile-scenes/types.ts
//
// Public contract for the scene-pipeline compiler. Two type families:
//   - AST*  : intermediate representation built by the parsers.
//   - JSON* : final shape written to src-tauri/resources/scenes/.
//
// The shape of JSON* matches the spec §3b 1:1. The Rust engine's serde
// types in Plan B's schema.rs are a direct mirror.
// =============================================================================

// ----- Shared atoms ----------------------------------------------------------

export type DialogueItem =
  | { kind: "sceneTag"; text: string }
  | { kind: "action"; text: string }
  | { kind: "line"; speaker: string; text: string };

export type RevealTarget =
  | { kind: "evidence"; id: string }
  | { kind: "statement"; id: string }
  | { kind: "topic"; characterId: string; topicId: string }
  | { kind: "hotspot"; id: string }
  | { kind: "sublocation"; id: string };

export type UnlockExpr =
  | { op: "and" | "or"; left: UnlockExpr; right: UnlockExpr }
  | { predicate: "evidence_collected"; id: string }
  | { predicate: "statement_acquired"; id: string }
  | { predicate: "topic_discussed"; characterId: string; topicId: string }
  | { predicate: "hotspot_investigated"; id: string };

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
}>;

export type ASTSublocation = Located<{
  id: string;
  label: string;
  status: "locked" | "unlocked";
  unlock: UnlockExpr | null;
  reveals: RevealTarget[];
  sceneTag: string;
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
  inspectDialogue: DialogueItem[];
  onReexamine: DialogueItem[] | null;
}>;

export type ASTCharacter = Located<{
  id: string;
  name: string;
  role: string;
  bio: string;
  topics: ASTTopic[];
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

// ----- JSON: emitter output (mirrors spec §3b) -------------------------------

export type JSONChaptersIndex = {
  chapters: Array<{
    id: string;
    title: string;
    summary: string;
    scenes: Array<{ type: "linear" | "investigation"; file: string }>;
  }>;
};

export type JSONLinearScene = {
  type: "linear";
  id: string;
  title: string;
  queue: DialogueItem[];
};

export type JSONInvestigationScene = {
  type: "investigation";
  id: string;
  title: string;
  intro: DialogueItem[];
  sublocations: Array<{
    id: string;
    label: string;
    status: "locked" | "unlocked";
    unlock: UnlockExpr | null;
    reveals: RevealTarget[];
    sceneTag: string;
    transitionDialogue: DialogueItem[];
    hotspots: Array<{
      id: string;
      label: string;
      description: string;
      status: "locked" | "unlocked";
      unlock: UnlockExpr | null;
      reveals: RevealTarget[];
      inspectDialogue: DialogueItem[];
      onReexamine: DialogueItem[] | null;
    }>;
    characters: Array<{
      id: string;
      name: string;
      role: string;
      bio: string;
      topics: Array<{
        id: string;
        label: string;
        status: "locked" | "unlocked";
        unlock: UnlockExpr | null;
        reveals: RevealTarget[];
        topicDialogue: DialogueItem[];
        onReexamine: DialogueItem[] | null;
      }>;
    }>;
  }>;
  evidenceManifest: Array<{
    id: string;
    name: string;
    description: string;
    details: string;
    onCollect: DialogueItem[];
    onReexamine: DialogueItem[] | null;
  }>;
  statementManifest: Array<{
    id: string;
    speaker: string;
    content: string;
    onAcquire: DialogueItem[];
    onReexamine: DialogueItem[] | null;
  }>;
  outro: {
    unlock: "auto" | UnlockExpr;
    dialogue: DialogueItem[];
  };
};

// ----- Compile errors --------------------------------------------------------

export type CompileError = {
  code: string; // stable identifier, e.g., "unresolvedRevealTarget"
  message: string; // human-readable, with file:line context
  sourceFile: string;
  line: number;
};
