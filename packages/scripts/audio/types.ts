export type SoundPlanChannel = "bgm" | "bgs" | "sfx";
export type SoundPlanStatus =
  | "proposed"
  | "approved"
  | "generated"
  | "rejected";

export type SoundPlanEvidence = {
  file: string;
  line: number;
  note: string;
};

export type SoundPlanEntry = {
  id: string;
  channel: SoundPlanChannel;
  status: SoundPlanStatus;
  loop: boolean;
  intendedDurationSeconds: number;
  prompt: string;
  reuseRationale: string;
  evidence: SoundPlanEvidence[];
  provider?: string;
  endpoint?: string;
  promptHash?: string;
  generatedAt?: string;
  durationSeconds?: number;
  outputPath?: string;
  forced?: boolean;
  normalizationNotes?: string;
};

export type SoundPlanCue = {
  file: string;
  visualUnit: string;
  /**
   * BGM entry ID from the sound plan, or the literal `"none"` for explicit
   * silence. The `"none"` sentinel is validated in `validateSoundPlan`
   * (sound-plan.ts); all other values must reference an approved entry.
   */
  bgm?: string;
  /** Same semantics as {@link bgm} but for the BGS channel. */
  bgs?: string;
  /**
   * Parsed from YAML so the validator can emit a precise
   * `soundPlanSfxCueUnsupported` diagnostic, but unconditionally rejected —
   * SFX cues are not supported in scene markdown in v1. Kept on the type
   * (rather than `never`) so the parser can accept the field without producing
   * a generic "unknown field" error.
   */
  sfx?: string;
};

export type RejectedSound = {
  file: string;
  line: number;
  sound: string;
  reason: string;
};

export type SoundPlan = {
  schemaVersion: 1;
  chapterId: string;
  sources: string[];
  catalogSnapshot: {
    bgm: string[];
    bgs: string[];
    sfx: string[];
  };
  entries: SoundPlanEntry[];
  cues: SoundPlanCue[];
  rejected: RejectedSound[];
};

export type SoundPlanDiagnostic = {
  code: string;
  message: string;
  path: string;
};
