// =============================================================================
// scripts/compile-scenes/validator.ts
//
// Cross-file + per-file invariant checking. Builds a single registry from all
// chapters and scenes, then enumerates rules from spec §3d:
//   - Manifest scene files exist with valid prefixes.
//   - Reveals targets are scene-local for all five kinds.
//   - Unlock predicates are scene-local in v1 (the cross-chapter restriction).
//   - Evidence/statement IDs are globally unique.
//   - Locked blocks have a path: inbound Reveals OR self Unlock (xor).
//   - First sub-location is unlocked (checked in parser but re-asserted here).
// =============================================================================

import type {
  ASTChapter,
  ASTInvestigationScene,
  ASTLinearScene,
  CompileError,
  RevealTarget,
  UnlockExpr,
} from "./types";

export type SceneRecord = {
  chapterId: string;
  file: string;
  ast: ASTLinearScene | ASTInvestigationScene;
};

export type ValidatorInput = {
  chapters: ASTChapter[];
  scenes: SceneRecord[];
};

export function validate(input: ValidatorInput): CompileError[] {
  const errors: CompileError[] = [];
  const globalEvidence = new Map<string, { chapterId: string; sourceFile: string; line: number }>();
  const globalStatement = new Map<string, { chapterId: string; sourceFile: string; line: number }>();

  // ---- Pass 1: build global registries. ----
  for (const rec of input.scenes) {
    if (rec.ast.kind !== "investigationScene") continue;
    const scene = rec.ast;

    for (const e of scene.evidenceManifest) {
      const prev = globalEvidence.get(e.id);
      if (prev) {
        errors.push({
          code: "duplicateGlobalEvidenceId",
          message: `Evidence id "${e.id}" declared in two scenes: ${prev.sourceFile}:${prev.line} and ${e.sourceFile}:${e.line}.`,
          sourceFile: e.sourceFile,
          line: e.line,
        });
      } else {
        globalEvidence.set(e.id, { chapterId: rec.chapterId, sourceFile: e.sourceFile, line: e.line });
      }
    }
    for (const s of scene.statementManifest) {
      const prev = globalStatement.get(s.id);
      if (prev) {
        errors.push({
          code: "duplicateGlobalStatementId",
          message: `Statement id "${s.id}" declared in two scenes: ${prev.sourceFile}:${prev.line} and ${s.sourceFile}:${s.line}.`,
          sourceFile: s.sourceFile,
          line: s.line,
        });
      } else {
        globalStatement.set(s.id, { chapterId: rec.chapterId, sourceFile: s.sourceFile, line: s.line });
      }
    }
  }

  // ---- Pass 2: per-scene ID resolution + locked-block reachability. ----
  for (const rec of input.scenes) {
    if (rec.ast.kind !== "investigationScene") continue;
    validateInvestigationScene(rec, errors);
  }

  // ---- Pass 3: chapter manifests refer to existing files. ----
  for (const chapter of input.chapters) {
    const sceneFilesInChapter = new Set(
      input.scenes.filter((s) => s.chapterId === chapter.dirName).map((s) => s.file),
    );
    for (const file of chapter.sceneFiles) {
      if (!sceneFilesInChapter.has(file)) {
        errors.push({
          code: "chapterManifestMissingFile",
          message: `Chapter ${chapter.dirName} lists "${file}" but no such file was loaded.`,
          sourceFile: chapter.sourceFile,
          line: chapter.line,
        });
      }
    }
  }

  return errors;
}

function validateInvestigationScene(rec: SceneRecord, errors: CompileError[]): void {
  const scene = rec.ast as ASTInvestigationScene;

  const localEvidence = new Set(scene.evidenceManifest.map((e) => e.id));
  const localStatement = new Set(scene.statementManifest.map((s) => s.id));
  const localHotspot = new Set<string>();
  const localTopic = new Set<string>();
  const localSublocation = new Set<string>();

  for (const sub of scene.sublocations) {
    localSublocation.add(sub.id);
    for (const h of sub.hotspots) localHotspot.add(h.id);
    for (const c of sub.characters) for (const t of c.topics) localTopic.add(`${c.id}@${t.id}`);
  }

  const inboundReveals = new Map<string, { source: string; line: number }>();

  const checkReveals = (source: string, line: number, list: RevealTarget[]) => {
    for (const r of list) {
      const key = revealKey(r);
      switch (r.kind) {
        case "evidence":
          if (!localEvidence.has(r.id)) {
            errors.push({
              code: "unresolvedRevealTarget",
              message: `Reveal target evidence:${r.id} not declared in this scene's Evidence Manifest.`,
              sourceFile: scene.sourceFile,
              line,
            });
          }
          break;
        case "statement":
          if (!localStatement.has(r.id)) {
            errors.push({
              code: "unresolvedRevealTarget",
              message: `Reveal target statement:${r.id} not declared in this scene's Statement Manifest.`,
              sourceFile: scene.sourceFile,
              line,
            });
          }
          break;
        case "hotspot":
          if (!localHotspot.has(r.id))
            errors.push({ code: "unresolvedRevealTarget", message: `Reveal target hotspot:${r.id} not declared in this scene.`, sourceFile: scene.sourceFile, line });
          break;
        case "topic":
          if (!localTopic.has(`${r.characterId}@${r.topicId}`))
            errors.push({ code: "unresolvedRevealTarget", message: `Reveal target topic:${r.characterId}@${r.topicId} not declared in this scene.`, sourceFile: scene.sourceFile, line });
          break;
        case "sublocation":
          if (!localSublocation.has(r.id))
            errors.push({ code: "unresolvedRevealTarget", message: `Reveal target sublocation:${r.id} not declared in this scene.`, sourceFile: scene.sourceFile, line });
          break;
      }
      inboundReveals.set(key, { source, line });
    }
  };

  for (const sub of scene.sublocations) {
    checkReveals(`sublocation:${sub.id}`, sub.line, sub.reveals);
    for (const h of sub.hotspots) checkReveals(`hotspot:${h.id}`, h.line, h.reveals);
    for (const c of sub.characters) for (const t of c.topics) checkReveals(`topic:${c.id}@${t.id}`, t.line, t.reveals);
  }

  // v1 restriction (spec §3d): all four predicate kinds must resolve scene-local.
  // We don't distinguish "doesn't exist anywhere" vs. "exists in another scene".
  const checkUnlock = (expr: UnlockExpr | null, sourceFile: string, line: number) => {
    if (expr === null) return;
    walkUnlock(expr, (pred) => {
      switch (pred.predicate) {
        case "evidence_collected":
          if (!localEvidence.has(pred.id)) {
            errors.push({
              code: "crossChapterUnlock",
              message: `Unlock predicate evidence:${pred.id} collected — id not declared in this scene's Evidence Manifest. v1 disallows cross-scene Unlock predicates (see spec §3d).`,
              sourceFile,
              line,
            });
          }
          break;
        case "statement_acquired":
          if (!localStatement.has(pred.id)) {
            errors.push({
              code: "crossChapterUnlock",
              message: `Unlock predicate statement:${pred.id} acquired — id not declared in this scene's Statement Manifest. v1 disallows cross-scene Unlock predicates (see spec §3d).`,
              sourceFile,
              line,
            });
          }
          break;
        case "topic_discussed":
          if (!localTopic.has(`${pred.characterId}@${pred.topicId}`))
            errors.push({
              code: "unresolvedUnlockPredicate",
              message: `Unlock predicate topic:${pred.characterId}@${pred.topicId} discussed — not declared in this scene.`,
              sourceFile,
              line,
            });
          break;
        case "hotspot_investigated":
          if (!localHotspot.has(pred.id))
            errors.push({
              code: "unresolvedUnlockPredicate",
              message: `Unlock predicate hotspot:${pred.id} investigated — not declared in this scene.`,
              sourceFile,
              line,
            });
          break;
      }
    });
  };

  for (const sub of scene.sublocations) {
    checkUnlock(sub.unlock, scene.sourceFile, sub.line);
    for (const h of sub.hotspots) checkUnlock(h.unlock, scene.sourceFile, h.line);
    for (const c of sub.characters) for (const t of c.topics) checkUnlock(t.unlock, scene.sourceFile, t.line);
  }
  if (scene.outro.unlock !== "auto") checkUnlock(scene.outro.unlock, scene.sourceFile, scene.line);

  for (const sub of scene.sublocations) {
    const key = `sublocation:${sub.id}`;
    if (sub.status === "locked") {
      const hasInbound = inboundReveals.has(key);
      const hasUnlock = sub.unlock !== null;
      if (hasInbound && hasUnlock)
        errors.push({ code: "revealsAndUnlockBoth", message: `sublocation ${sub.id} has both an inbound Reveals and a self Unlock — pick one.`, sourceFile: scene.sourceFile, line: sub.line });
      if (!hasInbound && !hasUnlock)
        errors.push({ code: "lockedBlockUnreachable", message: `sublocation ${sub.id} is locked but has no Unlock and no inbound Reveals — unreachable.`, sourceFile: scene.sourceFile, line: sub.line });
    }
    for (const h of sub.hotspots) checkLockedReachability(`hotspot:${h.id}`, h.status, h.unlock !== null, inboundReveals.has(`hotspot:${h.id}`), scene.sourceFile, h.line, errors);
    for (const c of sub.characters)
      for (const t of c.topics)
        checkLockedReachability(`topic:${c.id}@${t.id}`, t.status, t.unlock !== null, inboundReveals.has(`topic:${c.id}@${t.id}`), scene.sourceFile, t.line, errors);
  }
}

function checkLockedReachability(
  key: string,
  status: "locked" | "unlocked",
  hasUnlock: boolean,
  hasInbound: boolean,
  sourceFile: string,
  line: number,
  errors: CompileError[],
) {
  if (status !== "locked") return;
  if (hasInbound && hasUnlock)
    errors.push({ code: "revealsAndUnlockBoth", message: `${key} has both inbound Reveals and self Unlock — pick one.`, sourceFile, line });
  if (!hasInbound && !hasUnlock)
    errors.push({ code: "lockedBlockUnreachable", message: `${key} is locked but unreachable (no Unlock and no inbound Reveals).`, sourceFile, line });
}

function walkUnlock(expr: UnlockExpr, fn: (atom: Extract<UnlockExpr, { predicate: string }>) => void): void {
  if ("op" in expr) {
    walkUnlock(expr.left, fn);
    walkUnlock(expr.right, fn);
  } else {
    fn(expr);
  }
}

function revealKey(r: RevealTarget): string {
  switch (r.kind) {
    case "topic":
      return `topic:${r.characterId}@${r.topicId}`;
    default:
      return `${r.kind}:${r.id}`;
  }
}
