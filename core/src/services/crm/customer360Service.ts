import { queryOne, type Db } from "../../database/db.js";
import { sumMoney } from "../../lib/money.js";
import { parseInput, uuidSchema } from "../../lib/validation.js";
import {
  mapConversationRow,
  mapFollowupRow,
  mapHandoffRow,
  mapMessageRow,
  mapProductInterestRow,
  type Conversation,
  type ConversationRow,
  type Customer,
  type ExternalIdentity,
  type Followup,
  type FollowupRow,
  type Handoff,
  type HandoffRow,
  type Lead,
  type Message,
  type MessageRow,
  type ProductInterest,
  type ProductInterestRow,
} from "../../schemas/crm.js";
import { findStaff, type StaffSummary } from "../staffRules.js";
import { computeLeadScore, type LeadClassification, type LeadScoreBreakdownItem } from "./leadScoring.js";
import { findActiveLead, getLeadSignals, loadCustomer } from "./shared.js";

/**
 * Customer 360 — one read of everything known about a customer. This is the
 * context the future Sales Agent will receive. It contains only stored facts:
 * no inferred preferences, no estimated values. Unknown → null or [].
 */

/** Order statuses that count towards lifetime value (a sale actually happened). */
const REALIZED_ORDER_STATUSES = ["confirmed", "in_production", "ready", "delivered"];
const OPEN_ORDER_STATUSES = ["draft", "pending_confirmation", "confirmed", "in_production", "ready"];

export interface OrdersSummary {
  totalOrders: number;
  openOrders: number;
  deliveredOrders: number;
  cancelledOrRefundedOrders: number;
  /** Sum of realized order totals per currency, as exact decimal strings. */
  lifetimeValueByCurrency: Record<string, string>;
  lastOrderAt: Date | null;
}

export interface Customer360 {
  customer: Customer;
  externalIdentities: ExternalIdentity[];
  activeLead: Lead | null;
  /** Recomputed from the lead's signal audit trail; null when there is no active lead. */
  leadScore: number | null;
  leadClassification: LeadClassification | null;
  leadScoreBreakdown: LeadScoreBreakdownItem[];
  productInterests: ProductInterest[];
  recentConversations: Conversation[];
  recentMessages: Message[];
  pendingFollowups: Followup[];
  ordersSummary: OrdersSummary;
  assignedStaff: StaffSummary | null;
  humanTakeoverStatus: {
    active: boolean;
    conversationIds: string[];
    openHandoffs: Handoff[];
  };
  doNotContact: boolean;
}

export interface Customer360Options {
  interestLimit?: number;
  conversationLimit?: number;
  messageLimit?: number;
}

export function createCustomer360Service(db: Db) {
  async function getCustomer360(customerId: string, options: Customer360Options = {}): Promise<Customer360> {
    const id = parseInput(uuidSchema, customerId, "customer id");
    const customer = await loadCustomer(db, id);
    const interestLimit = Math.min(options.interestLimit ?? 20, 100);
    const conversationLimit = Math.min(options.conversationLimit ?? 5, 50);
    const messageLimit = Math.min(options.messageLimit ?? 20, 100);

    const [identities, activeLead, interests, conversations, followups, orderRows, openHandoffs] = await Promise.all([
      db.query<{ identity_type: ExternalIdentity["type"]; identity_value: string; is_verified: boolean }>(
        `select identity_type, identity_value, is_verified from customer_identities where customer_id = $1 order by created_at`,
        [id],
      ),
      findActiveLead(db, id),
      db.query<ProductInterestRow>(
        `select pi.*, p.sku as product_sku, p.name as product_name
           from product_interests pi join products p on p.id = pi.product_id
          where pi.customer_id = $1 order by pi.created_at desc, pi.id limit $2`,
        [id, interestLimit],
      ),
      db.query<ConversationRow>(
        `select * from conversations where customer_id = $1
          order by coalesce(last_message_at, created_at) desc limit $2`,
        [id, conversationLimit],
      ),
      db.query<FollowupRow>(
        `select * from followups where customer_id = $1 and status = 'pending' order by scheduled_for asc`,
        [id],
      ),
      db.query<{ status: string; currency: string; total: string; created_at: Date }>(
        `select status, currency, total, created_at from orders where customer_id = $1`,
        [id],
      ),
      db.query<HandoffRow>(
        `select * from handoffs where customer_id = $1 and status = 'open' order by created_at desc`,
        [id],
      ),
    ]);

    const recentConversations = conversations.map(mapConversationRow);
    const latest = recentConversations[0];
    const recentMessages = latest
      ? (
          await db.query<MessageRow>(
            `select * from (select * from messages where conversation_id = $1 order by created_at desc, id desc limit $2) m
              order by created_at asc, id asc`,
            [latest.id, messageLimit],
          )
        ).map(mapMessageRow)
      : [];

    const score = activeLead ? computeLeadScore(await getLeadSignals(db, activeLead.id)) : null;

    // Assigned staff: the active lead's owner, else the latest open conversation's.
    const staffId =
      activeLead?.assignedStaffId ?? recentConversations.find((c) => c.status === "open")?.assignedStaffId ?? null;
    const assignedStaff = staffId ? await findStaff(db, staffId) : null;

    const takeover = await db.query<{ id: string }>(
      `select id from conversations where customer_id = $1 and human_takeover and status = 'open'`,
      [id],
    );

    const realizedByCurrency = new Map<string, string[]>();
    for (const o of orderRows.filter((o) => REALIZED_ORDER_STATUSES.includes(o.status))) {
      realizedByCurrency.set(o.currency, [...(realizedByCurrency.get(o.currency) ?? []), o.total]);
    }
    const lastOrder = await queryOne<{ created_at: Date }>(
      db,
      `select created_at from orders where customer_id = $1 order by created_at desc limit 1`,
      [id],
    );

    return {
      customer,
      externalIdentities: identities.map((r) => ({ type: r.identity_type, value: r.identity_value, isVerified: r.is_verified })),
      activeLead,
      leadScore: score?.score ?? null,
      leadClassification: score?.classification ?? null,
      leadScoreBreakdown: score?.breakdown ?? [],
      productInterests: interests.map(mapProductInterestRow),
      recentConversations,
      recentMessages,
      pendingFollowups: followups.map(mapFollowupRow),
      ordersSummary: {
        totalOrders: orderRows.length,
        openOrders: orderRows.filter((o) => OPEN_ORDER_STATUSES.includes(o.status)).length,
        deliveredOrders: orderRows.filter((o) => o.status === "delivered").length,
        cancelledOrRefundedOrders: orderRows.filter((o) => o.status === "cancelled" || o.status === "refunded").length,
        lifetimeValueByCurrency: Object.fromEntries(
          [...realizedByCurrency].map(([currency, totals]) => [currency, sumMoney(totals)]),
        ),
        lastOrderAt: lastOrder?.created_at ?? null,
      },
      assignedStaff,
      humanTakeoverStatus: {
        active: takeover.length > 0,
        conversationIds: takeover.map((t) => t.id),
        openHandoffs: openHandoffs.map(mapHandoffRow),
      },
      doNotContact: customer.doNotContact,
    };
  }

  return { getCustomer360 };
}

export type Customer360Service = ReturnType<typeof createCustomer360Service>;
