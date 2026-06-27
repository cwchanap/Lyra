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
};

const shouldRegisterPlaywrightSuite = !("Bun" in globalThis);

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
    const investigationScene = {
      kind: "investigation",
      id: "investigation_scene_1",
      title: "測試調查場景",
      index: 0,
      total: 1,
      currentSublocationId: "coffee_shop",
      visibleSublocations: [
        {
          id: "coffee_shop",
          label: "喫茶店",
          sceneTag: "雨夜喫茶店。",
          hotspots: [
            {
              id: "table",
              label: "桌面",
              description: "杯底壓著濕掉的收據。",
              inspected: false,
              layout: { kind: "rect", x: 0.1, y: 0.2, w: 0.3, h: 0.2 },
            },
          ],
          characters: [
            {
              id: "witness",
              name: "目擊者",
              role: "常客",
              bio: "案發時坐在窗邊。",
              topics: [{ id: "alibi", label: "不在場證明", discussed: false }],
              layout: {
                kind: "sprite",
                assetId: "portrait.witness.standard",
                x: 0.65,
                y: 0.12,
                w: 0.18,
                h: 0.76,
                anchor: "bottomCenter",
              },
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
        },
        queueRemaining: 0,
        sceneTag: "雨聲貼在玻璃上。",
        queueToken: { sceneId: "scene_0", queueGen: 1, cursor: 0 },
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
      },
    };
    const exploreView = {
      chapter,
      inventory,
      scene: investigationScene,
      mode: {
        type: "explore",
        sublocationId: "coffee_shop",
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
      },
    };
    const inspectedView = {
      chapter,
      inventory,
      scene: {
        ...investigationScene,
        visibleSublocations: [
          {
            ...investigationScene.visibleSublocations[0],
            hotspots: [
              {
                ...investigationScene.visibleSublocations[0].hotspots[0],
                inspected: true,
              },
            ],
          },
        ],
      },
      mode: {
        type: "dialogue",
        current: {
          kind: "line",
          speaker: "相馬律",
          text: "還是熱的。",
        },
        queueRemaining: 0,
        sceneTag: "雨夜喫茶店。",
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
        if (command === "start_game" || command === "reset_game") {
          return introView;
        }
        if (command === "advance_dialogue") {
          return exploreView;
        }
        if (command === "inspect_hotspot") {
          return inspectedView;
        }
        return exploreView;
      },
      transformCallback: () => 0,
      unregisterCallback: () => {},
    };
  });
}

if (shouldRegisterPlaywrightSuite) {
  test.describe("investigation layout surface", () => {
    test.beforeEach(async ({ page }) => {
      await installTauriMock(page);
    });

    async function advanceDialogue(page: Page) {
      const advanceButton = page.getByRole("button", { name: "推進對話" });
      await expect(advanceButton).toBeEnabled();
      await advanceButton.click();
    }

    test("clicks a placed investigation hotspot", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: /開始調查/ }).click();

      await expect(page.getByText("測試開始。")).toBeVisible();
      await advanceDialogue(page);

      const placedHotspot = page.getByRole("button", {
        name: "調查：桌面",
      });
      await expect(placedHotspot).toBeVisible();
      await placedHotspot.click();

      await expect(page.getByText("還是熱的。")).toBeVisible();
    });

    test("highlights a placed investigation character on hover", async ({
      page,
    }) => {
      const testName = "highlights a placed investigation character on hover";

      try {
        await page.goto("/");
        await page.getByRole("button", { name: /開始調查/ }).click();

        await expect(page.getByText("測試開始。")).toBeVisible();
        await advanceDialogue(page);

        const placedCharacter = page.getByRole("button", {
          name: "詢問：目擊者",
        });
        const highlight = placedCharacter.locator(".character-highlight");
        const name = placedCharacter.locator(".character-name");

        await expect(placedCharacter).toBeVisible();
        await expect(highlight).toHaveCSS("opacity", "0");
        await expect(name).toHaveCSS("opacity", "0");
        await expect(name).toHaveCSS("top", "10px");
        await expect(name).toHaveCSS("right", "10px");
        await expect(name).toHaveCSS("font-size", "18px");

        await placedCharacter.hover();

        await expect(highlight).toHaveCSS("opacity", "1");
        await expect(name).toHaveCSS("opacity", "1");
      } catch (error) {
        reportTestFailure(testName, error);
      }
    });
  });
}
