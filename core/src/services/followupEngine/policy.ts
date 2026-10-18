import type { FollowupRejectionReason } from "../../lib/errors.js";
import type { Followup, FollowupPurpose } from "../../schemas/crm.js";
import type { FollowupContext } from "./context.js";
import { PURPOSE_META } from "./purposes.js";

/**
 * Deterministic follow-up eligibility. The language model never decides
 * whether a customer may be contacted — only this code does.
 *
 * blockers — the follow-up must not exist / proceed (opt-out, no consent,
 *            closed workflow, missing purchase, identity in doubt, frequency).
 * holds    — the follow-up may stay scheduled, but nothing may be drafted
 *            automatically right now (human takeover, the customer replied).
 */

export const MAX_OUTREACH_PER_WEEK = 3;

export interface PolicyIssue {
  code: FollowupRejectionReason;
  message: string;
}

export interface EligibilityResult {
  purpose: FollowupPurpose;
  kind: "outreach" | "internal";
  allowed: boolean;
  /** May the engine draft a customer message automatically now? */
  canDraftAutomatically: boolean;
  blockers: PolicyIssue[];
  holds: PolicyIssue[];
}

export function evaluateEligibility(
  ctx: FollowupContext,
  purpose: FollowupPurpose,
  options: { followup?: Followup; scheduling?: boolean } = {},
): EligibilityResult {
  const meta = PURPOSE_META[purpose];
  const blockers: PolicyIssue[] = [];
  const holds: PolicyIssue[] = [];
  const c = ctx.customer;

  if (c.doNotContact || ctx.lead?.status === "do_not_contact") {
    blockers.push({ code: "do_not_contact", message: "Customer asked not to be contacted" });
  }
  if (c.contactConsent === "denied") {
    blockers.push({ code: "consent_denied", message: "Customer declined to receive messages" });
  }
  if (meta.outreach && c.contactConsent === "unknown") {
    blockers.push({ code: "consent_missing", message: "No messaging consent recorded for this customer" });
  }
  if (meta.outreach && c.identityReviewRequired) {
    blockers.push({ code: "identity_review", message: "Customer identity needs review before any outreach" });
  }
  if (meta.sales && ctx.lead && (ctx.lead.status === "won" || ctx.lead.status === "lost")) {
    blockers.push({ code: "lead_closed", message: `Lead is ${ctx.lead.status}; sales follow-ups stop` });
  }
  if (meta.sales && ctx.orders.lastRealizedAt && options.followup && ctx.orders.lastRealizedAt > options.followup.createdAt) {
    blockers.push({ code: "lead_closed", message: "Customer made a purchase after this follow-up was scheduled" });
  }
  if (meta.requiresPurchase === "realized" && ctx.orders.realized === 0) {
    blockers.push({ code: "no_purchase", message: "No confirmed purchase on record" });
  }
  if (meta.requiresPurchase === "delivered" && ctx.orders.delivered === 0) {
    blockers.push({ code: "no_purchase", message: "No delivered order on record" });
  }
  if (meta.outreach && options.scheduling && ctx.recentOutreachCount >= MAX_OUTREACH_PER_WEEK) {
    blockers.push({ code: "frequency_limit", message: `Already ${ctx.recentOutreachCount} follow-ups in the last 7 days` });
  }

  if (meta.outreach && ctx.humanTakeover) {
    holds.push({ code: "human_takeover", message: "A staff member has taken over; no automatic drafting" });
  }
  const f = options.followup;
  const since = f ? (f.replyAcknowledgedAt && f.replyAcknowledgedAt > f.createdAt ? f.replyAcknowledgedAt : f.createdAt) : undefined;
  if (meta.outreach && since && ctx.latestCustomerMessage && ctx.latestCustomerMessage.at > since) {
    holds.push({ code: "customer_replied", message: "Customer replied after this follow-up was scheduled" });
  }

  const allowed = blockers.length === 0;
  return { purpose, kind: meta.outreach ? "outreach" : "internal", allowed, canDraftAutomatically: allowed && meta.outreach && holds.length === 0, blockers, holds };
}
