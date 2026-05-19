import { test, expect } from "@playwright/test";

test.describe("App shell", () => {
  test("loads without errors", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/lyra/i);
  });
});
