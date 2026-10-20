import { keyExpression } from "@lyra/dialogue-locale";
import type { EmittedLine, LocaleScriptLine } from "./types";

/** `scene_5.md` + `L012` -> `scene_5.md#L012`: a line's key within a chapter. */
export function scriptLineKey(sceneFile: string, id: string): string {
  return `${sceneFile}#${id}`;
}

/** The scene file whose script holds an emitted line. */
export function ownerSceneFile(line: EmittedLine, sceneFile: string): string {
  return line.sourceFile ?? sceneFile;
}

/**
 * True when the scene line no longer reads the way it did when translated:
 * another speaker, expression or Chinese text.
 */
export function sourceChanged(
  entry: LocaleScriptLine,
  emitted: EmittedLine,
): boolean {
  return (
    entry.speaker !== emitted.speaker ||
    entry.zh !== emitted.text ||
    keyExpression(entry.expression ?? null) !==
      keyExpression(emitted.expression)
  );
}
