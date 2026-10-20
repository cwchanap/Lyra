// =============================================================================
// packages/dialogue-locale/src/index.ts
//
// Shared contract for translated dialogue between the compiler and the game.
//
// Single source of truth for the key that ties a translated line to the
// emitted Chinese line it translates, and for the locale manifest the compiler
// writes next to the asset manifest and the game reads at runtime.
//
// Consumers:
//   - packages/scripts/voice/                     (locale scripts, manifest)
//   - apps/game/src/lib/audio/dialogue-voice.ts   (runtime voice lookup)
// =============================================================================

/**
 * The expression every character config must define (enforced by the asset
 * config loader). The compiler fills it in for lines authored without an
 * expression tag, so it carries no delivery intent of its own.
 */
export const DEFAULT_EXPRESSION = "standard";

export type LineKeyInput = {
  speaker: string;
  text: string;
  expression?: string | null | undefined;
};

/**
 * Normalizes an emitted or stored expression for keying: the default
 * expression and a missing portrait both mean "no specific delivery".
 */
export function keyExpression(
  expression: string | null | undefined,
): string | null {
  if (expression === undefined || expression === null) return null;
  return expression === DEFAULT_EXPRESSION ? null : expression;
}

/**
 * Translation-memory key for one spoken line: speaker, exact emitted Chinese
 * text, and the non-default expression. The same key always maps to the same
 * translation (and the same voice clip) wherever the line appears in a
 * chapter.
 */
export function localeLineKey(input: LineKeyInput): string {
  return JSON.stringify([
    input.speaker,
    keyExpression(input.expression),
    input.text,
  ]);
}

/** Locales the compiler writes a dialogue locale manifest for. */
export const DIALOGUE_LOCALES = ["ja"] as const;

/** `ja` -> `dialogue_locale.ja.json`, beside the asset manifest. */
export function dialogueLocaleManifestFileName(locale: string): string {
  return `dialogue_locale.${locale}.json`;
}

/** One translated line, keyed like {@link localeLineKey}. */
export type DialogueLocaleLineV1 = {
  speaker: string;
  /** Non-default portrait expression, or null (see {@link keyExpression}). */
  expression: string | null;
  /** The emitted Chinese line this entry translates. */
  zh: string;
  /** The translated line. */
  text: string;
  /**
   * `voice.<locale>.<clip>` asset ID, or null when the line has no recorded
   * clip in the build.
   */
  voice: string | null;
};

/**
 * Translated lines of one chapter. Keys are unique within a chapter; the same
 * line in another chapter has its own entry (and its own clip).
 */
export type DialogueLocaleChapterV1 = {
  id: string;
  lines: DialogueLocaleLineV1[];
};

/**
 * `dialogue_locale.<locale>.json`. Lives outside the scene JSON so recording
 * or re-recording voices never changes a save's content revision.
 */
export type DialogueLocaleManifestV1 = {
  schemaVersion: 1;
  locale: string;
  chapters: DialogueLocaleChapterV1[];
};
