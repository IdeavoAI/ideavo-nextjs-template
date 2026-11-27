import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  cacheComponents:false,
  images: {
    unoptimized: process.env.NODE_ENV === 'development',
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
  // removing this will lead to preview issues within ideavo iframe.
  allowedDevOrigins: ['**.app', '**.dev', '**.ai'],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  turbopack: {
    rules: {
      "*.{jsx,tsx}": {
        condition: { not: 'foreign' },
        loaders: [require.resolve('@ideavo/webpack-tagger')],
      },
    },
  },
} as NextConfig;

export default nextConfig;
