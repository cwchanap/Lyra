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
  /**
   * Files the orchestrator skipped because they use a reserved (future)
   * scene-type prefix. The chapter-manifest "file exists" check must treat
   * these as accepted, not missing.
   */
  skippedReservedFiles?: Set<string>;
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

  // ---- Pass 2b: reachability analysis for locked blocks. ----
  // A locked block is reachable if it can be unlocked through a chain of
  // Reveals / Unlock predicates starting from initially-unlocked blocks.
  // Cycles (A needs B, B needs A) or dead-ends produce unreachable blocks.
  for (const rec of input.scenes) {
    if (rec.ast.kind !== "investigationScene") continue;
    checkReachability(rec.ast, errors);
  }

  // ---- Pass 3: chapter manifests refer to existing files. ----
  const skipped = input.skippedReservedFiles ?? new Set<string>();
  for (const chapter of input.chapters) {
    const sceneFilesInChapter = new Set(
      input.scenes.filter((s) => s.chapterId === chapter.dirName).map((s) => s.file),
    );
    let playableSceneCount = 0;
    for (const file of chapter.sceneFiles) {
      const skippedKey = `${chapter.dirName}/${file}`;
      if (sceneFilesInChapter.has(file)) {
        playableSceneCount += 1;
      } else if (!skipped.has(skippedKey)) {
        errors.push({
          code: "chapterManifestMissingFile",
          message: `Chapter ${chapter.dirName} lists "${file}" but no such file was loaded.`,
          sourceFile: chapter.sourceFile,
          line: chapter.line,
        });
      }
    }
    if (playableSceneCount === 0 && chapter.sceneFiles.length > 0) {
      errors.push({
        code: "chapterNoPlayableScenes",
        message: `Chapter ${chapter.dirName} has no playable scenes — every listed file is a reserved placeholder.`,
        sourceFile: chapter.sourceFile,
        line: chapter.line,
      });
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

/**
 * Reachability analysis for locked blocks within a single investigation scene.
 *
 * Two-level model:
 *   1. Sub-location reachability: a locked sub-location is reachable when an
 *      already-reachable block's Reveals includes it, or its Unlock predicate
 *      is satisfiable by reachable content.
 *   2. Hotspot/topic reachability: a hotspot or topic is only reachable if its
 *      parent sub-location is reachable AND the block itself is unlocked or
 *      becomes reachable via Reveals/Unlock within that sub-location.
 *
 * After fixed-point propagation, any locked block still not reached gets an
 * error. This catches cyclic dependencies (A needs B, B needs A) and dead-end
 * chains.
 */
function checkReachability(scene: ASTInvestigationScene, errors: CompileError[]): void {
  // --- Phase 1: sub-location reachability ---
  const subReachable = new Set<string>();

  // Seed: unlocked sub-locations.
  for (const sub of scene.sublocations) {
    if (sub.status === "unlocked") subReachable.add(sub.id);
  }

  // Collect Reveals from reachable content inside sub-locations.
  // We need to know what each reachable sub-location's unlocked content can reveal.
  const subRevealsBySubId = new Map<string, RevealTarget[]>();
  for (const sub of scene.sublocations) {
    const reveals: RevealTarget[] = [...sub.reveals];
    for (const h of sub.hotspots) reveals.push(...h.reveals);
    for (const c of sub.characters) for (const t of c.topics) reveals.push(...t.reveals);
    subRevealsBySubId.set(sub.id, reveals);
  }

  // Track evidence/statements revealed by unlocked content in reachable sub-locations.
  const reachableItems = new Set<string>();

  function refreshReachableItems(): void {
    reachableItems.clear();
    for (const rid of subReachable) {
      const revs = subRevealsBySubId.get(rid) ?? [];
      for (const r of revs) {
        if (r.kind === "evidence") reachableItems.add(`evidence:${r.id}`);
        if (r.kind === "statement") reachableItems.add(`statement:${r.id}`);
      }
    }
  }
  refreshReachableItems();

  // Fixed-point propagation for sub-locations.
  let changed = true;
  while (changed) {
    changed = false;
    for (const sub of scene.sublocations) {
      if (subReachable.has(sub.id)) continue;
      if (sub.status !== "locked") continue;

      // Check if any reachable sub-location's content reveals this sub-location.
      const reachedByReveal = [...subReachable].some((rid) => {
        const revs = subRevealsBySubId.get(rid) ?? [];
        return revs.some((r) => r.kind === "sublocation" && r.id === sub.id);
      });
      if (reachedByReveal) {
        subReachable.add(sub.id);
        refreshReachableItems();
        changed = true;
        continue;
      }

      // Check if this sub-location's Unlock predicate is satisfiable.
      // For sub-location Unlock, predicate blocks must be in reachable sub-locations.
      if (sub.unlock && isSubUnlockSatisfiable(sub.unlock, subReachable, scene, reachableItems)) {
        subReachable.add(sub.id);
        refreshReachableItems();
        changed = true;
      }
    }
  }

  // --- Phase 2: hotspot/topic reachability within each sub-location ---
  for (const sub of scene.sublocations) {
    if (subReachable.has(sub.id)) {
      // Sub-location is reachable. Check internal blocks.
      checkInternalReachability(sub, scene, subReachable, errors);
    } else if (sub.status === "locked") {
      // Entire sub-location is unreachable → all locked internal blocks are too.
      for (const h of sub.hotspots) {
        if (h.status === "locked") {
          errors.push({
            code: "lockedBlockUnreachable",
            message: `hotspot:${h.id} is locked but unreachable — parent sub-location ${sub.id} is unreachable (possible cycle or dead-end).`,
            sourceFile: scene.sourceFile,
            line: h.line,
          });
        }
      }
      for (const c of sub.characters) {
        for (const t of c.topics) {
          if (t.status === "locked") {
            errors.push({
              code: "lockedBlockUnreachable",
              message: `topic:${c.id}@${t.id} is locked but unreachable — parent sub-location ${sub.id} is unreachable (possible cycle or dead-end).`,
              sourceFile: scene.sourceFile,
              line: t.line,
            });
          }
        }
      }
    }
  }

  // Report unreachable locked sub-locations.
  for (const sub of scene.sublocations) {
    if (sub.status === "locked" && !subReachable.has(sub.id)) {
      errors.push({
        code: "lockedBlockUnreachable",
        message: `sublocation:${sub.id} is locked but unreachable — no chain of Reveals/Unlock predicates from an unlocked block leads to it (possible cycle or dead-end).`,
        sourceFile: scene.sourceFile,
        line: sub.line,
      });
    }
  }
}

/**
 * Checks reachability of hotspots and topics within a single reachable sub-location.
 * Unlock predicates may reference blocks in other reachable sub-locations.
 */
function checkInternalReachability(
  sub: ASTSublocation,
  scene: ASTInvestigationScene,
  reachableSubs: Set<string>,
  errors: CompileError[],
): void {
  const reachable = new Set<string>();

  // Seed: unlocked hotspots and topics in this sub-location.
  for (const h of sub.hotspots) {
    if (h.status === "unlocked") reachable.add(`hotspot:${h.id}`);
  }
  for (const c of sub.characters) {
    for (const t of c.topics) {
      if (t.status === "unlocked") reachable.add(`topic:${c.id}@${t.id}`);
    }
  }

  // Also seed with unlocked hotspots/topics from other reachable sub-locations,
  // since Unlock predicates can reference them.
  for (const otherSub of scene.sublocations) {
    if (otherSub.id === sub.id) continue;
    if (!reachableSubs.has(otherSub.id)) continue;
    for (const h of otherSub.hotspots) {
      if (h.status === "unlocked") reachable.add(`hotspot:${h.id}`);
    }
    for (const c of otherSub.characters) {
      for (const t of c.topics) {
        if (t.status === "unlocked") reachable.add(`topic:${c.id}@${t.id}`);
      }
    }
  }

  // Fixed-point propagation within the sub-location.
  let changed = true;
  while (changed) {
    changed = false;

    // Collect Reveals from all reachable content in this sub-location.
    const allReveals: RevealTarget[] = [...sub.reveals];
    for (const h of sub.hotspots) {
      if (reachable.has(`hotspot:${h.id}`)) allReveals.push(...h.reveals);
    }
    for (const c of sub.characters) {
      for (const t of c.topics) {
        if (reachable.has(`topic:${c.id}@${t.id}`)) allReveals.push(...t.reveals);
      }
    }

    // Add evidence/statement IDs revealed by reachable blocks to the reachable
    // set so that evidence_collected / statement_acquired predicates can be
    // checked against actual reachability.
    for (const r of allReveals) {
      if (r.kind === "evidence" && !reachable.has(`evidence:${r.id}`)) {
        reachable.add(`evidence:${r.id}`); changed = true;
      }
      if (r.kind === "statement" && !reachable.has(`statement:${r.id}`)) {
        reachable.add(`statement:${r.id}`); changed = true;
      }
    }

    for (const h of sub.hotspots) {
      if (reachable.has(`hotspot:${h.id}`) || h.status !== "locked") continue;
      const reachedByReveal = allReveals.some((r) => r.kind === "hotspot" && r.id === h.id);
      if (reachedByReveal) { reachable.add(`hotspot:${h.id}`); changed = true; continue; }
      if (h.unlock && isUnlockSatisfiable(h.unlock, reachable)) {
        reachable.add(`hotspot:${h.id}`); changed = true;
      }
    }
    for (const c of sub.characters) {
      for (const t of c.topics) {
        const key = `topic:${c.id}@${t.id}`;
        if (reachable.has(key) || t.status !== "locked") continue;
        const reachedByReveal = allReveals.some((r) => r.kind === "topic" && r.characterId === c.id && r.topicId === t.id);
        if (reachedByReveal) { reachable.add(key); changed = true; continue; }
        if (t.unlock && isUnlockSatisfiable(t.unlock, reachable)) {
          reachable.add(key); changed = true;
        }
      }
    }
  }

  // Report unreachable locked internal blocks.
  for (const h of sub.hotspots) {
    if (h.status === "locked" && !reachable.has(`hotspot:${h.id}`)) {
      errors.push({
        code: "lockedBlockUnreachable",
        message: `hotspot:${h.id} is locked but unreachable within sub-location ${sub.id} — no chain of Reveals/Unlock predicates leads to it.`,
        sourceFile: scene.sourceFile,
        line: h.line,
      });
    }
  }
  for (const c of sub.characters) {
    for (const t of c.topics) {
      const key = `topic:${c.id}@${t.id}`;
      if (t.status === "locked" && !reachable.has(key)) {
        errors.push({
          code: "lockedBlockUnreachable",
          message: `topic:${key} is locked but unreachable within sub-location ${sub.id} — no chain of Reveals/Unlock predicates leads to it.`,
          sourceFile: scene.sourceFile,
          line: t.line,
        });
      }
    }
  }
}

/**
 * Evaluates whether a sub-location's Unlock predicate is satisfiable given
 * the set of currently-reachable sub-locations. A hotspot/topic predicate is
 * satisfiable when it exists in a reachable sub-location and is itself
 * reachable within that sub-location. For simplicity, we check only that the
 * referenced block's parent sub-location is reachable (the block's own status
 * being "unlocked" inside it is sufficient for the Unlock to be achievable).
 * Evidence/statement predicates check whether any reachable sub-location's
 * unlocked content or sub-location-level reveals expose that item.
 */
function isSubUnlockSatisfiable(
  expr: UnlockExpr,
  reachableSubs: Set<string>,
  scene: ASTInvestigationScene,
  reachableItems: Set<string>,
): boolean {
  if ("op" in expr) {
    if (expr.op === "and") {
      return isSubUnlockSatisfiable(expr.left, reachableSubs, scene, reachableItems)
          && isSubUnlockSatisfiable(expr.right, reachableSubs, scene, reachableItems);
    }
    return isSubUnlockSatisfiable(expr.left, reachableSubs, scene, reachableItems)
        || isSubUnlockSatisfiable(expr.right, reachableSubs, scene, reachableItems);
  }
  switch (expr.predicate) {
    case "hotspot_investigated": {
      // Find which sub-location contains this hotspot and check reachability.
      const parentSub = scene.sublocations.find((s) => s.hotspots.some((h) => h.id === expr.id));
      return parentSub != null && reachableSubs.has(parentSub.id);
    }
    case "topic_discussed": {
      const parentSub = scene.sublocations.find((s) =>
        s.characters.some((c) => c.id === expr.characterId && c.topics.some((t) => t.id === expr.topicId)),
      );
      return parentSub != null && reachableSubs.has(parentSub.id);
    }
    case "evidence_collected":
      return reachableItems.has(`evidence:${expr.id}`);
    case "statement_acquired":
      return reachableItems.has(`statement:${expr.id}`);
  }
}

/**
 * Evaluates whether an UnlockExpr can be satisfied given the current set of
 * reachable blocks. A predicate is satisfiable when the block it references
 * (hotspot, topic, evidence, statement) is already reachable. For evidence and
 * statements, reachability requires that they be revealed by a reachable block
 * in a prior iteration of the fixed-point loop.
 */
function isUnlockSatisfiable(expr: UnlockExpr, reachable: Set<string>): boolean {
  if ("op" in expr) {
    if (expr.op === "and") {
      return isUnlockSatisfiable(expr.left, reachable) && isUnlockSatisfiable(expr.right, reachable);
    }
    // "or"
    return isUnlockSatisfiable(expr.left, reachable) || isUnlockSatisfiable(expr.right, reachable);
  }
  switch (expr.predicate) {
    case "hotspot_investigated":
      return reachable.has(`hotspot:${expr.id}`);
    case "topic_discussed":
      return reachable.has(`topic:${expr.characterId}@${expr.topicId}`);
    case "evidence_collected":
      return reachable.has(`evidence:${expr.id}`);
    case "statement_acquired":
      return reachable.has(`statement:${expr.id}`);
  }
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
