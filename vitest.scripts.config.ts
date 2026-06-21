import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/scripts/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/.worktrees/**",
      "**/dist/**",
      "**/build/**",
    ],
  },
});
