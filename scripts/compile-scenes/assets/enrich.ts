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
import { buildAssetManifest, expectedPath, type AssetManifest, type AssetManifestEntry } from "./manifest";
import type {
  ASTEvidence,
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

export function enrichScenesWithAssets(input: { scenes: SceneRecord[]; config: AssetConfig }): AssetEnrichmentResult {
  if (!input.config.enabled) {
    return {
      scenes: input.scenes.map((scene) => ({ ...scene, ast: { ...scene.ast, assetRefs: [] } })),
      manifest: buildAssetManifest({ entries: [], config: input.config }),
      warnings: [],
      errors: [],
    };
  }

  const errors: CompileError[] = [];
  const requests = new Map<string, ManifestDraft>();
  const scenes = input.scenes.map((scene) => enrichScene(scene, input.config, requests, errors));
  const manifest = buildAssetManifest({ entries: [...requests.values()], config: input.config });
  const warnings = checkAssetExistence(manifest.entries);

  return {
    scenes,
    manifest,
    warnings,
    errors,
  };
}

function enrichScene(scene: SceneRecord, config: AssetConfig, requests: Map<string, ManifestDraft>, errors: CompileError[]): SceneRecord {
  const refs = new Map<string, AssetRef>();
  const context = { scene, config, requests, errors, refs, tagIndex: 0 };

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
};

function enrichInvestigationScene(ast: ASTInvestigationScene, context: EnrichContext): ASTInvestigationScene {
  return {
    ...ast,
    intro: enrichDialogue(ast.intro, context),
    sublocations: ast.sublocations.map((sub) => ({
      ...sub,
      assetCue: enrichVisualCue(sub.assetCue, `${sub.id}`, sub.sourceFile, sub.line, context),
      transitionDialogue: enrichDialogue(sub.transitionDialogue, context),
      hotspots: sub.hotspots.map((hotspot) => ({
        ...hotspot,
        inspectDialogue: enrichDialogue(hotspot.inspectDialogue, context),
        onReexamine: enrichNullableDialogue(hotspot.onReexamine, context),
      })),
      characters: sub.characters.map((character) => ({
        ...character,
        topics: character.topics.map((topic) => ({
          ...topic,
          topicDialogue: enrichDialogue(topic.topicDialogue, context),
          onReexamine: enrichNullableDialogue(topic.onReexamine, context),
        })),
      })),
    })),
    evidenceManifest: ast.evidenceManifest.map((evidence) => enrichEvidence(evidence, context)),
    statementManifest: ast.statementManifest.map((statement) => ({
      ...statement,
      onAcquire: enrichDialogue(statement.onAcquire, context),
      onReexamine: enrichNullableDialogue(statement.onReexamine, context),
    })),
    outro: { ...ast.outro, dialogue: enrichDialogue(ast.outro.dialogue, context) },
    assetRefs: [],
  };
}

function enrichInterrogationScene(ast: ASTInterrogationScene, context: EnrichContext): ASTInterrogationScene {
  return {
    ...ast,
    intro: enrichDialogue(ast.intro, context),
    phases: ast.phases.map((phase) => enrichInterrogationPhase(phase, context)),
    evidenceManifest: ast.evidenceManifest.map((evidence) => enrichEvidence(evidence, context)),
    statementManifest: ast.statementManifest.map((statement) => ({
      ...statement,
      onAcquire: enrichDialogue(statement.onAcquire, context),
      onReexamine: enrichNullableDialogue(statement.onReexamine, context),
    })),
    outro: { ...ast.outro, dialogue: enrichDialogue(ast.outro.dialogue, context) },
    assetRefs: [],
  };
}

function enrichInterrogationPhase(phase: ASTInterrogationPhase, context: EnrichContext): ASTInterrogationPhase {
  const common = {
    ...phase,
    assetCue: enrichVisualCue(phase.assetCue, phase.id, phase.sourceFile, phase.line, context),
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

function enrichDialogue(items: DialogueItem[], context: EnrichContext): DialogueItem[] {
  return items.map((item) => {
    if (item.kind === "line") return enrichLine(item, context);
    if (item.kind === "sceneTag") {
      const unit = `tag_${String(++context.tagIndex).padStart(3, "0")}`;
      return { ...item, assetCue: enrichVisualCue(item.assetCue ?? null, unit, context.scene.ast.sourceFile, context.scene.ast.line, context) };
    }
    return item;
  });
}

function enrichNullableDialogue(items: DialogueItem[] | null, context: EnrichContext): DialogueItem[] | null {
  return items ? enrichDialogue(items, context) : null;
}

function enrichLine(item: Extract<DialogueItem, { kind: "line" }>, context: EnrichContext): DialogueItem {
  const character = context.config.characters.byDisplayName.get(item.speaker);
  if (!character) {
    context.errors.push(compileError(context.scene.ast.sourceFile, context.scene.ast.line, "assetUnknownSpeaker", `Unknown speaker "${item.speaker}" in asset-enabled scene.`));
    return { ...item, portrait: null };
  }
  if (character.portraitMode === "none") {
    if (item.expression) {
      context.errors.push(compileError(context.scene.ast.sourceFile, context.scene.ast.line, "assetExpressionOnNoPortraitSpeaker", `Speaker "${item.speaker}" does not support portrait expressions.`));
    }
    return { ...item, portrait: null };
  }

  const expression = item.expression ?? "standard";
  const expressionConfig = character.expressions.get(expression);
  if (!expressionConfig) {
    context.errors.push(compileError(context.scene.ast.sourceFile, context.scene.ast.line, "assetUnknownExpression", `Unknown expression "${expression}" for speaker "${item.speaker}".`));
    return { ...item, portrait: null };
  }

  const assetId = `portrait.${character.id}.${expression}`;
  addRef(context.refs, { type: "portrait", assetId });
  putRequest(context.requests, {
    assetId,
    type: "portrait",
    source: { chapterId: context.scene.chapterId, sceneId: context.scene.ast.id, characterId: character.id, expression },
    prompt: expressionConfig.prompt,
    subjectPrompt: character.visualPrompt ?? "",
  });

  return { ...item, expression, portrait: { characterId: character.id, expression, assetId } };
}

function enrichVisualCue(cue: VisualAssetCue | null, unitId: string, sourceFile: string, line: number, context: EnrichContext): VisualAssetCue | null {
  if (!cue) return null;
  const bgm = enrichAudioCue(cue.bgm, sourceFile, line, context);
  const bgs = enrichAudioCue(cue.bgs, sourceFile, line, context);
  if (!cue.backgroundPrompt) {
    context.errors.push(compileError(sourceFile, line, "assetMissingBackgroundPrompt", `Visual unit "${unitId}" requires Background Prompt when assets are enabled.`));
    return { ...cue, bgm, bgs };
  }

  const backgroundAssetId = cue.backgroundAssetId ?? `background.${context.scene.chapterId}.${context.scene.ast.id}.${unitId}`;
  addRef(context.refs, { type: "background", assetId: backgroundAssetId });
  putRequest(context.requests, {
    assetId: backgroundAssetId,
    type: "background",
    source: { chapterId: context.scene.chapterId, sceneId: context.scene.ast.id, unitId },
    prompt: cue.backgroundPrompt,
  });

  return {
    ...cue,
    backgroundAssetId,
    bgm,
    bgs,
  };
}

function enrichAudioCue(cue: VisualAssetCue["bgm"], sourceFile: string, line: number, context: EnrichContext): VisualAssetCue["bgm"] {
  if (!cue || cue.assetId === null) return cue;
  const channel = cue.channel;
  const audio = context.config.audio[channel].get(cue.assetId);
  if (!audio) {
    context.errors.push(compileError(sourceFile, line, "assetUnknownAudio", `Unknown ${channel.toUpperCase()} asset "${cue.assetId}".`));
    return { ...cue, assetId: null };
  }

  const assetId = audioAssetId(channel, cue.assetId);
  addRef(context.refs, { type: "audio", assetId });
  putRequest(context.requests, {
    assetId,
    type: "audio",
    source: { chapterId: context.scene.chapterId, sceneId: context.scene.ast.id, channel, id: cue.assetId },
    prompt: audio.prompt,
  });
  return { ...cue, assetId };
}

function enrichEvidence(evidence: ASTEvidence, context: EnrichContext): ASTEvidence {
  const imageCue = enrichEvidenceImageCue(evidence.id, evidence.imageCue, evidence.sourceFile, evidence.line, context);
  return {
    ...evidence,
    imageCue,
    onCollect: enrichDialogue(evidence.onCollect, context),
    onReexamine: enrichNullableDialogue(evidence.onReexamine, context),
  };
}

function enrichEvidenceImageCue(id: string, cue: EvidenceImageCue, sourceFile: string, line: number, context: EnrichContext): EvidenceImageCue {
  if (!cue.imagePrompt) {
    context.errors.push(compileError(sourceFile, line, "assetMissingEvidenceImagePrompt", `Evidence "${id}" requires Image Prompt when assets are enabled.`));
    return { ...cue };
  }
  const assetId = cue.imageAssetId ?? `evidence.${id}`;
  addRef(context.refs, { type: "evidence", assetId });
  putRequest(context.requests, {
    assetId,
    type: "evidence",
    source: { chapterId: context.scene.chapterId, sceneId: context.scene.ast.id, evidenceId: id },
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

function putRequest(requests: Map<string, ManifestDraft>, entry: ManifestDraft): void {
  if (!requests.has(entry.assetId)) requests.set(entry.assetId, entry);
}

function compileError(sourceFile: string, line: number, code: string, message: string): CompileError {
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
