/**
 * Zarghoon AI core database migrations (any PostgreSQL, incl. Supabase).
 *
 *   ZARGHOON_CORE_DATABASE_URL=… npm run db:migrate -- --env staging                 # dry run: show plan
 *   ZARGHOON_CORE_DATABASE_URL=… npm run db:migrate -- --env staging --init          # first time, empty database only
 *   ZARGHOON_CORE_DATABASE_URL=… npm run db:migrate -- --env staging --apply         # apply pending migrations
 *
 * Production additionally needs --allow-production (only with owner approval).
 * The connection string is read from the environment only, never from arguments.
 */
import { parseArgs } from "node:util";
import { createPgDb } from "../src/database/db.js";
import {
  applyMigrations,
  describeDatabase,
  ENVIRONMENTS,
  initialiseDatabase,
  MigrationSafetyError,
  planMigrations,
  type DbEnvironment,
} from "../src/database/migrator.js";

const { values } = parseArgs({
  options: {
    env: { type: "string" },
    init: { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
    "allow-production": { type: "boolean", default: false },
  },
});

function describeTarget(url: string): string {
  const u = new URL(url);
  return `${u.username || "?"}@${u.hostname}:${u.port || "5432"}${u.pathname}`; // password never printed
}

async function main(): Promise<number> {
  const url = process.env.ZARGHOON_CORE_DATABASE_URL;
  const env = values.env as DbEnvironment | undefined;
  if (!url) {
    console.error("Set ZARGHOON_CORE_DATABASE_URL (server-side secret) to the target database.");
    return 2;
  }
  if (!env || !ENVIRONMENTS.includes(env)) {
    console.error(`--env is required: one of ${ENVIRONMENTS.join(", ")}`);
    return 2;
  }
  if (env === "production" && (values.init || values.apply) && !values["allow-production"]) {
    console.error("Refusing to change a production database without --allow-production (owner approval required).");
    return 2;
  }

  console.log(`Target: ${describeTarget(url)}  (environment: ${env})`);
  const db = createPgDb(url);
  try {
    const identity = await describeDatabase(db);
    console.log(`Connected: database "${identity.database}", PostgreSQL ${identity.serverVersion}, label: ${identity.environment ?? "not initialised"}`);
    if (values.init) {
      await initialiseDatabase(db, env);
      console.log(`Initialised as "${env}".`);
    }
    const plan = await planMigrations(db, env);
    console.log(`Applied: ${plan.applied.length}. Pending: ${plan.pending.length}`);
    for (const p of plan.pending) console.log(`  • ${p.name}`);
    if (!values.apply) {
      if (plan.pending.length) console.log("Dry run only. Re-run with --apply to apply.");
      return 0;
    }
    const done = await applyMigrations(db, env, { allowProduction: values["allow-production"] });
    console.log(done.length ? `Applied ${done.length} migration(s).` : "Nothing to apply.");
    return 0;
  } catch (error) {
    if (error instanceof MigrationSafetyError) {
      console.error(`Stopped for safety: ${error.message}`);
      return 1;
    }
    // Never print the connection string or driver internals.
    console.error(`Migration failed: ${error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g, "<redacted>") : "unknown error"}`);
    return 1;
  } finally {
    await db.end();
  }
}

process.exitCode = await main();
