import { z } from "zod";
import { isUniqueViolation, queryOne, type Db } from "../../database/db.js";
import { nextAllowedTime } from "../../lib/businessTime.js";
import { FollowupNotAllowedError, FollowupNotFoundError, InvalidStateError, NotFoundError, ValidationError } from "../../lib/errors.js";
import { optionalText, parseInput, timestampSchema, uuidSchema } from "../../lib/validation.js";
import {
  CONTACT_CONSENTS,
  FOLLOWUP_PRIORITIES,
  FOLLOWUP_PURPOSES,
  mapFollowupRow,
  type Followup,
  type FollowupPurpose,
  type FollowupRow,
  type FollowupType,
} from "../../schemas/crm.js";
import { systemClock, type ActionContext, type Clock } from "../../types/context.js";
import { recordAction } from "../auditService.js";
import { createFollowupService, MAX_SCHEDULE_DAYS } from "../crm/followupService.js";
import { createHandoffService } from "../crm/handoffService.js";
import { requireStaffActor } from "../staffRules.js";
import { loadFollowupContext } from "./context.js";
import { buildDraftFacts, createTemplateDrafter, validateDraft, type DraftLanguage, type FollowupDrafter } from "./drafting.js";
import { haltAllOutreachTx } from "./hooks.js";
import { notifyTx, resolveFollowupNotificationsTx } from "./notifications.js";
import { evaluateEligibility } from "./policy.js";
import { PURPOSE_META } from "./purposes.js";
import { getFollowupSettings } from "./settings.js";

/**
 * The follow-up engine's staff-facing operations. Every operation:
 *  - requires an active staff member (or, for drafting, the worker),
 *  - re-checks deterministic eligibility,
 *  - is idempotent where a retry could duplicate work,
 *  - is audited.
 * Nothing here contacts a customer: drafts are approved "for a future
 * permitted channel" and wait there.
 */

const DAY = 86_400_000;
const LEGACY_PURPOSE: Record<FollowupType, FollowupPurpose> = {
  sales: "product_interest",
  after_sales: "post_purchase_care",
  order_update: "custom_order",
  service: "review_request",
  other: "staff_callback",
};
export const purposeOf = (f: Followup): FollowupPurpose => f.purpose ?? LEGACY_PURPOSE[f.followupType];

export interface FollowupDraft {
  id: string;
  followupId: string;
  version: number;
  language: DraftLanguage;
  content: string;
  status: "pending_review" | "approved" | "rejected" | "superseded";
  authorType: "ai" | "template" | "staff";
  authorStaffId: string | null;
  model: string | null;
  sourceEventKey: string;
  facts: Record<string, unknown>;
  validation: Record<string, unknown>;
  rationale: string | null;
  reviewedByStaffId: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
}

export function mapDraftRow(r: Record<string, any>): FollowupDraft {
  return {
    id: r.id,
    followupId: r.followup_id,
    version: r.version,
    language: r.language,
    content: r.content,
    status: r.status,
    authorType: r.author_type,
    authorStaffId: r.author_staff_id,
    model: r.model,
    sourceEventKey: r.source_event_key,
    facts: r.facts,
    validation: r.validation,
    rationale: r.rationale,
    reviewedByStaffId: r.reviewed_by_staff_id,
    reviewedAt: r.reviewed_at,
    reviewNote: r.review_note,
    createdAt: r.created_at,
  };
}

const idempotencyKey = z.string().trim().min(8).max(200);

export const engineScheduleSchema = z
  .object({
    customerId: uuidSchema,
    leadId: uuidSchema.optional(),
    purpose: z.enum(FOLLOWUP_PURPOSES),
    priority: z.enum(FOLLOWUP_PRIORITIES).optional(),
    productId: uuidSchema.optional(),
    scheduledFor: timestampSchema.optional(),
    delayDays: z.number().int().min(0).max(MAX_SCHEDULE_DAYS).optional(),
    assignedStaffId: uuidSchema.optional(),
    note: optionalText(2000),
    idempotencyKey,
  })
  .strict()
  .refine((d) => (d.scheduledFor === undefined) !== (d.delayDays === undefined), { message: "Give either scheduledFor or delayDays" });

export const enrollSchema = z
  .object({
    customerId: uuidSchema,
    leadId: uuidSchema.optional(),
    purpose: z.enum(FOLLOWUP_PURPOSES).refine((p) => PURPOSE_META[p].outreach, "Sequences are for customer follow-ups"),
    productId: uuidSchema.optional(),
    stepDays: z.array(z.number().int().min(1).max(60)).min(1).max(5).optional(),
    assignedStaffId: uuidSchema.optional(),
    idempotencyKey,
  })
  .strict();

export function createFollowupEngine(db: Db, options: { clock?: Clock; drafter?: FollowupDrafter } = {}) {
  const clock = options.clock ?? systemClock;
  const drafter = options.drafter ?? createTemplateDrafter();

  async function loadFollowup(tx: Db, id: string, lock = false): Promise<Followup> {
    const row = await queryOne<FollowupRow>(tx, `select * from followups where id = $1 ${lock ? "for update" : ""}`, [id]);
    if (!row) throw new FollowupNotFoundError({ id });
    return mapFollowupRow(row);
  }

  async function loadDraft(tx: Db, id: string, lock = false): Promise<FollowupDraft> {
    const row = await queryOne<Record<string, unknown>>(tx, `select * from followup_drafts where id = $1 ${lock ? "for update" : ""}`, [id]);
    if (!row) throw new NotFoundError("Draft not found", { id });
    return mapDraftRow(row);
  }

  const byKey = async (tx: Db, key: string) => {
    const row = await queryOne<FollowupRow>(tx, `select * from followups where idempotency_key = $1`, [key]);
    return row ? mapFollowupRow(row) : null;
  };

  function blockedError(issue: { code: FollowupNotAllowedError["reason"]; message: string }) {
    return new FollowupNotAllowedError(issue.code, issue.message);
  }

  /**
   * Staff schedule a follow-up with a purpose. Idempotent by key: a retried
   * request returns the follow-up created the first time. Customer outreach
   * is moved out of quiet hours (business time zone).
   */
  async function scheduleFollowup(
    input: z.input<typeof engineScheduleSchema>,
    ctx: ActionContext,
    extra: { enrollmentId?: string; sequenceStep?: number } = {},
  ): Promise<{ followup: Followup; created: boolean }> {
    const data = parseInput(engineScheduleSchema, input, "follow-up");
    const existing = await byKey(db, data.idempotencyKey);
    if (existing) return { followup: existing, created: false };
    const meta = PURPOSE_META[data.purpose];
    const now = clock();
    try {
      return await db.transaction(async (tx) => {
        await requireStaffActor(tx, ctx, "schedule follow-ups");
        const context = await loadFollowupContext(tx, data.customerId, { now, leadId: data.leadId });
        const eligibility = evaluateEligibility(context, data.purpose, { scheduling: true });
        if (!eligibility.allowed) throw blockedError(eligibility.blockers[0]!);

        const settings = await getFollowupSettings(tx);
        const requested = data.scheduledFor ?? new Date(now.getTime() + (data.delayDays ?? 0) * DAY + (data.delayDays === 0 ? 60_000 : 0));
        const scheduledFor = meta.outreach ? nextAllowedTime(requested, settings.quietHours) : requested;
        const leadId = data.leadId ?? (context.lead && !["won", "lost", "do_not_contact"].includes(context.lead.status) ? context.lead.id : undefined);
        const productId = data.productId ?? context.interests[0]?.productId;

        const base = await createFollowupService(tx, clock).scheduleFollowup(
          {
            customerId: data.customerId,
            leadId,
            assignedStaffId: data.assignedStaffId,
            followupType: meta.followupType,
            scheduledFor,
            note: data.note ?? undefined,
          },
          ctx,
        );
        const priority = data.priority ?? "normal";
        const row = await queryOne<FollowupRow>(
          tx,
          `update followups set purpose = $2, priority = $3, product_id = $4, idempotency_key = $5,
                  quiet_hours_adjusted = $6, enrollment_id = $7, sequence_step = $8
            where id = $1 returning *`,
          [base.id, data.purpose, priority, productId ?? null, data.idempotencyKey, scheduledFor.getTime() !== requested.getTime(), extra.enrollmentId ?? null, extra.sequenceStep ?? null],
        );
        const followup = mapFollowupRow(row!);
        if (priority === "high" || priority === "urgent") {
          await notifyTx(tx, {
            kind: "high_priority_followup",
            severity: priority === "urgent" ? "critical" : "warning",
            title: `${priority === "urgent" ? "Urgent" : "High-priority"} follow-up: ${meta.label}`,
            customerId: followup.customerId,
            followupId: followup.id,
            audienceStaffId: followup.assignedStaffId,
            dedupeKey: `high:${followup.id}`,
          });
        }
        await recordAction(tx, ctx, {
          actionType: "followup_engine_scheduled",
          customerId: followup.customerId,
          leadId: followup.leadId,
          input: { purpose: data.purpose, priority, idempotencyKey: data.idempotencyKey },
          output: { followupId: followup.id, scheduledFor: scheduledFor.toISOString(), quietHoursAdjusted: followup.quietHoursAdjusted },
        });
        return { followup, created: true };
      });
    } catch (error) {
      if (isUniqueViolation(error, "followups_idempotency_key")) {
        const again = await byKey(db, data.idempotencyKey);
        if (again) return { followup: again, created: false };
      }
      throw error;
    }
  }

  /** Opt-in day-N sequence (e.g. 1/3/7). Only the next step exists at any time. */
  async function enrollSequence(input: z.input<typeof enrollSchema>, ctx: ActionContext) {
    const data = parseInput(enrollSchema, input, "follow-up sequence");
    const found = await queryOne<{ id: string }>(db, `select id from followup_enrollments where idempotency_key = $1`, [data.idempotencyKey]);
    if (found) return { enrollmentId: found.id, created: false };
    const staff = await requireStaffActor(db, ctx, "start follow-up sequences");
    const days = data.stepDays ?? (await getFollowupSettings(db)).defaultSequenceDays;
    // Tie the sequence to the active lead so closing that lead stops it.
    const leadId =
      data.leadId ??
      (await queryOne<{ id: string }>(db, `select id from leads where customer_id = $1 and status not in ('won', 'lost', 'do_not_contact') order by created_at desc limit 1`, [data.customerId]))?.id;
    try {
      return await db.transaction(async (tx) => {
        const row = await queryOne<{ id: string }>(
          tx,
          `insert into followup_enrollments (customer_id, lead_id, product_id, purpose, step_days, created_by_staff_id, idempotency_key)
           values ($1, $2, $3, $4, $5::smallint[], $6, $7) returning id`,
          [data.customerId, leadId ?? null, data.productId ?? null, data.purpose, days, staff.id, data.idempotencyKey],
        );
        // Same transaction: the first step and the enrollment commit together or not at all.
        await createFollowupEngine(tx, options).scheduleFollowup(
          {
            customerId: data.customerId,
            leadId,
            purpose: data.purpose,
            productId: data.productId,
            delayDays: days[0]!,
            assignedStaffId: data.assignedStaffId,
            idempotencyKey: `${data.idempotencyKey}:step1`,
          },
          ctx,
          { enrollmentId: row!.id, sequenceStep: 1 },
        );
        await recordAction(tx, ctx, { actionType: "followup_sequence_started", customerId: data.customerId, input: { purpose: data.purpose, stepDays: days } });
        return { enrollmentId: row!.id, created: true };
      });
    } catch (error) {
      if (isUniqueViolation(error, "followup_enrollments_one_active")) {
        throw new InvalidStateError("This customer already has an active sequence for that purpose");
      }
      if (isUniqueViolation(error, "followup_enrollments_idempotency_key")) {
        const again = await queryOne<{ id: string }>(db, `select id from followup_enrollments where idempotency_key = $1`, [data.idempotencyKey]);
        if (again) return { enrollmentId: again.id, created: false };
      }
      throw error;
    }
  }

  /** After a sequence step is completed, schedule the next one (if still eligible). */
  async function advanceSequenceTx(tx: Db, followup: Followup, ctx: ActionContext): Promise<void> {
    if (!followup.enrollmentId) return;
    const e = await queryOne<{ id: string; status: string; step_days: number[]; next_step: number; purpose: FollowupPurpose; lead_id: string | null; product_id: string | null; created_at: Date; idempotency_key: string }>(
      tx,
      `select * from followup_enrollments where id = $1 for update`,
      [followup.enrollmentId],
    );
    if (!e || e.status !== "active") return;
    const step = (followup.sequenceStep ?? e.next_step) + 1;
    const days = e.step_days.map(Number);
    if (step > days.length) {
      await tx.query(`update followup_enrollments set status = 'completed', next_step = $2 where id = $1`, [e.id, step]);
      return;
    }
    const now = clock();
    const context = await loadFollowupContext(tx, followup.customerId, { now, leadId: e.lead_id });
    const eligibility = evaluateEligibility(context, e.purpose, { scheduling: true });
    if (!eligibility.allowed) {
      await tx.query(`update followup_enrollments set status = 'stopped', stopped_reason = $2 where id = $1`, [e.id, eligibility.blockers[0]!.code]);
      return;
    }
    const due = new Date(Math.max(e.created_at.getTime() + days[step - 1]! * DAY, now.getTime() + 3_600_000));
    await tx.query(`update followup_enrollments set next_step = $2 where id = $1`, [e.id, step]);
    await createFollowupEngine(tx, options).scheduleFollowup(
      {
        customerId: followup.customerId,
        leadId: e.lead_id ?? undefined,
        purpose: e.purpose,
        productId: e.product_id ?? undefined,
        scheduledFor: due.toISOString(),
        assignedStaffId: followup.assignedStaffId ?? undefined,
        idempotencyKey: `${e.idempotency_key}:step${step}`,
      },
      ctx,
      { enrollmentId: e.id, sequenceStep: step },
    );
  }

  /**
   * Drafts a customer message for a follow-up. Idempotent per
   * `sourceEventKey`. The model call happens outside any transaction; the
   * result is stored after re-checking the follow-up is still eligible.
   */
  async function generateDraft(followupId: string, ctx: ActionContext, opts: { sourceEventKey: string }): Promise<FollowupDraft> {
    const id = parseInput(uuidSchema, followupId, "follow-up id");
    const eventKey = parseInput(z.string().trim().min(1).max(200), opts.sourceEventKey, "event key");
    if (ctx.actor.type === "staff") await requireStaffActor(db, ctx, "generate follow-up drafts");
    const existing = await queryOne<Record<string, unknown>>(db, `select * from followup_drafts where followup_id = $1 and source_event_key = $2`, [id, eventKey]);
    if (existing) return mapDraftRow(existing);

    const followup = await loadFollowup(db, id);
    if (followup.status !== "pending") throw new FollowupNotAllowedError("not_pending", `Follow-up is already ${followup.status}`);
    const purpose = purposeOf(followup);
    if (!PURPOSE_META[purpose].outreach) throw new FollowupNotAllowedError("not_reviewable", "Internal reminders have no customer message");
    const now = clock();
    const context = await loadFollowupContext(db, followup.customerId, { now, leadId: followup.leadId });
    const eligibility = evaluateEligibility(context, purpose, { followup });
    if (!eligibility.allowed) throw blockedError(eligibility.blockers[0]!);
    if (eligibility.holds.length) throw blockedError(eligibility.holds[0]!);

    const facts = buildDraftFacts(context, purpose, { productId: followup.productId, staffNote: followup.note });
    const result = await drafter.draft(facts);

    try {
      return await db.transaction(async (tx) => {
        const current = await loadFollowup(tx, id, true);
        if (current.status !== "pending") throw new FollowupNotAllowedError("not_pending", `Follow-up is already ${current.status}`);
        const again = await queryOne<Record<string, unknown>>(tx, `select * from followup_drafts where followup_id = $1 and source_event_key = $2`, [id, eventKey]);
        if (again) return mapDraftRow(again);
        await tx.query(`update followup_drafts set status = 'superseded' where followup_id = $1 and status in ('pending_review', 'approved')`, [id]);
        const row = await queryOne<Record<string, unknown>>(
          tx,
          `insert into followup_drafts (followup_id, version, language, content, author_type, model, source_event_key, facts, validation, rationale)
           values ($1, coalesce((select max(version) from followup_drafts where followup_id = $1), 0) + 1, $2, $3, $4, $5, $6, $7, $8, $9)
           returning *`,
          [id, result.language, result.content, result.authorType, result.model, eventKey, JSON.stringify(facts), JSON.stringify(result.validation), result.rationale],
        );
        const draft = mapDraftRow(row!);
        await tx.query(
          `update followups set processing_state = 'awaiting_review', blocked_reason = null, last_error_code = null,
                  locked_until = null, locked_by = null, last_processed_at = $2 where id = $1`,
          [id, now],
        );
        await notifyTx(tx, {
          kind: "draft_awaiting_review",
          severity: current.priority === "high" || current.priority === "urgent" ? "warning" : "info",
          title: `Draft ready for review: ${PURPOSE_META[purpose].label}`,
          customerId: current.customerId,
          followupId: id,
          audienceStaffId: current.assignedStaffId,
          dedupeKey: `draft:${draft.id}`,
        });
        await recordAction(tx, ctx, {
          actionType: "followup_draft_generated",
          customerId: current.customerId,
          leadId: current.leadId,
          input: { followupId: id, sourceEventKey: eventKey },
          output: {
            draftId: draft.id,
            version: draft.version,
            authorType: result.authorType,
            model: result.model,
            language: result.language,
            fallback: result.validation.fallback,
            violations: result.validation.violations.map((v) => v.code),
          },
        });
        return draft;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await queryOne<Record<string, unknown>>(db, `select * from followup_drafts where followup_id = $1 and source_event_key = $2`, [id, eventKey]);
        if (again) return mapDraftRow(again);
      }
      throw error;
    }
  }

  /** Reviewable = a live draft on a pending follow-up whose customer may still be contacted. */
  async function assertReviewable(tx: Db, draft: FollowupDraft, action: string): Promise<Followup> {
    const followup = await loadFollowup(tx, draft.followupId, true);
    if (followup.status !== "pending") throw new FollowupNotAllowedError("not_pending", `Follow-up is already ${followup.status}`);
    const context = await loadFollowupContext(tx, followup.customerId, { now: clock(), leadId: followup.leadId });
    const eligibility = evaluateEligibility(context, purposeOf(followup), { followup });
    if (!eligibility.allowed) throw blockedError(eligibility.blockers[0]!);
    const replied = eligibility.holds.find((h) => h.code === "customer_replied");
    if (replied) throw new FollowupNotAllowedError("customer_replied", `${replied.message}; reschedule it before you ${action}`);
    return followup;
  }

  /** Staff write or edit the message. Creates a new version that still needs approval. */
  async function editDraft(input: { followupId: unknown; content: unknown; language: unknown; eventKey: unknown }, ctx: ActionContext): Promise<FollowupDraft> {
    const followupId = parseInput(uuidSchema, input.followupId, "follow-up id");
    const content = parseInput(z.string().trim().min(1).max(1000), input.content, "message");
    const language = parseInput(z.enum(["english", "urdu", "roman_urdu"]), input.language, "language");
    const eventKey = `staff:${parseInput(idempotencyKey, input.eventKey, "request key")}`;
    return db.transaction(async (tx) => {
      const staff = await requireStaffActor(tx, ctx, "edit follow-up drafts");
      const again = await queryOne<Record<string, unknown>>(tx, `select * from followup_drafts where followup_id = $1 and source_event_key = $2`, [followupId, eventKey]);
      if (again) return mapDraftRow(again);
      const followup = await loadFollowup(tx, followupId, true);
      if (!PURPOSE_META[purposeOf(followup)].outreach) throw new FollowupNotAllowedError("not_reviewable", "Internal reminders have no customer message");
      await assertReviewable(tx, { followupId } as FollowupDraft, "edit the draft");
      const context = await loadFollowupContext(tx, followup.customerId, { now: clock(), leadId: followup.leadId });
      const facts = { ...buildDraftFacts(context, purposeOf(followup), { productId: followup.productId }), language };
      const violations = validateDraft(content, facts);
      if (violations.length) {
        throw new ValidationError("The message contains unverified or prohibited content", violations.map((v) => ({ path: "content", message: v.detail })));
      }
      await tx.query(`update followup_drafts set status = 'superseded' where followup_id = $1 and status in ('pending_review', 'approved')`, [followupId]);
      const row = await queryOne<Record<string, unknown>>(
        tx,
        `insert into followup_drafts (followup_id, version, language, content, author_type, author_staff_id, model, source_event_key, facts, validation)
         values ($1, coalesce((select max(version) from followup_drafts where followup_id = $1), 0) + 1, $2, $3, 'staff', $4, null, $5, $6, '{}')
         returning *`,
        [followupId, language, content, staff.id, eventKey, JSON.stringify(facts)],
      );
      await tx.query(`update followups set processing_state = 'awaiting_review', blocked_reason = null where id = $1`, [followupId]);
      const draft = mapDraftRow(row!);
      await recordAction(tx, ctx, {
        actionType: "followup_draft_edited",
        customerId: followup.customerId,
        input: { followupId, language, length: content.length },
        output: { draftId: draft.id, version: draft.version },
      });
      return draft;
    });
  }

  async function reviewDraft(draftId: unknown, decision: "approved" | "rejected", note: unknown, ctx: ActionContext): Promise<FollowupDraft> {
    const id = parseInput(uuidSchema, draftId, "draft id");
    const reviewNote = parseInput(optionalText(2000), note, "note");
    return db.transaction(async (tx) => {
      const staff = await requireStaffActor(tx, ctx, `${decision === "approved" ? "approve" : "reject"} follow-up drafts`);
      const draft = await loadDraft(tx, id, true);
      if (draft.status !== "pending_review") throw new FollowupNotAllowedError("not_reviewable", `Draft is ${draft.status.replace("_", " ")}`);
      const followup = decision === "approved" ? await assertReviewable(tx, draft, "approve it") : await loadFollowup(tx, draft.followupId, true);
      const row = await queryOne<Record<string, unknown>>(
        tx,
        `update followup_drafts set status = $2, reviewed_by_staff_id = $3, reviewed_at = now(), review_note = $4 where id = $1 returning *`,
        [id, decision, staff.id, reviewNote],
      );
      // Approved = ready for a future, permitted delivery channel. Not sent, not completed.
      await tx.query(`update followups set processing_state = $2 where id = $1`, [followup.id, decision === "approved" ? "approved" : "awaiting_review"]);
      await resolveFollowupNotificationsTx(tx, followup.id, ["draft_awaiting_review"]);
      await recordAction(tx, ctx, {
        actionType: decision === "approved" ? "followup_draft_approved" : "followup_draft_rejected",
        customerId: followup.customerId,
        leadId: followup.leadId,
        input: { draftId: id, note: reviewNote },
        output: { followupId: followup.id, delivered: false },
      });
      return mapDraftRow(row!);
    });
  }

  /** Moves a follow-up; it will be re-evaluated (and re-drafted) when due. */
  async function reschedule(followupId: unknown, when: unknown, ctx: ActionContext): Promise<Followup> {
    const id = parseInput(uuidSchema, followupId, "follow-up id");
    const requested = parseInput(timestampSchema, when, "new time");
    return db.transaction(async (tx) => {
      await requireStaffActor(tx, ctx, "reschedule follow-ups");
      const now = clock();
      if (requested.getTime() <= now.getTime()) throw new FollowupNotAllowedError("scheduled_in_past", "Follow-ups must be scheduled in the future");
      if (requested.getTime() > now.getTime() + MAX_SCHEDULE_DAYS * DAY) {
        throw new FollowupNotAllowedError("scheduled_too_far_ahead", `Follow-ups cannot be scheduled more than ${MAX_SCHEDULE_DAYS} days ahead`);
      }
      const current = await loadFollowup(tx, id, true);
      if (current.status !== "pending") throw new FollowupNotAllowedError("not_pending", `Follow-up is already ${current.status}`);
      const purpose = purposeOf(current);
      const context = await loadFollowupContext(tx, current.customerId, { now, leadId: current.leadId });
      const eligibility = evaluateEligibility(context, purpose, {});
      if (!eligibility.allowed) throw blockedError(eligibility.blockers[0]!);
      const settings = await getFollowupSettings(tx);
      const at = PURPOSE_META[purpose].outreach ? nextAllowedTime(requested, settings.quietHours) : requested;
      await tx.query(`update followup_drafts set status = 'superseded' where followup_id = $1 and status in ('pending_review', 'approved')`, [id]);
      const row = await queryOne<FollowupRow>(
        tx,
        `update followups set scheduled_for = $2, quiet_hours_adjusted = $3, processing_state = 'scheduled', processing_attempts = 0,
                blocked_reason = null, last_error_code = null, locked_until = null, locked_by = null, reply_acknowledged_at = $4
          where id = $1 returning *`,
        [id, at, at.getTime() !== requested.getTime(), now],
      );
      await resolveFollowupNotificationsTx(tx, id);
      await recordAction(tx, ctx, {
        actionType: "followup_rescheduled",
        customerId: current.customerId,
        leadId: current.leadId,
        input: { followupId: id, requested: requested.toISOString() },
        output: { scheduledFor: at.toISOString(), from: current.scheduledFor.toISOString() },
      });
      return mapFollowupRow(row!);
    });
  }

  async function cancel(followupId: unknown, reason: unknown, ctx: ActionContext): Promise<Followup> {
    const id = parseInput(uuidSchema, followupId, "follow-up id");
    const why = parseInput(optionalText(2000), reason, "reason") ?? undefined;
    return db.transaction(async (tx) => {
      await requireStaffActor(tx, ctx, "cancel follow-ups");
      const f = await createFollowupService(tx, clock).cancelFollowup(id, ctx, why);
      await tx.query(`update followups set processing_state = 'blocked', blocked_reason = 'cancelled_by_staff' where id = $1`, [id]);
      if (f.enrollmentId) {
        await tx.query(`update followup_enrollments set status = 'stopped', stopped_reason = 'cancelled_by_staff' where id = $1 and status = 'active'`, [f.enrollmentId]);
      }
      await resolveFollowupNotificationsTx(tx, id);
      return loadFollowup(tx, id);
    });
  }

  /**
   * Staff mark a follow-up done (an internal reminder, or outreach they
   * handled themselves). Generating or approving a draft never does this.
   */
  async function complete(followupId: unknown, outcome: unknown, ctx: ActionContext): Promise<Followup> {
    const id = parseInput(uuidSchema, followupId, "follow-up id");
    const note = parseInput(optionalText(2000), outcome, "outcome") ?? undefined;
    return db.transaction(async (tx) => {
      await requireStaffActor(tx, ctx, "complete follow-ups");
      const f = await createFollowupService(tx, clock).completeFollowup(id, ctx, note);
      await resolveFollowupNotificationsTx(tx, id);
      await advanceSequenceTx(tx, f, ctx);
      return loadFollowup(tx, id);
    });
  }

  /** Staff ask for a person to take over the customer's latest conversation (AI replies stop). */
  async function requestHumanTakeover(customerId: unknown, note: unknown, ctx: ActionContext) {
    const id = parseInput(uuidSchema, customerId, "customer id");
    const text = parseInput(optionalText(2000), note, "note") ?? undefined;
    await requireStaffActor(db, ctx, "request a human takeover");
    const conv = await queryOne<{ id: string }>(
      db,
      `select id from conversations where customer_id = $1 and status = 'open' order by coalesce(last_message_at, created_at) desc limit 1`,
      [id],
    );
    if (!conv) throw new InvalidStateError("This customer has no open conversation to take over");
    return createHandoffService(db).requestHumanHandoff({ conversationId: conv.id, customerId: id, reason: "manager_requested", urgency: "normal", note: text }, ctx);
  }

  /** Staff record the customer's messaging consent. "denied" stops all outreach. */
  async function setContactConsent(customerId: unknown, consent: unknown, source: unknown, ctx: ActionContext) {
    const id = parseInput(uuidSchema, customerId, "customer id");
    const value = parseInput(z.enum(CONTACT_CONSENTS), consent, "consent");
    const src = parseInput(z.string().trim().min(3, "Say how consent was given").max(200), source, "consent source");
    return db.transaction(async (tx) => {
      await requireStaffActor(tx, ctx, "record contact consent");
      const updated = await tx.query(
        `update customers set contact_consent = $2, contact_consent_at = now(), contact_consent_source = $3 where id = $1 returning id`,
        [id, value, src],
      );
      if (!updated.length) throw new NotFoundError("Customer not found", { id });
      const cancelled = value === "denied" ? await haltAllOutreachTx(tx, id, "cancelled: consent denied") : 0;
      await recordAction(tx, ctx, { actionType: "contact_consent_updated", customerId: id, input: { consent: value, source: src }, output: { cancelledFollowups: cancelled } });
      return { consent: value, cancelledFollowups: cancelled };
    });
  }

  async function setIdentityReview(customerId: unknown, required: unknown, ctx: ActionContext) {
    const id = parseInput(uuidSchema, customerId, "customer id");
    const flag = parseInput(z.boolean(), required, "identity review");
    return db.transaction(async (tx) => {
      await requireStaffActor(tx, ctx, "flag identity review");
      await tx.query(`update customers set identity_review_required = $2 where id = $1`, [id, flag]);
      await recordAction(tx, ctx, { actionType: flag ? "identity_review_flagged" : "identity_review_cleared", customerId: id });
      return { identityReviewRequired: flag };
    });
  }

  async function listDrafts(followupId: string): Promise<FollowupDraft[]> {
    const rows = await db.query<Record<string, unknown>>(`select * from followup_drafts where followup_id = $1 order by version desc`, [followupId]);
    return rows.map(mapDraftRow);
  }

  return {
    drafterKind: drafter.kind,
    drafterModel: drafter.model,
    scheduleFollowup,
    enrollSequence,
    generateDraft,
    editDraft,
    approveDraft: (draftId: unknown, ctx: ActionContext, note?: unknown) => reviewDraft(draftId, "approved", note, ctx),
    rejectDraft: (draftId: unknown, ctx: ActionContext, note?: unknown) => reviewDraft(draftId, "rejected", note, ctx),
    reschedule,
    cancel,
    complete,
    requestHumanTakeover,
    setContactConsent,
    setIdentityReview,
    listDrafts,
    getFollowup: (id: string) => loadFollowup(db, parseInput(uuidSchema, id, "follow-up id")),
  };
}

export type FollowupEngine = ReturnType<typeof createFollowupEngine>;
