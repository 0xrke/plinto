import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["spike/**/*.test.ts", "integration/**/*.test.ts", "unit/**/*.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    // LiteSVM instances are memory heavy (several MB of programs each); run files in forks.
    pool: "forks",
    reporters: ["verbose"],
  },
});
