import { randomUUID } from "node:crypto";
import type { BusinessInfo } from "../../config/businessInfo.js";
import type { ZarghoonCore } from "../../index.js";
import {
  ActiveLeadExistsError,
  ConversationClosedError,
  DuplicateLeadSignalError,
  HumanTakeoverActiveError,
  InvalidStateError,
} from "../../lib/errors.js";
import { createLogger, type Logger } from "../../lib/logger.js";
import { parseInput, zodIssues } from "../../lib/validation.js";
import type { Conversation, Language } from "../../schemas/crm.js";
import { systemClock, type ActionContext, type Clock } from "../../types/context.js";
import type { LlmClient, LlmMessageParam, LlmToolResultBlockParam, LlmToolUseBlock } from "../llm/llmClient.js";
import { validateReply } from "./responseValidator.js";
import { buildTurnContext, SALES_SYSTEM_PROMPT } from "./salesPrompt.js";
import {
  detectLanguageHeuristic,
  keywordHandoff,
  MANDATORY_HANDOFF_BY_INTENT,
  mergeHandoffs,
  SAFE_FALLBACK_REPLY,
  SIGNAL_BY_INTENT,
  type HandoffDecision,
} from "./safety.js";
import { SALES_TOOLS, toolInputSchemas, type SubmitReplyInput } from "./toolDefinitions.js";
import { createToolExecutor, TurnState, type TurnScope } from "./toolExecutor.js";
import {
  salesAgentInputSchema,
  salesAgentResultSchema,
  type ActionRecord,
  type SalesAgentInput,
  type SalesAgentResult,
  type SalesIntent,
  type SalesTurnStatus,
} from "./types.js";

/**
 * Zarghoon Sales Agent — one customer message in, one structured result out.
 *
 *   store inbound message → stop if a human has taken over → ensure active lead
 *   → load Customer 360 + history → controlled model/tool loop → validate the
 *   reply against tool data → record intent-derived signals → store the reply
 *   → create any handoff → read the score back from the scoring engine
 *
 * The model decides what to say and which tools to call. Code decides what is
 * allowed, what is true, and what gets recorded.
 */

export interface SalesAgentConfig {
  /** Maximum model calls per turn (each call may run several tools). */
  maxModelCalls: number;
  /** Wall-clock budget for the whole turn. */
  turnTimeoutMs: number;
  /** How many times a rejected submit_reply may be corrected before falling back. */
  maxReplyCorrections: number;
  historyLimit: number;
}

export const DEFAULT_SALES_AGENT_CONFIG: SalesAgentConfig = {
  maxModelCalls: 8,
  turnTimeoutMs: 120_000,
  maxReplyCorrections: 2,
  historyLimit: 20,
};

export interface SalesAgentDeps {
  core: ZarghoonCore;
  llm: LlmClient;
  businessInfo: BusinessInfo;
  clock?: Clock;
  logger?: Logger;
  config?: Partial<SalesAgentConfig>;
}

type FailReason = "model_error" | "model_refusal" | "timeout" | "max_iterations" | "invalid_reply" | "tool_unavailable";

const silentLogger = createLogger({}, () => undefined);

/** Maps the public channel to the stored conversation channel. */
const DB_CHANNEL = { website: "website", internal_test: "other" } as const;

export function createSalesAgent(deps: SalesAgentDeps) {
  const { core, llm, businessInfo } = deps;
  const clock = deps.clock ?? systemClock;
  const config = { ...DEFAULT_SALES_AGENT_CONFIG, ...deps.config };
  const baseLogger = deps.logger ?? silentLogger;

  async function handleMessage(rawInput: SalesAgentInput): Promise<SalesAgentResult> {
    const input = parseInput(salesAgentInputSchema, rawInput, "sales agent input");
    const requestId = input.requestId ?? randomUUID();
    const ctx: ActionContext = { actor: { type: "ai", agentName: "sales_agent" }, requestId };
    const actions: ActionRecord[] = [];

    // 1. Identify customer and conversation.
    const customer = await core.customers.getCustomer(input.customerId);
    const conversation = await openConversation(input, ctx);
    const logger = baseLogger.child({ requestId, customerId: customer.id, conversationId: conversation.id });

    // 2. Always store what the customer said (customer messages are never blocked).
    const heuristicLanguage = detectLanguageHeuristic(input.message);
    const inbound = await core.conversations.addMessage(
      {
        conversationId: conversation.id,
        direction: "inbound",
        senderType: "customer",
        content: input.message,
        language: heuristicLanguage,
        metadata: { channel: input.channel, requestId },
      },
      ctx,
    );
    actions.push({ type: "inbound_message_stored", detail: { messageId: inbound.message.id } });

    // 3. A human is in control: no model call, no AI reply.
    const current = await core.conversations.getConversation(conversation.id);
    if (current.humanTakeover) {
      await core.audit.recordAction(ctx, {
        actionType: "sales_agent_skipped_human_takeover",
        customerId: customer.id,
        conversationId: conversation.id,
        status: "rejected",
        output: { inboundMessageId: inbound.message.id },
      });
      const lead = await core.leads.getActiveLead(customer.id);
      return finish({
        status: "human_takeover_active",
        reply: null,
        outboundMessageId: null,
        intent: "unknown",
        language: heuristicLanguage,
        leadId: lead?.id ?? null,
        handoff: null,
        handoffId: null,
        followupRecommended: false,
        state: new TurnState(),
        productIds: [],
        actions,
        modelCalls: 0,
        humanTakeoverActive: true,
      });
    }

    // 4. Every sales conversation is tracked against an active lead (unless the customer opted out).
    const leadId = customer.doNotContact ? null : await ensureActiveLead(customer.id, conversation, ctx, actions);

    // 5. Context: Customer 360 and history from the database — not model memory.
    const customer360 = await core.customer360.getCustomer360(customer.id, { messageLimit: 0 });
    const history = (await core.conversations.getRecentMessages(conversation.id, config.historyLimit + 1)).filter(
      (m) => m.id !== inbound.message.id,
    );
    const contextText = buildTurnContext({ now: clock(), customer360, history, currentMessage: input.message });

    const scope: TurnScope = { customerId: customer.id, conversationId: conversation.id, leadId, inboundMessageId: inbound.message.id };
    const state = new TurnState();
    for (const i of customer360.productInterests) state.seenProducts.set(i.productId, { sku: i.productSku, name: i.productName });
    state.factSources.push(contextText);
    const customerTexts = [input.message, ...history.filter((m) => m.senderType === "customer").map((m) => m.content)];
    const executor = createToolExecutor({ core, scope, state, ctx, businessInfo, logger });

    // 6. Controlled model loop.
    const loop = await runModelLoop(contextText, executor, state, customerTexts, logger);

    // 7. Deterministic post-processing.
    const submission = loop.submission;
    const intent: SalesIntent = submission?.intent ?? "unknown";
    const language: Language = submission?.language ?? heuristicLanguage;
    const failed = !submission;

    const handoff = mergeHandoffs([
      failed ? { reason: "low_ai_confidence", urgency: "normal", source: "safety_failure", note: `Sales agent fell back safely (${loop.failReason})` } : null,
      MANDATORY_HANDOFF_BY_INTENT[intent] ? { ...MANDATORY_HANDOFF_BY_INTENT[intent]!, source: "intent_rule", note: `Intent: ${intent}` } : null,
      keywordHandoff(input.message),
      state.pendingHandoff ? { ...state.pendingHandoff, source: "model_tool" } : null,
      submission?.handoff.required
        ? {
            reason: submission.handoff.reason ?? "low_ai_confidence",
            urgency: submission.handoff.urgency ?? "normal",
            source: "model",
            note: "Requested by the sales agent",
          }
        : null,
    ]);

    // Intent-implied lead signals (idempotent; scoring stays deterministic).
    const signal = SIGNAL_BY_INTENT[intent];
    if (signal && leadId) {
      try {
        await core.leads.recordLeadSignal(leadId, { signal, evidence: `intent: ${intent}`, sourceMessageId: inbound.message.id }, { ...ctx, toolName: "intent_rules" });
        actions.push({ type: "lead_signal_recorded", detail: { signal, source: "intent_rule" } });
      } catch (error) {
        if (!(error instanceof DuplicateLeadSignalError)) throw error;
      }
    }

    // 8. Store the reply — only while the AI is still allowed to speak.
    const reply = submission?.reply ?? SAFE_FALLBACK_REPLY[language];
    let outboundMessageId: string | null = null;
    try {
      const outbound = await core.conversations.addMessage(
        {
          conversationId: conversation.id,
          direction: "outbound",
          // A model-written reply is "ai"; the fixed fallback text is "system".
          senderType: failed ? "system" : "ai",
          content: reply,
          language,
          metadata: { requestId, intent, productsReferenced: submission?.productsReferenced ?? [] },
        },
        ctx,
      );
      outboundMessageId = outbound.message.id;
      actions.push({ type: failed ? "fallback_reply_stored" : "ai_reply_stored", detail: { messageId: outboundMessageId } });
    } catch (error) {
      if (!(error instanceof HumanTakeoverActiveError)) throw error;
      // A staff member took over while the model was thinking: discard the reply.
      logger.info("reply discarded: human takeover began during the turn");
      return finish({
        status: "human_takeover_active",
        reply: null,
        outboundMessageId: null,
        intent,
        language,
        leadId,
        handoff: null,
        handoffId: null,
        followupRecommended: submission?.followupRecommended ?? false,
        state,
        productIds: [],
        actions,
        modelCalls: loop.modelCalls,
        humanTakeoverActive: true,
      });
    }

    // 9. Hand off after the reply is stored (takeover then blocks further AI replies).
    let handoffId: string | null = null;
    if (handoff) {
      const res = await core.handoffs.requestHumanHandoff(
        { conversationId: conversation.id, leadId: leadId ?? undefined, reason: handoff.reason, urgency: handoff.urgency, note: handoff.note },
        { ...ctx, toolName: "request_human_handoff" },
      );
      handoffId = res.handoff.id;
      actions.push({ type: "handoff_requested", detail: { handoffId, reason: res.handoff.reason, urgency: res.handoff.urgency, source: handoff.source } });
    }

    const status: SalesTurnStatus = failed ? "failed_safe" : handoff ? "replied_and_handed_off" : "replied";
    await core.audit.recordAction(ctx, {
      actionType: "sales_agent_turn",
      customerId: customer.id,
      leadId,
      conversationId: conversation.id,
      status: failed ? "failed" : "succeeded",
      errorMessage: failed ? loop.failReason : null,
      input: { inboundMessageId: inbound.message.id, channel: input.channel },
      output: {
        status,
        intent,
        language,
        model: llm.model,
        modelCalls: loop.modelCalls,
        toolsUsed: state.toolsUsed,
        productsReferenced: submission?.productsReferenced ?? [],
        handoff: handoff ? { reason: handoff.reason, urgency: handoff.urgency, source: handoff.source } : null,
      },
    });

    return finish({
      status,
      reply,
      outboundMessageId,
      intent,
      language,
      leadId,
      handoff,
      handoffId,
      followupRecommended: submission?.followupRecommended ?? false,
      state,
      productIds: submission?.productsReferenced ?? [],
      actions,
      modelCalls: loop.modelCalls,
      humanTakeoverActive: handoff !== null,
    });

    // --- helpers bound to this turn -------------------------------------------------

    async function finish(r: {
      status: SalesTurnStatus;
      reply: string | null;
      outboundMessageId: string | null;
      intent: SalesIntent;
      language: Language;
      leadId: string | null;
      handoff: HandoffDecision | null;
      handoffId: string | null;
      followupRecommended: boolean;
      state: TurnState;
      productIds: string[];
      actions: ActionRecord[];
      modelCalls: number;
      humanTakeoverActive: boolean;
    }): Promise<SalesAgentResult> {
      // The score is read back from the deterministic engine, never taken from the model.
      const lead = r.leadId ? await core.leads.getLeadById(r.leadId) : null;
      // Only products the database returned this turn can be reported.
      const referenced = r.productIds
        .filter((id) => r.state.seenProducts.has(id))
        .map((id) => ({ productId: id, ...r.state.seenProducts.get(id)! }));
      return salesAgentResultSchema.parse({
        status: r.status,
        reply: r.reply,
        customerId: customer.id,
        conversationId: conversation.id,
        inboundMessageId: inbound.message.id,
        outboundMessageId: r.outboundMessageId,
        intent: r.intent,
        language: r.language,
        toolsUsed: r.state.toolsUsed,
        productsReferenced: referenced,
        leadId: r.leadId,
        leadScore: lead?.score ?? null,
        leadClassification: lead?.scoreClassification ?? null,
        followupRecommended: r.followupRecommended,
        humanHandoff: {
          required: r.handoff !== null,
          reason: r.handoff?.reason ?? null,
          urgency: r.handoff?.urgency ?? null,
          handoffId: r.handoffId,
        },
        humanTakeoverActive: r.humanTakeoverActive,
        actionsRecorded: [...r.actions, ...r.state.actions],
        modelCalls: r.modelCalls,
        requestId,
      });
    }
  }

  async function openConversation(input: ReturnType<typeof salesAgentInputSchema.parse>, ctx: ActionContext): Promise<Conversation> {
    if (!input.conversationId) {
      return core.conversations.createConversation({ channel: DB_CHANNEL[input.channel], customerId: input.customerId }, ctx);
    }
    const conversation = await core.conversations.getConversation(input.conversationId);
    if (conversation.customerId !== input.customerId) {
      throw new InvalidStateError("Conversation does not belong to this customer", { conversationId: conversation.id });
    }
    if (conversation.status === "closed") throw new ConversationClosedError(conversation.id);
    return conversation;
  }

  async function ensureActiveLead(customerId: string, conversation: Conversation, ctx: ActionContext, actions: ActionRecord[]) {
    let lead = await core.leads.getActiveLead(customerId);
    if (!lead) {
      try {
        lead = await core.leads.createLead({ customerId, sourceChannel: "website" }, ctx);
        actions.push({ type: "lead_created", detail: { leadId: lead.id } });
      } catch (error) {
        if (!(error instanceof ActiveLeadExistsError)) throw error;
        lead = await core.leads.getActiveLead(customerId);
      }
    }
    if (lead && !conversation.leadId) {
      await core.conversations.attachCustomer(conversation.id, { customerId, leadId: lead.id }, ctx);
    }
    return lead?.id ?? null;
  }

  async function runModelLoop(
    contextText: string,
    executor: ReturnType<typeof createToolExecutor>,
    state: TurnState,
    customerTexts: string[],
    logger: Logger,
  ): Promise<{ submission: SubmitReplyInput | null; failReason: FailReason | null; modelCalls: number }> {
    const messages: LlmMessageParam[] = [{ role: "user", content: contextText }];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.turnTimeoutMs);
    let corrections = 0;
    let modelCalls = 0;
    const fail = (failReason: FailReason) => {
      logger.warn("sales agent falling back safely", { reason: failReason, modelCalls });
      return { submission: null, failReason, modelCalls };
    };

    try {
      while (modelCalls < config.maxModelCalls) {
        if (controller.signal.aborted) return fail("timeout");
        let response;
        try {
          modelCalls++;
          response = await llm.createMessage({ system: SALES_SYSTEM_PROMPT, messages, tools: SALES_TOOLS }, { signal: controller.signal });
        } catch (error) {
          logger.error("model call failed", { error: error instanceof Error ? error.message : String(error) });
          return fail(controller.signal.aborted ? "timeout" : "model_error");
        }
        if (response.stop_reason === "refusal") return fail("model_refusal");
        if (response.stop_reason === "max_tokens") return fail("model_error");

        // Pass the assistant content back unchanged (thinking blocks included).
        messages.push({ role: "assistant", content: response.content });
        const toolUses = response.content.filter((b): b is LlmToolUseBlock => b.type === "tool_use");

        if (toolUses.length === 0) {
          // Plain text is never sent to a customer; the reply must go through submit_reply.
          if (++corrections > config.maxReplyCorrections) return fail("invalid_reply");
          messages.push({ role: "user", content: "Finish by calling submit_reply with your reply and the structured summary." });
          continue;
        }

        const results: LlmToolResultBlockParam[] = [];
        let accepted: SubmitReplyInput | null = null;
        for (const use of toolUses) {
          if (use.name !== "submit_reply") {
            if (controller.signal.aborted) return fail("timeout");
            const res = await executor.execute(use.name, use.input);
            results.push({ type: "tool_result", tool_use_id: use.id, content: res.content, is_error: res.isError });
            continue;
          }
          const verdict = checkSubmission(use, toolUses.length, state, customerTexts);
          if (verdict.ok) accepted = verdict.submission;
          else {
            corrections++;
            results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify({ error: "REPLY_REJECTED", problems: verdict.problems }), is_error: true });
          }
        }
        if (accepted) return { submission: accepted, failReason: null, modelCalls };
        if (corrections > config.maxReplyCorrections) return fail("invalid_reply");
        if (state.infrastructureFailure && modelCalls >= 2) return fail("tool_unavailable");
        messages.push({ role: "user", content: results });
      }
      return fail("max_iterations");
    } finally {
      clearTimeout(timer);
    }
  }

  function checkSubmission(
    use: LlmToolUseBlock,
    toolCallsInResponse: number,
    state: TurnState,
    customerTexts: string[],
  ): { ok: true; submission: SubmitReplyInput } | { ok: false; problems: string[] } {
    if (toolCallsInResponse > 1) {
      return { ok: false, problems: ["Call submit_reply alone, after you have received the results of your other tool calls."] };
    }
    const parsed = toolInputSchemas.submit_reply.safeParse(use.input);
    if (!parsed.success) return { ok: false, problems: zodIssues(parsed.error).map((i) => `${i.path}: ${i.message}`) };
    const verdict = validateReply(parsed.data, { state, customerTexts });
    return verdict.ok ? { ok: true, submission: parsed.data } : verdict;
  }

  return { handleMessage };
}

export type SalesAgent = ReturnType<typeof createSalesAgent>;
