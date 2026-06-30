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
    // resolves sensibly. NOTE: under Vitest, neither jsdom nor happy-dom
    // exposes a working window.localStorage (Vitest's environment
    // global-transfer drops it; sessionStorage survives). The localStorage
    // shim in src/test-setup.ts is therefore load-bearing in either env.
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
