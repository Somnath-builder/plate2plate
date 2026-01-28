import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  distDir: '../public/client',
  trailingSlash: true,
};

export default nextConfig;
