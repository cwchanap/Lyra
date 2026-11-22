import {
  EXPECTED_FOCUS_CONTROL_SELECTOR,
  isExpectedFocusOwner,
} from "./focus-owner";

export type FocusRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type FocusElementProbe = {
  descriptor: string;
  tag: string;
  isActiveElement: boolean;
  /** `element === document.body` — exact identity fallback owner. */
  isBody: boolean;
  isGameplayRoot: boolean;
  /** The element itself matches EXPECTED_FOCUS_CONTROL_SELECTOR — a
   * narrow interactive control, never an ancestor match. */
  matchesExpectedControl: boolean;
  focusVisible: boolean;
  matchesFocus: boolean;
  outlineStyle: string;
  outlineColor: string;
  outlineWidth: string;
  outlineOffset: string;
  /** True when the element's computed outline is actually painted
   * (non-none style, positive width, nonzero geometry). */
  paintsOutline: boolean;
  rect: FocusRect;
  /** Diagnostic: the outline rect intersects a character portrait rect at
   * all (portraits are fixed to the viewport edges, so a legitimate small
   * control ring can touch an edge — intersection alone is not the bug). */
  crossesPortraitRegion: boolean;
  /** Largest fraction of any portrait rect the outline covers (0–1). The
   * oversized/root-spanning regression frame covers the character visual;
   * a legitimate control ring covering a sliver of an edge stays near 0. */
  portraitCoverFraction: number;
};

export type FocusProbeSnapshot = {
  viewport: { width: number; height: number };
  activeElement: FocusElementProbe | null;
  gameplayRoot: FocusElementProbe | null;
  outlinedElements: FocusElementProbe[];
  portraitRegionCount: number;
};

/**
 * THE serialized WDIO page script — passed verbatim to
 * `browser.execute(probeFocusStateDom, controlSelector)`, so it must stay
 * self-contained (parameters + DOM globals only; module-scope bindings do
 * not survive WebDriver serialization). Unit tests invoke the very same
 * function against jsdom, covering the actual shipped probe rather than a
 * mirror of it.
 *
 * Snapshots the focus/outline state relevant to HPA-831: the focused
 * element (identity, descriptor, :focus/:focus-visible, outline, rect,
 * portrait crossing), the [data-gameplay-root] element's focus state, and
 * every element in the DOM currently painting a visible outline — the
 * "frame" the bug report describes.
 */
export function probeFocusStateDom(
  controlSelector: string,
): FocusProbeSnapshot {
  const rectOf = (element: Element) => {
    const r = element.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    };
  };
  const portraitRects = Array.from(document.querySelectorAll("img.portrait"))
    .map(rectOf)
    .filter((r) => r.width > 0 && r.height > 0);
  const crossesPortrait = (r: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }) =>
    portraitRects.some(
      (p) =>
        r.left < p.right - 0.5 &&
        r.right > p.left + 0.5 &&
        r.top < p.bottom - 0.5 &&
        r.bottom > p.top + 0.5,
    );
  const portraitCover = (r: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }) =>
    portraitRects.reduce((max, p) => {
      const w = Math.min(r.right, p.right) - Math.max(r.left, p.left);
      const h = Math.min(r.bottom, p.bottom) - Math.max(r.top, p.top);
      if (w <= 0 || h <= 0) return max;
      const area = p.width * p.height;
      return area > 0 ? Math.max(max, (w * h) / area) : max;
    }, 0);
  const describe = (
    element: Element | null,
    active: Element | null,
  ): FocusElementProbe | null => {
    if (!element) return null;
    const styles = getComputedStyle(element);
    const rect = rectOf(element);
    const classes =
      typeof element.className === "string"
        ? element.className.trim().split(/\s+/).slice(0, 3).join(".")
        : "";
    const ariaLabel = element.getAttribute("aria-label");
    const paintsOutline =
      styles.outlineStyle !== "none" &&
      parseFloat(styles.outlineWidth) > 0 &&
      styles.display !== "none" &&
      styles.visibility !== "hidden" &&
      rect.width > 0.5 &&
      rect.height > 0.5;
    return {
      descriptor:
        element.tagName.toLowerCase() +
        (element.id ? `#${element.id}` : "") +
        (classes ? `.${classes}` : "") +
        (ariaLabel ? `[${ariaLabel}]` : "") +
        (element.hasAttribute("data-gameplay-root")
          ? "[data-gameplay-root]"
          : ""),
      tag: element.tagName.toLowerCase(),
      isActiveElement: element === active,
      // body/root admit descendants by identity check only; controls are
      // matched on the element itself — closest() through body or the
      // root would pass every gameplay descendant (the review finding).
      isBody: element === document.body,
      isGameplayRoot: element.hasAttribute("data-gameplay-root"),
      matchesExpectedControl: element.matches(controlSelector),
      focusVisible:
        element instanceof HTMLElement
          ? element.matches(":focus-visible")
          : false,
      matchesFocus:
        element instanceof HTMLElement ? element.matches(":focus") : false,
      outlineStyle: styles.outlineStyle,
      outlineColor: styles.outlineColor,
      outlineWidth: styles.outlineWidth,
      outlineOffset: styles.outlineOffset,
      paintsOutline,
      rect,
      crossesPortraitRegion: crossesPortrait(rect),
      portraitCoverFraction: portraitCover(rect),
    };
  };
  const active = document.activeElement;
  const outlined = Array.from(document.querySelectorAll("*"))
    .filter((element) => {
      const styles = getComputedStyle(element);
      if (styles.outlineStyle === "none") return false;
      if (!(parseFloat(styles.outlineWidth) > 0)) return false;
      if (styles.display === "none" || styles.visibility === "hidden") {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0.5 && rect.height > 0.5;
    })
    .map((element) => describe(element, active))
    .filter((entry): entry is FocusElementProbe => entry !== null);
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    activeElement: describe(active, active),
    gameplayRoot: describe(
      document.querySelector("[data-gameplay-root]"),
      active,
    ),
    outlinedElements: outlined,
    portraitRegionCount: portraitRects.length,
  };
}

/**
 * Hook-specific owner/modality contract for the focus probes:
 *  - "any-expected": body/root by exact identity, or a narrow control
 *    (the default allowed-owner set);
 *  - "control": the focused element itself must match the control
 *    selector — the WebDriver-click hooks (interview/topic), where the
 *    intended owner is the clicked control;
 *  - "gameplay-root": the scene_2-root-focus regression hook, which
 *    programmatically focused the root — anything else owning focus means
 *    the intended state was never established.
 * `requireKeyboardModality` additionally demands the owner match
 * :focus-visible. At hooks reached via trusted Enter advances a truly
 * keyboard-modality focus state is expected; body (or any owner) without
 * :focus-visible is NOT established focus — inconclusive, never silently
 * green (the round-3 review finding).
 */
export type FocusOwnerRequirement = {
  owner: "any-expected" | "control" | "gameplay-root";
  requireKeyboardModality?: boolean;
};

export type FocusOwnerCheck =
  | { ok: true }
  | { ok: false; inconclusive: boolean; reason: string };

export function checkFocusOwner(
  owner: FocusElementProbe | null,
  requirement: FocusOwnerRequirement,
): FocusOwnerCheck {
  if (owner === null) {
    return {
      ok: false,
      inconclusive: true,
      reason:
        "document.activeElement is null — the focus owner cannot be established",
    };
  }
  switch (requirement.owner) {
    case "gameplay-root":
      if (!owner.isGameplayRoot) {
        return {
          ok: false,
          inconclusive: true,
          reason:
            `expected [data-gameplay-root] to hold focus but ` +
            `activeElement is ${owner.descriptor} — the intended focus ` +
            `state was not established`,
        };
      }
      break;
    case "control":
      if (!owner.matchesExpectedControl) {
        return {
          ok: false,
          inconclusive: true,
          reason:
            `expected a focused control matching ` +
            `${EXPECTED_FOCUS_CONTROL_SELECTOR} but activeElement is ` +
            `${owner.descriptor} — the intended focus state was not ` +
            `established`,
        };
      }
      break;
    default:
      if (!isExpectedFocusOwner(owner)) {
        return {
          ok: false,
          inconclusive: false,
          reason:
            `unexpected focus owner ${owner.descriptor} — expected body, ` +
            `[data-gameplay-root], or an element matching ` +
            `${EXPECTED_FOCUS_CONTROL_SELECTOR}`,
        };
      }
  }
  if (requirement.requireKeyboardModality === true && !owner.focusVisible) {
    return {
      ok: false,
      inconclusive: true,
      reason:
        `${owner.descriptor} holds focus without :focus-visible — ` +
        `keyboard focus modality could not be established at this hook`,
    };
  }
  return { ok: true };
}

/**
 * Prohibited outline states (HPA-831 Task 1 C), asserted at every probe —
 * including the required scene_2 first/middle/last and map hooks:
 *   (a) a painted outline on ANY element that is not document.activeElement
 *       — the stale/misplaced frame;
 *   (b) a painted outline on [data-gameplay-root] itself — the long-lived
 *       container is never a legitimate ring owner: the reported bug is a
 *       root-sized frame, and a focused root may NOT paint one, so the
 *       "focused root with a visible outline" regression case is covered
 *       here (also exercised directly by the scene_2-root-focus probe);
 *   (c) an oversized outline covering a character portrait — the
 *       root-spanning frame over the character visuals. Portraits are
 *       fixed to the viewport edges behind the UI, so the bar is >25% of
 *       a portrait rect covered, not mere edge intersection.
 * A legitimate control ring on the focused element (small, covering at
 * most a sliver of a portrait edge, not the root) still passes;
 * :focus-visible stays diagnostic because WebKitGTK may paint :focus
 * rings without keyboard modality.
 */
export function focusOutlineViolations(
  probe: FocusProbeSnapshot,
): FocusElementProbe[] {
  return probe.outlinedElements.filter(
    (entry) =>
      !entry.isActiveElement ||
      entry.isGameplayRoot ||
      entry.portraitCoverFraction > 0.25,
  );
}

/**
 * Focus-trajectory recorder for the topic-activation transition (finding
 * 2): WebDriver's click_element runs el.click() then el.focus() — the
 * focus lands on the topic control synchronously during the same driver
 * call, then successful activation unmounts ExploreView and the control
 * disappears, taking its focus state with it. Sampling activeElement
 * afterwards can therefore never prove the click moved focus — this
 * capture-phase listener records focusin/focusout targets AS they happen.
 * Serialized verbatim to the page; parameters + DOM globals only.
 * Returns whether the expected topic button existed at install time.
 */
export function installFocusTrajectoryScript(
  popoverSelector: string,
  topicLabel: string,
): { installed: boolean } {
  const w = window as unknown as {
    __hpa831FocusTrajectory?: {
      expected: Element | null;
      sawExpectedFocusIn: boolean;
      wasAlreadyFocused: boolean;
      events: Array<{ type: string; target: string }>;
    };
  };
  const describe = (target: EventTarget | null): string => {
    if (!(target instanceof Element)) return "window";
    const classes =
      typeof target.className === "string"
        ? target.className.trim().split(/\s+/).slice(0, 3).join(".")
        : "";
    return target.tagName.toLowerCase() + (classes ? "." + classes : "");
  };
  const expected =
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        `${popoverSelector} .topic-actions button`,
      ),
    ).find((candidate) => (candidate.textContent ?? "").includes(topicLabel)) ??
    null;
  const state = {
    expected,
    sawExpectedFocusIn: false,
    wasAlreadyFocused: document.activeElement === expected,
    events: [] as Array<{ type: string; target: string }>,
  };
  w.__hpa831FocusTrajectory = state;
  const record = (event: Event) => {
    if (state.events.length < 50) {
      state.events.push({
        type: event.type,
        target: describe(event.target),
      });
    }
    if (event.type === "focusin" && event.target === state.expected) {
      state.sawExpectedFocusIn = true;
    }
  };
  window.addEventListener("focusin", record, true);
  window.addEventListener("focusout", record, true);
  return { installed: expected !== null };
}

export type FocusTrajectoryResult = {
  sawExpectedFocusIn: boolean;
  /** The control already held focus when the recorder was installed —
   * no focusin event is expected in that case. */
  wasAlreadyFocused: boolean;
  /** document.activeElement descriptor at read time (post-transition). */
  activeDescriptor: string | null;
  events: Array<{ type: string; target: string }>;
};

/** Reads back the recorder state after the transition has settled. */
export function readFocusTrajectoryScript(): FocusTrajectoryResult | null {
  const w = window as unknown as {
    __hpa831FocusTrajectory?: {
      expected: Element | null;
      sawExpectedFocusIn: boolean;
      wasAlreadyFocused: boolean;
      events: Array<{ type: string; target: string }>;
    };
  };
  const state = w.__hpa831FocusTrajectory;
  if (!state) return null;
  const describe = (target: EventTarget | null): string | null => {
    if (!(target instanceof Element)) return null;
    const classes =
      typeof target.className === "string"
        ? target.className.trim().split(/\s+/).slice(0, 3).join(".")
        : "";
    return target.tagName.toLowerCase() + (classes ? "." + classes : "");
  };
  return {
    sawExpectedFocusIn: state.sawExpectedFocusIn,
    wasAlreadyFocused: state.wasAlreadyFocused,
    activeDescriptor: describe(document.activeElement),
    events: state.events,
  };
}
