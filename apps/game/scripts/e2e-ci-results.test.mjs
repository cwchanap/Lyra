import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeE2eCiResults } from "./e2e-ci-results.mjs";
import {
  createRunOwnership,
  runE2eAttempt,
  runE2eRunner,
} from "./e2e-runner-lifecycle.mjs";

const FIXTURE_START_MS = Date.parse("2026-08-02T00:00:00.000Z");

function fixtureTimestamp(step) {
  return new Date(FIXTURE_START_MS + step * 1_000).toISOString();
}

const PHASES_BY_SUITE = {
  smoke: ["smoke"],
  gameplay: ["ordinary"],
  "production-journey": ["production-journey"],
  "capture-proof": ["capture-proof"],
  "save-core": ["save-seed", "save-resume"],
  "save-management": [
    "management-seed",
    "management-corrupt-newest",
    "management-missing-thumbnail",
    "management-corrupt-thumbnail",
  ],
  "exit-lifecycle": [
    "exit-close-seed",
    "exit-close-resume",
    "exit-quit-resume",
    "exit-failure-bypass",
    "exit-final-verification",
  ],
};

const ROOT_BY_PHASE = {
  smoke: "smoke",
  ordinary: "gameplay",
  "production-journey": "productionJourney",
  "capture-proof": "capture",
  "save-seed": "persistence",
  "save-resume": "persistence",
  "management-seed": "persistence",
  "management-corrupt-newest": "persistence",
  "management-missing-thumbnail": "persistence",
  "management-corrupt-thumbnail": "persistence",
  "exit-close-seed": "exit",
  "exit-close-resume": "exit",
  "exit-quit-resume": "exit",
  "exit-failure-bypass": "exit",
  "exit-final-verification": "exit",
};

function outputDirectoryFor(chainId, attempt, phase) {
  return path.join(
    os.tmpdir(),
    `${chainId}-run`,
    "outputs",
    `attempt-${attempt}`,
    ROOT_BY_PHASE[phase],
    phase,
  );
}

function plan({
  suites,
  chains,
  risk = suites,
  forcedFull = false,
  reason = null,
}) {
  return {
    suiteIds: suites,
    skip: suites.length === 0,
    expectedChainIds: chains.map(({ chainId }) => chainId),
    matrix: { include: chains },
    planner: {
      schemaVersion: 1,
      riskSelectedSuites: risk,
      forcedFull,
      reason,
    },
  };
}

function result({
  chainId,
  suites,
  risk = suites,
  forcedFull = false,
  reason = null,
  terminal = "passed",
  finalFailedSuite = null,
  firstAttemptFailures = [],
  recoveredFlakes = [],
  cleanupState = "removed",
}) {
  const finalAttempt = recoveredFlakes.length > 0 ? 2 : 1;
  let finalPhases = suites.flatMap((suite) =>
    PHASES_BY_SUITE[suite].map((phase, index) => ({
      phase,
      suite,
      attempt: finalAttempt,
      durationMs: 100 + index,
      result: "passed",
      exitCode: 0,
      start: "2026-08-02T00:00:00.000Z",
      finish: "2026-08-02T00:00:01.000Z",
      outputDirectory: outputDirectoryFor(chainId, finalAttempt, phase),
    })),
  );
  if (terminal === "failed") {
    const failedIndex = finalPhases.findIndex(
      ({ suite }) => suite === finalFailedSuite,
    );
    if (failedIndex >= 0) {
      finalPhases = finalPhases.slice(0, failedIndex + 1);
      finalPhases.at(-1).result = "failed";
      finalPhases.at(-1).exitCode = 1;
    }
  } else if (terminal === "cancelled" && finalPhases.length > 0) {
    finalPhases.at(-1).result = "failed";
    finalPhases.at(-1).exitCode = 143;
  }
  const recordedFirstAttemptFailures =
    finalAttempt > 1
      ? firstAttemptFailures
      : finalPhases.at(-1)?.result === "failed"
        ? [
            {
              phase: finalPhases.at(-1).phase,
              suite: finalPhases.at(-1).suite,
              exitCode: finalPhases.at(-1).exitCode,
            },
          ]
        : [];
  const phaseResults = [
    ...(finalAttempt > 1 ? firstAttemptFailures : []).map((failure, index) => ({
      ...failure,
      attempt: 1,
      durationMs: 50 + index,
      result: "failed",
      start: "2026-08-02T00:00:00.000Z",
      finish: "2026-08-02T00:00:01.000Z",
      outputDirectory: outputDirectoryFor(chainId, 1, failure.phase),
    })),
    ...finalPhases,
  ].map((phaseResult, index) => ({
    ...phaseResult,
    start: fixtureTimestamp(index),
    finish: fixtureTimestamp(index + 1),
  }));
  return {
    schemaVersion: 2,
    runId: `${chainId}-run`,
    chainId,
    selectedSuites: suites,
    riskSelectedSuites: risk,
    forcedFull,
    reason,
    phase: phaseResults.at(-1)?.phase ?? null,
    suite: phaseResults.at(-1)?.suite ?? null,
    attempt: finalAttempt,
    durationMs: phaseResults.at(-1)?.durationMs ?? 0,
    runnerWallTimeMs:
      phaseResults.reduce(
        (total, phaseResult) => total + phaseResult.durationMs,
        0,
      ) + 100,
    testOnlyTimeMs: phaseResults.reduce(
      (total, phaseResult) => total + phaseResult.durationMs,
      0,
    ),
    result: terminal,
    exitCode: terminal === "passed" ? 0 : terminal === "cancelled" ? 143 : 1,
    attempts: {
      configured: recoveredFlakes.length > 0 ? 2 : 1,
      used: recoveredFlakes.length > 0 ? 2 : 1,
      retries: recoveredFlakes.length > 0 ? 1 : 0,
    },
    firstAttemptFailures: recordedFirstAttemptFailures,
    recoveredFlakes,
    finalFailedSuite,
    phaseCount: phaseResults.length,
    processCount: phaseResults.length,
    cleanup: {
      state: cleanupState,
      attempts: Array.from({ length: finalAttempt }, (_, index) => ({
        attempt: index + 1,
        state: cleanupState,
      })),
    },
    start: fixtureTimestamp(0),
    finish: fixtureTimestamp(Math.max(phaseResults.length, 1)),
    phaseResults,
  };
}

const smokeChain = {
  chainId: "gameplay",
  suiteIds: ["smoke"],
  suiteFile: "chains/gameplay-suites.json",
  cacheKey: "tauri-e2e-gameplay-v1",
  timeoutMinutes: 8,
  artifactName: "tauri-e2e-gameplay",
};

async function produceSmokeResult({
  suiteIds = ["smoke"],
  phasePlan = suiteIds.flatMap((suite) =>
    PHASES_BY_SUITE[suite].map((id) => ({
      id,
      root: ROOT_BY_PHASE[id],
      suite,
    })),
  ),
  attempts = 1,
  supervisor = { cancelledSignal: null },
  guardExitCode = 0,
  runGuard = async () => ({ exitCode: guardExitCode }),
  applyCheckpoint = () => {},
  cleanupRoots = () => {},
  runPhase = async () => ({ exitCode: 0 }),
  ownershipMode = "stub",
  createRoot = () => path.join(os.tmpdir(), "unused-root"),
} = {}) {
  const runDirectory = mkdtempSync(
    path.join(os.tmpdir(), "lyra-e2e-producer-result-"),
  );
  try {
    const runner = await runE2eRunner({
      chainId: "gameplay",
      suiteIds,
      riskSelectedSuites: suiteIds,
      attempts,
      forcedFull: false,
      plannerReason: null,
      runDirectory,
      supervisor,
      runGuard,
      rootKeys: [...new Set(phasePlan.map(({ root }) => root))],
      createRoot,
      buildPhasePlan: (_suiteIds, directories) =>
        phasePlan.map(({ id, root }) => ({
          id,
          root,
          appDataDir: directories[root],
        })),
      suiteForPhase: (phaseId) =>
        phasePlan.find(({ id }) => id === phaseId).suite,
      applyCheckpoint,
      runPhase,
      captureFailureArtifacts() {},
      runAttempt: (options) =>
        runE2eAttempt({
          ...options,
          ...(ownershipMode === "stub"
            ? {
                createOwnership: ({ rootKeys }) => {
                  return {
                    roots: rootKeys.map((key) => ({
                      key,
                      appDataDir: path.join(runDirectory, key),
                    })),
                  };
                },
                cleanupRoots,
                rootByKey: (ownership, key) =>
                  ownership.roots.find((root) => root.key === key).appDataDir,
              }
            : ownershipMode === "no-manifest"
              ? {
                  createOwnership: (ownershipOptions) =>
                    createRunOwnership({
                      ...ownershipOptions,
                      writeOwnership() {
                        throw new Error("initial ownership write blocked");
                      },
                    }),
                }
              : {}),
        }),
    });
    return structuredClone(runner.result);
  } finally {
    rmSync(runDirectory, { recursive: true, force: true });
  }
}

test("accepts a complete smoke-only matrix", () => {
  const analysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [result({ chainId: "gameplay", suites: ["smoke"] })],
  });

  assert.equal(analysis.status, "passed");
  assert.deepEqual(analysis.errors, []);
  assert.deepEqual(analysis.expectedChainIds, ["gameplay"]);
});

test("accepts a producer retry after setup fails before a phase result exists", async () => {
  let checkpointCalls = 0;
  const produced = await produceSmokeResult({
    attempts: 2,
    applyCheckpoint() {
      checkpointCalls += 1;
      if (checkpointCalls === 1) throw new Error("checkpoint setup failed");
    },
  });
  assert.deepEqual(produced.firstAttemptFailures, [
    { phase: "smoke", suite: "smoke", exitCode: 1 },
  ]);
  assert.deepEqual(produced.recoveredFlakes, ["smoke"]);
  assert.deepEqual(
    produced.phaseResults.map(({ attempt, result: phaseResult }) => ({
      attempt,
      result: phaseResult,
    })),
    [{ attempt: 2, result: "passed" }],
  );

  const analysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [produced],
  });
  assert.equal(analysis.status, "passed");
  assert.deepEqual(analysis.errors, []);
  assert.deepEqual(analysis.routingAudit.recoveredFlakes, [
    { chainId: "gameplay", suite: "smoke" },
  ]);
});

test("accepts a producer pre-phase cancellation as structurally valid", async () => {
  const produced = await produceSmokeResult({
    supervisor: { cancelledSignal: "SIGTERM" },
  });
  assert.equal(produced.result, "cancelled");
  assert.deepEqual(produced.phaseResults, []);

  const analysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [produced],
  });
  assert.equal(analysis.status, "failed");
  assert.equal(
    analysis.errors.some(({ code }) => code === "cancelled-chain"),
    true,
  );
  assert.equal(
    analysis.errors.some(({ code }) => code === "malformed-chain"),
    false,
  );
});

test("recognizes a producer cleanup-triggered retry without inventing a phase failure", async () => {
  let cleanupCalls = 0;
  const produced = await produceSmokeResult({
    attempts: 2,
    cleanupRoots() {
      cleanupCalls += 1;
      if (cleanupCalls === 1) throw new Error("cleanup blocked");
    },
  });
  assert.equal(produced.result, "passed");
  assert.deepEqual(
    produced.phaseResults.map(({ attempt, result: phaseResult }) => ({
      attempt,
      result: phaseResult,
    })),
    [
      { attempt: 1, result: "passed" },
      { attempt: 2, result: "passed" },
    ],
  );
  assert.deepEqual(produced.cleanup, {
    state: "failed",
    attempts: [
      { attempt: 1, state: "failed" },
      { attempt: 2, state: "removed" },
    ],
  });

  const analysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [produced],
  });
  assert.equal(analysis.status, "failed");
  assert.equal(
    analysis.errors.some(({ code }) => code === "cleanup-failed"),
    true,
  );
  assert.equal(
    analysis.errors.some(({ code }) => code === "malformed-chain"),
    false,
  );
});

test("accepts the producer binary-guard failure shape only as an operational failure", async () => {
  const produced = await produceSmokeResult({ guardExitCode: 17 });
  assert.deepEqual(produced.attempts, {
    configured: 1,
    used: 0,
    retries: 0,
  });
  assert.deepEqual(produced.cleanup, { state: "not-required", attempts: [] });
  assert.equal(produced.phase, "binary-guard");

  const analysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [produced],
  });
  assert.equal(analysis.status, "failed");
  assert.deepEqual(
    analysis.errors.map(({ code }) => code),
    ["failed-chain"],
  );
});

test("accepts producer cancellation during the binary guard", async () => {
  const produced = await produceSmokeResult({
    guardExitCode: 143,
    supervisor: { cancelledSignal: "SIGTERM" },
  });
  assert.equal(produced.result, "cancelled");
  assert.equal(produced.phase, "binary-guard");
  assert.deepEqual(produced.attempts, {
    configured: 1,
    used: 0,
    retries: 0,
  });
  assert.deepEqual(produced.cleanup, { state: "not-required", attempts: [] });

  const analysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [produced],
  });
  assert.equal(analysis.status, "failed");
  assert.deepEqual(
    analysis.errors.map(({ code }) => code),
    ["cancelled-chain"],
  );
});

test("accepts producer guard invocation rejection with or without cancellation", async () => {
  const failed = await produceSmokeResult({
    runGuard: async () => {
      throw new Error("guard invocation rejected");
    },
  });
  assert.equal(failed.result, "failed");
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.phase, null);
  assert.deepEqual(failed.attempts, {
    configured: 1,
    used: 0,
    retries: 0,
  });
  assert.deepEqual(failed.cleanup, { state: "not-required", attempts: [] });

  const supervisor = { cancelledSignal: null };
  const cancelled = await produceSmokeResult({
    supervisor,
    runGuard: async () => {
      supervisor.cancelledSignal = "SIGINT";
      throw new Error("guard invocation cancelled");
    },
  });
  assert.equal(cancelled.result, "cancelled");
  assert.equal(cancelled.exitCode, 130);
  assert.equal(cancelled.phase, null);
  assert.deepEqual(cancelled.attempts, {
    configured: 1,
    used: 0,
    retries: 0,
  });

  for (const produced of [failed, cancelled]) {
    const analysis = analyzeE2eCiResults({
      plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
      results: [produced],
    });
    assert.equal(analysis.status, "failed");
    assert.equal(
      analysis.errors.some(({ code }) => code === "malformed-chain"),
      false,
    );
  }

  const malformed = structuredClone(failed);
  malformed.exitCode = 2;
  const malformedAnalysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [malformed],
  });
  assert.equal(
    malformedAnalysis.errors.some(({ code }) => code === "malformed-chain"),
    true,
  );
});

test("accepts a cancellation signal that overwrites a failed child exit", async () => {
  const supervisor = { cancelledSignal: null };
  const produced = await produceSmokeResult({
    supervisor,
    runPhase: async () => {
      supervisor.cancelledSignal = "SIGTERM";
      return { exitCode: 23 };
    },
  });
  assert.equal(produced.result, "cancelled");
  assert.equal(produced.exitCode, 143);
  assert.equal(produced.phaseResults[0].exitCode, 23);

  const analysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [produced],
  });
  assert.equal(analysis.status, "failed");
  assert.equal(
    analysis.errors.some(({ code }) => code === "cancelled-chain"),
    true,
  );
  assert.equal(
    analysis.errors.some(({ code }) => code === "malformed-chain"),
    false,
  );
});

test("accepts producer cancellation overlay on an unrecorded setup failure", async () => {
  const supervisor = { cancelledSignal: null };
  const produced = await produceSmokeResult({
    supervisor,
    applyCheckpoint() {
      supervisor.cancelledSignal = "SIGTERM";
      throw new Error("checkpoint failed while cancellation arrived");
    },
  });
  assert.equal(produced.result, "cancelled");
  assert.equal(produced.exitCode, 143);
  assert.equal(produced.phase, "smoke");
  assert.equal(produced.suite, "smoke");
  assert.equal(produced.attempt, 1);
  assert.deepEqual(produced.phaseResults, []);
  assert.deepEqual(produced.firstAttemptFailures, [
    { phase: "smoke", suite: "smoke", exitCode: 1 },
  ]);

  const analysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [produced],
  });
  assert.equal(analysis.status, "failed");
  assert.deepEqual(
    analysis.errors.map(({ code }) => code),
    ["cancelled-chain"],
  );
  assert.deepEqual(analysis.routingAudit.finalFailures, [
    {
      chainId: "gameplay",
      suite: null,
      classification: "indeterminate",
    },
  ]);
});

test("accepts setup cancellation after a recorded canonical phase prefix", async () => {
  const supervisor = { cancelledSignal: null };
  const suites = ["smoke", "gameplay"];
  const produced = await produceSmokeResult({
    suiteIds: suites,
    supervisor,
    applyCheckpoint(phase) {
      if (phase.id !== "ordinary") return;
      supervisor.cancelledSignal = "SIGINT";
      throw new Error("second phase setup cancelled");
    },
  });
  assert.equal(produced.result, "cancelled");
  assert.equal(produced.exitCode, 130);
  assert.deepEqual(
    produced.phaseResults.map(({ phase, result: phaseResult }) => ({
      phase,
      result: phaseResult,
    })),
    [{ phase: "smoke", result: "passed" }],
  );
  assert.equal(produced.phase, "ordinary");
  assert.equal(produced.suite, "gameplay");
  assert.equal(produced.durationMs, produced.phaseResults[0].durationMs);

  const analysis = analyzeE2eCiResults({
    plan: plan({
      suites,
      chains: [{ chainId: "gameplay", suiteIds: suites }],
    }),
    results: [produced],
  });
  assert.deepEqual(
    analysis.errors.map(({ code }) => code),
    ["cancelled-chain"],
  );
  assert.deepEqual(analysis.routingAudit.finalFailures, [
    {
      chainId: "gameplay",
      suite: null,
      classification: "indeterminate",
    },
  ]);
});

test("rejects cancelled terminal exits outside producer signal codes", async () => {
  const supervisor = { cancelledSignal: null };
  const malformed = await produceSmokeResult({
    supervisor,
    runPhase: async () => {
      supervisor.cancelledSignal = "SIGTERM";
      return { exitCode: 23 };
    },
  });
  malformed.exitCode = 17;

  const analysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [malformed],
  });
  assert.equal(analysis.status, "failed");
  assert.equal(
    analysis.errors.some(({ code }) => code === "malformed-chain"),
    true,
  );
  assert.deepEqual(analysis.routingAudit.finalFailures, [
    {
      chainId: "gameplay",
      suite: null,
      classification: "indeterminate",
    },
  ]);
});

test("accepts both producer pre-root ownership manifest lifecycles", async () => {
  const noManifest = await produceSmokeResult({
    ownershipMode: "no-manifest",
  });
  const emptyManifest = await produceSmokeResult({
    ownershipMode: "actual",
    createRoot() {
      throw new Error("ownership allocation blocked after empty manifest");
    },
  });
  assert.deepEqual(noManifest.cleanup, {
    state: "not-required",
    attempts: [],
  });
  assert.deepEqual(emptyManifest.cleanup, {
    state: "removed",
    attempts: [{ attempt: 1, state: "removed" }],
  });

  for (const produced of [noManifest, emptyManifest]) {
    assert.equal(produced.result, "failed");
    assert.equal(produced.exitCode, 1);
    assert.deepEqual(produced.attempts, {
      configured: 1,
      used: 1,
      retries: 0,
    });
    assert.equal(produced.phase, null);
    assert.deepEqual(produced.phaseResults, []);
    const analysis = analyzeE2eCiResults({
      plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
      results: [produced],
    });
    assert.deepEqual(
      analysis.errors.map(({ code }) => code),
      ["failed-chain"],
    );
  }

  const malformed = structuredClone(emptyManifest);
  malformed.exitCode = 2;
  const malformedAnalysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [malformed],
  });
  assert.equal(
    malformedAnalysis.errors.some(({ code }) => code === "malformed-chain"),
    true,
  );

  const malformedCleanup = structuredClone(noManifest);
  malformedCleanup.cleanup = { state: "removed", attempts: [] };
  const malformedCleanupAnalysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [malformedCleanup],
  });
  assert.equal(
    malformedCleanupAnalysis.errors.some(
      ({ code }) => code === "malformed-chain",
    ),
    true,
  );
});

test("rejects a binary-guard manifest with a malformed cleanup container", async () => {
  const malformed = await produceSmokeResult({ guardExitCode: 17 });
  malformed.cleanup.attempts = null;

  const analysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [malformed],
  });
  assert.equal(analysis.status, "failed");
  assert.equal(
    analysis.errors.some(({ code }) => code === "malformed-chain"),
    true,
  );
});

test("rejects attempts-used zero outside the producer binary guard", () => {
  const malformed = result({ chainId: "gameplay", suites: ["smoke"] });
  malformed.attempts = { configured: 1, used: 0, retries: 0 };
  malformed.cleanup = { state: "not-required", attempts: [] };

  const analysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [malformed],
  });
  assert.equal(analysis.status, "failed");
  assert.equal(
    analysis.errors.some(({ code }) => code === "malformed-chain"),
    true,
  );
});

test("accepts persistence-heavy routing only when all three chains are complete", () => {
  const suites = [
    "smoke",
    "capture-proof",
    "save-core",
    "save-management",
    "exit-lifecycle",
  ];
  const chains = [
    smokeChain,
    {
      chainId: "persistence",
      suiteIds: ["capture-proof", "save-core", "save-management"],
    },
    { chainId: "exit", suiteIds: ["exit-lifecycle"] },
  ];
  const analysis = analyzeE2eCiResults({
    plan: plan({ suites, chains }),
    results: [
      result({ chainId: "gameplay", suites: ["smoke"], risk: suites }),
      result({
        chainId: "persistence",
        suites: ["capture-proof", "save-core", "save-management"],
        risk: suites,
      }),
      result({ chainId: "exit", suites: ["exit-lifecycle"], risk: suites }),
    ],
  });

  assert.equal(analysis.status, "passed");
  assert.deepEqual(
    analysis.chains.map(({ chainId, processCount }) => ({
      chainId,
      processCount,
    })),
    [
      { chainId: "gameplay", processCount: 1 },
      { chainId: "persistence", processCount: 7 },
      { chainId: "exit", processCount: 5 },
    ],
  );
});

test("accepts the complete forced-full override matrix", () => {
  const suites = [
    "smoke",
    "gameplay",
    "production-journey",
    "capture-proof",
    "save-core",
    "save-management",
    "exit-lifecycle",
  ];
  const risk = ["smoke"];
  const chains = [
    {
      chainId: "gameplay",
      suiteIds: ["smoke", "gameplay", "production-journey"],
    },
    {
      chainId: "persistence",
      suiteIds: ["capture-proof", "save-core", "save-management"],
    },
    { chainId: "exit", suiteIds: ["exit-lifecycle"] },
  ];
  const analysis = analyzeE2eCiResults({
    plan: plan({
      suites,
      chains,
      risk,
      forcedFull: true,
      reason: "manual-override",
    }),
    results: chains.map(({ chainId, suiteIds }) =>
      result({
        chainId,
        suites: suiteIds,
        risk,
        forcedFull: true,
        reason: "manual-override",
      }),
    ),
  });

  assert.equal(analysis.status, "passed");
  assert.deepEqual(analysis.routingAudit.finalFailures, []);
});

test("fails closed when an expected chain manifest is missing", () => {
  const analysis = analyzeE2eCiResults({
    plan: plan({
      suites: ["smoke", "exit-lifecycle"],
      chains: [smokeChain, { chainId: "exit", suiteIds: ["exit-lifecycle"] }],
    }),
    results: [
      result({
        chainId: "gameplay",
        suites: ["smoke"],
        risk: ["smoke", "exit-lifecycle"],
      }),
    ],
  });

  assert.equal(analysis.status, "failed");
  assert.deepEqual(
    analysis.errors.map(({ code, chainId }) => ({ code, chainId })),
    [{ code: "missing-chain", chainId: "exit" }],
  );
});

test("fails closed on wrong suite ownership", () => {
  const analysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [result({ chainId: "gameplay", suites: ["gameplay"] })],
  });

  assert.equal(analysis.status, "failed");
  assert.equal(
    analysis.errors.some(({ code }) => code === "wrong-suite"),
    true,
  );
});

test("fails closed when a passed chain omits a mandatory final-attempt phase", () => {
  const complete = result({
    chainId: "persistence",
    suites: ["capture-proof", "save-core", "save-management"],
  });
  const phaseResults = complete.phaseResults.filter(
    ({ phase }) => phase !== "management-corrupt-thumbnail",
  );
  const analysis = analyzeE2eCiResults({
    plan: plan({
      suites: ["capture-proof", "save-core", "save-management"],
      chains: [
        {
          chainId: "persistence",
          suiteIds: ["capture-proof", "save-core", "save-management"],
        },
      ],
    }),
    results: [
      {
        ...complete,
        phaseResults,
        phaseCount: phaseResults.length,
        processCount: phaseResults.length,
      },
    ],
  });

  assert.equal(analysis.status, "failed");
  assert.equal(
    analysis.errors.some(({ code }) => code === "incomplete-chain"),
    true,
  );
});

test("fails closed on cancellation", () => {
  const analysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [
      result({
        chainId: "gameplay",
        suites: ["smoke"],
        terminal: "cancelled",
        finalFailedSuite: null,
      }),
    ],
  });

  assert.equal(analysis.status, "failed");
  assert.equal(
    analysis.errors.some(({ code }) => code === "cancelled-chain"),
    true,
  );
  assert.deepEqual(analysis.routingAudit.finalFailures, [
    { chainId: "gameplay", suite: null, classification: "indeterminate" },
  ]);
});

test("counts a recovered first-attempt failure as a flake, not a routing failure", () => {
  const analysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [
      result({
        chainId: "gameplay",
        suites: ["smoke"],
        firstAttemptFailures: [{ phase: "smoke", suite: "smoke", exitCode: 1 }],
        recoveredFlakes: ["smoke"],
      }),
    ],
  });

  assert.equal(analysis.status, "passed");
  assert.deepEqual(analysis.routingAudit.recoveredFlakes, [
    { chainId: "gameplay", suite: "smoke" },
  ]);
  assert.deepEqual(analysis.routingAudit.finalFailures, []);
});

test("classifies a forced-full failure already selected by risk as covered", () => {
  const gameplaySuites = ["smoke", "gameplay", "production-journey"];
  const analysis = analyzeE2eCiResults({
    plan: plan({
      suites: [
        ...gameplaySuites,
        "capture-proof",
        "save-core",
        "save-management",
        "exit-lifecycle",
      ],
      chains: [
        {
          chainId: "gameplay",
          suiteIds: gameplaySuites,
        },
        {
          chainId: "persistence",
          suiteIds: ["capture-proof", "save-core", "save-management"],
        },
        { chainId: "exit", suiteIds: ["exit-lifecycle"] },
      ],
      risk: ["smoke", "gameplay"],
      forcedFull: true,
      reason: "manual-override",
    }),
    results: [
      result({
        chainId: "gameplay",
        suites: gameplaySuites,
        risk: ["smoke", "gameplay"],
        forcedFull: true,
        reason: "manual-override",
        terminal: "failed",
        finalFailedSuite: "gameplay",
      }),
    ],
  });

  assert.equal(analysis.status, "failed");
  assert.deepEqual(
    analysis.routingAudit.finalFailures.find(
      ({ chainId }) => chainId === "gameplay",
    ),
    {
      chainId: "gameplay",
      suite: "gameplay",
      classification: "covered-by-risk-selection",
    },
  );
});

test("classifies a forced-full failure outside risk selection as a routing gap", () => {
  const gameplaySuites = ["smoke", "gameplay", "production-journey"];
  const analysis = analyzeE2eCiResults({
    plan: plan({
      suites: [
        ...gameplaySuites,
        "capture-proof",
        "save-core",
        "save-management",
        "exit-lifecycle",
      ],
      chains: [
        {
          chainId: "gameplay",
          suiteIds: gameplaySuites,
        },
        {
          chainId: "persistence",
          suiteIds: ["capture-proof", "save-core", "save-management"],
        },
        { chainId: "exit", suiteIds: ["exit-lifecycle"] },
      ],
      risk: ["smoke"],
      forcedFull: true,
      reason: "manual-override",
    }),
    results: [
      result({
        chainId: "gameplay",
        suites: gameplaySuites,
        risk: ["smoke"],
        forcedFull: true,
        reason: "manual-override",
        terminal: "failed",
        finalFailedSuite: "production-journey",
      }),
    ],
  });

  assert.equal(analysis.status, "failed");
  assert.deepEqual(
    analysis.routingAudit.finalFailures.find(
      ({ chainId }) => chainId === "gameplay",
    ),
    {
      chainId: "gameplay",
      suite: "production-journey",
      classification: "routing-gap",
    },
  );
});

test("fails closed on duplicate, unknown, malformed, nonterminal, and dirty-cleanup evidence", () => {
  const validPlan = plan({ suites: ["smoke"], chains: [smokeChain] });
  const validResult = result({ chainId: "gameplay", suites: ["smoke"] });
  const cases = [
    {
      results: [validResult, { ...validResult, runId: "duplicate-run" }],
      code: "duplicate-chain",
    },
    {
      results: [validResult, result({ chainId: "exit", suites: ["smoke"] })],
      code: "unknown-chain",
    },
    {
      results: [{ ...validResult, schemaVersion: 1 }],
      code: "malformed-chain",
    },
    {
      results: [{ ...validResult, result: "running" }],
      code: "malformed-chain",
    },
    {
      results: [
        result({
          chainId: "gameplay",
          suites: ["smoke"],
          cleanupState: "failed",
        }),
      ],
      code: "cleanup-failed",
    },
  ];

  for (const fixture of cases) {
    const analysis = analyzeE2eCiResults({
      plan: validPlan,
      results: fixture.results,
    });
    assert.equal(analysis.status, "failed");
    assert.equal(
      analysis.errors.some(({ code }) => code === fixture.code),
      true,
      fixture.code,
    );
  }
});

test("marks malformed forced-full failure evidence indeterminate", () => {
  const analysis = analyzeE2eCiResults({
    plan: plan({
      suites: ["smoke", "gameplay"],
      chains: [{ chainId: "gameplay", suiteIds: ["smoke", "gameplay"] }],
      risk: ["smoke"],
      forcedFull: true,
      reason: "manual-override",
    }),
    results: [
      {
        ...result({
          chainId: "gameplay",
          suites: ["smoke", "gameplay"],
          risk: ["smoke"],
          forcedFull: true,
          reason: "manual-override",
          terminal: "failed",
          finalFailedSuite: "gameplay",
        }),
        finalFailedSuite: null,
      },
    ],
  });

  assert.equal(analysis.status, "failed");
  assert.deepEqual(analysis.routingAudit.finalFailures, [
    { chainId: "gameplay", suite: null, classification: "indeterminate" },
  ]);
});

test("rejects contradictory planner execution modes", () => {
  const fullSuites = [
    "smoke",
    "gameplay",
    "production-journey",
    "capture-proof",
    "save-core",
    "save-management",
    "exit-lifecycle",
  ];
  const fullChains = [
    {
      chainId: "gameplay",
      suiteIds: ["smoke", "gameplay", "production-journey"],
    },
    {
      chainId: "persistence",
      suiteIds: ["capture-proof", "save-core", "save-management"],
    },
    { chainId: "exit", suiteIds: ["exit-lifecycle"] },
  ];
  const fixtures = [
    plan({
      suites: ["smoke"],
      chains: [smokeChain],
      risk: ["smoke"],
      forcedFull: true,
      reason: "manual-override",
    }),
    plan({
      suites: fullSuites,
      chains: fullChains,
      risk: ["smoke"],
      forcedFull: true,
      reason: null,
    }),
    plan({
      suites: ["smoke", "gameplay"],
      chains: [{ chainId: "gameplay", suiteIds: ["smoke", "gameplay"] }],
      risk: ["smoke"],
    }),
    plan({
      suites: ["smoke"],
      chains: [smokeChain],
      risk: ["smoke"],
      reason: "unexpected-reason",
    }),
    plan({ suites: [], chains: [], risk: ["smoke"] }),
    plan({
      suites: [],
      chains: [],
      risk: [],
      forcedFull: true,
      reason: "manual-override",
    }),
  ];

  for (const invalidPlan of fixtures) {
    const analysis = analyzeE2eCiResults({ plan: invalidPlan, results: [] });
    assert.equal(analysis.status, "failed");
    assert.equal(
      analysis.errors.some(({ code }) => code === "malformed-plan"),
      true,
    );
  }
});

test("rejects contradictory terminal, phase, timing, retry, and cleanup evidence", () => {
  const validPlan = plan({ suites: ["smoke"], chains: [smokeChain] });
  const passed = result({ chainId: "gameplay", suites: ["smoke"] });
  const failed = result({
    chainId: "gameplay",
    suites: ["smoke"],
    terminal: "failed",
    finalFailedSuite: "smoke",
  });
  const recovered = result({
    chainId: "gameplay",
    suites: ["smoke"],
    firstAttemptFailures: [{ phase: "smoke", suite: "smoke", exitCode: 23 }],
    recoveredFlakes: ["smoke"],
  });
  const fixtures = [
    { ...passed, exitCode: 1 },
    { ...failed, exitCode: 0 },
    {
      ...passed,
      phaseResults: [{ ...passed.phaseResults[0], exitCode: 9 }],
    },
    {
      ...failed,
      phaseResults: [{ ...failed.phaseResults[0], exitCode: 0 }],
    },
    {
      ...passed,
      phaseResults: [{ ...passed.phaseResults[0], phase: "invented-phase" }],
    },
    { ...passed, phaseResults: [null] },
    {
      ...passed,
      attempts: { configured: 2, used: 2, retries: 1 },
    },
    { ...recovered, firstAttemptFailures: [], recoveredFlakes: [] },
    { ...recovered, recoveredFlakes: [] },
    {
      ...recovered,
      cleanup: {
        state: "removed",
        attempts: [{ attempt: 1, state: "removed" }],
      },
    },
    { ...passed, cleanup: { state: "removed", attempts: [null] } },
    { ...passed, testOnlyTimeMs: passed.testOnlyTimeMs + 1 },
  ];

  for (const invalidResult of fixtures) {
    const analysis = analyzeE2eCiResults({
      plan: validPlan,
      results: [invalidResult],
    });
    assert.equal(analysis.status, "failed");
    assert.equal(
      analysis.errors.some(({ code }) => code === "malformed-chain"),
      true,
    );
  }
});

test("rejects a terminal exit code that disagrees with its failed final phase", () => {
  const gameplaySuites = ["smoke", "gameplay", "production-journey"];
  const forcedPlan = plan({
    suites: [
      ...gameplaySuites,
      "capture-proof",
      "save-core",
      "save-management",
      "exit-lifecycle",
    ],
    chains: [
      { chainId: "gameplay", suiteIds: gameplaySuites },
      {
        chainId: "persistence",
        suiteIds: ["capture-proof", "save-core", "save-management"],
      },
      { chainId: "exit", suiteIds: ["exit-lifecycle"] },
    ],
    risk: ["smoke"],
    forcedFull: true,
    reason: "manual-override",
  });
  const contradictory = result({
    chainId: "gameplay",
    suites: gameplaySuites,
    risk: ["smoke"],
    forcedFull: true,
    reason: "manual-override",
    terminal: "failed",
    finalFailedSuite: "production-journey",
  });
  contradictory.exitCode = 29;

  const analysis = analyzeE2eCiResults({
    plan: forcedPlan,
    results: [contradictory],
  });
  assert.equal(
    analysis.errors.some(({ code }) => code === "malformed-chain"),
    true,
  );
  assert.deepEqual(analysis.routingAudit.finalFailures[0], {
    chainId: "gameplay",
    suite: null,
    classification: "indeterminate",
  });
});

test("rejects runner wall time shorter than summed test-only time", () => {
  const malformed = result({ chainId: "gameplay", suites: ["smoke"] });
  malformed.runnerWallTimeMs = malformed.testOnlyTimeMs - 1;

  const analysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [malformed],
  });
  assert.equal(analysis.status, "failed");
  assert.equal(
    analysis.errors.some(({ code }) => code === "malformed-chain"),
    true,
  );
});

test("rejects malformed top-level and phase timing or artifact envelopes", () => {
  const validPlan = plan({ suites: ["smoke"], chains: [smokeChain] });
  const fixtures = [];

  const nonCanonicalStart = result({
    chainId: "gameplay",
    suites: ["smoke"],
  });
  nonCanonicalStart.start = "2026-08-02";
  fixtures.push(nonCanonicalStart);

  const reversedRunner = result({ chainId: "gameplay", suites: ["smoke"] });
  reversedRunner.start = "2026-08-02T00:00:02.000Z";
  fixtures.push(reversedRunner);

  const fractionalRunner = result({
    chainId: "gameplay",
    suites: ["smoke"],
  });
  fractionalRunner.runnerWallTimeMs += 0.5;
  fixtures.push(fractionalRunner);

  const nonCanonicalPhaseStart = result({
    chainId: "gameplay",
    suites: ["smoke"],
  });
  nonCanonicalPhaseStart.phaseResults[0].start = "not-a-timestamp";
  fixtures.push(nonCanonicalPhaseStart);

  const reversedPhase = result({ chainId: "gameplay", suites: ["smoke"] });
  reversedPhase.phaseResults[0].start = "2026-08-02T00:00:02.000Z";
  fixtures.push(reversedPhase);

  const phaseOutsideRunner = result({
    chainId: "gameplay",
    suites: ["smoke"],
  });
  phaseOutsideRunner.phaseResults[0].start = "2026-08-01T23:59:59.000Z";
  fixtures.push(phaseOutsideRunner);

  const fractionalPhase = result({
    chainId: "gameplay",
    suites: ["smoke"],
  });
  fractionalPhase.phaseResults[0].durationMs = 100.5;
  fractionalPhase.durationMs = 100.5;
  fractionalPhase.testOnlyTimeMs = 100.5;
  fractionalPhase.runnerWallTimeMs = 201;
  fixtures.push(fractionalPhase);

  for (const outputDirectory of [
    "",
    "relative/outputs/attempt-1/smoke/smoke",
    path.join(os.tmpdir(), "invented-output"),
    null,
  ]) {
    const malformedPath = result({
      chainId: "gameplay",
      suites: ["smoke"],
    });
    malformedPath.phaseResults[0].outputDirectory = outputDirectory;
    fixtures.push(malformedPath);
  }

  for (const malformed of fixtures) {
    const analysis = analyzeE2eCiResults({
      plan: validPlan,
      results: [malformed],
    });
    assert.equal(analysis.status, "failed");
    assert.equal(
      analysis.errors.some(({ code }) => code === "malformed-chain"),
      true,
    );
  }
});

test("rejects producer-impossible phase chronology and split run roots", async (t) => {
  const suites = ["smoke", "gameplay"];
  const validPlan = plan({
    suites,
    chains: [{ chainId: "gameplay", suiteIds: suites }],
  });
  const fixtures = [
    {
      name: "duration exceeds its timestamp envelope",
      mutate(malformed) {
        const phase = malformed.phaseResults.at(-1);
        const delta = 1_001 - phase.durationMs;
        phase.durationMs = 1_001;
        malformed.durationMs = phase.durationMs;
        malformed.testOnlyTimeMs += delta;
        malformed.runnerWallTimeMs = malformed.testOnlyTimeMs + 100;
      },
    },
    {
      name: "recorded phases overlap",
      mutate(malformed) {
        malformed.phaseResults[1].start = new Date(
          FIXTURE_START_MS + 500,
        ).toISOString();
      },
    },
    {
      name: "phase artifacts use different run directories",
      mutate(malformed) {
        malformed.phaseResults[1].outputDirectory = path.join(
          os.tmpdir(),
          "different-gameplay-run",
          "outputs",
          "attempt-1",
          "gameplay",
          "ordinary",
        );
      },
    },
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.name, () => {
      const malformed = result({
        chainId: "gameplay",
        suites,
        terminal: "failed",
        finalFailedSuite: "gameplay",
      });
      fixture.mutate(malformed);

      const analysis = analyzeE2eCiResults({
        plan: validPlan,
        results: [malformed],
      });
      assert.equal(analysis.status, "failed");
      assert.equal(
        analysis.errors.some(({ code }) => code === "malformed-chain"),
        true,
      );
      assert.deepEqual(analysis.routingAudit.finalFailures, [
        {
          chainId: "gameplay",
          suite: null,
          classification: "indeterminate",
        },
      ]);
    });
  }
});

test("keeps forced-full routing indeterminate for malformed phase artifacts", () => {
  const gameplaySuites = ["smoke", "gameplay", "production-journey"];
  const forcedPlan = plan({
    suites: [
      ...gameplaySuites,
      "capture-proof",
      "save-core",
      "save-management",
      "exit-lifecycle",
    ],
    chains: [
      { chainId: "gameplay", suiteIds: gameplaySuites },
      {
        chainId: "persistence",
        suiteIds: ["capture-proof", "save-core", "save-management"],
      },
      { chainId: "exit", suiteIds: ["exit-lifecycle"] },
    ],
    risk: ["smoke"],
    forcedFull: true,
    reason: "manual-override",
  });
  const malformed = result({
    chainId: "gameplay",
    suites: gameplaySuites,
    risk: ["smoke"],
    forcedFull: true,
    reason: "manual-override",
    terminal: "failed",
    finalFailedSuite: "production-journey",
  });
  malformed.phaseResults.at(-1).outputDirectory = path.join(
    os.tmpdir(),
    "invented-output",
  );

  const analysis = analyzeE2eCiResults({
    plan: forcedPlan,
    results: [malformed],
  });
  assert.equal(
    analysis.errors.some(({ code }) => code === "malformed-chain"),
    true,
  );
  assert.deepEqual(
    analysis.routingAudit.finalFailures.find(
      ({ chainId }) => chainId === "gameplay",
    ),
    {
      chainId: "gameplay",
      suite: null,
      classification: "indeterminate",
    },
  );
});

test("rejects wrong canonical phase order on every represented attempt", () => {
  const suites = ["smoke", "gameplay", "production-journey"];
  const validPlan = plan({
    suites,
    chains: [{ chainId: "gameplay", suiteIds: suites }],
  });
  const validResult = result({ chainId: "gameplay", suites });
  const reordered = {
    ...validResult,
    phaseResults: [
      validResult.phaseResults[1],
      validResult.phaseResults[0],
      validResult.phaseResults[2],
    ],
  };

  const analysis = analyzeE2eCiResults({
    plan: validPlan,
    results: [reordered],
  });
  assert.equal(analysis.status, "failed");
  assert.equal(
    analysis.errors.some(({ code }) => code === "malformed-chain"),
    true,
  );
});

test("rejects phase evidence outside or out of represented attempt order", () => {
  const validPlan = plan({ suites: ["smoke"], chains: [smokeChain] });
  const retried = result({
    chainId: "gameplay",
    suites: ["smoke"],
    firstAttemptFailures: [{ phase: "smoke", suite: "smoke", exitCode: 23 }],
    recoveredFlakes: ["smoke"],
  });
  const fixtures = [
    {
      ...retried,
      phaseResults: [retried.phaseResults[1], retried.phaseResults[0]],
    },
    {
      ...retried,
      phaseResults: [
        ...retried.phaseResults,
        { ...retried.phaseResults[1], attempt: 3 },
      ],
      phaseCount: 3,
      processCount: 3,
      testOnlyTimeMs:
        retried.testOnlyTimeMs + retried.phaseResults[1].durationMs,
      phase: retried.phaseResults[1].phase,
      suite: retried.phaseResults[1].suite,
      attempt: 3,
      durationMs: retried.phaseResults[1].durationMs,
    },
  ];

  for (const invalidResult of fixtures) {
    const analysis = analyzeE2eCiResults({
      plan: validPlan,
      results: [invalidResult],
    });
    assert.equal(analysis.status, "failed");
    assert.equal(
      analysis.errors.some(({ code }) => code === "malformed-chain"),
      true,
    );
  }
});

test("invented forced-full failure evidence remains indeterminate", () => {
  const suites = ["smoke", "gameplay", "production-journey"];
  const forcedPlan = plan({
    suites: [
      ...suites,
      "capture-proof",
      "save-core",
      "save-management",
      "exit-lifecycle",
    ],
    chains: [
      { chainId: "gameplay", suiteIds: suites },
      {
        chainId: "persistence",
        suiteIds: ["capture-proof", "save-core", "save-management"],
      },
      { chainId: "exit", suiteIds: ["exit-lifecycle"] },
    ],
    risk: ["smoke"],
    forcedFull: true,
    reason: "manual-override",
  });
  const invalidFailure = result({
    chainId: "gameplay",
    suites,
    risk: ["smoke"],
    forcedFull: true,
    reason: "manual-override",
    terminal: "failed",
    finalFailedSuite: "production-journey",
  });
  invalidFailure.phaseResults.at(-1).phase = "invented-phase";

  const analysis = analyzeE2eCiResults({
    plan: forcedPlan,
    results: [invalidFailure],
  });
  assert.deepEqual(analysis.routingAudit.finalFailures[0], {
    chainId: "gameplay",
    suite: null,
    classification: "indeterminate",
  });
});

test("CLI writes failed analysis and summary for a null planner matrix entry", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "lyra-e2e-analysis-"));
  try {
    const planFile = path.join(directory, "e2e-plan.json");
    const resultsDirectory = path.join(directory, "results");
    const analysisFile = path.join(directory, "analysis.json");
    const summaryFile = path.join(directory, "summary.md");
    mkdirSync(resultsDirectory);
    const malformedPlan = plan({ suites: ["smoke"], chains: [smokeChain] });
    malformedPlan.matrix.include = [null];
    writeFileSync(planFile, JSON.stringify(malformedPlan));

    const execution = spawnSync(
      process.execPath,
      [
        new URL("./e2e-ci-results.mjs", import.meta.url).pathname,
        "--plan-file",
        planFile,
        "--results-directory",
        resultsDirectory,
        "--analysis-file",
        analysisFile,
      ],
      {
        env: { ...process.env, GITHUB_STEP_SUMMARY: summaryFile },
        encoding: "utf8",
      },
    );

    assert.equal(execution.status, 1);
    assert.equal(existsSync(analysisFile), true);
    assert.equal(existsSync(summaryFile), true);
    const analysis = JSON.parse(readFileSync(analysisFile, "utf8"));
    assert.equal(analysis.status, "failed");
    assert.equal(
      analysis.errors.some(({ code }) => code === "malformed-plan"),
      true,
    );
    assert.match(readFileSync(summaryFile, "utf8"), /malformed-plan/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI writes failed artifacts for malformed phase timing and output paths", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "lyra-e2e-analysis-"));
  try {
    const planFile = path.join(directory, "e2e-plan.json");
    const resultsDirectory = path.join(directory, "results");
    const analysisFile = path.join(directory, "analysis.json");
    const summaryFile = path.join(directory, "summary.md");
    mkdirSync(resultsDirectory);
    writeFileSync(
      planFile,
      JSON.stringify(plan({ suites: ["smoke"], chains: [smokeChain] })),
    );
    const malformed = result({ chainId: "gameplay", suites: ["smoke"] });
    malformed.phaseResults[0].start = "not-a-timestamp";
    malformed.phaseResults[0].outputDirectory = null;
    writeFileSync(
      path.join(resultsDirectory, "run-result.json"),
      JSON.stringify(malformed),
    );

    const execution = spawnSync(
      process.execPath,
      [
        new URL("./e2e-ci-results.mjs", import.meta.url).pathname,
        "--plan-file",
        planFile,
        "--results-directory",
        resultsDirectory,
        "--analysis-file",
        analysisFile,
      ],
      {
        env: { ...process.env, GITHUB_STEP_SUMMARY: summaryFile },
        encoding: "utf8",
      },
    );

    assert.equal(execution.status, 1);
    assert.equal(existsSync(analysisFile), true);
    assert.equal(existsSync(summaryFile), true);
    const analysis = JSON.parse(readFileSync(analysisFile, "utf8"));
    assert.equal(analysis.status, "failed");
    assert.equal(
      analysis.errors.some(({ code }) => code === "malformed-chain"),
      true,
    );
    assert.match(readFileSync(summaryFile, "utf8"), /malformed-chain/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI fails closed for overlapping phases and split run roots", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "lyra-e2e-analysis-"));
  try {
    const planFile = path.join(directory, "e2e-plan.json");
    const resultsDirectory = path.join(directory, "results");
    const analysisFile = path.join(directory, "analysis.json");
    const summaryFile = path.join(directory, "summary.md");
    const suites = ["smoke", "gameplay"];
    mkdirSync(resultsDirectory);
    writeFileSync(
      planFile,
      JSON.stringify(
        plan({
          suites,
          chains: [{ chainId: "gameplay", suiteIds: suites }],
        }),
      ),
    );
    const malformed = result({ chainId: "gameplay", suites });
    malformed.phaseResults[1].start = new Date(
      FIXTURE_START_MS + 500,
    ).toISOString();
    malformed.phaseResults[1].outputDirectory = path.join(
      os.tmpdir(),
      "different-gameplay-run",
      "outputs",
      "attempt-1",
      "gameplay",
      "ordinary",
    );
    writeFileSync(
      path.join(resultsDirectory, "run-result.json"),
      JSON.stringify(malformed),
    );

    const execution = spawnSync(
      process.execPath,
      [
        new URL("./e2e-ci-results.mjs", import.meta.url).pathname,
        "--plan-file",
        planFile,
        "--results-directory",
        resultsDirectory,
        "--analysis-file",
        analysisFile,
      ],
      {
        env: { ...process.env, GITHUB_STEP_SUMMARY: summaryFile },
        encoding: "utf8",
      },
    );

    assert.equal(execution.status, 1);
    assert.equal(existsSync(analysisFile), true);
    assert.equal(existsSync(summaryFile), true);
    const analysis = JSON.parse(readFileSync(analysisFile, "utf8"));
    assert.equal(analysis.status, "failed");
    assert.equal(
      analysis.errors.some(({ code }) => code === "malformed-chain"),
      true,
    );
    assert.match(readFileSync(summaryFile, "utf8"), /malformed-chain/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("malformed attempts return failed analysis without throwing", () => {
  const malformed = result({ chainId: "gameplay", suites: ["smoke"] });
  malformed.attempts = null;
  const analysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [malformed],
  });

  assert.equal(analysis.status, "failed");
  assert.equal(
    analysis.errors.some(({ code }) => code === "malformed-chain"),
    true,
  );
});

test("CLI writes analysis and step summary for malformed result evidence", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "lyra-e2e-analysis-"));
  try {
    const planFile = path.join(directory, "e2e-plan.json");
    const resultsDirectory = path.join(directory, "results");
    const analysisFile = path.join(directory, "analysis.json");
    const summaryFile = path.join(directory, "summary.md");
    mkdirSync(resultsDirectory);
    writeFileSync(
      planFile,
      JSON.stringify(plan({ suites: ["smoke"], chains: [smokeChain] })),
    );
    const malformed = result({ chainId: "gameplay", suites: ["smoke"] });
    malformed.attempts = null;
    writeFileSync(
      path.join(resultsDirectory, "run-result.json"),
      JSON.stringify(malformed),
    );

    const execution = spawnSync(
      process.execPath,
      [
        new URL("./e2e-ci-results.mjs", import.meta.url).pathname,
        "--plan-file",
        planFile,
        "--results-directory",
        resultsDirectory,
        "--analysis-file",
        analysisFile,
      ],
      {
        env: { ...process.env, GITHUB_STEP_SUMMARY: summaryFile },
        encoding: "utf8",
      },
    );

    assert.equal(execution.status, 1, execution.stderr);
    assert.equal(
      JSON.parse(readFileSync(analysisFile, "utf8")).status,
      "failed",
    );
    assert.match(readFileSync(summaryFile, "utf8"), /Status: \*\*failed\*\*/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
