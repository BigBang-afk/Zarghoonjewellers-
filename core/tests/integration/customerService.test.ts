import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CustomerIdentityConflictError,
  ForbiddenActionError,
  InvalidStateError,
  ValidationError,
} from "../../src/lib/errors.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { auditTypes, createCore, type TestCore } from "../helpers/core.js";
import { AI_CTX, insertStaff, staffCtx } from "../helpers/fixtures.js";

let t: TestDatabase;
let core: TestCore;
beforeAll(async () => {
  t = await createTestDatabase();
  core = createCore(t.db);
});
afterAll(() => t.close());
beforeEach(() => t.reset());

describe("createCustomer", () => {
  it("creates a customer with normalized identifiers and audits it", async () => {
    const res = await core.customers.createCustomer(
      { fullName: " Sana Malik ", phone: "0300-1234567", email: " Sana@Example.com ", city: "Lahore" },
      AI_CTX,
    );
    expect(res.outcome).toBe("created");
    expect(res.customer).toMatchObject({
      fullName: "Sana Malik",
      phone: "+923001234567",
      whatsappNumber: null,
      email: "sana@example.com",
      preferredLanguage: "unknown",
      doNotContact: false,
    });
    expect(await auditTypes(t.db, { customerId: res.customer.id })).toEqual(["customer_created"]);
  });

  it("does not fabricate missing data", async () => {
    const { customer } = await core.customers.createCustomer({ whatsappNumber: "+923001112233" }, AI_CTX);
    expect(customer).toMatchObject({ fullName: null, phone: null, email: null, city: null, notes: null });
  });

  it("requires at least one identifier and rejects invalid ones", async () => {
    await expect(core.customers.createCustomer({ fullName: "No Contact" }, AI_CTX)).rejects.toBeInstanceOf(ValidationError);
    await expect(core.customers.createCustomer({ phone: "12345" }, AI_CTX)).rejects.toBeInstanceOf(ValidationError);
    await expect(core.customers.createCustomer({ email: "nope" }, AI_CTX)).rejects.toBeInstanceOf(ValidationError);
    await expect(core.customers.createCustomer({ phone: "03001234567", ssn: "x" } as never, AI_CTX)).rejects.toBeInstanceOf(ValidationError);
  });

  it("returns the existing customer instead of creating a duplicate", async () => {
    const first = await core.customers.createCustomer({ phone: "03001234567" }, AI_CTX);
    const again = await core.customers.createCustomer({ phone: "+92 300 1234567", fullName: "Different Name" }, AI_CTX);
    expect(again.outcome).toBe("existing");
    expect(again.customer.id).toBe(first.customer.id);
    expect(again.customer.fullName).toBeNull(); // nothing was overwritten
    const n = (await t.db.query<{ n: number }>(`select count(*)::int as n from customers`))[0]!.n;
    expect(n).toBe(1);
  });

  it("treats WhatsApp and phone numbers as one identity namespace", async () => {
    const first = await core.customers.createCustomer({ phone: "03001234567" }, AI_CTX);
    const viaWhatsapp = await core.customers.createCustomer({ whatsappNumber: "923001234567" }, AI_CTX);
    expect(viaWhatsapp).toMatchObject({ outcome: "existing", customer: { id: first.customer.id } });
    expect(viaWhatsapp.outcome === "existing" && viaWhatsapp.matchedOn[0]!.identifier).toBe("phone");
  });

  it("matches by external identity", async () => {
    const first = await core.customers.createCustomer(
      { email: "a@example.com", externalIdentities: [{ type: "instagram", value: "@Zara.Style" }] },
      AI_CTX,
    );
    const again = await core.customers.createCustomer({ externalIdentities: [{ type: "instagram", value: "zara.style" }] }, AI_CTX);
    expect(again.customer.id).toBe(first.customer.id);
  });

  it("raises an identity conflict (and never merges) when identifiers point at different customers", async () => {
    const a = await core.customers.createCustomer({ phone: "03001234567" }, AI_CTX);
    const b = await core.customers.createCustomer({ email: "b@example.com" }, AI_CTX);
    const err = await core.customers
      .createCustomer({ phone: "03001234567", email: "b@example.com" }, AI_CTX)
      .catch((e) => e);
    expect(err).toBeInstanceOf(CustomerIdentityConflictError);
    expect(err.customerIds).toEqual([a.customer.id, b.customer.id].sort());
    const n = (await t.db.query<{ n: number }>(`select count(*)::int as n from customers`))[0]!.n;
    expect(n).toBe(2);
    expect(await core.customers.getCustomer(a.customer.id)).toMatchObject({ email: null });
    expect(await auditTypes(t.db)).toContain("customer_identity_conflict");
  });
});

describe("finders", () => {
  it("find by phone (either column), email and external identity", async () => {
    const { customer } = await core.customers.createCustomer(
      { whatsappNumber: "03004445566", email: "x@example.com", externalIdentities: [{ type: "website_visitor", value: "v-1" }] },
      AI_CTX,
    );
    expect((await core.customers.findCustomerByPhone("0300 4445566"))?.id).toBe(customer.id);
    expect((await core.customers.findCustomerByEmail("X@EXAMPLE.COM"))?.id).toBe(customer.id);
    expect((await core.customers.findCustomerByExternalIdentity("website_visitor", "v-1"))?.id).toBe(customer.id);
    expect(await core.customers.findCustomerByPhone("03009999999")).toBeNull();
    expect(await core.customers.findCustomerById("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("throws a conflict when a phone matches two records", async () => {
    await core.customers.createCustomer({ phone: "03001234567" }, AI_CTX);
    const b = await core.customers.createCustomer({ email: "b@example.com" }, AI_CTX);
    // Constructed directly to simulate legacy data where another record holds the number as WhatsApp.
    await t.db.query(`update customers set whatsapp_number = '+923001234567' where id = $1`, [b.customer.id]);
    await expect(core.customers.findCustomerByPhone("03001234567")).rejects.toBeInstanceOf(CustomerIdentityConflictError);
  });
});

describe("updateCustomer", () => {
  it("updates only provided fields and audits the diff", async () => {
    const { customer } = await core.customers.createCustomer({ phone: "03001234567", fullName: "Sana", city: "Lahore" }, AI_CTX);
    const updated = await core.customers.updateCustomer(customer.id, { email: "sana@example.com" }, AI_CTX);
    expect(updated).toMatchObject({ email: "sana@example.com", fullName: "Sana", city: "Lahore" });
    const cleared = await core.customers.updateCustomer(customer.id, { city: null }, AI_CTX);
    expect(cleared.city).toBeNull();
    expect(cleared.fullName).toBe("Sana");
    expect(await auditTypes(t.db, { customerId: customer.id })).toEqual(["customer_created", "customer_updated", "customer_updated"]);
  });

  it("refuses identifiers that belong to another customer", async () => {
    const a = await core.customers.createCustomer({ phone: "03001234567" }, AI_CTX);
    const b = await core.customers.createCustomer({ phone: "03007654321" }, AI_CTX);
    await expect(core.customers.updateCustomer(b.customer.id, { whatsappNumber: "03001234567" }, AI_CTX)).rejects.toBeInstanceOf(
      CustomerIdentityConflictError,
    );
    expect((await core.customers.getCustomer(b.customer.id)).whatsappNumber).toBeNull();
    expect(a.customer.id).not.toBe(b.customer.id);
  });

  it("refuses to remove the last identifier", async () => {
    const { customer } = await core.customers.createCustomer({ phone: "03001234567" }, AI_CTX);
    await expect(core.customers.updateCustomer(customer.id, { phone: null }, AI_CTX)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("preferred language", () => {
  it("lets staff set it but requires the AI to cite the customer's own inbound message", async () => {
    const staff = await insertStaff(t.db);
    const { customer } = await core.customers.createCustomer({ phone: "03001234567" }, AI_CTX);
    await expect(core.customers.setPreferredLanguage(customer.id, { language: "urdu" }, AI_CTX)).rejects.toBeInstanceOf(
      ForbiddenActionError,
    );

    const convo = await core.conversations.createConversation({ channel: "website", customerId: customer.id }, AI_CTX);
    const outbound = await core.conversations.addMessage(
      { conversationId: convo.id, direction: "outbound", senderType: "ai", content: "Assalam o Alaikum!" },
      AI_CTX,
    );
    await expect(
      core.customers.setPreferredLanguage(customer.id, { language: "urdu", evidenceMessageId: outbound.message.id }, AI_CTX),
    ).rejects.toBeInstanceOf(InvalidStateError);

    const inbound = await core.conversations.addMessage(
      { conversationId: convo.id, direction: "inbound", senderType: "customer", content: "Please reply in Urdu", language: "english" },
      AI_CTX,
    );
    // Message language is per-message only; the profile is unchanged until explicitly set.
    expect((await core.customers.getCustomer(customer.id)).preferredLanguage).toBe("unknown");
    const updated = await core.customers.setPreferredLanguage(
      customer.id,
      { language: "urdu", evidenceMessageId: inbound.message.id },
      AI_CTX,
    );
    expect(updated.preferredLanguage).toBe("urdu");
    expect((await core.customers.setPreferredLanguage(customer.id, { language: "roman_urdu" }, staffCtx(staff))).preferredLanguage).toBe(
      "roman_urdu",
    );
  });
});

describe("external identities and do-not-contact", () => {
  it("links an unclaimed identity and refuses one owned by someone else", async () => {
    const a = await core.customers.createCustomer({ phone: "03001234567" }, AI_CTX);
    const b = await core.customers.createCustomer({ phone: "03007654321", externalIdentities: [{ type: "facebook", value: "fb-9" }] }, AI_CTX);
    const ids = await core.customers.linkExternalIdentity(a.customer.id, { type: "instagram", value: "@sana" }, AI_CTX);
    expect(ids).toEqual([{ type: "instagram", value: "sana", isVerified: false }]);
    await expect(core.customers.linkExternalIdentity(a.customer.id, { type: "facebook", value: "fb-9" }, AI_CTX)).rejects.toBeInstanceOf(
      CustomerIdentityConflictError,
    );
    expect(b.customer.id).toBeDefined();
  });

  it("only staff can clear do-not-contact", async () => {
    const staff = await insertStaff(t.db);
    const { customer } = await core.customers.createCustomer({ phone: "03001234567" }, AI_CTX);
    await core.customers.setDoNotContact(customer.id, AI_CTX, "Customer asked us to stop messaging");
    expect((await core.customers.getCustomer(customer.id)).doNotContact).toBe(true);
    await expect(core.customers.clearDoNotContact(customer.id, AI_CTX, "x")).rejects.toBeInstanceOf(ForbiddenActionError);
    expect((await core.customers.clearDoNotContact(customer.id, staffCtx(staff), "Customer visited the shop and asked to be contacted")).doNotContact).toBe(false);
  });

  it("returns a lightweight summary", async () => {
    const { customer } = await core.customers.createCustomer({ phone: "03001234567" }, AI_CTX);
    const summary = await core.customers.getCustomerSummary(customer.id);
    expect(summary).toMatchObject({ activeLead: null, openConversations: 0, pendingFollowups: 0, totalOrders: 0 });
  });
});
