import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  existsSync,
  mkdirSync,
  readFileSync,
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
  runE2eRunner,
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

test("ownership allocation rolls back and records cleanup when marker or manifest initialization fails", () => {
  const runDirectory = holder();
  const roots = [];
  const createRoot = () => {
    const root = createSaveE2eAppDataDir();
    roots.push(root);
    return root;
  };
  const cases = [
    {
      name: "marker",
      options: {
        writeRootMarker: () => {
          throw new Error("marker failed");
        },
      },
    },
    {
      name: "manifest",
      options: {
        writeOwnership: (() => {
          let calls = 0;
          return (destination, ownership) => {
            calls += 1;
            if (calls === 2) throw new Error("manifest failed");
            writeFileSync(destination, `${JSON.stringify(ownership)}\n`);
          };
        })(),
      },
    },
  ];

  for (const testCase of cases) {
    const casePath = path.join(runDirectory, `${testCase.name}.json`);
    assert.throws(
      () =>
        createRunOwnership({
          ownershipPath: casePath,
          runId: `rollback-${testCase.name}`,
          rootKeys: ["smoke"],
          createRoot,
          ...testCase.options,
        }),
      /failed/i,
    );
    const ownership = JSON.parse(readFileSync(casePath, "utf8"));
    assert.equal(ownership.roots[0].cleanup.state, "removed");
    assert.equal(existsSync(ownership.roots[0].appDataDir), false);
  }
  holders.push(...roots);
});

test("runner retry preserves a failed attempt while using fresh roots and output directories", async () => {
  const runDirectory = holder();
  const roots = [];
  const outputs = [];
  const captured = [];
  const runner = await runE2eRunner({
    suiteIds: ["smoke"],
    riskSelectedSuites: ["smoke"],
    attempts: 2,
    forcedFull: false,
    runDirectory,
    supervisor: { cancelledSignal: null },
    runGuard: async () => ({ exitCode: 0 }),
    rootKeys: ["smoke"],
    createRoot() {
      const root = createSaveE2eAppDataDir();
      roots.push(root);
      return root;
    },
    buildPhasePlan(_suiteIds, directories) {
      return [{ id: "ordinary", root: "smoke", appDataDir: directories.smoke }];
    },
    suiteForPhase: () => "smoke",
    applyCheckpoint() {},
    createOutputDirectory(details) {
      const output = path.join(
        runDirectory,
        `attempt-${details.attempt}`,
        details.phase,
      );
      mkdirSync(output, { recursive: true });
      outputs.push(output);
      return output;
    },
    async runPhase(_phase, { attempt }) {
      return { exitCode: attempt === 1 ? 23 : 0 };
    },
    captureFailureArtifacts(details) {
      captured.push(details);
      assert.equal(existsSync(details.phase.appDataDir), true);
    },
  });

  assert.equal(runner.exitCode, 0);
  assert.equal(runner.result.firstFailedSuite, "smoke");
  assert.deepEqual(
    runner.result.phaseResults.map(({ attempt, exitCode }) => [
      attempt,
      exitCode,
    ]),
    [
      [1, 23],
      [2, 0],
    ],
  );
  assert.notEqual(roots[0], roots[1]);
  assert.notEqual(outputs[0], outputs[1]);
  assert.equal(captured.length, 1);
  for (const root of roots) assert.equal(existsSync(root), false);
});

test("runner applies an external mutation before starting its fresh discovery child", async () => {
  const runDirectory = holder();
  const roots = [];
  const events = [];
  await runE2eRunner({
    suiteIds: ["save-management"],
    riskSelectedSuites: ["save-management"],
    attempts: 1,
    forcedFull: false,
    runDirectory,
    supervisor: { cancelledSignal: null },
    runGuard: async () => ({ exitCode: 0 }),
    rootKeys: ["persistence"],
    createRoot() {
      const root = createSaveE2eAppDataDir();
      roots.push(root);
      return root;
    },
    buildPhasePlan(_suiteIds, directories) {
      return [
        {
          id: "management-corrupt-newest",
          root: "persistence",
          appDataDir: directories.persistence,
          before: { type: "corrupt-slot", fixedSlotName: "autosave-1" },
        },
      ];
    },
    suiteForPhase: () => "save-management",
    applyCheckpoint(phase) {
      events.push(`mutate:${phase.id}`);
    },
    createOutputDirectory: () => runDirectory,
    async runPhase(phase) {
      events.push(`spawn:${phase.id}`);
      return { exitCode: 0 };
    },
    captureFailureArtifacts() {},
  });

  assert.deepEqual(events, [
    "mutate:management-corrupt-newest",
    "spawn:management-corrupt-newest",
  ]);
  for (const root of roots) assert.equal(existsSync(root), false);
});

test("runner cancellation writes diagnostics and cleans only its owned root", async () => {
  const runDirectory = holder();
  const roots = [];
  const foreignRoot = createSaveE2eAppDataDir();
  holders.push(foreignRoot);
  const supervisor = { cancelledSignal: null };
  const runner = await runE2eRunner({
    suiteIds: ["smoke"],
    riskSelectedSuites: ["smoke"],
    attempts: 1,
    forcedFull: false,
    runDirectory,
    supervisor,
    runGuard: async () => ({ exitCode: 0 }),
    rootKeys: ["smoke"],
    createRoot() {
      const root = createSaveE2eAppDataDir();
      roots.push(root);
      return root;
    },
    buildPhasePlan(_suiteIds, directories) {
      return [{ id: "ordinary", root: "smoke", appDataDir: directories.smoke }];
    },
    suiteForPhase: () => "smoke",
    applyCheckpoint() {},
    createOutputDirectory: () => runDirectory,
    async runPhase() {
      supervisor.cancelledSignal = "SIGTERM";
      return { exitCode: 143 };
    },
    captureFailureArtifacts() {},
  });

  const manifest = JSON.parse(readFileSync(runner.resultPath, "utf8"));
  const ownership = readRunOwnership(
    path.join(runDirectory, "attempt-1", "run-ownership.json"),
  );
  assert.equal(runner.exitCode, 143);
  assert.equal(manifest.result, "cancelled");
  assert.equal(manifest.phaseResults.length, 1);
  assert.equal(ownership.roots[0].cleanup.state, "removed");
  assert.equal(existsSync(roots[0]), false);
  assert.equal(existsSync(foreignRoot), true);
});
