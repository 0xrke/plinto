import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The SDK is a workspace package that ships TypeScript sources.
  transpilePackages: ["@stockfloor/sdk"],
};

export default nextConfig;
