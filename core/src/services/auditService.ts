import type { Db } from "../database/db.js";
import { redact } from "../lib/redact.js";
import { actorAgentName, actorStaffId, type ActionContext, type ActorType } from "../types/context.js";

/**
 * Append-only audit log (agent_actions). Inputs and outputs are redacted
 * before storage. The table itself rejects UPDATE/DELETE via trigger.
 */

export type AgentActionStatus = "succeeded" | "failed" | "pending_approval" | "rejected";

export interface RecordActionInput {
  actionType: string;
  customerId?: string | null;
  leadId?: string | null;
  conversationId?: string | null;
  approvalId?: string | null;
  input?: unknown;
  output?: unknown;
  status?: AgentActionStatus;
  requiresApproval?: boolean;
  errorMessage?: string | null;
}

export interface AgentAction {
  id: string;
  actionType: string;
  toolName: string | null;
  actorType: ActorType;
  actorStaffId: string | null;
  agentName: string | null;
  customerId: string | null;
  leadId: string | null;
  conversationId: string | null;
  approvalId: string | null;
  input: unknown;
  output: unknown;
  status: AgentActionStatus;
  requiresApproval: boolean;
  errorMessage: string | null;
  requestId: string | null;
  createdAt: Date;
}

interface AgentActionRow {
  id: string;
  action_type: string;
  tool_name: string | null;
  actor_type: ActorType;
  actor_staff_id: string | null;
  agent_name: string | null;
  customer_id: string | null;
  lead_id: string | null;
  conversation_id: string | null;
  approval_id: string | null;
  input: unknown;
  output: unknown;
  status: AgentActionStatus;
  requires_approval: boolean;
  error_message: string | null;
  request_id: string | null;
  created_at: Date;
}

function mapRow(r: AgentActionRow): AgentAction {
  return {
    id: r.id,
    actionType: r.action_type,
    toolName: r.tool_name,
    actorType: r.actor_type,
    actorStaffId: r.actor_staff_id,
    agentName: r.agent_name,
    customerId: r.customer_id,
    leadId: r.lead_id,
    conversationId: r.conversation_id,
    approvalId: r.approval_id,
    input: r.input,
    output: r.output,
    status: r.status,
    requiresApproval: r.requires_approval,
    errorMessage: r.error_message,
    requestId: r.request_id,
    createdAt: r.created_at,
  };
}

/** Writes one audit record using the given (possibly transaction-bound) db. */
export async function recordAction(db: Db, ctx: ActionContext, entry: RecordActionInput): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into agent_actions
       (action_type, tool_name, actor_type, actor_staff_id, agent_name, customer_id, lead_id,
        conversation_id, approval_id, input, output, status, requires_approval, error_message, request_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     returning id`,
    [
      entry.actionType,
      ctx.toolName ?? null,
      ctx.actor.type,
      actorStaffId(ctx),
      actorAgentName(ctx),
      entry.customerId ?? null,
      entry.leadId ?? null,
      entry.conversationId ?? null,
      entry.approvalId ?? null,
      JSON.stringify(redact(entry.input ?? {})),
      JSON.stringify(redact(entry.output ?? {})),
      entry.status ?? "succeeded",
      entry.requiresApproval ?? false,
      entry.errorMessage ?? null,
      ctx.requestId ?? null,
    ],
  );
  return rows[0]!.id;
}

export function createAuditService(db: Db) {
  return {
    recordAction: (ctx: ActionContext, entry: RecordActionInput) => recordAction(db, ctx, entry),

    async listActions(filter: {
      customerId?: string;
      conversationId?: string;
      actionType?: string;
      limit?: number;
    }): Promise<AgentAction[]> {
      const rows = await db.query<AgentActionRow>(
        `select * from agent_actions
          where ($1::uuid is null or customer_id = $1)
            and ($2::uuid is null or conversation_id = $2)
            and ($3::text is null or action_type = $3)
          order by created_at desc, id desc
          limit $4`,
        [filter.customerId ?? null, filter.conversationId ?? null, filter.actionType ?? null, Math.min(filter.limit ?? 50, 500)],
      );
      return rows.map(mapRow);
    },
  };
}

export type AuditService = ReturnType<typeof createAuditService>;
