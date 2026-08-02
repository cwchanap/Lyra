import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeE2eCiPlan } from "./plan-e2e-ci.mjs";

function withPlan(changedPaths, options = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "lyra-e2e-plan-"));
  const artifactDirectory = path.join(directory, "e2e-plan");
  mkdirSync(artifactDirectory);
  const paths = {
    changedPathsFile: path.join(directory, "changed-paths.txt"),
    suiteFile: path.join(artifactDirectory, "e2e-suites.json"),
    reportFile: path.join(artifactDirectory, "e2e-plan.json"),
    matrixFile: path.join(artifactDirectory, "e2e-matrix.json"),
    chainDirectory: path.join(artifactDirectory, "chains"),
    githubOutputFile: path.join(directory, "github-output.txt"),
  };
  writeFileSync(paths.changedPathsFile, changedPaths.join("\n"));
  const plan = writeE2eCiPlan({ ...paths, ...options });
  return {
    plan,
    paths,
    readJson(file) {
      return JSON.parse(readFileSync(file, "utf8"));
    },
    dispose() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("writes persistence-heavy routing as three isolated canonical chains", () => {
  const fixture = withPlan([
    "docs/stories_plan/outline.md",
    "apps/game/src-tauri/src/game/save/restore.rs",
  ]);
  try {
    assert.deepEqual(fixture.plan.suiteIds, [
      "smoke",
      "capture-proof",
      "save-core",
      "save-management",
      "exit-lifecycle",
    ]);
    assert.deepEqual(fixture.readJson(fixture.paths.suiteFile), [
      "smoke",
      "capture-proof",
      "save-core",
      "save-management",
      "exit-lifecycle",
    ]);
    assert.deepEqual(fixture.plan.expectedChainIds, [
      "gameplay",
      "persistence",
      "exit",
    ]);
    assert.deepEqual(fixture.readJson(fixture.paths.matrixFile), {
      include: [
        {
          chainId: "gameplay",
          suiteIds: ["smoke"],
          suiteFile: "chains/gameplay-suites.json",
          cacheKey: "tauri-e2e-gameplay-v1",
          timeoutMinutes: 15,
          artifactName: "tauri-e2e-gameplay",
        },
        {
          chainId: "persistence",
          suiteIds: ["capture-proof", "save-core", "save-management"],
          suiteFile: "chains/persistence-suites.json",
          cacheKey: "tauri-e2e-persistence-v1",
          timeoutMinutes: 15,
          artifactName: "tauri-e2e-persistence",
        },
        {
          chainId: "exit",
          suiteIds: ["exit-lifecycle"],
          suiteFile: "chains/exit-suites.json",
          cacheKey: "tauri-e2e-exit-v1",
          timeoutMinutes: 8,
          artifactName: "tauri-e2e-exit",
        },
      ],
    });
    assert.deepEqual(
      fixture.readJson(
        path.join(fixture.paths.chainDirectory, "gameplay-suites.json"),
      ),
      ["smoke"],
    );
    assert.deepEqual(
      fixture.readJson(
        path.join(fixture.paths.chainDirectory, "persistence-suites.json"),
      ),
      ["capture-proof", "save-core", "save-management"],
    );
    assert.deepEqual(
      fixture.readJson(
        path.join(fixture.paths.chainDirectory, "exit-suites.json"),
      ),
      ["exit-lifecycle"],
    );
    assert.deepEqual(fixture.plan.planner, {
      schemaVersion: 1,
      riskSelectedSuites: [
        "smoke",
        "capture-proof",
        "save-core",
        "save-management",
        "exit-lifecycle",
      ],
      forcedFull: false,
      reason: null,
    });
    const output = readFileSync(fixture.paths.githubOutputFile, "utf8");
    assert.match(output, /should_run=true/);
    assert.match(
      output,
      /expected_chain_ids=\["gameplay","persistence","exit"\]/,
    );
    assert.match(output, /matrix=\{"include":/);
  } finally {
    fixture.dispose();
  }
});

test("smoke-only routing emits only the gameplay chain", () => {
  const fixture = withPlan(["apps/game/src/lib/components/MainMenu.svelte"]);
  try {
    assert.deepEqual(fixture.plan.expectedChainIds, ["gameplay"]);
    assert.deepEqual(fixture.readJson(fixture.paths.matrixFile).include, [
      {
        chainId: "gameplay",
        suiteIds: ["smoke"],
        suiteFile: "chains/gameplay-suites.json",
        cacheKey: "tauri-e2e-gameplay-v1",
        timeoutMinutes: 15,
        artifactName: "tauri-e2e-gameplay",
      },
    ]);
  } finally {
    fixture.dispose();
  }
});

test("forced full routing emits every chain while retaining the risk selection", () => {
  const fixture = withPlan(["apps/game/src/lib/components/MainMenu.svelte"], {
    forceFull: true,
  });
  try {
    assert.deepEqual(fixture.plan.expectedChainIds, [
      "gameplay",
      "persistence",
      "exit",
    ]);
    assert.deepEqual(fixture.plan.planner, {
      schemaVersion: 1,
      riskSelectedSuites: ["smoke"],
      forcedFull: true,
      reason: "manual-override",
    });
    assert.deepEqual(
      fixture
        .readJson(fixture.paths.matrixFile)
        .include.map(({ chainId, suiteIds }) => ({ chainId, suiteIds })),
      [
        {
          chainId: "gameplay",
          suiteIds: ["smoke", "gameplay", "production-journey"],
        },
        {
          chainId: "persistence",
          suiteIds: ["capture-proof", "save-core", "save-management"],
        },
        { chainId: "exit", suiteIds: ["exit-lifecycle"] },
      ],
    );
  } finally {
    fixture.dispose();
  }
});

test("documentation-only routing intentionally emits no execution matrix", () => {
  const fixture = withPlan(["docs/superpowers/specs/e2e-plan.md"]);
  try {
    assert.deepEqual(fixture.readJson(fixture.paths.suiteFile), []);
    assert.deepEqual(fixture.readJson(fixture.paths.matrixFile), {
      include: [],
    });
    assert.deepEqual(fixture.plan.expectedChainIds, []);
    assert.equal(fixture.plan.skip, true);
    const output = readFileSync(fixture.paths.githubOutputFile, "utf8");
    assert.match(output, /should_run=false/);
    assert.match(output, /matrix=\{"include":\[\]\}/);
  } finally {
    fixture.dispose();
  }
});
