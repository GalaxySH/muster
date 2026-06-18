import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle for a small Docker runtime image.
  output: "standalone",
  reactStrictMode: true,
};

export default nextConfig;
