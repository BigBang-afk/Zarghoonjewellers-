import { describe, expect, it } from "vitest";
import { decimalEquals, moneySchema, sumMoney, weightGramsSchema } from "../../src/lib/money.js";

describe("moneySchema", () => {
  const schema = moneySchema("price");

  it("normalizes valid amounts to fixed 2-dp strings", () => {
    expect(schema.parse("485000")).toBe("485000.00");
    expect(schema.parse("1,250,000.5")).toBe("1250000.50");
    expect(schema.parse(0)).toBe("0.00");
    expect(schema.parse(150000)).toBe("150000.00");
  });

  it("rejects negative, malformed and over-precise amounts instead of rounding", () => {
    expect(schema.safeParse("-1").success).toBe(false);
    expect(schema.safeParse("12abc").success).toBe(false);
    expect(schema.safeParse("10.005").success).toBe(false);
    expect(schema.safeParse("1e5").success).toBe(false);
  });

  it("rejects fractional JS numbers, which may already have lost precision", () => {
    expect(schema.safeParse(0.1).success).toBe(false);
  });

  it("rejects values too large for NUMERIC(14,2)", () => {
    expect(schema.safeParse("1000000000000").success).toBe(false);
    expect(schema.safeParse("999999999999.99").success).toBe(true);
  });
});

describe("weightGramsSchema", () => {
  it("accepts up to 3 decimal places and requires > 0", () => {
    expect(weightGramsSchema().parse("11.664")).toBe("11.664");
    expect(weightGramsSchema().safeParse("0").success).toBe(false);
    expect(weightGramsSchema().safeParse("1.2345").success).toBe(false);
  });
});

describe("decimal arithmetic", () => {
  it("sums exactly where floating point would not", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");
    expect(sumMoney(["999999999999.99", "0.01"])).toBe("1000000000000.00");
  });

  it("compares decimal strings by value", () => {
    expect(decimalEquals("100", "100.00")).toBe(true);
    expect(decimalEquals("100.01", "100.00")).toBe(false);
    expect(decimalEquals(null, null)).toBe(true);
    expect(decimalEquals(null, "0")).toBe(false);
  });
});
