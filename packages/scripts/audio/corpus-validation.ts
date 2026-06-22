// =============================================================================
// packages/scripts/audio/corpus-validation.ts
//
// Spec-required corpus-aware checks that live outside the pure `validateSoundPlan`
// because they need to read the chapter manifest and scene markdown:
//
//   (#4a) The first visual unit in the asset-enabled corpus must explicitly set
//         both BGM and BGS in the plan (spec L251-252, L347). Silence is allowed
//         but must be explicit (`bgm: none`, `bgs: none`).
//   (#4b) Every cue must target a scene file listed in the chapter manifest
//         (spec L261-262, L348).
//
// Reuses `parseChapter` from compile-scenes and `indexVisualUnitsFromMarkdown`
// from this package so the definition of "visual unit" matches the apply step.
// =============================================================================

import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseChapter } from "../compile-scenes/parser-chapter";
import { indexVisualUnitsFromMarkdown } from "./visual-units";
import type { SoundPlan, SoundPlanCue, SoundPlanDiagnostic } from "./types";

/**
 * Default source roots searched for the chapter directory, mirroring the
 * compile-scenes entry point. A root that does not exist is skipped.
 */
export const DEFAULT_SOURCE_ROOTS = [
  "static/stories_plan",
  "docs/stories_plan",
] as const;

export type CorpusData = {
  /** Ordered scene-file basenames from the chapter manifest (e.g. `scene_0.md`). */
  chapterSceneFiles: string[];
  /** Scene-file basename → markdown source for every readable scene. */
  sceneSources: Map<string, string>;
};

export type CorpusLoadResult =
  | { ok: true; data: CorpusData }
  | { ok: false; diagnostics: SoundPlanDiagnostic[] };

/**
 * Read the chapter manifest and every listed scene file for `plan.chapterId`.
 * Returns diagnostics on failure rather than throwing — callers (validate/apply)
 * surface them through the normal diagnostic channel.
 */
export function loadCorpusForPlan(
  plan: SoundPlan,
  input: { repoRoot: string; sourceRoots?: readonly string[] },
): CorpusLoadResult {
  const roots = input.sourceRoots ?? DEFAULT_SOURCE_ROOTS;

  const chapterDir = findChapterDir(plan.chapterId, input.repoRoot, roots);
  if (chapterDir === null) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "soundPlanChapterDirNotFound",
          path: "chapterId",
          message: `Could not find chapter directory "${plan.chapterId}" under any source root.`,
        },
      ],
    };
  }

  const manifestPath = resolve(chapterDir, "chapter.md");
  if (!existsSync(manifestPath)) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "soundPlanChapterManifestMissing",
          path: "chapterId",
          message: `Chapter manifest not found at ${manifestPath}.`,
        },
      ],
    };
  }

  let manifestText: string;
  try {
    manifestText = readFileSync(manifestPath, "utf-8");
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "soundPlanChapterManifestUnreadable",
          path: "chapterId",
          message: `Failed to read chapter manifest: ${errorMessage(error)}`,
        },
      ],
    };
  }

  const parsed = parseChapter(manifestText, manifestPath, plan.chapterId);
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "soundPlanChapterManifestInvalid",
          path: "chapterId",
          message: `Chapter manifest parse failed: ${parsed.error.message}`,
        },
      ],
    };
  }

  const sceneSources = new Map<string, string>();
  for (const file of parsed.value.sceneFiles) {
    const fullPath = resolve(chapterDir, file);
    if (!existsSync(fullPath)) continue; // compile-scenes pipeline catches this.
    try {
      sceneSources.set(file, readFileSync(fullPath, "utf-8"));
    } catch {
      // Skip unreadable scene files; the compile pipeline reports them.
    }
  }

  return {
    ok: true,
    data: {
      chapterSceneFiles: parsed.value.sceneFiles,
      sceneSources,
    },
  };
}

/**
 * Run the corpus-aware checks against pre-loaded data. Pure so it can be
 * unit-tested without touching disk.
 */
export function validateSoundPlanAgainstCorpus(
  plan: SoundPlan,
  data: CorpusData,
): SoundPlanDiagnostic[] {
  const diagnostics: SoundPlanDiagnostic[] = [];
  const manifestSet = new Set(data.chapterSceneFiles);

  // (#4b) Every cue must target a scene file listed in the chapter manifest.
  for (const [index, cue] of plan.cues.entries()) {
    const name = basename(cue.file);
    if (!manifestSet.has(name)) {
      diagnostics.push({
        code: "soundPlanCueFileNotInManifest",
        path: `cues[${index}].file`,
        message: `Cue targets "${cue.file}" which is not listed in the chapter manifest.`,
      });
    }
  }

  // (#4a) The corpus-first visual unit must have a cue that explicitly sets
  // both BGM and BGS. "none" is an explicit value and is allowed for silence.
  const firstUnit = findFirstVisualUnit(data);
  if (firstUnit) {
    const cueIndex = plan.cues.findIndex(
      (c) =>
        basename(c.file) === firstUnit.file && c.visualUnit === firstUnit.id,
    );
    if (cueIndex === -1) {
      diagnostics.push({
        code: "soundPlanFirstVisualUnitMissingCue",
        path: "cues",
        message: `First visual unit ${firstUnit.file}#${firstUnit.id} has no cue. The first visual unit must explicitly set both BGM and BGS (use "none" for silence).`,
      });
    } else {
      const cue: SoundPlanCue | undefined = plan.cues[cueIndex];
      if (cue && !hasOwn(cue, "bgm")) {
        diagnostics.push({
          code: "soundPlanFirstVisualUnitMissingChannel",
          path: `cues[${cueIndex}].bgm`,
          message: `First visual unit ${firstUnit.file}#${firstUnit.id} cue must explicitly set BGM (use "none" for silence).`,
        });
      }
      if (cue && !hasOwn(cue, "bgs")) {
        diagnostics.push({
          code: "soundPlanFirstVisualUnitMissingChannel",
          path: `cues[${cueIndex}].bgs`,
          message: `First visual unit ${firstUnit.file}#${firstUnit.id} cue must explicitly set BGS (use "none" for silence).`,
        });
      }
    }
  }

  return diagnostics;
}

/**
 * Walk scene files in chapter-manifest order and return the first visual unit
 * found. Uses `indexVisualUnitsFromMarkdown` so the definition of "visual unit"
 * matches what the apply step will insert cues against.
 */
function findFirstVisualUnit(
  data: CorpusData,
): { file: string; id: string } | null {
  for (const file of data.chapterSceneFiles) {
    const source = data.sceneSources.get(file);
    if (!source) continue;
    const units = indexVisualUnitsFromMarkdown(file, source);
    const first = units[0];
    if (first) return { file, id: first.id };
  }
  return null;
}

function findChapterDir(
  chapterId: string,
  repoRoot: string,
  roots: readonly string[],
): string | null {
  for (const root of roots) {
    const candidate = resolve(repoRoot, root, chapterId);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
