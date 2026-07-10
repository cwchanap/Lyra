import { expect, test, type Page } from "@playwright/test";

type MockWindow = Window & {
  __TAURI_INTERNALS__?: {
    invoke: (
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<unknown>;
    transformCallback: () => number;
    unregisterCallback: () => void;
  };
  __LYRA_E2E_FAIL_NEXT_INSPECT__?: boolean;
};

const shouldRegisterPlaywrightSuite = !("Bun" in globalThis);

// Intentionally duplicated from $lib/test-utils.ts (reportAsyncTestFailure):
// Playwright e2e specs run against the built static SPA and cannot import
// the app's $lib tree. Keep this byte-for-byte in sync with the lib helper;
// do NOT "DRY" it by importing across the boundary.
function reportTestFailure(testName: string, error: unknown): never {
  throw new Error(`${testName} failed`, { cause: error });
}

async function installTauriMock(page: Page) {
  await page.addInitScript(() => {
    const win = window as MockWindow;
    const chapter = {
      id: "chapter_1",
      title: "測試章節",
      summary: "測試摘要",
      index: 0,
      total: 1,
    };
    const inventory = {
      evidence: [],
      statements: [],
    };
    const scene = {
      kind: "investigation",
      id: "investigation_scene_1",
      title: "測試調查場景",
      index: 0,
      total: 1,
      currentSublocationId: "main_hall",
      visibleSublocations: [
        {
          id: "main_hall",
          label: "主廳",
          sceneTag: "測試主廳，明亮。",
          hotspots: [
            {
              id: "table",
              label: "桌子",
              description: "一張木桌，桌上有一杯咖啡。",
              inspected: false,
              layout: null,
            },
          ],
          characters: [
            {
              id: "witness",
              name: "證人",
              role: "證人",
              bio: "案發時在現場的證人。",
              layout: null,
              topics: [
                {
                  id: "timeline",
                  label: "案發時間",
                  discussed: false,
                },
              ],
            },
          ],
        },
      ],
    };

    const introView = {
      chapter,
      inventory,
      scene: {
        kind: "linear",
        id: "scene_0",
        title: "測試線性場景",
        index: 0,
        total: 1,
      },
      mode: {
        type: "dialogue",
        current: {
          kind: "line",
          speaker: "早坂茜",
          text: "測試開始。",
          portrait: {
            characterId: "hayasaka_akane",
            expression: "standard",
            assetId: "portrait.hayasaka_akane.standard",
          },
        },
        queueRemaining: 0,
        sceneTag: "測試場景前廳，深夜。",
        queueToken: { sceneId: "scene_0", queueGen: 1, cursor: 0 },
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
      },
    };
    const exploreView = {
      chapter,
      inventory,
      scene,
      mode: {
        type: "explore",
        sublocationId: "main_hall",
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
      },
    };
    const inspectedView = {
      chapter,
      inventory: {
        evidence: [
          {
            id: "coffee",
            name: "還熱的咖啡",
            description: "一杯仍微熱的咖啡。",
            details: "杯壁溫度約 50°C。",
            imageAssetId: null,
            onReexamine: null,
            collectedInChapterId: "chapter_1",
            collectedInSceneId: "investigation_scene_1",
          },
        ],
        statements: [
          {
            id: "witness_timeline",
            speaker: "證人",
            content: "我在十一點前看見桌上的咖啡仍冒著熱氣。",
            onReexamine: null,
            acquiredInChapterId: "chapter_1",
            acquiredInSceneId: "investigation_scene_1",
          },
        ],
      },
      scene: {
        ...scene,
        visibleSublocations: [
          {
            ...scene.visibleSublocations[0],
            hotspots: [
              { ...scene.visibleSublocations[0].hotspots[0], inspected: true },
            ],
          },
        ],
      },
      mode: {
        type: "dialogue",
        current: { kind: "line", speaker: "相馬律", text: "還是熱的。" },
        queueRemaining: 0,
        sceneTag: "測試主廳，明亮。",
        queueToken: {
          sceneId: "investigation_scene_1",
          queueGen: 2,
          cursor: 0,
        },
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
      },
    };

    win.__TAURI_INTERNALS__ = {
      invoke: async (command) => {
        if (command === "start_game" || command === "reset_game")
          return introView;
        if (command === "advance_dialogue") return exploreView;
        if (command === "inspect_hotspot") {
          if (win.__LYRA_E2E_FAIL_NEXT_INSPECT__) {
            win.__LYRA_E2E_FAIL_NEXT_INSPECT__ = false;
            throw {
              code: "lockedHotspot",
              message: "Hotspot 'table' is locked.",
            };
          }
          return inspectedView;
        }
        if (command === "interview_topic") {
          return {
            ...exploreView,
            scene: {
              ...scene,
              visibleSublocations: [
                {
                  ...scene.visibleSublocations[0],
                  characters: [
                    {
                      ...scene.visibleSublocations[0].characters[0],
                      topics: [
                        {
                          ...scene.visibleSublocations[0].characters[0]
                            .topics[0],
                          discussed: true,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          };
        }
        if (command === "plugin:window|is_fullscreen") return false;
        if (command === "plugin:window|set_fullscreen") return null;
        return exploreView;
      },
      transformCallback: () => 0,
      unregisterCallback: () => {},
    };
  });
}

if (shouldRegisterPlaywrightSuite) {
  test.describe("App shell", () => {
    test.beforeEach(async ({ page }) => {
      await installTauriMock(page);
    });

    async function startFromMenu(page: Page) {
      await page.goto("/");
      await expect(page).toHaveTitle(/東京雨證/);
      await page.getByRole("button", { name: /開始調查/ }).click();
    }

    async function advanceDialogue(page: Page) {
      // DialogueBox reveals the current line over up to 1500ms via a JS
      // typewriter. A click while the reveal is still running completes the
      // text instead of advancing (handleClick -> completeTextRevealIfNeeded
      // returns early), so a single immediate click would not advance. Wait
      // for the full intro line to be shown first; getByText only matches
      // once the .text-line element contains the complete string, which
      // implies the typewriter has finished and the next click advances.
      await expect(page.getByText("測試開始。")).toBeVisible();
      const advanceButton = page.getByRole("button", { name: "推進對話" });
      await expect(advanceButton).toBeEnabled();
      await advanceButton.click();
    }

    test("advances dialogue into investigation controls", async ({ page }) => {
      await startFromMenu(page);
      await expect(page.getByText("測試開始。")).toBeVisible();

      await advanceDialogue(page);

      await expect(page.getByRole("button", { name: "主廳" })).toBeVisible();
      await expect(page.getByRole("button", { name: /桌子/ })).toBeVisible();
      await expect(
        page.getByRole("button", { name: /案發時間/ }),
      ).toBeVisible();
    });

    test("opens the game menu with Escape during investigation", async ({
      page,
    }) => {
      const testName = "opens the game menu with Escape during investigation";

      try {
        await startFromMenu(page);
        await advanceDialogue(page);

        await expect(
          page.getByRole("button", { name: /EVIDENCE/ }),
        ).toHaveCount(0);

        await page.keyboard.press("Escape");

        const gameMenu = page.getByRole("dialog", { name: "遊戲選單" });
        await expect(gameMenu).toBeVisible();
        await expect(
          gameMenu.getByRole("button", { name: /繼續調查/ }),
        ).toBeFocused();
        await expect(
          gameMenu.getByRole("button", { name: /EVIDENCE/ }),
        ).toBeVisible();

        await gameMenu.getByRole("button", { name: /繼續調查/ }).click();

        await expect(gameMenu).toBeHidden();
        await expect(page.getByRole("button", { name: /桌子/ })).toBeVisible();
      } catch (error) {
        reportTestFailure(testName, error);
      }
    });

    test("keeps right-side portraits inside the viewport", async ({ page }) => {
      await startFromMenu(page);

      const portrait = page.locator("img.portrait");
      await expect(portrait).toHaveAttribute("data-placement", "right");
      await expect(portrait).toBeVisible();

      const box = await portrait.boundingBox();
      const viewport = page.viewportSize();
      expect(box).not.toBeNull();
      expect(viewport).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 0.5);
    });

    test("shows sequential acquisition popups before dialogue and inventory", async ({
      page,
    }) => {
      await startFromMenu(page);
      await advanceDialogue(page);
      await page.getByRole("button", { name: /桌子/ }).click();

      const evidencePopup = page.getByRole("dialog", { name: "物證取得" });
      await expect(evidencePopup).toBeVisible();
      await expect(evidencePopup.getByText("還熱的咖啡")).toBeVisible();
      await expect(
        evidencePopup.getByRole("button", { name: "CONTINUE / 繼續" }),
      ).toBeFocused();

      await page.keyboard.press("Enter");

      const statementPopup = page.getByRole("dialog", { name: "證言取得" });
      await expect(statementPopup).toBeVisible();
      await expect(statementPopup.getByText("證人")).toBeVisible();
      await expect(statementPopup).toContainText(
        "我在十一點前看見桌上的咖啡仍冒著熱氣。",
      );
      await expect(page.getByRole("dialog", { name: "遊戲選單" })).toHaveCount(
        0,
      );

      await page.keyboard.press("Escape");

      await expect(statementPopup).toBeHidden();
      await expect(page.getByRole("dialog", { name: "遊戲選單" })).toHaveCount(
        0,
      );
      await expect(page.getByText("還是熱的。")).toBeVisible();

      await page.keyboard.press("Escape");
      const gameMenu = page.getByRole("dialog", { name: "遊戲選單" });
      await expect(gameMenu).toBeVisible();
      await gameMenu.getByRole("button", { name: /物證/ }).click();

      const evidenceMenu = page.getByRole("dialog", { name: "物證檔案" });
      await expect(evidenceMenu.getByText("還熱的咖啡")).toBeVisible();
      await expect(evidenceMenu.getByText("證人")).toBeVisible();
    });

    test("surfaces command errors in the banner", async ({ page }) => {
      await startFromMenu(page);
      await advanceDialogue(page);
      await page.evaluate(() => {
        (window as MockWindow).__LYRA_E2E_FAIL_NEXT_INSPECT__ = true;
      });
      await page.getByRole("button", { name: /桌子/ }).click();

      await expect(page.getByRole("alert")).toContainText(
        "Hotspot 'table' is locked.",
      );
      await expect(page.getByRole("dialog", { name: /取得/ })).toHaveCount(0);
    });
  });
}
