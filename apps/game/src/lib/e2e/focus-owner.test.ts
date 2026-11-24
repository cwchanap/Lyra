import { describe, expect, it } from "vitest";
import {
  anchors,
  EXPECTED_FOCUS_CONTROL_SELECTOR,
} from "../../../e2e-tauri/production-anchors";
import { focusOwnerFacts, isExpectedFocusOwner } from "./focus-owner";

const ownerFacts = (element: Element) =>
  focusOwnerFacts(
    element,
    EXPECTED_FOCUS_CONTROL_SELECTOR,
    anchors.gameplayRootAttribute,
  );

function buildDom(innerHtml: string): {
  doc: Document;
  query: (selector: string) => Element;
} {
  const doc = document.implementation.createHTMLDocument("probe");
  doc.body.innerHTML = innerHtml;
  return {
    doc,
    query: (selector: string) => {
      const element = doc.querySelector(selector);
      if (!element) throw new Error(`fixture missing ${selector}`);
      return element;
    },
  };
}

const GAMEPLAY_DOM = `
  <div data-gameplay-root="">
    <div class="investigation-stage">
      <button class="character-target" aria-label="詢問：早坂茜">早坂茜</button>
      <div class="topic-popover" role="dialog">
        <button class="close-topics" aria-label="關閉詢問項目">×</button>
        <div class="topic-actions">
          <button type="button">委託內容</button>
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
      <button data-map-overview="">全域</button>
    </div>
  </div>
`;

describe("isExpectedFocusOwner", () => {
  it("rejects a null owner (unestablished focus state)", () => {
    expect(isExpectedFocusOwner(null)).toBe(false);
  });

  it("rejects an owner matching no exact identity or control", () => {
    expect(
      isExpectedFocusOwner({
        isBody: false,
        isGameplayRoot: false,
        matchesExpectedControl: false,
      }),
    ).toBe(false);
  });

  it.each([
    [
      "body itself",
      { isBody: true, isGameplayRoot: false, matchesExpectedControl: false },
    ],
    [
      "the gameplay root itself",
      { isBody: false, isGameplayRoot: true, matchesExpectedControl: false },
    ],
    [
      "a narrow control",
      { isBody: false, isGameplayRoot: false, matchesExpectedControl: true },
    ],
  ])("allows %s", (_label, facts) => {
    expect(isExpectedFocusOwner(facts)).toBe(true);
  });
});

describe("focusOwnerFacts + isExpectedFocusOwner over DOM", () => {
  it("allows document.body by exact identity", () => {
    const { doc } = buildDom(GAMEPLAY_DOM);
    expect(isExpectedFocusOwner(ownerFacts(doc.body))).toBe(true);
  });

  it("allows [data-gameplay-root] by exact identity", () => {
    const { query } = buildDom(GAMEPLAY_DOM);
    const root = query("[data-gameplay-root]");
    expect(isExpectedFocusOwner(ownerFacts(root))).toBe(true);
  });

  it.each([
    ".advance-button",
    ".log-button",
    ".character-target",
    ".topic-actions button",
    ".close-topics",
    "[data-map-destination]",
    "[data-map-region]",
    "[data-map-overview]",
  ])("allows the narrow control %s", (selector) => {
    const { query } = buildDom(GAMEPLAY_DOM);
    expect(isExpectedFocusOwner(ownerFacts(query(selector)))).toBe(true);
  });

  it("rejects an unexpected descendant admitted only through the gameplay root", () => {
    const { query } = buildDom(GAMEPLAY_DOM);
    // The regression this gate fixes: closest("body,[data-gameplay-root]")
    // returned the root (and body) for ANY descendant, so this unrelated
    // button wrongly passed as an expected owner.
    const hotspot = query(".unrelated-panel .hotspot");
    const facts = ownerFacts(hotspot);
    expect(facts.matchesExpectedControl).toBe(false);
    expect(isExpectedFocusOwner(facts)).toBe(false);
  });

  it("rejects a non-control descendant inside .box", () => {
    const { query } = buildDom(GAMEPLAY_DOM);
    expect(isExpectedFocusOwner(ownerFacts(query(".box .text-line")))).toBe(
      false,
    );
  });

  it("rejects the .topic-popover container itself (not a control)", () => {
    const { query } = buildDom(GAMEPLAY_DOM);
    expect(isExpectedFocusOwner(ownerFacts(query(".topic-popover")))).toBe(
      false,
    );
  });

  it("rejects a non-focusable .box container", () => {
    const { query } = buildDom(GAMEPLAY_DOM);
    expect(isExpectedFocusOwner(ownerFacts(query(".box")))).toBe(false);
  });

  it("keeps the control selector free of ancestor-only surfaces", () => {
    // Guard the contract: body and the gameplay root must never appear in
    // the descendant-matched selector, or every element passes again.
    for (const selector of EXPECTED_FOCUS_CONTROL_SELECTOR.split(",")) {
      const probe = selector.trim();
      expect(probe).not.toBe("body");
      expect(probe).not.toBe("[data-gameplay-root]");
    }
  });
});
