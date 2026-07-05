import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle for a small Docker runtime image.
  output: "standalone",
  reactStrictMode: true,
  // Don't advertise the framework/version in an X-Powered-By response header.
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // File uploads flow through server actions (evidence ≤15 MB, roster
      // workbook ≤10 MB); the 1 MB default would reject them.
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
