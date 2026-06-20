import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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

      // Wait until `first` has actually acquired the lock (signaled by
      // `first:start`, which runs inside the critical section) before starting
      // `second`. A fixed-time head-start is not deterministic across CI hosts:
      // mkdir+writeFile latency varies, so without this guard `second` could
      // win the acquire race and invert the event order.
      await vi.waitFor(() => expect(events).toContain("first:start"));

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

  it("reaps a stale lock (dead PID + old mtime) and acquires cleanly", async () => {
    // End-to-end coverage for the stale-reap path through acquireLock:
    // mkdir throws EEXIST → isStaleLock returns true → rm → retry mkdir →
    // write owner.json → callback runs → finally rm. isStaleLock is unit-
    // tested below, but this is the only test that exercises the full
    // detect-stale → reap → re-acquire → release flow in withCompileLock.
    const outputRoot = mkdtempSync(
      resolve(tmpdir(), "lyra-compile-lock-stale-"),
    );
    const lockDir = `${outputRoot}.compile.lock`;

    // Plant a stale lock: directory exists (forces EEXIST on mkdir), owner
    // PID is guaranteed dead, and mtime is ancient so both liveness and
    // mtime checks agree the lock is stale.
    mkdirSync(lockDir);
    writeFileSync(
      resolve(lockDir, "owner.json"),
      `${JSON.stringify({
        pid: 999999999,
        createdAt: new Date(0).toISOString(),
      })}\n`,
    );
    utimesSync(lockDir, 1, 1);

    let observedOwnerPid: unknown = null;

    try {
      const result = await withCompileLock(outputRoot, async () => {
        // Inside the critical section the lock must have been reaped and
        // re-acquired by THIS process: owner.json should now reference us,
        // not the dead PID we planted. If the stale lock were merely reused
        // (no reap + rewrite), this would still be 999999999.
        const raw = readFileSync(resolve(lockDir, "owner.json"), "utf8");
        observedOwnerPid = (JSON.parse(raw) as { pid?: unknown }).pid;
        return "reaped-and-acquired";
      });

      expect(result).toBe("reaped-and-acquired");
      expect(observedOwnerPid).toBe(process.pid);
      // The lock dir is cleaned up after the callback resolves.
      expect(existsSync(lockDir)).toBe(false);
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
      rmSync(lockDir, { recursive: true, force: true });
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

  it("treats a lock held by a live PID as fresh when newer than the hard cap", async () => {
    await writeFile(
      resolve(lockDir, "owner.json"),
      `${JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
      })}\n`,
    );
    // Recent mtime: PID is alive and lock is under the cap, so fresh.
    const recent = Math.floor(Date.now() / 1000) - 60;
    utimesSync(lockDir, recent, recent);

    expect(await isStaleLock(lockDir)).toBe(false);
  });

  it("reaps a lock whose recorded PID is alive but exceeds the hard cap (PID reuse)", async () => {
    // PID reuse scenario: the recorded PID belongs to THIS process (alive),
    // but the lock is ancient — well beyond MAX_LOCK_MS. The PID-alive check
    // alone would treat it as fresh forever; the hard cap must reap it.
    await writeFile(
      resolve(lockDir, "owner.json"),
      `${JSON.stringify({
        pid: process.pid,
        createdAt: new Date(0).toISOString(),
      })}\n`,
    );
    utimesSync(lockDir, 1, 1);

    expect(await isStaleLock(lockDir)).toBe(true);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
