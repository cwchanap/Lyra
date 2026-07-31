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

  it("collects and re-examines production evidence through the focused Case File menu", async () => {
    await browser.setWindowSize(1280, 720);
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

    const caseFileLayout = await browser.execute(() => {
      const menu = document.querySelector<HTMLElement>(
        ".game-menu-panel.case-file",
      );
      const layout = document.querySelector<HTMLElement>(".case-file-panel");
      const scrollOwner = document.querySelector<HTMLElement>(
        ".game-menu-panel.case-file .game-menu-extra",
      );
      const rail = layout?.children.item(0) as HTMLElement | null;
      const list = layout?.children.item(1) as HTMLElement | null;
      const detail = layout?.children.item(2) as HTMLElement | null;
      if (!menu || !layout || !scrollOwner || !rail || !list || !detail) {
        return null;
      }
      const menuRect = menu.getBoundingClientRect();
      const action = detail.querySelector<HTMLElement>("button:not(:disabled)");
      const actionRect = action?.getBoundingClientRect() ?? null;
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        menu: {
          left: menuRect.left,
          top: menuRect.top,
          right: menuRect.right,
          bottom: menuRect.bottom,
        },
        columns: getComputedStyle(layout)
          .gridTemplateColumns.split(" ")
          .filter(Boolean).length,
        directColumns: layout.children.length,
        railLeft: rail.getBoundingClientRect().left,
        listLeft: list.getBoundingClientRect().left,
        detailLeft: detail.getBoundingClientRect().left,
        scrollOwnerOverflowY: getComputedStyle(scrollOwner).overflowY,
        nestedScrollOwners: Array.from(
          layout.querySelectorAll<HTMLElement>("*"),
        ).filter((element) => {
          const overflowY = getComputedStyle(element).overflowY;
          return overflowY === "auto" || overflowY === "scroll";
        }).length,
        actionReachable:
          actionRect !== null &&
          actionRect.top >= menuRect.top &&
          actionRect.bottom <= menuRect.bottom,
      };
    });
    expect(caseFileLayout).not.toBeNull();
    // setWindowSize controls the native window rectangle; the webview's inner
    // viewport can be slightly smaller because of platform chrome.
    expect(caseFileLayout!.viewport.width).toBeGreaterThanOrEqual(1200);
    expect(caseFileLayout!.viewport.height).toBeGreaterThanOrEqual(650);
    expect(caseFileLayout!.menu.left).toBeGreaterThanOrEqual(-0.5);
    expect(caseFileLayout!.menu.top).toBeGreaterThanOrEqual(-0.5);
    expect(caseFileLayout!.menu.right).toBeLessThanOrEqual(
      caseFileLayout!.viewport.width + 0.5,
    );
    expect(caseFileLayout!.menu.bottom).toBeLessThanOrEqual(
      caseFileLayout!.viewport.height + 0.5,
    );
    expect(caseFileLayout!.columns).toBe(3);
    expect(caseFileLayout!.directColumns).toBe(3);
    expect(caseFileLayout!.railLeft).toBeLessThan(caseFileLayout!.listLeft);
    expect(caseFileLayout!.listLeft).toBeLessThan(caseFileLayout!.detailLeft);
    expect(caseFileLayout!.scrollOwnerOverflowY).toBe("auto");
    expect(caseFileLayout!.nestedScrollOwners).toBe(0);
    expect(caseFileLayout!.actionReachable).toBe(true);

    await browser.keys("Escape");
    await browser.waitUntil(
      async () => {
        return browser.execute(
          (heading: string, entry: string) => {
            const dialog = Array.from(
              document.querySelectorAll<HTMLElement>('[role="dialog"]'),
            ).find((candidate) =>
              Array.from(candidate.querySelectorAll("h2")).some((title) =>
                (title.textContent ?? "").includes(heading),
              ),
            );
            const active = document.activeElement;
            return (
              dialog !== undefined &&
              active instanceof HTMLButtonElement &&
              dialog.contains(active) &&
              (active.textContent ?? "").includes(entry)
            );
          },
          anchors.gameMenu,
          anchors.caseFileMenuEntry,
        );
      },
      {
        timeout: 10000,
        timeoutMsg:
          "Escape did not return one layer to the focused Case File menu entry",
      },
    );

    await jsClickButtonContaining(anchors.caseFileMenuEntry);
    await jsClickButtonContaining(anchors.caseFileEvidenceTab);
    await jsClickButtonContaining(anchors.evidenceName);
    await browser.waitUntil(
      async () => {
        return browser.execute((label: string) => {
          return Array.from(document.querySelectorAll("button")).some(
            (button) =>
              (button.textContent ?? "").includes(label) && !button.disabled,
          );
        }, anchors.caseFileReexamine);
      },
      {
        timeout: 10000,
        timeoutMsg: "production evidence did not expose enabled re-examination",
      },
    );
    await jsClickButtonContaining(anchors.caseFileReexamine);
    await browser.waitUntil(
      async () => {
        return browser.execute(
          (caseFileHeading: string, advance: string) => {
            const caseFileOpen = Array.from(
              document.querySelectorAll('[role="dialog"]'),
            ).some((dialog) =>
              Array.from(dialog.querySelectorAll("h2")).some((heading) =>
                (heading.textContent ?? "").includes(caseFileHeading),
              ),
            );
            const dialogueVisible = Array.from(
              document.querySelectorAll("button"),
            ).some((button) => (button.textContent ?? "").includes(advance));
            return !caseFileOpen && dialogueVisible;
          },
          anchors.caseFile,
          anchors.advanceDialogue,
        );
      },
      {
        timeout: 10000,
        timeoutMsg:
          "Case File re-examination did not close the menu and enter dialogue",
      },
    );
  });
});
