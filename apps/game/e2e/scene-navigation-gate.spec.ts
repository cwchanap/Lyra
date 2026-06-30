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

// Vitest must not try to register this Playwright suite. Matches the guard in
// the sibling e2e specs.
const shouldRegisterPlaywrightSuite = !("Bun" in globalThis);

// Must stay in sync with $lib/state/story-clearance.ts. Duplicated (not
// imported) because e2e specs run against the built SPA and cannot reach $lib.
const STORY_CLEARED_STORAGE_KEY = "lyra.storyClearedOnce.v1";

// Intentionally duplicated from $lib/test-utils.ts (reportAsyncTestFailure):
// Playwright e2e specs run against the built static SPA and cannot import the
// app's $lib tree. Keep byte-for-byte in sync; do NOT "DRY" across the border.
function reportTestFailure(testName: string, error: unknown): never {
  throw new Error(`${testName} failed`, { cause: error });
}

// Install a browser-side Tauri invoke mock that returns a minimal in-game
// (dialogue) view, plus a tiny scene index so the scene-nav load path does
// not error. This mirrors the mock pattern in app.spec.ts.
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
    const dialogueView = {
      chapter,
      inventory: { evidence: [], statements: [] },
      scene: {
        kind: "linear",
        id: "scene_0",
        title: "測試線性場景",
        index: 0,
        total: 1,
      },
      mode: {
        type: "dialogue",
        current: { kind: "action", text: "測試開始。" },
        queueRemaining: 0,
        sceneTag: "測試場景，深夜。",
        queueToken: { sceneId: "scene_0", queueGen: 1, cursor: 0 },
        backgroundAssetId: null,
        bgm: null,
        bgs: null,
      },
    };
    const sceneIndex = {
      chapters: [
        {
          id: "chapter_1",
          title: "測試章節",
          index: 0,
          scenes: [
            {
              id: "scene_0",
              title: "測試線性場景",
              type: "linear",
              index: 0,
            },
          ],
        },
      ],
    };

    win.__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (
          command === "start_game" ||
          command === "reset_game" ||
          command === "advance_dialogue"
        ) {
          return dialogueView;
        }
        if (command === "list_scenes") return sceneIndex;
        if (command === "plugin:window|is_fullscreen") return false;
        if (command === "plugin:window|set_fullscreen") return null;
        return {};
      },
      transformCallback: () => 0,
      unregisterCallback: () => {},
    };
  });
}

async function startGameAndOpenMenu(page: Page) {
  await page.goto("/");
  await expect(page).toHaveTitle(/東京雨證/);
  await page.getByRole("button", { name: /開始調查/ }).click();
  // We are now in-game (dialogue mode). The global capture-phase Escape
  // listener owned by GameShell opens the case menu.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "遊戲選單" })).toBeVisible();
}

if (shouldRegisterPlaywrightSuite) {
  // sceneNavigationEnabled = `import.meta.env.DEV || storyClearedOnce`. The
  // preview build statically inlines DEV=false, so this is the only place the
  // production gate branch (!DEV) is exercised end-to-end against the real
  // artifact. The unit test (page.test.ts) covers the same branch via
  // vi.stubEnv; this guard covers the built bundle.
  test.describe("Scene navigation prod eligibility gate", () => {
    test.beforeEach(async ({ page }) => {
      await installTauriMock(page);
    });

    test("hides Scene Select when the story has not been cleared (production)", async ({
      page,
    }) => {
      const testName =
        "hides Scene Select when the story has not been cleared (production)";

      try {
        await startGameAndOpenMenu(page);
        const gameMenu = page.getByRole("dialog", { name: "遊戲選單" });
        await expect(
          gameMenu.getByRole("button", { name: /場景跳轉/ }),
        ).toHaveCount(0);
      } catch (error) {
        reportTestFailure(testName, error);
      }
    });

    test("shows Scene Select once the story has been cleared (production)", async ({
      page,
    }) => {
      const testName =
        "shows Scene Select once the story has been cleared (production)";

      try {
        // Persist clearance BEFORE the SPA initializes so
        // loadStoryClearedOnce() observes it on first render. addInitScript
        // runs before any page script on the target origin.
        await page.addInitScript((key) => {
          window.localStorage.setItem(key, "true");
        }, STORY_CLEARED_STORAGE_KEY);

        await startGameAndOpenMenu(page);
        const gameMenu = page.getByRole("dialog", { name: "遊戲選單" });
        await expect(
          gameMenu.getByRole("button", { name: /場景跳轉/ }),
        ).toBeVisible();
      } catch (error) {
        reportTestFailure(testName, error);
      }
    });
  });
}
