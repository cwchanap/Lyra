const BACKEND_LOG_ENVIRONMENT = Object.freeze({
  LYRA_E2E_CAPTURE_BACKEND_LOGS: "1",
});

export const E2E_SMOKE_SPECS = Object.freeze(["./e2e-tauri/smoke.e2e.ts"]);

const gameplaySpecs = Object.freeze([
  "./e2e-tauri/app.e2e.ts",
  "./e2e-tauri/investigation-layout.e2e.ts",
  "./e2e-tauri/scene-navigation-gate.e2e.ts",
]);

function phase(id, group, root, specs, before) {
  const environment = Object.freeze({
    ...BACKEND_LOG_ENVIRONMENT,
    ...(group === "management" || group === "exit"
      ? { LYRA_SAVE_E2E_PHASE: id }
      : {}),
  });
  return Object.freeze({
    id,
    group,
    root,
    specs: Object.freeze([...specs]),
    environment,
    ...(before === undefined ? {} : { before: Object.freeze(before) }),
  });
}

export const E2E_SUITE_IDS = Object.freeze([
  "smoke",
  "gameplay",
  "production-journey",
  "capture-proof",
  "save-core",
  "save-management",
  "exit-lifecycle",
]);

export const E2E_SUITE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "smoke",
    phases: Object.freeze([phase("smoke", "smoke", "smoke", E2E_SMOKE_SPECS)]),
  }),
  Object.freeze({
    id: "gameplay",
    phases: Object.freeze([
      phase("ordinary", "ordinary", "gameplay", gameplaySpecs),
    ]),
  }),
  // This leaf suite reserves stable CI routing ownership for the dedicated
  // fresh-install production journey added later.
  Object.freeze({ id: "production-journey", phases: Object.freeze([]) }),
  Object.freeze({
    id: "capture-proof",
    phases: Object.freeze([
      phase("capture-proof", "capture-proof", "capture", [
        "./e2e-tauri/capture-proof.e2e.ts",
      ]),
    ]),
  }),
  Object.freeze({
    id: "save-core",
    phases: Object.freeze([
      phase("save-seed", "seed", "persistence", [
        "./e2e-tauri/save-seed.e2e.ts",
      ]),
      phase("save-resume", "resume", "persistence", [
        "./e2e-tauri/save-resume.e2e.ts",
      ]),
    ]),
  }),
  Object.freeze({
    id: "save-management",
    phases: Object.freeze([
      phase("management-seed", "management", "persistence", [
        "./e2e-tauri/save-management.e2e.ts",
      ]),
      phase(
        "management-corrupt-newest",
        "management",
        "persistence",
        ["./e2e-tauri/save-management.e2e.ts"],
        { type: "corrupt-slot", fixedSlotName: "autosave-1" },
      ),
      phase("management-recover-older", "management", "persistence", [
        "./e2e-tauri/save-management.e2e.ts",
      ]),
      phase(
        "management-missing-thumbnail",
        "management",
        "persistence",
        ["./e2e-tauri/save-management.e2e.ts"],
        { type: "remove-observed-sidecar", fixedSlotName: "manual-1" },
      ),
      phase("management-restore-thumbnail", "management", "persistence", [
        "./e2e-tauri/save-management.e2e.ts",
      ]),
      phase(
        "management-corrupt-thumbnail",
        "management",
        "persistence",
        ["./e2e-tauri/save-management.e2e.ts"],
        { type: "corrupt-observed-sidecar", fixedSlotName: "manual-1" },
      ),
      phase("management-delete", "management", "persistence", [
        "./e2e-tauri/save-management.e2e.ts",
      ]),
    ]),
  }),
  Object.freeze({
    id: "exit-lifecycle",
    phases: Object.freeze([
      phase("exit-close-seed", "exit", "exit", [
        "./e2e-tauri/save-exit.e2e.ts",
      ]),
      phase("exit-close-resume", "exit", "exit", [
        "./e2e-tauri/save-exit.e2e.ts",
      ]),
      phase("exit-quit-seed", "exit", "exit", ["./e2e-tauri/save-exit.e2e.ts"]),
      phase("exit-quit-resume", "exit", "exit", [
        "./e2e-tauri/save-exit.e2e.ts",
      ]),
      phase("exit-failure-bypass", "exit", "exit", [
        "./e2e-tauri/save-exit.e2e.ts",
      ]),
      phase("exit-final-verification", "exit", "exit", [
        "./e2e-tauri/save-exit.e2e.ts",
      ]),
    ]),
  }),
]);

const definitionsById = new Map(
  E2E_SUITE_DEFINITIONS.map((definition) => [definition.id, definition]),
);
const phasesById = new Map(
  E2E_SUITE_DEFINITIONS.flatMap((definition) =>
    definition.phases.map((item) => [item.id, item]),
  ),
);
const canonicalPhaseIds = E2E_SUITE_DEFINITIONS.flatMap((definition) =>
  definition.phases.map((item) => item.id),
);
const approvedSpecs = new Set(
  E2E_SUITE_DEFINITIONS.flatMap((definition) =>
    definition.phases.flatMap((item) => item.specs),
  ),
);
const fixedSlotNames = new Set([
  "autosave-1",
  "autosave-2",
  "autosave-3",
  "autosave-4",
  "autosave-5",
  "manual-1",
  "manual-2",
  "manual-3",
]);

export const SAVE_E2E_ORDINARY_SPECS = gameplaySpecs;
export const SAVE_E2E_PHASE_NAMES = Object.freeze(
  Object.fromEntries(
    [...phasesById.keys()].map((id) => [
      id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
      id,
    ]),
  ),
);

export function normalizeE2eSuiteIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0)
    throw new Error("No e2e suites were selected.");
  const requested = new Set();
  for (const id of ids) {
    if (typeof id !== "string" || !definitionsById.has(id))
      throw new Error(`Unknown e2e suite: ${String(id)}`);
    requested.add(id);
  }
  return E2E_SUITE_IDS.filter((id) => requested.has(id));
}

export function resolveE2eSuiteSelection({ full = false, suiteIds = [] } = {}) {
  if (full) {
    if (suiteIds.length > 0)
      throw new Error("E2E suite selection modes are mutually exclusive.");
    return [...E2E_SUITE_IDS];
  }
  return normalizeE2eSuiteIds(suiteIds);
}

export function validateE2ePhaseOwnership(phaseToValidate) {
  const expected = phasesById.get(phaseToValidate?.id);
  if (!expected) throw new Error("Unknown save e2e phase.");
  if (
    !Array.isArray(phaseToValidate.specs) ||
    phaseToValidate.specs.length === 0 ||
    phaseToValidate.specs.some((spec) => !approvedSpecs.has(spec))
  ) {
    throw new Error(`Unknown save e2e spec: ${String(phaseToValidate.specs)}`);
  }
  if (
    phaseToValidate.before !== undefined &&
    (!phaseToValidate.before ||
      ![
        "corrupt-slot",
        "remove-observed-sidecar",
        "corrupt-observed-sidecar",
      ].includes(phaseToValidate.before.type) ||
      !fixedSlotNames.has(phaseToValidate.before.fixedSlotName))
  ) {
    throw new Error("Unknown save e2e checkpoint action.");
  }
  for (const key of ["group", "root", "specs", "environment", "before"]) {
    if (JSON.stringify(phaseToValidate[key]) !== JSON.stringify(expected[key]))
      throw new Error("Invalid save e2e phase plan.");
  }
  return true;
}

export function validateE2ePhaseSequence(phases) {
  const ids = phases.map((item) => item.id);
  if (
    new Set(ids).size !== ids.length ||
    JSON.stringify(ids) !==
      JSON.stringify(canonicalPhaseIds.filter((id) => ids.includes(id)))
  ) {
    throw new Error("Invalid save e2e phase plan.");
  }
  return true;
}

export function validateSelectedE2eSuiteDefinitions(suiteIds) {
  const selected = normalizeE2eSuiteIds(suiteIds);
  const phases = selected.flatMap((id) => definitionsById.get(id).phases);
  for (const phaseToValidate of phases)
    validateE2ePhaseOwnership(phaseToValidate);
  validateE2ePhaseSequence(phases);
  return selected;
}

export function buildE2ePhasePlan(suiteIds, appDataDirectories) {
  const phases = validateSelectedE2eSuiteDefinitions(suiteIds).flatMap(
    (id) => definitionsById.get(id).phases,
  );
  return phases.map((definition) => {
    const result = {
      id: definition.id,
      group: definition.group,
      appDataDir:
        appDataDirectories[definition.root] ??
        appDataDirectories[
          {
            smoke: "ordinary",
            capture: "captureProof",
            exit: "persistence",
          }[definition.root]
        ],
      specs: [...definition.specs],
      environment: { ...definition.environment },
      ...(definition.before === undefined
        ? {}
        : { before: { ...definition.before } }),
    };
    Object.defineProperty(result, "root", {
      value: definition.root,
      enumerable: false,
    });
    return result;
  });
}

export function e2eSuitePhaseRoots(suiteIds) {
  return [
    ...new Set(
      normalizeE2eSuiteIds(suiteIds).flatMap((id) =>
        definitionsById.get(id).phases.map((item) => item.root),
      ),
    ),
  ];
}

const guardedRootBySuiteId = Object.freeze({
  smoke: "smoke",
  gameplay: "gameplay",
  "production-journey": "productionJourney",
  "capture-proof": "capture",
  "save-core": "persistence",
  "save-management": "persistence",
  "exit-lifecycle": "exit",
});

export function e2eSuiteGuardedRoots(suiteIds) {
  return [
    ...new Set(
      normalizeE2eSuiteIds(suiteIds).map(
        (suiteId) => guardedRootBySuiteId[suiteId],
      ),
    ),
  ];
}

export function e2eSuiteForPhase(phaseId) {
  const suite = E2E_SUITE_DEFINITIONS.find((definition) =>
    definition.phases.some((phaseDefinition) => phaseDefinition.id === phaseId),
  );
  if (!suite) throw new Error(`Unknown e2e phase: ${String(phaseId)}`);
  return suite.id;
}
