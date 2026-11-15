import { describe, expect, it } from "vitest";
import { isInnerVoiceLine, isInnerVoiceText } from "./inner-voice";

describe("isInnerVoiceText", () => {
  it("is true only for text that is one whole full-width （…） group", () => {
    expect(isInnerVoiceText("（……我想相信她。）")).toBe(true);
    expect(isInnerVoiceText(" （……） ")).toBe(true);
    expect(isInnerVoiceText("……我想相信她。")).toBe(false);
    expect(isInnerVoiceText("我知道。（停頓）")).toBe(false);
    expect(isInnerVoiceText("（低聲）我知道。")).toBe(false);
    // The opening （ must close at the very end: this is speech with two
    // stage directions, not a thought.
    expect(isInnerVoiceText("（低聲）我知道。（停頓）")).toBe(false);
    expect(isInnerVoiceText("（她說（大概）不會來。）")).toBe(true);
    expect(isInnerVoiceText("（（還沒說完）")).toBe(false);
    // Half-width parentheses are not the convention.
    expect(isInnerVoiceText("(……我想相信她。)")).toBe(false);
    expect(isInnerVoiceText("")).toBe(false);
  });
});

describe("isInnerVoiceLine", () => {
  it("applies to spoken lines only, never to narration", () => {
    expect(
      isInnerVoiceLine({ kind: "line", speaker: "相馬律", text: "（……）" }),
    ).toBe(true);
    expect(
      isInnerVoiceLine({ kind: "line", speaker: "相馬律", text: "不說謊。" }),
    ).toBe(false);
    // The compiler's default 「（沒有新發現。）」 is narration and stays so.
    expect(isInnerVoiceLine({ kind: "action", text: "（沒有新發現。）" })).toBe(
      false,
    );
    expect(
      isInnerVoiceLine({
        kind: "prompt",
        question: "（那 89.7 秒說明了什麼？）",
        options: [],
      }),
    ).toBe(false);
    expect(
      isInnerVoiceLine({
        id: 3,
        kind: "line",
        speaker: "相馬律",
        text: "（……我想相信她。）",
        chapterTitle: "Chapter",
        sceneTitle: "Scene",
      }),
    ).toBe(true);
  });
});
