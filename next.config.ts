import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  reactCompiler: true,
  turbopack: {
    rules: {
      "*.{jsx,tsx}": {
        condition: { not: "foreign" },
        loaders: [require.resolve("@ideavo/webpack-tagger")],
      },
    },
  },
  images: {
    unoptimized: process.env.NODE_ENV === "development",
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "**",
      },
    ],
  },
  allowedDevOrigins: ["*.e2b.app", "*.ideavo.app", "*.ideavo.ai"],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
} as NextConfig;

export default nextConfig;
