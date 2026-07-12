import {
  openGameMenu,
  resetE2eStorage,
  seedStoryCleared,
  startFromMenu,
} from "./helpers";
import { anchors } from "./production-anchors";

describe("Scene navigation prod eligibility gate", () => {
  it("hides Scene Select when the story has not been cleared", async () => {
    await resetE2eStorage();
    await startFromMenu();
    const menu = await openGameMenu();
    const present = await browser.execute(
      (menuHeading: string, sceneLabel: string) => {
        const dialog = Array.from(
          document.querySelectorAll('[role="dialog"]'),
        ).find((d) =>
          Array.from(d.querySelectorAll("h2")).some((h) =>
            (h.textContent ?? "").includes(menuHeading),
          ),
        );
        if (!dialog) return null;
        return Array.from(dialog.querySelectorAll("button")).some((b) =>
          (b.textContent ?? "").includes(sceneLabel),
        );
      },
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
      async () => {
        return browser.execute(
          (menuHeading: string, sceneLabel: string) => {
            const dialog = Array.from(
              document.querySelectorAll('[role="dialog"]'),
            ).find((d) =>
              Array.from(d.querySelectorAll("h2")).some((h) =>
                (h.textContent ?? "").includes(menuHeading),
              ),
            );
            if (!dialog) return false;
            return Array.from(dialog.querySelectorAll("button")).some((b) =>
              (b.textContent ?? "").includes(sceneLabel),
            );
          },
          anchors.gameMenu,
          anchors.sceneSelect,
        );
      },
      { timeout: 10000, timeoutMsg: "Scene Select not shown after clearance" },
    );
  });
});
