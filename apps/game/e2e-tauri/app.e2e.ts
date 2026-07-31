import {
  advanceDialogueUntil,
  collectKagamiSummaryEvidence,
  drainToInvestigationExplore,
  elementExists,
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
    await openGameMenu();
    const hasContinue = await browser.execute(
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
      anchors.gameMenu,
      anchors.continueInvestigation,
    );
    expect(hasContinue).toBe(true);
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
          'img.portrait[data-placement="right"]',
        ) as HTMLImageElement | null;
        return !!img && img.offsetWidth > 0;
      });
    }, 80);
    const box = await browser.execute(() => {
      const img = document.querySelector(
        'img.portrait[data-placement="right"]',
      ) as HTMLImageElement | null;
      if (!img) return null;
      const r = img.getBoundingClientRect();
      return {
        placement: img.getAttribute("data-placement"),
        x: r.x,
        width: r.width,
        viewportWidth: window.innerWidth,
      };
    });
    expect(box).not.toBeNull();
    expect(box!.placement).toBe("right");
    expect(box!.x).toBeGreaterThanOrEqual(-0.5);
    expect(box!.x + box!.width).toBeLessThanOrEqual(box!.viewportWidth + 0.5);
  });

  it("shows acquisition popup when collecting production evidence", async () => {
    await drainToInvestigationExplore();
    // collectKagamiSummaryEvidence drains the authored on_collect dialogue
    // queue before expecting the deferred 物證取得 popup, then dismisses it
    // and drains residual dialogue back to explore. The popup is buffered
    // while the on_collect queue plays (game-client.svelte.ts defers it), so
    // a direct wait after the hotspot click would time out.
    await collectKagamiSummaryEvidence();

    await openGameMenu();
    await jsClickButtonContaining(anchors.caseFileMenuEntry);
    await jsClickButtonContaining(anchors.caseFileEvidenceTab);
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
          anchors.caseFile,
          anchors.evidenceName,
        );
      },
      { timeout: 10000, timeoutMsg: "evidence file panel missing evidence" },
    );
  });
});
