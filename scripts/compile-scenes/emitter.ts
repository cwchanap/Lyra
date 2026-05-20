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
  JSONChaptersIndex,
  JSONInterrogationScene,
  JSONInvestigationScene,
  JSONLinearScene,
} from "./types";

export function emitLinearScene(ast: ASTLinearScene): JSONLinearScene {
  return {
    type: "linear",
    id: ast.id,
    title: ast.title,
    queue: ast.queue,
  };
}

export function emitInvestigationScene(ast: ASTInvestigationScene): JSONInvestigationScene {
  return {
    type: "investigation",
    id: ast.id,
    title: ast.title,
    intro: ast.intro,
    sublocations: ast.sublocations.map((sub) => ({
      id: sub.id,
      label: sub.label,
      status: sub.status,
      unlock: sub.unlock,
      reveals: sub.reveals,
      sceneTag: sub.sceneTag,
      transitionDialogue: sub.transitionDialogue,
      hotspots: sub.hotspots.map((h) => ({
        id: h.id,
        label: h.label,
        description: h.description,
        status: h.status,
        unlock: h.unlock,
        reveals: h.reveals,
        inspectDialogue: h.inspectDialogue,
        onReexamine: h.onReexamine,
      })),
      characters: sub.characters.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        bio: c.bio,
        topics: c.topics.map((t) => ({
          id: t.id,
          label: t.label,
          status: t.status,
          unlock: t.unlock,
          reveals: t.reveals,
          topicDialogue: t.topicDialogue,
          onReexamine: t.onReexamine,
        })),
      })),
    })),
    evidenceManifest: ast.evidenceManifest.map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      details: e.details,
      onCollect: e.onCollect,
      onReexamine: e.onReexamine,
    })),
    statementManifest: ast.statementManifest.map((s) => ({
      id: s.id,
      speaker: s.speaker,
      content: s.content,
      onAcquire: s.onAcquire,
      onReexamine: s.onReexamine,
    })),
    outro: {
      unlock: ast.outro.unlock,
      dialogue: ast.outro.dialogue,
    },
  };
}

export function emitInterrogationScene(ast: ASTInterrogationScene): JSONInterrogationScene {
  return {
    type: "interrogation",
    id: ast.id,
    title: ast.title,
    intro: ast.intro,
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
        entryDialogue: phase.entryDialogue,
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
            answerDialogue: q.answerDialogue,
            onReask: q.onReask,
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
          onPress: s.onPress,
          onPresent: s.onPresent,
          onWrongPresent: s.onWrongPresent,
          reveals: s.reveals,
        })),
        results: phase.results.map((r) => ({
          id: r.id,
          label: r.label,
          reveals: r.reveals,
          dialogue: r.dialogue,
        })),
      };
    }),
    evidenceManifest: ast.evidenceManifest.map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      details: e.details,
      onCollect: e.onCollect,
      onReexamine: e.onReexamine,
    })),
    statementManifest: ast.statementManifest.map((s) => ({
      id: s.id,
      speaker: s.speaker,
      content: s.content,
      onAcquire: s.onAcquire,
      onReexamine: s.onReexamine,
    })),
    outro: {
      unlock: ast.outro.unlock,
      dialogue: ast.outro.dialogue,
    },
  };
}

export function emitChaptersIndex(chapters: ASTChapter[]): JSONChaptersIndex {
  return {
    chapters: chapters.map((c) => ({
      id: c.dirName,
      title: c.title,
      summary: c.summary,
      scenes: c.sceneFiles
        .map((f) => {
          const type = inferType(f);
          const jsonName = f.replace(/\.md$/, ".json");
          return { type, file: `${c.dirName}/${jsonName}` };
        }),
    })),
  };
}

function inferType(filename: string): JSONChaptersIndex["chapters"][number]["scenes"][number]["type"] {
  if (filename.startsWith("interrogation_scene_")) return "interrogation";
  if (filename.startsWith("investigation_scene_")) return "investigation";
  if (filename.startsWith("scene_")) return "linear";
  throw new Error(`emit: cannot infer scene type from filename "${filename}". Validator should have caught this.`);
}
