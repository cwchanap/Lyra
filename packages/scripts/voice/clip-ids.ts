import { keyExpression } from "@lyra/dialogue-locale";
import type { CastEntry } from "./voice-cast";
import type { LocaleScriptFile, LocaleScriptLine } from "./types";

/** `chapter_1` + `soma_ritsu` -> `ch1_soma_ritsu_` */
export function clipPrefix(chapterId: string, characterId: string): string {
  const chapter = /^chapter_(\d+)$/.exec(chapterId)?.[1];
  if (chapter === undefined) {
    throw new Error(`Not a chapter ID: ${chapterId}`);
  }
  return `ch${chapter}_${characterId}_`;
}

function clipNumber(clip: string, prefix: string): number | null {
  if (!clip.startsWith(prefix)) return null;
  const digits = clip.slice(prefix.length);
  return /^\d{4,}$/.test(digits) ? Number(digits) : null;
}

/**
 * Two script entries with the same key read the same, so they share one clip.
 */
export function clipReadingKey(line: LocaleScriptLine): string {
  return JSON.stringify([
    line.speaker,
    keyExpression(line.expression ?? null),
    line.zh,
    line.ja,
  ]);
}

/**
 * Gives every translated line spoken by an approved cast member a clip ID,
 * `ch<N>_<characterId>_<nnnn>`, in chapter order. Numbers continue after the
 * highest one already used by a script entry (stale entries included) or by a
 * clip file on disk, so a clip ID is never reused for a different line and
 * existing IDs never change. Lines that already have a clip keep it.
 *
 * A line that reads exactly like an earlier one (same speaker, expression,
 * Chinese and Japanese) gets no clip of its own: the game matches lines by
 * their text, so both play the first one's clip.
 *
 * Mutates the lines of `files` in place and returns how many IDs it assigned.
 */
export function assignClipIds(input: {
  chapterId: string;
  files: Iterable<LocaleScriptFile>;
  castBySpeaker: Map<string, CastEntry>;
  /** Clip IDs that already have a file under `static/assets/voice/<locale>/`. */
  existingClipFiles: Iterable<string>;
}): number {
  const files = [...input.files];
  const used = [
    ...files.flatMap((file) =>
      [...file.lines, ...file.stale].flatMap((line) =>
        line.voice ? [line.voice.clip] : [],
      ),
    ),
    ...input.existingClipFiles,
  ];
  const next = new Map<string, number>();
  const nextNumber = (prefix: string): number => {
    let value = next.get(prefix);
    if (value === undefined) {
      value = 1;
      for (const clip of used) {
        const n = clipNumber(clip, prefix);
        if (n !== null && n >= value) value = n + 1;
      }
    }
    next.set(prefix, value + 1);
    return value;
  };

  const voiced = new Set(
    files.flatMap((file) =>
      file.lines.flatMap((line) => (line.voice ? [clipReadingKey(line)] : [])),
    ),
  );

  let assigned = 0;
  for (const file of files) {
    for (const line of file.lines) {
      if (line.voice || line.ja.trim().length === 0) continue;
      const cast = input.castBySpeaker.get(line.speaker);
      if (!cast) continue;
      const reading = clipReadingKey(line);
      if (voiced.has(reading)) continue;
      voiced.add(reading);
      const prefix = clipPrefix(input.chapterId, cast.characterId);
      line.voice = {
        clip: `${prefix}${String(nextNumber(prefix)).padStart(4, "0")}`,
      };
      assigned += 1;
    }
  }
  return assigned;
}
