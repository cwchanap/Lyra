import type {
  ASTCaseRecordProvenance,
  ASTStoryCatalog,
  CaseRecordDefinitionIndex,
  CaseRecordMetadataRequirement,
  CaseRecordProvenance,
  CompileCaseRecordCorpusResult,
  CompileError,
  CompiledCaseRecord,
  InventoryTarget,
  Located,
  ProceduralStatus,
  ProofCapability,
} from "./types";
import type { SceneRecord } from "./validator";

export const CASE_RECORD_PROVENANCE_METADATA_KEYS = [
  "Source Kind",
  "Representation Layer",
  "Procedural Status",
  "Completeness",
  "Confidence",
  "Source Group",
  "Source Label",
  "Proof Capabilities",
  "Supersedes",
] as const;

export type ManifestMetadata = Map<string, Located<{ value: string }>>;

const SOURCE_KINDS = [
  "physical",
  "testimony",
  "digital",
  "subjective",
  "unspecified",
] as const;
const REPRESENTATION_LAYERS = [
  "raw",
  "sync",
  "summary",
  "composite",
  "none",
] as const;
const PROCEDURAL_STATUSES = [
  "unspecified",
  "lead",
  "reacquired",
  "exhibit",
] as const;
const COMPLETENESSES = [
  "complete",
  "partial",
  "cropped",
  "unspecified",
] as const;
const CONFIDENCES = [
  "unverified",
  "corroborated",
  "disputed",
  "unspecified",
] as const;
const PROOF_CAPABILITIES = [
  "time",
  "order",
  "route",
  "identity",
  "access",
  "motive",
  "source",
  "credibility",
  "procedure",
  "causation",
] as const;

const PROOF_CAPABILITY_RANK: Record<ProofCapability, number> = {
  time: 0,
  order: 1,
  route: 2,
  identity: 3,
  access: 4,
  motive: 5,
  source: 6,
  credibility: 7,
  procedure: 8,
  causation: 9,
};

const PROCEDURAL_STATUS_RANK: Record<ProceduralStatus, number> = {
  unspecified: 0,
  lead: 1,
  reacquired: 2,
  exhibit: 3,
};

export function inventoryTargetKey(target: InventoryTarget): string {
  return `${target.kind}:${target.id}`;
}

export function compareInventoryTargets(
  left: InventoryTarget,
  right: InventoryTarget,
): number {
  const leftRank = left.kind === "evidence" ? 0 : 1;
  const rightRank = right.kind === "evidence" ? 0 : 1;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function parseCaseRecordProvenance(
  metadata: ManifestMetadata,
):
  | { ok: true; value: ASTCaseRecordProvenance }
  | { ok: false; error: CompileError } {
  for (const key of CASE_RECORD_PROVENANCE_METADATA_KEYS) {
    const field = metadata.get(key);
    if (field && field.value.trim() === "") {
      return fail(
        field,
        "caseRecordMetadataBlank",
        `Case record metadata ${key} must not be blank.`,
      );
    }
  }

  const sourceKind = parseEnum(
    metadata.get("Source Kind"),
    SOURCE_KINDS,
    "Source Kind",
  );
  if (!sourceKind.ok) return sourceKind;
  const representationLayer = parseEnum(
    metadata.get("Representation Layer"),
    REPRESENTATION_LAYERS,
    "Representation Layer",
  );
  if (!representationLayer.ok) return representationLayer;
  const proceduralStatus = parseEnum(
    metadata.get("Procedural Status"),
    PROCEDURAL_STATUSES,
    "Procedural Status",
  );
  if (!proceduralStatus.ok) return proceduralStatus;
  const completeness = parseEnum(
    metadata.get("Completeness"),
    COMPLETENESSES,
    "Completeness",
  );
  if (!completeness.ok) return completeness;
  const confidence = parseEnum(
    metadata.get("Confidence"),
    CONFIDENCES,
    "Confidence",
  );
  if (!confidence.ok) return confidence;

  const proofCapabilities = parseProofCapabilities(
    metadata.get("Proof Capabilities"),
  );
  if (!proofCapabilities.ok) return proofCapabilities;
  const supersedes = parseSupersedes(metadata.get("Supersedes"));
  if (!supersedes.ok) return supersedes;

  return {
    ok: true,
    value: {
      sourceKind: sourceKind.value,
      representationLayer: representationLayer.value,
      proceduralStatus: proceduralStatus.value,
      completeness: completeness.value,
      confidence: confidence.value,
      sourceGroupId: metadata.get("Source Group") ?? null,
      sourceLabel: metadata.get("Source Label") ?? null,
      proofCapabilities: proofCapabilities.value,
      supersedes: supersedes.value,
    },
  };
}

export function emitCaseRecordProvenance(
  provenance: ASTCaseRecordProvenance,
): CaseRecordProvenance {
  return {
    sourceKind: provenance.sourceKind?.value ?? "unspecified",
    representationLayer: provenance.representationLayer?.value ?? "none",
    proceduralStatus: provenance.proceduralStatus?.value ?? "unspecified",
    completeness: provenance.completeness?.value ?? "unspecified",
    confidence: provenance.confidence?.value ?? "unspecified",
    sourceGroupId: provenance.sourceGroupId?.value ?? null,
    sourceLabel: provenance.sourceLabel?.value ?? null,
    proofCapabilities: [...provenance.proofCapabilities]
      .sort(
        (left, right) =>
          PROOF_CAPABILITY_RANK[left.value] -
          PROOF_CAPABILITY_RANK[right.value],
      )
      .map(({ value }) => value),
    supersedesRecordId: provenance.supersedes
      ? `${provenance.supersedes.kind}:${provenance.supersedes.id}`
      : null,
  };
}

export function compileCaseRecordCorpus(
  catalog: ASTStoryCatalog,
  scenes: readonly SceneRecord[],
): CompileCaseRecordCorpusResult {
  const errors: CompileError[] = [];
  const recordsByKey = new Map<string, CompiledCaseRecord>();
  const evidenceIndex: CaseRecordDefinitionIndex[] = [];
  const statementsIndex: CaseRecordDefinitionIndex[] = [];
  const groupsById = new Map<
    string,
    {
      id: string;
      label: string;
      summary: string;
      sourceFile: string;
      line: number;
      members: InventoryTarget[];
    }
  >();
  const supersessionLocations = new Map<string, Located<InventoryTarget>>();

  // Duplicate source-group IDs are rejected by validateStoryCatalog before
  // corpus construction. Retain the first definition rather than creating a
  // second duplicate-definition path here.
  for (const group of catalog.sourceGroups) {
    if (groupsById.has(group.id)) continue;
    groupsById.set(group.id, { ...group, members: [] });
  }

  const addRecord = (
    scene: SceneRecord,
    target: InventoryTarget,
    record: {
      provenance?: ASTCaseRecordProvenance;
      sourceFile: string;
      line: number;
    },
  ): void => {
    const astProvenance = record.provenance ?? emptyASTCaseRecordProvenance();
    const provenance = emitCaseRecordProvenance(astProvenance);
    const key = inventoryTargetKey(target);
    const compiled: CompiledCaseRecord = {
      target,
      chapterId: scene.chapterId,
      sceneId: scene.ast.id,
      provenance,
      sourceFile: record.sourceFile,
      line: record.line,
    };

    // Global same-kind ID uniqueness is owned by validator.ts. Do not replace
    // an earlier validated definition if this pure helper is called out of
    // sequence.
    if (!recordsByKey.has(key)) recordsByKey.set(key, compiled);

    const indexEntry = {
      id: target.id,
      chapterId: scene.chapterId,
      sceneId: scene.ast.id,
    };
    if (target.kind === "evidence") evidenceIndex.push(indexEntry);
    else statementsIndex.push(indexEntry);

    const sourceGroup = astProvenance.sourceGroupId;
    if (sourceGroup) {
      const group = groupsById.get(sourceGroup.value);
      if (!group) {
        errors.push({
          code: "caseRecordSourceGroupUnknown",
          message: `Case record ${key} references undeclared source group "${sourceGroup.value}".`,
          sourceFile: sourceGroup.sourceFile,
          line: sourceGroup.line,
        });
      } else {
        group.members.push(target);
      }
    }

    if (astProvenance.supersedes) {
      supersessionLocations.set(key, astProvenance.supersedes);
    }
  };

  for (const scene of scenes) {
    if (
      scene.ast.kind !== "investigationScene" &&
      scene.ast.kind !== "interrogationScene"
    ) {
      continue;
    }
    for (const evidence of scene.ast.evidenceManifest) {
      addRecord(scene, { kind: "evidence", id: evidence.id }, evidence);
    }
    for (const statement of scene.ast.statementManifest) {
      addRecord(scene, { kind: "statement", id: statement.id }, statement);
    }
  }

  const sortedGroups = [...groupsById.values()].sort(compareIds);
  for (const group of sortedGroups) {
    if (group.members.length > 0) continue;
    errors.push({
      code: "caseRecordSourceGroupUnused",
      message: `Source group "${group.id}" has no case-record members.`,
      sourceFile: group.sourceFile,
      line: group.line,
    });
  }

  validateSupersessionGraph(recordsByKey, supersessionLocations, errors);

  if (errors.length > 0) return { ok: false, errors };

  const sourceGroups = sortedGroups.map(({ id, label, summary, members }) => ({
    id,
    label,
    summary,
    members: [...members].sort(compareInventoryTargets),
  }));
  const warnings: CompileError[] = sourceGroups.flatMap((group) => {
    if (group.members.length !== 1) return [];
    const definition = groupsById.get(group.id);
    const member = group.members[0];
    if (!definition || !member) return [];
    return [
      {
        code: "singletonSourceGroup",
        message: `Source group "${group.id}" has one member: ${inventoryTargetKey(member)}.`,
        sourceFile: definition.sourceFile,
        line: definition.line,
      },
    ];
  });

  return {
    ok: true,
    value: {
      recordsByKey,
      evidenceIndex: evidenceIndex.sort(compareIndexIds),
      statementsIndex: statementsIndex.sort(compareIndexIds),
      sourceGroups,
      warnings,
    },
  };
}

export function validateCaseRecordRequirement(
  record: { id: string; provenance: CaseRecordProvenance },
  requirement: CaseRecordMetadataRequirement,
  requirementLocation: { sourceFile: string; line: number },
): CompileError[] {
  const errors: CompileError[] = [];
  const reject = (reason: string): void => {
    errors.push({
      code: "caseRecordRequirementFailed",
      message: `Case record "${record.id}" does not satisfy the metadata requirement: ${reason}.`,
      sourceFile: requirementLocation.sourceFile,
      line: requirementLocation.line,
    });
  };
  const provenance = record.provenance;

  if (
    requirement.allowedSourceKinds !== null &&
    !requirement.allowedSourceKinds.includes(provenance.sourceKind)
  ) {
    reject(`source kind "${provenance.sourceKind}" is not allowed`);
  }
  if (
    requirement.allowedRepresentationLayers !== null &&
    !requirement.allowedRepresentationLayers.includes(
      provenance.representationLayer,
    )
  ) {
    reject(
      `representation layer "${provenance.representationLayer}" is not allowed`,
    );
  }

  if (
    requirement.prohibitedProceduralStatuses.includes(
      provenance.proceduralStatus,
    )
  ) {
    reject(`procedural status "${provenance.proceduralStatus}" is prohibited`);
  } else if (
    requirement.allowedProceduralStatuses !== null &&
    !requirement.allowedProceduralStatuses.includes(provenance.proceduralStatus)
  ) {
    reject(`procedural status "${provenance.proceduralStatus}" is not allowed`);
  }

  if (
    requirement.allowedCompleteness !== null &&
    !requirement.allowedCompleteness.includes(provenance.completeness)
  ) {
    reject(`completeness "${provenance.completeness}" is not allowed`);
  }
  if (
    requirement.allowedConfidence !== null &&
    !requirement.allowedConfidence.includes(provenance.confidence)
  ) {
    reject(`confidence "${provenance.confidence}" is not allowed`);
  }
  if (requirement.requireSourceGroup && provenance.sourceGroupId === null) {
    reject("a source group is required");
  }
  const missingCapabilities = requirement.requiredProofCapabilities.filter(
    (capability) => !provenance.proofCapabilities.includes(capability),
  );
  if (missingCapabilities.length > 0) {
    reject(
      `required proof capabilities are missing: ${missingCapabilities.join(", ")}`,
    );
  }

  return errors;
}

function emptyASTCaseRecordProvenance(): ASTCaseRecordProvenance {
  return {
    sourceKind: null,
    representationLayer: null,
    proceduralStatus: null,
    completeness: null,
    confidence: null,
    sourceGroupId: null,
    sourceLabel: null,
    proofCapabilities: [],
    supersedes: null,
  };
}

function validateSupersessionGraph(
  recordsByKey: ReadonlyMap<string, CompiledCaseRecord>,
  supersessionLocations: ReadonlyMap<string, Located<InventoryTarget>>,
  errors: CompileError[],
): void {
  const successorByPredecessor = new Map<string, string>();
  const predecessorBySuccessor = new Map<string, string>();
  const sortedSuccessorKeys = [...supersessionLocations.keys()].sort();

  for (const successorKey of sortedSuccessorKeys) {
    const predecessor = supersessionLocations.get(successorKey);
    const successor = recordsByKey.get(successorKey);
    if (!predecessor || !successor) continue;
    const predecessorKey = inventoryTargetKey(predecessor);

    if (predecessorKey === successorKey) {
      errors.push(
        supersessionError(
          "caseRecordSupersessionSelf",
          `Case record ${successorKey} cannot supersede itself.`,
          predecessor,
        ),
      );
      continue;
    }

    const predecessorRecord = recordsByKey.get(predecessorKey);
    if (!predecessorRecord) {
      const oppositeKind =
        predecessor.kind === "evidence" ? "statement" : "evidence";
      const oppositeKey = `${oppositeKind}:${predecessor.id}`;
      if (recordsByKey.has(oppositeKey)) {
        errors.push(
          supersessionError(
            "caseRecordSupersessionKindMismatch",
            `Case record ${successorKey} references ${predecessorKey}, but ${oppositeKey} is the declared record.`,
            predecessor,
          ),
        );
      } else {
        errors.push(
          supersessionError(
            "caseRecordSupersessionUnknown",
            `Case record ${successorKey} supersedes unknown record ${predecessorKey}.`,
            predecessor,
          ),
        );
      }
      continue;
    }

    predecessorBySuccessor.set(successorKey, predecessorKey);

    const existingSuccessor = successorByPredecessor.get(predecessorKey);
    if (existingSuccessor) {
      errors.push(
        supersessionError(
          "caseRecordSupersessionFork",
          `Case record ${predecessorKey} has multiple successors: ${existingSuccessor} and ${successorKey}.`,
          predecessor,
        ),
      );
    } else {
      successorByPredecessor.set(predecessorKey, successorKey);
    }

    if (
      PROCEDURAL_STATUS_RANK[successor.provenance.proceduralStatus] <
      PROCEDURAL_STATUS_RANK[predecessorRecord.provenance.proceduralStatus]
    ) {
      errors.push(
        supersessionError(
          "caseRecordProceduralStatusRegression",
          `Case record ${successorKey} has procedural status "${successor.provenance.proceduralStatus}", which regresses from predecessor ${predecessorKey} status "${predecessorRecord.provenance.proceduralStatus}".`,
          predecessor,
        ),
      );
    }
  }

  const visitState = new Map<string, "visiting" | "visited">();
  const visit = (key: string): void => {
    const state = visitState.get(key);
    if (state === "visited") return;
    if (state === "visiting") return;

    visitState.set(key, "visiting");
    const predecessorKey = predecessorBySuccessor.get(key);
    if (predecessorKey) {
      if (visitState.get(predecessorKey) === "visiting") {
        const location = supersessionLocations.get(key);
        if (location) {
          errors.push(
            supersessionError(
              "caseRecordSupersessionCycle",
              `Supersession edge ${key} -> ${predecessorKey} creates a cycle.`,
              location,
            ),
          );
        }
      } else {
        visit(predecessorKey);
      }
    }
    visitState.set(key, "visited");
  };

  for (const key of [...recordsByKey.keys()].sort()) visit(key);
}

function supersessionError(
  code: string,
  message: string,
  location: Located<InventoryTarget>,
): CompileError {
  return {
    code,
    message,
    sourceFile: location.sourceFile,
    line: location.line,
  };
}

function compareIds(left: { id: string }, right: { id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function compareIndexIds(
  left: CaseRecordDefinitionIndex,
  right: CaseRecordDefinitionIndex,
): number {
  return compareIds(left, right);
}

function parseEnum<T extends string>(
  field: Located<{ value: string }> | undefined,
  allowed: readonly T[],
  label: string,
):
  | { ok: true; value: Located<{ value: T }> | null }
  | { ok: false; error: CompileError } {
  if (!field) return { ok: true, value: null };
  if (!allowed.includes(field.value as T)) {
    return fail(
      field,
      "caseRecordProvenanceInvalidValue",
      `Invalid ${label} value: ${field.value}.`,
    );
  }
  return { ok: true, value: field as Located<{ value: T }> };
}

function parseProofCapabilities(
  field: Located<{ value: string }> | undefined,
):
  | { ok: true; value: Array<Located<{ value: ProofCapability }>> }
  | { ok: false; error: CompileError } {
  if (!field) return { ok: true, value: [] };
  const match = /^\[(.*)\]$/.exec(field.value);
  if (!match) {
    return fail(
      field,
      "caseRecordProofCapabilityMalformed",
      "Proof Capabilities must be a bracketed list.",
    );
  }
  const body = match[1] ?? "";
  if (body === "") return { ok: true, value: [] };

  const values = body.split(",").map((value) => value.trim());
  if (values.some((value) => value === "")) {
    return fail(
      field,
      "caseRecordProofCapabilityMalformed",
      "Proof Capabilities must not contain empty entries.",
    );
  }

  const seen = new Set<string>();
  const capabilities: Array<Located<{ value: ProofCapability }>> = [];
  for (const value of values) {
    if (seen.has(value)) {
      return fail(
        field,
        "caseRecordProofCapabilityDuplicate",
        `Duplicate proof capability: ${value}.`,
      );
    }
    seen.add(value);
    if (!PROOF_CAPABILITIES.includes(value as ProofCapability)) {
      return fail(
        field,
        "caseRecordProvenanceInvalidValue",
        `Invalid Proof Capabilities value: ${value}.`,
      );
    }
    capabilities.push({ ...field, value: value as ProofCapability });
  }
  return { ok: true, value: capabilities };
}

function parseSupersedes(
  field: Located<{ value: string }> | undefined,
):
  | { ok: true; value: ASTCaseRecordProvenance["supersedes"] }
  | { ok: false; error: CompileError } {
  if (!field) return { ok: true, value: null };
  const match = /^(evidence|statement):([a-z0-9_]+)$/.exec(field.value);
  if (!match) {
    return fail(
      field,
      "caseRecordSupersedesMalformed",
      "Supersedes must be a typed evidence:<id> or statement:<id> reference.",
    );
  }
  return {
    ok: true,
    value: {
      kind: match[1] as "evidence" | "statement",
      id: match[2] ?? "",
      sourceFile: field.sourceFile,
      line: field.line,
    },
  };
}

function fail(
  field: Located<{ value: string }>,
  code: string,
  message: string,
): { ok: false; error: CompileError } {
  return {
    ok: false,
    error: { code, message, sourceFile: field.sourceFile, line: field.line },
  };
}
