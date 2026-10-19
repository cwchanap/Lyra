import { localeLineKey } from "./line-key";
import { localeScriptPath, sceneSourcePath } from "./locale-script";
import type { ExistingScript } from "./sync";
import type {
  EmittedScene,
  LocaleGlossary,
  LocaleScriptLine,
  VoiceDiagnostic,
} from "./types";

export type ValidateSummary = {
  emittedLines: number;
  uniqueLines: number;
  translated: number;
  missing: number;
  untranslated: number;
  stale: number;
};

export type ValidateResult = {
  diagnostics: VoiceDiagnostic[];
  summary: ValidateSummary;
};

function lineKey(line: LocaleScriptLine): string {
  return localeLineKey({
    speaker: line.speaker,
    text: line.zh,
    expression: line.expression ?? null,
  });
}

function label(line: { speaker: string; zh?: string; text?: string }): string {
  return `${line.speaker}: ${line.zh ?? line.text ?? ""}`;
}

/**
 * Checks a chapter's locale scripts against its emitted lines. Errors are
 * structural (duplicate keys, a script pointing at the wrong scene); warnings
 * are coverage gaps (missing or untranslated lines, stale or misplaced
 * entries, speakers without a glossary entry) that `--strict` promotes.
 */
export function validateChapterScripts(input: {
  chapterId: string;
  locale: string;
  scenes: EmittedScene[];
  existing: ExistingScript[];
  glossary?: { path: string; value: LocaleGlossary } | undefined;
}): ValidateResult {
  const diagnostics: VoiceDiagnostic[] = [];
  const summary: ValidateSummary = {
    emittedLines: 0,
    uniqueLines: 0,
    translated: 0,
    missing: 0,
    untranslated: 0,
    stale: 0,
  };

  const ownerByKey = new Map<string, string>();
  const speakers = new Set<string>();
  for (const scene of input.scenes) {
    for (const line of scene.lines) {
      summary.emittedLines += 1;
      speakers.add(line.speaker);
      const key = localeLineKey(line);
      if (!ownerByKey.has(key)) ownerByKey.set(key, scene.sceneFile);
    }
  }
  summary.uniqueLines = ownerByKey.size;

  const entryByKey = new Map<
    string,
    { line: LocaleScriptLine; path: string }
  >();
  for (const script of input.existing) {
    const expectedSource = sceneSourcePath(input.chapterId, script.sceneFile);
    if (script.file.source !== expectedSource) {
      diagnostics.push({
        severity: "error",
        code: "localeScriptSourceMismatch",
        message: `\`source\` is ${script.file.source} but the file name points at ${expectedSource}.`,
        path: script.path,
      });
    }
    if (script.file.locale !== input.locale) {
      diagnostics.push({
        severity: "error",
        code: "localeScriptLocaleMismatch",
        message: `\`locale\` is ${script.file.locale} but this is the ${input.locale} script directory.`,
        path: script.path,
      });
    }
    for (const line of script.file.stale) {
      summary.stale += 1;
      diagnostics.push({
        severity: "warning",
        code: "localeScriptStaleEntry",
        message: `Stale entry "${label(line)}": re-map its translation to the current line or delete it.`,
        path: script.path,
      });
    }
    for (const line of script.file.lines) {
      const key = lineKey(line);
      const prior = entryByKey.get(key);
      if (prior) {
        diagnostics.push({
          severity: "error",
          code: "localeScriptDuplicateKey",
          message: `"${label(line)}" is listed in both ${prior.path} and ${script.path}.`,
          path: script.path,
        });
        continue;
      }
      entryByKey.set(key, { line, path: script.path });
      const owner = ownerByKey.get(key);
      if (owner === undefined) {
        summary.stale += 1;
        diagnostics.push({
          severity: "warning",
          code: "localeScriptStaleEntry",
          message: `"${label(line)}" no longer matches any emitted line; run voice:sync.`,
          path: script.path,
        });
        continue;
      }
      const expectedPath = localeScriptPath(
        input.chapterId,
        owner,
        input.locale,
      );
      if (script.path !== expectedPath) {
        diagnostics.push({
          severity: "warning",
          code: "localeScriptMisplacedEntry",
          message: `"${label(line)}" first appears in ${owner}; run voice:sync to move it to ${expectedPath}.`,
          path: script.path,
        });
      }
      if (line.ja.trim().length === 0) {
        summary.untranslated += 1;
        diagnostics.push({
          severity: "warning",
          code: "localeScriptUntranslated",
          message: `"${label(line)}" has no translation yet.`,
          path: script.path,
        });
      } else {
        summary.translated += 1;
      }
    }
  }

  for (const scene of input.scenes) {
    const reported = new Set<string>();
    for (const line of scene.lines) {
      const key = localeLineKey(line);
      if (entryByKey.has(key) || reported.has(key)) continue;
      if (ownerByKey.get(key) !== scene.sceneFile) continue;
      reported.add(key);
      summary.missing += 1;
      diagnostics.push({
        severity: "warning",
        code: "localeScriptMissingEntry",
        message: `"${label(line)}" has no entry; run voice:sync.`,
        path: localeScriptPath(input.chapterId, scene.sceneFile, input.locale),
      });
    }
  }

  if (input.glossary) {
    const known = new Set(input.glossary.value.characters.map((c) => c.zh));
    for (const speaker of speakers) {
      if (known.has(speaker)) continue;
      diagnostics.push({
        severity: "warning",
        code: "localeGlossaryMissingSpeaker",
        message: `Speaker "${speaker}" has no glossary character entry.`,
        path: input.glossary.path,
      });
    }
  }

  return { diagnostics, summary };
}
