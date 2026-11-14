// =============================================================================
// packages/scripts/compile-scenes/inner-voice.ts
//
// Inner voice (心聲) is a spoken line whose whole text is wrapped in
// full-width parentheses: `**相馬律**：（……我想相信她。）`. It compiles as an
// ordinary spoken line; the game derives "this is a thought" from the text
// (apps/game/src/lib/state/inner-voice.ts). A line that opens with `（` but
// does not close with `）` would play as speech that looks half like a
// thought, so it is rejected here with its file and line.
// =============================================================================

import { dialogueOf } from "./line-ids";
import { tokenize } from "./tokenizer";
import type { CompileError } from "./types";

export function innerVoiceWrapErrors(
  source: string,
  sourceFile: string,
): CompileError[] {
  const errors: CompileError[] = [];
  for (const token of tokenize(source, sourceFile)) {
    const spoken = dialogueOf(token);
    if (!spoken) continue;
    const text = spoken.text.trim();
    if (!text.startsWith("（") || text.endsWith("）")) continue;
    errors.push({
      code: "innerVoiceUnclosed",
      message: `${sourceFile}:${token.line}: this spoken line opens with （ but does not end with ）. Inner voice wraps the whole line, e.g. **相馬律**：（……我想相信她。）; close it, or reword the line so it does not open with （.`,
      sourceFile,
      line: token.line,
    });
  }
  return errors;
}
