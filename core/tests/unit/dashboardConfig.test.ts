import { describe, expect, it } from "vitest";
import { resolveDashboardConfig } from "../../src/dashboard/config.js";
import { createDashboardRuntime, DashboardUnavailableError } from "../../src/dashboard/runtime.js";

describe("dashboard configuration", () => {
  it("has no default mode: unset means not configured (never demo by accident)", () => {
    expect(resolveDashboardConfig({ NODE_ENV: "development" })).toMatchObject({ mode: "unconfigured" });
    expect(resolveDashboardConfig({ ZARGHOON_DASHBOARD_MODE: "live" })).toMatchObject({ mode: "unconfigured" });
  });

  it("demo needs a strong password chosen by the operator", () => {
    expect(resolveDashboardConfig({ ZARGHOON_DASHBOARD_MODE: "demo" }).mode).toBe("unconfigured");
    expect(resolveDashboardConfig({ ZARGHOON_DASHBOARD_MODE: "demo", ZARGHOON_DEMO_PASSWORD: "short" }).mode).toBe("unconfigured");
    expect(resolveDashboardConfig({ ZARGHOON_DASHBOARD_MODE: "demo", ZARGHOON_DEMO_PASSWORD: "a-long-demo-pass-1" })).toMatchObject({ mode: "demo" });
  });

  it("connected needs a database URL and the expected environment label", () => {
    expect(resolveDashboardConfig({ ZARGHOON_DASHBOARD_MODE: "connected" }).problem).toMatch(/ZARGHOON_CORE_DATABASE_URL/);
    expect(resolveDashboardConfig({ ZARGHOON_DASHBOARD_MODE: "connected", ZARGHOON_CORE_DATABASE_URL: "postgres://x" }).problem).toMatch(/DB_ENV/);
    expect(
      resolveDashboardConfig({ ZARGHOON_DASHBOARD_MODE: "connected", ZARGHOON_CORE_DATABASE_URL: "postgres://x", ZARGHOON_DASHBOARD_DB_ENV: "staging" }),
    ).toMatchObject({ mode: "connected", expectedEnvironment: "staging" });
  });

  it("demo never activates in a production build unless explicitly allowed (step 12)", () => {
    const demo = { ZARGHOON_DASHBOARD_MODE: "demo", ZARGHOON_DEMO_PASSWORD: "a-long-demo-pass-1" };
    expect(resolveDashboardConfig({ ...demo, NODE_ENV: "production" })).toMatchObject({ mode: "unconfigured", problem: expect.stringMatching(/production/) });
    expect(resolveDashboardConfig({ ...demo, NODE_ENV: "production", ZARGHOON_ALLOW_DEMO_IN_PRODUCTION: "yes" }).mode).toBe("unconfigured");
    expect(resolveDashboardConfig({ ...demo, NODE_ENV: "production", ZARGHOON_ALLOW_DEMO_IN_PRODUCTION: "true" }).mode).toBe("demo");
  });

  it("rejects a business time zone that is not a valid IANA name (it is used in SQL)", () => {
    const demo = { ZARGHOON_DASHBOARD_MODE: "demo", ZARGHOON_DEMO_PASSWORD: "a-long-demo-pass-1" };
    expect(resolveDashboardConfig({ ...demo, ZARGHOON_BUSINESS_TIMEZONE: "Asia/Karachi'); drop table staff; --" }).problem).toMatch(/time zone/);
    expect(resolveDashboardConfig({ ...demo, ZARGHOON_BUSINESS_TIMEZONE: "Mars/Olympus" }).problem).toMatch(/time zone/);
    expect(resolveDashboardConfig({ ...demo, ZARGHOON_BUSINESS_TIMEZONE: "Europe/London" })).toMatchObject({ mode: "demo", timezone: "Europe/London" });
  });

  it("secure cookies in production", () => {
    expect(resolveDashboardConfig({ NODE_ENV: "production" }).secureCookies).toBe(true);
  });
});

describe("dashboard runtime", () => {
  it("refuses to start unconfigured, and a failed connection does not fall back to demo", async () => {
    await expect(createDashboardRuntime({})).rejects.toBeInstanceOf(DashboardUnavailableError);
    const error = await createDashboardRuntime({
      ZARGHOON_DASHBOARD_MODE: "connected",
      ZARGHOON_CORE_DATABASE_URL: "postgresql://nobody:secret-pw@127.0.0.1:1/none",
      ZARGHOON_DASHBOARD_DB_ENV: "staging",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DashboardUnavailableError);
    expect(String((error as Error).message)).not.toContain("secret-pw");
  });

  it("demo mode starts with fake data and working sign-in", async () => {
    const rt = await createDashboardRuntime({ ZARGHOON_DASHBOARD_MODE: "demo", ZARGHOON_DEMO_PASSWORD: "a-long-demo-pass-1" });
    try {
      expect(rt.environmentLabel).toBe("demo");
      const login = await rt.auth.login({ username: "demo-owner", password: "a-long-demo-pass-1" });
      if (!login.ok) throw new Error("demo login failed");
      const names = (await rt.dashboard.listCustomers(login.staff)).rows.map((c) => c.fullName ?? "");
      expect(names.filter(Boolean).every((n) => n.startsWith("DEMO "))).toBe(true);
    } finally {
      await rt.close();
    }
  }, 60_000);
});
