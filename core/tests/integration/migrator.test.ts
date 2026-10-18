import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { PgliteDb } from "../../src/database/pgliteDb.js";
import {
  applyMigrations,
  describeDatabase,
  initialiseDatabase,
  MigrationSafetyError,
  planMigrations,
  readMigrationFiles,
} from "../../src/database/migrator.js";

const freshDb = async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon nologin; create role authenticated nologin;`);
  return new PgliteDb(pg);
};

describe("safe migrator", () => {
  it("initialises a clean database, applies all migrations once, and is idempotent", async () => {
    const db = await freshDb();
    await initialiseDatabase(db, "staging");
    expect(await describeDatabase(db)).toMatchObject({ environment: "staging" });
    const files = readMigrationFiles();
    expect(await applyMigrations(db, "staging")).toEqual(files.map((f) => f.name));
    expect(await applyMigrations(db, "staging")).toEqual([]);
    expect((await planMigrations(db, "staging")).pending).toEqual([]);
    const [{ n }] = (await db.query<{ n: number }>(`select count(*)::int as n from information_schema.tables where table_schema='public'`)) as [{ n: number }];
    expect(n).toBeGreaterThanOrEqual(18);
    await db.close();
  });

  it("refuses an uninitialised database and a mismatched environment", async () => {
    const db = await freshDb();
    await expect(applyMigrations(db, "development")).rejects.toThrow(/not initialised/);
    await initialiseDatabase(db, "development");
    await expect(applyMigrations(db, "staging")).rejects.toThrow(/Environment mismatch/);
    await expect(initialiseDatabase(db, "staging")).rejects.toThrow(/already initialised/);
    await db.close();
  });

  it("refuses to take over a database that already has Zarghoon-named tables (possible real data)", async () => {
    const db = await freshDb();
    await db.query(`create table customers (id int)`);
    await expect(initialiseDatabase(db, "staging")).rejects.toThrow(MigrationSafetyError);
    await expect(initialiseDatabase(db, "staging")).rejects.toThrow(/customers/);
    await db.close();
  });

  it("detects edited historical migrations and out-of-order additions", async () => {
    const db = await freshDb();
    await initialiseDatabase(db, "development");
    const files = readMigrationFiles();
    await applyMigrations(db, "development", { files: files.slice(0, 2) });
    const tampered = files.map((f, i) => (i === 0 ? { ...f, sql: f.sql + "\n-- edited", checksum: "different" } : f));
    await expect(planMigrations(db, "development", tampered)).rejects.toThrow(/has been modified/);
    const outOfOrder = [...files.slice(0, 2), { name: "20200101000000_too_early.sql", sql: "select 1", checksum: "x" }].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    await expect(planMigrations(db, "development", outOfOrder)).rejects.toThrow(/missing|ordered before/);
    await db.close();
  });

  it("requires explicit approval for production", async () => {
    const db = await freshDb();
    await initialiseDatabase(db, "production");
    await expect(applyMigrations(db, "production")).rejects.toThrow(/explicit approval/);
    await db.close();
  });

  it("a failing migration leaves no partial state", async () => {
    const db = await freshDb();
    await initialiseDatabase(db, "development");
    const bad = [{ name: "20990101000000_bad.sql", sql: "create table ok_table (id int); select * from does_not_exist;", checksum: "c" }];
    await expect(applyMigrations(db, "development", { files: bad })).rejects.toThrow();
    const rows = await db.query(`select to_regclass('public.ok_table') as t`);
    expect(rows[0]).toEqual({ t: null });
    expect(await db.query(`select * from zarghoon_schema_migrations`)).toEqual([]);
    await db.close();
  });
});
