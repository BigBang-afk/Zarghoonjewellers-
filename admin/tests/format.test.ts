import { describe, expect, it } from "vitest";
import { defaultFollowupLocal, formatMoney, formatWeight, utcToZonedLocal, zonedLocalToUtc } from "@/lib/format";

describe("money and weight formatting (string-only, no floats)", () => {
  it("formats exact decimal strings", () => {
    expect(formatMoney("485000.00")).toBe("PKR 485,000");
    expect(formatMoney("1234.5")).toBe("PKR 1,234.50");
    expect(formatMoney("98000.00", "PKR")).toBe("PKR 98,000");
    expect(formatMoney("12345678901234.99")).toBe("PKR 12,345,678,901,234.99"); // beyond float precision, still exact
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney("abc")).toBeNull();
  });
  it("formats weights", () => {
    expect(formatWeight("48.250")).toBe("48.25 g");
    expect(formatWeight("11.000")).toBe("11 g");
    expect(formatWeight(null)).toBeNull();
  });
});

describe("business time zone (Asia/Karachi, UTC+5)", () => {
  it("converts datetime-local values both ways", () => {
    expect(zonedLocalToUtc("2026-10-19T15:30")!.toISOString()).toBe("2026-10-19T10:30:00.000Z");
    expect(utcToZonedLocal(new Date("2026-10-19T10:30:00Z"))).toBe("2026-10-19T15:30");
    expect(zonedLocalToUtc("tomorrow")).toBeNull();
  });
  it("defaults new follow-ups to tomorrow 11:00", () => {
    expect(defaultFollowupLocal(new Date("2026-10-18T20:00:00Z"))).toBe("2026-10-20T11:00"); // already the 19th in Karachi
  });
});
