import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAuth } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"
import { emitToAdmin } from "../../realtime/socket.js"
import { SupportCategory } from "../../types/enums.js"

/**
 * Support Center (Phase 3 §18) — any authenticated user (passenger or
 * driver) can open and track their own tickets; admin-side assignment
 * and status management already lives in admin/trust.ts.
 */
export const supportRouter = Router()
supportRouter.use(requireAuth)

supportRouter.post(
  "/tickets",
  validateBody(
    z.object({
      category: z.enum(SupportCategory),
      subject: z.string().trim().min(3).max(150),
      description: z.string().trim().max(2000).optional(),
      rideId: z.string().uuid().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    if (req.body.rideId) {
      const ride = await prisma.ride.findUnique({ where: { id: req.body.rideId }, include: { passenger: true, driver: true } })
      if (!ride) throw ApiError.notFound("Ride not found.")
      const isParty = ride.passenger.userId === req.auth!.userId || ride.driver.userId === req.auth!.userId
      if (!isParty) throw ApiError.forbidden()
    }

    const priority = req.body.category === "safety" ? "high" : "medium"
    const ticket = await prisma.supportTicket.create({
      data: { userId: req.auth!.userId, ...req.body, priority },
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
      include: { assignedAdmin: { select: { fullName: true } } },
      orderBy: { createdAt: "desc" },
    })
    res.json({ tickets })
  }),
)

supportRouter.get(
  "/tickets/:id",
  asyncHandler(async (req, res) => {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id }, include: { assignedAdmin: { select: { fullName: true } }, ride: true } })
    if (!ticket || ticket.userId !== req.auth!.userId) throw ApiError.notFound("Ticket not found.")
    res.json({ ticket })
  }),
)
