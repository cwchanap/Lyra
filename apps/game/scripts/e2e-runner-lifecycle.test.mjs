import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cleanupOwnedE2eRoots,
  createChildSupervisor,
  createRunOwnership,
  readRunOwnership,
  runE2eAttempt,
  runE2eRunner,
} from "./e2e-runner-lifecycle.mjs";
import { createSaveE2eAppDataDir } from "./save-e2e-paths.mjs";
import * as x11 from "./e2e-x11-trusted-input.mjs";

const holders = [];

function holder(prefix = "lyra-e2e-runner-test-") {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  holders.push(directory);
  return directory;
}

function authorityFixture(display = "99") {
  const field = (value) => {
    const bytes = Buffer.from(value);
    const length = Buffer.alloc(2);
    length.writeUInt16BE(bytes.length);
    return Buffer.concat([length, bytes]);
  };
  return Buffer.concat([
    Buffer.from([1, 0]),
    field("host"),
    field(display),
    field("MIT-MAGIC-COOKIE-1"),
    field(Buffer.alloc(16, 1)),
  ]);
}

function claimPathFor(xauthority) {
  const key = createHash("sha256")
    .update(path.resolve(xauthority))
    .digest("hex");
  return path.join(
    realpathSync(userInfo().homedir),
    ".cache",
    "lyra-e2e-x11-claims",
    `.lyra-e2e-x11-claim-${key}.json`,
  );
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
  let clockMs = 1_000;
  const runner = await runE2eRunner({
    suiteIds: ["smoke"],
    attempts: 2,
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
      clockMs += attempt === 1 ? 40 : 30;
      return { exitCode: attempt === 1 ? 23 : 0 };
    },
    captureFailureArtifacts(details) {
      captured.push(details);
      assert.equal(existsSync(details.phase.appDataDir), true);
    },
    nowMs: () => clockMs,
  });

  assert.equal(runner.exitCode, 0);
  assert.equal(runner.result.schemaVersion, 2);
  assert.deepEqual(runner.result.selectedSuites, ["smoke"]);
  assert.equal(runner.result.runnerWallTimeMs, 70);
  assert.equal(runner.result.testOnlyTimeMs, 70);
  assert.deepEqual(runner.result.attempts, {
    configured: 2,
    used: 2,
    retries: 1,
  });
  assert.deepEqual(runner.result.firstAttemptFailures, [
    { phase: "ordinary", suite: "smoke", exitCode: 23 },
  ]);
  assert.deepEqual(runner.result.recoveredFlakes, ["smoke"]);
  assert.equal(runner.result.finalFailedSuite, null);
  assert.equal(runner.result.phaseCount, 2);
  assert.equal(runner.result.processCount, 2);
  assert.deepEqual(runner.result.cleanup, {
    state: "removed",
    attempts: [
      { attempt: 1, state: "removed" },
      { attempt: 2, state: "removed" },
    ],
  });
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

test("a claimed display is never retried after a worker failure", async () => {
  let calls = 0;
  const runner = await runE2eRunner({
    suiteIds: ["gameplay"],
    attempts: 2,
    runDirectory: holder(),
    supervisor: { cancelledSignal: null },
    claimDisplay: async () => {},
    runGuard: async () => ({ exitCode: 0 }),
    rootKeys: ["gameplay"],
    createRoot: createSaveE2eAppDataDir,
    buildPhasePlan(_suiteIds, directories) {
      return [
        { id: "ordinary", root: "gameplay", appDataDir: directories.gameplay },
      ];
    },
    suiteForPhase: () => "gameplay",
    applyCheckpoint() {},
    async runPhase() {
      calls += 1;
      return { exitCode: 1 };
    },
    captureFailureArtifacts() {},
  });
  assert.notEqual(runner.exitCode, 0);
  assert.equal(runner.result.attempts.used, 1);
  assert.equal(calls, 1);
});

test("a claimed display can retry a cleaned-up failure before any worker starts", async () => {
  let allocations = 0;
  let phaseCalls = 0;
  const runner = await runE2eRunner({
    suiteIds: ["gameplay"],
    attempts: 2,
    runDirectory: holder(),
    supervisor: { cancelledSignal: null },
    claimDisplay: async () => {},
    runGuard: async () => ({ exitCode: 0 }),
    rootKeys: ["gameplay"],
    createRoot() {
      allocations += 1;
      if (allocations === 1)
        throw new Error("temporary root allocation failure");
      return createSaveE2eAppDataDir();
    },
    buildPhasePlan(_suiteIds, directories) {
      return [
        { id: "ordinary", root: "gameplay", appDataDir: directories.gameplay },
      ];
    },
    suiteForPhase: () => "gameplay",
    applyCheckpoint() {},
    async runPhase() {
      phaseCalls += 1;
      return { exitCode: 0 };
    },
    captureFailureArtifacts() {},
  });
  assert.equal(runner.exitCode, 0);
  assert.equal(runner.result.attempts.used, 2);
  assert.equal(allocations, 2);
  assert.equal(phaseCalls, 1);
});

test("a claimed display does not retry an uncertain launched or unknown attempt", async () => {
  for (const mode of ["phase-throws", "unknown-attempt"]) {
    let calls = 0;
    const runner = await runE2eRunner({
      suiteIds: ["gameplay"],
      attempts: 2,
      runDirectory: holder(),
      supervisor: { cancelledSignal: null },
      claimDisplay: async () => {},
      runGuard: async () => ({ exitCode: 0 }),
      rootKeys: ["gameplay"],
      createRoot: createSaveE2eAppDataDir,
      buildPhasePlan(_suiteIds, directories) {
        return [
          {
            id: "ordinary",
            root: "gameplay",
            appDataDir: directories.gameplay,
          },
        ];
      },
      suiteForPhase: () => "gameplay",
      applyCheckpoint() {},
      async runPhase() {
        calls += 1;
        throw new Error("uncertain phase failure");
      },
      captureFailureArtifacts() {},
      ...(mode === "unknown-attempt"
        ? {
            async runAttempt() {
              calls += 1;
              return 1;
            },
          }
        : {}),
    });
    assert.notEqual(runner.exitCode, 0);
    assert.equal(calls, 1);
  }
});

test("a pre-launch failure cannot retry if the ledger is unsafe", async () => {
  const runDirectory = holder();
  let allocations = 0;
  const runner = await runE2eRunner({
    suiteIds: ["gameplay"],
    attempts: 2,
    runDirectory,
    supervisor: { cancelledSignal: null },
    claimDisplay: async () => {},
    runGuard: async () => ({ exitCode: 0 }),
    rootKeys: ["gameplay"],
    createRoot() {
      allocations += 1;
      writeFileSync(
        path.join(runDirectory, "x11-pointer-state.json"),
        JSON.stringify({ status: "possible", button: "click" }),
      );
      throw new Error("root allocation failed with unsafe ledger");
    },
    buildPhasePlan: () => [{ id: "ordinary", root: "gameplay" }],
    suiteForPhase: () => "gameplay",
    applyCheckpoint() {},
    runPhase: async () => ({ exitCode: 0 }),
    captureFailureArtifacts() {},
  });
  assert.notEqual(runner.exitCode, 0);
  assert.equal(runner.result.displayPoisoned, true);
  assert.equal(runner.result.attempts.used, 1);
  assert.equal(allocations, 1);
});

test("runner refuses later phases and retries when a pointer press may remain held", async () => {
  const runDirectory = holder();
  const phases = [];
  const runner = await runE2eRunner({
    suiteIds: ["gameplay"],
    attempts: 2,
    runDirectory,
    supervisor: { cancelledSignal: null },
    runGuard: async () => ({ exitCode: 0 }),
    rootKeys: ["gameplay"],
    createRoot: createSaveE2eAppDataDir,
    buildPhasePlan(_suiteIds, directories) {
      return [
        { id: "ordinary", root: "gameplay", appDataDir: directories.gameplay },
        { id: "later", root: "gameplay", appDataDir: directories.gameplay },
      ];
    },
    suiteForPhase: () => "gameplay",
    applyCheckpoint() {},
    async runPhase(phase) {
      phases.push(phase.id);
      writeFileSync(
        path.join(runDirectory, "x11-pointer-state.json"),
        JSON.stringify({ status: "possible", button: "click" }),
      );
      return { exitCode: 0 };
    },
    captureFailureArtifacts() {},
  });

  assert.notEqual(runner.exitCode, 0);
  assert.deepEqual(phases, ["ordinary"]);
  assert.equal(runner.result.attempts.used, 1);
  assert.equal(runner.result.displayPoisoned, true);
});

test("runner treats a missing or corrupt pointer state as unsafe even after a child error", async () => {
  for (const mode of ["missing", "corrupt"]) {
    const runDirectory = holder();
    let calls = 0;
    const runner = await runE2eRunner({
      suiteIds: ["gameplay"],
      attempts: 2,
      runDirectory,
      supervisor: { cancelledSignal: null },
      runGuard: async () => ({ exitCode: 0 }),
      rootKeys: ["gameplay"],
      createRoot: createSaveE2eAppDataDir,
      buildPhasePlan(_suiteIds, directories) {
        return [
          {
            id: "ordinary",
            root: "gameplay",
            appDataDir: directories.gameplay,
          },
        ];
      },
      suiteForPhase: () => "gameplay",
      applyCheckpoint() {},
      async runPhase() {
        calls += 1;
        const statePath = path.join(runDirectory, "x11-pointer-state.json");
        if (mode === "missing") rmSync(statePath);
        else writeFileSync(statePath, "not-json");
        throw new Error("worker stopped");
      },
      captureFailureArtifacts() {},
    });
    assert.notEqual(runner.exitCode, 0);
    assert.equal(runner.result.displayPoisoned, true);
    assert.equal(runner.result.attempts.used, 1);
    assert.equal(calls, 1);
  }
});

test("outer runner refuses success or retry when an attempt leaves X11 state unsafe", async () => {
  const runDirectory = holder();
  let attempts = 0;
  const runner = await runE2eRunner({
    suiteIds: ["gameplay"],
    attempts: 2,
    runDirectory,
    supervisor: { cancelledSignal: null },
    runGuard: async () => ({ exitCode: 0 }),
    rootKeys: ["gameplay"],
    createRoot: createSaveE2eAppDataDir,
    buildPhasePlan: () => [],
    suiteForPhase: () => "gameplay",
    applyCheckpoint() {},
    runPhase: async () => ({ exitCode: 0 }),
    captureFailureArtifacts() {},
    async runAttempt({ pointerStatePath }) {
      attempts += 1;
      writeFileSync(
        pointerStatePath,
        JSON.stringify({ status: "held", button: "click" }),
      );
      return 0;
    },
  });
  assert.notEqual(runner.exitCode, 0);
  assert.equal(runner.result.displayPoisoned, true);
  assert.equal(attempts, 1);
});

test(
  "a second runner cannot reuse the same live Xvfb after a poisoned run",
  { skip: process.platform !== "linux" },
  async () => {
    const identityDirectory = holder("lyra-xvfb-identity-");
    const xauthority = path.join(identityDirectory, "Xauthority");
    writeFileSync(xauthority, authorityFixture(), { mode: 0o600 });
    holders.push(claimPathFor(xauthority));
    let phaseCalls = 0;
    const invokeRunner = (poison) =>
      runE2eRunner({
        suiteIds: ["gameplay"],
        attempts: 2,
        runDirectory: holder(),
        supervisor: { cancelledSignal: null },
        claimDisplay: ({ pointerStatePath }) =>
          x11.claimXvfbDisplay({
            xauthority,
            display: ":99",
            xvfbPid: 25,
            xvfbRunPid: 20,
            xvfbStart: "12345",
            runnerPid: process.pid,
            pointerStatePath,
          }),
        runGuard: async () => ({ exitCode: 0 }),
        rootKeys: ["gameplay"],
        createRoot: createSaveE2eAppDataDir,
        buildPhasePlan(_suiteIds, directories) {
          return [
            {
              id: "ordinary",
              root: "gameplay",
              appDataDir: directories.gameplay,
            },
          ];
        },
        suiteForPhase: () => "gameplay",
        applyCheckpoint() {},
        async runPhase(_phase, { pointerStatePath }) {
          phaseCalls += 1;
          if (poison) {
            writeFileSync(
              pointerStatePath,
              JSON.stringify({ status: "possible", button: "click" }),
            );
          }
          return { exitCode: 0 };
        },
        captureFailureArtifacts() {},
      });
    const first = await invokeRunner(true);
    const second = await invokeRunner(false);
    assert.notEqual(first.exitCode, 0);
    assert.equal(first.result.displayPoisoned, true);
    assert.notEqual(second.exitCode, 0);
    assert.equal(second.result.attempts.used, 0);
    assert.equal(phaseCalls, 1);
  },
);

test(
  "independent runner processes cannot reclaim a poisoned display",
  { skip: process.platform !== "linux" },
  () => {
    const authorityDirectory = holder("lyra-xvfb-process-");
    const freshDirectory = holder("lyra-xvfb-process-fresh-");
    for (const directory of [authorityDirectory, freshDirectory]) {
      writeFileSync(path.join(directory, "Xauthority"), authorityFixture(), {
        mode: 0o600,
      });
      holders.push(claimPathFor(path.join(directory, "Xauthority")));
    }
    const lifecycleUrl = new URL("./e2e-runner-lifecycle.mjs", import.meta.url)
      .href;
    const x11Url = new URL("./e2e-x11-trusted-input.mjs", import.meta.url).href;
    const script = `
    import { writeFileSync } from "node:fs";
    import { runE2eRunner } from ${JSON.stringify(lifecycleUrl)};
    import { claimXvfbDisplay } from ${JSON.stringify(x11Url)};
    const result = await runE2eRunner({
      suiteIds: ["gameplay"], attempts: 2, runDirectory: process.env.TEST_RUN_DIR,
      supervisor: { cancelledSignal: null }, runGuard: async () => ({ exitCode: 0 }),
      claimDisplay: ({ pointerStatePath }) => claimXvfbDisplay({
        xauthority: process.env.TEST_AUTH, display: ":99", xvfbPid: 25,
        xvfbRunPid: 20, xvfbStart: "12345", runnerPid: process.pid, pointerStatePath,
      }),
      rootKeys: [], createRoot() {}, buildPhasePlan: () => [], suiteForPhase() {},
      applyCheckpoint() {}, runPhase() {}, captureFailureArtifacts() {},
      async runAttempt({ pointerStatePath }) {
        if (process.env.TEST_POISON === "1")
          writeFileSync(pointerStatePath, JSON.stringify({ status: "possible", button: "click" }));
        return 0;
      },
    });
    console.log(JSON.stringify({ exitCode: result.exitCode, ...result.result }));
  `;
    const invoke = (directory, poison) => {
      const child = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", script],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            TEST_AUTH: path.join(directory, "Xauthority"),
            TEST_RUN_DIR: holder(),
            TEST_POISON: poison ? "1" : "0",
          },
        },
      );
      assert.equal(child.status, 0, child.stderr);
      return JSON.parse(child.stdout.trim());
    };
    const first = invoke(authorityDirectory, true);
    const second = invoke(authorityDirectory, false);
    const fresh = invoke(freshDirectory, false);
    assert.equal(first.displayPoisoned, true);
    assert.notEqual(first.exitCode, 0);
    assert.notEqual(second.exitCode, 0);
    assert.equal(second.attempts.used, 0);
    assert.equal(fresh.exitCode, 0);
  },
);

test("runner applies an external mutation before starting its fresh discovery child", async () => {
  const runDirectory = holder();
  const roots = [];
  const events = [];
  await runE2eRunner({
    suiteIds: ["save-management"],
    attempts: 1,
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
    attempts: 1,
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
  assert.equal(manifest.finalFailedSuite, null);
  assert.deepEqual(manifest.recoveredFlakes, []);
  assert.deepEqual(manifest.cleanup, {
    state: "removed",
    attempts: [{ attempt: 1, state: "removed" }],
  });
  assert.equal(manifest.phaseResults.length, 1);
  assert.equal(ownership.roots[0].cleanup.state, "removed");
  assert.equal(existsSync(roots[0]), false);
  assert.equal(existsSync(foreignRoot), true);
});

test("cleanup failure fails the runner without blaming the last passing suite", async () => {
  const runDirectory = holder();
  const roots = [];
  const runner = await runE2eRunner({
    suiteIds: ["smoke"],
    attempts: 1,
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
      return [{ id: "smoke", root: "smoke", appDataDir: directories.smoke }];
    },
    suiteForPhase: () => "smoke",
    applyCheckpoint() {},
    createOutputDirectory: () => runDirectory,
    async runPhase() {
      return { exitCode: 0 };
    },
    captureFailureArtifacts() {},
    runAttempt: (options) =>
      runE2eAttempt({
        ...options,
        cleanupRoots() {
          throw new Error("cleanup blocked");
        },
      }),
  });

  assert.equal(runner.exitCode, 1);
  assert.equal(runner.result.result, "failed");
  assert.equal(runner.result.finalFailedSuite, null);
  assert.equal(runner.result.cleanup.state, "failed");
  holders.push(...roots);
});

test("cleanup failure is terminal and cannot be retried into a pass", async () => {
  const runDirectory = holder();
  const roots = [];
  let attemptCalls = 0;
  const runner = await runE2eRunner({
    suiteIds: ["smoke"],
    attempts: 2,
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
      return [{ id: "smoke", root: "smoke", appDataDir: directories.smoke }];
    },
    suiteForPhase: () => "smoke",
    applyCheckpoint() {},
    createOutputDirectory: () => runDirectory,
    async runPhase() {
      return { exitCode: 0 };
    },
    captureFailureArtifacts() {},
    runAttempt: (options) => {
      attemptCalls += 1;
      return runE2eAttempt({
        ...options,
        cleanupRoots() {
          throw new Error("cleanup blocked");
        },
      });
    },
  });

  assert.equal(runner.exitCode, 1);
  assert.equal(runner.result.result, "failed");
  assert.equal(attemptCalls, 1);
  assert.deepEqual(runner.result.attempts, {
    configured: 2,
    used: 1,
    retries: 0,
  });
  assert.deepEqual(runner.result.cleanup, {
    state: "failed",
    attempts: [{ attempt: 1, state: "failed" }],
  });
  holders.push(...roots);
});

test("cleanup surfaces an ownership-recorded rollback failure instead of reporting removal", () => {
  const runDirectory = holder();
  const ownershipPath = path.join(runDirectory, "run-ownership.json");
  const roots = [];
  const createRoot = () => {
    const root = createSaveE2eAppDataDir();
    roots.push(root);
    return root;
  };

  assert.throws(
    () =>
      createRunOwnership({
        ownershipPath,
        runId: "rollback-failed",
        rootKeys: ["smoke"],
        createRoot,
        writeRootMarker() {
          throw new Error("marker failed");
        },
        removeRoot() {
          throw new Error("rollback blocked");
        },
      }),
    /marker failed/,
  );
  holders.push(...roots);

  const recorded = readRunOwnership(ownershipPath);
  assert.equal(recorded.roots[0].cleanup.state, "failed");
  assert.equal(recorded.roots[0].cleanup.message, "rollback blocked");
  assert.equal(existsSync(roots[0]), true);

  assert.throws(
    () => cleanupOwnedE2eRoots(ownershipPath),
    /cleanup already failed: rollback blocked/,
  );
  assert.equal(
    readRunOwnership(ownershipPath).roots[0].cleanup.state,
    "failed",
  );
  assert.equal(existsSync(roots[0]), true);
});

test("failed ownership rollback is terminal and cannot be retried into a pass", async () => {
  const runDirectory = holder();
  const roots = [];
  let attemptCalls = 0;
  const runner = await runE2eRunner({
    suiteIds: ["smoke"],
    attempts: 2,
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
      return [{ id: "smoke", root: "smoke", appDataDir: directories.smoke }];
    },
    suiteForPhase: () => "smoke",
    applyCheckpoint() {},
    createOutputDirectory: () => runDirectory,
    async runPhase() {
      return { exitCode: 0 };
    },
    captureFailureArtifacts() {},
    runAttempt: (options) => {
      attemptCalls += 1;
      return runE2eAttempt({
        ...options,
        createOwnership(details) {
          return createRunOwnership({
            ...details,
            writeRootMarker() {
              throw new Error("marker failed");
            },
            removeRoot() {
              throw new Error("rollback blocked");
            },
          });
        },
      });
    },
  });

  assert.equal(runner.exitCode, 1);
  assert.equal(runner.result.result, "failed");
  assert.equal(attemptCalls, 1);
  assert.deepEqual(runner.result.attempts, {
    configured: 2,
    used: 1,
    retries: 0,
  });
  assert.deepEqual(runner.result.firstAttemptFailures, [
    { phase: "smoke", suite: "smoke", exitCode: 1 },
  ]);
  assert.deepEqual(runner.result.cleanup, {
    state: "failed",
    attempts: [{ attempt: 1, state: "failed" }],
  });
  const ownership = readRunOwnership(
    path.join(runDirectory, "attempt-1", "run-ownership.json"),
  );
  assert.equal(ownership.roots[0].cleanup.state, "failed");
  assert.equal(existsSync(roots[0]), true);
  holders.push(...roots);
});

test("ownership allocation failure is a retryable attempt failure", async () => {
  const runDirectory = holder();
  const roots = [];
  let ownershipCalls = 0;
  const runner = await runE2eRunner({
    suiteIds: ["smoke"],
    attempts: 2,
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
      return [{ id: "smoke", root: "smoke", appDataDir: directories.smoke }];
    },
    suiteForPhase: () => "smoke",
    applyCheckpoint() {},
    createOutputDirectory: () => runDirectory,
    async runPhase() {
      return { exitCode: 0 };
    },
    captureFailureArtifacts() {},
    runAttempt: (options) =>
      runE2eAttempt({
        ...options,
        createOwnership(details) {
          ownershipCalls += 1;
          if (ownershipCalls === 1)
            throw new Error("ownership allocation failed");
          return createRunOwnership(details);
        },
      }),
  });

  assert.equal(runner.exitCode, 0);
  assert.equal(runner.result.result, "passed");
  assert.deepEqual(runner.result.attempts, {
    configured: 2,
    used: 2,
    retries: 1,
  });
  assert.deepEqual(runner.result.firstAttemptFailures, [
    { phase: "smoke", suite: "smoke", exitCode: 1 },
  ]);
  assert.deepEqual(runner.result.recoveredFlakes, ["smoke"]);
  assert.equal(runner.result.phaseCount, 1);
  for (const root of roots) assert.equal(existsSync(root), false);
});
