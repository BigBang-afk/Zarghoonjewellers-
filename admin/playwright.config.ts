import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests for the management dashboard in DEMO mode (in-memory,
 * fake data). Set E2E_DEMO_PASSWORD to the demo password; the dev server is
 * started with it (or an already-running one on port 3100 is reused).
 */
const password = process.env.E2E_DEMO_PASSWORD ?? "";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // tests share one in-memory demo database
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3100/login",
    reuseExistingServer: true,
    timeout: 180_000,
    // The suite signs in dozens of times a minute from one address.
    env: { ZARGHOON_DASHBOARD_MODE: "demo", ZARGHOON_DEMO_PASSWORD: password, ZARGHOON_ALLOW_DEMO_IN_PRODUCTION: "true", ZARGHOON_DASHBOARD_LOGINS_PER_MINUTE: "500", ZARGHOON_DASHBOARD_LOGINS_PER_HOUR: "1000" },
  },
});
