import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  E2E_CHAIN_IDS,
  partitionE2eSuitesByChain,
} from "./e2e-suite-registry.mjs";
import { selectE2eSuites } from "./select-e2e-suites.mjs";

export const E2E_CI_PLANNER_SCHEMA_VERSION = 1;

const CHAIN_EXECUTION = Object.freeze({
  // The gameplay chain bundles smoke (~1.6m) + ordinary gameplay (~7m,
  // five specs including investigation-layout at ~3m47s) + production-journey
  // (~10-12m, full Chapter 1 organic route across all nine city-map gates) +
  // analysis-beat85 (~1m). CI runner variance can add ~2m to the earlier
  // phases, so 25 minutes gives comfortable margin without risking the
  // 30-minute job-level safety net.
  gameplay: Object.freeze({ timeoutMinutes: 25 }),
  persistence: Object.freeze({ timeoutMinutes: 15 }),
  exit: Object.freeze({ timeoutMinutes: 8 }),
});

for (const chainId of E2E_CHAIN_IDS) {
  const execution = CHAIN_EXECUTION[chainId];
  if (
    !execution ||
    typeof execution.timeoutMinutes !== "number" ||
    execution.timeoutMinutes <= 0
  ) {
    throw new Error(`E2E chain lacks an execution budget: ${String(chainId)}`);
  }
}

function assertAbsolutePath(value, optionName) {
  if (typeof value !== "string" || !path.isAbsolute(value))
    throw new Error(`${optionName} requires an absolute path.`);
}

function changedPathsFromFile(changedPathsFile) {
  return readFileSync(changedPathsFile, "utf8").split(/\r?\n/).filter(Boolean);
}

export function writeE2eCiPlan({
  changedPathsFile,
  suiteFile,
  reportFile,
  matrixFile,
  chainDirectory,
  githubOutputFile,
  forceFull = false,
  eventName = "pull_request",
  ref = "",
}) {
  assertAbsolutePath(changedPathsFile, "--changed-paths-file");
  assertAbsolutePath(suiteFile, "--suite-file");
  assertAbsolutePath(reportFile, "--report-file");
  assertAbsolutePath(matrixFile, "--matrix-file");
  assertAbsolutePath(chainDirectory, "--chain-directory");
  if (githubOutputFile !== undefined)
    assertAbsolutePath(githubOutputFile, "GITHUB_OUTPUT");

  const selection = selectE2eSuites({
    changedPaths: changedPathsFromFile(changedPathsFile),
    forceFull,
    eventName,
    ref,
  });
  const chains = selection.skip
    ? []
    : partitionE2eSuitesByChain(selection.suiteIds);
  mkdirSync(chainDirectory, { recursive: true });
  const matrix = {
    include: chains.map(({ id, suiteIds }) => {
      const suiteFileName = `${id}-suites.json`;
      writeFileSync(
        path.join(chainDirectory, suiteFileName),
        `${JSON.stringify(suiteIds)}\n`,
      );
      return {
        chainId: id,
        suiteIds,
        suiteFile: `chains/${suiteFileName}`,
        cacheKey: `tauri-e2e-${id}-v1`,
        timeoutMinutes: CHAIN_EXECUTION[id].timeoutMinutes,
        artifactName: `tauri-e2e-${id}`,
      };
    }),
  };
  const plan = {
    ...selection,
    planner: {
      schemaVersion: E2E_CI_PLANNER_SCHEMA_VERSION,
      riskSelectedSuites: [...selection.riskSelectedSuites],
      forcedFull: selection.forcedFull,
      reason: selection.forcedFullReason,
    },
    expectedChainIds: chains.map(({ id }) => id),
    matrix,
  };
  writeFileSync(suiteFile, `${JSON.stringify(plan.suiteIds)}\n`);
  writeFileSync(matrixFile, `${JSON.stringify(matrix, null, 2)}\n`);
  writeFileSync(reportFile, `${JSON.stringify(plan, null, 2)}\n`);
  if (githubOutputFile) {
    appendFileSync(
      githubOutputFile,
      [
        `should_run=${String(!plan.skip)}`,
        `forced_full=${String(plan.forcedFull)}`,
        `expected_chain_ids=${JSON.stringify(plan.expectedChainIds)}`,
        `matrix=${JSON.stringify(matrix)}`,
        "",
      ].join("\n"),
    );
  }
  return plan;
}

function parseCliArguments(args) {
  const options = { forceFull: false, eventName: "pull_request", ref: "" };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--force-full") options.forceFull = true;
    else if (argument === "--changed-paths-file")
      options.changedPathsFile = args[++index];
    else if (argument === "--suite-file") options.suiteFile = args[++index];
    else if (argument === "--report-file") options.reportFile = args[++index];
    else if (argument === "--matrix-file") options.matrixFile = args[++index];
    else if (argument === "--chain-directory")
      options.chainDirectory = args[++index];
    else if (argument === "--event-name") options.eventName = args[++index];
    else if (argument === "--ref") options.ref = args[++index];
    else throw new Error(`Unknown E2E plan argument: ${String(argument)}`);
  }
  return options;
}

function runCli() {
  const plan = writeE2eCiPlan({
    ...parseCliArguments(process.argv.slice(2)),
    githubOutputFile: process.env.GITHUB_OUTPUT,
  });
  console.log(JSON.stringify(plan));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runCli();
