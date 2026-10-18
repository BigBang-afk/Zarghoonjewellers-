import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { PgliteDb } from "../../src/database/pgliteDb.js";
import { applyMigrations, initialiseDatabase } from "../../src/database/migrator.js";
import { auditDatabaseSecurity } from "../../src/database/securityAudit.js";

const migrated = async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon nologin; create role authenticated nologin;`);
  const db = new PgliteDb(pg);
  await initialiseDatabase(db, "staging");
  await applyMigrations(db, "staging");
  return { pg, db };
};

const level = (r: Awaited<ReturnType<typeof auditDatabaseSecurity>>, id: string) => r.checks.find((c) => c.id === id)?.level;

describe("db:audit (step 12)", () => {
  it("passes a migrated database and warns about a privileged connection", async () => {
    const { db } = await migrated();
    const report = await auditDatabaseSecurity(db, "staging");
    expect(report.ok).toBe(true);
    expect(level(report, "row-level-security")).toBe("pass");
    expect(level(report, "public-api-roles")).toBe("pass");
    expect(level(report, "trigger:approvals_guard")).toBe("pass");
    expect(level(report, "role-attributes")).toBe("warn");
    await db.close();
  });

  it("fails on the wrong environment label, a disabled guard, missing RLS or a public grant", async () => {
    const { db } = await migrated();
    expect(level(await auditDatabaseSecurity(db, "production"), "environment")).toBe("fail");
    await db.query(`alter table agent_actions disable trigger agent_actions_no_update`);
    await db.query(`alter table orders disable row level security`);
    await db.query(`grant select on customers to anon`);
    const report = await auditDatabaseSecurity(db, "staging");
    expect(report.ok).toBe(false);
    expect(level(report, "trigger:agent_actions_no_update")).toBe("fail");
    expect(report.checks.find((c) => c.id === "row-level-security")?.detail).toContain("orders");
    expect(report.checks.find((c) => c.id === "public-api-roles")?.detail).toContain("anon:customers");
    await db.close();
  });

  it("the least-privilege role script applies cleanly and leaves the app role unable to touch the audit log", async () => {
    const { pg, db } = await migrated();
    const sql = readFileSync(new URL("../../supabase/roles/least_privilege.sql", import.meta.url), "utf8");
    await pg.exec(sql);
    await pg.exec(sql); // idempotent
    const rights = await db.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants where grantee = 'zarghoon_app' and table_name = 'agent_actions' order by 1`,
    );
    expect(rights.map((r) => r.privilege_type)).toEqual(["INSERT", "SELECT"]);
    const hidden = await db.query(
      `select 1 from information_schema.role_table_grants where grantee = 'zarghoon_readonly' and table_name in ('staff_credentials', 'staff_sessions')`,
    );
    expect(hidden).toHaveLength(0);
    await db.close();
  });
});
