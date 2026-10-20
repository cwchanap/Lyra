import { basename } from "node:path";
import YAML from "yaml";
import { DEFAULT_EXPRESSION } from "@lyra/dialogue-locale";
import { LINE_ID_PATTERN } from "../compile-scenes/line-ids";
import type {
  LocaleScriptFile,
  LocaleScriptLine,
  LocaleScriptVoice,
  VoiceDiagnostic,
} from "./types";

export const STORY_ROOT = "docs/stories_plan";
export const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;

const ROOT_KEYS = new Set([
  "schemaVersion",
  "locale",
  "source",
  "lines",
  "stale",
]);
const LINE_KEYS = new Set([
  "id",
  "speaker",
  "expression",
  "zh",
  "ja",
  "note",
  "voice",
]);
const VOICE_KEYS = [
  "clip",
  "direction",
  "tts",
  "ttsHash",
  "generatedAt",
] as const;
/** Clip IDs become file names, so they are lowercase slugs. */
export const VOICE_CLIP_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; diagnostics: VoiceDiagnostic[] };

/** `docs/stories_plan/chapter_1/ja` */
export function localeScriptDir(chapterId: string, locale: string): string {
  return `${STORY_ROOT}/${chapterId}/${locale}`;
}

/** `scene_5.md` -> `docs/stories_plan/chapter_1/ja/scene_5.ja.yaml` */
export function localeScriptPath(
  chapterId: string,
  sceneFile: string,
  locale: string,
): string {
  return `${localeScriptDir(chapterId, locale)}/${sceneFile.replace(/\.md$/, "")}.${locale}.yaml`;
}

/** `scene_5.ja.yaml` -> `scene_5.md`, or null for a non-script file name. */
export function sceneFileForScriptName(
  fileName: string,
  locale: string,
): string | null {
  const suffix = `.${locale}.yaml`;
  const name = basename(fileName);
  if (!name.endsWith(suffix) || name.length === suffix.length) return null;
  return `${name.slice(0, -suffix.length)}.md`;
}

export function sceneSourcePath(chapterId: string, sceneFile: string): string {
  return `${STORY_ROOT}/${chapterId}/${sceneFile}`;
}

function error(path: string, code: string, message: string): VoiceDiagnostic {
  return { severity: "error", code, message, path };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseVoice(
  raw: unknown,
  path: string,
  diagnostics: VoiceDiagnostic[],
): LocaleScriptVoice | null {
  if (!isRecord(raw)) {
    diagnostics.push(
      error(path, "localeScriptSchema", "`voice` must be a mapping."),
    );
    return null;
  }
  const before = diagnostics.length;
  const known = new Set<string>(VOICE_KEYS);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      diagnostics.push(
        error(path, "localeScriptSchema", `Unknown voice field "${key}".`),
      );
    }
  }
  if (typeof raw.clip !== "string" || !VOICE_CLIP_PATTERN.test(raw.clip)) {
    diagnostics.push(
      error(
        path,
        "localeScriptSchema",
        "`voice.clip` must be a lowercase slug such as ch1_soma_ritsu_0001.",
      ),
    );
  }
  for (const key of VOICE_KEYS) {
    const value = raw[key];
    if (key === "clip" || value === undefined) continue;
    if (typeof value !== "string" || value.length === 0) {
      diagnostics.push(
        error(
          path,
          "localeScriptSchema",
          `\`voice.${key}\` must be a non-empty string when present.`,
        ),
      );
    }
  }
  if (diagnostics.length > before) return null;

  const voice: LocaleScriptVoice = { clip: raw.clip as string };
  for (const key of VOICE_KEYS) {
    const value = raw[key];
    if (key !== "clip" && typeof value === "string") voice[key] = value;
  }
  return voice;
}

function parseLine(
  raw: unknown,
  path: string,
  diagnostics: VoiceDiagnostic[],
): LocaleScriptLine | null {
  if (!isRecord(raw)) {
    diagnostics.push(
      error(path, "localeScriptSchema", "Each line must be a mapping."),
    );
    return null;
  }
  const before = diagnostics.length;
  for (const key of Object.keys(raw)) {
    if (!LINE_KEYS.has(key)) {
      diagnostics.push(
        error(path, "localeScriptSchema", `Unknown line field "${key}".`),
      );
    }
  }
  const { id, speaker, expression, zh, ja, note, voice } = raw;
  if (typeof id !== "string" || !LINE_ID_PATTERN.test(id)) {
    diagnostics.push(
      error(
        path,
        "localeScriptSchema",
        "`id` must be the scene line's ID, such as L012.",
      ),
    );
  }
  if (typeof speaker !== "string" || speaker.length === 0) {
    diagnostics.push(
      error(
        path,
        "localeScriptSchema",
        "`speaker` must be a non-empty string.",
      ),
    );
  }
  if (typeof zh !== "string" || zh.length === 0) {
    diagnostics.push(
      error(path, "localeScriptSchema", "`zh` must be a non-empty string."),
    );
  }
  if (typeof ja !== "string") {
    diagnostics.push(
      error(
        path,
        "localeScriptSchema",
        '`ja` must be a string (use "" when untranslated).',
      ),
    );
  }
  if (expression !== undefined) {
    if (typeof expression !== "string" || expression.length === 0) {
      diagnostics.push(
        error(
          path,
          "localeScriptSchema",
          "`expression` must be a non-empty string when present.",
        ),
      );
    } else if (expression === DEFAULT_EXPRESSION) {
      diagnostics.push(
        error(
          path,
          "localeScriptSchema",
          `Omit \`expression\` for "${DEFAULT_EXPRESSION}"; it is the default.`,
        ),
      );
    }
  }
  if (note !== undefined && typeof note !== "string") {
    diagnostics.push(
      error(
        path,
        "localeScriptSchema",
        "`note` must be a string when present.",
      ),
    );
  }
  const parsedVoice =
    voice === undefined ? undefined : parseVoice(voice, path, diagnostics);
  if (diagnostics.length > before) return null;

  const line: LocaleScriptLine = {
    id: id as string,
    speaker: speaker as string,
    zh: zh as string,
    ja: ja as string,
  };
  if (typeof expression === "string") line.expression = expression;
  if (typeof note === "string") line.note = note;
  if (parsedVoice) line.voice = parsedVoice;
  return line;
}

function parseLineList(
  raw: unknown,
  field: string,
  path: string,
  diagnostics: VoiceDiagnostic[],
): LocaleScriptLine[] {
  if (!Array.isArray(raw)) {
    diagnostics.push(
      error(path, "localeScriptSchema", `\`${field}\` must be a list.`),
    );
    return [];
  }
  const lines: LocaleScriptLine[] = [];
  raw.forEach((item, index) => {
    const line = parseLine(item, `${path}#${field}[${index}]`, diagnostics);
    if (line) lines.push(line);
  });
  return lines;
}

export function parseLocaleScriptText(
  text: string,
  path: string,
): ParseResult<LocaleScriptFile> {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (cause) {
    return {
      ok: false,
      diagnostics: [
        error(
          path,
          "localeScriptYaml",
          `Invalid YAML: ${cause instanceof Error ? cause.message : String(cause)}`,
        ),
      ],
    };
  }
  if (!isRecord(raw)) {
    return {
      ok: false,
      diagnostics: [
        error(path, "localeScriptSchema", "A locale script must be a mapping."),
      ],
    };
  }

  const diagnostics: VoiceDiagnostic[] = [];
  for (const key of Object.keys(raw)) {
    if (!ROOT_KEYS.has(key)) {
      diagnostics.push(
        error(path, "localeScriptSchema", `Unknown top-level field "${key}".`),
      );
    }
  }
  if (raw.schemaVersion !== 1) {
    diagnostics.push(
      error(path, "localeScriptSchema", "`schemaVersion` must be 1."),
    );
  }
  if (typeof raw.locale !== "string" || !LOCALE_PATTERN.test(raw.locale)) {
    diagnostics.push(
      error(path, "localeScriptSchema", "`locale` must be a code such as ja."),
    );
  }
  if (typeof raw.source !== "string" || raw.source.length === 0) {
    diagnostics.push(
      error(
        path,
        "localeScriptSchema",
        "`source` must be a repo-relative path.",
      ),
    );
  }
  const lines = parseLineList(raw.lines, "lines", path, diagnostics);
  const stale =
    raw.stale === undefined
      ? []
      : parseLineList(raw.stale, "stale", path, diagnostics);

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      locale: raw.locale as string,
      source: raw.source as string,
      lines,
      stale,
    },
  };
}

function orderedVoice(voice: LocaleScriptVoice): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of VOICE_KEYS) {
    const value = voice[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function orderedLine(line: LocaleScriptLine): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: line.id,
    speaker: line.speaker,
  };
  if (line.expression !== undefined) out.expression = line.expression;
  out.zh = line.zh;
  out.ja = line.ja;
  if (line.note !== undefined) out.note = line.note;
  if (line.voice !== undefined) out.voice = orderedVoice(line.voice);
  return out;
}

export function serializeLocaleScript(file: LocaleScriptFile): string {
  const body: Record<string, unknown> = {
    schemaVersion: file.schemaVersion,
    locale: file.locale,
    source: file.source,
    lines: file.lines.map(orderedLine),
  };
  if (file.stale.length > 0) body.stale = file.stale.map(orderedLine);
  const header = [
    `# ${file.locale} script for ${file.source}.`,
    "# Each entry is linked to its scene line by `id` (the line's {#L012} tag);",
    "# `speaker`, `expression` and `zh` record what was translated. Edit `ja`,",
    "# `note`, `voice.direction` and `voice.tts` only. After the scene changes, run",
    "# `bun run voice:sync <chapter>`, then `bun run voice:validate <chapter>`.",
  ].join("\n");
  return `${header}\n${YAML.stringify(body, { lineWidth: 0 })}`;
}
