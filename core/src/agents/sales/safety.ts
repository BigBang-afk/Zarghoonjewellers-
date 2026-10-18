import type { HandoffReason, HandoffUrgency, Language } from "../../schemas/crm.js";
import type { LeadSignal } from "../../services/crm/leadScoring.js";
import type { SalesIntent } from "./types.js";

/**
 * Deterministic safety rules applied in code after the model has spoken.
 * The model can always escalate, but it can never talk its way out of a
 * mandatory handoff.
 */

export interface HandoffDecision {
  reason: HandoffReason;
  urgency: HandoffUrgency;
  source: "intent_rule" | "keyword_backstop" | "model" | "model_tool" | "safety_failure";
  note: string;
}

const URGENCY_RANK: Record<HandoffUrgency, number> = { normal: 0, high: 1, urgent: 2 };

/** Intents that always need a human, whatever the model decides. */
export const MANDATORY_HANDOFF_BY_INTENT: Partial<Record<SalesIntent, { reason: HandoffReason; urgency: HandoffUrgency }>> = {
  discount_request: { reason: "discount_request", urgency: "normal" },
  complaint: { reason: "complaint", urgency: "high" },
  human_request: { reason: "customer_requested", urgency: "normal" },
  custom_order: { reason: "custom_order", urgency: "normal" },
};

/**
 * Keyword backstop on the customer's own words, in English, Roman Urdu and
 * Urdu. It catches cases the model misclassified. It deliberately errs
 * towards escalation: a needless handoff costs a staff glance, a missed one
 * could cost a customer.
 */
const KEYWORD_RULES: { reason: HandoffReason; urgency: HandoffUrgency; pattern: RegExp }[] = [
  {
    reason: "complaint",
    urgency: "high",
    pattern:
      /\b(complain(t|ts|ing)?|refund|damaged|broken|tarnish(ed)?|kharab|toot\s?gay[ai]|shikayat|dhoka|cheated|fraud)\b|شکایت|خراب|ٹوٹ|دھوکہ|ریفنڈ/i,
  },
  {
    reason: "discount_request",
    urgency: "normal",
    pattern: /\b(discount|rebate|riayat|kam\s?kar(en|ein|o|dein|do)?|kuch\s?kam|best\s?price|last\s?price)\b|رعایت|ڈسکاؤنٹ|کم\s?کر/i,
  },
  {
    reason: "customer_requested",
    urgency: "normal",
    pattern:
      /\b(real\s?person|human|sales\s?(person|man|woman)|manager|staff\s?(se|member)|kisi\s?(insaan|bande)|call\s?me|mujhe\s?call|(speak|talk)\s+(to|with)\s+(someone|somebody|a\s+person|an?\s+(agent|representative))|kisi\s+se\s+baat)\b|کسی\s?سے\s?بات|مینیجر/i,
  },
  {
    reason: "payment_issue",
    urgency: "high",
    pattern: /\b(payment\s?(failed|issue|problem|not\s?received)|paise\s?(kat|cut)|double\s?charged|transaction\s?failed)\b/i,
  },
];

export function keywordHandoff(message: string): HandoffDecision | null {
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(message)) {
      return { reason: rule.reason, urgency: rule.urgency, source: "keyword_backstop", note: "Matched escalation keywords in the customer's message" };
    }
  }
  return null;
}

/** Picks the most urgent of all handoff triggers (first trigger wins ties, so precedence is the array order). */
export function mergeHandoffs(candidates: (HandoffDecision | null | undefined)[]): HandoffDecision | null {
  let best: HandoffDecision | null = null;
  for (const c of candidates) {
    if (c && (!best || URGENCY_RANK[c.urgency] > URGENCY_RANK[best.urgency])) best = c;
  }
  return best;
}

/** Lead signals implied by the classified intent, recorded idempotently by code. */
export const SIGNAL_BY_INTENT: Partial<Record<SalesIntent, LeadSignal>> = {
  price_question: "asked_price",
  availability_question: "asked_availability",
  budget_search: "provided_budget",
  visit_question: "asked_about_visit",
  location_question: "asked_shop_location",
  payment_question: "asked_about_payment_or_order",
};

// --- Language ----------------------------------------------------------------------

const URDU_SCRIPT = /[؀-ۿ]/;
const ROMAN_URDU_WORDS =
  /\b(hai|hain|kya|kia|ka|ki|ke|mein|main|mujhe|aap|ap|chahiye|chahye|kitne|kitna|kab|kahan|nahi|nahin|bhai|bhi|wala|wali|dikhao|dikha|batao|bataen|shukriya|janab|ji|acha|theek)\b/gi;

/** Cheap fallback detector, used only when the model's own language judgement is unavailable. */
export function detectLanguageHeuristic(text: string): Language {
  if (URDU_SCRIPT.test(text)) return "urdu";
  const romanHits = text.match(ROMAN_URDU_WORDS)?.length ?? 0;
  if (romanHits >= 2) return "roman_urdu";
  return /[a-z]/i.test(text) ? "english" : "unknown";
}

/**
 * Fixed replies used when the model cannot be trusted to answer. They state
 * no facts and promise nothing beyond a human follow-up.
 */
export const SAFE_FALLBACK_REPLY: Record<Language, string> = {
  english:
    "Thank you for your message. I'd like to make sure you get accurate information, so a member of the Zarghoon Jewellers team will get back to you shortly.",
  roman_urdu:
    "Aap ke message ka shukriya. Hum chahte hain ke aap ko bilkul durust maloomat milein, is liye Zarghoon Jewellers ki team ka koi member jald aap se rabta karega.",
  urdu: "آپ کے پیغام کا شکریہ۔ ہم چاہتے ہیں کہ آپ کو بالکل درست معلومات ملیں، اس لیے زرغون جیولرز کی ٹیم کا ایک رکن جلد آپ سے رابطہ کرے گا۔",
  unknown:
    "Thank you for your message. A member of the Zarghoon Jewellers team will get back to you shortly.",
};
