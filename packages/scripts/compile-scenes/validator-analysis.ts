import {
  inventoryTargetKey,
  validateCaseRecordRequirement,
} from "./case-record-provenance";
import type { AnalysisDefinitionRegistry } from "./analysis-definition-registry";
import {
  validateStoryPredicateReferences,
  validateStoryRevealTargets,
} from "./story-catalog";
import type { StoryPredicateReference } from "./validator";
import type {
  ASTAnalysisBoard,
  ASTClassifyBoard,
  ASTOrderBoard,
  ASTStoryCatalog,
  ASTThresholdBoard,
  CaseRecordMetadataRequirement,
  CompiledCaseRecord,
  CompiledCaseRecordCorpus,
  CompileError,
  DialogueItem,
  InventoryTarget,
  Located,
  ProofCapability,
  ProceduralStatus,
  StoryRevealTarget,
  StoryUnlockExpr,
} from "./types";

export type { AnalysisSceneRecord } from "./types";
import type { AnalysisSceneRecord } from "./types";

/**
 * A compile-time materialization budget: six eligible cards produce at most
 * 64 candidate subsets. This is deliberately not a game-design limit.
 */
export const MAX_THRESHOLD_ELIGIBLE_CARDS = 6;

export type AnalysisCardJson = {
  id: string;
  label: string;
  source: InventoryTarget;
  summary: string;
};

export type AnalysisBoardJsonCommon = {
  id: string;
  label: string;
  prompt: string;
  unlock: StoryUnlockExpr | null;
  reveals: StoryRevealTarget[];
  feedback: {
    incomplete: string;
    incorrect: string;
    hint: string | null;
  };
  cards: AnalysisCardJson[];
  resultDialogue: DialogueItem[];
};

export type ClassifyBoardJson = AnalysisBoardJsonCommon & {
  kind: "classify";
  groups: Array<{ id: string; label: string; description: string }>;
  acceptedGroupByCard: Record<string, string>;
};

export type OrderBoardJson = AnalysisBoardJsonCommon & {
  kind: "order";
  acceptedOrder: string[];
  fixedAnchors: Array<{ cardId: string; position: number }>;
};

export type ThresholdBoardJson = AnalysisBoardJsonCommon & {
  kind: "threshold";
  minimumSelected: number;
  acceptedSelections: string[][];
};

export type AnalysisBoardJson =
  | ClassifyBoardJson
  | OrderBoardJson
  | ThresholdBoardJson;

export type NormalizedAnalysisScene = {
  chapterId: string;
  sceneId: string;
  title: string;
  summary: string;
  intro: DialogueItem[];
  boards: AnalysisBoardJson[];
  outro: DialogueItem[];
};

export type ValidateAnalysisScenesResult =
  | { ok: true; value: NormalizedAnalysisScene[] }
  | { ok: false; errors: CompileError[] };

export function validateAnalysisScenes(input: {
  scenes: readonly AnalysisSceneRecord[];
  catalog: ASTStoryCatalog;
  caseRecords: CompiledCaseRecordCorpus;
  analysisRegistry: AnalysisDefinitionRegistry;
}): ValidateAnalysisScenesResult {
  const errors: CompileError[] = [];
  const predicateReferences: StoryPredicateReference[] = [];
  const normalized: NormalizedAnalysisScene[] = [];

  for (const scene of input.scenes) {
    const sceneBoards = new Set<string>();
    const boards: AnalysisBoardJson[] = [];

    for (const board of scene.ast.boards) {
      if (sceneBoards.has(board.id)) {
        pushError(
          errors,
          board,
          "analysisDuplicateBoardId",
          `Analysis scene "${scene.ast.id}" declares board id "${board.id}" more than once.`,
        );
      } else {
        sceneBoards.add(board.id);
      }

      addBoardPredicateReferences(board, predicateReferences);
      validateBoardReveals(board, input.catalog, errors);
      boards.push(normalizeBoard(board, input.caseRecords, errors));
    }

    normalized.push({
      chapterId: scene.chapterId,
      sceneId: scene.ast.id,
      title: scene.ast.title,
      summary: scene.ast.summary,
      intro: [...scene.ast.intro],
      boards,
      outro: [...scene.ast.outro],
    });
  }

  errors.push(
    ...validateStoryPredicateReferences({
      catalog: input.catalog,
      scenes: [],
      analysisRegistry: input.analysisRegistry,
      additionalReferences: predicateReferences,
    }),
  );

  return errors.length === 0
    ? { ok: true, value: normalized }
    : { ok: false, errors };
}

function normalizeBoard(
  board: ASTAnalysisBoard,
  caseRecords: CompiledCaseRecordCorpus,
  errors: CompileError[],
): AnalysisBoardJson {
  const cards = validateBoardCards(board, caseRecords, errors);
  const common = normalizeBoardCommon(board);

  switch (board.kind) {
    case "classify":
      return {
        ...common,
        kind: "classify",
        ...normalizeClassifyBoard(board, cards, errors),
      };
    case "order":
      return {
        ...common,
        kind: "order",
        ...normalizeOrderBoard(board, cards, errors),
      };
    case "threshold":
      return {
        ...common,
        kind: "threshold",
        ...normalizeThresholdBoard(board, cards, errors),
      };
  }
}

function normalizeBoardCommon(
  board: ASTAnalysisBoard,
): AnalysisBoardJsonCommon {
  return {
    id: board.id,
    label: board.label,
    prompt: board.prompt.value,
    unlock: board.unlock?.value ?? null,
    reveals: board.reveals.value.map(copyStoryRevealTarget),
    feedback: {
      incomplete: board.feedback.incomplete.value,
      incorrect: board.feedback.incorrect.value,
      hint: board.feedback.hint?.value ?? null,
    },
    cards: board.cards.map((card) => ({
      id: card.id,
      label: card.label,
      source: { ...card.source.value },
      summary: card.summary.value,
    })),
    resultDialogue: [...board.resultDialogue],
  };
}

type ValidatedBoardCards = {
  displayedById: Map<string, ASTAnalysisBoard["cards"][number]>;
  recordsById: Map<string, CompiledCaseRecord>;
};

function validateBoardCards(
  board: ASTAnalysisBoard,
  caseRecords: CompiledCaseRecordCorpus,
  errors: CompileError[],
): ValidatedBoardCards {
  const displayedById = new Map<string, ASTAnalysisBoard["cards"][number]>();
  const recordsById = new Map<string, CompiledCaseRecord>();
  if (board.cards.length === 0) {
    pushError(
      errors,
      board,
      "analysisBoardNoCards",
      `Analysis board "${board.id}" must declare one or more cards.`,
    );
  }
  if (board.resultDialogue.length === 0) {
    pushError(
      errors,
      board,
      "analysisBoardEmptyResultDialogue",
      `Analysis board "${board.id}" must include non-empty result dialogue.`,
    );
  }

  const seen = new Set<string>();
  for (const card of board.cards) {
    if (seen.has(card.id)) {
      pushError(
        errors,
        card,
        "analysisDuplicateCardId",
        `Analysis board "${board.id}" declares card id "${card.id}" more than once.`,
      );
    } else {
      seen.add(card.id);
      displayedById.set(card.id, card);
    }

    const record = caseRecords.recordsByKey.get(
      inventoryTargetKey(card.source.value),
    );
    if (!record) {
      pushError(
        errors,
        card.source,
        "analysisCardSourceUnresolved",
        `Analysis card "${card.id}" references unknown case record ${inventoryTargetKey(card.source.value)}.`,
      );
      continue;
    }
    if (!recordsById.has(card.id)) recordsById.set(card.id, record);
  }
  return { displayedById, recordsById };
}

function normalizeClassifyBoard(
  board: ASTClassifyBoard,
  cards: ValidatedBoardCards,
  errors: CompileError[],
): Pick<ClassifyBoardJson, "groups" | "acceptedGroupByCard"> {
  if (board.groups.length === 0) {
    pushError(
      errors,
      board,
      "analysisClassifyNoGroups",
      `Classify board "${board.id}" must declare one or more groups.`,
    );
  }

  const acceptedGroupByCard = new Map<string, string>();
  const groupIds = new Set<string>();
  for (const group of board.groups) {
    if (groupIds.has(group.id)) {
      pushError(
        errors,
        group,
        "analysisDuplicateGroupId",
        `Classify board "${board.id}" declares group id "${group.id}" more than once.`,
      );
    } else {
      groupIds.add(group.id);
    }

    for (const acceptedCard of group.acceptedCards) {
      if (!cards.displayedById.has(acceptedCard.value)) {
        pushError(
          errors,
          acceptedCard,
          "analysisClassifyAcceptedCardUnknown",
          `Classify board "${board.id}" group "${group.id}" names unknown card "${acceptedCard.value}".`,
        );
        continue;
      }
      const previousGroup = acceptedGroupByCard.get(acceptedCard.value);
      if (previousGroup !== undefined) {
        pushError(
          errors,
          acceptedCard,
          "analysisClassifyCardAssignedMultipleTimes",
          `Classify card "${acceptedCard.value}" is accepted by both "${previousGroup}" and "${group.id}".`,
        );
        continue;
      }
      acceptedGroupByCard.set(acceptedCard.value, group.id);
    }
  }

  for (const [cardId, card] of cards.displayedById) {
    if (acceptedGroupByCard.has(cardId)) continue;
    pushError(
      errors,
      card,
      "analysisClassifyCardUnassigned",
      `Classify board "${board.id}" omits displayed card "${cardId}" from every accepted group.`,
    );
  }

  return {
    groups: board.groups.map((group) => ({
      id: group.id,
      label: group.label,
      description: group.description.value,
    })),
    acceptedGroupByCard: Object.fromEntries(
      [...acceptedGroupByCard.entries()].sort(([left], [right]) =>
        compareText(left, right),
      ),
    ),
  };
}

function normalizeOrderBoard(
  board: ASTOrderBoard,
  cards: ValidatedBoardCards,
  errors: CompileError[],
): Pick<OrderBoardJson, "acceptedOrder" | "fixedAnchors"> {
  const acceptedOrder: string[] = [];
  const acceptedIds = new Set<string>();
  for (const acceptedCard of board.acceptedOrder) {
    if (!cards.displayedById.has(acceptedCard.value)) {
      pushError(
        errors,
        acceptedCard,
        "analysisOrderAcceptedCardUnknown",
        `Order board "${board.id}" names unknown card "${acceptedCard.value}" in Accepted Order.`,
      );
      continue;
    }
    if (acceptedIds.has(acceptedCard.value)) {
      pushError(
        errors,
        acceptedCard,
        "analysisOrderAcceptedCardDuplicate",
        `Order board "${board.id}" names card "${acceptedCard.value}" more than once in Accepted Order.`,
      );
      continue;
    }
    acceptedIds.add(acceptedCard.value);
    acceptedOrder.push(acceptedCard.value);
  }

  for (const [cardId, card] of cards.displayedById) {
    if (acceptedIds.has(cardId)) continue;
    pushError(
      errors,
      card,
      "analysisOrderCardMissing",
      `Order board "${board.id}" omits displayed card "${cardId}" from Accepted Order.`,
    );
  }

  const anchorCardIds = new Set<string>();
  const anchorPositions = new Set<number>();
  for (const anchor of board.fixedAnchors) {
    const validPosition =
      Number.isSafeInteger(anchor.position) && anchor.position >= 1;
    if (!validPosition) {
      pushError(
        errors,
        anchor,
        "analysisOrderAnchorPositionInvalid",
        `Order board "${board.id}" fixed anchor "${anchor.cardId}" must use a one-based integer position.`,
      );
    } else if (anchor.position > board.cards.length) {
      pushError(
        errors,
        anchor,
        "analysisOrderAnchorPositionOutOfRange",
        `Order board "${board.id}" fixed anchor position ${anchor.position} is outside the displayed card range.`,
      );
    }
    if (anchorCardIds.has(anchor.cardId)) {
      pushError(
        errors,
        anchor,
        "analysisOrderAnchorCardDuplicate",
        `Order board "${board.id}" fixes card "${anchor.cardId}" more than once.`,
      );
    } else {
      anchorCardIds.add(anchor.cardId);
    }
    if (anchorPositions.has(anchor.position)) {
      pushError(
        errors,
        anchor,
        "analysisOrderAnchorPositionDuplicate",
        `Order board "${board.id}" fixes more than one card at position ${anchor.position}.`,
      );
    } else {
      anchorPositions.add(anchor.position);
    }
    if (!cards.displayedById.has(anchor.cardId)) {
      pushError(
        errors,
        anchor,
        "analysisOrderAnchorCardUnknown",
        `Order board "${board.id}" fixed anchor names unknown card "${anchor.cardId}".`,
      );
      continue;
    }
    if (
      validPosition &&
      anchor.position <= acceptedOrder.length &&
      acceptedOrder[anchor.position - 1] !== anchor.cardId
    ) {
      pushError(
        errors,
        anchor,
        "analysisOrderAnchorContradictsOrder",
        `Order board "${board.id}" fixed anchor ${anchor.cardId}@${anchor.position} contradicts Accepted Order.`,
      );
    }
  }

  return {
    acceptedOrder,
    fixedAnchors: board.fixedAnchors.map(({ cardId, position }) => ({
      cardId,
      position,
    })),
  };
}

function normalizeThresholdBoard(
  board: ASTThresholdBoard,
  cards: ValidatedBoardCards,
  errors: CompileError[],
): Pick<ThresholdBoardJson, "minimumSelected" | "acceptedSelections"> {
  const eligibleIds: string[] = [];
  const eligibleIdSet = new Set<string>();
  for (const eligibleCard of board.eligibleCards) {
    if (!cards.displayedById.has(eligibleCard.value)) {
      pushError(
        errors,
        eligibleCard,
        "analysisThresholdEligibleCardUnknown",
        `Threshold board "${board.id}" names unknown eligible card "${eligibleCard.value}".`,
      );
      continue;
    }
    if (eligibleIdSet.has(eligibleCard.value)) {
      pushError(
        errors,
        eligibleCard,
        "analysisThresholdEligibleCardDuplicate",
        `Threshold board "${board.id}" names eligible card "${eligibleCard.value}" more than once.`,
      );
      continue;
    }
    eligibleIdSet.add(eligibleCard.value);
    eligibleIds.push(eligibleCard.value);
  }

  if (eligibleIds.length === 0) {
    pushError(
      errors,
      board,
      "analysisThresholdNoEligibleCards",
      `Threshold board "${board.id}" must name one or more eligible cards.`,
    );
  }
  if (eligibleIds.length > MAX_THRESHOLD_ELIGIBLE_CARDS) {
    pushError(
      errors,
      board.eligibleCards[0] ?? board,
      "analysisThresholdEligibleCardBudgetExceeded",
      `Threshold board "${board.id}" has ${eligibleIds.length} eligible cards; the materialization budget is ${MAX_THRESHOLD_ELIGIBLE_CARDS}.`,
    );
  }
  if (board.minimumSelected.value < 0) {
    pushError(
      errors,
      board.minimumSelected,
      "analysisThresholdMinimumSelectedNegative",
      `Threshold board "${board.id}" Minimum Selected must not be negative.`,
    );
  }
  if (board.minimumDistinctSourceGroups.value < 0) {
    pushError(
      errors,
      board.minimumDistinctSourceGroups,
      "analysisThresholdMinimumDistinctGroupsNegative",
      `Threshold board "${board.id}" Minimum Distinct Source Groups must not be negative.`,
    );
  }

  const allowedStatuses = uniqueEnumValues(
    board.allowedProceduralStatuses,
    "analysisThresholdAllowedStatusDuplicate",
    `Threshold board "${board.id}" names a procedural status more than once.`,
    errors,
  );
  const requiredCapabilities = uniqueEnumValues(
    board.requiredProofCapabilities,
    "analysisThresholdProofCapabilityDuplicate",
    `Threshold board "${board.id}" names a required proof capability more than once.`,
    errors,
  );

  const canMaterialize =
    eligibleIds.length > 0 &&
    eligibleIds.length <= MAX_THRESHOLD_ELIGIBLE_CARDS &&
    board.minimumSelected.value >= 0 &&
    board.minimumDistinctSourceGroups.value >= 0 &&
    eligibleIds.every((cardId) => cards.recordsById.has(cardId));
  const acceptedSelections = canMaterialize
    ? materializeThresholdSelections({
        eligibleIds,
        recordsByCardId: cards.recordsById,
        minimumSelected: board.minimumSelected.value,
        minimumDistinctSourceGroups: board.minimumDistinctSourceGroups.value,
        allowedProceduralStatuses: allowedStatuses,
        requireSourceGroup: board.requireSourceGroup.value,
        requiredProofCapabilities: requiredCapabilities,
        requirementLocation: board,
      })
    : [];

  if (canMaterialize && acceptedSelections.length === 0) {
    pushError(
      errors,
      board,
      "analysisThresholdUnsatisfiable",
      `Threshold board "${board.id}" has no accepted selection under its authored provenance requirements.`,
    );
  }

  return {
    minimumSelected: board.minimumSelected.value,
    acceptedSelections,
  };
}

function materializeThresholdSelections(input: {
  eligibleIds: readonly string[];
  recordsByCardId: ReadonlyMap<string, CompiledCaseRecord>;
  minimumSelected: number;
  minimumDistinctSourceGroups: number;
  allowedProceduralStatuses: ProceduralStatus[];
  requireSourceGroup: boolean;
  requiredProofCapabilities: ProofCapability[];
  requirementLocation: Located<unknown>;
}): string[][] {
  const acceptedSelections: string[][] = [];
  const eligibleIdSet = new Set(input.eligibleIds);
  const requirement: CaseRecordMetadataRequirement = {
    allowedSourceKinds: null,
    allowedRepresentationLayers: null,
    allowedProceduralStatuses: input.allowedProceduralStatuses,
    prohibitedProceduralStatuses: [],
    allowedCompleteness: null,
    allowedConfidence: null,
    requireSourceGroup: input.requireSourceGroup,
    requiredProofCapabilities: [],
  };
  const candidateCount = 1 << input.eligibleIds.length;

  for (let candidate = 0; candidate < candidateCount; candidate += 1) {
    const selection = input.eligibleIds.filter(
      (_, index) => (candidate & (1 << index)) !== 0,
    );
    if (
      !isAcceptedThresholdSelection({
        ...input,
        eligibleIdSet,
        selection,
        requirement,
      })
    ) {
      continue;
    }
    acceptedSelections.push([...selection].sort(compareText));
  }

  return acceptedSelections.sort(compareStringArrays);
}

function isAcceptedThresholdSelection(input: {
  eligibleIdSet: ReadonlySet<string>;
  selection: readonly string[];
  recordsByCardId: ReadonlyMap<string, CompiledCaseRecord>;
  minimumSelected: number;
  minimumDistinctSourceGroups: number;
  requiredProofCapabilities: readonly ProofCapability[];
  requirement: CaseRecordMetadataRequirement;
  requirementLocation: Located<unknown>;
}): boolean {
  if (
    new Set(input.selection).size !== input.selection.length ||
    input.selection.some((id) => !input.eligibleIdSet.has(id)) ||
    input.selection.length < input.minimumSelected
  ) {
    return false;
  }

  const records: CompiledCaseRecord[] = [];
  for (const cardId of input.selection) {
    const record = input.recordsByCardId.get(cardId);
    if (!record) return false;
    const requirementErrors = validateCaseRecordRequirement(
      { id: record.target.id, provenance: record.provenance },
      input.requirement,
      input.requirementLocation,
    );
    if (requirementErrors.length > 0) return false;
    records.push(record);
  }

  const sourceGroups = new Set(
    records
      .map((record) => record.provenance.sourceGroupId)
      .filter((id): id is string => id !== null),
  );
  if (sourceGroups.size < input.minimumDistinctSourceGroups) return false;

  const proofCapabilities = new Set(
    records.flatMap((record) => record.provenance.proofCapabilities),
  );
  return input.requiredProofCapabilities.every((capability) =>
    proofCapabilities.has(capability),
  );
}

function uniqueEnumValues<T extends string>(
  values: readonly Located<{ value: T }>[],
  code: string,
  message: string,
  errors: CompileError[],
): T[] {
  const seen = new Set<T>();
  const unique: T[] = [];
  for (const value of values) {
    if (seen.has(value.value)) {
      pushError(errors, value, code, message);
      continue;
    }
    seen.add(value.value);
    unique.push(value.value);
  }
  return unique;
}

function validateBoardReveals(
  board: ASTAnalysisBoard,
  catalog: ASTStoryCatalog,
  errors: CompileError[],
): void {
  const permittedTargets: StoryRevealTarget[] = [];
  for (const target of board.reveals.value) {
    if (target.kind === "grantAuthorization") {
      pushError(
        errors,
        board.reveals,
        "analysisBoardGrantAuthorizationForbidden",
        `Analysis board "${board.id}" may not grant authorization "${target.authorizationId}".`,
      );
      if (
        !catalog.authorizations.some(
          (authorization) => authorization.id === target.authorizationId,
        )
      ) {
        errors.push(
          ...validateStoryRevealTargets({
            targets: [target],
            catalog,
            representedAuthority: null,
            location: board.reveals,
          }),
        );
      }
      continue;
    }
    permittedTargets.push(target);
  }
  errors.push(
    ...validateStoryRevealTargets({
      targets: permittedTargets,
      catalog,
      representedAuthority: null,
      location: board.reveals,
    }),
  );
}

function addBoardPredicateReferences(
  board: ASTAnalysisBoard,
  references: StoryPredicateReference[],
): void {
  if (board.unlock === null) return;
  addPredicateReferences(board.unlock.value, board.unlock, references);
}

function addPredicateReferences(
  expression: StoryUnlockExpr,
  location: Located<unknown>,
  references: StoryPredicateReference[],
): void {
  if (!("op" in expression)) {
    references.push({ predicate: expression, location });
    return;
  }
  if (expression.op === "at_least") {
    for (const condition of expression.conditions) {
      addPredicateReferences(condition, location, references);
    }
    return;
  }
  addPredicateReferences(expression.left, location, references);
  addPredicateReferences(expression.right, location, references);
}

function copyStoryRevealTarget(target: StoryRevealTarget): StoryRevealTarget {
  return { ...target };
}

function pushError(
  errors: CompileError[],
  location: Located<unknown>,
  code: string,
  message: string,
): void {
  errors.push({
    code,
    message,
    sourceFile: location.sourceFile,
    line: location.line,
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareStringArrays(
  left: readonly string[],
  right: readonly string[],
): number {
  const commonLength = Math.min(left.length, right.length);
  for (let index = 0; index < commonLength; index += 1) {
    const compared = compareText(left[index]!, right[index]!);
    if (compared !== 0) return compared;
  }
  return left.length - right.length;
}
