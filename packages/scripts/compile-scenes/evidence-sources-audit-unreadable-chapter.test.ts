// Regression guard for the per-chapter stat walk (review issue #2).
//
// auditEvidenceSources() confirms each chapter_<N>/ dir is a directory via
// statSync before auditing it. A dir that can't be stat'd (EACCES / ELOOP /
// a broken symlink) used to be silently dropped from the chapter filter — so
// its evidence hotspots were never audited and the CI gate could pass green
// while skipping them. The fix records a `chapterEntryUnreadable` problem so
// auditGateShouldFail() fails the build instead.
//
// This file isolates a scoped node:fs mock (real fs for every path except a
// deliberately poisoned chapter entry) so it cannot perturb the main audit
// suite.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factory (also hoisted) can reference it safely.
const { poisonedEntries } = vi.hoisted(() => ({
  poisonedEntries: new Set<string>(),
}));

vi.mock("node:fs", async (importActual) => {
  const actual = await importActual<typeof import("node:fs")>();
  return {
    ...actual,
    // Throw EACCES only for poisoned chapter entries; delegate every other
    // stat (valid chapter dir, file-vs-dir checks) to the real fs so the rest
    // of the audit behaves normally.
    statSync: ((path, options) => {
      if (poisonedEntries.has(resolve(String(path)))) {
        const err = new Error(
          `EACCES: permission denied, stat '${path}'`,
        ) as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      }
      return actual.statSync(
        path as Parameters<typeof actual.statSync>[0],
        options as Parameters<typeof actual.statSync>[1],
      );
    }) as typeof actual.statSync,
  };
});

const { auditEvidenceSources } = await import("./evidence-sources-audit");

const tempRoots: string[] = [];

afterEach(() => {
  poisonedEntries.clear();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function writeValidChapter(chapterRoot: string): void {
  mkdirSync(chapterRoot, { recursive: true });
  writeFileSync(
    join(chapterRoot, "chapter.md"),
    `
# Chapter 2: fixture

**Summary:** fixture chapter.

## Scenes
1. investigation_scene_1.md
`.trim(),
  );
  writeFileSync(
    join(chapterRoot, "investigation_scene_1.md"),
    `
# Scene 1: unreadable-chapter fixture

## Intro

**相馬律**：確認現場。

## Sub-location: front_room {#front_room}
- **Status:** unlocked
- **Background Prompt:** Rainy Tokyo cafe front room at night.

[場景：雨夜的咖啡館前廳。]

### Hotspot: 閉店監視器回放 {#cctv_playback}
- **Description:** 收銀台旁的小螢幕還能調出閉店前的監視器畫面。
- **Reveals:** [evidence:cctv_screenshot]
- **Evidence Source:** implied

**相馬律**：影像還在。

## Evidence Manifest

### evidence:cctv_screenshot {#cctv_screenshot}
- **Name:** 閉店監視器截圖
- **Description:** 截圖。
- **Details:** 截圖顯示有人經過。
- **Image Prompt:** Square CCTV screenshot evidence icon.

#### On Collect

**相馬律**：取得截圖。

## Statement Manifest

## Outro

**相馬律**：先整理證據。
`.trim(),
  );
}

describe("auditEvidenceSources — un-stattable chapter entry", () => {
  it("records a chapterEntryUnreadable problem and keeps auditing sibling chapters", () => {
    const root = mkdtempSync(join(tmpdir(), "lyra-evidence-audit-stat-"));
    tempRoots.push(root);

    // A valid chapter whose hotspot must still be reported...
    writeValidChapter(join(root, "chapter_2"));
    // ...and a chapter dir that statSync cannot read. It still exists on disk
    // (so existsSync/readdirSync see it) but stat throws EACCES.
    mkdirSync(join(root, "chapter_1"), { recursive: true });
    poisonedEntries.add(resolve(root, "chapter_1"));

    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { items, problems } = auditEvidenceSources([root]);
    errorLog.mockRestore();

    // The readable chapter's hotspot is still reported despite the sibling
    // entry being un-stattable.
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sceneFile: "chapter_2/investigation_scene_1.md",
      hotspotId: "cctv_playback",
    });

    // The un-stattable chapter is surfaced as a structured problem (not a
    // silent drop), so auditGateShouldFail() fails the build instead of
    // passing green while skipping chapter_1's evidence hotspots.
    expect(problems).toContainEqual({
      sceneFile: `${root}/chapter_1`,
      kind: "chapterEntryUnreadable",
      message: expect.stringContaining("EACCES"),
    });
  });
});
