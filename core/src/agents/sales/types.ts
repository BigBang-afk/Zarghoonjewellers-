import { z } from "zod";
import { uuidSchema } from "../../lib/validation.js";
import { HANDOFF_REASONS, HANDOFF_URGENCIES, LANGUAGES } from "../../schemas/crm.js";

/** Sales Agent input/output contracts. Both are validated with Zod at runtime. */

export const SALES_CHANNELS = ["website", "internal_test"] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

export const SALES_INTENTS = [
  "product_search",
  "price_question",
  "availability_question",
  "product_details",
  "budget_search",
  "visit_question",
  "location_question",
  "custom_order",
  "discount_request",
  "payment_question",
  "complaint",
  "human_request",
  "general_question",
  "unknown",
] as const;
export type SalesIntent = (typeof SALES_INTENTS)[number];

export const salesAgentInputSchema = z
  .object({
    customerId: uuidSchema,
    /** Omit to start a new conversation for this customer. */
    conversationId: uuidSchema.optional(),
    message: z.string().trim().min(1, "Message is required").max(4000, "Message is too long"),
    channel: z.enum(SALES_CHANNELS).default("website"),
    /** Correlates every write made during this turn. Generated if omitted. */
    requestId: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
export type SalesAgentInput = z.input<typeof salesAgentInputSchema>;

export const SALES_TURN_STATUSES = [
  /** The AI replied and the reply was stored. */
  "replied",
  /** The AI replied and the conversation was then handed to staff. */
  "replied_and_handed_off",
  /** A human already controls this conversation; no AI reply was generated. */
  "human_takeover_active",
  /** The model could not produce a safe answer; a fixed safe reply was sent and staff were alerted. */
  "failed_safe",
] as const;
export type SalesTurnStatus = (typeof SALES_TURN_STATUSES)[number];

export const actionRecordSchema = z.object({
  type: z.string(),
  detail: z.record(z.string(), z.unknown()).default({}),
});
export type ActionRecord = z.infer<typeof actionRecordSchema>;

export const salesAgentResultSchema = z
  .object({
    status: z.enum(SALES_TURN_STATUSES),
    /** The text sent to the customer; null when no AI reply was sent. */
    reply: z.string().min(1).nullable(),
    customerId: uuidSchema,
    conversationId: uuidSchema,
    inboundMessageId: uuidSchema,
    outboundMessageId: uuidSchema.nullable(),
    intent: z.enum(SALES_INTENTS),
    language: z.enum(LANGUAGES),
    toolsUsed: z.array(z.string()),
    productsReferenced: z.array(z.object({ productId: uuidSchema, sku: z.string(), name: z.string() })),
    /** Read back from the deterministic scoring engine after the turn — never from the model. */
    leadId: uuidSchema.nullable(),
    leadScore: z.number().int().min(0).max(100).nullable(),
    leadClassification: z.enum(["cold", "warm", "hot", "very_hot"]).nullable(),
    followupRecommended: z.boolean(),
    humanHandoff: z.object({
      required: z.boolean(),
      reason: z.enum(HANDOFF_REASONS).nullable(),
      urgency: z.enum(HANDOFF_URGENCIES).nullable(),
      handoffId: uuidSchema.nullable(),
    }),
    humanTakeoverActive: z.boolean(),
    actionsRecorded: z.array(actionRecordSchema),
    modelCalls: z.number().int().min(0),
    requestId: z.string(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if ((r.status === "replied" || r.status === "replied_and_handed_off" || r.status === "failed_safe") && !r.reply) {
      ctx.addIssue({ code: "custom", message: "A reply is required for this status", path: ["reply"] });
    }
    if (r.status === "human_takeover_active" && (r.reply !== null || r.outboundMessageId !== null)) {
      ctx.addIssue({ code: "custom", message: "No AI reply may exist during human takeover", path: ["reply"] });
    }
    if (r.humanHandoff.required !== (r.humanHandoff.reason !== null)) {
      ctx.addIssue({ code: "custom", message: "Handoff reason must be set iff handoff is required", path: ["humanHandoff"] });
    }
  });
export type SalesAgentResult = z.infer<typeof salesAgentResultSchema>;
