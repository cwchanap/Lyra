// =============================================================================
// packages/scripts/compile-scenes/emitter.ts
//
// Pure functions: AST → JSON. No I/O. The orchestrator owns disk writes.
// =============================================================================

import type {
  AnalysisSceneRecord,
  ASTChapter,
  ASTInterrogationScene,
  ASTInvestigationScene,
  ASTLinearScene,
  ASTStoryCatalog,
  ASTTestimony,
  ASTTestimonyLine,
  AssetRef,
  CaseRecordProvenance,
  CompiledCaseRecordCorpus,
  CompileError,
  DialogueItem,
  JSONChaptersIndex,
  JSONAnalysisBoard,
  JSONAnalysisBoardCommon,
  JSONAnalysisScene,
  JSONDialogueItem,
  JSONInterrogationScene,
  JSONInvestigationScene,
  JSONLinearScene,
  JSONTestimony,
  JSONTestimonyLine,
  JSONVisualAssetCue,
  StoryCatalogJsonV2,
  StoryUnlockExpr,
  VisualAssetCue,
} from "./types";
import type {
  AnalysisBoardJson,
  NormalizedAnalysisScene,
} from "./validator-analysis";

export function emitStoryCatalog(
  catalog: ASTStoryCatalog,
  caseRecords: CompiledCaseRecordCorpus,
  analysisScenes: readonly AnalysisSceneRecord[] = [],
): StoryCatalogJsonV2 {
  return {
    schemaVersion: 2,
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
    sourceGroups: caseRecords.sourceGroups.map((group) => ({
      ...group,
      members: group.members.map((member) => ({ ...member })),
    })),
    evidenceIndex: caseRecords.evidenceIndex.map((record) => ({
      ...record,
      provenance: copyCaseRecordProvenance(record.provenance),
    })),
    statementsIndex: caseRecords.statementsIndex.map((record) => ({
      ...record,
      provenance: copyCaseRecordProvenance(record.provenance),
    })),
    analysisScenes: analysisScenes
      .map(({ chapterId, ast }) => ({ chapterId, sceneId: ast.id }))
      .sort(compareAnalysisSceneRefs),
    analysisBoards: analysisScenes
      .flatMap(({ chapterId, ast }) =>
        ast.boards.map((board) => ({
          chapterId,
          sceneId: ast.id,
          boardId: board.id,
        })),
      )
      .sort(compareAnalysisBoardRefs),
  };
}

function compareAnalysisSceneRefs(
  left: { chapterId: string; sceneId: string },
  right: { chapterId: string; sceneId: string },
): number {
  return (
    compareText(left.chapterId, right.chapterId) ||
    compareText(left.sceneId, right.sceneId)
  );
}

function compareAnalysisBoardRefs(
  left: { chapterId: string; sceneId: string; boardId: string },
  right: { chapterId: string; sceneId: string; boardId: string },
): number {
  return (
    compareAnalysisSceneRefs(left, right) ||
    compareText(left.boardId, right.boardId)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function emitLinearScene(ast: ASTLinearScene): JSONLinearScene {
  return {
    type: "linear",
    id: ast.id,
    title: ast.title,
    summary: ast.summary,
    queue: emitDialogueItems(ast.queue),
    assetRefs: emitAssetRefs(ast.assetRefs),
  };
}

export function emitInvestigationScene(
  ast: ASTInvestigationScene,
  caseRecords: CompiledCaseRecordCorpus,
): JSONInvestigationScene {
  return {
    type: "investigation",
    id: ast.id,
    title: ast.title,
    summary: ast.summary,
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
      provenance: provenanceForRecord(
        ast,
        "evidence",
        e.id,
        e.sourceFile,
        e.line,
        caseRecords,
      ),
      onCollect: emitDialogueItems(e.onCollect),
      onReexamine: emitNullableDialogueItems(e.onReexamine),
    })),
    statementManifest: ast.statementManifest.map((s) => ({
      id: s.id,
      speaker: s.speaker,
      content: s.content,
      provenance: provenanceForRecord(
        ast,
        "statement",
        s.id,
        s.sourceFile,
        s.line,
        caseRecords,
      ),
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
  caseRecords: CompiledCaseRecordCorpus,
): JSONInterrogationScene {
  return {
    type: "interrogation",
    id: ast.id,
    title: ast.title,
    summary: ast.summary,
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
      provenance: provenanceForRecord(
        ast,
        "evidence",
        e.id,
        e.sourceFile,
        e.line,
        caseRecords,
      ),
      onCollect: emitDialogueItems(e.onCollect),
      onReexamine: emitNullableDialogueItems(e.onReexamine),
    })),
    statementManifest: ast.statementManifest.map((s) => ({
      id: s.id,
      speaker: s.speaker,
      content: s.content,
      provenance: provenanceForRecord(
        ast,
        "statement",
        s.id,
        s.sourceFile,
        s.line,
        caseRecords,
      ),
      onAcquire: emitDialogueItems(s.onAcquire),
      onReexamine: emitNullableDialogueItems(s.onReexamine),
    })),
    outro: {
      unlock: ast.outro.unlock,
      dialogue: emitDialogueItems(ast.outro.dialogue),
    },
  };
}

/** Emits only the Task-4-normalized analysis definition, never authored rules. */
export function emitAnalysisScene(
  scene: NormalizedAnalysisScene,
): JSONAnalysisScene {
  return {
    type: "analysis",
    id: scene.sceneId,
    title: scene.title,
    summary: scene.summary,
    assetRefs: emitAssetRefs(scene.assetRefs),
    intro: emitDialogueItems(scene.intro),
    boards: scene.boards.map(emitAnalysisBoard),
    outro: emitDialogueItems(scene.outro),
  };
}

function emitAnalysisBoard(board: AnalysisBoardJson): JSONAnalysisBoard {
  const common: JSONAnalysisBoardCommon = {
    id: board.common.id,
    label: board.common.label,
    prompt: board.common.prompt,
    unlock: copyStoryUnlockExpr(board.common.unlock),
    reveals: board.common.reveals.map(copyStoryRevealTarget),
    feedback: {
      ...board.common.feedback,
      incorrectSelections: board.common.feedback.incorrectSelections.map(
        (selection) => ({
          cards: [...selection.cards],
          feedback: selection.feedback,
        }),
      ),
    },
    cards: board.common.cards.map((card) => ({
      id: card.id,
      label: card.label,
      source: { ...card.source },
      summary: card.summary,
    })),
    resultDialogue: emitDialogueItems(board.common.resultDialogue),
  };

  switch (board.kind) {
    case "classify":
      return {
        kind: "classify",
        common,
        groups: board.groups.map((group) => ({ ...group })),
        acceptedGroupByCard: { ...board.acceptedGroupByCard },
      };
    case "order":
      return {
        kind: "order",
        common,
        acceptedOrder: [...board.acceptedOrder],
        fixedAnchors: board.fixedAnchors.map((anchor) => ({ ...anchor })),
      };
    case "threshold":
      return {
        kind: "threshold",
        common,
        minimumSelected: board.minimumSelected,
        acceptedSelections: board.acceptedSelections.map((selection) => [
          ...selection,
        ]),
      };
  }
}

function copyStoryRevealTarget(
  target: JSONAnalysisBoardCommon["reveals"][number],
) {
  return { ...target };
}

function copyStoryUnlockExpr(
  expr: StoryUnlockExpr | null,
): StoryUnlockExpr | null {
  if (expr === null) return null;
  return copyUnlockExpr(expr);
}

function copyUnlockExpr(expr: StoryUnlockExpr): StoryUnlockExpr {
  if ("op" in expr) {
    if (expr.op === "at_least") {
      return {
        op: "at_least",
        count: expr.count,
        conditions: expr.conditions.map(copyUnlockExpr),
      };
    }
    return {
      op: expr.op,
      left: copyUnlockExpr(expr.left),
      right: copyUnlockExpr(expr.right),
    };
  }
  return { ...expr };
}

export class CaseRecordEmissionError extends Error implements CompileError {
  readonly code = "caseRecordEmissionMismatch";

  constructor(
    message: string,
    readonly sourceFile: string,
    readonly line: number,
  ) {
    super(message);
    this.name = "CaseRecordEmissionError";
  }
}

function provenanceForRecord(
  ast: ASTInvestigationScene | ASTInterrogationScene,
  kind: "evidence" | "statement",
  id: string,
  sourceFile: string,
  line: number,
  caseRecords: CompiledCaseRecordCorpus,
): CaseRecordProvenance {
  const key = `${kind}:${id}`;
  const record = caseRecords.recordsByKey.get(key);
  if (
    !record ||
    record.target.kind !== kind ||
    record.target.id !== id ||
    record.sceneId !== ast.id ||
    record.sourceFile !== sourceFile
  ) {
    throw new CaseRecordEmissionError(
      `Case record ${key} in scene "${ast.id}" is missing from the compiled corpus or has a different scene origin.`,
      sourceFile,
      line,
    );
  }
  return copyCaseRecordProvenance(record.provenance);
}

function copyCaseRecordProvenance(
  provenance: CaseRecordProvenance,
): CaseRecordProvenance {
  return {
    ...provenance,
    proofCapabilities: [...provenance.proofCapabilities],
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
    kind: item.kind,
    speaker: item.speaker,
    text: item.text,
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
  if (filename.startsWith("analysis_scene_")) return "analysis";
  if (filename.startsWith("interrogation_scene_")) return "interrogation";
  if (filename.startsWith("investigation_scene_")) return "investigation";
  if (filename.startsWith("scene_")) return "linear";
  throw new Error(
    `emit: cannot infer scene type from filename "${filename}". Validator should have caught this.`,
  );
}
