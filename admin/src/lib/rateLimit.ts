import "server-only";
import { SlidingWindowRateLimiter, type RateRule } from "@zarghoon/core/dashboard";

/** Per-instance limits (a shared store is needed before running several instances). */
const holder = globalThis as unknown as { __zarghoonDashboardLimiter?: SlidingWindowRateLimiter };
const limiter = (holder.__zarghoonDashboardLimiter ??= new SlidingWindowRateLimiter());

const envLimit = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 && n <= 10_000 ? n : fallback;
};

// Account lockout (5 failures → 15 minutes) is enforced separately in the database.
const LOGIN_PER_ADDRESS: RateRule = { name: "login_address", limit: envLimit("ZARGHOON_DASHBOARD_LOGINS_PER_MINUTE", 10), windowMs: 60_000 };
const LOGIN_PER_USERNAME: RateRule = { name: "login_username", limit: envLimit("ZARGHOON_DASHBOARD_LOGINS_PER_HOUR", 20), windowMs: 60 * 60_000 };
const ACTIONS_PER_STAFF: RateRule = { name: "staff_actions", limit: 60, windowMs: 60_000 };

export const allowLogin = (address: string, username: string) =>
  limiter.check([
    { rule: LOGIN_PER_ADDRESS, key: address },
    { rule: LOGIN_PER_USERNAME, key: username.toLowerCase().slice(0, 40) },
  ]);

export const allowStaffAction = (staffId: string) => limiter.check([{ rule: ACTIONS_PER_STAFF, key: staffId }]);
