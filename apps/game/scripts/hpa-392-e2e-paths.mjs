import { lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

export const HPA392_E2E_DIRECTORY_PREFIX = "lyra-hpa-392-";

function unsafePath() {
  return new Error("Unsafe HPA-392 E2E app-data directory.");
}

function canonicalIfPresent(candidate) {
  if (!candidate) return null;
  try {
    return realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

export function productionAppDataDir() {
  if (process.platform === "darwin") {
    return path.join(
      homedir(),
      "Library",
      "Application Support",
      "com.chanwaichan.lyra",
    );
  }
  if (process.platform === "win32") {
    const base = process.env.APPDATA;
    return base
      ? path.join(base, "com.chanwaichan.lyra")
      : path.join(homedir(), "AppData", "Roaming", "com.chanwaichan.lyra");
  }
  return path.join(
    process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share"),
    "com.chanwaichan.lyra",
  );
}

export function validateHpa392E2eAppDataDir(
  candidate,
  { productionAppDataDir: production = productionAppDataDir() } = {},
) {
  if (
    typeof candidate !== "string" ||
    candidate.length === 0 ||
    !path.isAbsolute(candidate) ||
    !path.basename(candidate).startsWith(HPA392_E2E_DIRECTORY_PREFIX)
  ) {
    throw unsafePath();
  }

  let metadata;
  let canonical;
  let canonicalTemp;
  try {
    metadata = lstatSync(candidate);
    canonical = realpathSync(candidate);
    canonicalTemp = realpathSync(tmpdir());
  } catch {
    throw unsafePath();
  }

  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    canonical === canonicalTemp ||
    path.dirname(canonical) !== canonicalTemp ||
    !path.basename(canonical).startsWith(HPA392_E2E_DIRECTORY_PREFIX) ||
    canonical === canonicalIfPresent(homedir()) ||
    canonical === canonicalIfPresent(production)
  ) {
    throw unsafePath();
  }

  return canonical;
}

export function createHpa392E2eAppDataDir() {
  const canonicalTemp = realpathSync(tmpdir());
  const candidate = mkdtempSync(
    path.join(canonicalTemp, HPA392_E2E_DIRECTORY_PREFIX),
  );
  return validateHpa392E2eAppDataDir(candidate);
}

export function guardedRemoveHpa392E2eAppDataDir(candidate, options) {
  validateHpa392E2eAppDataDir(candidate, options);
  const revalidated = validateHpa392E2eAppDataDir(candidate, options);
  rmSync(revalidated, { recursive: true });
}
