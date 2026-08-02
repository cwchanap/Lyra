import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cleanupOwnedE2eRoots,
  createChildSupervisor,
  createRunOwnership,
  readRunOwnership,
} from "./e2e-runner-lifecycle.mjs";
import { createSaveE2eAppDataDir } from "./save-e2e-paths.mjs";

const holders = [];

function holder(prefix = "lyra-e2e-runner-test-") {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  holders.push(directory);
  return directory;
}

test.afterEach(() => {
  for (const directory of holders.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ownership is recorded immediately for each guarded root and cleanup only removes owned roots", () => {
  const runDirectory = holder();
  const ownershipPath = path.join(runDirectory, "run-ownership.json");
  const roots = [];
  const ownership = createRunOwnership({
    ownershipPath,
    runId: "test-run",
    rootKeys: [
      "smoke",
      "gameplay",
      "productionJourney",
      "capture",
      "persistence",
      "exit",
    ],
    createRoot() {
      const root = createSaveE2eAppDataDir();
      roots.push(root);
      return root;
    },
  });
  holders.push(...roots);
  const foreignRoot = createSaveE2eAppDataDir();
  holders.push(foreignRoot);

  assert.deepEqual(
    ownership.roots.map(({ key }) => key),
    [
      "smoke",
      "gameplay",
      "productionJourney",
      "capture",
      "persistence",
      "exit",
    ],
  );
  assert.equal(readRunOwnership(ownershipPath).roots.length, 6);

  cleanupOwnedE2eRoots(ownershipPath);

  for (const root of roots) assert.equal(existsSync(root), false);
  assert.equal(existsSync(foreignRoot), true);
});

test(
  "cleanup rejects malformed, foreign, non-temporary, wrong-prefix, and symlink roots",
  { skip: process.platform === "win32" },
  () => {
    const runDirectory = holder();
    const ownershipPath = path.join(runDirectory, "run-ownership.json");
    const ownedRoot = createSaveE2eAppDataDir();
    holders.push(ownedRoot);
    const foreignRoot = createSaveE2eAppDataDir();
    holders.push(foreignRoot);
    const outside = holder("outside-e2e-runner-");
    const nonTemporaryRoot = path.join(outside, "lyra-save-e2e-non-temporary");
    mkdirSync(nonTemporaryRoot);
    const wrongPrefixRoot = holder("not-lyra-save-e2e-");
    const symlinkRoot = path.join(tmpdir(), "lyra-save-e2e-runner-link");
    symlinkSync(outside, symlinkRoot, "dir");
    holders.push(symlinkRoot);

    const base = {
      schemaVersion: 1,
      runId: "test-run",
      roots: [
        { key: "smoke", appDataDir: ownedRoot, cleanup: { state: "pending" } },
      ],
    };
    const rejected = [
      "{",
      JSON.stringify({
        ...base,
        roots: [{ ...base.roots[0], appDataDir: foreignRoot }],
      }),
      JSON.stringify({
        ...base,
        roots: [{ ...base.roots[0], appDataDir: nonTemporaryRoot }],
      }),
      JSON.stringify({
        ...base,
        roots: [{ ...base.roots[0], appDataDir: wrongPrefixRoot }],
      }),
      JSON.stringify({
        ...base,
        roots: [{ ...base.roots[0], appDataDir: symlinkRoot }],
      }),
    ];

    for (const text of rejected) {
      writeFileSync(ownershipPath, text);
      assert.throws(
        () => cleanupOwnedE2eRoots(ownershipPath),
        /unsafe|ownership/i,
      );
    }
    assert.equal(existsSync(foreignRoot), true);
    assert.equal(existsSync(nonTemporaryRoot), true);
    assert.equal(existsSync(wrongPrefixRoot), true);
    assert.equal(existsSync(outside), true);
  },
);

test("the asynchronous child supervisor forwards cancellation and waits for the child exit", async () => {
  const processRef = new EventEmitter();
  const child = new EventEmitter();
  const forwarded = [];
  child.kill = (signal) => {
    forwarded.push(signal);
    return true;
  };
  const supervisor = createChildSupervisor({ processRef });
  const completion = supervisor.run({
    command: "bun",
    args: ["x", "wdio"],
    options: {},
    spawnImpl() {
      return child;
    },
  });

  processRef.emit("SIGTERM");
  child.emit("exit", null, "SIGTERM");

  assert.deepEqual(await completion, { exitCode: 143, signal: "SIGTERM" });
  assert.deepEqual(forwarded, ["SIGTERM"]);
  assert.equal(supervisor.cancelledSignal, "SIGTERM");
  supervisor.dispose();
});
