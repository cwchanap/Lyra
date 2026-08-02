import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveE2eSuiteSelection } from "./e2e-suite-registry.mjs";

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
