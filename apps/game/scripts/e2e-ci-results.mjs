import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  E2E_CHAIN_IDS,
  buildE2ePhasePlan,
  e2eSuiteForPhase,
  normalizeE2eSuiteIds,
  partitionE2eSuitesByChain,
} from "./e2e-suite-registry.mjs";
import { E2E_RUN_RESULT_SCHEMA_VERSION } from "./e2e-runner-lifecycle.mjs";

export const E2E_CI_ANALYSIS_SCHEMA_VERSION = 1;

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function error(code, message, chainId) {
  return {
    code,
    ...(chainId === undefined ? {} : { chainId }),
    message,
  };
}

function validatePlanner(plan) {
  const errors = [];
  if (
    !plan ||
    typeof plan !== "object" ||
    !Array.isArray(plan.suiteIds) ||
    !Array.isArray(plan.expectedChainIds) ||
    !Array.isArray(plan.matrix?.include) ||
    plan.planner?.schemaVersion !== 1 ||
    !Array.isArray(plan.planner.riskSelectedSuites) ||
    typeof plan.planner.forcedFull !== "boolean" ||
    (plan.planner.reason !== null && typeof plan.planner.reason !== "string")
  ) {
    return {
      errors: [error("malformed-plan", "E2E planner evidence is malformed.")],
      expectedChains: [],
    };
  }

  if (plan.suiteIds.length === 0) {
    if (
      plan.skip !== true ||
      plan.expectedChainIds.length !== 0 ||
      plan.matrix.include.length !== 0
    ) {
      errors.push(
        error(
          "malformed-plan",
          "An empty suite selection must be an intentional empty matrix.",
        ),
      );
    }
    return { errors, expectedChains: [] };
  }

  let canonicalSuites;
  let canonicalRiskSuites;
  try {
    canonicalSuites = normalizeE2eSuiteIds(plan.suiteIds);
    canonicalRiskSuites =
      plan.planner.riskSelectedSuites.length === 0
        ? []
        : normalizeE2eSuiteIds(plan.planner.riskSelectedSuites);
  } catch {
    errors.push(error("malformed-plan", "E2E planner suites are invalid."));
    return { errors, expectedChains: [] };
  }
  if (
    !equalJson(canonicalSuites, plan.suiteIds) ||
    !equalJson(canonicalRiskSuites, plan.planner.riskSelectedSuites)
  ) {
    errors.push(
      error("malformed-plan", "E2E planner suites are not canonical."),
    );
  }

  const expectedChains = partitionE2eSuitesByChain(canonicalSuites);
  const canonicalChainIds = expectedChains.map(({ id }) => id);
  if (
    new Set(plan.expectedChainIds).size !== plan.expectedChainIds.length ||
    !equalJson(plan.expectedChainIds, canonicalChainIds) ||
    plan.matrix.include.length !== expectedChains.length
  ) {
    errors.push(
      error("malformed-plan", "E2E planner chain ownership is invalid."),
    );
  }
  for (const expected of expectedChains) {
    const entries = plan.matrix.include.filter(
      ({ chainId }) => chainId === expected.id,
    );
    if (
      entries.length !== 1 ||
      !equalJson(entries[0]?.suiteIds, expected.suiteIds)
    ) {
      errors.push(
        error(
          "malformed-plan",
          "E2E planner chain suite ownership is invalid.",
          expected.id,
        ),
      );
    }
  }
  return { errors, expectedChains };
}

function validateResult(result, expected, planner) {
  const errors = [];
  const chainId = expected.id;
  if (
    !result ||
    typeof result !== "object" ||
    result.schemaVersion !== E2E_RUN_RESULT_SCHEMA_VERSION ||
    typeof result.runId !== "string" ||
    result.runId.length === 0 ||
    result.chainId !== chainId ||
    !["passed", "failed", "cancelled"].includes(result.result) ||
    typeof result.start !== "string" ||
    typeof result.finish !== "string" ||
    !Number.isFinite(result.runnerWallTimeMs) ||
    result.runnerWallTimeMs < 0 ||
    !Number.isFinite(result.testOnlyTimeMs) ||
    result.testOnlyTimeMs < 0 ||
    !Number.isInteger(result.phaseCount) ||
    result.phaseCount < 0 ||
    !Number.isInteger(result.processCount) ||
    result.processCount < 0 ||
    !Array.isArray(result.phaseResults) ||
    result.phaseCount !== result.phaseResults.length ||
    result.processCount !== result.phaseResults.length ||
    !result.attempts ||
    !Number.isInteger(result.attempts.configured) ||
    !Number.isInteger(result.attempts.used) ||
    !Number.isInteger(result.attempts.retries) ||
    result.attempts.configured < 1 ||
    result.attempts.used < 1 ||
    result.attempts.used > result.attempts.configured ||
    result.attempts.retries !== result.attempts.used - 1 ||
    !Array.isArray(result.firstAttemptFailures) ||
    !Array.isArray(result.recoveredFlakes)
  ) {
    errors.push(
      error("malformed-chain", "E2E chain manifest is malformed.", chainId),
    );
  }

  if (!equalJson(result?.selectedSuites, expected.suiteIds)) {
    errors.push(
      error(
        "wrong-suite",
        "E2E chain ran suites outside its canonical ownership.",
        chainId,
      ),
    );
  }
  if (
    !equalJson(result?.riskSelectedSuites, planner.riskSelectedSuites) ||
    result?.forcedFull !== planner.forcedFull ||
    result?.reason !== planner.reason
  ) {
    errors.push(
      error(
        "malformed-chain",
        "E2E chain planner metadata does not match the plan.",
        chainId,
      ),
    );
  }

  const selectedSuites = new Set(expected.suiteIds);
  const invalidPhase = result?.phaseResults?.some(
    (phaseResult) =>
      !phaseResult ||
      !selectedSuites.has(phaseResult.suite) ||
      typeof phaseResult.phase !== "string" ||
      !Number.isInteger(phaseResult.attempt) ||
      phaseResult.attempt < 1 ||
      !Number.isFinite(phaseResult.durationMs) ||
      phaseResult.durationMs < 0 ||
      !["passed", "failed"].includes(phaseResult.result),
  );
  const invalidFirstFailure = result?.firstAttemptFailures?.some(
    (failure) =>
      !failure ||
      typeof failure.phase !== "string" ||
      !selectedSuites.has(failure.suite) ||
      !Number.isInteger(failure.exitCode) ||
      failure.exitCode === 0,
  );
  const firstFailedSuites = new Set(
    result?.firstAttemptFailures?.map(({ suite }) => suite) ?? [],
  );
  const invalidRecoveredFlake = result?.recoveredFlakes?.some(
    (suite) =>
      !selectedSuites.has(suite) ||
      !firstFailedSuites.has(suite) ||
      result.result !== "passed",
  );
  if (invalidPhase || invalidFirstFailure || invalidRecoveredFlake) {
    errors.push(
      error(
        "malformed-chain",
        "E2E chain phase or retry evidence is malformed.",
        chainId,
      ),
    );
  }

  if (result?.result === "passed") {
    const expectedFinalPhases = buildE2ePhasePlan(expected.suiteIds, {}).map(
      ({ id }) => ({
        phase: id,
        suite: e2eSuiteForPhase(id),
        result: "passed",
      }),
    );
    const actualFinalPhases = result.phaseResults
      .filter(({ attempt }) => attempt === result.attempts.used)
      .map(({ phase, suite, result: phaseResult }) => ({
        phase,
        suite,
        result: phaseResult,
      }));
    if (!equalJson(actualFinalPhases, expectedFinalPhases)) {
      errors.push(
        error(
          "incomplete-chain",
          "E2E chain omitted or reordered a mandatory final-attempt phase.",
          chainId,
        ),
      );
    }
  }

  if (
    result?.cleanup?.state !== "removed" ||
    !Array.isArray(result?.cleanup?.attempts) ||
    result.cleanup.attempts.length === 0 ||
    result.cleanup.attempts.some(({ state }) => state !== "removed")
  ) {
    errors.push(
      error(
        "cleanup-failed",
        "E2E chain did not prove guarded root cleanup.",
        chainId,
      ),
    );
  }

  if (result?.result === "cancelled") {
    errors.push(error("cancelled-chain", "E2E chain was cancelled.", chainId));
  } else if (result?.result === "failed") {
    errors.push(error("failed-chain", "E2E chain failed.", chainId));
  }
  const validFailedSuite = selectedSuites.has(result?.finalFailedSuite);
  const validInfrastructureFailure =
    result?.result === "failed" &&
    result.finalFailedSuite === null &&
    (result.cleanup?.state === "failed" || result.phase === "binary-guard");
  if (
    (result?.result === "passed" && result.finalFailedSuite !== null) ||
    (result?.result === "cancelled" && result.finalFailedSuite !== null) ||
    (result?.result === "failed" &&
      !validFailedSuite &&
      !validInfrastructureFailure)
  ) {
    errors.push(
      error(
        "malformed-chain",
        "E2E final failure evidence is malformed.",
        chainId,
      ),
    );
  }
  return errors;
}

export function analyzeE2eCiResults({ plan, results }) {
  const planValidation = validatePlanner(plan);
  const errors = [...planValidation.errors];
  const expectedChainIds = planValidation.expectedChains.map(({ id }) => id);
  const resultList = Array.isArray(results) ? results : [];
  if (!Array.isArray(results))
    errors.push(error("malformed-chain", "E2E result evidence is malformed."));

  const resultsByChain = new Map();
  for (const result of resultList) {
    const chainId = result?.chainId;
    if (!E2E_CHAIN_IDS.includes(chainId)) {
      errors.push(
        error(
          chainId === undefined ? "malformed-chain" : "unknown-chain",
          "E2E result names an unknown or absent chain.",
          chainId,
        ),
      );
      continue;
    }
    if (!expectedChainIds.includes(chainId)) {
      errors.push(
        error("unknown-chain", "E2E result chain was not expected.", chainId),
      );
      continue;
    }
    const existing = resultsByChain.get(chainId) ?? [];
    existing.push(result);
    resultsByChain.set(chainId, existing);
  }

  const chainSummaries = [];
  const recoveredFlakes = [];
  const finalFailures = [];
  for (const expected of planValidation.expectedChains) {
    const matches = resultsByChain.get(expected.id) ?? [];
    if (matches.length === 0) {
      errors.push(
        error(
          "missing-chain",
          "Expected E2E chain manifest is absent.",
          expected.id,
        ),
      );
      if (plan?.planner?.forcedFull) {
        finalFailures.push({
          chainId: expected.id,
          suite: null,
          classification: "indeterminate",
        });
      }
      continue;
    }
    if (matches.length > 1) {
      errors.push(
        error(
          "duplicate-chain",
          "Expected E2E chain has duplicate manifests.",
          expected.id,
        ),
      );
      continue;
    }
    const result = matches[0];
    const resultErrors = validateResult(result, expected, plan.planner);
    errors.push(...resultErrors);
    for (const suite of result.recoveredFlakes ?? []) {
      recoveredFlakes.push({ chainId: expected.id, suite });
    }
    if (result.result === "failed" || result.result === "cancelled") {
      const suite = expected.suiteIds.includes(result.finalFailedSuite)
        ? result.finalFailedSuite
        : null;
      let classification = "indeterminate";
      if (suite !== null && plan.planner.forcedFull) {
        classification = plan.planner.riskSelectedSuites.includes(suite)
          ? "covered-by-risk-selection"
          : "routing-gap";
      }
      finalFailures.push({ chainId: expected.id, suite, classification });
    }
    chainSummaries.push({
      chainId: expected.id,
      selectedSuites: result.selectedSuites,
      result: result.result,
      runnerWallTimeMs: result.runnerWallTimeMs,
      testOnlyTimeMs: result.testOnlyTimeMs,
      attempts: result.attempts,
      phaseCount: result.phaseCount,
      processCount: result.processCount,
      cleanupState: result.cleanup?.state,
    });
  }

  const terminalResults = chainSummaries.filter(({ runnerWallTimeMs }) =>
    Number.isFinite(runnerWallTimeMs),
  );
  const status =
    errors.length > 0
      ? "failed"
      : expectedChainIds.length === 0
        ? "skipped"
        : "passed";
  return {
    schemaVersion: E2E_CI_ANALYSIS_SCHEMA_VERSION,
    status,
    expectedChainIds,
    errors,
    chains: chainSummaries,
    totals: {
      parallelWallTimeMs: Math.max(
        0,
        ...terminalResults.map(({ runnerWallTimeMs }) => runnerWallTimeMs),
      ),
      summedRunnerWallTimeMs: terminalResults.reduce(
        (total, { runnerWallTimeMs }) => total + runnerWallTimeMs,
        0,
      ),
      testOnlyTimeMs: terminalResults.reduce(
        (total, { testOnlyTimeMs }) => total + testOnlyTimeMs,
        0,
      ),
      phaseCount: terminalResults.reduce(
        (total, { phaseCount }) => total + phaseCount,
        0,
      ),
      processCount: terminalResults.reduce(
        (total, { processCount }) => total + processCount,
        0,
      ),
      retries: terminalResults.reduce(
        (total, { attempts }) => total + attempts.retries,
        0,
      ),
      recoveredFlakes: recoveredFlakes.length,
    },
    routingAudit: { recoveredFlakes, finalFailures },
  };
}

function findResultFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const destination = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...findResultFiles(destination));
    else if (entry.isFile() && entry.name === "run-result.json")
      files.push(destination);
  }
  return files.sort();
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--plan-file") options.planFile = args[++index];
    else if (argument === "--results-directory")
      options.resultsDirectory = args[++index];
    else if (argument === "--analysis-file")
      options.analysisFile = args[++index];
    else throw new Error(`Unknown E2E result argument: ${String(argument)}`);
  }
  for (const [name, value] of Object.entries(options)) {
    if (typeof value !== "string" || !path.isAbsolute(value))
      throw new Error(`${name} requires an absolute path.`);
  }
  if (!options.planFile || !options.resultsDirectory || !options.analysisFile)
    throw new Error(
      "E2E result validation requires plan, results, and analysis paths.",
    );
  return options;
}

function markdownSummary(analysis) {
  const lines = [
    "## Tauri E2E aggregate",
    "",
    `Status: **${analysis.status}**`,
    "",
    `Expected chains: ${analysis.expectedChainIds.join(", ") || "none"}`,
    `Parallel runner wall time: ${analysis.totals.parallelWallTimeMs} ms`,
    `Summed test-only time: ${analysis.totals.testOnlyTimeMs} ms`,
    `Processes: ${analysis.totals.processCount}; retries: ${analysis.totals.retries}; recovered flakes: ${analysis.totals.recoveredFlakes}`,
  ];
  if (analysis.routingAudit.finalFailures.length > 0) {
    lines.push("", "Routing audit:");
    for (const failure of analysis.routingAudit.finalFailures) {
      lines.push(
        `- ${failure.chainId}/${failure.suite ?? "unknown"}: ${failure.classification}`,
      );
    }
  }
  if (analysis.errors.length > 0) {
    lines.push("", "Validation errors:");
    for (const issue of analysis.errors)
      lines.push(`- ${issue.code}: ${issue.message}`);
  }
  return `${lines.join("\n")}\n`;
}

function runCli() {
  const options = parseArguments(process.argv.slice(2));
  let plan;
  const results = [];
  try {
    const planMetadata = lstatSync(options.planFile);
    if (!planMetadata.isFile() || planMetadata.isSymbolicLink())
      throw new Error("Plan evidence is not a regular file.");
    plan = JSON.parse(readFileSync(options.planFile, "utf8"));
  } catch {
    plan = null;
  }
  try {
    for (const resultFile of findResultFiles(options.resultsDirectory)) {
      try {
        results.push(JSON.parse(readFileSync(resultFile, "utf8")));
      } catch {
        results.push({ source: resultFile, malformed: true });
      }
    }
  } catch {
    // An absent or unreadable result directory is equivalent to no terminal
    // manifests and is reported by the same fail-closed missing-chain path.
  }
  const analysis = analyzeE2eCiResults({ plan, results });
  mkdirSync(path.dirname(options.analysisFile), { recursive: true });
  writeFileSync(options.analysisFile, `${JSON.stringify(analysis, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdownSummary(analysis));
  console.log(JSON.stringify(analysis));
  if (analysis.status === "failed") process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runCli();
