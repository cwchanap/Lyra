import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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
      outputDirectory: `/tmp/${chainId}/${suite}`,
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
      outputDirectory: `/tmp/${chainId}/attempt-1`,
    })),
    ...finalPhases,
  ];
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
    runnerWallTimeMs: 500,
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
    start: "2026-08-02T00:00:00.000Z",
    finish: "2026-08-02T00:00:01.000Z",
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

test("accepts a complete smoke-only matrix", () => {
  const analysis = analyzeE2eCiResults({
    plan: plan({ suites: ["smoke"], chains: [smokeChain] }),
    results: [result({ chainId: "gameplay", suites: ["smoke"] })],
  });

  assert.equal(analysis.status, "passed");
  assert.deepEqual(analysis.errors, []);
  assert.deepEqual(analysis.expectedChainIds, ["gameplay"]);
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
