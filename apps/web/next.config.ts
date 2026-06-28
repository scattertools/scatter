import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  output: 'standalone',
  turbopack: {
    root: '../..',
  },
};

export default nextConfig;
