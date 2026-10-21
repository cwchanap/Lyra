import { basename } from "node:path";
import {
  deriveDialogueSegments,
  type EmittedSceneRecordV1,
} from "../compile-scenes/dialogue-segment-origins";
import type { EmittedLine } from "./types";

/**
 * Lists every spoken `line` item of one emitted scene, in emitted dialogue
 * order, with the portrait expression the game will show. With the scene's
 * source AST and the line IDs of its source files, each line also carries
 * the ID of the authored line it came from; otherwise `id` is null.
 */
export function spokenLinesOfScene(
  chapterId: string,
  json: EmittedSceneRecordV1["json"],
  source?: {
    sourceAst: EmittedSceneRecordV1["sourceAst"];
    /** `chapter_1/scene_5.md` -> 1-based physical line -> line ID. */
    lineIds: ReadonlyMap<string, ReadonlyMap<number, string>>;
  },
): EmittedLine[] {
  const lines: EmittedLine[] = [];
  const segments = deriveDialogueSegments({
    chapterId,
    json,
    ...(source?.sourceAst ? { sourceAst: source.sourceAst } : {}),
  });
  segments.forEach((segment, segmentIndex) => {
    segment.items.forEach((item, index) => {
      if (item.kind !== "line") return;
      const origin = segment.itemSources?.[index];
      const located = origin && "sourceFile" in origin ? origin : null;
      lines.push({
        speaker: item.speaker,
        text: item.text,
        expression: item.portrait?.expression ?? null,
        id: located
          ? (source?.lineIds.get(located.sourceFile)?.get(located.line) ?? null)
          : null,
        sourceFile: located ? basename(located.sourceFile) : null,
        segment: segmentIndex,
      });
    });
  });
  return lines;
}
