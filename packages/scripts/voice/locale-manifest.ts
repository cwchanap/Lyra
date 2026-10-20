import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { publicPathForAssetId, voiceAssetId } from "@lyra/asset-paths";
import {
  keyExpression,
  localeLineKey,
  type DialogueLocaleChapterV1,
  type DialogueLocaleLineV1,
  type DialogueLocaleManifestV1,
} from "@lyra/dialogue-locale";
import type { CompileError } from "../compile-scenes/types";
import { parseLocaleScriptText, sceneFileForScriptName } from "./locale-script";
import { ownerSceneFile, scriptLineKey, sourceChanged } from "./script-key";
import type { EmittedLine, LocaleScriptLine } from "./types";

export type LocaleManifestChapterInput = {
  chapterId: string;
  /** Absolute path of the authored chapter directory. */
  chapterDir: string;
  /** Manifest scenes in order, each with its emitted spoken lines. */
  scenes: Array<{ sceneFile: string; sceneId: string; lines: EmittedLine[] }>;
};

export type LocaleManifestResult = {
  manifest: DialogueLocaleManifestV1;
  warnings: CompileError[];
};

function warning(
  code: string,
  message: string,
  sourceFile: string,
): CompileError {
  return { code, message, sourceFile, line: 1 };
}

/**
 * Reads one chapter's `<locale>/*.<locale>.yaml` scripts into a
 * `scene_5.md#L012` -> line pool. Unreadable scripts and repeated IDs become
 * warnings (the first entry wins); `voice:validate` reports the details.
 */
function readChapterScripts(
  chapterId: string,
  scriptDir: string,
  locale: string,
  repoRoot: string,
  warnings: CompileError[],
): Map<string, LocaleScriptLine> {
  const pool = new Map<string, LocaleScriptLine>();
  const names = readdirSync(scriptDir)
    .filter((name) => sceneFileForScriptName(name, locale) !== null)
    .sort();
  for (const name of names) {
    const sceneFile = sceneFileForScriptName(name, locale) as string;
    const path = relative(repoRoot, resolve(scriptDir, name));
    const parsed = parseLocaleScriptText(
      readFileSync(resolve(scriptDir, name), "utf-8"),
      path,
    );
    if (!parsed.ok) {
      const count = parsed.diagnostics.length;
      warnings.push(
        warning(
          "dialogueLocaleScriptInvalid",
          `${path} was skipped because it has ${count} problem(s), starting with: ${parsed.diagnostics[0]?.message ?? "invalid script."} Run \`bun run voice:validate ${chapterId}\`.`,
          path,
        ),
      );
      continue;
    }
    for (const line of parsed.value.lines) {
      const key = scriptLineKey(sceneFile, line.id);
      if (pool.has(key)) {
        warnings.push(
          warning(
            "dialogueLocaleDuplicateKey",
            `${path} lists ${line.id} twice; the first entry is used. Run \`bun run voice:validate ${chapterId}\`.`,
            path,
          ),
        );
        continue;
      }
      pool.set(key, line);
    }
  }
  return pool;
}

/**
 * Joins every emitted spoken line with the chapter's translated script into
 * the runtime locale manifest. Chapters without a `<locale>/` folder are left
 * out. Untranslated lines are skipped, and a voice clip is listed only when
 * its `.ogg` file exists, so the game never asks for audio that is not in the
 * build. Both gaps are reported as one warning per chapter.
 */
export function buildDialogueLocaleManifest(input: {
  locale: string;
  chapters: LocaleManifestChapterInput[];
  repoRoot: string;
}): LocaleManifestResult {
  const warnings: CompileError[] = [];
  const chapters: DialogueLocaleChapterV1[] = [];

  for (const chapter of input.chapters) {
    const scriptDir = resolve(chapter.chapterDir, input.locale);
    if (!existsSync(scriptDir)) continue;
    const scriptDirPath = relative(input.repoRoot, scriptDir);
    const pool = readChapterScripts(
      chapter.chapterId,
      scriptDir,
      input.locale,
      input.repoRoot,
      warnings,
    );

    const lines: DialogueLocaleLineV1[] = [];
    const seen = new Set<string>();
    const lineByRuntimeKey = new Map<string, DialogueLocaleLineV1>();
    let untranslated = 0;
    let changed = 0;
    let ambiguous = 0;
    const missingClips: string[] = [];
    for (const scene of chapter.scenes) {
      for (const emitted of scene.lines) {
        const owner = ownerSceneFile(emitted, scene.sceneFile);
        const key =
          emitted.id === null ? null : scriptLineKey(owner, emitted.id);
        if (key !== null) {
          if (seen.has(key)) continue;
          seen.add(key);
        }
        const entry = key === null ? undefined : pool.get(key);
        if (!entry || entry.ja.trim().length === 0) {
          untranslated += 1;
          continue;
        }
        if (sourceChanged(entry, emitted)) changed += 1;
        let voice: string | null = null;
        if (entry.voice) {
          const assetId = voiceAssetId(input.locale, entry.voice.clip);
          const expected = `static${publicPathForAssetId(assetId, "voice")}`;
          if (existsSync(resolve(input.repoRoot, expected))) {
            voice = assetId;
          } else {
            missingClips.push(expected);
          }
        }
        // The game matches lines by speaker, expression and Chinese text.
        // Two IDs that read the same share one runtime entry: the first
        // translation wins, and the line's clip is whichever of them has one
        // (voice:sync gives a clip to only one of two identical lines).
        const runtimeKey = localeLineKey(emitted);
        const prior = lineByRuntimeKey.get(runtimeKey);
        if (prior !== undefined) {
          if (prior.text !== entry.ja) ambiguous += 1;
          else if (prior.voice === null) prior.voice = voice;
          continue;
        }
        const line: DialogueLocaleLineV1 = {
          speaker: emitted.speaker,
          expression: keyExpression(emitted.expression),
          zh: emitted.text,
          text: entry.ja,
          voice,
        };
        lineByRuntimeKey.set(runtimeKey, line);
        lines.push(line);
      }
    }
    chapters.push({ id: chapter.chapterId, lines });

    if (untranslated > 0) {
      warnings.push(
        warning(
          "dialogueLocaleIncomplete",
          `${chapter.chapterId} ${input.locale}: ${untranslated} spoken lines have no translation yet. Run \`bun run voice:sync ${chapter.chapterId}\`, then \`bun run voice:validate ${chapter.chapterId}\`.`,
          scriptDirPath,
        ),
      );
    }
    if (changed > 0) {
      warnings.push(
        warning(
          "dialogueLocaleSourceChanged",
          `${chapter.chapterId} ${input.locale}: ${changed} translated lines changed in the scene since translation and still use the old translation. Run \`bun run voice:validate ${chapter.chapterId}\`.`,
          scriptDirPath,
        ),
      );
    }
    if (ambiguous > 0) {
      warnings.push(
        warning(
          "dialogueLocaleAmbiguous",
          `${chapter.chapterId} ${input.locale}: ${ambiguous} lines repeat another line's speaker and Chinese text with a different translation; the game plays the first one's.`,
          scriptDirPath,
        ),
      );
    }
    if (missingClips.length > 0) {
      warnings.push(
        warning(
          "voiceClipMissing",
          `${chapter.chapterId} ${input.locale}: ${missingClips.length} voice clip(s) not found (first: ${missingClips[0]}); those lines play without voice.`,
          scriptDirPath,
        ),
      );
    }
  }

  return {
    manifest: { schemaVersion: 1, locale: input.locale, chapters },
    warnings,
  };
}
