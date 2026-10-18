import type { Db } from "../../database/db.js";
import type { FollowupPriority, FollowupPurpose } from "../../schemas/crm.js";
import { customerScopeSql } from "../dashboard/access.js";
import { loadFollowupContext, type FollowupContext, type InterestFact } from "./context.js";
import { evaluateEligibility, type PolicyIssue } from "./policy.js";
import { PURPOSE_META } from "./purposes.js";

/**
 * Follow-up recommendations, computed deterministically from stored records.
 * A recommendation is only a suggestion for staff: nothing is scheduled until
 * an authorised staff member schedules it.
 */

export interface FollowupRecommendation {
  customerId: string;
  customerName: string | null;
  leadId: string | null;
  recommended: boolean;
  reason: string;
  priority: FollowupPriority;
  suggestedFollowupType: FollowupPurpose | null;
  suggestedDelayDays: number;
  productId: string | null;
  requiresStaffReview: true;
  alreadyScheduled: boolean;
  blockers: PolicyIssue[];
  holds: PolicyIssue[];
  leadScore: number | null;
}

const dateLabel = (d: Date) => d.toISOString().slice(0, 10);

function pickPurpose(ctx: FollowupContext): { purpose: FollowupPurpose; reason: string; product: InterestFact | null } | null {
  const signals = new Set(ctx.leadSignals);
  const product = ctx.interests[0] ?? null;
  const about = product ? ` ${product.name} (${product.sku})` : "";
  const leadOpen = ctx.lead && !["won", "lost", "do_not_contact"].includes(ctx.lead.status);

  const purchasedAt = ctx.orders.lastRealizedAt;
  const careAlreadyHandled = !!purchasedAt && ctx.followupHistory.some((f) => f.followupType === "after_sales" && f.status !== "cancelled" && f.createdAt >= purchasedAt);
  if (ctx.orders.realized > 0 && purchasedAt && !careAlreadyHandled && ctx.now.getTime() - purchasedAt.getTime() < 60 * 86_400_000) {
    return { purpose: "post_purchase_care", reason: `Customer purchased on ${dateLabel(purchasedAt)}`, product };
  }
  if (!leadOpen) return null;
  if (ctx.openHandoffReasons.includes("custom_order")) {
    return { purpose: "custom_order", reason: "Customer has an open custom-order request", product };
  }
  if (signals.has("asked_about_visit")) {
    return { purpose: "visit_request", reason: `Customer asked about visiting the store${product ? ` to see${about}` : ""}`, product };
  }
  if (product && (product.collection === "bridal" || /bridal/i.test(product.name))) {
    return { purpose: "bridal", reason: `Customer was interested in the bridal piece${about} on ${dateLabel(product.at)}`, product };
  }
  if (signals.has("asked_availability") && product) {
    return { purpose: "availability_inquiry", reason: `Customer asked about the availability of${about}`, product };
  }
  if (signals.has("asked_price") && product) {
    return { purpose: "price_inquiry", reason: `Customer asked about the price of${about}`, product };
  }
  if (product) {
    return { purpose: "product_interest", reason: `Customer showed interest in${about} on ${dateLabel(product.at)}`, product };
  }
  if (ctx.latestCustomerMessage) {
    return { purpose: "new_inquiry", reason: `Customer started an inquiry on ${dateLabel(ctx.latestCustomerMessage.at)}`, product: null };
  }
  return null;
}

function priorityFor(ctx: FollowupContext, purpose: FollowupPurpose): FollowupPriority {
  const order: FollowupPriority[] = ["low", "normal", "high", "urgent"];
  let i = { cold: 0, warm: 1, hot: 2, very_hot: 2 }[ctx.leadScore?.classification ?? "cold"];
  if (purpose === "bridal" || purpose === "custom_order" || purpose === "visit_request") i = Math.min(i + 1, 3);
  if (purpose === "post_purchase_care") i = 1;
  return order[i]!;
}

export function recommendFollowup(ctx: FollowupContext): FollowupRecommendation {
  const base = {
    customerId: ctx.customer.id,
    customerName: ctx.customer.fullName,
    leadId: ctx.lead?.id ?? null,
    requiresStaffReview: true as const,
    leadScore: ctx.leadScore?.score ?? null,
  };
  const pick = pickPurpose(ctx);
  if (!pick) {
    return { ...base, recommended: false, reason: "No open sales conversation or recent purchase to follow up on", priority: "low", suggestedFollowupType: null, suggestedDelayDays: 0, productId: null, alreadyScheduled: false, blockers: [], holds: [] };
  }
  const eligibility = evaluateEligibility(ctx, pick.purpose, { scheduling: true });
  const type = PURPOSE_META[pick.purpose].followupType;
  const alreadyScheduled = ctx.pendingFollowups.some((f) => f.followupType === type && (f.leadId ?? null) === (ctx.lead?.id ?? null));
  const recommended = eligibility.allowed && !alreadyScheduled;
  return {
    ...base,
    recommended,
    reason: alreadyScheduled ? `${pick.reason} — a follow-up is already scheduled` : pick.reason,
    priority: priorityFor(ctx, pick.purpose),
    suggestedFollowupType: pick.purpose,
    suggestedDelayDays: pick.purpose === "post_purchase_care" ? 7 : 1,
    productId: pick.product?.productId ?? null,
    alreadyScheduled,
    blockers: eligibility.blockers,
    holds: eligibility.holds,
  };
}

/**
 * Candidates: open leads that are warm or better / waiting on staff, and
 * customers with a recent confirmed purchase. Scoped to the viewer.
 */
export async function listRecommendations(db: Db, scopeStaffId: string | null, now: Date, limit = 30): Promise<FollowupRecommendation[]> {
  const rows = await db.query<{ customer_id: string; lead_id: string | null }>(
    `select c.id as customer_id, l.id as lead_id
       from customers c
       left join lateral (select * from leads where customer_id = c.id and status not in ('won', 'lost', 'do_not_contact')
                           order by created_at desc limit 1) l on true
      where ${customerScopeSql("c.id", "$1")}
        and ((l.id is not null and (l.score >= 21 or l.status in ('human_followup', 'waiting_customer')))
             or exists (select 1 from orders o where o.customer_id = c.id and o.status in ('confirmed', 'in_production', 'ready', 'delivered')
                          and coalesce(o.confirmed_at, o.created_at) > $2))
      order by l.score desc nulls last, c.id
      limit $3`,
    [scopeStaffId, new Date(now.getTime() - 60 * 86_400_000), Math.min(limit, 100)],
  );
  const out: FollowupRecommendation[] = [];
  for (const r of rows) out.push(recommendFollowup(await loadFollowupContext(db, r.customer_id, { now, leadId: r.lead_id })));
  const rank = { urgent: 0, high: 1, normal: 2, low: 3 };
  return out.sort((a, b) => Number(b.recommended) - Number(a.recommended) || rank[a.priority] - rank[b.priority]);
}
