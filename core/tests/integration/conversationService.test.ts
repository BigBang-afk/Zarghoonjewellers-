import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ConversationClosedError,
  DuplicateConversationError,
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

beforeAll(async () => {
  t = await createTestDatabase();
  core = createCore(t.db);
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  staffId = await insertStaff(t.db, { role: "sales" });
  customerId = (await core.customers.createCustomer({ phone: "03001234567" }, AI_CTX)).customer.id;
});

const inbound = (conversationId: string, content: string, extra = {}) =>
  core.conversations.addMessage({ conversationId, direction: "inbound", senderType: "customer", content, ...extra }, AI_CTX);
const aiReply = (conversationId: string, content: string) =>
  core.conversations.addMessage({ conversationId, direction: "outbound", senderType: "ai", content }, AI_CTX);

describe("conversations", () => {
  it("creates anonymous conversations and attaches the customer once identified", async () => {
    const convo = await core.conversations.createConversation({ channel: "website" }, AI_CTX);
    expect(convo).toMatchObject({ customerId: null, status: "open", humanTakeover: false });
    const attached = await core.conversations.attachCustomer(convo.id, { customerId }, AI_CTX);
    expect(attached.customerId).toBe(customerId);
    const other = (await core.customers.createCustomer({ phone: "03007654321" }, AI_CTX)).customer.id;
    await expect(core.conversations.attachCustomer(convo.id, { customerId: other }, AI_CTX)).rejects.toBeInstanceOf(InvalidStateError);
  });

  it("rejects duplicate external conversation IDs per channel", async () => {
    await core.conversations.createConversation({ channel: "whatsapp", externalConversationId: "wa-1" }, AI_CTX);
    const err = await core.conversations
      .createConversation({ channel: "whatsapp", externalConversationId: "wa-1" }, AI_CTX)
      .catch((e) => e);
    expect(err).toBeInstanceOf(DuplicateConversationError);
    expect((await core.conversations.findConversationByExternalId("whatsapp", "wa-1"))?.id).toBe(err.existingConversationId);
    await core.conversations.createConversation({ channel: "website", externalConversationId: "wa-1" }, AI_CTX);
  });

  it("validates channel and lead ownership", async () => {
    await expect(core.conversations.createConversation({ channel: "telegram" } as never, AI_CTX)).rejects.toBeInstanceOf(ValidationError);
    const other = (await core.customers.createCustomer({ phone: "03007654321" }, AI_CTX)).customer.id;
    const lead = await core.leads.createLead({ customerId: other }, AI_CTX);
    await expect(
      core.conversations.createConversation({ channel: "website", customerId, leadId: lead.id }, AI_CTX),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });
});

describe("messages", () => {
  it("stores history and returns the most recent messages in order", async () => {
    const convo = await core.conversations.createConversation({ channel: "website", customerId }, AI_CTX);
    for (let i = 1; i <= 5; i++) {
      await inbound(convo.id, `customer ${i}`);
      await aiReply(convo.id, `ai ${i}`);
    }
    const recent = await core.conversations.getRecentMessages(convo.id, 3);
    expect(recent.map((m) => m.content)).toEqual(["ai 4", "customer 5", "ai 5"]);
    const updated = await core.conversations.getConversation(convo.id);
    expect(updated.lastMessageAt).toEqual(recent[2]!.createdAt);
    expect((await core.customers.getCustomer(customerId)).lastContactAt).toEqual(recent[2]!.createdAt);
  });

  it("enforces direction/sender consistency", async () => {
    const convo = await core.conversations.createConversation({ channel: "website" }, AI_CTX);
    await expect(
      core.conversations.addMessage({ conversationId: convo.id, direction: "inbound", senderType: "ai", content: "x" }, AI_CTX),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      core.conversations.addMessage({ conversationId: convo.id, direction: "outbound", senderType: "staff", content: "x" }, AI_CTX),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(inbound(convo.id, "   ")).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses secrets in metadata but accepts ordinary metadata", async () => {
    const convo = await core.conversations.createConversation({ channel: "website" }, AI_CTX);
    await expect(inbound(convo.id, "hi", { metadata: { headers: { authorization: "Bearer abc" } } })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const ok = await inbound(convo.id, "hi", { metadata: { page: "/bridal", utm_source: "google" } });
    expect(ok.message.metadata).toEqual({ page: "/bridal", utm_source: "google" });
  });

  it("is idempotent on external message IDs (channel redelivery)", async () => {
    const convo = await core.conversations.createConversation({ channel: "whatsapp" }, AI_CTX);
    const a = await inbound(convo.id, "Salam", { externalMessageId: "wamid.1" });
    const b = await inbound(convo.id, "Salam", { externalMessageId: "wamid.1" });
    expect(b).toMatchObject({ duplicate: true, message: { id: a.message.id } });
    expect(await core.conversations.getRecentMessages(convo.id)).toHaveLength(1);
  });

  it("stores per-message language without changing the customer's preference", async () => {
    const convo = await core.conversations.createConversation({ channel: "website", customerId }, AI_CTX);
    const { message } = await inbound(convo.id, "Ye set kitne ka hai?", { language: "roman_urdu" });
    expect(message.language).toBe("roman_urdu");
    expect((await core.customers.getCustomer(customerId)).preferredLanguage).toBe("unknown");
  });
});

describe("human takeover", () => {
  it("blocks AI replies during takeover, audits the attempt, and lets staff reply", async () => {
    const convo = await core.conversations.createConversation({ channel: "website", customerId }, AI_CTX);
    await core.conversations.setHumanTakeover(convo.id, { active: true, reason: "VIP customer" }, AI_CTX);
    await expect(aiReply(convo.id, "Let me help")).rejects.toBeInstanceOf(HumanTakeoverActiveError);
    const staffMsg = await core.conversations.addMessage(
      { conversationId: convo.id, direction: "outbound", senderType: "staff", senderStaffId: staffId, content: "Ji, main help karti hoon" },
      staffCtx(staffId),
    );
    expect(staffMsg.message.senderType).toBe("staff");
    expect(await inbound(convo.id, "Shukriya")).toMatchObject({ duplicate: false });
    expect(await auditTypes(t.db, { conversationId: convo.id })).toContain("ai_message_blocked");
  });

  it("is also enforced by the database trigger", async () => {
    const convo = await core.conversations.createConversation({ channel: "website" }, AI_CTX);
    await core.conversations.setHumanTakeover(convo.id, { active: true }, AI_CTX);
    await expect(
      t.db.query(`insert into messages (conversation_id, direction, sender_type, content) values ($1, 'outbound', 'ai', 'x')`, [convo.id]),
    ).rejects.toThrow(/human takeover active/);
  });

  it("only staff can release takeover", async () => {
    const convo = await core.conversations.createConversation({ channel: "website" }, AI_CTX);
    await core.conversations.setHumanTakeover(convo.id, { active: true }, AI_CTX);
    await expect(core.conversations.setHumanTakeover(convo.id, { active: false }, AI_CTX)).rejects.toBeInstanceOf(ForbiddenActionError);
    const released = await core.conversations.setHumanTakeover(convo.id, { active: false }, staffCtx(staffId));
    expect(released).toMatchObject({ humanTakeover: false, humanTakeoverAt: null });
    expect((await aiReply(convo.id, "Back to assist")).duplicate).toBe(false);
  });
});

describe("staff assignment and closing", () => {
  it("never auto-assigns unavailable or inactive staff", async () => {
    const convo = await core.conversations.createConversation({ channel: "website" }, AI_CTX);
    const away = await insertStaff(t.db, { isAvailable: false });
    const gone = await insertStaff(t.db, { isActive: false });
    await expect(core.conversations.assignStaff(convo.id, away, AI_CTX)).rejects.toBeInstanceOf(StaffUnavailableError);
    await expect(core.conversations.assignStaff(convo.id, gone, staffCtx(staffId))).rejects.toBeInstanceOf(StaffUnavailableError);
    expect((await core.conversations.assignStaff(convo.id, staffId, AI_CTX)).assignedStaffId).toBe(staffId);
  });

  it("closed conversations accept no new messages", async () => {
    const convo = await core.conversations.createConversation({ channel: "website", customerId }, AI_CTX);
    const closed = await core.conversations.closeConversation(convo.id, AI_CTX);
    expect(closed.status).toBe("closed");
    await expect(inbound(convo.id, "hello?")).rejects.toBeInstanceOf(ConversationClosedError);
    expect((await core.conversations.getCustomerConversations(customerId, { status: "closed" })).map((c) => c.id)).toEqual([convo.id]);
  });
});
