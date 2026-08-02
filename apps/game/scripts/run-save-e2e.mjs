import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  assertSafeSaveE2eAppDataDir,
  buildSaveE2ePhaseEnvironment,
  corruptSaveE2eObservedSidecar,
  corruptSaveE2eSlot,
  createSaveE2eAppDataDir,
  removeSaveE2eObservedSidecar,
} from "./save-e2e-paths.mjs";
import {
  buildE2ePhasePlan,
  e2eSuiteForPhase,
  e2eSuiteGuardedRoots,
  validateSelectedE2eSuiteDefinitions,
} from "./e2e-suite-registry.mjs";
import {
  parseRunnerArguments,
  resolveRunnerSelection,
} from "./e2e-runner-selection.mjs";
import {
  E2E_RUN_RESULT_SCHEMA_VERSION,
  cleanupOwnedE2eRoots,
  createAttemptOutputDirectory,
  createChildSupervisor,
  createRunId,
  createRunOwnership,
  ownedRootByKey,
  writeRunResult,
} from "./e2e-runner-lifecycle.mjs";

let options;
let suiteIds;
try {
  options = parseRunnerArguments(process.argv.slice(2));
  suiteIds = resolveRunnerSelection(options);
  suiteIds = validateSelectedE2eSuiteDefinitions(suiteIds);
} catch (error) {
  console.error(
    `Usage: node scripts/run-save-e2e.mjs (--suite <id> [... ]|--suite-file /absolute/path/to/e2e-suites.json|--full) [--attempts 1|2]\n${error.message}`,
  );
  process.exit(2);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const artifactRoot = path.join(appRoot, "e2e-artifacts", "save-e2e", "runs");

function applyCheckpointAction(phase) {
  if (!phase.before) return;
  switch (phase.before.type) {
    case "corrupt-slot":
      corruptSaveE2eSlot(phase.appDataDir, phase.before.fixedSlotName);
      return;
    case "remove-observed-sidecar":
      removeSaveE2eObservedSidecar(
        phase.appDataDir,
        phase.before.fixedSlotName,
      );
      return;
    case "corrupt-observed-sidecar":
      corruptSaveE2eObservedSidecar(
        phase.appDataDir,
        phase.before.fixedSlotName,
      );
      return;
    default:
      throw new Error("Unknown save e2e checkpoint action.");
  }
}

function createResult({ runId, start }) {
  return {
    schemaVersion: E2E_RUN_RESULT_SCHEMA_VERSION,
    runId,
    selectedSuites: suiteIds,
    riskSelectedSuites: options.full ? [] : suiteIds,
    forcedFull: options.full === true,
    phase: null,
    suite: null,
    attempt: null,
    durationMs: 0,
    result: "running",
    exitCode: null,
    firstFailedSuite: null,
    processCount: 0,
    start,
    finish: null,
    phaseResults: [],
  };
}

function captureFailureArtifacts({ phase, code, attempt, runDirectory }) {
  try {
    const validatedRoot = assertSafeSaveE2eAppDataDir(phase.appDataDir);
    const destination = path.join(
      runDirectory,
      "failures",
      `attempt-${attempt}`,
      `${phase.id}-exit-${code}`,
    );
    mkdirSync(destination, { recursive: true });
    cpSync(validatedRoot, path.join(destination, "app-data"), {
      recursive: true,
      force: true,
      preserveTimestamps: true,
    });
  } catch (error) {
    console.error(
      `save e2e phase ${phase.id} diagnostics could not be copied:`,
      error,
    );
  }
}

async function runGuard(supervisor) {
  return supervisor.run({
    command: process.execPath,
    args: [path.join(scriptDirectory, "require-e2e-binary.mjs")],
    options: { cwd: appRoot, stdio: "inherit" },
    spawnImpl: spawn,
  });
}

async function runAttempt({
  attempt,
  runDirectory,
  result,
  resultPath,
  supervisor,
}) {
  const attemptDirectory = path.join(runDirectory, `attempt-${attempt}`);
  const ownershipPath = path.join(attemptDirectory, "run-ownership.json");
  let ownership;
  let exitCode = 0;
  try {
    ownership = createRunOwnership({
      ownershipPath,
      runId: result.runId,
      rootKeys: e2eSuiteGuardedRoots(suiteIds),
      createRoot: createSaveE2eAppDataDir,
    });
    const directories = Object.fromEntries(
      ownership.roots.map(({ key }) => [key, ownedRootByKey(ownership, key)]),
    );
    const phases = buildE2ePhasePlan(suiteIds, directories);
    for (const phase of phases) {
      if (supervisor.cancelledSignal) {
        exitCode = supervisor.cancelledSignal === "SIGINT" ? 130 : 143;
        break;
      }
      try {
        applyCheckpointAction(phase);
        const outputDirectory = createAttemptOutputDirectory({
          runDirectory,
          rootKey: phase.root,
          phase: phase.id,
          attempt,
        });
        const startedAt = new Date().toISOString();
        const startedMs = Date.now();
        console.log(`save e2e phase: ${phase.id} (attempt ${attempt})`);
        const child = await supervisor.run({
          command: "bun",
          args: [
            "x",
            "wdio",
            "run",
            "wdio.conf.ts",
            ...phase.specs.flatMap((spec) => ["--spec", spec]),
          ],
          options: {
            cwd: appRoot,
            env: {
              ...buildSaveE2ePhaseEnvironment(phase, {
                baseEnvironment: process.env,
                outputDirectory,
              }),
              LYRA_E2E_RUNNER_PHASE: phase.id,
              LYRA_E2E_ATTEMPT: String(attempt),
              LYRA_E2E_CAPTURE_BACKEND_LOGS: "1",
            },
            stdio: "inherit",
          },
          spawnImpl: spawn,
        });
        const phaseResult = {
          phase: phase.id,
          suite: e2eSuiteForPhase(phase.id),
          attempt,
          durationMs: Date.now() - startedMs,
          result: child.exitCode === 0 ? "passed" : "failed",
          exitCode: child.exitCode,
          start: startedAt,
          finish: new Date().toISOString(),
          outputDirectory,
        };
        result.phase = phaseResult.phase;
        result.suite = phaseResult.suite;
        result.attempt = attempt;
        result.durationMs = phaseResult.durationMs;
        result.result = phaseResult.result;
        result.exitCode = phaseResult.exitCode;
        result.processCount += 1;
        result.phaseResults.push(phaseResult);
        if (child.exitCode !== 0 && result.firstFailedSuite === null)
          result.firstFailedSuite = phaseResult.suite;
        writeRunResult(resultPath, result);
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
        result.suite = e2eSuiteForPhase(phase.id);
        result.attempt = attempt;
        result.result = "failed";
        result.exitCode = 1;
        result.firstFailedSuite ??= result.suite;
        writeRunResult(resultPath, result);
        exitCode = 1;
        break;
      }
    }
  } finally {
    if (ownership || existsSync(ownershipPath)) {
      try {
        cleanupOwnedE2eRoots(ownershipPath);
      } catch (error) {
        console.error("save e2e app data cleanup failed:", error);
        exitCode ||= 1;
      }
    }
  }
  return exitCode;
}

async function main() {
  const runId = createRunId();
  const start = new Date().toISOString();
  const runDirectory = path.join(artifactRoot, runId);
  const resultPath = path.join(runDirectory, "run-result.json");
  mkdirSync(runDirectory, { recursive: true });
  const result = createResult({ runId, start });
  const supervisor = createChildSupervisor();
  let exitCode = 1;
  try {
    const guard = await runGuard(supervisor);
    if (guard.exitCode !== 0) {
      result.phase = "binary-guard";
      result.result = "failed";
      result.exitCode = guard.exitCode;
      exitCode = guard.exitCode;
      return;
    }
    for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
      exitCode = await runAttempt({
        attempt,
        runDirectory,
        result,
        resultPath,
        supervisor,
      });
      if (exitCode === 0 || supervisor.cancelledSignal) break;
    }
    result.result = exitCode === 0 ? "passed" : "failed";
    result.exitCode = exitCode;
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
    }
    result.finish = new Date().toISOString();
    writeRunResult(resultPath, result);
    supervisor.dispose();
    process.exitCode = exitCode;
  }
}

await main();
