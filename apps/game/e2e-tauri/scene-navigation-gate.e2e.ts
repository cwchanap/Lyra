import {
  openGameMenu,
  resetE2eStorage,
  seedStoryCleared,
  startFromMenu,
} from "./helpers";
import { anchors } from "./production-anchors";

/**
 * Returns true when a game-menu dialog whose heading matches `menuHeading`
 * contains a button whose label includes `sceneLabel`. Returns false when no
 * matching dialog or button exists. Shared by both scene-nav gate cases so the
 * DOM lookup stays consistent.
 */
async function menuHasSceneButton(
  menuHeading: string,
  sceneLabel: string,
): Promise<boolean> {
  return browser.execute(
    (heading: string, label: string) => {
      const dialog = Array.from(
        document.querySelectorAll('[role="dialog"]'),
      ).find((d) =>
        Array.from(d.querySelectorAll("h2")).some((h) =>
          (h.textContent ?? "").includes(heading),
        ),
      );
      if (!dialog) return false;
      return Array.from(dialog.querySelectorAll("button")).some((b) =>
        (b.textContent ?? "").includes(label),
      );
    },
    menuHeading,
    sceneLabel,
  );
}

describe("Scene navigation prod eligibility gate", () => {
  it("hides Scene Select when the story has not been cleared", async () => {
    await resetE2eStorage();
    await startFromMenu();
    const menu = await openGameMenu();
    const present = await menuHasSceneButton(
      anchors.gameMenu,
      anchors.sceneSelect,
    );
    expect(present).toBe(false);
    // Keep reference so menu locator is exercised.
    await expect(menu).toExist();
  });

  it("shows Scene Select once the story has been cleared", async () => {
    await resetE2eStorage();
    await seedStoryCleared();
    await startFromMenu();
    await openGameMenu();
    await browser.waitUntil(
      async () => menuHasSceneButton(anchors.gameMenu, anchors.sceneSelect),
      { timeout: 10000, timeoutMsg: "Scene Select not shown after clearance" },
    );
  });
});
