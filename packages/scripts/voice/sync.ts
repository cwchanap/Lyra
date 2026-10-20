import { keyExpression } from "@lyra/dialogue-locale";
import { localeScriptPath, sceneSourcePath } from "./locale-script";
import { ownerSceneFile, scriptLineKey } from "./script-key";
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
  /** Emitted lines whose scene line has no `{#L012}` ID yet. */
  withoutId: number;
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

function skeleton(line: EmittedLine & { id: string }): LocaleScriptLine {
  const entry: LocaleScriptLine = {
    id: line.id,
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
 * Rebuilds a chapter's locale scripts from its emitted lines. Entries are
 * linked to scene lines by `{#L012}` ID; each ID is listed once, in the
 * script of the scene file the line is written in, in emitted order. An
 * existing entry is kept exactly as it is (its `zh` records what was
 * translated, and `voice:validate` reports lines that changed since).
 * Entries whose ID is gone move to the file's `stale` list when they hold a
 * translation, note or clip, and are dropped otherwise.
 *
 * Refuses to run when existing scripts list the same ID twice, since picking
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
      const key = scriptLineKey(script.sceneFile, line.id);
      if (pool.has(key)) {
        diagnostics.push({
          severity: "error",
          code: "localeScriptDuplicateKey",
          message: `${line.id} is listed twice in ${script.path}; keep one entry before syncing.`,
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
    withoutId: 0,
  };
  const linesByScene = new Map<string, LocaleScriptLine[]>();
  const used = new Set<string>();
  const sceneFiles: string[] = [];
  const noteScene = (sceneFile: string) => {
    if (!sceneFiles.includes(sceneFile)) sceneFiles.push(sceneFile);
  };
  for (const scene of input.scenes) {
    noteScene(scene.sceneFile);
    for (const emitted of scene.lines) {
      if (emitted.id === null) {
        report.withoutId += 1;
        continue;
      }
      const owner = ownerSceneFile(emitted, scene.sceneFile);
      noteScene(owner);
      const key = scriptLineKey(owner, emitted.id);
      if (used.has(key)) continue;
      used.add(key);
      const lines = linesByScene.get(owner) ?? [];
      const existing = pool.get(key);
      if (existing) {
        lines.push(existing.line);
        report.kept += 1;
      } else {
        lines.push(skeleton({ ...emitted, id: emitted.id }));
        report.added += 1;
      }
      linesByScene.set(owner, lines);
    }
  }

  const staleByScene = new Map<string, LocaleScriptLine[]>();
  for (const [key, { line, origin }] of pool) {
    if (used.has(key)) continue;
    if (!worthKeeping(line)) {
      report.droppedUntranslated += 1;
      continue;
    }
    report.staled += 1;
    noteScene(origin.sceneFile);
    const list = staleByScene.get(origin.sceneFile) ?? [];
    list.push(line);
    staleByScene.set(origin.sceneFile, list);
  }

  const writes = new Map<string, LocaleScriptFile>();
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
