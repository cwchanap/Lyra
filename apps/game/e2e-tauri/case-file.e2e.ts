import {
  dismissAllPendingAcquisitions,
  ensureCaseFileViewport,
  jsClickButtonContaining,
  loadPackagedCheckpoint,
  openGameMenu,
  resetE2eStorage,
} from "./helpers";
import { anchors } from "./production-anchors";
import { CASE_FILE_PREFERRED_VIEWPORT } from "../src/lib/e2e/case-file-viewport";

describe("Case File packaged flow", () => {
  beforeEach(async () => {
    await resetE2eStorage();
  });

  it("re-examines acquired production evidence through the focused menu", async () => {
    await ensureCaseFileViewport();
    await loadPackagedCheckpoint("chapter-1-investigation-with-kagami-summary");
    await dismissAllPendingAcquisitions({ cap: 1 });

    await openGameMenu();
    await jsClickButtonContaining(anchors.caseFileMenuEntry);
    await jsClickButtonContaining(anchors.caseFileEvidenceTab);
    await browser.waitUntil(
      async () =>
        browser.execute(
          (heading: string, name: string) => {
            const dialog = Array.from(
              document.querySelectorAll('[role="dialog"]'),
            ).find((candidate) =>
              Array.from(candidate.querySelectorAll("h2")).some((title) =>
                (title.textContent ?? "").includes(heading),
              ),
            );
            return !!dialog && (dialog.textContent ?? "").includes(name);
          },
          anchors.caseFile,
          anchors.evidenceName,
        ),
      { timeout: 10000, timeoutMsg: "evidence file panel missing evidence" },
    );

    const actionFocused = await browser.execute(() => {
      const detail = document.querySelector<HTMLElement>(".case-file-detail");
      const action = detail?.querySelector<HTMLButtonElement>(
        "button:not(:disabled)",
      );
      if (!action) return false;
      action.focus();
      return document.activeElement === action;
    });
    expect(actionFocused).toBe(true);

    const layout = await browser.execute(() => {
      const menu = document.querySelector<HTMLElement>(
        ".game-menu-panel.case-file",
      );
      const panel = document.querySelector<HTMLElement>(".case-file-panel");
      const scrollOwner = document.querySelector<HTMLElement>(
        ".game-menu-panel.case-file .game-menu-extra",
      );
      const rail = panel?.children.item(0) as HTMLElement | null;
      const list = panel?.children.item(1) as HTMLElement | null;
      const detail = panel?.children.item(2) as HTMLElement | null;
      if (!menu || !panel || !scrollOwner || !rail || !list || !detail) {
        return null;
      }
      const menuBounds = menu.getBoundingClientRect();
      const action = detail.querySelector<HTMLElement>("button:not(:disabled)");
      const actionBounds = action?.getBoundingClientRect() ?? null;
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        menu: {
          left: menuBounds.left,
          top: menuBounds.top,
          right: menuBounds.right,
          bottom: menuBounds.bottom,
        },
        columns: getComputedStyle(panel)
          .gridTemplateColumns.split(/ (?![^()]*\))/)
          .filter(Boolean).length,
        directColumns: panel.children.length,
        railLeft: rail.getBoundingClientRect().left,
        listLeft: list.getBoundingClientRect().left,
        detailLeft: detail.getBoundingClientRect().left,
        scrollOwnerOverflowY: getComputedStyle(scrollOwner).overflowY,
        nestedScrollOwners: Array.from(
          panel.querySelectorAll<HTMLElement>("*"),
        ).filter((element) => {
          const overflowY = getComputedStyle(element).overflowY;
          return overflowY === "auto" || overflowY === "scroll";
        }).length,
        actionReachable:
          actionBounds !== null &&
          actionBounds.top >= menuBounds.top &&
          actionBounds.bottom <= menuBounds.bottom,
      };
    });
    expect(layout).not.toBeNull();
    expect(layout!.viewport.width).toBeGreaterThanOrEqual(
      CASE_FILE_PREFERRED_VIEWPORT.width,
    );
    expect(layout!.viewport.height).toBeGreaterThanOrEqual(
      CASE_FILE_PREFERRED_VIEWPORT.height,
    );
    expect(layout!.menu.left).toBeGreaterThanOrEqual(-0.5);
    expect(layout!.menu.top).toBeGreaterThanOrEqual(-0.5);
    expect(layout!.menu.right).toBeLessThanOrEqual(
      layout!.viewport.width + 0.5,
    );
    expect(layout!.menu.bottom).toBeLessThanOrEqual(
      layout!.viewport.height + 0.5,
    );
    expect(layout!.columns).toBe(3);
    expect(layout!.directColumns).toBe(3);
    expect(layout!.railLeft).toBeLessThan(layout!.listLeft);
    expect(layout!.listLeft).toBeLessThan(layout!.detailLeft);
    expect(layout!.scrollOwnerOverflowY).toBe("auto");
    expect(layout!.nestedScrollOwners).toBe(0);
    expect(layout!.actionReachable).toBe(true);

    await browser.keys("Escape");
    await browser.waitUntil(
      async () =>
        browser.execute(
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
        ),
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
      async () =>
        browser.execute((label: string) => {
          return Array.from(document.querySelectorAll("button")).some(
            (button) =>
              (button.textContent ?? "").includes(label) && !button.disabled,
          );
        }, anchors.caseFileReexamine),
      {
        timeout: 10000,
        timeoutMsg: "production evidence did not expose enabled re-examination",
      },
    );
    await jsClickButtonContaining(anchors.caseFileReexamine);
    await browser.waitUntil(
      async () =>
        browser.execute(
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
        ),
      {
        timeout: 10000,
        timeoutMsg:
          "Case File re-examination did not close the menu and enter dialogue",
      },
    );
  });
});
