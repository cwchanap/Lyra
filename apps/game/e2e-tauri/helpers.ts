import {
  anchors,
  DIALOGUE_DRAIN_CAP,
  STORY_CLEARED_STORAGE_KEY,
} from "./production-anchors";

export async function waitForShell(): Promise<void> {
  const start = await $(`button*=開始調查`);
  await start.waitForDisplayed({ timeout: 60000 });
}

export async function resetE2eStorage(): Promise<void> {
  await browser.execute((key: string) => {
    try {
      window.localStorage.removeItem(key);
      // Clear other lyra.* keys if present so tests do not inherit prefs.
      const toRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith("lyra.")) toRemove.push(k);
      }
      for (const k of toRemove) window.localStorage.removeItem(k);
    } catch {
      // storage may be unavailable briefly during startup
    }
  }, STORY_CLEARED_STORAGE_KEY);
  await browser.refresh();
  await waitForShell();
}

export async function startFromMenu(): Promise<void> {
  const start = await $(`button*=開始調查`);
  await start.waitForDisplayed({ timeout: 60000 });
  await start.click();
}

export async function waitTypewriterIdle(): Promise<void> {
  // 推進對話 is enabled once the line can advance; also wait for stability.
  const advance = await $(`button[aria-label="${anchors.advanceDialogue}"]`);
  await advance.waitForEnabled({ timeout: 20000 });
  await browser.pause(50);
}

export async function advanceDialogueOnce(): Promise<void> {
  await waitTypewriterIdle();
  const advance = await $(`button[aria-label="${anchors.advanceDialogue}"]`);
  await advance.click();
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
    const advance = await $(`button[aria-label="${anchors.advanceDialogue}"]`);
    if (!(await advance.isExisting()) || !(await advance.isEnabled())) {
      if (await predicate()) return;
      throw new Error(
        `advanceDialogueUntil: advance control unavailable at step ${i}; predicate still false`,
      );
    }
    await advanceDialogueOnce();
  }
  throw new Error(
    `advanceDialogueUntil: exceeded cap ${cap}; predicate still false`,
  );
}

export async function drainToInvestigationExplore(): Promise<void> {
  await startFromMenu();
  await advanceDialogueUntil(async () => {
    // Sublocation or a placed hotspot control is visible in explore mode.
    const sub = await $(`button*=${anchors.sublocationLabel}`);
    if (await sub.isDisplayed().catch(() => false)) return true;
    const hotspot = await $(anchors.hotspotEvidence.label);
    return hotspot.isDisplayed().catch(() => false);
  });
}

export async function openGameMenu(): Promise<WebdriverIO.Element> {
  await browser.keys("Escape");
  const menu = await $(`[role="dialog"][aria-label="${anchors.gameMenu}"]`);
  await menu.waitForDisplayed({ timeout: 10000 });
  return menu;
}

export async function seedStoryCleared(): Promise<void> {
  await browser.execute((key: string) => {
    window.localStorage.setItem(key, "true");
  }, STORY_CLEARED_STORAGE_KEY);
  await browser.refresh();
  await waitForShell();
}
