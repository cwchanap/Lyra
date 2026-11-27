export type RenderedPortraitSnapshot = {
  src: string | null;
  complete: boolean;
  naturalWidth: number;
  naturalHeight: number;
};

export type PortraitCaptureExpectation = {
  label: string;
  characterId: string;
  /** Expected public asset path, e.g. /assets/portraits/saegusa_yuma/irritated.png. */
  assetPath: string;
  speaker?: string;
  /** Authored line text that the live dialogue box must already show. */
  text?: string;
};

export type PortraitCaptureCheck = { ok: true } | { ok: false; reason: string };

/** Reduces a rendered URL/data URI to the comparable /assets/... path. */
export function normalizeCapturePath(src: string | null): string | null {
  if (!src) return null;
  const pathPart = src.split(/[?#]/u)[0] ?? "";
  const marker = "/assets/";
  const index = pathPart.indexOf(marker);
  return index >= 0 ? pathPart.slice(index) : pathPart;
}

/** Collapses whitespace so authored/render differences remain comparable. */
export function normalizeCaptureText(text: string | null): string {
  return (text ?? "").replace(/\s+/gu, " ").trim();
}

/**
 * Gate applied before a compact character screenshot: the visible crossfade
 * portrait must decode to the expected character asset, and for a spoken line
 * the rendered dialogue text must already contain the authored speaker/text.
 * It deliberately does not accept a merely decoded portrait.
 */
export function checkPortraitCapture(
  expected: PortraitCaptureExpectation,
  rendered: RenderedPortraitSnapshot,
  dialogueText: string | null,
): PortraitCaptureCheck {
  if (
    !rendered.complete ||
    rendered.naturalWidth <= 0 ||
    rendered.naturalHeight <= 0
  ) {
    return {
      ok: false,
      reason: `${expected.label}: expected ${expected.characterId} portrait is not decoded`,
    };
  }
  const renderedPath = normalizeCapturePath(rendered.src);
  const expectedPath = normalizeCapturePath(expected.assetPath);
  if (!renderedPath || !expectedPath || renderedPath !== expectedPath) {
    return {
      ok: false,
      reason: `${expected.label}: expected ${expected.characterId} portrait ${String(expectedPath)}, rendered ${String(renderedPath)}`,
    };
  }
  if (expected.text) {
    const renderedText = normalizeCaptureText(dialogueText);
    if (!renderedText.includes(normalizeCaptureText(expected.text))) {
      return {
        ok: false,
        reason: `${expected.label}: authored dialogue text is not rendered yet`,
      };
    }
  }
  if (expected.speaker) {
    const renderedText = normalizeCaptureText(dialogueText);
    if (!renderedText.includes(normalizeCaptureText(expected.speaker))) {
      return {
        ok: false,
        reason: `${expected.label}: authored speaker ${expected.speaker} is not rendered yet`,
      };
    }
  }
  return { ok: true };
}
