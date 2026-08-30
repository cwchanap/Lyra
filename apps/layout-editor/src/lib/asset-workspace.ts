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
import type {
  AudioCue,
  CompileError,
} from "@lyra/scripts/compile-scenes/types";
import { projectReaderScene, ReaderProjectionError } from "./reader-projection";
import type {
  ReaderPresentationFact,
  WorkbenchAssetWorkspacePayload,
} from "./workbench-types";

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

/**
 * One concrete asset reference projected from Reader presentation facts.
 * `type` is the manifest entry type after the assetId join; `null` means the
 * generated manifest has no entry (surfaced as an unresolved diagnostic).
 */
export type AssetSceneUsage = {
  chapterId: string;
  sceneId: string;
  carrierId: string;
  role: "background" | "portrait" | "evidence" | "sprite";
  /** Item index inside the carrier for dialogue facts; null otherwise. */
  itemIndex: number | null;
  assetId: string;
  type: AssetManifestEntry["type"] | null;
};

/**
 * Per-cue BGM/BGS delta preserving the compiler's tri-state cue semantics:
 * null cue = inherit, `{ assetId: null }` = stop, concrete id = set.
 */
export type AssetSceneAudioDelta = {
  chapterId: string;
  sceneId: string;
  carrierId: string;
  itemIndex: number | null;
  channel: "bgm" | "bgs";
  state: "inherit" | "stop" | "set";
  assetId: string | null;
};

export type AssetWorkspace = {
  manifest: AssetManifest;
  report: AssetReport;
  /** Manifest-driven base rows: compiler-generated values, verbatim. */
  library: AssetManifestEntry[];
  characters: AssetCharacterRow[];
  audio: { bgm: AssetAudioRow[]; bgs: AssetAudioRow[]; sfx: AssetAudioRow[] };
  diagnostics: AssetWorkspaceDiagnostic[];
  /** Concrete per-scene asset usages joined against the manifest. */
  sceneUsages: AssetSceneUsage[];
  /** Per-cue BGM/BGS deltas with inherit/stop/set semantics preserved. */
  sceneAudioDeltas: AssetSceneAudioDelta[];
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
  const sceneProjection = projectSceneUsages(payload);
  return {
    manifest: payload.manifest,
    report: payload.report,
    library: payload.manifest.entries,
    characters: characterRows(characters, portraitUsages),
    audio: audioRows(audio, audioUsages),
    diagnostics: [
      ...catalogDiagnostics(characters),
      ...catalogDiagnostics(audio),
      ...sceneProjection.diagnostics,
    ],
    sceneUsages: sceneProjection.usages,
    sceneAudioDeltas: sceneProjection.audioDeltas,
    scenes: payload.scenes,
    existingAssetPaths: payload.existingAssetPaths,
  };
}

// ---- scene usage projection (Reader presentation facts only) ----------------

/**
 * Projects per-scene asset usages from `projectReaderScene().presentation`
 * for every snapshot scene. The Reader walk is the only scene walker: this
 * never switches on the scene shape and never derives carrier IDs itself —
 * facts already carry the existing Reader carrier IDs and item indexes.
 */
function projectSceneUsages(payload: WorkbenchAssetWorkspacePayload): {
  usages: AssetSceneUsage[];
  audioDeltas: AssetSceneAudioDelta[];
  diagnostics: AssetWorkspaceDiagnostic[];
} {
  const manifestTypeByAssetId = new Map<string, AssetManifestEntry["type"]>();
  for (const entry of payload.manifest.entries) {
    if (!manifestTypeByAssetId.has(entry.assetId)) {
      manifestTypeByAssetId.set(entry.assetId, entry.type);
    }
  }

  const usages = new Map<string, AssetSceneUsage>();
  const audioDeltas: AssetSceneAudioDelta[] = [];
  const diagnostics: AssetWorkspaceDiagnostic[] = [];

  for (const snapshot of payload.scenes) {
    let facts: ReaderPresentationFact[];
    try {
      facts = projectReaderScene(
        snapshot.chapterId,
        snapshot.sourcePath,
        snapshot.scene,
      ).presentation;
    } catch (error) {
      // A strict Reader completeness failure is a read diagnostic here, not a
      // workbench crash — the snapshot is compiler output, so this indicates
      // compiler/editor drift that the workbench should display.
      if (!(error instanceof ReaderProjectionError)) throw error;
      diagnostics.push({
        code: error.code,
        message: `${snapshot.sceneId}: ${error.message}`,
        sourceFile: snapshot.sourcePath,
        line: 0,
      });
      continue;
    }

    const resolveType = (assetId: string): AssetManifestEntry["type"] | null =>
      manifestTypeByAssetId.get(assetId) ?? null;
    const noteUnresolved = (description: string, assetId: string): void => {
      diagnostics.push({
        code: "assetUsageUnresolved",
        message: `${snapshot.chapterId}/${snapshot.sceneId} ${description} references "${assetId}" but the generated asset manifest has no entry for it.`,
        sourceFile: snapshot.sourcePath,
        line: 0,
      });
    };
    const addUsage = (
      fact: ReaderPresentationFact,
      role: AssetSceneUsage["role"],
      itemIndex: number | null,
      assetId: string,
    ): void => {
      // Deterministic dedupe: one row per (chapter, scene, carrier, role,
      // item index, asset). Different item indexes keep distinct rows so
      // repeated identical occurrences never collapse.
      const key = [
        snapshot.chapterId,
        snapshot.sceneId,
        fact.carrierId,
        role,
        itemIndex === null ? "" : String(itemIndex),
        assetId,
      ].join("\u0000");
      if (usages.has(key)) return;
      const type = resolveType(assetId);
      usages.set(key, {
        chapterId: snapshot.chapterId,
        sceneId: snapshot.sceneId,
        carrierId: fact.carrierId,
        role,
        itemIndex,
        assetId,
        type,
      });
      if (type === null) {
        noteUnresolved(`${role} usage at carrier "${fact.carrierId}"`, assetId);
      }
    };
    const addAudioDelta = (
      fact: ReaderPresentationFact,
      itemIndex: number | null,
      channel: "bgm" | "bgs",
      cue: AudioCue | null,
    ): void => {
      const state: AssetSceneAudioDelta["state"] =
        cue === null ? "inherit" : cue.assetId === null ? "stop" : "set";
      audioDeltas.push({
        chapterId: snapshot.chapterId,
        sceneId: snapshot.sceneId,
        carrierId: fact.carrierId,
        itemIndex,
        channel,
        state,
        assetId: cue?.assetId ?? null,
      });
      if (
        cue !== null &&
        cue.assetId !== null &&
        resolveType(cue.assetId) === null
      ) {
        noteUnresolved(
          `${channel} cue at carrier "${fact.carrierId}"`,
          cue.assetId,
        );
      }
    };

    for (const fact of facts) {
      switch (fact.kind) {
        case "dialogueAssetCue":
          if (fact.cue.backgroundAssetId !== null) {
            addUsage(
              fact,
              "background",
              fact.itemIndex,
              fact.cue.backgroundAssetId,
            );
          }
          addAudioDelta(fact, fact.itemIndex, "bgm", fact.cue.bgm);
          addAudioDelta(fact, fact.itemIndex, "bgs", fact.cue.bgs);
          break;
        case "dialoguePortrait":
          addUsage(fact, "portrait", fact.itemIndex, fact.portrait.assetId);
          break;
        case "structuralVisualCue":
          if (fact.backgroundAssetId !== null) {
            addUsage(fact, "background", null, fact.backgroundAssetId);
          }
          addAudioDelta(fact, null, "bgm", fact.bgm);
          addAudioDelta(fact, null, "bgs", fact.bgs);
          break;
        case "subjectPortrait":
          addUsage(fact, "portrait", null, fact.portrait.assetId);
          break;
        case "evidenceImage":
          addUsage(fact, "evidence", null, fact.imageAssetId);
          break;
        case "sprite":
          // Raw sprite asset ID; the manifest join above resolves the asset
          // kind (standee/portrait/evidence/background all work).
          addUsage(fact, "sprite", null, fact.assetId);
          break;
      }
    }
  }

  // Map iteration preserves insertion order — deterministic output.
  return { usages: [...usages.values()], audioDeltas, diagnostics };
}

// ---- scene cue display rows (shared presentation helper) -------------------

/**
 * One authored-order presentation row for the Assets Scene cues panel: a
 * `ReaderPresentationFact` reshaped for display, with the manifest join
 * applied (`type: null` = unresolved, surfaced as a read diagnostic elsewhere).
 */
export type AssetSceneCueRow =
  | {
      kind: "visualCue";
      carrierId: string;
      /** Dialogue-item index inside the carrier; null for structural carriers. */
      itemIndex: number | null;
      background: {
        assetId: string;
        type: AssetManifestEntry["type"] | null;
      } | null;
      bgm: { state: AssetSceneAudioDelta["state"]; assetId: string | null };
      bgs: { state: AssetSceneAudioDelta["state"]; assetId: string | null };
    }
  | {
      kind: "portrait";
      carrierId: string;
      itemIndex: number | null;
      assetId: string;
      type: AssetManifestEntry["type"] | null;
    }
  | {
      kind: "evidence";
      carrierId: string;
      itemIndex: null;
      assetId: string;
      type: AssetManifestEntry["type"] | null;
    }
  | {
      kind: "sprite";
      carrierId: string;
      itemIndex: null;
      assetId: string;
      type: AssetManifestEntry["type"] | null;
    };

/**
 * Ordered Scene-cues rows for one snapshot scene: the single Reader walk's
 * presentation facts in authored order with the manifest join applied. A
 * strict Reader completeness failure returns no rows — the workspace
 * diagnostics already surface it as a read diagnostic.
 */
export function sceneCueRows(
  workspace: AssetWorkspace,
  chapterId: string,
  sceneId: string,
): AssetSceneCueRow[] {
  const snapshot = workspace.scenes.find(
    (scene) => scene.chapterId === chapterId && scene.sceneId === sceneId,
  );
  if (!snapshot) return [];
  let facts: ReaderPresentationFact[];
  try {
    facts = projectReaderScene(
      snapshot.chapterId,
      snapshot.sourcePath,
      snapshot.scene,
    ).presentation;
  } catch (error) {
    if (!(error instanceof ReaderProjectionError)) throw error;
    return [];
  }

  const typeByAssetId = new Map<string, AssetManifestEntry["type"]>();
  for (const entry of workspace.manifest.entries) {
    if (!typeByAssetId.has(entry.assetId)) {
      typeByAssetId.set(entry.assetId, entry.type);
    }
  }
  const resolveType = (assetId: string): AssetManifestEntry["type"] | null =>
    typeByAssetId.get(assetId) ?? null;
  const audioState = (cue: AudioCue | null) => ({
    state:
      cue === null
        ? ("inherit" as const)
        : cue.assetId === null
          ? ("stop" as const)
          : ("set" as const),
    assetId: cue?.assetId ?? null,
  });

  return facts.map((fact): AssetSceneCueRow => {
    switch (fact.kind) {
      case "dialogueAssetCue":
        return {
          kind: "visualCue",
          carrierId: fact.carrierId,
          itemIndex: fact.itemIndex,
          background:
            fact.cue.backgroundAssetId === null
              ? null
              : {
                  assetId: fact.cue.backgroundAssetId,
                  type: resolveType(fact.cue.backgroundAssetId),
                },
          bgm: audioState(fact.cue.bgm),
          bgs: audioState(fact.cue.bgs),
        };
      case "structuralVisualCue":
        return {
          kind: "visualCue",
          carrierId: fact.carrierId,
          itemIndex: null,
          background:
            fact.backgroundAssetId === null
              ? null
              : {
                  assetId: fact.backgroundAssetId,
                  type: resolveType(fact.backgroundAssetId),
                },
          bgm: audioState(fact.bgm),
          bgs: audioState(fact.bgs),
        };
      case "dialoguePortrait":
        return {
          kind: "portrait",
          carrierId: fact.carrierId,
          itemIndex: fact.itemIndex,
          assetId: fact.portrait.assetId,
          type: resolveType(fact.portrait.assetId),
        };
      case "subjectPortrait":
        return {
          kind: "portrait",
          carrierId: fact.carrierId,
          itemIndex: null,
          assetId: fact.portrait.assetId,
          type: resolveType(fact.portrait.assetId),
        };
      case "evidenceImage":
        return {
          kind: "evidence",
          carrierId: fact.carrierId,
          itemIndex: null,
          assetId: fact.imageAssetId,
          type: resolveType(fact.imageAssetId),
        };
      case "sprite":
        return {
          kind: "sprite",
          carrierId: fact.carrierId,
          itemIndex: null,
          assetId: fact.assetId,
          type: resolveType(fact.assetId),
        };
    }
  });
}

// ---- usage joins (typed manifest sources only) ------------------------------

/**
 * Scene-grouped usage summary for one asset id, consumed by the Characters
 * expression grid: non-sprite usages collapse to their scene (deduped in
 * authored walk order), sprite-role usages stay concrete — a sprite layout
 * matches by raw asset id, so a parsed portrait identity picks up its
 * related sprite usages here.
 */
export type AssetUsageGroups = {
  scenes: Array<{ chapterId: string; sceneId: string }>;
  sprites: AssetSceneUsage[];
};

export function assetUsageGroups(
  workspace: AssetWorkspace,
  assetId: string,
): AssetUsageGroups {
  const scenes = new Map<string, { chapterId: string; sceneId: string }>();
  const sprites: AssetSceneUsage[] = [];
  for (const usage of workspace.sceneUsages) {
    if (usage.assetId !== assetId) continue;
    if (usage.role === "sprite") {
      sprites.push(usage);
      continue;
    }
    const key = `${usage.chapterId}\u0000${usage.sceneId}`;
    if (!scenes.has(key)) {
      scenes.set(key, { chapterId: usage.chapterId, sceneId: usage.sceneId });
    }
  }
  return { scenes: [...scenes.values()], sprites };
}

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
