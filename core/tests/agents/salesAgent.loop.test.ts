import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { lastToolResult, textBlock, toolResults, toolUseBlock } from "../../src/agents/llm/scriptedLlmClient.js";
import { createSalesAgent } from "../../src/agents/sales/salesAgent.js";
import { DEMO_BUSINESS_INFO } from "../../src/demo/demoData.js";
import { ValidationError } from "../../src/lib/errors.js";
import type { LlmClient } from "../../src/agents/llm/llmClient.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { actionTypes, call, messagesOf, setupAgent, signalsOf, submit } from "./harness.js";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const count = async (sql: string, params: unknown[] = []) => (await t.db.query<{ n: number }>(sql, params))[0]!.n;

describe("tool errors and invalid arguments", () => {
  it("18. a controlled business error reaches the model as a readable tool error", async () => {
    const { agent, customerId } = await setupAgent(t, [
      call("get_product", { sku: "DEMO-XX-999" }),
      (req) => {
        expect(lastToolResult(req)).toMatchObject({ isError: true, data: { error: "PRODUCT_NOT_FOUND" } });
        return submit({ reply: "I couldn't find that piece in our collection. Could you share a photo or describe it?", intent: "product_details" })(req, 1);
      },
    ]);
    const r = await agent.handleMessage({ customerId, message: "Do you have DEMO-XX-999?" });
    expect(r.status).toBe("replied");
    expect(await actionTypes(t, r.conversationId)).toContain("tool_call_rejected");
  });

  it("18b. an infrastructure failure is hidden from the model and never guessed around", async () => {
    const { agent, customerId, core } = await setupAgent(t, [
      call("search_products", { query: "necklace" }),
      (req) => {
        const res = lastToolResult(req)!;
        expect(res).toMatchObject({ isError: true, data: { error: "TOOL_UNAVAILABLE" } });
        expect(JSON.stringify(res.data)).not.toContain("connection refused");
        return submit({
          reply: "I'm having trouble checking our collection right now; a team member will help you shortly.",
          intent: "product_search",
          handoff: { required: true, reason: "low_ai_confidence" },
        })(req, 1);
      },
    ]);
    core.products.searchProducts = async () => {
      throw new Error("connection refused to postgres://user:secret@db");
    };
    const r = await agent.handleMessage({ customerId, message: "Show me necklaces" });
    expect(r.humanHandoff).toMatchObject({ required: true, reason: "low_ai_confidence" });
  });

  it("19. invalid tool arguments fail safely without touching the database", async () => {
    const { agent, customerId, llm } = await setupAgent(t, [
      () => [
        toolUseBlock("record_lead_signal", { signal: "super_hot", evidence: "" }),
        toolUseBlock("record_product_interest", { productId: "11111111-1111-4111-8111-111111111111", interestType: "asked_price" }),
        toolUseBlock("search_products", { query: "ring", customerId: "11111111-1111-4111-8111-111111111111" }),
        toolUseBlock("schedule_followup", { scheduledFor: "2020-01-01T10:00:00+05:00" }),
        toolUseBlock("run_sql", { sql: "select * from customers" }),
      ],
      submit({ reply: "How can I help you today?" }),
    ]);
    const r = await agent.handleMessage({ customerId, message: "hi" });
    expect(r.status).toBe("replied");
    const results = toolResults(llm.requests[1]!);
    expect(results.map((x) => (x.data as { error: string }).error)).toEqual([
      "INVALID_TOOL_INPUT", // unknown signal + empty evidence
      "PRODUCT_NOT_VERIFIED", // id never returned by a product tool
      "INVALID_TOOL_INPUT", // tools take no customer ids: scope is injected by code
      "FOLLOWUP_NOT_ALLOWED", // in the past
      "UNKNOWN_TOOL", // there is no SQL tool
    ]);
    expect(results.every((x) => x.isError)).toBe(true);
    expect(await count(`select count(*)::int as n from lead_signal_events`)).toBe(0);
    expect(await count(`select count(*)::int as n from product_interests`)).toBe(0);
    expect(await count(`select count(*)::int as n from followups`)).toBe(0);
    expect(await count(`select count(*)::int as n from agent_actions where action_type = 'tool_call_rejected'`)).toBe(5);
  });

  it("19b. a valid follow-up is scheduled as a record only", async () => {
    const when = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const { agent, customerId } = await setupAgent(t, [
      call("schedule_followup", { scheduledFor: when, note: "Call after Eid", messageDraft: "Salam! Following up on bridal sets." }),
      submit({ reply: "Of course, our team will get in touch after Eid.", followupRecommended: true }),
    ]);
    const r = await agent.handleMessage({ customerId, message: "Please contact me after Eid" });
    expect(r.followupRecommended).toBe(true);
    expect(r.actionsRecorded.map((a) => a.type)).toContain("followup_created");
    expect(await count(`select count(*)::int as n from followups where status = 'pending'`)).toBe(1);
    expect((await messagesOf(t, r.conversationId)).filter((m) => m.direction === "outbound")).toHaveLength(1);
  });
});

describe("loop control", () => {
  it("20. maximum model calls: falls back safely and hands off", async () => {
    // The model keeps searching forever.
    const { agent, customerId, llm } = await setupAgent(t, () => () => call("search_products", { query: "ring" }), {
      config: { maxModelCalls: 3 },
    });
    const r = await agent.handleMessage({ customerId, message: "Show me rings" });
    expect(r).toMatchObject({ status: "failed_safe", modelCalls: 3, humanHandoff: { required: true, reason: "low_ai_confidence" } });
    expect(llm.requests).toHaveLength(3);
    const last = (await messagesOf(t, r.conversationId)).at(-1)!;
    expect(last).toMatchObject({ direction: "outbound", sender_type: "system" });
  });

  it("plain text without submit_reply is never sent; the model is asked to submit", async () => {
    const { agent, customerId, llm } = await setupAgent(t, [
      () => [textBlock("Hello! How can I help?")],
      submit({ reply: "Hello! How may I help you today?" }),
    ]);
    const r = await agent.handleMessage({ customerId, message: "Hello" });
    expect(r.reply).toBe("Hello! How may I help you today?");
    expect(llm.requests).toHaveLength(2);
  });

  it("submit_reply together with other tools is rejected (reply must follow tool results)", async () => {
    const { agent, customerId, llm } = await setupAgent(t, [
      () => [toolUseBlock("search_products", { query: "ring" }), toolUseBlock("submit_reply", { reply: "Here you go", intent: "product_search", language: "english", confidence: "high" })],
      submit({ reply: "Let me know which style you prefer.", intent: "product_search" }),
    ]);
    const r = await agent.handleMessage({ customerId, message: "rings" });
    expect(r.status).toBe("replied");
    expect(JSON.stringify(toolResults(llm.requests[1]!).at(-1)!.data)).toContain("Call submit_reply alone");
  });

  it("model provider errors and refusals fall back safely", async () => {
    for (const failing of [
      { model: "x", createMessage: async () => { throw new Error("503"); } },
      { model: "x", createMessage: async () => ({ content: [], stop_reason: "refusal" }) as never },
    ] satisfies LlmClient[]) {
      await t.reset();
      const { core, customerId } = await setupAgent(t, []);
      const agent = createSalesAgent({ core, llm: failing, businessInfo: DEMO_BUSINESS_INFO });
      const r = await agent.handleMessage({ customerId, message: "Mujhe bridal set chahiye, kya hai?" });
      expect(r).toMatchObject({ status: "failed_safe", language: "roman_urdu", humanHandoff: { reason: "low_ai_confidence" } });
      expect(r.reply).toMatch(/Zarghoon Jewellers ki team/);
    }
  });

  it("times out safely", async () => {
    const { core, customerId } = await setupAgent(t, []);
    const slow: LlmClient = {
      model: "slow",
      createMessage: (_req, opts) =>
        new Promise((_resolve, reject) => opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    };
    const agent = createSalesAgent({ core, llm: slow, businessInfo: DEMO_BUSINESS_INFO, config: { turnTimeoutMs: 50 } });
    const r = await agent.handleMessage({ customerId, message: "Hello" });
    expect(r.status).toBe("failed_safe");
    expect(await actionTypes(t, r.conversationId)).toContain("sales_agent_turn");
    const [turn] = await t.db.query<{ error_message: string }>(`select error_message from agent_actions where action_type = 'sales_agent_turn'`);
    expect(turn!.error_message).toBe("timeout");
  });

  it("validates input and conversation ownership", async () => {
    const { agent, customerId, core } = await setupAgent(t, []);
    await expect(agent.handleMessage({ customerId, message: "   " })).rejects.toBeInstanceOf(ValidationError);
    await expect(agent.handleMessage({ customerId, message: "hi", channel: "whatsapp" } as never)).rejects.toBeInstanceOf(ValidationError);
    const other = (await core.customers.createCustomer({ phone: "03007654321" }, { actor: { type: "system" } })).customer.id;
    const convo = await core.conversations.createConversation({ channel: "website", customerId: other }, { actor: { type: "system" } });
    await expect(agent.handleMessage({ customerId, conversationId: convo.id, message: "hi" })).rejects.toThrow(/does not belong/);
  });

  it("continues an existing conversation using stored history, not model memory", async () => {
    const { agent, customerId, llm } = await setupAgent(t, [
      submit({ reply: "Welcome! What occasion are you shopping for?" }),
      (req) => {
        const context = req.messages[0]!.content as string;
        expect(context).toContain("Customer: Hi there");
        expect(context).toContain("You: Welcome! What occasion are you shopping for?");
        expect(context).toContain("<customer_message>\nMy sister's wedding\n</customer_message>");
        return submit({ reply: "Congratulations! Shall I show you some bridal pieces?" })(req, 1);
      },
    ]);
    const first = await agent.handleMessage({ customerId, message: "Hi there" });
    const second = await agent.handleMessage({ customerId, conversationId: first.conversationId, message: "My sister's wedding" });
    expect(second.status).toBe("replied");
    expect(llm.requests).toHaveLength(2);
    expect(await signalsOf(t, second.leadId!)).toEqual([]);
  });

  it("the internal_test channel is stored as 'other' and marked in metadata", async () => {
    const { agent, customerId } = await setupAgent(t, [submit({ reply: "Hello!" })]);
    const r = await agent.handleMessage({ customerId, message: "test", channel: "internal_test" });
    const [c] = await t.db.query<{ channel: string }>(`select channel from conversations where id = $1`, [r.conversationId]);
    expect(c!.channel).toBe("other");
  });
});
