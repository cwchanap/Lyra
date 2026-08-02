import assert from "node:assert/strict";
import test from "node:test";
import { selectE2eSuites } from "./select-e2e-suites.mjs";

test("skips packaged E2E for documentation-only planning changes", () => {
  const plan = selectE2eSuites({
    changedPaths: [
      "docs/superpowers/specs/e2e-plan.md",
      "docs/stories_plan/outline.md",
      "static/stories_plan/notes.md",
    ],
  });

  assert.deepEqual(plan.suiteIds, []);
  assert.equal(plan.skip, true);
  assert.equal(plan.forcedFull, false);
});

test("keeps code routing when documentation and UI changes are mixed", () => {
  const plan = selectE2eSuites({
    changedPaths: [
      "docs/superpowers/specs/e2e-plan.md",
      "apps/game/src/lib/components/MainMenu.svelte",
    ],
  });

  assert.deepEqual(plan.suiteIds, ["smoke"]);
  assert.equal(plan.skip, false);
});

test("routes general UI changes to smoke", () => {
  assert.deepEqual(
    selectE2eSuites({
      changedPaths: ["apps/game/src/routes/+page.svelte"],
    }).suiteIds,
    ["smoke"],
  );
});

test("routes gameplay changes through the focused and fresh-journey suites", () => {
  assert.deepEqual(
    selectE2eSuites({
      changedPaths: ["apps/game/src-tauri/src/game/dialogue.rs"],
    }).suiteIds,
    ["smoke", "gameplay", "production-journey"],
  );
});

test("routes persistence changes through every save lifecycle suite", () => {
  assert.deepEqual(
    selectE2eSuites({
      changedPaths: ["apps/game/src-tauri/src/game/save/restore.rs"],
    }).suiteIds,
    [
      "smoke",
      "capture-proof",
      "save-core",
      "save-management",
      "exit-lifecycle",
    ],
  );
});

test("routes capture changes to the independent capture proof", () => {
  assert.deepEqual(
    selectE2eSuites({
      changedPaths: ["apps/game/src-tauri/src/game/save/capture.rs"],
    }).suiteIds,
    ["smoke", "capture-proof"],
  );
});

test("routes exit lifecycle changes without selecting unrelated investigation coverage", () => {
  assert.deepEqual(
    selectE2eSuites({
      changedPaths: [
        "apps/game/src-tauri/src/game/save/coordinator/tests/exit_lifecycle.rs",
      ],
    }).suiteIds,
    ["smoke", "exit-lifecycle"],
  );
});

test("treats playable story and compiler inputs as production-journey risks", () => {
  assert.deepEqual(
    selectE2eSuites({
      changedPaths: [
        "docs/stories_plan/chapter_1/investigation_scene_1.md",
        "packages/scripts/compile-scenes/parser-investigation.ts",
      ],
    }).suiteIds,
    ["smoke", "gameplay", "production-journey"],
  );
});

test("routes the live scene compiler entrypoint as a story risk", () => {
  assert.deepEqual(
    selectE2eSuites({
      changedPaths: ["packages/scripts/compile-scenes.ts"],
    }).suiteIds,
    ["smoke", "gameplay", "production-journey"],
  );
});

test("forces the complete registry for E2E infrastructure", () => {
  const plan = selectE2eSuites({
    changedPaths: ["apps/game/wdio.conf.ts"],
  });

  assert.deepEqual(plan.suiteIds, [
    "smoke",
    "gameplay",
    "production-journey",
    "capture-proof",
    "save-core",
    "save-management",
    "exit-lifecycle",
  ]);
  assert.equal(plan.forcedFullReason, "e2e-infrastructure");
});

test("forces the complete registry for an unknown non-documentation path", () => {
  const plan = selectE2eSuites({ changedPaths: ["infra/new-runner.nix"] });

  assert.deepEqual(plan.suiteIds, [
    "smoke",
    "gameplay",
    "production-journey",
    "capture-proof",
    "save-core",
    "save-management",
    "exit-lifecycle",
  ]);
  assert.deepEqual(plan.unmatchedPaths, ["infra/new-runner.nix"]);
  assert.equal(plan.forcedFullReason, "unmatched-non-documentation-path");
});

test("routes the PR-32 save and recap risk union without gameplay", () => {
  const plan = selectE2eSuites({
    changedPaths: [
      "apps/game/src/lib/components/SaveRecapDetails.svelte",
      "apps/game/src/lib/persistence/persistence-store.svelte.ts",
      "apps/game/src-tauri/src/game/save/restore.rs",
    ],
  });

  assert.deepEqual(plan.suiteIds, [
    "smoke",
    "capture-proof",
    "save-core",
    "save-management",
    "exit-lifecycle",
  ]);
  assert.equal(plan.suiteIds.includes("gameplay"), false);
});

test("manual full coverage adds to automatic routing without suppressing it", () => {
  const plan = selectE2eSuites({
    changedPaths: ["apps/game/src/routes/+page.svelte"],
    forceFull: true,
  });

  assert.deepEqual(plan.riskSelectedSuites, ["smoke"]);
  assert.deepEqual(plan.suiteIds, [
    "smoke",
    "gameplay",
    "production-journey",
    "capture-proof",
    "save-core",
    "save-management",
    "exit-lifecycle",
  ]);
  assert.equal(plan.forcedFullReason, "manual-override");
});

test("runs the complete registry for main, nightly, tags, and manual dispatch", () => {
  for (const input of [
    { ref: "refs/heads/main" },
    { eventName: "schedule" },
    { ref: "refs/tags/v0.1.0" },
    { eventName: "workflow_dispatch" },
  ]) {
    const plan = selectE2eSuites({
      changedPaths: ["docs/superpowers/specs/e2e-plan.md"],
      ...input,
    });
    assert.deepEqual(plan.suiteIds, [
      "smoke",
      "gameplay",
      "production-journey",
      "capture-proof",
      "save-core",
      "save-management",
      "exit-lifecycle",
    ]);
    assert.equal(plan.forcedFull, true);
  }
});
