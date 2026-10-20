/**
 * One spoken `line` item as the compiler emits it. `expression` is the emitted
 * portrait expression, or null when the line has no portrait (narration).
 */
export type EmittedLine = {
  speaker: string;
  text: string;
  expression: string | null;
  /** The authored line's `{#L012}` ID, or null when it has none yet. */
  id: string | null;
  /** Scene file the authored line is in (and so its script), if known. */
  sourceFile: string | null;
};

/** The spoken lines of one manifest scene, in emitted dialogue order. */
export type EmittedScene = {
  chapterId: string;
  /** Authored source basename, e.g. `scene_5.md`. */
  sceneFile: string;
  sceneId: string;
  lines: EmittedLine[];
};

/**
 * Voice clip for one translated line. `clip` names the file
 * `static/assets/voice/<locale>/<clip>.ogg`; the other fields record how the
 * clip was generated.
 */
export type LocaleScriptVoice = {
  clip: string;
  /** Delivery direction, such as an audio tag like `[calm]`. */
  direction?: string;
  /** Reading override sent to text-to-speech instead of `ja`. */
  tts?: string;
  /** Hash of the generation inputs, written back by the generator. */
  ttsHash?: string;
  generatedAt?: string;
};

/**
 * One translated line in a per-scene locale script, linked to its scene line
 * by `id`. `speaker`, `expression` and `zh` record the line as it was when
 * translated; `expression` is omitted for `standard` and portrait-less lines.
 */
export type LocaleScriptLine = {
  id: string;
  speaker: string;
  expression?: string;
  zh: string;
  ja: string;
  note?: string;
  voice?: LocaleScriptVoice;
};

export type LocaleScriptFile = {
  schemaVersion: 1;
  locale: string;
  /** Repo-relative path of the authored scene this script translates. */
  source: string;
  lines: LocaleScriptLine[];
  /**
   * Translated entries whose Chinese line is no longer emitted. Kept so a
   * translation is never silently lost; re-map or delete them by hand.
   */
  stale: LocaleScriptLine[];
};

export type GlossaryCharacter = {
  zh: string;
  ja: string;
  reading?: string;
  firstPerson?: string;
  register?: string;
};

export type GlossaryTerm = {
  zh: string;
  ja: string;
  reading?: string;
  note?: string;
};

export type LocaleGlossary = {
  schemaVersion: 1;
  locale: string;
  styleRules: string[];
  characters: GlossaryCharacter[];
  terms: GlossaryTerm[];
};

export type VoiceDiagnosticSeverity = "error" | "warning";

export type VoiceDiagnostic = {
  severity: VoiceDiagnosticSeverity;
  code: string;
  message: string;
  path: string;
};
