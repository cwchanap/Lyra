// =============================================================================
// packages/scripts/compile-scenes/inner-voice.ts
//
// Inner voice (心聲) is a spoken line whose whole text is wrapped in
// full-width parentheses: `**相馬律**：（……我想相信她。）`. It compiles as an
// ordinary spoken line; the game derives "this is a thought" from the text
// (apps/game/src/lib/state/inner-voice.ts), with the same rule from
// @lyra/dialogue-locale. A line that opens with `（` but is not one whole
// （…） group would play as speech that looks half like a thought, so it is
// rejected here with its file and line.
// =============================================================================

import {
  isInnerVoiceText,
  opensWithInnerVoiceParen,
} from "@lyra/dialogue-locale";
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
    if (!opensWithInnerVoiceParen(spoken.text) || isInnerVoiceText(spoken.text))
      continue;
    errors.push({
      code: "innerVoiceUnclosed",
      message: `${sourceFile}:${token.line}: this spoken line opens with （ but that （ does not close at the end of the line. Inner voice wraps the whole line in one pair, e.g. **相馬律**：（……我想相信她。）; move a stage direction such as （低聲） to its own [...] line.`,
      sourceFile,
      line: token.line,
    });
  }
  return errors;
}
