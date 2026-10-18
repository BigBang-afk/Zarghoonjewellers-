import { z } from "zod";
import { ENVIRONMENTS, type DbEnvironment } from "../database/migrator.js";
import { passwordSchema } from "../services/staffAuth/staffAuthService.js";
import { isValidTimeZone } from "../lib/businessTime.js";

/**
 * Management dashboard configuration (server-side environment only).
 *
 *  ZARGHOON_DASHBOARD_MODE   "demo" | "connected" — REQUIRED. There is no default
 *                            and no fallback: a failed connection never turns into demo.
 *  demo:       in-memory database with clearly fake records. Sign in as the
 *              demo-* users with ZARGHOON_DEMO_PASSWORD (you choose it; ≥12 chars).
 *  connected:  ZARGHOON_CORE_DATABASE_URL + ZARGHOON_DASHBOARD_DB_ENV (the
 *              environment label the database must carry: development|staging|production).
 *
 *  ZARGHOON_FOLLOWUP_DRAFTER "claude" | "template" — who writes follow-up drafts.
 *                            Default: Claude when ANTHROPIC_API_KEY is set, otherwise
 *                            the offline templates (labelled "not AI" in the dashboard).
 */

export type DashboardMode = "demo" | "connected" | "unconfigured";

export interface DashboardConfig {
  mode: DashboardMode;
  /** Why the dashboard cannot start, when mode is "unconfigured". */
  problem: string | null;
  databaseUrl: string | null;
  expectedEnvironment: DbEnvironment | null;
  demoPassword: string | null;
  timezone: string;
  secureCookies: boolean;
  drafter: "claude" | "template";
}

export function resolveDashboardConfig(env: NodeJS.ProcessEnv): DashboardConfig {
  const base = {
    databaseUrl: null,
    expectedEnvironment: null,
    demoPassword: null,
    timezone: env.ZARGHOON_BUSINESS_TIMEZONE?.trim() || "Asia/Karachi",
    secureCookies: env.NODE_ENV === "production",
    drafter: (env.ZARGHOON_FOLLOWUP_DRAFTER === "template" || !env.ANTHROPIC_API_KEY?.trim() ? "template" : "claude") as "claude" | "template",
  };
  const off = (problem: string): DashboardConfig => ({ ...base, mode: "unconfigured", problem });
  const mode = env.ZARGHOON_DASHBOARD_MODE?.trim();

  if (!mode) return off("ZARGHOON_DASHBOARD_MODE is not set (use \"demo\" or \"connected\")");
  if (!isValidTimeZone(base.timezone) || !/^[A-Za-z0-9_+\-/]{1,64}$/.test(base.timezone)) {
    return off("ZARGHOON_BUSINESS_TIMEZONE is not a valid IANA time zone (e.g. Asia/Karachi)");
  }
  if (mode === "demo") {
    // A production build must never come up with fake data by accident; a local
    // production-build preview has to opt in explicitly.
    if (env.NODE_ENV === "production" && env.ZARGHOON_ALLOW_DEMO_IN_PRODUCTION !== "true") {
      return off("Demo mode is disabled in production builds (set ZARGHOON_ALLOW_DEMO_IN_PRODUCTION=true only for a local preview)");
    }
    const password = passwordSchema.safeParse(env.ZARGHOON_DEMO_PASSWORD ?? "");
    if (!password.success) {
      return off("Demo mode needs ZARGHOON_DEMO_PASSWORD (at least 12 characters with letters and numbers)");
    }
    return { ...base, mode: "demo", problem: null, demoPassword: password.data };
  }
  if (mode === "connected") {
    const url = env.ZARGHOON_CORE_DATABASE_URL?.trim();
    if (!url) return off("Connected mode needs ZARGHOON_CORE_DATABASE_URL");
    const expected = z.enum(ENVIRONMENTS).safeParse(env.ZARGHOON_DASHBOARD_DB_ENV);
    if (!expected.success) return off("Connected mode needs ZARGHOON_DASHBOARD_DB_ENV (development, staging or production)");
    return { ...base, mode: "connected", problem: null, databaseUrl: url, expectedEnvironment: expected.data };
  }
  return off(`Unknown ZARGHOON_DASHBOARD_MODE "${mode}"`);
}
