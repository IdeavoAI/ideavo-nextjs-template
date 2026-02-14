import type { NextConfig } from "next";
import path from "node:path";

// Loader path from @ideavo/webpack-tagger - use direct resolve to get the actual file
const loaderPath = require.resolve('@ideavo/webpack-tagger');

const nextConfig: NextConfig = {
  images: {
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
  allowedDevOrigins: ['*.e2b.app', '*.ideavo.app', '*.ideavo.ai'],
  outputFileTracingRoot: path.resolve(__dirname, '../../'),
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  turbopack: {
    rules: {
      "*.{jsx,tsx}": {
        loaders: [loaderPath]
      }
    }
  }
} as NextConfig;

export default nextConfig;
