import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSalesAgent } from "../../src/agents/sales/salesAgent.js";
import { UNCONFIGURED_BUSINESS_INFO } from "../../src/config/businessInfo.js";
import { createOfflineDemoModel, parseBudget } from "../../src/demo/offlineDemoModel.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { createCore } from "../helpers/core.js";
import { insertProduct } from "../helpers/fixtures.js";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  await insertProduct(t.db, { sku: "TST-NK-001", name: "Test Necklace", approvedPrice: "495000", stockStatus: "low_stock", stockQuantity: 1 });
  await insertProduct(t.db, { sku: "TST-NK-002", name: "Test Haar", approvedPrice: "720000", stockStatus: null, stockQuantity: null });
  await insertProduct(t.db, { sku: "TST-RG-001", name: "Test Ring", category: "ring", karat: 18, approvedPrice: null, stockStatus: null, stockQuantity: null });
});

async function ask(message: string) {
  const core = createCore(t.db);
  const { customer } = await core.customers.createCustomer({ email: `t${Date.now()}${Math.random()}@example.invalid` }, { actor: { type: "system" } });
  const agent = createSalesAgent({ core, llm: createOfflineDemoModel({ annotate: false }), businessInfo: UNCONFIGURED_BUSINESS_INFO });
  return agent.handleMessage({ customerId: customer.id, message });
}

describe("offline demo model", () => {
  it("parses only explicit budgets", () => {
    expect(parseBudget("Show me 22K necklaces under Rs 500,000")).toBe("500000");
    expect(parseBudget("budget is 5 lakh")).toBe("500000");
    expect(parseBudget("a 22K necklace")).toBeNull();
  });

  it("applies the budget to the real search", async () => {
    const r = await ask("Show me 22K necklaces under Rs 500,000");
    expect(r.productsReferenced.map((p) => p.sku)).toEqual(["TST-NK-001"]);
    expect(r).toMatchObject({ intent: "budget_search", leadScore: 15 });
  });

  it("answers SKU stock and price questions only from stored data", async () => {
    const stock = await ask("Is TST-NK-001 in stock?");
    expect(stock.reply).toContain("PKR 495,000");
    expect(stock.reply).toContain("is available");
    const price = await ask("What is the price of TST-RG-001?");
    expect(price.reply).toContain("price to be confirmed by our team");
    expect(price.reply).toContain("our team will confirm availability");
    expect(price.reply).not.toMatch(/PKR \d/);
    const missing = await ask("Price of TST-XX-999?");
    expect(missing.reply).toMatch(/couldn't find/);
  });
});
