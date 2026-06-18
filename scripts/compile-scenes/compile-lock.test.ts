import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { withCompileLock } from "./compile-lock";

describe("withCompileLock", () => {
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
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
