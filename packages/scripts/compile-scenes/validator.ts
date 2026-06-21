// =============================================================================
// packages/scripts/compile-scenes/validator.ts
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
  ASTInquiryPhase,
  ASTInterrogationScene,
  ASTTestimonyPhase,
  ASTTestimonyStatement,
  ASTInvestigationScene,
  ASTLinearScene,
  ASTSublocation,
  CompileError,
  InterrogationRevealTarget,
  InterrogationUnlockExpr,
  InventoryTarget,
  RevealTarget,
  UnlockExpr,
} from "./types";

export type SceneRecord = {
  chapterId: string;
  file: string;
  ast: ASTLinearScene | ASTInvestigationScene | ASTInterrogationScene;
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
  /**
   * Files the orchestrator did read but could not parse. They should not also
   * be reported as missing from the chapter manifest.
   */
  failedParseFiles?: Set<string>;
};

type CorpusContext = {
  globalEvidence: Map<
    string,
    { chapterId: string; sourceFile: string; line: number }
  >;
  globalStatement: Map<
    string,
    { chapterId: string; sourceFile: string; line: number }
  >;
  guaranteedInventoryBeforeScene: Map<string, Set<string>>;
};

export function validate(input: ValidatorInput): CompileError[] {
  const errors: CompileError[] = [];
  const globalEvidence = new Map<
    string,
    { chapterId: string; sourceFile: string; line: number }
  >();
  const globalStatement = new Map<
    string,
    { chapterId: string; sourceFile: string; line: number }
  >();

  // ---- Pass 1: build global registries. ----
  for (const rec of input.scenes) {
    if (
      rec.ast.kind !== "investigationScene" &&
      rec.ast.kind !== "interrogationScene"
    )
      continue;
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
        globalEvidence.set(e.id, {
          chapterId: rec.chapterId,
          sourceFile: e.sourceFile,
          line: e.line,
        });
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
        globalStatement.set(s.id, {
          chapterId: rec.chapterId,
          sourceFile: s.sourceFile,
          line: s.line,
        });
      }
    }
  }

  const guaranteedInventoryBeforeScene =
    buildGuaranteedInventoryBeforeScene(input);
  const corpusContext: CorpusContext = {
    globalEvidence,
    globalStatement,
    guaranteedInventoryBeforeScene,
  };

  // ---- Pass 2: per-scene ID resolution + locked-block reachability. ----
  for (const rec of input.scenes) {
    if (rec.ast.kind === "investigationScene")
      validateInvestigationScene(rec, errors);
    if (rec.ast.kind === "interrogationScene")
      validateInterrogationScene(rec, errors, corpusContext);
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
  const failedParse = input.failedParseFiles ?? new Set<string>();
  for (const chapter of input.chapters) {
    const sceneFilesInChapter = new Set(
      input.scenes
        .filter((s) => s.chapterId === chapter.dirName)
        .map((s) => s.file),
    );
    let playableSceneCount = 0;
    for (const file of chapter.sceneFiles) {
      const skippedKey = `${chapter.dirName}/${file}`;
      if (sceneFilesInChapter.has(file)) {
        playableSceneCount += 1;
      } else if (!skipped.has(skippedKey) && !failedParse.has(skippedKey)) {
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

function validateInterrogationScene(
  rec: SceneRecord,
  errors: CompileError[],
  corpusContext: CorpusContext,
): void {
  const scene = rec.ast as ASTInterrogationScene;
  const sceneKey = sceneRecordKey(rec);
  const guaranteedBefore =
    corpusContext.guaranteedInventoryBeforeScene.get(sceneKey) ??
    new Set<string>();

  const localEvidence = new Set(scene.evidenceManifest.map((e) => e.id));
  const localStatement = new Set(scene.statementManifest.map((s) => s.id));
  const localPhase = new Set<string>();
  const localQuestion = new Set<string>();
  const localTestimonyStatement = new Set<string>();
  const subjectById = new Map<
    string,
    { name: string; role: string; bio: string }
  >();
  const inboundReveals = new Map<string, Set<string>>();
  const interrogationFlow = analyzeInterrogationInventory(scene, {
    mode: "obtainable",
    initialInventory: guaranteedBefore,
  });
  const guaranteedInterrogationFlow = analyzeInterrogationInventory(scene, {
    mode: "guaranteed",
    initialInventory: guaranteedBefore,
  });

  const addInboundReveal = (target: string, source: string) => {
    const existing = inboundReveals.get(target) ?? new Set<string>();
    existing.add(source);
    inboundReveals.set(target, existing);
  };

  const checkDuplicate = (
    set: Set<string>,
    id: string,
    label: string,
    line: number,
  ) => {
    if (set.has(id)) {
      errors.push({
        code: "duplicateInterrogationId",
        message: `Duplicate ${label} id "${id}" within interrogation scene.`,
        sourceFile: scene.sourceFile,
        line,
      });
    }
    set.add(id);
  };

  for (const phase of scene.phases) {
    checkDuplicate(localPhase, phase.id, "phase", phase.line);
    const priorSubject = subjectById.get(phase.subject.id);
    if (priorSubject) {
      if (
        priorSubject.name !== phase.subject.name ||
        priorSubject.role !== phase.subject.role ||
        priorSubject.bio !== phase.subject.bio
      ) {
        errors.push({
          code: "interrogationSubjectConflict",
          message: `Subject id "${phase.subject.id}" is reused with different name, role, or bio.`,
          sourceFile: scene.sourceFile,
          line: phase.subject.line,
        });
      }
    } else {
      subjectById.set(phase.subject.id, {
        name: phase.subject.name,
        role: phase.subject.role,
        bio: phase.subject.bio,
      });
    }

    if (phase.kind === "inquiry") {
      for (const question of phase.questions) {
        checkDuplicate(localQuestion, question.id, "question", question.line);
      }
    } else {
      for (const statement of phase.statements) {
        checkDuplicate(
          localTestimonyStatement,
          statement.id,
          "testimony statement",
          statement.line,
        );
      }

      const resultIds = new Set<string>();
      for (const result of phase.results) {
        if (resultIds.has(result.id)) {
          errors.push({
            code: "duplicateInterrogationId",
            message: `Duplicate result id "${result.id}" within testimony phase "${phase.id}".`,
            sourceFile: scene.sourceFile,
            line: result.line,
          });
        }
        resultIds.add(result.id);
      }
    }
  }

  const checkReveals = (
    source: string,
    line: number,
    reveals: InterrogationRevealTarget[],
  ) => {
    for (const reveal of reveals) {
      const targetKey = interrogationRevealKey(reveal);
      switch (reveal.kind) {
        case "evidence":
          if (!localEvidence.has(reveal.id)) {
            errors.push({
              code: "interrogationRevealUnresolved",
              message: `Reveal target evidence:${reveal.id} not declared in this interrogation scene's Evidence Manifest.`,
              sourceFile: scene.sourceFile,
              line,
            });
          }
          break;
        case "statement":
          if (!localStatement.has(reveal.id)) {
            errors.push({
              code: "interrogationRevealUnresolved",
              message: `Reveal target statement:${reveal.id} not declared in this interrogation scene's Statement Manifest.`,
              sourceFile: scene.sourceFile,
              line,
            });
          }
          break;
        case "question":
          if (!localQuestion.has(reveal.id)) {
            errors.push({
              code: "interrogationRevealUnresolved",
              message: `Reveal target question:${reveal.id} not declared in this interrogation scene.`,
              sourceFile: scene.sourceFile,
              line,
            });
          }
          break;
        case "phase":
          if (!localPhase.has(reveal.id)) {
            errors.push({
              code: "interrogationRevealUnresolved",
              message: `Reveal target phase:${reveal.id} not declared in this interrogation scene.`,
              sourceFile: scene.sourceFile,
              line,
            });
          }
          break;
      }
      addInboundReveal(targetKey, source);
    }
  };

  const checkUnlock = (
    expr: InterrogationUnlockExpr | null,
    line: number,
    options: { checkCrossSceneInventory: boolean },
  ) => {
    if (expr === null) return;
    walkInterrogationUnlock(expr, (pred) => {
      switch (pred.predicate) {
        case "evidence_collected":
          if (!knownEvidence(pred.id, scene, corpusContext)) {
            errors.push({
              code: "interrogationUnlockUnresolved",
              message: `Unlock predicate evidence:${pred.id} collected — id not declared in any loaded Evidence Manifest.`,
              sourceFile: scene.sourceFile,
              line,
            });
          } else if (
            options.checkCrossSceneInventory &&
            !localEvidence.has(pred.id) &&
            !guaranteedBefore.has(`evidence:${pred.id}`)
          ) {
            errors.push(
              crossSceneInventoryError(scene, line, `evidence:${pred.id}`),
            );
          }
          break;
        case "statement_acquired":
          if (!knownStatement(pred.id, scene, corpusContext)) {
            errors.push({
              code: "interrogationUnlockUnresolved",
              message: `Unlock predicate statement:${pred.id} acquired — id not declared in any loaded Statement Manifest.`,
              sourceFile: scene.sourceFile,
              line,
            });
          } else if (
            options.checkCrossSceneInventory &&
            !localStatement.has(pred.id) &&
            !guaranteedBefore.has(`statement:${pred.id}`)
          ) {
            errors.push(
              crossSceneInventoryError(scene, line, `statement:${pred.id}`),
            );
          }
          break;
        case "question_answered":
          if (!localQuestion.has(pred.id)) {
            errors.push({
              code: "interrogationUnlockUnresolved",
              message: `Unlock predicate question:${pred.id} answered — question not declared in this interrogation scene.`,
              sourceFile: scene.sourceFile,
              line,
            });
          }
          break;
        case "phase_completed":
          if (!localPhase.has(pred.id)) {
            errors.push({
              code: "interrogationUnlockUnresolved",
              message: `Unlock predicate phase:${pred.id} completed — phase not declared in this interrogation scene.`,
              sourceFile: scene.sourceFile,
              line,
            });
          }
          break;
      }
    });
  };

  for (const phase of scene.phases) {
    const phaseSource = `phase:${phase.id}`;
    checkReveals(phaseSource, phase.line, phase.reveals);
    checkUnlock(phase.unlock, phase.line, { checkCrossSceneInventory: true });

    if (phase.kind === "inquiry") {
      if (phase.complete !== "auto")
        checkUnlock(phase.complete, phase.line, {
          checkCrossSceneInventory: false,
        });
      if (
        phase.required &&
        !guaranteedInterrogationFlow.phaseCompletable.get(phase.id)
      ) {
        errors.push({
          code: "interrogationNoValidCompletionPath",
          message: `Required inquiry phase "${phase.id}" has no satisfiable completion path.`,
          sourceFile: scene.sourceFile,
          line: phase.line,
        });
      }
      for (const question of phase.questions) {
        checkReveals(
          `question:${question.id}`,
          question.line,
          question.reveals,
        );
        checkUnlock(question.unlock, question.line, {
          checkCrossSceneInventory: false,
        });
      }
    } else {
      validateTestimonyPhaseResults(scene, phase, errors);
      if (
        phase.required &&
        !guaranteedInterrogationFlow.phaseCompletable.get(phase.id)
      ) {
        errors.push({
          code: "interrogationNoValidContradictionPath",
          message: `Required testimony phase "${phase.id}" has no valid Contradiction plus On Correct result path.`,
          sourceFile: scene.sourceFile,
          line: phase.line,
        });
      }
      const obtainableBeforePhase =
        interrogationFlow.beforePhase.get(phase.id) ?? new Set<string>();
      // Press reveals are obtainable within the phase: the player can press
      // any statement before presenting, so all statement-level reveals are
      // available as contradiction targets within the same testimony phase.
      const obtainableInPhase = new Set(obtainableBeforePhase);
      for (const statement of phase.statements) {
        for (const reveal of statement.reveals) {
          if (reveal.kind === "evidence")
            obtainableInPhase.add(`evidence:${reveal.id}`);
          if (reveal.kind === "statement")
            obtainableInPhase.add(`statement:${reveal.id}`);
        }
      }
      for (const statement of phase.statements) {
        checkReveals(
          `testimonyStatement:${statement.id}`,
          statement.line,
          statement.reveals,
        );
        validateContradiction(
          scene,
          statement,
          errors,
          corpusContext,
          localEvidence,
          localStatement,
          obtainableInPhase,
          guaranteedBefore,
        );
      }
      for (const result of phase.results) {
        checkReveals(
          `result:${phase.id}:${result.id}`,
          result.line,
          result.reveals,
        );
      }
    }
  }

  if (scene.outro.unlock !== "auto") {
    checkUnlock(scene.outro.unlock, scene.line, {
      checkCrossSceneInventory: false,
    });
    errors.push(
      ...collectInterrogationOutroUnlockErrors(
        scene.outro.unlock,
        scene,
        guaranteedInterrogationFlow,
      ),
    );
  }

  for (const phase of scene.phases) {
    checkInterrogationLockedReachability(
      `phase:${phase.id}`,
      phase.status,
      phase.unlock !== null,
      inboundFromOtherBlock(inboundReveals, `phase:${phase.id}`),
      scene.sourceFile,
      phase.line,
      errors,
    );
    if (phase.kind !== "inquiry") continue;
    for (const question of phase.questions) {
      checkInterrogationLockedReachability(
        `question:${question.id}`,
        question.status,
        question.unlock !== null,
        inboundFromOtherBlock(inboundReveals, `question:${question.id}`),
        scene.sourceFile,
        question.line,
        errors,
      );
    }
  }
}

function validateTestimonyPhaseResults(
  scene: ASTInterrogationScene,
  phase: ASTTestimonyPhase,
  errors: CompileError[],
): void {
  const resultIds = new Set(phase.results.map((result) => result.id));
  for (const statement of phase.statements) {
    if (statement.contradiction && statement.onCorrect === null) {
      errors.push({
        code: "interrogationContradictionMissingCorrectResult",
        message: `Testimony statement "${statement.id}" has a Contradiction but no On Correct result.`,
        sourceFile: scene.sourceFile,
        line: statement.line,
      });
    }
    for (const [field, resultId] of [
      ["On Correct", statement.onCorrect],
      ["On Wrong", statement.onWrong],
    ] as const) {
      if (resultId !== null && !resultIds.has(resultId)) {
        errors.push({
          code: "interrogationResultUnresolved",
          message: `Testimony statement "${statement.id}" ${field} references missing result "${resultId}" in phase "${phase.id}".`,
          sourceFile: scene.sourceFile,
          line: statement.line,
        });
      }
    }
  }
}

function validateContradiction(
  scene: ASTInterrogationScene,
  statement: ASTTestimonyStatement,
  errors: CompileError[],
  corpusContext: CorpusContext,
  localEvidence: Set<string>,
  localStatement: Set<string>,
  obtainableBeforePhase: Set<string>,
  guaranteedBefore: Set<string>,
): void {
  if (statement.contradiction === null) return;
  const target = statement.contradiction;
  if (target.kind === "evidence") {
    if (!knownEvidence(target.id, scene, corpusContext)) {
      errors.push({
        code: "interrogationContradictionUnresolved",
        message: `Contradiction target evidence:${target.id} not declared in any loaded Evidence Manifest.`,
        sourceFile: scene.sourceFile,
        line: statement.line,
      });
    } else if (
      localEvidence.has(target.id) &&
      !obtainableBeforePhase.has(`evidence:${target.id}`)
    ) {
      errors.push({
        code: "interrogationContradictionUnresolved",
        message: `Contradiction target evidence:${target.id} is declared locally but is not obtainable before this testimony phase.`,
        sourceFile: scene.sourceFile,
        line: statement.line,
      });
    } else if (
      !localEvidence.has(target.id) &&
      !guaranteedBefore.has(`evidence:${target.id}`)
    ) {
      errors.push(
        crossSceneInventoryError(
          scene,
          statement.line,
          `evidence:${target.id}`,
        ),
      );
    }
    return;
  }
  if (!knownStatement(target.id, scene, corpusContext)) {
    errors.push({
      code: "interrogationContradictionUnresolved",
      message: `Contradiction target statement:${target.id} not declared in any loaded Statement Manifest.`,
      sourceFile: scene.sourceFile,
      line: statement.line,
    });
  } else if (
    localStatement.has(target.id) &&
    !obtainableBeforePhase.has(`statement:${target.id}`)
  ) {
    errors.push({
      code: "interrogationContradictionUnresolved",
      message: `Contradiction target statement:${target.id} is declared locally but is not obtainable before this testimony phase.`,
      sourceFile: scene.sourceFile,
      line: statement.line,
    });
  } else if (
    !localStatement.has(target.id) &&
    !guaranteedBefore.has(`statement:${target.id}`)
  ) {
    errors.push(
      crossSceneInventoryError(scene, statement.line, `statement:${target.id}`),
    );
  }
}

function checkInterrogationLockedReachability(
  key: string,
  status: "locked" | "unlocked",
  hasUnlock: boolean,
  hasInbound: boolean,
  sourceFile: string,
  line: number,
  errors: CompileError[],
): void {
  if (status !== "locked") return;
  if (hasInbound && hasUnlock) {
    errors.push({
      code: "interrogationRevealsAndUnlockBoth",
      message: `${key} has both an inbound Reveals and a self Unlock — pick one.`,
      sourceFile,
      line,
    });
  }
  if (!hasInbound && !hasUnlock) {
    errors.push({
      code: "interrogationLockedBlockUnreachable",
      message: `${key} is locked but unreachable (no Unlock and no inbound Reveals).`,
      sourceFile,
      line,
    });
  }
}

function collectInterrogationOutroUnlockErrors(
  expr: InterrogationUnlockExpr,
  scene: ASTInterrogationScene,
  flow: InterrogationInventoryAnalysis,
): CompileError[] {
  if ("op" in expr) {
    const leftErrors = collectInterrogationOutroUnlockErrors(
      expr.left,
      scene,
      flow,
    );
    const rightErrors = collectInterrogationOutroUnlockErrors(
      expr.right,
      scene,
      flow,
    );
    if (expr.op === "and") {
      return [...leftErrors, ...rightErrors];
    }
    return leftErrors.length === 0 || rightErrors.length === 0
      ? []
      : [...leftErrors, ...rightErrors];
  }
  return interrogationOutroPredicateReachable(expr, scene, flow)
    ? []
    : [interrogationOutroPredicateUnreachableError(expr, scene)];
}

function interrogationOutroPredicateReachable(
  pred: Extract<InterrogationUnlockExpr, { predicate: string }>,
  scene: ASTInterrogationScene,
  flow: InterrogationInventoryAnalysis,
): boolean {
  switch (pred.predicate) {
    case "evidence_collected":
      return flow.afterScene.has(`evidence:${pred.id}`);
    case "statement_acquired":
      return flow.afterScene.has(`statement:${pred.id}`);
    case "question_answered":
      // A question is reachable only if it was actually answerable within the
      // scene (present in the answeredQuestions set from inventory analysis),
      // not merely present in a completable phase.
      return flow.answeredQuestions.has(pred.id);
    case "phase_completed":
      return flow.phaseCompletable.get(pred.id) === true;
  }
}

function interrogationOutroPredicateUnreachableError(
  pred: Extract<InterrogationUnlockExpr, { predicate: string }>,
  scene: ASTInterrogationScene,
): CompileError {
  switch (pred.predicate) {
    case "evidence_collected":
      return {
        code: "interrogationOutroPredicateUnreachable",
        message: `Outro requires evidence:${pred.id} collected, but it is not guaranteed on all valid paths within this scene — scene may be unwinnable depending on player choices.`,
        sourceFile: scene.sourceFile,
        line: scene.line,
      };
    case "statement_acquired":
      return {
        code: "interrogationOutroPredicateUnreachable",
        message: `Outro requires statement:${pred.id} acquired, but it is not guaranteed on all valid paths within this scene — scene may be unwinnable depending on player choices.`,
        sourceFile: scene.sourceFile,
        line: scene.line,
      };
    case "question_answered":
      return {
        code: "interrogationOutroPredicateUnreachable",
        message: `Outro requires question:${pred.id} answered, but no guaranteed completion path answers this question — scene may be unwinnable depending on player choices.`,
        sourceFile: scene.sourceFile,
        line: scene.line,
      };
    case "phase_completed":
      return {
        code: "interrogationOutroPredicateUnreachable",
        message: `Outro requires phase:${pred.id} completed, but that phase has no valid completion path — scene is unwinnable.`,
        sourceFile: scene.sourceFile,
        line: scene.line,
      };
  }
}

function buildGuaranteedInventoryBeforeScene(
  input: ValidatorInput,
): Map<string, Set<string>> {
  const recordsByKey = new Map(
    input.scenes.map((rec) => [sceneRecordKey(rec), rec]),
  );
  const guaranteedBefore = new Map<string, Set<string>>();
  const cumulative = new Set<string>();

  for (const chapter of input.chapters) {
    for (const file of chapter.sceneFiles) {
      const key = `${chapter.dirName}/${file}`;
      const rec = recordsByKey.get(key);
      if (!rec) continue;
      guaranteedBefore.set(key, new Set(cumulative));
      for (const item of guaranteedInventoryFromScene(rec.ast, cumulative)) {
        cumulative.add(item);
      }
    }
  }

  for (const rec of input.scenes) {
    const key = sceneRecordKey(rec);
    if (!guaranteedBefore.has(key))
      guaranteedBefore.set(key, new Set(cumulative));
  }

  return guaranteedBefore;
}

function guaranteedInventoryFromScene(
  scene: SceneRecord["ast"],
  initialInventory: Set<string>,
): Set<string> {
  if (scene.kind === "investigationScene")
    return guaranteedInventoryFromInvestigation(scene);
  if (scene.kind === "interrogationScene") {
    return analyzeInterrogationInventory(scene, {
      mode: "guaranteed",
      initialInventory,
    }).afterScene;
  }
  return new Set<string>();
}

function guaranteedInventoryFromInvestigation(
  scene: ASTInvestigationScene,
): Set<string> {
  const guaranteed = new Set<string>();
  if (scene.outro.unlock === "auto") {
    // For auto-outro, the runtime requires every unlocked hotspot to be
    // inspected and every unlocked topic to be discussed.  The player must
    // enter any sub-location that has reachable hotspots/topics ("mandatory"
    // sub-locations).  Entry reveals from such sub-locations are guaranteed
    // to fire.  Entry reveals from sub-locations with no interactive content
    // are NOT guaranteed — the player can skip them without entering.

    const subReachable = new Set<string>();
    for (const sub of scene.sublocations) {
      if (sub.status === "unlocked") subReachable.add(sub.id);
    }

    // Track which sub-locations are mandatory (player must enter them).
    // A sub-location is mandatory if it has any reachable hotspot or topic
    // that the auto-outro check requires the player to interact with.
    const subMandatory = new Set<string>();

    // The runtime automatically enters the first unlocked sub-location
    // (advance_into_first_sublocation uses .find on Unlocked status),
    // firing its entry reveals even if it has no interactive content.
    // Mirror this by marking the first unlocked sub-location as mandatory.
    const firstUnlocked = scene.sublocations.find(
      (s) => s.status === "unlocked",
    );
    if (firstUnlocked) subMandatory.add(firstUnlocked.id);

    // Fixed-point for sub-location reachability, mandatoriness, and inventory.
    let changed = true;
    while (changed) {
      changed = false;

      // Compute reachable atoms using only entry reveals from mandatory sub-locations.
      const reachableAtoms = collectReachableAtomsAcrossReachableSublocations(
        scene,
        subReachable,
        subMandatory,
      );

      // Update mandatory set: a reachable sub-location is mandatory if it has
      // any reachable hotspot or topic.
      for (const sub of scene.sublocations) {
        if (!subReachable.has(sub.id) || subMandatory.has(sub.id)) continue;
        const hasReachableContent =
          sub.hotspots.some((h) => reachableAtoms.has(`hotspot:${h.id}`)) ||
          sub.characters.some((c) =>
            c.topics.some((t) => reachableAtoms.has(`topic:${c.id}@${t.id}`)),
          );
        if (hasReachableContent) {
          subMandatory.add(sub.id);
          changed = true;
        }
      }

      // Expand sub-location reachability using only mandatory entry reveals.
      for (const sub of scene.sublocations) {
        if (subReachable.has(sub.id)) continue;
        if (sub.status !== "locked") continue;
        const reachedByReveal = [...subReachable].some((rid) => {
          if (!subMandatory.has(rid)) return false;
          const revs = collectRevealsFromReachableBlocks(
            scene.sublocations.find((s) => s.id === rid)!,
            reachableAtoms,
            subMandatory,
          );
          return revs.some((r) => r.kind === "sublocation" && r.id === sub.id);
        });
        if (reachedByReveal) {
          subReachable.add(sub.id);
          changed = true;
          continue;
        }
        const reachableItems = new Set<string>();
        for (const rid of subReachable) {
          if (!subMandatory.has(rid)) continue;
          const revs = collectRevealsFromReachableBlocks(
            scene.sublocations.find((s) => s.id === rid)!,
            reachableAtoms,
            subMandatory,
          );
          for (const r of revs) {
            if (r.kind === "evidence") reachableItems.add(`evidence:${r.id}`);
            if (r.kind === "statement") reachableItems.add(`statement:${r.id}`);
          }
        }
        if (
          sub.unlock &&
          isSubUnlockSatisfiable(
            sub.unlock,
            subReachable,
            scene,
            reachableItems,
            reachableAtoms,
          )
        ) {
          subReachable.add(sub.id);
          changed = true;
        }
      }
    }

    // Collect inventory from reachable hotspots and topics.
    const reachableAtoms = collectReachableAtomsAcrossReachableSublocations(
      scene,
      subReachable,
      subMandatory,
    );
    for (const sub of scene.sublocations) {
      if (!subReachable.has(sub.id)) continue;
      for (const h of sub.hotspots) {
        if (reachableAtoms.has(`hotspot:${h.id}`))
          addInventoryReveals(guaranteed, h.reveals);
      }
      for (const c of sub.characters) {
        for (const t of c.topics) {
          if (reachableAtoms.has(`topic:${c.id}@${t.id}`))
            addInventoryReveals(guaranteed, t.reveals);
        }
      }
    }

    // Entry reveals from mandatory sub-locations are also guaranteed — the
    // player must enter those sub-locations, so their entry reveals fire.
    for (const sub of scene.sublocations) {
      if (!subMandatory.has(sub.id)) continue;
      addInventoryReveals(guaranteed, sub.reveals);
    }

    return guaranteed;
  }

  for (const item of requiredInventoryPredicates(scene.outro.unlock)) {
    guaranteed.add(item);
  }

  // The outro may also require hotspot/topic interactions whose reveals
  // (evidence, statements) are guaranteed because the outro cannot unlock
  // without those interactions firing.
  for (const item of requiredInteractionReveals(scene.outro.unlock, scene)) {
    guaranteed.add(item);
  }

  // The runtime always auto-enters the first unlocked sub-location
  // (advance_into_first_sublocation), regardless of outro type, so its
  // entry reveals are guaranteed even for explicit-outro investigations.
  const firstUnlocked = scene.sublocations.find((s) => s.status === "unlocked");
  if (firstUnlocked) addInventoryReveals(guaranteed, firstUnlocked.reveals);

  return guaranteed;
}

function requiredInteractionReveals(
  expr: UnlockExpr,
  scene: ASTInvestigationScene,
): Set<string> {
  if ("op" in expr) {
    const left = requiredInteractionReveals(expr.left, scene);
    const right = requiredInteractionReveals(expr.right, scene);
    if (expr.op === "and") return new Set([...left, ...right]);
    return new Set([...left].filter((item) => right.has(item)));
  }
  if (expr.predicate === "hotspot_investigated") {
    for (const sub of scene.sublocations) {
      const hotspot = sub.hotspots.find((h) => h.id === expr.id);
      if (hotspot) {
        const reveals = new Set<string>();
        addInventoryReveals(reveals, hotspot.reveals);
        return reveals;
      }
    }
    return new Set<string>();
  }
  if (expr.predicate === "topic_discussed") {
    for (const sub of scene.sublocations) {
      const char = sub.characters.find((c) => c.id === expr.characterId);
      if (char) {
        const topic = char.topics.find((t) => t.id === expr.topicId);
        if (topic) {
          const reveals = new Set<string>();
          addInventoryReveals(reveals, topic.reveals);
          return reveals;
        }
      }
    }
    return new Set<string>();
  }
  return new Set<string>();
}

type InterrogationInventoryMode = "obtainable" | "guaranteed";

type InterrogationInventoryAnalysis = {
  beforePhase: Map<string, Set<string>>;
  phaseCompletable: Map<string, boolean>;
  answeredQuestions: Set<string>;
  afterScene: Set<string>;
};

function analyzeInterrogationInventory(
  scene: ASTInterrogationScene,
  options: { mode: InterrogationInventoryMode; initialInventory: Set<string> },
): InterrogationInventoryAnalysis {
  const inventory = new Set(options.initialInventory);
  const beforePhase = new Map<string, Set<string>>();
  const phaseCompletable = new Map<string, boolean>();
  const answeredQuestions = new Set<string>();
  const completedPhases = new Set<string>();
  const revealedQuestions = new Set<string>();
  const revealedPhases = new Set<string>();

  // Process phases with a fixed-point iteration that mirrors the runtime's
  // refresh_current_phase behavior:
  //   1. The runtime prefers required unlocked phases over optional ones.
  //   2. When all required phases are locked, the runtime falls through to
  //      optional unlocked phases. After an optional phase completes and
  //      reveals new items, the runtime re-evaluates and may now find a
  //      previously-locked required phase unlocked.
  //   3. A single-pass required-then-optional ordering would evaluate locked
  //      required phases before their optional-phase unlockers run, producing
  //      false-positive interrogationNoValidCompletionPath errors.
  //
  // The loop below repeatedly attempts to process reachable phases until no
  // new progress is made. Each iteration processes required phases first
  // (matching the runtime's preference), then optional phases. Phases that
  // become reachable due to newly revealed inventory are picked up on the
  // next iteration.
  //
  // In guaranteed mode, optional phases are normally evaluated on clones so
  // their reveals don't pollute the guaranteed inventory. However, when an
  // optional phase is the only unlocked path (because all required phases are
  // locked), the runtime forces the player through it — so its reveals ARE
  // guaranteed. A second inner loop detects these "effectively forced"
  // optional phases: if an optional phase's reveals include something that
  // would unlock a locked required phase, that optional phase is processed
  // on the main state.
  const orderedPhases = [
    ...scene.phases.filter((p) => p.required),
    ...scene.phases.filter((p) => !p.required),
  ];
  const processed = new Set<string>();
  const forcedOptional = new Set<string>();
  let madeProgress = true;
  while (madeProgress) {
    madeProgress = false;

    for (const phase of orderedPhases) {
      if (processed.has(phase.id)) continue;

      if (
        !interrogationBlockReachable(
          phase.status,
          phase.unlock,
          `phase:${phase.id}`,
          {
            inventory,
            answeredQuestions,
            completedPhases,
            revealedQuestions,
            revealedPhases,
          },
        )
      ) {
        beforePhase.set(phase.id, new Set(inventory));
        phaseCompletable.set(phase.id, false);
        continue;
      }

      processed.add(phase.id);
      madeProgress = true;

      if (
        options.mode === "guaranteed" &&
        !phase.required &&
        !forcedOptional.has(phase.id)
      ) {
        beforePhase.set(phase.id, new Set(inventory));
        // Evaluate completability on a cloned state so that optional-phase
        // reveals don't pollute the guaranteed inventory, but the outro
        // validation can still detect incompletable optional phases.
        // Note: even though the phase is "processed" (entered), its reveals
        // are NOT in the main state. The forced-optional detection below
        // will re-evaluate such phases if their reveals could unlock locked
        // required phases.
        const clone = cloneInterrogationInventoryState({
          inventory,
          answeredQuestions,
          completedPhases,
          revealedQuestions,
          revealedPhases,
        });
        addInterrogationRevealsToState(clone, phase.reveals);
        if (phase.kind === "inquiry") {
          const complete = collectInquiryInventory(phase, {
            mode: "guaranteed",
            ...clone,
          });
          phaseCompletable.set(phase.id, complete);
        } else {
          const hasValidCorrectPath = collectTestimonyResultInventory(phase, {
            mode: "guaranteed",
            inventory: clone.inventory,
            revealedQuestions: clone.revealedQuestions,
            revealedPhases: clone.revealedPhases,
          });
          phaseCompletable.set(phase.id, hasValidCorrectPath);
        }
        continue;
      }

      addInterrogationRevealsToState(
        { inventory, revealedQuestions, revealedPhases },
        phase.reveals,
      );
      beforePhase.set(phase.id, new Set(inventory));

      if (phase.kind === "inquiry") {
        const complete = collectInquiryInventory(phase, {
          mode: options.mode,
          inventory,
          answeredQuestions,
          completedPhases,
          revealedQuestions,
          revealedPhases,
        });
        phaseCompletable.set(phase.id, complete);
        if (complete) completedPhases.add(phase.id);
      } else {
        const hasValidCorrectPath = collectTestimonyResultInventory(phase, {
          mode: options.mode,
          inventory,
          revealedQuestions,
          revealedPhases,
        });
        phaseCompletable.set(phase.id, hasValidCorrectPath);
        if (hasValidCorrectPath) completedPhases.add(phase.id);
      }
    }

    // In guaranteed mode, detect effectively-forced optional phases: those
    // whose reveals would unlock a locked required phase. These phases are
    // forced because the player has no alternative path — the required
    // phase is locked, so the runtime will direct the player to the optional
    // phase, which then unlocks the required phase.
    // This also re-evaluates optional phases that were already processed on
    // a clone — if their reveals are needed to unlock a required phase, they
    // must be promoted to forced and reprocessed on the main state.
    if (options.mode === "guaranteed") {
      for (const phase of orderedPhases) {
        if (phase.required || forcedOptional.has(phase.id)) continue;

        const state = {
          inventory,
          answeredQuestions,
          completedPhases,
          revealedQuestions,
          revealedPhases,
        };
        if (
          !interrogationBlockReachable(
            phase.status,
            phase.unlock,
            `phase:${phase.id}`,
            state,
          )
        )
          continue;

        // Check if this optional phase's reveals would unlock any locked required phase.
        const clone = cloneInterrogationInventoryState(state);
        addInterrogationRevealsToState(clone, phase.reveals);
        let completable: boolean;
        if (phase.kind === "inquiry") {
          completable = collectInquiryInventory(phase, {
            mode: "guaranteed",
            ...clone,
          });
        } else {
          completable = collectTestimonyResultInventory(phase, {
            mode: "guaranteed",
            inventory: clone.inventory,
            revealedQuestions: clone.revealedQuestions,
            revealedPhases: clone.revealedPhases,
          });
        }
        // Mark the phase as completed in the clone so that phase_completed
        // predicates in downstream unlock checks evaluate correctly.
        if (completable) clone.completedPhases.add(phase.id);

        const unlocksLockedRequired = orderedPhases.some(
          (other) =>
            other.required &&
            !processed.has(other.id) &&
            !interrogationBlockReachable(
              other.status,
              other.unlock,
              `phase:${other.id}`,
              state,
            ) &&
            interrogationBlockReachable(
              other.status,
              other.unlock,
              `phase:${other.id}`,
              clone,
            ),
        );

        if (unlocksLockedRequired) {
          forcedOptional.add(phase.id);
          // Remove from processed so it gets re-evaluated on the main state
          // in the next outer-loop iteration.
          processed.delete(phase.id);
          madeProgress = true;
        }
      }
    }
  }

  // Forced optional phases: when the outro depends on items only available from
  // optional phases, every successful playthrough must collect those items.
  // Identify forced optional phases via fixed-point and include their contributions.
  if (options.mode === "guaranteed" && scene.outro.unlock !== "auto") {
    const outroExpr = scene.outro.unlock;
    const forced = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      const currentState = {
        inventory,
        answeredQuestions,
        completedPhases,
        revealedQuestions,
        revealedPhases,
      };
      // If the outro is already fully satisfied, no more forced phases needed.
      if (interrogationUnlockSatisfiable(outroExpr, currentState)) break;

      for (const phase of orderedPhases) {
        if (phase.required || forced.has(phase.id)) continue;
        if (phaseCompletable.get(phase.id) !== true) continue;
        if (
          !interrogationBlockReachable(
            phase.status,
            phase.unlock,
            `phase:${phase.id}`,
            currentState,
          )
        )
          continue;

        // Evaluate the phase on a clone to see what it produces
        const clone = cloneInterrogationInventoryState(currentState);
        addInterrogationRevealsToState(clone, phase.reveals);
        let cloneCompletable: boolean;
        if (phase.kind === "inquiry") {
          cloneCompletable = collectInquiryInventory(phase, {
            mode: "guaranteed",
            ...clone,
          });
        } else {
          cloneCompletable = collectTestimonyResultInventory(phase, {
            mode: "guaranteed",
            inventory: clone.inventory,
            revealedQuestions: clone.revealedQuestions,
            revealedPhases: clone.revealedPhases,
          });
        }
        // Mark the phase as completed on the clone so that
        // phase_completed predicates in the outro expression are
        // detected by cloneProducesNeededOutroAtom.
        if (cloneCompletable) clone.completedPhases.add(phase.id);

        // Check if the clone produces anything the outro needs that the
        // current state doesn't have.
        if (cloneProducesNeededOutroAtom(outroExpr, currentState, clone)) {
          // Phase is forced — process it on the main state.
          forced.add(phase.id);
          addInterrogationRevealsToState(
            { inventory, revealedQuestions, revealedPhases },
            phase.reveals,
          );
          beforePhase.set(phase.id, new Set(inventory));
          if (phase.kind === "inquiry") {
            const complete = collectInquiryInventory(phase, {
              mode: "guaranteed",
              inventory,
              answeredQuestions,
              completedPhases,
              revealedQuestions,
              revealedPhases,
            });
            phaseCompletable.set(phase.id, complete);
            if (complete) completedPhases.add(phase.id);
          } else {
            const hasValidCorrectPath = collectTestimonyResultInventory(phase, {
              mode: "guaranteed",
              inventory,
              revealedQuestions,
              revealedPhases,
            });
            phaseCompletable.set(phase.id, hasValidCorrectPath);
            if (hasValidCorrectPath) completedPhases.add(phase.id);
          }
          changed = true;
          break; // Restart while-loop with updated state
        }
      }
    }
  }

  return {
    beforePhase,
    phaseCompletable,
    answeredQuestions,
    afterScene: inventory,
  };
}

/**
 * Returns true if `clone` produces at least one atom that the outro expression
 * requires and that `base` does not already provide. This is used to detect
 * "forced" optional phases — phases whose output the outro depends on.
 */
function cloneProducesNeededOutroAtom(
  expr: InterrogationUnlockExpr,
  base: Pick<
    InterrogationInventoryState,
    "inventory" | "answeredQuestions" | "completedPhases"
  >,
  clone: Pick<
    InterrogationInventoryState,
    "inventory" | "answeredQuestions" | "completedPhases"
  >,
): boolean {
  if ("op" in expr) {
    return (
      cloneProducesNeededOutroAtom(expr.left, base, clone) ||
      cloneProducesNeededOutroAtom(expr.right, base, clone)
    );
  }
  switch (expr.predicate) {
    case "evidence_collected": {
      const atom = `evidence:${expr.id}`;
      return !base.inventory.has(atom) && clone.inventory.has(atom);
    }
    case "statement_acquired": {
      const atom = `statement:${expr.id}`;
      return !base.inventory.has(atom) && clone.inventory.has(atom);
    }
    case "question_answered":
      return (
        !base.answeredQuestions.has(expr.id) &&
        clone.answeredQuestions.has(expr.id)
      );
    case "phase_completed":
      return (
        !base.completedPhases.has(expr.id) && clone.completedPhases.has(expr.id)
      );
  }
}

type InterrogationInventoryState = {
  inventory: Set<string>;
  answeredQuestions: Set<string>;
  completedPhases: Set<string>;
  revealedQuestions: Set<string>;
  revealedPhases: Set<string>;
};

function collectInquiryInventory(
  phase: ASTInquiryPhase,
  state: InterrogationInventoryState & { mode: InterrogationInventoryMode },
): boolean {
  const explicitComplete = phase.complete === "auto" ? null : phase.complete;
  if (
    explicitComplete &&
    interrogationUnlockSatisfiable(explicitComplete, state)
  )
    return true;
  if (explicitComplete && state.mode === "guaranteed") {
    return collectGuaranteedExplicitInquiryInventory(
      phase,
      state,
      explicitComplete,
    );
  }

  const guaranteedQuestionIds =
    state.mode === "guaranteed" ? guaranteedInquiryQuestionIds(phase) : null;
  let changed = true;
  while (changed) {
    changed = false;
    for (const question of phase.questions) {
      if (state.answeredQuestions.has(question.id)) continue;
      if (
        guaranteedQuestionIds !== null &&
        !guaranteedQuestionIds.has(question.id)
      )
        continue;
      if (
        !interrogationBlockReachable(
          question.status,
          question.unlock,
          `question:${question.id}`,
          state,
        )
      )
        continue;

      state.answeredQuestions.add(question.id);
      addInterrogationRevealsToState(state, question.reveals);
      if (
        explicitComplete &&
        interrogationUnlockSatisfiable(explicitComplete, state)
      )
        return true;
      changed = true;
    }
  }

  if (explicitComplete)
    return interrogationUnlockSatisfiable(explicitComplete, state);
  return phase.questions.every(
    (question) =>
      !question.required || state.answeredQuestions.has(question.id),
  );
}

function collectGuaranteedExplicitInquiryInventory(
  phase: ASTInquiryPhase,
  state: InterrogationInventoryState,
  complete: InterrogationUnlockExpr,
): boolean {
  const completionStates = collectExplicitInquiryCompletionStates(
    phase,
    cloneInterrogationInventoryState(state),
    complete,
  );
  if (completionStates.length === 0) return false;

  replaceSet(
    state.inventory,
    commonSet(completionStates.map((path) => path.inventory)),
  );
  replaceSet(
    state.answeredQuestions,
    commonSet(completionStates.map((path) => path.answeredQuestions)),
  );
  replaceSet(
    state.revealedQuestions,
    commonSet(completionStates.map((path) => path.revealedQuestions)),
  );
  replaceSet(
    state.revealedPhases,
    commonSet(completionStates.map((path) => path.revealedPhases)),
  );
  return true;
}

function collectExplicitInquiryCompletionStates(
  phase: ASTInquiryPhase,
  state: InterrogationInventoryState,
  complete: InterrogationUnlockExpr,
): InterrogationInventoryState[] {
  if (interrogationUnlockSatisfiable(complete, state)) return [state];

  const completions: InterrogationInventoryState[] = [];
  for (const question of phase.questions) {
    if (state.answeredQuestions.has(question.id)) continue;
    if (
      !interrogationBlockReachable(
        question.status,
        question.unlock,
        `question:${question.id}`,
        state,
      )
    )
      continue;

    const next = cloneInterrogationInventoryState(state);
    next.answeredQuestions.add(question.id);
    addInterrogationRevealsToState(next, question.reveals);
    completions.push(
      ...collectExplicitInquiryCompletionStates(phase, next, complete),
    );
  }
  return completions;
}

function cloneInterrogationInventoryState(
  state: InterrogationInventoryState,
): InterrogationInventoryState {
  return {
    inventory: new Set(state.inventory),
    answeredQuestions: new Set(state.answeredQuestions),
    completedPhases: new Set(state.completedPhases),
    revealedQuestions: new Set(state.revealedQuestions),
    revealedPhases: new Set(state.revealedPhases),
  };
}

function replaceSet<T>(target: Set<T>, source: Set<T>): void {
  target.clear();
  for (const item of source) target.add(item);
}

function commonSet<T>(sets: Set<T>[]): Set<T> {
  if (sets.length === 0) return new Set<T>();
  let common = new Set(sets[0]!);
  for (const set of sets.slice(1)) {
    common = new Set([...common].filter((item) => set.has(item)));
  }
  return common;
}

function guaranteedInquiryQuestionIds(phase: ASTInquiryPhase): Set<string> {
  if (phase.complete === "auto") {
    // For auto-complete, the runtime waits for ALL unlocked questions to be
    // answered before auto-completing (see Rust phase_complete: it checks that
    // no unlocked question remains unanswered, regardless of required flag).
    // So every question that can become reachable is guaranteed to be answered.
    // The reachability check inside collectInquiryInventory's fixed-point loop
    // handles which questions are actually reachable; we include all IDs here
    // so the loop doesn't filter out optional follow-ups.
    return new Set(phase.questions.map((question) => question.id));
  }
  return new Set<string>();
}

function collectTestimonyResultInventory(
  phase: ASTTestimonyPhase,
  state: Pick<
    InterrogationInventoryState,
    "inventory" | "revealedQuestions" | "revealedPhases"
  > & { mode: InterrogationInventoryMode },
): boolean {
  // Press reveals: the player *can* press any statement, but pressing is
  // optional — a player may complete the phase by presenting evidence without
  // ever pressing.  In obtainable mode we include press reveals (the player
  // has the option to collect them).  In guaranteed mode we skip them because
  // they are not guaranteed to be collected.
  const baseInventory = new Set(state.inventory);
  const availableForContradictions = new Set(state.inventory);
  if (state.mode === "obtainable") {
    for (const statement of phase.statements) {
      addInterrogationRevealsToState(state, statement.reveals);
      addInterrogationInventoryReveals(
        availableForContradictions,
        statement.reveals,
      );
    }
  } else {
    for (const statement of phase.statements) {
      addInterrogationInventoryReveals(
        availableForContradictions,
        statement.reveals,
      );
    }
  }

  const validPathReveals: InterrogationRevealTarget[][] = [];
  for (const statement of phase.statements) {
    if (statement.contradiction === null || statement.onCorrect === null)
      continue;
    if (!availableForContradictions.has(inventoryAtom(statement.contradiction)))
      continue;
    const result = phase.results.find(
      (candidate) => candidate.id === statement.onCorrect,
    );
    if (!result) continue;
    const pathReveals = [...result.reveals];
    if (
      state.mode === "guaranteed" &&
      !baseInventory.has(inventoryAtom(statement.contradiction))
    ) {
      pathReveals.push(statement.contradiction);
    }
    validPathReveals.push(pathReveals);
  }

  if (validPathReveals.length === 0) return false;
  if (state.mode === "obtainable") {
    for (const reveals of validPathReveals) {
      addInterrogationRevealsToState(state, reveals);
    }
    return true;
  }

  for (const reveal of commonInterrogationReveals(validPathReveals)) {
    addInterrogationRevealsToState(state, [reveal]);
  }
  return true;
}

function interrogationBlockReachable(
  status: "locked" | "unlocked",
  unlock: InterrogationUnlockExpr | null,
  key: string,
  state: InterrogationInventoryState,
): boolean {
  if (status === "unlocked") return true;
  if (
    key.startsWith("question:") &&
    state.revealedQuestions.has(key.slice("question:".length))
  )
    return true;
  if (
    key.startsWith("phase:") &&
    state.revealedPhases.has(key.slice("phase:".length))
  )
    return true;
  return unlock !== null && interrogationUnlockSatisfiable(unlock, state);
}

function interrogationUnlockSatisfiable(
  expr: InterrogationUnlockExpr,
  state: Pick<
    InterrogationInventoryState,
    "inventory" | "answeredQuestions" | "completedPhases"
  >,
): boolean {
  if ("op" in expr) {
    if (expr.op === "and") {
      return (
        interrogationUnlockSatisfiable(expr.left, state) &&
        interrogationUnlockSatisfiable(expr.right, state)
      );
    }
    return (
      interrogationUnlockSatisfiable(expr.left, state) ||
      interrogationUnlockSatisfiable(expr.right, state)
    );
  }
  switch (expr.predicate) {
    case "evidence_collected":
      return state.inventory.has(`evidence:${expr.id}`);
    case "statement_acquired":
      return state.inventory.has(`statement:${expr.id}`);
    case "question_answered":
      return state.answeredQuestions.has(expr.id);
    case "phase_completed":
      return state.completedPhases.has(expr.id);
  }
}

function addInterrogationBlockReveals(
  state: Pick<
    InterrogationInventoryState,
    "revealedQuestions" | "revealedPhases"
  >,
  reveals: InterrogationRevealTarget[],
): void {
  for (const reveal of reveals) {
    if (reveal.kind === "question") state.revealedQuestions.add(reveal.id);
    if (reveal.kind === "phase") state.revealedPhases.add(reveal.id);
  }
}

function addInterrogationRevealsToState(
  state: Pick<
    InterrogationInventoryState,
    "inventory" | "revealedQuestions" | "revealedPhases"
  >,
  reveals: InterrogationRevealTarget[],
): void {
  addInterrogationInventoryReveals(state.inventory, reveals);
  addInterrogationBlockReveals(state, reveals);
}

function commonInterrogationReveals(
  paths: InterrogationRevealTarget[][],
): InterrogationRevealTarget[] {
  if (paths.length === 0) return [];
  let common = new Set(paths[0]!.map(interrogationRevealKey));
  for (const path of paths.slice(1)) {
    const keys = new Set(path.map(interrogationRevealKey));
    common = new Set([...common].filter((key) => keys.has(key)));
  }
  return paths[0]!.filter((reveal) =>
    common.has(interrogationRevealKey(reveal)),
  );
}

function inventoryAtom(target: InventoryTarget): string {
  return `${target.kind}:${target.id}`;
}

function addInventoryReveals(out: Set<string>, reveals: RevealTarget[]): void {
  for (const reveal of reveals) {
    if (reveal.kind === "evidence") out.add(`evidence:${reveal.id}`);
    if (reveal.kind === "statement") out.add(`statement:${reveal.id}`);
  }
}

function addInterrogationInventoryReveals(
  out: Set<string>,
  reveals: InterrogationRevealTarget[],
): void {
  for (const reveal of reveals) {
    if (reveal.kind === "evidence") out.add(`evidence:${reveal.id}`);
    if (reveal.kind === "statement") out.add(`statement:${reveal.id}`);
  }
}

function requiredInventoryPredicates(expr: UnlockExpr): Set<string> {
  if ("op" in expr) {
    const left = requiredInventoryPredicates(expr.left);
    const right = requiredInventoryPredicates(expr.right);
    if (expr.op === "and") return new Set([...left, ...right]);
    return new Set([...left].filter((item) => right.has(item)));
  }
  if (expr.predicate === "evidence_collected")
    return new Set([`evidence:${expr.id}`]);
  if (expr.predicate === "statement_acquired")
    return new Set([`statement:${expr.id}`]);
  return new Set<string>();
}

function knownEvidence(
  id: string,
  scene: ASTInterrogationScene,
  corpusContext: CorpusContext,
): boolean {
  return (
    scene.evidenceManifest.some((evidence) => evidence.id === id) ||
    corpusContext.globalEvidence.has(id)
  );
}

function knownStatement(
  id: string,
  scene: ASTInterrogationScene,
  corpusContext: CorpusContext,
): boolean {
  return (
    scene.statementManifest.some((statement) => statement.id === id) ||
    corpusContext.globalStatement.has(id)
  );
}

function crossSceneInventoryError(
  scene: ASTInterrogationScene,
  line: number,
  item: string,
): CompileError {
  return {
    code: "crossSceneInventoryNotGuaranteed",
    message: `${item} is referenced from a prior scene, but the compiler cannot prove it is guaranteed before this interrogation scene.`,
    sourceFile: scene.sourceFile,
    line,
  };
}

function inboundFromOtherBlock(
  inboundReveals: Map<string, Set<string>>,
  key: string,
): boolean {
  const sources = inboundReveals.get(key);
  if (!sources) return false;
  return [...sources].some((source) => source !== key);
}

function sceneRecordKey(rec: SceneRecord): string {
  return `${rec.chapterId}/${rec.file}`;
}

function validateInvestigationScene(
  rec: SceneRecord,
  errors: CompileError[],
): void {
  const scene = rec.ast as ASTInvestigationScene;

  const localEvidence = new Set(scene.evidenceManifest.map((e) => e.id));
  const localStatement = new Set(scene.statementManifest.map((s) => s.id));
  const localHotspot = new Set<string>();
  const localTopic = new Set<string>();
  const localSublocation = new Set<string>();

  for (const sub of scene.sublocations) {
    const prev = localSublocation.size;
    localSublocation.add(sub.id);
    if (localSublocation.size === prev) {
      errors.push({
        code: "duplicateSceneLocalId",
        message: `Duplicate sub-location id "${sub.id}" within scene — sub-location ids must be unique within a scene.`,
        sourceFile: scene.sourceFile,
        line: sub.line,
      });
    }

    // Character IDs are scoped per sub-location: the same NPC can appear in
    // different sub-locations with distinct topics.  The `character@topic`
    // uniqueness check below catches ambiguous topic overlap across sub-locations.
    const subLocalCharacter = new Set<string>();

    for (const h of sub.hotspots) {
      const prevH = localHotspot.size;
      localHotspot.add(h.id);
      if (localHotspot.size === prevH) {
        errors.push({
          code: "duplicateSceneLocalId",
          message: `Duplicate hotspot id "${h.id}" within scene — hotspot ids must be unique within a scene.`,
          sourceFile: scene.sourceFile,
          line: h.line,
        });
      }
    }
    for (const c of sub.characters) {
      const prevC = subLocalCharacter.size;
      subLocalCharacter.add(c.id);
      if (subLocalCharacter.size === prevC) {
        errors.push({
          code: "duplicateSceneLocalId",
          message: `Duplicate character id "${c.id}" within sub-location "${sub.id}" — character ids must be unique within a sub-location.`,
          sourceFile: scene.sourceFile,
          line: c.line,
        });
      }
      for (const t of c.topics) {
        const key = `${c.id}@${t.id}`;
        const prevT = localTopic.size;
        localTopic.add(key);
        if (localTopic.size === prevT) {
          errors.push({
            code: "duplicateSceneLocalId",
            message: `Duplicate topic key "${key}" within scene — topic ids must be unique per character within a scene.`,
            sourceFile: scene.sourceFile,
            line: t.line,
          });
        }
      }
    }
  }

  const evidenceSourceSublocation = new Map<string, string>();
  for (const evidence of scene.evidenceManifest) {
    if (evidence.sourceSublocationId == null) {
      errors.push({
        code: "evidenceSourceSublocationMissing",
        message: `Evidence id "${evidence.id}" must declare a source sub-location.`,
        sourceFile: evidence.sourceFile,
        line: evidence.line,
      });
    } else if (typeof evidence.sourceSublocationId === "string") {
      if (!localSublocation.has(evidence.sourceSublocationId)) {
        errors.push({
          code: "evidenceSourceSublocationUnknown",
          message: `Evidence id "${evidence.id}" source sub-location "${evidence.sourceSublocationId}" is not declared in this scene.`,
          sourceFile: evidence.sourceFile,
          line: evidence.line,
        });
      } else {
        evidenceSourceSublocation.set(
          evidence.id,
          evidence.sourceSublocationId,
        );
      }
    }
  }

  const inboundReveals = new Map<string, { source: string; line: number }>();

  const checkReveals = (
    source: string,
    sourceSublocationId: string,
    line: number,
    list: RevealTarget[],
  ) => {
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
          } else {
            const expectedSourceSublocation = evidenceSourceSublocation.get(
              r.id,
            );
            if (
              expectedSourceSublocation !== undefined &&
              expectedSourceSublocation !== sourceSublocationId
            ) {
              errors.push({
                code: "evidenceRevealOutsideSourceSublocation",
                message: `Reveal target evidence:${r.id} belongs to source sub-location "${expectedSourceSublocation}" but is revealed from "${sourceSublocationId}".`,
                sourceFile: scene.sourceFile,
                line,
              });
            }
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
            errors.push({
              code: "unresolvedRevealTarget",
              message: `Reveal target hotspot:${r.id} not declared in this scene.`,
              sourceFile: scene.sourceFile,
              line,
            });
          break;
        case "topic":
          if (!localTopic.has(`${r.characterId}@${r.topicId}`))
            errors.push({
              code: "unresolvedRevealTarget",
              message: `Reveal target topic:${r.characterId}@${r.topicId} not declared in this scene.`,
              sourceFile: scene.sourceFile,
              line,
            });
          break;
        case "sublocation":
          if (!localSublocation.has(r.id))
            errors.push({
              code: "unresolvedRevealTarget",
              message: `Reveal target sublocation:${r.id} not declared in this scene.`,
              sourceFile: scene.sourceFile,
              line,
            });
          break;
      }
      inboundReveals.set(key, { source, line });
    }
  };

  for (const sub of scene.sublocations) {
    checkReveals(`sublocation:${sub.id}`, sub.id, sub.line, sub.reveals);
    for (const h of sub.hotspots)
      checkReveals(`hotspot:${h.id}`, sub.id, h.line, h.reveals);
    for (const c of sub.characters)
      for (const t of c.topics)
        checkReveals(`topic:${c.id}@${t.id}`, sub.id, t.line, t.reveals);
  }

  // v1 restriction (spec §3d): all four predicate kinds must resolve scene-local.
  // We don't distinguish "doesn't exist anywhere" vs. "exists in another scene".
  const checkUnlock = (
    expr: UnlockExpr | null,
    sourceFile: string,
    line: number,
  ) => {
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
    for (const h of sub.hotspots)
      checkUnlock(h.unlock, scene.sourceFile, h.line);
    for (const c of sub.characters)
      for (const t of c.topics) checkUnlock(t.unlock, scene.sourceFile, t.line);
  }
  if (scene.outro.unlock !== "auto")
    checkUnlock(scene.outro.unlock, scene.sourceFile, scene.line);

  for (const sub of scene.sublocations) {
    const key = `sublocation:${sub.id}`;
    if (sub.status === "locked") {
      const hasInbound = inboundReveals.has(key);
      const hasUnlock = sub.unlock !== null;
      if (hasInbound && hasUnlock)
        errors.push({
          code: "revealsAndUnlockBoth",
          message: `sublocation ${sub.id} has both an inbound Reveals and a self Unlock — pick one.`,
          sourceFile: scene.sourceFile,
          line: sub.line,
        });
      if (!hasInbound && !hasUnlock)
        errors.push({
          code: "lockedBlockUnreachable",
          message: `sublocation ${sub.id} is locked but has no Unlock and no inbound Reveals — unreachable.`,
          sourceFile: scene.sourceFile,
          line: sub.line,
        });
    }
    for (const h of sub.hotspots)
      checkLockedReachability(
        `hotspot:${h.id}`,
        h.status,
        h.unlock !== null,
        inboundReveals.has(`hotspot:${h.id}`),
        scene.sourceFile,
        h.line,
        errors,
      );
    for (const c of sub.characters)
      for (const t of c.topics)
        checkLockedReachability(
          `topic:${c.id}@${t.id}`,
          t.status,
          t.unlock !== null,
          inboundReveals.has(`topic:${c.id}@${t.id}`),
          scene.sourceFile,
          t.line,
          errors,
        );
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
    errors.push({
      code: "revealsAndUnlockBoth",
      message: `${key} has both inbound Reveals and self Unlock — pick one.`,
      sourceFile,
      line,
    });
  if (!hasInbound && !hasUnlock)
    errors.push({
      code: "lockedBlockUnreachable",
      message: `${key} is locked but unreachable (no Unlock and no inbound Reveals).`,
      sourceFile,
      line,
    });
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
function checkReachability(
  scene: ASTInvestigationScene,
  errors: CompileError[],
): void {
  // --- Phase 1: sub-location reachability ---
  const subReachable = new Set<string>();

  // Seed: unlocked sub-locations.
  for (const sub of scene.sublocations) {
    if (sub.status === "unlocked") subReachable.add(sub.id);
  }

  // Collect Reveals from reachable content inside sub-locations.
  // Only count reveals from blocks proven reachable — locked blocks whose
  // unlock conditions haven't been satisfied yet must not contribute their
  // reveals, otherwise cyclic dependencies can be masked.
  const subRevealsBySubId = new Map<string, RevealTarget[]>();

  function refreshReachableReveals(reachableAtoms: Set<string>): void {
    subRevealsBySubId.clear();
    for (const sub of scene.sublocations) {
      if (!subReachable.has(sub.id)) continue;
      subRevealsBySubId.set(
        sub.id,
        collectRevealsFromReachableBlocks(sub, reachableAtoms),
      );
    }
  }

  // Track evidence/statements revealed by reachable content in reachable sub-locations.
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
  // Fixed-point propagation for sub-locations.
  let changed = true;
  while (changed) {
    const reachableAtoms = collectReachableAtomsAcrossReachableSublocations(
      scene,
      subReachable,
    );
    refreshReachableReveals(reachableAtoms);
    refreshReachableItems();
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
        changed = true;
        continue;
      }

      // Check if this sub-location's Unlock predicate is satisfiable.
      // For sub-location Unlock, predicate blocks must be in reachable sub-locations.
      if (
        sub.unlock &&
        isSubUnlockSatisfiable(
          sub.unlock,
          subReachable,
          scene,
          reachableItems,
          reachableAtoms,
        )
      ) {
        subReachable.add(sub.id);
        changed = true;
      }
    }
  }

  // --- Phase 2: hotspot/topic reachability within each sub-location ---
  const reachableAtoms = collectReachableAtomsAcrossReachableSublocations(
    scene,
    subReachable,
  );
  for (const sub of scene.sublocations) {
    if (subReachable.has(sub.id)) {
      // Sub-location is reachable. Check internal blocks.
      checkInternalReachability(sub, scene, reachableAtoms, errors);
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

  // --- Phase 3: Outro unlock reachability for inventory predicates ---
  // Evidence/statement predicates in the Outro expression must reference items
  // that can actually be collected/acquired through the reveal chain. If an
  // item is declared but never revealed by any reachable trigger, the scene is
  // unwinnable at runtime.
  if (scene.outro.unlock !== "auto") {
    // Collect all evidence/statements revealed by reachable content.
    errors.push(
      ...collectOutroUnlockErrors(
        scene.outro.unlock,
        scene,
        subReachable,
        reachableAtoms,
      ),
    );
  }
}

/**
 * Checks reachability of hotspots and topics within a single reachable sub-location.
 * Unlock predicates may reference blocks in other reachable sub-locations.
 */
function checkInternalReachability(
  sub: ASTSublocation,
  scene: ASTInvestigationScene,
  reachableAtoms: Set<string>,
  errors: CompileError[],
): void {
  // Report unreachable locked internal blocks.
  for (const h of sub.hotspots) {
    if (h.status === "locked" && !reachableAtoms.has(`hotspot:${h.id}`)) {
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
      if (t.status === "locked" && !reachableAtoms.has(key)) {
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

function collectReachableAtomsAcrossReachableSublocations(
  scene: ASTInvestigationScene,
  reachableSubs: Set<string>,
  mandatorySubs?: Set<string>,
): Set<string> {
  const reachable = new Set<string>();

  for (const sub of scene.sublocations) {
    if (!reachableSubs.has(sub.id)) continue;
    for (const h of sub.hotspots) {
      if (h.status === "unlocked") reachable.add(`hotspot:${h.id}`);
    }
    for (const c of sub.characters) {
      for (const t of c.topics) {
        if (t.status === "unlocked") reachable.add(`topic:${c.id}@${t.id}`);
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;

    const allReveals: RevealTarget[] = [];
    for (const sub of scene.sublocations) {
      if (!reachableSubs.has(sub.id)) continue;
      // Only include sub-location entry reveals if this sub-location is
      // mandatory (player must enter it). When mandatorySubs is not provided,
      // all entry reveals are included (obtainable/reachability analysis).
      if (!mandatorySubs || mandatorySubs.has(sub.id)) {
        allReveals.push(...sub.reveals);
      }
      for (const h of sub.hotspots) {
        if (reachable.has(`hotspot:${h.id}`)) allReveals.push(...h.reveals);
      }
      for (const c of sub.characters) {
        for (const t of c.topics) {
          if (reachable.has(`topic:${c.id}@${t.id}`))
            allReveals.push(...t.reveals);
        }
      }
    }

    for (const r of allReveals) {
      if (r.kind === "evidence" && !reachable.has(`evidence:${r.id}`)) {
        reachable.add(`evidence:${r.id}`);
        changed = true;
      }
      if (r.kind === "statement" && !reachable.has(`statement:${r.id}`)) {
        reachable.add(`statement:${r.id}`);
        changed = true;
      }
    }

    for (const sub of scene.sublocations) {
      if (!reachableSubs.has(sub.id)) continue;
      for (const h of sub.hotspots) {
        if (reachable.has(`hotspot:${h.id}`) || h.status !== "locked") continue;
        const reachedByReveal = allReveals.some(
          (r) => r.kind === "hotspot" && r.id === h.id,
        );
        if (reachedByReveal) {
          reachable.add(`hotspot:${h.id}`);
          changed = true;
          continue;
        }
        if (h.unlock && isUnlockSatisfiable(h.unlock, reachable)) {
          reachable.add(`hotspot:${h.id}`);
          changed = true;
        }
      }
      for (const c of sub.characters) {
        for (const t of c.topics) {
          const key = `topic:${c.id}@${t.id}`;
          if (reachable.has(key) || t.status !== "locked") continue;
          const reachedByReveal = allReveals.some(
            (r) =>
              r.kind === "topic" &&
              r.characterId === c.id &&
              r.topicId === t.id,
          );
          if (reachedByReveal) {
            reachable.add(key);
            changed = true;
            continue;
          }
          if (t.unlock && isUnlockSatisfiable(t.unlock, reachable)) {
            reachable.add(key);
            changed = true;
          }
        }
      }
    }
  }

  return reachable;
}

/**
 * Collects RevealTargets from all reachable blocks within a sub-location.
 * Uses collectReachableAtoms to determine which blocks are actually reachable
 * (considering internal unlock chains and cross-sublocation dependencies),
 * then gathers reveals from only those blocks.
 */
function collectRevealsFromReachableBlocks(
  sub: ASTSublocation,
  reachableAtoms: Set<string>,
  mandatorySubs?: Set<string>,
): RevealTarget[] {
  // Only include sub-location entry reveals if this sub-location is mandatory
  // (the player must enter it for auto-outro). When mandatorySubs is not
  // provided, all entry reveals are included (obtainable/reachability analysis).
  const reveals: RevealTarget[] =
    !mandatorySubs || mandatorySubs.has(sub.id) ? [...sub.reveals] : [];
  for (const h of sub.hotspots) {
    if (reachableAtoms.has(`hotspot:${h.id}`)) reveals.push(...h.reveals);
  }
  for (const c of sub.characters) {
    for (const t of c.topics) {
      if (reachableAtoms.has(`topic:${c.id}@${t.id}`))
        reveals.push(...t.reveals);
    }
  }
  return reveals;
}

/**
 * Evaluates whether a sub-location's Unlock predicate is satisfiable given
 * the set of currently-reachable sub-locations. A hotspot/topic predicate is
 * satisfiable when it exists in a reachable sub-location and is itself
 * reachable within that sub-location.
 * Evidence/statement predicates check whether any reachable sub-location's
 * unlocked content or sub-location-level reveals expose that item.
 */
function isSubUnlockSatisfiable(
  expr: UnlockExpr,
  reachableSubs: Set<string>,
  scene: ASTInvestigationScene,
  reachableItems: Set<string>,
  reachableAtoms: Set<string>,
): boolean {
  if ("op" in expr) {
    if (expr.op === "and") {
      return (
        isSubUnlockSatisfiable(
          expr.left,
          reachableSubs,
          scene,
          reachableItems,
          reachableAtoms,
        ) &&
        isSubUnlockSatisfiable(
          expr.right,
          reachableSubs,
          scene,
          reachableItems,
          reachableAtoms,
        )
      );
    }
    return (
      isSubUnlockSatisfiable(
        expr.left,
        reachableSubs,
        scene,
        reachableItems,
        reachableAtoms,
      ) ||
      isSubUnlockSatisfiable(
        expr.right,
        reachableSubs,
        scene,
        reachableItems,
        reachableAtoms,
      )
    );
  }
  switch (expr.predicate) {
    case "hotspot_investigated": {
      // Find which sub-location contains this hotspot and check reachability.
      const parentSub = scene.sublocations.find((s) =>
        s.hotspots.some((h) => h.id === expr.id),
      );
      return (
        parentSub != null &&
        reachableSubs.has(parentSub.id) &&
        reachableAtoms.has(`hotspot:${expr.id}`)
      );
    }
    case "topic_discussed": {
      const parentSub = scene.sublocations.find((s) =>
        s.characters.some(
          (c) =>
            c.id === expr.characterId &&
            c.topics.some((t) => t.id === expr.topicId),
        ),
      );
      return (
        parentSub != null &&
        reachableSubs.has(parentSub.id) &&
        reachableAtoms.has(`topic:${expr.characterId}@${expr.topicId}`)
      );
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
function isUnlockSatisfiable(
  expr: UnlockExpr,
  reachable: Set<string>,
): boolean {
  if ("op" in expr) {
    if (expr.op === "and") {
      return (
        isUnlockSatisfiable(expr.left, reachable) &&
        isUnlockSatisfiable(expr.right, reachable)
      );
    }
    // "or"
    return (
      isUnlockSatisfiable(expr.left, reachable) ||
      isUnlockSatisfiable(expr.right, reachable)
    );
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

function collectOutroUnlockErrors(
  expr: UnlockExpr,
  scene: ASTInvestigationScene,
  reachableSubs: Set<string>,
  reachableAtoms: Set<string>,
): CompileError[] {
  if ("op" in expr) {
    const leftErrors = collectOutroUnlockErrors(
      expr.left,
      scene,
      reachableSubs,
      reachableAtoms,
    );
    const rightErrors = collectOutroUnlockErrors(
      expr.right,
      scene,
      reachableSubs,
      reachableAtoms,
    );
    if (expr.op === "and") {
      return [...leftErrors, ...rightErrors];
    }
    return leftErrors.length === 0 || rightErrors.length === 0
      ? []
      : [...leftErrors, ...rightErrors];
  }
  return outroPredicateReachable(expr, scene, reachableSubs, reachableAtoms)
    ? []
    : [outroPredicateUnreachableError(expr, scene)];
}

function outroPredicateReachable(
  pred: Extract<UnlockExpr, { predicate: string }>,
  scene: ASTInvestigationScene,
  reachableSubs: Set<string>,
  reachableAtoms: Set<string>,
): boolean {
  switch (pred.predicate) {
    case "evidence_collected":
      return reachableAtoms.has(`evidence:${pred.id}`);
    case "statement_acquired":
      return reachableAtoms.has(`statement:${pred.id}`);
    case "topic_discussed": {
      const parentSub = scene.sublocations.find((s) =>
        s.characters.some(
          (c) =>
            c.id === pred.characterId &&
            c.topics.some((t) => t.id === pred.topicId),
        ),
      );
      return (
        parentSub != null &&
        reachableSubs.has(parentSub.id) &&
        reachableAtoms.has(`topic:${pred.characterId}@${pred.topicId}`)
      );
    }
    case "hotspot_investigated": {
      const parentSub = scene.sublocations.find((s) =>
        s.hotspots.some((h) => h.id === pred.id),
      );
      return (
        parentSub != null &&
        reachableSubs.has(parentSub.id) &&
        reachableAtoms.has(`hotspot:${pred.id}`)
      );
    }
  }
}

function outroPredicateUnreachableError(
  pred: Extract<UnlockExpr, { predicate: string }>,
  scene: ASTInvestigationScene,
): CompileError {
  switch (pred.predicate) {
    case "evidence_collected":
      return {
        code: "outroPredicateUnreachable",
        message: `Outro requires evidence:${pred.id} collected, but no reachable block reveals this evidence — scene is unwinnable.`,
        sourceFile: scene.sourceFile,
        line: scene.line,
      };
    case "statement_acquired":
      return {
        code: "outroPredicateUnreachable",
        message: `Outro requires statement:${pred.id} acquired, but no reachable block reveals this statement — scene is unwinnable.`,
        sourceFile: scene.sourceFile,
        line: scene.line,
      };
    case "topic_discussed":
      return {
        code: "outroPredicateUnreachable",
        message: `Outro requires topic:${pred.characterId}@${pred.topicId} discussed, but that topic is not reachable — scene is unwinnable.`,
        sourceFile: scene.sourceFile,
        line: scene.line,
      };
    case "hotspot_investigated":
      return {
        code: "outroPredicateUnreachable",
        message: `Outro requires hotspot:${pred.id} investigated, but that hotspot is not reachable — scene is unwinnable.`,
        sourceFile: scene.sourceFile,
        line: scene.line,
      };
  }
}

function walkUnlock(
  expr: UnlockExpr,
  fn: (atom: Extract<UnlockExpr, { predicate: string }>) => void,
): void {
  if ("op" in expr) {
    walkUnlock(expr.left, fn);
    walkUnlock(expr.right, fn);
  } else {
    fn(expr);
  }
}

function walkInterrogationUnlock(
  expr: InterrogationUnlockExpr,
  fn: (atom: Extract<InterrogationUnlockExpr, { predicate: string }>) => void,
): void {
  if ("op" in expr) {
    walkInterrogationUnlock(expr.left, fn);
    walkInterrogationUnlock(expr.right, fn);
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

function interrogationRevealKey(r: InterrogationRevealTarget): string {
  return `${r.kind}:${r.id}`;
}
