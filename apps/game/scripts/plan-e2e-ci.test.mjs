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

test("writes the execution suite file at the uploaded plan artifact root", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "lyra-e2e-plan-"));
  try {
    const changedPathsFile = path.join(directory, "changed-paths.txt");
    const artifactDirectory = path.join(directory, "e2e-plan");
    const suiteFile = path.join(artifactDirectory, "e2e-suites.json");
    const reportFile = path.join(artifactDirectory, "e2e-plan.json");
    const githubOutputFile = path.join(directory, "github-output.txt");
    mkdirSync(artifactDirectory);
    writeFileSync(
      changedPathsFile,
      [
        "docs/stories_plan/outline.md",
        "apps/game/src-tauri/src/game/save/restore.rs",
      ].join("\n"),
    );

    const plan = writeE2eCiPlan({
      changedPathsFile,
      suiteFile,
      reportFile,
      githubOutputFile,
    });

    assert.deepEqual(plan.suiteIds, [
      "smoke",
      "capture-proof",
      "save-core",
      "save-management",
      "exit-lifecycle",
    ]);
    assert.deepEqual(
      JSON.parse(readFileSync(suiteFile, "utf8")),
      plan.suiteIds,
    );
    assert.deepEqual(
      JSON.parse(readFileSync(reportFile, "utf8")).matchedRules,
      [
        {
          id: "persistence",
          paths: ["apps/game/src-tauri/src/game/save/restore.rs"],
        },
      ],
    );
    assert.match(readFileSync(githubOutputFile, "utf8"), /should_run=true/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
