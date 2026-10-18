import { queryOne, type Db } from "../../database/db.js";
import {
  mapCustomerRow,
  mapFollowupRow,
  mapLeadRow,
  type Customer,
  type CustomerRow,
  type Followup,
  type FollowupRow,
  type Language,
  type Lead,
  type LeadRow,
} from "../../schemas/crm.js";
import { CustomerNotFoundError } from "../../lib/errors.js";
import { computeLeadScore, type LeadClassification, type LeadSignal } from "../crm/leadScoring.js";
import { getLeadSignals } from "../crm/shared.js";

/**
 * Everything the follow-up engine may know about a customer, read from stored
 * records only. Recommendations, eligibility and drafts are all built from
 * this — never from model memory.
 */

export interface InterestFact {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
  collection: string | null;
  interestType: string;
  at: Date;
  isActive: boolean;
  approvedPrice: string | null;
  currency: string;
  stockStatus: string | null;
  stockQuantity: number | null;
}

export interface FollowupContext {
  now: Date;
  customer: Customer;
  /** The lead the follow-up is about (explicit, else the active lead, else the latest). */
  lead: Lead | null;
  leadSignals: LeadSignal[];
  leadScore: { score: number; classification: LeadClassification } | null;
  latestCustomerMessage: { id: string; content: string; at: Date; language: Language | null } | null;
  lastOutboundAt: Date | null;
  latestConversationId: string | null;
  interests: InterestFact[];
  orders: { realized: number; delivered: number; lastRealizedAt: Date | null };
  humanTakeover: boolean;
  openHandoffReasons: string[];
  pendingFollowups: Followup[];
  /** Outreach follow-ups created for this customer in the last 7 days (any status). */
  recentOutreachCount: number;
  /** The customer's latest follow-ups of any status (newest first, up to 20). */
  followupHistory: { purpose: string | null; followupType: string; status: string; createdAt: Date }[];
}

export async function loadFollowupContext(
  db: Db,
  customerId: string,
  options: { now: Date; leadId?: string | null },
): Promise<FollowupContext> {
  const row = await queryOne<CustomerRow>(db, `select * from customers where id = $1`, [customerId]);
  if (!row) throw new CustomerNotFoundError({ id: customerId });
  const customer = mapCustomerRow(row);

  const leadRow = options.leadId
    ? await queryOne<LeadRow>(db, `select * from leads where id = $1 and customer_id = $2`, [options.leadId, customerId])
    : await queryOne<LeadRow>(
        db,
        `select * from leads where customer_id = $1
          order by (status in ('won', 'lost', 'do_not_contact')), created_at desc limit 1`,
        [customerId],
      );
  const lead = leadRow ? mapLeadRow(leadRow) : null;

  const [signals, latestMsg, lastOut, conv, interests, orders, takeover, handoffs, pending, recent, history] = await Promise.all([
    lead ? getLeadSignals(db, lead.id) : Promise.resolve([] as LeadSignal[]),
    queryOne<{ id: string; content: string; created_at: Date; language: Language | null }>(
      db,
      `select m.id, m.content, m.created_at, m.language from messages m join conversations v on v.id = m.conversation_id
        where v.customer_id = $1 and m.sender_type = 'customer' order by m.created_at desc, m.id desc limit 1`,
      [customerId],
    ),
    queryOne<{ at: Date }>(
      db,
      `select max(m.created_at) as at from messages m join conversations v on v.id = m.conversation_id
        where v.customer_id = $1 and m.direction = 'outbound'`,
      [customerId],
    ),
    queryOne<{ id: string }>(
      db,
      `select id from conversations where customer_id = $1 order by coalesce(last_message_at, created_at) desc limit 1`,
      [customerId],
    ),
    db.query<Record<string, never>>(
      `select distinct on (p.id) p.id as product_id, p.sku, p.name, p.category, p.collection, pi.interest_type, pi.created_at,
              p.is_active, p.approved_price, p.currency, p.stock_status, p.stock_quantity
         from product_interests pi join products p on p.id = pi.product_id
        where pi.customer_id = $1 order by p.id, pi.created_at desc`,
      [customerId],
    ),
    queryOne<{ realized: number; delivered: number; last_realized: Date | null }>(
      db,
      `select count(*) filter (where status in ('confirmed', 'in_production', 'ready', 'delivered'))::int as realized,
              count(*) filter (where status = 'delivered')::int as delivered,
              max(coalesce(confirmed_at, created_at)) filter (where status in ('confirmed', 'in_production', 'ready', 'delivered')) as last_realized
         from orders where customer_id = $1`,
      [customerId],
    ),
    queryOne<{ n: number }>(db, `select count(*)::int as n from conversations where customer_id = $1 and human_takeover and status = 'open'`, [customerId]),
    db.query<{ reason: string }>(`select reason from handoffs where customer_id = $1 and status = 'open'`, [customerId]),
    db.query<FollowupRow>(`select * from followups where customer_id = $1 and status = 'pending' order by scheduled_for`, [customerId]),
    queryOne<{ n: number }>(
      db,
      `select count(*)::int as n from followups where customer_id = $1 and created_at > $2
          and coalesce(purpose, '') <> 'staff_callback'`,
      [customerId, new Date(options.now.getTime() - 7 * 86_400_000)],
    ),
    db.query<{ purpose: string | null; followup_type: string; status: string; created_at: Date }>(
      `select purpose, followup_type, status, created_at from followups where customer_id = $1 order by created_at desc limit 20`,
      [customerId],
    ),
  ]);

  const score = lead ? computeLeadScore(signals) : null;
  return {
    now: options.now,
    customer,
    lead,
    leadSignals: signals,
    leadScore: score ? { score: score.score, classification: score.classification } : null,
    latestCustomerMessage: latestMsg ? { id: latestMsg.id, content: latestMsg.content, at: latestMsg.created_at, language: latestMsg.language } : null,
    lastOutboundAt: lastOut?.at ?? null,
    latestConversationId: conv?.id ?? null,
    interests: (interests as Record<string, any>[])
      .map((r) => ({
        productId: r.product_id,
        sku: r.sku,
        name: r.name,
        category: r.category,
        collection: r.collection,
        interestType: r.interest_type,
        at: r.created_at,
        isActive: r.is_active,
        approvedPrice: r.approved_price,
        currency: r.currency,
        stockStatus: r.stock_status,
        stockQuantity: r.stock_quantity,
      }))
      .sort((a, b) => b.at.getTime() - a.at.getTime()),
    orders: { realized: orders!.realized, delivered: orders!.delivered, lastRealizedAt: orders!.last_realized },
    humanTakeover: takeover!.n > 0,
    openHandoffReasons: handoffs.map((h) => h.reason),
    pendingFollowups: pending.map(mapFollowupRow),
    recentOutreachCount: recent!.n,
    followupHistory: history.map((h) => ({ purpose: h.purpose, followupType: h.followup_type, status: h.status, createdAt: h.created_at })),
  };
}
