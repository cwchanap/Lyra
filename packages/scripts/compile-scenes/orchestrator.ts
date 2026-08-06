// =============================================================================
// packages/scripts/compile-scenes/orchestrator.ts
//
// Top-level compile pipeline:
//   1. Discover chapter_<N>/ directories under static/stories_plan/.
//   2. Parse chapter.md per chapter.
//   3. Parse each scene file (type inferred from filename prefix).
//   4. Validate the full corpus.
//   5. Emit JSON to apps/game/src-tauri/resources/scenes/.
//
// Pure-ish: takes a sourceRoot + outputRoot. Test code passes fixture roots.
// Production code uses the repo paths.
//
// Surgical delete: never blanket-rmSync the outputRoot. The output root may
// contain a tracked .gitkeep placeholder (so Tauri's bundle.resources glob
// matches even before any scenes have been compiled). Only delete entries
// the orchestrator owns: chapters.json, story_catalog.json, and chapter_*/
// subdirectories.
// =============================================================================

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { parseChapter } from "./parser-chapter";
import { parseLinearScene } from "./parser-linear";
import { parseInvestigationScene } from "./parser-investigation";
import { parseInterrogationScene } from "./parser-interrogation";
import { parseAnalysisScene } from "./parser-analysis";
import { emptyStoryCatalog, parseStoryCatalog } from "./parser-story-catalog";
import {
  applyInvestigationLayout,
  detectLayoutOverlaps,
  parseInvestigationLayoutJson,
} from "./layout";
import { validate, type SceneRecord } from "./validator";
import {
  validateStoryCatalog,
  validateStoryPredicateReferences,
} from "./story-catalog";
import { createAnalysisDefinitionRegistryFromScenes } from "./analysis-definition-registry";
import {
  validateAnalysisScenes,
  type NormalizedAnalysisScene,
} from "./validator-analysis";
import {
  analyzeReachability,
  buildReachabilityNodes,
  type ReachabilityDiagnostic,
} from "./reachability";
import {
  CaseRecordEmissionError,
  emitChaptersIndex,
  emitAnalysisScene,
  emitInterrogationScene,
  emitInvestigationScene,
  emitLinearScene,
  emitStoryCatalog,
} from "./emitter";
import { compileCaseRecordCorpus } from "./case-record-provenance";
import {
  buildSaveContentManifest,
  type EmittedSceneJsonV1,
  type SaveContentBundleV1,
} from "./save-content-manifest";
import {
  validateDerivedDialogueOriginCollisions,
  type EmittedSceneRecordV1,
} from "./dialogue-segment-origins";
import { materializeSemanticDefaults } from "./semantic-defaults";
import { validateSaveContentReferences } from "./save-content-references";
import type {
  ASTChapter,
  AnalysisSceneRecord,
  ASTStoryCatalog,
  CompileError,
  CompiledCaseRecordCorpus,
} from "./types";
import { loadAssetConfig } from "./assets/config";
import { enrichScenesWithAssets } from "./assets/enrich";
import type { AssetManifest } from "./assets/manifest";

export type CompileOptions = {
  /**
   * One source tree, or several to merge in a single pass. Roots that do not
   * exist are skipped; the same chapter_<N> in two roots is a collision.
   */
  sourceRoot: string | string[];
  outputRoot: string;
  assetConfigRoot?: string;
  assetOutputRoot?: string;
  /**
   * Repository root that asset manifest `expectedPath` values are relative
   * to. Required for the asset-existence check to work regardless of the
   * invocation cwd (e.g. `--cwd packages/scripts`). Falls back to
   * `process.cwd()` when omitted for backward compatibility.
   */
  repoRoot?: string;
};

export type AssetReport = {
  enabled: boolean;
  requested: Record<
    "background" | "portrait" | "standee" | "evidence" | "audio",
    number
  >;
  warnings: CompileError[];
};

export type CompileResult =
  | {
      ok: true;
      chaptersCompiled: number;
      scenesCompiled: number;
      assetReport: AssetReport;
      /**
       * Non-blocking warnings that do not fail the build. Currently carries
       * layout geometry warnings (e.g. overlapping hotspot rects); printed
       * by the CLI but never change the exit code.
       */
      warnings: CompileError[];
    }
  | { ok: false; errors: CompileError[] };

export function compile(opts: CompileOptions): CompileResult {
  const chapters: ASTChapter[] = [];
  const scenes: SceneRecord[] = [];
  // Task 5 owns manifest dispatch that fills this collection. Keeping the
  // typed ownership here makes registry/catalog derivation authoritative now
  // without an eager scan or a synthetic CompileOptions injection seam.
  const analysisScenes: AnalysisSceneRecord[] = [];
  const errors: CompileError[] = [];
  const warnings: CompileError[] = [];
  const skippedReservedFiles = new Set<string>();
  const failedParseFiles = new Set<string>();
  let storyCatalog: ASTStoryCatalog = emptyStoryCatalog("story_catalog.md");
  let storyCatalogPath: string | null = null;

  const sourceRoots = Array.isArray(opts.sourceRoot)
    ? opts.sourceRoot
    : [opts.sourceRoot];

  // 1. Discover chapter directories across every source root, then merge.
  //
  // Roots are optional: a path that does not exist is skipped (e.g. an empty
  // static/ tree while all authored content lives under docs/). A root that
  // exists but cannot be read is a hard error. The same chapter_<N> appearing
  // in more than one root is a collision — each chapter must live in exactly
  // one root, since they all emit into the same outputRoot/chapter_<N>/.
  const discovered: { dirName: string; chapterDir: string }[] = [];
  const claimedBy = new Map<string, string>(); // dirName -> root that owns it
  for (const root of sourceRoots) {
    if (!existsSync(root)) continue;
    const candidateCatalogPath = resolve(root, "story_catalog.md");
    if (existsSync(candidateCatalogPath)) {
      if (storyCatalogPath === null) {
        storyCatalogPath = candidateCatalogPath;
      } else {
        errors.push({
          code: "duplicateStoryCatalog",
          message: `Story catalog found in multiple source roots (${storyCatalogPath} and ${candidateCatalogPath}); exactly one global catalog may be authored.`,
          sourceFile: candidateCatalogPath,
          line: 1,
        });
      }
    }

    let entries: string[];
    try {
      entries = readdirSync(root).filter(
        (d) =>
          /^chapter_\d+$/.test(d) && statSync(resolve(root, d)).isDirectory(),
      );
    } catch (e) {
      errors.push({
        code: "sourceRootUnreadable",
        message: `${root}: ${(e as Error).message}`,
        sourceFile: root,
        line: 0,
      });
      continue;
    }
    for (const dirName of entries) {
      const owner = claimedBy.get(dirName);
      if (owner !== undefined) {
        errors.push({
          code: "duplicateChapter",
          message: `Chapter "${dirName}" found in multiple source roots (${owner} and ${root}); each chapter must be defined in exactly one root.`,
          sourceFile: resolve(root, dirName),
          line: 0,
        });
        continue;
      }
      claimedBy.set(dirName, root);
      discovered.push({ dirName, chapterDir: resolve(root, dirName) });
    }
  }
  discovered.sort((a, b) => byChapterNumber(a.dirName, b.dirName));

  if (storyCatalogPath !== null) {
    try {
      const parsedCatalog = parseStoryCatalog(
        readFileSync(storyCatalogPath, "utf-8"),
        storyCatalogPath,
      );
      if (parsedCatalog.ok) {
        storyCatalog = parsedCatalog.value;
      } else {
        errors.push(...parsedCatalog.errors);
      }
    } catch (e) {
      errors.push({
        code: "storyCatalogUnreadable",
        message: `${storyCatalogPath}: ${(e as Error).message}`,
        sourceFile: storyCatalogPath,
        line: 1,
      });
    }
  }

  // 2 & 3. For each chapter, parse the manifest then each scene.
  if (discovered.length === 0 && errors.length === 0) {
    return {
      ok: false,
      errors: [
        {
          code: "noChaptersFound",
          message: `No chapter_<N> directories found under: ${sourceRoots.join(", ")}`,
          sourceFile: sourceRoots[0] ?? "",
          line: 0,
        },
      ],
    };
  }
  for (const { dirName, chapterDir } of discovered) {
    const manifestPath = resolve(chapterDir, "chapter.md");
    let manifestSource: string;
    try {
      manifestSource = readFileSync(manifestPath, "utf-8");
    } catch (e) {
      errors.push({
        code: "chapterManifestMissing",
        message: `${manifestPath}: ${(e as Error).message}`,
        sourceFile: manifestPath,
        line: 1,
      });
      continue;
    }
    const chapter = parseChapter(
      manifestSource,
      `${dirName}/chapter.md`,
      dirName,
    );
    if (!chapter.ok) {
      errors.push(chapter.error);
      continue;
    }
    chapters.push(chapter.value);

    for (const file of chapter.value.sceneFiles) {
      const sceneId = file.replace(/\.md$/, "");
      const scenePath = resolve(chapterDir, file);
      let source: string;
      try {
        source = readFileSync(scenePath, "utf-8");
      } catch (e) {
        errors.push({
          code: "sceneFileMissing",
          message: `${scenePath}: ${(e as Error).message}`,
          sourceFile: scenePath,
          line: 1,
        });
        continue;
      }
      const sourceFileTag = `${dirName}/${file}`;
      if (file.startsWith("scene_")) {
        const parsed = parseLinearScene(source, sourceFileTag, sceneId);
        if (!parsed.ok) {
          errors.push(parsed.error);
          failedParseFiles.add(sourceFileTag);
        } else scenes.push({ chapterId: dirName, file, ast: parsed.value });
      } else if (file.startsWith("investigation_scene_")) {
        const parsed = parseInvestigationScene(source, sourceFileTag, sceneId);
        if (!parsed.ok) {
          errors.push(parsed.error);
          failedParseFiles.add(sourceFileTag);
        } else {
          const layoutFile = file.replace(/\.md$/, ".layout.json");
          const layoutPath = resolve(chapterDir, layoutFile);
          const layoutSourceFileTag = `${dirName}/${layoutFile}`;
          let ast = parsed.value;
          if (existsSync(layoutPath)) {
            try {
              const layoutSource = readFileSync(layoutPath, "utf-8");
              const layout = parseInvestigationLayoutJson(
                layoutSource,
                layoutSourceFileTag,
              );
              if (!layout.ok) {
                errors.push(...layout.errors);
              } else {
                const applied = applyInvestigationLayout(
                  ast,
                  layout.value,
                  layoutSourceFileTag,
                );
                if (!applied.ok) {
                  errors.push(...applied.errors);
                } else {
                  ast = applied.value;
                  warnings.push(
                    ...detectLayoutOverlaps(layout.value, layoutSourceFileTag),
                  );
                }
              }
            } catch (e) {
              errors.push({
                code: "layoutFileUnreadable",
                message: `${layoutPath}: ${(e as Error).message}`,
                sourceFile: layoutSourceFileTag,
                line: 1,
              });
            }
          }
          scenes.push({ chapterId: dirName, file, ast });
        }
      } else if (file.startsWith("interrogation_scene_")) {
        const parsed = parseInterrogationScene(source, sourceFileTag, sceneId);
        if (!parsed.ok) {
          errors.push(parsed.error);
          failedParseFiles.add(sourceFileTag);
        } else scenes.push({ chapterId: dirName, file, ast: parsed.value });
      } else if (file.startsWith("analysis_scene_")) {
        const parsed = parseAnalysisScene(source, sourceFileTag, sceneId);
        if (!parsed.ok) {
          errors.push(parsed.error);
          failedParseFiles.add(sourceFileTag);
        } else {
          analysisScenes.push({ chapterId: dirName, file, ast: parsed.value });
        }
      } else {
        errors.push({
          code: "sceneFileUnknownType",
          message: `Unknown scene-file prefix: ${file}`,
          sourceFile: scenePath,
          line: 1,
        });
      }
    }
  }

  const assetConfig = loadAssetConfig(
    // sourceRoots is contractually non-empty at this point (chapters were
    // discovered above); fall back to the first root for asset config path.
    opts.assetConfigRoot ?? resolve(sourceRoots[0] ?? ".", "../assets/config"),
  );
  if (!assetConfig.ok) {
    errors.push(...assetConfig.errors);
  }

  let assetReport: AssetReport = {
    enabled: false,
    requested: {
      background: 0,
      portrait: 0,
      standee: 0,
      evidence: 0,
      audio: 0,
    },
    warnings: [],
  };

  let manifestToWrite: AssetManifest | null = null;
  if (assetConfig.ok) {
    const configWarnings = assetConfig.warnings;
    scenes.forEach((scene, i) => {
      scenes[i] = materializeSemanticDefaults(scene);
    });
    const enriched = enrichScenesWithAssets({
      scenes,
      config: assetConfig.value,
      ...(opts.repoRoot === undefined ? {} : { repoRoot: opts.repoRoot }),
    });
    scenes.splice(0, scenes.length, ...enriched.scenes);
    errors.push(...enriched.errors);
    assetReport = makeAssetReport(enriched.manifest, [
      ...configWarnings,
      ...enriched.warnings,
    ]);
    manifestToWrite = enriched.manifest;
    if (enriched.errors.length === 0) {
      errors.push(
        ...validateSaveContentReferences({
          scenes,
          config: assetConfig.value,
          manifest: enriched.manifest,
        }),
      );
    }
  }

  // 4. Validate. Task 5 populates analysisScenes during manifest dispatch;
  // derive its definition registry only after that parse phase is complete.
  const analysisRegistry =
    createAnalysisDefinitionRegistryFromScenes(analysisScenes);
  const validationErrors = validate({
    chapters,
    scenes,
    analysisScenes,
    skippedReservedFiles,
    failedParseFiles,
  });
  const storyCatalogErrors = validateStoryCatalog(storyCatalog, scenes);
  const storyPredicateReferenceErrors = validateStoryPredicateReferences({
    catalog: storyCatalog,
    scenes,
    analysisRegistry,
  });
  errors.push(
    ...validationErrors,
    ...storyCatalogErrors,
    ...storyPredicateReferenceErrors,
  );
  // Preserve the established HPA-257 reachability eligibility boundary:
  // structural, story-catalog, and ordinary story-predicate diagnostics block
  // it, while later case-record and analysis semantic diagnostics are reported
  // before (and alongside) the existing reachability analysis.
  const shouldAnalyzeReachability = errors.length === 0;
  const caseRecordResult = compileCaseRecordCorpus(storyCatalog, scenes);
  let normalizedAnalysisScenes: NormalizedAnalysisScene[] | null = null;
  if (caseRecordResult.ok) {
    warnings.push(...caseRecordResult.value.warnings);
    const analysisValidation = validateAnalysisScenes({
      scenes: analysisScenes,
      catalog: storyCatalog,
      caseRecords: caseRecordResult.value,
      analysisRegistry,
    });
    if (analysisValidation.ok) {
      normalizedAnalysisScenes = analysisValidation.value;
    } else {
      errors.push(...analysisValidation.errors);
    }
  } else {
    errors.push(...caseRecordResult.errors);
  }

  if (
    shouldAnalyzeReachability &&
    !(analysisScenes.length > 0 && normalizedAnalysisScenes === null)
  ) {
    const nodes = buildReachabilityNodes({
      chapters,
      scenes,
      catalog: storyCatalog,
      analysisRegistry,
      analysisScenes,
      normalizedAnalysisScenes: normalizedAnalysisScenes ?? [],
    });
    const progression = analyzeReachability({ nodes, catalog: storyCatalog });
    errors.push(...sortReachabilityDiagnostics(progression.errors));
    warnings.push(...sortReachabilityDiagnostics(progression.warnings));
  }
  if (caseRecordResult.ok) {
    try {
      const emittedForOriginValidation: EmittedSceneRecordV1[] = scenes.map(
        (rec) => ({
          chapterId: rec.chapterId,
          json: emitSceneRecord(rec, caseRecordResult.value),
          sourceAst: rec.ast,
        }),
      );
      if (normalizedAnalysisScenes !== null) {
        const normalizedBySceneKey = new Map(
          normalizedAnalysisScenes.map(
            (scene) => [`${scene.chapterId}/${scene.sceneId}`, scene] as const,
          ),
        );
        for (const rec of analysisScenes) {
          const normalized = normalizedBySceneKey.get(
            `${rec.chapterId}/${rec.ast.id}`,
          );
          if (!normalized) {
            throw new Error(
              `Missing normalized analysis scene for ${rec.chapterId}/${rec.file}.`,
            );
          }
          emittedForOriginValidation.push({
            chapterId: rec.chapterId,
            json: emitAnalysisScene(normalized),
            sourceAst: rec.ast,
          });
        }
      }
      errors.push(
        ...validateDerivedDialogueOriginCollisions(emittedForOriginValidation),
      );
    } catch (error) {
      if (!(error instanceof CaseRecordEmissionError)) throw error;
      errors.push(error);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  if (!caseRecordResult.ok) {
    throw new Error("case record corpus failed without compiler errors");
  }
  if (normalizedAnalysisScenes === null) {
    throw new Error("analysis normalization failed without compiler errors");
  }
  const caseRecords = caseRecordResult.value;

  // 5. Surgical delete + emit + write to disk.
  //
  // Do NOT rmSync the entire outputRoot — it may contain a tracked .gitkeep
  // placeholder that must be preserved. Delete only entries this orchestrator
  // is responsible for: chapters.json, story_catalog.json,
  // save_content_manifest.json, and chapter_*/ subdirectories.
  mkdirSync(opts.outputRoot, { recursive: true });
  const oldChaptersJson = resolve(opts.outputRoot, "chapters.json");
  if (existsSync(oldChaptersJson)) rmSync(oldChaptersJson, { force: true });
  const oldStoryCatalogJson = resolve(opts.outputRoot, "story_catalog.json");
  if (existsSync(oldStoryCatalogJson))
    rmSync(oldStoryCatalogJson, { force: true });
  const oldSaveContentManifestJson = resolve(
    opts.outputRoot,
    "save_content_manifest.json",
  );
  if (existsSync(oldSaveContentManifestJson))
    rmSync(oldSaveContentManifestJson, { force: true });
  for (const entry of readdirSync(opts.outputRoot)) {
    if (/^chapter_\d+$/.test(entry)) {
      rmSync(resolve(opts.outputRoot, entry), { recursive: true, force: true });
    }
  }

  const emittedChapters: SaveContentBundleV1["chapters"] = [];
  const sceneRecordsByManifestKey = new Map<string, SceneRecord>(
    scenes.map((rec) => [`${rec.chapterId}/${rec.file}`, rec] as const),
  );
  const normalizedAnalysisBySceneKey = new Map(
    (normalizedAnalysisScenes ?? []).map(
      (scene) => [`${scene.chapterId}/${scene.sceneId}`, scene] as const,
    ),
  );
  const emittedAnalysisByManifestKey = new Map<string, EmittedSceneJsonV1>(
    analysisScenes.map((rec) => {
      const normalized = normalizedAnalysisBySceneKey.get(
        `${rec.chapterId}/${rec.ast.id}`,
      );
      if (!normalized) {
        throw new Error(
          `Missing normalized analysis scene for ${rec.chapterId}/${rec.file}.`,
        );
      }
      return [
        `${rec.chapterId}/${rec.file}`,
        emitAnalysisScene(normalized),
      ] as const;
    }),
  );
  for (const chapter of chapters) {
    const emittedScenes: EmittedSceneJsonV1[] = [];
    for (const file of chapter.sceneFiles) {
      const key = `${chapter.dirName}/${file}`;
      const rec = sceneRecordsByManifestKey.get(key);
      const json = rec
        ? emitSceneRecord(rec, caseRecords)
        : emittedAnalysisByManifestKey.get(key);
      if (!json) continue;
      const outFile = resolve(
        opts.outputRoot,
        chapter.dirName,
        file.replace(/\.md$/, ".json"),
      );
      mkdirSync(dirname(outFile), { recursive: true });
      writeFileSync(outFile, JSON.stringify(json, null, 2) + "\n");
      emittedScenes.push(json);
    }
    emittedChapters.push({
      id: chapter.dirName,
      title: chapter.title,
      summary: chapter.summary,
      scenes: emittedScenes,
    });
  }

  const idx = emitChaptersIndex(chapters);
  writeFileSync(
    resolve(opts.outputRoot, "chapters.json"),
    JSON.stringify(idx, null, 2) + "\n",
  );
  const emittedStoryCatalog = emitStoryCatalog(
    storyCatalog,
    caseRecords,
    analysisScenes,
  );
  writeFileSync(
    resolve(opts.outputRoot, "story_catalog.json"),
    JSON.stringify(emittedStoryCatalog, null, 2) + "\n",
  );
  writeFileSync(
    resolve(opts.outputRoot, "save_content_manifest.json"),
    JSON.stringify(
      buildSaveContentManifest({
        bundle: {
          chapters: emittedChapters,
          storyCatalog: emittedStoryCatalog,
        },
      }),
      null,
      2,
    ) + "\n",
  );

  if (opts.assetOutputRoot && manifestToWrite) {
    mkdirSync(opts.assetOutputRoot, { recursive: true });
    writeFileSync(
      resolve(opts.assetOutputRoot, "manifest.json"),
      JSON.stringify(manifestToWrite, null, 2) + "\n",
    );
    writeFileSync(
      resolve(opts.assetOutputRoot, "report.json"),
      JSON.stringify(assetReport, null, 2) + "\n",
    );
  }

  return {
    ok: true,
    chaptersCompiled: chapters.length,
    scenesCompiled: scenes.length + analysisScenes.length,
    assetReport,
    warnings,
  };
}

function emitSceneRecord(
  rec: SceneRecord,
  caseRecords: CompiledCaseRecordCorpus,
): EmittedSceneJsonV1 {
  return rec.ast.kind === "linearScene"
    ? emitLinearScene(rec.ast)
    : rec.ast.kind === "investigationScene"
      ? emitInvestigationScene(rec.ast, caseRecords)
      : emitInterrogationScene(rec.ast, caseRecords);
}

function makeAssetReport(
  manifest: AssetManifest,
  warnings: CompileError[],
): AssetReport {
  const requested: AssetReport["requested"] = {
    background: 0,
    portrait: 0,
    standee: 0,
    evidence: 0,
    audio: 0,
  };
  for (const entry of manifest.entries) {
    requested[entry.type] += 1;
  }
  return { enabled: manifest.enabled, requested, warnings };
}

function byChapterNumber(a: string, b: string): number {
  const an = Number(a.replace("chapter_", ""));
  const bn = Number(b.replace("chapter_", ""));
  return an - bn;
}

function sortReachabilityDiagnostics(
  diagnostics: ReachabilityDiagnostic[],
): ReachabilityDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    const sourceOrder = compareDiagnosticText(
      normalizedDiagnosticPath(left.sourceFile),
      normalizedDiagnosticPath(right.sourceFile),
    );
    if (sourceOrder !== 0) return sourceOrder;
    if (left.line !== right.line) return left.line - right.line;
    const codeOrder = compareDiagnosticText(left.code, right.code);
    if (codeOrder !== 0) return codeOrder;
    const nodeOrder = compareDiagnosticText(left.nodeKey, right.nodeKey);
    if (nodeOrder !== 0) return nodeOrder;
    return (left.targetIndex ?? -1) - (right.targetIndex ?? -1);
  });
}

function normalizedDiagnosticPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function compareDiagnosticText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function formatErrors(errors: CompileError[]): string {
  return errors
    .map((e) => `${e.sourceFile}:${e.line}\t[${e.code}] ${e.message}`)
    .join("\n");
}
