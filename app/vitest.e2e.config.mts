import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Local-fork end-to-end runs (need a running Surfpool surfnet and `next start`); never part of
 * `pnpm test`. See app/README.md, "Local fork end-to-end".
 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["e2e/**/*.e2e.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 60_000,
    globals: false,
  },
});
