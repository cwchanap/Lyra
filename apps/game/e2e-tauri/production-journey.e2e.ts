import {
  advanceDialogueUntil,
  clickButton,
  clickSoleMapDestination,
  collectKagamiSummaryEvidence,
  completeP1PracticeTutorial,
  elementExists,
  enabledMapDestinationIds,
  getPackagedGameState,
  jumpToProductionScene,
  lastVisibleDialogueText,
  resetE2eStorage,
  seedStoryCleared,
  startFromMenu,
  waitForButton,
  waitForPackagedGameState,
} from "./helpers";
import { anchors, DIALOGUE_DRAIN_CAP } from "./production-anchors";
import type { GameStateView } from "$lib/state/types";

/** Explore parked on a mapped wrapper's city map (HPA-601 §7 pending map). */
function isPendingMapGate(state: GameStateView, wrapper: string): boolean {
  return (
    state.mode.type === "explore" &&
    state.scene.kind === "investigation" &&
    state.scene.id === wrapper &&
    state.scene.currentSublocationId === null &&
    state.scene.map !== null
  );
}

/**
 * A gate must advance exactly once: the successor scene is active with its
 * entry queue playing, and the city map is gone (no lingering Explore).
 */
async function expectCrossedToSuccessor(nextSceneId: string): Promise<void> {
  // Gate successors span all three scene kinds (linear, investigation,
  // interrogation); only the id is common, so assert on it alone.
  await waitForPackagedGameState(
    (state) => state.scene.id === nextSceneId,
    30000,
    `city-map gate did not advance into ${nextSceneId}`,
  );
  const state = await getPackagedGameState();
  expect(state.mode.type).toBe("dialogue");
  expect(await elementExists(anchors.cityMapSelector)).toBe(false);
}

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

    // Finish investigation_scene_1's remaining plain hotspots, then discuss
    // the commission topic. The authored outro unlock is "kagami_summary
    // collected + commission discussed", and the evidence is already in the
    // inventory, so the interview exhausts into the scene outro, scene_2, and
    // the first map wrapper's pending map in one automatic chain.
    for (const label of anchors.firstInvestigationHotspots) {
      await waitForButton(label, 90000);
      await clickButton(label);
      // Drain until the hotspot itself reports inspected: at click time the
      // explore surface is still mounted, so character-button presence is not
      // a race-free transition signal.
      await advanceDialogueUntil(
        () =>
          browser.execute((name: string) => {
            const button = Array.from(
              document.querySelectorAll<HTMLButtonElement>("button"),
            ).find(
              (candidate) => candidate.getAttribute("aria-label") === name,
            );
            return (
              button?.classList.contains("inspected") === true ||
              button?.classList.contains("done") === true
            );
          }, label),
        40,
      );
    }
    await waitForButton(anchors.character.label, 90000);
    await clickButton(anchors.character.label);
    await clickButton(anchors.firstTopic);
    // The outro chains automatically; the city map renders once the pending
    // map parks. Predicate-first ordering keeps the drain from clicking the
    // destination pin — the explicit crossing below owns that step.
    await advanceDialogueUntil(
      () => elementExists(anchors.cityMapSelector),
      DIALOGUE_DRAIN_CAP,
    );

    // The organic Chapter 1 route parks on the first city-map gate.
    await waitForPackagedGameState(
      (state) => isPendingMapGate(state, anchors.firstMapWrapper),
      30000,
      "the organic route did not park on the first pending city map",
    );
    expect(await enabledMapDestinationIds()).toEqual([
      anchors.firstMapDestination,
    ]);

    // Cross it through the generic map-aware drain — no explicit click here.
    await advanceDialogueUntil(
      async () =>
        (await getPackagedGameState()).scene.id === anchors.firstGateSuccessor,
      DIALOGUE_DRAIN_CAP,
    );
    await expectCrossedToSuccessor(anchors.firstGateSuccessor);
  });

  it("crosses every remaining city-map gate through its sole destination", async () => {
    await resetE2eStorage();
    await seedStoryCleared();
    await startFromMenu();

    for (const gate of anchors.mapGates.slice(1)) {
      await jumpToProductionScene(gate.wrapper);
      await waitForPackagedGameState(
        (state) => isPendingMapGate(state, gate.wrapper),
        30000,
        `${gate.wrapper} did not park on its pending city map`,
      );

      // Each wrapper exposes exactly its authored destination, enabled.
      expect(await enabledMapDestinationIds()).toEqual([gate.destination]);

      // The generic map-aware drain clicks the sole destination and lands in
      // the successor's entry queue — exactly one scene advance.
      await advanceDialogueUntil(
        async () => (await getPackagedGameState()).scene.id === gate.next,
        40,
      );
      await expectCrossedToSuccessor(gate.next);
    }
  });

  it("keeps the drain deterministic when several destinations are enabled", async () => {
    // Guard the pure seam directly: the DOM drain must fail rather than guess.
    // clickSoleMapDestination only reads enabled pins, so a synthetic two-pin
    // DOM proves the deterministic error surfaces through the drain path.
    await resetE2eStorage();
    await seedStoryCleared();
    await startFromMenu();
    await jumpToProductionScene(anchors.firstMapWrapper);
    await waitForPackagedGameState(
      (state) => isPendingMapGate(state, anchors.firstMapWrapper),
      30000,
      "first map wrapper did not park on the pending city map",
    );
    await browser.execute((sectionSelector: string) => {
      const section = document.querySelector(sectionSelector);
      const original = section?.querySelector<HTMLButtonElement>(
        "[data-map-destination]",
      );
      if (!original) throw new Error("map destination pin is missing");
      const clone = original.cloneNode(true) as HTMLButtonElement;
      clone.setAttribute("data-map-destination", "e2e_second_pin");
      section?.querySelector(".map-plane")?.appendChild(clone);
    }, anchors.cityMapSelector);
    await expect(clickSoleMapDestination()).rejects.toThrow(
      /expected at most one enabled map destination.*e2e_second_pin/s,
    );
  });
});
