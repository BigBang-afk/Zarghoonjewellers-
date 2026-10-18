import { z } from "zod";
import { queryOne, type Db } from "../../database/db.js";
import { ConversationNotFoundError, CustomerNotFoundError, LeadNotFoundError, ProductNotFoundError } from "../../lib/errors.js";
import { sumMoney } from "../../lib/money.js";
import { parseInput, uuidSchema } from "../../lib/validation.js";
import {
  LANGUAGES,
  LEAD_STATUSES,
  mapConversationRow,
  mapFollowupRow,
  mapLeadRow,
  mapMessageRow,
  type ConversationRow,
  type FollowupRow,
  type LeadRow,
  type LeadStatus,
  type MessageRow,
} from "../../schemas/crm.js";
import { mapProductRow, STOCK_STATUSES, type ProductRow } from "../../schemas/product.js";
import { systemClock, type Clock } from "../../types/context.js";
import { recordAction } from "../auditService.js";
import { createCustomer360Service } from "../crm/customer360Service.js";
import { computeLeadScore, type LeadClassification } from "../crm/leadScoring.js";
import { getLeadSignals } from "../crm/shared.js";
import { can, customerScopeSql, requireCapability, scopeStaffId, type Viewer } from "./access.js";

/**
 * Read model for the management dashboard.
 *
 * Every method takes the signed-in viewer and applies their scope in SQL, so
 * a salesperson's query cannot return another salesperson's customers. All
 * figures are counted from stored rows; nothing is estimated. Mutations are
 * not here — they go through the existing CRM services (see dashboardActions).
 */

export const PAGE_SIZE = 25;
export const DEFAULT_TIMEZONE = "Asia/Karachi";
const REALIZED_ORDER_STATUSES = ["confirmed", "in_production", "ready", "delivered"];
const ACTIVE_LEAD = `status not in ('won', 'lost', 'do_not_contact')`;

const pageSchema = z.coerce.number().int().min(1).max(10_000).optional().default(1).catch(1);
const searchSchema = z.string().trim().max(100).optional().catch(undefined);

/** Escapes LIKE wildcards in user search text. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

const toPage = <T>(rows: T[], total: number, page: number): Page<T> => ({ rows, total, page, pageSize: PAGE_SIZE });

// --- Row shapes ------------------------------------------------------------------------

export interface OverviewMetrics {
  totalCustomers: number;
  newLeadsToday: number;
  activeLeads: number;
  hotLeads: number;
  veryHotLeads: number;
  pendingFollowups: number;
  overdueFollowups: number;
  openHandoffs: number;
  availableProducts: number;
  lowStockProducts: number;
  /** Counted from the orders table only; revenue = confirmed-or-later order totals. */
  orders: { total: number; open: number; revenueByCurrency: Record<string, string> };
  pipeline: { status: LeadStatus; count: number }[];
  recentActivity: ActivityRow[];
}

export interface CustomerListRow {
  id: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  preferredLanguage: string;
  doNotContact: boolean;
  leadId: string | null;
  leadStatus: LeadStatus | null;
  leadScore: number | null;
  leadClassification: LeadClassification | null;
  lastContactAt: Date | null;
  createdAt: Date;
  assignedStaffName: string | null;
}

export interface LeadListRow {
  id: string;
  customerId: string;
  customerName: string | null;
  status: LeadStatus;
  score: number;
  classification: LeadClassification;
  budgetAmount: string | null;
  budgetCurrency: string | null;
  interestedCategory: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  nextFollowupAt: Date | null;
  lastActivityAt: Date;
}

export interface ConversationListRow {
  id: string;
  customerId: string | null;
  customerName: string | null;
  channel: string;
  status: string;
  humanTakeover: boolean;
  assignedStaffName: string | null;
  lastMessageAt: Date | null;
  messageCount: number;
  lastMessagePreview: string | null;
  lastSenderType: string | null;
}

export interface ProductListRow {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  collection: string | null;
  metal: string | null;
  karat: number | null;
  weightGrams: string | null;
  approvedPrice: string | null;
  currency: string;
  stockQuantity: number | null;
  stockStatus: string | null;
  isActive: boolean;
  imageUrl: string | null;
  missing: MissingField[];
}

export type MissingField = "category" | "metal" | "karat" | "weight" | "price" | "stock" | "image";

export type FollowupBucket = "today" | "overdue" | "upcoming" | "completed" | "cancelled";

export interface FollowupListRow {
  id: string;
  customerId: string;
  customerName: string | null;
  doNotContact: boolean;
  leadId: string | null;
  leadStatus: LeadStatus | null;
  followupType: string;
  channel: string | null;
  scheduledFor: Date;
  status: string;
  note: string | null;
  messageDraft: string | null;
  outcomeNote: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  createdByType: string;
  completedAt: Date | null;
  cancelledAt: Date | null;
}

export interface HandoffListRow {
  id: string;
  conversationId: string;
  customerId: string | null;
  customerName: string | null;
  leadId: string | null;
  leadStatus: LeadStatus | null;
  leadScore: number | null;
  reason: string;
  urgency: string;
  status: string;
  note: string | null;
  requestedByType: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  humanTakeover: boolean;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface ApprovalListRow {
  id: string;
  actionType: string;
  status: string;
  reason: string;
  payloadKind: string | null;
  payload: Record<string, unknown>;
  requestedByType: string;
  requestedByName: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  customerId: string | null;
  customerName: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

export interface ActivityRow {
  id: string;
  actionType: string;
  toolName: string | null;
  actorType: string;
  actorName: string | null;
  agentName: string | null;
  customerId: string | null;
  customerName: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
}

export type ActivityCategory = "all" | "ai" | "sensitive" | "sign_in";

/** Actions that change money, status, access or responsibility. */
const SENSITIVE_ACTIONS = [
  "approval_requested",
  "approval_approved",
  "approval_rejected",
  "approval_cancelled",
  "lead_won",
  "lead_lost",
  "lead_do_not_contact",
  "customer_do_not_contact",
  "human_handoff_requested",
  "handoff_assigned",
  "handoff_resolved",
  "human_takeover_activated",
  "human_takeover_released",
  "product_import",
  "product_sync",
  "staff_credential_set",
  "staff_password_changed",
  "demo_data_reset",
];
/** High-volume read actions hidden from "recent activity" (still in the audit log). */
const NOISY_ACTIONS = [
  "product_search",
  "product_viewed",
  "inventory_check",
  "customer_360_viewed",
  "conversation_viewed",
  // Sign-in events are in the activity log's "Sign-in" tab.
  "staff_login",
  "staff_logout",
  "staff_login_failed",
  "staff_login_locked",
];

// --- Filters ------------------------------------------------------------------------------

export const customerFilterSchema = z.object({
  q: searchSchema,
  leadStatus: z.enum(LEAD_STATUSES).optional().catch(undefined),
  classification: z.enum(["cold", "warm", "hot", "very_hot"]).optional().catch(undefined),
  language: z.enum(LANGUAGES).optional().catch(undefined),
  sort: z.enum(["last_contact", "score", "name", "created"]).default("last_contact").catch("last_contact"),
  dir: z.enum(["asc", "desc"]).default("desc").catch("desc"),
  page: pageSchema,
});
export type CustomerFilter = z.input<typeof customerFilterSchema>;

export const leadFilterSchema = z.object({
  q: searchSchema,
  status: z.enum(LEAD_STATUSES).optional().catch(undefined),
  assigned: z.enum(["me", "unassigned"]).optional().catch(undefined),
  page: pageSchema,
});
export type LeadFilter = z.input<typeof leadFilterSchema>;

export const conversationFilterSchema = z.object({
  q: searchSchema,
  status: z.enum(["open", "closed"]).optional().catch(undefined),
  takeover: z.enum(["yes", "no"]).optional().catch(undefined),
  page: pageSchema,
});
export type ConversationFilter = z.input<typeof conversationFilterSchema>;

export const productFilterSchema = z.object({
  q: searchSchema,
  category: z.string().trim().toLowerCase().max(100).optional().catch(undefined),
  stock: z.enum([...STOCK_STATUSES, "unknown"]).optional().catch(undefined),
  missing: z.enum(["any", "price", "weight", "karat", "stock", "image"]).optional().catch(undefined),
  page: pageSchema,
});
export type ProductFilter = z.input<typeof productFilterSchema>;

const followupBucketSchema = z.enum(["today", "overdue", "upcoming", "completed", "cancelled"]).catch("today");

// --- Service -----------------------------------------------------------------------------------

export function createDashboardService(db: Db, options: { clock?: Clock; timezone?: string } = {}) {
  const clock = options.clock ?? systemClock;
  const tz = options.timezone ?? DEFAULT_TIMEZONE;
  const customer360 = createCustomer360Service(db);
  const startOfDay = (p: string) => `(date_trunc('day', ${p}::timestamptz at time zone '${tz.replace(/'/g, "")}') at time zone '${tz.replace(/'/g, "")}')`;

  async function count(sql: string, params: unknown[]): Promise<number> {
    return (await queryOne<{ n: number }>(db, sql, params))!.n;
  }

  /** Throws "not found" unless the customer exists and is in the viewer's scope. */
  async function assertCustomerVisible(viewer: Viewer, customerId: string): Promise<void> {
    const ok = await queryOne<{ id: string }>(
      db,
      `select id from customers c where c.id = $1 and ${customerScopeSql("c.id", "$2")}`,
      [customerId, scopeStaffId(viewer)],
    );
    if (!ok) throw new CustomerNotFoundError({ id: customerId });
  }

  async function getOverview(viewer: Viewer): Promise<OverviewMetrics> {
    const me = scopeStaffId(viewer);
    const now = clock();
    const scopeC = customerScopeSql("c.id", "$1");
    const scopeL = customerScopeSql("l.customer_id", "$1");
    const scopeF = `(${customerScopeSql("f.customer_id", "$1")} or f.assigned_staff_id = $1)`;
    const [customers, leads, followups, handoffs, products, orders, pipeline, recentActivity] = await Promise.all([
      count(`select count(*)::int as n from customers c where ${scopeC}`, [me]),
      queryOne<{ new_today: number; active: number; hot: number; very_hot: number }>(
        db,
        `select count(*) filter (where l.created_at >= ${startOfDay("$2")})::int as new_today,
                count(*) filter (where l.${ACTIVE_LEAD})::int as active,
                count(*) filter (where l.${ACTIVE_LEAD} and l.score_classification = 'hot')::int as hot,
                count(*) filter (where l.${ACTIVE_LEAD} and l.score_classification = 'very_hot')::int as very_hot
           from leads l where ${scopeL}`,
        [me, now],
      ),
      queryOne<{ pending: number; overdue: number }>(
        db,
        `select count(*) filter (where f.scheduled_for >= $2)::int as pending,
                count(*) filter (where f.scheduled_for < $2)::int as overdue
           from followups f where f.status = 'pending' and ${scopeF}`,
        [me, now],
      ),
      count(
        `select count(*)::int as n from handoffs h where h.status = 'open'
            and (${customerScopeSql("h.customer_id", "$1")} or h.assigned_staff_id = $1 or h.assigned_staff_id is null)`,
        [me],
      ),
      queryOne<{ available: number; low: number }>(
        db,
        `select count(*) filter (where stock_status in ('available', 'low_stock'))::int as available,
                count(*) filter (where stock_status = 'low_stock')::int as low
           from products where is_active`,
      ),
      db.query<{ status: string; currency: string; total: string }>(
        `select o.status, o.currency, o.total from orders o where ${customerScopeSql("o.customer_id", "$1")}`,
        [me],
      ),
      db.query<{ status: LeadStatus; n: number }>(
        `select l.status, count(*)::int as n from leads l where ${scopeL} group by l.status`,
        [me],
      ),
      listActivityRows(me, { excludeNoisy: true, limit: 12 }),
    ]);

    const realized = new Map<string, string[]>();
    for (const o of orders.filter((o) => REALIZED_ORDER_STATUSES.includes(o.status))) {
      realized.set(o.currency, [...(realized.get(o.currency) ?? []), o.total]);
    }
    const counts = new Map(pipeline.map((p) => [p.status, p.n]));
    return {
      totalCustomers: customers,
      newLeadsToday: leads!.new_today,
      activeLeads: leads!.active,
      hotLeads: leads!.hot,
      veryHotLeads: leads!.very_hot,
      pendingFollowups: followups!.pending,
      overdueFollowups: followups!.overdue,
      openHandoffs: handoffs,
      availableProducts: products!.available,
      lowStockProducts: products!.low,
      orders: {
        total: orders.length,
        open: orders.filter((o) => ["draft", "pending_confirmation", "confirmed", "in_production", "ready"].includes(o.status)).length,
        revenueByCurrency: Object.fromEntries([...realized].map(([c, totals]) => [c, sumMoney(totals)])),
      },
      pipeline: LEAD_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 })),
      recentActivity,
    };
  }

  async function listCustomers(viewer: Viewer, filter: CustomerFilter = {}): Promise<Page<CustomerListRow>> {
    const f = customerFilterSchema.parse(filter);
    const params: unknown[] = [scopeStaffId(viewer)];
    const where = [customerScopeSql("c.id", "$1")];
    if (f.q) {
      params.push(likePattern(f.q));
      const digits = f.q.replace(/\D/g, "");
      const phone = digits.length >= 4 ? ` or c.phone like '%' || $${params.push(digits.replace(/^0/, ""))} || '%'` : "";
      where.push(`(c.full_name ilike $2 or c.email ilike $2 or c.city ilike $2${phone})`);
    }
    if (f.leadStatus) where.push(`l.status = $${params.push(f.leadStatus)}`);
    if (f.classification) where.push(`l.score_classification = $${params.push(f.classification)} and l.${ACTIVE_LEAD}`);
    if (f.language) where.push(`c.preferred_language = $${params.push(f.language)}`);
    const order = {
      last_contact: `c.last_contact_at ${f.dir} nulls last`,
      score: `l.score ${f.dir} nulls last`,
      name: `c.full_name ${f.dir} nulls last`,
      created: `c.created_at ${f.dir}`,
    }[f.sort];
    const from = `from customers c
      left join lateral (
        select * from leads where customer_id = c.id
         order by (status in ('won', 'lost', 'do_not_contact')), created_at desc limit 1) l on true
      left join staff s on s.id = coalesce(l.assigned_staff_id,
        (select assigned_staff_id from conversations where customer_id = c.id and assigned_staff_id is not null
          order by created_at desc limit 1))
      where ${where.join(" and ")}`;
    const [rows, total] = await Promise.all([
      db.query<Record<string, never>>(
        `select c.id, c.full_name, c.phone, c.email, c.city, c.preferred_language, c.do_not_contact, c.last_contact_at,
                c.created_at, l.id as lead_id, l.status as lead_status, l.score as lead_score,
                l.score_classification as lead_classification, s.full_name as staff_name
           ${from} order by ${order}, c.id limit ${PAGE_SIZE} offset ${(f.page - 1) * PAGE_SIZE}`,
        params,
      ),
      count(`select count(*)::int as n ${from}`, params),
    ]);
    return toPage(
      rows.map((r: Record<string, any>) => ({
        id: r.id,
        fullName: r.full_name,
        phone: r.phone,
        email: r.email,
        city: r.city,
        preferredLanguage: r.preferred_language,
        doNotContact: r.do_not_contact,
        leadId: r.lead_id,
        leadStatus: r.lead_status,
        leadScore: r.lead_score,
        leadClassification: r.lead_classification,
        lastContactAt: r.last_contact_at,
        createdAt: r.created_at,
        assignedStaffName: r.staff_name,
      })),
      total,
      f.page,
    );
  }

  /** Customer 360 (the existing service) plus full histories; audited as a PII view. */
  async function getCustomerDetail(viewer: Viewer, customerId: string) {
    const id = parseInput(uuidSchema, customerId, "customer id");
    await assertCustomerVisible(viewer, id);
    const [c360, leads, followups, orders, conversations] = await Promise.all([
      customer360.getCustomer360(id, { messageLimit: 30, conversationLimit: 20 }),
      db.query<LeadRow & { staff_name: string | null }>(
        `select l.*, s.full_name as staff_name from leads l left join staff s on s.id = l.assigned_staff_id
          where l.customer_id = $1 order by l.created_at desc`,
        [id],
      ),
      db.query<FollowupRow & { staff_name: string | null }>(
        `select f.*, s.full_name as staff_name from followups f left join staff s on s.id = f.assigned_staff_id
          where f.customer_id = $1 order by f.scheduled_for desc limit 50`,
        [id],
      ),
      db.query<{ id: string; order_number: string; status: string; payment_status: string; currency: string; total: string; created_at: Date }>(
        `select id, order_number, status, payment_status, currency, total, created_at from orders
          where customer_id = $1 order by created_at desc limit 50`,
        [id],
      ),
      db.query<ConversationRow & { message_count: number; staff_name: string | null }>(
        `select v.*, (select count(*)::int from messages m where m.conversation_id = v.id) as message_count,
                s.full_name as staff_name
           from conversations v left join staff s on s.id = v.assigned_staff_id
          where v.customer_id = $1 order by coalesce(v.last_message_at, v.created_at) desc limit 20`,
        [id],
      ),
    ]);
    const signalEvents = c360.activeLead ? await getSignalEvents(c360.activeLead.id) : [];
    const staffIds = [...new Set(c360.recentMessages.map((m) => m.senderStaffId).filter((s): s is string => !!s))];
    const staffNames = new Map(
      staffIds.length
        ? (await db.query<{ id: string; full_name: string }>(`select id, full_name from staff where id = any($1::uuid[])`, [staffIds])).map((r) => [r.id, r.full_name])
        : [],
    );
    await recordAction(db, { actor: { type: "staff", staffId: viewer.id } }, { actionType: "customer_360_viewed", customerId: id });
    return {
      ...c360,
      recentMessages: c360.recentMessages.map((m) => ({ ...m, senderStaffName: m.senderStaffId ? (staffNames.get(m.senderStaffId) ?? null) : null })),
      leadHistory: leads.map((r) => ({ ...mapLeadRow(r), assignedStaffName: r.staff_name })),
      followupHistory: followups.map((r) => ({ ...mapFollowupRow(r), assignedStaffName: r.staff_name })),
      orders: orders.map((o) => ({
        id: o.id,
        orderNumber: o.order_number,
        status: o.status,
        paymentStatus: o.payment_status,
        currency: o.currency,
        total: o.total,
        createdAt: o.created_at,
      })),
      conversations: conversations.map((r) => ({
        ...mapConversationRow(r),
        messageCount: r.message_count,
        assignedStaffName: r.staff_name,
      })),
      signalEvents,
    };
  }

  async function getSignalEvents(leadId: string) {
    const rows = await db.query<{ signal: string; points: number; evidence: string | null; recorded_by_type: string; created_at: Date }>(
      `select signal, points, evidence, recorded_by_type, created_at from lead_signal_events
        where lead_id = $1 order by created_at, id`,
      [leadId],
    );
    return rows.map((r) => ({
      signal: r.signal,
      points: r.points,
      evidence: r.evidence,
      recordedByType: r.recorded_by_type,
      createdAt: r.created_at,
    }));
  }

  async function listLeads(viewer: Viewer, filter: LeadFilter = {}): Promise<Page<LeadListRow>> {
    const f = leadFilterSchema.parse(filter);
    const params: unknown[] = [scopeStaffId(viewer)];
    const where = [customerScopeSql("l.customer_id", "$1")];
    if (f.status) where.push(`l.status = $${params.push(f.status)}`);
    if (f.assigned === "me") where.push(`l.assigned_staff_id = $${params.push(viewer.id)}`);
    if (f.assigned === "unassigned") where.push(`l.assigned_staff_id is null`);
    if (f.q) where.push(`(c.full_name ilike $${params.push(likePattern(f.q))} or c.email ilike $${params.length})`);
    const from = `from leads l join customers c on c.id = l.customer_id
      left join staff s on s.id = l.assigned_staff_id where ${where.join(" and ")}`;
    const [rows, total] = await Promise.all([
      db.query<Record<string, any>>(
        `select l.id, l.customer_id, c.full_name, l.status, l.score, l.score_classification, l.budget_amount,
                l.budget_currency, l.assigned_staff_id, s.full_name as staff_name, l.last_activity_at,
                (select p.category from product_interests pi join products p on p.id = pi.product_id
                  where pi.customer_id = l.customer_id and p.category is not null
                  order by pi.created_at desc limit 1) as interested_category,
                (select min(f.scheduled_for) from followups f where f.lead_id = l.id and f.status = 'pending') as next_followup_at
           ${from} order by (l.status in ('won', 'lost', 'do_not_contact')), l.score desc, l.last_activity_at desc, l.id
          limit ${PAGE_SIZE} offset ${(f.page - 1) * PAGE_SIZE}`,
        params,
      ),
      count(`select count(*)::int as n ${from}`, params),
    ]);
    return toPage(
      rows.map((r) => ({
        id: r.id,
        customerId: r.customer_id,
        customerName: r.full_name,
        status: r.status,
        score: r.score,
        classification: r.score_classification,
        budgetAmount: r.budget_amount,
        budgetCurrency: r.budget_currency,
        interestedCategory: r.interested_category,
        assignedStaffId: r.assigned_staff_id,
        assignedStaffName: r.staff_name,
        nextFollowupAt: r.next_followup_at,
        lastActivityAt: r.last_activity_at,
      })),
      total,
      f.page,
    );
  }

  async function getLeadDetail(viewer: Viewer, leadId: string) {
    const id = parseInput(uuidSchema, leadId, "lead id");
    const row = await queryOne<LeadRow & { customer_name: string | null; staff_name: string | null; do_not_contact: boolean }>(
      db,
      `select l.*, c.full_name as customer_name, c.do_not_contact, s.full_name as staff_name
         from leads l join customers c on c.id = l.customer_id left join staff s on s.id = l.assigned_staff_id
        where l.id = $1 and ${customerScopeSql("l.customer_id", "$2")}`,
      [id, scopeStaffId(viewer)],
    );
    if (!row) throw new LeadNotFoundError({ id });
    const [signals, events, followups] = await Promise.all([
      getLeadSignals(db, id),
      getSignalEvents(id),
      db.query<FollowupRow>(`select * from followups where lead_id = $1 order by scheduled_for desc limit 50`, [id]),
    ]);
    return {
      lead: mapLeadRow(row),
      customerName: row.customer_name,
      doNotContact: row.do_not_contact,
      assignedStaffName: row.staff_name,
      score: computeLeadScore(signals),
      signalEvents: events,
      followups: followups.map(mapFollowupRow),
    };
  }

  async function listConversations(viewer: Viewer, filter: ConversationFilter = {}): Promise<Page<ConversationListRow>> {
    const f = conversationFilterSchema.parse(filter);
    const params: unknown[] = [scopeStaffId(viewer)];
    const where = [`($1::uuid is null or v.assigned_staff_id = $1 or (v.customer_id is not null and ${customerScopeSql("v.customer_id", "$1")}))`];
    if (f.status) where.push(`v.status = $${params.push(f.status)}`);
    if (f.takeover) where.push(f.takeover === "yes" ? `v.human_takeover` : `not v.human_takeover`);
    if (f.q) where.push(`c.full_name ilike $${params.push(likePattern(f.q))}`);
    const joins = `from conversations v left join customers c on c.id = v.customer_id
      left join staff s on s.id = v.assigned_staff_id`;
    const whereSql = `where ${where.join(" and ")}`;
    const from = `${joins} ${whereSql}`;
    const [rows, total] = await Promise.all([
      db.query<Record<string, any>>(
        `select v.id, v.customer_id, c.full_name, v.channel, v.status, v.human_takeover, s.full_name as staff_name,
                v.last_message_at, (select count(*)::int from messages m where m.conversation_id = v.id) as message_count,
                lm.content as last_content, lm.sender_type as last_sender
           ${joins}
           left join lateral (select content, sender_type from messages m where m.conversation_id = v.id
                               order by created_at desc, id desc limit 1) lm on true
           ${whereSql}
          order by coalesce(v.last_message_at, v.created_at) desc, v.id
          limit ${PAGE_SIZE} offset ${(f.page - 1) * PAGE_SIZE}`,
        params,
      ),
      count(`select count(*)::int as n ${from}`, params),
    ]);
    return toPage(
      rows.map((r) => ({
        id: r.id,
        customerId: r.customer_id,
        customerName: r.full_name,
        channel: r.channel,
        status: r.status,
        humanTakeover: r.human_takeover,
        assignedStaffName: r.staff_name,
        lastMessageAt: r.last_message_at,
        messageCount: r.message_count,
        lastMessagePreview: r.last_content ? String(r.last_content).slice(0, 140) : null,
        lastSenderType: r.last_sender,
      })),
      total,
      f.page,
    );
  }

  async function getConversation(viewer: Viewer, conversationId: string) {
    const id = parseInput(uuidSchema, conversationId, "conversation id");
    const row = await queryOne<ConversationRow & { customer_name: string | null; staff_name: string | null }>(
      db,
      `select v.*, c.full_name as customer_name, s.full_name as staff_name
         from conversations v left join customers c on c.id = v.customer_id left join staff s on s.id = v.assigned_staff_id
        where v.id = $1 and ($2::uuid is null or v.assigned_staff_id = $2
          or (v.customer_id is not null and ${customerScopeSql("v.customer_id", "$2")}))`,
      [id, scopeStaffId(viewer)],
    );
    if (!row) throw new ConversationNotFoundError({ id });
    const [messages, handoffs] = await Promise.all([
      db.query<MessageRow & { staff_name: string | null }>(
        `select * from (select m.*, s.full_name as staff_name from messages m left join staff s on s.id = m.sender_staff_id
                         where m.conversation_id = $1 order by m.created_at desc, m.id desc limit 200) x
          order by created_at, id`,
        [id],
      ),
      db.query<{ id: string; reason: string; urgency: string; status: string; created_at: Date }>(
        `select id, reason, urgency, status, created_at from handoffs where conversation_id = $1 order by created_at desc`,
        [id],
      ),
    ]);
    await recordAction(db, { actor: { type: "staff", staffId: viewer.id } }, {
      actionType: "conversation_viewed",
      conversationId: id,
      customerId: row.customer_id,
    });
    return {
      conversation: mapConversationRow(row),
      customerName: row.customer_name,
      assignedStaffName: row.staff_name,
      messages: messages.map((m) => ({ ...mapMessageRow(m), senderStaffName: m.staff_name })),
      handoffs: handoffs.map((h) => ({ id: h.id, reason: h.reason, urgency: h.urgency, status: h.status, createdAt: h.created_at })),
    };
  }

  function missingFields(p: { category: string | null; metal: string | null; karat: number | null; weight_grams: string | null; approved_price: string | null; stock_status: string | null; image_url: string | null }): MissingField[] {
    const out: MissingField[] = [];
    if (!p.category) out.push("category");
    if (!p.metal) out.push("metal");
    if (p.karat === null && (p.metal === null || p.metal.endsWith("gold"))) out.push("karat");
    if (!p.weight_grams) out.push("weight");
    if (!p.approved_price) out.push("price");
    if (!p.stock_status) out.push("stock");
    if (!p.image_url) out.push("image");
    return out;
  }

  /** Products carry no customer data: every active staff member may view the catalogue. */
  async function listProducts(_viewer: Viewer, filter: ProductFilter = {}): Promise<Page<ProductListRow> & { categories: string[] }> {
    const f = productFilterSchema.parse(filter);
    const params: unknown[] = [];
    const where: string[] = ["true"];
    if (f.q) where.push(`(p.name ilike $${params.push(likePattern(f.q))} or p.sku ilike $${params.length})`);
    if (f.category) where.push(`p.category = $${params.push(f.category)}`);
    if (f.stock) where.push(f.stock === "unknown" ? `p.stock_status is null` : `p.stock_status = $${params.push(f.stock)}`);
    const missingSql = {
      any: `(p.approved_price is null or p.weight_grams is null or p.stock_status is null or p.category is null or p.metal is null
             or not exists (select 1 from product_images i where i.product_id = p.id))`,
      price: `p.approved_price is null`,
      weight: `p.weight_grams is null`,
      karat: `p.karat is null`,
      stock: `p.stock_status is null`,
      image: `not exists (select 1 from product_images i where i.product_id = p.id)`,
    };
    if (f.missing) where.push(missingSql[f.missing]);
    const from = `from products p where ${where.join(" and ")}`;
    const [rows, total, categories] = await Promise.all([
      db.query<Record<string, any>>(
        `select p.*, (select url from product_images i where i.product_id = p.id
                       order by i.is_primary desc, i.sort_order, i.created_at limit 1) as image_url
           ${from} order by p.is_active desc, p.name, p.id limit ${PAGE_SIZE} offset ${(f.page - 1) * PAGE_SIZE}`,
        params,
      ),
      count(`select count(*)::int as n ${from}`, params),
      db.query<{ category: string }>(`select distinct category from products where category is not null order by 1`),
    ]);
    return {
      ...toPage(
        rows.map((r) => ({
          id: r.id,
          sku: r.sku,
          name: r.name,
          category: r.category,
          collection: r.collection,
          metal: r.metal,
          karat: r.karat,
          weightGrams: r.weight_grams,
          approvedPrice: r.approved_price,
          currency: r.currency,
          stockQuantity: r.stock_quantity,
          stockStatus: r.stock_status,
          isActive: r.is_active,
          imageUrl: r.image_url,
          missing: missingFields(r as never),
        })),
        total,
        f.page,
      ),
      categories: categories.map((c) => c.category),
    };
  }

  async function getProduct(viewer: Viewer, productId: string) {
    const id = parseInput(uuidSchema, productId, "product id");
    const row = await queryOne<ProductRow>(db, `select * from products where id = $1`, [id]);
    if (!row) throw new ProductNotFoundError({ id });
    const [images, links, interest] = await Promise.all([
      db.query<{ url: string; alt_text: string | null; is_primary: boolean }>(
        `select url, alt_text, is_primary from product_images where product_id = $1 order by is_primary desc, sort_order, created_at`,
        [id],
      ),
      can.viewSyncRecords(viewer)
        ? db.query<{ source: string; source_product_id: string; first_synced_at: Date; last_synced_at: Date }>(
            `select source, source_product_id, first_synced_at, last_synced_at from product_source_links where product_id = $1`,
            [id],
          )
        : Promise.resolve([]),
      count(`select count(*)::int as n from product_interests where product_id = $1`, [id]),
    ]);
    const product = mapProductRow(row);
    // Internal cost fields are for approvers only.
    const costs = can.viewSyncRecords(viewer) ? { makingCharge: product.makingCharge, stoneCost: product.stoneCost } : null;
    const { makingCharge: _m, stoneCost: _s, ...publicFields } = product;
    return {
      product: publicFields,
      costs,
      images: images.map((i) => ({ url: i.url, altText: i.alt_text, isPrimary: i.is_primary })),
      sourceLinks: links.map((l) => ({
        source: l.source,
        sourceProductId: l.source_product_id,
        firstSyncedAt: l.first_synced_at,
        lastSyncedAt: l.last_synced_at,
      })),
      interestCount: interest,
      missing: missingFields({ ...row, image_url: images[0]?.url ?? null }),
    };
  }

  /** Approved and pending product synchronisation/import batches (approvers only). */
  async function listSyncRecords(viewer: Viewer) {
    requireCapability(viewer, can.viewSyncRecords(viewer), "view product synchronisation records");
    const [approvals, applied, links] = await Promise.all([
      listApprovalRows({ kinds: ["product_sync", "product_import"], limit: 50 }),
      db.query<{ id: string; created_at: Date; output: Record<string, unknown>; actor_name: string | null; approval_id: string | null }>(
        `select a.id, a.created_at, a.output, s.full_name as actor_name, a.approval_id from agent_actions a
           left join staff s on s.id = a.actor_staff_id
          where a.action_type in ('product_sync', 'product_import') and a.status = 'succeeded'
          order by a.created_at desc limit 20`,
      ),
      count(`select count(*)::int as n from product_source_links`, []),
    ]);
    return {
      approvals,
      applied: applied.map((a) => ({ id: a.id, createdAt: a.created_at, output: a.output, actorName: a.actor_name, approvalId: a.approval_id })),
      linkedProducts: links,
    };
  }

  async function listFollowups(viewer: Viewer, bucketInput: unknown, page = 1) {
    const bucket = followupBucketSchema.parse(bucketInput);
    const p = pageSchema.parse(page);
    const now = clock();
    const params: unknown[] = [scopeStaffId(viewer), now];
    // ($2 is referenced in every bucket so all queries bind the same parameters.)
    const where = [`(${customerScopeSql("f.customer_id", "$1")} or f.assigned_staff_id = $1) and $2::timestamptz is not null`];
    const endOfToday = `(${startOfDay("$2")} + interval '1 day')`;
    where.push(
      {
        overdue: `f.status = 'pending' and f.scheduled_for < $2`,
        today: `f.status = 'pending' and f.scheduled_for >= $2 and f.scheduled_for < ${endOfToday}`,
        upcoming: `f.status = 'pending' and f.scheduled_for >= ${endOfToday}`,
        completed: `f.status = 'completed'`,
        cancelled: `f.status in ('cancelled', 'skipped')`,
      }[bucket],
    );
    const order = bucket === "completed" || bucket === "cancelled" ? `coalesce(f.completed_at, f.cancelled_at, f.updated_at) desc` : `f.scheduled_for asc`;
    const from = `from followups f join customers c on c.id = f.customer_id left join leads l on l.id = f.lead_id
      left join staff s on s.id = f.assigned_staff_id where ${where.join(" and ")}`;
    const [rows, total, counts] = await Promise.all([
      db.query<FollowupRow & { customer_name: string | null; do_not_contact: boolean; lead_status: LeadStatus | null; staff_name: string | null }>(
        `select f.*, c.full_name as customer_name, c.do_not_contact, l.status as lead_status, s.full_name as staff_name
           ${from} order by ${order}, f.id limit ${PAGE_SIZE} offset ${(p - 1) * PAGE_SIZE}`,
        params,
      ),
      count(`select count(*)::int as n ${from}`, params),
      queryOne<Record<FollowupBucket, number>>(
        db,
        `select count(*) filter (where f.status = 'pending' and f.scheduled_for < $2)::int as overdue,
                count(*) filter (where f.status = 'pending' and f.scheduled_for >= $2 and f.scheduled_for < ${endOfToday})::int as today,
                count(*) filter (where f.status = 'pending' and f.scheduled_for >= ${endOfToday})::int as upcoming,
                count(*) filter (where f.status = 'completed')::int as completed,
                count(*) filter (where f.status in ('cancelled', 'skipped'))::int as cancelled
           from followups f where ${where[0]}`,
        params,
      ),
    ]);
    return {
      bucket,
      counts: counts!,
      ...toPage<FollowupListRow>(
        rows.map((r) => {
          const fu = mapFollowupRow(r);
          return {
            id: fu.id,
            customerId: fu.customerId,
            customerName: r.customer_name,
            doNotContact: r.do_not_contact,
            leadId: fu.leadId,
            leadStatus: r.lead_status,
            followupType: fu.followupType,
            channel: fu.channel,
            scheduledFor: fu.scheduledFor,
            status: fu.status,
            note: fu.note,
            messageDraft: fu.messageDraft,
            outcomeNote: fu.outcomeNote,
            assignedStaffId: fu.assignedStaffId,
            assignedStaffName: r.staff_name,
            createdByType: fu.createdByType,
            completedAt: fu.completedAt,
            cancelledAt: fu.cancelledAt,
          };
        }),
        total,
        p,
      ),
    };
  }

  async function listHandoffs(viewer: Viewer, statusInput: unknown = "open"): Promise<HandoffListRow[]> {
    const status = z.enum(["open", "resolved"]).catch("open").parse(statusInput);
    const rows = await db.query<Record<string, any>>(
      `select h.*, c.full_name as customer_name, l.status as lead_status, l.score as lead_score,
              s.full_name as staff_name, v.human_takeover
         from handoffs h join conversations v on v.id = h.conversation_id
         left join customers c on c.id = h.customer_id left join leads l on l.id = h.lead_id
         left join staff s on s.id = h.assigned_staff_id
        where h.status = $2 and ($1::uuid is null or h.assigned_staff_id = $1
          or (h.status = 'open' and h.assigned_staff_id is null)
          or (h.customer_id is not null and ${customerScopeSql("h.customer_id", "$1")}))
        order by ${status === "open" ? `case h.urgency when 'urgent' then 0 when 'high' then 1 else 2 end, h.created_at` : `h.resolved_at desc`}
        limit 200`,
      [scopeStaffId(viewer), status],
    );
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      customerId: r.customer_id,
      customerName: r.customer_name,
      leadId: r.lead_id,
      leadStatus: r.lead_status,
      leadScore: r.lead_score,
      reason: r.reason,
      urgency: r.urgency,
      status: r.status,
      note: r.note,
      requestedByType: r.requested_by_type,
      assignedStaffId: r.assigned_staff_id,
      assignedStaffName: r.staff_name,
      humanTakeover: r.human_takeover,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
    }));
  }

  async function listApprovalRows(options: { status?: string; kinds?: string[]; limit?: number }): Promise<ApprovalListRow[]> {
    const rows = await db.query<Record<string, any>>(
      `select a.*, rs.full_name as requested_by_name, ds.full_name as decided_by_name, c.full_name as customer_name
         from approvals a left join staff rs on rs.id = a.requested_by_staff_id
         left join staff ds on ds.id = a.decided_by_staff_id left join customers c on c.id = a.customer_id
        where ($1::text is null or a.status = $1) and ($2::text[] is null or a.payload->>'kind' = any($2))
        order by case when a.status = 'pending' then 0 else 1 end, coalesce(a.decided_at, a.created_at) desc
        limit $3`,
      [options.status ?? null, options.kinds ?? null, options.limit ?? 100],
    );
    return rows.map((r) => ({
      id: r.id,
      actionType: r.action_type,
      status: r.status,
      reason: r.reason,
      payloadKind: typeof r.payload?.kind === "string" ? r.payload.kind : null,
      payload: r.payload ?? {},
      requestedByType: r.requested_by_type,
      requestedByName: r.requested_by_name,
      decidedByName: r.decided_by_name,
      decisionNote: r.decision_note,
      customerId: r.customer_id,
      customerName: r.customer_name,
      createdAt: r.created_at,
      decidedAt: r.decided_at,
    }));
  }

  async function listApprovals(viewer: Viewer, statusInput?: unknown, kindInput?: unknown) {
    requireCapability(viewer, can.decideApprovals(viewer), "view approvals");
    const status = z.enum(["pending", "approved", "rejected", "cancelled"]).optional().catch(undefined).parse(statusInput);
    const kind = z.enum(["imports"]).optional().catch(undefined).parse(kindInput);
    return listApprovalRows({ status, kinds: kind === "imports" ? ["product_sync", "product_import"] : undefined });
  }

  async function listActivityRows(
    scopeId: string | null,
    options: { category?: ActivityCategory; excludeNoisy?: boolean; limit?: number; page?: number },
  ): Promise<ActivityRow[]> {
    const params: unknown[] = [scopeId];
    const where = [`($1::uuid is null or (a.customer_id is not null and ${customerScopeSql("a.customer_id", "$1")}))`];
    if (options.excludeNoisy) where.push(`a.action_type <> all($${params.push(NOISY_ACTIONS)})`);
    if (options.category === "ai") where.push(`a.actor_type = 'ai'`);
    if (options.category === "sensitive") where.push(`(a.action_type = any($${params.push(SENSITIVE_ACTIONS)}) or a.requires_approval)`);
    if (options.category === "sign_in") where.push(`a.action_type like 'staff\\_%'`);
    const limit = options.limit ?? 50;
    const rows = await db.query<Record<string, any>>(
      `select a.id, a.action_type, a.tool_name, a.actor_type, s.full_name as actor_name, a.agent_name, a.customer_id,
              c.full_name as customer_name, a.status, a.error_message, a.created_at
         from agent_actions a left join staff s on s.id = a.actor_staff_id left join customers c on c.id = a.customer_id
        where ${where.join(" and ")} order by a.created_at desc, a.id limit ${limit} offset ${((options.page ?? 1) - 1) * limit}`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      actionType: r.action_type,
      toolName: r.tool_name,
      actorType: r.actor_type,
      actorName: r.actor_name,
      agentName: r.agent_name,
      customerId: r.customer_id,
      customerName: r.customer_name,
      status: r.status,
      errorMessage: r.error_message,
      createdAt: r.created_at,
    }));
  }

  async function listActivity(viewer: Viewer, categoryInput?: unknown, page = 1) {
    requireCapability(viewer, can.viewAudit(viewer), "view the activity log");
    const category = z.enum(["all", "ai", "sensitive", "sign_in"]).catch("all").parse(categoryInput ?? "all");
    return { category, rows: await listActivityRows(null, { category, limit: 50, page: pageSchema.parse(page) }) };
  }

  async function listOrders(viewer: Viewer) {
    const rows = await db.query<Record<string, any>>(
      `select o.id, o.order_number, o.customer_id, c.full_name, o.status, o.payment_status, o.currency, o.total, o.created_at
         from orders o join customers c on c.id = o.customer_id
        where ${customerScopeSql("o.customer_id", "$1")} order by o.created_at desc limit 200`,
      [scopeStaffId(viewer)],
    );
    return rows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      customerId: r.customer_id,
      customerName: r.full_name,
      status: r.status,
      paymentStatus: r.payment_status,
      currency: r.currency,
      total: r.total,
      createdAt: r.created_at,
    }));
  }

  /** Active staff for assignment pickers (names and availability only). */
  async function listStaff(_viewer: Viewer) {
    const rows = await db.query<{ id: string; full_name: string; role: string; is_available: boolean }>(
      `select id, full_name, role, is_available from staff where is_active order by full_name`,
    );
    return rows.map((r) => ({ id: r.id, fullName: r.full_name, role: r.role, isAvailable: r.is_available }));
  }

  return {
    assertCustomerVisible,
    getOverview,
    listCustomers,
    getCustomerDetail,
    listLeads,
    getLeadDetail,
    listConversations,
    getConversation,
    listProducts,
    getProduct,
    listSyncRecords,
    listFollowups,
    listHandoffs,
    listApprovals,
    listActivity,
    listOrders,
    listStaff,
  };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
