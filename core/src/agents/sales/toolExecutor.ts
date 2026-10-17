import type { BusinessInfo } from "../../config/businessInfo.js";
import type { ZarghoonCore } from "../../index.js";
import { AppError, DuplicateLeadSignalError, toPublicError } from "../../lib/errors.js";
import type { Logger } from "../../lib/logger.js";
import { zodIssues } from "../../lib/validation.js";
import type { HandoffReason, HandoffUrgency } from "../../schemas/crm.js";
import type { Product } from "../../schemas/product.js";
import type { ActionContext } from "../../types/context.js";
import { toolInputSchemas, type SalesToolInput, type SalesToolName } from "./toolDefinitions.js";
import type { ActionRecord } from "./types.js";

/**
 * Executes model tool calls against the real business services.
 *
 * Every call is: looked up in the closed tool set → validated with Zod (no
 * side effects on failure) → executed with customer/conversation scope
 * injected from the turn → returned as a controlled JSON result. Errors never
 * escape as exceptions to the model loop; business errors become readable
 * tool errors, infrastructure errors become a generic message.
 */

export interface TurnScope {
  customerId: string;
  conversationId: string;
  leadId: string | null;
  inboundMessageId: string;
}

export interface PendingHandoff {
  reason: HandoffReason;
  urgency: HandoffUrgency;
  note: string;
}

/** Everything learned during one turn; the response validator grounds the reply against it. */
export class TurnState {
  readonly toolsUsed: string[] = [];
  /** Products the database returned this turn: the only ids the model may reference. */
  readonly seenProducts = new Map<string, { sku: string; name: string }>();
  readonly inventoryChecked = new Set<string>();
  /** Raw JSON of every successful tool result — the reply's allowed fact sources. */
  readonly factSources: string[] = [];
  readonly actions: ActionRecord[] = [];
  pendingHandoff: PendingHandoff | null = null;
  infrastructureFailure = false;
}

export interface ToolExecutionResult {
  content: string;
  isError: boolean;
}

const URGENCY_RANK: Record<HandoffUrgency, number> = { normal: 0, high: 1, urgent: 2 };

/** Customer-safe product view. Internal cost fields (making charge, stone cost) are never exposed. */
function productView(p: Product) {
  return {
    productId: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    category: p.category,
    collection: p.collection,
    metal: p.metal,
    karat: p.karat,
    weightGrams: p.weightGrams,
    approvedPrice: p.approvedPrice,
    currency: p.currency,
    priceStatus: p.approvedPrice === null ? "requires_confirmation" : "approved",
    stockStatus: p.stockStatus,
    size: p.size,
    websiteUrl: p.websiteUrl,
    isActive: p.isActive,
  };
}

export interface ToolExecutorDeps {
  core: ZarghoonCore;
  scope: TurnScope;
  state: TurnState;
  ctx: ActionContext;
  businessInfo: BusinessInfo;
  logger: Logger;
}

export function createToolExecutor(deps: ToolExecutorDeps) {
  const { core, scope, state, businessInfo, logger } = deps;
  const ctxFor = (toolName: string): ActionContext => ({ ...deps.ctx, toolName });

  const remember = (p: { id: string; sku: string; name: string }) => state.seenProducts.set(p.id, { sku: p.sku, name: p.name });

  /** Read-only lookups are audited too, so every fact shown to a customer is traceable. */
  const auditRead = (actionType: string, toolName: string, input: unknown, output: unknown) =>
    core.audit.recordAction(ctxFor(toolName), {
      actionType,
      customerId: scope.customerId,
      leadId: scope.leadId,
      conversationId: scope.conversationId,
      input,
      output,
    });

  const handlers: { [N in Exclude<SalesToolName, "submit_reply">]: (input: SalesToolInput<N>) => Promise<unknown> } = {
    async get_customer_360() {
      const c = await core.customer360.getCustomer360(scope.customerId, { messageLimit: 0 });
      for (const i of c.productInterests) remember({ id: i.productId, sku: i.productSku, name: i.productName });
      await auditRead("customer_360_viewed", "get_customer_360", {}, { activeLeadId: c.activeLead?.id ?? null });
      return {
        customer: {
          fullName: c.customer.fullName,
          city: c.customer.city,
          preferredLanguage: c.customer.preferredLanguage,
          doNotContact: c.doNotContact,
        },
        // Lead score is deliberately not shown to the model: it is internal and never quoted.
        activeLead: c.activeLead ? { status: c.activeLead.status, budgetAmount: c.activeLead.budgetAmount } : null,
        productInterests: c.productInterests.map((i) => ({
          productId: i.productId,
          sku: i.productSku,
          name: i.productName,
          interestType: i.interestType,
          at: i.createdAt.toISOString(),
        })),
        pendingFollowups: c.pendingFollowups.map((f) => ({ type: f.followupType, scheduledFor: f.scheduledFor.toISOString() })),
        orders: { total: c.ordersSummary.totalOrders, open: c.ordersSummary.openOrders, delivered: c.ordersSummary.deliveredOrders },
        humanTakeoverActive: c.humanTakeoverStatus.active,
      };
    },

    async get_recent_messages(input) {
      const messages = await core.conversations.getRecentMessages(scope.conversationId, input.limit);
      return messages.map((m) => ({ sender: m.senderType, content: m.content, at: m.createdAt.toISOString() }));
    },

    async search_products(input) {
      const results = await core.products.searchProducts({ ...input, includeInactive: false });
      results.forEach(remember);
      await auditRead("product_search", "search_products", input, { count: results.length, skus: results.map((r) => r.sku) });
      return { count: results.length, products: results.map(productView) };
    },

    async get_product(input) {
      const p = await core.products.getProduct(input.productId ? { id: input.productId } : { sku: input.sku! });
      remember(p);
      await auditRead("product_viewed", "get_product", input, { productId: p.id, sku: p.sku });
      return productView(p);
    },

    async check_inventory(input) {
      const inv = await core.products.checkInventory(input.productId ? { id: input.productId } : { sku: input.sku! });
      remember({ id: inv.productId, sku: inv.sku, name: inv.name });
      state.inventoryChecked.add(inv.productId);
      await auditRead("inventory_check", "check_inventory", input, inv);
      return inv;
    },

    async record_product_interest(input) {
      if (!state.seenProducts.has(input.productId)) {
        throw new ToolUsageError(
          "PRODUCT_NOT_VERIFIED",
          "Look the product up with search_products, get_product or check_inventory first; only ids returned by those tools may be used.",
        );
      }
      const res = await core.productInterests.recordProductInterest(
        {
          customerId: scope.customerId,
          productId: input.productId,
          interestType: input.interestType,
          leadId: scope.leadId ?? undefined,
          conversationId: scope.conversationId,
          messageId: scope.inboundMessageId,
          notes: input.notes,
        },
        ctxFor("record_product_interest"),
      );
      state.actions.push({
        type: "product_interest_recorded",
        detail: { productId: input.productId, interestType: input.interestType, duplicate: res.duplicate, signalsRecorded: res.signalsRecorded },
      });
      return { recorded: !res.duplicate, interestType: input.interestType };
    },

    async record_lead_signal(input) {
      if (!scope.leadId) {
        return { recorded: false, reason: "no_active_lead" };
      }
      try {
        await core.leads.recordLeadSignal(
          scope.leadId,
          { signal: input.signal, evidence: input.evidence, sourceMessageId: scope.inboundMessageId },
          ctxFor("record_lead_signal"),
        );
      } catch (error) {
        // Already counted: not an error, and never counted twice.
        if (error instanceof DuplicateLeadSignalError) return { recorded: false, reason: "already_recorded" };
        throw error;
      }
      state.actions.push({ type: "lead_signal_recorded", detail: { signal: input.signal } });
      // Points and score are deliberately not returned to the model.
      return { recorded: true, signal: input.signal };
    },

    async schedule_followup(input) {
      const f = await core.followups.scheduleFollowup(
        {
          customerId: scope.customerId,
          leadId: scope.leadId ?? undefined,
          conversationId: scope.conversationId,
          followupType: input.followupType,
          channel: "website",
          scheduledFor: input.scheduledFor,
          note: input.note,
          messageDraft: input.messageDraft,
        },
        ctxFor("schedule_followup"),
      );
      state.actions.push({ type: "followup_created", detail: { followupId: f.id, scheduledFor: f.scheduledFor.toISOString() } });
      return { scheduled: true, scheduledFor: f.scheduledFor.toISOString(), note: "Recorded for staff. Nothing is sent automatically." };
    },

    async request_human_handoff(input) {
      // Deferred: executing now would activate takeover and block the reply the
      // customer is owed. The orchestrator creates it right after the reply.
      const current = state.pendingHandoff;
      if (!current || URGENCY_RANK[input.urgency] > URGENCY_RANK[current.urgency]) {
        state.pendingHandoff = { reason: input.reason, urgency: input.urgency, note: input.note };
      }
      return {
        accepted: true,
        note: "A team member will take over after your reply. Tell the customer the team will follow up; promise nothing else.",
      };
    },

    async get_business_info() {
      await auditRead("business_info_viewed", "get_business_info", {}, {});
      const { isDemo, ...facts } = businessInfo;
      return { ...facts, ...(isDemo ? { notice: "DEMO DATA — not a real store" } : {}) };
    },

    async set_preferred_language(input) {
      const customer = await core.customers.setPreferredLanguage(
        scope.customerId,
        { language: input.language, evidenceMessageId: scope.inboundMessageId },
        ctxFor("set_preferred_language"),
      );
      state.actions.push({ type: "preferred_language_set", detail: { language: customer.preferredLanguage } });
      return { saved: true, language: customer.preferredLanguage };
    },
  };

  async function execute(name: string, rawInput: unknown): Promise<ToolExecutionResult> {
    if (!(name in handlers)) {
      return reject(name, rawInput, "UNKNOWN_TOOL", `Tool "${name}" does not exist`);
    }
    const toolName = name as Exclude<SalesToolName, "submit_reply">;
    const parsed = toolInputSchemas[toolName].safeParse(rawInput);
    if (!parsed.success) {
      return reject(toolName, rawInput, "INVALID_TOOL_INPUT", "Tool input failed validation; nothing was changed", {
        issues: zodIssues(parsed.error),
      });
    }

    state.toolsUsed.push(toolName);
    try {
      const output = await (handlers[toolName] as (i: unknown) => Promise<unknown>)(parsed.data);
      const content = JSON.stringify(output);
      state.factSources.push(content);
      return { content, isError: false };
    } catch (error) {
      if (error instanceof ToolUsageError) return reject(toolName, parsed.data, error.code, error.message);
      if (error instanceof AppError && error.isBusinessError) {
        const pub = toPublicError(error);
        await auditFailure(toolName, parsed.data, pub.code, pub.message);
        return { content: JSON.stringify({ error: pub.code, message: pub.message, details: pub.details }), isError: true };
      }
      state.infrastructureFailure = true;
      logger.error("sales tool failed", { tool: toolName, error: error instanceof Error ? error.message : String(error) });
      return {
        content: JSON.stringify({ error: "TOOL_UNAVAILABLE", message: "This tool is temporarily unavailable. Do not guess; hand off to the team." }),
        isError: true,
      };
    }
  }

  async function auditFailure(toolName: string, input: unknown, code: string, message: string) {
    await core.audit.recordAction(ctxFor(toolName), {
      actionType: "tool_call_rejected",
      customerId: scope.customerId,
      conversationId: scope.conversationId,
      status: "failed",
      input,
      output: { code },
      errorMessage: message,
    });
  }

  async function reject(toolName: string, input: unknown, code: string, message: string, extra: Record<string, unknown> = {}) {
    logger.warn("sales tool call rejected", { tool: toolName, code });
    await auditFailure(toolName, input, code, message);
    return { content: JSON.stringify({ error: code, message, ...extra }), isError: true };
  }

  return { execute };
}

/** A tool was used incorrectly (not a service failure). */
class ToolUsageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type ToolExecutor = ReturnType<typeof createToolExecutor>;
