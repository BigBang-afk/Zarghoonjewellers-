import { z } from "zod";
import { isUniqueViolation, queryOne, type Db } from "../../database/db.js";
import {
  DuplicateFollowupError,
  FollowupNotAllowedError,
  FollowupNotFoundError,
  InvalidStateError,
} from "../../lib/errors.js";
import { optionalText, parseInput, timestampSchema, uuidSchema } from "../../lib/validation.js";
import {
  CHANNELS,
  FOLLOWUP_STATUSES,
  FOLLOWUP_TYPES,
  mapFollowupRow,
  type Followup,
  type FollowupRow,
  type FollowupStatus,
} from "../../schemas/crm.js";
import { actorStaffId, systemClock, type ActionContext, type Clock } from "../../types/context.js";
import { recordAction } from "../auditService.js";
import { assertAssignableStaff } from "../staffRules.js";
import { assertLeadBelongsTo, loadConversation, loadCustomer, loadLead } from "./shared.js";

/**
 * Follow-up scheduling. Phase 1 manages records only — nothing is ever sent
 * to a customer from here.
 *
 * Rules (enforced in code, duplicates also by a unique index):
 *  - scheduled time must be in the future and within MAX_SCHEDULE_DAYS
 *  - customers flagged do_not_contact get no follow-ups at all
 *  - won/lost leads get no further *sales* follow-ups; do_not_contact leads none
 *  - at most one pending follow-up per customer/lead/type
 */

export const MAX_SCHEDULE_DAYS = 365;

export const scheduleFollowupSchema = z
  .object({
    customerId: uuidSchema,
    leadId: uuidSchema.optional(),
    conversationId: uuidSchema.optional(),
    assignedStaffId: uuidSchema.optional(),
    followupType: z.enum(FOLLOWUP_TYPES).default("sales"),
    channel: z.enum(CHANNELS).optional(),
    scheduledFor: timestampSchema,
    /** Draft text for a human to review. Never sent automatically in Phase 1. */
    messageDraft: optionalText(2000),
    note: optionalText(2000),
  })
  .strict();
export type ScheduleFollowupInput = z.input<typeof scheduleFollowupSchema>;

export function createFollowupService(db: Db, clock: Clock = systemClock) {
  async function loadFollowup(tx: Db, id: string, lock = false): Promise<Followup> {
    const row = await queryOne<FollowupRow>(tx, `select * from followups where id = $1 ${lock ? "for update" : ""}`, [id]);
    if (!row) throw new FollowupNotFoundError({ id });
    return mapFollowupRow(row);
  }

  async function findPendingDuplicate(tx: Db, customerId: string, leadId: string | null, type: string) {
    return queryOne<{ id: string }>(
      tx,
      `select id from followups
        where status = 'pending' and customer_id = $1 and lead_id is not distinct from $2 and followup_type = $3`,
      [customerId, leadId, type],
    );
  }

  async function scheduleFollowup(input: ScheduleFollowupInput, ctx: ActionContext): Promise<Followup> {
    const data = parseInput(scheduleFollowupSchema, input, "follow-up");
    const now = clock();
    if (data.scheduledFor.getTime() <= now.getTime()) {
      throw new FollowupNotAllowedError("scheduled_in_past", "Follow-ups must be scheduled in the future");
    }
    if (data.scheduledFor.getTime() > now.getTime() + MAX_SCHEDULE_DAYS * 86_400_000) {
      throw new FollowupNotAllowedError(
        "scheduled_too_far_ahead",
        `Follow-ups cannot be scheduled more than ${MAX_SCHEDULE_DAYS} days ahead`,
      );
    }

    try {
      return await db.transaction(async (tx) => {
        const customer = await loadCustomer(tx, data.customerId, true);
        if (customer.doNotContact) {
          throw new FollowupNotAllowedError("do_not_contact", "Customer has asked not to be contacted");
        }
        if (data.leadId) {
          const lead = await loadLead(tx, data.leadId);
          assertLeadBelongsTo(lead, customer.id);
          if (lead.status === "do_not_contact") {
            throw new FollowupNotAllowedError("do_not_contact", "Lead is marked do_not_contact");
          }
          if ((lead.status === "won" || lead.status === "lost") && data.followupType === "sales") {
            throw new FollowupNotAllowedError("lead_closed", `Lead is ${lead.status}; sales follow-ups are not allowed`);
          }
        }
        if (data.conversationId) {
          const conversation = await loadConversation(tx, data.conversationId);
          if (conversation.customerId !== customer.id) {
            throw new InvalidStateError("Conversation belongs to a different customer", { conversationId: conversation.id });
          }
        }
        if (data.assignedStaffId) await assertAssignableStaff(tx, data.assignedStaffId, ctx);

        const duplicate = await findPendingDuplicate(tx, customer.id, data.leadId ?? null, data.followupType);
        if (duplicate) throw new DuplicateFollowupError(duplicate.id);

        const row = await queryOne<FollowupRow>(
          tx,
          `insert into followups (customer_id, lead_id, conversation_id, assigned_staff_id, followup_type, channel,
                                  scheduled_for, message_draft, note, created_by_type, created_by_staff_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
          [
            customer.id,
            data.leadId ?? null,
            data.conversationId ?? null,
            data.assignedStaffId ?? null,
            data.followupType,
            data.channel ?? null,
            data.scheduledFor,
            data.messageDraft,
            data.note,
            ctx.actor.type,
            actorStaffId(ctx),
          ],
        );
        const followup = mapFollowupRow(row!);
        await recordAction(tx, ctx, {
          actionType: "followup_scheduled",
          customerId: customer.id,
          leadId: followup.leadId,
          conversationId: followup.conversationId,
          input: data,
          output: { followupId: followup.id },
        });
        return followup;
      });
    } catch (error) {
      if (isUniqueViolation(error, "followups_one_pending_per_type")) {
        const existing = await findPendingDuplicate(db, data.customerId, data.leadId ?? null, data.followupType);
        throw new DuplicateFollowupError(existing?.id ?? null);
      }
      throw error;
    }
  }

  async function transition(
    followupId: string,
    to: Exclude<FollowupStatus, "pending">,
    note: string | null | undefined,
    ctx: ActionContext,
  ): Promise<Followup> {
    const id = parseInput(uuidSchema, followupId, "follow-up id");
    const outcomeNote = parseInput(optionalText(2000), note, "note");
    return db.transaction(async (tx) => {
      const current = await loadFollowup(tx, id, true);
      if (current.status !== "pending") {
        throw new FollowupNotAllowedError("not_pending", `Follow-up is already ${current.status}`);
      }
      const row = await queryOne<FollowupRow>(
        tx,
        `update followups set status = $2, outcome_note = $3,
                completed_at = case when $2 = 'completed' then now() else completed_at end,
                cancelled_at = case when $2 = 'cancelled' then now() else cancelled_at end
          where id = $1 returning *`,
        [id, to, outcomeNote],
      );
      const followup = mapFollowupRow(row!);
      await recordAction(tx, ctx, {
        actionType: `followup_${to}`,
        customerId: followup.customerId,
        leadId: followup.leadId,
        input: { followupId: id, note: outcomeNote },
      });
      return followup;
    });
  }

  /** Pending follow-ups ordered by due time; `dueBefore` narrows to those due (incl. overdue). */
  async function getPendingFollowups(
    options: { dueBefore?: Date; assignedStaffId?: string; limit?: number } = {},
  ): Promise<Followup[]> {
    const staffId = options.assignedStaffId ? parseInput(uuidSchema, options.assignedStaffId, "staff id") : null;
    const rows = await db.query<FollowupRow>(
      `select * from followups
        where status = 'pending'
          and ($1::timestamptz is null or scheduled_for <= $1)
          and ($2::uuid is null or assigned_staff_id = $2)
        order by scheduled_for asc limit $3`,
      [options.dueBefore ?? null, staffId, Math.min(options.limit ?? 100, 500)],
    );
    return rows.map(mapFollowupRow);
  }

  async function getCustomerFollowups(customerId: string, options: { status?: FollowupStatus } = {}): Promise<Followup[]> {
    const id = parseInput(uuidSchema, customerId, "customer id");
    const status = options.status ? parseInput(z.enum(FOLLOWUP_STATUSES), options.status, "status") : null;
    const rows = await db.query<FollowupRow>(
      `select * from followups where customer_id = $1 and ($2::text is null or status = $2)
        order by scheduled_for desc limit 200`,
      [id, status],
    );
    return rows.map(mapFollowupRow);
  }

  return {
    scheduleFollowup,
    getFollowup: async (id: string) => loadFollowup(db, parseInput(uuidSchema, id, "follow-up id")),
    getPendingFollowups,
    getCustomerFollowups,
    completeFollowup: (id: string, ctx: ActionContext, outcomeNote?: string) => transition(id, "completed", outcomeNote, ctx),
    cancelFollowup: (id: string, ctx: ActionContext, reason?: string) => transition(id, "cancelled", reason, ctx),
    skipFollowup: (id: string, ctx: ActionContext, reason?: string) => transition(id, "skipped", reason, ctx),
  };
}

export type FollowupService = ReturnType<typeof createFollowupService>;
