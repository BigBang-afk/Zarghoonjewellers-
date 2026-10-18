import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { Db } from "./db.js";

/**
 * In-process PostgreSQL (PGlite/WASM) with the real migrations applied.
 *
 * DEVELOPMENT AND TESTS ONLY: used by the test suite and the sales
 * playground's demo mode. Data lives in memory and disappears on exit;
 * production uses `createPgDb`.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");

export function loadMigrations(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8") }));
}

type PgliteQueryable = Pick<PGlite | Transaction, "query" | "exec">;

class PgliteTxDb implements Db {
  constructor(private readonly q: PgliteQueryable) {}
  async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return (await this.q.query<T>(sql, params as unknown[])).rows;
  }
  async exec(sql: string): Promise<void> {
    await this.q.exec(sql);
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
  async exec(sql: string): Promise<void> {
    await this.pg.exec(sql);
  }
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.pg.transaction((tx) => fn(new PgliteTxDb(tx)));
  }
  close(): Promise<void> {
    return this.pg.close();
  }
}

/** Creates an empty in-memory database with every migration applied. */
export async function createInMemoryDb(): Promise<PgliteDb> {
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
  return new PgliteDb(pg);
}
