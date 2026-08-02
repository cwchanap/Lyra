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
  buildSaveE2ePhaseEnvironment,
  buildSaveE2ePhasePlan,
  assertNoUnknownSaveE2eSidecars,
  corruptSaveE2eObservedSidecar,
  corruptSaveE2eSlot,
  createSaveE2eAppDataDir,
  executeSaveE2ePhasePlan,
  removeSaveE2eAppDataDir,
  productionAppDataDir,
  readSaveE2eControlExpectation,
  readSaveE2eSlotFiles,
  removeSaveE2eObservedSidecar,
  resolveSaveE2eObservedSidecar,
  assertSafeSaveE2eAppDataDir,
  writeSaveE2eControlExpectation,
} from "./save-e2e-paths.mjs";

const holders = [];

function holder(prefix = "lyra-save-e2e-path-test-") {
  const value = mkdtempSync(path.join(tmpdir(), prefix));
  holders.push(value);
  return value;
}

test.afterEach(() => {
  for (const directory of holders.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Turbo preserves OS temp-directory variables for packaged E2E tasks", () => {
  const turboConfig = JSON.parse(
    readFileSync(new URL("../../../turbo.json", import.meta.url), "utf8"),
  );

  for (const taskName of ["test:e2e", "test:e2e:run"]) {
    const passThroughEnv = turboConfig.tasks[taskName]?.passThroughEnv ?? [];

    for (const variable of ["TMPDIR", "TMP", "TEMP"]) {
      assert.equal(
        passThroughEnv.includes(variable),
        true,
        `${taskName} must pass through ${variable}`,
      );
    }
  }
});

test("accepts only an absolute generated lyra-save-e2e child of the OS temp root", () => {
  const generated = createSaveE2eAppDataDir();
  holders.push(generated);

  assert.equal(path.isAbsolute(generated), true);
  assert.equal(path.dirname(generated), realpathSync(tmpdir()));
  assert.match(path.basename(generated), /^lyra-save-e2e-/);
  assert.equal(assertSafeSaveE2eAppDataDir(generated), generated);
});

test("refuses missing, relative, temp-root, home, production, and wrong-prefix paths", () => {
  const valid = holder("lyra-save-e2e-");
  const production = holder("lyra-save-e2e-production-");
  const wrongPrefix = holder("not-lyra-save-proof-");
  const missing = path.join(tmpdir(), "lyra-save-e2e-does-not-exist");

  const rejected = [
    undefined,
    "",
    "relative/lyra-save-e2e-test",
    tmpdir(),
    homedir(),
    production,
    wrongPrefix,
    missing,
  ];

  for (const candidate of rejected) {
    assert.throws(
      () =>
        assertSafeSaveE2eAppDataDir(candidate, {
          productionAppDataDir: production,
        }),
      /unsafe save e2e app-data directory/i,
      String(candidate),
    );
  }

  assert.equal(
    assertSafeSaveE2eAppDataDir(valid, {
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
    const link = path.join(linkHolder, "lyra-save-e2e-symlink");
    symlinkSync(outside, link, "dir");

    assert.throws(
      () => assertSafeSaveE2eAppDataDir(link),
      /unsafe save e2e app-data directory/i,
    );
    assert.equal(realpathSync(outside), outside);
  },
);

test("revalidates immediately before cleanup and removes only the validated directory", () => {
  const generated = holder("lyra-save-e2e-");
  const sentinel = path.join(generated, "sentinel.txt");
  writeFileSync(sentinel, "test-owned");

  removeSaveE2eAppDataDir(generated);

  assert.throws(() => readFileSync(sentinel));
  assert.throws(() => assertSafeSaveE2eAppDataDir(generated));
});

test(
  "revalidation blocks cleanup after a validated path is replaced by a symlink escape",
  { skip: process.platform === "win32" },
  () => {
    const generated = holder("lyra-save-e2e-");
    const outside = holder("outside-hpa-proof-");
    const sentinel = path.join(outside, "keep.txt");
    writeFileSync(sentinel, "keep");

    assert.equal(
      assertSafeSaveE2eAppDataDir(generated),
      realpathSync(generated),
    );
    rmSync(generated, { recursive: true });
    symlinkSync(outside, generated, "dir");

    assert.throws(
      () => removeSaveE2eAppDataDir(generated),
      /unsafe save e2e app-data directory/i,
    );
    assert.equal(readFileSync(sentinel, "utf8"), "keep");
  },
);

test("refuses nested prefixed directories rather than broadening cleanup scope", () => {
  const parent = holder("lyra-save-e2e-parent-");
  const nested = path.join(parent, "lyra-save-e2e-nested");
  mkdirSync(nested);

  assert.throws(
    () => assertSafeSaveE2eAppDataDir(nested),
    /unsafe save e2e app-data directory/i,
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
  const ordinary = holder("lyra-save-e2e-");
  const plan = buildSaveE2ePhasePlan({
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
        "./e2e-tauri/case-file.e2e.ts",
        "./e2e-tauri/checkpoint-contract.e2e.ts",
        "./e2e-tauri/investigation-layout.e2e.ts",
        "./e2e-tauri/scene-navigation-gate.e2e.ts",
      ],
      environment: { LYRA_E2E_CAPTURE_BACKEND_LOGS: "1" },
    },
  ]);
});

test("phase child environments replace stale guarded values instead of inheriting them", () => {
  const ordinary = holder("lyra-save-e2e-");
  const [phase] = buildSaveE2ePhasePlan({
    mode: "--ordinary",
    ordinaryAppDataDir: ordinary,
  });
  const outputDirectory = path.join(ordinary, "runner-logs", "ordinary");

  const environment = buildSaveE2ePhaseEnvironment(phase, {
    baseEnvironment: {
      KEEP_ME: "yes",
      LYRA_E2E_APP_DATA_DIR: "/stale/app-data",
      LYRA_E2E_CAPTURE_BACKEND_LOGS: "0",
      LYRA_E2E_OUTPUT_DIR: "/stale/output",
      LYRA_SAVE_E2E_PHASE: "management-delete",
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
  const capture = holder("lyra-save-e2e-");
  const plan = buildSaveE2ePhasePlan({
    mode: "--capture-proof",
    captureProofAppDataDir: capture,
  });

  assert.deepEqual(plan, [
    {
      id: "capture-proof",
      group: "capture-proof",
      appDataDir: realpathSync(capture),
      specs: ["./e2e-tauri/capture-proof.e2e.ts"],
      environment: { LYRA_E2E_CAPTURE_BACKEND_LOGS: "1" },
    },
  ]);
});

test("--full orders proof, seed, resume, management, and exit with isolated roots", () => {
  const capture = holder("lyra-save-e2e-");
  const persistence = holder("lyra-save-e2e-");
  const plan = buildSaveE2ePhasePlan({
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
          LYRA_SAVE_E2E_PHASE: phase.id,
        },
        phase.id,
      );
    }
  }
});

test("the consolidated persistence path retains every disk-mutation and restart boundary", () => {
  const capture = holder("lyra-save-e2e-");
  const persistence = holder("lyra-save-e2e-");
  const plan = buildSaveE2ePhasePlan({
    mode: "--full",
    captureProofAppDataDir: capture,
    persistenceAppDataDir: persistence,
  });

  assert.deepEqual(
    plan.map(({ id, before }) => ({ id, before })),
    [
      { id: "capture-proof", before: undefined },
      { id: "save-seed", before: undefined },
      { id: "save-resume", before: undefined },
      { id: "management-seed", before: undefined },
      {
        id: "management-corrupt-newest",
        before: { type: "corrupt-slot", fixedSlotName: "autosave-1" },
      },
      {
        id: "management-missing-thumbnail",
        before: {
          type: "remove-observed-sidecar",
          fixedSlotName: "manual-1",
        },
      },
      {
        id: "management-corrupt-thumbnail",
        before: {
          type: "corrupt-observed-sidecar",
          fixedSlotName: "manual-2",
        },
      },
      { id: "exit-close-seed", before: undefined },
      { id: "exit-close-resume", before: undefined },
      { id: "exit-quit-resume", before: undefined },
      { id: "exit-failure-bypass", before: undefined },
      { id: "exit-final-verification", before: undefined },
    ],
  );
});

test("a failing persistence phase captures backend logs and artifacts before guarded cleanup", () => {
  const capture = holder("lyra-save-e2e-");
  const persistence = holder("lyra-save-e2e-");
  const phases = buildSaveE2ePhasePlan({
    mode: "--full",
    captureProofAppDataDir: capture,
    persistenceAppDataDir: persistence,
  });
  const spawned = [];
  const artifacts = [];
  const cleaned = [];
  const events = [];

  const exitCode = executeSaveE2ePhasePlan(phases, {
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
  const ordinary = holder("lyra-save-e2e-");
  assert.throws(
    () =>
      buildSaveE2ePhasePlan({
        mode: "--mystery",
        ordinaryAppDataDir: ordinary,
      }),
    /unknown save e2e mode/i,
  );

  const phases = buildSaveE2ePhasePlan({
    mode: "--ordinary",
    ordinaryAppDataDir: ordinary,
  });
  phases[0].specs = ["./e2e-tauri/not-approved.e2e.ts"];
  let spawned = false;
  assert.throws(
    () =>
      executeSaveE2ePhasePlan(phases, {
        spawnPhase() {
          spawned = true;
          return 0;
        },
        captureFailureArtifacts() {},
        cleanupAppDataDir() {},
      }),
    /unknown save e2e spec/i,
  );
  assert.equal(spawned, false);
});

test("an unknown disk checkpoint action is rejected before spawn", () => {
  const ordinary = holder("lyra-save-e2e-");
  const phases = buildSaveE2ePhasePlan({
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
      executeSaveE2ePhasePlan(phases, {
        spawnPhase() {
          spawned = true;
          return 0;
        },
        captureFailureArtifacts() {},
        cleanupAppDataDir() {},
      }),
    /unknown save e2e checkpoint action/i,
  );
  assert.equal(spawned, false);
});

test("an approved spec in the wrong phase is rejected before spawn", () => {
  const ordinary = holder("lyra-save-e2e-");
  const phases = buildSaveE2ePhasePlan({
    mode: "--ordinary",
    ordinaryAppDataDir: ordinary,
  });
  phases[0].specs = ["./e2e-tauri/capture-proof.e2e.ts"];
  let spawned = false;

  assert.throws(
    () =>
      executeSaveE2ePhasePlan(phases, {
        spawnPhase() {
          spawned = true;
          return 0;
        },
        captureFailureArtifacts() {},
        cleanupAppDataDir() {},
      }),
    /invalid save e2e phase plan/i,
  );
  assert.equal(spawned, false);
});

test("slot fixtures enumerate exactly eight fixed envelopes without broad reads", () => {
  const appData = holder("lyra-save-e2e-");
  const saves = path.join(appData, "saves");
  mkdirSync(saves);
  writeFileSync(path.join(saves, "manual-2.json"), '{"saveId":"fixture"}\n');
  writeFileSync(path.join(saves, "notes.txt"), "not owned");

  const slots = readSaveE2eSlotFiles(appData);

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
  const appData = holder("lyra-save-e2e-");
  const saves = path.join(appData, "saves");
  mkdirSync(saves);
  const slot = path.join(saves, "autosave-1.json");
  const outside = path.join(appData, "keep.txt");
  writeFileSync(slot, '{"valid":true}\n');
  writeFileSync(outside, "keep");

  corruptSaveE2eSlot(appData, "autosave-1");

  assert.equal(readFileSync(slot, "utf8"), '{"broken":');
  assert.throws(
    () => corruptSaveE2eSlot(appData, "../keep"),
    /fixed save e2e slot/i,
  );
  assert.equal(readFileSync(outside, "utf8"), "keep");
});

test(
  "slot and control mutation reject symlink escapes",
  { skip: process.platform === "win32" },
  () => {
    const appData = holder("lyra-save-e2e-");
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
      () => corruptSaveE2eSlot(appData, "manual-1"),
      /unsafe save e2e app-data directory/i,
    );
    assert.throws(
      () =>
        writeSaveE2eControlExpectation(
          appData,
          "expected-resume-checkpoint",
          {},
        ),
      /unsafe save e2e app-data directory/i,
    );
    assert.equal(readFileSync(outsideSlot, "utf8"), "keep-slot");
    assert.equal(readFileSync(outsideControl, "utf8"), "keep-control");
  },
);

test("observed sidecar mutation requires a canonical matching UUID", () => {
  const appData = holder("lyra-save-e2e-");
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
    resolveSaveE2eObservedSidecar(appData, "manual-1"),
    realpathSync(sidecar),
  );
  corruptSaveE2eObservedSidecar(appData, "manual-1");
  assert.equal(readFileSync(sidecar, "utf8"), "not-a-png");
  removeSaveE2eObservedSidecar(appData, "manual-1");
  assert.throws(() => readFileSync(sidecar));

  writeFileSync(
    slot,
    JSON.stringify({
      saveId: "not-a-uuid",
      thumbnail: { type: "available", objectId: "not-a-uuid" },
    }),
  );
  assert.throws(
    () => removeSaveE2eObservedSidecar(appData, "manual-1"),
    /canonical UUID/i,
  );
});

test("sidecar inventory rejects unknown names and unreferenced canonical files", () => {
  const appData = holder("lyra-save-e2e-");
  const thumbnails = path.join(appData, "saves", "thumbnails");
  mkdirSync(thumbnails, { recursive: true });
  writeFileSync(path.join(thumbnails, "unexpected.txt"), "keep");

  assert.throws(
    () => assertNoUnknownSaveE2eSidecars(appData),
    /unknown save e2e sidecar/i,
  );
});

test("sidecar inventory accepts legitimately referenced canonical thumbnails", () => {
  const appData = holder("lyra-save-e2e-");
  const saves = path.join(appData, "saves");
  const thumbnails = path.join(saves, "thumbnails");
  mkdirSync(thumbnails, { recursive: true });
  const saveId = "123e4567-e89b-42d3-a456-426614174000";
  writeFileSync(
    path.join(saves, "manual-1.json"),
    JSON.stringify({
      saveId,
      thumbnail: { type: "available", objectId: saveId },
    }),
  );
  writeFileSync(path.join(thumbnails, `${saveId}.png`), "png");

  assert.equal(assertNoUnknownSaveE2eSidecars(appData), true);
});

test("control expectations live outside saves and accept only closed names", () => {
  const appData = holder("lyra-save-e2e-");
  mkdirSync(path.join(appData, "saves"));

  writeSaveE2eControlExpectation(appData, "expected-resume-checkpoint", {
    saveId: "fixture",
  });

  assert.deepEqual(
    readSaveE2eControlExpectation(appData, "expected-resume-checkpoint"),
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
    () => writeSaveE2eControlExpectation(appData, "../saves/manual-1", {}),
    /test-control expectation/i,
  );
});
