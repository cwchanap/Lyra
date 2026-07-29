import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  assertSafeHpa392AppDataDir,
  buildHpa392PhaseEnvironment,
  buildHpa392PhasePlan,
  corruptHpa392ObservedSidecar,
  corruptHpa392Slot,
  createHpa392AppDataDir,
  executeHpa392PhasePlan,
  removeHpa392AppDataDir,
  removeHpa392ObservedSidecar,
} from "./hpa-392-e2e-paths.mjs";

const mode = process.argv[2];
const supportedModes = new Set(["--ordinary", "--capture-proof", "--full"]);
if (process.argv.length !== 3 || !supportedModes.has(mode)) {
  console.error(
    "Usage: node scripts/run-hpa-392-e2e.mjs --ordinary|--capture-proof|--full",
  );
  process.exit(2);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const artifactRoot = path.join(appRoot, "e2e-artifacts", "hpa-392");

const guard = spawnSync(
  process.execPath,
  [path.join(scriptDirectory, "require-e2e-binary.mjs")],
  { cwd: appRoot, stdio: "inherit" },
);
if (guard.error) {
  console.error("HPA-392 E2E binary guard failed to launch:", guard.error);
  process.exit(1);
}
if ((guard.status ?? 1) !== 0) {
  process.exit(guard.status ?? 1);
}

const createdRoots = [];
let exitCode;

function createRoot() {
  const root = createHpa392AppDataDir();
  createdRoots.push(root);
  return root;
}

function applyCheckpointAction(phase) {
  if (!phase.before) return;
  switch (phase.before.type) {
    case "corrupt-slot":
      corruptHpa392Slot(phase.appDataDir, phase.before.fixedSlotName);
      return;
    case "remove-observed-sidecar":
      removeHpa392ObservedSidecar(phase.appDataDir, phase.before.fixedSlotName);
      return;
    case "corrupt-observed-sidecar":
      corruptHpa392ObservedSidecar(
        phase.appDataDir,
        phase.before.fixedSlotName,
      );
      return;
    default:
      throw new Error("Unknown HPA-392 checkpoint action.");
  }
}

function spawnPhase(phase) {
  try {
    applyCheckpointAction(phase);
    const validatedRoot = assertSafeHpa392AppDataDir(phase.appDataDir);
    const outputDirectory = path.join(validatedRoot, "runner-logs", phase.id);
    mkdirSync(outputDirectory, { recursive: true });
    const args = ["x", "wdio", "run", "wdio.conf.ts"];
    for (const spec of phase.specs) {
      args.push("--spec", spec);
    }
    console.log(`HPA-392 E2E phase: ${phase.id}`);
    const result = spawnSync("bun", args, {
      cwd: appRoot,
      env: buildHpa392PhaseEnvironment(phase, {
        baseEnvironment: process.env,
        outputDirectory,
      }),
      stdio: "inherit",
    });
    if (result.error) {
      console.error(
        `HPA-392 phase ${phase.id} failed to launch:`,
        result.error,
      );
      return 1;
    }
    return result.status ?? 1;
  } catch (error) {
    console.error(`HPA-392 phase ${phase.id} setup failed:`, error);
    return 1;
  }
}

function captureFailureArtifacts(phase, code) {
  try {
    const validatedRoot = assertSafeHpa392AppDataDir(phase.appDataDir);
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
      `HPA-392 phase ${phase.id} diagnostics could not be copied:`,
      error,
    );
  }
}

try {
  let phasePlan;
  if (mode === "--ordinary") {
    phasePlan = buildHpa392PhasePlan({
      mode,
      ordinaryAppDataDir: createRoot(),
    });
  } else if (mode === "--capture-proof") {
    phasePlan = buildHpa392PhasePlan({
      mode,
      captureProofAppDataDir: createRoot(),
    });
  } else {
    phasePlan = buildHpa392PhasePlan({
      mode,
      captureProofAppDataDir: createRoot(),
      persistenceAppDataDir: createRoot(),
    });
  }

  exitCode = executeHpa392PhasePlan(phasePlan, {
    spawnPhase,
    captureFailureArtifacts,
    cleanupAppDataDir: removeHpa392AppDataDir,
  });
} catch (error) {
  console.error("HPA-392 E2E runner failed:", error);
  exitCode = 1;
} finally {
  // If directory creation or plan construction fails before ownership reaches
  // executeHpa392PhasePlan, this remains the cleanup backstop. Existing roots
  // were already removed by the executor's own finally.
  for (const root of createdRoots) {
    if (existsSync(root)) {
      try {
        removeHpa392AppDataDir(root);
      } catch (error) {
        console.error("HPA-392 E2E app data cleanup failed:", error);
      }
    }
  }
}

process.exit(exitCode);
