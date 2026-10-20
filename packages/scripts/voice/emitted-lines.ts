import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { compile } from "../compile-scenes/orchestrator";
import type { CompileError } from "../compile-scenes/types";
import { STORY_ROOT } from "./locale-script";
import type { EmittedScene } from "./types";

type EmittedLinesResult =
  | { ok: true; scenes: EmittedScene[] }
  | { ok: false; errors: CompileError[] };

/**
 * Lists every spoken `line` item of one chapter, in manifest scene order and
 * emitted dialogue order, with each line's `{#L012}` ID, by compiling the
 * authored tree into a throwaway directory. Uses the same emitted scenes the
 * game loads (asset enrichment included, so portrait expressions match
 * runtime), and never touches the generated resource tree.
 */
export function collectEmittedLines(input: {
  repoRoot: string;
  chapterId: string;
  storyRoot?: string;
  assetConfigRoot?: string;
}): EmittedLinesResult {
  const workDir = mkdtempSync(resolve(tmpdir(), "lyra-voice-"));
  try {
    const result = compile({
      sourceRoot: resolve(input.repoRoot, input.storyRoot ?? STORY_ROOT),
      outputRoot: resolve(workDir, "scenes"),
      assetConfigRoot: resolve(
        input.repoRoot,
        input.assetConfigRoot ?? "static/assets/config",
      ),
      assetOutputRoot: resolve(workDir, "assets"),
      repoRoot: input.repoRoot,
    });
    if (!result.ok) return { ok: false, errors: result.errors };

    const chapter = result.spokenLines.find(
      (c) => c.chapterId === input.chapterId,
    );
    if (!chapter) {
      return {
        ok: false,
        errors: [
          {
            code: "voiceChapterNotFound",
            message: `Chapter "${input.chapterId}" is not in the compiled story.`,
            sourceFile: input.chapterId,
            line: 0,
          },
        ],
      };
    }
    return {
      ok: true,
      scenes: chapter.scenes.map((scene) => ({
        chapterId: input.chapterId,
        sceneFile: scene.sceneFile,
        sceneId: scene.sceneId,
        lines: scene.lines,
      })),
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
