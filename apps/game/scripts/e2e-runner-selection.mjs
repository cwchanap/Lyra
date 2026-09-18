export function parseRunnerArguments(args) {
  const result = { suiteIds: [], attempts: 1 };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--suite") {
      const id = args[++index];
      if (!id || id.startsWith("--"))
        throw new Error("--suite requires an ID.");
      result.suiteIds.push(id);
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
  if (Number(result.full === true) + Number(result.suiteIds.length > 0) !== 1)
    throw new Error("E2E suite selection modes are mutually exclusive.");
  return result;
}
