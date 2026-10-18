import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDashboardRuntime } from "../../src/dashboard/runtime.js";
import { createDashboardActions } from "../../src/services/dashboard/dashboardActions.js";
import { createFollowupCenter } from "../../src/services/dashboard/followupCenter.js";
import { findStaff, type StaffSummary } from "../../src/services/staffRules.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { insertStaff } from "../helpers/fixtures.js";
import { at, createWorld, key, NOON_PKT, type FollowupWorld } from "../helpers/followupFixtures.js";

let t: TestDatabase;
let w: FollowupWorld;
const v: Record<string, StaffSummary> = {};
const actions = (hours = 0) => createDashboardActions(t.db, { clock: () => at(hours) });
const center = (hours = 0) => createFollowupCenter(t.db, { clock: () => at(hours) });

beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  w = await createWorld(t.db);
  for (const [k, id] of Object.entries({ manager: w.manager, ali: w.ali, sara: w.sara })) v[k] = (await findStaff(t.db, id))!;
});

describe("23. Follow-up Center authorization and data isolation", () => {
  it("sales see only their customers' follow-ups; actions on others are 'not found'", async () => {
    const { followup } = await actions().scheduleSmartFollowup(v.ali!, { customerId: w.customer, purpose: "bridal", delayDays: 1, idempotencyKey: key() });
    expect((await center().list(v.ali!, "history")).total).toBe(1);
    expect((await center().list(v.sara!, "history")).total).toBe(0);
    expect((await center().list(v.manager!, "history")).total).toBe(1);
    await expect(center().detail(v.sara!, followup.id)).rejects.toMatchObject({ code: "FOLLOWUP_NOT_FOUND" });
    await expect(actions().generateDraft(v.sara!, followup.id, key())).rejects.toMatchObject({ code: "FOLLOWUP_NOT_FOUND" });
    await expect(actions().scheduleSmartFollowup(v.sara!, { customerId: w.customer, purpose: "bridal", delayDays: 2, idempotencyKey: key() })).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
    await expect(actions().setContactConsent(v.sara!, w.customer, "denied", "nope nope")).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });

    const draft = await actions(25).generateDraft(v.ali!, followup.id, key());
    await expect(actions().approveDraft(v.sara!, draft.id)).rejects.toMatchObject({ code: "FOLLOWUP_NOT_FOUND" });
    await expect(actions().approveDraft(v.manager!, draft.id)).resolves.toMatchObject({ status: "approved" });
  });

  it("only managers assign colleagues, run the worker or change settings", async () => {
    await expect(
      actions().scheduleSmartFollowup(v.ali!, { customerId: w.customer, purpose: "bridal", delayDays: 1, assignedStaffId: w.sara, idempotencyKey: key() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN_ACTION" });
    await expect(actions().runFollowupWorker(v.ali!)).rejects.toMatchObject({ code: "FORBIDDEN_ACTION" });
    await expect(actions().updateFollowupSettings(v.manager!, { quietHoursEnabled: false })).rejects.toMatchObject({ code: "FORBIDDEN_ACTION" });
    await expect(actions(25).runFollowupWorker(v.manager!)).resolves.toMatchObject({ claimed: 0 });
    const owner = (await findStaff(t.db, await insertStaff(t.db, { fullName: "TEST Owner", role: "owner" })))!;
    await expect(actions().updateFollowupSettings(owner, { quietHoursEnd: "09:30" })).resolves.toMatchObject({ quietHours: { end: "09:30" } });
  });

  it("deactivated staff cannot act", async () => {
    const { followup } = await actions().scheduleSmartFollowup(v.ali!, { customerId: w.customer, purpose: "bridal", delayDays: 1, idempotencyKey: key() });
    await t.db.query(`update staff set is_active = false where id = $1`, [w.ali]);
    await expect(actions(25).generateDraft(v.ali!, followup.id, key())).rejects.toMatchObject({ code: "FORBIDDEN_ACTION" });
  });

  it("notifications go to the responsible staff member and the manager queue only", async () => {
    await actions().scheduleSmartFollowup(v.manager!, { customerId: w.customer, purpose: "bridal", priority: "high", delayDays: 1, assignedStaffId: w.ali, idempotencyKey: key() });
    await actions().scheduleSmartFollowup(v.manager!, { customerId: w.customer, purpose: "staff_callback", priority: "urgent", delayDays: 1, idempotencyKey: key() });
    const ali = await center().notifications(v.ali!);
    expect(ali.map((n) => n.kind)).toEqual(["high_priority_followup"]);
    expect(await center().notifications(v.sara!)).toEqual([]);
    // The callback was scheduled by the manager without an assignee, so it is theirs; Ali's stays with Ali.
    expect((await center().notifications(v.manager!)).map((n) => n.title)).toEqual(["Urgent follow-up: Staff callback reminder"]);
    expect(await center().unreadCount(v.ali!)).toBe(1);
    expect(await center().markRead(v.sara!, [ali[0]!.id])).toBe(0); // not Sara's
    expect(await center().markRead(v.ali!, [ali[0]!.id])).toBe(1);
    expect(await center().unreadCount(v.ali!)).toBe(0);
  });
});

describe("Follow-up Center views and analytics", () => {
  it("tabs, draft preview, detail with eligibility and audit; analytics never invent delivery or conversion", async () => {
    const { followup } = await actions().scheduleSmartFollowup(v.ali!, { customerId: w.customer, purpose: "bridal", delayDays: 1, idempotencyKey: key() });
    expect((await center().list(v.ali!, "upcoming")).total).toBe(1);
    await actions(25).generateDraft(v.ali!, followup.id, key());
    const review = await center(25).list(v.ali!, "review");
    expect(review.rows[0]).toMatchObject({ purpose: "bridal", productSku: "TEST-NK-001", leadScore: 25, draft: { status: "pending_review", authorType: "template" } });
    const d = await center(25).detail(v.ali!, followup.id);
    expect(d.eligibility.allowed).toBe(true);
    expect(d.drafts).toHaveLength(1);
    expect(d.audit.map((a) => a.actionType)).toEqual(expect.arrayContaining(["followup_engine_scheduled", "followup_draft_generated"]));
    const a = await center(25).analytics(v.manager!);
    expect(a.followups).toMatchObject({ scheduled: 1, pending: 1, completed: 0 });
    expect(a.drafts).toMatchObject({ created: 1, awaiting_review: 1, approved: 0 });
    expect(a.delivered.value).toBeNull();
    expect(a.averageResponseTime.value).toBeNull();
    expect(a.conversion.value).toBeNull();
    expect((await center(25).recommendations(v.ali!)).some((r) => r.customerId === w.customer)).toBe(true);
    expect(await center(25).recommendations(v.sara!)).toEqual([]);
  });

  it("request human takeover from the follow-up center", async () => {
    await actions().requestHumanTakeover(v.ali!, w.customer, "Customer prefers a call");
    const conv = (await t.db.query<{ human_takeover: boolean }>(`select human_takeover from conversations where id = $1`, [w.conversation]))[0]!;
    expect(conv.human_takeover).toBe(true);
    await expect(actions().requestHumanTakeover(v.sara!, w.customer)).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
  });
});

describe("24. demo mode isolation", () => {
  it("demo never touches a configured database URL and uses the offline writer without a key", async () => {
    const rt = await createDashboardRuntime({
      ZARGHOON_DASHBOARD_MODE: "demo",
      ZARGHOON_DEMO_PASSWORD: "a-long-demo-pass-1",
      ZARGHOON_CORE_DATABASE_URL: "postgresql://nobody:pw@127.0.0.1:1/should-never-be-used",
    });
    try {
      expect(rt.environmentLabel).toBe("demo");
      expect(rt.drafter).toEqual({ kind: "template", model: "offline-template" });
      const names = (await rt.db.query<{ full_name: string | null }>(`select full_name from customers`)).map((r) => r.full_name).filter(Boolean);
      expect(names.every((n) => n!.startsWith("DEMO "))).toBe(true);
      expect((await rt.db.query(`select 1 from followup_drafts`)).length).toBeGreaterThan(0);
    } finally {
      await rt.close();
    }
    expect(NOON_PKT).toBeInstanceOf(Date);
  }, 60_000);
});
