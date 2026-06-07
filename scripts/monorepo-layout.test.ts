import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function readJson(path: string) {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"));
}

describe("monorepo layout", () => {
  it("keeps game and editor apps under the apps workspace", () => {
    const rootPackage = readJson("package.json");

    expect(rootPackage.packageManager).toBe("bun@1.3.1");
    expect(rootPackage.workspaces).toEqual(["apps/*"]);
    expect(rootPackage.devDependencies.turbo).toBeDefined();
    expect(rootPackage.scripts.dev).toBe("turbo run dev:frontend dev:tauri");
    expect(rootPackage.scripts["dev:game"]).toBe(
      "turbo run dev:frontend dev:tauri --filter=@lyra/game",
    );
    expect(rootPackage.scripts["dev:editor"]).toBe(
      "turbo run dev:frontend dev:tauri --filter=@lyra/layout-editor",
    );
    expect(rootPackage.scripts.tauri).toBeUndefined();
    expect(rootPackage.scripts["dev:tauri"]).toBeUndefined();
    expect(rootPackage.scripts["editor:dev"]).toBeUndefined();
    expect(rootPackage.scripts.build).toBe("turbo run build");
    expect(rootPackage.scripts.check).toBe("turbo run check");
    expect(rootPackage.scripts.test).toContain("turbo run test");
    expect(rootPackage.scripts["test:scripts"]).toBe(
      "vitest run --config vitest.scripts.config.ts",
    );

    expect(existsSync(resolve(process.cwd(), "turbo.json"))).toBe(true);
    expect(existsSync(resolve(process.cwd(), "apps/game/package.json"))).toBe(
      true,
    );
    expect(
      existsSync(resolve(process.cwd(), "apps/layout-editor/package.json")),
    ).toBe(true);
  });

  it("keeps the game app as a Tauri package inside apps/game", () => {
    const gamePackage = readJson("apps/game/package.json");
    const editorPackage = readJson("apps/layout-editor/package.json");
    const editorViteConfig = readFileSync(
      resolve(process.cwd(), "apps/layout-editor/vite.config.ts"),
      "utf8",
    );

    expect(gamePackage.name).toBe("@lyra/game");
    expect(gamePackage.scripts.dev).toBe("bun run --cwd ../.. dev:game");
    expect(gamePackage.scripts["dev:frontend"]).toBe("vite dev");
    expect(gamePackage.scripts["dev:tauri"]).toBe(
      "bun run scenes:compile && tauri dev -c src-tauri/tauri.dev.conf.json",
    );
    expect(gamePackage.scripts.tauri).toBe("tauri");
    expect(gamePackage.scripts["scenes:compile"]).toBeDefined();
    expect(
      existsSync(resolve(process.cwd(), "apps/game/src-tauri/Cargo.toml")),
    ).toBe(true);
    expect(
      existsSync(
        resolve(process.cwd(), "apps/game/src-tauri/tauri.dev.conf.json"),
      ),
    ).toBe(true);
    expect(
      existsSync(resolve(process.cwd(), "apps/game/src/routes/+page.svelte")),
    ).toBe(true);

    expect(editorPackage.name).toBe("@lyra/layout-editor");
    expect(editorPackage.scripts.dev).toBe("bun run --cwd ../.. dev:editor");
    expect(editorPackage.scripts["dev:frontend"]).toBe(
      "vite dev --host 127.0.0.1",
    );
    expect(editorPackage.scripts["dev:tauri"]).toBe(
      "tauri dev -c src-tauri/tauri.dev.conf.json",
    );
    expect(editorPackage.scripts.test).toBe("vitest run");
    expect(editorViteConfig).toContain('publicDir: "../../static"');
    expect(
      existsSync(
        resolve(
          process.cwd(),
          "apps/layout-editor/src-tauri/tauri.dev.conf.json",
        ),
      ),
    ).toBe(true);
  });
});
