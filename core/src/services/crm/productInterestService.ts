import { z } from "zod";
import { queryOne, type Db } from "../../database/db.js";
import { InvalidStateError, ProductNotFoundError } from "../../lib/errors.js";
import { optionalText, parseInput, uuidSchema } from "../../lib/validation.js";
import { skuSchema } from "../../schemas/product.js";
import {
  INTEREST_TYPES,
  isTerminalLeadStatus,
  mapProductInterestRow,
  type InterestType,
  type ProductInterest,
  type ProductInterestRow,
} from "../../schemas/crm.js";
import type { ActionContext } from "../../types/context.js";
import { recordAction } from "../auditService.js";
import type { LeadScoreResult, LeadSignal } from "./leadScoring.js";
import {
  assertLeadBelongsTo,
  assertMessageInConversation,
  findActiveLead,
  loadConversation,
  loadCustomer,
  loadLead,
  recordLeadSignalTx,
} from "./shared.js";

/**
 * Product interest tracking — what customers actually engaged with, recorded
 * as facts against real product rows (never model-invented IDs).
 *
 * Interests feed lead scoring deterministically:
 *   asked_price          → asked_price + specific_product_interest
 *   asked_availability   → asked_availability + specific_product_interest
 *   shortlisted / requested_similar / requested_customization
 *                        → specific_product_interest
 *   viewed               → (no signal: browsing alone is not intent)
 *   a second non-"viewed" interest in the same product → repeated_product_interest
 * Each signal still counts at most once per lead.
 */

const SIGNALS_FOR_INTEREST: Record<InterestType, LeadSignal[]> = {
  viewed: [],
  asked_price: ["asked_price", "specific_product_interest"],
  asked_availability: ["asked_availability", "specific_product_interest"],
  shortlisted: ["specific_product_interest"],
  requested_similar: ["specific_product_interest"],
  requested_customization: ["specific_product_interest"],
};

export const recordProductInterestSchema = z
  .object({
    customerId: uuidSchema,
    productId: uuidSchema.optional(),
    sku: skuSchema.optional(),
    interestType: z.enum(INTEREST_TYPES),
    /** Defaults to the customer's active lead, if there is one. */
    leadId: uuidSchema.optional(),
    conversationId: uuidSchema.optional(),
    messageId: uuidSchema.optional(),
    notes: optionalText(1000),
  })
  .strict()
  .refine((d) => !!d.productId !== !!d.sku, { message: "Provide exactly one of productId or sku" });
export type RecordProductInterestInput = z.input<typeof recordProductInterestSchema>;

export interface RecordProductInterestResult {
  interest: ProductInterest;
  /** True when this exact interest from this message was already recorded. */
  duplicate: boolean;
  signalsRecorded: LeadSignal[];
  leadScore: LeadScoreResult | null;
}

const SELECT_INTEREST = `
  select pi.*, p.sku as product_sku, p.name as product_name
    from product_interests pi join products p on p.id = pi.product_id`;

export function createProductInterestService(db: Db) {
  async function recordProductInterest(
    input: RecordProductInterestInput,
    ctx: ActionContext,
  ): Promise<RecordProductInterestResult> {
    const data = parseInput(recordProductInterestSchema, input, "product interest");
    return db.transaction(async (tx) => {
      const customer = await loadCustomer(tx, data.customerId);
      const product = await queryOne<{ id: string }>(
        tx,
        data.productId ? `select id from products where id = $1` : `select id from products where sku = $1`,
        [data.productId ?? data.sku],
      );
      if (!product) throw new ProductNotFoundError(data.productId ? { id: data.productId } : { sku: data.sku });

      if (data.conversationId) {
        const conversation = await loadConversation(tx, data.conversationId);
        if (conversation.customerId && conversation.customerId !== customer.id) {
          throw new InvalidStateError("Conversation belongs to a different customer", {
            conversationId: conversation.id,
          });
        }
      }
      if (data.messageId) await assertMessageInConversation(tx, data.messageId, data.conversationId ?? null);

      let lead = data.leadId ? await loadLead(tx, data.leadId) : await findActiveLead(tx, customer.id);
      if (lead) assertLeadBelongsTo(lead, customer.id);

      const inserted = await tx.query<{ id: string }>(
        `insert into product_interests (customer_id, lead_id, product_id, interest_type, conversation_id, message_id, notes)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (customer_id, product_id, interest_type, message_id) where message_id is not null do nothing
         returning id`,
        [customer.id, lead?.id ?? null, product.id, data.interestType, data.conversationId ?? null, data.messageId ?? null, data.notes],
      );
      if (inserted.length === 0) {
        const existing = await queryOne<ProductInterestRow>(
          tx,
          `${SELECT_INTEREST} where pi.customer_id = $1 and pi.product_id = $2 and pi.interest_type = $3 and pi.message_id = $4`,
          [customer.id, product.id, data.interestType, data.messageId],
        );
        return { interest: mapProductInterestRow(existing!), duplicate: true, signalsRecorded: [], leadScore: null };
      }
      const interestId = inserted[0]!.id;

      const signalsRecorded: LeadSignal[] = [];
      let leadScore: LeadScoreResult | null = null;
      if (lead && !isTerminalLeadStatus(lead.status)) {
        const signals = [...SIGNALS_FOR_INTEREST[data.interestType]];
        if (data.interestType !== "viewed") {
          const prior = await queryOne<{ n: number }>(
            tx,
            `select count(*)::int as n from product_interests
              where customer_id = $1 and product_id = $2 and interest_type <> 'viewed' and id <> $3`,
            [customer.id, product.id, interestId],
          );
          if (prior!.n > 0) signals.push("repeated_product_interest");
        }
        for (const signal of signals) {
          const result = await recordLeadSignalTx(tx, lead.id, signal, ctx, {
            sourceMessageId: data.messageId ?? null,
            evidence: `product interest ${data.interestType} on ${product.id}`,
            ignoreDuplicate: true,
          });
          if (result.recorded) signalsRecorded.push(signal);
          leadScore = result.score;
          lead = result.lead;
        }
      }

      await recordAction(tx, ctx, {
        actionType: "product_interest_recorded",
        customerId: customer.id,
        leadId: lead?.id ?? null,
        conversationId: data.conversationId ?? null,
        input: data,
        output: { interestId, signalsRecorded },
      });
      const row = await queryOne<ProductInterestRow>(tx, `${SELECT_INTEREST} where pi.id = $1`, [interestId]);
      return { interest: mapProductInterestRow(row!), duplicate: false, signalsRecorded, leadScore };
    });
  }

  async function getCustomerProductInterests(customerId: string, limit = 50): Promise<ProductInterest[]> {
    const id = parseInput(uuidSchema, customerId, "customer id");
    const rows = await db.query<ProductInterestRow>(
      `${SELECT_INTEREST} where pi.customer_id = $1 order by pi.created_at desc, pi.id limit $2`,
      [id, Math.min(limit, 500)],
    );
    return rows.map(mapProductInterestRow);
  }

  async function getLeadProductInterests(leadId: string, limit = 50): Promise<ProductInterest[]> {
    const id = parseInput(uuidSchema, leadId, "lead id");
    const rows = await db.query<ProductInterestRow>(
      `${SELECT_INTEREST} where pi.lead_id = $1 order by pi.created_at desc, pi.id limit $2`,
      [id, Math.min(limit, 500)],
    );
    return rows.map(mapProductInterestRow);
  }

  return { recordProductInterest, getCustomerProductInterests, getLeadProductInterests };
}

export type ProductInterestService = ReturnType<typeof createProductInterestService>;
