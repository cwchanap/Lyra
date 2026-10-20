import YAML from "yaml";
import { parseCharactersYamlText } from "../compile-scenes/assets/config-catalog";
import { LOCALE_PATTERN, type ParseResult } from "./locale-script";
import type { VoiceDiagnostic } from "./types";

export const VOICE_CAST_PATH = "static/assets/config/voice_cast.yaml";
export const CHARACTERS_PATH = "static/assets/config/characters.yaml";

export const CAST_STATUSES = ["proposed", "approved", "rejected"] as const;
export type CastStatus = (typeof CAST_STATUSES)[number];

/** ElevenLabs `voice_settings`, in the repo's camelCase. */
export type VoiceSettings = {
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
  useSpeakerBoost?: boolean;
};

export type AuditionLine = {
  ja: string;
  /** Portrait expression whose direction the audition uses; default standard. */
  expression?: string;
};

export type CastCandidate = { name: string; voiceId: string };

export type CastEntry = {
  characterId: string;
  /** The speaker names scenes use for this character (its displayNames). */
  speakers: string[];
  status: CastStatus;
  voiceId: string | null;
  settings: VoiceSettings;
  seed: number;
  expressionDirections: Record<string, string>;
  auditionLines: AuditionLine[];
  candidates: CastCandidate[];
};

export type LocaleCast = {
  locale: string;
  model: string;
  languageTextNormalization: boolean;
  cast: CastEntry[];
};

export type VoiceCast = {
  schemaVersion: 1;
  locales: Map<string, LocaleCast>;
};

/** ElevenLabs voice IDs are alphanumeric. */
const VOICE_ID_PATTERN = /^[A-Za-z0-9]+$/;
const SEED_MAX = 4294967295;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaError(path: string, message: string): VoiceDiagnostic {
  return { severity: "error", code: "voiceCastSchema", message, path };
}

function checkKeys(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  diagnostics: VoiceDiagnostic[],
): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      diagnostics.push(schemaError(path, `Unknown field "${key}".`));
    }
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readSettings(
  raw: unknown,
  path: string,
  diagnostics: VoiceDiagnostic[],
): VoiceSettings | null {
  if (!isRecord(raw)) {
    diagnostics.push(schemaError(path, "`settings` must be a mapping."));
    return null;
  }
  checkKeys(
    raw,
    ["stability", "similarityBoost", "style", "speed", "useSpeakerBoost"],
    path,
    diagnostics,
  );
  const before = diagnostics.length;
  const unit = (key: string, min: number, max: number): number => {
    const value = raw[key];
    if (typeof value !== "number" || value < min || value > max) {
      diagnostics.push(
        schemaError(
          path,
          `\`settings.${key}\` must be a number from ${min} to ${max}.`,
        ),
      );
      return 0;
    }
    return value;
  };
  const settings: VoiceSettings = {
    stability: unit("stability", 0, 1),
    similarityBoost: unit("similarityBoost", 0, 1),
    style: unit("style", 0, 1),
    speed: unit("speed", 0.7, 1.2),
  };
  if (raw.useSpeakerBoost !== undefined) {
    if (typeof raw.useSpeakerBoost !== "boolean") {
      diagnostics.push(
        schemaError(path, "`settings.useSpeakerBoost` must be true or false."),
      );
    } else {
      settings.useSpeakerBoost = raw.useSpeakerBoost;
    }
  }
  return diagnostics.length > before ? null : settings;
}

function readStringMap(
  raw: unknown,
  field: string,
  path: string,
  diagnostics: VoiceDiagnostic[],
): Record<string, string> {
  if (!isRecord(raw)) {
    diagnostics.push(schemaError(path, `\`${field}\` must be a mapping.`));
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!nonEmptyString(value)) {
      diagnostics.push(
        schemaError(path, `\`${field}.${key}\` must be a non-empty string.`),
      );
      continue;
    }
    out[key] = value;
  }
  return out;
}

function readAuditionLines(
  raw: unknown,
  path: string,
  diagnostics: VoiceDiagnostic[],
): AuditionLine[] {
  if (!Array.isArray(raw)) {
    diagnostics.push(schemaError(path, "`auditionLines` must be a list."));
    return [];
  }
  const lines: AuditionLine[] = [];
  raw.forEach((item, index) => {
    const itemPath = `${path}.auditionLines[${index}]`;
    if (!isRecord(item)) {
      diagnostics.push(schemaError(itemPath, "Must be a mapping."));
      return;
    }
    checkKeys(item, ["ja", "expression"], itemPath, diagnostics);
    if (!nonEmptyString(item.ja)) {
      diagnostics.push(
        schemaError(itemPath, "`ja` must be a non-empty string."),
      );
      return;
    }
    const line: AuditionLine = { ja: item.ja };
    if (item.expression !== undefined) {
      if (!nonEmptyString(item.expression)) {
        diagnostics.push(
          schemaError(itemPath, "`expression` must be a non-empty string."),
        );
        return;
      }
      line.expression = item.expression;
    }
    lines.push(line);
  });
  return lines;
}

function readCandidates(
  raw: unknown,
  path: string,
  diagnostics: VoiceDiagnostic[],
): CastCandidate[] {
  if (!Array.isArray(raw)) {
    diagnostics.push(schemaError(path, "`candidates` must be a list."));
    return [];
  }
  const candidates: CastCandidate[] = [];
  raw.forEach((item, index) => {
    const itemPath = `${path}.candidates[${index}]`;
    if (!isRecord(item)) {
      diagnostics.push(schemaError(itemPath, "Must be a mapping."));
      return;
    }
    checkKeys(item, ["name", "voiceId"], itemPath, diagnostics);
    if (!nonEmptyString(item.name)) {
      diagnostics.push(
        schemaError(itemPath, "`name` must be a non-empty string."),
      );
      return;
    }
    if (
      typeof item.voiceId !== "string" ||
      !VOICE_ID_PATTERN.test(item.voiceId)
    ) {
      diagnostics.push(
        schemaError(itemPath, "`voiceId` must be an ElevenLabs voice ID."),
      );
      return;
    }
    candidates.push({ name: item.name, voiceId: item.voiceId });
  });
  return candidates;
}

function readCastEntry(
  raw: unknown,
  path: string,
  characters: Map<string, { speakers: string[]; expressions: Set<string> }>,
  diagnostics: VoiceDiagnostic[],
): CastEntry | null {
  if (!isRecord(raw)) {
    diagnostics.push(schemaError(path, "A cast entry must be a mapping."));
    return null;
  }
  checkKeys(
    raw,
    [
      "characterId",
      "status",
      "voiceId",
      "settings",
      "seed",
      "expressionDirections",
      "auditionLines",
      "candidates",
    ],
    path,
    diagnostics,
  );
  const before = diagnostics.length;
  const characterId = raw.characterId;
  const character =
    typeof characterId === "string" ? characters.get(characterId) : undefined;
  if (typeof characterId !== "string" || !character) {
    diagnostics.push(
      schemaError(
        path,
        `\`characterId\` must name a character in ${CHARACTERS_PATH}.`,
      ),
    );
  }
  const status = raw.status;
  if (!CAST_STATUSES.includes(status as CastStatus)) {
    diagnostics.push(
      schemaError(
        path,
        `\`status\` must be one of ${CAST_STATUSES.join(", ")}.`,
      ),
    );
  }
  const voiceId = raw.voiceId ?? null;
  if (
    voiceId !== null &&
    (typeof voiceId !== "string" || !VOICE_ID_PATTERN.test(voiceId))
  ) {
    diagnostics.push(
      schemaError(path, "`voiceId` must be an ElevenLabs voice ID or null."),
    );
  }
  if (status === "approved" && voiceId === null) {
    diagnostics.push(
      schemaError(path, "An `approved` entry needs the picked `voiceId`."),
    );
  }
  const seed = raw.seed;
  if (
    typeof seed !== "number" ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > SEED_MAX
  ) {
    diagnostics.push(
      schemaError(path, `\`seed\` must be an integer from 0 to ${SEED_MAX}.`),
    );
  }
  const settings = readSettings(raw.settings, `${path}.settings`, diagnostics);
  const expressionDirections = readStringMap(
    raw.expressionDirections,
    "expressionDirections",
    path,
    diagnostics,
  );
  if (character) {
    for (const expression of Object.keys(expressionDirections)) {
      if (!character.expressions.has(expression)) {
        diagnostics.push(
          schemaError(
            path,
            `\`expressionDirections.${expression}\` is not an expression of ${String(characterId)} in ${CHARACTERS_PATH}.`,
          ),
        );
      }
    }
  }
  const auditionLines = readAuditionLines(raw.auditionLines, path, diagnostics);
  if (character) {
    for (const line of auditionLines) {
      if (
        line.expression !== undefined &&
        !character.expressions.has(line.expression)
      ) {
        diagnostics.push(
          schemaError(
            path,
            `Audition expression ${line.expression} is not an expression of ${String(characterId)} in ${CHARACTERS_PATH}.`,
          ),
        );
      }
    }
  }
  const candidates = readCandidates(raw.candidates, path, diagnostics);
  if (diagnostics.length > before || !character || !settings) return null;
  return {
    characterId: characterId as string,
    speakers: character.speakers,
    status: status as CastStatus,
    voiceId: voiceId as string | null,
    settings,
    seed: seed as number,
    expressionDirections,
    auditionLines,
    candidates,
  };
}

/**
 * Parses `voice_cast.yaml`. `charactersText` is `characters.yaml`, which
 * supplies each cast entry's speaker name and the expressions its directions
 * may name.
 */
export function parseVoiceCastText(
  text: string,
  path: string,
  charactersText: string,
): ParseResult<VoiceCast> {
  const characters = parseCharactersYamlText(charactersText, CHARACTERS_PATH);
  if (!characters.ok) {
    return {
      ok: false,
      diagnostics: characters.errors.map((error) =>
        schemaError(CHARACTERS_PATH, error.message),
      ),
    };
  }
  const known = new Map<
    string,
    { speakers: string[]; expressions: Set<string> }
  >();
  for (const character of characters.characters) {
    if (character.malformed || character.displayNames.length === 0) continue;
    known.set(character.id, {
      speakers: character.displayNames,
      expressions: new Set(character.expressions.keys()),
    });
  }

  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (cause) {
    return {
      ok: false,
      diagnostics: [
        schemaError(
          path,
          `Invalid YAML: ${cause instanceof Error ? cause.message : String(cause)}`,
        ),
      ],
    };
  }
  if (!isRecord(raw)) {
    return {
      ok: false,
      diagnostics: [schemaError(path, "The voice cast must be a mapping.")],
    };
  }
  const diagnostics: VoiceDiagnostic[] = [];
  checkKeys(raw, ["schemaVersion", "locales"], path, diagnostics);
  if (raw.schemaVersion !== 1) {
    diagnostics.push(schemaError(path, "`schemaVersion` must be 1."));
  }
  const locales = new Map<string, LocaleCast>();
  if (!isRecord(raw.locales)) {
    diagnostics.push(schemaError(path, "`locales` must be a mapping."));
  } else {
    for (const [locale, value] of Object.entries(raw.locales)) {
      const localePath = `${path}#locales.${locale}`;
      if (!LOCALE_PATTERN.test(locale)) {
        diagnostics.push(
          schemaError(localePath, "Locale keys are codes such as ja."),
        );
        continue;
      }
      if (!isRecord(value)) {
        diagnostics.push(schemaError(localePath, "Must be a mapping."));
        continue;
      }
      checkKeys(
        value,
        ["model", "languageTextNormalization", "cast"],
        localePath,
        diagnostics,
      );
      if (!nonEmptyString(value.model)) {
        diagnostics.push(
          schemaError(localePath, "`model` must be an ElevenLabs model ID."),
        );
      }
      const normalization = value.languageTextNormalization ?? false;
      if (typeof normalization !== "boolean") {
        diagnostics.push(
          schemaError(
            localePath,
            "`languageTextNormalization` must be true or false.",
          ),
        );
      }
      if (!Array.isArray(value.cast)) {
        diagnostics.push(schemaError(localePath, "`cast` must be a list."));
        continue;
      }
      const cast: CastEntry[] = [];
      const seen = new Set<string>();
      value.cast.forEach((item, index) => {
        const entry = readCastEntry(
          item,
          `${localePath}.cast[${index}]`,
          known,
          diagnostics,
        );
        if (!entry) return;
        if (seen.has(entry.characterId)) {
          diagnostics.push(
            schemaError(
              `${localePath}.cast[${index}]`,
              `${entry.characterId} is cast twice.`,
            ),
          );
          return;
        }
        seen.add(entry.characterId);
        cast.push(entry);
      });
      locales.set(locale, {
        locale,
        model: String(value.model),
        languageTextNormalization: normalization === true,
        cast,
      });
    }
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, value: { schemaVersion: 1, locales } };
}

/** The cast entries for a locale that may receive clips, keyed by speaker. */
export function approvedCastBySpeaker(
  cast: LocaleCast | undefined,
): Map<string, CastEntry> {
  const out = new Map<string, CastEntry>();
  for (const entry of cast?.cast ?? []) {
    if (entry.status !== "approved" || entry.voiceId === null) continue;
    for (const speaker of entry.speakers) out.set(speaker, entry);
  }
  return out;
}
