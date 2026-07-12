describe("Tauri smoke", () => {
  it("shows the main menu start control", async () => {
    const start = await $("button*=開始調查");
    await start.waitForDisplayed({ timeout: 60000 });
    await expect(start).toBeDisplayed();
  });
});
