import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { Db } from "../../src/database/db.js";

/**
 * In-process PostgreSQL (PGlite/WASM) with the real migrations applied.
 * Tests exercise genuine SQL, constraints and triggers without any external
 * database or credentials, and never touch production.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "..", "supabase", "migrations");

export function loadMigrations(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8") }));
}

type PgliteQueryable = Pick<PGlite | Transaction, "query">;

class PgliteTxDb implements Db {
  constructor(private readonly q: PgliteQueryable) {}
  async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return (await this.q.query<T>(sql, params as unknown[])).rows;
  }
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

export class PgliteDb implements Db {
  constructor(readonly pg: PGlite) {}
  async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return (await this.pg.query<T>(sql, params as unknown[])).rows;
  }
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.pg.transaction((tx) => fn(new PgliteTxDb(tx)));
  }
}

const ALL_TABLES = [
  "agent_actions",
  "handoffs",
  "lead_signal_events",
  "product_interests",
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
  db: PgliteDb;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite();
  // Supabase's API roles, so the RLS migration's revoke path is exercised.
  await pg.exec(`create role anon nologin; create role authenticated nologin;
                 grant usage on schema public to anon, authenticated;`);
  for (const m of loadMigrations()) {
    try {
      await pg.exec(m.sql);
    } catch (error) {
      throw new Error(`Migration ${m.name} failed: ${(error as Error).message}`);
    }
  }
  const db = new PgliteDb(pg);
  return {
    db,
    reset: async () => {
      await pg.exec(`truncate ${ALL_TABLES.join(", ")} restart identity cascade`);
    },
    close: () => pg.close(),
  };
}
