import {
  advanceDialogueSelector,
  collectKagamiSummaryEvidence,
  drainToInvestigationExplore,
  elementExists,
  jsClick,
  openGameMenu,
  resetE2eStorage,
} from "./helpers";
import { anchors } from "./production-anchors";

describe("investigation layout surface", () => {
  beforeEach(async () => {
    await resetE2eStorage();
  });

  it("clicks a placed investigation hotspot", async () => {
    await drainToInvestigationExplore();
    const hotspotSel = `button[aria-label="${anchors.hotspotEvidence.label}"]`;
    await browser.waitUntil(async () => elementExists(hotspotSel), {
      timeout: 15000,
    });
    await jsClick(hotspotSel);

    await browser.waitUntil(
      async () => {
        const popup = await browser.execute((heading: string) => {
          return Array.from(document.querySelectorAll('[role="dialog"]')).some(
            (d) =>
              Array.from(d.querySelectorAll("h2")).some((h) =>
                (h.textContent ?? "").includes(heading),
              ),
          );
        }, anchors.evidenceAcquired);
        if (popup) return true;
        return elementExists(advanceDialogueSelector);
      },
      {
        timeout: 15000,
        timeoutMsg:
          "expected acquisition popup or dialogue after hotspot click",
      },
    );
  });

  it("highlights a placed investigation character on hover", async () => {
    await drainToInvestigationExplore();
    const characterSel = `button[aria-label="${anchors.character.label}"]`;
    await browser.waitUntil(async () => elementExists(characterSel), {
      timeout: 15000,
    });

    // Production CSS raises highlight/name opacity on :hover, :focus-visible,
    // or [aria-expanded="true"]. OS-focus flake makes real hover + getComputedStyle
    // via execute unreliable (script timeouts under tauri-service window hooks).
    // Expand the character (same CSS rules as hover) and assert via JS
    // getComputedStyle to avoid findElement/elementClick focus-hook timeouts.
    await jsClick(characterSel);
    await browser.waitUntil(
      async () =>
        browser.execute((sel: string) => {
          const el = document.querySelector(sel);
          return el?.getAttribute("aria-expanded") === "true";
        }, characterSel),
      { timeout: 10000, timeoutMsg: "character did not expand" },
    );

    await browser.waitUntil(
      async () => {
        return browser.execute((sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const highlight = el.querySelector(".character-highlight");
          const name = el.querySelector(".character-name");
          if (!highlight || !name) return false;
          const ho = window.getComputedStyle(highlight).opacity;
          const no = window.getComputedStyle(name).opacity;
          return Number(ho) >= 0.99 && Number(no) >= 0.99;
        }, characterSel);
      },
      {
        timeout: 10000,
        timeoutMsg: "character highlight/name opacity not 1 when expanded",
      },
    );
  });

  it("Escape closes the topic popover before opening the game menu", async () => {
    await drainToInvestigationExplore();
    // commission topic starts locked until kagami_summary is revealed.
    await collectKagamiSummaryEvidence();

    const characterSel = `button[aria-label="${anchors.character.label}"]`;
    await browser.waitUntil(async () => elementExists(characterSel), {
      timeout: 15000,
    });
    await jsClick(characterSel);

    await browser.waitUntil(
      async () => {
        return browser.execute((label: string) => {
          return !!document.querySelector(
            `[role="dialog"][aria-label="${label}"]`,
          );
        }, anchors.topicPopoverName);
      },
      { timeout: 10000, timeoutMsg: "topic popover did not open" },
    );

    await browser.keys("Escape");
    await browser.waitUntil(
      async () => {
        return browser.execute((label: string) => {
          const el = document.querySelector(
            `[role="dialog"][aria-label="${label}"]`,
          );
          return !el;
        }, anchors.topicPopoverName);
      },
      { timeout: 5000, timeoutMsg: "topic popover did not close on Escape" },
    );

    const menuOpen = await browser.execute((heading: string) => {
      return Array.from(document.querySelectorAll('[role="dialog"]')).some(
        (d) =>
          Array.from(d.querySelectorAll("h2")).some((h) =>
            (h.textContent ?? "").includes(heading),
          ),
      );
    }, anchors.gameMenu);
    expect(menuOpen).toBe(false);

    await openGameMenu();
    const menuNow = await browser.execute((heading: string) => {
      return Array.from(document.querySelectorAll('[role="dialog"]')).some(
        (d) =>
          Array.from(d.querySelectorAll("h2")).some((h) =>
            (h.textContent ?? "").includes(heading),
          ),
      );
    }, anchors.gameMenu);
    expect(menuNow).toBe(true);
  });
});
