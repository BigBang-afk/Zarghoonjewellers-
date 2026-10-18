import { z } from "zod";
import { queryOne, type Db } from "../database/db.js";
import { ApprovalNotFoundError, ApprovalRequiredError, InvalidStateError } from "../lib/errors.js";
import { optionalText, parseInput, uuidSchema } from "../lib/validation.js";
import { actorStaffId, type ActionContext, type ActorType } from "../types/context.js";
import { recordAction } from "./auditService.js";
import { APPROVER_ROLES, requireStaffActor } from "./staffRules.js";

/**
 * Human approval for sensitive actions. The AI may *request* an approval; only
 * owner/manager/admin staff may approve or reject one. An approval can be
 * consumed by at most one executed action.
 */

export const APPROVAL_ACTION_TYPES = [
  "discount",
  "refund",
  "price_change",
  "gold_rate_change",
  "payment_change",
  "cancellation",
  "delete_product",
  "delete_order",
  "high_risk_complaint_response",
  "advertising_spend",
  "bulk_marketing",
  "banking_details_change",
  "other",
] as const;
export type ApprovalActionType = (typeof APPROVAL_ACTION_TYPES)[number];
export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface Approval {
  id: string;
  actionType: ApprovalActionType;
  status: ApprovalStatus;
  requestedByType: ActorType;
  requestedByStaffId: string | null;
  customerId: string | null;
  leadId: string | null;
  conversationId: string | null;
  reason: string;
  payload: Record<string, unknown>;
  decidedByStaffId: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  /** Set once, when the approved action is carried out; an approval is never used twice. */
  consumedAt: Date | null;
  consumedByAction: string | null;
  createdAt: Date;
}

interface ApprovalRow {
  id: string;
  action_type: ApprovalActionType;
  status: ApprovalStatus;
  requested_by_type: ActorType;
  requested_by_staff_id: string | null;
  customer_id: string | null;
  lead_id: string | null;
  conversation_id: string | null;
  reason: string;
  payload: Record<string, unknown>;
  decided_by_staff_id: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  consumed_at: Date | null;
  consumed_by_action: string | null;
  created_at: Date;
}

function mapRow(r: ApprovalRow): Approval {
  return {
    id: r.id,
    actionType: r.action_type,
    status: r.status,
    requestedByType: r.requested_by_type,
    requestedByStaffId: r.requested_by_staff_id,
    customerId: r.customer_id,
    leadId: r.lead_id,
    conversationId: r.conversation_id,
    reason: r.reason,
    payload: r.payload,
    decidedByStaffId: r.decided_by_staff_id,
    decidedAt: r.decided_at,
    decisionNote: r.decision_note,
    consumedAt: r.consumed_at ?? null,
    consumedByAction: r.consumed_by_action ?? null,
    createdAt: r.created_at,
  };
}

export const createApprovalSchema = z
  .object({
    actionType: z.enum(APPROVAL_ACTION_TYPES),
    reason: z.string().trim().min(1).max(2000),
    payload: z.record(z.string(), z.unknown()).default({}),
    customerId: uuidSchema.optional(),
    leadId: uuidSchema.optional(),
    conversationId: uuidSchema.optional(),
  })
  .strict();

async function loadApproval(db: Db, id: string, lock = false): Promise<Approval> {
  const row = await queryOne<ApprovalRow>(db, `select * from approvals where id = $1 ${lock ? "for update" : ""}`, [id]);
  if (!row) throw new ApprovalNotFoundError({ id });
  return mapRow(row);
}

/**
 * Verifies that an approval exists, is approved, is of the expected type and
 * has never been used, then marks it used by `consumerActionType`. Call it
 * inside the transaction that performs the action: if the action fails the
 * consumption rolls back with it; two concurrent uses cannot both succeed
 * (row lock + `consumed_at is null`, also enforced by a database trigger).
 */
export async function assertUsableApproval(
  db: Db,
  approvalId: string,
  expectedType: ApprovalActionType,
  consumerActionType: string,
): Promise<Approval> {
  const approval = await loadApproval(db, parseInput(uuidSchema, approvalId, "approval id"), true);
  if (approval.actionType !== expectedType) {
    throw new ApprovalRequiredError(`Approval is for "${approval.actionType}", not "${expectedType}"`, {
      approvalId,
    });
  }
  if (approval.status !== "approved") {
    throw new ApprovalRequiredError(`Approval is ${approval.status}, not approved`, { approvalId });
  }
  const used = await queryOne<{ id: string }>(
    db,
    `select id from agent_actions where approval_id = $1 and action_type = $2 and status = 'succeeded' limit 1`,
    [approvalId, consumerActionType],
  );
  if (used || approval.consumedAt) throw new ApprovalRequiredError("Approval has already been used", { approvalId });
  const consumed = await queryOne<ApprovalRow>(
    db,
    `update approvals set consumed_at = now(), consumed_by_action = $2
      where id = $1 and status = 'approved' and consumed_at is null returning *`,
    [approvalId, consumerActionType],
  );
  if (!consumed) throw new ApprovalRequiredError("Approval has already been used", { approvalId });
  return mapRow(consumed);
}

export function createApprovalService(db: Db) {
  async function createApprovalRequest(input: z.input<typeof createApprovalSchema>, ctx: ActionContext) {
    const data = parseInput(createApprovalSchema, input, "approval request");
    return db.transaction(async (tx) => {
      const row = await queryOne<ApprovalRow>(
        tx,
        `insert into approvals (action_type, requested_by_type, requested_by_staff_id, customer_id, lead_id,
                                conversation_id, reason, payload)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
        [
          data.actionType,
          ctx.actor.type,
          actorStaffId(ctx),
          data.customerId ?? null,
          data.leadId ?? null,
          data.conversationId ?? null,
          data.reason,
          JSON.stringify(data.payload),
        ],
      );
      const approval = mapRow(row!);
      await recordAction(tx, ctx, {
        actionType: "approval_requested",
        approvalId: approval.id,
        customerId: approval.customerId,
        leadId: approval.leadId,
        conversationId: approval.conversationId,
        requiresApproval: true,
        status: "pending_approval",
        input: data,
      });
      return approval;
    });
  }

  async function decide(
    approvalId: string,
    decision: "approved" | "rejected",
    note: string | null | undefined,
    ctx: ActionContext,
  ): Promise<Approval> {
    const id = parseInput(uuidSchema, approvalId, "approval id");
    const decisionNote = parseInput(optionalText(2000), note, "decision note");
    return db.transaction(async (tx) => {
      const staff = await requireStaffActor(tx, ctx, "decide approvals", APPROVER_ROLES);
      const current = await loadApproval(tx, id, true);
      if (current.status !== "pending") {
        throw new InvalidStateError(`Approval is already ${current.status}`, { approvalId: id });
      }
      const row = await queryOne<ApprovalRow>(
        tx,
        `update approvals set status = $2, decided_by_staff_id = $3, decided_at = now(), decision_note = $4
          where id = $1 returning *`,
        [id, decision, staff.id, decisionNote],
      );
      const approval = mapRow(row!);
      await recordAction(tx, ctx, {
        actionType: `approval_${decision}`,
        approvalId: id,
        customerId: approval.customerId,
        leadId: approval.leadId,
        conversationId: approval.conversationId,
        input: { decisionNote },
        output: { status: approval.status },
      });
      return approval;
    });
  }

  async function cancelApproval(approvalId: string, ctx: ActionContext): Promise<Approval> {
    const id = parseInput(uuidSchema, approvalId, "approval id");
    return db.transaction(async (tx) => {
      const current = await loadApproval(tx, id, true);
      if (current.status !== "pending") {
        throw new InvalidStateError(`Approval is already ${current.status}`, { approvalId: id });
      }
      const row = await queryOne<ApprovalRow>(
        tx,
        `update approvals set status = 'cancelled', decided_at = now(), decided_by_staff_id = $2
          where id = $1 returning *`,
        [id, actorStaffId(ctx)],
      );
      await recordAction(tx, ctx, { actionType: "approval_cancelled", approvalId: id });
      return mapRow(row!);
    });
  }

  return {
    createApprovalRequest,
    getApproval: async (id: string) => loadApproval(db, parseInput(uuidSchema, id, "approval id")),
    approve: (id: string, ctx: ActionContext, note?: string) => decide(id, "approved", note, ctx),
    reject: (id: string, ctx: ActionContext, note?: string) => decide(id, "rejected", note, ctx),
    cancelApproval,
    async listPendingApprovals(limit = 50): Promise<Approval[]> {
      const rows = await db.query<ApprovalRow>(
        `select * from approvals where status = 'pending' order by created_at limit $1`,
        [Math.min(limit, 200)],
      );
      return rows.map(mapRow);
    },
  };
}

export type ApprovalService = ReturnType<typeof createApprovalService>;
