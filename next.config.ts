import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle for a small Docker runtime image.
  output: "standalone",
  reactStrictMode: true,
  // Don't advertise the framework/version in an X-Powered-By response header.
  poweredByHeader: false,
};

export default nextConfig;
