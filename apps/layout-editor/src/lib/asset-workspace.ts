// =============================================================================
// apps/layout-editor/src/lib/asset-workspace.ts
//
// Base projection for the Assets workbench: turns the Rust
// `load_asset_workspace` snapshot into the editor's workspace model.
//
// Config catalogs are parsed with the compiler's browser-safe shared parser
// (@lyra/scripts config-catalog) so normalization cannot drift; compiler-only
// validity policy is NOT run here — parse/shape problems surface as read
// diagnostics. Library rows are the compiler-generated manifest entries
// verbatim (no recomputed paths/prompts), and manifest-driven usage joins use
// the typed `source` fields only — the editor never reconstructs asset id
// strings like `audio.<channel>.<id>`.
// =============================================================================

import { portraitAssetId } from "@lyra/asset-paths";
import {
  expectedPath,
  publicPath,
  type AssetManifest,
  type AssetManifestEntry,
} from "@lyra/scripts/compile-scenes/assets/manifest";
import {
  parseAudioYamlText,
  parseCharactersYamlText,
  type AudioChannel,
  type AudioConfigEntry,
  type CharacterExpressionConfig,
  type ParsedAudioCatalog,
  type ParsedCharacterCatalog,
} from "@lyra/scripts/compile-scenes/assets/config-catalog";
import type { AssetReport } from "@lyra/scripts/compile-scenes/orchestrator";
import type { CompileError } from "@lyra/scripts/compile-scenes/types";
import type { WorkbenchAssetWorkspacePayload } from "./workbench-types";

export type AssetCharacterExpressionRow = {
  characterId: string;
  expressionId: string;
  /** Shared identity: portraitAssetId(characterId, expressionId). */
  assetId: string;
  /** Compiler-expected disk path (repo-relative `static/...`). */
  expectedPath: string;
  /** Compiler public URL path. */
  publicPath: string;
  /** Catalog prompt — the canonical source for expressions with no manifest entry. */
  prompt: string;
  /** Manifest references via typed portrait source fields. */
  usages: number;
  referenced: boolean;
};

export type AssetCharacterRow = {
  id: string;
  displayNames: string[];
  portraitMode: "portrait" | "none";
  visualPrompt: string | null;
  referenceAssetId: string | null;
  expressions: AssetCharacterExpressionRow[];
};

export type AssetAudioRow = {
  channel: AudioChannel;
  id: string;
  prompt: string;
  loop: boolean;
  /** Manifest references joined by (channel, id) — never by id alone. */
  usages: number;
  referenced: boolean;
};

/** Read diagnostics from parsing the authored config sources. */
export type AssetWorkspaceDiagnostic = CompileError;

export type AssetWorkspace = {
  manifest: AssetManifest;
  report: AssetReport;
  /** Manifest-driven base rows: compiler-generated values, verbatim. */
  library: AssetManifestEntry[];
  characters: AssetCharacterRow[];
  audio: { bgm: AssetAudioRow[]; bgs: AssetAudioRow[]; sfx: AssetAudioRow[] };
  diagnostics: AssetWorkspaceDiagnostic[];
  scenes: WorkbenchAssetWorkspacePayload["scenes"];
  /** Presence-only list of asset files under static/assets. */
  existingAssetPaths: WorkbenchAssetWorkspacePayload["existingAssetPaths"];
};

export function projectAssetWorkspace(
  payload: WorkbenchAssetWorkspacePayload,
): AssetWorkspace {
  const characters = parseCharactersYamlText(
    payload.configSources.characters.content,
    payload.configSources.characters.path,
  );
  const audio = parseAudioYamlText(
    payload.configSources.audio.content,
    payload.configSources.audio.path,
  );
  const portraitUsages = countPortraitUsages(payload.manifest);
  const audioUsages = countAudioUsages(payload.manifest);
  return {
    manifest: payload.manifest,
    report: payload.report,
    library: payload.manifest.entries,
    characters: characterRows(characters, portraitUsages),
    audio: audioRows(audio, audioUsages),
    diagnostics: [
      ...catalogDiagnostics(characters),
      ...catalogDiagnostics(audio),
    ],
    scenes: payload.scenes,
    existingAssetPaths: payload.existingAssetPaths,
  };
}

// ---- usage joins (typed manifest sources only) ------------------------------

function countPortraitUsages(manifest: AssetManifest): Map<string, number> {
  const usages = new Map<string, number>();
  for (const entry of manifest.entries) {
    if (entry.type !== "portrait") continue;
    const key = `${entry.source.characterId}\u0000${entry.source.expression}`;
    usages.set(key, (usages.get(key) ?? 0) + 1);
  }
  return usages;
}

function countAudioUsages(
  manifest: AssetManifest,
): Map<AudioChannel, Map<string, number>> {
  const usages = new Map<AudioChannel, Map<string, number>>();
  for (const entry of manifest.entries) {
    if (entry.type !== "audio") continue;
    let byId = usages.get(entry.source.channel);
    if (!byId) {
      byId = new Map();
      usages.set(entry.source.channel, byId);
    }
    byId.set(entry.source.id, (byId.get(entry.source.id) ?? 0) + 1);
  }
  return usages;
}

// ---- projections -------------------------------------------------------------

function characterRows(
  parsed: ParsedCharacterCatalog,
  usages: Map<string, number>,
): AssetCharacterRow[] {
  if (!parsed.ok) return [];
  return parsed.characters
    .filter((entry) => !entry.malformed)
    .map((entry) => ({
      id: entry.id,
      displayNames: entry.displayNames,
      portraitMode: entry.portraitMode,
      visualPrompt: entry.visualPrompt,
      referenceAssetId: entry.referenceAssetId,
      expressions: [...entry.expressions.values()].map((expression) =>
        expressionRow(entry.id, expression, usages),
      ),
    }));
}

function expressionRow(
  characterId: string,
  expression: CharacterExpressionConfig,
  usages: Map<string, number>,
): AssetCharacterExpressionRow {
  const assetId = portraitAssetId(characterId, expression.id);
  const count = usages.get(`${characterId}\u0000${expression.id}`) ?? 0;
  return {
    characterId,
    expressionId: expression.id,
    assetId,
    expectedPath: expectedPath(assetId, "portrait"),
    publicPath: publicPath(assetId, "portrait"),
    prompt: expression.prompt,
    usages: count,
    referenced: count > 0,
  };
}

function audioRows(
  parsed: ParsedAudioCatalog,
  usages: Map<AudioChannel, Map<string, number>>,
): AssetWorkspace["audio"] {
  const channels: Record<AudioChannel, Map<string, AudioConfigEntry>> = {
    bgm: new Map(),
    bgs: new Map(),
    sfx: new Map(),
  };
  if (parsed.ok) {
    channels.bgm = parsed.audio.bgm;
    channels.bgs = parsed.audio.bgs;
    channels.sfx = parsed.audio.sfx;
  }
  const build = (channel: AudioChannel): AssetAudioRow[] =>
    [...channels[channel].values()].map((entry) => {
      const count = usages.get(channel)?.get(entry.id) ?? 0;
      return {
        channel,
        id: entry.id,
        prompt: entry.prompt,
        loop: entry.loop,
        usages: count,
        referenced: count > 0,
      };
    });
  return { bgm: build("bgm"), bgs: build("bgs"), sfx: build("sfx") };
}

function catalogDiagnostics(
  parsed: ParsedCharacterCatalog | ParsedAudioCatalog,
): CompileError[] {
  if (!parsed.ok) return parsed.errors;
  if ("characters" in parsed) {
    return [
      ...parsed.errors,
      ...parsed.characters.flatMap((entry) => [
        ...entry.errors,
        ...entry.warnings,
      ]),
    ];
  }
  return [...parsed.errors, ...parsed.warnings];
}
