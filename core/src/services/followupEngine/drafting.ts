import type { LlmClient, LlmContentBlock, LlmMessageParam, LlmTool } from "../../agents/llm/llmClient.js";
import type { FollowupPurpose, Language } from "../../schemas/crm.js";
import type { FollowupContext } from "./context.js";
import { PURPOSE_META } from "./purposes.js";

/**
 * Follow-up message drafting.
 *
 * 1. A fact sheet is built from stored, verified data only. Prices appear
 *    only when an approved price exists; availability only when stock status
 *    allows promising it. Nothing else about products, prices, discounts,
 *    delivery or gold rates is available to the writer.
 * 2. A writer drafts the message: Claude (when configured) or fixed
 *    templates (offline / fallback).
 * 3. A deterministic validator checks every draft against the fact sheet.
 *    Claude gets one correction attempt; after that the safe template is used.
 * Drafts are always reviewed by staff, and are never sent by this system.
 */

export type DraftLanguage = Exclude<Language, "unknown">;

export interface ProductFact {
  name: string;
  sku: string;
  /** Verified approved price, formatted ("PKR 485,000"), or null when not approved. */
  price: string | null;
  availability: "available" | "made_to_order" | "needs_confirmation";
}

export interface DraftFacts {
  businessName: string;
  purpose: FollowupPurpose;
  purposeLabel: string;
  language: DraftLanguage;
  languageSource: "customer_preference" | "default";
  customerName: string | null;
  products: ProductFact[];
  lastCustomerMessage: { text: string; date: string } | null;
  staffNote: string | null;
}

export interface DraftValidation {
  attempts: number;
  violations: { code: string; detail: string }[];
  fallback: boolean;
}

export interface DraftResult {
  content: string;
  language: DraftLanguage;
  rationale: string | null;
  authorType: "ai" | "template";
  model: string;
  validation: DraftValidation;
}

export interface FollowupDrafter {
  readonly kind: "ai" | "template";
  readonly model: string;
  draft(facts: DraftFacts, options?: { signal?: AbortSignal }): Promise<DraftResult>;
}

// --- Facts ------------------------------------------------------------------------------

/** "485000.00" → "PKR 485,000" (string arithmetic only — money never passes through a float). */
export function formatVerifiedPrice(amount: string, currency: string): string {
  const [int, frac = ""] = amount.split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency} ${grouped}${/^0*$/.test(frac) ? "" : `.${frac.padEnd(2, "0").slice(0, 2)}`}`;
}

export function buildDraftFacts(ctx: FollowupContext, purpose: FollowupPurpose, options: { productId?: string | null; staffNote?: string | null } = {}): DraftFacts {
  const pref = ctx.customer.preferredLanguage;
  const chosen = options.productId ? ctx.interests.filter((i) => i.productId === options.productId) : ctx.interests.slice(0, 1);
  return {
    businessName: "Zarghoon Jewellers",
    purpose,
    purposeLabel: PURPOSE_META[purpose].label,
    language: pref === "unknown" ? "english" : pref,
    languageSource: pref === "unknown" ? "default" : "customer_preference",
    customerName: ctx.customer.fullName,
    products: chosen.map((p) => ({
      name: p.name,
      sku: p.sku,
      price: p.isActive && p.approvedPrice ? formatVerifiedPrice(p.approvedPrice, p.currency) : null,
      availability:
        p.isActive && (p.stockStatus === "available" || p.stockStatus === "low_stock") && (p.stockQuantity === null || p.stockQuantity > 0)
          ? "available"
          : p.isActive && p.stockStatus === "made_to_order"
            ? "made_to_order"
            : "needs_confirmation",
    })),
    lastCustomerMessage: ctx.latestCustomerMessage
      ? { text: ctx.latestCustomerMessage.content.slice(0, 300), date: ctx.latestCustomerMessage.at.toISOString().slice(0, 10) }
      : null,
    staffNote: options.staffNote?.slice(0, 300) ?? null,
  };
}

// --- Validation -------------------------------------------------------------------------

const FORBIDDEN: [RegExp, string][] = [
  [/discount|% ?off|\bsale\b|\boffer(s|ed)?\b|\bdeal\b|cashback|rebate|special price|best price|رعایت|ڈسکاؤنٹ|آفر|\bri'?ayat\b/i, "discount_or_offer"],
  [/gold rate|tola rate|rate of gold|سونے کا ریٹ|سونے کی قیمت|\btola\b/i, "gold_rate"],
  [/deliver(y|ed)? (by|within|on|in)\b|ship(ped|ping)? (by|within|on)\b|\bfree delivery\b|ڈیلیوری/i, "delivery_promise"],
  [/limited|only \d+ (left|piece)|last (one|piece)|few (left|pieces)|selling fast|hurry|act fast|before (it'?s|they'?re) gone|جلدی|محدود|sirf \d+/i, "urgency_or_scarcity"],
  [/guarantee|guaranteed|ضمانت/i, "guarantee"],
  [/\b(payment|refund|order|booking|exchange)\b[^.?!\n]{0,40}\b(received|confirmed|processed|approved|shipped|dispatched|delivered|cancell?ed|reserved)\b/i, "transaction_claim"],
  [/https?:\/\/|www\.|@[a-z0-9-]+\.[a-z]/i, "contact_or_link"],
];
const AVAILABILITY_CLAIM = /\b(in stock|is available|are available|available now|ready to (ship|deliver|collect)|stock mein|mojood|maujood|dastiyab)\b|موجود|دستیاب/i;
const LARGE_AMOUNT_WORDS = /\b(lakh|lac|crore|hazar|thousand|million|k)\b|لاکھ|کروڑ|ہزار/i;

const digitsOf = (s: string) => s.replace(/[^\d]/g, "");

export function validateDraft(text: string, facts: DraftFacts): { code: string; detail: string }[] {
  const violations: { code: string; detail: string }[] = [];
  const trimmed = text.trim();
  if (trimmed.length < 20) violations.push({ code: "too_short", detail: "Draft is too short" });
  if (trimmed.length > 700) violations.push({ code: "too_long", detail: "Draft is longer than 700 characters" });
  for (const [re, code] of FORBIDDEN) {
    const m = trimmed.match(re);
    if (m) violations.push({ code, detail: `"${m[0]}" is not allowed` });
  }
  const allowedNumbers = new Set(facts.products.flatMap((p) => (p.price ? [digitsOf(p.price.split(".")[0]!)] : [])));
  for (const m of trimmed.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = digitsOf(m[0].split(".")[0]!);
    if (n.length >= 3 && !allowedNumbers.has(n)) violations.push({ code: "unverified_number", detail: `"${m[0]}" is not a verified figure` });
  }
  if (/%/.test(trimmed)) violations.push({ code: "unverified_number", detail: "Percentages are not allowed" });
  if (/\d/.test(trimmed) && LARGE_AMOUNT_WORDS.test(trimmed)) {
    violations.push({ code: "unverified_number", detail: "Amounts must be written exactly as the verified price" });
  }
  if (AVAILABILITY_CLAIM.test(trimmed) && !facts.products.some((p) => p.availability === "available")) {
    violations.push({ code: "unverified_availability", detail: "Availability is not confirmed for this piece" });
  }
  const urduScript = /[؀-ۿ]/.test(trimmed);
  if (facts.language === "urdu" && !urduScript) violations.push({ code: "wrong_language", detail: "Draft must be in Urdu script" });
  if (facts.language !== "urdu" && urduScript) violations.push({ code: "wrong_language", detail: `Draft must be in ${facts.language.replace("_", " ")}` });
  return violations;
}

// --- Templates (offline writer and safe fallback) ------------------------------------------------

type Template = (name: string, product: string | null) => string;

const greet: Record<DraftLanguage, (name: string) => string> = {
  english: (n) => `Assalamualaikum${n ? ` ${n}` : ""}!`,
  roman_urdu: (n) => `Assalamualaikum${n ? ` ${n}` : ""}!`,
  urdu: (n) => `السلام علیکم${n ? ` ${n}` : ""}!`,
};

const TEMPLATES: Record<FollowupPurpose, Record<DraftLanguage, Template>> = {
  new_inquiry: {
    english: (n) => `${greet.english(n)} Thank you for getting in touch with Zarghoon Jewellers. Is there a particular piece or occasion we can help you with?`,
    roman_urdu: (n) => `${greet.roman_urdu(n)} Zarghoon Jewellers se rabta karne ka shukriya. Kya koi khaas design ya mauqa hai jis mein hum aap ki madad kar sakte hain?`,
    urdu: (n) => `${greet.urdu(n)} زرغون جیولرز سے رابطہ کرنے کا شکریہ۔ کیا کوئی خاص ڈیزائن یا موقع ہے جس میں ہم آپ کی مدد کر سکیں؟`,
  },
  product_interest: {
    english: (n, p) => `${greet.english(n)} Just following up on ${p ?? "the piece"} you were interested in. Would you like us to show you a few similar designs?`,
    roman_urdu: (n, p) => `${greet.roman_urdu(n)} Aap ne ${p ?? "jis design"} mein dilchaspi dikhayi thi. Kya hum aap ko is jaise kuch aur designs dikhayein?`,
    urdu: (n, p) => `${greet.urdu(n)} آپ نے ${p ?? "جس ڈیزائن"} میں دلچسپی ظاہر کی تھی۔ کیا ہم آپ کو اس جیسے کچھ اور ڈیزائن دکھائیں؟`,
  },
  bridal: {
    english: (n, p) => `${greet.english(n)} Just following up on ${p ?? "the bridal piece"} you were interested in. Would you like us to show you a few more bridal designs, or arrange a time for you to visit?`,
    roman_urdu: (n, p) => `${greet.roman_urdu(n)} Aap ne ${p ?? "bridal design"} mein dilchaspi dikhayi thi. Kya hum aap ko kuch aur bridal designs dikhayein, ya aap ki suhulat se visit ka waqt tay karein?`,
    urdu: (n, p) => `${greet.urdu(n)} آپ نے ${p ?? "برائیڈل ڈیزائن"} میں دلچسپی ظاہر کی تھی۔ کیا ہم آپ کو کچھ اور برائیڈل ڈیزائن دکھائیں، یا آپ کی سہولت کے مطابق وزٹ کا وقت طے کریں؟`,
  },
  price_inquiry: {
    english: (n, p) => `${greet.english(n)} Following up on your question about ${p ?? "the piece"}. Our team would be happy to confirm the details for you — would you like us to get in touch?`,
    roman_urdu: (n, p) => `${greet.roman_urdu(n)} Aap ne ${p ?? "design"} ke bare mein poocha tha. Hamari team aap ko tamam tafseelat confirm kar degi — kya hum aap se rabta karein?`,
    urdu: (n, p) => `${greet.urdu(n)} آپ نے ${p ?? "ڈیزائن"} کے بارے میں پوچھا تھا۔ ہماری ٹیم آپ کو تمام تفصیلات کی تصدیق کر دے گی — کیا ہم آپ سے رابطہ کریں؟`,
  },
  availability_inquiry: {
    english: (n, p) => `${greet.english(n)} Following up on your question about ${p ?? "the piece"}. Our team will confirm the latest availability for you — would that be helpful?`,
    roman_urdu: (n, p) => `${greet.roman_urdu(n)} Aap ne ${p ?? "design"} ke bare mein poocha tha. Hamari team aap ko taaza maloomat confirm kar degi — kya yeh madadgar hoga?`,
    urdu: (n, p) => `${greet.urdu(n)} آپ نے ${p ?? "ڈیزائن"} کے بارے میں پوچھا تھا۔ ہماری ٹیم آپ کو تازہ معلومات کی تصدیق کر دے گی — کیا یہ مددگار ہوگا؟`,
  },
  visit_request: {
    english: (n, p) => `${greet.english(n)} You mentioned you would like to visit us${p ? ` to see ${p}` : ""}. Please let us know a day and time that suits you, and our team will be ready to welcome you.`,
    roman_urdu: (n, p) => `${greet.roman_urdu(n)} Aap ne store aane ka zikr kiya tha${p ? ` taake ${p} dekh sakein` : ""}. Apni suhulat ka din aur waqt bata dein, hamari team aap ka intezar karegi.`,
    urdu: (n, p) => `${greet.urdu(n)} آپ نے اسٹور آنے کا ذکر کیا تھا${p ? ` تاکہ ${p} دیکھ سکیں` : ""}۔ اپنی سہولت کا دن اور وقت بتا دیں، ہماری ٹیم آپ کا استقبال کرے گی۔`,
  },
  custom_order: {
    english: (n) => `${greet.english(n)} Following up on your custom design request. Would you like to share any more details or reference pictures so our team can guide you?`,
    roman_urdu: (n) => `${greet.roman_urdu(n)} Aap ki custom design ki darkhwast ke silsile mein rabta kar rahe hain. Kya aap mazeed tafseel ya reference tasaveer share karna chahenge?`,
    urdu: (n) => `${greet.urdu(n)} آپ کی کسٹم ڈیزائن کی درخواست کے سلسلے میں رابطہ کر رہے ہیں۔ کیا آپ مزید تفصیل یا حوالہ تصاویر شیئر کرنا چاہیں گے؟`,
  },
  staff_callback: {
    english: (n) => `${greet.english(n)} A member of our team will call you as requested.`,
    roman_urdu: (n) => `${greet.roman_urdu(n)} Aap ki darkhwast par hamari team aap ko call karegi.`,
    urdu: (n) => `${greet.urdu(n)} آپ کی درخواست پر ہماری ٹیم آپ کو کال کرے گی۔`,
  },
  post_purchase_care: {
    english: (n, p) => `${greet.english(n)} Thank you for choosing Zarghoon Jewellers. We hope you are enjoying ${p ?? "your jewellery"}. If you would like any care tips or help, we are always here for you.`,
    roman_urdu: (n, p) => `${greet.roman_urdu(n)} Zarghoon Jewellers ko chunne ka shukriya. Umeed hai aap ko ${p ?? "aap ki jewellery"} pasand aa rahi hogi. Dekh bhaal ke mashwaron ya kisi bhi madad ke liye hum hazir hain.`,
    urdu: (n, p) => `${greet.urdu(n)} زرغون جیولرز کو منتخب کرنے کا شکریہ۔ امید ہے آپ کو ${p ?? "آپ کے زیورات"} پسند آ رہے ہوں گے۔ دیکھ بھال کے مشوروں یا کسی بھی مدد کے لیے ہم حاضر ہیں۔`,
  },
  review_request: {
    english: (n) => `${greet.english(n)} Thank you for shopping with Zarghoon Jewellers. If you have a moment, we would be grateful to hear about your experience.`,
    roman_urdu: (n) => `${greet.roman_urdu(n)} Zarghoon Jewellers se khareedari ka shukriya. Agar waqt ho to apna tajurba zaroor batayein, hamein khushi hogi.`,
    urdu: (n) => `${greet.urdu(n)} زرغون جیولرز سے خریداری کا شکریہ۔ اگر وقت ہو تو اپنا تجربہ ضرور بتائیں، ہمیں خوشی ہوگی۔`,
  },
};

export function templateDraft(facts: DraftFacts): string {
  const product = facts.products[0] ? facts.products[0].name : null;
  return TEMPLATES[facts.purpose][facts.language](facts.customerName ?? "", product);
}

export const TEMPLATE_MODEL = "offline-template";

/** The offline writer: fixed, reviewed templates. Not AI. */
export function createTemplateDrafter(): FollowupDrafter {
  return {
    kind: "template",
    model: TEMPLATE_MODEL,
    async draft(facts) {
      const content = templateDraft(facts);
      return {
        content,
        language: facts.language,
        rationale: null,
        authorType: "template",
        model: TEMPLATE_MODEL,
        validation: { attempts: 0, violations: validateDraft(content, facts), fallback: false },
      };
    },
  };
}

// --- Claude writer --------------------------------------------------------------------------

export const SUBMIT_DRAFT_TOOL: LlmTool = {
  name: "submit_draft",
  description: "Submit the follow-up message draft for staff review. Call this exactly once.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      message: { type: "string", description: "The message text the customer would receive." },
      language: { type: "string", enum: ["english", "urdu", "roman_urdu"] },
      rationale: { type: "string", description: "One sentence for staff: why this follow-up and this wording." },
    },
    required: ["message", "language", "rationale"],
    additionalProperties: false,
  },
};

export const DRAFTING_SYSTEM_PROMPT = `You write follow-up messages for Zarghoon Jewellers, a premium jewellery business in Pakistan. Staff review every draft before anything is sent.

Voice: premium, professional, friendly and respectful — a natural Pakistani jewellery business tone. Helpful, never pushy. Two or three short sentences. Greet with "Assalamualaikum" (or "السلام علیکم" in Urdu). End with a gentle question or offer of help.

Use ONLY the facts provided. Strictly:
- Never mention a price unless it appears in the facts, and then exactly as written.
- Never mention discounts, offers, deals, gold rates, delivery dates, guarantees, urgency or limited stock.
- Never say a piece is available or in stock unless its availability fact is "available". Otherwise, say the team can confirm.
- Never invent product details, past conversations or purchases. Do not include links, phone numbers or email addresses.
- Write in the requested language: "english", "urdu" (Urdu script) or "roman_urdu" (Urdu in Latin letters).

Return the draft by calling the submit_draft tool.`;

function factsPrompt(facts: DraftFacts): string {
  return `Write a ${facts.purposeLabel.toLowerCase()} follow-up in ${facts.language}.\n\n<facts>\n${JSON.stringify(facts, null, 2)}\n</facts>`;
}

function findSubmit(content: LlmContentBlock[]) {
  for (const block of content) {
    if (block.type === "tool_use" && block.name === "submit_draft") return block;
  }
  return null;
}

/**
 * Claude writer with deterministic validation. One corrective retry; then the
 * safe template. Provider errors (network, rate limit) propagate so the
 * caller can retry later — they never produce an unvalidated draft.
 */
export function createClaudeDrafter(llm: LlmClient, options: { maxAttempts?: number } = {}): FollowupDrafter {
  const maxAttempts = options.maxAttempts ?? 2;
  return {
    kind: "ai",
    model: llm.model,
    async draft(facts, opts) {
      const messages: LlmMessageParam[] = [{ role: "user", content: factsPrompt(facts) }];
      const violations: { code: string; detail: string }[] = [];
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const response = await llm.createMessage({ system: DRAFTING_SYSTEM_PROMPT, messages, tools: [SUBMIT_DRAFT_TOOL] }, { signal: opts?.signal });
        messages.push({ role: "assistant", content: response.content });
        const call = response.stop_reason === "refusal" ? null : findSubmit(response.content);
        const input = (call?.input ?? {}) as { message?: unknown; language?: unknown; rationale?: unknown };
        const text = typeof input.message === "string" ? input.message.trim() : "";
        const problems = call ? validateDraft(text, facts) : [{ code: "no_draft", detail: "No draft was submitted" }];
        if (call && input.language !== facts.language) problems.push({ code: "wrong_language", detail: `Language must be ${facts.language}` });
        if (problems.length === 0) {
          return {
            content: text,
            language: facts.language,
            rationale: typeof input.rationale === "string" ? input.rationale.slice(0, 1000) : null,
            authorType: "ai",
            model: response.model ?? llm.model,
            validation: { attempts: attempt, violations, fallback: false },
          };
        }
        violations.push(...problems);
        if (!call) break;
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: call.id,
              is_error: true,
              content: `The draft was rejected: ${problems.map((p) => p.detail).join("; ")}. Write it again using only the facts.`,
            },
          ],
        });
      }
      const content = templateDraft(facts);
      return {
        content,
        language: facts.language,
        rationale: "Safe template used because the AI draft did not pass validation.",
        authorType: "template",
        model: TEMPLATE_MODEL,
        validation: { attempts: maxAttempts, violations, fallback: true },
      };
    },
  };
}
