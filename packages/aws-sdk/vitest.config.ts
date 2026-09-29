import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Scanning SDK packages with ts-morph is CPU-heavy.
    testTimeout: 30_000
  }
})
