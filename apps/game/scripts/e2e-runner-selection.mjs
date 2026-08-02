import { readFileSync } from "node:fs";
import path from "node:path";
import {
  E2E_CHAIN_IDS,
  normalizeE2eSuiteIds,
  resolveE2eSuiteSelection,
} from "./e2e-suite-registry.mjs";

export function parseRunnerArguments(args) {
  const result = { suiteIds: [], attempts: 1 };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--suite") {
      const id = args[++index];
      if (!id || id.startsWith("--"))
        throw new Error("--suite requires an ID.");
      result.suiteIds.push(id);
    } else if (argument === "--suite-file") {
      const suiteFilePath = args[++index];
      if (
        !suiteFilePath ||
        suiteFilePath.startsWith("--") ||
        !path.isAbsolute(suiteFilePath)
      )
        throw new Error("--suite-file requires an absolute path.");
      result.suiteFilePath = suiteFilePath;
    } else if (argument === "--full") {
      result.full = true;
    } else if (argument === "--attempts") {
      const attempts = Number(args[++index]);
      if (!Number.isInteger(attempts) || (attempts !== 1 && attempts !== 2))
        throw new Error("--attempts must be 1 or 2.");
      result.attempts = attempts;
    } else if (argument === "--chain-id") {
      const chainId = args[++index];
      if (!chainId || chainId.startsWith("--"))
        throw new Error("--chain-id requires an ID.");
      result.chainId = chainId;
    } else if (argument === "--plan-file") {
      const planFilePath = args[++index];
      if (
        !planFilePath ||
        planFilePath.startsWith("--") ||
        !path.isAbsolute(planFilePath)
      )
        throw new Error("--plan-file requires an absolute path.");
      result.planFilePath = planFilePath;
    } else {
      throw new Error(`Unknown e2e runner argument: ${String(argument)}`);
    }
  }
  const modes =
    Number(result.full === true) +
    Number(result.suiteIds.length > 0) +
    Number(result.suiteFilePath !== undefined);
  if (modes !== 1)
    throw new Error("E2E suite selection modes are mutually exclusive.");
  if (
    (result.chainId === undefined) !== (result.planFilePath === undefined) ||
    (result.chainId !== undefined && result.suiteFilePath === undefined)
  ) {
    throw new Error(
      "--chain-id and --plan-file require a --suite-file CI selection.",
    );
  }
  return result;
}

export function resolveRunnerSelection(
  options,
  { readFile = readFileSync } = {},
) {
  if (options.suiteFilePath !== undefined) {
    let suiteIds;
    try {
      suiteIds = JSON.parse(readFile(options.suiteFilePath, "utf8"));
    } catch (error) {
      throw new Error(`Invalid e2e suite file: ${error.message}`, {
        cause: error,
      });
    }
    if (!Array.isArray(suiteIds))
      throw new Error("Invalid e2e suite file: expected a JSON array.");
    return resolveE2eSuiteSelection({ suiteIds });
  }
  return resolveE2eSuiteSelection(options);
}

export function resolveRunnerPlannerMetadata(
  options,
  suiteIds,
  { readFile = readFileSync } = {},
) {
  const selectedSuites = normalizeE2eSuiteIds(suiteIds);
  if (options.planFilePath === undefined) {
    return {
      chainId: "direct",
      riskSelectedSuites: options.full ? [] : selectedSuites,
      forcedFull: options.full === true,
      reason: options.full ? "direct-full" : null,
    };
  }

  let plan;
  try {
    plan = JSON.parse(readFile(options.planFilePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid E2E planner metadata: ${error.message}`, {
      cause: error,
    });
  }
  const planner = plan?.planner;
  const matrixEntries = plan?.matrix?.include;
  const matchingEntries = Array.isArray(matrixEntries)
    ? matrixEntries.filter(({ chainId }) => chainId === options.chainId)
    : [];
  const matchingEntry = matchingEntries[0];
  if (
    !E2E_CHAIN_IDS.includes(options.chainId) ||
    planner?.schemaVersion !== 1 ||
    !Array.isArray(planner.riskSelectedSuites) ||
    typeof planner.forcedFull !== "boolean" ||
    (planner.reason !== null && typeof planner.reason !== "string") ||
    !Array.isArray(plan.expectedChainIds) ||
    !plan.expectedChainIds.includes(options.chainId) ||
    matchingEntries.length !== 1 ||
    !Array.isArray(matchingEntry?.suiteIds) ||
    JSON.stringify(matchingEntry.suiteIds) !== JSON.stringify(selectedSuites)
  ) {
    throw new Error("Invalid E2E planner metadata for selected chain.");
  }
  return {
    chainId: options.chainId,
    riskSelectedSuites:
      planner.riskSelectedSuites.length === 0
        ? []
        : normalizeE2eSuiteIds(planner.riskSelectedSuites),
    forcedFull: planner.forcedFull,
    reason: planner.reason,
  };
}
