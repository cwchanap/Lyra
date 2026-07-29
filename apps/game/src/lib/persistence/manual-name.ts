export type ManualDisplayNameValidation =
  | { ok: true; value: string }
  | { ok: false; reason: "empty" | "tooLong" | "forbidden" };

const forbiddenCharacter = /[\p{Cc}\u2028\u2029]/u;
const edgeWhiteSpace = /^\p{White_Space}+|\p{White_Space}+$/gu;
const graphemeSegmenter = new Intl.Segmenter("zh-Hant", {
  granularity: "grapheme",
});

function graphemes(input: string): string[] {
  return Array.from(graphemeSegmenter.segment(input), ({ segment }) => segment);
}

export function validateManualDisplayName(
  input: string,
): ManualDisplayNameValidation {
  if (forbiddenCharacter.test(input)) {
    return { ok: false, reason: "forbidden" };
  }

  const value = input.replace(edgeWhiteSpace, "");
  const count = graphemes(value).length;
  if (count === 0) return { ok: false, reason: "empty" };
  if (count > 40) return { ok: false, reason: "tooLong" };
  return { ok: true, value };
}

export function suggestManualDisplayName(
  chapterTitle: string,
  sceneTitle: string,
): string {
  const combined = `${chapterTitle} · ${sceneTitle}`;
  const segments = graphemes(combined);
  return segments.length <= 40
    ? combined
    : `${segments.slice(0, 39).join("")}…`;
}
