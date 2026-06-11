// =============================================================================
// scripts/compile-scenes/config-check.ts
//
// Asserts apps/game/src-tauri/tauri.conf.json has the wiring spec §3a.0 / §3a.1 require:
//   build.beforeDevCommand   === "bun run scenes:compile && bun run dev:frontend"
//   build.beforeBuildCommand === "bun run scenes:compile && bun run build"
//   bundle.resources         ⊇ ["resources/scenes/**/*"]
//
// Fails loud if any are missing or wrong.
// =============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const EXPECTED_BEFORE_DEV = "bun run scenes:compile && bun run dev:frontend";
const EXPECTED_BEFORE_BUILD = "bun run scenes:compile && bun run build";
const REQUIRED_RESOURCE = "resources/scenes/**/*";

export type ConfigCheckResult =
  | { ok: true }
  | { ok: false; problems: string[] };

export function checkTauriConfig(
  repoRoot: string = process.cwd(),
): ConfigCheckResult {
  const configPath = resolve(repoRoot, "apps/game/src-tauri/tauri.conf.json");
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch (e) {
    return {
      ok: false,
      problems: [`Cannot read ${configPath}: ${(e as Error).message}`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      problems: [`Invalid JSON in ${configPath}: ${(e as Error).message}`],
    };
  }

  const problems: string[] = [];
  const cfg = parsed as {
    build?: { beforeDevCommand?: string; beforeBuildCommand?: string };
    bundle?: { resources?: unknown };
  };

  const beforeDev = cfg.build?.beforeDevCommand;
  if (beforeDev !== EXPECTED_BEFORE_DEV) {
    problems.push(
      `build.beforeDevCommand should be "${EXPECTED_BEFORE_DEV}", got: ${JSON.stringify(beforeDev)}`,
    );
  }

  const beforeBuild = cfg.build?.beforeBuildCommand;
  if (beforeBuild !== EXPECTED_BEFORE_BUILD) {
    problems.push(
      `build.beforeBuildCommand should be "${EXPECTED_BEFORE_BUILD}", got: ${JSON.stringify(beforeBuild)}`,
    );
  }

  const resources = cfg.bundle?.resources;
  const ok = Array.isArray(resources) && resources.includes(REQUIRED_RESOURCE);
  if (!ok) {
    problems.push(
      `bundle.resources must include "${REQUIRED_RESOURCE}". Got: ${JSON.stringify(resources)}`,
    );
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
