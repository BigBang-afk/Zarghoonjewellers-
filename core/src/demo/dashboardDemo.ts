import type { Db } from "../database/db.js";
import { createZarghoonCore } from "../index.js";
import type { LeadSignal } from "../services/crm/leadScoring.js";
import { createStaffAuthService } from "../services/staffAuth/staffAuthService.js";
import type { ActionContext } from "../types/context.js";
import { seedDemoData } from "./demoData.js";

/**
 * Fake business data for the management dashboard's DEMO mode.
 *
 * Everything is unmistakably fake: names start with "DEMO", phone numbers are
 * in the North American 555-0100…0199 range reserved for fiction, emails use the reserved .invalid domain,
 * and products are the DEMO- catalogue. Records are created through the real
 * services, so lead scores, follow-up rules and handoffs behave exactly as in
 * production. Refuses to run against a database with real products.
 */

export const DEMO_STAFF = [
  { key: "owner", username: "demo-owner", fullName: "DEMO Owner", role: "owner" },
  { key: "manager", username: "demo-manager", fullName: "DEMO Sales Manager", role: "manager" },
  { key: "ali", username: "demo-sales", fullName: "DEMO Salesperson Ali", role: "sales" },
  { key: "sara", username: "demo-sales2", fullName: "DEMO Salesperson Sara", role: "sales" },
  { key: "support", username: "demo-support", fullName: "DEMO Support", role: "support" },
] as const;
export type DemoStaffKey = (typeof DEMO_STAFF)[number]["key"];

export interface DashboardDemoResult {
  staff: Record<DemoStaffKey, string>;
  customers: Record<string, string>;
  leads: Record<string, string>;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export async function seedDashboardDemo(db: Db, options: { password: string; now?: Date }): Promise<DashboardDemoResult> {
  const now = options.now ?? new Date();
  const { productIds, staffId: managerId } = await seedDemoData(db);
  const core = createZarghoonCore({ db, clock: () => now });
  const system: ActionContext = { actor: { type: "system", name: "dashboard_demo_seed" } };
  const ai: ActionContext = { actor: { type: "ai", agentName: "sales_agent" } };

  // --- Staff + sign-in --------------------------------------------------------------------
  const staff = {} as Record<DemoStaffKey, string>;
  const auth = createStaffAuthService(db);
  for (const s of DEMO_STAFF) {
    const id =
      s.key === "manager"
        ? managerId
        : (await db.query<{ id: string }>(
            `insert into staff (full_name, role, is_active, is_available, email) values ($1, $2, true, $3, $4) returning id`,
            [s.fullName, s.role, s.role === "sales" || s.role === "support", `${s.username}@example.invalid`],
          ))[0]!.id;
    staff[s.key] = id;
    await auth.setCredential({ staffId: id, username: s.username, password: options.password }, system);
  }
  const staffCtx = (key: DemoStaffKey): ActionContext => ({ actor: { type: "staff", staffId: staff[key] } });

  // --- Customers, conversations, leads ------------------------------------------------------
  const customers: Record<string, string> = {};
  const leads: Record<string, string> = {};
  const conversations: Record<string, string> = {};

  async function customer(
    key: string,
    data: { name: string | null; city?: string; language?: "english" | "urdu" | "roman_urdu"; phoneSuffix?: string; visitor?: boolean },
    assigned: DemoStaffKey | null,
    signals: LeadSignal[],
    chat: [sender: "customer" | "ai" | "staff" | "system", text: string][],
    budget?: string,
  ) {
    const { customer } = await core.customers.createCustomer(
      {
        fullName: data.name ?? undefined,
        city: data.city,
        preferredLanguage: data.language ?? "english",
        ...(data.phoneSuffix ? { phone: `+120255501${data.phoneSuffix.slice(-2)}`, email: `${key}@example.invalid` } : {}),
        ...(data.visitor ? { externalIdentities: [{ type: "website_visitor" as const, value: `sha256:demo-${key}` }] } : {}),
      },
      system,
    );
    customers[key] = customer.id;
    const lead = await core.leads.createLead(
      {
        customerId: customer.id,
        sourceChannel: "website",
        ...(assigned ? { assignedStaffId: staff[assigned] } : {}),
        ...(budget ? { budgetAmount: budget, budgetCurrency: "PKR" } : {}),
      },
      system,
    );
    leads[key] = lead.id;
    const conversation = await core.conversations.createConversation({ channel: "website", customerId: customer.id, leadId: lead.id }, system);
    conversations[key] = conversation.id;
    if (assigned) await core.conversations.assignStaff(conversation.id, staff[assigned], system);
    for (const [sender, content] of chat) {
      await core.conversations.addMessage(
        {
          conversationId: conversation.id,
          direction: sender === "customer" ? "inbound" : "outbound",
          senderType: sender,
          ...(sender === "staff" ? { senderStaffId: staff[assigned ?? "manager"] } : {}),
          content,
        },
        sender === "ai" ? ai : sender === "staff" ? staffCtx(assigned ?? "manager") : system,
      );
    }
    for (const signal of signals) {
      if (signal === "provided_budget" && budget) continue; // recorded by createLead
      await core.leads.recordLeadSignal(lead.id, { signal, evidence: "DEMO conversation" }, ai);
    }
  }

  await customer(
    "ayesha",
    { name: "DEMO Ayesha Khan (fake)", city: "Lahore", phoneSuffix: "0001" },
    "ali",
    ["asked_price", "provided_budget", "specific_product_interest", "asked_availability", "asked_about_visit", "provided_contact"],
    [
      ["customer", "Salam, I'm looking for a bridal necklace set for my wedding in December."],
      ["ai", "Congratulations! Our DEMO Bridal Kundan Necklace (DEMO-NK-001) is PKR 485,000 and currently available. What budget did you have in mind?"],
      ["customer", "Around 5 lakh. Can I see it in the store this Saturday?"],
      ["ai", "Of course. A member of our team will confirm a time for your visit."],
      ["staff", "DEMO note from Ali: I'll call to confirm Saturday 4pm."],
    ],
    "500000",
  );
  await core.productInterests.recordProductInterest({ customerId: customers.ayesha!, sku: "DEMO-NK-001", interestType: "shortlisted" }, ai);

  await customer(
    "bilal",
    { name: "DEMO Bilal Ahmed (fake)", city: "Karachi", language: "roman_urdu", phoneSuffix: "0002" },
    "sara",
    ["asked_price", "provided_budget", "specific_product_interest", "asked_availability"],
    [
      ["customer", "Bhai 22K kangan ka rate kya hai? Budget 3 lakh hai."],
      ["ai", "DEMO Classic 22K Bangles (DEMO-BG-002) PKR 298,000 hain — sirf kuch pieces baqi hain."],
    ],
    "300000",
  );
  await core.productInterests.recordProductInterest({ customerId: customers.bilal!, sku: "DEMO-BG-002", interestType: "asked_price" }, ai);

  await customer(
    "hina",
    { name: "DEMO Hina Malik (fake)", city: "Islamabad", language: "urdu", phoneSuffix: "0003" },
    null,
    ["asked_price", "specific_product_interest"],
    [
      ["customer", "کیا اس سیٹ پر کوئی رعایت مل سکتی ہے؟"],
      ["ai", "ہماری ٹیم آپ کی اس درخواست میں مدد کرے گی۔"],
    ],
  );
  await core.productInterests.recordProductInterest({ customerId: customers.hina!, sku: "DEMO-NK-001", interestType: "asked_price" }, ai);
  await core.handoffs.requestHumanHandoff({ conversationId: conversations.hina!, reason: "discount_request", urgency: "high" }, ai);
  await core.approvals.createApprovalRequest(
    {
      actionType: "discount",
      reason: "DEMO — customer asked for a better price on DEMO-NK-001 (no amount offered by the AI)",
      customerId: customers.hina!,
      payload: { kind: "discount_request", sku: "DEMO-NK-001" },
    },
    ai,
  );

  await customer(
    "visitor",
    { name: null, visitor: true },
    null,
    ["requested_human_salesperson"],
    [
      ["customer", "Can I speak to a real person please?"],
      ["ai", "Of course. A member of the Zarghoon Jewellers team will assist you with this request."],
    ],
  );
  await core.handoffs.requestHumanHandoff({ conversationId: conversations.visitor!, reason: "customer_requested", urgency: "urgent" }, ai);

  await customer(
    "usman",
    { name: "DEMO Usman Tariq (fake)", city: "Lahore", phoneSuffix: "0004" },
    "ali",
    ["asked_price", "specific_product_interest"],
    [["customer", "Do you have 18K rings for engagement?"], ["ai", "Here is what I found: DEMO Solitaire Ring (DEMO-RG-001) — made to order."]],
  );
  await core.productInterests.recordProductInterest({ customerId: customers.usman!, sku: "DEMO-RG-001", interestType: "viewed" }, ai);

  await customer(
    "kamran",
    { name: "DEMO Kamran Shah (fake)", city: "Peshawar", phoneSuffix: "0005" },
    "sara",
    [],
    [["customer", "Just browsing earrings, thanks."], ["ai", "Here is what I found: DEMO Gold Jhumka Earrings — PKR 98,000."]],
  );

  await customer(
    "fatima",
    { name: "DEMO Fatima Noor (fake)", city: "Lahore", phoneSuffix: "0006" },
    "ali",
    ["asked_price", "specific_product_interest", "asked_about_payment_or_order"],
    [["customer", "I'd like to order the DEMO Gold Jhumka Earrings."], ["staff", "DEMO: Order confirmed in store."]],
  );
  await core.leads.markLeadWon(leads.fatima!, staffCtx("ali"), "DEMO sale completed in store");
  const order = await db.query<{ id: string }>(
    `insert into orders (order_number, customer_id, lead_id, status, payment_status, subtotal, total, assigned_staff_id, notes, confirmed_at, delivered_at)
     values ('DEMO-ORD-0001', $1, $2, 'delivered', 'paid', 98000, 98000, $3, 'DEMO order — fake data', $4, $4) returning id`,
    [customers.fatima, leads.fatima, staff.ali, new Date(now.getTime() - 5 * DAY)],
  );
  await db.query(
    `insert into order_items (order_id, product_id, sku_snapshot, description, quantity, unit_price, line_total)
     values ($1, $2, 'DEMO-ER-001', 'DEMO Gold Jhumka Earrings', 1, 98000, 98000)`,
    [order[0]!.id, productIds["DEMO-ER-001"]],
  );

  await customer(
    "zain",
    { name: "DEMO Zain Abbas (fake)", city: "Multan", phoneSuffix: "0007" },
    "sara",
    ["asked_price"],
    [["customer", "What's the price of the polki set?"], ["ai", "Our team will confirm the price of the DEMO Polki Necklace for you."]],
  );
  await core.leads.markLeadLost(leads.zain!, "DEMO — chose a different design elsewhere", staffCtx("sara"));

  await customer(
    "sana",
    { name: "DEMO Sana Iqbal (fake)", city: "Faisalabad", phoneSuffix: "0008" },
    "ali",
    ["asked_price"],
    [["customer", "Please don't contact me again."], ["ai", "Understood. We won't contact you again."]],
  );

  // --- Follow-ups: today, overdue, upcoming, completed, cancelled --------------------------------
  const past = createZarghoonCore({ db, clock: () => new Date(now.getTime() - 3 * DAY) });
  await core.followups.scheduleFollowup(
    { customerId: customers.ayesha!, leadId: leads.ayesha, assignedStaffId: staff.ali, scheduledFor: new Date(now.getTime() + 2 * HOUR), note: "DEMO — confirm Saturday store visit" },
    staffCtx("ali"),
  );
  await past.followups.scheduleFollowup(
    { customerId: customers.bilal!, leadId: leads.bilal, assignedStaffId: staff.sara, scheduledFor: new Date(now.getTime() - DAY), note: "DEMO — send bangle photos (overdue)" },
    staffCtx("sara"),
  );
  await core.followups.scheduleFollowup(
    { customerId: customers.usman!, leadId: leads.usman, assignedStaffId: staff.ali, scheduledFor: new Date(now.getTime() + 3 * DAY), note: "DEMO — share ring sizes" },
    staffCtx("ali"),
  );
  await core.followups.scheduleFollowup(
    { customerId: customers.kamran!, leadId: leads.kamran, assignedStaffId: staff.sara, scheduledFor: new Date(now.getTime() + 6 * DAY), note: "DEMO — new earrings arrival" },
    staffCtx("sara"),
  );
  const done = await core.followups.scheduleFollowup(
    { customerId: customers.fatima!, followupType: "after_sales", assignedStaffId: staff.ali, scheduledFor: new Date(now.getTime() + HOUR), note: "DEMO — after-sales check" },
    staffCtx("ali"),
  );
  await core.followups.completeFollowup(done.id, staffCtx("ali"), "DEMO — customer happy with the earrings");
  await core.followups.scheduleFollowup(
    { customerId: customers.sana!, leadId: leads.sana, assignedStaffId: staff.ali, scheduledFor: new Date(now.getTime() + 2 * DAY), note: "DEMO — follow up on price" },
    staffCtx("ali"),
  );
  // Opting out cancels pending follow-ups (existing do-not-contact rule).
  await core.leads.markLeadDoNotContact(leads.sana!, staffCtx("ali"), "DEMO — customer asked not to be contacted");

  // --- Approvals: pending + history -------------------------------------------------------------------
  await core.approvals.createApprovalRequest(
    {
      actionType: "other",
      reason: "DEMO — product sync preview from the website export (fake batch)",
      payload: {
        kind: "product_sync",
        source: "website_export",
        planHash: "demo-plan-hash",
        summary: { create: 1, link: 3, update: 2, unchanged: 0, needs_sku: 1, invalid: 0, conflict: 0, flagged: 1, missingFromSource: 0 },
      },
    },
    staffCtx("manager"),
  );
  const priceChange = await core.approvals.createApprovalRequest(
    { actionType: "price_change", reason: "DEMO — correct DEMO-BG-001 price after re-weighing", payload: { kind: "product_import", sku: "DEMO-BG-001" } },
    staffCtx("manager"),
  );
  await core.approvals.approve(priceChange.id, staffCtx("owner"), "DEMO — approved");
  const marketing = await core.approvals.createApprovalRequest(
    { actionType: "bulk_marketing", reason: "DEMO — Eid campaign message to all customers", payload: { kind: "bulk_marketing" } },
    staffCtx("manager"),
  );
  await core.approvals.reject(marketing.id, staffCtx("owner"), "DEMO — not this season");

  return { staff, customers, leads };
}
