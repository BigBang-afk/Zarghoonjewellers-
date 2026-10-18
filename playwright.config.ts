import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests for the website and the Zarghoon AI chat.
 * They run against `npm run dev` in demo mode (in-memory DEMO database);
 * without ANTHROPIC_API_KEY the chat uses the labelled offline demo model.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // tests share one in-memory demo database
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      command: "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      // Stand-in for an existing store website that embeds the chat (test fixture only).
      command: "python3 -m http.server 4000 --bind 127.0.0.1 --directory e2e/fixtures/existing-store",
      url: "http://127.0.0.1:4000",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    // Opt-in (E2E_CROSS_SITE=1, after `npm run build`): a production build on another
    // site, embedded cross-site with an origin allowlist and partitioned cookies.
    ...(process.env.E2E_CROSS_SITE === "1"
      ? [
          {
            command: "npx next start -p 3001",
            url: "http://localhost:3001/zarghoon-ai.js",
            reuseExistingServer: true,
            timeout: 120_000,
            env: {
              ZARGHOON_CHAT_MODE: "demo",
              // A local production-build preview with fake data only.
              ZARGHOON_ALLOW_DEMO_IN_PRODUCTION: "true",
              ZARGHOON_EMBED_CROSS_SITE: "true",
              ZARGHOON_EMBED_ALLOWED_ORIGINS: "http://127.0.0.1:4000",
              ZARGHOON_AI_SERVICE_ONLY: "true",
              AUTH_TRUST_HOST: "true",
            },
          },
        ]
      : []),
  ],
});
