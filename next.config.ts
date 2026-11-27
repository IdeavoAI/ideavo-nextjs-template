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
  // A bare '*' matches nothing in Next.js: each preview domain is listed
  allowedDevOrigins: ['*.e2b.app', '*.on.boat.dev', '*.agent37.app', '*.ideavo.app', '*.ideavo.ai'],
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
