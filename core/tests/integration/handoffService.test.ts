import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ConversationClosedError,
  ForbiddenActionError,
  HumanTakeoverActiveError,
  InvalidStateError,
  StaffUnavailableError,
  ValidationError,
} from "../../src/lib/errors.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { auditTypes, createCore, type TestCore } from "../helpers/core.js";
import { AI_CTX, insertStaff, staffCtx } from "../helpers/fixtures.js";

let t: TestDatabase;
let core: TestCore;
let customerId: string;
let staffId: string;
let conversationId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  core = createCore(t.db);
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  staffId = await insertStaff(t.db, { role: "sales" });
  customerId = (await core.customers.createCustomer({ phone: "03001234567" }, AI_CTX)).customer.id;
  conversationId = (await core.conversations.createConversation({ channel: "website", customerId }, AI_CTX)).id;
});

describe("requestHumanHandoff", () => {
  it("activates takeover, updates the lead, preserves the reason and audits", async () => {
    const lead = await core.leads.createLead({ customerId }, AI_CTX);
    const res = await core.handoffs.requestHumanHandoff(
      { conversationId, customerId, reason: "customer_requested", urgency: "high", note: "Wants to speak to a person" },
      AI_CTX,
    );
    expect(res.alreadyActive).toBe(false);
    expect(res.handoff).toMatchObject({ reason: "customer_requested", urgency: "high", status: "open", leadId: lead.id, assignedStaffId: null });
    expect(res.conversation).toMatchObject({ humanTakeover: true, humanTakeoverReason: "customer_requested", leadId: lead.id });
    expect(res.lead).toMatchObject({ status: "human_followup", score: 15 }); // requested_human_salesperson
    expect(await auditTypes(t.db, { conversationId })).toContain("human_handoff_requested");

    // Autonomous replies are now blocked.
    await expect(
      core.conversations.addMessage({ conversationId, direction: "outbound", senderType: "ai", content: "Hi" }, AI_CTX),
    ).rejects.toBeInstanceOf(HumanTakeoverActiveError);
  });

  it("does not reopen or alter closed leads", async () => {
    const lead = await core.leads.createLead({ customerId }, AI_CTX);
    await core.leads.markLeadLost(lead.id, "Not interested", staffCtx(staffId));
    const res = await core.handoffs.requestHumanHandoff({ conversationId, leadId: lead.id, reason: "complaint" }, AI_CTX);
    expect(res.lead?.status).toBe("lost");
    expect(res.conversation.humanTakeover).toBe(true);
  });

  it("is idempotent while a handoff is open and only escalates urgency", async () => {
    const first = await core.handoffs.requestHumanHandoff({ conversationId, reason: "discount_request" }, AI_CTX);
    const second = await core.handoffs.requestHumanHandoff({ conversationId, reason: "discount_request", urgency: "urgent" }, AI_CTX);
    expect(second).toMatchObject({ alreadyActive: true, handoff: { id: first.handoff.id, urgency: "urgent" } });
    const third = await core.handoffs.requestHumanHandoff({ conversationId, reason: "other", urgency: "normal" }, AI_CTX);
    expect(third.handoff.urgency).toBe("urgent");
    expect(await core.handoffs.getOpenHandoffs()).toHaveLength(1);
  });

  it("never assigns unavailable staff automatically", async () => {
    const away = await insertStaff(t.db, { isAvailable: false });
    await expect(
      core.handoffs.requestHumanHandoff({ conversationId, reason: "high_value_lead", preferredStaffId: away }, AI_CTX),
    ).rejects.toBeInstanceOf(StaffUnavailableError);
    // Nothing was changed by the failed attempt.
    expect((await core.conversations.getConversation(conversationId)).humanTakeover).toBe(false);
    const ok = await core.handoffs.requestHumanHandoff({ conversationId, reason: "high_value_lead", preferredStaffId: staffId }, AI_CTX);
    expect(ok.handoff.assignedStaffId).toBe(staffId);
    expect(ok.conversation.assignedStaffId).toBe(staffId);
  });

  it("validates input and conversation state", async () => {
    await expect(core.handoffs.requestHumanHandoff({ conversationId, reason: "bored" } as never, AI_CTX)).rejects.toBeInstanceOf(
      ValidationError,
    );
    const other = (await core.customers.createCustomer({ phone: "03007654321" }, AI_CTX)).customer.id;
    await expect(
      core.handoffs.requestHumanHandoff({ conversationId, customerId: other, reason: "other" }, AI_CTX),
    ).rejects.toBeInstanceOf(InvalidStateError);
    await core.conversations.closeConversation(conversationId, AI_CTX);
    await expect(core.handoffs.requestHumanHandoff({ conversationId, reason: "complaint" }, AI_CTX)).rejects.toBeInstanceOf(
      ConversationClosedError,
    );
  });
});

describe("resolveHandoff", () => {
  it("is staff-only and can hand the conversation back to the AI", async () => {
    const { handoff } = await core.handoffs.requestHumanHandoff({ conversationId, reason: "payment_issue", urgency: "urgent" }, AI_CTX);
    await expect(core.handoffs.resolveHandoff(handoff.id, AI_CTX)).rejects.toBeInstanceOf(ForbiddenActionError);
    const resolved = await core.handoffs.resolveHandoff(handoff.id, staffCtx(staffId), { releaseTakeover: true, note: "Payment confirmed by bank" });
    expect(resolved).toMatchObject({ status: "resolved", resolvedByStaffId: staffId });
    expect((await core.conversations.getConversation(conversationId)).humanTakeover).toBe(false);
    await expect(core.handoffs.resolveHandoff(handoff.id, staffCtx(staffId))).rejects.toBeInstanceOf(InvalidStateError);
  });

  it("keeps takeover active unless explicitly released", async () => {
    const { handoff } = await core.handoffs.requestHumanHandoff({ conversationId, reason: "custom_order" }, AI_CTX);
    await core.handoffs.resolveHandoff(handoff.id, staffCtx(staffId));
    expect((await core.conversations.getConversation(conversationId)).humanTakeover).toBe(true);
  });

  it("orders the open queue by urgency", async () => {
    const c2 = (await core.conversations.createConversation({ channel: "website" }, AI_CTX)).id;
    await core.handoffs.requestHumanHandoff({ conversationId, reason: "other", urgency: "normal" }, AI_CTX);
    await core.handoffs.requestHumanHandoff({ conversationId: c2, reason: "complaint", urgency: "urgent" }, AI_CTX);
    expect((await core.handoffs.getOpenHandoffs()).map((h) => h.urgency)).toEqual(["urgent", "normal"]);
  });
});
