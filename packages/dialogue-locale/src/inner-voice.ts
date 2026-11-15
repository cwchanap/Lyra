// =============================================================================
// packages/dialogue-locale/src/inner-voice.ts
//
// Inner voice (心聲): a spoken line whose whole text is one full-width
// parenthesised group, e.g. `**相馬律**：（……我想相信她。）`. It stays an
// ordinary spoken line everywhere else (scene JSON, saves, line IDs, locale
// scripts, voice clips).
//
// Consumers, which must agree on what counts as a thought:
//   - packages/scripts/compile-scenes/inner-voice.ts  (rejects a spoken line
//     that opens with （ but is not wholly wrapped)
//   - apps/game/src/lib/state/inner-voice.ts          (shows it as 心聲)
// =============================================================================

const OPEN = "（";
const CLOSE = "）";

/** True when the text opens with （, i.e. it claims to be inner voice. */
export function opensWithInnerVoiceParen(text: string): boolean {
  return text.trim().startsWith(OPEN);
}

/**
 * True when the trimmed text is one （…） group: the （ that opens it is
 * closed by the final ）. Pairs nested inside are fine; a line such as
 * 「（低聲）我知道。（停頓）」 is speech with stage directions, not a thought.
 */
export function isInnerVoiceText(text: string): boolean {
  if (!opensWithInnerVoiceParen(text)) return false;
  const chars = [...text.trim()];
  let depth = 0;
  for (const [index, char] of chars.entries()) {
    if (char === OPEN) depth += 1;
    else if (char === CLOSE) {
      depth -= 1;
      if (depth === 0) return index === chars.length - 1;
    }
  }
  return false;
}
