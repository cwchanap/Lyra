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
  E2E_SUITE_IDS,
  buildE2ePhasePlan,
  e2eSuiteForPhase,
  normalizeE2eSuiteIds,
  partitionE2eSuitesByChain,
} from "./e2e-suite-registry.mjs";
import { E2E_CI_METRICS_SCHEMA_VERSION } from "./e2e-ci-metrics.mjs";
import { E2E_RUN_RESULT_SCHEMA_VERSION } from "./e2e-runner-lifecycle.mjs";

export const E2E_CI_ANALYSIS_SCHEMA_VERSION = 1;

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalTimestamp(value) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString() === value ? timestamp : null;
}

function outputDirectoryRunDirectory(value, { attempt, phase, root }) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    typeof phase !== "string" ||
    phase.length === 0 ||
    typeof root !== "string" ||
    root.length === 0 ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value
  ) {
    return null;
  }
  const rootDirectory = path.dirname(value);
  const attemptDirectory = path.dirname(rootDirectory);
  const outputsDirectory = path.dirname(attemptDirectory);
  const runDirectory = path.dirname(outputsDirectory);
  if (
    path.basename(value) !== phase ||
    path.basename(rootDirectory) !== root ||
    path.basename(attemptDirectory) !== `attempt-${attempt}` ||
    path.basename(outputsDirectory) !== "outputs" ||
    runDirectory === path.parse(runDirectory).root ||
    path.join(runDirectory, "outputs", `attempt-${attempt}`, root, phase) !==
      value
  ) {
    return null;
  }
  return runDirectory;
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
      plan.matrix.include.length !== 0 ||
      plan.planner.riskSelectedSuites.length !== 0 ||
      plan.planner.forcedFull !== false ||
      plan.planner.reason !== null
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

  if (plan.skip !== false) {
    errors.push(
      error("malformed-plan", "A non-empty E2E plan cannot be skipped."),
    );
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

  if (plan.planner.forcedFull) {
    if (
      !equalJson(canonicalSuites, E2E_SUITE_IDS) ||
      typeof plan.planner.reason !== "string" ||
      plan.planner.reason.trim().length === 0
    ) {
      errors.push(
        error(
          "malformed-plan",
          "Forced-full E2E plans require the full registry and a reason.",
        ),
      );
    }
  } else if (
    !equalJson(canonicalSuites, canonicalRiskSuites) ||
    plan.planner.reason !== null
  ) {
    errors.push(
      error(
        "malformed-plan",
        "Risk-selected E2E plans must match their canonical risk suites.",
      ),
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
      (entry) => entry?.chainId === expected.id,
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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validateMetricsRecord(metrics, chainId) {
  const errors = [];
  const malformed = (message) =>
    errors.push(error("malformed-metric", message, chainId));
  if (!isPlainObject(metrics)) {
    malformed("E2E metrics evidence is not an object.");
    return { errors, complete: false };
  }
  if (metrics.schemaVersion !== E2E_CI_METRICS_SCHEMA_VERSION)
    malformed("E2E metrics schema version is invalid.");
  if (metrics.chainId !== chainId)
    malformed("E2E metrics chain does not match the expected chain.");
  if (
    typeof metrics.source !== "string" ||
    metrics.source.length === 0 ||
    metrics.source.includes("\0") ||
    !path.isAbsolute(metrics.source) ||
    path.normalize(metrics.source) !== metrics.source ||
    path.basename(path.dirname(metrics.source)) !== "e2e-metrics" ||
    path.basename(metrics.source) !== `${chainId}.json`
  ) {
    malformed("E2E metrics evidence does not have the expected artifact path.");
  }
  const startedAtMsValid = isNonNegativeInteger(metrics.startedAtMs);
  if (!startedAtMsValid)
    malformed("E2E metrics start time must be a non-negative integer.");

  const hasSetup = hasOwn(metrics, "setup");
  const hasBuild = hasOwn(metrics, "build");
  const hasTest = hasOwn(metrics, "test");
  if (hasBuild && !hasSetup)
    malformed("E2E build metrics require completed setup metrics.");
  if (hasTest && !hasBuild)
    malformed("E2E test metrics require completed build metrics.");

  let setupValid = false;
  let setupFinishedAtMs = null;
  if (hasSetup) {
    const setup = metrics.setup;
    const setupShapeValid =
      isPlainObject(setup) &&
      isNonNegativeInteger(setup.finishedAtMs) &&
      isNonNegativeInteger(setup.durationMs) &&
      typeof setup.cacheHit === "boolean" &&
      isNonNegativeInteger(setup.restoredCacheBytes);
    if (!setupShapeValid) {
      malformed("E2E setup metrics are malformed.");
    } else if (
      !startedAtMsValid ||
      setup.finishedAtMs < metrics.startedAtMs ||
      setup.durationMs !== setup.finishedAtMs - metrics.startedAtMs
    ) {
      malformed("E2E setup metrics have an invalid duration or ordering.");
    } else {
      setupValid = true;
      setupFinishedAtMs = setup.finishedAtMs;
    }
  }

  let buildValid = false;
  let buildFinishedAtMs = null;
  let buildExitCode = null;
  if (hasBuild) {
    const build = metrics.build;
    const buildShapeValid =
      isPlainObject(build) &&
      isNonNegativeInteger(build.startedAtMs) &&
      isNonNegativeInteger(build.finishedAtMs) &&
      isNonNegativeInteger(build.durationMs) &&
      isNonNegativeInteger(build.exitCode);
    if (!buildShapeValid) {
      malformed("E2E build metrics are malformed.");
    } else if (
      !setupValid ||
      build.startedAtMs < setupFinishedAtMs ||
      build.finishedAtMs < build.startedAtMs ||
      build.durationMs !== build.finishedAtMs - build.startedAtMs
    ) {
      malformed("E2E build metrics have an invalid duration or ordering.");
    } else {
      buildValid = true;
      buildFinishedAtMs = build.finishedAtMs;
      buildExitCode = build.exitCode;
    }
  }

  let testValid = false;
  let testExitCode = null;
  if (hasTest) {
    const test = metrics.test;
    const testShapeValid =
      isPlainObject(test) &&
      isNonNegativeInteger(test.startedAtMs) &&
      isNonNegativeInteger(test.finishedAtMs) &&
      isNonNegativeInteger(test.durationMs) &&
      isNonNegativeInteger(test.exitCode);
    if (!testShapeValid) {
      malformed("E2E test metrics are malformed.");
    } else if (
      !buildValid ||
      buildExitCode !== 0 ||
      test.startedAtMs < buildFinishedAtMs ||
      test.finishedAtMs < test.startedAtMs ||
      test.durationMs !== test.finishedAtMs - test.startedAtMs
    ) {
      malformed("E2E test metrics have an invalid duration or ordering.");
    } else {
      testValid = true;
      testExitCode = test.exitCode;
    }
  }

  return {
    errors,
    complete:
      hasSetup && hasBuild && hasTest && setupValid && buildValid && testValid,
    buildExitCode,
    testExitCode,
  };
}

function validateResult(result, expected, planner) {
  const evidenceErrors = [];
  const chainId = expected.id;
  const malformed = (message) =>
    evidenceErrors.push(error("malformed-chain", message, chainId));
  const phaseResults = Array.isArray(result?.phaseResults)
    ? result.phaseResults
    : [];
  const firstAttemptFailures = Array.isArray(result?.firstAttemptFailures)
    ? result.firstAttemptFailures
    : [];
  const recoveredFlakes = Array.isArray(result?.recoveredFlakes)
    ? result.recoveredFlakes
    : [];
  const cleanupAttempts = Array.isArray(result?.cleanup?.attempts)
    ? result.cleanup.attempts
    : [];
  const attempts = result?.attempts;
  const ordinaryAttemptsValid =
    attempts !== null &&
    typeof attempts === "object" &&
    [1, 2].includes(attempts.configured) &&
    Number.isInteger(attempts.used) &&
    attempts.used >= 1 &&
    attempts.used <= attempts.configured &&
    attempts.retries === attempts.used - 1;
  const terminalResult = result?.result;
  const cancelledExitValid = [130, 143].includes(result?.exitCode);
  const zeroAttemptEnvelope =
    result?.suite === null &&
    result?.attempt === null &&
    result?.durationMs === 0 &&
    result?.testOnlyTimeMs === 0 &&
    result?.phaseCount === 0 &&
    result?.processCount === 0 &&
    attempts !== null &&
    typeof attempts === "object" &&
    [1, 2].includes(attempts.configured) &&
    attempts.used === 0 &&
    attempts.retries === 0 &&
    firstAttemptFailures.length === 0 &&
    recoveredFlakes.length === 0 &&
    result?.finalFailedSuite === null &&
    phaseResults.length === 0 &&
    result?.cleanup?.state === "not-required" &&
    Array.isArray(result?.cleanup?.attempts) &&
    cleanupAttempts.length === 0;
  const binaryGuardManifest =
    ["failed", "cancelled"].includes(terminalResult) &&
    result?.phase === "binary-guard" &&
    zeroAttemptEnvelope;
  const guardInvocationFailureManifest =
    result?.phase === null &&
    zeroAttemptEnvelope &&
    ((terminalResult === "failed" && result?.exitCode === 1) ||
      (terminalResult === "cancelled" && cancelledExitValid));
  const noAttemptCleanup =
    result?.cleanup?.state === "not-required" &&
    Array.isArray(result?.cleanup?.attempts) &&
    cleanupAttempts.length === 0;
  const singleAttemptCleanup =
    Array.isArray(result?.cleanup?.attempts) &&
    cleanupAttempts.length === 1 &&
    cleanupAttempts[0]?.attempt === 1 &&
    ["removed", "failed"].includes(cleanupAttempts[0]?.state) &&
    result?.cleanup?.state === cleanupAttempts[0].state;
  const prePhaseTerminalManifest =
    ((terminalResult === "failed" && result?.exitCode === 1) ||
      (terminalResult === "cancelled" && cancelledExitValid)) &&
    result?.phase === null &&
    result?.suite === null &&
    result?.attempt === null &&
    result?.durationMs === 0 &&
    result?.testOnlyTimeMs === 0 &&
    result?.phaseCount === 0 &&
    result?.processCount === 0 &&
    ordinaryAttemptsValid &&
    attempts.used === 1 &&
    firstAttemptFailures.length === 0 &&
    recoveredFlakes.length === 0 &&
    result?.finalFailedSuite === null &&
    phaseResults.length === 0 &&
    (noAttemptCleanup || singleAttemptCleanup);
  const phaseAttemptManifest =
    ordinaryAttemptsValid && !prePhaseTerminalManifest;
  const zeroAttemptTerminalManifest =
    binaryGuardManifest || guardInvocationFailureManifest;
  const attemptsValid = ordinaryAttemptsValid || zeroAttemptTerminalManifest;
  const runnerStart = canonicalTimestamp(result?.start);
  const runnerFinish = canonicalTimestamp(result?.finish);
  const terminalExitValid =
    Number.isInteger(result?.exitCode) &&
    ((terminalResult === "passed" && result.exitCode === 0) ||
      (terminalResult === "failed" && result.exitCode !== 0) ||
      (terminalResult === "cancelled" && cancelledExitValid));
  if (
    !result ||
    typeof result !== "object" ||
    result.schemaVersion !== E2E_RUN_RESULT_SCHEMA_VERSION ||
    typeof result.runId !== "string" ||
    result.runId.length === 0 ||
    result.chainId !== chainId ||
    !["passed", "failed", "cancelled"].includes(terminalResult) ||
    !terminalExitValid ||
    runnerStart === null ||
    runnerFinish === null ||
    runnerStart > runnerFinish ||
    !Number.isInteger(result.durationMs) ||
    result.durationMs < 0 ||
    !Number.isInteger(result.runnerWallTimeMs) ||
    result.runnerWallTimeMs < 0 ||
    !Number.isInteger(result.testOnlyTimeMs) ||
    result.testOnlyTimeMs < 0 ||
    result.runnerWallTimeMs < result.testOnlyTimeMs ||
    !Number.isInteger(result.phaseCount) ||
    result.phaseCount < 0 ||
    !Number.isInteger(result.processCount) ||
    result.processCount < 0 ||
    !Array.isArray(result.phaseResults) ||
    result.phaseCount !== phaseResults.length ||
    result.processCount !== phaseResults.length ||
    !attemptsValid ||
    !Array.isArray(result.firstAttemptFailures) ||
    !Array.isArray(result.recoveredFlakes)
  ) {
    malformed("E2E chain manifest is malformed.");
  }

  if (!equalJson(result?.selectedSuites, expected.suiteIds)) {
    evidenceErrors.push(
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
    evidenceErrors.push(
      error(
        "malformed-chain",
        "E2E chain planner metadata does not match the plan.",
        chainId,
      ),
    );
  }

  const selectedSuites = new Set(expected.suiteIds);
  const canonicalPhases = buildE2ePhasePlan(expected.suiteIds, {}).map(
    ({ id, root }) => ({ phase: id, suite: e2eSuiteForPhase(id), root }),
  );
  const canonicalById = new Map(
    canonicalPhases.map((phase) => [phase.phase, phase]),
  );
  let phasesValid = true;
  let phaseRunDirectory = null;
  let previousPhaseFinish = null;
  for (const phaseResult of phaseResults) {
    const canonical = canonicalById.get(phaseResult?.phase);
    const phaseStart = canonicalTimestamp(phaseResult?.start);
    const phaseFinish = canonicalTimestamp(phaseResult?.finish);
    const outputRunDirectory = outputDirectoryRunDirectory(
      phaseResult?.outputDirectory,
      {
        attempt: phaseResult?.attempt,
        phase: phaseResult?.phase,
        root: canonical?.root,
      },
    );
    const outputRunDirectoryMatches =
      outputRunDirectory !== null &&
      (phaseRunDirectory === null || phaseRunDirectory === outputRunDirectory);
    const exitValid =
      Number.isInteger(phaseResult?.exitCode) &&
      ((phaseResult?.result === "passed" && phaseResult.exitCode === 0) ||
        (phaseResult?.result === "failed" && phaseResult.exitCode !== 0));
    if (
      !phaseResult ||
      canonical?.suite !== phaseResult.suite ||
      !selectedSuites.has(phaseResult.suite) ||
      !Number.isInteger(phaseResult.attempt) ||
      phaseResult.attempt < 1 ||
      (phaseAttemptManifest && phaseResult.attempt > attempts.used) ||
      !Number.isInteger(phaseResult.durationMs) ||
      phaseResult.durationMs < 0 ||
      !["passed", "failed"].includes(phaseResult.result) ||
      !exitValid ||
      phaseStart === null ||
      phaseFinish === null ||
      phaseStart > phaseFinish ||
      (phaseStart !== null &&
        phaseFinish !== null &&
        phaseResult.durationMs > phaseFinish - phaseStart) ||
      (previousPhaseFinish !== null &&
        phaseStart !== null &&
        phaseStart < previousPhaseFinish) ||
      (runnerStart !== null && phaseStart < runnerStart) ||
      (runnerFinish !== null && phaseFinish > runnerFinish) ||
      !outputRunDirectoryMatches
    ) {
      phasesValid = false;
    }
    if (phaseRunDirectory === null && outputRunDirectory !== null) {
      phaseRunDirectory = outputRunDirectory;
    }
    if (phaseFinish !== null) previousPhaseFinish = phaseFinish;
  }
  if (!phasesValid)
    malformed("E2E chain phase evidence is malformed or non-canonical.");

  const durationSum = phaseResults.reduce(
    (total, phaseResult) =>
      total +
      (Number.isFinite(phaseResult?.durationMs) ? phaseResult.durationMs : 0),
    0,
  );
  if (result?.testOnlyTimeMs !== durationSum)
    malformed("E2E test-only timing does not match phase evidence.");

  let attemptGroups = [];
  if (phaseAttemptManifest && phasesValid) {
    attemptGroups = Array.from({ length: attempts.used }, (_, index) =>
      phaseResults.filter(({ attempt }) => attempt === index + 1),
    );
    const phasesInAttemptOrder = attemptGroups.flat();
    if (
      phasesInAttemptOrder.length !== phaseResults.length ||
      phaseResults.some(
        (phaseResult, index) => phaseResult !== phasesInAttemptOrder[index],
      )
    ) {
      malformed("E2E phase evidence is outside represented attempt order.");
    }
    for (let index = 0; index < attemptGroups.length; index += 1) {
      const group = attemptGroups[index];
      const signature = group.map(({ phase, suite }) => ({ phase, suite }));
      const expectedPrefix = canonicalPhases
        .slice(0, group.length)
        .map(({ phase, suite }) => ({ phase, suite }));
      const failedIndexes = group.flatMap(
        ({ result: phaseResult }, phaseIndex) =>
          phaseResult === "failed" ? [phaseIndex] : [],
      );
      if (
        group.length > canonicalPhases.length ||
        !equalJson(signature, expectedPrefix) ||
        failedIndexes.some((phaseIndex) => phaseIndex !== group.length - 1) ||
        failedIndexes.length > 1
      ) {
        malformed(
          "E2E attempt phases are missing, reordered, or contradictory.",
        );
        break;
      }
    }
  }

  const firstAttemptGroup = attemptGroups[0] ?? [];
  const recordedFirstAttemptFailures = firstAttemptGroup
    .filter(({ result: phaseResult }) => phaseResult === "failed")
    .map(({ phase, suite, exitCode }) => ({ phase, suite, exitCode }));
  const firstUnrecordedPhase = canonicalPhases[firstAttemptGroup.length];
  const unrecordedFirstAttemptFailure =
    ordinaryAttemptsValid &&
    firstAttemptGroup.every(
      ({ result: phaseResult }) => phaseResult === "passed",
    ) &&
    firstAttemptFailures.length === 1 &&
    firstAttemptFailures[0]?.phase === firstUnrecordedPhase?.phase &&
    firstAttemptFailures[0]?.suite === firstUnrecordedPhase?.suite &&
    firstAttemptFailures[0]?.exitCode === 1;
  const firstAttemptEvidenceValid =
    equalJson(firstAttemptFailures, recordedFirstAttemptFailures) ||
    unrecordedFirstAttemptFailure;
  if (!firstAttemptEvidenceValid)
    malformed("E2E first-attempt failure evidence is inconsistent.");

  const expectedRecoveredFlakes =
    terminalResult === "passed" &&
    ordinaryAttemptsValid &&
    attempts.used > 1 &&
    firstAttemptEvidenceValid
      ? [...new Set(firstAttemptFailures.map(({ suite }) => suite))]
      : [];
  if (!equalJson(recoveredFlakes, expectedRecoveredFlakes))
    malformed("E2E recovered-flake evidence is inconsistent.");

  const finalGroup = attemptGroups.at(-1) ?? [];
  const finalPhase = finalGroup.at(-1);
  const finalUnrecordedPhase = canonicalPhases[finalGroup.length];
  const lastRecordedPhase = phaseResults.at(-1);
  const retainedRecordedPhaseSummary =
    lastRecordedPhase !== null &&
    typeof lastRecordedPhase === "object" &&
    result?.phase === lastRecordedPhase.phase &&
    result?.suite === lastRecordedPhase.suite &&
    result?.attempt === lastRecordedPhase.attempt &&
    result?.durationMs === lastRecordedPhase.durationMs;
  const retainedFirstSetupSummary =
    unrecordedFirstAttemptFailure &&
    result?.phase === firstUnrecordedPhase?.phase &&
    result?.suite === firstUnrecordedPhase?.suite &&
    result?.attempt === 1 &&
    result?.durationMs === (lastRecordedPhase?.durationMs ?? 0);
  const retryPrePhaseTerminalManifest =
    phaseAttemptManifest &&
    attempts.configured === 2 &&
    attempts.used === 2 &&
    finalGroup.length === 0 &&
    ((terminalResult === "failed" && result?.exitCode === 1) ||
      (terminalResult === "cancelled" && cancelledExitValid)) &&
    result?.finalFailedSuite === null &&
    (retainedRecordedPhaseSummary || retainedFirstSetupSummary);

  if (phaseAttemptManifest) {
    const expectedCleanupAttempts = Array.from(
      { length: attempts.used },
      (_, index) => index + 1,
    );
    const cleanupNumbers = cleanupAttempts.map((entry) => entry?.attempt);
    const cleanupStatesValid = cleanupAttempts.every((entry) =>
      ["removed", "failed"].includes(entry?.state),
    );
    const derivedCleanupState = cleanupAttempts.some(
      (entry) => entry?.state === "failed",
    )
      ? "failed"
      : "removed";
    const cleanupNumbersValid =
      equalJson(cleanupNumbers, expectedCleanupAttempts) ||
      (retryPrePhaseTerminalManifest &&
        equalJson(cleanupNumbers, expectedCleanupAttempts.slice(0, -1)));
    const cleanupEvidenceValid =
      cleanupNumbersValid &&
      cleanupStatesValid &&
      result?.cleanup?.state === derivedCleanupState;
    if (!cleanupEvidenceValid) {
      malformed("E2E cleanup attempts do not match represented attempts.");
    }
  }

  if (phaseAttemptManifest && phasesValid) {
    for (let index = 0; index < attemptGroups.length - 1; index += 1) {
      const group = attemptGroups[index];
      const phaseFailed = group.at(-1)?.result === "failed";
      const setupFailed = index === 0 && unrecordedFirstAttemptFailure;
      const cleanupFailed = cleanupAttempts[index]?.state === "failed";
      if (!phaseFailed && !setupFailed && !cleanupFailed) {
        malformed("E2E retry has no producer-recorded failure cause.");
      }
    }
  }

  const terminalSetupContextMatches =
    phaseAttemptManifest &&
    finalGroup.every(({ result: phaseResult }) => phaseResult === "passed") &&
    result?.phase === finalUnrecordedPhase?.phase &&
    result?.suite === finalUnrecordedPhase?.suite &&
    result?.attempt === attempts.used &&
    result?.durationMs === (phaseResults.at(-1)?.durationMs ?? 0);
  const terminalSetupFailure =
    terminalSetupContextMatches &&
    terminalResult === "failed" &&
    result?.exitCode === 1 &&
    result?.finalFailedSuite === finalUnrecordedPhase?.suite;
  const terminalCancelledSetupFailure =
    terminalSetupContextMatches &&
    terminalResult === "cancelled" &&
    cancelledExitValid &&
    result?.finalFailedSuite === null;
  const terminalPhaseSummaryMatches =
    finalPhase !== undefined &&
    result?.phase === finalPhase.phase &&
    result?.suite === finalPhase.suite &&
    result?.attempt === finalPhase.attempt &&
    result?.durationMs === finalPhase.durationMs;
  const emptyCancellationSummary =
    terminalResult === "cancelled" &&
    finalPhase === undefined &&
    result?.phase === null &&
    result?.suite === null &&
    result?.attempt === null &&
    result?.durationMs === 0;
  if (
    phaseAttemptManifest &&
    !terminalSetupFailure &&
    !terminalCancelledSetupFailure &&
    !retryPrePhaseTerminalManifest &&
    !terminalPhaseSummaryMatches &&
    !emptyCancellationSummary
  ) {
    malformed("E2E terminal phase summary is inconsistent.");
  }

  const terminalFailedPhase =
    terminalPhaseSummaryMatches && finalPhase?.result === "failed";
  if (
    terminalFailedPhase &&
    terminalResult === "failed" &&
    result.exitCode !== finalPhase.exitCode
  ) {
    malformed("E2E terminal exit code disagrees with its failed final phase.");
  }
  if (
    phaseAttemptManifest &&
    terminalResult === "failed" &&
    terminalFailedPhase &&
    attempts.used !== attempts.configured
  ) {
    malformed("E2E terminal phase failure did not exhaust configured retries.");
  }

  if (phaseAttemptManifest && phasesValid) {
    const finalCleanupFailed = cleanupAttempts.at(-1)?.state === "failed";
    if (
      terminalResult === "passed" &&
      (finalGroup.length !== canonicalPhases.length ||
        finalGroup.some(({ result: phaseResult }) => phaseResult !== "passed"))
    ) {
      evidenceErrors.push(
        error(
          "incomplete-chain",
          "E2E chain omitted or failed a mandatory final-attempt phase.",
          chainId,
        ),
      );
    } else if (
      terminalResult === "failed" &&
      !terminalFailedPhase &&
      !terminalSetupFailure &&
      !retryPrePhaseTerminalManifest &&
      !finalCleanupFailed
    ) {
      malformed("E2E terminal result does not match its final phase.");
    }
  }

  const cleanupNotRequired =
    zeroAttemptTerminalManifest ||
    (prePhaseTerminalManifest && noAttemptCleanup);
  const cleanupProvesRemoval =
    result?.cleanup?.state === "removed" &&
    Array.isArray(result?.cleanup?.attempts) &&
    result.cleanup.attempts.length > 0 &&
    result.cleanup.attempts.every((entry) => entry?.state === "removed");
  if (!cleanupNotRequired && !cleanupProvesRemoval) {
    evidenceErrors.push(
      error(
        "cleanup-failed",
        "E2E chain did not prove guarded root cleanup.",
        chainId,
      ),
    );
  }

  const expectedFinalFailedSuite =
    terminalResult === "failed"
      ? terminalFailedPhase
        ? finalPhase.suite
        : terminalSetupFailure
          ? finalUnrecordedPhase.suite
          : null
      : null;
  if (result?.finalFailedSuite !== expectedFinalFailedSuite) {
    evidenceErrors.push(
      error(
        "malformed-chain",
        "E2E final failure evidence is malformed.",
        chainId,
      ),
    );
  }
  const errors = [...evidenceErrors];
  const routingSuite =
    evidenceErrors.length === 0 &&
    terminalResult === "failed" &&
    terminalFailedPhase &&
    finalPhase.suite === result.finalFailedSuite
      ? result.finalFailedSuite
      : null;
  if (terminalResult === "cancelled") {
    errors.push(error("cancelled-chain", "E2E chain was cancelled.", chainId));
  } else if (terminalResult === "failed") {
    errors.push(error("failed-chain", "E2E chain failed.", chainId));
  }
  return {
    errors,
    routingSuite,
    recoveredFlakes: evidenceErrors.length === 0 ? expectedRecoveredFlakes : [],
  };
}

export function analyzeE2eCiResults({ plan, results, metrics = [] }) {
  const planValidation = validatePlanner(plan);
  const errors = [...planValidation.errors];
  const expectedChainIds = planValidation.expectedChains.map(({ id }) => id);
  const resultList = Array.isArray(results) ? results : [];
  const metricsList = Array.isArray(metrics) ? metrics : [];
  if (!Array.isArray(results))
    errors.push(error("malformed-chain", "E2E result evidence is malformed."));
  if (!Array.isArray(metrics))
    errors.push(
      error("malformed-metric", "E2E metrics evidence is malformed."),
    );

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

  const metricsByChain = new Map();
  for (const metricsRecord of metricsList) {
    if (!isPlainObject(metricsRecord) || metricsRecord.malformed === true) {
      errors.push(
        error("malformed-metric", "E2E metrics evidence is malformed."),
      );
      continue;
    }
    const chainId = metricsRecord.chainId;
    if (
      !E2E_CHAIN_IDS.includes(chainId) ||
      !expectedChainIds.includes(chainId)
    ) {
      errors.push(
        error(
          "unknown-metric",
          "E2E metrics evidence names an unexpected chain.",
          typeof chainId === "string" ? chainId : undefined,
        ),
      );
      continue;
    }
    const existing = metricsByChain.get(chainId) ?? [];
    existing.push(metricsRecord);
    metricsByChain.set(chainId, existing);
  }

  const chainSummaries = [];
  const recoveredFlakes = [];
  const finalFailures = [];
  for (const expected of planValidation.expectedChains) {
    const resultMatches = resultsByChain.get(expected.id) ?? [];
    let result = null;
    let resultValidation = null;
    if (resultMatches.length === 0) {
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
    } else if (resultMatches.length > 1) {
      errors.push(
        error(
          "duplicate-chain",
          "Expected E2E chain has duplicate manifests.",
          expected.id,
        ),
      );
    } else {
      result = resultMatches[0];
      resultValidation = validateResult(result, expected, plan.planner);
      errors.push(...resultValidation.errors);
      for (const suite of resultValidation.recoveredFlakes) {
        recoveredFlakes.push({ chainId: expected.id, suite });
      }
      if (result.result === "failed" || result.result === "cancelled") {
        const suite = resultValidation.routingSuite;
        let classification = "indeterminate";
        if (
          suite !== null &&
          planValidation.errors.length === 0 &&
          plan.planner.forcedFull
        ) {
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
        attempts:
          result.attempts !== null && typeof result.attempts === "object"
            ? result.attempts
            : null,
        phaseCount: Number.isInteger(result.phaseCount) ? result.phaseCount : 0,
        processCount: Number.isInteger(result.processCount)
          ? result.processCount
          : 0,
        cleanupState: result.cleanup?.state,
      });
    }

    const metricMatches = metricsByChain.get(expected.id) ?? [];
    if (metricMatches.length === 0) {
      errors.push(
        error(
          "missing-metric",
          "Expected E2E chain metrics evidence is absent.",
          expected.id,
        ),
      );
      continue;
    }
    if (metricMatches.length > 1) {
      errors.push(
        error(
          "duplicate-metric",
          "Expected E2E chain has duplicate metrics manifests.",
          expected.id,
        ),
      );
      continue;
    }
    const metricsValidation = validateMetricsRecord(
      metricMatches[0],
      expected.id,
    );
    errors.push(...metricsValidation.errors);
    if (
      result !== null &&
      resultValidation !== null &&
      result.result === "passed" &&
      resultValidation.errors.length === 0 &&
      metricsValidation.errors.length === 0 &&
      (!metricsValidation.complete ||
        metricsValidation.buildExitCode !== 0 ||
        metricsValidation.testExitCode !== 0)
    ) {
      errors.push(
        error(
          "incomplete-metric",
          "A passed E2E chain requires complete successful setup, build, and test metrics.",
          expected.id,
        ),
      );
    }
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
        (total, { attempts }) =>
          total + (Number.isInteger(attempts?.retries) ? attempts.retries : 0),
        0,
      ),
      recoveredFlakes: recoveredFlakes.length,
    },
    routingAudit: { recoveredFlakes, finalFailures },
  };
}

function findEvidenceFiles(directory, predicate) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const destination = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory())
      files.push(...findEvidenceFiles(destination, predicate));
    else if (entry.isFile() && predicate(destination)) files.push(destination);
  }
  return files.sort();
}

function findResultFiles(directory) {
  return findEvidenceFiles(
    directory,
    (file) => path.basename(file) === "run-result.json",
  );
}

function findMetricFiles(directory) {
  return findEvidenceFiles(
    directory,
    (file) =>
      path.basename(path.dirname(file)) === "e2e-metrics" &&
      path.extname(file) === ".json",
  );
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
  const metrics = [];
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
    for (const metricsFile of findMetricFiles(options.resultsDirectory)) {
      const chainId = path.basename(metricsFile, ".json");
      try {
        const parsed = JSON.parse(readFileSync(metricsFile, "utf8"));
        metrics.push(
          isPlainObject(parsed)
            ? { ...parsed, source: metricsFile }
            : { chainId, malformed: true, source: metricsFile },
        );
      } catch {
        metrics.push({ chainId, malformed: true, source: metricsFile });
      }
    }
  } catch {
    // An absent or unreadable result directory is equivalent to no terminal
    // manifests and is reported by the same fail-closed missing-chain path.
  }
  const analysis = analyzeE2eCiResults({ plan, results, metrics });
  mkdirSync(path.dirname(options.analysisFile), { recursive: true });
  writeFileSync(options.analysisFile, `${JSON.stringify(analysis, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdownSummary(analysis));
  console.log(JSON.stringify(analysis));
  if (analysis.status === "failed") process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runCli();
