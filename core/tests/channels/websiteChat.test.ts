import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ScriptedLlmClient, toolUseBlock, type ScriptStep } from "../../src/agents/llm/scriptedLlmClient.js";
import { createSalesAgent } from "../../src/agents/sales/salesAgent.js";
import {
  createWebsiteChat,
  createWebsiteChatRuntime,
  formatPrice,
  HANDOFF_NOTICE,
  resolveWebsiteChatConfig,
  sessionIdentityValue,
  SlidingWindowRateLimiter,
  WebsiteChatError,
} from "../../src/channels/website/index.js";
import { DEMO_BUSINESS_INFO, seedDemoData } from "../../src/demo/demoData.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { createCore, type TestCore } from "../helpers/core.js";
import { staffCtx } from "../helpers/fixtures.js";
import { call, submit } from "../agents/harness.js";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const devConfig = (extra: Record<string, string> = {}) =>
  resolveWebsiteChatConfig({ NODE_ENV: "development", ZARGHOON_CHAT_DEBUG: "true", ...extra });

async function setup(steps: (pid: (sku: string) => string) => ScriptStep[] | ((r: never, i: number) => ScriptStep | undefined), extra: Record<string, string> = {}) {
  const core: TestCore = createCore(t.db);
  const seed = await seedDemoData(t.db);
  const pid = (sku: string) => seed.productIds[sku]!;
  const built = steps(pid);
  const llm = new ScriptedLlmClient(built as never);
  const agent = createSalesAgent({ core, llm, businessInfo: DEMO_BUSINESS_INFO, config: { turnTimeoutMs: 10_000 } });
  const chat = createWebsiteChat({ core, agent, config: devConfig(extra) });
  return { core, chat, llm, pid, staffId: seed.staffId };
}

const visitor = (token: string | null = null, ip = "203.0.113.7") => ({ sessionToken: token, ip });

describe("configuration", () => {
  it("defaults to demo in development and off in production", () => {
    expect(resolveWebsiteChatConfig({ NODE_ENV: "development" })).toMatchObject({ mode: "demo", model: "offline_demo", debug: false });
    expect(resolveWebsiteChatConfig({ NODE_ENV: "development", ANTHROPIC_API_KEY: "sk-ant-x" }).model).toBe("claude");
    expect(resolveWebsiteChatConfig({ NODE_ENV: "production" })).toMatchObject({ mode: "off", model: "none" });
  });

  it("14. live mode without an API key is unavailable, never faked", () => {
    const c = resolveWebsiteChatConfig({ NODE_ENV: "production", ZARGHOON_CHAT_MODE: "live", ZARGHOON_CORE_DATABASE_URL: "postgres://x" });
    expect(c).toMatchObject({ model: "none", unavailableReason: "ANTHROPIC_API_KEY is not set" });
    expect(resolveWebsiteChatConfig({ NODE_ENV: "production", ZARGHOON_CHAT_MODE: "live" }).unavailableReason).toMatch(/DATABASE_URL/);
  });

  it("staging mode uses the persistent database, with or without Claude", () => {
    expect(resolveWebsiteChatConfig({ NODE_ENV: "development", ZARGHOON_CHAT_MODE: "staging", ZARGHOON_CORE_DATABASE_URL: "postgres://s" })).toMatchObject({
      mode: "staging",
      model: "offline_demo",
      databaseUrl: "postgres://s",
    });
    expect(
      resolveWebsiteChatConfig({ NODE_ENV: "production", ZARGHOON_CHAT_MODE: "staging", ZARGHOON_CORE_DATABASE_URL: "postgres://s", ANTHROPIC_API_KEY: "k" }).model,
    ).toBe("claude");
    expect(resolveWebsiteChatConfig({ NODE_ENV: "development", ZARGHOON_CHAT_MODE: "staging" })).toMatchObject({ model: "none" });
  });

  it("never enables debug output in production", () => {
    expect(resolveWebsiteChatConfig({ NODE_ENV: "production", ZARGHOON_CHAT_MODE: "demo", ZARGHOON_CHAT_DEBUG: "true" }).debug).toBe(false);
  });

  it("14b. the runtime refuses to answer without a key in live mode", async () => {
    const runtime = await createWebsiteChatRuntime({ NODE_ENV: "production", ZARGHOON_CHAT_MODE: "live", ZARGHOON_CORE_DATABASE_URL: "postgres://u@127.0.0.1:1/x" });
    expect(runtime.chat.available).toBe(false);
    const err = await runtime.chat.sendMessage(visitor(), { message: "hi" }).catch((e) => e);
    expect(err).toMatchObject({ status: 503, code: "assistant_unavailable" });
    await runtime.close();
  });

  it("demo runtime boots an isolated in-memory database with DEMO fixtures", async () => {
    const runtime = await createWebsiteChatRuntime({ NODE_ENV: "development" });
    const out = await runtime.chat.sendMessage(visitor(), { message: "Show me bangles" });
    expect(out.body.messages.at(-1)!.products.map((p) => p.sku)).toEqual(["DEMO-BG-002", "DEMO-BG-001"]);
    await runtime.close();
  });

  it("off mode touches nothing", async () => {
    const runtime = await createWebsiteChatRuntime({ NODE_ENV: "production" });
    expect((await runtime.chat.getState(visitor())).body).toMatchObject({ mode: "off", available: false, messages: [] });
    await expect(runtime.chat.resetConversation(visitor())).rejects.toMatchObject({ status: 503 });
  });
});

describe("chat turns", () => {
  it("2–4. sends a message, gets a reply and verified product cards", async () => {
    const { chat, pid } = await setup((pid) => [
      call("search_products", { collection: "bridal", category: "necklace" }),
      submit({ reply: "Here are our bridal necklaces.", intent: "product_search", productsReferenced: [pid("DEMO-NK-001"), pid("DEMO-NK-002"), pid("DEMO-NK-003")] }),
    ]);
    const out = await chat.sendMessage(visitor(), { message: "Show bridal jewelry" });
    expect(out.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [customerMsg, reply] = out.body.messages;
    expect(customerMsg).toMatchObject({ role: "customer", text: "Show bridal jewelry" });
    expect(reply).toMatchObject({ role: "assistant", text: "Here are our bridal necklaces." });
    const cards = Object.fromEntries(reply!.products.map((c) => [c.sku, c]));
    expect(cards["DEMO-NK-001"]).toMatchObject({
      productId: pid("DEMO-NK-001"),
      karatLabel: "22K",
      weightLabel: "62.5 g",
      priceLabel: "PKR 485,000",
      priceConfirmed: true,
      availabilityLabel: "In stock",
      imageUrl: null,
      viewUrl: null,
    });
    // 5. no approved price / unknown stock / unknown weight
    expect(cards["DEMO-NK-002"]).toMatchObject({ priceLabel: "Needs confirmation", priceConfirmed: false, weightLabel: "Ask for details", availabilityLabel: "Needs confirmation" });
    expect(cards["DEMO-NK-003"]).toMatchObject({ availabilityLabel: "Out of stock" });
  });

  it("6. no matching product: no cards", async () => {
    const { chat } = await setup(() => [
      call("search_products", { query: "anklet" }),
      submit({ reply: "I couldn't find anklets right now.", intent: "product_search" }),
    ]);
    const out = await chat.sendMessage(visitor(), { message: "Anklets?" });
    expect(out.body.messages[1]!.products).toEqual([]);
  });

  it("7. lead score comes from the scoring engine and is only in debug output", async () => {
    const { chat, pid } = await setup((pid) => [
      call("get_product", { sku: "DEMO-NK-001" }),
      () => [toolUseBlock("record_product_interest", { productId: pid("DEMO-NK-001"), interestType: "asked_price" })],
      submit({ reply: "It is PKR 485,000.", intent: "price_question", productsReferenced: [pid("DEMO-NK-001")] }),
    ]);
    const out = await chat.sendMessage(visitor(), { message: "Price of DEMO-NK-001?" });
    expect(out.body.debug).toMatchObject({ leadScore: 25, leadClassification: "warm", intent: "price_question" });
    expect(JSON.stringify(out.body.messages)).not.toMatch(/leadScore|score/i);

  });

  it("8. conversation persists across requests for the same session", async () => {
    const { chat } = await setup(() => [submit({ reply: "Welcome! Which occasion?" }), submit({ reply: "Lovely. Any budget in mind?" })]);
    const first = await chat.sendMessage(visitor(), { message: "Hi" });
    await chat.sendMessage(visitor(first.sessionToken), { message: "A wedding" });
    const state = await chat.getState(visitor(first.sessionToken));
    expect(state.body.messages.map((m) => [m.role, m.text])).toEqual([
      ["customer", "Hi"],
      ["assistant", "Welcome! Which occasion?"],
      ["customer", "A wedding"],
      ["assistant", "Lovely. Any budget in mind?"],
    ]);
  });

  it("9–10. Roman Urdu and Urdu messages round-trip", async () => {
    const { chat } = await setup((pid) => [
      call("search_products", { category: "bangle", karat: 22 }),
      submit({ reply: "Ji, 22K mein DEMO Classic 22K Gold Bangles (Pair) PKR 365,000 ki hain.", intent: "product_search", language: "roman_urdu", productsReferenced: [pid("DEMO-BG-001")] }),
      submit({ reply: "جی، ہماری ٹیم آپ کی مدد کرے گی۔", intent: "general_question", language: "urdu" }),
    ]);
    const a = await chat.sendMessage(visitor(), { message: "22k kangan dikhao" });
    expect(a.body.messages[1]).toMatchObject({ language: "roman_urdu" });
    expect(a.body.messages[1]!.products[0]!.sku).toBe("DEMO-BG-001");
    const b = await chat.sendMessage(visitor(a.sessionToken), { message: "کیا آپ کے پاس جھمکے ہیں؟" });
    expect(b.body.messages[1]).toMatchObject({ language: "urdu", text: "جی، ہماری ٹیم آپ کی مدد کرے گی۔" });
  });

  it("11–12. human handoff shows the notice and the AI stops replying", async () => {
    const { chat, llm } = await setup(() => [
      submit({ reply: "Of course — a member of our team will help you.", intent: "human_request" }),
    ]);
    const a = await chat.sendMessage(visitor(), { message: "I want to speak to someone" });
    expect(a.body.humanTakeoverActive).toBe(true);
    expect(a.body.messages.map((m) => m.role)).toEqual(["customer", "assistant", "notice"]);
    expect(a.body.messages[2]!.text).toBe(HANDOFF_NOTICE);
    expect(a.body.debug?.handoffReason).toBe("customer_requested");

    const b = await chat.sendMessage(visitor(a.sessionToken), { message: "Hello? Are you there?" });
    expect(b.body.messages.map((m) => m.role)).toEqual(["customer", "notice"]);
    expect(llm.requests).toHaveLength(1); // no model call during takeover
    // Starting over is not a way around the handoff.
    await expect(chat.resetConversation(visitor(a.sessionToken))).rejects.toMatchObject({ status: 409 });
    const state = await chat.getState(visitor(a.sessionToken));
    expect(state.body.humanTakeoverActive).toBe(true);
    expect(state.body.messages.at(-1)!.role).toBe("notice");
  });

  it("staff replies appear as the Zarghoon team", async () => {
    const { chat, core, staffId } = await setup(() => [submit({ reply: "A team member will help.", intent: "human_request" })]);
    const a = await chat.sendMessage(visitor(), { message: "manager please" });
    const customer = await core.customers.findCustomerByExternalIdentity("website_visitor", sessionIdentityValue(a.sessionToken!));
    const [conv] = await core.conversations.getCustomerConversations(customer!.id);
    await core.conversations.addMessage({ conversationId: conv!.id, direction: "outbound", senderType: "staff", senderStaffId: staffId, content: "Salam, I'm Sana from Zarghoon." }, staffCtx(staffId));
    const state = await chat.getState(visitor(a.sessionToken));
    expect(state.body.messages.find((m) => m.role === "team")?.text).toBe("Salam, I'm Sana from Zarghoon.");
  });

  it("13. model failure still produces a safe reply; infrastructure failure a safe error", async () => {
    const { chat, core } = await setup(() => [() => { throw new Error("provider down"); }]);
    const out = await chat.sendMessage(visitor(), { message: "hello" });
    expect(out.body.messages[1]!.text).toMatch(/team will get back to you/);
    expect(out.body.humanTakeoverActive).toBe(true);

    core.customers.findCustomerByExternalIdentity = async () => {
      throw new Error("connection refused postgres://user:pw@db");
    };
    const err = await chat.sendMessage(visitor(), { message: "hello" }).catch((e) => e);
    expect(err).toBeInstanceOf(WebsiteChatError);
    expect(err).toMatchObject({ status: 500, code: "internal_error" });
    expect(err.message).not.toMatch(/postgres|pw/);
  });

  it("15. invalid input is rejected before anything is stored", async () => {
    const { chat } = await setup(() => []);
    for (const body of [{}, { message: "" }, { message: "   " }, { message: "x".repeat(1001) }, { message: "hi", customerId: "x" }, "hi", null]) {
      await expect(chat.sendMessage(visitor(), body)).rejects.toMatchObject({ status: 400, code: "invalid_input" });
    }
    const n = (await t.db.query<{ n: number }>(`select count(*)::int as n from messages`))[0]!.n;
    expect(n).toBe(0);
  });

  it("16. sessions are isolated: another token or a forged token sees nothing", async () => {
    const { chat } = await setup(() => [submit({ reply: "Private reply for A" }), submit({ reply: "Reply for B" })]);
    const a = await chat.sendMessage(visitor(), { message: "My secret wedding plans" });
    const b = await chat.sendMessage(visitor(), { message: "Hi" });
    expect(a.sessionToken).not.toBe(b.sessionToken);
    const bState = await chat.getState(visitor(b.sessionToken));
    expect(JSON.stringify(bState.body)).not.toContain("secret wedding");
    for (const forged of ["", "not-a-token", "x".repeat(43), a.sessionToken!.slice(0, 42) + "A", "../../etc"]) {
      const s = await chat.getState(visitor(forged));
      expect(JSON.stringify(s.body)).not.toContain("secret wedding");
    }
    // Only the hash of the token is stored.
    const rows = await t.db.query<{ identity_value: string }>(`select identity_value from customer_identities`);
    expect(rows.map((r) => r.identity_value).join()).not.toContain(a.sessionToken);
  });

  it("signed-in website accounts map to their own verified identity", async () => {
    const { chat, core } = await setup(() => [submit({ reply: "Welcome back!" })]);
    const out = await chat.sendMessage({ sessionToken: null, account: { userId: "user_abc", fullName: "Hina Raza" } }, { message: "Hi" });
    const c = await core.customers.findCustomerByExternalIdentity("website_account", "user_abc");
    expect(c).toMatchObject({ fullName: "Hina Raza", phone: null });
    // An anonymous session (even with the same cookie) does not see the account's chat.
    const anon = await chat.getState(visitor(out.sessionToken));
    expect(anon.body.messages).toEqual([]);
  });

  it("reset closes the conversation; the next message starts a new one", async () => {
    const { chat } = await setup(() => [submit({ reply: "First" }), submit({ reply: "Fresh start" })]);
    const a = await chat.sendMessage(visitor(), { message: "one" });
    expect((await chat.resetConversation(visitor(a.sessionToken))).body.reset).toBe(true);
    expect((await chat.getState(visitor(a.sessionToken))).body.messages).toEqual([]);
    await chat.sendMessage(visitor(a.sessionToken), { message: "two" });
    expect((await chat.getState(visitor(a.sessionToken))).body.messages.map((m) => m.text)).toEqual(["two", "Fresh start"]);
  });
});

describe("rate limiting and cost protection", () => {
  it("limits per session, per IP and globally, without consuming quota on refusal", async () => {
    const steps = () => () => submit({ reply: "ok" });
    const { chat } = await setup(steps as never, { ZARGHOON_CHAT_SESSION_PER_MINUTE: "2", ZARGHOON_CHAT_IP_PER_MINUTE: "3", ZARGHOON_CHAT_GLOBAL_PER_DAY: "4" });
    const a = await chat.sendMessage(visitor(null, "198.51.100.1"), { message: "1" });
    await chat.sendMessage(visitor(a.sessionToken, "198.51.100.1"), { message: "2" });
    const err = await chat.sendMessage(visitor(a.sessionToken, "198.51.100.1"), { message: "3" }).catch((e) => e);
    expect(err).toMatchObject({ status: 429, code: "rate_limited" });
    expect(err.retryAfterSeconds).toBeGreaterThan(0);
    await chat.sendMessage(visitor(null, "198.51.100.1"), { message: "new session, same ip" });
    await expect(chat.sendMessage(visitor(null, "198.51.100.1"), { message: "ip limit" })).rejects.toMatchObject({ status: 429 });
    await chat.sendMessage(visitor(null, "198.51.100.2"), { message: "4th turn today" });
    const global = await chat.sendMessage(visitor(null, "198.51.100.3"), { message: "over budget" }).catch((e) => e);
    expect(global).toMatchObject({ status: 429 });
    expect(global.message).toMatch(/very busy/);
  });

  it("sliding window recovers after the window passes", () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(() => new Date(now));
    const rule = { name: "r", limit: 1, windowMs: 1000 };
    expect(limiter.check([{ rule, key: "k" }]).allowed).toBe(true);
    expect(limiter.check([{ rule, key: "k" }]).allowed).toBe(false);
    now = 1001;
    expect(limiter.check([{ rule, key: "k" }]).allowed).toBe(true);
  });
});

describe("contact details", () => {
  it("saves self-reported contact details and records provided_contact", async () => {
    const { chat, core } = await setup(() => [submit({ reply: "Hello!" })]);
    const a = await chat.sendMessage(visitor(), { message: "hi" });
    const res = await chat.submitContact(visitor(a.sessionToken), { fullName: "Sara Khan", phone: "0300-1234567" });
    expect(res.body.saved).toBe(true);
    const c = await core.customers.findCustomerByPhone("03001234567");
    expect(c?.fullName).toBe("Sara Khan");
    const lead = await core.leads.getActiveLead(c!.id);
    expect((await core.leads.getLeadScore(lead!.id)).breakdown.map((b) => b.signal)).toContain("provided_contact");
  });

  it("never merges: a phone that belongs to someone else is flagged, not attached", async () => {
    const { chat, core } = await setup(() => [submit({ reply: "Hello!" })]);
    await core.customers.createCustomer({ phone: "03001234567", fullName: "Existing Customer" }, { actor: { type: "system" } });
    const a = await chat.sendMessage(visitor(), { message: "hi" });
    const res = await chat.submitContact(visitor(a.sessionToken), { phone: "03001234567" });
    expect(res.body).toMatchObject({ saved: false });
    expect(res.body.message).not.toMatch(/Existing Customer/);
    const visitorCustomer = await core.customers.findCustomerByExternalIdentity("website_visitor", sessionIdentityValue(a.sessionToken!));
    expect(visitorCustomer?.phone).toBeNull();
    const n = (await t.db.query<{ n: number }>(`select count(*)::int as n from agent_actions where action_type = 'customer_identity_conflict'`))[0]!.n;
    expect(n).toBe(1);
  });

  it("rejects invalid contact details", async () => {
    const { chat } = await setup(() => []);
    await expect(chat.submitContact(visitor(), { phone: "123" })).rejects.toMatchObject({ status: 400 });
    await expect(chat.submitContact(visitor(), {})).rejects.toMatchObject({ status: 400 });
  });
});

describe("formatting", () => {
  it("formats prices exactly", () => {
    expect(formatPrice("485000.00", "PKR")).toBe("PKR 485,000");
    expect(formatPrice("999999999999.99", "PKR")).toBe("PKR 999,999,999,999.99");
  });
});

