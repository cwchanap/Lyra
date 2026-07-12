import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appBinaryPath = path.join(__dirname, "src-tauri/target/debug/lyra");

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./e2e-tauri/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "tauri",
      "wdio:enforceWebDriverClassic": true,
      "tauri:options": {
        application: appBinaryPath,
      },
    },
  ],
  logLevel: "info",
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 2,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 180000,
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
