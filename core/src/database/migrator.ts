import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { queryOne, type Db } from "./db.js";

/**
 * Safe migration runner for real PostgreSQL databases (Supabase, Neon, …).
 *
 * Safety rules:
 *  - A database must be explicitly initialised with an environment label
 *    ("development" | "staging" | "production"); every later run must state
 *    the same label, so a staging command can never hit production by
 *    accident.
 *  - Initialisation refuses a database that already contains any Zarghoon
 *    table it did not create (it may hold someone's real data).
 *  - Each migration runs in its own transaction together with its tracking row.
 *  - Applied migrations are checksummed; an edited historical migration
 *    stops everything (create a new migration instead).
 *  - Nothing is ever dropped, truncated or reset.
 */

export const ENVIRONMENTS = ["development", "staging", "production"] as const;
export type DbEnvironment = (typeof ENVIRONMENTS)[number];

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");

/** Tables our migrations create; their presence without our tracking means "not ours". */
const ZARGHOON_TABLES = [
  "staff", "customers", "products", "product_images", "leads", "conversations", "messages",
  "product_interests", "followups", "orders", "order_items", "approvals", "agent_actions",
  "customer_identities", "lead_signal_events", "handoffs",
];

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export function readMigrationFiles(dir = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}

export class MigrationSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationSafetyError";
  }
}

export interface DatabaseIdentity {
  database: string;
  serverVersion: string;
  environment: DbEnvironment | null;
}

export async function describeDatabase(db: Db): Promise<DatabaseIdentity> {
  const info = await queryOne<{ database: string; version: string }>(
    db,
    `select current_database() as database, current_setting('server_version') as version`,
  );
  const meta = await queryOne<{ exists: boolean }>(
    db,
    `select to_regclass('public.zarghoon_meta') is not null as exists`,
  );
  let environment: DbEnvironment | null = null;
  if (meta?.exists) {
    const row = await queryOne<{ value: string }>(db, `select value from zarghoon_meta where key = 'environment'`);
    environment = (row?.value as DbEnvironment) ?? null;
  }
  return { database: info!.database, serverVersion: info!.version, environment };
}

/** Marks an empty (Zarghoon-free) database as belonging to an environment. */
export async function initialiseDatabase(db: Db, environment: DbEnvironment): Promise<void> {
  const identity = await describeDatabase(db);
  if (identity.environment) {
    throw new MigrationSafetyError(`Database is already initialised as "${identity.environment}"`);
  }
  const existing = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])`,
    [ZARGHOON_TABLES],
  );
  if (existing.length > 0) {
    throw new MigrationSafetyError(
      `Refusing to initialise: tables already exist that this tool did not create (${existing
        .map((t) => t.table_name)
        .join(", ")}). They may hold real data. Inspect the database manually.`,
    );
  }
  await db.transaction(async (tx) => {
    await tx.query(`create table zarghoon_meta (key text primary key, value text not null, updated_at timestamptz not null default now())`);
    await tx.query(`insert into zarghoon_meta (key, value) values ('environment', $1)`, [environment]);
    await tx.query(
      `create table zarghoon_schema_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())`,
    );
    // Supabase exposes the public schema through its API roles; deny them these internal tables too.
    await tx.query(`alter table zarghoon_meta enable row level security`);
    await tx.query(`alter table zarghoon_schema_migrations enable row level security`);
    await tx.query(`do $$ begin
      if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke all on table zarghoon_meta, zarghoon_schema_migrations from anon;
      end if;
      if exists (select 1 from pg_roles where rolname = 'authenticated') then
        revoke all on table zarghoon_meta, zarghoon_schema_migrations from authenticated;
      end if;
    end $$`);
  });
}

export interface MigrationPlan {
  identity: DatabaseIdentity;
  applied: string[];
  pending: MigrationFile[];
}

export async function planMigrations(db: Db, expectedEnvironment: DbEnvironment, files = readMigrationFiles()): Promise<MigrationPlan> {
  const identity = await describeDatabase(db);
  if (!identity.environment) {
    throw new MigrationSafetyError("Database is not initialised for Zarghoon AI (run with --init <environment> first)");
  }
  if (identity.environment !== expectedEnvironment) {
    throw new MigrationSafetyError(
      `Environment mismatch: database is "${identity.environment}" but the command targets "${expectedEnvironment}"`,
    );
  }
  const rows = await db.query<{ name: string; checksum: string }>(`select name, checksum from zarghoon_schema_migrations order by name`);
  const byName = new Map(files.map((f) => [f.name, f]));
  for (const row of rows) {
    const file = byName.get(row.name);
    if (!file) throw new MigrationSafetyError(`Applied migration ${row.name} is missing from the repository`);
    if (file.checksum !== row.checksum) {
      throw new MigrationSafetyError(`Applied migration ${row.name} has been modified since it was applied. Never edit applied migrations.`);
    }
  }
  const applied = new Set(rows.map((r) => r.name));
  const pending = files.filter((f) => !applied.has(f.name));
  const latestApplied = rows.at(-1)?.name;
  if (latestApplied && pending.some((p) => p.name < latestApplied)) {
    throw new MigrationSafetyError("A new migration is ordered before already-applied ones; rename it with a later timestamp");
  }
  return { identity, applied: [...applied], pending };
}

/** Applies pending migrations, each atomically with its tracking row. */
export async function applyMigrations(
  db: Db,
  expectedEnvironment: DbEnvironment,
  options: { allowProduction?: boolean; files?: MigrationFile[] } = {},
): Promise<string[]> {
  if (expectedEnvironment === "production" && !options.allowProduction) {
    throw new MigrationSafetyError("Production migrations require explicit approval (--allow-production)");
  }
  const plan = await planMigrations(db, expectedEnvironment, options.files);
  const done: string[] = [];
  for (const migration of plan.pending) {
    await db.transaction(async (tx) => {
      await tx.exec(migration.sql);
      await tx.query(`insert into zarghoon_schema_migrations (name, checksum) values ($1, $2)`, [migration.name, migration.checksum]);
    });
    done.push(migration.name);
  }
  return done;
}
