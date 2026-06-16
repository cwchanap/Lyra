// =============================================================================
// scripts/compile-scenes/assets/enrich.ts
//
// Walks scene ASTs and injects concrete assetIds (background, portrait,
// evidence, audio) using the config's character/expression/audio maps.
// Collects manifest entries for every asset referenced. Validates that
// speakers, expressions, and audio IDs are known when assets are enabled.
// =============================================================================

import { existsSync } from "node:fs";
import type { AssetConfig, AudioChannel } from "./config";
import {
  buildAssetManifest,
  type AssetManifest,
  type AssetManifestEntry,
} from "./manifest";
import type {
  ASTCharacter,
  ASTEvidence,
  ASTHotspot,
  ASTInterrogationPhase,
  ASTInterrogationScene,
  ASTInvestigationScene,
  ASTLinearScene,
  AssetRef,
  CompileError,
  DialogueItem,
  EvidenceImageCue,
  VisualAssetCue,
} from "../types";
import type { SceneRecord } from "../validator";

type ManifestDraft = {
  assetId: string;
  type: AssetManifestEntry["type"];
  source: Record<string, string>;
  prompt: string;
  subjectPrompt?: string;
};

export type AssetEnrichmentResult = {
  scenes: SceneRecord[];
  manifest: AssetManifest;
  warnings: CompileError[];
  errors: CompileError[];
};

export function enrichScenesWithAssets(input: {
  scenes: SceneRecord[];
  config: AssetConfig;
}): AssetEnrichmentResult {
  if (!input.config.enabled) {
    return {
      scenes: input.scenes.map((scene) => stripAssetData(scene)),
      manifest: buildAssetManifest({ entries: [], config: input.config }),
      warnings: [],
      errors: [],
    };
  }

  const errors: CompileError[] = [];
  const requests = new Map<string, ManifestDraft>();
  const corpusState = { hadVisualCue: false };
  const scenes = input.scenes.map((scene) =>
    enrichScene(scene, input.config, requests, errors, corpusState),
  );
  const manifest = buildAssetManifest({
    entries: [...requests.values()],
    config: input.config,
  });
  const warnings = checkAssetExistence(manifest.entries);

  return {
    scenes,
    manifest,
    warnings,
    errors,
  };
}

function enrichScene(
  scene: SceneRecord,
  config: AssetConfig,
  requests: Map<string, ManifestDraft>,
  errors: CompileError[],
  corpusState: { hadVisualCue: boolean },
): SceneRecord {
  const refs = new Map<string, AssetRef>();
  const context = {
    scene,
    config,
    requests,
    errors,
    refs,
    tagIndex: 0,
    hadVisualCue: corpusState.hadVisualCue,
    corpusState,
  };

  if (scene.ast.kind === "linearScene") {
    const ast: ASTLinearScene = {
      ...scene.ast,
      queue: enrichDialogue(scene.ast.queue, context),
      assetRefs: [],
    };
    return { ...scene, ast: { ...ast, assetRefs: [...refs.values()] } };
  }

  if (scene.ast.kind === "investigationScene") {
    const ast = enrichInvestigationScene(scene.ast, context);
    return { ...scene, ast: { ...ast, assetRefs: [...refs.values()] } };
  }

  const ast = enrichInterrogationScene(scene.ast, context);
  return { ...scene, ast: { ...ast, assetRefs: [...refs.values()] } };
}

type EnrichContext = {
  scene: SceneRecord;
  config: AssetConfig;
  requests: Map<string, ManifestDraft>;
  errors: CompileError[];
  refs: Map<string, AssetRef>;
  tagIndex: number;
  /** Whether at least one visual cue has been seen so far (corpus-scoped). */
  hadVisualCue: boolean;
  /** Shared corpus state — updated when a visual cue is encountered. */
  corpusState: { hadVisualCue: boolean };
};

function enrichInvestigationScene(
  ast: ASTInvestigationScene,
  context: EnrichContext,
): ASTInvestigationScene {
  const evidenceNamesById = new Map(
    ast.evidenceManifest.map((evidence) => [evidence.id, evidence.name]),
  );
  return {
    ...ast,
    intro: enrichDialogue(ast.intro, context),
    sublocations: ast.sublocations.map((sub) => {
      validateHotspotEvidenceSources(sub.hotspots, context);
      return {
        ...sub,
        assetCue: enrichVisualCue(
          sub.assetCue,
          `${sub.id}`,
          sub.sourceFile,
          sub.line,
          context,
          investigationSourceGuidance(sub.hotspots, evidenceNamesById),
        ),
        transitionDialogue: enrichDialogue(sub.transitionDialogue, context),
        hotspots: sub.hotspots.map((hotspot) => ({
          ...hotspot,
          inspectDialogue: enrichDialogue(hotspot.inspectDialogue, context),
          onReexamine: enrichNullableDialogue(hotspot.onReexamine, context),
        })),
        characters: sub.characters.map((character) => {
          enrichCharacterSpriteLayout(character, context);
          return {
            ...character,
            topics: character.topics.map((topic) => ({
              ...topic,
              topicDialogue: enrichDialogue(topic.topicDialogue, context),
              onReexamine: enrichNullableDialogue(topic.onReexamine, context),
            })),
          };
        }),
      };
    }),
    evidenceManifest: ast.evidenceManifest.map((evidence) =>
      enrichEvidence(evidence, context),
    ),
    statementManifest: ast.statementManifest.map((statement) => ({
      ...statement,
      onAcquire: enrichDialogue(statement.onAcquire, context),
      onReexamine: enrichNullableDialogue(statement.onReexamine, context),
    })),
    outro: {
      ...ast.outro,
      dialogue: enrichDialogue(ast.outro.dialogue, context),
    },
    assetRefs: [],
  };
}

function enrichInterrogationScene(
  ast: ASTInterrogationScene,
  context: EnrichContext,
): ASTInterrogationScene {
  return {
    ...ast,
    intro: enrichDialogue(ast.intro, context),
    phases: ast.phases.map((phase) => enrichInterrogationPhase(phase, context)),
    evidenceManifest: ast.evidenceManifest.map((evidence) =>
      enrichEvidence(evidence, context),
    ),
    statementManifest: ast.statementManifest.map((statement) => ({
      ...statement,
      onAcquire: enrichDialogue(statement.onAcquire, context),
      onReexamine: enrichNullableDialogue(statement.onReexamine, context),
    })),
    outro: {
      ...ast.outro,
      dialogue: enrichDialogue(ast.outro.dialogue, context),
    },
    assetRefs: [],
  };
}

function enrichInterrogationPhase(
  phase: ASTInterrogationPhase,
  context: EnrichContext,
): ASTInterrogationPhase {
  const common = {
    ...phase,
    assetCue: enrichVisualCue(
      phase.assetCue,
      phase.id,
      phase.sourceFile,
      phase.line,
      context,
    ),
    entryDialogue: enrichDialogue(phase.entryDialogue, context),
  };
  if (phase.kind === "inquiry") {
    return {
      ...common,
      kind: "inquiry",
      questions: phase.questions.map((question) => ({
        ...question,
        answerDialogue: enrichDialogue(question.answerDialogue, context),
        onReask: enrichNullableDialogue(question.onReask, context),
      })),
    };
  }
  return {
    ...common,
    kind: "testimony",
    statements: phase.statements.map((statement) => ({
      ...statement,
      onPress: enrichNullableDialogue(statement.onPress, context),
      onPresent: enrichNullableDialogue(statement.onPresent, context),
      onWrongPresent: enrichNullableDialogue(statement.onWrongPresent, context),
    })),
    results: phase.results.map((result) => ({
      ...result,
      dialogue: enrichDialogue(result.dialogue, context),
    })),
  };
}

function enrichDialogue(
  items: DialogueItem[],
  context: EnrichContext,
): DialogueItem[] {
  return items.map((item) => {
    if (item.kind === "line") return enrichLine(item, context);
    if (item.kind === "sceneTag") {
      const unit = `tag_${String(++context.tagIndex).padStart(3, "0")}`;
      return {
        ...item,
        assetCue: enrichVisualCue(
          item.assetCue ?? null,
          unit,
          context.scene.ast.sourceFile,
          context.scene.ast.line,
          context,
        ),
      };
    }
    return item;
  });
}

function enrichNullableDialogue(
  items: DialogueItem[] | null,
  context: EnrichContext,
): DialogueItem[] | null {
  return items ? enrichDialogue(items, context) : null;
}

function enrichLine(
  item: Extract<DialogueItem, { kind: "line" }>,
  context: EnrichContext,
): DialogueItem {
  const character = context.config.characters.byDisplayName.get(item.speaker);
  if (!character) {
    // Narrator-style lines (unknown speaker, no expression) are exempt from
    // character lookup — they never need a portrait.  Only error when the
    // author explicitly requested an expression, which implies a portrait was
    // expected.
    if (!item.expression) {
      return { ...item, portrait: null };
    }
    context.errors.push(
      compileError(
        context.scene.ast.sourceFile,
        context.scene.ast.line,
        "assetUnknownSpeaker",
        `Unknown speaker "${item.speaker}" in asset-enabled scene.`,
      ),
    );
    return { ...item, portrait: null };
  }
  if (character.portraitMode === "none") {
    if (item.expression) {
      context.errors.push(
        compileError(
          context.scene.ast.sourceFile,
          context.scene.ast.line,
          "assetExpressionOnNoPortraitSpeaker",
          `Speaker "${item.speaker}" does not support portrait expressions.`,
        ),
      );
    }
    return { ...item, portrait: null };
  }

  const expression = item.expression ?? "standard";
  const expressionConfig = character.expressions.get(expression);
  if (!expressionConfig) {
    context.errors.push(
      compileError(
        context.scene.ast.sourceFile,
        context.scene.ast.line,
        "assetUnknownExpression",
        `Unknown expression "${expression}" for speaker "${item.speaker}".`,
      ),
    );
    return { ...item, portrait: null };
  }

  const assetId = `portrait.${character.id}.${expression}`;
  addRef(context.refs, { type: "portrait", assetId });
  putRequest(context.requests, {
    assetId,
    type: "portrait",
    source: {
      chapterId: context.scene.chapterId,
      sceneId: context.scene.ast.id,
      characterId: character.id,
      expression,
    },
    prompt: expressionConfig.prompt,
    subjectPrompt: character.visualPrompt ?? "",
  });

  return {
    ...item,
    expression,
    portrait: { characterId: character.id, expression, assetId },
  };
}

// -----------------------------------------------------------------------------
// stripAssetData — deep-walks an AST and nulls out all visual/audio cues,
// evidence image cues, and portrait refs so that a disabled asset pipeline
// produces clean JSON with no raw, unvalidated IDs leaking through.
// -----------------------------------------------------------------------------

const NULL_VISUAL_CUE: VisualAssetCue = {
  backgroundPrompt: null,
  backgroundAssetId: null,
  bgm: null,
  bgs: null,
};

function stripAssetData(scene: SceneRecord): SceneRecord {
  const ast = scene.ast;
  if (ast.kind === "linearScene") {
    return { ...scene, ast: { ...stripLinearScene(ast), assetRefs: [] } };
  }
  if (ast.kind === "investigationScene") {
    return {
      ...scene,
      ast: { ...stripInvestigationScene(ast), assetRefs: [] },
    };
  }
  return { ...scene, ast: { ...stripInterrogationScene(ast), assetRefs: [] } };
}

function stripLinearScene(
  ast: ASTLinearScene,
): Omit<ASTLinearScene, "assetRefs"> {
  return { ...ast, queue: stripDialogue(ast.queue) };
}

function stripInvestigationScene(
  ast: ASTInvestigationScene,
): Omit<ASTInvestigationScene, "assetRefs"> {
  return {
    ...ast,
    intro: stripDialogue(ast.intro),
    sublocations: ast.sublocations.map((sub) => ({
      ...sub,
      assetCue: stripVisualCue(sub.assetCue),
      transitionDialogue: stripDialogue(sub.transitionDialogue),
      hotspots: sub.hotspots.map((h) => ({
        ...h,
        inspectDialogue: stripDialogue(h.inspectDialogue),
        onReexamine: stripNullableDialogue(h.onReexamine),
      })),
      characters: sub.characters.map((c) => ({
        ...c,
        topics: c.topics.map((t) => ({
          ...t,
          topicDialogue: stripDialogue(t.topicDialogue),
          onReexamine: stripNullableDialogue(t.onReexamine),
        })),
      })),
    })),
    evidenceManifest: ast.evidenceManifest.map(stripEvidence),
    statementManifest: ast.statementManifest.map((s) => ({
      ...s,
      onAcquire: stripDialogue(s.onAcquire),
      onReexamine: stripNullableDialogue(s.onReexamine),
    })),
    outro: { ...ast.outro, dialogue: stripDialogue(ast.outro.dialogue) },
  };
}

function stripInterrogationScene(
  ast: ASTInterrogationScene,
): Omit<ASTInterrogationScene, "assetRefs"> {
  return {
    ...ast,
    intro: stripDialogue(ast.intro),
    phases: ast.phases.map(stripPhase),
    evidenceManifest: ast.evidenceManifest.map(stripEvidence),
    statementManifest: ast.statementManifest.map((s) => ({
      ...s,
      onAcquire: stripDialogue(s.onAcquire),
      onReexamine: stripNullableDialogue(s.onReexamine),
    })),
    outro: { ...ast.outro, dialogue: stripDialogue(ast.outro.dialogue) },
  };
}

function stripPhase(phase: ASTInterrogationPhase): ASTInterrogationPhase {
  const common = {
    ...phase,
    assetCue: stripVisualCue(phase.assetCue),
    entryDialogue: stripDialogue(phase.entryDialogue),
  };
  if (phase.kind === "inquiry") {
    return {
      ...common,
      kind: "inquiry",
      questions: phase.questions.map((q) => ({
        ...q,
        answerDialogue: stripDialogue(q.answerDialogue),
        onReask: stripNullableDialogue(q.onReask),
      })),
    };
  }
  return {
    ...common,
    kind: "testimony",
    statements: phase.statements.map((s) => ({
      ...s,
      onPress: stripNullableDialogue(s.onPress),
      onPresent: stripNullableDialogue(s.onPresent),
      onWrongPresent: stripNullableDialogue(s.onWrongPresent),
    })),
    results: phase.results.map((r) => ({
      ...r,
      dialogue: stripDialogue(r.dialogue),
    })),
  };
}

function stripDialogue(items: DialogueItem[]): DialogueItem[] {
  return items.map((item) => {
    if (item.kind === "sceneTag") {
      return {
        ...item,
        assetCue: item.assetCue ? { ...NULL_VISUAL_CUE } : null,
      };
    }
    if (item.kind === "line") {
      return { ...item, portrait: null };
    }
    return item;
  });
}

function stripNullableDialogue(
  items: DialogueItem[] | null,
): DialogueItem[] | null {
  return items ? stripDialogue(items) : null;
}

function stripVisualCue(cue: VisualAssetCue | null): VisualAssetCue | null {
  if (!cue) return null;
  return { ...NULL_VISUAL_CUE };
}

function stripEvidence(evidence: ASTEvidence): ASTEvidence {
  return {
    ...evidence,
    imageCue: { imagePrompt: null, imageAssetId: null },
    onCollect: stripDialogue(evidence.onCollect),
    onReexamine: stripNullableDialogue(evidence.onReexamine),
  };
}

/**
 * Extract asset references from a character's sprite layout.
 * Layout sidecars set `layout.assetId` on investigation-scene characters.
 * The layout parser accepts "standee.", "portrait.", "evidence.", and
 * "background." prefixes. The enrichment pipeline must register all of
 * them as manifest entries so that asset existence checks and the manifest
 * report cover every rendered sprite asset.
 */
function enrichCharacterSpriteLayout(
  character: ASTCharacter,
  context: EnrichContext,
): void {
  if (!character.layout || character.layout.kind !== "sprite") return;
  const assetId = character.layout.assetId;

  if (assetId.startsWith("standee.")) {
    const parts = assetId.split(".");
    if (parts.length !== 3) {
      context.errors.push(
        compileError(
          character.sourceFile,
          character.line,
          "assetInvalidStandeeId",
          `Standee assetId "${assetId}" must follow format standee.<characterId>.<pose>.`,
        ),
      );
      return;
    }
    const [, characterId, pose] = parts;

    addRef(context.refs, { type: "standee", assetId });
    const charConfig = context.config.characters.byId.get(characterId);
    putRequest(context.requests, {
      assetId,
      type: "standee",
      source: {
        chapterId: context.scene.chapterId,
        sceneId: context.scene.ast.id,
        characterId: character.id,
      },
      prompt: pose,
      subjectPrompt: charConfig?.visualPrompt ?? "",
    });
  } else if (assetId.startsWith("portrait.")) {
    const parts = assetId.split(".");
    if (parts.length !== 3) {
      context.errors.push(
        compileError(
          character.sourceFile,
          character.line,
          "assetInvalidPortraitLayoutId",
          `Portrait layout assetId "${assetId}" must follow format portrait.<characterId>.<expression>.`,
        ),
      );
      return;
    }
    const [, characterId, expression] = parts;

    addRef(context.refs, { type: "portrait", assetId });
    const charConfig = context.config.characters.byId.get(characterId);
    putRequest(context.requests, {
      assetId,
      type: "portrait",
      source: {
        chapterId: context.scene.chapterId,
        sceneId: context.scene.ast.id,
        characterId: character.id,
        expression,
      },
      prompt: expression,
      subjectPrompt: charConfig?.visualPrompt ?? "",
    });
  } else if (assetId.startsWith("evidence.")) {
    addRef(context.refs, { type: "evidence", assetId });
    putRequest(context.requests, {
      assetId,
      type: "evidence",
      source: {
        chapterId: context.scene.chapterId,
        sceneId: context.scene.ast.id,
        characterId: character.id,
      },
      prompt: `evidence sprite for ${character.id}`,
    });
  } else if (assetId.startsWith("background.")) {
    addRef(context.refs, { type: "background", assetId });
    putRequest(context.requests, {
      assetId,
      type: "background",
      source: {
        chapterId: context.scene.chapterId,
        sceneId: context.scene.ast.id,
        characterId: character.id,
      },
      prompt: `background sprite for ${character.id}`,
    });
  }
}

function enrichVisualCue(
  cue: VisualAssetCue | null,
  unitId: string,
  sourceFile: string,
  line: number,
  context: EnrichContext,
  promptSuffix?: string,
): VisualAssetCue | null {
  if (!cue) return null;
  const isFirst = !context.hadVisualCue;
  context.hadVisualCue = true;
  context.corpusState.hadVisualCue = true;
  const bgm = enrichAudioCue(cue.bgm, sourceFile, line, context);
  const bgs = enrichAudioCue(cue.bgs, sourceFile, line, context);
  if (isFirst) {
    if (!cue.bgm) {
      context.errors.push(
        compileError(
          sourceFile,
          line,
          "assetFirstCueMissingBgm",
          `First visual unit "${unitId}" must set BGM to a defined ID or \`none\` when assets are enabled.`,
        ),
      );
    }
    if (!cue.bgs) {
      context.errors.push(
        compileError(
          sourceFile,
          line,
          "assetFirstCueMissingBgs",
          `First visual unit "${unitId}" must set BGS to a defined ID or \`none\` when assets are enabled.`,
        ),
      );
    }
  }
  if (!cue.backgroundPrompt) {
    context.errors.push(
      compileError(
        sourceFile,
        line,
        "assetMissingBackgroundPrompt",
        `Visual unit "${unitId}" requires Background Prompt when assets are enabled.`,
      ),
    );
    return { ...cue, bgm, bgs };
  }

  const backgroundAssetId =
    cue.backgroundAssetId ??
    `background.${context.scene.chapterId}.${context.scene.ast.id}.${unitId}`;
  addRef(context.refs, { type: "background", assetId: backgroundAssetId });
  putRequest(context.requests, {
    assetId: backgroundAssetId,
    type: "background",
    source: {
      chapterId: context.scene.chapterId,
      sceneId: context.scene.ast.id,
      unitId,
    },
    prompt: [cue.backgroundPrompt, promptSuffix].filter(Boolean).join("\n\n"),
  });

  return {
    ...cue,
    backgroundAssetId,
    bgm,
    bgs,
  };
}

function validateHotspotEvidenceSources(
  hotspots: ASTHotspot[],
  context: EnrichContext,
): void {
  for (const hotspot of hotspots) {
    if (revealedEvidenceIds(hotspot).length === 0 || hotspot.evidenceSource) {
      continue;
    }
    context.errors.push(
      compileError(
        hotspot.sourceFile,
        hotspot.line,
        "hotspotEvidenceSourceMissing",
        `Hotspot "${hotspot.id}" reveals evidence and must declare Evidence Source when assets are enabled.`,
      ),
    );
  }
}

function investigationSourceGuidance(
  hotspots: ASTHotspot[],
  evidenceNamesById: Map<string, string>,
): string | undefined {
  const lines = hotspots.flatMap((hotspot) => {
    const evidenceNames = revealedEvidenceIds(hotspot).map(
      (id) => evidenceNamesById.get(id) ?? id,
    );
    if (evidenceNames.length === 0 || !hotspot.evidenceSource) return [];
    // Treat an empty/whitespace-only sceneSourcePrompt as missing so authors
    // get the label:description fallback rather than empty source guidance.
    const trimmedPrompt = (hotspot.sceneSourcePrompt ?? "").trim();
    const sourcePrompt =
      trimmedPrompt || `${hotspot.label}: ${hotspot.description}`.trim();

    if (hotspot.evidenceSource === "visible") {
      return [
        `- visible: ${hotspot.id}. Include the source object/area: ${sourcePrompt}.`,
      ];
    }
    if (hotspot.evidenceSource === "implied") {
      return [
        `- implied: ${hotspot.id}. Include source/access point guidance: ${sourcePrompt}; do not show the collected evidence image or readable evidence content for ${evidenceNames.join(", ")}.`,
      ];
    }
    return [
      `- hidden: ${hotspot.id}. Do not show ${evidenceNames.join(", ")} or the source record for hotspot ${hotspot.id} in the background.`,
    ];
  });
  if (lines.length === 0) return undefined;
  return ["Investigation source guidance:", ...lines].join("\n");
}

function revealedEvidenceIds(hotspot: ASTHotspot): string[] {
  return hotspot.reveals
    .filter((reveal) => reveal.kind === "evidence")
    .map((reveal) => reveal.id);
}

function enrichAudioCue(
  cue: VisualAssetCue["bgm"],
  sourceFile: string,
  line: number,
  context: EnrichContext,
): VisualAssetCue["bgm"] {
  if (!cue || cue.assetId === null) return cue;
  const channel = cue.channel;
  const audio = context.config.audio[channel].get(cue.assetId);
  if (!audio) {
    context.errors.push(
      compileError(
        sourceFile,
        line,
        "assetUnknownAudio",
        `Unknown ${channel.toUpperCase()} asset "${cue.assetId}".`,
      ),
    );
    return { ...cue, assetId: null };
  }

  const assetId = audioAssetId(channel, cue.assetId);
  addRef(context.refs, { type: "audio", assetId });
  putRequest(context.requests, {
    assetId,
    type: "audio",
    source: {
      chapterId: context.scene.chapterId,
      sceneId: context.scene.ast.id,
      channel,
      id: cue.assetId,
    },
    prompt: audio.prompt,
  });
  return { ...cue, assetId };
}

function enrichEvidence(
  evidence: ASTEvidence,
  context: EnrichContext,
): ASTEvidence {
  const imageCue = enrichEvidenceImageCue(
    evidence.id,
    evidence.imageCue,
    evidence.sourceFile,
    evidence.line,
    context,
  );
  return {
    ...evidence,
    imageCue,
    onCollect: enrichDialogue(evidence.onCollect, context),
    onReexamine: enrichNullableDialogue(evidence.onReexamine, context),
  };
}

function enrichEvidenceImageCue(
  id: string,
  cue: EvidenceImageCue,
  sourceFile: string,
  line: number,
  context: EnrichContext,
): EvidenceImageCue {
  if (!cue.imagePrompt) {
    context.errors.push(
      compileError(
        sourceFile,
        line,
        "assetMissingEvidenceImagePrompt",
        `Evidence "${id}" requires Image Prompt when assets are enabled.`,
      ),
    );
    return { ...cue };
  }
  const assetId = cue.imageAssetId ?? `evidence.${id}`;
  addRef(context.refs, { type: "evidence", assetId });
  putRequest(context.requests, {
    assetId,
    type: "evidence",
    source: {
      chapterId: context.scene.chapterId,
      sceneId: context.scene.ast.id,
      evidenceId: id,
    },
    prompt: cue.imagePrompt,
  });
  return { ...cue, imageAssetId: assetId };
}

function audioAssetId(channel: AudioChannel, id: string): string {
  return `audio.${channel}.${id}`;
}

function addRef(refs: Map<string, AssetRef>, ref: AssetRef): void {
  refs.set(`${ref.type}:${ref.assetId}`, ref);
}

function putRequest(
  requests: Map<string, ManifestDraft>,
  entry: ManifestDraft,
): void {
  if (!requests.has(entry.assetId)) requests.set(entry.assetId, entry);
}

function compileError(
  sourceFile: string,
  line: number,
  code: string,
  message: string,
): CompileError {
  return { sourceFile, line, code, message };
}

/**
 * Check whether each manifest entry's expected file exists on disk.
 * Returns warnings (not errors) for missing files — assets may be generated
 * after compilation, so missing files don't block the pipeline.
 */
function checkAssetExistence(entries: AssetManifestEntry[]): CompileError[] {
  const warnings: CompileError[] = [];
  for (const entry of entries) {
    if (!existsSync(entry.expectedPath)) {
      warnings.push({
        sourceFile: entry.expectedPath,
        line: 1,
        code: "assetFileMissing",
        message: `Expected asset file not found: ${entry.expectedPath} (assetId: ${entry.assetId}, type: ${entry.type})`,
      });
    }
  }
  return warnings;
}
