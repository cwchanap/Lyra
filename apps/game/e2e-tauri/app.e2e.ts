import {
  jsClickButtonContaining,
  loadPackagedCheckpoint,
  openGameMenu,
  resetE2eStorage,
} from "./helpers";
import { anchors } from "./production-anchors";

describe("App shell", () => {
  beforeEach(async () => {
    await resetE2eStorage();
  });

  it("opens the game menu with Escape during investigation", async () => {
    await loadPackagedCheckpoint("chapter-1-investigation-explore");
    await openGameMenu();
    const hasContinue = await browser.execute(
      (heading: string, label: string) => {
        const dialog = Array.from(
          document.querySelectorAll('[role="dialog"]'),
        ).find((candidate) =>
          Array.from(candidate.querySelectorAll("h2")).some((title) =>
            (title.textContent ?? "").includes(heading),
          ),
        );
        return (
          dialog !== undefined &&
          Array.from(dialog.querySelectorAll("button")).some((button) =>
            (button.textContent ?? "").includes(label),
          )
        );
      },
      anchors.gameMenu,
      anchors.continueInvestigation,
    );
    expect(hasContinue).toBe(true);
    await jsClickButtonContaining(anchors.continueInvestigation);
  });

  it("keeps right-side portraits inside the viewport", async () => {
    await loadPackagedCheckpoint("chapter-1-right-portrait-dialogue");
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const image = document.querySelector<HTMLImageElement>(
            'img.portrait[data-placement="right"]',
          );
          return image !== null && image.offsetWidth > 0;
        }),
      { timeout: 15000, timeoutMsg: "right-side portrait did not render" },
    );
    const box = await browser.execute(() => {
      const image = document.querySelector<HTMLImageElement>(
        'img.portrait[data-placement="right"]',
      );
      if (!image) return null;
      const bounds = image.getBoundingClientRect();
      return {
        placement: image.getAttribute("data-placement"),
        x: bounds.x,
        width: bounds.width,
        viewportWidth: window.innerWidth,
      };
    });
    expect(box).not.toBeNull();
    expect(box!.placement).toBe("right");
    expect(box!.x).toBeGreaterThanOrEqual(-0.5);
    expect(box!.x + box!.width).toBeLessThanOrEqual(box!.viewportWidth + 0.5);
  });
});
