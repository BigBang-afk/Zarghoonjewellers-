import { createZarghoonCore } from "../../src/index.js";
import type { Clock } from "../../src/types/context.js";
import type { PgliteDb } from "./testDb.js";

export const createCore = (db: PgliteDb, clock?: Clock) => createZarghoonCore({ db, clock });
export type TestCore = ReturnType<typeof createCore>;

export async function auditTypes(db: PgliteDb, filter: { customerId?: string; conversationId?: string } = {}) {
  const rows = await db.query<{ action_type: string }>(
    `select action_type from agent_actions
      where ($1::uuid is null or customer_id = $1) and ($2::uuid is null or conversation_id = $2)
      order by created_at, id`,
    [filter.customerId ?? null, filter.conversationId ?? null],
  );
  return rows.map((r) => r.action_type);
}
