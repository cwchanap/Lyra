// =============================================================================
// scripts/compile-scenes/parser-chapter.ts
//
// Parses a chapter.md manifest. Produces an ASTChapter or a CompileError.
//
// Schema (see writing-chapter-manifest skill):
//   # Chapter <N>: <title>
//   **Summary:** <summary>
//   ## Scenes
//   1. scene_0.md
//   2. investigation_scene_1.md
// =============================================================================

import type { ASTChapter, CompileError } from "./types";

export type ChapterParseResult =
  | { ok: true; value: ASTChapter }
  | { ok: false; error: CompileError };

// Reject path separators to prevent directory traversal (e.g. "../other/evil.md").
const NUMBERED_FILE_RE = /^(\d+)\.\s+([^\/\\]+\.md)\s*$/;

export function parseChapter(
  source: string,
  sourceFile: string,
  dirName: string,
): ChapterParseResult {
  // The manifest has a simple top-down structure; rather than tokenizing,
  // we walk lines directly for the few specific shapes the manifest takes.
  const lines = source.split(/\r?\n/);
  let title: string | null = null;
  let chapterNumber: number | null = null;
  let summary: string | null = null;
  let inScenes = false;
  const sceneFiles: string[] = [];
  let headerLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    const lineNum = i + 1;
    if (line === "") continue;

    if (line.startsWith("# ")) {
      const m = /^#\s+Chapter\s+(\d+):\s+(.+?)\s*$/.exec(line);
      if (!m) {
        return fail(sourceFile, lineNum, "chapterMalformedH1", `H1 must match "# Chapter <N>: <title>"; got: ${line}`);
      }
      chapterNumber = Number(m[1]);
      title = m[2] ?? "";
      headerLine = lineNum;
      continue;
    }

    if (line.startsWith("**Summary:**")) {
      summary = line.slice("**Summary:**".length).trim();
      continue;
    }

    if (line === "## Scenes") {
      inScenes = true;
      continue;
    }

    if (inScenes) {
      const m = NUMBERED_FILE_RE.exec(line);
      if (m) {
        sceneFiles.push(m[2] ?? "");
      } else if (/^\d+\.\s/.test(line)) {
        // Looks like a numbered entry but doesn't match the strict pattern
        // (e.g. missing .md extension, trailing text, wrong format).
        return fail(sourceFile, lineNum, "chapterMalformedSceneRow", `Scene list entry is malformed; expected "N. <file>.md". Got: ${line}`);
      }
      // Non-numbered, non-blank lines inside Scenes are ignored (e.g. comments).
    }
  }

  if (chapterNumber === null || title === null) {
    return fail(sourceFile, 1, "chapterMissingH1", "Manifest missing # Chapter <N>: <title> heading.");
  }

  const expectedNumber = parseChapterDirNumber(dirName);
  if (expectedNumber !== null && expectedNumber !== chapterNumber) {
    return fail(
      sourceFile,
      headerLine,
      "chapterNumberMismatch",
      `Chapter H1 number ${chapterNumber} does not match directory ${dirName}.`,
    );
  }

  if (summary === null || summary === "") {
    return fail(sourceFile, 1, "chapterMissingSummary", "Manifest missing **Summary:** field.");
  }
  if (sceneFiles.length === 0) {
    return fail(sourceFile, 1, "chapterNoScenes", "Manifest must list at least one scene under ## Scenes.");
  }

  return {
    ok: true,
    value: {
      kind: "chapter",
      dirName,
      number: chapterNumber,
      title,
      summary,
      sceneFiles,
      sourceFile,
      line: headerLine || 1,
    },
  };
}

function parseChapterDirNumber(dirName: string): number | null {
  const m = /^chapter_(\d+)$/.exec(dirName);
  return m ? Number(m[1]) : null;
}

function fail(
  sourceFile: string,
  line: number,
  code: string,
  message: string,
): ChapterParseResult {
  return { ok: false, error: { code, message, sourceFile, line } };
}
