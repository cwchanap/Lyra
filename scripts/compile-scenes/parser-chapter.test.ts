import { describe, expect, it } from "bun:test";
import { parseChapter } from "./parser-chapter";

describe("parseChapter", () => {
  it("parses a minimal valid manifest", () => {
    const source = `
# Chapter 1: 雨鐘咖啡館殺人事件

**Summary:** 律師相馬律調查咖啡館。

## Scenes
1. scene_0.md
2. investigation_scene_1.md
`.trim();
    const result = parseChapter(source, "chapter_1/chapter.md", "chapter_1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.number).toBe(1);
    expect(result.value.title).toBe("雨鐘咖啡館殺人事件");
    expect(result.value.summary).toBe("律師相馬律調查咖啡館。");
    expect(result.value.sceneFiles).toEqual(["scene_0.md", "investigation_scene_1.md"]);
  });

  it("rejects a manifest with no H1", () => {
    const source = `**Summary:** foo\n## Scenes\n1. scene_0.md`;
    const result = parseChapter(source, "chapter_1/chapter.md", "chapter_1");
    expect(result.ok).toBe(false);
  });

  it("rejects a manifest whose H1 number doesn't match the directory name", () => {
    const source = `
# Chapter 2: foo

**Summary:** bar

## Scenes
1. scene_0.md
`.trim();
    const result = parseChapter(source, "chapter_1/chapter.md", "chapter_1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("chapterNumberMismatch");
  });

  it("rejects a manifest missing the Summary field", () => {
    const source = `
# Chapter 1: foo

## Scenes
1. scene_0.md
`.trim();
    const result = parseChapter(source, "chapter_1/chapter.md", "chapter_1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("chapterMissingSummary");
  });

  it("rejects a manifest with an empty Scenes list", () => {
    const source = `
# Chapter 1: foo

**Summary:** bar

## Scenes
`.trim();
    const result = parseChapter(source, "chapter_1/chapter.md", "chapter_1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("chapterNoScenes");
  });

  it("rejects a malformed scene-list entry (missing .md extension)", () => {
    const source = `
# Chapter 1: foo

**Summary:** bar

## Scenes
1. scene_0.md
2. investigation_scene_1
`.trim();
    const result = parseChapter(source, "chapter_1/chapter.md", "chapter_1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("chapterMalformedSceneRow");
  });

  it("rejects a malformed scene-list entry (trailing comment)", () => {
    const source = `
# Chapter 1: foo

**Summary:** bar

## Scenes
1. scene_0.md # note
`.trim();
    const result = parseChapter(source, "chapter_1/chapter.md", "chapter_1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("chapterMalformedSceneRow");
  });

  it("rejects a scene-list entry with path traversal (..)", () => {
    const source = `
# Chapter 1: foo

**Summary:** bar

## Scenes
1. ../chapter_2/scene_0.md
`.trim();
    const result = parseChapter(source, "chapter_1/chapter.md", "chapter_1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("chapterMalformedSceneRow");
  });

  it("rejects a scene-list entry with absolute path", () => {
    const source = `
# Chapter 1: foo

**Summary:** bar

## Scenes
1. /etc/passwd.md
`.trim();
    const result = parseChapter(source, "chapter_1/chapter.md", "chapter_1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("chapterMalformedSceneRow");
  });
});
