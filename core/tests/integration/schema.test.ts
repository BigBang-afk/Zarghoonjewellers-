import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { insertProduct, insertStaff } from "../helpers/fixtures.js";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

describe("database constraints", () => {
  it("creates all core and CRM tables", async () => {
    const rows = await t.db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        "customers", "products", "product_images", "leads", "conversations", "messages",
        "product_interests", "followups", "staff", "orders", "order_items", "agent_actions",
        "approvals", "customer_identities", "lead_signal_events", "handoffs",
      ]),
    );
  });

  it("enforces unique, well-formed SKUs", async () => {
    await insertProduct(t.db, { sku: "ZJ-BR-001" });
    await expect(insertProduct(t.db, { sku: "ZJ-BR-001" })).rejects.toMatchObject({ code: "23505" });
    await expect(insertProduct(t.db, { sku: "zj-br-002" })).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects negative prices, non-positive weights and inconsistent stock", async () => {
    await expect(insertProduct(t.db, { sku: "ZJ-A-1", approvedPrice: "-1.00" })).rejects.toMatchObject({ code: "23514" });
    await expect(insertProduct(t.db, { sku: "ZJ-A-2", weightGrams: "0" })).rejects.toMatchObject({ code: "23514" });
    await expect(insertProduct(t.db, { sku: "ZJ-A-3", stockStatus: "out_of_stock", stockQuantity: 4 })).rejects.toMatchObject({ code: "23514" });
    await expect(insertProduct(t.db, { sku: "ZJ-A-4", stockStatus: "in_stock" })).rejects.toMatchObject({ code: "23514" });
  });

  it("stores money exactly as NUMERIC", async () => {
    const id = await insertProduct(t.db, { approvedPrice: "999999999999.99" });
    const [row] = await t.db.query<{ approved_price: string }>(`select approved_price from products where id = $1`, [id]);
    expect(row!.approved_price).toBe("999999999999.99");
  });

  it("keeps agent_actions append-only", async () => {
    const [a] = await t.db.query<{ id: string }>(
      `insert into agent_actions (action_type, actor_type, status) values ('x', 'system', 'succeeded') returning id`,
    );
    await expect(t.db.query(`update agent_actions set status = 'failed' where id = $1`, [a!.id])).rejects.toThrow(/append-only/);
    await expect(t.db.query(`delete from agent_actions where id = $1`, [a!.id])).rejects.toThrow(/append-only/);
  });

  it("enforces message direction/sender consistency", async () => {
    const [c] = await t.db.query<{ id: string }>(`insert into conversations (channel) values ('website') returning id`);
    await expect(
      t.db.query(`insert into messages (conversation_id, direction, sender_type, content) values ($1, 'inbound', 'ai', 'hi')`, [c!.id]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("requires a decider on approved approvals", async () => {
    await expect(
      t.db.query(`insert into approvals (action_type, status, requested_by_type, reason, decided_at) values ('refund', 'approved', 'ai', 'r', now())`),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("row level security", () => {
  it("enables RLS on every table", async () => {
    const rows = await t.db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(16);
    expect(rows.filter((r) => !r.relrowsecurity)).toEqual([]);
  });

  it("denies anonymous and authenticated roles any direct table access", async () => {
    await insertStaff(t.db);
    for (const role of ["anon", "authenticated"]) {
      for (const table of ["customers", "leads", "staff", "orders", "messages", "agent_actions", "approvals", "products"]) {
        // SET LOCAL inside a transaction: the role change cannot leak to other pooled connections.
        await expect(
          t.db.transaction(async (tx) => {
            await tx.query(`set local role ${role}`);
            await tx.query(`select * from ${table}`);
          }),
        ).rejects.toThrow(/permission denied/);
      }
    }
  });
});
