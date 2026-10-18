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
  // The embed page's frame-ancestors policy is set per request in src/middleware.ts,
  // so ZARGHOON_EMBED_ALLOWED_ORIGINS takes effect without a rebuild.
  async headers() {
    return [
      {
        source: "/zarghoon-ai.js",
        headers: [{ key: "Cache-Control", value: "public, max-age=300" }],
      },
    ];
  },
};

export default nextConfig;
