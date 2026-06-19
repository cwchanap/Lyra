import { existsSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pass-through mock so individual tests can force `writeFile` to fail or
// observe `rm` calls. The default behavior delegates to the real filesystem
// so the concurrency test below keeps using real disk I/O.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
    rm: vi.fn(actual.rm),
  };
});

import { rm, writeFile } from "node:fs/promises";
import { isStaleLock, withCompileLock } from "./compile-lock";

const mockedWriteFile = vi.mocked(writeFile);
const mockedRm = vi.mocked(rm);

describe("withCompileLock", () => {
  afterEach(() => {
    mockedWriteFile.mockReset();
    mockedRm.mockReset();
  });

  it("serializes concurrent sections for the same output root", async () => {
    const outputRoot = mkdtempSync(resolve(tmpdir(), "lyra-compile-lock-"));
    const events: string[] = [];

    try {
      const first = withCompileLock(outputRoot, async () => {
        events.push("first:start");
        await sleep(50);
        events.push("first:end");
        return "first";
      });

      await sleep(5);

      const second = withCompileLock(outputRoot, async () => {
        events.push("second:start");
        events.push("second:end");
        return "second";
      });

      await expect(Promise.all([first, second])).resolves.toEqual([
        "first",
        "second",
      ]);
      expect(events).toEqual([
        "first:start",
        "first:end",
        "second:start",
        "second:end",
      ]);
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
      rmSync(`${outputRoot}.compile.lock`, { recursive: true, force: true });
    }
  });

  it("removes the lock directory when owner.json write fails after mkdir", async () => {
    const outputRoot = mkdtempSync(
      resolve(tmpdir(), "lyra-compile-lock-fail-"),
    );
    const lockDir = `${outputRoot}.compile.lock`;

    // Force the owner.json write (the call inside `acquireLock`) to fail with
    // a non-EEXIST error. The default pass-through handles the parent-dir
    // mkdir; only the owner.json write is poisoned.
    mockedWriteFile.mockImplementationOnce(async () => {
      throw Object.assign(new Error("no space left on device"), {
        code: "ENOSPC",
      });
    });

    try {
      await expect(
        withCompileLock(outputRoot, async () => "should not run"),
      ).rejects.toThrow("no space left on device");

      // The orphaned lock directory must be cleaned up so the next compile
      // is not blocked by a half-created lock.
      expect(existsSync(lockDir)).toBe(false);
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
      rmSync(lockDir, { recursive: true, force: true });
    }
  });
});

describe("isStaleLock", () => {
  let lockDir: string;

  beforeEach(() => {
    lockDir = mkdtempSync(resolve(tmpdir(), "lyra-stale-lock-"));
  });

  afterEach(() => {
    rmSync(lockDir, { recursive: true, force: true });
  });

  it("treats a lock held by a live PID as fresh regardless of mtime", async () => {
    await writeFile(
      resolve(lockDir, "owner.json"),
      `${JSON.stringify({
        pid: process.pid,
        createdAt: new Date(0).toISOString(),
      })}\n`,
    );
    // Force the directory mtime far into the past so the mtime-only check
    // would incorrectly consider this lock stale.
    utimesSync(lockDir, 1, 1);

    expect(await isStaleLock(lockDir)).toBe(false);
  });

  it("still treats a lock with a dead PID and stale mtime as stale", async () => {
    // PID 999999999 is effectively guaranteed to be unused on POSIX systems.
    await writeFile(
      resolve(lockDir, "owner.json"),
      `${JSON.stringify({
        pid: 999999999,
        createdAt: new Date(0).toISOString(),
      })}\n`,
    );
    utimesSync(lockDir, 1, 1);

    expect(await isStaleLock(lockDir)).toBe(true);
  });

  it("falls back to mtime when owner.json is missing", async () => {
    // No owner.json; old mtime. Should be considered stale by mtime fallback.
    utimesSync(lockDir, 1, 1);
    expect(await isStaleLock(lockDir)).toBe(true);
  });
});

function sleep(_ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep));
}
