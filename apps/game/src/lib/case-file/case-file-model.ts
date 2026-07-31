import type {
  EvidenceRecord,
  GameStateView,
  InventoryTarget,
  StatementRecord,
} from "$lib/state/types";
import type {
  CaseFileAuthorizationItem,
  CaseFileFactItem,
  CaseFileItem,
  CaseFileKey,
  CaseFileModel,
  CaseFileQuestionItem,
  CaseFileRecordItem,
} from "./types";

export function recordKey(target: InventoryTarget): CaseFileKey {
  return `${target.kind}:${target.id}`;
}

export function factKey(id: string): CaseFileKey {
  return `fact:${id}`;
}

export function parseEncodedRecordTarget(
  value: string,
): InventoryTarget | null {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return null;

  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (kind === "evidence" || kind === "statement") return { kind, id };
  return null;
}

export function hasVisibleProvenance(
  record: EvidenceRecord | StatementRecord,
  acquiredSuccessor: InventoryTarget | null,
): boolean {
  const provenance = record.provenance;
  return (
    provenance.sourceKind !== "unspecified" ||
    provenance.representationLayer !== "none" ||
    provenance.proceduralStatus !== "unspecified" ||
    provenance.completeness !== "unspecified" ||
    provenance.confidence !== "unspecified" ||
    provenance.sourceLabel !== null ||
    record.sourceGroup !== null ||
    provenance.proofCapabilities.length > 0 ||
    provenance.supersedesRecordId !== null ||
    acquiredSuccessor !== null
  );
}

function recordTarget(
  record: EvidenceRecord | StatementRecord,
): InventoryTarget {
  return "name" in record
    ? { kind: "evidence", id: record.id }
    : { kind: "statement", id: record.id };
}

function normalizedRecord(
  record: EvidenceRecord | StatementRecord,
  predecessor: InventoryTarget | null,
): EvidenceRecord | StatementRecord {
  if (predecessor !== null || record.provenance.supersedesRecordId === null) {
    return record;
  }
  return {
    ...record,
    provenance: { ...record.provenance, supersedesRecordId: null },
  };
}

function recordItems(state: GameStateView): CaseFileRecordItem[] {
  const records = [...state.inventory.evidence, ...state.inventory.statements];
  const acquiredKeys = new Set(
    records.map((record) => recordKey(recordTarget(record))),
  );
  const items = records.map((record) => {
    const target = recordTarget(record);
    const parsedPredecessor =
      record.provenance.supersedesRecordId === null
        ? null
        : parseEncodedRecordTarget(record.provenance.supersedesRecordId);
    const predecessor =
      parsedPredecessor !== null &&
      acquiredKeys.has(recordKey(parsedPredecessor))
        ? parsedPredecessor
        : null;
    return {
      key: recordKey(target),
      section: target.kind === "evidence" ? "evidence" : "statements",
      target,
      record: normalizedRecord(record, predecessor),
      predecessor,
      successor: null,
      hasVisibleProvenance: false,
    } satisfies CaseFileRecordItem;
  });

  const successors = new Map<CaseFileKey, InventoryTarget>();
  for (const item of items) {
    if (item.predecessor !== null) {
      successors.set(recordKey(item.predecessor), item.target);
    }
  }

  return items.map((item) => {
    const successor = successors.get(item.key) ?? null;
    return {
      ...item,
      successor,
      hasVisibleProvenance: hasVisibleProvenance(item.record, successor),
    };
  });
}

export function buildCaseFileModel(state: GameStateView): CaseFileModel {
  const records = recordItems(state);
  const evidence = records.filter((item) => item.section === "evidence");
  const statements = records.filter((item) => item.section === "statements");
  const recordsByKey = new Map(records.map((item) => [item.key, item]));
  const acquiredSuccessorByRecordKey = new Map<CaseFileKey, InventoryTarget>();
  for (const item of records) {
    if (item.successor !== null) {
      acquiredSuccessorByRecordKey.set(item.key, item.successor);
    }
  }

  const visibleFactKeys = new Set(
    state.story.facts.map((fact) => factKey(fact.id)),
  );
  const facts: CaseFileFactItem[] = state.story.facts.map((fact) => {
    const supportingRecords = fact.supportingRecords.filter((target) =>
      recordsByKey.has(recordKey(target)),
    );
    const supportingFactIds = fact.supportingFactIds.filter((id) =>
      visibleFactKeys.has(factKey(id)),
    );
    return {
      key: factKey(fact.id),
      section: "facts",
      fact: { ...fact, supportingRecords, supportingFactIds },
      supportingRecordKeys: supportingRecords.map(recordKey),
      supportingFactKeys: supportingFactIds.map(factKey),
    };
  });

  const factsByKey = new Set(facts.map((fact) => fact.key));
  const questions: CaseFileQuestionItem[] = state.story.questions.map(
    (question) => {
      const resolvedFactKey =
        question.resolvedByFactId !== null &&
        factsByKey.has(factKey(question.resolvedByFactId))
          ? factKey(question.resolvedByFactId)
          : null;
      return {
        key: `question:${question.id}`,
        section: "questions",
        question: {
          ...question,
          resolvedByFactId:
            resolvedFactKey === null ? null : question.resolvedByFactId,
        },
        resolvedFactKey,
      };
    },
  );

  const objectives = state.story.objectives;
  const completed = objectives
    .filter((objective) => objective.completed)
    .toSorted(
      (left, right) =>
        right.sortOrder - left.sortOrder || left.id.localeCompare(right.id),
    );
  const activePrimary =
    objectives.find(
      (objective) => objective.activePrimary && !objective.completed,
    ) ?? null;
  const incompleteSecondaries = objectives.filter(
    (objective) => objective.kind === "secondary" && !objective.completed,
  );
  const recentCompleted = completed.slice(0, 3);
  const earlierCompleted = completed.slice(3);
  const authorizationItems: CaseFileAuthorizationItem[] =
    state.story.authorizations.map((authorization) => ({
      key: `authorization:${authorization.id}`,
      section: "authorizations",
      authorization,
    }));

  const visibleObjectives = [
    ...(activePrimary === null ? [] : [activePrimary]),
    ...incompleteSecondaries,
    ...recentCompleted,
    ...earlierCompleted,
  ];
  const objectiveItems: CaseFileItem[] = visibleObjectives.map((objective) => ({
    key: `objective:${objective.id}`,
    section: "objective",
    objective,
  }));
  const factItems: CaseFileItem[] = facts;
  const questionItems: CaseFileItem[] = questions;
  const itemEntries: Array<[CaseFileKey, CaseFileItem]> = [
    ...records.map((item) => [item.key, item] as [CaseFileKey, CaseFileItem]),
    ...factItems.map((item) => [item.key, item] as [CaseFileKey, CaseFileItem]),
    ...questionItems.map(
      (item) => [item.key, item] as [CaseFileKey, CaseFileItem],
    ),
    ...objectiveItems.map(
      (item) => [item.key, item] as [CaseFileKey, CaseFileItem],
    ),
    ...authorizationItems.map(
      (item) => [item.key, item] as [CaseFileKey, CaseFileItem],
    ),
  ];

  return {
    objectives: {
      activePrimary,
      incompleteSecondaries,
      recentCompleted,
      earlierCompleted,
    },
    evidence,
    statements,
    facts,
    questions: {
      open: questions.filter(({ question }) => question.status === "open"),
      resolved: questions.filter(
        ({ question }) => question.status === "resolved",
      ),
    },
    authorizations: authorizationItems,
    counts: {
      objective:
        (activePrimary === null ? 0 : 1) +
        incompleteSecondaries.length +
        recentCompleted.length +
        earlierCompleted.length,
      evidence: evidence.length,
      statements: statements.length,
      facts: facts.length,
      questions: questions.length,
      authorizations: authorizationItems.length,
    },
    itemsByKey: new Map(itemEntries),
    recordsByKey,
    acquiredSuccessorByRecordKey,
  };
}
