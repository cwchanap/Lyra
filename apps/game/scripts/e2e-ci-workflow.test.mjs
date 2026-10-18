import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseDocument } from "yaml";

const workflowPath = fileURLToPath(
  new URL("../../../.github/workflows/ci.yml", import.meta.url),
);
const fullWorkflowPath = fileURLToPath(
  new URL("../../../.github/workflows/e2e-full.yml", import.meta.url),
);
const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));

const SMOKE_JOB = "tauri-e2e-pr-smoke";
const FULL_JOB = "tauri-e2e-full";
const CONTRACT_STEP = "Run surviving E2E contract tests";
const CONTRACT_FILES = [
  "apps/game/scripts/e2e-suite-registry.test.mjs",
  "apps/game/scripts/e2e-runner-lifecycle.test.mjs",
  "apps/game/scripts/save-e2e-paths.test.mjs",
  "apps/game/scripts/e2e-ci-workflow.test.mjs",
];

function loadWorkflow(path = workflowPath) {
  const document = parseDocument(readFileSync(path, "utf8"));
  assert.deepEqual(document.errors, []);
  return document.toJS();
}

// Smoke lives in CI and full in its own workflow; the shared checks below
// keep the two files from drifting apart (e.g. losing the shared cache).
function loadPackagedJobs() {
  const smoke = loadWorkflow().jobs[SMOKE_JOB];
  const full = loadWorkflow(fullWorkflowPath).jobs[FULL_JOB];
  assert.ok(smoke, `missing ${SMOKE_JOB} job in ci.yml`);
  assert.ok(full, `missing ${FULL_JOB} job in e2e-full.yml`);
  return { smoke, full };
}

function namedStep(job, name) {
  const step = job.steps.find((candidate) => candidate.name === name);
  assert.ok(step, `missing ${name} step`);
  return step;
}

function runStepMatching(job, pattern) {
  const matches = job.steps.filter(
    (candidate) =>
      typeof candidate.run === "string" && pattern.test(candidate.run),
  );
  assert.equal(
    matches.length,
    1,
    `expected exactly one step matching ${pattern}`,
  );
  return matches[0];
}

test("packaged E2E is exactly two direct jobs; planner machinery is gone", () => {
  const jobs = loadWorkflow().jobs;
  assert.equal(jobs["e2e-plan"], undefined, "planner job must be deleted");
  assert.equal(
    jobs["e2e-execution"],
    undefined,
    "matrix chain job must be deleted",
  );
  assert.equal(jobs.e2e, undefined, "aggregate job must be deleted");
  const raw = JSON.stringify(jobs);
  assert.ok(!raw.includes("e2e-plan"), "no plan artifact may remain");
  assert.ok(
    !raw.includes("plan-e2e-ci"),
    "planner selector must no longer be invoked",
  );
  assert.ok(!raw.includes("e2e-ci-metrics"), "no metrics wrapper may remain");
  assert.ok(
    !raw.includes("e2e-ci-results"),
    "no aggregate routing validator may remain",
  );
  assert.ok(!raw.includes("fromJSON"), "no matrix may remain");
  assert.ok(
    !raw.includes('"needs"'),
    "packaged E2E must not chain through a planner job",
  );
});

test("both jobs display as Tauri E2E with 45/120 minute timeouts", () => {
  const { smoke, full } = loadPackagedJobs();
  assert.equal(smoke.name, "Tauri E2E");
  assert.equal(full.name, "Tauri E2E");
  assert.equal(smoke["timeout-minutes"], 45);
  assert.equal(
    full["timeout-minutes"],
    120,
    "full must cover cold build + two ~34-38 min passes + upload (~100 min)",
  );
});

test("smoke path is non-draft PRs plus the nightly schedule", () => {
  const { smoke } = loadPackagedJobs();
  const condition = smoke.if;
  assert.match(condition, /github\.event_name == 'pull_request'/);
  assert.match(
    condition,
    /github\.event\.pull_request\.draft == false/,
    "draft PRs must not run packaged smoke",
  );
  assert.match(
    condition,
    /github\.event_name == 'schedule'/,
    "the nightly run keeps main's target-e2e cache warm for PR smoke",
  );
  assert.doesNotMatch(
    condition,
    /'push'|workflow_dispatch/,
    "plain pushes and manual dispatch must not run smoke",
  );
});

test("no job branches on PR labels, so label changes do not rerun CI", () => {
  const workflow = loadWorkflow();
  const types = workflow.on.pull_request.types;
  assert.ok(!types.includes("labeled"), "labeled must not trigger CI");
  assert.ok(!types.includes("unlabeled"), "unlabeled must not trigger CI");
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.ok(
      !JSON.stringify(job).includes("pull_request.labels"),
      `${name} must not branch on PR labels`,
    );
  }
});

test("both packaged jobs share one E2E cargo target dir", () => {
  const { smoke, full } = loadPackagedJobs();
  for (const job of [smoke, full]) {
    assert.equal(job.env?.CARGO_TARGET_DIR, "apps/game/src-tauri/target-e2e");
  }
});

test("both packaged jobs share the tauri-e2e-v2 Rust cache contract", () => {
  const { smoke, full } = loadPackagedJobs();
  for (const job of [smoke, full]) {
    const cache = job.steps.find(
      (candidate) => candidate.uses === "Swatinem/rust-cache@v2",
    );
    assert.ok(cache, "missing Swatinem/rust-cache@v2 step");
    assert.equal(cache.with.workspaces, "apps/game/src-tauri -> target-e2e");
    assert.equal(
      cache.with["prefix-key"],
      "tauri-e2e-v2",
      "smoke and full must not invent separate cache keys",
    );
    assert.equal(
      cache.with["shared-key"],
      "tauri-e2e-v2",
      "rust-cache defaults add-job-id-key=true; only shared-key lets the two job ids resolve one entry",
    );
  }
});

test("jobs invoke the direct package commands under xvfb-run -a", () => {
  const { smoke, full } = loadPackagedJobs();
  const smokeRun = runStepMatching(smoke, /test:e2e:smoke/);
  assert.match(
    smokeRun.run,
    /^xvfb-run -a bun run --cwd apps\/game test:e2e:smoke$/,
  );
  assert.ok(!smokeRun.run.includes("--attempts"), "smoke must stay fail-fast");
  const fullRun = runStepMatching(full, /test:e2e:all/);
  assert.match(
    fullRun.run,
    /^xvfb-run -a bun run --cwd apps\/game test:e2e:all$/,
  );
});

test("both packaged jobs upload evidence on failure", () => {
  const { smoke, full } = loadPackagedJobs();
  for (const [job, artifact] of [
    [smoke, "tauri-e2e-smoke"],
    [full, "tauri-e2e-full"],
  ]) {
    const upload = job.steps.find(
      (candidate) => candidate.uses === "actions/upload-artifact@v4",
    );
    assert.ok(upload, "missing evidence upload step");
    assert.equal(upload.if, "${{ always() }}");
    assert.equal(upload.with.name, artifact);
    assert.match(upload.with.path, /apps\/game\/e2e-artifacts\//);
  }
});

test("lint-frontend runs the surviving Node contract tests", () => {
  const lint = loadWorkflow().jobs["lint-frontend"];
  assert.ok(lint, "missing lint-frontend job");
  const run = namedStep(lint, CONTRACT_STEP).run;
  assert.match(run, /node --test/);
  let cursor = run.indexOf("node --test");
  for (const file of CONTRACT_FILES) {
    const at = run.indexOf(file, cursor);
    assert.ok(at !== -1, `contract step must run ${file}`);
    cursor = at + file.length;
  }
});

test("direct smoke and full commands remain intentionally distinct", () => {
  const scripts = JSON.parse(readFileSync(packagePath, "utf8")).scripts;
  assert.equal(
    scripts["test:e2e:smoke:run"],
    "node scripts/run-save-e2e.mjs --suite smoke",
  );
  assert.equal(
    scripts["test:e2e:all:run"],
    "node scripts/run-save-e2e.mjs --full --attempts 2",
    "full tolerates one retry; smoke stays fail-fast",
  );
  assert.equal(scripts["test:e2e:run"], "bun run test:e2e:smoke:run");
});
