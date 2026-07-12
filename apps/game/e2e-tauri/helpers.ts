import {
  anchors,
  dialogByHeading,
  DIALOGUE_DRAIN_CAP,
  STORY_CLEARED_STORAGE_KEY,
} from "./production-anchors";

/** DialogueBox uses role="button" on a div, not a <button>. */
export const advanceDialogueSelector = `[role="button"][aria-label="${anchors.advanceDialogue}"]`;

/**
 * Main-menu cards animate with opacity 0 (fill-mode both). Under WebDriver the
 * WebView can keep animations frozen when focus is flaky, so isDisplayed()
 * (checkVisibility + opacity) hangs forever. Prefer existence + JS click.
 */
/**
 * DialogueBox skips the JS typewriter when prefers-reduced-motion is reduce.
 * Without this, each advance needs two clicks (complete reveal, then advance)
 * and a 273-line intro exceeds the drain cap / suite budget.
 *
 * Also disable CSS transitions/animations: when the WebView is unfocused under
 * WDIO, transitions freeze at their starting values (opacity 0 on menu cards
 * and character highlight), so isDisplayed/getCSSProperty hang or assert 0.
 */
export async function forceReducedMotion(): Promise<void> {
  await browser.execute(() => {
    try {
      const original = window.matchMedia.bind(window);
      window.matchMedia = ((query: string) => {
        const mql = original(query);
        if (
          typeof query === "string" &&
          query.includes("prefers-reduced-motion")
        ) {
          Object.defineProperty(mql, "matches", {
            configurable: true,
            get: () => true,
          });
        }
        return mql;
      }) as typeof window.matchMedia;
    } catch {
      // ignore — drain still double-clicks as fallback
    }
    try {
      if (!document.getElementById("lyra-e2e-no-motion")) {
        const style = document.createElement("style");
        style.id = "lyra-e2e-no-motion";
        style.textContent =
          "*, *::before, *::after { transition: none !important; animation: none !important; animation-delay: 0s !important; }";
        document.head.appendChild(style);
      }
    } catch {
      // ignore
    }
  });
}

export async function waitForShell(): Promise<void> {
  await forceReducedMotion();
  await browser.waitUntil(
    async () => {
      return browser.execute((label: string) => {
        const buttons = Array.from(document.querySelectorAll("button"));
        return buttons.some((b) => (b.textContent ?? "").includes(label));
      }, anchors.startButton);
    },
    {
      timeout: 60000,
      timeoutMsg: "main menu start control did not appear in DOM",
      interval: 250,
    },
  );
}

export async function clickStartButton(): Promise<void> {
  await waitForShell();
  const clicked = await browser.execute((label: string) => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const btn = buttons.find((b) => (b.textContent ?? "").includes(label));
    if (!btn) return false;
    // Finish entrance animations so layout/hit-testing is stable.
    document.getAnimations?.().forEach((a) => {
      try {
        a.finish();
      } catch {
        /* ignore */
      }
    });
    (btn as HTMLButtonElement).click();
    return true;
  }, anchors.startButton);
  if (!clicked) {
    throw new Error("clickStartButton: start control not found");
  }
}

export async function resetE2eStorage(): Promise<void> {
  await browser.waitUntil(
    async () => {
      return browser.execute(() => typeof window.localStorage !== "undefined");
    },
    { timeout: 30000, timeoutMsg: "localStorage unavailable" },
  );
  await browser.execute((key: string) => {
    window.localStorage.removeItem(key);
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("lyra.")) toRemove.push(k);
    }
    for (const k of toRemove) window.localStorage.removeItem(k);
  }, STORY_CLEARED_STORAGE_KEY);
  await browser.refresh();
  // Re-apply motion stubs after navigation (refresh drops injected scripts).
  await waitForShell();
}

export async function startFromMenu(): Promise<void> {
  await clickStartButton();
  await browser.waitUntil(
    async () => {
      return browser.execute((sel: string) => {
        return document.querySelector(sel) !== null;
      }, advanceDialogueSelector);
    },
    {
      timeout: 30000,
      timeoutMsg: "dialogue advance control did not appear after start",
      interval: 200,
    },
  );
}

export async function waitTypewriterIdle(): Promise<void> {
  await browser.waitUntil(
    async () => {
      return browser.execute((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return false;
        return el.getAttribute("aria-disabled") !== "true";
      }, advanceDialogueSelector);
    },
    {
      timeout: 20000,
      timeoutMsg: "dialogue advance stayed aria-disabled",
      interval: 100,
    },
  );
  // Typewriter can take up to ~1.5s after enable; settle briefly.
  await browser.pause(150);
}

export async function advanceDialogueOnce(): Promise<void> {
  await waitTypewriterIdle();
  // Click twice: first may only complete a typewriter reveal; second advances.
  // With reduced-motion both are cheap no-ops/advances as appropriate.
  const ok = await browser.execute((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    el.click();
    el.click();
    return true;
  }, advanceDialogueSelector);
  if (!ok) {
    throw new Error("advanceDialogueOnce: advance control missing");
  }
}

/**
 * Read the currently visible dialogue line/narration/scene text so capped
 * drain failures report what was on screen (see flake policy in the design
 * spec). Returns "" when no dialogue text element is present.
 */
export async function lastVisibleDialogueText(): Promise<string> {
  return browser.execute(() => {
    const el = document.querySelector(".text-line, .text-action, .text-scene");
    return el ? (el.textContent ?? "").trim() : "";
  });
}

/**
 * Advance dialogue until `predicate` returns true or cap is hit.
 * Cap must be intro-length + margin (see production-anchors).
 */
export async function advanceDialogueUntil(
  predicate: () => Promise<boolean>,
  cap: number = DIALOGUE_DRAIN_CAP,
): Promise<void> {
  for (let i = 0; i < cap; i++) {
    if (await predicate()) return;
    const hasAdvance = await browser.execute((sel: string) => {
      return document.querySelector(sel) !== null;
    }, advanceDialogueSelector);
    if (!hasAdvance) {
      if (await predicate()) return;
      const lastText = await lastVisibleDialogueText();
      throw new Error(
        `advanceDialogueUntil: advance control unavailable at step ${i}; predicate still false; last visible text: ${JSON.stringify(lastText)}`,
      );
    }
    await advanceDialogueOnce();
  }
  const lastText = await lastVisibleDialogueText();
  throw new Error(
    `advanceDialogueUntil: exceeded cap ${cap}; predicate still false; last visible text: ${JSON.stringify(lastText)}`,
  );
}

export async function elementExists(selector: string): Promise<boolean> {
  return browser.execute((sel: string) => {
    return document.querySelector(sel) !== null;
  }, selector);
}

export async function elementTextIncludes(
  selector: string,
  text: string,
): Promise<boolean> {
  return browser.execute(
    (sel: string, needle: string) => {
      const el = document.querySelector(sel);
      return !!el && (el.textContent ?? "").includes(needle);
    },
    selector,
    text,
  );
}

export async function drainToInvestigationExplore(): Promise<void> {
  await startFromMenu();
  await advanceDialogueUntil(async () => {
    // Prefer DOM existence — avoids opacity/visibility flake on animated UI.
    const sub = await browser.execute((label: string) => {
      return Array.from(document.querySelectorAll("button")).some((b) =>
        (b.textContent ?? "").includes(label),
      );
    }, anchors.sublocationLabel);
    if (sub) return true;
    return elementExists(
      `button[aria-label="${anchors.hotspotEvidence.label}"]`,
    );
  });
}

export async function openGameMenu(): Promise<WebdriverIO.Element> {
  await browser.keys("Escape");
  const menu = await $(dialogByHeading(anchors.gameMenu));
  await browser.waitUntil(
    async () => {
      return browser.execute((heading: string) => {
        const dialogs = Array.from(
          document.querySelectorAll('[role="dialog"]'),
        );
        return dialogs.some((d) =>
          Array.from(d.querySelectorAll("h2")).some((h) =>
            (h.textContent ?? "").includes(heading),
          ),
        );
      }, anchors.gameMenu);
    },
    { timeout: 10000, timeoutMsg: "game menu dialog did not open" },
  );
  return menu;
}

export async function seedStoryCleared(): Promise<void> {
  await browser.execute((key: string) => {
    window.localStorage.setItem(key, "true");
  }, STORY_CLEARED_STORAGE_KEY);
  await browser.refresh();
  await waitForShell();
  // Assert persistence so storage-isolation failures surface during setup,
  // before the test body runs with a missing clearance flag.
  const value = await browser.execute((key: string) => {
    return window.localStorage.getItem(key);
  }, STORY_CLEARED_STORAGE_KEY);
  if (value !== "true") {
    throw new Error(
      `seedStoryCleared: ${STORY_CLEARED_STORAGE_KEY} did not persist across refresh (got ${JSON.stringify(value)})`,
    );
  }
}

export async function jsClick(selector: string): Promise<void> {
  const ok = await browser.execute((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  if (!ok) throw new Error(`jsClick: no element for ${selector}`);
}

export async function jsClickButtonContaining(text: string): Promise<void> {
  const ok = await browser.execute((label: string) => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(label),
    );
    if (!btn) return false;
    (btn as HTMLButtonElement).click();
    return true;
  }, text);
  if (!ok) throw new Error(`jsClickButtonContaining: no button with ${text}`);
}

/** Collect kagami_summary evidence and dismiss acquisition UI back to explore/dialogue. */
export async function collectKagamiSummaryEvidence(): Promise<void> {
  const hotspotSel = `button[aria-label="${anchors.hotspotEvidence.label}"]`;
  await browser.waitUntil(async () => elementExists(hotspotSel), {
    timeout: 15000,
    timeoutMsg: "evidence hotspot not in DOM",
  });
  await jsClick(hotspotSel);
  await browser.waitUntil(
    async () => {
      return browser.execute((heading: string) => {
        return Array.from(document.querySelectorAll('[role="dialog"]')).some(
          (d) =>
            Array.from(d.querySelectorAll("h2")).some((h) =>
              (h.textContent ?? "").includes(heading),
            ),
        );
      }, anchors.evidenceAcquired);
    },
    { timeout: 15000, timeoutMsg: "evidence acquisition popup missing" },
  );
  await jsClickButtonContaining("CONTINUE");
  // On-collect may queue dialogue; drain until explore or character is usable again.
  await advanceDialogueUntil(async () => {
    if (await elementExists(`button[aria-label="${anchors.character.label}"]`))
      return true;
    return elementExists(hotspotSel);
  }, 40);
}
