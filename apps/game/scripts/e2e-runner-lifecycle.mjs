import {
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
export const E2E_RUN_RESULT_SCHEMA_VERSION = 1;
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
  writeRunOwnership(ownershipPath, ownership);
  for (const key of rootKeys) {
    const appDataDir = assertSafeSaveE2eAppDataDir(createRoot());
    const entry = {
      key,
      appDataDir,
      cleanup: { state: "pending" },
    };
    writeRootOwnershipMarker(entry, runId);
    ownership.roots.push(entry);
    // Persist after every allocation: a cancellation can only clean roots that
    // are already recorded as owned by this run.
    writeRunOwnership(ownershipPath, ownership);
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
