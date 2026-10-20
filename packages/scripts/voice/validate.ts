import { localeScriptPath, sceneSourcePath } from "./locale-script";
import { ownerSceneFile, scriptLineKey, sourceChanged } from "./script-key";
import type { ExistingScript } from "./sync";
import type {
  EmittedLine,
  EmittedScene,
  LocaleGlossary,
  VoiceDiagnostic,
} from "./types";
import type { CastEntry } from "./voice-cast";

export type ValidateSummary = {
  emittedLines: number;
  uniqueLines: number;
  translated: number;
  missing: number;
  untranslated: number;
  stale: number;
  /** Translated lines whose scene line changed since translation. */
  changed: number;
  /** Emitted lines whose scene line has no `{#L012}` ID yet. */
  withoutId: number;
};

export type ValidateResult = {
  diagnostics: VoiceDiagnostic[];
  summary: ValidateSummary;
};

function label(line: { speaker: string; zh?: string; text?: string }): string {
  return `${line.speaker}: ${line.zh ?? line.text ?? ""}`;
}

/**
 * Checks a chapter's locale scripts against its emitted lines. Errors are
 * structural (an ID or clip listed twice, a script pointing at the wrong
 * scene); warnings are coverage gaps (lines without an ID, missing or
 * untranslated entries, lines that changed since translation, stale
 * entries, speakers without a glossary entry, clips of uncast roles) that
 * `--strict` promotes.
 */
export function validateChapterScripts(input: {
  chapterId: string;
  locale: string;
  scenes: EmittedScene[];
  existing: ExistingScript[];
  glossary?: { path: string; value: LocaleGlossary } | undefined;
  /** Approved cast by speaker; when given, clips of uncast speakers warn. */
  castBySpeaker?: Map<string, CastEntry> | undefined;
}): ValidateResult {
  const diagnostics: VoiceDiagnostic[] = [];
  const summary: ValidateSummary = {
    emittedLines: 0,
    uniqueLines: 0,
    translated: 0,
    missing: 0,
    untranslated: 0,
    stale: 0,
    changed: 0,
    withoutId: 0,
  };

  const emittedByKey = new Map<
    string,
    { line: EmittedLine & { id: string }; owner: string }
  >();
  const speakers = new Set<string>();
  const unidentified = new Set<string>();
  for (const scene of input.scenes) {
    for (const line of scene.lines) {
      summary.emittedLines += 1;
      speakers.add(line.speaker);
      const owner = ownerSceneFile(line, scene.sceneFile);
      if (line.id === null) {
        summary.withoutId += 1;
        unidentified.add(owner);
        continue;
      }
      const key = scriptLineKey(owner, line.id);
      if (!emittedByKey.has(key)) {
        emittedByKey.set(key, { line: { ...line, id: line.id }, owner });
      }
    }
  }
  summary.uniqueLines = emittedByKey.size;
  for (const owner of unidentified) {
    diagnostics.push({
      severity: "warning",
      code: "dialogueLineWithoutId",
      message: `${owner} has spoken lines without a {#L012} ID; run voice:sync to add them.`,
      path: sceneSourcePath(input.chapterId, owner),
    });
  }

  const clipOwner = new Map<string, string>();
  for (const script of input.existing) {
    for (const line of [...script.file.lines, ...script.file.stale]) {
      if (!line.voice) continue;
      const prior = clipOwner.get(line.voice.clip);
      if (prior !== undefined) {
        diagnostics.push({
          severity: "error",
          code: "localeScriptDuplicateClip",
          message: `Clip ${line.voice.clip} is used by both ${prior} and ${script.sceneFile} ${line.id}; each line needs its own clip.`,
          path: script.path,
        });
        continue;
      }
      clipOwner.set(line.voice.clip, `${script.sceneFile} ${line.id}`);
      if (input.castBySpeaker && !input.castBySpeaker.has(line.speaker)) {
        diagnostics.push({
          severity: "warning",
          code: "localeScriptVoiceUncast",
          message: `${line.id} "${label(line)}" has clip ${line.voice.clip} but ${line.speaker} has no approved voice in voice_cast.yaml; voice:generate skips it.`,
          path: script.path,
        });
      }
    }
  }

  const entries = new Set<string>();
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
    const ids = new Set<string>();
    for (const line of [...script.file.lines, ...script.file.stale]) {
      if (ids.has(line.id)) {
        diagnostics.push({
          severity: "error",
          code: "localeScriptDuplicateKey",
          message: `${line.id} is listed twice in this script.`,
          path: script.path,
        });
      }
      ids.add(line.id);
    }
    for (const line of script.file.stale) {
      summary.stale += 1;
      diagnostics.push({
        severity: "warning",
        code: "localeScriptStaleEntry",
        message: `Stale entry ${line.id} "${label(line)}": move its translation to the line that replaced it, then delete it.`,
        path: script.path,
      });
    }
    for (const line of script.file.lines) {
      const key = scriptLineKey(script.sceneFile, line.id);
      entries.add(key);
      const emitted = emittedByKey.get(key);
      if (!emitted) {
        summary.stale += 1;
        diagnostics.push({
          severity: "warning",
          code: "localeScriptStaleEntry",
          message: `${line.id} "${label(line)}" is no longer a spoken line of ${script.sceneFile}; run voice:sync.`,
          path: script.path,
        });
        continue;
      }
      if (line.ja.trim().length === 0) {
        summary.untranslated += 1;
        diagnostics.push({
          severity: "warning",
          code: "localeScriptUntranslated",
          message: `${line.id} "${label(line)}" has no translation yet.`,
          path: script.path,
        });
        if (line.voice) {
          diagnostics.push({
            severity: "warning",
            code: "localeScriptVoiceWithoutTranslation",
            message: `${line.id} "${label(line)}" has voice clip ${line.voice.clip} but no translation; the game skips it.`,
            path: script.path,
          });
        }
        continue;
      }
      summary.translated += 1;
      if (sourceChanged(line, emitted.line)) {
        summary.changed += 1;
        diagnostics.push({
          severity: "warning",
          code: "localeScriptSourceChanged",
          message: `${line.id} was translated from "${label(line)}"${line.expression ? ` [${line.expression}]` : ""} but now reads "${label(emitted.line)}"${emitted.line.expression && emitted.line.expression !== "standard" ? ` [${emitted.line.expression}]` : ""}. Check the ja, then copy the current speaker, expression and zh into the entry.`,
          path: script.path,
        });
      }
    }
  }

  for (const [key, { line, owner }] of emittedByKey) {
    if (entries.has(key)) continue;
    summary.missing += 1;
    diagnostics.push({
      severity: "warning",
      code: "localeScriptMissingEntry",
      message: `${line.id} "${label(line)}" has no entry; run voice:sync.`,
      path: localeScriptPath(input.chapterId, owner, input.locale),
    });
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
