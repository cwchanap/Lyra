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

test("routes the checkpoint bridge layout to smoke and gameplay", () => {
  // +layout.svelte installs window.__lyraE2e and renders the checkpoint-
  // generation marker that loadPackagedCheckpoint() waits on. Only gameplay
  // specs call loadPackagedCheckpoint(); smoke does not. A bridge-only break
  // must therefore select gameplay, not just smoke.
  const plan = selectE2eSuites({
    changedPaths: ["apps/game/src/routes/+layout.svelte"],
  });

  assert.deepEqual(plan.suiteIds, ["smoke", "gameplay"]);
  assert.equal(plan.forcedFull, false);
});

test("routes unrelated general UI changes to smoke", () => {
  assert.deepEqual(
    selectE2eSuites({
      changedPaths: ["apps/game/src/lib/components/MainMenu.svelte"],
    }).suiteIds,
    ["smoke"],
  );
});

test("treats layout-editor changes as explicitly outside game E2E ownership", () => {
  for (const changedPath of [
    "apps/layout-editor/src/App.svelte",
    "apps/layout-editor/src-tauri/src/lib.rs",
  ]) {
    const plan = selectE2eSuites({ changedPaths: [changedPath] });

    assert.deepEqual(plan.suiteIds, [], changedPath);
    assert.equal(plan.skip, true, changedPath);
    assert.equal(plan.forcedFull, false, changedPath);
    assert.deepEqual(plan.unmatchedPaths, [], changedPath);
    assert.deepEqual(
      plan.matchedRules,
      [{ id: "layout-editor", paths: [changedPath] }],
      changedPath,
    );
  }
});

test("keeps layout-editor plus documentation outside game E2E", () => {
  const plan = selectE2eSuites({
    changedPaths: [
      "docs/superpowers/specs/layout-editor-notes.md",
      "apps/layout-editor/src/App.svelte",
    ],
  });

  assert.deepEqual(plan.suiteIds, []);
  assert.equal(plan.skip, true);
  assert.equal(plan.forcedFull, false);
  assert.deepEqual(plan.unmatchedPaths, []);
  assert.deepEqual(plan.matchedRules, [
    { id: "layout-editor", paths: ["apps/layout-editor/src/App.svelte"] },
  ]);
});

test("unions layout-editor ownership with real game risk", () => {
  const plan = selectE2eSuites({
    changedPaths: [
      "apps/layout-editor/src/App.svelte",
      "apps/game/src/lib/components/MainMenu.svelte",
    ],
  });

  assert.deepEqual(plan.suiteIds, ["smoke"]);
  assert.equal(plan.forcedFull, false);
  assert.deepEqual(plan.unmatchedPaths, []);
  assert.deepEqual(plan.matchedRules, [
    {
      id: "general-ui",
      paths: ["apps/game/src/lib/components/MainMenu.svelte"],
    },
    { id: "layout-editor", paths: ["apps/layout-editor/src/App.svelte"] },
  ]);
});

test("routes each acquisition acknowledgement surface to its direct lifecycle coverage", () => {
  for (const changedPath of [
    "apps/game/src/lib/components/AcquisitionPopup.svelte",
    "apps/game/src/lib/state/acquisition-controller.svelte.ts",
  ]) {
    const plan = selectE2eSuites({ changedPaths: [changedPath] });

    assert.deepEqual(plan.riskSelectedSuites, [
      "smoke",
      "gameplay",
      "production-journey",
      "save-core",
      "exit-lifecycle",
    ]);
    assert.equal(plan.forcedFull, false);
    assert.equal(plan.suiteIds.includes("capture-proof"), false);
    assert.equal(plan.suiteIds.includes("save-management"), false);
  }
});

test("routes dialogue, crossfade, and page shells through every dependent suite", () => {
  for (const changedPath of [
    "apps/game/src/lib/components/DialogueBox.svelte",
    "apps/game/src/lib/components/CrossfadeImage.svelte",
    "apps/game/src/routes/+page.svelte",
  ]) {
    const plan = selectE2eSuites({ changedPaths: [changedPath] });

    assert.deepEqual(plan.riskSelectedSuites, [
      "smoke",
      "gameplay",
      "production-journey",
      "analysis-beat85",
      "capture-proof",
      "save-core",
      "save-management",
      "exit-lifecycle",
    ]);
    assert.equal(plan.forcedFull, false);
  }
});

test("routes gameplay changes through the focused and fresh-journey suites", () => {
  // The gameplay chain (E2E_CHAIN_DEFINITIONS) owns analysis-beat85, and
  // navigation.rs carries the Beat 8.5 pre-hearing grant helper, so gameplay
  // surfaces route to the deep Beat 8.5 runtime suite as well.
  assert.deepEqual(
    selectE2eSuites({
      changedPaths: ["apps/game/src-tauri/src/game/dialogue.rs"],
    }).suiteIds,
    ["smoke", "gameplay", "production-journey", "analysis-beat85"],
  );
});

test("routes every Interrogation component surface through gameplay coverage", () => {
  for (const changedPath of [
    "apps/game/src/lib/components/InterrogationStage.svelte",
    "apps/game/src/lib/components/InterrogationView.svelte",
    "apps/game/src/lib/components/InterrogationEvidenceTray.svelte",
    "apps/game/src/lib/components/InterrogationSubjectArt.svelte",
  ]) {
    assert.deepEqual(
      selectE2eSuites({ changedPaths: [changedPath] }).suiteIds,
      ["smoke", "gameplay", "production-journey", "analysis-beat85"],
      changedPath,
    );
  }
});

test("routes Analysis component changes through the gameplay chain", () => {
  assert.deepEqual(
    selectE2eSuites({
      changedPaths: [
        "apps/game/src/lib/components/analysis/AnalysisWorkbench.svelte",
      ],
    }).suiteIds,
    ["smoke", "gameplay", "production-journey", "analysis-beat85"],
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

test("mid-pattern globstar matches exit files directly under coordinator and persistence", () => {
  // `coordinator/**/exit*.rs` and `persistence/**/exit*.ts` use a mid-pattern
  // globstar that must match zero directory segments as well as one or more.
  // For the coordinator rule, the persistence rule excludes
  // `coordinator/**/exit*.rs`, so an exit file directly under coordinator
  // routes only to exit-lifecycle. Before the globstar fix, the zero-segment
  // path missed the exclusion and the exit-lifecycle rule and instead pulled
  // in the full persistence suite.
  for (const changedPath of [
    "apps/game/src-tauri/src/game/save/coordinator/exit_handler.rs",
    "apps/game/src-tauri/src/game/save/coordinator/tests/exit_lifecycle.rs",
  ]) {
    const plan = selectE2eSuites({ changedPaths: [changedPath] });

    assert.deepEqual(plan.suiteIds, ["smoke", "exit-lifecycle"], changedPath);
  }
  // The persistence rule does not exclude `persistence/**/exit*.ts`, so exit
  // files under persistence remain covered by the full persistence suite
  // union (exit-lifecycle is already a member) at every depth.
  for (const changedPath of [
    "apps/game/src/lib/persistence/exit_controller.ts",
    "apps/game/src/lib/persistence/exit/exit_controller.ts",
  ]) {
    const plan = selectE2eSuites({ changedPaths: [changedPath] });

    assert.deepEqual(
      plan.suiteIds,
      [
        "smoke",
        "capture-proof",
        "save-core",
        "save-management",
        "exit-lifecycle",
      ],
      changedPath,
    );
  }
});

test("mid-pattern globstar does not match a basename that merely ends with the suffix", () => {
  // `coordinator/**/exit*.rs` must only match files whose segment starts with
  // `exit`, not files like `pre_exit.rs` whose basename ends with `exit`. A
  // replacement that consumed the trailing slash (e.g. `(/.*)?`) would let the
  // optional group eat `/pre_` and the suffix match `exit.rs`, incorrectly
  // excluding these persistence files from the full persistence suite and
  // routing them only to `smoke` plus `exit-lifecycle`.
  for (const changedPath of [
    "apps/game/src-tauri/src/game/save/coordinator/pre_exit.rs",
    "apps/game/src-tauri/src/game/save/coordinator/tests/pre_exit.rs",
  ]) {
    const plan = selectE2eSuites({ changedPaths: [changedPath] });

    assert.deepEqual(
      plan.suiteIds,
      [
        "smoke",
        "capture-proof",
        "save-core",
        "save-management",
        "exit-lifecycle",
      ],
      changedPath,
    );
  }
});

test("treats playable story and compiler inputs as production-journey risks", () => {
  assert.deepEqual(
    selectE2eSuites({
      changedPaths: [
        "docs/stories_plan/chapter_1/investigation_scene_1.md",
        "packages/scripts/compile-scenes/parser-investigation.ts",
      ],
    }).suiteIds,
    ["smoke", "gameplay", "production-journey", "analysis-beat85"],
  );
});

test("preserves the risky source when a rename moves it onto a documentation path", () => {
  // git diff --no-renames emits both sides of a rename as a delete + add.
  // The deleted side is the old story source (a story-and-compiler risk); the
  // added side is a documentation destination that the selector would
  // otherwise treat as documentation-only and skip. Including both paths must
  // keep the story routing instead of under-selecting as a documentation
  // change.
  const plan = selectE2eSuites({
    changedPaths: [
      "static/stories_plan/chapter_1/scene_1.md",
      "docs/archive/chapter_1_scene_1.md",
    ],
  });

  assert.deepEqual(plan.suiteIds, [
    "smoke",
    "gameplay",
    "production-journey",
    "analysis-beat85",
  ]);
  assert.equal(plan.skip, false);
  assert.equal(plan.forcedFull, false);
});

test("does not route a documentation destination alone when the risky source is absent", () => {
  // Confirms the rename test above is meaningful: without the deleted source
  // path, the documentation destination alone is correctly skipped.
  const plan = selectE2eSuites({
    changedPaths: ["docs/archive/chapter_1_scene_1.md"],
  });

  assert.deepEqual(plan.suiteIds, []);
  assert.equal(plan.skip, true);
});

test("routes the live scene compiler entrypoint as a story risk", () => {
  assert.deepEqual(
    selectE2eSuites({
      changedPaths: ["packages/scripts/compile-scenes.ts"],
    }).suiteIds,
    ["smoke", "gameplay", "production-journey", "analysis-beat85"],
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
    "analysis-beat85",
    "capture-proof",
    "save-core",
    "save-management",
    "exit-lifecycle",
  ]);
  assert.equal(plan.forcedFullReason, "e2e-infrastructure");
});

test("forces the complete registry for planner scripts and their contract tests", () => {
  for (const changedPath of [
    "apps/game/scripts/plan-e2e-ci.mjs",
    "apps/game/scripts/require-e2e-binary.mjs",
    "apps/game/scripts/select-e2e-suites.mjs",
    "apps/game/scripts/select-e2e-suites.test.mjs",
  ]) {
    const plan = selectE2eSuites({ changedPaths: [changedPath] });

    assert.deepEqual(
      plan.suiteIds,
      [
        "smoke",
        "gameplay",
        "production-journey",
        "analysis-beat85",
        "capture-proof",
        "save-core",
        "save-management",
        "exit-lifecycle",
      ],
      changedPath,
    );
    assert.equal(plan.forcedFullReason, "e2e-infrastructure", changedPath);
  }
});

test("forces the complete registry for an unknown non-documentation path", () => {
  const plan = selectE2eSuites({ changedPaths: ["infra/new-runner.nix"] });

  assert.deepEqual(plan.suiteIds, [
    "smoke",
    "gameplay",
    "production-journey",
    "analysis-beat85",
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
    changedPaths: ["apps/game/src/lib/components/MainMenu.svelte"],
    forceFull: true,
  });

  assert.deepEqual(plan.riskSelectedSuites, ["smoke"]);
  assert.deepEqual(plan.suiteIds, [
    "smoke",
    "gameplay",
    "production-journey",
    "analysis-beat85",
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
      "analysis-beat85",
      "capture-proof",
      "save-core",
      "save-management",
      "exit-lifecycle",
    ]);
    assert.equal(plan.forcedFull, true);
  }
});
