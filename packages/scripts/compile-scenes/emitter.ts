// =============================================================================
// packages/scripts/compile-scenes/emitter.ts
//
// Pure functions: AST → JSON. No I/O. The orchestrator owns disk writes.
// =============================================================================

import type {
  ASTChapter,
  ASTInterrogationScene,
  ASTInvestigationScene,
  ASTLinearScene,
  ASTStoryCatalog,
  ASTTestimony,
  ASTTestimonyLine,
  AssetRef,
  CaseRecordDefinitionIndex,
  DialogueItem,
  JSONChaptersIndex,
  JSONDialogueItem,
  JSONInterrogationScene,
  JSONInvestigationScene,
  JSONLinearScene,
  JSONTestimony,
  JSONTestimonyLine,
  JSONVisualAssetCue,
  StoryCatalogJson,
  VisualAssetCue,
} from "./types";
import type { SceneRecord } from "./validator";

export function emitStoryCatalog(
  catalog: ASTStoryCatalog,
  scenes: SceneRecord[],
): StoryCatalogJson {
  const evidenceIndex: CaseRecordDefinitionIndex[] = [];
  const statementsIndex: CaseRecordDefinitionIndex[] = [];

  for (const record of scenes) {
    if (
      record.ast.kind !== "investigationScene" &&
      record.ast.kind !== "interrogationScene"
    ) {
      continue;
    }
    for (const evidence of record.ast.evidenceManifest) {
      evidenceIndex.push({
        id: evidence.id,
        chapterId: record.chapterId,
        sceneId: record.ast.id,
      });
    }
    for (const statement of record.ast.statementManifest) {
      statementsIndex.push({
        id: statement.id,
        chapterId: record.chapterId,
        sceneId: record.ast.id,
      });
    }
  }

  const byId = (
    left: CaseRecordDefinitionIndex,
    right: CaseRecordDefinitionIndex,
  ) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

  return {
    schemaVersion: 1,
    facts: catalog.facts.map(({ id, label, summary, details, category }) => ({
      id,
      label,
      summary,
      details,
      category,
    })),
    questions: catalog.questions.map(
      ({ id, label, summary, resolvedByFactIds }) => ({
        id,
        label,
        summary,
        resolvedByFactIds: resolvedByFactIds.map((reference) => reference.id),
      }),
    ),
    objectives: [...catalog.objectives]
      .sort((left, right) =>
        left.sortOrder < right.sortOrder
          ? -1
          : left.sortOrder > right.sortOrder
            ? 1
            : left.id < right.id
              ? -1
              : left.id > right.id
                ? 1
                : 0,
      )
      .map(({ id, label, summary, kind, sortOrder }) => ({
        id,
        label,
        summary,
        kind,
        sortOrder,
      })),
    authorizations: catalog.authorizations.map(
      ({ id, label, summary, grantingAuthority }) => ({
        id,
        label,
        summary,
        grantingAuthority,
      }),
    ),
    evidenceIndex: evidenceIndex.sort(byId),
    statementsIndex: statementsIndex.sort(byId),
  };
}

export function emitLinearScene(ast: ASTLinearScene): JSONLinearScene {
  return {
    type: "linear",
    id: ast.id,
    title: ast.title,
    queue: emitDialogueItems(ast.queue),
    assetRefs: emitAssetRefs(ast.assetRefs),
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
    assetRefs: emitAssetRefs(ast.assetRefs),
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
      sourceSublocationId: e.sourceSublocationId,
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
    assetRefs: emitAssetRefs(ast.assetRefs),
    phases: ast.phases.map((phase) => ({
      kind: "inquiry",
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
      complete: phase.complete,
      questions: phase.questions.map((q) => ({
        id: q.id,
        label: q.label,
        status: q.status,
        required: q.required,
        unlock: q.unlock,
        reveals: q.reveals,
        testimony: emitTestimony(q.testimony),
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

function emitAssetRefs(assetRefs: AssetRef[]): AssetRef[] {
  return [...assetRefs].sort((left, right) => {
    const byType = left.type < right.type ? -1 : left.type > right.type ? 1 : 0;
    return byType !== 0
      ? byType
      : left.assetId < right.assetId
        ? -1
        : left.assetId > right.assetId
          ? 1
          : 0;
  });
}

function emitDialogueItems(items: DialogueItem[]): JSONDialogueItem[] {
  return items.map(emitDialogueItem);
}

// The AST leaves un-authored dialogue arrays as null (defaultChallenge,
// defaultWrong, and a line's challenge/onCorrect/onWrongEvidence on an
// honest line). The Rust runtime deserializes these fields with
// #[serde(default)] Vec<DialogueItem>, which only tolerates an ABSENT key,
// not an explicit JSON null — so every one of these must emit as `[]`,
// never `null`. Only `contradiction` stays nullable (deserialized as
// Option in Rust, which does accept null).
function emitTestimony(ast: ASTTestimony): JSONTestimony {
  return {
    onLoop: emitDialogueItems(ast.onLoop),
    loopPrompt: emitDialogueItems(ast.loopPrompt ?? []),
    defaultChallenge: emitDialogueItems(ast.defaultChallenge ?? []),
    defaultWrong: emitDialogueItems(ast.defaultWrong ?? []),
    wrongReply: emitDialogueItems(ast.wrongReply ?? []),
    lines: ast.lines.map(emitTestimonyLine),
  };
}

function emitTestimonyLine(ast: ASTTestimonyLine): JSONTestimonyLine {
  return {
    id: ast.id,
    label: ast.label,
    content: emitDialogueItems(ast.content),
    contradiction: ast.contradiction,
    challenge: emitDialogueItems(ast.challenge ?? []),
    onCorrect: emitDialogueItems(ast.onCorrect ?? []),
    onWrongEvidence: emitDialogueItems(ast.onWrongEvidence ?? []),
    reveals: ast.reveals,
  };
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
