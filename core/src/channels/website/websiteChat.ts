import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SalesAgent } from "../../agents/sales/salesAgent.js";
import type { SalesAgentResult } from "../../agents/sales/types.js";
import type { ZarghoonCore } from "../../index.js";
import {
  AppError,
  CustomerIdentityConflictError,
  DuplicateLeadSignalError,
  ValidationError,
} from "../../lib/errors.js";
import { emailSchema, phoneSchema } from "../../lib/identifiers.js";
import { createLogger, type Logger } from "../../lib/logger.js";
import { zodIssues } from "../../lib/validation.js";
import type { Conversation, Customer, Language, Message } from "../../schemas/crm.js";
import { systemClock, type ActionContext, type Clock } from "../../types/context.js";
import type { WebsiteChatConfig } from "./config.js";
import { buildProductCards, type ChatProductCard } from "./productCards.js";
import { SlidingWindowRateLimiter } from "./rateLimiter.js";
import { generateSessionToken, parseSessionToken, sessionIdentityValue } from "./session.js";

/**
 * Website chat channel: turns HTTP-level requests into Sales Agent turns.
 *
 * Security model:
 *  - Identity comes only from the server: a signed-in website account (as
 *    verified by the website's auth) or the opaque session token in an
 *    HttpOnly cookie. The browser never supplies customer or conversation
 *    IDs, so it cannot address another visitor's data.
 *  - Rate limits (per session, per IP, global daily budget) run before any
 *    database write or model call.
 *  - Errors are mapped to safe codes; internals never reach the browser.
 *  - Message text is never written to logs.
 */

export const HANDOFF_NOTICE = "Our team will assist you with this request.";
export const MAX_CHAT_MESSAGE_LENGTH = 1000;

export interface ChatVisitor {
  /** Raw cookie value (validated here; malformed tokens are ignored). */
  sessionToken: string | null | undefined;
  /** Present only when the website's own authentication verified the user. */
  account?: { userId: string; fullName: string | null } | null;
  ip?: string | null;
}

export type ChatRole = "customer" | "assistant" | "team" | "notice";

export interface ChatMessageView {
  id: string;
  role: ChatRole;
  text: string;
  language: Language | null;
  createdAt: string;
  products: ChatProductCard[];
}

export interface ChatDebugInfo {
  status: string;
  intent: string;
  language: string;
  leadScore: number | null;
  leadClassification: string | null;
  toolsUsed: string[];
  modelCalls: number;
  handoffReason: string | null;
  requestId: string;
}

export interface ChatStateView {
  mode: WebsiteChatConfig["mode"];
  model: WebsiteChatConfig["model"];
  available: boolean;
  messages: ChatMessageView[];
  humanTakeoverActive: boolean;
}

export interface ChatTurnView {
  messages: ChatMessageView[];
  humanTakeoverActive: boolean;
  debug?: ChatDebugInfo;
}

/** A failure that is safe to show the visitor. */
export class WebsiteChatError extends Error {
  constructor(
    readonly status: number,
    readonly code:
      | "invalid_input"
      | "rate_limited"
      | "assistant_unavailable"
      | "no_conversation"
      | "conflict"
      | "internal_error",
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "WebsiteChatError";
  }
}

/** Every response carries the session token the cookie should hold (rotated in when created). */
export interface ChatOutcome<T> {
  sessionToken: string | null;
  body: T;
}

export const sendMessageSchema = z.object({ message: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_LENGTH) }).strict();

export const contactSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100).optional(),
    phone: phoneSchema.optional(),
    email: emailSchema.optional(),
  })
  .strict()
  .refine((c) => c.fullName || c.phone || c.email, { message: "Share at least one detail" });

export interface WebsiteChatDeps {
  core: ZarghoonCore;
  agent: SalesAgent | null;
  config: WebsiteChatConfig;
  rateLimiter?: SlidingWindowRateLimiter;
  clock?: Clock;
  logger?: Logger;
}

const silentLogger = createLogger({}, () => undefined);

export function createWebsiteChat(deps: WebsiteChatDeps) {
  const { core, agent, config } = deps;
  const clock = deps.clock ?? systemClock;
  const limiter = deps.rateLimiter ?? new SlidingWindowRateLimiter(clock);
  const logger = deps.logger ?? silentLogger;
  const available = config.mode !== "off" && config.model !== "none" && agent !== null;
  const ctxFor = (requestId: string): ActionContext => ({ actor: { type: "system", name: "website_chat" }, requestId });

  // --- identity -------------------------------------------------------------------

  function identityOf(visitor: ChatVisitor, token: string) {
    return visitor.account
      ? { type: "website_account" as const, value: visitor.account.userId }
      : { type: "website_visitor" as const, value: sessionIdentityValue(token) };
  }

  async function findCustomer(visitor: ChatVisitor, token: string | null): Promise<Customer | null> {
    if (!visitor.account && !token) return null;
    const id = identityOf(visitor, token ?? "");
    return core.customers.findCustomerByExternalIdentity(id.type, id.value);
  }

  async function findOrCreateCustomer(visitor: ChatVisitor, token: string, requestId: string): Promise<Customer> {
    const existing = await findCustomer(visitor, token);
    if (existing) return existing;
    const identity = identityOf(visitor, token);
    // Only verified facts: the account's own name, or nothing at all for anonymous visitors.
    const res = await core.customers.createCustomer(
      { fullName: visitor.account?.fullName ?? undefined, externalIdentities: [identity] },
      ctxFor(requestId),
    );
    return res.customer;
  }

  async function openConversation(customerId: string): Promise<Conversation | null> {
    const conversations = await core.conversations.getCustomerConversations(customerId, { status: "open", limit: 10 });
    return conversations.find((c) => c.channel === "website") ?? null;
  }

  // --- views ----------------------------------------------------------------------

  async function toView(m: Message): Promise<ChatMessageView> {
    const role: ChatRole = m.senderType === "customer" ? "customer" : m.senderType === "staff" ? "team" : "assistant";
    const ids = Array.isArray(m.metadata.productsReferenced) ? (m.metadata.productsReferenced as unknown[]) : [];
    const productIds = ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x));
    return {
      id: m.id,
      role,
      text: m.content,
      language: m.language,
      createdAt: m.createdAt.toISOString(),
      products: role === "assistant" && productIds.length ? await buildProductCards(core, productIds) : [],
    };
  }

  const notice = (): ChatMessageView => ({
    id: `notice-${randomUUID()}`,
    role: "notice",
    text: HANDOFF_NOTICE,
    language: null,
    createdAt: clock().toISOString(),
    products: [],
  });

  // --- operations -----------------------------------------------------------------

  /** Current conversation for this visitor. Never creates records. */
  async function getState(visitor: ChatVisitor): Promise<ChatOutcome<ChatStateView>> {
    const token = parseSessionToken(visitor.sessionToken);
    const base = { mode: config.mode, model: config.model, available };
    if (config.mode === "off") return { sessionToken: token, body: { ...base, messages: [], humanTakeoverActive: false } };
    const customer = await guard(() => findCustomer(visitor, token));
    const conversation = customer ? await guard(() => openConversation(customer.id)) : null;
    if (!conversation) {
      return { sessionToken: token, body: { ...base, messages: [], humanTakeoverActive: false } };
    }
    const messages = await guard(async () => {
      const stored = await core.conversations.getRecentMessages(conversation.id, 50);
      return Promise.all(stored.map(toView));
    });
    if (conversation.humanTakeover) messages.push(notice());
    return { sessionToken: token, body: { ...base, messages, humanTakeoverActive: conversation.humanTakeover } };
  }

  async function sendMessage(visitor: ChatVisitor, rawBody: unknown): Promise<ChatOutcome<ChatTurnView>> {
    const parsed = sendMessageSchema.safeParse(rawBody);
    if (!parsed.success) {
      const unexpectedFields = parsed.error.issues.some((i) => i.code === "unrecognized_keys");
      throw new WebsiteChatError(
        400,
        "invalid_input",
        unexpectedFields ? "Invalid request." : `Please enter a message of 1 to ${MAX_CHAT_MESSAGE_LENGTH} characters.`,
      );
    }
    if (!available || !agent) {
      throw new WebsiteChatError(503, "assistant_unavailable", "Our assistant is unavailable right now. Please try again later.");
    }

    const token = parseSessionToken(visitor.sessionToken) ?? generateSessionToken();
    enforceRateLimits(visitor, token);

    const requestId = randomUUID();
    const started = clock().getTime();
    const result = await guard(async () => {
      const customer = await findOrCreateCustomer(visitor, token, requestId);
      const conversation = await openConversation(customer.id);
      return agent.handleMessage({
        customerId: customer.id,
        conversationId: conversation?.id,
        message: parsed.data.message,
        channel: "website",
        requestId,
      });
    });
    logger.info("website chat turn", { requestId, status: result.status, ms: clock().getTime() - started });

    const messages: ChatMessageView[] = [
      {
        id: result.inboundMessageId,
        role: "customer",
        text: parsed.data.message,
        language: null,
        createdAt: new Date(started).toISOString(),
        products: [],
      },
    ];
    if (result.reply && result.outboundMessageId) {
      messages.push({
        id: result.outboundMessageId,
        role: "assistant",
        text: result.reply,
        language: result.language,
        createdAt: clock().toISOString(),
        products: await guard(() => buildProductCards(core, result.productsReferenced.map((p) => p.productId))),
      });
    }
    if (result.humanTakeoverActive) messages.push(notice());

    return {
      sessionToken: token,
      body: { messages, humanTakeoverActive: result.humanTakeoverActive, ...(config.debug ? { debug: debugInfo(result) } : {}) },
    };
  }

  /** Closes the visitor's open conversation so the next message starts fresh. */
  async function resetConversation(visitor: ChatVisitor): Promise<ChatOutcome<{ reset: boolean }>> {
    assertEnabled();
    const token = parseSessionToken(visitor.sessionToken);
    const customer = await guard(() => findCustomer(visitor, token));
    const conversation = customer ? await guard(() => openConversation(customer.id)) : null;
    if (!conversation) return { sessionToken: token, body: { reset: false } };
    if (conversation.humanTakeover) {
      // Starting over must not become a way around a human handoff.
      throw new WebsiteChatError(409, "conflict", "A member of our team is looking after this conversation.");
    }
    await guard(() => core.conversations.closeConversation(conversation.id, ctxFor(randomUUID())));
    return { sessionToken: token, body: { reset: true } };
  }

  /**
   * Contact details the visitor typed into the contact form (not extracted
   * by the model). Stored as self-reported; an identifier that already
   * belongs to another customer is never merged — it is flagged for review.
   */
  async function submitContact(visitor: ChatVisitor, rawBody: unknown): Promise<ChatOutcome<{ saved: boolean; message: string }>> {
    const parsed = contactSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = zodIssues(parsed.error);
      throw new WebsiteChatError(400, "invalid_input", issues[0]?.path ? `Please check your ${issues[0].path}.` : "Please share at least one detail.");
    }
    assertEnabled();
    const token = parseSessionToken(visitor.sessionToken) ?? generateSessionToken();
    enforceRateLimits(visitor, token);
    const requestId = randomUUID();
    const ctx = ctxFor(requestId);

    return guard(async () => {
      const customer = await findOrCreateCustomer(visitor, token, requestId);
      try {
        await core.customers.updateCustomer(
          customer.id,
          { fullName: parsed.data.fullName, phone: parsed.data.phone, email: parsed.data.email },
          ctx,
        );
      } catch (error) {
        if (error instanceof CustomerIdentityConflictError) {
          // Audited by the customer service; the visitor learns nothing about other records.
          return { sessionToken: token, body: { saved: false, message: "Thank you. Our team will confirm your details with you." } };
        }
        throw error;
      }
      const lead = await core.leads.getActiveLead(customer.id);
      if (lead && (parsed.data.phone || parsed.data.email)) {
        try {
          await core.leads.recordLeadSignal(lead.id, { signal: "provided_contact", evidence: "contact form in website chat" }, ctx);
        } catch (error) {
          if (!(error instanceof DuplicateLeadSignalError)) throw error;
        }
      }
      return { sessionToken: token, body: { saved: true, message: "Thank you, we've saved your details so our team can reach you." } };
    });
  }

  // --- helpers --------------------------------------------------------------------

  function assertEnabled() {
    if (config.mode === "off") throw new WebsiteChatError(503, "assistant_unavailable", "Website chat is not available.");
  }

  function enforceRateLimits(visitor: ChatVisitor, token: string) {
    const sessionKey = visitor.account ? `acct:${visitor.account.userId}` : sessionIdentityValue(token);
    const l = config.limits;
    const decision = limiter.check([
      { rule: { name: "session_minute", limit: l.sessionPerMinute, windowMs: 60_000 }, key: sessionKey },
      { rule: { name: "session_day", limit: l.sessionPerDay, windowMs: 86_400_000 }, key: sessionKey },
      ...(visitor.ip ? [{ rule: { name: "ip_minute", limit: l.ipPerMinute, windowMs: 60_000 }, key: visitor.ip }] : []),
      { rule: { name: "global_day", limit: l.globalPerDay, windowMs: 86_400_000 }, key: "all" },
    ]);
    if (!decision.allowed) {
      throw new WebsiteChatError(
        429,
        "rate_limited",
        decision.rule === "global_day"
          ? "Our assistant is very busy right now. Please try again later."
          : "You're sending messages quickly. Please wait a moment and try again.",
        decision.retryAfterSeconds,
      );
    }
  }

  function debugInfo(r: SalesAgentResult): ChatDebugInfo {
    return {
      status: r.status,
      intent: r.intent,
      language: r.language,
      leadScore: r.leadScore,
      leadClassification: r.leadClassification,
      toolsUsed: r.toolsUsed,
      modelCalls: r.modelCalls,
      handoffReason: r.humanHandoff.reason,
      requestId: r.requestId,
    };
  }

  /** Maps any failure to a visitor-safe error, logging internals without message content. */
  async function guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof WebsiteChatError) throw error;
      if (error instanceof ValidationError) {
        throw new WebsiteChatError(400, "invalid_input", "Please check your details and try again.");
      }
      if (error instanceof AppError && error.isBusinessError) {
        logger.warn("website chat business error", { code: error.code });
        throw new WebsiteChatError(409, "conflict", "We couldn't complete that just now. Please try again.");
      }
      logger.error("website chat failure", { error: error instanceof Error ? error.name : "unknown" });
      throw new WebsiteChatError(500, "internal_error", "Something went wrong on our side. Please try again in a moment.");
    }
  }

  return { getState, sendMessage, resetConversation, submitContact, available };
}

export type WebsiteChat = ReturnType<typeof createWebsiteChat>;
