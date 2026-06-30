import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";
import { svelteTesting } from "@testing-library/svelte/vite";

const host = process.env.TAURI_DEV_HOST;

// @ts-expect-error svelteTesting plugin type is incompatible with vitest defineConfig
export default defineConfig(async () => ({
  plugins: [sveltekit(), svelteTesting()],

  test: {
    include: ["src/**/*.test.ts"],
    environment: "jsdom",
    // jsdom defaults to about:blank. Give it a real origin so window.location
    // resolves sensibly. jsdom 29.1.1 exposes a native window.localStorage;
    // the shim in src/test-setup.ts is a fallback for environments that lack
    // one (e.g. happy-dom) and is not installed under jsdom.
    environmentOptions: {
      jsdom: { url: "http://localhost:1420" },
    },
    setupFiles: ["src/test-setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["lcov"],
      reportsDirectory: "coverage",
      include: ["src/lib/**/*.svelte", "src/lib/**/*.ts"],
    },
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
