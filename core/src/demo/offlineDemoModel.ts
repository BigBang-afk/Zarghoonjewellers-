import { lastToolResult, ScriptedLlmClient, toolResults, toolUseBlock } from "../agents/llm/scriptedLlmClient.js";
import type { LlmContentBlock, LlmRequest } from "../agents/llm/llmClient.js";
import { MoneyDecimal } from "../lib/money.js";
import { keywordHandoff } from "../agents/sales/safety.js";

/**
 * A rule-based stand-in for Claude, for trying the playground without an API
 * key. It is NOT an AI: it detects a product category, runs the real
 * search_products tool, and lists what the database returned. It exists to
 * demonstrate the pipeline (tools, validation, CRM writes, storage), not
 * conversation quality. Every reply still passes through the real validator.
 */

const CATEGORY_WORDS: [RegExp, string][] = [
  [/necklace|haar|set\b|ہار/i, "necklace"],
  [/bangle|kangan|chur|کنگن|چوڑ/i, "bangle"],
  [/ring|angoothi|انگوٹھی/i, "ring"],
  [/bracelet/i, "bracelet"],
  [/earring|jhumk|bali|جھمک|بالی/i, "earrings"],
];

function currentMessage(req: LlmRequest): string {
  const first = req.messages[0]?.content;
  const text = typeof first === "string" ? first : "";
  return text.split("<customer_message>\n")[1]?.split("\n</customer_message>")[0] ?? "";
}

const SKU_PATTERN = /\b[A-Z]{2,5}(?:-[A-Z0-9]{1,10}){1,4}\b/;
const STOCK_WORDS = /stock|available|availability|ready|mojood|موجود/i;
const BUDGET_PATTERN = /\b(?:under|below|within|up ?to|less than|max(?:imum)?|budget(?: of| is)?)\s*(?:rs\.?|pkr)?\s*(\d{1,3}(?:,\d{3})+|\d+)\s*(lakh|lac)?\b/i;

/** A stated budget as an exact PKR amount string, or null. Never guesses. */
export function parseBudget(message: string): string | null {
  const m = message.match(BUDGET_PATTERN);
  if (!m) return null;
  const amount = BigInt(m[1]!.replace(/,/g, "")) * (m[2] ? 100_000n : 1n);
  return amount > 0n ? amount.toString() : null;
}

interface ProductResult {
  productId: string;
  sku: string;
  name: string;
  approvedPrice: string | null;
  priceStatus: string;
}
interface InventoryResult {
  availability: string;
  canPromiseInStock: boolean;
}

function availabilityText(inv: InventoryResult): string {
  if (inv.canPromiseInStock) return inv.availability === "low_stock" ? "is available, with limited pieces left" : "is available";
  if (inv.availability === "made_to_order") return "is made to order; our team will confirm the timeline";
  return "needs confirmation — our team will confirm availability";
}

function formatPkr(amount: string): string {
  return `PKR ${Number(new MoneyDecimal(amount).toFixed(0)).toLocaleString("en-US")}`;
}

const OFFLINE_NOTE = "\n\n[offline demo model — set ANTHROPIC_API_KEY to talk to Claude]";

function submitReply(reply: string, intent: string, productsReferenced: string[] = [], annotate = true): LlmContentBlock[] {
  return [
    toolUseBlock("submit_reply", {
      reply: annotate ? `${reply}${OFFLINE_NOTE}` : reply,
      intent,
      language: "english",
      productsReferenced,
      followupRecommended: false,
      handoff: { required: false },
      confidence: "high",
    }),
  ];
}

/**
 * @param options.annotate append a note that this is not AI (CLI default). The
 *   website omits it because its demo banner already says so.
 */
export function createOfflineDemoModel(options: { annotate?: boolean } = {}): ScriptedLlmClient {
  const annotate = options.annotate ?? true;
  return new ScriptedLlmClient((req) => {
    const message = currentMessage(req);
    const previous = lastToolResult(req);
    const submit = (reply: string, intent: string, ids: string[] = []) => submitReply(reply, intent, ids, annotate);

    if (!previous) {
      // Escalations: acknowledge politely; the agent's code rules create the actual handoff.
      const handoff = keywordHandoff(message);
      if (handoff) {
        const intent = handoff.reason === "discount_request" ? "discount_request" : handoff.reason === "complaint" ? "complaint" : "human_request";
        return () => submit("Of course. A member of the Zarghoon Jewellers team will assist you with this request.", intent);
      }
      const sku = message.match(SKU_PATTERN)?.[0];
      if (sku) return () => [toolUseBlock("get_product", { sku })];
      const category = CATEGORY_WORDS.find(([pattern]) => pattern.test(message))?.[1];
      const bridal = /bridal|dulhan|shaadi|wedding|دلہن|شادی/i.test(message);
      const karatMatch = message.match(/\b(1[0-9]|2[0-4])\s*(k|kt|karat)\b/i);
      if (!category && !bridal) {
        return () =>
          submit("Welcome to Zarghoon Jewellers. Which kind of piece are you looking for — necklaces, bangles, rings, bracelets or earrings?", "general_question");
      }
      return () => [
        toolUseBlock("search_products", {
          ...(category ? { category } : {}),
          ...(bridal ? { collection: "bridal" } : {}),
          ...(karatMatch ? { karat: Number(karatMatch[1]) } : {}),
          ...(parseBudget(message) ? { maxPrice: parseBudget(message) } : {}),
          limit: 3,
        }),
      ];
    }

    if (previous.isError) {
      return () => submit("I couldn't find that piece in our collection. Our team would be happy to help you further.", "general_question");
    }
    const [first, second] = toolResults(req).map((r) => r.data);
    if (first && typeof first === "object" && "priceStatus" in first) {
      const product = first as ProductResult;
      // A single product: also check stored stock before saying anything about availability.
      if (!second) return () => [toolUseBlock("check_inventory", { sku: product.sku })];
      const price = product.approvedPrice ? formatPkr(product.approvedPrice) : "to be confirmed by our team";
      const intent = STOCK_WORDS.test(message) ? "availability_question" : "price_question";
      return () =>
        submit(`${product.name} (${product.sku}): price ${price}. This piece ${availabilityText(second as InventoryResult)}.`, intent, [product.productId]);
    }

    const data = previous.data as { products?: { productId: string; name: string; approvedPrice: string | null }[] };
    const products = data.products ?? [];
    if (products.length === 0) {
      return () => submit("I couldn't find a matching piece in our collection right now. Our team would be happy to help you further.", "product_search");
    }
    const lines = products.map((p) => `• ${p.name} — ${p.approvedPrice ? formatPkr(p.approvedPrice) : "price to be confirmed by our team"}`);
    const intent = parseBudget(message) ? "budget_search" : "product_search";
    return () => submit(`Here is what I found:\n${lines.join("\n")}`, intent, products.map((p) => p.productId));
  });
}
