import { beforeEach, describe, expect, it } from "vitest";
import {
  anchors,
  EXPECTED_FOCUS_CONTROL_SELECTOR,
} from "../../../e2e-tauri/production-anchors";
import {
  checkFocusOwner,
  checkTrustedEnterDelivery,
  focusOutlineViolations,
  focusProbeEvidenceMissing,
  installFocusTrajectoryScript,
  installKeyDeliveryRecorderScript,
  probeFocusStateDom,
  probeKeyboardFocusTargetDom,
  readFocusTrajectoryScript,
  readKeyDeliveryEventsScript,
  type FocusElementProbe,
} from "./focus-probe";

/**
 * These tests run the very functions `browser.execute` serializes into the
 * packaged WebKitGTK page (probeFocusStateDom, install/read
 * FocusTrajectoryScript) — not a mirrored helper — plus the Node-side gate
 * decisions (checkFocusOwner, focusOutlineViolations) applied to their
 * output.
 */

// jsdom has no layout: getBoundingClientRect returns zeros, which would
// make every outline/portrait invisible to the probe. Feed each element a
// rect through the prototype — standard jsdom practice.
const RECTS = new WeakMap<Element, Partial<DOMRect>>();
const ZERO_RECT = {
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
} as DOMRect;
Element.prototype.getBoundingClientRect = function (this: Element) {
  return { ...ZERO_RECT, ...RECTS.get(this) } as DOMRect;
};

function setRect(
  element: Element,
  rect: { left: number; top: number; width: number; height: number },
): void {
  RECTS.set(element, {
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    width: rect.width,
    height: rect.height,
  });
}

function paintOutline(element: HTMLElement): void {
  element.style.outlineStyle = "solid";
  element.style.outlineWidth = "2px";
  element.style.outlineColor = "rgb(0, 204, 255)";
}

const TOPIC_LABEL = "委託內容";
const POPOVER_SELECTOR = ".topic-popover";
const TOPIC_BUTTON_SELECTOR = anchors.topicActionButtonSelector;

// The serialized page scripts take the authored selectors/attributes as
// parameters (production coupling lives in production-anchors); these
// wrappers pass exactly what the journey passes.
const probeFocusState = () =>
  probeFocusStateDom(
    EXPECTED_FOCUS_CONTROL_SELECTOR,
    anchors.portraitImageSelector,
    anchors.gameplayRootAttribute,
  );
const checkOwner = (
  owner: Parameters<typeof checkFocusOwner>[0],
  requirement: Parameters<typeof checkFocusOwner>[1],
) => checkFocusOwner(owner, requirement, EXPECTED_FOCUS_CONTROL_SELECTOR);

function mountGameplayDom(): void {
  document.body.innerHTML = `
    <div data-gameplay-root="" tabindex="-1">
      <div class="investigation-stage">
        <button class="character-target" aria-label="詢問：早坂茜">早坂茜</button>
        <div class="topic-popover" role="dialog">
          <button class="close-topics" aria-label="關閉詢問項目">×</button>
          <div class="topic-actions">
            <button type="button">${TOPIC_LABEL}</button>
            <button type="button">その他</button>
          </div>
        </div>
        <div class="unrelated-panel"><button class="hotspot">熱點</button></div>
      </div>
      <div class="wrapper">
        <button class="log-button">LOG</button>
        <button class="advance-button" aria-label="推進對話">▶</button>
        <div class="box"><span class="text-line">台詞</span></div>
      </div>
      <div class="map-plane">
        <button data-map-destination="police_meeting_room">警局</button>
        <button data-map-region="district_a">地區</button>
      </div>
    </div>
  `;
}

function query(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`fixture missing ${selector}`);
  return element;
}

beforeEach(() => {
  mountGameplayDom();
});

describe("probeFocusStateDom — the actual serialized WDIO page script", () => {
  const probe = () => probeFocusState();

  it("records body as an exact-identity owner", () => {
    const snapshot = probe();
    expect(snapshot.activeElement?.isBody).toBe(true);
    expect(
      checkOwner(snapshot.activeElement, { owner: "any-expected" }),
    ).toEqual({ ok: true });
  });

  it("records the gameplay root as focused owner by exact identity", () => {
    const root = query("[data-gameplay-root]");
    root.focus();
    const snapshot = probe();
    expect(snapshot.activeElement?.isGameplayRoot).toBe(true);
    expect(snapshot.activeElement?.isActiveElement).toBe(true);
    expect(
      checkOwner(snapshot.activeElement, { owner: "gameplay-root" }),
    ).toEqual({ ok: true });
  });

  it("records a narrow control as an expected owner", () => {
    query(".advance-button").focus();
    const snapshot = probe();
    expect(snapshot.activeElement?.matchesExpectedControl).toBe(true);
    expect(checkOwner(snapshot.activeElement, { owner: "control" })).toEqual({
      ok: true,
    });
  });

  it("flags an unexpected gameplay descendant as no expected owner", () => {
    // The round-2 finding: ancestor matching through body/root used to
    // pass this. The real probe now reports all three facts false.
    query(".unrelated-panel .hotspot").focus();
    const snapshot = probe();
    const owner = snapshot.activeElement;
    expect(owner?.isBody).toBe(false);
    expect(owner?.isGameplayRoot).toBe(false);
    expect(owner?.matchesExpectedControl).toBe(false);
    const check = checkOwner(owner, { owner: "any-expected" });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.inconclusive).toBe(false); // violation, not inconclusive
  });

  it("detects a stale outline painted on a non-active element", () => {
    const stale = query(".unrelated-panel .hotspot");
    setRect(stale, { left: 10, top: 10, width: 40, height: 20 });
    paintOutline(stale);
    query(".advance-button").focus();
    const snapshot = probe();
    const violations = focusOutlineViolations(snapshot);
    expect(violations.map((v) => v.descriptor)).toContain("button.hotspot");
    expect(violations.some((v) => !v.isActiveElement)).toBe(true);
  });

  it("detects the reported regression: focused root painting an outline", () => {
    const root = query("[data-gameplay-root]");
    setRect(root, { left: 0, top: 0, width: 800, height: 600 });
    paintOutline(root);
    root.focus();
    const snapshot = probe();
    const violations = focusOutlineViolations(snapshot);
    expect(violations.some((v) => v.isGameplayRoot && v.isActiveElement)).toBe(
      true,
    );
  });

  it("detects an oversized outline covering a character portrait", () => {
    const portrait = document.createElement("img");
    portrait.className = "portrait";
    document.body.appendChild(portrait);
    setRect(portrait, { left: 0, top: 0, width: 200, height: 600 });
    const frame = query(".unrelated-panel");
    setRect(frame, { left: 0, top: 0, width: 800, height: 600 });
    paintOutline(frame);
    const snapshot = probe();
    expect(snapshot.portraitRegionCount).toBe(1);
    const covered = snapshot.outlinedElements.find(
      (v) => v.portraitCoverFraction > 0.25,
    );
    expect(covered?.portraitCoverFraction).toBeCloseTo(1, 1);
    expect(focusOutlineViolations(snapshot).length).toBeGreaterThan(0);
  });

  it("lets a legitimate focused control ring pass all outline checks", () => {
    const portrait = document.createElement("img");
    portrait.className = "portrait";
    document.body.appendChild(portrait);
    setRect(portrait, { left: 0, top: 0, width: 200, height: 600 });
    // A small ring on the focused advance button that merely touches the
    // portrait's right-adjacent edge covers ~0.3% of it — not the bug.
    const button = query(".advance-button");
    setRect(button, { left: 195, top: 560, width: 60, height: 20 });
    paintOutline(button);
    button.focus();
    const snapshot = probe();
    const ring = snapshot.outlinedElements.find((v) => v.isActiveElement);
    expect(ring).toBeDefined();
    expect(ring?.portraitCoverFraction ?? 1).toBeLessThanOrEqual(0.25);
    expect(focusOutlineViolations(snapshot)).toHaveLength(0);
    expect(
      checkOwner(snapshot.activeElement, { owner: "any-expected" }),
    ).toEqual({ ok: true });
  });

  it("records keyboard modality as unestablished when the owner lacks :focus-visible", () => {
    // THE round-3 finding: at scene_2/map hooks, body with
    // focusVisible=false used to pass. jsdom never reports :focus-visible,
    // so the real probe output drives exactly the inconclusive verdict the
    // hook must now produce.
    const snapshot = probe();
    expect(snapshot.activeElement?.isBody).toBe(true);
    expect(snapshot.activeElement?.focusVisible).toBe(false);
    const check = checkOwner(snapshot.activeElement, {
      owner: "any-expected",
      requireKeyboardModality: true,
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.inconclusive).toBe(true);
  });
});

describe("checkFocusOwner — per-hook owner/modality requirements", () => {
  const owner = (overrides: Partial<FocusElementProbe>): FocusElementProbe => ({
    descriptor: "body",
    tag: "body",
    isActiveElement: true,
    isBody: false,
    isGameplayRoot: false,
    matchesExpectedControl: false,
    focusVisible: false,
    matchesFocus: true,
    outlineStyle: "none",
    outlineColor: "",
    outlineWidth: "0px",
    outlineOffset: "0px",
    paintsOutline: false,
    rect: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
    crossesPortraitRegion: false,
    portraitCoverFraction: 0,
    ...overrides,
  });

  it("is inconclusive when activeElement is null", () => {
    const check = checkOwner(null, { owner: "any-expected" });
    expect(check).toMatchObject({ ok: false, inconclusive: true });
  });

  it("is inconclusive when a 'control' hook finds a non-control owner", () => {
    const check = checkOwner(owner({ isBody: true }), {
      owner: "control",
    });
    expect(check).toMatchObject({ ok: false, inconclusive: true });
  });

  it("is inconclusive when the root-focus hook finds another owner", () => {
    const check = checkOwner(owner({ isBody: true }), {
      owner: "gameplay-root",
    });
    expect(check).toMatchObject({ ok: false, inconclusive: true });
  });

  it("passes a keyboard-modality hook only when the owner is :focus-visible", () => {
    const visibleBody = owner({ isBody: true, focusVisible: true });
    expect(
      checkOwner(visibleBody, {
        owner: "any-expected",
        requireKeyboardModality: true,
      }),
    ).toEqual({ ok: true });
    const visibleControl = owner({
      matchesExpectedControl: true,
      focusVisible: true,
    });
    expect(
      checkOwner(visibleControl, {
        owner: "any-expected",
        requireKeyboardModality: true,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects an invisible-modality owner even when it is expected", () => {
    const control = owner({ matchesExpectedControl: true });
    const check = checkOwner(control, {
      owner: "any-expected",
      requireKeyboardModality: true,
    });
    expect(check).toMatchObject({ ok: false, inconclusive: true });
  });
});

describe("probeKeyboardFocusTargetDom — the actual serialized poll", () => {
  // The bounded establish-keyboard-focus wait the journey runs before the
  // Enter drain: WebDriver Tab input must land DOM focus on the stable
  // advance control, or the positive keyboard-modality owner is
  // unestablished and coverage is inconclusive.
  it("reports the unmount fallback (body) as off-target", () => {
    const result = probeKeyboardFocusTargetDom(".advance-button");
    expect(result.onTarget).toBe(false);
    expect(result.descriptor).toBe("body");
  });

  it("reports focus on the advance control as on-target", () => {
    query(".advance-button").focus();
    const result = probeKeyboardFocusTargetDom(".advance-button");
    expect(result.onTarget).toBe(true);
    expect(result.descriptor).toBe("button.advance-button");
  });

  it("rejects a different control — the poll is exact-owner only", () => {
    query(".log-button").focus();
    const result = probeKeyboardFocusTargetDom(".advance-button");
    expect(result.onTarget).toBe(false);
    expect(result.descriptor).toBe("button.log-button");
  });
});

describe("focus trajectory scripts — actual serialized lifecycle", () => {
  it("reports installed:false when the topic button is absent", () => {
    document.body.innerHTML = `<div class="topic-popover"></div>`;
    expect(
      installFocusTrajectoryScript(
        POPOVER_SELECTOR,
        TOPIC_BUTTON_SELECTOR,
        TOPIC_LABEL,
      ),
    ).toEqual({ installed: false });
  });

  it("captures the focusin landing on the topic control during activation", () => {
    expect(
      installFocusTrajectoryScript(
        POPOVER_SELECTOR,
        TOPIC_BUTTON_SELECTOR,
        TOPIC_LABEL,
      ),
    ).toEqual({ installed: true });
    // The WebDriver click's el.focus() equivalent — synchronous, inside
    // the same task as activation.
    query(".topic-actions button").focus();
    // Successful activation unmounts the popover + button.
    document.querySelector(POPOVER_SELECTOR)?.remove();
    const result = readFocusTrajectoryScript();
    expect(result?.sawExpectedFocusIn).toBe(true);
    expect(result?.events.some((e) => e.type === "focusin")).toBe(true);
  });

  it("proves inconclusive when activation never focused the control", () => {
    expect(
      installFocusTrajectoryScript(
        POPOVER_SELECTOR,
        TOPIC_BUTTON_SELECTOR,
        TOPIC_LABEL,
      ),
    ).toEqual({ installed: true });
    // A click path that moves focus somewhere else entirely.
    query(".hotspot").focus();
    document.querySelector(POPOVER_SELECTOR)?.remove();
    const result = readFocusTrajectoryScript();
    expect(result?.sawExpectedFocusIn).toBe(false);
    expect(result?.wasAlreadyFocused).toBe(false);
    // This is the state the journey converts into an inconclusive error.
  });

  it("accepts focus already on the control at install time", () => {
    query(".topic-actions button").focus();
    expect(
      installFocusTrajectoryScript(
        POPOVER_SELECTOR,
        TOPIC_BUTTON_SELECTOR,
        TOPIC_LABEL,
      ),
    ).toEqual({ installed: true });
    const result = readFocusTrajectoryScript();
    expect(result?.wasAlreadyFocused).toBe(true);
  });

  it("returns null when the recorder was never installed", () => {
    // Fresh page state: no prior install in this test.
    (window as unknown as Record<string, unknown>)["__hpa831FocusTrajectory"] =
      undefined;
    expect(readFocusTrajectoryScript()).toBeNull();
  });
});

describe("map-pending gate — the contract the parked-map hook applies", () => {
  // Evidence run a0f60ac6 (focus-map-pending.json): the last Enter's
  // advance unmounts the focused .advance-button with the DialogueBox,
  // so activeElement falls back to body — focusVisible=false, no painted
  // outline anywhere. That legitimate transition state is the contract
  // this block pins.
  it("accepts the legitimate unmount fallback: body, no ring, fv=false", () => {
    const snapshot = probeFocusState();
    expect(snapshot.activeElement?.isBody).toBe(true);
    expect(snapshot.activeElement?.focusVisible).toBe(false);
    expect(snapshot.outlinedElements).toHaveLength(0);
    // The owner contract the map hook enforces: an expected transition
    // owner and zero stale outlines.
    expect(
      checkOwner(snapshot.activeElement, { owner: "any-expected" }),
    ).toEqual({ ok: true });
    expect(focusOutlineViolations(snapshot)).toHaveLength(0);
    // …and the same observed state is inconclusive under
    // requireKeyboardModality — which is exactly why the map hook's
    // keyboard proof is trusted Enter delivery, not owner modality.
    const modality = checkOwner(snapshot.activeElement, {
      owner: "any-expected",
      requireKeyboardModality: true,
    });
    expect(modality.ok).toBe(false);
    if (!modality.ok) expect(modality.inconclusive).toBe(true);
  });

  it("still fails a stale outline painted during the body fallback", () => {
    // The map hook must keep catching the reported bug even while the
    // fallback owner itself is legitimate.
    const stale = query(".unrelated-panel .hotspot");
    setRect(stale, { left: 10, top: 10, width: 40, height: 20 });
    paintOutline(stale);
    const snapshot = probeFocusState();
    expect(snapshot.activeElement?.isBody).toBe(true);
    expect(focusOutlineViolations(snapshot).map((v) => v.descriptor)).toContain(
      "button.hotspot",
    );
  });

  it("still fails an unexpected transition owner as a violation", () => {
    // A focused non-control descendant is the wrong-owner signature —
    // reported as a violation (inconclusive=false), not an unestablished
    // state.
    query(".unrelated-panel .hotspot").focus();
    const snapshot = probeFocusState();
    const check = checkOwner(snapshot.activeElement, {
      owner: "any-expected",
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.inconclusive).toBe(false);
  });
});

describe("key-delivery scripts — actual serialized recorder", () => {
  // jsdom-dispatched events are never trusted, which doubles as proof the
  // untrusted path through the real recorder is observable.
  it("records dispatched keydowns with key, isTrusted and target tag", () => {
    installKeyDeliveryRecorderScript();
    query(".advance-button").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(readKeyDeliveryEventsScript()).toEqual([
      { key: "Enter", isTrusted: false, target: "button" },
      { key: "Tab", isTrusted: false, target: "window" },
    ]);
  });

  it("resets the buffer on re-install without double-recording", () => {
    installKeyDeliveryRecorderScript();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    installKeyDeliveryRecorderScript();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(readKeyDeliveryEventsScript()).toEqual([
      { key: "Enter", isTrusted: false, target: "window" },
    ]);
  });

  it("returns an empty list when the recorder was never installed", () => {
    (window as unknown as Record<string, unknown>)["__hpa831KeyEvents"] =
      undefined;
    expect(readKeyDeliveryEventsScript()).toEqual([]);
  });

  it("feeds recorded synthetic events into the delivery gate as untrusted", () => {
    installKeyDeliveryRecorderScript();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    const check = checkTrustedEnterDelivery(readKeyDeliveryEventsScript(), 1);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("untrusted");
  });
});

describe("checkTrustedEnterDelivery — the map-crossing keyboard proof", () => {
  const trustedEnter = { key: "Enter", isTrusted: true, target: "button" };

  it("passes when every sent Enter arrived as a trusted keydown", () => {
    expect(
      checkTrustedEnterDelivery(
        [trustedEnter, trustedEnter, { ...trustedEnter }],
        3,
      ),
    ).toEqual({ ok: true, receivedEnters: 3 });
  });

  it("fails inconclusive when the transport dropped sent Enters", () => {
    const check = checkTrustedEnterDelivery([trustedEnter], 3);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toContain("1/3");
      expect(check.reason).toContain("inconclusive");
    }
  });

  it("fails when any recorded event arrived untrusted", () => {
    // One synthetic event anywhere — including a non-Enter key — means
    // the transport cannot establish real keyboard modality.
    const check = checkTrustedEnterDelivery(
      [trustedEnter, { key: "Tab", isTrusted: false, target: "body" }],
      1,
    );
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("untrusted");
  });

  it("fails when no Enter keydown ever reached the page", () => {
    const check = checkTrustedEnterDelivery(
      [{ key: "Tab", isTrusted: true, target: "body" }],
      0,
    );
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("no Enter keydown");
  });

  it("counts only Enter keys toward sent Enters", () => {
    // Trusted Tab presses from the establish-focus phase are recorded but
    // do not count; extra delivered Enters do not reduce the proof.
    expect(
      checkTrustedEnterDelivery(
        [
          { key: "Tab", isTrusted: true, target: "body" },
          trustedEnter,
          { ...trustedEnter },
        ],
        2,
      ),
    ).toEqual({ ok: true, receivedEnters: 2 });
  });
});

describe("focusProbeEvidenceMissing — the credited-checkpoint artifact gate", () => {
  it("returns nothing when both artifacts landed", () => {
    expect(
      focusProbeEvidenceMissing({ screenshot: true, diagnostics: true }),
    ).toEqual([]);
  });

  it("names each artifact whose write did not land", () => {
    expect(
      focusProbeEvidenceMissing({ screenshot: false, diagnostics: true }),
    ).toEqual(["screenshot"]);
    expect(
      focusProbeEvidenceMissing({ screenshot: true, diagnostics: false }),
    ).toEqual(["diagnostics"]);
    expect(
      focusProbeEvidenceMissing({ screenshot: false, diagnostics: false }),
    ).toEqual(["screenshot", "diagnostics"]);
  });
});
