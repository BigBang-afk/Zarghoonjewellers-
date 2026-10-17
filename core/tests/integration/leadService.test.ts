import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ActiveLeadExistsError,
  CustomerNotFoundError,
  DoNotContactError,
  DuplicateLeadSignalError,
  ForbiddenActionError,
  InvalidStateError,
  StaffUnavailableError,
  ValidationError,
} from "../../src/lib/errors.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";
import { auditTypes, createCore, type TestCore } from "../helpers/core.js";
import { AI_CTX, insertStaff, staffCtx, SYSTEM_CTX } from "../helpers/fixtures.js";

let t: TestDatabase;
let core: TestCore;
let customerId: string;
let staffId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  core = createCore(t.db);
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  staffId = await insertStaff(t.db, { role: "sales" });
  customerId = (await core.customers.createCustomer({ phone: "03001234567" }, AI_CTX)).customer.id;
});

describe("createLead", () => {
  it("creates a new cold lead", async () => {
    const lead = await core.leads.createLead({ customerId, sourceChannel: "website" }, AI_CTX);
    expect(lead).toMatchObject({ status: "new", score: 0, scoreClassification: "cold", budgetAmount: null });
  });

  it("records provided_budget deterministically when a budget is given", async () => {
    const lead = await core.leads.createLead({ customerId, budgetAmount: "500000" }, AI_CTX);
    expect(lead).toMatchObject({ budgetAmount: "500000.00", budgetCurrency: "PKR", score: 15, scoreClassification: "cold" });
  });

  it("allows only one active lead per customer", async () => {
    const first = await core.leads.createLead({ customerId }, AI_CTX);
    const err = await core.leads.createLead({ customerId }, AI_CTX).catch((e) => e);
    expect(err).toBeInstanceOf(ActiveLeadExistsError);
    expect(err.activeLeadId).toBe(first.id);
  });

  it("rejects unknown customers, do-not-contact customers and invalid input", async () => {
    await expect(core.leads.createLead({ customerId: "00000000-0000-0000-0000-000000000000" }, AI_CTX)).rejects.toBeInstanceOf(
      CustomerNotFoundError,
    );
    await expect(core.leads.createLead({ customerId, budgetAmount: "-5" }, AI_CTX)).rejects.toBeInstanceOf(ValidationError);
    await expect(core.leads.createLead({ customerId, score: 90 } as never, AI_CTX)).rejects.toBeInstanceOf(ValidationError);
    await core.customers.setDoNotContact(customerId, AI_CTX);
    await expect(core.leads.createLead({ customerId }, AI_CTX)).rejects.toBeInstanceOf(DoNotContactError);
  });

  it("never lets automation assign unavailable staff", async () => {
    const away = await insertStaff(t.db, { isAvailable: false });
    await expect(core.leads.createLead({ customerId, assignedStaffId: away }, AI_CTX)).rejects.toBeInstanceOf(StaffUnavailableError);
    // A staff member may deliberately assign an unavailable colleague.
    const lead = await core.leads.createLead({ customerId, assignedStaffId: away }, staffCtx(staffId));
    expect(lead.assignedStaffId).toBe(away);
  });
});

describe("recordLeadSignal", () => {
  it("scores deterministically, promotes status and returns the audit breakdown", async () => {
    const lead = await core.leads.createLead({ customerId }, AI_CTX);
    expect((await core.leads.recordLeadSignal(lead.id, { signal: "asked_price" }, AI_CTX)).statusChanged).toBe(false);
    // 10 + 15 = 25 → warm: status is promoted from new.
    const second = await core.leads.recordLeadSignal(lead.id, { signal: "provided_budget" }, AI_CTX);
    expect(second).toMatchObject({ statusChanged: true, lead: { status: "warm" } });
    const res = await core.leads.recordLeadSignal(lead.id, { signal: "asked_availability", evidence: "Is it in stock?" }, AI_CTX);
    expect(res.score).toEqual({
      score: 40,
      classification: "warm",
      uncappedScore: 40,
      breakdown: [
        { signal: "asked_price", points: 10 },
        { signal: "provided_budget", points: 15 },
        { signal: "asked_availability", points: 15 },
      ],
    });
    expect(res.lead).toMatchObject({ score: 40, scoreClassification: "warm", status: "warm" });
    expect(res.statusChanged).toBe(false);
    const events = await t.db.query<{ signal: string; points: number; recorded_by_type: string }>(
      `select signal, points, recorded_by_type from lead_signal_events where lead_id = $1 order by created_at`,
      [lead.id],
    );
    expect(events).toHaveLength(3);
    expect(events[2]).toEqual({ signal: "asked_availability", points: 15, recorded_by_type: "ai" });
  });

  it("prevents duplicate scoring of the same signal", async () => {
    const lead = await core.leads.createLead({ customerId }, AI_CTX);
    await core.leads.recordLeadSignal(lead.id, { signal: "asked_price" }, AI_CTX);
    await expect(core.leads.recordLeadSignal(lead.id, { signal: "asked_price" }, AI_CTX)).rejects.toBeInstanceOf(
      DuplicateLeadSignalError,
    );
    expect((await core.leads.getLeadById(lead.id)).score).toBe(10);
  });

  it("caps the score at 100 and classifies very_hot", async () => {
    const lead = await core.leads.createLead({ customerId }, AI_CTX);
    for (const signal of [
      "asked_price", "provided_budget", "specific_product_interest", "asked_availability", "provided_contact",
      "asked_shop_location", "asked_about_visit", "asked_about_payment_or_order",
    ] as const) {
      await core.leads.recordLeadSignal(lead.id, { signal }, AI_CTX);
    }
    const updated = await core.leads.getLeadById(lead.id);
    expect(updated).toMatchObject({ score: 100, scoreClassification: "very_hot", status: "very_hot" });
  });

  it("rejects unknown signals and signals on closed leads", async () => {
    const lead = await core.leads.createLead({ customerId }, AI_CTX);
    await expect(core.leads.recordLeadSignal(lead.id, { signal: "loves_gold" } as never, AI_CTX)).rejects.toBeInstanceOf(ValidationError);
    await core.leads.markLeadLost(lead.id, "Bought elsewhere", staffCtx(staffId));
    await expect(core.leads.recordLeadSignal(lead.id, { signal: "asked_price" }, AI_CTX)).rejects.toBeInstanceOf(InvalidStateError);
  });

  it("does not let scoring override a workflow status", async () => {
    const lead = await core.leads.createLead({ customerId }, AI_CTX);
    await core.leads.updateLead(lead.id, { status: "waiting_customer" }, AI_CTX);
    const res = await core.leads.recordLeadSignal(lead.id, { signal: "asked_about_visit" }, AI_CTX);
    expect(res.lead.status).toBe("waiting_customer");
  });
});

describe("updateLead", () => {
  it("restricts which statuses the AI can set", async () => {
    const lead = await core.leads.createLead({ customerId }, AI_CTX);
    await expect(core.leads.updateLead(lead.id, { status: "very_hot" }, AI_CTX)).rejects.toBeInstanceOf(ForbiddenActionError);
    await expect(core.leads.updateLead(lead.id, { status: "won" } as never, staffCtx(staffId))).rejects.toBeInstanceOf(ValidationError);
    expect((await core.leads.updateLead(lead.id, { status: "qualified" }, staffCtx(staffId))).status).toBe("qualified");
  });

  it("records provided_budget once when a budget is added later", async () => {
    const lead = await core.leads.createLead({ customerId }, AI_CTX);
    const updated = await core.leads.updateLead(lead.id, { budgetAmount: "250000" }, AI_CTX);
    expect(updated).toMatchObject({ budgetAmount: "250000.00", budgetCurrency: "PKR", score: 15 });
    expect((await core.leads.updateLead(lead.id, { budgetAmount: "300000" }, AI_CTX)).score).toBe(15);
  });
});

describe("closing leads", () => {
  it("only staff/system can mark won or lost, and pending sales follow-ups are cancelled", async () => {
    const lead = await core.leads.createLead({ customerId }, AI_CTX);
    const inAWeek = new Date(Date.now() + 7 * 86_400_000);
    const sales = await core.followups.scheduleFollowup({ customerId, leadId: lead.id, scheduledFor: inAWeek }, AI_CTX);
    const afterSales = await core.followups.scheduleFollowup(
      { customerId, leadId: lead.id, followupType: "after_sales", scheduledFor: inAWeek },
      AI_CTX,
    );

    await expect(core.leads.markLeadWon(lead.id, AI_CTX)).rejects.toBeInstanceOf(ForbiddenActionError);
    const won = await core.leads.markLeadWon(lead.id, staffCtx(staffId));
    expect(won.status).toBe("won");
    expect(won.wonAt).toBeInstanceOf(Date);
    expect((await core.followups.getFollowup(sales.id)).status).toBe("cancelled");
    expect((await core.followups.getFollowup(afterSales.id)).status).toBe("pending");
    await expect(core.leads.markLeadLost(lead.id, "x", SYSTEM_CTX)).rejects.toBeInstanceOf(InvalidStateError);
    expect(await auditTypes(t.db, { customerId })).toContain("lead_won");
  });

  it("requires a reason to mark lost", async () => {
    const lead = await core.leads.createLead({ customerId }, AI_CTX);
    await expect(core.leads.markLeadLost(lead.id, "  ", staffCtx(staffId))).rejects.toBeInstanceOf(ValidationError);
    expect((await core.leads.markLeadLost(lead.id, "Budget too low", SYSTEM_CTX)).lostReason).toBe("Budget too low");
    // A new lead can now be opened.
    expect((await core.leads.createLead({ customerId }, AI_CTX)).status).toBe("new");
  });

  it("do-not-contact closes the lead, flags the customer and cancels every follow-up", async () => {
    const lead = await core.leads.createLead({ customerId }, AI_CTX);
    const f = await core.followups.scheduleFollowup(
      { customerId, leadId: lead.id, followupType: "service", scheduledFor: new Date(Date.now() + 86_400_000) },
      AI_CTX,
    );
    const res = await core.leads.markLeadDoNotContact(lead.id, AI_CTX, "Asked us to stop");
    expect(res).toEqual({ closedLeadIds: [lead.id], cancelledFollowups: 1 });
    expect((await core.leads.getLeadById(lead.id)).status).toBe("do_not_contact");
    expect((await core.customers.getCustomer(customerId)).doNotContact).toBe(true);
    expect((await core.followups.getFollowup(f.id)).status).toBe("cancelled");
  });
});

describe("lead queries", () => {
  it("lists hot leads and leads needing follow-up", async () => {
    const cold = await core.leads.createLead({ customerId }, AI_CTX);
    const c2 = (await core.customers.createCustomer({ phone: "03007654321" }, AI_CTX)).customer.id;
    const hot = await core.leads.createLead({ customerId: c2 }, AI_CTX);
    for (const signal of ["asked_about_visit", "asked_about_payment_or_order", "asked_availability"] as const) {
      await core.leads.recordLeadSignal(hot.id, { signal }, AI_CTX);
    }
    expect((await core.leads.getHotLeads()).map((l) => l.id)).toEqual([hot.id]);
    expect((await core.leads.getLeadsNeedingFollowup()).map((l) => l.id)).toEqual([hot.id]);

    await core.followups.scheduleFollowup({ customerId: c2, leadId: hot.id, scheduledFor: new Date(Date.now() + 3_600_000) }, AI_CTX);
    expect(await core.leads.getLeadsNeedingFollowup()).toEqual([]);
    expect(cold.score).toBe(0);
  });

  it("recomputes the score from the signal audit trail", async () => {
    const lead = await core.leads.createLead({ customerId }, AI_CTX);
    await core.leads.recordLeadSignal(lead.id, { signal: "provided_contact" }, AI_CTX);
    expect(await core.leads.getLeadScore(lead.id)).toMatchObject({ score: 10, breakdown: [{ signal: "provided_contact", points: 10 }] });
    expect((await core.leads.getCustomerLeads(customerId)).map((l) => l.id)).toEqual([lead.id]);
  });
});
