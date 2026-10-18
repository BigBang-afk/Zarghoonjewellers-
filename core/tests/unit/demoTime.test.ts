import { describe, expect, it } from "vitest";
import { laterToday } from "../../src/demo/dashboardDemo.js";

const karachiDate = (d: Date) => new Date(d.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);

describe("demo seed time of day", () => {
  it("'later today' stays on the same Karachi day, even late at night", () => {
    for (const iso of ["2026-10-18T04:00:00Z", "2026-10-18T17:20:00Z", "2026-10-18T18:58:00Z"]) {
      const now = new Date(iso);
      const t = laterToday(now);
      expect(t.getTime()).toBeGreaterThan(now.getTime());
      expect(karachiDate(t)).toBe(karachiDate(now));
    }
  });
});
