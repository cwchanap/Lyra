// Inner voice (心聲): a spoken line whose whole text is one full-width
// parenthesised group, e.g. `**相馬律**：（……我想相信她。）`. It is not a
// separate dialogue kind: scene JSON, saves, line IDs, the Japanese locale and
// voice clips treat it as an ordinary spoken line. The dialogue box and the
// LOG panel both read this one test so they never disagree about a line, and
// the rule itself comes from @lyra/dialogue-locale, which the compiler's
// check (packages/scripts/compile-scenes/inner-voice.ts) also uses.

import { isInnerVoiceText } from "@lyra/dialogue-locale";
import type { DialogueHistoryEntry, DialogueItem } from "./types";

export { isInnerVoiceText };

/** True for a spoken-line item (dialogue box item or LOG entry) that is inner
 * voice. Run it on the scene's own text, never on a translation, which could
 * drop the parentheses. Narration stays narration even when it is wholly in
 * parentheses, like the compiler's default 「（沒有新發現。）」. */
export function isInnerVoiceLine(
  item: DialogueItem | DialogueHistoryEntry,
): boolean {
  return item.kind === "line" && isInnerVoiceText(item.text);
}
