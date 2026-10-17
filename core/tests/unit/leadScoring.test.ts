import { describe, expect, it } from "vitest";
import {
  classifyLeadScore,
  computeLeadScore,
  LEAD_SIGNAL_POINTS,
  LEAD_SIGNALS,
} from "../../src/services/crm/leadScoring.js";
import { promotedStatus } from "../../src/services/crm/shared.js";

describe("computeLeadScore", () => {
  it("matches the specification example (40, warm) with an audit breakdown", () => {
    expect(computeLeadScore(["asked_price", "provided_budget", "asked_availability"])).toEqual({
      score: 40,
      classification: "warm",
      uncappedScore: 40,
      breakdown: [
        { signal: "asked_price", points: 10 },
        { signal: "provided_budget", points: 15 },
        { signal: "asked_availability", points: 15 },
      ],
    });
  });

  it("uses the exact point table", () => {
    expect(LEAD_SIGNAL_POINTS).toEqual({
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
    });
  });

  it("caps at 100 but keeps the uncapped total for transparency", () => {
    const all = computeLeadScore(LEAD_SIGNALS);
    expect(all.score).toBe(100);
    expect(all.uncappedScore).toBe(140);
    expect(all.classification).toBe("very_hot");
  });

  it("counts a repeated signal only once", () => {
    expect(computeLeadScore(["asked_price", "asked_price", "asked_price"]).score).toBe(10);
  });

  it("is deterministic regardless of input order", () => {
    const a = computeLeadScore(["asked_about_visit", "asked_price", "provided_contact"]);
    const b = computeLeadScore(["provided_contact", "asked_about_visit", "asked_price"]);
    expect(a).toEqual(b);
  });

  it("scores zero with no signals", () => {
    expect(computeLeadScore([])).toEqual({ score: 0, classification: "cold", breakdown: [], uncappedScore: 0 });
  });
});

describe("classifyLeadScore", () => {
  it.each([
    [0, "cold"], [20, "cold"], [21, "warm"], [50, "warm"],
    [51, "hot"], [75, "hot"], [76, "very_hot"], [100, "very_hot"],
  ] as const)("%i → %s", (score, expected) => {
    expect(classifyLeadScore(score)).toBe(expected);
  });

  it("rejects out-of-range or fractional scores", () => {
    expect(() => classifyLeadScore(-1)).toThrow(RangeError);
    expect(() => classifyLeadScore(101)).toThrow(RangeError);
    expect(() => classifyLeadScore(20.5)).toThrow(RangeError);
  });
});

describe("promotedStatus", () => {
  it("promotes temperature statuses upward only", () => {
    expect(promotedStatus("new", "warm")).toBe("warm");
    expect(promotedStatus("warm", "very_hot")).toBe("very_hot");
    expect(promotedStatus("qualified", "hot")).toBe("hot");
    expect(promotedStatus("hot", "warm")).toBe("hot");
    expect(promotedStatus("new", "cold")).toBe("new");
  });

  it("never overrides workflow or terminal statuses", () => {
    for (const status of ["waiting_customer", "human_followup", "won", "lost", "do_not_contact"] as const) {
      expect(promotedStatus(status, "very_hot")).toBe(status);
    }
  });
});
