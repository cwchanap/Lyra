// Guard for `test:e2e:run`: fail fast with a clear message when the debug
// e2e binary has not been built, instead of letting @wdio/tauri-service fail
// with an opaque spawn error. The binary lives in a dedicated target dir
// (`src-tauri/target-e2e`, set via CARGO_TARGET_DIR by `build-e2e.mjs`) so
// that ordinary `cargo build` / `tauri dev` cannot overwrite it with a
// non-e2e binary. Run `bun run test:e2e` (build + run) first.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveE2eBinaryPath } from "./e2e-binary-path.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binaryPath = resolveE2eBinaryPath(path.resolve(__dirname, ".."));

if (!existsSync(binaryPath)) {
  console.error(
    `[e2e] Debug e2e binary not found at ${binaryPath}.\n` +
      `       Build it first with \`bun run test:e2e\` (or \`bun run test:e2e:all\`).`,
  );
  process.exit(1);
}
