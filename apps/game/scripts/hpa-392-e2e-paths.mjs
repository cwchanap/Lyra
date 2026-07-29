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

export const HPA392_E2E_DIRECTORY_PREFIX = "lyra-hpa-392-";
export const HPA392_ORDINARY_SPECS = Object.freeze([
  "./e2e-tauri/app.e2e.ts",
  "./e2e-tauri/investigation-layout.e2e.ts",
  "./e2e-tauri/scene-navigation-gate.e2e.ts",
]);
export const HPA392_PHASE_NAMES = Object.freeze({
  captureProof: "capture-proof",
  saveSeed: "save-seed",
  saveResume: "save-resume",
  managementSeed: "management-seed",
  managementCorruptNewest: "management-corrupt-newest",
  managementRecoverOlder: "management-recover-older",
  managementMissingThumbnail: "management-missing-thumbnail",
  managementRestoreThumbnail: "management-restore-thumbnail",
  managementCorruptThumbnail: "management-corrupt-thumbnail",
  managementDelete: "management-delete",
  exitCloseSeed: "exit-close-seed",
  exitCloseResume: "exit-close-resume",
  exitQuitSeed: "exit-quit-seed",
  exitQuitResume: "exit-quit-resume",
  exitFailureBypass: "exit-failure-bypass",
  exitFinalVerification: "exit-final-verification",
});

const HPA392_CAPTURE_SPEC = "./e2e-tauri/hpa-392-capture-proof.e2e.ts";
const HPA392_SEED_SPEC = "./e2e-tauri/hpa-392-save-seed.e2e.ts";
const HPA392_RESUME_SPEC = "./e2e-tauri/hpa-392-save-resume.e2e.ts";
const HPA392_MANAGEMENT_SPEC = "./e2e-tauri/hpa-392-save-management.e2e.ts";
const HPA392_EXIT_SPEC = "./e2e-tauri/hpa-392-exit.e2e.ts";
const HPA392_APPROVED_SPECS = new Set([
  ...HPA392_ORDINARY_SPECS,
  HPA392_CAPTURE_SPEC,
  HPA392_SEED_SPEC,
  HPA392_RESUME_SPEC,
  HPA392_MANAGEMENT_SPEC,
  HPA392_EXIT_SPEC,
]);
const HPA392_APPROVED_PHASES = new Set([
  "ordinary",
  ...Object.values(HPA392_PHASE_NAMES),
]);
const HPA392_APPROVED_GROUPS = new Set([
  "ordinary",
  "capture-proof",
  "seed",
  "resume",
  "management",
  "exit",
]);
const HPA392_FULL_PHASE_ORDER = Object.freeze([
  HPA392_PHASE_NAMES.captureProof,
  HPA392_PHASE_NAMES.saveSeed,
  HPA392_PHASE_NAMES.saveResume,
  HPA392_PHASE_NAMES.managementSeed,
  HPA392_PHASE_NAMES.managementCorruptNewest,
  HPA392_PHASE_NAMES.managementRecoverOlder,
  HPA392_PHASE_NAMES.managementMissingThumbnail,
  HPA392_PHASE_NAMES.managementRestoreThumbnail,
  HPA392_PHASE_NAMES.managementCorruptThumbnail,
  HPA392_PHASE_NAMES.managementDelete,
  HPA392_PHASE_NAMES.exitCloseSeed,
  HPA392_PHASE_NAMES.exitCloseResume,
  HPA392_PHASE_NAMES.exitQuitSeed,
  HPA392_PHASE_NAMES.exitQuitResume,
  HPA392_PHASE_NAMES.exitFailureBypass,
  HPA392_PHASE_NAMES.exitFinalVerification,
]);
const HPA392_FIXED_SLOT_NAMES = Object.freeze([
  "autosave-1",
  "autosave-2",
  "autosave-3",
  "autosave-4",
  "autosave-5",
  "manual-1",
  "manual-2",
  "manual-3",
]);
const HPA392_FIXED_SLOT_NAME_SET = new Set(HPA392_FIXED_SLOT_NAMES);
const HPA392_CONTROL_EXPECTATIONS = new Set([
  "expected-resume-checkpoint",
  "management-state",
  "exit-state",
]);
const HPA392_BACKEND_LOG_ENVIRONMENT = Object.freeze({
  LYRA_E2E_CAPTURE_BACKEND_LOGS: "1",
});
const CANONICAL_UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function unsafePath() {
  return new Error("Unsafe HPA-392 E2E app-data directory.");
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

export function assertSafeHpa392AppDataDir(
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
    !path.basename(candidate).startsWith(HPA392_E2E_DIRECTORY_PREFIX)
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
    !path.basename(canonical).startsWith(HPA392_E2E_DIRECTORY_PREFIX) ||
    canonical === canonicalIfPresent(homeDir) ||
    canonical === canonicalIfPresent(production)
  ) {
    throw unsafePath();
  }

  return canonical;
}

export function createHpa392AppDataDir({ tempDir = tmpdir(), ...safety } = {}) {
  const canonicalTemp = realpathSync(tempDir);
  const candidate = mkdtempSync(
    path.join(canonicalTemp, HPA392_E2E_DIRECTORY_PREFIX),
  );
  return assertSafeHpa392AppDataDir(candidate, {
    ...safety,
    tempDir: canonicalTemp,
  });
}

export function removeHpa392AppDataDir(candidate, safetyContext) {
  assertSafeHpa392AppDataDir(candidate, safetyContext);
  const revalidated = assertSafeHpa392AppDataDir(candidate, safetyContext);
  rmSync(revalidated, { recursive: true });
}

// Task 13 public names remain as compatibility aliases for the existing proof
// tests while Task 16 exposes the plan's canonical API.
export const validateHpa392E2eAppDataDir = assertSafeHpa392AppDataDir;
export const createHpa392E2eAppDataDir = createHpa392AppDataDir;
export const guardedRemoveHpa392E2eAppDataDir = removeHpa392AppDataDir;

function fixedSlotPath(appDataDir, fixedSlotName) {
  const root = assertSafeHpa392AppDataDir(appDataDir);
  if (!HPA392_FIXED_SLOT_NAME_SET.has(fixedSlotName)) {
    throw new Error(`Unknown fixed HPA-392 slot: ${String(fixedSlotName)}`);
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

export function readHpa392SlotFiles(appDataDir) {
  return HPA392_FIXED_SLOT_NAMES.map((fixedSlotName) => {
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

export function corruptHpa392Slot(appDataDir, fixedSlotName) {
  const slot = fixedSlotPath(appDataDir, fixedSlotName);
  if (!existsSync(slot)) {
    throw new Error(`HPA-392 slot does not exist: ${fixedSlotName}`);
  }
  const metadata = lstatSync(slot);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw unsafePath();
  writeFileSync(slot, '{"broken":');
}

export function resolveHpa392ObservedSidecar(appDataDir, fixedSlotName) {
  const text = readFixedSlotText(appDataDir, fixedSlotName);
  if (text === null) {
    throw new Error(`HPA-392 slot does not exist: ${fixedSlotName}`);
  }
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new Error("HPA-392 slot envelope is not valid JSON.");
  }
  const saveId = envelope?.saveId;
  const objectId = envelope?.thumbnail?.objectId;
  if (
    envelope?.thumbnail?.type !== "available" ||
    typeof saveId !== "string" ||
    !CANONICAL_UUID_V4.test(saveId) ||
    objectId !== saveId
  ) {
    throw new Error("HPA-392 sidecar requires a canonical UUID observation.");
  }
  const root = assertSafeHpa392AppDataDir(appDataDir);
  const thumbnails = path.join(root, "saves", "thumbnails");
  if (existsSync(thumbnails)) {
    const metadata = lstatSync(thumbnails);
    if (metadata.isSymbolicLink() || !metadata.isDirectory())
      throw unsafePath();
  }
  return path.join(thumbnails, `${saveId}.png`);
}

export function removeHpa392ObservedSidecar(appDataDir, fixedSlotName) {
  const sidecar = resolveHpa392ObservedSidecar(appDataDir, fixedSlotName);
  const metadata = lstatSync(sidecar);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw unsafePath();
  unlinkSync(sidecar);
}

export function corruptHpa392ObservedSidecar(appDataDir, fixedSlotName) {
  const sidecar = resolveHpa392ObservedSidecar(appDataDir, fixedSlotName);
  const metadata = lstatSync(sidecar);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw unsafePath();
  writeFileSync(sidecar, "not-a-png");
}

export function assertNoUnknownHpa392Sidecars(appDataDir) {
  const root = assertSafeHpa392AppDataDir(appDataDir);
  const thumbnails = path.join(root, "saves", "thumbnails");
  if (!existsSync(thumbnails)) return true;
  const metadata = lstatSync(thumbnails);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw unsafePath();

  const referenced = new Set();
  for (const slot of readHpa392SlotFiles(root)) {
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
      throw new Error(`Unknown HPA-392 sidecar: ${filename}`);
    }
  }
  return true;
}

function controlExpectationPath(appDataDir, expectationName, create) {
  const root = assertSafeHpa392AppDataDir(appDataDir);
  if (!HPA392_CONTROL_EXPECTATIONS.has(expectationName)) {
    throw new Error(
      `Unknown HPA-392 test-control expectation: ${String(expectationName)}`,
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

export function writeHpa392ControlExpectation(
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

export function readHpa392ControlExpectation(appDataDir, expectationName) {
  const source = controlExpectationPath(appDataDir, expectationName, false);
  const metadata = lstatSync(source);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw unsafePath();
  return JSON.parse(readFileSync(source, "utf8"));
}

function phase(
  id,
  group,
  appDataDir,
  specs,
  environment = { ...HPA392_BACKEND_LOG_ENVIRONMENT },
  before,
) {
  const result = {
    id,
    group,
    appDataDir: assertSafeHpa392AppDataDir(appDataDir),
    specs,
    environment,
  };
  if (before) result.before = before;
  return result;
}

function managementPhase(id, appDataDir, before) {
  return phase(
    id,
    "management",
    appDataDir,
    [HPA392_MANAGEMENT_SPEC],
    {
      ...HPA392_BACKEND_LOG_ENVIRONMENT,
      LYRA_HPA392_PHASE: id,
    },
    before,
  );
}

function exitPhase(id, appDataDir) {
  return phase(id, "exit", appDataDir, [HPA392_EXIT_SPEC], {
    ...HPA392_BACKEND_LOG_ENVIRONMENT,
    LYRA_HPA392_PHASE: id,
  });
}

export function buildHpa392PhasePlan({
  mode,
  ordinaryAppDataDir,
  captureProofAppDataDir,
  persistenceAppDataDir,
}) {
  if (mode === "--ordinary") {
    return [
      phase("ordinary", "ordinary", ordinaryAppDataDir, [
        ...HPA392_ORDINARY_SPECS,
      ]),
    ];
  }
  if (mode === "--capture-proof") {
    return [
      phase(
        HPA392_PHASE_NAMES.captureProof,
        "capture-proof",
        captureProofAppDataDir,
        [HPA392_CAPTURE_SPEC],
        { ...HPA392_BACKEND_LOG_ENVIRONMENT },
      ),
    ];
  }
  if (mode !== "--full") {
    throw new Error(`Unknown HPA-392 E2E mode: ${String(mode)}`);
  }

  return [
    phase(
      HPA392_PHASE_NAMES.captureProof,
      "capture-proof",
      captureProofAppDataDir,
      [HPA392_CAPTURE_SPEC],
      { ...HPA392_BACKEND_LOG_ENVIRONMENT },
    ),
    phase(HPA392_PHASE_NAMES.saveSeed, "seed", persistenceAppDataDir, [
      HPA392_SEED_SPEC,
    ]),
    phase(HPA392_PHASE_NAMES.saveResume, "resume", persistenceAppDataDir, [
      HPA392_RESUME_SPEC,
    ]),
    managementPhase(HPA392_PHASE_NAMES.managementSeed, persistenceAppDataDir),
    managementPhase(
      HPA392_PHASE_NAMES.managementCorruptNewest,
      persistenceAppDataDir,
      { type: "corrupt-slot", fixedSlotName: "autosave-1" },
    ),
    managementPhase(
      HPA392_PHASE_NAMES.managementRecoverOlder,
      persistenceAppDataDir,
    ),
    managementPhase(
      HPA392_PHASE_NAMES.managementMissingThumbnail,
      persistenceAppDataDir,
      { type: "remove-observed-sidecar", fixedSlotName: "manual-1" },
    ),
    managementPhase(
      HPA392_PHASE_NAMES.managementRestoreThumbnail,
      persistenceAppDataDir,
    ),
    managementPhase(
      HPA392_PHASE_NAMES.managementCorruptThumbnail,
      persistenceAppDataDir,
      { type: "corrupt-observed-sidecar", fixedSlotName: "manual-1" },
    ),
    managementPhase(HPA392_PHASE_NAMES.managementDelete, persistenceAppDataDir),
    exitPhase(HPA392_PHASE_NAMES.exitCloseSeed, persistenceAppDataDir),
    exitPhase(HPA392_PHASE_NAMES.exitCloseResume, persistenceAppDataDir),
    exitPhase(HPA392_PHASE_NAMES.exitQuitSeed, persistenceAppDataDir),
    exitPhase(HPA392_PHASE_NAMES.exitQuitResume, persistenceAppDataDir),
    exitPhase(HPA392_PHASE_NAMES.exitFailureBypass, persistenceAppDataDir),
    exitPhase(HPA392_PHASE_NAMES.exitFinalVerification, persistenceAppDataDir),
  ];
}

function validatePhase(phaseToValidate) {
  if (
    !phaseToValidate ||
    typeof phaseToValidate !== "object" ||
    !HPA392_APPROVED_PHASES.has(phaseToValidate.id) ||
    !HPA392_APPROVED_GROUPS.has(phaseToValidate.group)
  ) {
    throw new Error("Unknown HPA-392 E2E phase.");
  }
  assertSafeHpa392AppDataDir(phaseToValidate.appDataDir);
  if (
    !Array.isArray(phaseToValidate.specs) ||
    phaseToValidate.specs.length === 0
  ) {
    throw new Error("Unknown HPA-392 E2E spec.");
  }
  for (const spec of phaseToValidate.specs) {
    if (!HPA392_APPROVED_SPECS.has(spec)) {
      throw new Error(`Unknown HPA-392 E2E spec: ${String(spec)}`);
    }
  }
  if (phaseToValidate.before !== undefined) {
    const action = phaseToValidate.before;
    if (
      !action ||
      typeof action !== "object" ||
      ![
        "corrupt-slot",
        "remove-observed-sidecar",
        "corrupt-observed-sidecar",
      ].includes(action.type) ||
      !HPA392_FIXED_SLOT_NAME_SET.has(action.fixedSlotName)
    ) {
      throw new Error("Unknown HPA-392 checkpoint action.");
    }
  }
  const environment = phaseToValidate.environment;
  if (!environment || typeof environment !== "object") {
    throw new Error("Unknown HPA-392 phase environment.");
  }
  const expectedEnvironment =
    phaseToValidate.group === "management" || phaseToValidate.group === "exit"
      ? {
          ...HPA392_BACKEND_LOG_ENVIRONMENT,
          LYRA_HPA392_PHASE: phaseToValidate.id,
        }
      : { ...HPA392_BACKEND_LOG_ENVIRONMENT };
  if (JSON.stringify(environment) !== JSON.stringify(expectedEnvironment)) {
    throw new Error("Unknown HPA-392 phase environment.");
  }
  const expected = expectedPhaseShape(phaseToValidate.id);
  if (
    phaseToValidate.group !== expected.group ||
    JSON.stringify(phaseToValidate.specs) !== JSON.stringify(expected.specs) ||
    JSON.stringify(phaseToValidate.before) !== JSON.stringify(expected.before)
  ) {
    throw new Error("Invalid HPA-392 phase plan.");
  }
}

function expectedPhaseShape(id) {
  if (id === "ordinary") {
    return {
      group: "ordinary",
      specs: [...HPA392_ORDINARY_SPECS],
      before: undefined,
    };
  }
  if (id === HPA392_PHASE_NAMES.captureProof) {
    return {
      group: "capture-proof",
      specs: [HPA392_CAPTURE_SPEC],
      before: undefined,
    };
  }
  if (id === HPA392_PHASE_NAMES.saveSeed) {
    return { group: "seed", specs: [HPA392_SEED_SPEC], before: undefined };
  }
  if (id === HPA392_PHASE_NAMES.saveResume) {
    return {
      group: "resume",
      specs: [HPA392_RESUME_SPEC],
      before: undefined,
    };
  }
  const managementBefore = new Map([
    [
      HPA392_PHASE_NAMES.managementCorruptNewest,
      { type: "corrupt-slot", fixedSlotName: "autosave-1" },
    ],
    [
      HPA392_PHASE_NAMES.managementMissingThumbnail,
      { type: "remove-observed-sidecar", fixedSlotName: "manual-1" },
    ],
    [
      HPA392_PHASE_NAMES.managementCorruptThumbnail,
      { type: "corrupt-observed-sidecar", fixedSlotName: "manual-1" },
    ],
  ]);
  if (id.startsWith("management-")) {
    return {
      group: "management",
      specs: [HPA392_MANAGEMENT_SPEC],
      before: managementBefore.get(id),
    };
  }
  return { group: "exit", specs: [HPA392_EXIT_SPEC], before: undefined };
}

function validatePhaseSequence(phases) {
  const ids = phases.map((phaseToValidate) => phaseToValidate.id);
  const ordinary = ["ordinary"];
  const captureOnly = [HPA392_PHASE_NAMES.captureProof];
  if (
    JSON.stringify(ids) === JSON.stringify(ordinary) ||
    JSON.stringify(ids) === JSON.stringify(captureOnly)
  ) {
    return;
  }
  if (JSON.stringify(ids) !== JSON.stringify(HPA392_FULL_PHASE_ORDER)) {
    throw new Error("Invalid HPA-392 phase plan.");
  }
  const captureRoot = phases[0].appDataDir;
  const persistenceRoot = phases[1].appDataDir;
  if (
    captureRoot === persistenceRoot ||
    phases.slice(1).some((phaseToValidate) => {
      return phaseToValidate.appDataDir !== persistenceRoot;
    })
  ) {
    throw new Error("Invalid HPA-392 phase plan roots.");
  }
}

export function buildHpa392PhaseEnvironment(
  phaseToRun,
  { baseEnvironment = process.env, outputDirectory },
) {
  validatePhase(phaseToRun);
  if (typeof outputDirectory !== "string" || outputDirectory.length === 0) {
    throw new Error("Unknown HPA-392 E2E output directory.");
  }
  const environment = { ...baseEnvironment };
  delete environment.LYRA_E2E_APP_DATA_DIR;
  delete environment.LYRA_E2E_CAPTURE_BACKEND_LOGS;
  delete environment.LYRA_E2E_OUTPUT_DIR;
  delete environment.LYRA_HPA392_PHASE;
  return {
    ...environment,
    ...phaseToRun.environment,
    LYRA_E2E_APP_DATA_DIR: phaseToRun.appDataDir,
    LYRA_E2E_OUTPUT_DIR: outputDirectory,
  };
}

export function executeHpa392PhasePlan(
  phases,
  { spawnPhase, captureFailureArtifacts, cleanupAppDataDir },
) {
  if (!Array.isArray(phases) || phases.length === 0) {
    throw new Error("Unknown HPA-392 E2E phase plan.");
  }
  const roots = [
    ...new Set(phases.map((phaseToValidate) => phaseToValidate.appDataDir)),
  ];
  let exitCode = 0;
  try {
    for (const phaseToValidate of phases) validatePhase(phaseToValidate);
    validatePhaseSequence(phases);
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
        console.error("HPA-392 E2E app data cleanup failed:", error);
      }
    }
  }
}
