import { queryOne, type Db } from "./db.js";
import { describeDatabase, planMigrations, type DbEnvironment } from "./migrator.js";

/**
 * Read-only security check of a Zarghoon core database, run with the
 * connection the application will use (`npm run db:audit`). It never changes
 * anything and never prints connection details or row data.
 */

export type CheckLevel = "pass" | "warn" | "fail";
export interface SecurityCheck {
  id: string;
  level: CheckLevel;
  detail: string;
}
export interface SecurityAuditReport {
  database: string;
  environment: DbEnvironment | null;
  role: string;
  checks: SecurityCheck[];
  ok: boolean;
}

/** Guards that must exist for audit, approval and takeover integrity. */
const REQUIRED_TRIGGERS: [table: string, trigger: string, why: string][] = [
  ["agent_actions", "agent_actions_no_update", "audit log is append-only"],
  ["approvals", "approvals_guard", "approval decisions are final and single-use"],
  ["approvals", "approvals_no_delete", "decided approvals cannot be deleted"],
  ["messages", "messages_block_ai_during_takeover", "AI cannot reply during a human takeover"],
];

export async function auditDatabaseSecurity(db: Db, expectedEnvironment: DbEnvironment): Promise<SecurityAuditReport> {
  const checks: SecurityCheck[] = [];
  const add = (id: string, level: CheckLevel, detail: string) => checks.push({ id, level, detail });

  const identity = await describeDatabase(db);
  if (identity.environment !== expectedEnvironment) {
    add("environment", "fail", `database is labelled "${identity.environment ?? "unlabelled"}", expected "${expectedEnvironment}"`);
  } else {
    add("environment", "pass", `labelled "${identity.environment}"`);
    const plan = await planMigrations(db, expectedEnvironment);
    add(
      "migrations",
      plan.pending.length ? "fail" : "pass",
      plan.pending.length ? `${plan.pending.length} pending: ${plan.pending.map((m) => m.name).join(", ")}` : `${plan.applied.length} applied, none pending`,
    );
  }

  const role = await queryOne<{ name: string; superuser: boolean; bypassrls: boolean; createrole: boolean; createdb: boolean }>(
    db,
    `select current_user as name, rolsuper as superuser, rolbypassrls as bypassrls, rolcreaterole as createrole, rolcreatedb as createdb
       from pg_roles where rolname = current_user`,
  );
  const r = role!;
  const privileged = [r.superuser && "superuser", r.bypassrls && "bypassrls", r.createrole && "createrole", r.createdb && "createdb"].filter(Boolean);
  add(
    "role-attributes",
    privileged.length ? "warn" : "pass",
    privileged.length
      ? `connected as "${r.name}" with ${privileged.join(", ")} — use the least-privilege zarghoon_app role for the app (supabase/roles/least_privilege.sql)`
      : `"${r.name}" has no superuser, bypassrls, createrole or createdb`,
  );

  const owned = await queryOne<{ n: number }>(
    db,
    `select count(*)::int as n from pg_tables where schemaname = 'public' and tableowner = current_user`,
  );
  add("table-ownership", owned!.n ? "warn" : "pass", owned!.n ? `owns ${owned!.n} tables (owners can alter or drop them and skip row-level security)` : "owns no tables");

  const create = await queryOne<{ ok: boolean }>(db, `select has_schema_privilege(current_user, 'public', 'CREATE') as ok`);
  add("schema-create", create!.ok ? "warn" : "pass", create!.ok ? "can create objects in schema public" : "cannot change the schema");

  const audit = await queryOne<{ upd: boolean; del: boolean; trunc: boolean }>(
    db,
    `select has_table_privilege(current_user, 'public.agent_actions', 'UPDATE') as upd,
            has_table_privilege(current_user, 'public.agent_actions', 'DELETE') as del,
            has_table_privilege(current_user, 'public.agent_actions', 'TRUNCATE') as trunc`,
  );
  const auditRights = [audit!.upd && "update", audit!.del && "delete", audit!.trunc && "truncate"].filter(Boolean);
  add(
    "audit-log-privileges",
    auditRights.length ? "warn" : "pass",
    auditRights.length ? `can ${auditRights.join("/")} the audit log (blocked by trigger for update/delete, but not truncate)` : "insert/select only on the audit log",
  );

  const rls = await db.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity order by 1`);
  add("row-level-security", rls.length ? "fail" : "pass", rls.length ? `RLS disabled on: ${rls.map((t) => t.tablename).join(", ")}` : "enabled on every table");

  const exposed = await db.query<{ grantee: string; table_name: string }>(
    `select distinct grantee, table_name from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC') order by 1, 2`,
  );
  add(
    "public-api-roles",
    exposed.length ? "fail" : "pass",
    exposed.length ? `public roles have grants on: ${exposed.map((e) => `${e.grantee}:${e.table_name}`).join(", ")}` : "anon/authenticated/PUBLIC have no table access",
  );

  for (const [table, trigger, why] of REQUIRED_TRIGGERS) {
    const found = await queryOne<{ ok: boolean }>(
      db,
      `select exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                       where n.nspname = 'public' and c.relname = $1 and t.tgname = $2 and t.tgenabled <> 'D') as ok`,
      [table, trigger],
    );
    add(`trigger:${trigger}`, found!.ok ? "pass" : "fail", found!.ok ? why : `missing or disabled — ${why} is not enforced`);
  }

  return { database: identity.database, environment: identity.environment, role: r.name, checks, ok: !checks.some((c) => c.level === "fail") };
}
