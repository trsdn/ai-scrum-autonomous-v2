import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10000, // 10s default for integration tests with network operations
    coverage: {
      provider: "v8",
      reporter: ["json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
});
