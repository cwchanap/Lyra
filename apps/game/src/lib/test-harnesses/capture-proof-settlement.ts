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

export function captureProofDialogueTextIsStable(input: {
  before: string;
  after: string;
  advanceAriaDisabled: string | null;
}): boolean {
  return (
    input.before.length > 0 &&
    input.before === input.after &&
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
