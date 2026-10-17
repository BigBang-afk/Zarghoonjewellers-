import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CustomerNotFoundError } from "../../src/lib/errors.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { createCore, type TestCore } from "../helpers/core.js";
import { AI_CTX, insertProduct, insertStaff } from "../helpers/fixtures.js";

let t: TestDatabase;
let core: TestCore;
beforeAll(async () => {
  t = await createTestDatabase();
  core = createCore(t.db);
});
afterAll(() => t.close());
beforeEach(() => t.reset());

async function insertOrder(customerId: string, status: string, total: string, number: string) {
  await t.db.query(
    `insert into orders (order_number, customer_id, status, subtotal, total) values ($1, $2, $3, $4, $4)`,
    [number, customerId, status, total],
  );
}

describe("getCustomer360", () => {
  it("returns empty/null for a brand-new customer without inventing anything", async () => {
    const { customer } = await core.customers.createCustomer({ phone: "03001234567" }, AI_CTX);
    const c360 = await core.customer360.getCustomer360(customer.id);
    expect(c360).toMatchObject({
      activeLead: null,
      leadScore: null,
      leadClassification: null,
      leadScoreBreakdown: [],
      productInterests: [],
      recentConversations: [],
      recentMessages: [],
      pendingFollowups: [],
      assignedStaff: null,
      doNotContact: false,
      humanTakeoverStatus: { active: false, conversationIds: [], openHandoffs: [] },
      ordersSummary: { totalOrders: 0, openOrders: 0, lifetimeValueByCurrency: {}, lastOrderAt: null },
    });
    expect(c360.customer.fullName).toBeNull();
  });

  it("assembles the full picture from stored facts", async () => {
    const staffId = await insertStaff(t.db, { fullName: "Bilal Ahmed", role: "sales" });
    const productId = await insertProduct(t.db, { sku: "ZJ-NK-001" });
    const { customer } = await core.customers.createCustomer({ phone: "03001234567", fullName: "Hina" }, AI_CTX);
    const lead = await core.leads.createLead({ customerId: customer.id, assignedStaffId: staffId, budgetAmount: "500000" }, AI_CTX);
    const convo = await core.conversations.createConversation({ channel: "website", customerId: customer.id, leadId: lead.id }, AI_CTX);
    const { message } = await core.conversations.addMessage(
      { conversationId: convo.id, direction: "inbound", senderType: "customer", content: "Is ZJ-NK-001 available?" },
      AI_CTX,
    );
    await core.productInterests.recordProductInterest(
      { customerId: customer.id, productId, interestType: "asked_availability", conversationId: convo.id, messageId: message.id },
      AI_CTX,
    );
    await core.followups.scheduleFollowup({ customerId: customer.id, leadId: lead.id, scheduledFor: new Date(Date.now() + 86_400_000) }, AI_CTX);
    await insertOrder(customer.id, "delivered", "150000.10", "ZJ-0001");
    await insertOrder(customer.id, "confirmed", "99999.95", "ZJ-0002");
    await insertOrder(customer.id, "cancelled", "50000.00", "ZJ-0003");
    await core.handoffs.requestHumanHandoff({ conversationId: convo.id, reason: "high_value_lead", urgency: "high" }, AI_CTX);

    const c360 = await core.customer360.getCustomer360(customer.id);
    expect(c360.activeLead?.id).toBe(lead.id);
    // provided_budget 15 + asked_availability 15 + specific_product_interest 15
    expect(c360.leadScore).toBe(45);
    expect(c360.leadClassification).toBe("warm");
    expect(c360.leadScoreBreakdown.map((b) => b.signal)).toEqual(["provided_budget", "specific_product_interest", "asked_availability"]);
    expect(c360.productInterests.map((p) => p.productSku)).toEqual(["ZJ-NK-001"]);
    expect(c360.recentConversations.map((c) => c.id)).toEqual([convo.id]);
    expect(c360.recentMessages.map((m) => m.content)).toEqual(["Is ZJ-NK-001 available?"]);
    expect(c360.pendingFollowups).toHaveLength(1);
    expect(c360.assignedStaff).toMatchObject({ id: staffId, fullName: "Bilal Ahmed" });
    expect(c360.ordersSummary).toMatchObject({
      totalOrders: 3,
      openOrders: 1,
      deliveredOrders: 1,
      cancelledOrRefundedOrders: 1,
      lifetimeValueByCurrency: { PKR: "250000.05" },
    });
    expect(c360.humanTakeoverStatus).toMatchObject({ active: true, conversationIds: [convo.id] });
    expect(c360.humanTakeoverStatus.openHandoffs[0]).toMatchObject({ reason: "high_value_lead", urgency: "high" });
  });

  it("throws for unknown customers", async () => {
    await expect(core.customer360.getCustomer360("00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(CustomerNotFoundError);
  });
});
