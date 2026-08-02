import { spawn } from "node:child_process";
import { cpSync, mkdirSync } from "node:fs";
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
  resolveRunnerPlannerMetadata,
  resolveRunnerSelection,
} from "./e2e-runner-selection.mjs";
import {
  createChildSupervisor,
  createRunId,
  runE2eRunner,
} from "./e2e-runner-lifecycle.mjs";

let options;
let suiteIds;
let plannerMetadata;
try {
  options = parseRunnerArguments(process.argv.slice(2));
  suiteIds = resolveRunnerSelection(options);
  suiteIds = validateSelectedE2eSuiteDefinitions(suiteIds);
  plannerMetadata = resolveRunnerPlannerMetadata(options, suiteIds);
} catch (error) {
  console.error(
    `Usage: node scripts/run-save-e2e.mjs (--suite <id> [... ]|--suite-file /absolute/path/to/e2e-suites.json|--full) [--attempts 1|2] [--chain-id <id> --plan-file /absolute/path/to/e2e-plan.json]\n${error.message}`,
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

async function main() {
  const runId = createRunId();
  const runDirectory = path.join(artifactRoot, runId);
  const supervisor = createChildSupervisor();
  try {
    const runner = await runE2eRunner({
      chainId: plannerMetadata.chainId,
      suiteIds,
      riskSelectedSuites: plannerMetadata.riskSelectedSuites,
      attempts: options.attempts,
      forcedFull: plannerMetadata.forcedFull,
      plannerReason: plannerMetadata.reason,
      runDirectory,
      supervisor,
      runGuard: () =>
        supervisor.run({
          command: process.execPath,
          args: [path.join(scriptDirectory, "require-e2e-binary.mjs")],
          options: { cwd: appRoot, stdio: "inherit" },
          spawnImpl: spawn,
        }),
      rootKeys: e2eSuiteGuardedRoots(suiteIds),
      createRoot: createSaveE2eAppDataDir,
      buildPhasePlan: buildE2ePhasePlan,
      suiteForPhase: e2eSuiteForPhase,
      applyCheckpoint: applyCheckpointAction,
      async runPhase(phase, { attempt, outputDirectory }) {
        console.log(`save e2e phase: ${phase.id} (attempt ${attempt})`);
        return supervisor.run({
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
      },
      captureFailureArtifacts,
      createRun: () => runId,
    });
    process.exitCode = runner.exitCode;
  } finally {
    supervisor.dispose();
  }
}

await main();
