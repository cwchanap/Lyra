import type {
  ASTCaseRecordProvenance,
  CaseRecordProvenance,
  CompileError,
  Located,
  ProofCapability,
} from "./types";

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
