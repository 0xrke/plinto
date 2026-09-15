import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The integration tests use the SDK from source (packages/sdk) without a workspace dependency.
      "@stockfloor/sdk": fileURLToPath(new URL("../packages/sdk/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["spike/**/*.test.ts", "integration/**/*.test.ts", "unit/**/*.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    // LiteSVM instances are memory heavy (several MB of programs each); run files in forks.
    pool: "forks",
    reporters: ["verbose"],
  },
});
