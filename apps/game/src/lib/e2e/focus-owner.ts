/**
 * Expected-focus-owner contract for the commission -> scene_2 -> map
 * regression segment (HPA-831).
 *
 * `body` and `[data-gameplay-root]` are ancestors of every gameplay
 * element, so they match by exact identity ONLY — an ancestor/closest test
 * through either of them admits literally any element, which is exactly
 * the wrong-owner signature this gate exists to catch. Descendant
 * admission is restricted to the narrow interactive controls in
 * EXPECTED_FOCUS_CONTROL_SELECTOR: the DialogueBox buttons, the character
 * interview target, the topic popover's buttons, and the city-map pins.
 */
export const EXPECTED_FOCUS_CONTROL_SELECTOR = [
  ".advance-button",
  ".log-button",
  ".character-target",
  ".topic-popover button",
  "[data-map-destination]",
  "[data-map-region]",
  "[data-map-overview]",
].join(",");

export type FocusOwnerFacts = {
  /** `element === document.body` — the browser's fallback focus owner. */
  isBody: boolean;
  /** `element` has `data-gameplay-root` — the app's own focus-restore
   * owner (silently focused is fine; painting an outline is the bug). */
  isGameplayRoot: boolean;
  /** `element` itself matches EXPECTED_FOCUS_CONTROL_SELECTOR. */
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
export function focusOwnerFacts(element: Element): FocusOwnerFacts {
  return {
    isBody: element === element.ownerDocument.body,
    isGameplayRoot: element.hasAttribute("data-gameplay-root"),
    matchesExpectedControl: element.matches(EXPECTED_FOCUS_CONTROL_SELECTOR),
  };
}
