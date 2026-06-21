import YAML from "yaml";
import type {
  RejectedSound,
  SoundPlan,
  SoundPlanChannel,
  SoundPlanCue,
  SoundPlanDiagnostic,
  SoundPlanEntry,
  SoundPlanEvidence,
  SoundPlanStatus,
} from "./types";

const CHANNELS = new Set<SoundPlanChannel>(["bgm", "bgs", "sfx"]);
const STATUSES = new Set<SoundPlanStatus>([
  "proposed",
  "approved",
  "generated",
  "rejected",
]);
const ID_RE = /^[a-z0-9_]+$/;

export type ParseSoundPlanResult =
  | { ok: true; value: SoundPlan }
  | { ok: false; diagnostics: SoundPlanDiagnostic[] };

export function parseSoundPlanText(
  text: string,
  path: string,
): ParseSoundPlanResult {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "soundPlanYamlInvalid",
          path,
          message: `${path}: ${(error as Error).message}`,
        },
      ],
    };
  }

  const diagnostics: SoundPlanDiagnostic[] = [];
  const plan = coercePlan(raw, path, diagnostics);
  if (!plan) return { ok: false, diagnostics };
  return { ok: true, value: plan };
}

export function validateSoundPlan(plan: SoundPlan): SoundPlanDiagnostic[] {
  const diagnostics: SoundPlanDiagnostic[] = [];
  const ids = new Map<string, SoundPlanEntry>();

  for (const [index, entry] of plan.entries.entries()) {
    const path = `entries[${index}]`;
    let validEvidenceCount = 0;
    if (!ID_RE.test(entry.id)) {
      diagnostics.push({
        code: "soundPlanIdInvalid",
        path: `${path}.id`,
        message: `Sound ID "${entry.id}" must be snake_case.`,
      });
    }
    if (ids.has(entry.id)) {
      diagnostics.push({
        code: "soundPlanDuplicateId",
        path,
        message: `Duplicate sound ID "${entry.id}".`,
      });
    }
    ids.set(entry.id, entry);
    if (entry.prompt.trim() === "") {
      diagnostics.push({
        code: "soundPlanPromptMissing",
        path: `${path}.prompt`,
        message: `Sound "${entry.id}" must define a prompt.`,
      });
    }
    if (
      !Number.isFinite(entry.intendedDurationSeconds) ||
      entry.intendedDurationSeconds <= 0
    ) {
      diagnostics.push({
        code: "soundPlanDurationInvalid",
        path: `${path}.intendedDurationSeconds`,
        message: `Sound "${entry.id}" must define a positive duration.`,
      });
    }
    for (const [evidenceIndex, evidence] of entry.evidence.entries()) {
      const evidencePath = `${path}.evidence[${evidenceIndex}]`;
      if (isValidEvidence(evidence)) {
        validEvidenceCount += 1;
        continue;
      }
      diagnostics.push({
        code: "soundPlanEntryEvidenceInvalid",
        path: evidencePath,
        message: `Sound "${entry.id}" has malformed evidence at ${evidencePath}.`,
      });
    }
    if (validEvidenceCount === 0 && entry.status !== "rejected") {
      diagnostics.push({
        code: "soundPlanEvidenceMissing",
        path: `${path}.evidence`,
        message: `Sound "${entry.id}" must cite at least one scene source.`,
      });
    }
  }

  for (const [index, cue] of plan.cues.entries()) {
    const path = `cues[${index}]`;
    for (const channel of ["bgm", "bgs"] as const) {
      if (!hasOwn(cue, channel)) continue;
      const id = cue[channel];
      if (typeof id !== "string" || id.trim() === "") {
        diagnostics.push({
          code: "soundPlanCueBlankEntry",
          path: `${path}.${channel}`,
          message: `Cue ${channel} must be "none" or a sound entry ID.`,
        });
        continue;
      }
      if (id === "none") continue;
      const entry = ids.get(id);
      if (!entry) {
        diagnostics.push({
          code: "soundPlanCueUnknownEntry",
          path: `${path}.${channel}`,
          message: `Cue references unknown ${channel} entry "${id}".`,
        });
        continue;
      }
      if (entry.channel !== channel) {
        diagnostics.push({
          code: "soundPlanCueChannelMismatch",
          path: `${path}.${channel}`,
          message: `Cue ${channel} references ${entry.channel} entry "${id}".`,
        });
      }
      if (entry.status !== "approved" && entry.status !== "generated") {
        diagnostics.push({
          code: "soundPlanCueUnapprovedEntry",
          path: `${path}.${channel}`,
          message: `Cue references "${id}" before it is approved.`,
        });
      }
    }
    if (hasOwn(cue, "sfx")) {
      diagnostics.push({
        code: "soundPlanSfxCueUnsupported",
        path: `${path}.sfx`,
        message: "SFX cues are not supported in scene markdown in v1.",
      });
    }
  }

  return diagnostics;
}

function coercePlan(
  raw: unknown,
  path: string,
  diagnostics: SoundPlanDiagnostic[],
): SoundPlan | null {
  if (!isRecord(raw)) {
    diagnostics.push({
      code: "soundPlanRootInvalid",
      path,
      message: "Sound plan root must be a YAML object.",
    });
    return null;
  }

  const startDiagnostics = diagnostics.length;
  const schemaVersion = schemaVersionField(raw, diagnostics);
  const chapterId = requiredStringField(
    raw,
    "chapterId",
    "chapterId",
    "soundPlanChapterIdInvalid",
    diagnostics,
  );
  const sources = stringArrayField(
    raw,
    "sources",
    "sources",
    "soundPlanSourcesInvalid",
    "soundPlanSourceInvalid",
    diagnostics,
  );
  const catalogSnapshot = coerceCatalogSnapshot(
    raw.catalogSnapshot,
    diagnostics,
  );
  const entries = coerceEntries(raw.entries, diagnostics);
  const cues = coerceCues(raw.cues, diagnostics);
  const rejected = coerceRejectedSounds(raw.rejected, diagnostics);

  if (diagnostics.length > startDiagnostics) return null;
  return {
    schemaVersion,
    chapterId,
    sources,
    catalogSnapshot,
    entries,
    cues,
    rejected,
  };
}

function schemaVersionField(
  raw: Record<string, unknown>,
  diagnostics: SoundPlanDiagnostic[],
): 1 {
  if (raw.schemaVersion !== 1) {
    diagnostics.push({
      code: "soundPlanSchemaVersionInvalid",
      path: "schemaVersion",
      message: `Sound plan schemaVersion must be 1, got ${formatValue(raw.schemaVersion)}.`,
    });
  }
  return 1;
}

function coerceCatalogSnapshot(
  raw: unknown,
  diagnostics: SoundPlanDiagnostic[],
): SoundPlan["catalogSnapshot"] {
  if (!isRecord(raw)) {
    diagnostics.push({
      code: "soundPlanCatalogSnapshotInvalid",
      path: "catalogSnapshot",
      message:
        "catalogSnapshot must be an object with bgm, bgs, and sfx arrays.",
    });
    return { bgm: [], bgs: [], sfx: [] };
  }

  return {
    bgm: stringArrayField(
      raw,
      "bgm",
      "catalogSnapshot.bgm",
      "soundPlanCatalogSnapshotChannelInvalid",
      "soundPlanCatalogSnapshotEntryInvalid",
      diagnostics,
    ),
    bgs: stringArrayField(
      raw,
      "bgs",
      "catalogSnapshot.bgs",
      "soundPlanCatalogSnapshotChannelInvalid",
      "soundPlanCatalogSnapshotEntryInvalid",
      diagnostics,
    ),
    sfx: stringArrayField(
      raw,
      "sfx",
      "catalogSnapshot.sfx",
      "soundPlanCatalogSnapshotChannelInvalid",
      "soundPlanCatalogSnapshotEntryInvalid",
      diagnostics,
    ),
  };
}

function coerceEntries(
  raw: unknown,
  diagnostics: SoundPlanDiagnostic[],
): SoundPlanEntry[] {
  if (!Array.isArray(raw)) {
    diagnostics.push({
      code: "soundPlanEntriesInvalid",
      path: "entries",
      message: "entries must be an array.",
    });
    return [];
  }

  const entries: SoundPlanEntry[] = [];
  for (const [index, item] of raw.entries()) {
    const entry = coerceEntry(item, `entries[${index}]`, diagnostics);
    if (entry) entries.push(entry);
  }
  return entries;
}

function coerceEntry(
  raw: unknown,
  path: string,
  diagnostics: SoundPlanDiagnostic[],
): SoundPlanEntry | null {
  if (!isRecord(raw)) {
    diagnostics.push({
      code: "soundPlanEntryInvalid",
      path,
      message: "Every sound plan entry must be an object.",
    });
    return null;
  }

  const startDiagnostics = diagnostics.length;
  const id = requiredStringField(
    raw,
    "id",
    `${path}.id`,
    "soundPlanEntryInvalid",
    diagnostics,
  );
  const channel = requiredChannelField(raw, `${path}.channel`, diagnostics);
  const status = requiredStatusField(raw, `${path}.status`, diagnostics);
  const loop = requiredBooleanField(
    raw,
    "loop",
    `${path}.loop`,
    "soundPlanEntryInvalid",
    diagnostics,
  );
  const intendedDurationSeconds = requiredNumberField(
    raw,
    "intendedDurationSeconds",
    `${path}.intendedDurationSeconds`,
    "soundPlanEntryInvalid",
    diagnostics,
  );
  const prompt = requiredStringField(
    raw,
    "prompt",
    `${path}.prompt`,
    "soundPlanEntryInvalid",
    diagnostics,
  );
  const reuseRationale = requiredStringField(
    raw,
    "reuseRationale",
    `${path}.reuseRationale`,
    "soundPlanEntryInvalid",
    diagnostics,
  );
  const evidence = coerceEvidenceArray(
    raw.evidence,
    `${path}.evidence`,
    diagnostics,
  );

  if (diagnostics.length > startDiagnostics) return null;

  const entry: SoundPlanEntry = {
    id,
    channel,
    status,
    loop,
    intendedDurationSeconds,
    prompt,
    reuseRationale,
    evidence,
  };
  addOptionalStringField(entry, "provider", raw, path, diagnostics);
  addOptionalStringField(entry, "endpoint", raw, path, diagnostics);
  addOptionalStringField(entry, "promptHash", raw, path, diagnostics);
  addOptionalStringField(entry, "generatedAt", raw, path, diagnostics);
  addOptionalNumberField(entry, "durationSeconds", raw, path, diagnostics);
  addOptionalStringField(entry, "outputPath", raw, path, diagnostics);
  addOptionalBooleanField(entry, "forced", raw, path, diagnostics);
  addOptionalStringField(entry, "normalizationNotes", raw, path, diagnostics);
  if (diagnostics.length > startDiagnostics) return null;
  return entry;
}

function coerceEvidenceArray(
  raw: unknown,
  path: string,
  diagnostics: SoundPlanDiagnostic[],
): SoundPlanEvidence[] {
  if (!Array.isArray(raw)) {
    diagnostics.push({
      code: "soundPlanEntryEvidenceInvalid",
      path,
      message: "entry.evidence must be an array.",
    });
    return [];
  }

  const evidence: SoundPlanEvidence[] = [];
  for (const [index, item] of raw.entries()) {
    const coerced = coerceEvidence(item, `${path}[${index}]`, diagnostics);
    if (coerced) evidence.push(coerced);
  }
  return evidence;
}

function coerceEvidence(
  raw: unknown,
  path: string,
  diagnostics: SoundPlanDiagnostic[],
): SoundPlanEvidence | null {
  if (!isRecord(raw)) {
    diagnostics.push({
      code: "soundPlanEntryEvidenceInvalid",
      path,
      message: "evidence items must be objects.",
    });
    return null;
  }

  const startDiagnostics = diagnostics.length;
  const evidence = {
    file: requiredStringField(
      raw,
      "file",
      `${path}.file`,
      "soundPlanEntryEvidenceInvalid",
      diagnostics,
      { nonEmpty: true },
    ),
    line: requiredPositiveIntegerField(
      raw,
      "line",
      `${path}.line`,
      "soundPlanEntryEvidenceInvalid",
      diagnostics,
    ),
    note: requiredStringField(
      raw,
      "note",
      `${path}.note`,
      "soundPlanEntryEvidenceInvalid",
      diagnostics,
      { nonEmpty: true },
    ),
  };
  return diagnostics.length === startDiagnostics ? evidence : null;
}

function coerceCues(
  raw: unknown,
  diagnostics: SoundPlanDiagnostic[],
): SoundPlanCue[] {
  if (!Array.isArray(raw)) {
    diagnostics.push({
      code: "soundPlanCuesInvalid",
      path: "cues",
      message: "cues must be an array.",
    });
    return [];
  }

  const cues: SoundPlanCue[] = [];
  for (const [index, item] of raw.entries()) {
    const cue = coerceCue(item, `cues[${index}]`, diagnostics);
    if (cue) cues.push(cue);
  }
  return cues;
}

function coerceCue(
  raw: unknown,
  path: string,
  diagnostics: SoundPlanDiagnostic[],
): SoundPlanCue | null {
  if (!isRecord(raw)) {
    diagnostics.push({
      code: "soundPlanCueInvalid",
      path,
      message: "cue items must be objects.",
    });
    return null;
  }

  const startDiagnostics = diagnostics.length;
  const cue: SoundPlanCue = {
    file: requiredStringField(
      raw,
      "file",
      `${path}.file`,
      "soundPlanCueInvalid",
      diagnostics,
      { nonEmpty: true },
    ),
    visualUnit: requiredStringField(
      raw,
      "visualUnit",
      `${path}.visualUnit`,
      "soundPlanCueInvalid",
      diagnostics,
      { nonEmpty: true },
    ),
  };
  addOptionalCueText(cue, "bgm", raw, path, diagnostics);
  addOptionalCueText(cue, "bgs", raw, path, diagnostics);
  addOptionalCueText(cue, "sfx", raw, path, diagnostics);
  return diagnostics.length === startDiagnostics ? cue : null;
}

function coerceRejectedSounds(
  raw: unknown,
  diagnostics: SoundPlanDiagnostic[],
): RejectedSound[] {
  if (!Array.isArray(raw)) {
    diagnostics.push({
      code: "soundPlanRejectedInvalid",
      path: "rejected",
      message: "rejected must be an array.",
    });
    return [];
  }

  const rejected: RejectedSound[] = [];
  for (const [index, item] of raw.entries()) {
    const sound = coerceRejectedSound(item, `rejected[${index}]`, diagnostics);
    if (sound) rejected.push(sound);
  }
  return rejected;
}

function coerceRejectedSound(
  raw: unknown,
  path: string,
  diagnostics: SoundPlanDiagnostic[],
): RejectedSound | null {
  if (!isRecord(raw)) {
    diagnostics.push({
      code: "soundPlanRejectedInvalid",
      path,
      message: "rejected items must be objects.",
    });
    return null;
  }

  const startDiagnostics = diagnostics.length;
  const rejected = {
    file: requiredStringField(
      raw,
      "file",
      `${path}.file`,
      "soundPlanRejectedInvalid",
      diagnostics,
      { nonEmpty: true },
    ),
    line: requiredPositiveIntegerField(
      raw,
      "line",
      `${path}.line`,
      "soundPlanRejectedInvalid",
      diagnostics,
    ),
    sound: requiredStringField(
      raw,
      "sound",
      `${path}.sound`,
      "soundPlanRejectedInvalid",
      diagnostics,
      { nonEmpty: true },
    ),
    reason: requiredStringField(
      raw,
      "reason",
      `${path}.reason`,
      "soundPlanRejectedInvalid",
      diagnostics,
      { nonEmpty: true },
    ),
  };
  return diagnostics.length === startDiagnostics ? rejected : null;
}

function requiredChannelField(
  raw: Record<string, unknown>,
  path: string,
  diagnostics: SoundPlanDiagnostic[],
): SoundPlanChannel {
  const value = raw.channel;
  if (typeof value !== "string") {
    diagnostics.push({
      code: "soundPlanEntryInvalid",
      path,
      message: `Entry channel must be bgm, bgs, or sfx, got ${formatValue(value)}.`,
    });
    return "bgm";
  }
  if (!CHANNELS.has(value as SoundPlanChannel)) {
    diagnostics.push({
      code: "soundPlanEntryInvalid",
      path,
      message: `Unsupported sound channel "${value}". Expected bgm, bgs, or sfx.`,
    });
    return "bgm";
  }
  return value as SoundPlanChannel;
}

function requiredStatusField(
  raw: Record<string, unknown>,
  path: string,
  diagnostics: SoundPlanDiagnostic[],
): SoundPlanStatus {
  const value = raw.status;
  if (typeof value !== "string") {
    diagnostics.push({
      code: "soundPlanEntryInvalid",
      path,
      message: `Entry status must be proposed, approved, generated, or rejected, got ${formatValue(value)}.`,
    });
    return "proposed";
  }
  if (!STATUSES.has(value as SoundPlanStatus)) {
    diagnostics.push({
      code: "soundPlanEntryInvalid",
      path,
      message: `Unsupported sound status "${value}". Expected proposed, approved, generated, or rejected.`,
    });
    return "proposed";
  }
  return value as SoundPlanStatus;
}

function stringArrayField(
  raw: Record<string, unknown>,
  field: string,
  path: string,
  arrayCode: string,
  itemCode: string,
  diagnostics: SoundPlanDiagnostic[],
): string[] {
  const value = raw[field];
  if (!Array.isArray(value)) {
    diagnostics.push({
      code: arrayCode,
      path,
      message: `${path} must be an array.`,
    });
    return [];
  }

  const out: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    diagnostics.push({
      code: itemCode,
      path: `${path}[${index}]`,
      message: `${path}[${index}] must be a string, got ${formatValue(item)}.`,
    });
  }
  return out;
}

function requiredStringField(
  raw: Record<string, unknown>,
  field: string,
  path: string,
  code: string,
  diagnostics: SoundPlanDiagnostic[],
  options: { nonEmpty?: boolean } = {},
): string {
  const value = raw[field];
  if (typeof value !== "string") {
    diagnostics.push({
      code,
      path,
      message: `${path} must be a string, got ${formatValue(value)}.`,
    });
    return "";
  }
  if (options.nonEmpty === true && value.trim() === "") {
    diagnostics.push({
      code,
      path,
      message: `${path} must not be empty.`,
    });
  }
  return value;
}

function requiredBooleanField(
  raw: Record<string, unknown>,
  field: string,
  path: string,
  code: string,
  diagnostics: SoundPlanDiagnostic[],
): boolean {
  const value = raw[field];
  if (typeof value !== "boolean") {
    diagnostics.push({
      code,
      path,
      message: `${path} must be a boolean, got ${formatValue(value)}.`,
    });
    return false;
  }
  return value;
}

function requiredNumberField(
  raw: Record<string, unknown>,
  field: string,
  path: string,
  code: string,
  diagnostics: SoundPlanDiagnostic[],
): number {
  const value = raw[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    diagnostics.push({
      code,
      path,
      message: `${path} must be a finite number, got ${formatValue(value)}.`,
    });
    return Number.NaN;
  }
  return value;
}

function requiredPositiveIntegerField(
  raw: Record<string, unknown>,
  field: string,
  path: string,
  code: string,
  diagnostics: SoundPlanDiagnostic[],
): number {
  const value = raw[field];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    diagnostics.push({
      code,
      path,
      message: `${path} must be a positive integer, got ${formatValue(value)}.`,
    });
    return Number.NaN;
  }
  return value;
}

function addOptionalStringField<
  K extends
    | "provider"
    | "endpoint"
    | "promptHash"
    | "generatedAt"
    | "outputPath"
    | "normalizationNotes",
>(
  target: SoundPlanEntry,
  key: K,
  raw: Record<string, unknown>,
  path: string,
  diagnostics: SoundPlanDiagnostic[],
): void {
  if (!hasOwn(raw, key)) return;
  const value = raw[key];
  if (typeof value !== "string") {
    diagnostics.push({
      code: "soundPlanEntryInvalid",
      path: `${path}.${key}`,
      message: `${path}.${key} must be a string, got ${formatValue(value)}.`,
    });
    return;
  }
  target[key] = value;
}

function addOptionalNumberField(
  target: SoundPlanEntry,
  key: "durationSeconds",
  raw: Record<string, unknown>,
  path: string,
  diagnostics: SoundPlanDiagnostic[],
): void {
  if (!hasOwn(raw, key)) return;
  const value = raw[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    diagnostics.push({
      code: "soundPlanEntryInvalid",
      path: `${path}.${key}`,
      message: `${path}.${key} must be a finite number, got ${formatValue(value)}.`,
    });
    return;
  }
  target[key] = value;
}

function addOptionalBooleanField(
  target: SoundPlanEntry,
  key: "forced",
  raw: Record<string, unknown>,
  path: string,
  diagnostics: SoundPlanDiagnostic[],
): void {
  if (!hasOwn(raw, key)) return;
  const value = raw[key];
  if (typeof value !== "boolean") {
    diagnostics.push({
      code: "soundPlanEntryInvalid",
      path: `${path}.${key}`,
      message: `${path}.${key} must be a boolean, got ${formatValue(value)}.`,
    });
    return;
  }
  target[key] = value;
}

function addOptionalCueText(
  target: SoundPlanCue,
  key: "bgm" | "bgs" | "sfx",
  raw: Record<string, unknown>,
  path: string,
  diagnostics: SoundPlanDiagnostic[],
): void {
  if (!hasOwn(raw, key)) return;
  const value = raw[key];
  if (typeof value !== "string") {
    diagnostics.push({
      code: "soundPlanCueInvalid",
      path: `${path}.${key}`,
      message: `${path}.${key} must be a string, got ${formatValue(value)}.`,
    });
    return;
  }
  target[key] = value;
}

function isValidEvidence(evidence: SoundPlanEvidence): boolean {
  return (
    evidence.file.trim() !== "" &&
    Number.isInteger(evidence.line) &&
    evidence.line > 0 &&
    evidence.note.trim() !== ""
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (value === undefined) return "undefined";
  return JSON.stringify(value) ?? String(value);
}
