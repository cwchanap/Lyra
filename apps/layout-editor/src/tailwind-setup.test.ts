import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json";

const srcDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(srcDir, "..");

function sourceAt(pathFromAppRoot: string): string {
  const fullPath = resolve(appRoot, pathFromAppRoot);
  return existsSync(fullPath) ? readFileSync(fullPath, "utf8") : "";
}

describe("layout editor Tailwind setup", () => {
  it("loads Tailwind through the Vite plugin and app stylesheet", () => {
    const viteConfig = sourceAt("vite.config.ts");
    const mainSource = sourceAt("src/main.ts");
    const appCss = sourceAt("src/app.css");

    expect(packageJson.devDependencies).toMatchObject({
      "@tailwindcss/vite": expect.any(String),
      tailwindcss: expect.any(String),
    });
    expect(viteConfig).toContain(
      'import tailwindcss from "@tailwindcss/vite";',
    );
    expect(viteConfig).toContain(
      "plugins: [tailwindcss(), svelte(), svelteTesting()]",
    );
    expect(mainSource).toContain('import "./app.css";');
    expect(appCss).toContain('@import "tailwindcss";');
  });

  it("keeps editor component styling in Tailwind classes", () => {
    const componentPaths = [
      "src/App.svelte",
      "src/lib/EditorCanvas.svelte",
      "src/lib/EvidenceAssignmentPanel.svelte",
      "src/lib/TargetList.svelte",
    ];

    for (const componentPath of componentPaths) {
      expect(sourceAt(componentPath), componentPath).not.toMatch(/<style\b/);
    }
  });
});
