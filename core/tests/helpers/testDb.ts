import { createInMemoryDb, PgliteDb } from "../../src/database/pgliteDb.js";

/**
 * Test databases are in-process PostgreSQL (PGlite) with the real migrations
 * applied: genuine SQL, constraints and triggers, no credentials, no
 * production access.
 */

export { PgliteDb };

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
  const db = await createInMemoryDb();
  return {
    db,
    reset: async () => {
      await db.pg.exec(`truncate ${ALL_TABLES.join(", ")} restart identity cascade`);
    },
    close: () => db.close(),
  };
}
