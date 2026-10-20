import { describe, expect, it } from "vitest";
import { addMissingLineIds, formatLineId, scanSourceLineIds } from "./line-ids";

describe("scanSourceLineIds", () => {
  it("maps each physical line to its ID and lists lines without one", () => {
    const source = [
      "# Scene 1: 接案",
      "[場景：雨夜。]",
      "**相馬律**：先確認現場。 {#L002}",
      "**早坂茜**[concerned]：你不舒服？",
      "- **On Loop:** **神谷澪**：還沒。 {#L010}",
    ].join("\n");
    const scan = scanSourceLineIds(source, "chapter_1/scene_1.md");
    expect([...scan.byLine]).toEqual([
      [3, "L002"],
      [5, "L010"],
    ]);
    expect(scan.missing).toEqual([4]);
    expect(scan.errors).toEqual([]);
  });

  it("errors on a repeated ID and on a malformed trailing tag", () => {
    const source = [
      "**相馬律**：一。 {#L001}",
      "**相馬律**：二。 {#L001}",
      "**相馬律**：三。 {#L1}",
    ].join("\n");
    const scan = scanSourceLineIds(source, "scene.md");
    expect(scan.errors.map((error) => [error.code, error.line])).toEqual([
      ["dialogueLineIdDuplicate", 2],
      ["dialogueLineIdMalformed", 3],
    ]);
    expect(scan.missing).toEqual([]);
  });
});

describe("addMissingLineIds", () => {
  it("numbers after the highest ID in the file or still reserved, keeping every other byte", () => {
    const source =
      "# Scene\r\n**相馬律**：一。 {#L004}\r\n**早坂茜**：二。  \r\n**早坂茜**：三。";
    const result = addMissingLineIds(source, ["L007"]);
    expect(result.added).toBe(2);
    expect(result.text).toBe(
      "# Scene\r\n**相馬律**：一。 {#L004}\r\n**早坂茜**：二。 {#L008}  \r\n**早坂茜**：三。 {#L009}",
    );
    expect(addMissingLineIds(result.text).added).toBe(0);
  });

  it("starts at L001 and pads to three digits", () => {
    expect(addMissingLineIds("**A**：hi").text).toBe("**A**：hi {#L001}");
    expect(formatLineId(1234)).toBe("L1234");
  });
});
