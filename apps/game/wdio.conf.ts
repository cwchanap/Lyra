import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appBinaryPath = path.join(__dirname, "src-tauri/target/debug/lyra");

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./e2e-tauri/**/*.e2e.ts"],
  maxInstances: 1,
  // Desktop-e2e is inherently flaky (focus, WebView animations, IPC timing).
  // Spec-level retries are CI-only per the e2e design spec (local: 0).
  specFileRetries: process.env.CI ? 2 : 0,
  specFileRetriesDelay: 5,
  capabilities: [
    {
      browserName: "tauri",
      "wdio:enforceWebDriverClassic": true,
    },
  ],
  logLevel: "info",
  outputDir: path.join(__dirname, "logs"),
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
      },
    ],
  ],
};
