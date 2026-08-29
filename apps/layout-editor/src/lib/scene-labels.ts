/**
 * Converts a scene filename into a human-readable label (e.g. "investigation_scene_3" → "Investigation Scene 3").
 */
export function readableSceneLabel(file: string): string {
  const basename =
    file
      .split("/")
      .at(-1)
      ?.replace(/\.json$/i, "") ?? file;
  const sceneMatch =
    /^(?:(investigation|interrogation|analysis)_)?scene_(.+)$/.exec(basename);
  if (sceneMatch) {
    const [, prefix, sceneNumber] = sceneMatch;
    const typeLabel = prefix ? `${titleCase(prefix)} Scene` : "Scene";
    return `${typeLabel} ${formatSceneNumber(sceneNumber)}`;
  }

  return basename.split("_").filter(Boolean).map(titleCase).join(" ");
}

/**
 * Returns the chapter title if present, otherwise derives a label from the chapter ID.
 */
export function readableChapterLabel(chapterId: string, title: string): string {
  if (title.trim()) return title;
  const chapterNumber = chapterId.match(/\d+(?:_\d+)?/)?.[0];
  return chapterNumber
    ? `Chapter ${formatSceneNumber(chapterNumber)}`
    : chapterId;
}

function formatSceneNumber(value: string): string {
  return value.replace(/_/g, ".");
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
