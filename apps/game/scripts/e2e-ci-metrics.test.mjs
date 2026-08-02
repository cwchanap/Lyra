import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  initializeE2eCiMetrics,
  recordE2eCiSetup,
  runTimedE2eCiStage,
} from "./e2e-ci-metrics.mjs";

test("records raw setup, restored-cache, build, and test measurements", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "lyra-e2e-metrics-"));
  const metricsFile = path.join(directory, "gameplay.json");
  try {
    initializeE2eCiMetrics({
      metricsFile,
      chainId: "gameplay",
      nowMs: () => 1_000,
    });
    recordE2eCiSetup({
      metricsFile,
      cacheDirectory: "/tmp/cache",
      cacheHit: "true",
      nowMs: () => 1_400,
      measureDirectoryBytes: () => 8_192,
    });
    const buildExit = runTimedE2eCiStage({
      metricsFile,
      stage: "build",
      command: "node",
      args: ["build.mjs"],
      nowMs: (() => {
        const values = [1_500, 1_750];
        return () => values.shift();
      })(),
      runCommand: () => ({ status: 0 }),
    });
    const testExit = runTimedE2eCiStage({
      metricsFile,
      stage: "test",
      command: "xvfb-run",
      args: ["node", "run.mjs"],
      nowMs: (() => {
        const values = [1_800, 2_300];
        return () => values.shift();
      })(),
      runCommand: () => ({ status: 17 }),
    });

    assert.equal(buildExit, 0);
    assert.equal(testExit, 17);
    assert.deepEqual(JSON.parse(readFileSync(metricsFile, "utf8")), {
      schemaVersion: 1,
      chainId: "gameplay",
      startedAtMs: 1_000,
      setup: {
        finishedAtMs: 1_400,
        durationMs: 400,
        cacheHit: true,
        restoredCacheBytes: 8_192,
      },
      build: {
        startedAtMs: 1_500,
        finishedAtMs: 1_750,
        durationMs: 250,
        exitCode: 0,
      },
      test: {
        startedAtMs: 1_800,
        finishedAtMs: 2_300,
        durationMs: 500,
        exitCode: 17,
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("refuses unknown chains and timing stages", () => {
  assert.throws(
    () =>
      initializeE2eCiMetrics({
        metricsFile: "/tmp/metrics.json",
        chainId: "unknown",
      }),
    /chain/i,
  );
  assert.throws(
    () =>
      runTimedE2eCiStage({
        metricsFile: "/tmp/metrics.json",
        stage: "setup",
        command: "node",
        args: [],
      }),
    /stage/i,
  );
});
