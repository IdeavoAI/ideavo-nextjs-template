import type { NextConfig } from "next";
import path from "node:path";

const LOADER = path.resolve(
  process.cwd(),
  "node_modules/@ideavo/webpack-tagger/dist/index.js"
);

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
  turbopack: {
    rules: {
      "*.{jsx,tsx}": {
        loaders: [LOADER],
      },
    },
  },
};

export default nextConfig;
