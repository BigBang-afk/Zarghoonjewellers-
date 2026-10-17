import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CustomerNotFoundError,
  DuplicateFollowupError,
  FollowupNotAllowedError,
  StaffUnavailableError,
  ValidationError,
} from "../../src/lib/errors.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { createCore, type TestCore } from "../helpers/core.js";
import { AI_CTX, insertStaff, staffCtx } from "../helpers/fixtures.js";

const NOW = new Date("2026-10-17T10:00:00Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

let t: TestDatabase;
let core: TestCore;
let customerId: string;
let staffId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  core = createCore(t.db, () => NOW);
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  staffId = await insertStaff(t.db, { role: "sales" });
  customerId = (await core.customers.createCustomer({ phone: "03001234567" }, AI_CTX)).customer.id;
});

const notAllowedReason = (p: Promise<unknown>) => p.then(() => null, (e) => (e instanceof FollowupNotAllowedError ? e.reason : e));

describe("scheduleFollowup", () => {
  it("schedules a pending follow-up without sending anything", async () => {
    const f = await core.followups.scheduleFollowup(
      { customerId, scheduledFor: inHours(24).toISOString(), messageDraft: "Salam! Necklace set abhi available hai.", channel: "whatsapp" },
      AI_CTX,
    );
    expect(f).toMatchObject({ status: "pending", followupType: "sales", createdByType: "ai", channel: "whatsapp" });
    expect(f.scheduledFor).toEqual(inHours(24));
    const n = (await t.db.query<{ n: number }>(`select count(*)::int as n from messages`))[0]!.n;
    expect(n).toBe(0);
  });

  it("rejects past/now and far-future dates", async () => {
    expect(await notAllowedReason(core.followups.scheduleFollowup({ customerId, scheduledFor: inHours(-1) }, AI_CTX))).toBe("scheduled_in_past");
    expect(await notAllowedReason(core.followups.scheduleFollowup({ customerId, scheduledFor: NOW }, AI_CTX))).toBe("scheduled_in_past");
    expect(await notAllowedReason(core.followups.scheduleFollowup({ customerId, scheduledFor: inHours(24 * 400) }, AI_CTX))).toBe(
      "scheduled_too_far_ahead",
    );
    await expect(core.followups.scheduleFollowup({ customerId, scheduledFor: "tomorrow" } as never, AI_CTX)).rejects.toBeInstanceOf(
      ValidationError,
    );
    // Timestamps without an explicit offset are ambiguous and rejected.
    await expect(core.followups.scheduleFollowup({ customerId, scheduledFor: "2026-10-20T10:00:00" } as never, AI_CTX)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("prevents duplicate pending follow-ups of the same type", async () => {
    const first = await core.followups.scheduleFollowup({ customerId, scheduledFor: inHours(2) }, AI_CTX);
    const err = await core.followups.scheduleFollowup({ customerId, scheduledFor: inHours(48) }, AI_CTX).catch((e) => e);
    expect(err).toBeInstanceOf(DuplicateFollowupError);
    expect(err.existingFollowupId).toBe(first.id);
    // A different type is fine, and once completed a new one can be scheduled.
    await core.followups.scheduleFollowup({ customerId, followupType: "service", scheduledFor: inHours(2) }, AI_CTX);
    await core.followups.completeFollowup(first.id, staffCtx(staffId), "Customer will visit Saturday");
    await core.followups.scheduleFollowup({ customerId, scheduledFor: inHours(72) }, AI_CTX);
  });

  it("blocks follow-ups for do-not-contact customers", async () => {
    await core.customers.setDoNotContact(customerId, AI_CTX);
    expect(await notAllowedReason(core.followups.scheduleFollowup({ customerId, scheduledFor: inHours(2) }, AI_CTX))).toBe("do_not_contact");
    expect(
      await notAllowedReason(core.followups.scheduleFollowup({ customerId, followupType: "service", scheduledFor: inHours(2) }, staffCtx(staffId))),
    ).toBe("do_not_contact");
  });

  it("blocks sales follow-ups on won/lost leads but allows after-sales", async () => {
    const lead = await core.leads.createLead({ customerId }, AI_CTX);
    await core.leads.markLeadWon(lead.id, staffCtx(staffId));
    expect(await notAllowedReason(core.followups.scheduleFollowup({ customerId, leadId: lead.id, scheduledFor: inHours(2) }, AI_CTX))).toBe(
      "lead_closed",
    );
    const after = await core.followups.scheduleFollowup(
      { customerId, leadId: lead.id, followupType: "after_sales", scheduledFor: inHours(2) },
      AI_CTX,
    );
    expect(after.status).toBe("pending");
  });

  it("validates customer and assigned staff", async () => {
    await expect(
      core.followups.scheduleFollowup({ customerId: "00000000-0000-0000-0000-000000000000", scheduledFor: inHours(2) }, AI_CTX),
    ).rejects.toBeInstanceOf(CustomerNotFoundError);
    const away = await insertStaff(t.db, { isAvailable: false });
    await expect(
      core.followups.scheduleFollowup({ customerId, assignedStaffId: away, scheduledFor: inHours(2) }, AI_CTX),
    ).rejects.toBeInstanceOf(StaffUnavailableError);
  });
});

describe("follow-up lifecycle and queries", () => {
  it("completes, cancels and skips only pending follow-ups", async () => {
    const a = await core.followups.scheduleFollowup({ customerId, scheduledFor: inHours(1) }, AI_CTX);
    const done = await core.followups.completeFollowup(a.id, staffCtx(staffId), "Called, interested");
    expect(done).toMatchObject({ status: "completed", outcomeNote: "Called, interested" });
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(await notAllowedReason(core.followups.cancelFollowup(a.id, AI_CTX))).toBe("not_pending");

    const b = await core.followups.scheduleFollowup({ customerId, followupType: "service", scheduledFor: inHours(1) }, AI_CTX);
    expect((await core.followups.cancelFollowup(b.id, AI_CTX, "Customer replied")).status).toBe("cancelled");
    const c = await core.followups.scheduleFollowup({ customerId, followupType: "other", scheduledFor: inHours(1) }, AI_CTX);
    expect((await core.followups.skipFollowup(c.id, staffCtx(staffId))).status).toBe("skipped");
  });

  it("lists pending follow-ups by due time and staff", async () => {
    const c2 = (await core.customers.createCustomer({ phone: "03007654321" }, AI_CTX)).customer.id;
    const late = await core.followups.scheduleFollowup({ customerId, scheduledFor: inHours(48) }, AI_CTX);
    const soon = await core.followups.scheduleFollowup({ customerId: c2, scheduledFor: inHours(1), assignedStaffId: staffId }, AI_CTX);
    expect((await core.followups.getPendingFollowups()).map((f) => f.id)).toEqual([soon.id, late.id]);
    expect((await core.followups.getPendingFollowups({ dueBefore: inHours(2) })).map((f) => f.id)).toEqual([soon.id]);
    expect((await core.followups.getPendingFollowups({ assignedStaffId: staffId })).map((f) => f.id)).toEqual([soon.id]);
    expect((await core.followups.getCustomerFollowups(customerId, { status: "pending" })).map((f) => f.id)).toEqual([late.id]);
  });
});
