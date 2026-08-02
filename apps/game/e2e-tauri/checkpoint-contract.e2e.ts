import {
  elementExists,
  loadPackagedCheckpoint,
  openGameMenu,
  resetE2eStorage,
} from "./helpers";
import { anchors } from "./production-anchors";

async function gameMenuHas(label: string): Promise<boolean> {
  return browser.execute(
    (heading: string, expectedLabel: string) => {
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
          (button.textContent ?? "").includes(expectedLabel),
        )
      );
    },
    anchors.gameMenu,
    label,
  );
}

describe("packaged checkpoint contract", () => {
  beforeEach(async () => {
    await resetE2eStorage();
  });

  it("renders the right-portrait dialogue checkpoint", async () => {
    await loadPackagedCheckpoint("chapter-1-right-portrait-dialogue");
    await browser.waitUntil(
      async () => elementExists('img.portrait[data-placement="right"]'),
      {
        timeout: 15000,
        timeoutMsg: "right portrait checkpoint did not render",
      },
    );
    expect(await elementExists('button[aria-label="推進對話"]')).toBe(true);
  });

  it("renders the investigation explore checkpoint", async () => {
    await loadPackagedCheckpoint("chapter-1-investigation-explore");
    expect(
      await elementExists(
        `button[aria-label="${anchors.hotspotEvidence.label}"]`,
      ),
    ).toBe(true);
    expect(
      await elementExists(`button[aria-label="${anchors.character.label}"]`),
    ).toBe(true);
  });

  it("renders the KAGAMI acquisition projected by its checkpoint", async () => {
    await loadPackagedCheckpoint("chapter-1-investigation-with-kagami-summary");
    await browser.waitUntil(
      async () =>
        browser.execute((evidenceName: string) => {
          const card = document.querySelector(".acquisition-card");
          return (
            card !== null && (card.textContent ?? "").includes(evidenceName)
          );
        }, anchors.evidenceName),
      {
        timeout: 15000,
        timeoutMsg: "KAGAMI checkpoint acquisition did not render",
      },
    );
  });

  it("keeps scene navigation locked for the locked checkpoint", async () => {
    await loadPackagedCheckpoint("chapter-1-scene-navigation-locked");
    await openGameMenu();
    expect(await gameMenuHas(anchors.sceneSelect)).toBe(false);
  });

  it("enables scene navigation through the eligible projection", async () => {
    await loadPackagedCheckpoint("chapter-1-scene-navigation-eligible");
    await openGameMenu();
    await browser.waitUntil(async () => gameMenuHas(anchors.sceneSelect), {
      timeout: 10000,
      timeoutMsg: "eligible checkpoint did not enable Scene Select",
    });
  });
});
