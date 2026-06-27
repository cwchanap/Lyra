import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function pageSource() {
  return readFileSync(join(process.cwd(), "src/routes/+page.svelte"), "utf8");
}

describe("+page inventory placement", () => {
  it("renders inventory inside the GameShell menu slot instead of scene HUDs", () => {
    const source = pageSource();

    expect(source).toContain("{#snippet menu()}");
    expect(source).toContain("<InventoryPanel");
    expect(source).not.toContain('placement="scene"');
    expect(source).not.toContain('gameState.value.mode.type !== "explore"');
  });
});

describe("ExploreView HUD placement", () => {
  function exploreViewSource() {
    return readFileSync(
      join(process.cwd(), "src/lib/components/ExploreView.svelte"),
      "utf8",
    );
  }

  it("renders the sublocation nav through the scene HUD instead of above the scene", () => {
    const source = exploreViewSource();

    expect(source).toContain("{#snippet sceneHud()}");
    expect(source).toContain('placement="scene"');
    expect(source).toContain("{@render hud()}");
    expect(source).not.toContain("<SublocationNav\n    sublocations=");
  });
});

describe("+page gameplay audio wiring", () => {
  it("mounts GameplayAudio whenever a game state exists", () => {
    const source = pageSource();

    expect(source).toContain(
      'import GameplayAudio from "$lib/components/GameplayAudio.svelte";',
    );
    expect(source).toContain("<GameplayAudio mode={gameState.value.mode} />");
  });
});
