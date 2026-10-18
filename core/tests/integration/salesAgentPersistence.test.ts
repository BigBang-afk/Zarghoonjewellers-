import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { lastToolResult, ScriptedLlmClient, toolUseBlock } from "../../src/agents/llm/scriptedLlmClient.js";
import { createSalesAgent } from "../../src/agents/sales/salesAgent.js";
import { UNCONFIGURED_BUSINESS_INFO } from "../../src/config/businessInfo.js";
import type { SourceProductInput } from "../../src/services/products/sync/sourceProduct.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { createCore, type TestCore } from "../helpers/core.js";
import { insertStaff, staffCtx } from "../helpers/fixtures.js";
import { call, submit } from "../agents/harness.js";

/**
 * The Sales Agent over products that entered the catalogue through the
 * approved sync pipeline, with every CRM effect checked in the database.
 * Runs on PGlite by default and on real PostgreSQL with ZARGHOON_TEST_PG_ADMIN_URL.
 * (The model is scripted: real Claude reasoning needs ANTHROPIC_API_KEY.)
 */

let t: TestDatabase;
let core: TestCore;
let ids: Record<string, string>;

const SYNCED: SourceProductInput[] = [
  { sourceProductId: "w1", sku: "STG-NK-001", name: "STAGING SAMPLE Bridal Kundan Necklace", category: "Necklace", metal: "gold", karat: 22, weightGrams: "48.25", price: "495000", stockQuantity: 1, stockStatus: "low_stock" },
  { sourceProductId: "w2", sku: "STG-NK-002", name: "STAGING SAMPLE Heavy Rani Haar", category: "Necklace", metal: "gold", karat: 22, weightGrams: "95", price: "720000" },
  { sourceProductId: "w3", sku: "STG-NK-003", name: "STAGING SAMPLE 18K Choker", category: "Necklace", metal: "gold", karat: 18, price: "310000" },
  { sourceProductId: "w4", sku: "STG-RG-001", name: "STAGING SAMPLE Solitaire Ring", category: "Ring", karat: 18, stockStatus: "made_to_order" },
  { sourceProductId: "w5", sku: "STG-BG-001", name: "STAGING SAMPLE Classic Bangles", category: "Bangle", karat: 22, price: "372000" },
];

beforeAll(async () => {
  t = await createTestDatabase();
  core = createCore(t.db);
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  const manager = await insertStaff(t.db, { role: "manager" });
  const b = { source: "website_export", records: SYNCED, warnings: {} };
  const preview = await core.productSync.previewSync(b);
  const approval = await core.productSync.requestApproval(preview, staffCtx(manager));
  await core.approvals.approve(approval.id, staffCtx(manager));
  await core.productSync.applySync(b, approval.id, staffCtx(manager));
  ids = Object.fromEntries((await t.db.query<{ sku: string; id: string }>(`select sku, id from products`)).map((r) => [r.sku, r.id]));
});

const agentWith = (steps: ConstructorParameters<typeof ScriptedLlmClient>[0]) =>
  createSalesAgent({ core: createCore(t.db), llm: new ScriptedLlmClient(steps), businessInfo: UNCONFIGURED_BUSINESS_INFO });

describe("Sales Agent on synced, persistent data", () => {
  it('"Show me 22K necklaces under Rs 500,000": verified products, stock, interest, deterministic score', async () => {
    const { customer } = await core.customers.createCustomer({ externalIdentities: [{ type: "website_visitor", value: "sha256:test" }] }, { actor: { type: "system" } });
    const agent = agentWith([
      call("search_products", { category: "necklace", karat: 22, maxPrice: 500000 }),
      (req) => {
        const found = lastToolResult(req)!.data as { products: { sku: string; approvedPrice: string }[] };
        // Only the verified 22K necklace within budget — not the 720k haar, not the 18K choker.
        expect(found.products.map((p) => [p.sku, p.approvedPrice])).toEqual([["STG-NK-001", "495000.00"]]);
        return [toolUseBlock("check_inventory", { sku: "STG-NK-001" })];
      },
      (req) => {
        expect(lastToolResult(req)!.data).toMatchObject({ availability: "low_stock", canPromiseInStock: true, stockQuantity: 1 });
        return [toolUseBlock("record_product_interest", { productId: ids["STG-NK-001"], interestType: "shortlisted" })];
      },
      submit({
        reply: "Within Rs 500,000 in 22K, we have the STAGING SAMPLE Bridal Kundan Necklace (STG-NK-001) at PKR 495,000, 48.25 grams — only 1 piece left.",
        intent: "budget_search",
        productsReferenced: [ids["STG-NK-001"]!],
      }),
    ]);
    const r = await agent.handleMessage({ customerId: customer.id, message: "Show me 22K necklaces under Rs 500,000." });
    expect(r).toMatchObject({ status: "replied", leadScore: 30, leadClassification: "warm" }); // provided_budget 15 + specific_product_interest 15
    expect(r.productsReferenced.map((p) => p.sku)).toEqual(["STG-NK-001"]);

    // Everything persisted:
    const n = async (sql: string) => (await t.db.query<{ n: number }>(sql))[0]!.n;
    expect(await n(`select count(*)::int as n from messages`)).toBe(2);
    expect(await n(`select count(*)::int as n from product_interests`)).toBe(1);
    expect(await n(`select count(*)::int as n from lead_signal_events`)).toBe(2);
    expect(await n(`select count(*)::int as n from agent_actions where action_type in ('product_search','inventory_check','sales_agent_turn')`)).toBe(3);

    // A fresh agent (e.g. after a server restart) continues from stored history, not memory.
    const next = agentWith([
      (req) => {
        expect(req.messages[0]!.content as string).toContain("Customer: Show me 22K necklaces under Rs 500,000.");
        expect(req.messages[0]!.content as string).toContain("STG-NK-001");
        return submit({ reply: "Of course — a member of our team will discuss pricing with you.", intent: "discount_request" })(req, 0);
      },
    ]);
    const r2 = await next.handleMessage({ customerId: customer.id, conversationId: r.conversationId, message: "Can you do a better price?" });
    expect(r2.humanHandoff).toMatchObject({ required: true, reason: "discount_request" });
    expect(await n(`select count(*)::int as n from handoffs where status = 'open'`)).toBe(1);
  });

  it("unknown price and unknown stock are answered as needing confirmation", async () => {
    const { customer } = await core.customers.createCustomer({ email: "test.customer@example.invalid" }, { actor: { type: "system" } });
    const agent = agentWith([
      call("get_product", { sku: "STG-RG-001" }),
      (req) => {
        expect(lastToolResult(req)!.data).toMatchObject({ approvedPrice: null, priceStatus: "requires_confirmation" });
        return [toolUseBlock("check_inventory", { sku: "STG-BG-001" })];
      },
      (req) => {
        expect(lastToolResult(req)!.data).toMatchObject({ availability: "unknown", canPromiseInStock: false, requiresConfirmation: true });
        // An invented price is still rejected on real data.
        return submit({ reply: "The ring is about PKR 250,000.", intent: "price_question", productsReferenced: [ids["STG-RG-001"]!] })(req, 2);
      },
      submit({
        reply: "Our team will confirm the price of the STAGING SAMPLE Solitaire Ring, and the availability of the Classic Bangles, for you.",
        intent: "price_question",
        productsReferenced: [ids["STG-RG-001"]!, ids["STG-BG-001"]!],
      }),
    ]);
    const r = await agent.handleMessage({ customerId: customer.id, message: "Price of STG-RG-001? And are STG-BG-001 bangles in stock?" });
    expect(r.status).toBe("replied");
    expect(r.reply).not.toMatch(/250,000/);
  });
});
