import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseDocument } from "yaml";

const workflowPath = fileURLToPath(
  new URL("../../../.github/workflows/ci.yml", import.meta.url),
);
const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));

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

test("workflow runs every E2E CI contract from the planner job", () => {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  assert.equal(
    packageJson.scripts["test:e2e:ci-contracts"],
    [
      "node --test",
      "scripts/e2e-suite-registry.test.mjs",
      "scripts/e2e-runner-lifecycle.test.mjs",
      "scripts/save-e2e-paths.test.mjs",
      "scripts/select-e2e-suites.test.mjs",
      "scripts/plan-e2e-ci.test.mjs",
      "scripts/e2e-ci-metrics.test.mjs",
      "scripts/e2e-ci-results.test.mjs",
      "scripts/e2e-ci-workflow.test.mjs",
    ].join(" "),
  );

  const plan = loadWorkflow().jobs["e2e-plan"];
  assert.equal(
    namedStep(plan, "Run E2E CI contracts").run,
    "bun run --cwd apps/game test:e2e:ci-contracts",
  );
});

test("planner publishes the dynamic matrix and every chain suite file", () => {
  const plan = loadWorkflow().jobs["e2e-plan"];
  assert.equal(plan.outputs.should_run, "${{ steps.plan.outputs.should_run }}");
  assert.equal(plan.outputs.matrix, "${{ steps.plan.outputs.matrix }}");
  assert.equal(
    plan.outputs.expected_chain_ids,
    "${{ steps.plan.outputs.expected_chain_ids }}",
  );
  const selector = namedStep(plan, "Select packaged E2E suites").run;
  assert.match(
    selector,
    /--suite-file "\$RUNNER_TEMP\/e2e-plan\/e2e-suites\.json"/,
  );
  assert.match(
    selector,
    /--matrix-file "\$RUNNER_TEMP\/e2e-plan\/e2e-matrix\.json"/,
  );
  assert.match(selector, /--chain-directory "\$RUNNER_TEMP\/e2e-plan\/chains"/);
  const upload = namedStep(plan, "Upload E2E plan");
  assert.equal(upload.if, "${{ always() }}");
  assert.equal(upload.with.name, "e2e-plan");
  assert.equal(upload.with.path, "${{ runner.temp }}/e2e-plan/");
  assert.equal(
    upload.with.overwrite,
    true,
    "Upload E2E plan must overwrite so a failed-job rerun can replace the prior artifact",
  );
});

test("changed paths are collected from the merge base without rename detection", () => {
  const plan = loadWorkflow().jobs["e2e-plan"];
  const collect = namedStep(plan, "Collect changed paths").run;
  // Three-dot form diffs merge-base(BASE_SHA, HEAD_SHA) against HEAD_SHA, so
  // base-branch-only changes after divergence are excluded.
  assert.match(
    collect,
    /git diff --no-renames --name-only "\$BASE_SHA\.\.\.\$HEAD_SHA"/,
  );
  // --no-renames on the new-branch fallback keeps single-commit renames from
  // hiding the deleted side of a moved risky source.
  assert.match(
    collect,
    /git diff-tree --no-renames --no-commit-id --name-only -r "\$HEAD_SHA"/,
  );
});

test("execution is a non-fail-fast isolated chain matrix", () => {
  const execution = loadWorkflow().jobs["e2e-execution"];
  assert.equal(execution.needs, "e2e-plan");
  assert.equal(
    execution.if,
    "${{ needs.e2e-plan.outputs.should_run == 'true' }}",
  );
  assert.equal(execution.strategy["fail-fast"], false);
  assert.equal(
    execution.strategy.matrix,
    "${{ fromJSON(needs.e2e-plan.outputs.matrix) }}",
  );
  assert.equal(execution["timeout-minutes"], 30);
  assert.equal(execution.name, "Tauri E2E execution (${{ matrix.chainId }})");

  const initialize = namedStep(execution, "Initialize chain metrics");
  assert.match(initialize.run, /e2e-ci-metrics\.mjs initialize/);
  assert.equal(initialize.env.CHAIN_ID, "${{ matrix.chainId }}");
  assert.match(initialize.run, /--chain-id "\$CHAIN_ID"/);

  const cache = namedStep(execution, "Rust cache");
  assert.equal(cache.id, "rust-cache");
  assert.equal(cache.with["prefix-key"], "${{ matrix.cacheKey }}");
  const setup = namedStep(execution, "Record setup and restored cache");
  assert.match(setup.run, /e2e-ci-metrics\.mjs setup/);
  assert.equal(setup.env.CHAIN_ID, "${{ matrix.chainId }}");
  assert.equal(
    setup.env.RUST_CACHE_HIT,
    "${{ steps.rust-cache.outputs.cache-hit }}",
  );
  assert.match(setup.run, /--cache-hit "\$RUST_CACHE_HIT"/);
  const build = namedStep(execution, "Build Tauri E2E binary");
  assert.match(build.run, /e2e-ci-metrics\.mjs run/);
  assert.equal(build.env.CHAIN_ID, "${{ matrix.chainId }}");
  assert.match(build.run, /--stage build/);
  assert.match(build.run, /-- node apps\/game\/scripts\/build-e2e\.mjs/);
  const run = namedStep(execution, "Run selected Tauri E2E chain");
  assert.equal(run["timeout-minutes"], "${{ matrix.timeoutMinutes }}");
  assert.match(run.run, /e2e-ci-metrics\.mjs run/);
  assert.match(run.run, /--stage test/);
  assert.match(run.run, /--suite-file "\$RUNNER_TEMP\/e2e-plan\/\$SUITE_FILE"/);
  assert.match(run.run, /--chain-id "\$CHAIN_ID"/);
  assert.match(
    run.run,
    /--plan-file "\$RUNNER_TEMP\/e2e-plan\/e2e-plan\.json"/,
  );
  assert.match(run.run, /--attempts 2/);

  assert.equal(
    namedStep(execution, "Run guarded post-cleanup").if,
    "${{ always() }}",
  );
  const upload = namedStep(execution, "Upload chain evidence");
  assert.equal(upload.if, "${{ always() }}");
  assert.equal(upload.with.name, "${{ matrix.artifactName }}");
  assert.equal(upload.with["if-no-files-found"], "warn");
  assert.match(upload.with.path, /\$\{\{ runner\.temp \}\}\/e2e-metrics\//);
  assert.equal(
    upload.with.overwrite,
    true,
    "Upload chain evidence must overwrite so a failed-chain rerun can replace the prior artifact",
  );
});

test("stable aggregate downloads every manifest and runs the pure validator", () => {
  const aggregate = loadWorkflow().jobs.e2e;
  assert.equal(aggregate.name, "Tauri E2E");
  assert.equal(
    aggregate.if,
    "${{ always() && (github.event_name != 'pull_request' || github.event.pull_request.draft == false) }}",
  );
  assert.deepEqual(aggregate.needs, ["e2e-plan", "e2e-execution"]);

  const planDownload = namedStep(aggregate, "Download E2E plan");
  assert.equal(planDownload.with.name, "e2e-plan");
  const resultDownload = namedStep(aggregate, "Download chain evidence");
  assert.equal(
    resultDownload.if,
    "${{ needs.e2e-plan.outputs.should_run == 'true' }}",
  );
  assert.equal(resultDownload.with.pattern, "tauri-e2e-*");
  assert.equal(resultDownload.with.path, "${{ runner.temp }}/e2e-results");

  const validate = namedStep(aggregate, "Validate E2E manifests and routing");
  assert.equal(validate.env.PLAN_RESULT, "${{ needs.e2e-plan.result }}");
  assert.equal(
    validate.env.SHOULD_RUN,
    "${{ needs.e2e-plan.outputs.should_run }}",
  );
  assert.equal(
    validate.env.EXECUTION_RESULT,
    "${{ needs.e2e-execution.result }}",
  );
  assert.match(validate.run, /scripts\/e2e-ci-results\.mjs/);
  assert.match(validate.run, /--plan-file/);
  assert.match(validate.run, /--results-directory/);
  assert.match(validate.run, /--analysis-file/);
  assert.match(
    validate.run,
    /\[\[ "\$SHOULD_RUN" == "true" && "\$EXECUTION_RESULT" != "success" \]\]/,
  );
  const upload = namedStep(aggregate, "Upload E2E aggregate analysis");
  assert.equal(upload.if, "${{ always() }}");
  assert.equal(upload.with.name, "tauri-e2e-analysis");
  assert.equal(
    upload.with.overwrite,
    true,
    "Upload E2E aggregate analysis must overwrite so a full rerun can replace the prior artifact",
  );
});

test("direct smoke and full commands remain intentionally distinct", () => {
  const scripts = JSON.parse(readFileSync(packagePath, "utf8")).scripts;
  assert.equal(
    scripts["test:e2e:smoke:run"],
    "node scripts/run-save-e2e.mjs --suite smoke",
  );
  assert.equal(
    scripts["test:e2e:all:run"],
    "node scripts/run-save-e2e.mjs --full",
  );
  assert.equal(scripts["test:e2e:run"], "bun run test:e2e:smoke:run");
});
