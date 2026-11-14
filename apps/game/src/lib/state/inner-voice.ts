// Inner voice (心聲): a spoken line whose whole text is wrapped in full-width
// parentheses, e.g. `**相馬律**：（……我想相信她。）`. It is not a separate
// dialogue kind: scene JSON, saves, line IDs, the Japanese locale and voice
// clips treat it as an ordinary spoken line. The dialogue box and the LOG
// panel both read this one test so they never disagree about a line.
//
// The compiler rejects a spoken line that opens with `（` but does not close
// with `）` (packages/scripts/compile-scenes/inner-voice.ts), so every line
// that opens with `（` reaching the game is a whole thought.

import type { DialogueHistoryEntry, DialogueItem } from "./types";

const OPEN = "（";
const CLOSE = "）";

/** True when a spoken line's source text is wholly wrapped in `（ ）`. Run it
 * on the scene's own text, never on a translation, which could drop the
 * parentheses. */
export function isInnerVoiceText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith(OPEN) && trimmed.endsWith(CLOSE);
}

/** True for a spoken-line item (dialogue box item or LOG entry) that is inner
 * voice. Narration stays narration even when it is wholly in parentheses,
 * like the compiler's default 「（沒有新發現。）」. */
export function isInnerVoiceLine(
  item: DialogueItem | DialogueHistoryEntry,
): boolean {
  return item.kind === "line" && isInnerVoiceText(item.text);
}
