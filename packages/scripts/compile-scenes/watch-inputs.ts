import { isAbsolute, relative, sep } from "node:path";

export function compileScenesWatchInputs(
  sourceRoots: readonly string[],
  assetConfigRoot: string,
): string[] {
  return [...sourceRoots, assetConfigRoot];
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
