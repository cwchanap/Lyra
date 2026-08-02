import path from "node:path";
import { fileURLToPath } from "node:url";
import { SAVE_E2E_ORDINARY_SPECS } from "./scripts/e2e-suite-registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Dedicated e2e target dir (CARGO_TARGET_DIR=src-tauri/target-e2e) so that
// ordinary `cargo build` / `tauri dev` cannot overwrite the e2e binary.
// Cargo emits `lyra.exe` on Windows; the extensionless path only exists on
// macOS/Linux, so derive the suffix from the platform.
const exeSuffix = process.platform === "win32" ? ".exe" : "";
const appBinaryPath = path.join(
  __dirname,
  `src-tauri/target-e2e/debug/lyra${exeSuffix}`,
);

export const config: WebdriverIO.Config = {
  runner: "local",
  // The default configuration is deliberately ordinary-only. Every
  // save e2e spec process is selected explicitly by the guarded phased
  // runner so it can own and revalidate the app-data directory lifecycle.
  specs: [...SAVE_E2E_ORDINARY_SPECS],
  maxInstances: 1,
  // Phased save E2E owns persistent app-data across process boundaries. WDIO
  // spec retries reuse that directory, so a partial seed contaminates the retry.
  // Keep retries only for standalone/non-phased CI specs.
  specFileRetries: process.env.CI && !process.env.LYRA_SAVE_E2E_PHASE ? 2 : 0,
  specFileRetriesDelay: 5,
  capabilities: [
    {
      browserName: "tauri",
      "wdio:enforceWebDriverClassic": true,
    },
  ],
  logLevel: "info",
  outputDir: process.env.LYRA_E2E_OUTPUT_DIR ?? path.join(__dirname, "logs"),
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 2,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    // Full intro drain is ~273 advances; allow headroom for typewriter + IPC.
    timeout: 600000,
  },
  services: [
    [
      "@wdio/tauri-service",
      {
        driverProvider: "embedded",
        appBinaryPath,
        captureBackendLogs: process.env.LYRA_E2E_CAPTURE_BACKEND_LOGS === "1",
      },
    ],
  ],
};
