import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
  buildE2ePhasePlan,
  SAVE_E2E_ORDINARY_SPECS,
  SAVE_E2E_PHASE_NAMES,
  validateE2ePhaseOwnership,
  validateE2ePhaseSequence,
} from "./e2e-suite-registry.mjs";

export { SAVE_E2E_ORDINARY_SPECS, SAVE_E2E_PHASE_NAMES };

export const SAVE_E2E_E2E_DIRECTORY_PREFIX = "lyra-save-e2e-";
const SAVE_E2E_FIXED_SLOT_NAMES = Object.freeze([
  "autosave-1",
  "autosave-2",
  "autosave-3",
  "autosave-4",
  "autosave-5",
  "manual-1",
  "manual-2",
  "manual-3",
]);
const SAVE_E2E_FIXED_SLOT_NAME_SET = new Set(SAVE_E2E_FIXED_SLOT_NAMES);
const SAVE_E2E_CONTROL_EXPECTATIONS = new Set([
  "expected-resume-checkpoint",
  "management-state",
  "exit-state",
]);
const CANONICAL_UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function unsafePath() {
  return new Error("Unsafe save e2e app-data directory.");
}

function canonicalIfPresent(candidate) {
  if (!candidate) return null;
  try {
    return realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

export function productionAppDataDir({
  platform = process.platform,
  homeDir = homedir(),
  environment = process.env,
  pathApi = path,
} = {}) {
  if (platform === "darwin") {
    return pathApi.join(
      homeDir,
      "Library",
      "Application Support",
      "com.chanwaichan.lyra",
    );
  }
  if (platform === "win32") {
    return pathApi.join(
      environment.APPDATA ?? pathApi.join(homeDir, "AppData", "Roaming"),
      "com.chanwaichan.lyra",
    );
  }
  return pathApi.join(
    environment.XDG_DATA_HOME ?? pathApi.join(homeDir, ".local", "share"),
    "com.chanwaichan.lyra",
  );
}

export function assertSafeSaveE2eAppDataDir(
  candidate,
  {
    homeDir = homedir(),
    tempDir = tmpdir(),
    productionAppDataDir: production = productionAppDataDir({ homeDir }),
  } = {},
) {
  if (
    typeof candidate !== "string" ||
    candidate.length === 0 ||
    !path.isAbsolute(candidate) ||
    !path.basename(candidate).startsWith(SAVE_E2E_E2E_DIRECTORY_PREFIX)
  ) {
    throw unsafePath();
  }

  let metadata;
  let canonical;
  let canonicalTemp;
  try {
    metadata = lstatSync(candidate);
    canonical = realpathSync(candidate);
    canonicalTemp = realpathSync(tempDir);
  } catch {
    throw unsafePath();
  }

  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    canonical === canonicalTemp ||
    path.dirname(canonical) !== canonicalTemp ||
    !path.basename(canonical).startsWith(SAVE_E2E_E2E_DIRECTORY_PREFIX) ||
    canonical === canonicalIfPresent(homeDir) ||
    canonical === canonicalIfPresent(production)
  ) {
    throw unsafePath();
  }

  return canonical;
}

export function createSaveE2eAppDataDir({
  tempDir = tmpdir(),
  ...safety
} = {}) {
  const canonicalTemp = realpathSync(tempDir);
  const candidate = mkdtempSync(
    path.join(canonicalTemp, SAVE_E2E_E2E_DIRECTORY_PREFIX),
  );
  return assertSafeSaveE2eAppDataDir(candidate, {
    ...safety,
    tempDir: canonicalTemp,
  });
}

export function removeSaveE2eAppDataDir(candidate, safetyContext) {
  assertSafeSaveE2eAppDataDir(candidate, safetyContext);
  const revalidated = assertSafeSaveE2eAppDataDir(candidate, safetyContext);
  rmSync(revalidated, { recursive: true });
}

function fixedSlotPath(appDataDir, fixedSlotName) {
  const root = assertSafeSaveE2eAppDataDir(appDataDir);
  if (!SAVE_E2E_FIXED_SLOT_NAME_SET.has(fixedSlotName)) {
    throw new Error(`Unknown fixed save e2e slot: ${String(fixedSlotName)}`);
  }
  const saves = path.join(root, "saves");
  if (existsSync(saves)) {
    const metadata = lstatSync(saves);
    if (metadata.isSymbolicLink() || !metadata.isDirectory())
      throw unsafePath();
  }
  return path.join(saves, `${fixedSlotName}.json`);
}

function readFixedSlotText(appDataDir, fixedSlotName) {
  const slot = fixedSlotPath(appDataDir, fixedSlotName);
  if (!existsSync(slot)) return null;
  const metadata = lstatSync(slot);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw unsafePath();
  return readFileSync(slot, "utf8");
}

export function readSaveE2eSlotFiles(appDataDir) {
  return SAVE_E2E_FIXED_SLOT_NAMES.map((fixedSlotName) => {
    const slotPath = fixedSlotPath(appDataDir, fixedSlotName);
    const text = readFixedSlotText(appDataDir, fixedSlotName);
    return {
      fixedSlotName,
      path: slotPath,
      text,
      modifiedAtMs: text === null ? null : statSync(slotPath).mtimeMs,
    };
  });
}

export function corruptSaveE2eSlot(appDataDir, fixedSlotName) {
  const slot = fixedSlotPath(appDataDir, fixedSlotName);
  if (!existsSync(slot)) {
    throw new Error(`save e2e slot does not exist: ${fixedSlotName}`);
  }
  const metadata = lstatSync(slot);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw unsafePath();
  writeFileSync(slot, '{"broken":');
}

export function resolveSaveE2eObservedSidecar(appDataDir, fixedSlotName) {
  const text = readFixedSlotText(appDataDir, fixedSlotName);
  if (text === null) {
    throw new Error(`save e2e slot does not exist: ${fixedSlotName}`);
  }
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new Error("save e2e slot envelope is not valid JSON.");
  }
  const saveId = envelope?.saveId;
  const objectId = envelope?.thumbnail?.objectId;
  if (
    envelope?.thumbnail?.type !== "available" ||
    typeof saveId !== "string" ||
    !CANONICAL_UUID_V4.test(saveId) ||
    objectId !== saveId
  ) {
    throw new Error("save e2e sidecar requires a canonical UUID observation.");
  }
  const root = assertSafeSaveE2eAppDataDir(appDataDir);
  const thumbnails = path.join(root, "saves", "thumbnails");
  if (existsSync(thumbnails)) {
    const metadata = lstatSync(thumbnails);
    if (metadata.isSymbolicLink() || !metadata.isDirectory())
      throw unsafePath();
  }
  return path.join(thumbnails, `${saveId}.png`);
}

export function removeSaveE2eObservedSidecar(appDataDir, fixedSlotName) {
  const sidecar = resolveSaveE2eObservedSidecar(appDataDir, fixedSlotName);
  const metadata = lstatSync(sidecar);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw unsafePath();
  unlinkSync(sidecar);
}

export function corruptSaveE2eObservedSidecar(appDataDir, fixedSlotName) {
  const sidecar = resolveSaveE2eObservedSidecar(appDataDir, fixedSlotName);
  const metadata = lstatSync(sidecar);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw unsafePath();
  writeFileSync(sidecar, "not-a-png");
}

export function assertNoUnknownSaveE2eSidecars(appDataDir) {
  const root = assertSafeSaveE2eAppDataDir(appDataDir);
  const thumbnails = path.join(root, "saves", "thumbnails");
  if (!existsSync(thumbnails)) return true;
  const metadata = lstatSync(thumbnails);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw unsafePath();

  const referenced = new Set();
  for (const slot of readSaveE2eSlotFiles(root)) {
    if (slot.text === null) continue;
    try {
      const envelope = JSON.parse(slot.text);
      const saveId = envelope?.saveId;
      if (
        envelope?.thumbnail?.type === "available" &&
        typeof saveId === "string" &&
        CANONICAL_UUID_V4.test(saveId) &&
        envelope.thumbnail.objectId === saveId
      ) {
        referenced.add(`${saveId}.png`);
      }
    } catch {
      // An invalid slot cannot authorize ownership of any sidecar.
    }
  }

  for (const filename of readdirSync(thumbnails)) {
    const sidecar = path.join(thumbnails, filename);
    const sidecarMetadata = lstatSync(sidecar);
    if (
      sidecarMetadata.isSymbolicLink() ||
      !sidecarMetadata.isFile() ||
      !CANONICAL_UUID_V4.test(filename.replace(/\.png$/, "")) ||
      !filename.endsWith(".png") ||
      !referenced.has(filename)
    ) {
      throw new Error(`Unknown save e2e sidecar: ${filename}`);
    }
  }
  return true;
}

function controlExpectationPath(appDataDir, expectationName, create) {
  const root = assertSafeSaveE2eAppDataDir(appDataDir);
  if (!SAVE_E2E_CONTROL_EXPECTATIONS.has(expectationName)) {
    throw new Error(
      `Unknown save e2e test-control expectation: ${String(expectationName)}`,
    );
  }
  const control = path.join(root, "test-control");
  if (create) mkdirSync(control, { recursive: true });
  if (existsSync(control)) {
    const metadata = lstatSync(control);
    if (metadata.isSymbolicLink() || !metadata.isDirectory())
      throw unsafePath();
  }
  return path.join(control, `${expectationName}.json`);
}

export function writeSaveE2eControlExpectation(
  appDataDir,
  expectationName,
  value,
) {
  const destination = controlExpectationPath(appDataDir, expectationName, true);
  if (existsSync(destination)) {
    const metadata = lstatSync(destination);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw unsafePath();
  }
  writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`);
}

export function readSaveE2eControlExpectation(appDataDir, expectationName) {
  const source = controlExpectationPath(appDataDir, expectationName, false);
  const metadata = lstatSync(source);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw unsafePath();
  return JSON.parse(readFileSync(source, "utf8"));
}

export function buildSaveE2ePhasePlan({
  mode,
  ordinaryAppDataDir,
  captureProofAppDataDir,
  persistenceAppDataDir,
}) {
  const suitesByMode = {
    "--ordinary": ["gameplay"],
    "--capture-proof": ["capture-proof"],
    "--full": [
      "capture-proof",
      "save-core",
      "save-management",
      "exit-lifecycle",
    ],
  };
  const suites = suitesByMode[mode];
  if (!suites) throw new Error(`Unknown save e2e mode: ${String(mode)}`);
  return buildE2ePhasePlan(suites, {
    gameplay:
      ordinaryAppDataDir === undefined
        ? undefined
        : assertSafeSaveE2eAppDataDir(ordinaryAppDataDir),
    ordinary:
      ordinaryAppDataDir === undefined
        ? undefined
        : assertSafeSaveE2eAppDataDir(ordinaryAppDataDir),
    captureProof:
      captureProofAppDataDir === undefined
        ? undefined
        : assertSafeSaveE2eAppDataDir(captureProofAppDataDir),
    persistence:
      persistenceAppDataDir === undefined
        ? undefined
        : assertSafeSaveE2eAppDataDir(persistenceAppDataDir),
  });
}

export function buildSaveE2ePhaseEnvironment(
  phaseToRun,
  { baseEnvironment = process.env, outputDirectory },
) {
  validateE2ePhaseOwnership(phaseToRun);
  assertSafeSaveE2eAppDataDir(phaseToRun.appDataDir);
  if (typeof outputDirectory !== "string" || outputDirectory.length === 0) {
    throw new Error("Unknown save e2e output directory.");
  }
  const environment = { ...baseEnvironment };
  delete environment.LYRA_E2E_APP_DATA_DIR;
  delete environment.LYRA_E2E_CAPTURE_BACKEND_LOGS;
  delete environment.LYRA_E2E_OUTPUT_DIR;
  delete environment.LYRA_SAVE_E2E_PHASE;
  return {
    ...environment,
    ...phaseToRun.environment,
    LYRA_E2E_APP_DATA_DIR: phaseToRun.appDataDir,
    LYRA_E2E_OUTPUT_DIR: outputDirectory,
  };
}

export function executeSaveE2ePhasePlan(
  phases,
  { spawnPhase, captureFailureArtifacts, cleanupAppDataDir },
) {
  if (!Array.isArray(phases) || phases.length === 0) {
    throw new Error("Unknown save e2e phase plan.");
  }
  const roots = [
    ...new Set(phases.map((phaseToValidate) => phaseToValidate.appDataDir)),
  ];
  let exitCode = 0;
  try {
    for (const phaseToValidate of phases) {
      validateE2ePhaseOwnership(phaseToValidate);
      assertSafeSaveE2eAppDataDir(phaseToValidate.appDataDir);
    }
    validateE2ePhaseSequence(phases);
    for (const currentPhase of phases) {
      exitCode = spawnPhase(currentPhase);
      if (exitCode !== 0) {
        captureFailureArtifacts(currentPhase, exitCode);
        break;
      }
    }
    return exitCode;
  } finally {
    for (const root of roots) {
      try {
        cleanupAppDataDir(root);
      } catch (error) {
        console.error("save e2e app data cleanup failed:", error);
      }
    }
  }
}
