import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  assertSafeSaveE2eAppDataDir,
  buildSaveE2ePhaseEnvironment,
  corruptSaveE2eObservedSidecar,
  corruptSaveE2eSlot,
  createSaveE2eAppDataDir,
  executeSaveE2ePhasePlan,
  removeSaveE2eAppDataDir,
  removeSaveE2eObservedSidecar,
} from "./save-e2e-paths.mjs";
import {
  buildE2ePhasePlan,
  e2eSuitePhaseRoots,
  validateSelectedE2eSuiteDefinitions,
} from "./e2e-suite-registry.mjs";
import {
  parseRunnerArguments,
  resolveRunnerSelection,
} from "./e2e-runner-selection.mjs";

let suiteIds;
try {
  const options = parseRunnerArguments(process.argv.slice(2));
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
const artifactRoot = path.join(appRoot, "e2e-artifacts", "save-e2e");

const guard = spawnSync(
  process.execPath,
  [path.join(scriptDirectory, "require-e2e-binary.mjs")],
  { cwd: appRoot, stdio: "inherit" },
);
if (guard.error) {
  console.error("save e2e binary guard failed to launch:", guard.error);
  process.exit(1);
}
if ((guard.status ?? 1) !== 0) {
  process.exit(guard.status ?? 1);
}

const createdRoots = [];
let exitCode;

function createRoot() {
  const root = createSaveE2eAppDataDir();
  createdRoots.push(root);
  return root;
}

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

function spawnPhase(phase) {
  try {
    applyCheckpointAction(phase);
    const validatedRoot = assertSafeSaveE2eAppDataDir(phase.appDataDir);
    const outputDirectory = path.join(validatedRoot, "runner-logs", phase.id);
    mkdirSync(outputDirectory, { recursive: true });
    const args = ["x", "wdio", "run", "wdio.conf.ts"];
    for (const spec of phase.specs) {
      args.push("--spec", spec);
    }
    console.log(`save e2e phase: ${phase.id}`);
    const result = spawnSync("bun", args, {
      cwd: appRoot,
      env: buildSaveE2ePhaseEnvironment(phase, {
        baseEnvironment: process.env,
        outputDirectory,
      }),
      stdio: "inherit",
    });
    if (result.error) {
      console.error(
        `save e2e phase ${phase.id} failed to launch:`,
        result.error,
      );
      return 1;
    }
    return result.status ?? 1;
  } catch (error) {
    console.error(`save e2e phase ${phase.id} setup failed:`, error);
    return 1;
  }
}

function captureFailureArtifacts(phase, code) {
  try {
    const validatedRoot = assertSafeSaveE2eAppDataDir(phase.appDataDir);
    const destination = path.join(
      artifactRoot,
      "failures",
      `${phase.id}-exit-${code}`,
    );
    // A phase ID and exit code are intentionally stable across retries. Clear
    // the prior snapshot first so a new failure cannot inherit stale saves,
    // sidecars, or runner logs from an earlier attempt.
    if (existsSync(destination)) {
      rmSync(destination, { recursive: true });
    }
    mkdirSync(destination, { recursive: true });
    cpSync(validatedRoot, path.join(destination, "app-data"), {
      recursive: true,
      force: true,
      // Save recency is deliberately filesystem-mtime authoritative. Keep the
      // failed fixture replayable without changing Continue selection order.
      preserveTimestamps: true,
    });
  } catch (error) {
    console.error(
      `save e2e phase ${phase.id} diagnostics could not be copied:`,
      error,
    );
  }
}

try {
  const directories = {};
  for (const root of e2eSuitePhaseRoots(suiteIds))
    directories[root] = createRoot();
  const phasePlan = buildE2ePhasePlan(suiteIds, directories);

  exitCode = executeSaveE2ePhasePlan(phasePlan, {
    spawnPhase,
    captureFailureArtifacts,
    cleanupAppDataDir: removeSaveE2eAppDataDir,
  });
} catch (error) {
  console.error("save e2e runner failed:", error);
  exitCode = 1;
} finally {
  // If directory creation or plan construction fails before ownership reaches
  // executeSaveE2ePhasePlan, this remains the cleanup backstop. Existing roots
  // were already removed by the executor's own finally.
  for (const root of createdRoots) {
    if (existsSync(root)) {
      try {
        removeSaveE2eAppDataDir(root);
      } catch (error) {
        console.error("save e2e app data cleanup failed:", error);
      }
    }
  }
}

process.exit(exitCode);
