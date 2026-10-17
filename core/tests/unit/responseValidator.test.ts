import { describe, expect, it } from "vitest";
import { extractNumbers, validateReply } from "../../src/agents/sales/responseValidator.js";
import { TurnState } from "../../src/agents/sales/toolExecutor.js";
import type { SubmitReplyInput } from "../../src/agents/sales/toolDefinitions.js";

const PID = "5b0e1f0e-8f0a-4c43-9d1a-2f4a8a9b7c10";

function stateWith(sources: unknown[] = [], products: Record<string, string> = {}) {
  const s = new TurnState();
  for (const src of sources) s.factSources.push(JSON.stringify(src));
  for (const [id, sku] of Object.entries(products)) s.seenProducts.set(id, { sku, name: sku });
  return s;
}

const submission = (reply: string, over: Partial<SubmitReplyInput> = {}): SubmitReplyInput => ({
  reply,
  intent: "general_question",
  language: "english",
  productsReferenced: [],
  followupRecommended: false,
  handoff: { required: false },
  confidence: "high",
  ...over,
});

describe("extractNumbers", () => {
  it("understands Pakistani amount formats", () => {
    const values = (text: string) => extractNumbers(text).map((n) => [n.value, n.kind]);
    expect(values("PKR 485,000")).toEqual([["485000", "plain"]]);
    expect(values("Rs 4,85,000")).toEqual([["485000", "plain"]]);
    expect(values("4.85 lakh")).toEqual([["485000", "amount"]]);
    expect(values("1.2 crore")).toEqual([["12000000", "amount"]]);
    expect(values("under 400k")).toEqual([["400000", "amount"]]);
    expect(values("22k gold")).toEqual([["22", "karat"]]);
    expect(values("18 karat")).toEqual([["18", "karat"]]);
    expect(values("62.500 grams")).toEqual([["62.5", "weight"]]);
    expect(values("10% off")).toEqual([["10", "percent"]]);
    expect(values("قیمت ۴۸۵۰۰۰ روپے")).toEqual([["485000", "plain"]]);
    expect(values("۵ لاکھ")).toEqual([["500000", "amount"]]);
  });
});

describe("validateReply", () => {
  const product = { productId: PID, sku: "DEMO-NK-001", approvedPrice: "485000.00", karat: 22, weightGrams: "62.500" };

  it("accepts values that tools returned, in any common format", () => {
    const state = stateWith([product], { [PID]: "DEMO-NK-001" });
    for (const reply of [
      "DEMO-NK-001 is PKR 485,000.",
      "Its price is Rs 4,85,000.",
      "It is 4.85 lakh, 22K gold, 62.5 grams.",
      "Qeemat ۴۸۵۰۰۰ روپے hai.",
    ]) {
      expect(validateReply(submission(reply, { productsReferenced: [PID] }), { state, customerTexts: [] })).toEqual({ ok: true });
    }
  });

  it("accepts the customer's own numbers (their budget)", () => {
    const state = stateWith([]);
    expect(validateReply(submission("Within your 5 lakh budget, let me check."), { state, customerTexts: ["budget 5 lakh"] }).ok).toBe(true);
    expect(validateReply(submission("Within 500,000, let me check."), { state, customerTexts: ["under 500k"] }).ok).toBe(true);
  });

  it("rejects invented prices, karat, weights, percentages and scores", () => {
    const state = stateWith([product], { [PID]: "DEMO-NK-001" });
    for (const reply of [
      "It costs PKR 450,000.",
      "It's 24K gold.",
      "It weighs 50 grams.",
      "I can give 10% off.",
      "Approximately 5 lakh.",
      "Your lead score is 95.",
      "You're a hot lead!",
    ]) {
      expect(validateReply(submission(reply), { state, customerTexts: [] }).ok, reply).toBe(false);
    }
  });

  it("does not let digits inside ids or timestamps ground a percentage", () => {
    const state = stateWith([{ id: "a10b0e1f-8f0a-4c43-9d1a-2f4a8a9b7c10", at: "2026-10-17T10:10:00Z" }]);
    expect(validateReply(submission("Enjoy 10% off today."), { state, customerTexts: [] }).ok).toBe(false);
  });

  it("allows small bare numbers (counts, dates, times)", () => {
    const state = stateWith([]);
    expect(validateReply(submission("I found 3 designs; we can meet on 20 October at 11am."), { state, customerTexts: [] }).ok).toBe(true);
  });

  it("rejects SKUs and product ids not returned this turn", () => {
    const state = stateWith([product], { [PID]: "DEMO-NK-001" });
    expect(validateReply(submission("Try DEMO-NK-777."), { state, customerTexts: [] }).ok).toBe(false);
    const res = validateReply(submission("Lovely piece.", { productsReferenced: ["6b0e1f0e-8f0a-4c43-9d1a-2f4a8a9b7c10"] }), { state, customerTexts: [] });
    expect(res.ok).toBe(false);
  });

  it("requires check_inventory before availability answers about a product", () => {
    const state = stateWith([product], { [PID]: "DEMO-NK-001" });
    const sub = submission("Yes it's available.", { intent: "availability_question", productsReferenced: [PID] });
    expect(validateReply(sub, { state, customerTexts: [] }).ok).toBe(false);
    state.inventoryChecked.add(PID);
    expect(validateReply(sub, { state, customerTexts: [] }).ok).toBe(true);
  });

  it("limits emojis and forces handoff on low confidence", () => {
    const state = stateWith([]);
    expect(validateReply(submission("Hello ✨💍💎🌟"), { state, customerTexts: [] }).ok).toBe(false);
    expect(validateReply(submission("Not sure.", { confidence: "low" }), { state, customerTexts: [] }).ok).toBe(false);
    expect(validateReply(submission("Team will confirm.", { confidence: "low", handoff: { required: true, reason: "low_ai_confidence" } }), { state, customerTexts: [] }).ok).toBe(true);
  });
});
