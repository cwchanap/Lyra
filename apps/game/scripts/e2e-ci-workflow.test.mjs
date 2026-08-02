import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseDocument } from "yaml";

const workflowPath = fileURLToPath(
  new URL("../../../.github/workflows/ci.yml", import.meta.url),
);

function loadWorkflow() {
  const document = parseDocument(readFileSync(workflowPath, "utf8"));
  assert.deepEqual(document.errors, []);
  return document.toJS();
}

function namedStep(job, name) {
  const step = job.steps.find((candidate) => candidate.name === name);
  assert.ok(step, `missing ${name} step`);
  return step;
}

function aggregateResult(run, environment) {
  return spawnSync("/bin/bash", ["-e", "-c", run], {
    env: { ...process.env, ...environment },
    encoding: "utf8",
  });
}

test("workflow routes planned suites through an always-validated aggregate gate", () => {
  const workflow = loadWorkflow();
  assert.deepEqual(workflow.on.pull_request.types, [
    "opened",
    "synchronize",
    "reopened",
    "labeled",
    "unlabeled",
  ]);
  assert.equal(Array.isArray(workflow.on.schedule), true);
  assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"));
  assert.deepEqual(workflow.on.push.tags, ["*"]);

  const plan = workflow.jobs["e2e-plan"];
  const execution = workflow.jobs["e2e-execution"];
  const aggregate = workflow.jobs.e2e;
  assert.equal(execution.needs, "e2e-plan");
  assert.equal(
    execution.if,
    "${{ needs.e2e-plan.outputs.should_run == 'true' }}",
  );
  assert.deepEqual(aggregate.needs, ["e2e-plan", "e2e-execution"]);
  assert.equal(aggregate.name, "Tauri E2E");
  assert.equal(aggregate.if, "${{ always() }}");

  const planUpload = namedStep(plan, "Upload E2E plan");
  const download = namedStep(execution, "Download E2E plan");
  assert.equal(planUpload.if, "${{ always() }}");
  assert.equal(planUpload.with.name, "e2e-plan");
  assert.equal(planUpload.with.path, "${{ runner.temp }}/e2e-plan/");
  assert.equal(download.with.name, planUpload.with.name);
  assert.equal(download.with.path, "${{ runner.temp }}/e2e-plan");

  const selectedRun = namedStep(execution, "Run selected Tauri E2E suites");
  assert.match(
    selectedRun.run,
    /--suite-file "\$RUNNER_TEMP\/e2e-plan\/e2e-suites\.json"/,
  );
  assert.equal(
    namedStep(execution, "Run guarded post-cleanup").if,
    "${{ always() }}",
  );
  assert.equal(namedStep(execution, "Upload WDIO logs").if, "${{ always() }}");
});

test("aggregate gate passes only intentional docs skips and complete executions", () => {
  const aggregate = loadWorkflow().jobs.e2e;
  const run = namedStep(aggregate, "Validate E2E gate result").run;

  for (const [environment, expectedStatus] of [
    [
      {
        PLAN_RESULT: "success",
        SHOULD_RUN: "false",
        EXECUTION_RESULT: "skipped",
        MANIFEST_PRESENT: "",
      },
      0,
    ],
    [
      {
        PLAN_RESULT: "failure",
        SHOULD_RUN: "",
        EXECUTION_RESULT: "skipped",
        MANIFEST_PRESENT: "",
      },
      1,
    ],
    [
      {
        PLAN_RESULT: "success",
        SHOULD_RUN: "true",
        EXECUTION_RESULT: "cancelled",
        MANIFEST_PRESENT: "true",
      },
      1,
    ],
    [
      {
        PLAN_RESULT: "success",
        SHOULD_RUN: "true",
        EXECUTION_RESULT: "success",
        MANIFEST_PRESENT: "false",
      },
      1,
    ],
    [
      {
        PLAN_RESULT: "success",
        SHOULD_RUN: "true",
        EXECUTION_RESULT: "success",
        MANIFEST_PRESENT: "true",
      },
      0,
    ],
  ]) {
    const result = aggregateResult(run, environment);
    assert.equal(result.status, expectedStatus, result.stderr);
  }
});
