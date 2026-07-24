export function compileScenesWatchInputs(
  sourceRoots: readonly string[],
  assetConfigRoot: string,
): string[] {
  return [
    ...sourceRoots.map((root) => `${root}/story_catalog.md`),
    ...sourceRoots.map((root) => `${root}/chapter_*/*.md`),
    ...sourceRoots.map((root) => `${root}/chapter_*/*.layout.json`),
    `${assetConfigRoot}/**/*.yaml`,
  ];
}
