import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/globalSetup.ts"],
    fileParallelism: false, // shared SQLite test DB — run test files sequentially
    testTimeout: 20_000,
    hookTimeout: 20_000,
    env: {
      NODE_ENV: "test",
      // Prisma resolves sqlite `file:` URLs relative to schema.prisma's
      // directory (backend/prisma/), not the process cwd — so this
      // resolves to backend/prisma/test.db, matching globalSetup.ts.
      DATABASE_URL: "file:./test.db",
      JWT_ACCESS_SECRET: "test-access-secret",
      JWT_REFRESH_SECRET: "test-refresh-secret",
      CORS_ORIGIN: "http://localhost:5173",
      MOCK_OTP: "true",
      MOCK_PAYMENTS: "true",
      MOCK_NOTIFICATIONS: "true",
    },
  },
})
