import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  assertSafeSaveE2eAppDataDir,
  removeSaveE2eAppDataDir,
} from "./save-e2e-paths.mjs";

export const E2E_RUN_OWNERSHIP_SCHEMA_VERSION = 1;
export const E2E_RUN_RESULT_SCHEMA_VERSION = 2;
const ROOT_OWNERSHIP_MARKER = ".lyra-e2e-runner-owner.json";

function ownershipError() {
  return new Error("Invalid e2e run ownership manifest.");
}

function writeJsonAtomically(destination, value) {
  mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, destination);
}

function validateCleanup(cleanup, { allowMissingRoot = false } = {}) {
  if (!cleanup || typeof cleanup !== "object") throw ownershipError();
  if (cleanup.state === "pending") return;
  if (
    allowMissingRoot &&
    ["removed", "failed"].includes(cleanup.state) &&
    typeof cleanup.finishedAt === "string"
  )
    return;
  throw ownershipError();
}

function validateOwnership(ownership, { allowMissingRoots = false } = {}) {
  if (
    !ownership ||
    typeof ownership !== "object" ||
    ownership.schemaVersion !== E2E_RUN_OWNERSHIP_SCHEMA_VERSION ||
    typeof ownership.runId !== "string" ||
    ownership.runId.length === 0 ||
    !Array.isArray(ownership.roots)
  ) {
    throw ownershipError();
  }

  const keys = new Set();
  const roots = new Set();
  for (const entry of ownership.roots) {
    if (
      !entry ||
      typeof entry.key !== "string" ||
      entry.key.length === 0 ||
      typeof entry.appDataDir !== "string" ||
      keys.has(entry.key) ||
      roots.has(entry.appDataDir)
    ) {
      throw ownershipError();
    }
    keys.add(entry.key);
    roots.add(entry.appDataDir);
    validateCleanup(entry.cleanup, { allowMissingRoot: allowMissingRoots });
    if (entry.cleanup.state === "pending") {
      assertSafeSaveE2eAppDataDir(entry.appDataDir);
    }
  }
  return ownership;
}

function writeRootOwnershipMarker(entry, runId) {
  const root = assertSafeSaveE2eAppDataDir(entry.appDataDir);
  writeFileSync(
    path.join(root, ROOT_OWNERSHIP_MARKER),
    `${JSON.stringify({ schemaVersion: E2E_RUN_OWNERSHIP_SCHEMA_VERSION, runId, key: entry.key })}\n`,
  );
}

function assertRootOwnershipMarker(entry, runId) {
  const root = assertSafeSaveE2eAppDataDir(entry.appDataDir);
  const markerPath = path.join(root, ROOT_OWNERSHIP_MARKER);
  let metadata;
  let marker;
  try {
    metadata = lstatSync(markerPath);
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    throw ownershipError();
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    marker?.schemaVersion !== E2E_RUN_OWNERSHIP_SCHEMA_VERSION ||
    marker.runId !== runId ||
    marker.key !== entry.key
  ) {
    throw ownershipError();
  }
  return root;
}

export function createRunId() {
  return randomUUID();
}

export function writeRunOwnership(ownershipPath, ownership) {
  validateOwnership(ownership, { allowMissingRoots: true });
  writeJsonAtomically(ownershipPath, ownership);
}

export function readRunOwnership(ownershipPath) {
  let metadata;
  try {
    metadata = lstatSync(ownershipPath);
  } catch {
    throw ownershipError();
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw ownershipError();
  let ownership;
  try {
    ownership = JSON.parse(readFileSync(ownershipPath, "utf8"));
  } catch {
    throw ownershipError();
  }
  return validateOwnership(ownership, { allowMissingRoots: true });
}

export function createRunOwnership({
  ownershipPath,
  runId = createRunId(),
  rootKeys,
  createRoot,
  startedAt = new Date().toISOString(),
  writeOwnership = writeRunOwnership,
  writeRootMarker = writeRootOwnershipMarker,
  removeRoot = removeSaveE2eAppDataDir,
  now = () => new Date().toISOString(),
}) {
  if (
    typeof ownershipPath !== "string" ||
    !Array.isArray(rootKeys) ||
    rootKeys.length === 0 ||
    new Set(rootKeys).size !== rootKeys.length ||
    rootKeys.some((key) => typeof key !== "string" || key.length === 0) ||
    typeof createRoot !== "function"
  ) {
    throw ownershipError();
  }
  const ownership = {
    schemaVersion: E2E_RUN_OWNERSHIP_SCHEMA_VERSION,
    runId,
    startedAt,
    roots: [],
  };
  writeOwnership(ownershipPath, ownership);
  for (const key of rootKeys) {
    let entry;
    try {
      const appDataDir = assertSafeSaveE2eAppDataDir(createRoot());
      entry = {
        key,
        appDataDir,
        cleanup: { state: "pending" },
      };
      // Persist the allocation before marker initialization so cleanup has an
      // authoritative record even if an initialization write fails.
      ownership.roots.push(entry);
      writeOwnership(ownershipPath, ownership);
      writeRootMarker(entry, runId);
    } catch (error) {
      if (entry) {
        try {
          removeRoot(assertSafeSaveE2eAppDataDir(entry.appDataDir));
          entry.cleanup = { state: "removed", finishedAt: now() };
        } catch (cleanupError) {
          entry.cleanup = {
            state: "failed",
            finishedAt: now(),
            message:
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError),
          };
        }
        // A failed initial manifest write is retried after guarded rollback,
        // so diagnostics still say whether the freshly allocated root was
        // removed. Do not replace the initialization failure if this record
        // write itself cannot be recovered.
        try {
          writeOwnership(ownershipPath, ownership);
        } catch (recordError) {
          console.error(
            "e2e ownership rollback could not be recorded:",
            recordError,
          );
        }
      }
      throw error;
    }
  }
  return ownership;
}

export function ownedRootByKey(ownership, key) {
  validateOwnership(ownership, { allowMissingRoots: true });
  const root = ownership.roots.find((entry) => entry.key === key);
  if (!root || root.cleanup.state !== "pending") throw ownershipError();
  return root.appDataDir;
}

export function createAttemptOutputDirectory({
  runDirectory,
  rootKey,
  phase,
  attempt,
}) {
  if (
    typeof runDirectory !== "string" ||
    typeof rootKey !== "string" ||
    typeof phase !== "string" ||
    !Number.isInteger(attempt) ||
    attempt < 1
  ) {
    throw new Error("Invalid e2e runner output directory.");
  }
  const outputDirectory = path.join(
    runDirectory,
    "outputs",
    `attempt-${attempt}`,
    rootKey,
    phase,
  );
  mkdirSync(outputDirectory, { recursive: true });
  return outputDirectory;
}

export function cleanupOwnedE2eRoots(
  ownershipPath,
  {
    removeRoot = removeSaveE2eAppDataDir,
    now = () => new Date().toISOString(),
  } = {},
) {
  const ownership = readRunOwnership(ownershipPath);
  const errors = [];
  for (const entry of ownership.roots) {
    if (entry.cleanup.state !== "pending") continue;
    try {
      // This is intentionally the only cleanup target source: no caller may
      // append a foreign root to a post-run cleanup request.
      removeRoot(assertRootOwnershipMarker(entry, ownership.runId));
      entry.cleanup = { state: "removed", finishedAt: now() };
    } catch (error) {
      entry.cleanup = {
        state: "failed",
        finishedAt: now(),
        message: error instanceof Error ? error.message : String(error),
      };
      writeRunOwnership(ownershipPath, ownership);
      errors.push(error);
      continue;
    }
    writeRunOwnership(ownershipPath, ownership);
  }
  if (errors.length > 0) throw errors[0];
  return ownership;
}

function createRunnerResult({
  runId,
  chainId,
  suiteIds,
  riskSelectedSuites,
  forcedFull,
  plannerReason,
  attempts,
  start,
}) {
  return {
    schemaVersion: E2E_RUN_RESULT_SCHEMA_VERSION,
    runId,
    chainId,
    selectedSuites: suiteIds,
    riskSelectedSuites,
    forcedFull,
    reason: plannerReason,
    phase: null,
    suite: null,
    attempt: null,
    durationMs: 0,
    runnerWallTimeMs: 0,
    testOnlyTimeMs: 0,
    result: "running",
    exitCode: null,
    attempts: { configured: attempts, used: 0, retries: 0 },
    firstAttemptFailures: [],
    recoveredFlakes: [],
    finalFailedSuite: null,
    phaseCount: 0,
    processCount: 0,
    cleanup: { state: "pending", attempts: [] },
    start,
    finish: null,
    phaseResults: [],
  };
}

export async function runE2eAttempt({
  attempt,
  runDirectory,
  result,
  resultPath,
  supervisor,
  suiteIds,
  rootKeys,
  createRoot,
  buildPhasePlan,
  suiteForPhase,
  applyCheckpoint,
  createOutputDirectory = createAttemptOutputDirectory,
  runPhase,
  captureFailureArtifacts,
  createOwnership = createRunOwnership,
  cleanupRoots = cleanupOwnedE2eRoots,
  rootByKey = ownedRootByKey,
  writeResult = writeRunResult,
  now = () => new Date().toISOString(),
  nowMs = Date.now,
}) {
  const attemptDirectory = path.join(runDirectory, `attempt-${attempt}`);
  const ownershipPath = path.join(attemptDirectory, "run-ownership.json");
  let ownership;
  let exitCode = 0;
  result.attempts.used = Math.max(result.attempts.used, attempt);
  result.attempts.retries = Math.max(0, result.attempts.used - 1);
  result.finalFailedSuite = null;
  try {
    ownership = createOwnership({
      ownershipPath,
      runId: result.runId,
      rootKeys,
      createRoot,
    });
    const directories = Object.fromEntries(
      ownership.roots.map(({ key }) => [key, rootByKey(ownership, key)]),
    );
    const phases = buildPhasePlan(suiteIds, directories);
    for (const phase of phases) {
      if (supervisor.cancelledSignal) {
        exitCode = supervisor.cancelledSignal === "SIGINT" ? 130 : 143;
        break;
      }
      try {
        applyCheckpoint(phase);
        const outputDirectory = createOutputDirectory({
          runDirectory,
          rootKey: phase.root,
          phase: phase.id,
          attempt,
        });
        const start = now();
        const startedMs = nowMs();
        const child = await runPhase(phase, { attempt, outputDirectory });
        const phaseResult = {
          phase: phase.id,
          suite: suiteForPhase(phase.id),
          attempt,
          durationMs: nowMs() - startedMs,
          result: child.exitCode === 0 ? "passed" : "failed",
          exitCode: child.exitCode,
          start,
          finish: now(),
          outputDirectory,
        };
        result.phase = phaseResult.phase;
        result.suite = phaseResult.suite;
        result.attempt = attempt;
        result.durationMs = phaseResult.durationMs;
        result.result = phaseResult.result;
        result.exitCode = phaseResult.exitCode;
        result.testOnlyTimeMs += phaseResult.durationMs;
        result.phaseCount += 1;
        result.processCount += 1;
        result.phaseResults.push(phaseResult);
        if (child.exitCode !== 0 && attempt === 1) {
          result.firstAttemptFailures.push({
            phase: phaseResult.phase,
            suite: phaseResult.suite,
            exitCode: phaseResult.exitCode,
          });
        }
        if (child.exitCode !== 0) result.finalFailedSuite = phaseResult.suite;
        writeResult(resultPath, result);
        if (child.exitCode !== 0) {
          captureFailureArtifacts({
            phase,
            code: child.exitCode,
            attempt,
            runDirectory,
          });
          exitCode = child.exitCode;
          break;
        }
      } catch (error) {
        console.error(`save e2e phase ${phase.id} setup failed:`, error);
        result.phase = phase.id;
        result.suite = suiteForPhase(phase.id);
        result.attempt = attempt;
        result.result = "failed";
        result.exitCode = 1;
        if (attempt === 1) {
          result.firstAttemptFailures.push({
            phase: result.phase,
            suite: result.suite,
            exitCode: 1,
          });
        }
        result.finalFailedSuite = result.suite;
        writeResult(resultPath, result);
        exitCode = 1;
        break;
      }
    }
  } finally {
    if (ownership || existsSync(ownershipPath)) {
      try {
        cleanupRoots(ownershipPath);
        result.cleanup.attempts.push({ attempt, state: "removed" });
      } catch (error) {
        console.error("save e2e app data cleanup failed:", error);
        result.cleanup.attempts.push({ attempt, state: "failed" });
        exitCode ||= 1;
      }
    }
    result.cleanup.state = result.cleanup.attempts.some(
      ({ state }) => state === "failed",
    )
      ? "failed"
      : "removed";
  }
  return exitCode;
}

export async function runE2eRunner({
  chainId = "direct",
  suiteIds,
  riskSelectedSuites,
  attempts,
  forcedFull,
  plannerReason = null,
  runDirectory,
  supervisor,
  runGuard,
  rootKeys,
  createRoot,
  buildPhasePlan,
  suiteForPhase,
  applyCheckpoint,
  createOutputDirectory,
  runPhase,
  captureFailureArtifacts,
  createRun = createRunId,
  writeResult = writeRunResult,
  now = () => new Date().toISOString(),
  nowMs = Date.now,
  runAttempt = runE2eAttempt,
}) {
  mkdirSync(runDirectory, { recursive: true });
  const runId = createRun();
  const resultPath = path.join(runDirectory, "run-result.json");
  const runnerStartedMs = nowMs();
  const result = createRunnerResult({
    runId,
    chainId,
    suiteIds,
    riskSelectedSuites,
    forcedFull,
    plannerReason,
    attempts,
    start: now(),
  });
  let exitCode = 1;
  try {
    const guard = await runGuard();
    if (guard.exitCode !== 0) {
      result.phase = "binary-guard";
      result.result = "failed";
      result.exitCode = guard.exitCode;
      exitCode = guard.exitCode;
    } else {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        exitCode = await runAttempt({
          attempt,
          runDirectory,
          result,
          resultPath,
          supervisor,
          suiteIds,
          rootKeys,
          createRoot,
          buildPhasePlan,
          suiteForPhase,
          applyCheckpoint,
          createOutputDirectory,
          runPhase,
          captureFailureArtifacts,
          writeResult,
          now,
          nowMs,
        });
        if (exitCode === 0 || supervisor.cancelledSignal) break;
      }
      result.result = exitCode === 0 ? "passed" : "failed";
      result.exitCode = exitCode;
      if (exitCode === 0) result.finalFailedSuite = null;
      result.recoveredFlakes =
        exitCode === 0
          ? [...new Set(result.firstAttemptFailures.map(({ suite }) => suite))]
          : [];
    }
  } catch (error) {
    console.error("save e2e runner failed:", error);
    result.result = "failed";
    result.exitCode = 1;
    exitCode = 1;
  } finally {
    if (supervisor.cancelledSignal) {
      exitCode = supervisor.cancelledSignal === "SIGINT" ? 130 : 143;
      result.result = "cancelled";
      result.exitCode = exitCode;
      result.finalFailedSuite = null;
    }
    if (result.cleanup.attempts.length === 0)
      result.cleanup.state = "not-required";
    result.runnerWallTimeMs = nowMs() - runnerStartedMs;
    result.finish = now();
    writeResult(resultPath, result);
  }
  return { exitCode, result, resultPath, runDirectory };
}

export function writeRunResult(resultPath, result) {
  if (
    !result ||
    typeof result !== "object" ||
    result.schemaVersion !== E2E_RUN_RESULT_SCHEMA_VERSION
  ) {
    throw new Error("Invalid e2e run result manifest.");
  }
  writeJsonAtomically(resultPath, result);
}

function signalExitCode(signal) {
  return signal === "SIGINT" ? 130 : 143;
}

export function createChildSupervisor({ processRef = process } = {}) {
  let activeChild = null;
  let cancelledSignal = null;
  const forwardSignal = (signal) => {
    cancelledSignal ??= signal;
    if (activeChild && !activeChild.killed) activeChild.kill(signal);
  };
  const onSigint = () => forwardSignal("SIGINT");
  const onSigterm = () => forwardSignal("SIGTERM");
  processRef.on("SIGINT", onSigint);
  processRef.on("SIGTERM", onSigterm);

  return {
    get cancelledSignal() {
      return cancelledSignal;
    },
    run({ command, args, options, spawnImpl }) {
      return new Promise((resolve) => {
        const child = spawnImpl(command, args, options);
        activeChild = child;
        let completed = false;
        const finish = (exitCode, signal = null) => {
          if (completed) return;
          completed = true;
          if (activeChild === child) activeChild = null;
          resolve({
            exitCode:
              typeof exitCode === "number"
                ? exitCode
                : signalExitCode(signal ?? cancelledSignal),
            signal,
          });
        };
        child.once("error", () => finish(1));
        child.once("exit", finish);
        if (cancelledSignal && !child.killed) child.kill(cancelledSignal);
      });
    },
    dispose() {
      processRef.off("SIGINT", onSigint);
      processRef.off("SIGTERM", onSigterm);
    },
  };
}
