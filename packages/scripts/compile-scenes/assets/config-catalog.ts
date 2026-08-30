// =============================================================================
// packages/scripts/compile-scenes/assets/config-catalog.ts
//
// Browser-safe parsing and normalization for the asset pipeline's character
// and audio catalogs (characters.yaml, audio.yaml). No Node filesystem or
// path built-ins — consumed by the compiler's loadAssetConfig() and
// deep-imported by the layout editor's Assets workbench so both sides share
// one normalizer.
//
// Ownership split:
//   - here: YAML parsing, document/entry shapes, per-entry slug checks tied
//     to map insertion (expression ids, audio ids), text normalization and
//     its wrong-type warnings.
//   - config.ts (compiler-only): policy.yaml, character id validity
//     (wrong type / missing / slug), duplicate ids, ambiguous display names,
//     required `standard` expression, enabled-mode requirements.
// =============================================================================

import YAML from "yaml";
import type { CompileError } from "../types";

export type AudioChannel = "bgm" | "bgs" | "sfx";
const AUDIO_CHANNELS: readonly AudioChannel[] = ["bgm", "bgs", "sfx"];
const AUDIO_CHANNEL_SET = new Set<string>(AUDIO_CHANNELS);

export type CharacterExpressionConfig = {
  id: string;
  prompt: string;
};

export type CharacterConfig = {
  id: string;
  displayNames: string[];
  portraitMode: "portrait" | "none";
  visualPrompt: string | null;
  referenceAssetId: string | null;
  expressions: Map<string, CharacterExpressionConfig>;
};

export type AudioConfigEntry = {
  id: string;
  prompt: string;
  loop: boolean;
};

export const SAFE_ASSET_SLUG = /^[a-z0-9_]+$/;

// ---- characters -------------------------------------------------------------

/** One parsed character entry, carrying its own parse diagnostics so the
 *  compiler can interleave them with its validity policy exactly as before,
 *  and the metadata the validity policy needs (the editor never runs it). */
export type ParsedCharacterEntry = CharacterConfig & {
  /** Parse/shape/slug diagnostics for this entry, in emission order. */
  errors: CompileError[];
  /** Wrong-type warnings for this entry, in emission order. */
  warnings: CompileError[];
  /** Entry was not a record; compiler validity checks are skipped for it. */
  malformed: boolean;
  /** typeof of the raw id when present but not a string, else null. */
  idWrongTypeKind: string | null;
};

export type ParsedCharacterCatalog =
  | { ok: false; errors: CompileError[] }
  | {
      ok: true;
      characters: ParsedCharacterEntry[];
      errors: CompileError[];
      warnings: CompileError[];
    };

/**
 * Parses characters.yaml text into normalized character entries. Pure: no
 * filesystem access. Parse failures (and document shapes that leave nothing
 * to normalize) return `ok: false`; per-entry problems are collected on the
 * entries themselves.
 */
export function parseCharactersYamlText(
  text: string,
  sourceFile: string,
): ParsedCharacterCatalog {
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (e) {
    return {
      ok: false,
      errors: [
        compileError(
          sourceFile,
          "assetConfigUnreadable",
          `${sourceFile}: ${(e as Error).message}`,
        ),
      ],
    };
  }
  // Empty documents normalize to an empty catalog (matches the compiler's
  // missing-file default of `{ characters: [] }`).
  if (doc === null || doc === undefined) {
    return { ok: true, characters: [], errors: [], warnings: [] };
  }
  const errors: CompileError[] = [];
  const root = asRecord(
    doc,
    sourceFile,
    "assetCharactersFileMalformed",
    errors,
  );
  if (!root) return { ok: false, errors };
  const rawCharacters = root.characters;
  if (rawCharacters !== undefined && !Array.isArray(rawCharacters)) {
    errors.push(
      compileError(
        sourceFile,
        "assetCharactersMalformed",
        `${sourceFile} contains an invalid array shape.`,
      ),
    );
  }
  const characters = (Array.isArray(rawCharacters) ? rawCharacters : []).map(
    (item) => parseCharacterEntry(item, sourceFile),
  );
  return { ok: true, characters, errors, warnings: [] };
}

function parseCharacterEntry(
  item: unknown,
  sourceFile: string,
): ParsedCharacterEntry {
  const errors: CompileError[] = [];
  const warnings: CompileError[] = [];
  const c = asRecord(item, sourceFile, "assetCharacterMalformed", errors);
  if (!c) {
    return {
      id: "",
      displayNames: [],
      portraitMode: "portrait",
      visualPrompt: null,
      referenceAssetId: null,
      expressions: new Map(),
      errors,
      warnings,
      malformed: true,
      idWrongTypeKind: null,
    };
  }
  const idRaw = c.id;
  const id = textWithWarn(idRaw, "id", sourceFile, warnings);
  const displayNames = Array.isArray(c.displayNames)
    ? c.displayNames.flatMap((v) => {
        if (typeof v !== "string") {
          warnings.push(
            compileError(
              sourceFile,
              "assetConfigWrongType",
              `Field "displayNames" entry expected string, got ${typeof v}.`,
            ),
          );
          return [];
        }
        const trimmed = v.trim();
        return trimmed ? [trimmed] : [];
      })
    : [];
  const portraitMode = c.portraitMode === "none" ? "none" : "portrait";
  const expressions = new Map<string, CharacterExpressionConfig>();
  const rawExpressions =
    asOptionalRecord(
      c.expressions,
      sourceFile,
      "assetCharacterExpressionsMalformed",
      errors,
    ) ?? {};
  for (const [exprId, exprRaw] of Object.entries(rawExpressions)) {
    const exprIdIsSafe = SAFE_ASSET_SLUG.test(exprId);
    if (!exprIdIsSafe) {
      errors.push(
        compileError(
          sourceFile,
          "assetCharacterExpressionIdMalformed",
          `Character ${id || "(missing id)"} expression ${exprId} must be a snake_case slug.`,
        ),
      );
    }
    const expr = asRecord(
      exprRaw,
      sourceFile,
      "assetCharacterExpressionMalformed",
      errors,
    );
    if (!expr) continue;
    const prompt = text(expr.prompt);
    if (exprIdIsSafe) expressions.set(exprId, { id: exprId, prompt });
  }
  return {
    id,
    displayNames,
    portraitMode,
    visualPrompt: text(c.visualPrompt) || null,
    referenceAssetId: text(c.referenceAssetId) || null,
    expressions,
    errors,
    warnings,
    malformed: false,
    idWrongTypeKind:
      idRaw !== undefined && idRaw !== null && typeof idRaw !== "string"
        ? typeof idRaw
        : null,
  };
}

// ---- audio ------------------------------------------------------------------

export type ParsedAudioCatalog =
  | { ok: false; errors: CompileError[] }
  | {
      ok: true;
      audio: Record<AudioChannel, Map<string, AudioConfigEntry>>;
      errors: CompileError[];
      warnings: CompileError[];
    };

/**
 * Parses audio.yaml text into normalized per-channel audio maps. Omitted
 * `loop` defaults to true. Pure: no filesystem access.
 */
export function parseAudioYamlText(
  text: string,
  sourceFile: string,
): ParsedAudioCatalog {
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (e) {
    return {
      ok: false,
      errors: [
        compileError(
          sourceFile,
          "assetConfigUnreadable",
          `${sourceFile}: ${(e as Error).message}`,
        ),
      ],
    };
  }
  if (doc === null || doc === undefined) {
    return {
      ok: true,
      audio: emptyAudioMaps(),
      errors: [],
      warnings: [],
    };
  }
  const errors: CompileError[] = [];
  const root = asRecord(doc, sourceFile, "assetAudioFileMalformed", errors);
  if (!root) return { ok: false, errors };
  for (const channel of Object.keys(root)) {
    if (!AUDIO_CHANNEL_SET.has(channel)) {
      errors.push(
        compileError(
          sourceFile,
          "assetAudioChannelUnsupported",
          `Unsupported audio channel "${channel}" in audio.yaml. Expected one of ${AUDIO_CHANNELS.join(", ")}.`,
        ),
      );
    }
  }
  const audio = {
    bgm: buildAudioMap(root.bgm, "bgm", sourceFile, errors),
    bgs: buildAudioMap(root.bgs, "bgs", sourceFile, errors),
    sfx: buildAudioMap(root.sfx, "sfx", sourceFile, errors),
  };
  return { ok: true, audio, errors, warnings: [] };
}

function buildAudioMap(
  raw: unknown,
  channel: AudioChannel,
  sourceFile: string,
  errors: CompileError[],
): Map<string, AudioConfigEntry> {
  const out = new Map<string, AudioConfigEntry>();
  const entries =
    asOptionalRecord(raw, sourceFile, "assetAudioChannelMalformed", errors) ??
    {};
  for (const [id, value] of Object.entries(entries)) {
    if (!SAFE_ASSET_SLUG.test(id)) {
      errors.push(
        compileError(
          sourceFile,
          "assetAudioIdMalformed",
          `${channel}.${id} must be a snake_case slug.`,
        ),
      );
    }
    const record = asRecord(
      value,
      sourceFile,
      "assetAudioEntryMalformed",
      errors,
    );
    if (!record) continue;
    out.set(id, {
      id,
      prompt: text(record.prompt),
      loop: typeof record.loop === "boolean" ? record.loop : true,
    });
  }
  return out;
}

// ---- shared record/text helpers (browser-safe) ------------------------------

export function emptyAudioMaps(): Record<
  AudioChannel,
  Map<string, AudioConfigEntry>
> {
  return { bgm: new Map(), bgs: new Map(), sfx: new Map() };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function asRecord(
  value: unknown,
  sourceFile: string,
  code: string,
  errors: CompileError[],
): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  errors.push(
    compileError(
      sourceFile,
      code,
      `${sourceFile} contains an invalid object shape.`,
    ),
  );
  return null;
}

export function asOptionalRecord(
  value: unknown,
  sourceFile: string,
  code: string,
  errors: CompileError[],
): Record<string, unknown> | null {
  if (value === undefined) return null;
  return asRecord(value, sourceFile, code, errors);
}

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Like text(), but emits a warning when the value is present but not a string. */
export function textWithWarn(
  value: unknown,
  fieldName: string,
  sourceFile: string,
  warnings: CompileError[],
): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  warnings.push(
    compileError(
      sourceFile,
      "assetConfigWrongType",
      `Field "${fieldName}" expected string, got ${typeof value}.`,
    ),
  );
  return "";
}

export function compileError(
  sourceFile: string,
  code: string,
  message: string,
): CompileError {
  return { sourceFile, line: 1, code, message };
}
