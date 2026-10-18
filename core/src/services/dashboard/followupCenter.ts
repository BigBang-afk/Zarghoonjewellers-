import { z } from "zod";
import { queryOne, type Db } from "../../database/db.js";
import { startOfBusinessDay } from "../../lib/businessTime.js";
import { FollowupNotFoundError } from "../../lib/errors.js";
import { parseInput, uuidSchema } from "../../lib/validation.js";
import { mapFollowupRow, type FollowupRow } from "../../schemas/crm.js";
import { systemClock, type Clock } from "../../types/context.js";
import { loadFollowupContext } from "../followupEngine/context.js";
import { mapDraftRow, purposeOf, type FollowupDraft } from "../followupEngine/engineService.js";
import { evaluateEligibility } from "../followupEngine/policy.js";
import { PURPOSE_META } from "../followupEngine/purposes.js";
import { listRecommendations } from "../followupEngine/recommendations.js";
import { getFollowupSettings } from "../followupEngine/settings.js";
import { can, customerScopeSql, scopeStaffId, type Viewer } from "./access.js";

/**
 * Read model for the AI Follow-up Center, the notification bell and
 * follow-up analytics. Every query is scoped to the viewer (sales/support see
 * only follow-ups for their customers or assigned to them). Figures are
 * counted from stored rows; delivery and attribution are reported as not
 * available because no delivery channel exists yet.
 */

export const CENTER_TABS = ["due_today", "overdue", "upcoming", "review", "approved", "attention", "completed", "cancelled", "history"] as const;
export type CenterTab = (typeof CENTER_TABS)[number];
const PAGE = 25;

export interface CenterRow {
  id: string;
  customerId: string;
  customerName: string | null;
  doNotContact: boolean;
  contactConsent: string;
  purpose: string;
  purposeLabel: string;
  outreach: boolean;
  priority: string;
  scheduledFor: Date;
  status: string;
  processingState: string;
  blockedReason: string | null;
  lastErrorCode: string | null;
  quietHoursAdjusted: boolean;
  outcomeNote: string | null;
  sequenceStep: number | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  leadScore: number | null;
  leadClassification: string | null;
  productName: string | null;
  productSku: string | null;
  draft: { id: string; status: string; content: string; language: string; authorType: string; version: number } | null;
}

export function createFollowupCenter(db: Db, options: { clock?: Clock } = {}) {
  const clock = options.clock ?? systemClock;
  const scope = (alias: string, p: string) => `(${customerScopeSql(`${alias}.customer_id`, p)} or ${alias}.assigned_staff_id = ${p})`;

  async function bounds() {
    const now = clock();
    const tz = (await getFollowupSettings(db)).timezone;
    const start = startOfBusinessDay(now, tz);
    return { now, endOfToday: new Date(startOfBusinessDay(new Date(start.getTime() + 36 * 3_600_000), tz).getTime()) };
  }

  const TAB_SQL: Record<CenterTab, string> = {
    due_today: `f.status = 'pending' and f.scheduled_for >= $2 and f.scheduled_for < $3`,
    overdue: `f.status = 'pending' and f.scheduled_for < $2 and f.processing_state not in ('approved')`,
    upcoming: `f.status = 'pending' and f.scheduled_for >= $3`,
    review: `f.status = 'pending' and exists (select 1 from followup_drafts d where d.followup_id = f.id and d.status = 'pending_review')`,
    approved: `f.status = 'pending' and f.processing_state = 'approved'`,
    attention: `f.status = 'pending' and f.processing_state in ('blocked', 'failed', 'reminder_due')`,
    completed: `f.status = 'completed'`,
    cancelled: `f.status in ('cancelled', 'skipped')`,
    history: `true`,
  };

  async function list(viewer: Viewer, tabInput: unknown, pageInput: unknown = 1) {
    const tab = z.enum(CENTER_TABS).catch("due_today").parse(tabInput);
    const page = z.coerce.number().int().min(1).max(1000).catch(1).parse(pageInput);
    const { now, endOfToday } = await bounds();
    // $2 / $3 appear in every query so all bind the same parameters.
    const params = [scopeStaffId(viewer), now, endOfToday];
    const where = `${scope("f", "$1")} and $2::timestamptz is not null and $3::timestamptz is not null`;
    const from = `from followups f join customers c on c.id = f.customer_id
      left join leads l on l.id = f.lead_id left join staff s on s.id = f.assigned_staff_id
      left join lateral (select p.name, p.sku from products p
                          where p.id = coalesce(f.product_id, (select pi.product_id from product_interests pi
                                                               where pi.customer_id = f.customer_id order by pi.created_at desc limit 1))) pr on true
      left join lateral (select * from followup_drafts d where d.followup_id = f.id
                          order by (d.status in ('pending_review', 'approved')) desc, d.version desc limit 1) d on true`;
    const order = tab === "completed" || tab === "cancelled" || tab === "history" ? "f.updated_at desc" : "case f.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, f.scheduled_for";
    const [rows, total, counts] = await Promise.all([
      db.query<Record<string, any>>(
        `select f.*, c.full_name, c.do_not_contact, c.contact_consent, s.full_name as staff_name, l.score as lead_score,
                l.score_classification, pr.name as product_name, pr.sku as product_sku,
                d.id as draft_id, d.status as draft_status, d.content as draft_content, d.language as draft_language,
                d.author_type as draft_author, d.version as draft_version
           ${from} where ${where} and ${TAB_SQL[tab]} order by ${order}, f.id limit ${PAGE} offset ${(page - 1) * PAGE}`,
        params,
      ),
      queryOne<{ n: number }>(db, `select count(*)::int as n from followups f where ${where} and ${TAB_SQL[tab]}`, params),
      queryOne<Record<CenterTab, number>>(
        db,
        `select ${CENTER_TABS.map((t) => `count(*) filter (where ${TAB_SQL[t]})::int as ${t}`).join(", ")} from followups f where ${where}`,
        params,
      ),
    ]);
    return {
      tab,
      page,
      pageSize: PAGE,
      total: total!.n,
      counts: counts!,
      rows: rows.map((r): CenterRow => {
        const f = mapFollowupRow(r as FollowupRow);
        const purpose = purposeOf(f);
        return {
          id: f.id,
          customerId: f.customerId,
          customerName: r.full_name,
          doNotContact: r.do_not_contact,
          contactConsent: r.contact_consent,
          purpose,
          purposeLabel: PURPOSE_META[purpose].label,
          outreach: PURPOSE_META[purpose].outreach,
          priority: f.priority,
          scheduledFor: f.scheduledFor,
          status: f.status,
          processingState: f.processingState,
          blockedReason: f.blockedReason,
          lastErrorCode: f.lastErrorCode,
          quietHoursAdjusted: f.quietHoursAdjusted,
          outcomeNote: f.outcomeNote,
          sequenceStep: f.sequenceStep,
          assignedStaffId: f.assignedStaffId,
          assignedStaffName: r.staff_name,
          leadScore: r.lead_score,
          leadClassification: r.score_classification,
          productName: r.product_name,
          productSku: r.product_sku,
          draft: r.draft_id
            ? { id: r.draft_id, status: r.draft_status, content: r.draft_content, language: r.draft_language, authorType: r.draft_author, version: r.draft_version }
            : null,
        };
      }),
    };
  }

  /** Throws "not found" unless the follow-up is within the viewer's scope. */
  async function assertVisible(viewer: Viewer, followupId: string) {
    const ok = await queryOne<{ id: string }>(db, `select id from followups f where f.id = $1 and ${scope("f", "$2")}`, [followupId, scopeStaffId(viewer)]);
    if (!ok) throw new FollowupNotFoundError({ id: followupId });
  }

  async function detail(viewer: Viewer, followupId: string) {
    const id = parseInput(uuidSchema, followupId, "follow-up id");
    await assertVisible(viewer, id);
    const row = await queryOne<FollowupRow & { full_name: string | null; staff_name: string | null }>(
      db,
      `select f.*, c.full_name, s.full_name as staff_name from followups f join customers c on c.id = f.customer_id
         left join staff s on s.id = f.assigned_staff_id where f.id = $1`,
      [id],
    );
    const f = mapFollowupRow(row!);
    const purpose = purposeOf(f);
    const now = clock();
    const context = await loadFollowupContext(db, f.customerId, { now, leadId: f.leadId });
    const eligibility = evaluateEligibility(context, purpose, { followup: f });
    const [drafts, audit, enrollment] = await Promise.all([
      db.query<Record<string, unknown>>(`select * from followup_drafts where followup_id = $1 order by version desc`, [id]),
      db.query<{ action_type: string; actor_type: string; actor_name: string | null; status: string; created_at: Date; error_message: string | null }>(
        `select a.action_type, a.actor_type, s.full_name as actor_name, a.status, a.created_at, a.error_message
           from agent_actions a left join staff s on s.id = a.actor_staff_id
          where a.input->>'followupId' = $1 or a.output->>'followupId' = $1
             or (a.action_type like 'followup_draft_%' and a.output->>'draftId' in (select id::text from followup_drafts where followup_id = $2))
          order by a.created_at desc, a.id limit 50`,
        [id, id],
      ),
      f.enrollmentId
        ? queryOne<{ step_days: number[]; status: string; stopped_reason: string | null }>(db, `select step_days, status, stopped_reason from followup_enrollments where id = $1`, [f.enrollmentId])
        : Promise.resolve(null),
    ]);
    const product = f.productId ? context.interests.find((i) => i.productId === f.productId) ?? null : context.interests[0] ?? null;
    return {
      followup: f,
      purpose,
      purposeLabel: PURPOSE_META[purpose].label,
      outreach: PURPOSE_META[purpose].outreach,
      customer: context.customer,
      customerName: row!.full_name,
      assignedStaffName: row!.staff_name,
      lead: context.lead,
      leadScore: context.leadScore,
      product,
      latestCustomerMessage: context.latestCustomerMessage,
      humanTakeover: context.humanTakeover,
      eligibility,
      drafts: drafts.map(mapDraftRow) as FollowupDraft[],
      audit: audit.map((a) => ({ actionType: a.action_type, actorType: a.actor_type, actorName: a.actor_name, status: a.status, createdAt: a.created_at, errorMessage: a.error_message })),
      enrollment: enrollment ? { stepDays: enrollment.step_days.map(Number), status: enrollment.status, stoppedReason: enrollment.stopped_reason } : null,
    };
  }

  async function recommendations(viewer: Viewer, limit = 20) {
    return listRecommendations(db, scopeStaffId(viewer), clock(), limit);
  }

  // --- Notifications ---------------------------------------------------------------------

  const audienceSql = (p: string) => `(n.audience_staff_id = ${p} or ($2::boolean and n.audience_staff_id is null))`;

  async function notifications(viewer: Viewer, opts: { includeResolved?: boolean; limit?: number } = {}) {
    const rows = await db.query<Record<string, any>>(
      `select n.*, c.full_name as customer_name, (r.staff_id is not null) as is_read
         from notifications n left join customers c on c.id = n.customer_id
         left join notification_reads r on r.notification_id = n.id and r.staff_id = $1
        where ${audienceSql("$1")} and ($3::boolean or n.resolved_at is null)
        order by n.resolved_at is null desc, n.created_at desc limit $4`,
      [viewer.id, can.viewAllCustomers(viewer), opts.includeResolved ?? false, Math.min(opts.limit ?? 50, 200)],
    );
    return rows.map((r) => ({
      id: r.id as string,
      kind: r.kind as string,
      severity: r.severity as string,
      title: r.title as string,
      body: r.body as string | null,
      customerId: r.customer_id as string | null,
      customerName: r.customer_name as string | null,
      followupId: r.followup_id as string | null,
      handoffId: r.handoff_id as string | null,
      createdAt: r.created_at as Date,
      resolvedAt: r.resolved_at as Date | null,
      read: r.is_read as boolean,
    }));
  }

  async function unreadCount(viewer: Viewer): Promise<number> {
    const r = await queryOne<{ n: number }>(
      db,
      `select count(*)::int as n from notifications n
        where ${audienceSql("$1")} and n.resolved_at is null
          and not exists (select 1 from notification_reads r where r.notification_id = n.id and r.staff_id = $1)`,
      [viewer.id, can.viewAllCustomers(viewer)],
    );
    return r!.n;
  }

  async function markRead(viewer: Viewer, ids: unknown) {
    const list = parseInput(z.array(uuidSchema).max(200), ids, "notification ids");
    if (!list.length) return 0;
    const rows = await db.query(
      `insert into notification_reads (notification_id, staff_id)
       select n.id, $1 from notifications n where n.id = any($3::uuid[]) and ${audienceSql("$1")}
       on conflict do nothing returning notification_id`,
      [viewer.id, can.viewAllCustomers(viewer), list],
    );
    return rows.length;
  }

  // --- Analytics ----------------------------------------------------------------------------

  async function analytics(viewer: Viewer) {
    const params = [scopeStaffId(viewer), clock()];
    const where = `${scope("f", "$1")} and $2::timestamptz is not null`;
    const r = await queryOne<Record<string, number>>(
      db,
      `select count(*)::int as scheduled,
              count(*) filter (where f.status = 'pending')::int as pending,
              count(*) filter (where f.status = 'completed')::int as completed,
              count(*) filter (where f.status in ('cancelled', 'skipped'))::int as cancelled,
              count(*) filter (where f.status = 'pending' and f.scheduled_for < $2)::int as overdue,
              count(*) filter (where f.customer_replied_at is not null)::int as customer_replied
         from followups f where ${where}`,
      params,
    );
    const d = await queryOne<Record<string, number>>(
      db,
      `select count(*)::int as created,
              count(*) filter (where d.author_type = 'ai')::int as by_ai,
              count(*) filter (where d.author_type = 'template')::int as by_template,
              count(*) filter (where d.author_type = 'staff')::int as by_staff,
              count(*) filter (where d.status = 'approved')::int as approved,
              count(*) filter (where d.status = 'rejected')::int as rejected,
              count(*) filter (where d.status = 'pending_review')::int as awaiting_review
         from followup_drafts d join followups f on f.id = d.followup_id where ${where}`,
      params,
    );
    const byPurpose = await db.query<{ purpose: string | null; followup_type: string; n: number }>(
      `select f.purpose, f.followup_type, count(*)::int as n from followups f where ${where} group by 1, 2 order by 3 desc`,
      params,
    );
    return {
      followups: r!,
      drafts: d!,
      byPurpose: byPurpose.map((p) => ({ purpose: p.purpose, followupType: p.followup_type, count: p.n })),
      // No delivery channel is connected, so these cannot be measured honestly yet.
      delivered: { value: null, reason: "No delivery channel is connected; nothing has been sent." },
      averageResponseTime: { value: null, reason: "Requires delivery tracking: a reply can only be attributed to a message that was actually sent." },
      conversion: { value: null, reason: "Follow-up-to-sale attribution is not reliable until messages are delivered and tracked." },
    };
  }

  return { list, detail, assertVisible, recommendations, notifications, unreadCount, markRead, analytics };
}

export type FollowupCenter = ReturnType<typeof createFollowupCenter>;
