import {
  advanceDialogueUntil,
  completeP1PracticeTutorial,
  collectKagamiSummaryEvidence,
  elementExists,
  lastVisibleDialogueText,
  resetE2eStorage,
  startFromMenu,
  waitForButton,
} from "./helpers";
import { anchors, DIALOGUE_DRAIN_CAP } from "./production-anchors";

describe("fresh production journey", () => {
  it("completes the P1 tutorial before real KAGAMI acquisition in investigation", async () => {
    await resetE2eStorage();
    expect(await elementExists(`[aria-label="${anchors.mainMenu}"]`)).toBe(
      true,
    );

    await startFromMenu();
    expect(await lastVisibleDialogueText()).not.toBe("");

    const hotspot = `button[aria-label="${anchors.hotspotEvidence.label}"]`;
    await completeP1PracticeTutorial();
    await advanceDialogueUntil(
      () => elementExists(hotspot),
      DIALOGUE_DRAIN_CAP,
    );
    await waitForButton(anchors.hotspotEvidence.label, 90000);
    await collectKagamiSummaryEvidence();

    expect(await elementExists(hotspot)).toBe(true);
    expect(
      await browser.execute(
        (selector: string) =>
          document.querySelector(selector)?.classList.contains("inspected"),
        hotspot,
      ),
    ).toBe(true);
  });
});
