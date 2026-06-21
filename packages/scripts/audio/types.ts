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
  bgm?: string | "none";
  bgs?: string | "none";
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
