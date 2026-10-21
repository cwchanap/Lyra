import { createHash } from "node:crypto";
import { DEFAULT_EXPRESSION } from "@lyra/dialogue-locale";
import type { CastEntry, LocaleCast } from "./voice-cast";
import type { LocaleGlossary, LocaleScriptLine } from "./types";

/** The JSON body of `POST /v1/text-to-speech/{voice_id}`. */
export type TtsBody = {
  text: string;
  model_id: string;
  language_code?: string;
  voice_settings: {
    stability: number;
    similarity_boost: number;
    style: number;
    speed: number;
    use_speaker_boost?: boolean;
  };
  seed: number;
  previous_text?: string;
  next_text?: string;
  apply_language_text_normalization?: boolean;
};

export type TtsRequest = {
  voiceId: string;
  body: TtsBody;
  /** The resolved delivery direction, or null when none is sent. */
  direction: string | null;
  /** Short hash of every input that shapes the performance. */
  hash: string;
};

/** Models that read inline audio tags such as `[calm]`. */
export function supportsAudioTags(model: string): boolean {
  const version = /^eleven_v(\d+)/.exec(model)?.[1];
  return version !== undefined && Number(version) >= 3;
}

/**
 * eleven_v3 has no request stitching, so it gets no neighbouring-line
 * context. eleven_v3 and later reject `apply_language_text_normalization`. The older multilingual and monolingual models take no
 * `language_code`.
 */
function supportsContextText(model: string): boolean {
  return model !== "eleven_v3";
}

function supportsTextNormalization(model: string): boolean {
  return !supportsAudioTags(model);
}

function supportsLanguageCode(model: string): boolean {
  return !/^eleven_(?:multilingual|monolingual)_/.test(model);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns a function that swaps every glossary name and term with a `reading`
 * for that reading (spaces removed), longest match first, in one pass.
 */
export function glossaryReader(
  glossary: LocaleGlossary | undefined,
): (text: string) => string {
  const readings = new Map<string, string>();
  for (const entry of [
    ...(glossary?.characters ?? []),
    ...(glossary?.terms ?? []),
  ]) {
    if (entry.reading === undefined) continue;
    const reading = entry.reading.replace(/\s+/g, "");
    if (reading.length === 0 || reading === entry.ja) continue;
    readings.set(entry.ja, reading);
  }
  if (readings.size === 0) return (text) => text;
  const pattern = new RegExp(
    [...readings.keys()]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|"),
    "g",
  );
  return (text) =>
    text.replace(pattern, (match) => readings.get(match) ?? match);
}

/** The direction a line is performed with: its own, else its expression's. */
export function resolveDirection(
  line: LocaleScriptLine,
  cast: CastEntry,
): string | null {
  return (
    line.voice?.direction ??
    cast.expressionDirections[line.expression ?? DEFAULT_EXPRESSION] ??
    null
  );
}

/** The words sent for a line: its `tts` override, else `ja` with readings. */
export function spokenText(
  line: LocaleScriptLine,
  read: (text: string) => string,
): string {
  return line.voice?.tts ?? read(line.ja);
}

/**
 * Builds the text-to-speech request for one line. The hash covers the model,
 * voice, settings, seed, normalization, direction and final text, but not the
 * neighbouring lines, so editing one line never regenerates its neighbours.
 */
export function buildTtsRequest(input: {
  line: LocaleScriptLine;
  cast: CastEntry;
  localeCast: LocaleCast;
  read: (text: string) => string;
  previous?: LocaleScriptLine | undefined;
  next?: LocaleScriptLine | undefined;
}): TtsRequest {
  const { cast, localeCast } = input;
  if (cast.voiceId === null) {
    throw new Error(`${cast.characterId} has no voiceId.`);
  }
  const model = localeCast.model;
  const tags = supportsAudioTags(model);
  const direction = tags ? resolveDirection(input.line, cast) : null;
  const words = spokenText(input.line, input.read);
  const text = direction === null ? words : `${direction} ${words}`;
  const body: TtsBody = {
    text,
    model_id: model,
    voice_settings: {
      stability: cast.settings.stability,
      similarity_boost: cast.settings.similarityBoost,
      style: cast.settings.style,
      speed: cast.settings.speed,
    },
    seed: cast.seed,
  };
  if (cast.settings.useSpeakerBoost !== undefined) {
    body.voice_settings.use_speaker_boost = cast.settings.useSpeakerBoost;
  }
  if (supportsLanguageCode(model)) body.language_code = localeCast.locale;
  if (
    localeCast.languageTextNormalization &&
    supportsTextNormalization(model)
  ) {
    body.apply_language_text_normalization = true;
  }
  if (supportsContextText(model)) {
    if (input.previous && input.previous.ja.trim().length > 0) {
      body.previous_text = spokenText(input.previous, input.read);
    }
    if (input.next && input.next.ja.trim().length > 0) {
      body.next_text = spokenText(input.next, input.read);
    }
  }
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        model,
        voiceId: cast.voiceId,
        settings: body.voice_settings,
        seed: cast.seed,
        languageCode: body.language_code ?? null,
        normalization: body.apply_language_text_normalization ?? false,
        direction,
        text,
      }),
    )
    .digest("hex")
    .slice(0, 12);
  return { voiceId: cast.voiceId, body, direction, hash };
}
