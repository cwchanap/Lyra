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
        statements: [],
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
      await startFromMenu(page);
      await advanceDialogue(page);

      await expect(page.getByRole("button", { name: /EVIDENCE/ })).toHaveCount(
        0,
      );

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

    test("inspects a hotspot and shows inventory", async ({ page }) => {
      await startFromMenu(page);
      await advanceDialogue(page);
      await page.getByRole("button", { name: /桌子/ }).click();

      await expect(page.getByText("還是熱的。")).toBeVisible();
      await expect(page.getByRole("button", { name: /EVIDENCE/ })).toHaveCount(
        0,
      );

      await page.keyboard.press("Escape");
      const gameMenu = page.getByRole("dialog", { name: "遊戲選單" });
      await gameMenu.getByRole("button", { name: /物證/ }).click();

      await expect(gameMenu.getByText("還熱的咖啡")).toBeVisible();
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
    });
  });
}
