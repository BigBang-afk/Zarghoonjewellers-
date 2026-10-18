import { describe, expect, it } from "vitest";
import { isInQuietHours, nextAllowedTime, startOfBusinessDay, zonedParts, zonedTimeToUtc } from "../../src/lib/businessTime.js";

const KHI = "Asia/Karachi";
const q = { enabled: true, start: "21:00", end: "10:00", timezone: KHI };

describe("time zone handling (stored in UTC, interpreted in Asia/Karachi)", () => {
  it("converts business-local times to UTC and back", () => {
    expect(zonedTimeToUtc(2026, 10, 19, 15, 30, KHI).toISOString()).toBe("2026-10-19T10:30:00.000Z");
    expect(zonedParts(new Date("2026-10-19T19:30:00Z"), KHI)).toMatchObject({ day: 20, hour: 0, minute: 30 });
  });
  it("finds the business day boundary in Karachi, not UTC", () => {
    expect(startOfBusinessDay(new Date("2026-10-18T20:30:00Z"), KHI).toISOString()).toBe("2026-10-18T19:00:00.000Z");
  });
  it("works for a DST zone too", () => {
    // London is UTC+1 in summer: 09:00 local = 08:00Z.
    expect(zonedTimeToUtc(2026, 7, 1, 9, 0, "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
  });
});

describe("quiet hours", () => {
  it("detects the window across midnight", () => {
    expect(isInQuietHours(new Date("2026-10-19T17:00:00Z"), q)).toBe(true); // 22:00 PKT
    expect(isInQuietHours(new Date("2026-10-19T03:00:00Z"), q)).toBe(true); // 08:00 PKT
    expect(isInQuietHours(new Date("2026-10-19T07:00:00Z"), q)).toBe(false); // 12:00 PKT
  });
  it("moves a time out of quiet hours to the next opening (10:00 PKT)", () => {
    expect(nextAllowedTime(new Date("2026-10-19T17:00:00Z"), q).toISOString()).toBe("2026-10-20T05:00:00.000Z"); // 22:00 → next day 10:00
    expect(nextAllowedTime(new Date("2026-10-19T22:00:00Z"), q).toISOString()).toBe("2026-10-20T05:00:00.000Z"); // 03:00 → same day 10:00
    const noon = new Date("2026-10-19T07:00:00Z");
    expect(nextAllowedTime(noon, q)).toBe(noon);
    expect(nextAllowedTime(new Date("2026-10-19T17:00:00Z"), { ...q, enabled: false }).toISOString()).toBe("2026-10-19T17:00:00.000Z");
  });
  it("supports a same-day window", () => {
    const lunch = { ...q, start: "13:00", end: "14:00" };
    expect(nextAllowedTime(new Date("2026-10-19T08:30:00Z"), lunch).toISOString()).toBe("2026-10-19T09:00:00.000Z");
  });
});
