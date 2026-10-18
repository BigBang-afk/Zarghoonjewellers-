/**
 * Runs the follow-up processing worker against a Zarghoon AI database.
 *
 *   ZARGHOON_CORE_DATABASE_URL=… npm run followups:worker -- --env staging --once
 *   ZARGHOON_CORE_DATABASE_URL=… npm run followups:worker -- --env staging --interval 60
 *
 * It finds due follow-ups, re-checks eligibility, prepares drafts for staff
 * review and raises dashboard notifications. It never sends a message.
 * Drafts are written by Claude when ANTHROPIC_API_KEY is set (server-side),
 * otherwise by the offline templates; force templates with
 * ZARGHOON_FOLLOWUP_DRAFTER=template. Safe to run in several processes.
 */
import { parseArgs } from "node:util";
import { createDrafterFromEnv } from "../src/dashboard/runtime.js";
import { createPgDb } from "../src/database/db.js";
import { describeDatabase, ENVIRONMENTS, planMigrations, type DbEnvironment } from "../src/database/migrator.js";
import { createFollowupWorker } from "../src/services/followupEngine/worker.js";

const { values } = parseArgs({
  options: {
    env: { type: "string" },
    once: { type: "boolean", default: false },
    interval: { type: "string" },
    limit: { type: "string", default: "20" },
  },
});

async function main(): Promise<number> {
  const url = process.env.ZARGHOON_CORE_DATABASE_URL;
  const env = values.env as DbEnvironment | undefined;
  if (!url) return (console.error("Set ZARGHOON_CORE_DATABASE_URL."), 2);
  if (!env || !ENVIRONMENTS.includes(env)) return (console.error(`--env is required: one of ${ENVIRONMENTS.join(", ")}`), 2);
  const interval = values.interval ? Number(values.interval) : null;
  if (!values.once && (!interval || interval < 15)) return (console.error("Use --once, or --interval <seconds ≥ 15>"), 2);

  const db = createPgDb(url);
  let stop = false;
  process.on("SIGINT", () => (stop = true));
  process.on("SIGTERM", () => (stop = true));
  try {
    const identity = await describeDatabase(db);
    if (identity.environment !== env) return (console.error(`Stopped: database is labelled "${identity.environment ?? "not initialised"}", not "${env}".`), 1);
    const plan = await planMigrations(db, env);
    if (plan.pending.length) return (console.error(`Stopped: ${plan.pending.length} pending migration(s). Run db:migrate first.`), 1);
    const choice = process.env.ZARGHOON_FOLLOWUP_DRAFTER === "template" || !process.env.ANTHROPIC_API_KEY?.trim() ? "template" : "claude";
    const worker = createFollowupWorker(db, { drafter: createDrafterFromEnv(process.env, choice) });
    console.log(`Follow-up worker ${worker.workerId} on "${identity.database}" (${env}); writer: ${choice}. No messages are ever sent.`);
    do {
      const summary = await worker.runOnce({ limit: Math.min(Number(values.limit) || 20, 100) });
      console.log(JSON.stringify({ at: new Date().toISOString(), ...summary }));
      if (values.once || stop) break;
      await new Promise((r) => setTimeout(r, interval! * 1000));
    } while (!stop);
    return 0;
  } catch (error) {
    const code = (error as { code?: string }).code;
    console.error(`Worker failed${code ? ` (${code})` : ""}: ${error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g, "<redacted>") : "unknown error"}`);
    return 1;
  } finally {
    await db.end();
  }
}

main().then((code) => process.exit(code));
