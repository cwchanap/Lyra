import type { AssetConfig } from "./assets/config";
import type { AssetManifest } from "./assets/manifest";
import type {
  ASTInterrogationScene,
  ASTInvestigationScene,
  DialogueItem,
  VisualAssetCue,
} from "./types";
import type { CompileError } from "./types";
import type { SceneRecord } from "./validator";

type SemanticReference = {
  assetId: string;
  sourceFile: string;
  line: number;
};

function occurrences(values: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function error(
  reference: SemanticReference,
  scope: "asset manifest" | "asset configuration",
  count: number,
): CompileError {
  const missing = count === 0;
  return {
    code: missing
      ? "saveContentReferenceMissing"
      : "saveContentReferenceAmbiguous",
    message: `Semantic asset reference "${reference.assetId}" occurs ${count} time(s) in the ${scope}; expected exactly one.`,
    sourceFile: reference.sourceFile,
    line: reference.line,
  };
}

function addDialogueReferences(
  items: readonly DialogueItem[],
  sourceFile: string,
  line: number,
  refs: SemanticReference[],
): void {
  for (const item of items) {
    if (item.kind === "line" && item.portrait) {
      refs.push({ assetId: item.portrait.assetId, sourceFile, line });
    }
    if (item.kind === "sceneTag")
      addVisualCue(item.assetCue ?? null, sourceFile, line, refs);
  }
}

function addVisualCue(
  cue: VisualAssetCue | null,
  sourceFile: string,
  line: number,
  refs: SemanticReference[],
): void {
  if (!cue) return;
  if (cue.backgroundAssetId)
    refs.push({ assetId: cue.backgroundAssetId, sourceFile, line });
  if (cue.bgm?.assetId)
    refs.push({ assetId: cue.bgm.assetId, sourceFile, line });
  if (cue.bgs?.assetId)
    refs.push({ assetId: cue.bgs.assetId, sourceFile, line });
}

function addInventoryReferences(
  scene: ASTInvestigationScene | ASTInterrogationScene,
  refs: SemanticReference[],
): void {
  for (const evidence of scene.evidenceManifest) {
    if (evidence.imageCue.imageAssetId) {
      refs.push({
        assetId: evidence.imageCue.imageAssetId,
        sourceFile: evidence.sourceFile,
        line: evidence.line,
      });
    }
    addDialogueReferences(
      evidence.onCollect,
      evidence.sourceFile,
      evidence.line,
      refs,
    );
    if (evidence.onReexamine)
      addDialogueReferences(
        evidence.onReexamine,
        evidence.sourceFile,
        evidence.line,
        refs,
      );
  }
  for (const statement of scene.statementManifest) {
    addDialogueReferences(
      statement.onAcquire,
      statement.sourceFile,
      statement.line,
      refs,
    );
    if (statement.onReexamine)
      addDialogueReferences(
        statement.onReexamine,
        statement.sourceFile,
        statement.line,
        refs,
      );
  }
}

function sceneReferences(scene: SceneRecord): SemanticReference[] {
  const refs: SemanticReference[] = scene.ast.assetRefs.map((ref) => ({
    assetId: ref.assetId,
    sourceFile: scene.ast.sourceFile,
    line: scene.ast.line,
  }));
  if (scene.ast.kind === "linearScene") {
    addDialogueReferences(
      scene.ast.queue,
      scene.ast.sourceFile,
      scene.ast.line,
      refs,
    );
    return refs;
  }

  addDialogueReferences(
    scene.ast.intro,
    scene.ast.sourceFile,
    scene.ast.line,
    refs,
  );
  addInventoryReferences(scene.ast, refs);
  addDialogueReferences(
    scene.ast.outro.dialogue,
    scene.ast.sourceFile,
    scene.ast.line,
    refs,
  );
  if (scene.ast.kind === "investigationScene") {
    for (const sublocation of scene.ast.sublocations) {
      addVisualCue(
        sublocation.assetCue,
        sublocation.sourceFile,
        sublocation.line,
        refs,
      );
      addDialogueReferences(
        sublocation.transitionDialogue,
        sublocation.sourceFile,
        sublocation.line,
        refs,
      );
      for (const hotspot of sublocation.hotspots) {
        addDialogueReferences(
          hotspot.inspectDialogue,
          hotspot.sourceFile,
          hotspot.line,
          refs,
        );
        if (hotspot.onReexamine)
          addDialogueReferences(
            hotspot.onReexamine,
            hotspot.sourceFile,
            hotspot.line,
            refs,
          );
      }
      for (const character of sublocation.characters)
        for (const topic of character.topics) {
          addDialogueReferences(
            topic.topicDialogue,
            topic.sourceFile,
            topic.line,
            refs,
          );
          if (topic.onReexamine)
            addDialogueReferences(
              topic.onReexamine,
              topic.sourceFile,
              topic.line,
              refs,
            );
        }
    }
    return refs;
  }

  for (const phase of scene.ast.phases) {
    addVisualCue(phase.assetCue, phase.sourceFile, phase.line, refs);
    addDialogueReferences(
      phase.entryDialogue,
      phase.sourceFile,
      phase.line,
      refs,
    );
    for (const question of phase.questions) {
      const testimony = question.testimony;
      addDialogueReferences(
        testimony.onLoop,
        testimony.sourceFile,
        testimony.line,
        refs,
      );
      for (const block of [
        testimony.loopPrompt,
        testimony.defaultChallenge,
        testimony.defaultWrong,
        testimony.wrongReply,
      ]) {
        if (block)
          addDialogueReferences(
            block,
            testimony.sourceFile,
            testimony.line,
            refs,
          );
      }
      for (const line of testimony.lines) {
        addDialogueReferences(line.content, line.sourceFile, line.line, refs);
        if (line.challenge)
          addDialogueReferences(
            line.challenge,
            line.sourceFile,
            line.line,
            refs,
          );
        if (line.onCorrect)
          addDialogueReferences(
            line.onCorrect,
            line.sourceFile,
            line.line,
            refs,
          );
        if (line.onWrongEvidence)
          addDialogueReferences(
            line.onWrongEvidence,
            line.sourceFile,
            line.line,
            refs,
          );
      }
    }
  }
  return refs;
}

function configuredSemanticIds(config: AssetConfig): Map<string, number> {
  const ids: string[] = [];
  for (const character of config.characters.byId.values()) {
    for (const expression of character.expressions.values())
      ids.push(`portrait.${character.id}.${expression.id}`);
  }
  for (const channel of ["bgm", "bgs", "sfx"] as const) {
    for (const entry of config.audio[channel].values())
      ids.push(`audio.${channel}.${entry.id}`);
  }
  return occurrences(ids);
}

/** Verifies every emitted semantic asset reference resolves exactly once. */
export function validateSaveContentReferences(input: {
  scenes: readonly SceneRecord[];
  config: AssetConfig;
  manifest: AssetManifest;
}): CompileError[] {
  const manifestCounts = occurrences(
    input.manifest.entries.map((entry) => entry.assetId),
  );
  const configuredCounts = configuredSemanticIds(input.config);
  const errors: CompileError[] = [];
  const seen = new Set<string>();
  for (const scene of input.scenes)
    for (const reference of sceneReferences(scene)) {
      const manifestCount = manifestCounts.get(reference.assetId) ?? 0;
      if (manifestCount !== 1) {
        const key = `${reference.assetId}:asset manifest`;
        if (!seen.has(key)) {
          seen.add(key);
          errors.push(error(reference, "asset manifest", manifestCount));
        }
      }
      if (
        reference.assetId.startsWith("portrait.") ||
        reference.assetId.startsWith("audio.")
      ) {
        const configuredCount = configuredCounts.get(reference.assetId) ?? 0;
        if (configuredCount !== 1) {
          const key = `${reference.assetId}:asset configuration`;
          if (!seen.has(key)) {
            seen.add(key);
            errors.push(
              error(reference, "asset configuration", configuredCount),
            );
          }
        }
      }
    }
  return errors;
}
