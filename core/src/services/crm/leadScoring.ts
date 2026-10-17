/**
 * Deterministic lead scoring.
 *
 * The score is a pure function of which signals have been recorded for a
 * lead. The language model never produces a score — it can only report that
 * a signal happened (via a validated tool call), and this code decides what
 * that is worth. Each signal counts at most once per lead.
 */

export const LEAD_SIGNAL_POINTS = {
  asked_price: 10,
  provided_budget: 15,
  specific_product_interest: 15,
  asked_availability: 15,
  provided_contact: 10,
  asked_shop_location: 10,
  asked_about_visit: 20,
  asked_about_payment_or_order: 20,
  repeated_product_interest: 10,
  requested_human_salesperson: 15,
} as const satisfies Record<string, number>;

export type LeadSignal = keyof typeof LEAD_SIGNAL_POINTS;
export const LEAD_SIGNALS = Object.keys(LEAD_SIGNAL_POINTS) as LeadSignal[];

export const MAX_LEAD_SCORE = 100;

export type LeadClassification = "cold" | "warm" | "hot" | "very_hot";

export interface LeadScoreBreakdownItem {
  signal: LeadSignal;
  points: number;
}

export interface LeadScoreResult {
  score: number;
  classification: LeadClassification;
  breakdown: LeadScoreBreakdownItem[];
  /** Sum before the 100-point cap, kept for transparency. */
  uncappedScore: number;
}

/** 0–20 cold · 21–50 warm · 51–75 hot · 76–100 very_hot */
export function classifyLeadScore(score: number): LeadClassification {
  if (!Number.isInteger(score) || score < 0 || score > MAX_LEAD_SCORE) {
    throw new RangeError(`Lead score must be an integer between 0 and ${MAX_LEAD_SCORE}`);
  }
  if (score <= 20) return "cold";
  if (score <= 50) return "warm";
  if (score <= 75) return "hot";
  return "very_hot";
}

/**
 * Computes the score from recorded signals. Duplicates are counted once and
 * the breakdown is returned in canonical signal order, so the same set of
 * signals always yields an identical result.
 */
export function computeLeadScore(signals: readonly LeadSignal[]): LeadScoreResult {
  const distinct = new Set(signals);
  const breakdown = LEAD_SIGNALS.filter((s) => distinct.has(s)).map((signal) => ({
    signal,
    points: LEAD_SIGNAL_POINTS[signal],
  }));
  const uncappedScore = breakdown.reduce((sum, item) => sum + item.points, 0);
  const score = Math.min(uncappedScore, MAX_LEAD_SCORE);
  return { score, classification: classifyLeadScore(score), breakdown, uncappedScore };
}
