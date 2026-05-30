// =============================================================================
// scripts/compile-scenes/orchestrator.ts
//
// Top-level compile pipeline:
//   1. Discover chapter_<N>/ directories under static/stories_plan/.
//   2. Parse chapter.md per chapter.
//   3. Parse each scene file (type inferred from filename prefix).
//   4. Validate the full corpus.
//   5. Emit JSON to src-tauri/resources/scenes/.
//
// Pure-ish: takes a sourceRoot + outputRoot. Test code passes fixture roots.
// Production code uses the repo paths.
//
// Surgical delete: never blanket-rmSync the outputRoot. The output root may
// contain a tracked .gitkeep placeholder (so Tauri's bundle.resources glob
// matches even before any scenes have been compiled). Only delete entries
// the orchestrator owns: chapters.json and chapter_*/ subdirectories.
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
import { validate, type SceneRecord } from "./validator";
import { emitChaptersIndex, emitInterrogationScene, emitInvestigationScene, emitLinearScene } from "./emitter";
import type { ASTChapter, CompileError } from "./types";
import { loadAssetConfig } from "./assets/config";
import { enrichScenesWithAssets } from "./assets/enrich";
import type { AssetManifest } from "./assets/manifest";

export type CompileOptions = {
  sourceRoot: string;
  outputRoot: string;
  assetConfigRoot?: string;
  assetOutputRoot?: string;
};

export type AssetReport = {
  enabled: boolean;
  requested: Record<"background" | "portrait" | "evidence" | "audio", number>;
  warnings: CompileError[];
};

export type CompileResult =
  | { ok: true; chaptersCompiled: number; scenesCompiled: number; assetReport: AssetReport }
  | { ok: false; errors: CompileError[] };

export function compile(opts: CompileOptions): CompileResult {
  const chapters: ASTChapter[] = [];
  const scenes: SceneRecord[] = [];
  const errors: CompileError[] = [];
  const skippedReservedFiles = new Set<string>();
  const failedParseFiles = new Set<string>();

  // 1. Discover chapter directories.
  let dirs: string[];
  try {
    dirs = readdirSync(opts.sourceRoot)
      .filter((d) => /^chapter_\d+$/.test(d) && statSync(resolve(opts.sourceRoot, d)).isDirectory())
      .sort(byChapterNumber);
  } catch (e) {
    return {
      ok: false,
      errors: [{
        code: "sourceRootUnreadable",
        message: `${opts.sourceRoot}: ${(e as Error).message}`,
        sourceFile: opts.sourceRoot,
        line: 0,
      }],
    };
  }

  // 2 & 3. For each chapter, parse the manifest then each scene.
  if (dirs.length === 0) {
    return {
      ok: false,
      errors: [{
        code: "noChaptersFound",
        message: `No chapter_<N> directories found under ${opts.sourceRoot}`,
        sourceFile: opts.sourceRoot,
        line: 0,
      }],
    };
  }
  for (const dirName of dirs) {
    const chapterDir = resolve(opts.sourceRoot, dirName);
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
    const chapter = parseChapter(manifestSource, `${dirName}/chapter.md`, dirName);
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
        }
        else scenes.push({ chapterId: dirName, file, ast: parsed.value });
      } else if (file.startsWith("investigation_scene_")) {
        const parsed = parseInvestigationScene(source, sourceFileTag, sceneId);
        if (!parsed.ok) {
          errors.push(parsed.error);
          failedParseFiles.add(sourceFileTag);
        }
        else scenes.push({ chapterId: dirName, file, ast: parsed.value });
      } else if (file.startsWith("interrogation_scene_")) {
        const parsed = parseInterrogationScene(source, sourceFileTag, sceneId);
        if (!parsed.ok) {
          errors.push(parsed.error);
          failedParseFiles.add(sourceFileTag);
        }
        else scenes.push({ chapterId: dirName, file, ast: parsed.value });
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

  const assetConfig = loadAssetConfig(opts.assetConfigRoot ?? resolve(opts.sourceRoot, "../assets/config"));
  if (!assetConfig.ok) {
    errors.push(...assetConfig.errors);
  }

  let assetReport: AssetReport = {
    enabled: false,
    requested: { background: 0, portrait: 0, evidence: 0, audio: 0 },
    warnings: [],
  };

  let manifestToWrite: AssetManifest | null = null;
  if (assetConfig.ok) {
    const configWarnings = assetConfig.warnings;
    const enriched = enrichScenesWithAssets({ scenes, config: assetConfig.value });
    scenes.splice(0, scenes.length, ...enriched.scenes);
    errors.push(...enriched.errors);
    assetReport = makeAssetReport(enriched.manifest, [...configWarnings, ...enriched.warnings]);
    manifestToWrite = enriched.manifest;
  }

  // 4. Validate.
  errors.push(...validate({ chapters, scenes, skippedReservedFiles, failedParseFiles }));

  if (errors.length > 0) return { ok: false, errors };

  // 5. Surgical delete + emit + write to disk.
  //
  // Do NOT rmSync the entire outputRoot — it may contain a tracked .gitkeep
  // placeholder that must be preserved. Delete only entries this orchestrator
  // is responsible for: chapters.json and chapter_*/ subdirectories.
  mkdirSync(opts.outputRoot, { recursive: true });
  const oldChaptersJson = resolve(opts.outputRoot, "chapters.json");
  if (existsSync(oldChaptersJson)) rmSync(oldChaptersJson, { force: true });
  for (const entry of readdirSync(opts.outputRoot)) {
    if (/^chapter_\d+$/.test(entry)) {
      rmSync(resolve(opts.outputRoot, entry), { recursive: true, force: true });
    }
  }

  for (const rec of scenes) {
    const json =
      rec.ast.kind === "linearScene"
        ? emitLinearScene(rec.ast)
        : rec.ast.kind === "investigationScene"
          ? emitInvestigationScene(rec.ast)
          : emitInterrogationScene(rec.ast);
    const outFile = resolve(opts.outputRoot, rec.chapterId, rec.file.replace(/\.md$/, ".json"));
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, JSON.stringify(json, null, 2) + "\n");
  }

  const idx = emitChaptersIndex(chapters);
  writeFileSync(resolve(opts.outputRoot, "chapters.json"), JSON.stringify(idx, null, 2) + "\n");

  if (opts.assetOutputRoot && manifestToWrite) {
    mkdirSync(opts.assetOutputRoot, { recursive: true });
    writeFileSync(resolve(opts.assetOutputRoot, "manifest.json"), JSON.stringify(manifestToWrite, null, 2) + "\n");
    writeFileSync(resolve(opts.assetOutputRoot, "report.json"), JSON.stringify(assetReport, null, 2) + "\n");
  }

  return { ok: true, chaptersCompiled: chapters.length, scenesCompiled: scenes.length, assetReport };
}

function makeAssetReport(manifest: AssetManifest, warnings: CompileError[]): AssetReport {
  const requested: AssetReport["requested"] = { background: 0, portrait: 0, evidence: 0, audio: 0 };
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

export function formatErrors(errors: CompileError[]): string {
  return errors.map((e) => `${e.sourceFile}:${e.line}\t[${e.code}] ${e.message}`).join("\n");
}
