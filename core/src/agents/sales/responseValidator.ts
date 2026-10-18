import { MoneyDecimal } from "../../lib/money.js";
import type { SubmitReplyInput } from "./toolDefinitions.js";
import type { TurnState } from "./toolExecutor.js";

/**
 * Fact-grounding check on the model's final reply, in code.
 *
 * The prompt tells the model not to invent facts; this module verifies it.
 * Any price, amount, karat, weight, percentage or SKU in the reply must
 * appear in this turn's tool results or in the customer's own messages.
 * Referenced products must have come from the database this turn, and an
 * availability answer must be backed by check_inventory.
 *
 * A failed check is returned to the model as a tool error so it can correct
 * itself; repeated failure makes the orchestrator fall back to a safe reply
 * and a human handoff.
 */

export interface ValidationContext {
  state: TurnState;
  /** The customer's own words (current and recent inbound messages). */
  customerTexts: string[];
}

export type ReplyValidation = { ok: true } | { ok: false; problems: string[] };

/**
 * Small bare numbers (counts, days of the month, clock times: "2 designs",
 * "20 October", "11am") are not business facts. Anything larger must be grounded.
 */
const SMALL_NUMBER_LIMIT = 31;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const MAX_EMOJIS = 2;

const URDU_DIGITS: Record<string, string> = {
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

function normalizeDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (d) => URDU_DIGITS[d] ?? d);
}

export interface NumericMention {
  raw: string;
  /** Canonical decimal string of the value the mention denotes. */
  value: string;
  kind: "amount" | "karat" | "weight" | "percent" | "plain";
}

const NUMBER = String.raw`(\d[\d,]*(?:\.\d+)?)`;
const MENTION = new RegExp(
  `${NUMBER}\\s*(lakh|lac|لاکھ|crore|کروڑ|%|percent|k\\b|kt\\b|karat|carat|قیراط|grams?\\b|gms?\\b|g\\b|tola)?`,
  "gi",
);

function canonical(d: InstanceType<typeof MoneyDecimal>): string {
  return d.toFixed(); // "485000.00" → "485000", "45.500" → "45.5"
}

/** Extracts every numeric mention with its unit-aware value (shared by reply and sources). */
export function extractNumbers(text: string): NumericMention[] {
  const out: NumericMention[] = [];
  for (const m of normalizeDigits(text).matchAll(MENTION)) {
    const digits = m[1]!.replace(/,/g, "");
    if (!/^\d+(\.\d+)?$/.test(digits)) continue;
    const n = new MoneyDecimal(digits);
    const unit = (m[2] ?? "").toLowerCase();
    let value = n;
    let kind: NumericMention["kind"] = "plain";
    if (unit === "lakh" || unit === "lac" || unit === "لاکھ") {
      value = n.times(100_000);
      kind = "amount";
    } else if (unit === "crore" || unit === "کروڑ") {
      value = n.times(10_000_000);
      kind = "amount";
    } else if (unit === "%" || unit === "percent") {
      kind = "percent";
    } else if (unit === "k") {
      // "22k" is a karat; "400k" is an amount.
      if (n.lessThanOrEqualTo(24)) kind = "karat";
      else {
        value = n.times(1000);
        kind = "amount";
      }
    } else if (["kt", "karat", "carat", "قیراط"].includes(unit)) {
      kind = "karat";
    } else if (unit) {
      kind = "weight";
    }
    out.push({ raw: m[0].trim(), value: canonical(value), kind });
  }
  return out;
}

export function validateReply(submission: SubmitReplyInput, vc: ValidationContext): ReplyValidation {
  const problems: string[] = [];
  const reply = submission.reply;

  // 1. Every number that could be a business fact must be grounded.
  const allowed = new Set<string>();
  // Percentages (discount territory) must be grounded by a percentage, not by any equal number.
  const allowedPercents = new Set<string>();
  // Numbers the tools returned (verified facts), kept apart from the customer's own numbers.
  const fromTools = new Set<string>();
  for (const [i, source] of [...vc.state.factSources, ...vc.customerTexts].entries()) {
    // Digit runs inside ids must not accidentally "ground" a number.
    for (const n of extractNumbers(source.replace(UUID, " "))) {
      allowed.add(n.value);
      if (i < vc.state.factSources.length) fromTools.add(n.value);
      if (n.kind === "percent") allowedPercents.add(n.value);
    }
  }
  for (const mention of extractNumbers(reply)) {
    const isBareSmall = mention.kind === "plain" && new MoneyDecimal(mention.value).lessThanOrEqualTo(SMALL_NUMBER_LIMIT);
    if (isBareSmall) continue;
    if (mention.kind === "percent" ? allowedPercents.has(mention.value) : allowed.has(mention.value)) {
      // A customer's figure may be repeated as their budget, never confirmed as a price
      // ("the website said 300,000" must not become "yes, it is 300,000").
      if (!fromTools.has(mention.value) && assertsPrice(reply, mention.raw)) {
        problems.push(
          `"${mention.raw}" came from the customer, not from the catalogue. Never confirm a customer's figure as a price; state the stored price from a tool, or say the team will confirm it.`,
        );
      }
      continue;
    }
    problems.push(
      `"${mention.raw}" does not appear in any tool result or customer message. Never state prices, amounts, karat, weights or percentages that tools did not return.`,
    );
  }

  // 2. SKUs must be real and seen this turn.
  const seenSkus = new Set([...vc.state.seenProducts.values()].map((p) => p.sku));
  for (const sku of reply.match(/\b[A-Z]{2,}(?:-[A-Z0-9]+){1,4}\b/g) ?? []) {
    if (!seenSkus.has(sku)) problems.push(`SKU "${sku}" was not returned by a product tool this turn.`);
  }

  // 3. Referenced products must come from the database this turn.
  for (const id of submission.productsReferenced) {
    if (!vc.state.seenProducts.has(id)) problems.push(`productsReferenced contains ${id}, which no product tool returned.`);
  }

  // 4. Availability answers about specific products require check_inventory.
  if (submission.intent === "availability_question") {
    for (const id of submission.productsReferenced) {
      if (!vc.state.inventoryChecked.has(id)) {
        problems.push(`Availability of product ${id} was not checked with check_inventory this turn.`);
      }
    }
  }

  // 5. Lead scoring is internal and never discussed with customers.
  if (/\b(lead\s*)?scor(e|es|ing)\b|\bhot\s+lead\b/i.test(reply)) {
    problems.push("Never mention scores, lead status or other internal CRM data to the customer.");
  }

  // 6. Brand voice: restrained emoji use.
  const emojis = reply.match(/\p{Extended_Pictographic}/gu)?.length ?? 0;
  if (emojis > MAX_EMOJIS) problems.push(`Use at most ${MAX_EMOJIS} emojis.`);

  // 7. A low-confidence answer must go to a human instead of the customer guessing.
  if (submission.confidence === "low" && !submission.handoff.required) {
    problems.push("Confidence is low: request a human handoff (reason low_ai_confidence) instead of guessing.");
  }

  // 8. The agent has no tool that takes payments, approves discounts or refunds, books or
  //    ships orders, or reads the gold rate — so any claim that one of these happened is invented.
  for (const claim of unsupportedCommitments(reply)) {
    problems.push(
      `"${claim}" states something no tool did or returned (payments, orders, delivery, discounts, refunds and gold rates are confirmed only by staff). Offer to connect the customer with the team instead.`,
    );
  }

  return problems.length ? { ok: false, problems } : { ok: true };
}

const PRICE_WORDS = /\b(price|priced|prices|costs?|rate|qeemat|keemat|قیمت|is (?:pkr|rs\.?)|for (?:pkr|rs\.?|only))\b/i;
const BUDGET_WORDS = /\b(budget|under|below|within|up ?to|less than|around|max(?:imum)?|range|tak|se kam|بجٹ|تک)\b/i;

/** Whether the sentence holding `raw` states it as a price rather than a budget. */
function assertsPrice(reply: string, raw: string): boolean {
  const at = reply.indexOf(raw);
  if (at < 0) return false;
  const start = Math.max(reply.lastIndexOf(".", at - 1), reply.lastIndexOf("?", at - 1), reply.lastIndexOf("!", at - 1), reply.lastIndexOf("\n", at - 1)) + 1;
  const ends = [".", "?", "!", "\n"].map((c) => reply.indexOf(c, at + raw.length)).filter((i) => i >= 0);
  const sentence = reply.slice(start, ends.length ? Math.min(...ends) : reply.length);
  return PRICE_WORDS.test(sentence) && !BUDGET_WORDS.test(sentence);
}

/**
 * Completed-action and commitment claims. A clause containing a negation or a condition
 * ("not yet confirmed", "once your payment is confirmed") is not a claim.
 */
const COMMITMENT_PATTERNS: RegExp[] = [
  /\b(payment|transfer|deposit|advance|amount)\b[^.?!\n]{0,40}\b(received|confirmed|verified|cleared|successful|credited)\b/gi,
  /\b(discount|refund|exchange|price (?:change|match)|cancellation|replacement)\b[^.?!\n]{0,40}\b(approved|processed|applied|granted|issued|arranged|done|confirmed)\b/gi,
  /\b(order|booking|parcel|package|delivery|shipment)\b[^.?!\n]{0,40}\b(confirmed|booked|placed|shipped|dispatched|delivered|cancell?ed|on (?:its|the) way)\b/gi,
  /\b(?:I|we)(?:'ve| have)?\s+(?:already\s+)?(?:applied|approved|processed|refunded|cancell?ed|reserved|booked|shipped|dispatched)\b/gi,
  /\b(?:will|shall)\s+(?:be\s+)?deliver(?:ed)?\b[^.?!\n]{0,30}\b(?:today|tomorrow|tonight|by|on|within)\b/gi,
  /\bgold\s*rate\b[^.?!\n]{0,40}\b(?:is|was|has)\s+(?:stable|down|up|lower|higher|the same|dropped|increased|decreased|fixed)\b/gi,
  // Roman Urdu
  /\b(payment|paise|raqam)\b[^.?!\n]{0,30}\b(mil|aa|agay|aagay)\s*(gai|gayi|gaye|gaya|chuki|chuka)\b/gi,
  /\b(discount|refund|order)\b[^.?!\n]{0,30}\b(de|lag|ho|confirm ho|book ho|cancel ho)\s*(diya|gaya|gayi|chuka|chuki)\b/gi,
];
const NOT_A_CLAIM = /\b(not|n't|never|no|yet to|once|after|when|if|until|before|can't|cannot|only|whether)\b/i;

export function unsupportedCommitments(reply: string): string[] {
  const found: string[] = [];
  for (const pattern of COMMITMENT_PATTERNS) {
    for (const m of reply.matchAll(pattern)) {
      const start = Math.max(0, reply.lastIndexOf(".", m.index) + 1, reply.lastIndexOf(",", m.index) + 1);
      const clause = reply.slice(start, m.index + m[0].length);
      if (!NOT_A_CLAIM.test(clause)) found.push(m[0].trim());
    }
  }
  return found;
}
