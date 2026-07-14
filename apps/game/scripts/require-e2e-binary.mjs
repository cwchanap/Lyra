// Guard for `test:e2e:run`: fail fast with a clear message when the debug
// e2e binary has not been built, instead of letting @wdio/tauri-service fail
// with an opaque spawn error. The binary lives in a dedicated target dir
// (`src-tauri/target-e2e`, set via CARGO_TARGET_DIR by `build-e2e.mjs`) so
// that ordinary `cargo build` / `tauri dev` cannot overwrite it with a
// non-e2e binary. Run `bun run test:e2e` (build + run) first.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Cargo emits `lyra.exe` on Windows; the extensionless path only exists on
// macOS/Linux. Derive the suffix from the platform so the guard resolves the
// real binary instead of rejecting a freshly built one.
const exeSuffix = process.platform === "win32" ? ".exe" : "";
const binaryPath = path.resolve(
  __dirname,
  `../src-tauri/target-e2e/debug/lyra${exeSuffix}`,
);

if (!existsSync(binaryPath)) {
  console.error(
    `[e2e] Debug e2e binary not found at ${binaryPath}.\n` +
      `       Build it first with \`bun run test:e2e\` (or \`bun run test:e2e:build\`).`,
  );
  process.exit(1);
}
