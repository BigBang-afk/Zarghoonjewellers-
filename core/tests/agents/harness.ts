import { DEMO_BUSINESS_INFO, seedDemoData } from "../../src/demo/demoData.js";
import { createSalesAgent, type SalesAgentConfig } from "../../src/agents/sales/salesAgent.js";
import { ScriptedLlmClient, toolUseBlock, type ScriptStep } from "../../src/agents/llm/scriptedLlmClient.js";
import type { BusinessInfo } from "../../src/config/businessInfo.js";
import type { LlmRequest } from "../../src/agents/llm/llmClient.js";
import type { SubmitReplyInput } from "../../src/agents/sales/toolDefinitions.js";
import { createCore, type TestCore } from "../helpers/core.js";
import type { TestDatabase } from "../helpers/testDb.js";
import { AI_CTX } from "../helpers/fixtures.js";

/** Builds a sales agent over a fresh demo database with a scripted (credential-free) model. */
export async function setupAgent(
  t: TestDatabase,
  /** Script steps, or a builder that receives seeded ids (product ids are random per run). */
  steps: ScriptStep[] | ((h: { pid: (sku: string) => string }) => ScriptStep[] | ((req: LlmRequest, i: number) => ScriptStep | undefined)),
  options: { config?: Partial<SalesAgentConfig>; businessInfo?: BusinessInfo; customer?: Record<string, unknown> } = {},
) {
  const core: TestCore = createCore(t.db);
  const seed = await seedDemoData(t.db);
  const { customer } = await core.customers.createCustomer(
    { phone: "03001234567", fullName: "Ayesha", ...options.customer },
    AI_CTX,
  );
  const pid = (sku: string) => {
    const id = seed.productIds[sku];
    if (!id) throw new Error(`No demo product ${sku}`);
    return id;
  };
  const llm = new ScriptedLlmClient(typeof steps === "function" ? steps({ pid }) : steps);
  const agent = createSalesAgent({
    core,
    llm,
    businessInfo: options.businessInfo ?? DEMO_BUSINESS_INFO,
    config: { turnTimeoutMs: 10_000, ...options.config },
  });
  return { core, llm, agent, customerId: customer.id, staffId: seed.staffId, pid };
}

// --- script step helpers ---------------------------------------------------------------

export const call =
  (name: string, input: unknown): ScriptStep =>
  () => [toolUseBlock(name, input)];

export const submit =
  (over: Partial<SubmitReplyInput> & { reply: string }): ScriptStep =>
  () => [
    toolUseBlock("submit_reply", {
      intent: "general_question",
      language: "english",
      productsReferenced: [],
      followupRecommended: false,
      handoff: { required: false },
      confidence: "high",
      ...over,
    }),
  ];

// --- DB inspection helpers ---------------------------------------------------------------

export async function messagesOf(t: TestDatabase, conversationId: string) {
  return t.db.query<{ direction: string; sender_type: string; content: string; language: string | null }>(
    `select direction, sender_type, content, language from messages where conversation_id = $1 order by created_at, id`,
    [conversationId],
  );
}

export async function signalsOf(t: TestDatabase, leadId: string) {
  const rows = await t.db.query<{ signal: string }>(`select signal from lead_signal_events where lead_id = $1 order by signal`, [leadId]);
  return rows.map((r) => r.signal);
}

export async function actionTypes(t: TestDatabase, conversationId: string) {
  const rows = await t.db.query<{ action_type: string }>(
    `select action_type from agent_actions where conversation_id = $1 order by created_at, id`,
    [conversationId],
  );
  return rows.map((r) => r.action_type);
}
