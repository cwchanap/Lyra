import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative, sep } from "node:path";

export function compileScenesWatchInputs(
  sourceRoots: readonly string[],
  assetConfigRoot: string,
): string[] {
  return [...sourceRoots, assetConfigRoot];
}

/**
 * For each watch input, if the path does not exist yet, watch its nearest
 * existing ancestor instead. This keeps an optional source root (e.g.
 * `static/stories_plan` before any content is authored there) visible to
 * Chokidar so that creating the root or adding files under it later in the
 * session triggers a recompile. `isCompileScenesWatchPath` still gates which
 * events actually recompile, so watching a broader ancestor is safe.
 * Returns a de-duplicated list; inputs that have no existing ancestor (e.g.
 * on a path whose parents are all missing) are dropped. An input whose nearest
 * existing ancestor is the filesystem root (`/` on POSIX, a drive root on
 * Windows) is also dropped — watching the filesystem root is never the intent
 * for compile-scenes inputs and would flood Chokidar.
 */
export function resolveWatchRoots(inputs: readonly string[]): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    let root = input;
    while (!existsSync(root) && dirname(root) !== root) {
      root = dirname(root);
    }
    // Drop when the resolved root is the filesystem root itself. On POSIX `/`
    // always exists, so the loop above exits via `existsSync` before the
    // `dirname(root) !== root` guard fires; without this check `/` would be
    // handed to chokidar.watch(...). On Windows the same applies to drive
    // roots, and a missing drive falls through here too.
    if (dirname(root) === root) continue;
    if (!seen.has(root)) {
      seen.add(root);
      resolved.push(root);
    }
  }
  return resolved;
}

export function isCompileScenesWatchPath(
  path: string,
  sourceRoots: readonly string[],
  assetConfigRoot: string,
): boolean {
  for (const root of sourceRoots) {
    const segments = relativeSegments(root, path);
    if (!segments) continue;
    if (segments.length === 1 && segments[0] === "story_catalog.md") {
      return true;
    }
    if (
      segments.length === 2 &&
      /^chapter_\d+$/.test(segments[0] ?? "") &&
      (segments[1]?.endsWith(".md") || segments[1]?.endsWith(".layout.json"))
    ) {
      return true;
    }
  }

  const assetSegments = relativeSegments(assetConfigRoot, path);
  return (
    assetSegments !== null && assetSegments.at(-1)?.endsWith(".yaml") === true
  );
}

function relativeSegments(root: string, path: string): string[] | null {
  const relativePath = relative(root, path);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return null;
  }
  return relativePath.split(sep);
}
