import { assignClipIds, clipReadingKey } from "./clip-ids";
import { serializeLocaleScript } from "./locale-script";
import { ownerSceneFile, scriptLineKey } from "./script-key";
import { syncChapterScripts, type ExistingScript } from "./sync";
import {
  buildTtsRequest,
  resolveDirection,
  spokenText,
  supportsAudioTags,
  type TtsRequest,
} from "./tts-request";
import {
  approvedCastBySpeaker,
  type CastEntry,
  type LocaleCast,
} from "./voice-cast";
import type {
  EmittedScene,
  LocaleScriptFile,
  LocaleScriptLine,
  VoiceDiagnostic,
} from "./types";

export type VoiceFilters = {
  /** Authored scene file, e.g. `scene_5.md`. */
  scene?: string | undefined;
  /** Cast character ID, e.g. `kamiya_mio`. */
  speaker?: string | undefined;
  /** One clip ID. */
  only?: string | undefined;
};

export type VoiceTarget = {
  script: ExistingScript;
  line: LocaleScriptLine & { voice: NonNullable<LocaleScriptLine["voice"]> };
  cast: CastEntry;
  request: TtsRequest;
};

export type VoicePlan = {
  targets: VoiceTarget[];
  /** Clips skipped because the file exists and its hash still matches. */
  current: number;
  /** Characters the targets send to text-to-speech. */
  characters: number;
  /** Translated lines of cast roles that are not approved yet. */
  pending: { characterId: string; lines: number; characters: number }[];
};

export type VoicePlanResult =
  | { ok: true; plan: VoicePlan }
  | { ok: false; diagnostics: VoiceDiagnostic[] };

function planError(
  path: string,
  code: string,
  message: string,
): VoiceDiagnostic {
  return { severity: "error", code, message, path };
}

function matchesFilters(
  target: { script: ExistingScript; line: LocaleScriptLine; cast: CastEntry },
  filters: VoiceFilters,
): boolean {
  if (
    filters.scene !== undefined &&
    target.script.sceneFile !== filters.scene
  ) {
    return false;
  }
  if (
    filters.speaker !== undefined &&
    target.cast.characterId !== filters.speaker
  ) {
    return false;
  }
  if (filters.only !== undefined && target.line.voice?.clip !== filters.only) {
    return false;
  }
  return true;
}

/**
 * Works out which clips a `voice:generate` run would make. Refuses when the
 * scripts are not what `voice:sync` would write now (new, moved or stale
 * lines, or clip IDs not assigned yet), so clips always match the current
 * story. A clip is current when its file exists and the stored `ttsHash`
 * equals the hash of today's request; `force` regenerates current clips too.
 */
type Neighbours = { previous?: LocaleScriptLine; next?: LocaleScriptLine };

/**
 * The lines heard just before and after each script line, keyed by
 * `scriptLineKey`, sent as context to models with request stitching. They
 * come from the emitted dialogue queues, not from script order: branching
 * scripts list each queue's lines wherever the compiler collects them, so
 * two entries next to each other in a file may never be heard together. A
 * line emitted in more than one place keeps a neighbour only when every
 * place agrees on it.
 */
export function stitchingNeighbours(
  scenes: EmittedScene[],
  scripts: Iterable<{ sceneFile: string; file: LocaleScriptFile }>,
): Map<string, Neighbours> {
  const entries = new Map<string, LocaleScriptLine>();
  for (const script of scripts) {
    for (const line of script.file.lines) {
      entries.set(scriptLineKey(script.sceneFile, line.id), line);
    }
  }
  const seen = new Map<
    string,
    { previous: Set<string | null>; next: Set<string | null> }
  >();
  for (const scene of scenes) {
    const keyAt = (index: number, segment: number): string | null => {
      const line = scene.lines[index];
      if (!line || line.segment !== segment || line.id === null) return null;
      return scriptLineKey(ownerSceneFile(line, scene.sceneFile), line.id);
    };
    scene.lines.forEach((line, index) => {
      if (line.id === null) return;
      const key = scriptLineKey(ownerSceneFile(line, scene.sceneFile), line.id);
      const sides = seen.get(key) ?? { previous: new Set(), next: new Set() };
      seen.set(key, sides);
      if (line.segment === undefined) {
        sides.previous.add(null);
        sides.next.add(null);
        return;
      }
      sides.previous.add(keyAt(index - 1, line.segment));
      sides.next.add(keyAt(index + 1, line.segment));
    });
  }
  const only = (keys: Set<string | null>): LocaleScriptLine | undefined => {
    if (keys.size !== 1) return undefined;
    const [key] = keys;
    return key === null || key === undefined ? undefined : entries.get(key);
  };
  const neighbours = new Map<string, Neighbours>();
  for (const [key, sides] of seen) {
    const previous = only(sides.previous);
    const next = only(sides.next);
    neighbours.set(key, {
      ...(previous === undefined ? {} : { previous }),
      ...(next === undefined ? {} : { next }),
    });
  }
  return neighbours;
}

export function planVoiceGeneration(input: {
  chapterId: string;
  locale: string;
  scenes: EmittedScene[];
  existing: ExistingScript[];
  localeCast: LocaleCast | undefined;
  read: (text: string) => string;
  existingClipFiles: string[];
  filters: VoiceFilters;
  force: boolean;
}): VoicePlanResult {
  const castBySpeaker = approvedCastBySpeaker(input.localeCast);
  const synced = syncChapterScripts({
    chapterId: input.chapterId,
    locale: input.locale,
    scenes: input.scenes,
    existing: structuredClone(input.existing),
  });
  if (!synced.ok) return synced;
  if (synced.report.withoutId > 0) {
    return {
      ok: false,
      diagnostics: [
        planError(
          `docs/stories_plan/${input.chapterId}`,
          "voiceScriptsOutOfDate",
          `${synced.report.withoutId} spoken lines have no {#L012} line ID; run \`bun run voice:sync ${input.chapterId}\` and commit the result first.`,
        ),
      ],
    };
  }
  assignClipIds({
    chapterId: input.chapterId,
    files: synced.writes.values(),
    castBySpeaker,
    existingClipFiles: input.existingClipFiles,
  });
  const byPath = new Map(input.existing.map((script) => [script.path, script]));
  const outOfDate = [
    ...[...synced.writes].flatMap(([path, file]) => {
      const current = byPath.get(path);
      return current &&
        serializeLocaleScript(current.file) === serializeLocaleScript(file)
        ? []
        : [path];
    }),
    ...synced.deletes,
  ];
  if (outOfDate.length > 0) {
    return {
      ok: false,
      diagnostics: outOfDate.map((path) =>
        planError(
          path,
          "voiceScriptsOutOfDate",
          `Not in step with the story or the cast; run \`bun run voice:sync ${input.chapterId}\` and commit the result first.`,
        ),
      ),
    };
  }

  const neighbours = stitchingNeighbours(input.scenes, input.existing);
  const plan: VoicePlan = {
    targets: [],
    current: 0,
    characters: 0,
    pending: [],
  };
  const localeCast = input.localeCast;
  const clipFiles = new Set(input.existingClipFiles);
  const pending = new Map<string, { lines: number; characters: number }>();
  const pendingBySpeaker = new Map<string, CastEntry>();
  for (const entry of localeCast?.cast ?? []) {
    if (entry.status === "approved" && entry.voiceId !== null) continue;
    for (const speaker of entry.speakers) pendingBySpeaker.set(speaker, entry);
  }
  const tags = localeCast ? supportsAudioTags(localeCast.model) : false;
  // Identical lines will share one clip (see assignClipIds).
  const pendingReadings = new Set<string>();

  for (const script of input.existing) {
    script.file.lines.forEach((line) => {
      if (line.ja.trim().length === 0) return;
      const pendingCast = pendingBySpeaker.get(line.speaker);
      if (pendingCast) {
        if (
          !matchesFilters({ script, line, cast: pendingCast }, input.filters)
        ) {
          return;
        }
        const reading = clipReadingKey(line);
        if (pendingReadings.has(reading)) return;
        pendingReadings.add(reading);
        const direction = tags ? resolveDirection(line, pendingCast) : null;
        const text = spokenText(line, input.read);
        const totals = pending.get(pendingCast.characterId) ?? {
          lines: 0,
          characters: 0,
        };
        totals.lines += 1;
        totals.characters +=
          text.length + (direction === null ? 0 : direction.length + 1);
        pending.set(pendingCast.characterId, totals);
        return;
      }
      const cast = castBySpeaker.get(line.speaker);
      if (!cast || !line.voice || !localeCast) return;
      const voiced = line as VoiceTarget["line"];
      if (!matchesFilters({ script, line, cast }, input.filters)) return;
      const request = buildTtsRequest({
        line,
        cast,
        localeCast,
        read: input.read,
        ...neighbours.get(scriptLineKey(script.sceneFile, line.id)),
      });
      if (
        !input.force &&
        clipFiles.has(voiced.voice.clip) &&
        voiced.voice.ttsHash === request.hash
      ) {
        plan.current += 1;
        return;
      }
      plan.targets.push({ script, line: voiced, cast, request });
      plan.characters += request.body.text.length;
    });
  }
  plan.pending = (localeCast?.cast ?? []).flatMap((entry) => {
    const totals = pending.get(entry.characterId);
    return totals ? [{ characterId: entry.characterId, ...totals }] : [];
  });
  return { ok: true, plan };
}
