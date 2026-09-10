import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAdminRole } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"
import { writeAuditLog } from "../../shared/audit.js"
import { requestMoreInfo, refundDispute, adjustDriverPayout, closeDispute } from "../../services/disputeService.js"

export const adminTrustRouter = Router()

function pagination(query: Record<string, unknown>) {
  const take = Math.min(100, Number(query.pageSize) || 20)
  const page = Math.max(1, Number(query.page) || 1)
  return { take, skip: (page - 1) * take, page }
}

// ---------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------

adminTrustRouter.get(
  "/disputes",
  asyncHandler(async (req, res) => {
    const { status } = req.query as Record<string, string>
    const { take, skip, page } = pagination(req.query as Record<string, unknown>)
    const where = status ? { status } : {}
    const [disputes, total] = await Promise.all([
      prisma.dispute.findMany({ where, include: { ride: true, raisedBy: true, resolvedBy: true }, orderBy: { createdAt: "desc" }, take, skip }),
      prisma.dispute.count({ where }),
    ])
    res.json({ disputes, total, page, pageSize: take })
  }),
)

/**
 * Dispute resolution (Phase 3 §19) — five distinct admin actions instead
 * of a single opaque "resolve", each leaving its own audit-log entry:
 * request more info, refund the passenger, adjust the driver's payout,
 * or close the dispute with no monetary action.
 */
adminTrustRouter.post(
  "/disputes/:id/request-info",
  requireAdminRole("super_admin", "ops_manager", "finance"),
  validateBody(z.object({ message: z.string().trim().min(1).max(500) })),
  asyncHandler(async (req, res) => {
    const dispute = await requestMoreInfo(req.params.id, req.auth!.userId, req.body.message)
    await writeAuditLog({ req, action: "dispute.request_info", targetTable: "disputes", targetId: dispute.id, after: req.body })
    res.json({ dispute })
  }),
)

adminTrustRouter.post(
  "/disputes/:id/refund",
  requireAdminRole("super_admin", "ops_manager", "finance"),
  validateBody(z.object({ amountRs: z.number().positive().optional(), resolution: z.string().trim().min(1).max(500) })),
  asyncHandler(async (req, res) => {
    const dispute = await refundDispute(req.params.id, req.auth!.userId, req.body.amountRs, req.body.resolution)
    await writeAuditLog({ req, action: "dispute.refund", targetTable: "disputes", targetId: dispute.id, after: req.body })
    res.json({ dispute })
  }),
)

adminTrustRouter.post(
  "/disputes/:id/adjust",
  requireAdminRole("super_admin", "ops_manager", "finance"),
  validateBody(z.object({ amountRs: z.number(), resolution: z.string().trim().min(1).max(500) })),
  asyncHandler(async (req, res) => {
    const dispute = await adjustDriverPayout(req.params.id, req.auth!.userId, req.body.amountRs, req.body.resolution)
    await writeAuditLog({ req, action: "dispute.adjust", targetTable: "disputes", targetId: dispute.id, after: req.body })
    res.json({ dispute })
  }),
)

adminTrustRouter.post(
  "/disputes/:id/close",
  requireAdminRole("super_admin", "ops_manager", "finance"),
  validateBody(z.object({ resolution: z.string().trim().min(1).max(500), status: z.enum(["closed", "rejected"]).default("closed") })),
  asyncHandler(async (req, res) => {
    const dispute = await closeDispute(req.params.id, req.auth!.userId, req.body.resolution, req.body.status)
    await writeAuditLog({ req, action: `dispute.${req.body.status}`, targetTable: "disputes", targetId: dispute.id, after: req.body })
    res.json({ dispute })
  }),
)

// ---------------------------------------------------------------------
// Support tickets
// ---------------------------------------------------------------------

adminTrustRouter.get(
  "/support-tickets",
  asyncHandler(async (req, res) => {
    const { status, priority, category } = req.query as Record<string, string>
    const { take, skip, page } = pagination(req.query as Record<string, unknown>)
    const where = { ...(status ? { status } : {}), ...(priority ? { priority } : {}), ...(category ? { category } : {}) }
    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({ where, include: { user: true, assignedAdmin: true, ride: true }, orderBy: { createdAt: "desc" }, take, skip }),
      prisma.supportTicket.count({ where }),
    ])
    res.json({ tickets, total, page, pageSize: take })
  }),
)

adminTrustRouter.get(
  "/support-tickets/:id",
  asyncHandler(async (req, res) => {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { fullName: true, phone: true, email: true } },
        assignedAdmin: { select: { fullName: true } },
        ride: true,
        messages: { orderBy: { createdAt: "asc" }, include: { author: { select: { fullName: true } } } },
      },
    })
    if (!ticket) throw ApiError.notFound("Ticket not found.")
    res.json({ ticket })
  }),
)

adminTrustRouter.patch(
  "/support-tickets/:id",
  requireAdminRole("super_admin", "ops_manager", "support_agent"),
  validateBody(
    z.object({
      status: z.enum(["open", "in_progress", "waiting", "resolved", "closed"]).optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      assignToSelf: z.boolean().optional(),
      assignedAdminId: z.string().uuid().optional(),
      internalNotes: z.string().trim().max(2000).optional(),
      dueAt: z.coerce.date().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } })
    if (!ticket) throw ApiError.notFound("Ticket not found.")
    const updated = await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        status: req.body.status,
        priority: req.body.priority,
        assignedAdminId: req.body.assignToSelf ? req.auth!.userId : req.body.assignedAdminId,
        internalNotes: req.body.internalNotes,
        dueAt: req.body.dueAt,
        resolvedAt: req.body.status === "resolved" || req.body.status === "closed" ? new Date() : undefined,
      },
    })
    await writeAuditLog({ req, action: "support_ticket.update", targetTable: "support_tickets", targetId: ticket.id, before: ticket, after: req.body })
    res.json({ ticket: updated })
  }),
)

adminTrustRouter.post(
  "/support-tickets/:id/messages",
  requireAdminRole("super_admin", "ops_manager", "support_agent"),
  validateBody(z.object({ body: z.string().trim().min(1).max(2000) })),
  asyncHandler(async (req, res) => {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } })
    if (!ticket) throw ApiError.notFound("Ticket not found.")
    const message = await prisma.supportMessage.create({
      data: { ticketId: ticket.id, authorUserId: req.auth!.userId, isAdmin: true, body: req.body.body },
    })
    if (ticket.status === "open") {
      await prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: "in_progress" } })
    }
    res.status(201).json({ message })
  }),
)

// ---------------------------------------------------------------------
// Lost & found (Phase 5 §15) — the structured view; the underlying
// message thread is the same SupportTicket every /support/tickets/:id
// endpoint already serves, so admin uses that for replies.
// ---------------------------------------------------------------------

adminTrustRouter.get(
  "/lost-item-reports",
  asyncHandler(async (req, res) => {
    const { status } = req.query as Record<string, string>
    const { take, skip, page } = pagination(req.query as Record<string, unknown>)
    const where = status ? { status } : {}
    const [reports, total] = await Promise.all([
      prisma.lostItemReport.findMany({
        where,
        include: {
          reporter: { select: { fullName: true, phone: true } },
          driver: { select: { fullName: true, phone: true } },
          ticket: { select: { id: true, status: true } },
        },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.lostItemReport.count({ where }),
    ])
    res.json({ reports, total, page, pageSize: take })
  }),
)

adminTrustRouter.patch(
  "/lost-item-reports/:id",
  requireAdminRole("super_admin", "ops_manager", "support_agent"),
  validateBody(z.object({ status: z.enum(["return_arranged", "returned", "closed"]) })),
  asyncHandler(async (req, res) => {
    const report = await prisma.lostItemReport.findUnique({ where: { id: req.params.id } })
    if (!report) throw ApiError.notFound("Lost item report not found.")
    const updated = await prisma.lostItemReport.update({
      where: { id: report.id },
      data: { status: req.body.status, resolvedAt: ["returned", "closed"].includes(req.body.status) ? new Date() : undefined },
    })
    await writeAuditLog({ req, action: "lost_item.update", targetTable: "lost_item_reports", targetId: report.id, before: report, after: req.body })
    res.json({ report: updated })
  }),
)

// ---------------------------------------------------------------------
// Safety events
// ---------------------------------------------------------------------

adminTrustRouter.get(
  "/safety-events",
  asyncHandler(async (req, res) => {
    const { severity, resolved, assignedAdminId } = req.query as Record<string, string>
    const { take, skip, page } = pagination(req.query as Record<string, unknown>)
    const where = {
      ...(severity ? { severity } : {}),
      ...(resolved === "true" ? { resolvedAt: { not: null } } : {}),
      ...(resolved === "false" ? { resolvedAt: null } : {}),
      ...(assignedAdminId ? { assignedAdminId } : {}),
    }
    const [events, total] = await Promise.all([
      prisma.safetyEvent.findMany({
        where,
        include: { user: true, ride: true, assignedAdmin: { select: { fullName: true } } },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.safetyEvent.count({ where }),
    ])
    res.json({ events, total, page, pageSize: take })
  }),
)

/**
 * Safety operations center (Phase 4 §21) — investigator assignment and
 * notes are separate from resolution: severe cases can be actively
 * worked before anyone decides the outcome, and the algorithm that
 * raised the event never enforces anything on its own — a human always
 * assigns, investigates, and resolves.
 */
adminTrustRouter.patch(
  "/safety-events/:id",
  requireAdminRole("super_admin", "ops_manager", "safety_officer"),
  validateBody(
    z.object({
      assignToSelf: z.boolean().optional(),
      assignedAdminId: z.string().uuid().optional(),
      notes: z.string().trim().max(2000).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const event = await prisma.safetyEvent.findUnique({ where: { id: req.params.id } })
    if (!event) throw ApiError.notFound("Safety event not found.")
    const updated = await prisma.safetyEvent.update({
      where: { id: event.id },
      data: {
        assignedAdminId: req.body.assignToSelf ? req.auth!.userId : req.body.assignedAdminId,
        notes: req.body.notes,
      },
    })
    await writeAuditLog({ req, action: "safety_event.update", targetTable: "safety_events", targetId: event.id, before: event, after: req.body })
    res.json({ event: updated })
  }),
)

adminTrustRouter.post(
  "/safety-events/:id/resolve",
  requireAdminRole("super_admin", "ops_manager", "safety_officer"),
  validateBody(z.object({ notes: z.string().trim().max(2000).optional() })),
  asyncHandler(async (req, res) => {
    const event = await prisma.safetyEvent.findUnique({ where: { id: req.params.id } })
    if (!event) throw ApiError.notFound("Safety event not found.")
    const updated = await prisma.safetyEvent.update({
      where: { id: event.id },
      data: { resolvedAt: new Date(), notes: req.body.notes ?? event.notes },
    })
    await writeAuditLog({ req, action: "safety_event.resolve", targetTable: "safety_events", targetId: event.id, after: req.body })
    res.json({ event: updated })
  }),
)
