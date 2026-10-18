import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDashboardDemo, type DashboardDemoResult } from "../../src/demo/dashboardDemo.js";
import { createDashboardService } from "../../src/services/dashboard/dashboardService.js";
import { findStaff, type StaffSummary } from "../../src/services/staffRules.js";
import { createTestDatabase, type TestDatabase } from "../helpers/testDb.js";

/**
 * The dashboard read model over the demo seed (created through the real
 * services). Read-only tests share one seed; actions are tested separately.
 */

let t: TestDatabase;
let demo: DashboardDemoResult;
const v: Record<string, StaffSummary> = {};
const svc = () => createDashboardService(t.db);

beforeAll(async () => {
  t = await createTestDatabase();
  await t.reset();
  demo = await seedDashboardDemo(t.db, { password: "demo-password-123", followupEngine: false });
  for (const [k, id] of Object.entries(demo.staff)) v[k] = (await findStaff(t.db, id))!;
}, 120_000);
afterAll(() => t.close());

describe("overview", () => {
  it("counts only stored facts, for the whole business", async () => {
    const o = await svc().getOverview(v.owner!);
    expect(o).toMatchObject({
      totalCustomers: 9,
      newLeadsToday: 9,
      activeLeads: 6,
      hotLeads: 1,
      veryHotLeads: 1,
      pendingFollowups: 3,
      overdueFollowups: 1,
      openHandoffs: 2,
      availableProducts: 4,
      lowStockProducts: 1,
      orders: { total: 1, open: 0, revenueByCurrency: { PKR: "98000.00" } },
    });
    expect(Object.fromEntries(o.pipeline.map((p) => [p.status, p.count]))).toMatchObject({
      very_hot: 1,
      hot: 1,
      human_followup: 2,
      won: 1,
      lost: 1,
      do_not_contact: 1,
    });
    expect(o.recentActivity.length).toBeGreaterThan(0);
    expect(o.recentActivity.map((a) => a.actionType)).not.toContain("product_search");
  });

  it("is scoped for a salesperson", async () => {
    const o = await svc().getOverview(v.ali!);
    expect(o.totalCustomers).toBe(4); // ayesha, usman, fatima, sana
    expect(o.veryHotLeads).toBe(1);
    expect(o.hotLeads).toBe(0); // bilal is Sara's
    expect(o.overdueFollowups).toBe(0);
    expect(o.openHandoffs).toBe(2); // the unassigned queue
    expect(o.recentActivity.every((a) => a.customerId && Object.values(demo.customers).includes(a.customerId))).toBe(true);
    const visible = new Set([demo.customers.ayesha, demo.customers.usman, demo.customers.fatima, demo.customers.sana]);
    expect(o.recentActivity.every((a) => visible.has(a.customerId!))).toBe(true);
  });
});

describe("data isolation", () => {
  it("a salesperson sees only their customers, leads, conversations and follow-ups", async () => {
    const customers = await svc().listCustomers(v.ali!);
    expect(customers.total).toBe(4);
    expect(customers.rows.map((c) => c.fullName)).not.toContain("DEMO Bilal Ahmed (fake)");

    await expect(svc().getCustomerDetail(v.ali!, demo.customers.bilal!)).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
    await expect(svc().getLeadDetail(v.ali!, demo.leads.bilal!)).rejects.toMatchObject({ code: "LEAD_NOT_FOUND" });
    const bilalConversation = (await svc().listConversations(v.sara!)).rows.find((c) => c.customerId === demo.customers.bilal)!;
    await expect(svc().getConversation(v.ali!, bilalConversation.id)).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });

    expect((await svc().listLeads(v.ali!)).rows.every((l) => l.assignedStaffId === demo.staff.ali)).toBe(true);
    expect((await svc().listConversations(v.ali!)).total).toBe(4);
    expect((await svc().listFollowups(v.ali!, "overdue")).total).toBe(0);
    expect((await svc().listFollowups(v.sara!, "overdue")).total).toBe(1);
    expect((await svc().listOrders(v.sara!)).length).toBe(0);
    expect((await svc().listOrders(v.ali!)).length).toBe(1);
  });

  it("the unassigned handoff queue is visible, its conversation is not", async () => {
    const handoffs = await svc().listHandoffs(v.ali!, "open");
    expect(handoffs.map((h) => h.reason).sort()).toEqual(["customer_requested", "discount_request"]);
    const hina = handoffs.find((h) => h.reason === "discount_request")!;
    await expect(svc().getConversation(v.ali!, hina.conversationId)).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
  });

  it("approvals, audit and sync records are for managers and above", async () => {
    for (const who of ["ali", "support"]) {
      await expect(svc().listApprovals(v[who]!)).rejects.toMatchObject({ code: "FORBIDDEN_ACTION" });
      await expect(svc().listActivity(v[who]!)).rejects.toMatchObject({ code: "FORBIDDEN_ACTION" });
      await expect(svc().listSyncRecords(v[who]!)).rejects.toMatchObject({ code: "FORBIDDEN_ACTION" });
    }
    expect((await svc().listApprovals(v.manager!, "pending")).map((a) => a.actionType).sort()).toEqual(["discount", "other"]);
    expect((await svc().listApprovals(v.owner!, undefined, "imports")).map((a) => a.payloadKind).sort()).toEqual(["product_import", "product_sync"]);
    expect((await svc().listActivity(v.owner!, "sensitive")).rows.map((r) => r.actionType)).toEqual(
      expect.arrayContaining(["approval_approved", "approval_rejected", "lead_won", "lead_lost"]),
    );
  });

  it("a deactivated viewer gets nothing", async () => {
    await expect(svc().listApprovals({ ...v.owner!, isActive: false })).rejects.toMatchObject({ code: "FORBIDDEN_ACTION" });
  });
});

describe("customers and Customer 360", () => {
  it("searches safely, filters and sorts", async () => {
    expect((await svc().listCustomers(v.owner!, { q: "ayesha" })).rows.map((c) => c.fullName)).toEqual(["DEMO Ayesha Khan (fake)"]);
    expect((await svc().listCustomers(v.owner!, { q: "%" })).total).toBe(0); // wildcards are literal
    expect((await svc().listCustomers(v.owner!, { q: "5550101" })).rows[0]!.fullName).toBe("DEMO Ayesha Khan (fake)");
    expect((await svc().listCustomers(v.owner!, { classification: "very_hot" })).total).toBe(1);
    const byScore = await svc().listCustomers(v.owner!, { sort: "score", dir: "desc" });
    expect(byScore.rows[0]!.leadScore).toBe(85);
    expect((await svc().listCustomers(v.owner!, { sort: "drop table" as never })).total).toBe(9); // unknown sort → default
  });

  it("Customer 360 shows the deterministic score breakdown and is audited", async () => {
    const c = await svc().getCustomerDetail(v.ali!, demo.customers.ayesha!);
    expect(c.leadScore).toBe(85);
    expect(c.leadClassification).toBe("very_hot");
    expect(c.leadScoreBreakdown.reduce((s, b) => s + b.points, 0)).toBe(85);
    expect(c.signalEvents).toHaveLength(6);
    expect(new Set(c.recentMessages.map((m) => m.senderType))).toEqual(new Set(["customer", "ai", "staff"]));
    expect(c.productInterests[0]).toMatchObject({ productSku: "DEMO-NK-001" });
    expect(c.pendingFollowups).toHaveLength(1);
    expect(c.assignedStaff?.fullName).toBe("DEMO Salesperson Ali");
    const audit = await t.db.query(`select 1 from agent_actions where action_type = 'customer_360_viewed' and actor_staff_id = $1 and customer_id = $2`, [
      demo.staff.ali,
      demo.customers.ayesha,
    ]);
    expect(audit).toHaveLength(1);
  });

  it("orders and lifetime value come only from order rows", async () => {
    const c = await svc().getCustomerDetail(v.owner!, demo.customers.fatima!);
    expect(c.orders).toEqual([expect.objectContaining({ orderNumber: "DEMO-ORD-0001", total: "98000.00", status: "delivered" })]);
    expect(c.ordersSummary.lifetimeValueByCurrency).toEqual({ PKR: "98000.00" });
    const none = await svc().getCustomerDetail(v.owner!, demo.customers.kamran!);
    expect(none.orders).toEqual([]);
    expect(none.ordersSummary.lifetimeValueByCurrency).toEqual({});
  });
});

describe("leads, follow-ups, products", () => {
  it("lead list carries category, budget and next follow-up; filters by status", async () => {
    const leads = await svc().listLeads(v.owner!);
    const ayesha = leads.rows.find((l) => l.customerId === demo.customers.ayesha)!;
    expect(ayesha).toMatchObject({ score: 85, classification: "very_hot", budgetAmount: "500000.00", interestedCategory: "necklace", assignedStaffName: "DEMO Salesperson Ali" });
    expect(ayesha.nextFollowupAt).toBeInstanceOf(Date);
    expect((await svc().listLeads(v.owner!, { status: "human_followup" })).total).toBe(2);
    expect((await svc().listLeads(v.owner!, { status: "won" })).total).toBe(1);
    const detail = await svc().getLeadDetail(v.owner!, demo.leads.bilal!);
    expect(detail.score).toMatchObject({ score: 55, classification: "hot" });
  });

  it("follow-up buckets", async () => {
    const r = await svc().listFollowups(v.owner!, "today");
    expect(r.counts).toEqual({ overdue: 1, today: r.counts.today, upcoming: r.counts.upcoming, completed: 1, cancelled: 1 });
    expect(r.counts.today + r.counts.upcoming).toBe(3);
    expect((await svc().listFollowups(v.owner!, "cancelled")).rows[0]).toMatchObject({ doNotContact: true });
    expect((await svc().listFollowups(v.owner!, "bogus")).bucket).toBe("today");
  });

  it("products flag missing information and hide costs from non-approvers", async () => {
    const missingPrice = await svc().listProducts(v.ali!, { missing: "price" });
    expect(missingPrice.rows.map((p) => p.sku)).toContain("DEMO-NK-002");
    expect(missingPrice.rows.find((p) => p.sku === "DEMO-NK-002")!.missing).toEqual(expect.arrayContaining(["price", "stock"]));
    expect((await svc().listProducts(v.ali!, { stock: "low_stock" })).rows.map((p) => p.sku)).toEqual(["DEMO-BG-002"]);
    const id = missingPrice.rows[0]!.id;
    expect((await svc().getProduct(v.ali!, id)).costs).toBeNull();
    expect((await svc().getProduct(v.owner!, id)).costs).not.toBeNull();
    expect((await svc().getProduct(v.ali!, id)).product).not.toHaveProperty("makingCharge");
  });
});
