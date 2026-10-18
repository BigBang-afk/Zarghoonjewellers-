import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Zarghoon AI core runs as plain Node.js ESM on the server only (pg, and in
  // demo mode an in-process WASM PostgreSQL). Never bundled for the browser.
  serverExternalPackages: ["@zarghoon/core", "@electric-sql/pglite"],
  // core/ is a linked package outside this folder.
  turbopack: { root: path.join(__dirname, "..") },
  poweredByHeader: false,
  // The dev indicator sits over the sidebar's sign-out button.
  devIndicators: false,
  images: { unoptimized: true },
};

export default nextConfig;
