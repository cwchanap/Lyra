import YAML from "yaml";
import type { SoundPlanDiagnostic, SoundPlanEntry } from "./types";
const CHANNELS = ["bgm", "bgs", "sfx"] as const;
const CHANNEL_SET = new Set<string>(CHANNELS);
const ID_RE = /^[a-z0-9_]+$/;

export type AudioCatalogEntry = {
  prompt: string;
  loop: boolean;
};

export type AudioCatalog = {
  bgm: Record<string, AudioCatalogEntry>;
  bgs: Record<string, AudioCatalogEntry>;
  sfx: Record<string, AudioCatalogEntry>;
};

export type ParseAudioCatalogResult =
  | { ok: true; value: AudioCatalog }
  | { ok: false; diagnostics: SoundPlanDiagnostic[] };

export function parseAudioCatalogText(
  text: string,
  path: string,
): ParseAudioCatalogResult {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "audioCatalogYamlInvalid",
          path,
          message: `${path}: ${(error as Error).message}`,
        },
      ],
    };
  }

  if (!isRecord(raw)) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "audioCatalogRootInvalid",
          path,
          message: "Audio catalog root must be a YAML object.",
        },
      ],
    };
  }

  const diagnostics: SoundPlanDiagnostic[] = [];
  for (const key of Object.keys(raw)) {
    if (CHANNEL_SET.has(key)) continue;
    diagnostics.push({
      code: "audioCatalogTopLevelKeyUnsupported",
      path: key,
      message: `Unsupported audio catalog channel "${key}". Expected bgm, bgs, or sfx.`,
    });
  }

  const catalog: AudioCatalog = { bgm: {}, bgs: {}, sfx: {} };
  for (const channel of CHANNELS) {
    if (!hasOwn(raw, channel)) continue;
    const channelMap = raw[channel];
    if (!isRecord(channelMap)) {
      diagnostics.push({
        code: "audioCatalogChannelInvalid",
        path: channel,
        message: `Audio catalog channel "${channel}" must be an object map.`,
      });
      continue;
    }
    catalog[channel] = parseChannelMap(channel, channelMap, diagnostics);
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    value: catalog,
  };
}

export function serializeAudioCatalog(catalog: AudioCatalog): string {
  return YAML.stringify({
    bgm: sortCatalogMap(catalog.bgm),
    bgs: sortCatalogMap(catalog.bgs),
    sfx: sortCatalogMap(catalog.sfx),
  });
}

/**
 * Normalize serialized catalog YAML through Prettier so the output matches the
 * canonical on-disk form. This matters because `serializeAudioCatalog` emits
 * plain scalars that Prettier reformats to block scalars; without this step,
 * `audio:apply --check` always reports drift (exit 2) even when the catalog
 * content is correct, because the textual representation differs.
 *
 * The returned text is a fixed point of Prettier — running Prettier again
 * produces identical output — so `--check` only reports drift when the merged
 * catalog content genuinely differs from what is on disk.
 */
export async function formatAudioCatalogYaml(text: string): Promise<string> {
  const { format } = await import("prettier");
  return format(text, { parser: "yaml" });
}

export function mergeApprovedEntriesIntoCatalog(
  catalog: AudioCatalog,
  entries: SoundPlanEntry[],
): { catalog: AudioCatalog; diagnostics: SoundPlanDiagnostic[] } {
  const next: AudioCatalog = {
    bgm: cloneCatalogMap(catalog.bgm),
    bgs: cloneCatalogMap(catalog.bgs),
    sfx: cloneCatalogMap(catalog.sfx),
  };
  const diagnostics: SoundPlanDiagnostic[] = [];

  for (const [index, entry] of entries.entries()) {
    if (entry.status !== "approved" && entry.status !== "generated") continue;
    const target = next[entry.channel];
    const current = target[entry.id];
    const incoming = { prompt: entry.prompt, loop: entry.loop };
    if (current) {
      if (
        current.prompt !== incoming.prompt ||
        current.loop !== incoming.loop
      ) {
        diagnostics.push({
          code: "audioCatalogDuplicateConflict",
          path: `entries[${index}].${entry.channel}.${entry.id}`,
          message: `Catalog entry ${entry.channel}.${entry.id} conflicts with entries[${index}]: ${describeEntryDiff(
            current,
            incoming,
          )}.`,
        });
      }
      continue;
    }
    target[entry.id] = incoming;
  }

  return { catalog: next, diagnostics };
}

function parseChannelMap(
  channel: keyof AudioCatalog,
  raw: Record<string, unknown>,
  diagnostics: SoundPlanDiagnostic[],
): Record<string, AudioCatalogEntry> {
  const out: Record<string, AudioCatalogEntry> = {};
  for (const [id, value] of Object.entries(raw)) {
    const path = `${channel}.${id}`;
    let valid = true;
    if (!ID_RE.test(id)) {
      diagnostics.push({
        code: "audioCatalogIdInvalid",
        path,
        message: `Audio catalog ID "${id}" must be snake_case.`,
      });
      valid = false;
    }
    if (!isRecord(value)) {
      diagnostics.push({
        code: "audioCatalogEntryInvalid",
        path,
        message: `Audio catalog entry ${path} must be an object.`,
      });
      continue;
    }
    if (typeof value.prompt !== "string") {
      diagnostics.push({
        code: "audioCatalogPromptInvalid",
        path: `${path}.prompt`,
        message: `Audio catalog entry ${path} must define a string prompt.`,
      });
      valid = false;
    }
    if (typeof value.loop !== "boolean") {
      diagnostics.push({
        code: "audioCatalogLoopInvalid",
        path: `${path}.loop`,
        message: `Audio catalog entry ${path} must define a boolean loop.`,
      });
      valid = false;
    }
    if (!valid) continue;
    // `valid` is true only when the typeof guards above established that
    // value.prompt is a string and value.loop is a boolean. TS cannot track
    // the flag back to those guards, so assert the narrowed types here.
    out[id] = {
      prompt: value.prompt as string,
      loop: value.loop as boolean,
    };
  }
  return out;
}

function cloneCatalogMap(
  entries: Record<string, AudioCatalogEntry>,
): Record<string, AudioCatalogEntry> {
  return Object.fromEntries(
    Object.entries(entries).map(([id, entry]) => [
      id,
      { prompt: entry.prompt, loop: entry.loop },
    ]),
  );
}

function sortCatalogMap(
  entries: Record<string, AudioCatalogEntry>,
): Record<string, AudioCatalogEntry> {
  return Object.fromEntries(
    Object.entries(entries)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, entry]) => [id, { prompt: entry.prompt, loop: entry.loop }]),
  );
}

function describeEntryDiff(
  current: AudioCatalogEntry,
  incoming: AudioCatalogEntry,
): string {
  const diffs: string[] = [];
  if (current.prompt !== incoming.prompt) {
    diffs.push(
      `prompt differs (existing ${formatValue(
        current.prompt,
      )}, incoming ${formatValue(incoming.prompt)})`,
    );
  }
  if (current.loop !== incoming.loop) {
    diffs.push(
      `loop differs (existing ${formatValue(
        current.loop,
      )}, incoming ${formatValue(incoming.loop)})`,
    );
  }
  return diffs.join("; ");
}

function formatValue(value: string | boolean): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function hasOwn(
  value: Record<string, unknown>,
  key: string,
): value is Record<string, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
