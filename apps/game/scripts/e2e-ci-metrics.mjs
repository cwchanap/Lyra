import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { E2E_CHAIN_IDS } from "./e2e-suite-registry.mjs";

export const E2E_CI_METRICS_SCHEMA_VERSION = 1;

function assertAbsolute(value, name) {
  if (typeof value !== "string" || !path.isAbsolute(value))
    throw new Error(`${name} requires an absolute path.`);
}

function writeMetrics(metricsFile, metrics) {
  assertAbsolute(metricsFile, "Metrics file");
  mkdirSync(path.dirname(metricsFile), { recursive: true });
  const temporary = `${metricsFile}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(metrics, null, 2)}\n`);
  renameSync(temporary, metricsFile);
}

function readMetrics(metricsFile) {
  assertAbsolute(metricsFile, "Metrics file");
  let metrics;
  try {
    metrics = JSON.parse(readFileSync(metricsFile, "utf8"));
  } catch (error) {
    throw new Error(`Invalid E2E CI metrics: ${error.message}`, {
      cause: error,
    });
  }
  if (
    metrics?.schemaVersion !== E2E_CI_METRICS_SCHEMA_VERSION ||
    !E2E_CHAIN_IDS.includes(metrics.chainId) ||
    !Number.isFinite(metrics.startedAtMs)
  ) {
    throw new Error("Invalid E2E CI metrics manifest.");
  }
  return metrics;
}

function directoryBytes(directory) {
  assertAbsolute(directory, "Cache directory");
  if (!existsSync(directory)) return 0;
  const result = spawnSync("du", ["-sk", directory], { encoding: "utf8" });
  const kibibytes = Number.parseInt(result.stdout?.trim().split(/\s+/)[0], 10);
  if (result.status !== 0 || !Number.isFinite(kibibytes))
    throw new Error("Could not measure the restored E2E cache directory.");
  return kibibytes * 1_024;
}

export function initializeE2eCiMetrics({
  metricsFile,
  chainId,
  nowMs = Date.now,
}) {
  if (!E2E_CHAIN_IDS.includes(chainId))
    throw new Error("Unknown E2E CI metrics chain.");
  const metrics = {
    schemaVersion: E2E_CI_METRICS_SCHEMA_VERSION,
    chainId,
    startedAtMs: nowMs(),
  };
  writeMetrics(metricsFile, metrics);
  return metrics;
}

export function recordE2eCiSetup({
  metricsFile,
  cacheDirectory,
  cacheHit = false,
  nowMs = Date.now,
  measureDirectoryBytes = directoryBytes,
}) {
  const metrics = readMetrics(metricsFile);
  const finishedAtMs = nowMs();
  metrics.setup = {
    finishedAtMs,
    durationMs: finishedAtMs - metrics.startedAtMs,
    cacheHit: cacheHit === true || cacheHit === "true",
    restoredCacheBytes: measureDirectoryBytes(cacheDirectory),
  };
  writeMetrics(metricsFile, metrics);
  return metrics;
}

export function runTimedE2eCiStage({
  metricsFile,
  stage,
  command,
  args,
  nowMs = Date.now,
  runCommand = (executable, executableArgs) =>
    spawnSync(executable, executableArgs, { stdio: "inherit" }),
}) {
  if (!["build", "test"].includes(stage))
    throw new Error("Unknown E2E CI timing stage.");
  if (
    typeof command !== "string" ||
    command.length === 0 ||
    !Array.isArray(args)
  )
    throw new Error("Invalid E2E CI timed command.");
  const metrics = readMetrics(metricsFile);
  const startedAtMs = nowMs();
  const execution = runCommand(command, args);
  const finishedAtMs = nowMs();
  const exitCode = Number.isInteger(execution.status) ? execution.status : 1;
  metrics[stage] = {
    startedAtMs,
    finishedAtMs,
    durationMs: finishedAtMs - startedAtMs,
    exitCode,
  };
  writeMetrics(metricsFile, metrics);
  return exitCode;
}

function valueAfter(args, option) {
  const index = args.indexOf(option);
  return index === -1 ? undefined : args[index + 1];
}

function runCli() {
  const [operation, ...args] = process.argv.slice(2);
  const metricsFile = valueAfter(args, "--file");
  if (operation === "initialize") {
    initializeE2eCiMetrics({
      metricsFile,
      chainId: valueAfter(args, "--chain-id"),
    });
    return;
  }
  if (operation === "setup") {
    recordE2eCiSetup({
      metricsFile,
      cacheDirectory: valueAfter(args, "--cache-directory"),
      cacheHit: valueAfter(args, "--cache-hit"),
    });
    return;
  }
  if (operation === "run") {
    const separator = args.indexOf("--");
    const commandArgs = separator === -1 ? [] : args.slice(separator + 1);
    const [command, ...executableArgs] = commandArgs;
    process.exitCode = runTimedE2eCiStage({
      metricsFile,
      stage: valueAfter(args, "--stage"),
      command,
      args: executableArgs,
    });
    return;
  }
  throw new Error("Unknown E2E CI metrics operation.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runCli();
