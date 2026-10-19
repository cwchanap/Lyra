import YAML from "yaml";
import { LOCALE_PATTERN, STORY_ROOT, type ParseResult } from "./locale-script";
import type { LocaleGlossary, VoiceDiagnostic } from "./types";

/** `docs/stories_plan/ja_glossary.yaml` */
export function glossaryPath(locale: string): string {
  return `${STORY_ROOT}/${locale}_glossary.yaml`;
}

const ROOT_KEYS = new Set([
  "schemaVersion",
  "locale",
  "styleRules",
  "characters",
  "terms",
]);
const CHARACTER_KEYS = new Set([
  "zh",
  "ja",
  "reading",
  "firstPerson",
  "register",
]);
const TERM_KEYS = new Set(["zh", "ja", "reading", "note"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaError(path: string, message: string): VoiceDiagnostic {
  return { severity: "error", code: "localeGlossarySchema", message, path };
}

function readStrings<K extends string>(
  raw: Record<string, unknown>,
  allowed: Set<string>,
  required: readonly K[],
  path: string,
  diagnostics: VoiceDiagnostic[],
): Record<string, string> | null {
  const before = diagnostics.length;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.has(key)) {
      diagnostics.push(schemaError(path, `Unknown field "${key}".`));
    } else if (typeof value !== "string" || value.length === 0) {
      diagnostics.push(
        schemaError(path, `\`${key}\` must be a non-empty string.`),
      );
    } else {
      out[key] = value;
    }
  }
  for (const key of required) {
    if (raw[key] === undefined) {
      diagnostics.push(schemaError(path, `\`${key}\` is required.`));
    }
  }
  return diagnostics.length > before ? null : out;
}

type GlossaryEntry = { zh: string; ja: string } & Record<string, string>;

function readEntries(
  list: unknown,
  field: string,
  allowed: Set<string>,
  path: string,
  diagnostics: VoiceDiagnostic[],
): GlossaryEntry[] {
  if (!Array.isArray(list)) {
    diagnostics.push(schemaError(path, `\`${field}\` must be a list.`));
    return [];
  }
  const entries: GlossaryEntry[] = [];
  const seen = new Set<string>();
  list.forEach((item, index) => {
    const itemPath = `${path}#${field}[${index}]`;
    if (!isRecord(item)) {
      diagnostics.push(schemaError(itemPath, "Must be a mapping."));
      return;
    }
    const entry = readStrings(
      item,
      allowed,
      ["zh", "ja"],
      itemPath,
      diagnostics,
    );
    const zh = entry?.zh;
    const ja = entry?.ja;
    if (!entry || zh === undefined || ja === undefined) return;
    if (seen.has(zh)) {
      diagnostics.push(schemaError(itemPath, `Duplicate \`zh\` "${zh}".`));
      return;
    }
    seen.add(zh);
    entries.push({ ...entry, zh, ja });
  });
  return entries;
}

export function parseGlossaryText(
  text: string,
  path: string,
): ParseResult<LocaleGlossary> {
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
      diagnostics: [schemaError(path, "A glossary must be a mapping.")],
    };
  }

  const diagnostics: VoiceDiagnostic[] = [];
  for (const key of Object.keys(raw)) {
    if (!ROOT_KEYS.has(key)) {
      diagnostics.push(schemaError(path, `Unknown top-level field "${key}".`));
    }
  }
  if (raw.schemaVersion !== 1) {
    diagnostics.push(schemaError(path, "`schemaVersion` must be 1."));
  }
  if (typeof raw.locale !== "string" || !LOCALE_PATTERN.test(raw.locale)) {
    diagnostics.push(schemaError(path, "`locale` must be a code such as ja."));
  }

  const styleRules: string[] = [];
  if (!Array.isArray(raw.styleRules)) {
    diagnostics.push(schemaError(path, "`styleRules` must be a list."));
  } else {
    raw.styleRules.forEach((rule, index) => {
      if (typeof rule === "string" && rule.length > 0) styleRules.push(rule);
      else
        diagnostics.push(
          schemaError(
            `${path}#styleRules[${index}]`,
            "Must be a non-empty string.",
          ),
        );
    });
  }

  const characters = readEntries(
    raw.characters,
    "characters",
    CHARACTER_KEYS,
    path,
    diagnostics,
  );
  const terms = readEntries(raw.terms, "terms", TERM_KEYS, path, diagnostics);

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      locale: raw.locale as string,
      styleRules,
      characters,
      terms,
    },
  };
}
