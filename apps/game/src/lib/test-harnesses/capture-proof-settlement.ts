export type CaptureProofCommandStatus = "capturing" | "idle";

export function captureProofCommandIsSettled(input: {
  beforeGeneration: number;
  completedGeneration: number;
  commandStatus: string | null;
  advanceAriaDisabled: string | null;
}): boolean {
  return (
    input.completedGeneration > input.beforeGeneration &&
    input.commandStatus === "idle" &&
    input.advanceAriaDisabled !== "true"
  );
}

export function captureProofNativeAutosaveIsReady(input: {
  priorSaveIds: readonly string[];
  currentSaveId: string | null;
  currentThumbnailType: "available" | "unavailable" | null;
}): boolean {
  return (
    input.currentSaveId !== null &&
    !input.priorSaveIds.includes(input.currentSaveId) &&
    input.currentThumbnailType === "available"
  );
}

export function captureProofDialogueTextIsStable(input: {
  before: string;
  after: string;
  authoritativeText: string;
  advanceAriaDisabled: string | null;
}): boolean {
  return (
    input.before.length > 0 &&
    input.before === input.after &&
    input.after === input.authoritativeText &&
    input.advanceAriaDisabled !== "true"
  );
}

export function captureProofRecoveryTargetMatches(input: {
  dialogueText: string;
  expectedPrefix: string;
  visiblePortraitSrc: string;
  expectedPortraitFragment: string;
}): boolean {
  return (
    input.dialogueText.startsWith(input.expectedPrefix) &&
    input.visiblePortraitSrc.includes(input.expectedPortraitFragment)
  );
}
