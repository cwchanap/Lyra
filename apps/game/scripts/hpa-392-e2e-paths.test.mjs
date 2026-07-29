import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildHpa392PhaseEnvironment,
  buildHpa392PhasePlan,
  assertNoUnknownHpa392Sidecars,
  corruptHpa392ObservedSidecar,
  corruptHpa392Slot,
  createHpa392E2eAppDataDir,
  executeHpa392PhasePlan,
  guardedRemoveHpa392E2eAppDataDir,
  productionAppDataDir,
  readHpa392ControlExpectation,
  readHpa392SlotFiles,
  removeHpa392ObservedSidecar,
  resolveHpa392ObservedSidecar,
  validateHpa392E2eAppDataDir,
  writeHpa392ControlExpectation,
} from "./hpa-392-e2e-paths.mjs";

const holders = [];

function holder(prefix = "lyra-hpa-392-path-test-") {
  const value = mkdtempSync(path.join(tmpdir(), prefix));
  holders.push(value);
  return value;
}

test.afterEach(() => {
  for (const directory of holders.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("accepts only an absolute generated lyra-hpa-392 child of the OS temp root", () => {
  const generated = createHpa392E2eAppDataDir();
  holders.push(generated);

  assert.equal(path.isAbsolute(generated), true);
  assert.equal(path.dirname(generated), realpathSync(tmpdir()));
  assert.match(path.basename(generated), /^lyra-hpa-392-/);
  assert.equal(validateHpa392E2eAppDataDir(generated), generated);
});

test("refuses missing, relative, temp-root, home, production, and wrong-prefix paths", () => {
  const valid = holder("lyra-hpa-392-");
  const production = holder("lyra-hpa-392-production-");
  const wrongPrefix = holder("not-lyra-save-proof-");
  const missing = path.join(tmpdir(), "lyra-hpa-392-does-not-exist");

  const rejected = [
    undefined,
    "",
    "relative/lyra-hpa-392-test",
    tmpdir(),
    homedir(),
    production,
    wrongPrefix,
    missing,
  ];

  for (const candidate of rejected) {
    assert.throws(
      () =>
        validateHpa392E2eAppDataDir(candidate, {
          productionAppDataDir: production,
        }),
      /unsafe HPA-392 E2E app-data directory/i,
      String(candidate),
    );
  }

  assert.equal(
    validateHpa392E2eAppDataDir(valid, {
      productionAppDataDir: production,
    }),
    realpathSync(valid),
  );
});

test(
  "refuses a prefixed symlink whose canonical target escapes the temp root",
  { skip: process.platform === "win32" },
  () => {
    const linkHolder = holder("hpa-path-link-holder-");
    const outside = path.resolve(process.cwd());
    const link = path.join(linkHolder, "lyra-hpa-392-symlink");
    symlinkSync(outside, link, "dir");

    assert.throws(
      () => validateHpa392E2eAppDataDir(link),
      /unsafe HPA-392 E2E app-data directory/i,
    );
    assert.equal(realpathSync(outside), outside);
  },
);

test("revalidates immediately before cleanup and removes only the validated directory", () => {
  const generated = holder("lyra-hpa-392-");
  const sentinel = path.join(generated, "sentinel.txt");
  writeFileSync(sentinel, "test-owned");

  guardedRemoveHpa392E2eAppDataDir(generated);

  assert.throws(() => readFileSync(sentinel));
  assert.throws(() => validateHpa392E2eAppDataDir(generated));
});

test(
  "revalidation blocks cleanup after a validated path is replaced by a symlink escape",
  { skip: process.platform === "win32" },
  () => {
    const generated = holder("lyra-hpa-392-");
    const outside = holder("outside-hpa-proof-");
    const sentinel = path.join(outside, "keep.txt");
    writeFileSync(sentinel, "keep");

    assert.equal(
      validateHpa392E2eAppDataDir(generated),
      realpathSync(generated),
    );
    rmSync(generated, { recursive: true });
    symlinkSync(outside, generated, "dir");

    assert.throws(
      () => guardedRemoveHpa392E2eAppDataDir(generated),
      /unsafe HPA-392 E2E app-data directory/i,
    );
    assert.equal(readFileSync(sentinel, "utf8"), "keep");
  },
);

test("refuses nested prefixed directories rather than broadening cleanup scope", () => {
  const parent = holder("lyra-hpa-392-parent-");
  const nested = path.join(parent, "lyra-hpa-392-nested");
  mkdirSync(nested);

  assert.throws(
    () => validateHpa392E2eAppDataDir(nested),
    /unsafe HPA-392 E2E app-data directory/i,
  );
});

test("derives the production comparison from each platform data directory", () => {
  assert.equal(
    productionAppDataDir({
      platform: "darwin",
      homeDir: "/Users/tester",
      environment: {},
    }),
    "/Users/tester/Library/Application Support/com.chanwaichan.lyra",
  );
  assert.equal(
    productionAppDataDir({
      platform: "linux",
      homeDir: "/home/tester",
      environment: { XDG_DATA_HOME: "/var/test-data" },
    }),
    "/var/test-data/com.chanwaichan.lyra",
  );
  assert.equal(
    productionAppDataDir({
      platform: "linux",
      homeDir: "/home/tester",
      environment: {},
    }),
    "/home/tester/.local/share/com.chanwaichan.lyra",
  );
  assert.equal(
    productionAppDataDir({
      platform: "win32",
      homeDir: "C:\\Users\\tester",
      environment: { APPDATA: "D:\\Roaming" },
      pathApi: path.win32,
    }),
    "D:\\Roaming\\com.chanwaichan.lyra",
  );
});

test("--ordinary yields only the existing non-HPA specs with one guarded root", () => {
  const ordinary = holder("lyra-hpa-392-");
  const plan = buildHpa392PhasePlan({
    mode: "--ordinary",
    ordinaryAppDataDir: ordinary,
  });

  assert.deepEqual(plan, [
    {
      id: "ordinary",
      group: "ordinary",
      appDataDir: realpathSync(ordinary),
      specs: [
        "./e2e-tauri/app.e2e.ts",
        "./e2e-tauri/investigation-layout.e2e.ts",
        "./e2e-tauri/scene-navigation-gate.e2e.ts",
      ],
      environment: { LYRA_E2E_CAPTURE_BACKEND_LOGS: "1" },
    },
  ]);
});

test("phase child environments replace stale guarded values instead of inheriting them", () => {
  const ordinary = holder("lyra-hpa-392-");
  const [phase] = buildHpa392PhasePlan({
    mode: "--ordinary",
    ordinaryAppDataDir: ordinary,
  });
  const outputDirectory = path.join(ordinary, "runner-logs", "ordinary");

  const environment = buildHpa392PhaseEnvironment(phase, {
    baseEnvironment: {
      KEEP_ME: "yes",
      LYRA_E2E_APP_DATA_DIR: "/stale/app-data",
      LYRA_E2E_CAPTURE_BACKEND_LOGS: "0",
      LYRA_E2E_OUTPUT_DIR: "/stale/output",
      LYRA_HPA392_PHASE: "management-delete",
    },
    outputDirectory,
  });

  assert.deepEqual(environment, {
    KEEP_ME: "yes",
    LYRA_E2E_CAPTURE_BACKEND_LOGS: "1",
    LYRA_E2E_APP_DATA_DIR: realpathSync(ordinary),
    LYRA_E2E_OUTPUT_DIR: outputDirectory,
  });
});

test("--capture-proof yields only the packaged capture proof", () => {
  const capture = holder("lyra-hpa-392-");
  const plan = buildHpa392PhasePlan({
    mode: "--capture-proof",
    captureProofAppDataDir: capture,
  });

  assert.deepEqual(plan, [
    {
      id: "capture-proof",
      group: "capture-proof",
      appDataDir: realpathSync(capture),
      specs: ["./e2e-tauri/hpa-392-capture-proof.e2e.ts"],
      environment: { LYRA_E2E_CAPTURE_BACKEND_LOGS: "1" },
    },
  ]);
});

test("--full orders proof, seed, resume, management, and exit with isolated roots", () => {
  const capture = holder("lyra-hpa-392-");
  const persistence = holder("lyra-hpa-392-");
  const plan = buildHpa392PhasePlan({
    mode: "--full",
    captureProofAppDataDir: capture,
    persistenceAppDataDir: persistence,
  });

  const groups = plan.map((phase) => phase.group);
  assert.deepEqual(groups.slice(0, 3), ["capture-proof", "seed", "resume"]);
  assert.equal(
    groups.filter((group) => group === "management").length > 0,
    true,
  );
  assert.equal(groups.filter((group) => group === "exit").length > 0, true);
  assert.equal(
    groups.findIndex((group) => group === "management") <
      groups.findIndex((group) => group === "exit"),
    true,
  );
  assert.equal(plan[0].appDataDir, realpathSync(capture));
  for (const phase of plan.slice(1)) {
    assert.equal(phase.appDataDir, realpathSync(persistence), phase.id);
  }
  for (const phase of plan) {
    assert.equal(
      phase.environment.LYRA_E2E_CAPTURE_BACKEND_LOGS,
      "1",
      phase.id,
    );
    if (phase.group === "management" || phase.group === "exit") {
      assert.deepEqual(
        phase.environment,
        {
          LYRA_E2E_CAPTURE_BACKEND_LOGS: "1",
          LYRA_HPA392_PHASE: phase.id,
        },
        phase.id,
      );
    }
  }
});

test("a failing persistence phase captures backend logs and artifacts before guarded cleanup", () => {
  const capture = holder("lyra-hpa-392-");
  const persistence = holder("lyra-hpa-392-");
  const phases = buildHpa392PhasePlan({
    mode: "--full",
    captureProofAppDataDir: capture,
    persistenceAppDataDir: persistence,
  });
  const spawned = [];
  const artifacts = [];
  const cleaned = [];
  const events = [];

  const exitCode = executeHpa392PhasePlan(phases, {
    spawnPhase(phase) {
      spawned.push(phase.id);
      if (phase.id === "save-seed") {
        assert.equal(phase.environment.LYRA_E2E_CAPTURE_BACKEND_LOGS, "1");
      }
      return phase.id === "save-seed" ? 23 : 0;
    },
    captureFailureArtifacts(phase, code) {
      artifacts.push([phase.id, code]);
      events.push(`capture:${phase.id}`);
    },
    cleanupAppDataDir(directory) {
      cleaned.push(directory);
      events.push(`cleanup:${path.basename(directory)}`);
    },
  });

  assert.equal(exitCode, 23);
  assert.deepEqual(spawned, ["capture-proof", "save-seed"]);
  assert.deepEqual(artifacts, [["save-seed", 23]]);
  assert.deepEqual(
    cleaned.sort(),
    [realpathSync(capture), realpathSync(persistence)].sort(),
  );
  assert.equal(events[0], "capture:save-seed");
  assert.equal(
    events.slice(1).every((event) => event.startsWith("cleanup:")),
    true,
  );
});

test("an unknown mode or spec is rejected before any child is spawned", () => {
  const ordinary = holder("lyra-hpa-392-");
  assert.throws(
    () =>
      buildHpa392PhasePlan({
        mode: "--mystery",
        ordinaryAppDataDir: ordinary,
      }),
    /unknown HPA-392 E2E mode/i,
  );

  const phases = buildHpa392PhasePlan({
    mode: "--ordinary",
    ordinaryAppDataDir: ordinary,
  });
  phases[0].specs = ["./e2e-tauri/not-approved.e2e.ts"];
  let spawned = false;
  assert.throws(
    () =>
      executeHpa392PhasePlan(phases, {
        spawnPhase() {
          spawned = true;
          return 0;
        },
        captureFailureArtifacts() {},
        cleanupAppDataDir() {},
      }),
    /unknown HPA-392 E2E spec/i,
  );
  assert.equal(spawned, false);
});

test("an unknown disk checkpoint action is rejected before spawn", () => {
  const ordinary = holder("lyra-hpa-392-");
  const phases = buildHpa392PhasePlan({
    mode: "--ordinary",
    ordinaryAppDataDir: ordinary,
  });
  phases[0].before = {
    type: "write-arbitrary-file",
    path: "/tmp/not-allowed",
  };
  let spawned = false;

  assert.throws(
    () =>
      executeHpa392PhasePlan(phases, {
        spawnPhase() {
          spawned = true;
          return 0;
        },
        captureFailureArtifacts() {},
        cleanupAppDataDir() {},
      }),
    /unknown HPA-392 checkpoint action/i,
  );
  assert.equal(spawned, false);
});

test("an approved spec in the wrong phase is rejected before spawn", () => {
  const ordinary = holder("lyra-hpa-392-");
  const phases = buildHpa392PhasePlan({
    mode: "--ordinary",
    ordinaryAppDataDir: ordinary,
  });
  phases[0].specs = ["./e2e-tauri/hpa-392-capture-proof.e2e.ts"];
  let spawned = false;

  assert.throws(
    () =>
      executeHpa392PhasePlan(phases, {
        spawnPhase() {
          spawned = true;
          return 0;
        },
        captureFailureArtifacts() {},
        cleanupAppDataDir() {},
      }),
    /invalid HPA-392 phase plan/i,
  );
  assert.equal(spawned, false);
});

test("slot fixtures enumerate exactly eight fixed envelopes without broad reads", () => {
  const appData = holder("lyra-hpa-392-");
  const saves = path.join(appData, "saves");
  mkdirSync(saves);
  writeFileSync(path.join(saves, "manual-2.json"), '{"saveId":"fixture"}\n');
  writeFileSync(path.join(saves, "notes.txt"), "not owned");

  const slots = readHpa392SlotFiles(appData);

  assert.deepEqual(
    slots.map(({ fixedSlotName }) => fixedSlotName),
    [
      "autosave-1",
      "autosave-2",
      "autosave-3",
      "autosave-4",
      "autosave-5",
      "manual-1",
      "manual-2",
      "manual-3",
    ],
  );
  assert.equal(
    slots.find(({ fixedSlotName }) => fixedSlotName === "manual-2").text,
    '{"saveId":"fixture"}\n',
  );
  assert.equal(
    slots.find(({ fixedSlotName }) => fixedSlotName === "manual-1").text,
    null,
  );
});

test("slot corruption accepts one fixed existing slot and rejects traversal", () => {
  const appData = holder("lyra-hpa-392-");
  const saves = path.join(appData, "saves");
  mkdirSync(saves);
  const slot = path.join(saves, "autosave-1.json");
  const outside = path.join(appData, "keep.txt");
  writeFileSync(slot, '{"valid":true}\n');
  writeFileSync(outside, "keep");

  corruptHpa392Slot(appData, "autosave-1");

  assert.equal(readFileSync(slot, "utf8"), '{"broken":');
  assert.throws(
    () => corruptHpa392Slot(appData, "../keep"),
    /fixed HPA-392 slot/i,
  );
  assert.equal(readFileSync(outside, "utf8"), "keep");
});

test(
  "slot and control mutation reject symlink escapes",
  { skip: process.platform === "win32" },
  () => {
    const appData = holder("lyra-hpa-392-");
    const saves = path.join(appData, "saves");
    const control = path.join(appData, "test-control");
    const outside = holder("outside-hpa-fixture-");
    const outsideSlot = path.join(outside, "slot.json");
    const outsideControl = path.join(outside, "control.json");
    mkdirSync(saves);
    mkdirSync(control);
    writeFileSync(outsideSlot, "keep-slot");
    writeFileSync(outsideControl, "keep-control");
    symlinkSync(outsideSlot, path.join(saves, "manual-1.json"));
    symlinkSync(
      outsideControl,
      path.join(control, "expected-resume-checkpoint.json"),
    );

    assert.throws(
      () => corruptHpa392Slot(appData, "manual-1"),
      /unsafe HPA-392 E2E app-data directory/i,
    );
    assert.throws(
      () =>
        writeHpa392ControlExpectation(
          appData,
          "expected-resume-checkpoint",
          {},
        ),
      /unsafe HPA-392 E2E app-data directory/i,
    );
    assert.equal(readFileSync(outsideSlot, "utf8"), "keep-slot");
    assert.equal(readFileSync(outsideControl, "utf8"), "keep-control");
  },
);

test("observed sidecar mutation requires a canonical matching UUID", () => {
  const appData = holder("lyra-hpa-392-");
  const saves = path.join(appData, "saves");
  const thumbnails = path.join(saves, "thumbnails");
  mkdirSync(thumbnails, { recursive: true });
  const saveId = "123e4567-e89b-42d3-a456-426614174000";
  const slot = path.join(saves, "manual-1.json");
  const sidecar = path.join(thumbnails, `${saveId}.png`);
  writeFileSync(
    slot,
    JSON.stringify({
      saveId,
      thumbnail: { type: "available", objectId: saveId },
    }),
  );
  writeFileSync(sidecar, "png");

  assert.equal(
    resolveHpa392ObservedSidecar(appData, "manual-1"),
    realpathSync(sidecar),
  );
  corruptHpa392ObservedSidecar(appData, "manual-1");
  assert.equal(readFileSync(sidecar, "utf8"), "not-a-png");
  removeHpa392ObservedSidecar(appData, "manual-1");
  assert.throws(() => readFileSync(sidecar));

  writeFileSync(
    slot,
    JSON.stringify({
      saveId: "not-a-uuid",
      thumbnail: { type: "available", objectId: "not-a-uuid" },
    }),
  );
  assert.throws(
    () => removeHpa392ObservedSidecar(appData, "manual-1"),
    /canonical UUID/i,
  );
});

test("sidecar inventory rejects unknown names and unreferenced canonical files", () => {
  const appData = holder("lyra-hpa-392-");
  const thumbnails = path.join(appData, "saves", "thumbnails");
  mkdirSync(thumbnails, { recursive: true });
  writeFileSync(path.join(thumbnails, "unexpected.txt"), "keep");

  assert.throws(
    () => assertNoUnknownHpa392Sidecars(appData),
    /unknown HPA-392 sidecar/i,
  );
});

test("control expectations live outside saves and accept only closed names", () => {
  const appData = holder("lyra-hpa-392-");
  mkdirSync(path.join(appData, "saves"));

  writeHpa392ControlExpectation(appData, "expected-resume-checkpoint", {
    saveId: "fixture",
  });

  assert.deepEqual(
    readHpa392ControlExpectation(appData, "expected-resume-checkpoint"),
    { saveId: "fixture" },
  );
  assert.equal(
    readFileSync(
      path.join(appData, "test-control", "expected-resume-checkpoint.json"),
      "utf8",
    ),
    '{\n  "saveId": "fixture"\n}\n',
  );
  assert.throws(
    () => writeHpa392ControlExpectation(appData, "../saves/manual-1", {}),
    /test-control expectation/i,
  );
});
