import { describe, expect, it } from "vitest";
import { innerVoiceWrapErrors } from "./inner-voice";

describe("innerVoiceWrapErrors", () => {
  it("accepts whole thoughts, ordinary speech and parenthesised narration", () => {
    const source = [
      "# Scene 1: 接案",
      "[場景：雨夜。]",
      "**相馬律**：（……我想相信她。）",
      "**相馬律**[shaken]：（……） {#L004}",
      "**早坂茜**：你（又）在想什麼？",
      "**早坂茜**：我知道。（停頓）",
      "[（沒有新發現。）]",
      "- **On Loop:** **相馬律**：（還不夠。）",
    ].join("\n");
    expect(innerVoiceWrapErrors(source, "chapter_1/scene_1.md")).toEqual([]);
  });

  it("rejects a spoken line that opens with （ but does not close, with its file and line", () => {
    const source = [
      "# Scene 1: 接案",
      "**相馬律**：（……我想相信她。",
      "**相馬律**[shaken]：（低聲）我想相信她。 {#L003}",
      "- **Loop Prompt:** **相馬律**：（再問一次。",
    ].join("\n");
    const errors = innerVoiceWrapErrors(source, "chapter_1/scene_1.md");
    expect(errors.map((error) => [error.code, error.line])).toEqual([
      ["innerVoiceUnclosed", 2],
      ["innerVoiceUnclosed", 3],
      ["innerVoiceUnclosed", 4],
    ]);
    expect(errors[0]?.sourceFile).toBe("chapter_1/scene_1.md");
    expect(errors[0]?.message).toContain("chapter_1/scene_1.md:2:");
  });
});
