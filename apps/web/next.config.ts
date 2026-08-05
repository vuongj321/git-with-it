import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@gwi/shared-types'],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
