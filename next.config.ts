import { NextConfig } from "next";

/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  images: { unoptimized: true },
  webpack: (config) => {
    config.module.rules.push({
      test: /.(jsx|tsx)$/,
      exclude: /node_modules/,
      enforce: "pre",
      use: "@ideavo/webpack-tagger"
    });

    return config;
  }
};

module.exports = nextConfig;
