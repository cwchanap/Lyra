import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  E2E_SUITE_IDS,
  E2E_SUITE_DEFINITIONS,
  buildE2ePhasePlan,
  e2eSuiteGuardedRoots,
  normalizeE2eSuiteIds,
  resolveE2eSuiteSelection,
  validateE2ePhaseOwnership,
} from "./e2e-suite-registry.mjs";
import { parseRunnerArguments } from "./e2e-runner-selection.mjs";

test("registry exposes the canonical leaf suite order", () => {
  assert.deepEqual(E2E_SUITE_IDS, [
    "smoke",
    "gameplay",
    "production-journey",
    "analysis-beat85",
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

test("analysis beat 8.5 owns one focused packaged spec after production journey", () => {
  const [phase] = buildE2ePhasePlan(["analysis-beat85"], {
    analysisBeat85: "/tmp/analysis-beat85",
  });

  assert.deepEqual(phase, {
    id: "analysis-beat85",
    group: "analysis-beat85",
    appDataDir: "/tmp/analysis-beat85",
    specs: ["./e2e-tauri/analysis-beat85.e2e.ts"],
    environment: { LYRA_E2E_CAPTURE_BACKEND_LOGS: "1" },
  });
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
    "analysisBeat85",
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

test("runner rejects the removed planner selection flags", () => {
  for (const flag of ["--suite-file", "--chain-id", "--plan-file"]) {
    assert.throws(
      () => parseRunnerArguments([flag, "/tmp/e2e-fixture.json"]),
      /unknown e2e runner argument/i,
      flag,
    );
  }
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
    "validateSelectedE2eSuiteDefinitions(",
  );

  assert.notEqual(validation, -1);
  assert.equal(
    validation < runnerSource.indexOf("const runner = await runE2eRunner"),
    true,
  );
});
