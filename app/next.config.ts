import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { assertDeployableProductionBuild } from "./src/lib/deployGuard";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The SDK is a workspace package that ships TypeScript sources.
  transpilePackages: ["@stockfloor/sdk"],
  // Separate build directories let several builds (for example a local-fork e2e build next to the
  // default one) coexist in one checkout: STOCKFLOOR_NEXT_DIST_DIR=.next-e2e next build.
  // STOCKFLOOR_ALLOW_MAINNET is the second mainnet send switch (next to NEXT_PUBLIC_ALLOW_MAINNET), the
  // same variable the CLI requires; it is inlined so the browser bundle can check both.
  env: { STOCKFLOOR_ALLOW_MAINNET: process.env.STOCKFLOOR_ALLOW_MAINNET === "1" ? "1" : "" },
  distDir: process.env.STOCKFLOOR_NEXT_DIST_DIR || ".next",
  // `next dev` would otherwise write AGENTS.md / CLAUDE.md into app/ (also gitignored).
  agentRules: false,
};

/**
 * `next build` only: a build that would be hosted must be wired to a chain, so a deploy cannot
 * quietly ship the mock launches or an RPC URL pointing at the build machine (see lib/deployGuard).
 * `next dev` and `next start` are unaffected.
 */
export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) {
    assertDeployableProductionBuild({
      NEXT_PUBLIC_DATA_SOURCE: process.env.NEXT_PUBLIC_DATA_SOURCE,
      NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
      STOCKFLOOR_LOCAL_BUILD: process.env.STOCKFLOOR_LOCAL_BUILD,
    });
  }
  return nextConfig;
}
