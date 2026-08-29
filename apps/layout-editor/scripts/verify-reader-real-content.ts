import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChaptersIndex } from "@lyra/scene-types";
import { projectReaderScene } from "../src/lib/reader-projection";
import type {
  ReaderGroup,
  ReaderItem,
  WorkbenchScenePayload,
} from "../src/lib/workbench-types";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const resourcesRoot = resolve(repoRoot, "apps/game/src-tauri/resources/scenes");
const chapters = JSON.parse(
  readFileSync(resolve(resourcesRoot, "chapters.json"), "utf8"),
) as ChaptersIndex;
const chapter = chapters.chapters.find(({ id }) => id === "chapter_1");
if (!chapter) throw new Error("chapter_1 missing from compiled manifest");

const stems = chapter.scenes.map(({ file }) =>
  file.replace(/^.*\//, "").replace(/\.json$/, ""),
);
const linearIndex = chapter.scenes.findIndex(({ type }) => type === "linear");
const requiredIndexes = [
  linearIndex,
  stems.indexOf("investigation_scene_3"),
  stems.indexOf("interrogation_scene_4"),
  stems.indexOf("analysis_scene_8_5"),
];
if (requiredIndexes.some((index) => index < 0)) {
  throw new Error(
    "required Chapter 1 Reader verification scene missing from manifest",
  );
}

const readers = requiredIndexes.map((index) => {
  const entry = chapter.scenes[index]!;
  const compiled = JSON.parse(
    readFileSync(resolve(resourcesRoot, entry.file), "utf8"),
  ) as WorkbenchScenePayload;
  const sourcePath = `docs/stories_plan/${entry.file.replace(/\.json$/, ".md")}`;
  return projectReaderScene(chapter.id, sourcePath, compiled);
});

function items(groups: ReaderGroup[]): ReaderItem[] {
  return groups.flatMap((group) => [...group.items, ...items(group.children)]);
}

const investigationItems = items(readers[1]!.groups);
if (
  !investigationItems.some(
    (item) => item.kind === "notice" && item.noticeKind === "evidence",
  )
) {
  throw new Error("investigation_scene_3 projected no evidence/reveal notice");
}

const interrogationItems = items(readers[2]!.groups);
if (
  !interrogationItems.some(
    (item) => item.kind === "notice" && item.noticeKind === "contradiction",
  )
) {
  throw new Error("interrogation_scene_4 projected no contradiction notice");
}

for (const reader of readers) {
  if (reader.groups.length === 0)
    throw new Error(`${reader.id} projected an empty Reader`);
}

console.log(
  `verify-reader-real-content: OK — ${readers.map(({ id }) => id).join(", ")}`,
);
