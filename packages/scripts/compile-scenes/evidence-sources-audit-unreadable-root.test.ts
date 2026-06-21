// Regression guard for the source-root walk (see review issue #1).
//
// auditEvidenceSources() discovers chapter_<N>/ dirs with a readdirSync +
// per-entry statSync walk. That walk must be guarded: an unreadable root
// (EACCES) or a symlinked entry (ELOOP) used to throw out of the audit and
// discard every problem/item already collected — contradicting the file's
// own "must not abort on a single unreadable ... file" contract. The fix
// mirrors the compiler orchestrator's sourceRootUnreadable handling.
//
// This file isolates a scoped node:fs mock (real fs for every path except a
// deliberately poisoned root) so it cannot perturb the main audit suite.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factory (also hoisted) can reference it safely.
const { poisonedRoots } = vi.hoisted(() => ({
  poisonedRoots: new Set<string>(),
}));

vi.mock("node:fs", async (importActual) => {
  const actual = await importActual<typeof import("node:fs")>();
  return {
    ...actual,
    // Throw EACCES only for poisoned roots; delegate everything else to real fs
    // so the rest of the audit (existsSync, readFileSync, statSync, tmp setup)
    // behaves normally.
    readdirSync: ((path, options) => {
      if (poisonedRoots.has(resolve(String(path)))) {
        const err = new Error(
          `EACCES: permission denied, scandir '${path}'`,
        ) as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      }
      return actual.readdirSync(
        path as Parameters<typeof actual.readdirSync>[0],
        options as Parameters<typeof actual.readdirSync>[1],
      );
    }) as typeof actual.readdirSync,
  };
});

const { auditEvidenceSources } = await import("./evidence-sources-audit");

const tempRoots: string[] = [];

afterEach(() => {
  poisonedRoots.clear();
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
# Scene 1: unreadable-root fixture

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

describe("auditEvidenceSources — unreadable source root", () => {
  it("records a sourceRootUnreadable problem and keeps auditing other roots instead of aborting", () => {
    const poisonedRoot = mkdtempSync(
      join(tmpdir(), "lyra-evidence-audit-poisoned-"),
    );
    const validRoot = mkdtempSync(join(tmpdir(), "lyra-evidence-audit-valid-"));
    tempRoots.push(poisonedRoot, validRoot);

    // Put a real chapter in the valid root; it must still be reported even
    // though the sibling root is unreadable.
    writeValidChapter(join(validRoot, "chapter_2"));

    // Poison only the first root's directory listing. existsSync still returns
    // true (the dir exists), so the guard we are testing is the readdirSync
    // try/catch, not the existence check.
    poisonedRoots.add(resolve(poisonedRoot));

    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { items, problems } = auditEvidenceSources([poisonedRoot, validRoot]);
    errorLog.mockRestore();

    // The valid root's hotspot is reported despite the unreadable sibling.
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sceneFile: "chapter_2/investigation_scene_1.md",
      hotspotId: "cctv_playback",
    });

    // The unreadable root is surfaced as a structured problem, not a throw.
    expect(problems).toContainEqual({
      sceneFile: poisonedRoot,
      kind: "sourceRootUnreadable",
      message: expect.stringContaining("EACCES"),
    });
  });
});
