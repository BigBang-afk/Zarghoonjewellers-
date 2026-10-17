import pg from "pg";

/**
 * Minimal database abstraction used by every service.
 *
 * All SQL is parameterized ($1, $2…). The language model never gets direct
 * access to this interface — only to validated service functions.
 *
 * `transaction` is flattening: calling it on a transaction-bound Db reuses
 * the same transaction, so services can compose without nesting concerns.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

export async function queryOne<T>(db: Db, sql: string, params?: readonly unknown[]): Promise<T | null> {
  const rows = await db.query<T>(sql, params);
  return rows[0] ?? null;
}

// --- node-postgres adapter (production) ------------------------------------

type PgQueryable = Pick<pg.Pool | pg.PoolClient, "query">;

class PgTransactionDb implements Db {
  constructor(private readonly client: PgQueryable) {}

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const result = await this.client.query(sql, params as unknown[]);
    return result.rows as T[];
  }

  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

export class PgDb implements Db {
  constructor(private readonly pool: pg.Pool) {}

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const result = await this.pool.query(sql, params as unknown[]);
    return result.rows as T[];
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await fn(new PgTransactionDb(client));
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  end(): Promise<void> {
    return this.pool.end();
  }
}

/** Creates a pooled Postgres connection. Server-side only. */
export function createPgDb(connectionString: string): PgDb {
  // NUMERIC (oid 1700) is returned as a string by node-postgres by default,
  // which is exactly what we want: money must never pass through a JS float.
  return new PgDb(new pg.Pool({ connectionString, max: 10 }));
}

// --- Postgres error helpers --------------------------------------------------

interface PgLikeError {
  code?: string;
  constraint?: string;
  hint?: string;
  message?: string;
}

function asPgError(error: unknown): PgLikeError | null {
  return typeof error === "object" && error !== null ? (error as PgLikeError) : null;
}

/** True when the error is a unique violation, optionally on a named constraint/index. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = asPgError(error);
  if (e?.code !== "23505") return false;
  if (!constraint) return true;
  return e.constraint === constraint || (e.message ?? "").includes(`"${constraint}"`);
}

/** True when a database trigger raised the given ZJ_* hint. */
export function hasDbHint(error: unknown, hint: string): boolean {
  const e = asPgError(error);
  return e?.code === "P0001" && e.hint === hint;
}
