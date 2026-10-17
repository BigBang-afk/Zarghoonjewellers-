import { describe, expect, it } from "vitest";
import { detectLanguageHeuristic, keywordHandoff, mergeHandoffs, SAFE_FALLBACK_REPLY } from "../../src/agents/sales/safety.js";
import { SALES_TOOLS, toolInputSchemas } from "../../src/agents/sales/toolDefinitions.js";

describe("keyword backstop", () => {
  it.each([
    ["Can I get a discount?", "discount_request"],
    ["thora kam kar dein please", "discount_request"],
    ["کچھ رعایت ہو سکتی ہے؟", "discount_request"],
    ["My ring arrived broken", "complaint"],
    ["set kharab hai, refund chahiye", "complaint"],
    ["مجھے شکایت ہے", "complaint"],
    ["I want to talk to a real person", "customer_requested"],
    ["manager se baat karwao", "customer_requested"],
    ["my payment failed twice", "payment_issue"],
  ])("%s → %s", (message, reason) => {
    expect(keywordHandoff(message)?.reason).toBe(reason);
  });

  it("does not fire on ordinary questions", () => {
    for (const m of ["Show me bridal necklaces", "Price of DEMO-NK-001?", "Shop kahan hai?", "Do you have 22k bangles?"]) {
      expect(keywordHandoff(m)).toBeNull();
    }
  });

  it("merges triggers by urgency", () => {
    const merged = mergeHandoffs([
      { reason: "discount_request", urgency: "normal", source: "model", note: "" },
      null,
      { reason: "complaint", urgency: "high", source: "keyword_backstop", note: "" },
    ]);
    expect(merged).toMatchObject({ reason: "complaint", urgency: "high" });
    expect(mergeHandoffs([null, undefined])).toBeNull();
  });
});

describe("language heuristic and fallbacks", () => {
  it("detects the three supported languages", () => {
    expect(detectLanguageHeuristic("Show me bridal sets")).toBe("english");
    expect(detectLanguageHeuristic("Bridal set dikhao, kitne ka hai?")).toBe("roman_urdu");
    expect(detectLanguageHeuristic("کیا یہ دستیاب ہے؟")).toBe("urdu");
    expect(detectLanguageHeuristic("💍")).toBe("unknown");
  });

  it("fallback replies state no facts", () => {
    for (const text of Object.values(SAFE_FALLBACK_REPLY)) expect(text).not.toMatch(/\d/);
  });
});

describe("tool definitions", () => {
  it("exposes exactly the approved tools and no database access", () => {
    expect(SALES_TOOLS.map((t) => t.name).sort()).toEqual([
      "check_inventory", "get_business_info", "get_customer_360", "get_product", "get_recent_messages",
      "record_lead_signal", "record_product_interest", "request_human_handoff", "schedule_followup",
      "search_products", "set_preferred_language", "submit_reply",
    ]);
    const all = JSON.stringify(SALES_TOOLS);
    expect(all).not.toMatch(/"sql"|"query_db"|customerId|conversationId|leadId/);
  });

  it("every tool schema is a closed object", () => {
    for (const tool of SALES_TOOLS) {
      expect(tool.input_schema.type).toBe("object");
      expect((tool.input_schema as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    }
    expect(toolInputSchemas.search_products.safeParse({ query: "x", leadScore: 99 }).success).toBe(false);
  });
});
