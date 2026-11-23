import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These load native or WASM files at run time, so Next.js must not bundle them.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
};

export default nextConfig;
