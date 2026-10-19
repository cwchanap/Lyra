/**
 * One spoken `line` item as the compiler emits it. `expression` is the emitted
 * portrait expression, or null when the line has no portrait (narration).
 */
export type EmittedLine = {
  speaker: string;
  text: string;
  expression: string | null;
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
 * One translated line in a per-scene locale script. `expression` is omitted
 * for the `standard` expression and for portrait-less lines; see
 * {@link localeLineKey}.
 */
export type LocaleScriptLine = {
  speaker: string;
  expression?: string;
  zh: string;
  ja: string;
  note?: string;
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
