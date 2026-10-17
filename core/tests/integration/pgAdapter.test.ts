import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgDb, type PgDb } from "../../src/database/db.js";
import { createZarghoonCore } from "../../src/index.js";
import { CustomerIdentityConflictError, DuplicateLeadSignalError, HumanTakeoverActiveError } from "../../src/lib/errors.js";
import { AI_CTX } from "../helpers/fixtures.js";

/**
 * Opt-in: exercises the production node-postgres adapter against a real,
 * DISPOSABLE Postgres with migrations applied. Never point this at production.
 *   TEST_DATABASE_URL=postgres://... npx vitest run tests/integration/pgAdapter.test.ts
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("node-postgres adapter (real Postgres)", () => {
  let db: PgDb;
  beforeAll(async () => {
    db = createPgDb(url!);
    await db.query(`truncate agent_actions, handoffs, lead_signal_events, product_interests, followups, messages,
                    conversations, order_items, orders, approvals, leads, customer_identities, customers,
                    product_images, products, staff restart identity cascade`);
  });
  afterAll(() => db.end());

  it("runs a full CRM flow with transactions, rollback and typed errors", async () => {
    const core = createZarghoonCore({ db });
    const { customer } = await core.customers.createCustomer({ phone: "03001234567", email: "pg@example.com" }, AI_CTX);
    await core.customers.createCustomer({ phone: "03007654321" }, AI_CTX);
    await expect(core.customers.createCustomer({ phone: "03007654321", email: "pg@example.com" }, AI_CTX)).rejects.toBeInstanceOf(
      CustomerIdentityConflictError,
    );

    const lead = await core.leads.createLead({ customerId: customer.id, budgetAmount: "750000.50" }, AI_CTX);
    expect(lead.budgetAmount).toBe("750000.50");
    await core.leads.recordLeadSignal(lead.id, { signal: "asked_price" }, AI_CTX);
    await expect(core.leads.recordLeadSignal(lead.id, { signal: "asked_price" }, AI_CTX)).rejects.toBeInstanceOf(
      DuplicateLeadSignalError,
    );

    const convo = await core.conversations.createConversation({ channel: "website", customerId: customer.id }, AI_CTX);
    await core.handoffs.requestHumanHandoff({ conversationId: convo.id, reason: "customer_requested" }, AI_CTX);
    await expect(
      core.conversations.addMessage({ conversationId: convo.id, direction: "outbound", senderType: "ai", content: "hi" }, AI_CTX),
    ).rejects.toBeInstanceOf(HumanTakeoverActiveError);

    const c360 = await core.customer360.getCustomer360(customer.id);
    expect(c360).toMatchObject({ leadScore: 40, leadClassification: "warm", humanTakeoverStatus: { active: true } });
    expect(c360.activeLead?.status).toBe("human_followup");
  });
});
