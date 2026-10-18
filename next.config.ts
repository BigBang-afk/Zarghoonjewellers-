import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
  // Zarghoon AI core runs as plain Node.js ESM on the server only (it uses
  // pg, the Anthropic SDK and, in demo mode, an in-process WASM PostgreSQL).
  serverExternalPackages: ["@zarghoon/core", "@electric-sql/pglite"],
};

export default nextConfig;
