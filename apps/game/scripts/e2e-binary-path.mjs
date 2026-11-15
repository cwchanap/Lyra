import path from "node:path";

// Single source of truth for the packaged e2e binary path, so the binary
// @wdio/tauri-service launches (wdio.conf.ts) and the only process the
// trusted-key helper may drive (e2e-tauri/helpers.ts) cannot drift.
// Cargo emits `lyra.exe` on Windows; the extensionless path only exists on
// macOS/Linux.
const exeSuffix = process.platform === "win32" ? ".exe" : "";

export function resolveE2eBinaryPath(appDir) {
  return path.join(
    appDir,
    "src-tauri",
    "target-e2e",
    "debug",
    `lyra${exeSuffix}`,
  );
}
