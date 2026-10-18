import { randomBytes } from "node:crypto";
import pg from "pg";
import { createPgDb, type Db } from "../../src/database/db.js";
import { applyMigrations, initialiseDatabase } from "../../src/database/migrator.js";
import { createInMemoryDb } from "../../src/database/pgliteDb.js";

/**
 * Test databases. By default: in-process PostgreSQL (PGlite) with the real
 * migrations — no server or credentials needed.
 *
 * With ZARGHOON_TEST_PG_ADMIN_URL set to a DISPOSABLE PostgreSQL server, every
 * test file instead gets its own temporary database (zj_test_<random>),
 * migrated with the real migrator and dropped afterwards. Never point this at
 * a server holding real data.
 */

const ALL_TABLES = [
  "agent_actions",
  "handoffs",
  "lead_signal_events",
  "product_interests",
  "product_source_links",
  "followups",
  "messages",
  "conversations",
  "order_items",
  "orders",
  "approvals",
  "leads",
  "customer_identities",
  "customers",
  "product_images",
  "products",
  "staff",
];

export interface TestDatabase {
  db: Db;
  /** Which engine the suite is running on. */
  engine: "pglite" | "postgres";
  reset(): Promise<void>;
  close(): Promise<void>;
}

const truncateSql = async (db: Db) => {
  const existing = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])`,
    [ALL_TABLES],
  );
  if (existing.length) await db.query(`truncate ${existing.map((t) => t.table_name).join(", ")} restart identity cascade`);
};

export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = process.env.ZARGHOON_TEST_PG_ADMIN_URL;
  if (!adminUrl) {
    const db = await createInMemoryDb();
    return { db, engine: "pglite", reset: () => truncateSql(db), close: () => db.close() };
  }

  const name = `zj_test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  // Supabase's API roles (cluster-wide), so the RLS migration's revoke path is exercised.
  for (const role of ["anon", "authenticated"]) {
    await admin.query(`do $$ begin create role ${role} nologin; exception when duplicate_object then null; end $$`);
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const db = createPgDb(url.toString());
  await initialiseDatabase(db, "development");
  await applyMigrations(db, "development");
  return {
    db,
    engine: "postgres",
    reset: () => truncateSql(db),
    close: async () => {
      await db.end();
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}
