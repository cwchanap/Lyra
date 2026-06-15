// =============================================================================
// scripts/compile-scenes/emitter.ts
//
// Pure functions: AST → JSON. No I/O. The orchestrator owns disk writes.
// =============================================================================

import type {
  ASTChapter,
  ASTInterrogationScene,
  ASTInvestigationScene,
  ASTLinearScene,
  DialogueItem,
  JSONChaptersIndex,
  JSONDialogueItem,
  JSONInterrogationScene,
  JSONInvestigationScene,
  JSONLinearScene,
  JSONVisualAssetCue,
  VisualAssetCue,
} from "./types";

export function emitLinearScene(ast: ASTLinearScene): JSONLinearScene {
  return {
    type: "linear",
    id: ast.id,
    title: ast.title,
    queue: emitDialogueItems(ast.queue),
    assetRefs: ast.assetRefs,
  };
}

export function emitInvestigationScene(
  ast: ASTInvestigationScene,
): JSONInvestigationScene {
  return {
    type: "investigation",
    id: ast.id,
    title: ast.title,
    intro: emitDialogueItems(ast.intro),
    assetRefs: ast.assetRefs,
    sublocations: ast.sublocations.map((sub) => ({
      id: sub.id,
      label: sub.label,
      status: sub.status,
      unlock: sub.unlock,
      reveals: sub.reveals,
      sceneTag: sub.sceneTag,
      ...emitVisualFields(sub.assetCue),
      transitionDialogue: emitDialogueItems(sub.transitionDialogue),
      hotspots: sub.hotspots.map((h) => ({
        id: h.id,
        label: h.label,
        description: h.description,
        status: h.status,
        unlock: h.unlock,
        reveals: h.reveals,
        evidenceSource: h.evidenceSource,
        sceneSourcePrompt: h.sceneSourcePrompt,
        inspectDialogue: emitDialogueItems(h.inspectDialogue),
        onReexamine: emitNullableDialogueItems(h.onReexamine),
        layout: h.layout ?? null,
      })),
      characters: sub.characters.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        bio: c.bio,
        layout: c.layout ?? null,
        topics: c.topics.map((t) => ({
          id: t.id,
          label: t.label,
          status: t.status,
          unlock: t.unlock,
          reveals: t.reveals,
          topicDialogue: emitDialogueItems(t.topicDialogue),
          onReexamine: emitNullableDialogueItems(t.onReexamine),
        })),
      })),
    })),
    evidenceManifest: ast.evidenceManifest.map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      details: e.details,
      imageAssetId: e.imageCue.imageAssetId,
      onCollect: emitDialogueItems(e.onCollect),
      onReexamine: emitNullableDialogueItems(e.onReexamine),
    })),
    statementManifest: ast.statementManifest.map((s) => ({
      id: s.id,
      speaker: s.speaker,
      content: s.content,
      onAcquire: emitDialogueItems(s.onAcquire),
      onReexamine: emitNullableDialogueItems(s.onReexamine),
    })),
    outro: {
      unlock: ast.outro.unlock,
      dialogue: emitDialogueItems(ast.outro.dialogue),
    },
  };
}

export function emitInterrogationScene(
  ast: ASTInterrogationScene,
): JSONInterrogationScene {
  return {
    type: "interrogation",
    id: ast.id,
    title: ast.title,
    intro: emitDialogueItems(ast.intro),
    assetRefs: ast.assetRefs,
    phases: ast.phases.map((phase) => {
      const common = {
        id: phase.id,
        label: phase.label,
        subject: {
          id: phase.subject.id,
          name: phase.subject.name,
          role: phase.subject.role,
          bio: phase.subject.bio,
        },
        required: phase.required,
        status: phase.status,
        unlock: phase.unlock,
        reveals: phase.reveals,
        sceneTag: phase.sceneTag,
        ...emitVisualFields(phase.assetCue),
        entryDialogue: emitDialogueItems(phase.entryDialogue),
      };
      if (phase.kind === "inquiry") {
        return {
          kind: "inquiry",
          ...common,
          complete: phase.complete,
          questions: phase.questions.map((q) => ({
            id: q.id,
            label: q.label,
            kind: q.kind,
            parentQuestionId: q.parentQuestionId,
            status: q.status,
            required: q.required,
            unlock: q.unlock,
            reveals: q.reveals,
            answerDialogue: emitDialogueItems(q.answerDialogue),
            onReask: emitNullableDialogueItems(q.onReask),
          })),
        };
      }
      return {
        kind: "testimony",
        ...common,
        statements: phase.statements.map((s) => ({
          id: s.id,
          label: s.label,
          content: s.content,
          contradiction: s.contradiction,
          onCorrect: s.onCorrect,
          onWrong: s.onWrong,
          onPress: emitNullableDialogueItems(s.onPress),
          onPresent: emitNullableDialogueItems(s.onPresent),
          onWrongPresent: emitNullableDialogueItems(s.onWrongPresent),
          reveals: s.reveals,
        })),
        results: phase.results.map((r) => ({
          id: r.id,
          label: r.label,
          reveals: r.reveals,
          dialogue: emitDialogueItems(r.dialogue),
        })),
      };
    }),
    evidenceManifest: ast.evidenceManifest.map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      details: e.details,
      imageAssetId: e.imageCue.imageAssetId,
      onCollect: emitDialogueItems(e.onCollect),
      onReexamine: emitNullableDialogueItems(e.onReexamine),
    })),
    statementManifest: ast.statementManifest.map((s) => ({
      id: s.id,
      speaker: s.speaker,
      content: s.content,
      onAcquire: emitDialogueItems(s.onAcquire),
      onReexamine: emitNullableDialogueItems(s.onReexamine),
    })),
    outro: {
      unlock: ast.outro.unlock,
      dialogue: emitDialogueItems(ast.outro.dialogue),
    },
  };
}

function emitDialogueItems(items: DialogueItem[]): JSONDialogueItem[] {
  return items.map(emitDialogueItem);
}

function emitNullableDialogueItems(
  items: DialogueItem[] | null,
): JSONDialogueItem[] | null {
  return items ? emitDialogueItems(items) : null;
}

function emitDialogueItem(item: DialogueItem): JSONDialogueItem {
  if (item.kind === "sceneTag") {
    return {
      ...item,
      assetCue: emitVisualAssetCue(item.assetCue ?? null),
    };
  }
  if (item.kind !== "line") return item;
  return {
    ...item,
    expression: item.expression ?? null,
    portrait: item.portrait ?? null,
  };
}

function emitVisualAssetCue(
  cue: VisualAssetCue | null,
): JSONVisualAssetCue | null {
  if (!cue) return null;
  return {
    backgroundAssetId: cue.backgroundAssetId,
    bgm: cue.bgm,
    bgs: cue.bgs,
  };
}

function emitVisualFields(cue: VisualAssetCue | null): JSONVisualAssetCue {
  return {
    backgroundAssetId: cue?.backgroundAssetId ?? null,
    bgm: cue?.bgm ?? null,
    bgs: cue?.bgs ?? null,
  };
}

export function emitChaptersIndex(chapters: ASTChapter[]): JSONChaptersIndex {
  return {
    chapters: chapters.map((c) => ({
      id: c.dirName,
      title: c.title,
      summary: c.summary,
      scenes: c.sceneFiles.map((f) => {
        const type = inferType(f);
        const jsonName = f.replace(/\.md$/, ".json");
        return { type, file: `${c.dirName}/${jsonName}` };
      }),
    })),
  };
}

function inferType(
  filename: string,
): JSONChaptersIndex["chapters"][number]["scenes"][number]["type"] {
  if (filename.startsWith("interrogation_scene_")) return "interrogation";
  if (filename.startsWith("investigation_scene_")) return "investigation";
  if (filename.startsWith("scene_")) return "linear";
  throw new Error(
    `emit: cannot infer scene type from filename "${filename}". Validator should have caught this.`,
  );
}
