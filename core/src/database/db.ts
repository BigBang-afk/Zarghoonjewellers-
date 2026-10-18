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
  /** Runs a trusted multi-statement SQL script (migrations only; never user input). */
  exec(sql: string): Promise<void>;
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

  async exec(sql: string): Promise<void> {
    await this.client.query(sql); // no parameters → simple protocol, multiple statements allowed
  }

  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

export class PgDb implements Db {
  constructor(private readonly pool: pg.Pool) {
    // Idle connections can be terminated by the server (restart, failover,
    // maintenance). node-postgres reports that as a pool "error" event, which
    // would crash the process if unhandled. The pool replaces the client on
    // the next query, so log (without connection details) and carry on.
    pool.on("error", (error: Error & { code?: string }) => {
      process.stderr.write(`${JSON.stringify({ level: "warn", message: "postgres idle client error", code: error.code ?? null })}\n`);
    });
  }

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const result = await this.pool.query(sql, params as unknown[]);
    return result.rows as T[];
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
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
  return new PgDb(
    new pg.Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      // A runaway query must not hold a connection (or a customer's request) forever.
      statement_timeout: 30_000,
      application_name: "zarghoon-ai-core",
    }),
  );
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
