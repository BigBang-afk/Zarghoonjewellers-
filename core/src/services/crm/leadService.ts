import { z } from "zod";
import { isUniqueViolation, queryOne, type Db } from "../../database/db.js";
import {
  ActiveLeadExistsError,
  DoNotContactError,
  ForbiddenActionError,
  InvalidStateError,
} from "../../lib/errors.js";
import { currencySchema, moneySchema } from "../../lib/money.js";
import { optionalText, parseInput, patchText, uuidSchema } from "../../lib/validation.js";
import {
  CHANNELS,
  isTerminalLeadStatus,
  LEAD_STATUSES,
  mapLeadRow,
  type Lead,
  type LeadRow,
  type LeadStatus,
} from "../../schemas/crm.js";
import type { ActionContext } from "../../types/context.js";
import { recordAction } from "../auditService.js";
import { stopLeadSequencesTx } from "../followupEngine/hooks.js";
import { assertAssignableStaff, requireStaffActor } from "../staffRules.js";
import { computeLeadScore, LEAD_SIGNALS, type LeadScoreResult, type LeadSignal } from "./leadScoring.js";
import {
  applyDoNotContactTx,
  cancelPendingFollowupsTx,
  findActiveLead,
  getLeadSignals,
  loadCustomer,
  loadLead,
  recordLeadSignalTx,
  type RecordSignalResult,
} from "./shared.js";

/**
 * Lead lifecycle.
 *
 *   new → (signals raise score) → warm → hot → very_hot
 *       ↘ qualified / waiting_customer / human_followup (set by people/workflow)
 *   any active status → won | lost | do_not_contact   (terminal)
 *
 * - One active lead per customer (DB-enforced).
 * - Score and classification are only ever produced by `computeLeadScore`.
 * - Only staff/system can mark a lead won or lost; the AI cannot claim a sale.
 * - Closing a lead cancels its pending sales follow-ups.
 */

/** Statuses the AI may set directly. Temperature statuses come from scoring only. */
const AI_SETTABLE_STATUSES: readonly LeadStatus[] = ["waiting_customer"];
const MANUAL_STATUSES = LEAD_STATUSES.filter((s) => !isTerminalLeadStatus(s)) as LeadStatus[];

export const createLeadSchema = z
  .object({
    customerId: uuidSchema,
    sourceChannel: z.enum(CHANNELS).optional(),
    budgetAmount: moneySchema("budgetAmount").optional(),
    budgetCurrency: currencySchema.optional(),
    assignedStaffId: uuidSchema.optional(),
    notes: optionalText(5000),
  })
  .strict();
export type CreateLeadInput = z.input<typeof createLeadSchema>;

export const updateLeadSchema = z
  .object({
    status: z.enum(MANUAL_STATUSES as [LeadStatus, ...LeadStatus[]]).optional(),
    sourceChannel: z.enum(CHANNELS).nullable().optional(),
    budgetAmount: moneySchema("budgetAmount").nullable().optional(),
    budgetCurrency: currencySchema.nullable().optional(),
    assignedStaffId: uuidSchema.nullable().optional(),
    notes: patchText(5000),
  })
  .strict();
export type UpdateLeadInput = z.input<typeof updateLeadSchema>;

export const recordSignalSchema = z
  .object({
    signal: z.enum(LEAD_SIGNALS as [LeadSignal, ...LeadSignal[]]),
    sourceMessageId: uuidSchema.optional(),
    evidence: optionalText(1000),
  })
  .strict();
export type RecordSignalInput = z.input<typeof recordSignalSchema>;

export interface LeadWithScore extends Lead {
  scoreBreakdown: LeadScoreResult["breakdown"];
}

export function createLeadService(db: Db) {
  async function createLead(input: CreateLeadInput, ctx: ActionContext): Promise<Lead> {
    const data = parseInput(createLeadSchema, input, "lead");
    try {
      return await db.transaction(async (tx) => {
        const customer = await loadCustomer(tx, data.customerId, true);
        if (customer.doNotContact) throw new DoNotContactError(customer.id);
        const active = await findActiveLead(tx, customer.id);
        if (active) throw new ActiveLeadExistsError(customer.id, active.id);
        if (data.assignedStaffId) await assertAssignableStaff(tx, data.assignedStaffId, ctx);

        const row = await queryOne<LeadRow>(
          tx,
          `insert into leads (customer_id, source_channel, budget_amount, budget_currency, assigned_staff_id, notes)
           values ($1, $2, $3, $4, $5, $6) returning *`,
          [
            customer.id,
            data.sourceChannel ?? null,
            data.budgetAmount ?? null,
            data.budgetAmount ? (data.budgetCurrency ?? "PKR") : null,
            data.assignedStaffId ?? null,
            data.notes,
          ],
        );
        let lead = mapLeadRow(row!);
        await recordAction(tx, ctx, {
          actionType: "lead_created",
          customerId: customer.id,
          leadId: lead.id,
          input: data,
        });
        // A stated budget is itself a scoring signal — recorded by code, not by the model.
        if (data.budgetAmount) {
          lead = (await recordLeadSignalTx(tx, lead.id, "provided_budget", ctx, { evidence: "budget supplied at lead creation" })).lead;
        }
        return lead;
      });
    } catch (error) {
      if (isUniqueViolation(error, "leads_one_active_per_customer")) {
        const active = await findActiveLead(db, data.customerId);
        throw new ActiveLeadExistsError(data.customerId, active?.id ?? "unknown");
      }
      throw error;
    }
  }

  async function getLeadById(id: string): Promise<LeadWithScore> {
    const lead = await loadLead(db, parseInput(uuidSchema, id, "lead id"));
    const score = computeLeadScore(await getLeadSignals(db, lead.id));
    return { ...lead, scoreBreakdown: score.breakdown };
  }

  async function getCustomerLeads(customerId: string): Promise<Lead[]> {
    const id = parseInput(uuidSchema, customerId, "customer id");
    const rows = await db.query<LeadRow>(`select * from leads where customer_id = $1 order by created_at desc`, [id]);
    return rows.map(mapLeadRow);
  }

  async function getActiveLead(customerId: string): Promise<Lead | null> {
    return findActiveLead(db, parseInput(uuidSchema, customerId, "customer id"));
  }

  /** Recomputes the score from the signal audit trail (the source of truth). */
  async function getLeadScore(leadId: string): Promise<LeadScoreResult> {
    const lead = await loadLead(db, parseInput(uuidSchema, leadId, "lead id"));
    return computeLeadScore(await getLeadSignals(db, lead.id));
  }

  async function updateLead(id: string, input: UpdateLeadInput, ctx: ActionContext): Promise<Lead> {
    const leadId = parseInput(uuidSchema, id, "lead id");
    const patch = parseInput(updateLeadSchema, input, "lead update");
    return db.transaction(async (tx) => {
      const current = await loadLead(tx, leadId, true);
      if (isTerminalLeadStatus(current.status)) {
        throw new InvalidStateError(`Lead is ${current.status} and can no longer be changed`, { leadId });
      }
      if (patch.status && ctx.actor.type === "ai" && !AI_SETTABLE_STATUSES.includes(patch.status)) {
        throw new ForbiddenActionError(`The AI may not set lead status "${patch.status}"`, { leadId });
      }
      if (patch.assignedStaffId) await assertAssignableStaff(tx, patch.assignedStaffId, ctx);

      const columns = {
        status: "status",
        sourceChannel: "source_channel",
        budgetAmount: "budget_amount",
        budgetCurrency: "budget_currency",
        assignedStaffId: "assigned_staff_id",
        notes: "notes",
      } as const;
      const keys = (Object.keys(columns) as (keyof typeof columns)[]).filter((k) => patch[k] !== undefined);
      const values = keys.map((k) => patch[k] ?? null);
      // Budget currency defaults to PKR when an amount is given without one.
      if (patch.budgetAmount && patch.budgetCurrency === undefined && !current.budgetCurrency) {
        keys.push("budgetCurrency");
        values.push("PKR");
      }
      if (keys.length === 0) return current;

      const sets = keys.map((k, i) => `${columns[k]} = $${i + 2}`);
      let lead = mapLeadRow(
        (await queryOne<LeadRow>(
          tx,
          `update leads set ${sets.join(", ")}, last_activity_at = now() where id = $1 returning *`,
          [leadId, ...values],
        ))!,
      );
      await recordAction(tx, ctx, {
        actionType: "lead_updated",
        customerId: lead.customerId,
        leadId,
        input: patch,
        output: { fromStatus: current.status, toStatus: lead.status },
      });
      if (patch.budgetAmount) {
        lead = (await recordLeadSignalTx(tx, leadId, "provided_budget", ctx, { ignoreDuplicate: true })).lead;
      }
      return lead;
    });
  }

  async function recordLeadSignal(leadId: string, input: RecordSignalInput, ctx: ActionContext): Promise<RecordSignalResult> {
    const id = parseInput(uuidSchema, leadId, "lead id");
    const data = parseInput(recordSignalSchema, input, "lead signal");
    return db.transaction((tx) =>
      recordLeadSignalTx(tx, id, data.signal, ctx, { sourceMessageId: data.sourceMessageId, evidence: data.evidence }),
    );
  }

  async function closeLead(
    leadId: string,
    outcome: "won" | "lost",
    reason: string | null,
    ctx: ActionContext,
  ): Promise<Lead> {
    const id = parseInput(uuidSchema, leadId, "lead id");
    return db.transaction(async (tx) => {
      if (ctx.actor.type === "ai") {
        throw new ForbiddenActionError(`The AI may not mark a lead ${outcome}`, { leadId: id });
      }
      if (ctx.actor.type === "staff") await requireStaffActor(tx, ctx, `mark leads ${outcome}`);
      const current = await loadLead(tx, id, true);
      if (isTerminalLeadStatus(current.status)) {
        throw new InvalidStateError(`Lead is already ${current.status}`, { leadId: id });
      }
      const row = await queryOne<LeadRow>(
        tx,
        outcome === "won"
          ? `update leads set status = 'won', won_at = now(), last_activity_at = now(),
                    notes = coalesce($2, notes) where id = $1 returning *`
          : `update leads set status = 'lost', lost_at = now(), lost_reason = $2, last_activity_at = now()
              where id = $1 returning *`,
        [id, reason],
      );
      const lead = mapLeadRow(row!);
      // Normal sales chasing stops; after-sales/order follow-ups remain.
      const cancelled = await cancelPendingFollowupsTx(
        tx,
        { customerId: lead.customerId, leadId: id, types: ["sales"] },
        `cancelled: lead ${outcome}`,
      );
      await stopLeadSequencesTx(tx, id, `lead_${outcome}`);
      await recordAction(tx, ctx, {
        actionType: `lead_${outcome}`,
        customerId: lead.customerId,
        leadId: id,
        input: { reason },
        output: { cancelledSalesFollowups: cancelled },
      });
      return lead;
    });
  }

  async function markLeadDoNotContact(leadId: string, ctx: ActionContext, reason?: string) {
    const id = parseInput(uuidSchema, leadId, "lead id");
    return db.transaction(async (tx) => {
      const lead = await loadLead(tx, id);
      return applyDoNotContactTx(tx, lead.customerId, ctx, reason ?? null);
    });
  }

  async function getHotLeads(limit = 50): Promise<Lead[]> {
    const rows = await db.query<LeadRow>(
      `select * from leads
        where status not in ('won', 'lost', 'do_not_contact') and score_classification in ('hot', 'very_hot')
        order by score desc, last_activity_at desc
        limit $1`,
      [Math.min(limit, 200)],
    );
    return rows.map(mapLeadRow);
  }

  /**
   * Active leads that deserve attention but have nothing scheduled:
   * warm-or-better (score ≥ 21) or waiting on a human, with no pending
   * follow-up, and whose customer has not opted out.
   */
  async function getLeadsNeedingFollowup(limit = 50): Promise<Lead[]> {
    const rows = await db.query<LeadRow>(
      `select l.* from leads l
         join customers c on c.id = l.customer_id
        where l.status not in ('won', 'lost', 'do_not_contact')
          and not c.do_not_contact
          and (l.score >= 21 or l.status in ('human_followup', 'waiting_customer'))
          and not exists (select 1 from followups f where f.lead_id = l.id and f.status = 'pending')
        order by l.score desc, l.last_activity_at asc
        limit $1`,
      [Math.min(limit, 200)],
    );
    return rows.map(mapLeadRow);
  }

  /**
   * Staff add a dated, attributed note to a lead. Notes are appended under a
   * row lock (never overwritten); the 5000-character limit is enforced, not
   * silently truncated.
   */
  async function appendLeadNote(leadId: string, note: string, ctx: ActionContext): Promise<Lead> {
    const id = parseInput(uuidSchema, leadId, "lead id");
    const text = parseInput(z.string().trim().min(1, "Note is required").max(1000), note, "note");
    return db.transaction(async (tx) => {
      const staff = await requireStaffActor(tx, ctx, "add lead notes");
      const current = await loadLead(tx, id, true);
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      const entry = `[${stamp} UTC · ${staff.fullName}] ${text}`;
      const notes = current.notes ? `${current.notes}\n${entry}` : entry;
      if (notes.length > 5000) throw new InvalidStateError("Lead notes are full (5000 characters)", { leadId: id });
      const lead = mapLeadRow(
        (await queryOne<LeadRow>(tx, `update leads set notes = $2, last_activity_at = now() where id = $1 returning *`, [id, notes]))!,
      );
      await recordAction(tx, ctx, { actionType: "lead_note_added", customerId: lead.customerId, leadId: id, input: { note: text } });
      return lead;
    });
  }

  return {
    createLead,
    appendLeadNote,
    getLeadById,
    getCustomerLeads,
    getActiveLead,
    getLeadScore,
    updateLead,
    recordLeadSignal,
    markLeadWon: (id: string, ctx: ActionContext, note?: string) => closeLead(id, "won", note ?? null, ctx),
    markLeadLost: async (id: string, reason: string, ctx: ActionContext) =>
      closeLead(id, "lost", parseInput(z.string().trim().min(1).max(1000), reason, "lost reason"), ctx),
    markLeadDoNotContact,
    getHotLeads,
    getLeadsNeedingFollowup,
  };
}

export type LeadService = ReturnType<typeof createLeadService>;
