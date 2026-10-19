import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import {
  deriveDialogueSegments,
  type EmittedSceneRecordV1,
} from "../compile-scenes/dialogue-segment-origins";
import { compile } from "../compile-scenes/orchestrator";
import type { CompileError } from "../compile-scenes/types";
import { STORY_ROOT } from "./locale-script";
import type { EmittedLine, EmittedScene } from "./types";

type ChaptersIndex = {
  chapters: Array<{
    id: string;
    scenes: Array<{ type: string; file: string }>;
  }>;
};

type EmittedLinesResult =
  | { ok: true; scenes: EmittedScene[] }
  | { ok: false; errors: CompileError[] };

/**
 * Lists every spoken `line` item of one chapter, in manifest scene order and
 * emitted dialogue order, by compiling the authored tree into a throwaway
 * directory. Reads the same emitted JSON the game loads (asset enrichment
 * included, so portrait expressions match runtime), and never touches the
 * generated resource tree.
 */
export function collectEmittedLines(input: {
  repoRoot: string;
  chapterId: string;
  storyRoot?: string;
  assetConfigRoot?: string;
}): EmittedLinesResult {
  const workDir = mkdtempSync(resolve(tmpdir(), "lyra-voice-"));
  try {
    const outputRoot = resolve(workDir, "scenes");
    const result = compile({
      sourceRoot: resolve(input.repoRoot, input.storyRoot ?? STORY_ROOT),
      outputRoot,
      assetConfigRoot: resolve(
        input.repoRoot,
        input.assetConfigRoot ?? "static/assets/config",
      ),
      assetOutputRoot: resolve(workDir, "assets"),
      repoRoot: input.repoRoot,
    });
    if (!result.ok) return { ok: false, errors: result.errors };

    const index = JSON.parse(
      readFileSync(resolve(outputRoot, "chapters.json"), "utf-8"),
    ) as ChaptersIndex;
    const chapter = index.chapters.find((c) => c.id === input.chapterId);
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

    const scenes: EmittedScene[] = chapter.scenes.map((ref) => {
      const json = JSON.parse(
        readFileSync(resolve(outputRoot, ref.file), "utf-8"),
      ) as EmittedSceneRecordV1["json"];
      const lines: EmittedLine[] = [];
      for (const segment of deriveDialogueSegments({
        chapterId: input.chapterId,
        json,
      })) {
        for (const item of segment.items) {
          if (item.kind !== "line") continue;
          lines.push({
            speaker: item.speaker,
            text: item.text,
            expression: item.portrait?.expression ?? null,
          });
        }
      }
      return {
        chapterId: input.chapterId,
        sceneFile: basename(ref.file).replace(/\.json$/, ".md"),
        sceneId: json.id,
        lines,
      };
    });
    return { ok: true, scenes };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
