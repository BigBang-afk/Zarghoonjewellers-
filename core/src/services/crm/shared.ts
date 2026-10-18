import { queryOne, type Db } from "../../database/db.js";
import { haltAllOutreachTx } from "../followupEngine/hooks.js";
import {
  ConversationNotFoundError,
  CustomerNotFoundError,
  DuplicateLeadSignalError,
  InvalidStateError,
  LeadNotFoundError,
  MessageNotFoundError,
} from "../../lib/errors.js";
import {
  isTerminalLeadStatus,
  mapConversationRow,
  mapCustomerRow,
  mapLeadRow,
  type Conversation,
  type ConversationRow,
  type Customer,
  type CustomerRow,
  type FollowupType,
  type Lead,
  type LeadRow,
  type LeadStatus,
} from "../../schemas/crm.js";
import { actorStaffId, type ActionContext } from "../../types/context.js";
import { recordAction } from "../auditService.js";
import { computeLeadScore, LEAD_SIGNAL_POINTS, type LeadClassification, type LeadScoreResult, type LeadSignal } from "./leadScoring.js";

/** Loaders and transactional building blocks shared by the CRM services. */

export async function loadCustomer(db: Db, id: string, lock = false): Promise<Customer> {
  const row = await queryOne<CustomerRow>(db, `select * from customers where id = $1 ${lock ? "for update" : ""}`, [id]);
  if (!row) throw new CustomerNotFoundError({ id });
  return mapCustomerRow(row);
}

export async function loadLead(db: Db, id: string, lock = false): Promise<Lead> {
  const row = await queryOne<LeadRow>(db, `select * from leads where id = $1 ${lock ? "for update" : ""}`, [id]);
  if (!row) throw new LeadNotFoundError({ id });
  return mapLeadRow(row);
}

export async function loadConversation(db: Db, id: string, lock = false): Promise<Conversation> {
  const row = await queryOne<ConversationRow>(
    db,
    `select * from conversations where id = $1 ${lock ? "for update" : ""}`,
    [id],
  );
  if (!row) throw new ConversationNotFoundError({ id });
  return mapConversationRow(row);
}

export async function findActiveLead(db: Db, customerId: string): Promise<Lead | null> {
  const row = await queryOne<LeadRow>(
    db,
    `select * from leads where customer_id = $1 and status not in ('won', 'lost', 'do_not_contact')`,
    [customerId],
  );
  return row ? mapLeadRow(row) : null;
}

/** Ensures a lead belongs to the given customer (prevents cross-customer writes). */
export function assertLeadBelongsTo(lead: Lead, customerId: string): void {
  if (lead.customerId !== customerId) {
    throw new InvalidStateError("Lead does not belong to this customer", { leadId: lead.id, customerId });
  }
}

export async function assertMessageInConversation(db: Db, messageId: string, conversationId: string | null) {
  const row = await queryOne<{ conversation_id: string }>(db, `select conversation_id from messages where id = $1`, [
    messageId,
  ]);
  if (!row) throw new MessageNotFoundError({ id: messageId });
  if (conversationId && row.conversation_id !== conversationId) {
    throw new InvalidStateError("Message does not belong to this conversation", { messageId, conversationId });
  }
  return row.conversation_id;
}

// --- Lead status promotion --------------------------------------------------------

const TEMPERATURE_RANK: Partial<Record<LeadStatus, number>> = { new: 0, qualified: 1, warm: 2, hot: 3, very_hot: 4 };
const STATUS_FOR_CLASSIFICATION: Record<LeadClassification, LeadStatus | null> = {
  cold: null,
  warm: "warm",
  hot: "hot",
  very_hot: "very_hot",
};

/**
 * Pipeline status follows the score upwards only, and only while the lead is
 * in a "temperature" status (new/qualified/warm/hot/very_hot). Statuses set by
 * people or workflow (waiting_customer, human_followup, terminal states) are
 * never overridden by scoring, and scoring never demotes a lead.
 */
export function promotedStatus(current: LeadStatus, classification: LeadClassification): LeadStatus {
  const currentRank = TEMPERATURE_RANK[current];
  const target = STATUS_FOR_CLASSIFICATION[classification];
  if (currentRank === undefined || target === null) return current;
  return TEMPERATURE_RANK[target]! > currentRank ? target : current;
}

// --- Lead signals --------------------------------------------------------------------

export interface RecordSignalOptions {
  sourceMessageId?: string | null;
  evidence?: string | null;
  /** When true a repeated signal is a silent no-op instead of an error. */
  ignoreDuplicate?: boolean;
}

export interface RecordSignalResult {
  recorded: boolean;
  lead: Lead;
  score: LeadScoreResult;
  statusChanged: boolean;
}

export async function getLeadSignals(db: Db, leadId: string): Promise<LeadSignal[]> {
  const rows = await db.query<{ signal: LeadSignal }>(`select signal from lead_signal_events where lead_id = $1`, [leadId]);
  return rows.map((r) => r.signal);
}

/** Records one scoring signal and recomputes the lead's cached score. Must run inside a transaction. */
export async function recordLeadSignalTx(
  tx: Db,
  leadId: string,
  signal: LeadSignal,
  ctx: ActionContext,
  options: RecordSignalOptions = {},
): Promise<RecordSignalResult> {
  const lead = await loadLead(tx, leadId, true);
  if (isTerminalLeadStatus(lead.status)) {
    throw new InvalidStateError(`Cannot record signals on a ${lead.status} lead`, { leadId, status: lead.status });
  }
  if (options.sourceMessageId) await assertMessageInConversation(tx, options.sourceMessageId, null);

  // ON CONFLICT keeps the transaction usable when the signal already exists.
  const inserted = await tx.query<{ id: string }>(
    `insert into lead_signal_events (lead_id, signal, points, source_message_id, recorded_by_type, recorded_by_staff_id, evidence)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (lead_id, signal) do nothing
     returning id`,
    [
      leadId,
      signal,
      LEAD_SIGNAL_POINTS[signal],
      options.sourceMessageId ?? null,
      ctx.actor.type,
      actorStaffId(ctx),
      options.evidence ?? null,
    ],
  );
  if (inserted.length === 0) {
    if (!options.ignoreDuplicate) throw new DuplicateLeadSignalError(leadId, signal);
    return { recorded: false, lead, score: computeLeadScore(await getLeadSignals(tx, leadId)), statusChanged: false };
  }

  const score = computeLeadScore(await getLeadSignals(tx, leadId));
  const status = promotedStatus(lead.status, score.classification);
  const updated = mapLeadRow(
    (await queryOne<LeadRow>(
      tx,
      `update leads set score = $2, score_classification = $3, status = $4, last_activity_at = now()
        where id = $1 returning *`,
      [leadId, score.score, score.classification, status],
    ))!,
  );
  await recordAction(tx, ctx, {
    actionType: "lead_signal_recorded",
    customerId: lead.customerId,
    leadId,
    input: { signal, sourceMessageId: options.sourceMessageId ?? null, evidence: options.evidence ?? null },
    output: { score: score.score, classification: score.classification, breakdown: score.breakdown, status },
  });
  return { recorded: true, lead: updated, score, statusChanged: status !== lead.status };
}

// --- Follow-up cancellation / do-not-contact ------------------------------------------

export async function cancelPendingFollowupsTx(
  tx: Db,
  filter: { customerId: string; leadId?: string; types?: readonly FollowupType[] },
  reason: string,
): Promise<number> {
  const rows = await tx.query<{ id: string }>(
    `update followups set status = 'cancelled', cancelled_at = now(), outcome_note = $4
      where status = 'pending' and customer_id = $1
        and ($2::uuid is null or lead_id = $2)
        and ($3::text[] is null or followup_type = any($3::text[]))
      returning id`,
    [filter.customerId, filter.leadId ?? null, filter.types ?? null, reason],
  );
  return rows.length;
}

/**
 * A do-not-contact request applies to the person: flag the customer, close
 * the active lead as do_not_contact and cancel every pending follow-up.
 */
export async function applyDoNotContactTx(tx: Db, customerId: string, ctx: ActionContext, reason: string | null) {
  await loadCustomer(tx, customerId, true);
  await tx.query(
    `update customers set do_not_contact = true, do_not_contact_at = coalesce(do_not_contact_at, now()) where id = $1`,
    [customerId],
  );
  const leads = await tx.query<{ id: string }>(
    `update leads set status = 'do_not_contact', last_activity_at = now()
      where customer_id = $1 and status not in ('won', 'lost', 'do_not_contact') returning id`,
    [customerId],
  );
  // Every pending follow-up is cancelled and follow-up sequences stop.
  const cancelledFollowups = await haltAllOutreachTx(tx, customerId, "cancelled: do_not_contact");
  await recordAction(tx, ctx, {
    actionType: "do_not_contact_set",
    customerId,
    leadId: leads[0]?.id ?? null,
    input: { reason },
    output: { closedLeadIds: leads.map((l) => l.id), cancelledFollowups },
  });
  return { closedLeadIds: leads.map((l) => l.id), cancelledFollowups };
}
