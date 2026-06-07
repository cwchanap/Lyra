import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import svelte from "eslint-plugin-svelte";
import { defineConfig } from "eslint/config";
import globals from "globals";
import ts from "typescript-eslint";
import gameSvelteConfig from "./apps/game/svelte.config.js";

export default defineConfig(
  {
    ignores: [
      ".worktrees/**",
      ".turbo/**",
      ".svelte-kit/**",
      "apps/game/.svelte-kit/**",
      "apps/game/build/**",
      "apps/game/src-tauri/gen/**",
      "apps/game/src-tauri/resources/**",
      "apps/game/src-tauri/target/**",
      "build/**",
      "coverage/**",
      "dist/**",
      "apps/layout-editor/dist/**",
      "apps/layout-editor/src-tauri/gen/**",
      "apps/layout-editor/src-tauri/target/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  prettier,
  svelte.configs.prettier,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        Bun: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
        },
      ],
      "no-undef": "off",
    },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.js", "**/*.svelte.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: [".svelte"],
        parser: ts.parser,
        svelteConfig: gameSvelteConfig,
      },
    },
  },
  {
    files: ["**/*.test.ts", "e2e/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.vitest,
        Bun: "readonly",
      },
    },
  },
);
