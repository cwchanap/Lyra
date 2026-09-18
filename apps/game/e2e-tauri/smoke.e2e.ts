import {
  analysisBoard,
  closePersistenceBrowserToGameplay,
  continueFromTitle,
  dragAnalysisCardSynthetic,
  elementExists,
  ensureCaseFileViewport,
  getPackagedGameState,
  loadPackagedCheckpoint,
  resetE2eStorage,
  returnToTitle,
  saveManualSlot,
  settlePackagedCommand,
  startFromMenu,
  waitForAnalysisBoard,
  waitForClassifyDraft,
} from "./helpers";
import { anchors } from "./production-anchors";

const ANALYSIS_SCENE_ID = "analysis_scene_8_5";

async function cleanTitleState() {
  return browser.execute((mainMenuLabel: string) => {
    const button = (label: string) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (candidate) => candidate.getAttribute("aria-label") === label,
      ) ?? null;
    const continueButton = button("繼續遊戲");
    const loadButton = button("載入遊戲");
    const newGameButton = button("開始新遊戲");
    return {
      titleVisible:
        document.querySelector(`[aria-label="${mainMenuLabel}"]`) !== null,
      hasContinueRecap:
        document.querySelector('[aria-label="繼續遊戲摘要"]') !== null,
      continueDisabled: continueButton?.disabled ?? false,
      loadDisabled: loadButton?.disabled ?? false,
      newGameEnabled: newGameButton !== null && !newGameButton.disabled,
    };
  }, anchors.mainMenu);
}

describe("packaged smoke", () => {
  beforeEach(async () => {
    await resetE2eStorage();
  });

  it("renders a clean no-save title state", async () => {
    await browser.waitUntil(
      async () => {
        const title = await cleanTitleState();
        return (
          title.titleVisible &&
          !title.hasContinueRecap &&
          title.continueDisabled &&
          title.loadDisabled &&
          title.newGameEnabled
        );
      },
      {
        timeout: 30000,
        timeoutMsg: "clean title state did not settle",
      },
    );

    const title = await cleanTitleState();
    expect(title).toEqual({
      titleVisible: true,
      hasContinueRecap: false,
      continueDisabled: true,
      loadDisabled: true,
      newGameEnabled: true,
    });
  });

  it("returns the typed not-started error before New Game", async () => {
    const beforeStart = await settlePackagedCommand("get_state");
    expect(beforeStart).toEqual({
      ok: false,
      error: {
        code: "gameNotStarted",
        message: "Call start_game first.",
      },
    });
  });

  it("enters real dialogue after New Game", async () => {
    await startFromMenu();
    expect(await elementExists("[data-gameplay-root]")).toBe(true);
    expect((await getPackagedGameState()).mode.type).toBe("dialogue");
  });

  it("restores a semantic Analysis draft across save and continue", async () => {
    await ensureCaseFileViewport();
    await loadPackagedCheckpoint("chapter-1-analysis-beat-85-ready");

    await waitForAnalysisBoard(ANALYSIS_SCENE_ID, "evidence_packages");
    await dragAnalysisCardSynthetic(
      "miyake_call",
      "classify:group:miyake_small_lies",
    );
    const expectedDraft = { miyake_call: "miyake_small_lies" };
    await waitForClassifyDraft(expectedDraft);

    await saveManualSlot(1, "Beat 8.5 分類部分草稿");
    await closePersistenceBrowserToGameplay();
    await returnToTitle();
    await continueFromTitle();

    const resumed = await waitForAnalysisBoard(
      ANALYSIS_SCENE_ID,
      "evidence_packages",
    );
    const restored = analysisBoard(resumed, "evidence_packages");
    if (restored.kind !== "classify" || restored.draft.kind !== "classify") {
      throw new Error("Continue did not restore the Classify draft");
    }
    expect(restored.draft.groupByCard).toEqual(expectedDraft);

    // One further production interaction proves the resumed board is still
    // interactive rather than a read-only restore.
    await dragAnalysisCardSynthetic(
      "miyake_pov_replay",
      "classify:group:earlier_third_party",
    );
    await waitForClassifyDraft({
      ...expectedDraft,
      miyake_pov_replay: "earlier_third_party",
    });
  });
});
