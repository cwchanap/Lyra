import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  E2E_CHAIN_DEFINITIONS,
  E2E_CHAIN_IDS,
  E2E_SUITE_IDS,
  E2E_SUITE_DEFINITIONS,
  buildE2ePhasePlan,
  e2eSuiteGuardedRoots,
  normalizeE2eSuiteIds,
  partitionE2eSuitesByChain,
  resolveE2eSuiteSelection,
  validateE2ePhaseOwnership,
} from "./e2e-suite-registry.mjs";
import {
  parseRunnerArguments,
  resolveRunnerPlannerMetadata,
  resolveRunnerSelection,
} from "./e2e-runner-selection.mjs";

test("registry exposes the canonical leaf suite order", () => {
  assert.deepEqual(E2E_SUITE_IDS, [
    "smoke",
    "gameplay",
    "production-journey",
    "capture-proof",
    "save-core",
    "save-management",
    "exit-lifecycle",
  ]);
});

test("registry definitions are immutable", () => {
  assert.equal(Object.isFrozen(E2E_SUITE_DEFINITIONS), true);
  assert.equal(Object.isFrozen(E2E_SUITE_DEFINITIONS[0]), true);
  assert.equal(Object.isFrozen(E2E_SUITE_DEFINITIONS[0].phases), true);
});

test("chain registry owns every canonical suite exactly once", () => {
  assert.deepEqual(E2E_CHAIN_IDS, ["gameplay", "persistence", "exit"]);
  assert.equal(Object.isFrozen(E2E_CHAIN_DEFINITIONS), true);
  assert.equal(
    E2E_CHAIN_DEFINITIONS.every(
      (definition) =>
        Object.isFrozen(definition) && Object.isFrozen(definition.suiteIds),
    ),
    true,
  );
  assert.deepEqual(
    E2E_CHAIN_DEFINITIONS.map(({ id, suiteIds }) => ({ id, suiteIds })),
    [
      {
        id: "gameplay",
        suiteIds: ["smoke", "gameplay", "production-journey"],
      },
      {
        id: "persistence",
        suiteIds: ["capture-proof", "save-core", "save-management"],
      },
      { id: "exit", suiteIds: ["exit-lifecycle"] },
    ],
  );
  const ownedSuites = E2E_CHAIN_DEFINITIONS.flatMap(({ suiteIds }) => suiteIds);
  assert.deepEqual(ownedSuites, E2E_SUITE_IDS);
  assert.equal(new Set(ownedSuites).size, ownedSuites.length);
});

test("partitions risk-selected suites into canonical non-empty chains", () => {
  assert.deepEqual(
    partitionE2eSuitesByChain([
      "exit-lifecycle",
      "smoke",
      "save-management",
      "smoke",
    ]),
    [
      {
        id: "gameplay",
        suiteIds: ["smoke"],
        guardedRoots: ["smoke"],
      },
      {
        id: "persistence",
        suiteIds: ["save-management"],
        guardedRoots: ["persistence"],
      },
      {
        id: "exit",
        suiteIds: ["exit-lifecycle"],
        guardedRoots: ["exit"],
      },
    ],
  );
  assert.deepEqual(partitionE2eSuitesByChain(["capture-proof"]), [
    {
      id: "persistence",
      suiteIds: ["capture-proof"],
      guardedRoots: ["capture"],
    },
  ]);
});

test("full chain partition retains the frozen Task 8 persistence boundaries", () => {
  const chains = partitionE2eSuitesByChain(E2E_SUITE_IDS);
  assert.deepEqual(
    chains.map(({ id, guardedRoots }) => ({ id, guardedRoots })),
    [
      {
        id: "gameplay",
        guardedRoots: ["smoke", "gameplay", "productionJourney"],
      },
      {
        id: "persistence",
        guardedRoots: ["capture", "persistence"],
      },
      { id: "exit", guardedRoots: ["exit"] },
    ],
  );
  const processCounts = Object.fromEntries(
    chains.map(({ id, suiteIds }) => [
      id,
      buildE2ePhasePlan(suiteIds, {}).length,
    ]),
  );
  assert.deepEqual(processCounts, { gameplay: 3, persistence: 7, exit: 5 });
  assert.equal(
    buildE2ePhasePlan(["save-core", "save-management", "exit-lifecycle"], {})
      .length,
    11,
  );
});

test("smoke owns only the packaged title-to-dialogue check", () => {
  const [phase] = buildE2ePhasePlan(["smoke"], { smoke: "/tmp/smoke" });

  assert.deepEqual(phase.specs, ["./e2e-tauri/smoke.e2e.ts"]);
});

test("gameplay owns the focused checkpoint-backed packaged specs", () => {
  const [phase] = buildE2ePhasePlan(["gameplay"], {
    gameplay: "/tmp/gameplay",
  });

  assert.deepEqual(phase.specs, [
    "./e2e-tauri/app.e2e.ts",
    "./e2e-tauri/case-file.e2e.ts",
    "./e2e-tauri/checkpoint-contract.e2e.ts",
    "./e2e-tauri/investigation-layout.e2e.ts",
    "./e2e-tauri/scene-navigation-gate.e2e.ts",
  ]);
});

test("production journey owns exactly the one genuine fresh-install spec", () => {
  const [phase] = buildE2ePhasePlan(["production-journey"], {
    productionJourney: "/tmp/production-journey",
  });

  assert.deepEqual(phase.specs, ["./e2e-tauri/production-journey.e2e.ts"]);
});

test("persistence suites retain exactly eleven native restart boundaries", () => {
  const phases = buildE2ePhasePlan(
    ["save-core", "save-management", "exit-lifecycle"],
    {
      persistence: "/tmp/persistence",
      exit: "/tmp/exit",
    },
  );

  assert.deepEqual(
    phases.map(({ id }) => id),
    [
      "save-seed",
      "save-resume",
      "management-seed",
      "management-corrupt-newest",
      "management-missing-thumbnail",
      "management-corrupt-thumbnail",
      "exit-close-seed",
      "exit-close-resume",
      "exit-quit-resume",
      "exit-failure-bypass",
      "exit-final-verification",
    ],
  );
  assert.equal(phases.length, 11);
});

test("normalizes duplicate requested suites into canonical order", () => {
  assert.deepEqual(
    normalizeE2eSuiteIds(["save-management", "smoke", "smoke"]),
    ["smoke", "save-management"],
  );
});

test("rejects an unknown suite before resolving a plan", () => {
  assert.throws(() => normalizeE2eSuiteIds(["unknown"]), /unknown e2e suite/i);
});

test("the full selector resolves every suite in canonical order", () => {
  assert.deepEqual(resolveE2eSuiteSelection({ full: true }), E2E_SUITE_IDS);
});

test("the full selector reserves independent guarded roots for every CI suite class", () => {
  assert.deepEqual(e2eSuiteGuardedRoots(E2E_SUITE_IDS), [
    "smoke",
    "gameplay",
    "productionJourney",
    "capture",
    "persistence",
    "exit",
  ]);
});

test("runner accepts only one selection mode and one or two attempts", () => {
  assert.deepEqual(
    parseRunnerArguments([
      "--suite",
      "save-core",
      "--suite",
      "smoke",
      "--attempts",
      "2",
    ]),
    { suiteIds: ["save-core", "smoke"], attempts: 2 },
  );
  assert.throws(
    () => parseRunnerArguments(["--full", "--suite", "smoke"]),
    /mutually exclusive/i,
  );
  assert.throws(
    () => parseRunnerArguments(["--full", "--attempts", "3"]),
    /attempts/i,
  );
});

test("suite-file selection rejects invalid JSON and non-array contents", () => {
  const invalid = parseRunnerArguments([
    "--suite-file",
    "/tmp/e2e-suites.json",
  ]);
  assert.throws(
    () => resolveRunnerSelection(invalid, { readFile: () => "{" }),
    /invalid e2e suite file/i,
  );
  assert.throws(
    () =>
      resolveRunnerSelection(invalid, {
        readFile: () => JSON.stringify({ suite: "smoke" }),
      }),
    /json array/i,
  );
});

test("runner binds a chain suite file to the planner metadata that selected it", () => {
  const options = parseRunnerArguments([
    "--suite-file",
    "/tmp/e2e-plan/chains/persistence-suites.json",
    "--chain-id",
    "persistence",
    "--plan-file",
    "/tmp/e2e-plan/e2e-plan.json",
  ]);
  const metadata = resolveRunnerPlannerMetadata(
    options,
    ["capture-proof", "save-core", "save-management"],
    {
      readFile: () =>
        JSON.stringify({
          planner: {
            schemaVersion: 1,
            riskSelectedSuites: ["smoke", "capture-proof", "save-core"],
            forcedFull: true,
            reason: "manual-override",
          },
          expectedChainIds: ["gameplay", "persistence", "exit"],
          matrix: {
            include: [
              {
                chainId: "persistence",
                suiteIds: ["capture-proof", "save-core", "save-management"],
              },
            ],
          },
        }),
    },
  );

  assert.deepEqual(metadata, {
    chainId: "persistence",
    riskSelectedSuites: ["smoke", "capture-proof", "save-core"],
    forcedFull: true,
    reason: "manual-override",
  });
});

test("runner rejects a chain whose suite file disagrees with the planner", () => {
  const options = parseRunnerArguments([
    "--suite-file",
    "/tmp/e2e-plan/chains/gameplay-suites.json",
    "--chain-id",
    "gameplay",
    "--plan-file",
    "/tmp/e2e-plan/e2e-plan.json",
  ]);
  assert.throws(
    () =>
      resolveRunnerPlannerMetadata(options, ["smoke", "gameplay"], {
        readFile: () =>
          JSON.stringify({
            planner: {
              schemaVersion: 1,
              riskSelectedSuites: ["smoke"],
              forcedFull: false,
              reason: null,
            },
            expectedChainIds: ["gameplay"],
            matrix: {
              include: [{ chainId: "gameplay", suiteIds: ["smoke"] }],
            },
          }),
      }),
    /planner metadata/i,
  );
});

test("runner preserves an empty risk selection for scheduled forced-full coverage", () => {
  const options = parseRunnerArguments([
    "--suite-file",
    "/tmp/e2e-plan/chains/exit-suites.json",
    "--chain-id",
    "exit",
    "--plan-file",
    "/tmp/e2e-plan/e2e-plan.json",
  ]);
  assert.deepEqual(
    resolveRunnerPlannerMetadata(options, ["exit-lifecycle"], {
      readFile: () =>
        JSON.stringify({
          planner: {
            schemaVersion: 1,
            riskSelectedSuites: [],
            forcedFull: true,
            reason: "nightly",
          },
          expectedChainIds: ["gameplay", "persistence", "exit"],
          matrix: {
            include: [{ chainId: "exit", suiteIds: ["exit-lifecycle"] }],
          },
        }),
    }),
    {
      chainId: "exit",
      riskSelectedSuites: [],
      forcedFull: true,
      reason: "nightly",
    },
  );
});

test("phase ownership rejects an approved spec in the wrong phase before launch", () => {
  const [phase] = buildE2ePhasePlan(["smoke"], { ordinary: "/tmp/owned" });
  phase.specs = ["./e2e-tauri/capture-proof.e2e.ts"];
  assert.throws(() => validateE2ePhaseOwnership(phase), /phase plan/i);
});

test("runner validates selected suite definitions before its binary guard or roots", () => {
  const runnerSource = readFileSync(
    new URL("./run-save-e2e.mjs", import.meta.url),
    "utf8",
  );
  const validation = runnerSource.indexOf(
    "validateSelectedE2eSuiteDefinitions(suiteIds)",
  );

  assert.notEqual(validation, -1);
  assert.equal(
    validation < runnerSource.indexOf("const runner = await runE2eRunner"),
    true,
  );
});
