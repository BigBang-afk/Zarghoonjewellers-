import "server-only";
import { createDashboardRuntime, DashboardUnavailableError, type DashboardRuntime } from "@zarghoon/core/dashboard";

/**
 * One dashboard backend per server process (kept on globalThis so dev reloads
 * don't open new pools or reseed the demo). Secrets are read here, on the
 * server, from environment variables and never reach the browser.
 *
 * If the backend cannot start (not configured, wrong database, pending
 * migrations), every page shows "Dashboard unavailable". It never falls back
 * to demo data; the next request retries.
 */

const holder = globalThis as unknown as { __zarghoonDashboard?: Promise<DashboardRuntime> };

export async function getRuntime(): Promise<DashboardRuntime> {
  holder.__zarghoonDashboard ??= createDashboardRuntime(process.env);
  try {
    return await holder.__zarghoonDashboard;
  } catch (error) {
    holder.__zarghoonDashboard = undefined;
    throw error;
  }
}

export type RuntimeStatus = { ok: true; runtime: DashboardRuntime } | { ok: false; message: string };

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  try {
    return { ok: true, runtime: await getRuntime() };
  } catch (error) {
    if (error instanceof DashboardUnavailableError) return { ok: false, message: error.message };
    console.error(JSON.stringify({ level: "error", message: "dashboard runtime failed", name: (error as Error)?.name }));
    return { ok: false, message: "The dashboard backend could not start." };
  }
}

/** Demo mode only: discard the in-memory database and seed a fresh one. */
export async function resetDemoRuntime(): Promise<void> {
  const current = await getRuntime();
  if (current.mode !== "demo") throw new Error("Reset is only available in demo mode");
  holder.__zarghoonDashboard = undefined;
  await current.close().catch(() => undefined);
  await getRuntime();
}
