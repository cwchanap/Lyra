import { describe, expect, it } from "vitest";
import * as settlementModule from "./capture-proof-settlement";
import {
  captureProofCommandIsSettled,
  captureProofDialogueTextIsStable,
} from "./capture-proof-settlement";

describe("capture proof command settlement", () => {
  it("does not treat an enabled control as settled while the owning command is capturing", () => {
    expect(
      captureProofCommandIsSettled({
        beforeGeneration: 4,
        completedGeneration: 5,
        commandStatus: "capturing",
        advanceAriaDisabled: null,
      }),
    ).toBe(false);
  });

  it("requires both an idle owning command and an enabled advance control", () => {
    expect(
      captureProofCommandIsSettled({
        beforeGeneration: 4,
        completedGeneration: 5,
        commandStatus: "idle",
        advanceAriaDisabled: "true",
      }),
    ).toBe(false);
    expect(
      captureProofCommandIsSettled({
        beforeGeneration: 4,
        completedGeneration: 4,
        commandStatus: "idle",
        advanceAriaDisabled: null,
      }),
    ).toBe(false);
    expect(
      captureProofCommandIsSettled({
        beforeGeneration: 4,
        completedGeneration: 5,
        commandStatus: "idle",
        advanceAriaDisabled: null,
      }),
    ).toBe(true);
  });
});

describe("capture proof dialogue stability", () => {
  it("rejects an unchanged typewriter prefix that is shorter than the authoritative dialogue", () => {
    expect(
      captureProofDialogueTextIsStable({
        before: "我胃不",
        after: "我胃不",
        authoritativeText: "我胃不好，不能喝咖啡。",
        advanceAriaDisabled: null,
      }),
    ).toBe(false);
  });

  it("rejects a truncated typewriter prefix that changed during the bounded interval", () => {
    expect(
      captureProofDialogueTextIsStable({
        before: "我胃不",
        after: "我胃不好，不能喝咖啡。",
        authoritativeText: "我胃不好，不能喝咖啡。",
        advanceAriaDisabled: null,
      }),
    ).toBe(false);
  });

  it("accepts only non-empty unchanged text while the advance control is enabled", () => {
    expect(
      captureProofDialogueTextIsStable({
        before: "",
        after: "",
        authoritativeText: "",
        advanceAriaDisabled: null,
      }),
    ).toBe(false);
    expect(
      captureProofDialogueTextIsStable({
        before: "我胃不好，不能喝咖啡。",
        after: "我胃不好，不能喝咖啡。",
        authoritativeText: "我胃不好，不能喝咖啡。",
        advanceAriaDisabled: "true",
      }),
    ).toBe(false);
    expect(
      captureProofDialogueTextIsStable({
        before: "我胃不好，不能喝咖啡。",
        after: "我胃不好，不能喝咖啡。",
        authoritativeText: "我胃不好，不能喝咖啡。",
        advanceAriaDisabled: null,
      }),
    ).toBe(true);
  });
});

describe("capture proof recovery target", () => {
  it("accepts a distinctive revealed prefix only with the expected current portrait", () => {
    const matches = (
      settlementModule as unknown as {
        captureProofRecoveryTargetMatches?: (input: {
          dialogueText: string;
          expectedPrefix: string;
          visiblePortraitSrc: string;
          expectedPortraitFragment: string;
        }) => boolean;
      }
    ).captureProofRecoveryTargetMatches;

    expect(
      matches?.({
        dialogueText: "他在店裡帶回來的那些蛋",
        expectedPrefix: "他在店裡",
        visiblePortraitSrc:
          "http://asset.localhost/portraits/miyake_mother/standard.png",
        expectedPortraitFragment: "portraits/miyake_mother/standard.png",
      }),
    ).toBe(true);
    expect(
      matches?.({
        dialogueText: "他在店裡帶回來的那些蛋",
        expectedPrefix: "他在店裡",
        visiblePortraitSrc:
          "http://asset.localhost/portraits/soma_ritsu/standard.png",
        expectedPortraitFragment: "portraits/miyake_mother/standard.png",
      }),
    ).toBe(false);
    expect(
      matches?.({
        dialogueText: "他在",
        expectedPrefix: "他在店裡",
        visiblePortraitSrc:
          "http://asset.localhost/portraits/miyake_mother/standard.png",
        expectedPortraitFragment: "portraits/miyake_mother/standard.png",
      }),
    ).toBe(false);
  });
});
