import { z } from "zod";
import { moneySchema } from "../../lib/money.js";
import { optionalText, uuidSchema } from "../../lib/validation.js";
import { FOLLOWUP_TYPES, HANDOFF_REASONS, HANDOFF_URGENCIES, INTEREST_TYPES, LANGUAGES } from "../../schemas/crm.js";
import { skuSchema, STOCK_STATUSES } from "../../schemas/product.js";
import { LEAD_SIGNALS, type LeadSignal } from "../../services/crm/leadScoring.js";
import type { LlmTool } from "../llm/llmClient.js";
import { SALES_INTENTS } from "./types.js";

/**
 * The complete, closed set of tools the Sales Agent model may call.
 *
 * Each tool's Zod schema is the single source of truth: it generates the JSON
 * schema sent to the model AND validates every call at runtime. Tool inputs
 * never contain customer or conversation IDs — the executor injects those
 * from the turn context, so the model cannot read or write another
 * customer's data. There is no SQL or raw database tool.
 */

const productRef = z
  .object({
    productId: uuidSchema.optional().describe("Product id exactly as returned by a product tool"),
    sku: skuSchema.optional().describe("Product SKU exactly as returned by a product tool or given by the customer"),
  })
  .strict()
  .refine((v) => !!v.productId !== !!v.sku, { message: "Provide exactly one of productId or sku" });

export const toolInputSchemas = {
  get_customer_360: z.object({}).strict(),

  get_recent_messages: z
    .object({ limit: z.number().int().min(1).max(30).default(10) })
    .strict(),

  search_products: z
    .object({
      query: z.string().trim().max(100).optional().describe("Words to match in name, SKU, description, category or collection"),
      category: z.string().trim().max(50).optional().describe("Exact category, e.g. necklace, bangle, ring"),
      collection: z.string().trim().max(50).optional().describe("Exact collection, e.g. bridal"),
      karat: z.number().int().min(1).max(24).optional(),
      minPrice: moneySchema("minPrice").optional().describe("PKR. Only products with an approved price can match"),
      maxPrice: moneySchema("maxPrice").optional().describe("PKR. Only products with an approved price can match"),
      stockStatuses: z.array(z.enum(STOCK_STATUSES)).max(6).optional(),
      limit: z.number().int().min(1).max(10).default(5),
    })
    .strict(),

  get_product: productRef,

  check_inventory: productRef,

  record_product_interest: z
    .object({
      productId: uuidSchema.describe("Must be a product id returned by a product tool in this conversation turn"),
      interestType: z.enum(INTEREST_TYPES),
      notes: optionalText(300),
    })
    .strict(),

  record_lead_signal: z
    .object({
      signal: z.enum(LEAD_SIGNALS as [LeadSignal, ...LeadSignal[]]),
      evidence: z.string().trim().min(1).max(300).describe("Short quote or paraphrase of what the customer said"),
    })
    .strict(),

  schedule_followup: z
    .object({
      // Tool input is JSON, so only an ISO string (with explicit offset) is accepted.
      scheduledFor: z.iso
        .datetime({ offset: true })
        .describe("ISO-8601 timestamp with timezone offset, in the future, e.g. 2026-10-20T11:00:00+05:00"),
      followupType: z.enum(FOLLOWUP_TYPES).default("sales"),
      note: optionalText(500),
      messageDraft: optionalText(1000).describe("Draft for staff to review. It is never sent automatically."),
    })
    .strict(),

  request_human_handoff: z
    .object({
      reason: z.enum(HANDOFF_REASONS),
      urgency: z.enum(HANDOFF_URGENCIES).default("normal"),
      note: z.string().trim().min(1).max(500).describe("Context for staff: what the customer wants"),
    })
    .strict(),

  get_business_info: z.object({}).strict(),

  set_preferred_language: z
    .object({ language: z.enum(LANGUAGES) })
    .strict(),

  submit_reply: z
    .object({
      reply: z.string().trim().min(1).max(2000).describe("The exact message to send to the customer"),
      intent: z.enum(SALES_INTENTS),
      language: z.enum(LANGUAGES).describe("Language of the reply"),
      productsReferenced: z
        .array(uuidSchema)
        .max(10)
        .default([])
        .describe("Ids of every product mentioned in the reply, as returned by product tools"),
      followupRecommended: z.boolean().default(false),
      handoff: z
        .object({
          required: z.boolean(),
          reason: z.enum(HANDOFF_REASONS).optional(),
          urgency: z.enum(HANDOFF_URGENCIES).optional(),
        })
        .strict()
        .default({ required: false }),
      confidence: z.enum(["high", "medium", "low"]).describe("Your confidence that every fact in the reply came from tools"),
    })
    .strict(),
} as const;

export type SalesToolName = keyof typeof toolInputSchemas;
export const SALES_TOOL_NAMES = Object.keys(toolInputSchemas) as SalesToolName[];
export type SalesToolInput<N extends SalesToolName> = z.output<(typeof toolInputSchemas)[N]>;
export type SubmitReplyInput = SalesToolInput<"submit_reply">;

const DESCRIPTIONS: Record<SalesToolName, string> = {
  get_customer_360:
    "Load what Zarghoon Jewellers knows about the current customer: profile, active lead status, product interests, pending follow-ups, order counts and human-takeover state. Unknown fields are null.",
  get_recent_messages: "Load the most recent messages of the current conversation, oldest first.",
  search_products:
    "Search the real Zarghoon catalogue. Returns only products that exist in the database, with their stored price (null = needs confirmation) and stored stock status. An empty list means nothing matched — never suggest products that were not returned.",
  get_product: "Get one product's stored details by id or SKU. Fails if the product does not exist.",
  check_inventory:
    "Get the stored stock status of a product. Use this before saying anything about availability. Only canPromiseInStock=true allows saying the piece is in stock.",
  record_product_interest:
    "Record that the customer showed interest in a specific product returned by a product tool (asked its price, asked availability, shortlisted, wants something similar, wants customization).",
  record_lead_signal:
    "Record evidence of buying intent the customer just showed. The scoring engine decides what it is worth; you never assign points. Recording the same signal twice is harmless.",
  schedule_followup:
    "Schedule a follow-up for staff to contact the customer later (records only; nothing is sent automatically). Use only when the customer agreed to be contacted later or asked to be reminded.",
  request_human_handoff:
    "Hand this conversation to a human team member. Required for discount requests, complaints, payment problems, custom/bespoke orders, requests for a person, and whenever you cannot answer an important factual question from tool data. The handoff is created after your reply is sent.",
  get_business_info:
    "Get owner-approved store facts: address, city, opening hours, phone, WhatsApp, order process, payment methods. null means not configured — say the team will confirm.",
  set_preferred_language:
    "Save the customer's preferred language ONLY when the customer explicitly asked to be spoken to in that language in their latest message.",
  submit_reply:
    "Finish the turn with the reply to send to the customer and a structured summary. Call it alone, after you have all the tool results you need. Every price, weight, karat, SKU, stock or store fact in the reply must come from tool results.",
};

function toInputSchema(schema: z.ZodType): LlmTool["input_schema"] {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  return json as LlmTool["input_schema"];
}

/** Tool definitions in the order sent to the model (fixed order keeps the prompt cache stable). */
export const SALES_TOOLS: LlmTool[] = SALES_TOOL_NAMES.map((name) => ({
  name,
  description: DESCRIPTIONS[name],
  input_schema: toInputSchema(toolInputSchemas[name]),
}));
