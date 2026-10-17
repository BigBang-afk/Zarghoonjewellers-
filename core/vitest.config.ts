import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Each test file boots its own in-process PGlite database; keep the
    // timeout generous for the first WASM load.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
