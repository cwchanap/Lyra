// Guard for `test:e2e:run`: fail fast with a clear message when the debug
// e2e binary has not been built, instead of letting @wdio/tauri-service fail
// with an opaque spawn error. Run `bun run test:e2e` (build + run) first.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binaryPath = path.resolve(__dirname, "../src-tauri/target/debug/lyra");

if (!existsSync(binaryPath)) {
  console.error(
    `[e2e] Debug e2e binary not found at ${binaryPath}.\n` +
      `       Build it first with \`bun run test:e2e\` (or \`bun run test:e2e:build\`).`,
  );
  process.exit(1);
}
