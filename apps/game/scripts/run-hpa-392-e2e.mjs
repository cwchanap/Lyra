import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  createHpa392E2eAppDataDir,
  guardedRemoveHpa392E2eAppDataDir,
  validateHpa392E2eAppDataDir,
} from "./hpa-392-e2e-paths.mjs";

const mode = process.argv[2];
if (mode !== "--capture-proof" || process.argv.length !== 3) {
  console.error("Usage: node scripts/run-hpa-392-e2e.mjs --capture-proof");
  process.exit(2);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const appDataDirectory = createHpa392E2eAppDataDir();
let exitCode;

try {
  const validatedAppDataDirectory =
    validateHpa392E2eAppDataDir(appDataDirectory);
  const result = spawnSync(
    "bun",
    [
      "run",
      "test:e2e:run",
      "--spec",
      "./e2e-tauri/hpa-392-capture-proof.e2e.ts",
    ],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        LYRA_E2E_APP_DATA_DIR: validatedAppDataDirectory,
        LYRA_E2E_CAPTURE_BACKEND_LOGS: "1",
      },
      stdio: "inherit",
    },
  );
  if (result.error) {
    console.error("HPA-392 E2E runner failed to launch:", result.error);
    exitCode = 1;
  } else {
    exitCode = result.status ?? 1;
  }
} finally {
  guardedRemoveHpa392E2eAppDataDir(appDataDirectory);
}

process.exit(exitCode);
