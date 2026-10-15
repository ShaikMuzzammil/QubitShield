import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standard Next.js output — works out of the box on Vercel and `next start`.
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
