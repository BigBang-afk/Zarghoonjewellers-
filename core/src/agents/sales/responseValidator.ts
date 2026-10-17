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
  for (const source of [...vc.state.factSources, ...vc.customerTexts]) {
    // Digit runs inside ids must not accidentally "ground" a number.
    for (const n of extractNumbers(source.replace(UUID, " "))) {
      allowed.add(n.value);
      if (n.kind === "percent") allowedPercents.add(n.value);
    }
  }
  for (const mention of extractNumbers(reply)) {
    const isBareSmall = mention.kind === "plain" && new MoneyDecimal(mention.value).lessThanOrEqualTo(SMALL_NUMBER_LIMIT);
    if (isBareSmall) continue;
    if (mention.kind === "percent" ? allowedPercents.has(mention.value) : allowed.has(mention.value)) continue;
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

  return problems.length ? { ok: false, problems } : { ok: true };
}
