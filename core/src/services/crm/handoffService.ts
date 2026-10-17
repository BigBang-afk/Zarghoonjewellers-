import { z } from "zod";
import { queryOne, type Db } from "../../database/db.js";
import { ConversationClosedError, HandoffNotFoundError, InvalidStateError } from "../../lib/errors.js";
import { optionalText, parseInput, uuidSchema } from "../../lib/validation.js";
import {
  HANDOFF_REASONS,
  HANDOFF_URGENCIES,
  isTerminalLeadStatus,
  mapConversationRow,
  mapHandoffRow,
  mapLeadRow,
  type Conversation,
  type ConversationRow,
  type Handoff,
  type HandoffRow,
  type HandoffUrgency,
  type Lead,
  type LeadRow,
} from "../../schemas/crm.js";
import { actorStaffId, type ActionContext } from "../../types/context.js";
import { recordAction } from "../auditService.js";
import { assertAssignableStaff, requireStaffActor } from "../staffRules.js";
import { assertLeadBelongsTo, findActiveLead, loadConversation, loadLead, recordLeadSignalTx } from "./shared.js";

/**
 * Human handoff: the AI (or anyone) stops autonomous handling of a
 * conversation and hands it to staff.
 *
 * In one transaction it:
 *  1. records the handoff with its reason and urgency,
 *  2. activates human takeover on the conversation (AI replies are then
 *     blocked by the conversation service and a DB trigger),
 *  3. moves the active lead to `human_followup` (unless it is closed), and
 *     records `requested_human_salesperson` when the customer asked for a person,
 *  4. writes an audit record.
 *
 * Staff are never auto-assigned. A preferred staff member may be named, and
 * automated actors may only name someone who is active and available.
 */

const URGENCY_RANK: Record<HandoffUrgency, number> = { normal: 0, high: 1, urgent: 2 };

export const requestHandoffSchema = z
  .object({
    conversationId: uuidSchema,
    customerId: uuidSchema.optional(),
    leadId: uuidSchema.optional(),
    reason: z.enum(HANDOFF_REASONS),
    urgency: z.enum(HANDOFF_URGENCIES).default("normal"),
    note: optionalText(2000),
    preferredStaffId: uuidSchema.optional(),
  })
  .strict();
export type RequestHandoffInput = z.input<typeof requestHandoffSchema>;

export interface HandoffResult {
  handoff: Handoff;
  conversation: Conversation;
  lead: Lead | null;
  /** True when an open handoff already existed; it is returned (urgency raised if needed). */
  alreadyActive: boolean;
}

export function createHandoffService(db: Db) {
  async function requestHumanHandoff(input: RequestHandoffInput, ctx: ActionContext): Promise<HandoffResult> {
    const data = parseInput(requestHandoffSchema, input, "handoff");
    return db.transaction(async (tx) => {
      const conversation = await loadConversation(tx, data.conversationId, true);
      if (conversation.status === "closed") throw new ConversationClosedError(conversation.id);
      if (data.customerId && conversation.customerId && data.customerId !== conversation.customerId) {
        throw new InvalidStateError("Customer does not match the conversation", { conversationId: conversation.id });
      }
      const customerId = conversation.customerId ?? data.customerId ?? null;

      let lead: Lead | null = null;
      const leadId = data.leadId ?? conversation.leadId;
      if (leadId) {
        lead = await loadLead(tx, leadId, true);
        if (customerId) assertLeadBelongsTo(lead, customerId);
      } else if (customerId) {
        lead = await findActiveLead(tx, customerId);
      }

      const open = await queryOne<HandoffRow>(
        tx,
        `select * from handoffs where conversation_id = $1 and status = 'open' order by created_at desc limit 1 for update`,
        [conversation.id],
      );
      if (open && conversation.humanTakeover) {
        let handoff = mapHandoffRow(open);
        if (URGENCY_RANK[data.urgency] > URGENCY_RANK[handoff.urgency]) {
          handoff = mapHandoffRow(
            (await queryOne<HandoffRow>(tx, `update handoffs set urgency = $2 where id = $1 returning *`, [
              handoff.id,
              data.urgency,
            ]))!,
          );
          await recordAction(tx, ctx, {
            actionType: "handoff_escalated",
            customerId,
            leadId: lead?.id ?? null,
            conversationId: conversation.id,
            input: { handoffId: handoff.id, urgency: data.urgency, reason: data.reason },
          });
        }
        return { handoff, conversation, lead, alreadyActive: true };
      }

      const assignedStaffId = data.preferredStaffId
        ? (await assertAssignableStaff(tx, data.preferredStaffId, ctx)).id
        : null;

      const handoff = mapHandoffRow(
        (await queryOne<HandoffRow>(
          tx,
          `insert into handoffs (conversation_id, customer_id, lead_id, reason, urgency, note,
                                 requested_by_type, requested_by_staff_id, assigned_staff_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
          [
            conversation.id,
            customerId,
            lead?.id ?? null,
            data.reason,
            data.urgency,
            data.note,
            ctx.actor.type,
            actorStaffId(ctx),
            assignedStaffId,
          ],
        ))!,
      );

      const updatedConversation = mapConversationRow(
        (await queryOne<ConversationRow>(
          tx,
          `update conversations
              set human_takeover = true,
                  human_takeover_at = coalesce(human_takeover_at, now()),
                  human_takeover_reason = $2,
                  lead_id = coalesce(lead_id, $3),
                  assigned_staff_id = coalesce($4, assigned_staff_id)
            where id = $1 returning *`,
          [conversation.id, data.reason, lead?.id ?? null, assignedStaffId],
        ))!,
      );

      if (lead && !isTerminalLeadStatus(lead.status)) {
        if (data.reason === "customer_requested") {
          await recordLeadSignalTx(tx, lead.id, "requested_human_salesperson", ctx, {
            evidence: "customer asked for a human salesperson",
            ignoreDuplicate: true,
          });
        }
        lead = mapLeadRow(
          (await queryOne<LeadRow>(
            tx,
            `update leads set status = 'human_followup', last_activity_at = now(),
                    assigned_staff_id = coalesce($2, assigned_staff_id)
              where id = $1 returning *`,
            [lead.id, assignedStaffId],
          ))!,
        );
      }

      await recordAction(tx, ctx, {
        actionType: "human_handoff_requested",
        customerId,
        leadId: lead?.id ?? null,
        conversationId: conversation.id,
        input: data,
        output: { handoffId: handoff.id, assignedStaffId, leadStatus: lead?.status ?? null },
      });
      return { handoff, conversation: updatedConversation, lead, alreadyActive: false };
    });
  }

  /** Staff close a handoff; optionally hand the conversation back to the AI. */
  async function resolveHandoff(
    handoffId: string,
    ctx: ActionContext,
    options: { releaseTakeover?: boolean; note?: string } = {},
  ): Promise<Handoff> {
    const id = parseInput(uuidSchema, handoffId, "handoff id");
    return db.transaction(async (tx) => {
      const staff = await requireStaffActor(tx, ctx, "resolve handoffs");
      const current = await queryOne<HandoffRow>(tx, `select * from handoffs where id = $1 for update`, [id]);
      if (!current) throw new HandoffNotFoundError({ id });
      if (current.status === "resolved") throw new InvalidStateError("Handoff is already resolved", { handoffId: id });
      const row = await queryOne<HandoffRow>(
        tx,
        `update handoffs set status = 'resolved', resolved_at = now(), resolved_by_staff_id = $2,
                note = coalesce($3, note) where id = $1 returning *`,
        [id, staff.id, options.note ?? null],
      );
      if (options.releaseTakeover) {
        const stillOpen = await queryOne<{ n: number }>(
          tx,
          `select count(*)::int as n from handoffs where conversation_id = $1 and status = 'open'`,
          [current.conversation_id],
        );
        if (stillOpen!.n === 0) {
          await tx.query(
            `update conversations set human_takeover = false, human_takeover_at = null, human_takeover_reason = null
              where id = $1`,
            [current.conversation_id],
          );
        }
      }
      await recordAction(tx, ctx, {
        actionType: "handoff_resolved",
        customerId: current.customer_id,
        leadId: current.lead_id,
        conversationId: current.conversation_id,
        input: { handoffId: id, releaseTakeover: options.releaseTakeover ?? false },
      });
      return mapHandoffRow(row!);
    });
  }

  async function getOpenHandoffs(limit = 50): Promise<Handoff[]> {
    const rows = await db.query<HandoffRow>(
      `select * from handoffs where status = 'open'
        order by case urgency when 'urgent' then 0 when 'high' then 1 else 2 end, created_at
        limit $1`,
      [Math.min(limit, 200)],
    );
    return rows.map(mapHandoffRow);
  }

  return { requestHumanHandoff, resolveHandoff, getOpenHandoffs };
}

export type HandoffService = ReturnType<typeof createHandoffService>;
