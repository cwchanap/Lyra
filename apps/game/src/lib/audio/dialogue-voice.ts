import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  localeLineKey,
  type DialogueLocaleManifestV1,
} from "@lyra/dialogue-locale";

/** The language voice clips are recorded in (Japanese audio, Chinese text). */
export const VOICE_LOCALE = "ja";

/** A spoken line as the dialogue box shows it, plus its chapter. */
export type DialogueVoiceLine = {
  chapterId: string;
  speaker: string;
  text: string;
  /** The line's portrait expression, or null when it has no portrait. */
  expression: string | null;
};

export type DialogueVoiceIndex = {
  /** The `voice.<locale>.<clip>` asset ID for a line, or null if unvoiced. */
  voiceFor: (line: DialogueVoiceLine) => string | null;
};

export const EMPTY_DIALOGUE_VOICE_INDEX: DialogueVoiceIndex = {
  voiceFor: () => null,
};

/**
 * Indexes the voiced lines of a locale manifest by chapter and by the shared
 * line key, so a line finds its clip from exactly what the dialogue box has:
 * speaker, Chinese text and portrait expression.
 */
export function indexDialogueVoices(
  manifest: DialogueLocaleManifestV1 | null,
): DialogueVoiceIndex {
  const byChapter = new Map<string, Map<string, string>>();
  for (const chapter of manifest?.chapters ?? []) {
    const voices = new Map<string, string>();
    for (const line of chapter.lines) {
      if (!line.voice) continue;
      voices.set(
        localeLineKey({
          speaker: line.speaker,
          text: line.zh,
          expression: line.expression,
        }),
        line.voice,
      );
    }
    if (voices.size > 0) byChapter.set(chapter.id, voices);
  }
  if (byChapter.size === 0) return EMPTY_DIALOGUE_VOICE_INDEX;
  return {
    voiceFor: (line) =>
      byChapter.get(line.chapterId)?.get(localeLineKey(line)) ?? null,
  };
}

export type DialogueLocaleFetcher = (
  locale: string,
) => Promise<DialogueLocaleManifestV1 | null>;

/**
 * Reads the bundled locale manifest through the Rust shell. Outside Tauri
 * (unit tests, a plain browser tab) there is no bundle to read, which means
 * no voice rather than a failure.
 */
export function fetchDialogueLocale(
  locale: string,
): Promise<DialogueLocaleManifestV1 | null> {
  if (!isTauri()) return Promise.resolve(null);
  return invoke<DialogueLocaleManifestV1 | null>("get_dialogue_locale", {
    locale,
  });
}

type LoggerLike = { warn: (message: string) => void };

function describeError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/**
 * Returns a loader that fetches and indexes the voice manifest once per
 * session. A failed load is one warning and an empty index: the game plays
 * on without voices.
 */
export function createDialogueVoiceLoader(
  fetcher: DialogueLocaleFetcher = fetchDialogueLocale,
  logger: LoggerLike = console,
): () => Promise<DialogueVoiceIndex> {
  let pending: Promise<DialogueVoiceIndex> | null = null;
  return () => {
    pending ??= fetcher(VOICE_LOCALE).then(indexDialogueVoices, (error) => {
      logger.warn(
        `[GameplayAudio] Voice lines unavailable: the ${VOICE_LOCALE} dialogue locale could not be loaded (${describeError(error)})`,
      );
      return EMPTY_DIALOGUE_VOICE_INDEX;
    });
    return pending;
  };
}
