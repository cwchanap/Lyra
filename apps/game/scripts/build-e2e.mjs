// Builds the e2e debug binary into a dedicated target directory
// (`src-tauri/target-e2e`) so that ordinary `cargo build` / `tauri dev`
// cannot overwrite it with a non-e2e binary. WDIO (`wdio.conf.ts`) and the
// run-guard (`require-e2e-binary.mjs`) both point at this dedicated path,
// making the existence-only guard meaningful again.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const targetDir = path.join(appRoot, "src-tauri", "target-e2e");

const env = {
  ...process.env,
  CARGO_TARGET_DIR: targetDir,
  // Signals the Vite build (run via beforeBuildCommand) to include the
  // @wdio/tauri-plugin frontend import. Tree-shaken out of ordinary builds
  // where this var is absent (import.meta.env.VITE_E2E is undefined).
  VITE_E2E: "true",
  // Compile the closed HPA-392 packaged capture probe only into this debug
  // E2E bundle. Ordinary production builds never receive this flag.
  VITE_LYRA_E2E_CAPTURE_PROOF: "1",
};
// App-data ownership begins only in run-hpa-392-e2e.mjs. Never let a stale
// shell environment bind the build step to a prior fixture root or phase.
delete env.LYRA_E2E_APP_DATA_DIR;
delete env.LYRA_E2E_CAPTURE_BACKEND_LOGS;
delete env.LYRA_HPA392_PHASE;

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

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

// `tauri build --no-bundle` skips the bundling step that would otherwise copy
// `bundle.resources` entries next to the binary. The runtime's
// `resolve_scenes_dir` falls back to `<exe_dir>/resources/scenes`, so mirror
// the bundled layout there. Source resources are emitted by `scenes:compile`
// (run via `beforeBuildCommand`) into `src-tauri/resources/{scenes,assets}`.
const debugDir = path.join(targetDir, "debug");
const resourcesDest = path.join(debugDir, "resources");
const resourcesSrc = path.join(appRoot, "src-tauri", "resources");
for (const sub of ["scenes", "assets"]) {
  const src = path.join(resourcesSrc, sub);
  const dest = path.join(resourcesDest, sub);
  if (!existsSync(src)) {
    console.error(
      `build-e2e: missing resource source ${src} (run scenes:compile?)`,
    );
    process.exit(1);
  }
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

// Sanity check: the runtime reads chapters.json from the scenes dir.
const chaptersJson = path.join(resourcesDest, "scenes", "chapters.json");
if (!existsSync(chaptersJson)) {
  console.error(`build-e2e: ${chaptersJson} missing after resource copy`);
  process.exit(1);
}
console.log(`build-e2e: copied resources to ${resourcesDest}`);
console.log(
  `build-e2e: resources contain ${readdirSync(path.join(resourcesDest, "scenes")).length} scene entries`,
);

process.exit(0);
