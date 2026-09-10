import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAuth } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"
import { emitToAdmin } from "../../realtime/socket.js"
import { SupportCategory } from "../../types/enums.js"
import { chatRateLimit } from "../../middleware/rateLimit.js"

/**
 * Support Center (Phase 3 §18) — any authenticated user (passenger or
 * driver) can open and track their own tickets; admin-side assignment
 * and status management already lives in admin/trust.ts.
 */
export const supportRouter = Router()
supportRouter.use(requireAuth)

// Ticket rows returned to the author never include `internalNotes` —
// that field exists specifically so admins can leave notes the reporting
// user never sees (Phase 4 §20).
const ticketAuthorSelect = {
  id: true, userId: true, rideId: true, category: true, subject: true, description: true,
  status: true, priority: true, assignedAdminId: true, attachments: true, dueAt: true,
  resolvedAt: true, createdAt: true, updatedAt: true,
  assignedAdmin: { select: { fullName: true } },
} as const

supportRouter.post(
  "/tickets",
  validateBody(
    z.object({
      category: z.enum(SupportCategory),
      subject: z.string().trim().min(3).max(150),
      description: z.string().trim().max(2000).optional(),
      rideId: z.string().uuid().optional(),
      attachments: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (req.body.rideId) {
      const ride = await prisma.ride.findUnique({ where: { id: req.body.rideId }, include: { passenger: true, driver: true } })
      if (!ride) throw ApiError.notFound("Ride not found.")
      const isParty = ride.passenger.userId === req.auth!.userId || ride.driver.userId === req.auth!.userId
      if (!isParty) throw ApiError.forbidden()
    }

    const { attachments, ...rest } = req.body
    const priority = req.body.category === "safety" ? "high" : "medium"
    const ticket = await prisma.supportTicket.create({
      data: { userId: req.auth!.userId, ...rest, priority, attachments: attachments ? JSON.stringify(attachments) : undefined },
      select: ticketAuthorSelect,
    })
    emitToAdmin("support.ticket_created", { ticketId: ticket.id, category: ticket.category, priority: ticket.priority })
    res.status(201).json({ ticket })
  }),
)

supportRouter.get(
  "/tickets",
  asyncHandler(async (req, res) => {
    const tickets = await prisma.supportTicket.findMany({
      where: { userId: req.auth!.userId },
      select: ticketAuthorSelect,
      orderBy: { createdAt: "desc" },
    })
    res.json({ tickets })
  }),
)

/**
 * A ticket is visible to its author as always, but a ticket linked to a
 * ride (e.g. a lost-item report) is also visible to the *other* ride
 * party — a driver needs to see and reply to a passenger's lost-item
 * ticket even though the passenger filed it, and vice versa.
 */
async function isTicketAccessible(ticket: { userId: string; rideId: string | null }, userId: string): Promise<boolean> {
  if (ticket.userId === userId) return true
  if (!ticket.rideId) return false
  const ride = await prisma.ride.findUnique({ where: { id: ticket.rideId }, include: { passenger: true, driver: true } })
  return ride ? ride.passenger.userId === userId || ride.driver.userId === userId : false
}

supportRouter.get(
  "/tickets/:id",
  asyncHandler(async (req, res) => {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: req.params.id },
      select: { ...ticketAuthorSelect, ride: true, messages: { orderBy: { createdAt: "asc" }, include: { author: { select: { fullName: true } } } } },
    })
    if (!ticket || !(await isTicketAccessible(ticket, req.auth!.userId))) throw ApiError.notFound("Ticket not found.")
    res.json({ ticket })
  }),
)

supportRouter.post(
  "/tickets/:id/messages",
  chatRateLimit,
  validateBody(z.object({ body: z.string().trim().min(1).max(2000) })),
  asyncHandler(async (req, res) => {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } })
    if (!ticket || !(await isTicketAccessible(ticket, req.auth!.userId))) throw ApiError.notFound("Ticket not found.")
    if (ticket.status === "closed") throw ApiError.badRequest("TICKET_CLOSED", "This ticket is closed. Open a new one if you need further help.")

    const message = await prisma.supportMessage.create({
      data: { ticketId: ticket.id, authorUserId: req.auth!.userId, isAdmin: false, body: req.body.body },
    })
    if (ticket.status === "resolved") {
      await prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: "waiting" } })
    }
    emitToAdmin("support.ticket_message", { ticketId: ticket.id })
    res.status(201).json({ message })
  }),
)
