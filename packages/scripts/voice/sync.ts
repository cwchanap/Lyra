import { keyExpression, localeLineKey } from "@lyra/dialogue-locale";
import { localeScriptPath, sceneSourcePath } from "./locale-script";
import type {
  EmittedLine,
  EmittedScene,
  LocaleScriptFile,
  LocaleScriptLine,
  VoiceDiagnostic,
} from "./types";

export type ExistingScript = {
  /** Repo-relative path the script was read from. */
  path: string;
  /** Authored scene the file name points at, e.g. `scene_5.md`. */
  sceneFile: string;
  file: LocaleScriptFile;
};

export type SyncReport = {
  added: number;
  kept: number;
  staled: number;
  droppedUntranslated: number;
};

export type SyncResult =
  | {
      ok: true;
      /** Script files to write, keyed by repo-relative path. */
      writes: Map<string, LocaleScriptFile>;
      /** Existing script files that no longer hold anything. */
      deletes: string[];
      report: SyncReport;
    }
  | { ok: false; diagnostics: VoiceDiagnostic[] };

function lineKey(line: LocaleScriptLine): string {
  return localeLineKey({
    speaker: line.speaker,
    text: line.zh,
    expression: line.expression ?? null,
  });
}

function skeleton(line: EmittedLine): LocaleScriptLine {
  const entry: LocaleScriptLine = {
    speaker: line.speaker,
    zh: line.text,
    ja: "",
  };
  const expression = keyExpression(line.expression);
  if (expression !== null) entry.expression = expression;
  return entry;
}

function worthKeeping(line: LocaleScriptLine): boolean {
  return (
    line.ja.length > 0 || line.note !== undefined || line.voice !== undefined
  );
}

/**
 * Rebuilds a chapter's locale scripts from its emitted lines. Each unique line
 * (by {@link localeLineKey}) is listed once, in the first scene that emits it;
 * existing translations move with their key. Translated or annotated entries
 * that no longer match any emitted line move to their file's `stale` list
 * instead of being dropped; untranslated ones are dropped.
 *
 * Refuses to run when existing scripts list the same key twice, since picking
 * one translation would silently discard the other.
 */
export function syncChapterScripts(input: {
  chapterId: string;
  locale: string;
  scenes: EmittedScene[];
  existing: ExistingScript[];
}): SyncResult {
  const diagnostics: VoiceDiagnostic[] = [];
  const pool = new Map<
    string,
    { line: LocaleScriptLine; origin: ExistingScript }
  >();
  for (const script of input.existing) {
    for (const line of [...script.file.lines, ...script.file.stale]) {
      const key = lineKey(line);
      const prior = pool.get(key);
      if (prior) {
        diagnostics.push({
          severity: "error",
          code: "localeScriptDuplicateKey",
          message: `"${line.speaker}: ${line.zh}" is listed in both ${prior.origin.path} and ${script.path}; keep one entry before syncing.`,
          path: script.path,
        });
        continue;
      }
      pool.set(key, { line, origin: script });
    }
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const report: SyncReport = {
    added: 0,
    kept: 0,
    staled: 0,
    droppedUntranslated: 0,
  };
  const linesByScene = new Map<string, LocaleScriptLine[]>();
  const used = new Set<string>();
  for (const scene of input.scenes) {
    const lines: LocaleScriptLine[] = [];
    for (const emitted of scene.lines) {
      const key = localeLineKey(emitted);
      if (used.has(key)) continue;
      used.add(key);
      const existing = pool.get(key);
      if (existing) {
        lines.push(existing.line);
        report.kept += 1;
      } else {
        lines.push(skeleton(emitted));
        report.added += 1;
      }
    }
    linesByScene.set(scene.sceneFile, lines);
  }

  const staleByScene = new Map<string, LocaleScriptLine[]>();
  for (const [key, { line, origin }] of pool) {
    if (used.has(key)) continue;
    if (!worthKeeping(line)) {
      report.droppedUntranslated += 1;
      continue;
    }
    report.staled += 1;
    const list = staleByScene.get(origin.sceneFile) ?? [];
    list.push(line);
    staleByScene.set(origin.sceneFile, list);
  }

  const writes = new Map<string, LocaleScriptFile>();
  const sceneFiles = [
    ...input.scenes.map((scene) => scene.sceneFile),
    ...[...staleByScene.keys()].filter(
      (sceneFile) => !linesByScene.has(sceneFile),
    ),
  ];
  for (const sceneFile of sceneFiles) {
    const lines = linesByScene.get(sceneFile) ?? [];
    const stale = staleByScene.get(sceneFile) ?? [];
    if (lines.length === 0 && stale.length === 0) continue;
    writes.set(localeScriptPath(input.chapterId, sceneFile, input.locale), {
      schemaVersion: 1,
      locale: input.locale,
      source: sceneSourcePath(input.chapterId, sceneFile),
      lines,
      stale,
    });
  }
  const deletes = input.existing
    .map((script) => script.path)
    .filter((path) => !writes.has(path));

  return { ok: true, writes, deletes, report };
}
