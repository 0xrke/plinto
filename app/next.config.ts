import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The SDK is a workspace package that ships TypeScript sources.
  transpilePackages: ["@stockfloor/sdk"],
  // Separate build directories let several builds (for example a local-fork e2e build next to the
  // default one) coexist in one checkout: STOCKFLOOR_NEXT_DIST_DIR=.next-e2e next build.
  distDir: process.env.STOCKFLOOR_NEXT_DIST_DIR || ".next",
};

export default nextConfig;
