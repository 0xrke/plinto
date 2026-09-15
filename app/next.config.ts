import type { NextConfig } from "next";

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

export default nextConfig;
