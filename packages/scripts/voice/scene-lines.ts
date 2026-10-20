import {
  deriveDialogueSegments,
  type EmittedSceneRecordV1,
} from "../compile-scenes/dialogue-segment-origins";
import type { EmittedLine } from "./types";

/**
 * Lists every spoken `line` item of one emitted scene, in emitted dialogue
 * order, with the portrait expression the game will show.
 */
export function spokenLinesOfScene(
  chapterId: string,
  json: EmittedSceneRecordV1["json"],
): EmittedLine[] {
  const lines: EmittedLine[] = [];
  for (const segment of deriveDialogueSegments({ chapterId, json })) {
    for (const item of segment.items) {
      if (item.kind !== "line") continue;
      lines.push({
        speaker: item.speaker,
        text: item.text,
        expression: item.portrait?.expression ?? null,
      });
    }
  }
  return lines;
}
