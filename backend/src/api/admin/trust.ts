import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { ApiError } from "../../utils/apiError.js"
import { writeAuditLog } from "../../shared/audit.js"
import { notify } from "../../services/notifications/NotificationService.js"

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

adminTrustRouter.post(
  "/disputes/:id/resolve",
  validateBody(z.object({ resolution: z.string().trim().min(1).max(500), status: z.enum(["resolved", "rejected"]) })),
  asyncHandler(async (req, res) => {
    const dispute = await prisma.dispute.findUnique({ where: { id: req.params.id } })
    if (!dispute) throw ApiError.notFound("Dispute not found.")
    const updated = await prisma.dispute.update({
      where: { id: dispute.id },
      data: { status: req.body.status, resolution: req.body.resolution, resolvedById: req.auth!.userId, resolvedAt: new Date() },
    })
    await writeAuditLog({ req, action: "dispute.resolve", targetTable: "disputes", targetId: dispute.id, after: req.body })
    await notify({ userId: dispute.raisedById, type: "system", title: "Dispute update", body: req.body.resolution })
    res.json({ dispute: updated })
  }),
)

// ---------------------------------------------------------------------
// Support tickets
// ---------------------------------------------------------------------

adminTrustRouter.get(
  "/support-tickets",
  asyncHandler(async (req, res) => {
    const { status, priority } = req.query as Record<string, string>
    const { take, skip, page } = pagination(req.query as Record<string, unknown>)
    const where = { ...(status ? { status } : {}), ...(priority ? { priority } : {}) }
    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({ where, include: { user: true, assignedAdmin: true, ride: true }, orderBy: { createdAt: "desc" }, take, skip }),
      prisma.supportTicket.count({ where }),
    ])
    res.json({ tickets, total, page, pageSize: take })
  }),
)

adminTrustRouter.patch(
  "/support-tickets/:id",
  validateBody(
    z.object({
      status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      assignToSelf: z.boolean().optional(),
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
        assignedAdminId: req.body.assignToSelf ? req.auth!.userId : undefined,
        resolvedAt: req.body.status === "resolved" || req.body.status === "closed" ? new Date() : undefined,
      },
    })
    await writeAuditLog({ req, action: "support_ticket.update", targetTable: "support_tickets", targetId: ticket.id, after: req.body })
    res.json({ ticket: updated })
  }),
)

// ---------------------------------------------------------------------
// Safety events
// ---------------------------------------------------------------------

adminTrustRouter.get(
  "/safety-events",
  asyncHandler(async (req, res) => {
    const { severity, resolved } = req.query as Record<string, string>
    const { take, skip, page } = pagination(req.query as Record<string, unknown>)
    const where = {
      ...(severity ? { severity } : {}),
      ...(resolved === "true" ? { resolvedAt: { not: null } } : {}),
      ...(resolved === "false" ? { resolvedAt: null } : {}),
    }
    const [events, total] = await Promise.all([
      prisma.safetyEvent.findMany({ where, include: { user: true, ride: true }, orderBy: { createdAt: "desc" }, take, skip }),
      prisma.safetyEvent.count({ where }),
    ])
    res.json({ events, total, page, pageSize: take })
  }),
)

adminTrustRouter.post(
  "/safety-events/:id/resolve",
  asyncHandler(async (req, res) => {
    const event = await prisma.safetyEvent.findUnique({ where: { id: req.params.id } })
    if (!event) throw ApiError.notFound("Safety event not found.")
    const updated = await prisma.safetyEvent.update({ where: { id: event.id }, data: { resolvedAt: new Date() } })
    await writeAuditLog({ req, action: "safety_event.resolve", targetTable: "safety_events", targetId: event.id })
    res.json({ event: updated })
  }),
)
