import type { Db } from "../../database/db.js";
import type { ActionContext } from "../../types/context.js";
import { recordAction } from "../auditService.js";
import { notifyTx } from "./notifications.js";

/**
 * Reactions to CRM events, run inside the caller's transaction:
 *  - a customer reply puts outstanding outreach on hold for staff review,
 *  - an opt-out (do-not-contact / consent denied) stops all outreach,
 *  - a closed lead (won/lost) stops its sales sequences.
 * Pending follow-ups that get cancelled have their drafts superseded by a
 * database trigger.
 */

const INTERNAL = `coalesce(purpose, '') = 'staff_callback'`;

/** The customer wrote to us: re-evaluate outstanding outreach. */
export async function onCustomerReplyTx(tx: Db, customerId: string, at: Date, ctx: ActionContext): Promise<number> {
  const held = await tx.query<{ id: string; assigned_staff_id: string | null }>(
    `update followups
        set customer_replied_at = $2,
            processing_state = case when processing_state = 'processing' then processing_state else 'blocked' end,
            blocked_reason = 'customer_replied', locked_until = null, locked_by = null
      where customer_id = $1 and status = 'pending' and not (${INTERNAL})
        and greatest(created_at, coalesce(reply_acknowledged_at, created_at)) < $2
      returning id, assigned_staff_id`,
    [customerId, at],
  );
  if (held.length === 0) return 0;
  await tx.query(
    `update followup_drafts set status = 'superseded'
      where followup_id = any($1::uuid[]) and status in ('pending_review', 'approved')`,
    [held.map((h) => h.id)],
  );
  await tx.query(
    `update followup_enrollments set status = 'stopped', stopped_reason = 'customer_replied'
      where customer_id = $1 and status = 'active'`,
    [customerId],
  );
  for (const f of held) {
    await notifyTx(tx, {
      kind: "human_attention",
      severity: "warning",
      title: "Customer replied — review the scheduled follow-up",
      body: "Outstanding drafts were withdrawn. Reschedule or cancel the follow-up.",
      customerId,
      followupId: f.id,
      audienceStaffId: f.assigned_staff_id,
      dedupeKey: `replied:${f.id}:${at.toISOString()}`,
    });
  }
  await recordAction(tx, ctx, {
    actionType: "followups_held_customer_replied",
    customerId,
    output: { followupIds: held.map((h) => h.id) },
  });
  return held.length;
}

/** Opt-out: cancel every pending follow-up (outreach and callbacks) and stop sequences. */
export async function haltAllOutreachTx(tx: Db, customerId: string, reason: string): Promise<number> {
  const rows = await tx.query(
    `update followups set status = 'cancelled', cancelled_at = now(), outcome_note = $2,
                          processing_state = 'blocked', blocked_reason = 'do_not_contact'
      where customer_id = $1 and status = 'pending' returning id`,
    [customerId, reason],
  );
  await tx.query(
    `update followup_enrollments set status = 'stopped', stopped_reason = $2 where customer_id = $1 and status = 'active'`,
    [customerId, reason],
  );
  return rows.length;
}

/** A lead was won or lost: its sales sequences stop. */
export async function stopLeadSequencesTx(tx: Db, leadId: string, reason: string): Promise<void> {
  await tx.query(
    `update followup_enrollments set status = 'stopped', stopped_reason = $2 where lead_id = $1 and status = 'active'`,
    [leadId, reason],
  );
}
