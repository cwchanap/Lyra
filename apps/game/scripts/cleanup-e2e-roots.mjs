import path from "node:path";
import { cleanupOwnedE2eRoots } from "./e2e-runner-lifecycle.mjs";

const [ownershipPath] = process.argv.slice(2);
if (
  process.argv.length !== 3 ||
  typeof ownershipPath !== "string" ||
  !path.isAbsolute(ownershipPath)
) {
  console.error(
    "Usage: node scripts/cleanup-e2e-roots.mjs /absolute/path/to/run-ownership.json",
  );
  process.exitCode = 2;
} else {
  try {
    cleanupOwnedE2eRoots(ownershipPath);
  } catch (error) {
    console.error("e2e guarded root cleanup failed:", error);
    process.exitCode = 1;
  }
}
