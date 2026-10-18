import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedDashboardDemo, type DashboardDemoResult } from "../../src/demo/dashboardDemo.js";
import { createDashboardActions } from "../../src/services/dashboard/dashboardActions.js";
import { createDashboardService } from "../../src/services/dashboard/dashboardService.js";
import { findStaff, type StaffSummary } from "../../src/services/staffRules.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { createCore } from "../helpers/core.js";
import { AI_CTX } from "../helpers/fixtures.js";

let t: TestDatabase;
let demo: DashboardDemoResult;
const v: Record<string, StaffSummary> = {};
const actions = () => createDashboardActions(t.db);
const read = () => createDashboardService(t.db);
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  demo = await seedDashboardDemo(t.db, { password: "demo-password-123", followupEngine: false });
  for (const [k, id] of Object.entries(demo.staff)) v[k] = (await findStaff(t.db, id))!;
}, 120_000);

describe("lead actions", () => {
  it("notes are appended with author and time, only within scope", async () => {
    const lead = await actions().addLeadNote(v.ali!, demo.leads.ayesha, "Called — visiting Saturday");
    expect(lead.notes).toMatch(/\[\d{4}-\d\d-\d\d \d\d:\d\d UTC · DEMO Salesperson Ali\] Called — visiting Saturday$/);
    await actions().addLeadNote(v.ali!, demo.leads.ayesha, "Second note");
    expect((await read().getLeadDetail(v.ali!, demo.leads.ayesha!)).lead.notes!.split("\n")).toHaveLength(2);
    await expect(actions().addLeadNote(v.ali!, demo.leads.bilal, "not mine")).rejects.toMatchObject({ code: "LEAD_NOT_FOUND" });
    await expect(actions().addLeadNote(v.ali!, demo.leads.ayesha, "   ")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("only managers assign leads; assignment changes who can see the customer", async () => {
    await expect(actions().assignLead(v.ali!, demo.leads.ayesha, demo.staff.sara)).rejects.toMatchObject({ code: "FORBIDDEN_ACTION" });
    await expect(read().getCustomerDetail(v.ali!, demo.customers.bilal!)).rejects.toThrow();
    await actions().assignLead(v.manager!, demo.leads.bilal, demo.staff.ali);
    await expect(read().getCustomerDetail(v.ali!, demo.customers.bilal!)).resolves.toBeTruthy();
  });

  it("won/lost follow the existing rules (reason required, closed leads stay closed)", async () => {
    await expect(actions().markLeadLost(v.ali!, demo.leads.ayesha, "")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await actions().markLeadWon(v.ali!, demo.leads.ayesha, "Bought DEMO-NK-001");
    await expect(actions().markLeadWon(v.ali!, demo.leads.ayesha)).rejects.toMatchObject({ code: "INVALID_STATE" });
    // Closing a lead cancels its pending sales follow-ups.
    expect((await read().getCustomerDetail(v.ali!, demo.customers.ayesha!)).pendingFollowups).toHaveLength(0);
    await expect(actions().markLeadLost(v.sara!, demo.leads.usman, "not mine")).rejects.toMatchObject({ code: "LEAD_NOT_FOUND" });
  });
});

describe("follow-up actions", () => {
  it("schedules for yourself; only managers assign colleagues; existing rules apply", async () => {
    const f = await actions().scheduleFollowup(v.ali!, { customerId: demo.customers.usman, followupType: "service", scheduledFor: inHours(5), note: "Resize ring" });
    expect(f.assignedStaffId).toBe(demo.staff.ali);
    await expect(
      actions().scheduleFollowup(v.ali!, { customerId: demo.customers.usman, followupType: "other", scheduledFor: inHours(5), assignedStaffId: demo.staff.sara }),
    ).rejects.toMatchObject({ code: "FORBIDDEN_ACTION" });
    await expect(actions().scheduleFollowup(v.ali!, { customerId: demo.customers.bilal, scheduledFor: inHours(5) })).rejects.toMatchObject({
      code: "CUSTOMER_NOT_FOUND",
    });
    // Do-not-contact, closed leads and past dates are refused by the follow-up service.
    await expect(actions().scheduleFollowup(v.ali!, { customerId: demo.customers.sana, scheduledFor: inHours(5) })).rejects.toMatchObject({
      code: "FOLLOWUP_NOT_ALLOWED",
    });
    await expect(
      actions().scheduleFollowup(v.manager!, { customerId: demo.customers.zain, leadId: demo.leads.zain, scheduledFor: inHours(5) }),
    ).rejects.toMatchObject({ code: "FOLLOWUP_NOT_ALLOWED" });
    await expect(actions().scheduleFollowup(v.ali!, { customerId: demo.customers.usman, followupType: "other", scheduledFor: inHours(-1) })).rejects.toMatchObject({
      code: "FOLLOWUP_NOT_ALLOWED",
    });
    await expect(actions().scheduleFollowup(v.ali!, { customerId: demo.customers.usman, scheduledFor: inHours(5), extra: 1 })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("complete and cancel, within scope, once", async () => {
    const today = (await read().listFollowups(v.ali!, "today")).rows[0]!;
    await expect(actions().completeFollowup(v.sara!, today.id)).rejects.toMatchObject({ code: "FOLLOWUP_NOT_FOUND" });
    await actions().completeFollowup(v.ali!, today.id, "Visit confirmed");
    await expect(actions().cancelFollowup(v.ali!, today.id)).rejects.toMatchObject({ code: "FOLLOWUP_NOT_ALLOWED" });
    const overdue = (await read().listFollowups(v.sara!, "overdue")).rows[0]!;
    await actions().cancelFollowup(v.sara!, overdue.id, "Customer travelling");
    expect((await read().listFollowups(v.sara!, "cancelled")).rows.map((r) => r.id)).toContain(overdue.id);
  });
});

describe("human handoff", () => {
  it("takeover assigns the handoff, conversation and lead; resolving can hand back to the AI", async () => {
    const handoff = (await read().listHandoffs(v.ali!, "open")).find((h) => h.reason === "discount_request")!;
    await actions().takeOverHandoff(v.ali!, handoff.id);
    const conv = await read().getConversation(v.ali!, handoff.conversationId);
    expect(conv.conversation).toMatchObject({ humanTakeover: true, assignedStaffId: demo.staff.ali });
    expect((await read().getLeadDetail(v.ali!, demo.leads.hina!)).lead.assignedStaffId).toBe(demo.staff.ali);

    // Sara can no longer see or take it.
    await expect(actions().takeOverHandoff(v.sara!, handoff.id)).rejects.toMatchObject({ code: "HANDOFF_NOT_FOUND" });

    // The AI can never release a takeover.
    await expect(createCore(t.db).conversations.setHumanTakeover(handoff.conversationId, { active: false }, AI_CTX)).rejects.toMatchObject({
      code: "FORBIDDEN_ACTION",
    });

    await actions().resolveHandoff(v.ali!, handoff.id, { releaseTakeover: true, note: "Manager will call about pricing" });
    expect((await read().getConversation(v.ali!, handoff.conversationId)).conversation.humanTakeover).toBe(false);
    await expect(actions().resolveHandoff(v.ali!, handoff.id, {})).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("resolving without release keeps the AI blocked", async () => {
    const handoff = (await read().listHandoffs(v.manager!, "open")).find((h) => h.reason === "customer_requested")!;
    await actions().takeOverHandoff(v.manager!, handoff.id);
    await expect(actions().resolveHandoff(v.ali!, handoff.id, {})).rejects.toThrow(); // not Ali's
    await actions().resolveHandoff(v.manager!, handoff.id, { releaseTakeover: false });
    expect((await read().getConversation(v.manager!, handoff.conversationId)).conversation.humanTakeover).toBe(true);
  });
});

describe("approvals", () => {
  it("only approver roles decide; a decision is final; the payload is untouched", async () => {
    const pending = (await read().listApprovals(v.owner!, "pending")).find((a) => a.actionType === "discount")!;
    await expect(actions().decideApproval(v.ali!, pending.id, "approved")).rejects.toMatchObject({ code: "FORBIDDEN_ACTION" });
    await expect(actions().decideApproval(v.support!, pending.id, "approved")).rejects.toMatchObject({ code: "FORBIDDEN_ACTION" });
    await expect(actions().decideApproval(v.owner!, pending.id, "maybe")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    const decided = await actions().decideApproval(v.owner!, pending.id, "rejected", "No discount on bridal sets");
    expect(decided).toMatchObject({ status: "rejected", decisionNote: "No discount on bridal sets", payload: pending.payload });
    await expect(actions().decideApproval(v.manager!, pending.id, "approved")).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("deactivated staff", () => {
  it("cannot act even with a stale viewer object", async () => {
    await t.db.query(`update staff set is_active = false where id = $1`, [demo.staff.ali]);
    await expect(actions().addLeadNote(v.ali!, demo.leads.ayesha, "hello")).rejects.toMatchObject({ code: "FORBIDDEN_ACTION" });
  });
});
