import { randomUUID } from "node:crypto";
import { LlmProviderError } from "../../agents/llm/llmClient.js";
import type { Db } from "../../database/db.js";
import { AppError } from "../../lib/errors.js";
import { mapFollowupRow, type Followup, type FollowupRow } from "../../schemas/crm.js";
import { systemClock, type ActionContext, type Clock } from "../../types/context.js";
import { recordAction } from "../auditService.js";
import { createFollowupService } from "../crm/followupService.js";
import { loadFollowupContext } from "./context.js";
import type { FollowupDrafter } from "./drafting.js";
import { createFollowupEngine, purposeOf } from "./engineService.js";
import { notifyTx } from "./notifications.js";
import { evaluateEligibility } from "./policy.js";
import { PURPOSE_META } from "./purposes.js";
import { getFollowupSettings } from "./settings.js";

/**
 * The follow-up processing worker. Safe to run from several processes at once:
 *
 *  - Claiming uses `FOR UPDATE SKIP LOCKED` plus a lease (`locked_until`), so a
 *    follow-up is processed by one worker at a time; a crashed worker's lease
 *    simply expires and another worker picks the follow-up up.
 *  - Every due follow-up is re-checked (opt-out, consent, closed lead,
 *    purchase, human takeover, customer reply) before anything is drafted.
 *  - Drafting is idempotent per follow-up and due time, so retries never
 *    create duplicate drafts.
 *  - Failures are retried a bounded number of times with backoff, recorded
 *    with an error code only (no message content), and raise a dashboard
 *    notification when retries are exhausted.
 *  - It never contacts a customer and never completes a follow-up.
 */

const LEASE_MS = 5 * 60_000;
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

/** Hard blockers that end a follow-up (it can never become eligible again). */
const TERMINAL = new Set(["do_not_contact", "consent_denied", "lead_closed", "no_purchase"]);

export interface WorkerRunSummary {
  workerId: string;
  claimed: number;
  drafted: number;
  reminders: number;
  held: number;
  cancelled: number;
  failed: number;
  exhausted: number;
  notificationsCreated: number;
}

function errorCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (error instanceof LlmProviderError) return error.retryable ? "LLM_PROVIDER_RETRYABLE" : "LLM_PROVIDER";
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code) ? `DB_${code}` : "INTERNAL_ERROR";
}

export function createFollowupWorker(db: Db, options: { drafter?: FollowupDrafter; clock?: Clock; workerId?: string } = {}) {
  const clock = options.clock ?? systemClock;
  const workerId = options.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
  const ctx: ActionContext = { actor: { type: "system", name: "followup_worker" }, requestId: workerId };
  const engine = createFollowupEngine(db, { clock, drafter: options.drafter });

  /** Claims up to `limit` due follow-ups for this worker. */
  async function claim(limit: number, maxAttempts: number): Promise<Followup[]> {
    const now = clock();
    return db.transaction(async (tx) => {
      const rows = await tx.query<FollowupRow>(
        `update followups f set processing_state = 'processing', locked_by = $1, locked_until = $2,
                processing_attempts = f.processing_attempts + 1, last_processed_at = $3
          where f.id in (
            select id from followups
             where status = 'pending' and scheduled_for <= $3 and processing_attempts < $4
               and (processing_state in ('scheduled', 'failed') or processing_state = 'processing')
               and (locked_until is null or locked_until < $3)
             order by case priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, scheduled_for
             limit $5
             for update skip locked)
          returning f.*`,
        [workerId, new Date(now.getTime() + LEASE_MS), now, maxAttempts, limit],
      );
      return rows.map(mapFollowupRow);
    });
  }

  /** Final state write — only if this worker still holds the lease. */
  async function finish(tx: Db, id: string, state: string, reason: string | null): Promise<boolean> {
    const rows = await tx.query(
      `update followups set processing_state = $3, blocked_reason = $4, locked_until = null, locked_by = null, last_error_code = null
        where id = $1 and locked_by = $2 and processing_state = 'processing' returning id`,
      [id, workerId, state, reason],
    );
    return rows.length > 0;
  }

  async function processOne(f: Followup, summary: WorkerRunSummary): Promise<void> {
    const now = clock();
    const purpose = purposeOf(f);
    const meta = PURPOSE_META[purpose];
    const context = await loadFollowupContext(db, f.customerId, { now, leadId: f.leadId });
    const eligibility = evaluateEligibility(context, purpose, { followup: f });

    if (!eligibility.allowed) {
      const blocker = eligibility.blockers[0]!;
      await db.transaction(async (tx) => {
        if (TERMINAL.has(blocker.code)) {
          await createFollowupService(tx, clock).cancelFollowup(f.id, ctx, `cancelled: ${blocker.code}`);
          await tx.query(`update followups set processing_state = 'blocked', blocked_reason = $2, locked_until = null, locked_by = null where id = $1`, [f.id, blocker.code]);
          summary.cancelled++;
        } else {
          await finish(tx, f.id, "blocked", blocker.code);
          if (await notifyTx(tx, { kind: "human_attention", severity: "warning", title: `Follow-up on hold: ${blocker.message}`, customerId: f.customerId, followupId: f.id, audienceStaffId: f.assignedStaffId, dedupeKey: `blocked:${f.id}:${blocker.code}` })) summary.notificationsCreated++;
          summary.held++;
        }
        await recordAction(tx, ctx, { actionType: "followup_processing_blocked", customerId: f.customerId, leadId: f.leadId, output: { followupId: f.id, reason: blocker.code, cancelled: TERMINAL.has(blocker.code) } });
      });
      return;
    }

    if (!meta.outreach) {
      // Internal reminder: nothing to draft — tell the responsible staff member.
      await db.transaction(async (tx) => {
        await finish(tx, f.id, "reminder_due", null);
        if (await notifyTx(tx, { kind: "human_attention", severity: f.priority === "urgent" || f.priority === "high" ? "warning" : "info", title: `${meta.label} due`, body: f.note, customerId: f.customerId, followupId: f.id, audienceStaffId: f.assignedStaffId, dedupeKey: `reminder:${f.id}:${f.scheduledFor.toISOString()}` })) summary.notificationsCreated++;
        await recordAction(tx, ctx, { actionType: "followup_reminder_due", customerId: f.customerId, output: { followupId: f.id } });
      });
      summary.reminders++;
      return;
    }

    if (eligibility.holds.length) {
      // Human takeover or a customer reply: no automatic drafting. Staff are told instead.
      const hold = eligibility.holds[0]!;
      await db.transaction(async (tx) => {
        await finish(tx, f.id, "blocked", hold.code);
        if (await notifyTx(tx, { kind: "human_attention", severity: "warning", title: hold.code === "human_takeover" ? "Follow-up due — conversation is with staff" : "Customer replied — review the follow-up", customerId: f.customerId, followupId: f.id, audienceStaffId: f.assignedStaffId, dedupeKey: `hold:${f.id}:${hold.code}:${f.scheduledFor.toISOString()}` })) summary.notificationsCreated++;
        await recordAction(tx, ctx, { actionType: "followup_processing_held", customerId: f.customerId, output: { followupId: f.id, reason: hold.code } });
      });
      summary.held++;
      return;
    }

    await engine.generateDraft(f.id, ctx, { sourceEventKey: `auto:${f.scheduledFor.toISOString()}` });
    summary.drafted++;
  }

  async function recordFailure(f: Followup, error: unknown, maxAttempts: number, summary: WorkerRunSummary): Promise<void> {
    const code = errorCode(error);
    const exhausted = f.processingAttempts >= maxAttempts;
    const retryAt = new Date(clock().getTime() + BACKOFF_MS[Math.min(f.processingAttempts - 1, BACKOFF_MS.length - 1)]!);
    summary.failed++;
    try {
      await db.transaction(async (tx) => {
        await tx.query(
          `update followups set processing_state = 'failed', last_error_code = $3, locked_by = null, locked_until = $4
            where id = $1 and locked_by = $2`,
          [f.id, workerId, code, exhausted ? null : retryAt],
        );
        if (exhausted) {
          summary.exhausted++;
          if (await notifyTx(tx, { kind: "processing_failed", severity: "critical", title: "Follow-up processing failed", body: `Stopped after ${f.processingAttempts} attempts (${code}). Reschedule to try again.`, customerId: f.customerId, followupId: f.id, dedupeKey: `failed:${f.id}:${f.processingAttempts}` })) summary.notificationsCreated++;
        }
        await recordAction(tx, ctx, { actionType: "followup_processing_failed", customerId: f.customerId, status: "failed", errorMessage: code, output: { followupId: f.id, attempt: f.processingAttempts, exhausted } });
      });
    } catch {
      // The database itself is failing: leave the lease to expire; the follow-up is retried later.
    }
  }

  /** Overdue follow-ups and customers waiting for a person → dashboard notifications. */
  async function refreshNotifications(): Promise<number> {
    const now = clock();
    let created = 0;
    const overdue = await db.query<{ id: string; customer_id: string; assigned_staff_id: string | null; scheduled_for: Date }>(
      `select id, customer_id, assigned_staff_id, scheduled_for from followups
        where status = 'pending' and scheduled_for < $1 and processing_state not in ('approved') order by scheduled_for limit 200`,
      [new Date(now.getTime() - 3_600_000)],
    );
    const handoffs = await db.query<{ id: string; customer_id: string | null; assigned_staff_id: string | null; urgency: string; reason: string }>(
      `select id, customer_id, assigned_staff_id, urgency, reason from handoffs where status = 'open' limit 200`,
    );
    await db.transaction(async (tx) => {
      for (const o of overdue) {
        if (await notifyTx(tx, { kind: "overdue_followup", severity: "warning", title: "Overdue follow-up", customerId: o.customer_id, followupId: o.id, audienceStaffId: o.assigned_staff_id, dedupeKey: `overdue:${o.id}:${o.scheduled_for.toISOString()}` })) created++;
      }
      for (const h of handoffs) {
        if (await notifyTx(tx, { kind: "human_attention", severity: h.urgency === "urgent" ? "critical" : "warning", title: `Customer waiting for a person (${h.reason.replace(/_/g, " ")})`, customerId: h.customer_id, handoffId: h.id, audienceStaffId: h.assigned_staff_id, dedupeKey: `handoff:${h.id}` })) created++;
      }
      // Notifications about things that are no longer open resolve themselves.
      await tx.query(
        `update notifications n set resolved_at = now()
          where n.resolved_at is null and (
            (n.followup_id is not null and exists (select 1 from followups f where f.id = n.followup_id and f.status <> 'pending'))
            or (n.handoff_id is not null and exists (select 1 from handoffs h where h.id = n.handoff_id and h.status = 'resolved')))`,
      );
    });
    return created;
  }

  async function runOnce(opts: { limit?: number } = {}): Promise<WorkerRunSummary> {
    const settings = await getFollowupSettings(db);
    const summary: WorkerRunSummary = { workerId, claimed: 0, drafted: 0, reminders: 0, held: 0, cancelled: 0, failed: 0, exhausted: 0, notificationsCreated: 0 };
    const claimed = await claim(Math.min(opts.limit ?? 20, 100), settings.maxProcessingAttempts);
    summary.claimed = claimed.length;
    for (const f of claimed) {
      try {
        await processOne(f, summary);
      } catch (error) {
        await recordFailure(f, error, settings.maxProcessingAttempts, summary);
      }
    }
    try {
      summary.notificationsCreated += await refreshNotifications();
      if (summary.claimed > 0) await recordAction(db, ctx, { actionType: "followup_worker_run", output: { ...summary } });
    } catch {
      // Notification refresh is best-effort; the next run repeats it.
    }
    return summary;
  }

  return { workerId, runOnce, refreshNotifications };
}

export type FollowupWorker = ReturnType<typeof createFollowupWorker>;
