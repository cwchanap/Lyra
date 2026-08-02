import {
  elementExists,
  getPackagedGameState,
  resetE2eStorage,
  settlePackagedCommand,
  startFromMenu,
} from "./helpers";

async function cleanTitleState() {
  return browser.execute(() => {
    const button = (label: string) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (candidate) => candidate.getAttribute("aria-label") === label,
      ) ?? null;
    const continueButton = button("繼續遊戲");
    const loadButton = button("載入遊戲");
    const newGameButton = button("開始新遊戲");
    return {
      titleVisible: document.querySelector('[aria-label="主選單"]') !== null,
      hasContinueRecap:
        document.querySelector('[aria-label="繼續遊戲摘要"]') !== null,
      continueDisabled: continueButton?.disabled ?? false,
      loadDisabled: loadButton?.disabled ?? false,
      newGameEnabled: newGameButton !== null && !newGameButton.disabled,
    };
  });
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
});
