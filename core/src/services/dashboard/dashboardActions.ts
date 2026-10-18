import { randomUUID } from "node:crypto";
import { z } from "zod";
import { queryOne, type Db } from "../../database/db.js";
import { CustomerNotFoundError, FollowupNotFoundError, HandoffNotFoundError, LeadNotFoundError } from "../../lib/errors.js";
import { optionalText, parseInput, timestampSchema, uuidSchema } from "../../lib/validation.js";
import { CHANNELS, FOLLOWUP_TYPES } from "../../schemas/crm.js";
import { systemClock, type ActionContext, type Clock } from "../../types/context.js";
import { createApprovalService } from "../approvalService.js";
import { createConversationService } from "../crm/conversationService.js";
import { createFollowupService } from "../crm/followupService.js";
import { createHandoffService } from "../crm/handoffService.js";
import { createLeadService } from "../crm/leadService.js";
import { createFollowupEngine, type FollowupDraft } from "../followupEngine/engineService.js";
import type { FollowupDrafter } from "../followupEngine/drafting.js";
import { updateFollowupSettings } from "../followupEngine/settings.js";
import { createFollowupWorker } from "../followupEngine/worker.js";
import { requireStaffActor } from "../staffRules.js";
import { can, customerScopeSql, requireCapability, scopeStaffId, type Viewer } from "./access.js";

/**
 * Staff actions from the management dashboard.
 *
 * Each action (1) re-checks that the viewer is an active staff member,
 * (2) checks the record is within their scope (out-of-scope = not found),
 * (3) checks role rules for the action, then (4) calls the existing CRM
 * service, which applies its own business rules (do-not-contact, closed
 * leads, approver roles, AI restrictions…) and writes the audit log.
 * Nothing here sends a message to a customer.
 */

export const scheduleFollowupFormSchema = z
  .object({
    customerId: uuidSchema,
    leadId: uuidSchema.optional(),
    scheduledFor: timestampSchema,
    followupType: z.enum(FOLLOWUP_TYPES).default("sales"),
    channel: z.enum(CHANNELS).optional(),
    note: optionalText(2000),
    assignedStaffId: uuidSchema.optional(),
  })
  .strict();

const noteSchema = z.string().trim().min(1, "Note is required").max(1000);

export function createDashboardActions(db: Db, options: { clock?: Clock; drafter?: FollowupDrafter } = {}) {
  const clock = options.clock ?? systemClock;
  const engineFor = (handle: Db) => createFollowupEngine(handle, { clock, drafter: options.drafter });
  const staffCtx = (viewer: Viewer): ActionContext => ({ actor: { type: "staff", staffId: viewer.id }, requestId: randomUUID() });

  async function visibleCustomer(handle: Db, viewer: Viewer, customerId: unknown): Promise<string> {
    const id = parseInput(uuidSchema, customerId, "customer id");
    const row = await queryOne<{ id: string }>(handle, `select id from customers c where c.id = $1 and ${customerScopeSql("c.id", "$2")}`, [id, scopeStaffId(viewer)]);
    if (!row) throw new CustomerNotFoundError({ id });
    return id;
  }

  async function visibleDraftFollowup(handle: Db, viewer: Viewer, draftId: unknown): Promise<string> {
    const id = parseInput(uuidSchema, draftId, "draft id");
    const row = await queryOne<{ followup_id: string }>(handle, `select followup_id from followup_drafts where id = $1`, [id]);
    if (!row) throw new FollowupNotFoundError({ draftId: id });
    await visibleFollowup(handle, viewer, row.followup_id);
    return id;
  }

  /** Runs `fn` in one transaction with services bound to it, as the viewer. */
  async function asStaff<T>(viewer: Viewer, action: string, fn: (tx: Db, ctx: ActionContext) => Promise<T>): Promise<T> {
    const ctx: ActionContext = { actor: { type: "staff", staffId: viewer.id }, requestId: randomUUID() };
    return db.transaction(async (tx) => {
      await requireStaffActor(tx, ctx, action);
      return fn(tx, ctx);
    });
  }

  async function visibleLead(tx: Db, viewer: Viewer, leadId: string) {
    const row = await queryOne<{ id: string; customer_id: string; assigned_staff_id: string | null }>(
      tx,
      `select id, customer_id, assigned_staff_id from leads l where l.id = $1 and ${customerScopeSql("l.customer_id", "$2")}`,
      [leadId, scopeStaffId(viewer)],
    );
    if (!row) throw new LeadNotFoundError({ id: leadId });
    return row;
  }

  async function visibleFollowup(tx: Db, viewer: Viewer, followupId: string) {
    const row = await queryOne<{ id: string }>(
      tx,
      `select id from followups f where f.id = $1
          and (${customerScopeSql("f.customer_id", "$2")} or f.assigned_staff_id = $2)`,
      [followupId, scopeStaffId(viewer)],
    );
    if (!row) throw new FollowupNotFoundError({ id: followupId });
    return row;
  }

  async function visibleHandoff(tx: Db, viewer: Viewer, handoffId: string) {
    const row = await queryOne<{ id: string; conversation_id: string; lead_id: string | null; status: string; assigned_staff_id: string | null }>(
      tx,
      `select id, conversation_id, lead_id, status, assigned_staff_id from handoffs h where h.id = $1
          and ($2::uuid is null or h.assigned_staff_id = $2 or (h.status = 'open' and h.assigned_staff_id is null)
               or (h.customer_id is not null and ${customerScopeSql("h.customer_id", "$2")}))`,
      [handoffId, scopeStaffId(viewer)],
    );
    if (!row) throw new HandoffNotFoundError({ id: handoffId });
    return row;
  }

  /** Non-managers may only assign follow-up work to themselves. */
  function assignee(viewer: Viewer, requested: unknown): string {
    const id = requested === undefined || requested === null || requested === "" ? viewer.id : parseInput(uuidSchema, requested, "staff id");
    if (id !== viewer.id) requireCapability(viewer, can.assignOthers(viewer), "assign follow-ups to colleagues");
    return id;
  }

  const followupEngineActions = {
    /** Schedule an engine follow-up (purpose, priority, quiet hours, idempotent by key). */
    scheduleSmartFollowup: (viewer: Viewer, input: Record<string, unknown>) =>
      asStaff(viewer, "schedule follow-ups", async (tx, ctx) => {
        await visibleCustomer(tx, viewer, input.customerId);
        return engineFor(tx).scheduleFollowup({ ...input, assignedStaffId: assignee(viewer, input.assignedStaffId) } as never, ctx);
      }),

    /** Opt-in Day 1 / 3 / 7 sequence for one customer. */
    enrollSequence: (viewer: Viewer, input: Record<string, unknown>) =>
      asStaff(viewer, "start follow-up sequences", async (_tx, ctx) => {
        await visibleCustomer(db, viewer, input.customerId);
        return engineFor(db).enrollSequence({ ...input, assignedStaffId: assignee(viewer, input.assignedStaffId) } as never, ctx);
      }),

    /**
     * Ask for a draft now. The model call runs outside any database
     * transaction; `requestKey` (one per form) makes double-submits harmless.
     */
    generateDraft: async (viewer: Viewer, followupId: unknown, requestKey: unknown): Promise<FollowupDraft> => {
      const ctx = staffCtx(viewer);
      await requireStaffActor(db, ctx, "generate follow-up drafts");
      const id = parseInput(uuidSchema, followupId, "follow-up id");
      await visibleFollowup(db, viewer, id);
      const key = parseInput(z.string().trim().min(8).max(100), requestKey, "request key");
      return engineFor(db).generateDraft(id, ctx, { sourceEventKey: `request:${key}` });
    },

    editDraft: async (viewer: Viewer, input: { followupId: unknown; content: unknown; language: unknown; requestKey: unknown }) => {
      const ctx = staffCtx(viewer);
      await visibleFollowup(db, viewer, parseInput(uuidSchema, input.followupId, "follow-up id"));
      return engineFor(db).editDraft({ followupId: input.followupId, content: input.content, language: input.language, eventKey: input.requestKey }, ctx);
    },

    approveDraft: async (viewer: Viewer, draftId: unknown, note?: unknown) => {
      const id = await visibleDraftFollowup(db, viewer, draftId);
      return engineFor(db).approveDraft(id, staffCtx(viewer), note);
    },

    rejectDraft: async (viewer: Viewer, draftId: unknown, note?: unknown) => {
      const id = await visibleDraftFollowup(db, viewer, draftId);
      return engineFor(db).rejectDraft(id, staffCtx(viewer), note);
    },

    rescheduleFollowup: async (viewer: Viewer, followupId: unknown, when: unknown) => {
      const id = parseInput(uuidSchema, followupId, "follow-up id");
      await visibleFollowup(db, viewer, id);
      return engineFor(db).reschedule(id, when, staffCtx(viewer));
    },

    cancelSmartFollowup: async (viewer: Viewer, followupId: unknown, reason?: unknown) => {
      const id = parseInput(uuidSchema, followupId, "follow-up id");
      await visibleFollowup(db, viewer, id);
      return engineFor(db).cancel(id, reason, staffCtx(viewer));
    },

    completeSmartFollowup: async (viewer: Viewer, followupId: unknown, outcome?: unknown) => {
      const id = parseInput(uuidSchema, followupId, "follow-up id");
      await visibleFollowup(db, viewer, id);
      return engineFor(db).complete(id, outcome, staffCtx(viewer));
    },

    requestHumanTakeover: async (viewer: Viewer, customerId: unknown, note?: unknown) => {
      const id = await visibleCustomer(db, viewer, customerId);
      return engineFor(db).requestHumanTakeover(id, note, staffCtx(viewer));
    },

    setContactConsent: async (viewer: Viewer, customerId: unknown, consent: unknown, source: unknown) => {
      const id = await visibleCustomer(db, viewer, customerId);
      return engineFor(db).setContactConsent(id, consent, source, staffCtx(viewer));
    },

    setIdentityReview: async (viewer: Viewer, customerId: unknown, required: unknown) => {
      const id = await visibleCustomer(db, viewer, customerId);
      return engineFor(db).setIdentityReview(id, required, staffCtx(viewer));
    },

    /** Managers can run the processing worker on demand (it never sends anything). */
    runFollowupWorker: async (viewer: Viewer) => {
      requireCapability(viewer, can.assignOthers(viewer), "run follow-up processing");
      await requireStaffActor(db, staffCtx(viewer), "run follow-up processing");
      return createFollowupWorker(db, { clock, drafter: options.drafter, workerId: `dashboard-${viewer.id.slice(0, 8)}` }).runOnce();
    },

    updateFollowupSettings: (viewer: Viewer, input: unknown) => updateFollowupSettings(db, input, staffCtx(viewer)),
  };

  return {
    ...followupEngineActions,
    /** Managers assign any active colleague; others cannot reassign leads. */
    assignLead: (viewer: Viewer, leadId: unknown, staffId: unknown) =>
      asStaff(viewer, "assign leads", async (tx, ctx) => {
        requireCapability(viewer, can.assignOthers(viewer), "assign leads");
        const id = parseInput(uuidSchema, leadId, "lead id");
        await visibleLead(tx, viewer, id);
        return createLeadService(tx).updateLead(id, { assignedStaffId: parseInput(uuidSchema, staffId, "staff id") }, ctx);
      }),

    addLeadNote: (viewer: Viewer, leadId: unknown, note: unknown) =>
      asStaff(viewer, "add lead notes", async (tx, ctx) => {
        const id = parseInput(uuidSchema, leadId, "lead id");
        await visibleLead(tx, viewer, id);
        return createLeadService(tx).appendLeadNote(id, parseInput(noteSchema, note, "note"), ctx);
      }),

    markLeadWon: (viewer: Viewer, leadId: unknown, note?: unknown) =>
      asStaff(viewer, "mark leads won", async (tx, ctx) => {
        const id = parseInput(uuidSchema, leadId, "lead id");
        await visibleLead(tx, viewer, id);
        return createLeadService(tx).markLeadWon(id, ctx, parseInput(optionalText(1000), note, "note") ?? undefined);
      }),

    markLeadLost: (viewer: Viewer, leadId: unknown, reason: unknown) =>
      asStaff(viewer, "mark leads lost", async (tx, ctx) => {
        const id = parseInput(uuidSchema, leadId, "lead id");
        await visibleLead(tx, viewer, id);
        return createLeadService(tx).markLeadLost(id, parseInput(noteSchema, reason, "lost reason"), ctx);
      }),

    /** Records a follow-up for staff to do; nothing is sent automatically. */
    scheduleFollowup: (viewer: Viewer, input: unknown) =>
      asStaff(viewer, "schedule follow-ups", async (tx, ctx) => {
        const data = parseInput(scheduleFollowupFormSchema, input, "follow-up");
        const assignee = data.assignedStaffId ?? viewer.id;
        if (assignee !== viewer.id) requireCapability(viewer, can.assignOthers(viewer), "assign follow-ups to colleagues");
        const visible = await queryOne<{ id: string }>(
          tx,
          `select id from customers c where c.id = $1 and ${customerScopeSql("c.id", "$2")}`,
          [data.customerId, scopeStaffId(viewer)],
        );
        if (!visible) throw new CustomerNotFoundError({ id: data.customerId });
        return createFollowupService(tx, clock).scheduleFollowup({ ...data, assignedStaffId: assignee }, ctx);
      }),

    completeFollowup: (viewer: Viewer, followupId: unknown, note?: unknown) =>
      asStaff(viewer, "complete follow-ups", async (tx, ctx) => {
        const id = parseInput(uuidSchema, followupId, "follow-up id");
        await visibleFollowup(tx, viewer, id);
        return createFollowupService(tx, clock).completeFollowup(id, ctx, parseInput(optionalText(2000), note, "note") ?? undefined);
      }),

    cancelFollowup: (viewer: Viewer, followupId: unknown, reason?: unknown) =>
      asStaff(viewer, "cancel follow-ups", async (tx, ctx) => {
        const id = parseInput(uuidSchema, followupId, "follow-up id");
        await visibleFollowup(tx, viewer, id);
        return createFollowupService(tx, clock).cancelFollowup(id, ctx, parseInput(optionalText(2000), reason, "reason") ?? undefined);
      }),

    /**
     * A staff member takes over a handoff: the handoff and conversation are
     * assigned to them, human takeover stays active (AI replies blocked), and
     * an unassigned lead becomes theirs. Sales/support may take unassigned
     * handoffs or their own; managers may take any.
     */
    takeOverHandoff: (viewer: Viewer, handoffId: unknown) =>
      asStaff(viewer, "take over handoffs", async (tx, ctx) => {
        const id = parseInput(uuidSchema, handoffId, "handoff id");
        const h = await visibleHandoff(tx, viewer, id);
        if (h.assigned_staff_id && h.assigned_staff_id !== viewer.id) {
          requireCapability(viewer, can.assignOthers(viewer), "take over a colleague's handoff");
        }
        const handoffs = createHandoffService(tx);
        const conversations = createConversationService(tx);
        const handoff = await handoffs.assignHandoff(id, viewer.id, ctx);
        await conversations.setHumanTakeover(h.conversation_id, { active: true, reason: "staff took over from the dashboard" }, ctx);
        await conversations.assignStaff(h.conversation_id, viewer.id, ctx);
        if (h.lead_id) {
          const lead = await queryOne<{ assigned_staff_id: string | null; status: string }>(
            tx,
            `select assigned_staff_id, status from leads where id = $1`,
            [h.lead_id],
          );
          if (lead && !lead.assigned_staff_id && !["won", "lost", "do_not_contact"].includes(lead.status)) {
            await createLeadService(tx).updateLead(h.lead_id, { assignedStaffId: viewer.id }, ctx);
          }
        }
        return handoff;
      }),

    /**
     * Resolves a handoff. `releaseTakeover` hands the conversation back to the
     * AI — a staff-only decision (the core services refuse it from the AI).
     */
    resolveHandoff: (viewer: Viewer, handoffId: unknown, input: { releaseTakeover?: unknown; note?: unknown }) =>
      asStaff(viewer, "resolve handoffs", async (tx, ctx) => {
        const id = parseInput(uuidSchema, handoffId, "handoff id");
        const h = await visibleHandoff(tx, viewer, id);
        if (h.assigned_staff_id !== viewer.id) requireCapability(viewer, can.assignOthers(viewer), "resolve a handoff assigned to someone else");
        return createHandoffService(tx).resolveHandoff(id, ctx, {
          releaseTakeover: input.releaseTakeover === true,
          note: parseInput(optionalText(2000), input.note, "note") ?? undefined,
        });
      }),

    /** Approver roles only — enforced again by the approval service. */
    decideApproval: (viewer: Viewer, approvalId: unknown, decision: unknown, note?: unknown) =>
      asStaff(viewer, "decide approvals", async (tx, ctx) => {
        requireCapability(viewer, can.decideApprovals(viewer), "decide approvals");
        const id = parseInput(uuidSchema, approvalId, "approval id");
        const d = parseInput(z.enum(["approved", "rejected"]), decision, "decision");
        const text = parseInput(optionalText(2000), note, "note") ?? undefined;
        const approvals = createApprovalService(tx);
        return d === "approved" ? approvals.approve(id, ctx, text) : approvals.reject(id, ctx, text);
      }),
  };
}

export type DashboardActions = ReturnType<typeof createDashboardActions>;
