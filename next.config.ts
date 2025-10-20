import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  devIndicators: false,
  webpack: config => {
    config.module.rules.push({
      test: /.(jsx|tsx)$/,
      exclude: /node_modules/,
      enforce: "pre",
      use: "@ideavo/webpack-tagger"
    });

    return config;
  }
};
export default nextConfig;
