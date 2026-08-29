import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/scripts/audio/audio-boundary.test.ts"],
  },
});
