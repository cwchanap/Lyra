import {
  advanceDialogueUntil,
  drainToInvestigationExplore,
  elementExists,
  jsClick,
  jsClickButtonContaining,
  openGameMenu,
  resetE2eStorage,
  startFromMenu,
} from "./helpers";
import { anchors } from "./production-anchors";

describe("App shell", () => {
  beforeEach(async () => {
    await resetE2eStorage();
  });

  it("advances dialogue into investigation controls", async () => {
    await drainToInvestigationExplore();
    const exists = await elementExists(
      `button[aria-label="${anchors.hotspotEvidence.label}"]`,
    );
    expect(exists).toBe(true);
  });

  it("opens the game menu with Escape during investigation", async () => {
    await drainToInvestigationExplore();
    const menu = await openGameMenu();
    const cont = await menu.$(`button*=${anchors.continueInvestigation}`);
    await expect(cont).toExist();
    await jsClickButtonContaining(anchors.continueInvestigation);
    await browser.waitUntil(
      async () => {
        return browser.execute((heading: string) => {
          return !Array.from(document.querySelectorAll('[role="dialog"]')).some(
            (d) =>
              Array.from(d.querySelectorAll("h2")).some((h) =>
                (h.textContent ?? "").includes(heading),
              ),
          );
        }, anchors.gameMenu);
      },
      { timeout: 10000, timeoutMsg: "game menu did not close" },
    );
  });

  it("keeps right-side portraits inside the viewport", async () => {
    await startFromMenu();
    await advanceDialogueUntil(async () => {
      return browser.execute(() => {
        const img = document.querySelector(
          "img.portrait",
        ) as HTMLImageElement | null;
        return !!img && img.offsetWidth > 0;
      });
    }, 80);
    const box = await browser.execute(() => {
      const img = document.querySelector(
        "img.portrait",
      ) as HTMLImageElement | null;
      if (!img) return null;
      const r = img.getBoundingClientRect();
      return {
        x: r.x,
        width: r.width,
        viewportWidth: window.innerWidth,
      };
    });
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-0.5);
    expect(box!.x + box!.width).toBeLessThanOrEqual(box!.viewportWidth + 0.5);
  });

  it("shows acquisition popup when collecting production evidence", async () => {
    await drainToInvestigationExplore();
    await jsClick(`button[aria-label="${anchors.hotspotEvidence.label}"]`);

    await browser.waitUntil(
      async () => {
        return browser.execute(
          (heading: string, name: string) => {
            const dialog = Array.from(
              document.querySelectorAll('[role="dialog"]'),
            ).find((d) =>
              Array.from(d.querySelectorAll("h2")).some((h) =>
                (h.textContent ?? "").includes(heading),
              ),
            );
            return !!dialog && (dialog.textContent ?? "").includes(name);
          },
          anchors.evidenceAcquired,
          anchors.evidenceName,
        );
      },
      { timeout: 15000, timeoutMsg: "acquisition popup missing evidence name" },
    );
    await jsClickButtonContaining("CONTINUE");

    // On-collect dialogue may play; drain until explore so the menu can open.
    await advanceDialogueUntil(async () => {
      const sub = await browser.execute((label: string) => {
        return Array.from(document.querySelectorAll("button")).some((b) =>
          (b.textContent ?? "").includes(label),
        );
      }, anchors.sublocationLabel);
      if (sub) return true;
      return elementExists(
        `button[aria-label="${anchors.hotspotEvidence.label}"]`,
      );
    }, 40);

    await openGameMenu();
    await jsClickButtonContaining(anchors.evidenceMenuEntry);
    await browser.waitUntil(
      async () => {
        return browser.execute(
          (heading: string, name: string) => {
            const dialog = Array.from(
              document.querySelectorAll('[role="dialog"]'),
            ).find((d) =>
              Array.from(d.querySelectorAll("h2")).some((h) =>
                (h.textContent ?? "").includes(heading),
              ),
            );
            return !!dialog && (dialog.textContent ?? "").includes(name);
          },
          anchors.evidenceFile,
          anchors.evidenceName,
        );
      },
      { timeout: 10000, timeoutMsg: "evidence file panel missing evidence" },
    );
  });
});
