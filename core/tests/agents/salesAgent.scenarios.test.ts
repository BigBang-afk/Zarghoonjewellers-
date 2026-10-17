import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { lastToolResult, toolResults, toolUseBlock } from "../../src/agents/llm/scriptedLlmClient.js";
import { UNCONFIGURED_BUSINESS_INFO } from "../../src/config/businessInfo.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { staffCtx } from "../helpers/fixtures.js";
import { actionTypes, call, messagesOf, setupAgent, signalsOf, submit } from "./harness.js";

/**
 * Sales Agent scenarios with a scripted model. The scripts deliberately
 * include model mistakes (invented prices, missing handoffs, skipped
 * inventory checks) to prove the code-level guarantees hold regardless.
 */

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

describe("product questions", () => {
  it("1. bridal products under a budget: only real matches, budget recorded", async () => {
    const { agent, customerId, pid } = await setupAgent(t, [
      call("search_products", { collection: "bridal", category: "necklace", maxPrice: 500000 }),
      (req) => {
        const found = lastToolResult(req)!.data as { products: { sku: string; productId: string }[] };
        expect(found.products.map((p) => p.sku)).toEqual(["DEMO-NK-001"]); // unpriced and over-budget pieces excluded
        return submit({
          reply: "For bridal necklaces within your budget, we have the DEMO Bridal Kundan Necklace Set (DEMO-NK-001) at PKR 485,000.",
          intent: "budget_search",
          productsReferenced: [found.products[0]!.productId],
        })(req, 1);
      },
    ]);
    const r = await agent.handleMessage({ customerId, message: "Show me bridal necklaces under 500000" });
    expect(r.status).toBe("replied");
    expect(r.productsReferenced).toEqual([{ productId: pid("DEMO-NK-001"), sku: "DEMO-NK-001", name: "DEMO Bridal Kundan Necklace Set" }]);
    expect(r.toolsUsed).toEqual(["search_products"]);
    expect(await signalsOf(t, r.leadId!)).toEqual(["provided_budget"]);
    expect(r).toMatchObject({ leadScore: 15, leadClassification: "cold", humanHandoff: { required: false } });
    const msgs = await messagesOf(t, r.conversationId);
    expect(msgs.map((m) => [m.direction, m.sender_type])).toEqual([["inbound", "customer"], ["outbound", "ai"]]);
    expect(await actionTypes(t, r.conversationId)).toEqual(expect.arrayContaining(["product_search", "ai_message_sent", "sales_agent_turn"]));
  });

  it("2. exact price question quotes the database price and records interest", async () => {
    const { agent, customerId, pid } = await setupAgent(t, ({ pid }) => [
      call("get_product", { sku: "DEMO-NK-001" }),
      () => [toolUseBlock("record_product_interest", { productId: pid("DEMO-NK-001"), interestType: "asked_price" })],
      submit({ reply: "The DEMO Bridal Kundan Necklace Set is PKR 485,000.", intent: "price_question", productsReferenced: [pid("DEMO-NK-001")] }),
    ]);
    const r = await agent.handleMessage({ customerId, message: "What is the price of DEMO-NK-001?" });
    expect(r.reply).toContain("PKR 485,000");
    expect(await signalsOf(t, r.leadId!)).toEqual(["asked_price", "specific_product_interest"]);
    expect(r.leadScore).toBe(25);
    expect(r.actionsRecorded.map((a) => a.type)).toContain("product_interest_recorded");
  });

  it("3. product without approved price: an invented price is rejected, the corrected reply defers to the team", async () => {
    const { agent, customerId, pid, llm } = await setupAgent(t, ({ pid }) => [
      call("get_product", { sku: "DEMO-NK-002" }),
      submit({ reply: "The Polki necklace is around PKR 350,000.", intent: "price_question", productsReferenced: [pid("DEMO-NK-002")] }),
      (req) => {
        const rejection = lastToolResult(req)!;
        expect(rejection.isError).toBe(true);
        expect(JSON.stringify(rejection.data)).toContain("350,000");
        return submit({
          reply: "I'll need to have the price of the DEMO Bridal Polki Necklace confirmed for you by our team.",
          intent: "price_question",
          productsReferenced: [pid("DEMO-NK-002")],
        })(req, 2);
      },
    ]);
    const r = await agent.handleMessage({ customerId, message: "How much is the polki necklace DEMO-NK-002?" });
    expect(r.status).toBe("replied");
    expect(r.reply).not.toMatch(/\d{3}/);
    expect(llm.requests).toHaveLength(3);
    const msgs = await messagesOf(t, r.conversationId);
    expect(msgs.filter((m) => m.direction === "outbound")).toHaveLength(1);
    expect(msgs.some((m) => m.content.includes("350,000"))).toBe(false);
  });

  it("4. availability must come from check_inventory", async () => {
    const { agent, customerId, pid } = await setupAgent(t, ({ pid }) => [
      call("get_product", { sku: "DEMO-BG-001" }),
      // Model answers availability without checking inventory: rejected.
      submit({ reply: "Yes, the DEMO bangles are available.", intent: "availability_question", productsReferenced: [pid("DEMO-BG-001")] }),
      call("check_inventory", { sku: "DEMO-BG-001" }),
      (req) => {
        expect((lastToolResult(req)!.data as { canPromiseInStock: boolean }).canPromiseInStock).toBe(true);
        return submit({
          reply: "Yes, the DEMO Classic 22K Gold Bangles (Pair) are in stock.",
          intent: "availability_question",
          productsReferenced: [pid("DEMO-BG-001")],
        })(req, 3);
      },
    ]);
    const r = await agent.handleMessage({ customerId, message: "Is DEMO-BG-001 available?" });
    expect(r.status).toBe("replied");
    expect(r.toolsUsed).toEqual(["get_product", "check_inventory"]);
    expect(await signalsOf(t, r.leadId!)).toEqual(["asked_availability"]);
  });

  it("5. out-of-stock product is reported from stored stock data", async () => {
    const { agent, customerId, pid } = await setupAgent(t, ({ pid }) => [
      call("check_inventory", { sku: "DEMO-NK-003" }),
      (req) => {
        expect(lastToolResult(req)!.data).toMatchObject({ availability: "out_of_stock", canPromiseInStock: false, stockQuantity: 0 });
        return submit({
          reply: "I'm sorry, the DEMO Rani Haar Bridal Necklace is currently out of stock. Would you like me to show similar bridal pieces?",
          intent: "availability_question",
          productsReferenced: [pid("DEMO-NK-003")],
        })(req, 1);
      },
    ]);
    const r = await agent.handleMessage({ customerId, message: "Is the rani haar DEMO-NK-003 available?" });
    expect(r.reply).toContain("out of stock");
    expect(await actionTypes(t, r.conversationId)).toContain("inventory_check");
  });

  it("6. 22K bangles under 400k", async () => {
    const { agent, customerId, pid } = await setupAgent(t, ({ pid }) => [
      call("search_products", { category: "bangle", karat: 22, maxPrice: 400000 }),
      (req) => {
        const found = lastToolResult(req)!.data as { products: { sku: string }[] };
        expect(found.products.map((p) => p.sku)).toEqual(["DEMO-BG-001"]);
        return submit({
          reply: "In 22K we have the DEMO Classic 22K Gold Bangles (Pair) at PKR 365,000.",
          intent: "budget_search",
          productsReferenced: [pid("DEMO-BG-001")],
        })(req, 1);
      },
    ]);
    const r = await agent.handleMessage({ customerId, message: "22k bangles under 400k" });
    expect(r.status).toBe("replied");
    expect(r.productsReferenced.map((p) => p.sku)).toEqual(["DEMO-BG-001"]);
  });

  it("7. no matching product: honest answer, invented SKU rejected", async () => {
    const { agent, customerId } = await setupAgent(t, [
      call("search_products", { query: "anklet" }),
      submit({ reply: "We have the DEMO-AN-001 platinum anklet you might like.", intent: "product_search" }),
      submit({
        reply: "I'm sorry, I couldn't find any anklets in our collection right now. Would you like our team to help you find something?",
        intent: "product_search",
      }),
    ]);
    const r = await agent.handleMessage({ customerId, message: "Do you have platinum anklets?" });
    expect(r.status).toBe("replied");
    expect(r.reply).not.toContain("DEMO-AN-001");
    expect(r.productsReferenced).toEqual([]);
  });
});

describe("handoff rules", () => {
  it("8. discount request: no discount promised, handoff created even if the model forgets", async () => {
    const { agent, customerId, pid, core } = await setupAgent(t, ({ pid }) => [
      call("get_product", { sku: "DEMO-NK-001" }),
      submit({ reply: "I can offer you 10% off this set!", intent: "discount_request", productsReferenced: [pid("DEMO-NK-001")] }),
      submit({
        reply: "Thank you for asking. A member of our team will discuss pricing for the DEMO Bridal Kundan Necklace Set with you personally.",
        intent: "discount_request",
        productsReferenced: [pid("DEMO-NK-001")],
        handoff: { required: false }, // the model "forgot" — code must not
      }),
    ]);
    const r = await agent.handleMessage({ customerId, message: "Can you give me a discount on DEMO-NK-001?" });
    expect(r.status).toBe("replied_and_handed_off");
    expect(r.reply).not.toMatch(/%|off/);
    expect(r.humanHandoff).toMatchObject({ required: true, reason: "discount_request", urgency: "normal" });
    expect(r.humanTakeoverActive).toBe(true);
    const convo = await core.conversations.getConversation(r.conversationId);
    expect(convo.humanTakeover).toBe(true);
    const msgs = await messagesOf(t, r.conversationId);
    expect(msgs.map((m) => m.sender_type)).toEqual(["customer", "ai"]); // reply stored before takeover
  });

  it("9. complaint: high-priority handoff, no admissions or refunds", async () => {
    const { agent, customerId } = await setupAgent(t, [
      submit({
        reply: "I'm truly sorry to hear this. I've passed your concern to our team, and a senior team member will contact you shortly.",
        intent: "complaint",
        handoff: { required: true, reason: "complaint", urgency: "high" },
      }),
    ]);
    const r = await agent.handleMessage({ customerId, message: "The bangle I bought is broken. I'm very disappointed." });
    expect(r.humanHandoff).toMatchObject({ required: true, reason: "complaint", urgency: "high" });
    expect(r.reply).not.toMatch(/refund|replace|our fault/i);
  });

  it("9b. keyword backstop escalates a complaint the model misclassified", async () => {
    const { agent, customerId } = await setupAgent(t, [
      submit({ reply: "Thank you for reaching out. Our team will look into this for you.", intent: "general_question" }),
    ]);
    const r = await agent.handleMessage({ customerId, message: "Mera set kharab nikla, mujhe refund chahiye" });
    expect(r.humanHandoff).toMatchObject({ required: true, reason: "complaint", urgency: "high" });
  });

  it("10. customer asks for a human salesperson", async () => {
    const { agent, customerId } = await setupAgent(t, [
      submit({ reply: "Of course. A member of our sales team will be with you shortly.", intent: "human_request" }),
    ]);
    const r = await agent.handleMessage({ customerId, message: "Can I talk to a real person please?" });
    expect(r.humanHandoff).toMatchObject({ required: true, reason: "customer_requested" });
    expect(await signalsOf(t, r.leadId!)).toEqual(["requested_human_salesperson"]);
    expect(r.leadScore).toBe(15);
  });

  it("11. human takeover already active: no model call, no AI reply", async () => {
    const { agent, customerId, core, llm, staffId } = await setupAgent(t, [submit({ reply: "should never be used" })]);
    const convo = await core.conversations.createConversation({ channel: "website", customerId }, staffCtx(staffId));
    await core.conversations.setHumanTakeover(convo.id, { active: true, reason: "VIP" }, staffCtx(staffId));
    const r = await agent.handleMessage({ customerId, conversationId: convo.id, message: "Hello, any update?" });
    expect(r).toMatchObject({ status: "human_takeover_active", reply: null, outboundMessageId: null, humanTakeoverActive: true, modelCalls: 0 });
    expect(llm.requests).toHaveLength(0);
    const msgs = await messagesOf(t, convo.id);
    expect(msgs.map((m) => m.direction)).toEqual(["inbound"]);
    expect(await actionTypes(t, convo.id)).toContain("sales_agent_skipped_human_takeover");
  });

  it("16. custom jewellery: interest recorded and handed off without promises", async () => {
    const { agent, customerId, pid } = await setupAgent(t, ({ pid }) => [
      call("get_product", { sku: "DEMO-RG-001" }),
      () => [toolUseBlock("record_product_interest", { productId: pid("DEMO-RG-001"), interestType: "requested_customization", notes: "wants ruby instead of diamond" })],
      call("request_human_handoff", { reason: "custom_order", urgency: "normal", note: "Ruby instead of diamond on DEMO-RG-001" }),
      submit({
        reply: "That sounds lovely. Our design team will review the ruby option for the DEMO Solitaire Engagement Ring and get back to you.",
        intent: "custom_order",
        productsReferenced: [pid("DEMO-RG-001")],
        handoff: { required: true, reason: "custom_order" },
      }),
    ]);
    const r = await agent.handleMessage({ customerId, message: "Can you make DEMO-RG-001 with a ruby instead of a diamond?" });
    expect(r.humanHandoff).toMatchObject({ required: true, reason: "custom_order" });
    const interests = await t.db.query<{ interest_type: string }>(`select interest_type from product_interests where customer_id = $1`, [customerId]);
    expect(interests.map((i) => i.interest_type)).toEqual(["requested_customization"]);
    expect(r.reply).not.toMatch(/\d/);
  });

  it("17. unknown factual question: low confidence must hand off instead of guessing", async () => {
    const { agent, customerId } = await setupAgent(t, [
      submit({ reply: "I'm not certain about today's gold rate.", intent: "general_question", confidence: "low" }),
      submit({
        reply: "I'll have our team confirm today's rate for you shortly.",
        intent: "general_question",
        confidence: "low",
        handoff: { required: true, reason: "low_ai_confidence" },
      }),
    ]);
    const r = await agent.handleMessage({ customerId, message: "What is today's gold rate per tola?" });
    expect(r.humanHandoff).toMatchObject({ required: true, reason: "low_ai_confidence" });
    expect(r.reply).not.toMatch(/\d/);
  });
});

describe("CRM activity", () => {
  it("12. customer gives a budget", async () => {
    const { agent, customerId, pid } = await setupAgent(t, ({ pid }) => [
      call("record_lead_signal", { signal: "provided_budget", evidence: "budget around 3 lakh" }),
      call("search_products", { category: "bangle", maxPrice: "300000" }),
      submit({
        reply: "Within 3 lakh, we have the DEMO 21K Kangan Bangle at PKR 298,000.",
        intent: "budget_search",
        productsReferenced: [pid("DEMO-BG-002")],
      }),
    ]);
    const r = await agent.handleMessage({ customerId, message: "My budget is around 3 lakh for a bangle" });
    expect(r.status).toBe("replied");
    expect(await signalsOf(t, r.leadId!)).toEqual(["provided_budget"]);
    expect(r.leadScore).toBe(15);
  });

  it("13. shop location comes from owner-approved business info", async () => {
    const { agent, customerId } = await setupAgent(t, [
      call("get_business_info", {}),
      (req) => {
        expect(lastToolResult(req)!.data).toMatchObject({ notice: "DEMO DATA — not a real store" });
        return submit({ reply: "We're at DEMO ADDRESS — 1 Example Road, Lahore.", intent: "location_question" })(req, 1);
      },
    ]);
    const r = await agent.handleMessage({ customerId, message: "Where is your shop?" });
    expect(await signalsOf(t, r.leadId!)).toEqual(["asked_shop_location"]);
    expect(r.leadScore).toBe(10);
  });

  it("13b. unconfigured store info is returned as null, not invented", async () => {
    const { agent, customerId } = await setupAgent(
      t,
      [
        call("get_business_info", {}),
        (req) => {
          expect(lastToolResult(req)!.data).toMatchObject({ address: null, openingHours: null });
          return submit({ reply: "Our team will share the store address and timings with you shortly.", intent: "location_question" })(req, 1);
        },
      ],
      { businessInfo: UNCONFIGURED_BUSINESS_INFO },
    );
    const r = await agent.handleMessage({ customerId, message: "What are your timings?" });
    expect(r.status).toBe("replied");
  });

  it("14. how to order", async () => {
    const { agent, customerId } = await setupAgent(t, [
      call("get_business_info", {}),
      submit({ reply: "You can visit the store or ask our team to reserve a piece; our staff confirm every order personally.", intent: "payment_question" }),
    ]);
    const r = await agent.handleMessage({ customerId, message: "How can I place an order?" });
    expect(await signalsOf(t, r.leadId!)).toEqual(["asked_about_payment_or_order"]);
    expect(r.leadScore).toBe(20);
  });

  it("15. duplicate lead signals never inflate the score", async () => {
    const turn = (pid: (s: string) => string) => [
      call("record_lead_signal", { signal: "asked_price", evidence: "price?" }),
      call("get_product", { sku: "DEMO-NK-001" }),
      submit({ reply: "It is PKR 485,000.", intent: "price_question", productsReferenced: [pid("DEMO-NK-001")] }),
    ];
    const { agent, customerId, llm } = await setupAgent(t, ({ pid }) => [...turn(pid), ...turn(pid)]);
    const first = await agent.handleMessage({ customerId, message: "Price of DEMO-NK-001?" });
    const second = await agent.handleMessage({ customerId, conversationId: first.conversationId, message: "Sorry, price again?" });
    expect(second.leadScore).toBe(first.leadScore);
    expect(await signalsOf(t, second.leadId!)).toEqual(["asked_price"]);
    // The model is told the duplicate was already recorded, not given an error or points.
    const dupResult = toolResults(llm.requests[4]!).find((x) => JSON.stringify(x.data).includes("already_recorded"));
    expect(dupResult).toMatchObject({ isError: false, data: { recorded: false, reason: "already_recorded" } });
  });

  it("does not create leads for do-not-contact customers but still answers them", async () => {
    const { agent, customerId, core } = await setupAgent(t, [submit({ reply: "Thank you for your message.", intent: "general_question" })]);
    await core.customers.setDoNotContact(customerId, staffCtx((await t.db.query<{ id: string }>(`select id from staff limit 1`))[0]!.id));
    const r = await agent.handleMessage({ customerId, message: "Hello" });
    expect(r).toMatchObject({ status: "replied", leadId: null, leadScore: null, leadClassification: null });
  });
});

describe("languages", () => {
  it("21. English conversation", async () => {
    const { agent, customerId } = await setupAgent(t, [submit({ reply: "Good afternoon! How may I help you today?", language: "english" })]);
    const r = await agent.handleMessage({ customerId, message: "Hello, I'm looking for a gift" });
    expect(r.language).toBe("english");
    const msgs = await messagesOf(t, r.conversationId);
    expect(msgs.map((m) => m.language)).toEqual(["english", "english"]);
  });

  it("22. Roman Urdu conversation with lakh amounts in Pakistani digit grouping", async () => {
    const { agent, customerId, pid, core } = await setupAgent(t, ({ pid }) => [
      call("search_products", { collection: "bridal", maxPrice: 500000 }),
      submit({
        reply: "Ji zaroor! 5 lakh tak hamare paas DEMO Bridal Kundan Necklace Set hai, jis ki qeemat PKR 4,85,000 hai.",
        intent: "budget_search",
        language: "roman_urdu",
        productsReferenced: [pid("DEMO-NK-001")],
      }),
    ]);
    const r = await agent.handleMessage({ customerId, message: "Bridal set dikhao 5 lakh tak, kya hai aap ke paas?" });
    expect(r).toMatchObject({ status: "replied", language: "roman_urdu" });
    expect((await messagesOf(t, r.conversationId))[0]!.language).toBe("roman_urdu");
    // One message in a language is not a stated preference.
    expect((await core.customers.getCustomer(customerId)).preferredLanguage).toBe("unknown");
  });

  it("23. Urdu conversation, Urdu digits validated, explicit preference saved", async () => {
    const { agent, customerId, pid, core } = await setupAgent(t, ({ pid }) => [
      call("get_product", { sku: "DEMO-NK-001" }),
      call("set_preferred_language", { language: "urdu" }),
      submit({
        reply: "جی ضرور، آئندہ میں اردو میں بات کروں گی۔ اس سیٹ کی قیمت ۴۸۵۰۰۰ روپے ہے۔",
        intent: "price_question",
        language: "urdu",
        productsReferenced: [pid("DEMO-NK-001")],
      }),
    ]);
    const r = await agent.handleMessage({ customerId, message: "مجھ سے اردو میں بات کریں۔ DEMO-NK-001 کی قیمت کیا ہے؟" });
    expect(r).toMatchObject({ status: "replied", language: "urdu" });
    expect((await core.customers.getCustomer(customerId)).preferredLanguage).toBe("urdu");
  });
});

describe("no invented values", () => {
  it("24. invented weight and karat are rejected; persistent invention falls back safely", async () => {
    const lie = submit({
      reply: "The DEMO Bridal Kundan Necklace Set is 24K gold and weighs 50 grams.",
      intent: "product_details",
    });
    const { agent, customerId, llm } = await setupAgent(t, [call("get_product", { sku: "DEMO-NK-001" }), lie, lie, lie]);
    const r = await agent.handleMessage({ customerId, message: "Tell me about DEMO-NK-001" });
    expect(r.status).toBe("failed_safe");
    expect(r.reply).not.toMatch(/\d/);
    expect(r.humanHandoff).toMatchObject({ required: true, reason: "low_ai_confidence" });
    const rejection = JSON.stringify(toolResults(llm.requests[2]!).at(-1)!.data);
    expect(rejection).toContain("24K");
    expect(rejection).toContain("50 grams");
    const msgs = await messagesOf(t, r.conversationId);
    expect(msgs.some((m) => /50 grams|24K/.test(m.content))).toBe(false);
    expect(msgs.at(-1)!.sender_type).toBe("system"); // fixed fallback text, not model output
  });

  it("25. the lead score is never the model's: invented score rejected, result read from the engine", async () => {
    const { agent, customerId, llm } = await setupAgent(t, [
      call("record_lead_signal", { signal: "asked_about_visit", evidence: "wants to visit" }),
      (req) => {
        const res = JSON.stringify(lastToolResult(req)!.data);
        expect(res).not.toMatch(/score|points/i);
        return submit({ reply: "You're a top customer — your lead score is 95!", intent: "visit_question" })(req, 1);
      },
      submit({ reply: "We'd be delighted to welcome you. Our team will help you plan your visit.", intent: "visit_question" }),
    ]);
    const r = await agent.handleMessage({ customerId, message: "I'd like to visit the store this weekend" });
    expect(r.leadScore).toBe(20);
    expect(r.leadClassification).toBe("cold");
    expect(llm.requests).toHaveLength(3);
  });

  it("26. no outbound AI message when a human takes over mid-turn", async () => {
    let conversationId = "";
    let staffId = "";
    let coreRef: Awaited<ReturnType<typeof setupAgent>>["core"] | null = null;
    const setup = await setupAgent(t, [
      async (req, i) => {
        // A staff member grabs the conversation while the model is still working.
        await coreRef!.conversations.setHumanTakeover(conversationId, { active: true }, staffCtx(staffId));
        return submit({ reply: "Here are some options for you." })(req, i);
      },
    ]);
    coreRef = setup.core;
    staffId = setup.staffId;
    conversationId = (await setup.core.conversations.createConversation({ channel: "website", customerId: setup.customerId }, staffCtx(staffId))).id;
    const r = await setup.agent.handleMessage({ customerId: setup.customerId, conversationId, message: "Show me rings" });
    expect(r).toMatchObject({ status: "human_takeover_active", reply: null, outboundMessageId: null });
    const msgs = await messagesOf(t, conversationId);
    expect(msgs.filter((m) => m.sender_type === "ai")).toHaveLength(0);
  });
});
