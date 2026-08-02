import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectE2eSuites } from "./select-e2e-suites.mjs";

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
  githubOutputFile,
  forceFull = false,
  eventName = "pull_request",
  ref = "",
}) {
  assertAbsolutePath(changedPathsFile, "--changed-paths-file");
  assertAbsolutePath(suiteFile, "--suite-file");
  assertAbsolutePath(reportFile, "--report-file");
  if (githubOutputFile !== undefined)
    assertAbsolutePath(githubOutputFile, "GITHUB_OUTPUT");

  const plan = selectE2eSuites({
    changedPaths: changedPathsFromFile(changedPathsFile),
    forceFull,
    eventName,
    ref,
  });
  writeFileSync(suiteFile, `${JSON.stringify(plan.suiteIds)}\n`);
  writeFileSync(reportFile, `${JSON.stringify(plan, null, 2)}\n`);
  if (githubOutputFile) {
    appendFileSync(
      githubOutputFile,
      `should_run=${String(!plan.skip)}\nforced_full=${String(plan.forcedFull)}\n`,
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
