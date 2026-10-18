/**
 * Read-only database security check, run with the connection the app will use.
 *
 *   ZARGHOON_CORE_DATABASE_URL=… npm run db:audit -- --env staging
 *
 * Exits 1 if any check fails. Prints no connection details or row data.
 */
import { parseArgs } from "node:util";
import { createPgDb } from "../src/database/db.js";
import { ENVIRONMENTS, type DbEnvironment } from "../src/database/migrator.js";
import { auditDatabaseSecurity } from "../src/database/securityAudit.js";

const { values } = parseArgs({ options: { env: { type: "string" } } });

async function main(): Promise<number> {
  const url = process.env.ZARGHOON_CORE_DATABASE_URL;
  const env = values.env as DbEnvironment | undefined;
  if (!url) {
    console.error("Set ZARGHOON_CORE_DATABASE_URL to the connection the application uses.");
    return 2;
  }
  if (!env || !ENVIRONMENTS.includes(env)) {
    console.error(`--env is required: one of ${ENVIRONMENTS.join(", ")}`);
    return 2;
  }
  const db = createPgDb(url);
  try {
    const report = await auditDatabaseSecurity(db, env);
    console.log(`Database "${report.database}" (${report.environment ?? "unlabelled"}) as role "${report.role}"`);
    for (const c of report.checks) console.log(`  ${c.level.toUpperCase().padEnd(4)}  ${c.id}: ${c.detail}`);
    console.log(report.ok ? "No failing checks." : "Some checks FAILED.");
    return report.ok ? 0 : 1;
  } catch (error) {
    console.error(`Audit failed: ${error instanceof Error ? error.name : "unknown error"}`);
    return 1;
  } finally {
    await db.end();
  }
}

process.exitCode = await main();
