// Builds the e2e debug binary into a dedicated target directory
// (`src-tauri/target-e2e`) so that ordinary `cargo build` / `tauri dev`
// cannot overwrite it with a non-e2e binary. WDIO (`wdio.conf.ts`) and the
// run-guard (`require-e2e-binary.mjs`) both point at this dedicated path,
// making the existence-only guard meaningful again.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const targetDir = path.join(appRoot, "src-tauri", "target-e2e");

const env = {
  ...process.env,
  CARGO_TARGET_DIR: targetDir,
};

const args = [
  "run",
  "tauri",
  "build",
  "--debug",
  "--no-bundle",
  "--features",
  "e2e",
  "-c",
  "src-tauri/tauri.e2e.conf.json",
];

const result = spawnSync("bun", args, {
  stdio: "inherit",
  env,
  cwd: appRoot,
});

if (result.error) {
  // Spawn itself failed (e.g. `bun` missing or unlaunchable). Surface the
  // cause before exiting; a bare status-based exit would hide the real reason.
  console.error("build-e2e: failed to spawn `bun`:", result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
