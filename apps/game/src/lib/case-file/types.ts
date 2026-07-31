import type {
  AuthorizationView,
  EvidenceRecord,
  FactView,
  InventoryTarget,
  ObjectiveView,
  QuestionView,
  StatementRecord,
} from "$lib/state/types";

export type CaseFileSection =
  | "objective"
  | "evidence"
  | "statements"
  | "facts"
  | "questions"
  | "authorizations";

export type CaseFileKey =
  | `evidence:${string}`
  | `statement:${string}`
  | `fact:${string}`
  | `question:${string}`
  | `objective:${string}`
  | `authorization:${string}`;

export type CaseFileRecordItem = {
  key: CaseFileKey;
  section: "evidence" | "statements";
  target: InventoryTarget;
  record: EvidenceRecord | StatementRecord;
  predecessor: InventoryTarget | null;
  successor: InventoryTarget | null;
  hasVisibleProvenance: boolean;
};

export type CaseFileFactItem = {
  key: CaseFileKey;
  section: "facts";
  fact: FactView;
  supportingRecordKeys: CaseFileKey[];
  supportingFactKeys: CaseFileKey[];
};

export type CaseFileQuestionItem = {
  key: CaseFileKey;
  section: "questions";
  question: QuestionView;
  resolvedFactKey: CaseFileKey | null;
};

export type CaseFileObjectiveItem = {
  key: CaseFileKey;
  section: "objective";
  objective: ObjectiveView;
};

export type CaseFileAuthorizationItem = {
  key: CaseFileKey;
  section: "authorizations";
  authorization: AuthorizationView;
};

export type CaseFileItem =
  | CaseFileRecordItem
  | CaseFileFactItem
  | CaseFileQuestionItem
  | CaseFileObjectiveItem
  | CaseFileAuthorizationItem;

export type CaseFileObjectives = {
  activePrimary: ObjectiveView | null;
  incompleteSecondaries: ObjectiveView[];
  recentCompleted: ObjectiveView[];
  earlierCompleted: ObjectiveView[];
};

export type CaseFileQuestions = {
  open: CaseFileQuestionItem[];
  resolved: CaseFileQuestionItem[];
};

export type CaseFileModel = {
  objectives: CaseFileObjectives;
  evidence: CaseFileRecordItem[];
  statements: CaseFileRecordItem[];
  facts: CaseFileFactItem[];
  questions: CaseFileQuestions;
  authorizations: CaseFileAuthorizationItem[];
  counts: Record<CaseFileSection, number>;
  itemsByKey: ReadonlyMap<CaseFileKey, CaseFileItem>;
  recordsByKey: ReadonlyMap<CaseFileKey, CaseFileRecordItem>;
  acquiredSuccessorByRecordKey: ReadonlyMap<CaseFileKey, InventoryTarget>;
};
