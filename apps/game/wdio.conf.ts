import path from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_SMOKE_SPECS } from "./scripts/e2e-suite-registry.mjs";
import { resolveE2eBinaryPath } from "./scripts/e2e-binary-path.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Dedicated e2e target dir (CARGO_TARGET_DIR=src-tauri/target-e2e) so that
// ordinary `cargo build` / `tauri dev` cannot overwrite the e2e binary.
// Single source of truth shared with the trusted-key helper, which may only
// key the process running this exact binary.
const appBinaryPath = resolveE2eBinaryPath(__dirname);

export const config: WebdriverIO.Config = {
  runner: "local",
  // The default is the fast packaged smoke check. Every non-smoke process
  // passes an explicit spec through the guarded suite runner, which owns and
  // revalidates the app-data directory lifecycle.
  specs: [...E2E_SMOKE_SPECS],
  maxInstances: 1,
  // Runner-managed retries allocate a fresh guarded root, retain first-attempt
  // diagnostics, and never let WDIO retry against contaminated app data.
  specFileRetries: 0,
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
    // WDIO v9's executeAsync (see @wdio/utils testFnWrapper) reads
    // `this._runnable._timeout` BEFORE the user's test function runs, then
    // arms a setTimeout race that rejects with `Error: Timeout`. Per-test
    // `this.timeout(...)` calls inside it() bodies execute after that read,
    // so they cannot raise the deadline — a bigger per-test budget must be
    // declared at registration via `it(...).timeout(ms)`, which is what the
    // production-journey spec's two organic Chapter 1 legs do. The spec
    // splits Chapter 1 in two tests and Chapter 2 into legs
    // (production-anchors.ts) so every test fits in 20m on a slow runner;
    // only the two organic Chapter 1 legs register 30m (focus/image proofs
    // on the first, the five-gate second half on the second). The outer hang
    // guard stays the CI job timeout-minutes.
    timeout: 1200000,
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
