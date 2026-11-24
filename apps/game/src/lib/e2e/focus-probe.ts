import { statSync } from "node:fs";
import { isExpectedFocusOwner } from "./focus-owner";

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
  /** The element itself matches the caller-supplied control selector — a
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
 * `browser.execute(probeFocusStateDom, controlSelector, portraitSelector,
 * gameplayRootAttribute)`, so it must stay self-contained (parameters +
 * DOM globals only; module-scope bindings do not survive WebDriver
 * serialization). The production selector/attribute values are authored
 * in e2e-tauri/production-anchors.ts and passed in by the caller — unit
 * tests invoke the very same function against jsdom, covering the actual
 * shipped probe rather than a mirror of it.
 *
 * Snapshots the focus/outline state relevant to HPA-831: the focused
 * element (identity, descriptor, :focus/:focus-visible, outline, rect,
 * portrait crossing), the gameplay-root element's focus state, and every
 * element in the DOM currently painting a visible outline — the "frame"
 * the bug report describes.
 */
export function probeFocusStateDom(
  controlSelector: string,
  portraitSelector: string,
  gameplayRootAttribute: string,
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
  const portraitRects = Array.from(document.querySelectorAll(portraitSelector))
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
        (element.hasAttribute(gameplayRootAttribute)
          ? `[${gameplayRootAttribute}]`
          : ""),
      tag: element.tagName.toLowerCase(),
      isActiveElement: element === active,
      // body/root admit descendants by identity check only; controls are
      // matched on the element itself — closest() through body or the
      // root would pass every gameplay descendant (the review finding).
      isBody: element === document.body,
      isGameplayRoot: element.hasAttribute(gameplayRootAttribute),
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
      document.querySelector(`[${gameplayRootAttribute}]`),
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
 *  - "gameplay-root": the focused-root regression contract, asserting
 *    [data-gameplay-root] itself owns focus — anything else owning focus
 *    means the intended state was never established.
 * `requireKeyboardModality` additionally demands the owner match
 * :focus-visible. At hooks reached via trusted Enter advances a truly
 * keyboard-modality focus state is expected; body (or any owner) without
 * :focus-visible is NOT established focus — inconclusive, never silently
 * green (the round-3 review finding). The parked-map hook deliberately
 * omits it: the last Enter's advance unmounts the focused dialogue
 * control with the DialogueBox, so the browser legitimately falls back
 * to body with no ring — the same unmount fallback as topic-click —
 * and the keyboard proof there is trusted Enter delivery, not the
 * fallback owner's modality (evidence run a0f60ac6).
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
  controlSelector: string,
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
            `expected the gameplay root to hold focus but ` +
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
            `${controlSelector} but activeElement is ` +
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
            `the gameplay root, or an element matching ` +
            `${controlSelector}`,
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
 *       here (and exercised directly by the unit regression below);
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
 * Round-4 review gate: the probe evidence writes are deliberately
 * best-effort — a wedged session or gone window must not let a capture
 * error mask the probe result or the failure a stall hook was about to
 * report. But a probe that PASSED its owner/outline checks is a credited
 * checkpoint, and the plan requires each credited checkpoint's
 * screenshot + diagnostics artifacts to actually exist on disk. Returns
 * the artifact names whose writes did not land (failed or empty file);
 * the caller fails inconclusive on any entry rather than crediting a
 * checkpoint without its evidence.
 *
 * `evidenceArtifactLanded` is the per-artifact half of that gate,
 * extracted from the e2e capture so vitest pins it against real files:
 * true only when the artifact exists AND is nonempty — a swallowed write
 * failure (no file) and a zero-byte write both report as missing
 * evidence. Never serialized into the page.
 */
export function evidenceArtifactLanded(artifactPath: string): boolean {
  try {
    return statSync(artifactPath).size > 0;
  } catch {
    return false;
  }
}

export function focusProbeEvidenceMissing(evidence: {
  screenshot: boolean;
  diagnostics: boolean;
}): string[] {
  const missing: string[] = [];
  if (!evidence.screenshot) missing.push("screenshot");
  if (!evidence.diagnostics) missing.push("diagnostics");
  return missing;
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
  topicButtonSelector: string,
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
        `${popoverSelector} ${topicButtonSelector}`,
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

export type KeyboardFocusTargetProbe = {
  /** document.activeElement IS the named control. */
  onTarget: boolean;
  /** Diagnostic descriptor of the current owner (tag + first classes). */
  descriptor: string | null;
};

/**
 * Serialized verbatim into the page for the bounded
 * establish-keyboard-focus wait (HPA-831 final review): after the topic
 * control's unmount drops focus to the browser fallback, WebDriver Tab
 * input must move DOM focus to the stable advance control before the
 * Enter drain begins. This poll proves only the owner — keyboard
 * modality (:focus-visible) is enforced separately by the shared probe
 * gate (`requireKeyboardModality`) once the owner lands.
 * Self-contained: parameters + DOM globals only.
 */
export function probeKeyboardFocusTargetDom(
  selector: string,
): KeyboardFocusTargetProbe {
  const active = document.activeElement;
  if (!active) return { onTarget: false, descriptor: null };
  const classes =
    typeof active.className === "string"
      ? active.className.trim().split(/\s+/).slice(0, 3).join(".")
      : "";
  return {
    onTarget: active.matches(selector),
    descriptor: active.tagName.toLowerCase() + (classes ? `.${classes}` : ""),
  };
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

export type KeyDeliveryEvent = {
  key: string;
  isTrusted: boolean;
  target: string;
};

/**
 * Serialized verbatim into the page: records each keydown the page
 * actually receives (key + DOM isTrusted + target tag) on
 * window.__hpa831KeyEvents. WebDriver key actions are spec'd to produce
 * trusted input; synthetic dispatchEvent would arrive untrusted, and an
 * embedded transport that injects untrusted DOM events is caught the
 * same way. Parameters + DOM globals only — nothing module-scoped
 * survives WebDriver serialization.
 * Re-installing removes the previous listener and resets the buffer, so
 * a second install never double-records.
 */
export function installKeyDeliveryRecorderScript(): void {
  const w = window as unknown as {
    __hpa831KeyEvents?: KeyDeliveryEvent[];
    __hpa831KeyDeliveryListener?: (event: KeyboardEvent) => void;
  };
  if (w.__hpa831KeyDeliveryListener) {
    window.removeEventListener("keydown", w.__hpa831KeyDeliveryListener, true);
  }
  w.__hpa831KeyEvents = [];
  const record = (event: KeyboardEvent) => {
    w.__hpa831KeyEvents?.push({
      key: event.key,
      isTrusted: event.isTrusted,
      target:
        event.target instanceof Element
          ? event.target.tagName.toLowerCase()
          : "window",
    });
  };
  w.__hpa831KeyDeliveryListener = record;
  window.addEventListener("keydown", record, true);
}

/** Serialized verbatim into the page: reads back the recorded keydowns. */
export function readKeyDeliveryEventsScript(): KeyDeliveryEvent[] {
  const w = window as unknown as {
    __hpa831KeyEvents?: KeyDeliveryEvent[];
  };
  return w.__hpa831KeyEvents ?? [];
}

export type TrustedEnterDeliveryCheck =
  | { ok: true; receivedEnters: number }
  | { ok: false; reason: string };

/**
 * Node-side decision of the objective trusted-delivery gate the journey
 * applies: every Enter the test sent must have reached the page as a
 * trusted keydown. Fewer recorded Enters means the transport dropped
 * input; any untrusted event means the delivery is not real keyboard
 * modality — either way the keyboard coverage is inconclusive and the
 * journey must NOT pass on queue progress alone.
 */
export function checkTrustedEnterDelivery(
  events: KeyDeliveryEvent[],
  sentEnters: number,
): TrustedEnterDeliveryCheck {
  const untrusted = events.filter((event) => !event.isTrusted);
  if (untrusted.length > 0) {
    return {
      ok: false,
      reason:
        `${untrusted.length}/${events.length} keydown events arrived ` +
        `untrusted (isTrusted=false) — the embedded transport cannot ` +
        `establish real keyboard modality; focus/keyboard coverage is ` +
        `inconclusive ` +
        `(events: ${JSON.stringify(untrusted.slice(0, 5))})`,
    };
  }
  const receivedEnters = events.filter((event) => event.key === "Enter").length;
  if (receivedEnters < sentEnters) {
    return {
      ok: false,
      reason:
        `only ${receivedEnters}/${sentEnters} Enter keydowns reached the ` +
        `page — the embedded transport dropped keyboard input; ` +
        `focus/keyboard coverage is inconclusive`,
    };
  }
  if (receivedEnters === 0) {
    return {
      ok: false,
      reason:
        `no Enter keydown reached the page — keyboard coverage is ` +
        `inconclusive`,
    };
  }
  return { ok: true, receivedEnters };
}
