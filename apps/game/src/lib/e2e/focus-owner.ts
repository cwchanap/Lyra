/**
 * Expected-focus-owner contract for the commission -> scene_2 -> map
 * regression segment (HPA-831).
 *
 * `body` and `[data-gameplay-root]` are ancestors of every gameplay
 * element, so they match by exact identity ONLY — an ancestor/closest test
 * through either of them admits literally any element, which is exactly
 * the wrong-owner signature this gate exists to catch. Descendant
 * admission is restricted to the narrow interactive controls in the
 * caller-supplied control selector — authored as
 * EXPECTED_FOCUS_CONTROL_SELECTOR in e2e-tauri/production-anchors.ts
 * (the single production-coupling point; this module is also imported by
 * the app bundle and cannot import that file back).
 */

export type FocusOwnerFacts = {
  /** `element === document.body` — the browser's fallback focus owner. */
  isBody: boolean;
  /** `element` carries the gameplay-root attribute — the app's own
   * focus-restore owner (silently focused is fine; painting an outline is
   * the bug). */
  isGameplayRoot: boolean;
  /** `element` itself matches the caller-supplied control selector. */
  matchesExpectedControl: boolean;
};

export function isExpectedFocusOwner(facts: FocusOwnerFacts | null): boolean {
  if (facts === null) return false;
  return facts.isBody || facts.isGameplayRoot || facts.matchesExpectedControl;
}

/**
 * Reference implementation of the serialized browser probe's owner-facts
 * computation (the probe mirrors it because imports cannot cross the
 * WebDriver serialization boundary): exact identity for body/root,
 * `matches()` against the narrow control selector — never `closest()`,
 * which would admit every gameplay descendant through body and the root.
 */
export function focusOwnerFacts(
  element: Element,
  controlSelector: string,
  gameplayRootAttribute: string,
): FocusOwnerFacts {
  return {
    isBody: element === element.ownerDocument.body,
    isGameplayRoot: element.hasAttribute(gameplayRootAttribute),
    matchesExpectedControl: element.matches(controlSelector),
  };
}
