import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InvalidStateError, ProductNotFoundError, ValidationError } from "../../src/lib/errors.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { createCore, type TestCore } from "../helpers/core.js";
import { AI_CTX, insertProduct } from "../helpers/fixtures.js";

let t: TestDatabase;
let core: TestCore;
let customerId: string;
let productId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  core = createCore(t.db);
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  productId = await insertProduct(t.db, { sku: "ZJ-NK-001" });
  customerId = (await core.customers.createCustomer({ phone: "03001234567" }, AI_CTX)).customer.id;
});

describe("recordProductInterest", () => {
  it("requires a real product (by id or SKU)", async () => {
    await expect(
      core.productInterests.recordProductInterest({ customerId, sku: "ZJ-XX-404", interestType: "viewed" }, AI_CTX),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
    await expect(
      core.productInterests.recordProductInterest(
        { customerId, productId: "00000000-0000-0000-0000-000000000000", interestType: "viewed" },
        AI_CTX,
      ),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
    await expect(
      core.productInterests.recordProductInterest({ customerId, productId, sku: "ZJ-NK-001", interestType: "viewed" }, AI_CTX),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      core.productInterests.recordProductInterest({ customerId, sku: "ZJ-NK-001", interestType: "loved" } as never, AI_CTX),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("attaches to the active lead and records deterministic signals", async () => {
    const lead = await core.leads.createLead({ customerId }, AI_CTX);
    const res = await core.productInterests.recordProductInterest({ customerId, sku: "zj-nk-001", interestType: "asked_price" }, AI_CTX);
    expect(res.interest).toMatchObject({ leadId: lead.id, productId, productSku: "ZJ-NK-001", interestType: "asked_price" });
    expect(res.signalsRecorded).toEqual(["asked_price", "specific_product_interest"]);
    expect(res.leadScore?.score).toBe(25);
  });

  it("records repeated_product_interest on a second engagement with the same product", async () => {
    await core.leads.createLead({ customerId }, AI_CTX);
    await core.productInterests.recordProductInterest({ customerId, productId, interestType: "asked_price" }, AI_CTX);
    const second = await core.productInterests.recordProductInterest({ customerId, productId, interestType: "shortlisted" }, AI_CTX);
    expect(second.signalsRecorded).toEqual(["repeated_product_interest"]);
    expect(second.leadScore?.score).toBe(35);
  });

  it("does not treat browsing as intent", async () => {
    await core.leads.createLead({ customerId }, AI_CTX);
    const res = await core.productInterests.recordProductInterest({ customerId, productId, interestType: "viewed" }, AI_CTX);
    expect(res.signalsRecorded).toEqual([]);
  });

  it("works without a lead and is idempotent per message", async () => {
    const convo = await core.conversations.createConversation({ channel: "website", customerId }, AI_CTX);
    const { message } = await core.conversations.addMessage(
      { conversationId: convo.id, direction: "inbound", senderType: "customer", content: "Price of ZJ-NK-001?" },
      AI_CTX,
    );
    const input = { customerId, productId, interestType: "asked_price" as const, conversationId: convo.id, messageId: message.id };
    const first = await core.productInterests.recordProductInterest(input, AI_CTX);
    expect(first).toMatchObject({ duplicate: false, signalsRecorded: [], leadScore: null, interest: { leadId: null } });
    const again = await core.productInterests.recordProductInterest(input, AI_CTX);
    expect(again.duplicate).toBe(true);
    expect(again.interest.id).toBe(first.interest.id);
    expect(await core.productInterests.getCustomerProductInterests(customerId)).toHaveLength(1);
  });

  it("refuses cross-customer references", async () => {
    const other = (await core.customers.createCustomer({ phone: "03007654321" }, AI_CTX)).customer.id;
    const otherLead = await core.leads.createLead({ customerId: other }, AI_CTX);
    const otherConvo = await core.conversations.createConversation({ channel: "website", customerId: other }, AI_CTX);
    await expect(
      core.productInterests.recordProductInterest({ customerId, productId, interestType: "viewed", leadId: otherLead.id }, AI_CTX),
    ).rejects.toBeInstanceOf(InvalidStateError);
    await expect(
      core.productInterests.recordProductInterest({ customerId, productId, interestType: "viewed", conversationId: otherConvo.id }, AI_CTX),
    ).rejects.toBeInstanceOf(InvalidStateError);
  });

  it("lists interests by customer and by lead", async () => {
    const lead = await core.leads.createLead({ customerId }, AI_CTX);
    await core.productInterests.recordProductInterest({ customerId, productId, interestType: "viewed" }, AI_CTX);
    expect(await core.productInterests.getLeadProductInterests(lead.id)).toHaveLength(1);
    expect((await core.productInterests.getCustomerProductInterests(customerId))[0]!.productName).toBe("Bridal Kundan Necklace");
  });
});
