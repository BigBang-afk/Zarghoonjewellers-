import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"
import { notify } from "./notifications/NotificationService.js"
import { emitToAdmin, emitToUser } from "../realtime/socket.js"
import type { LostItemCategory } from "../types/enums.js"

/**
 * Phase 5 §15 — lost & found workflow. Deliberately built on top of the
 * existing SupportTicket/SupportMessage infrastructure (never a parallel
 * chat system): every report gets its own ticket (category "lost_item")
 * so the passenger<->driver back-and-forth reuses the same message
 * endpoints admin already monitors, while LostItemReport carries the
 * structured item/status fields a generic ticket can't.
 */
export async function reportLostItem(params: {
  rideId: string
  reporterUserId: string
  itemCategory: LostItemCategory
  itemDescription: string
}) {
  const ride = await prisma.ride.findUnique({ where: { id: params.rideId }, include: { passenger: true, driver: true } })
  if (!ride) throw ApiError.notFound("Ride not found.")
  if (ride.passenger.userId !== params.reporterUserId) throw ApiError.forbidden("Only the passenger can report a lost item for this ride.")
  if (ride.status !== "ride_completed") throw ApiError.conflict("RIDE_NOT_COMPLETED", "Lost items can only be reported for a completed ride.")

  const result = await prisma.$transaction(async (tx) => {
    const ticket = await tx.supportTicket.create({
      data: {
        userId: params.reporterUserId,
        rideId: ride.id,
        category: "lost_item",
        subject: `Lost item — ${params.itemCategory.replace(/_/g, " ")}`,
        description: params.itemDescription,
        priority: "medium",
      },
    })
    const report = await tx.lostItemReport.create({
      data: {
        ticketId: ticket.id,
        rideId: ride.id,
        reporterUserId: params.reporterUserId,
        driverUserId: ride.driver.userId,
        itemCategory: params.itemCategory,
        itemDescription: params.itemDescription,
        status: "reported",
      },
    })
    return { ticket, report }
  })

  await notify({
    userId: ride.driver.userId,
    type: "support",
    title: "Passenger reported a lost item",
    body: `A passenger from your recent ride may have left something behind: ${params.itemDescription}`,
    data: { lostItemReportId: result.report.id, rideId: ride.id },
  })
  emitToUser(ride.driver.userId, "lost_item.reported", { lostItemReportId: result.report.id })
  emitToAdmin("lost_item.reported", { lostItemReportId: result.report.id, rideId: ride.id })

  return result.report
}

export async function driverRespondToLostItem(params: { reportId: string; driverUserId: string; found: boolean }) {
  const report = await prisma.lostItemReport.findUnique({ where: { id: params.reportId } })
  if (!report) throw ApiError.notFound("Lost item report not found.")
  if (report.driverUserId !== params.driverUserId) throw ApiError.forbidden()
  if (report.status !== "reported") throw ApiError.conflict("ALREADY_RESPONDED", "This report has already been responded to.")

  const status = params.found ? "driver_confirmed_found" : "driver_confirmed_not_found"
  const updated = await prisma.lostItemReport.update({
    where: { id: report.id },
    data: { status, foundAt: params.found ? new Date() : undefined },
  })

  await notify({
    userId: report.reporterUserId,
    type: "support",
    title: params.found ? "Your driver found your item!" : "Driver couldn't find your item",
    body: params.found
      ? "Reply in the ticket to arrange how you'll get it back."
      : "The driver didn't find the item described. You can add more details or contact support.",
    data: { lostItemReportId: report.id },
  })
  emitToUser(report.reporterUserId, "lost_item.driver_responded", { lostItemReportId: report.id, found: params.found })

  return updated
}

/** Either party (or admin, via the admin route) marks a found item as physically returned, or closes an unresolved one. */
export async function resolveLostItem(params: { reportId: string; actorUserId: string; isAdmin?: boolean; status: "returned" | "closed" }) {
  const report = await prisma.lostItemReport.findUnique({ where: { id: params.reportId } })
  if (!report) throw ApiError.notFound("Lost item report not found.")
  if (!params.isAdmin && report.reporterUserId !== params.actorUserId && report.driverUserId !== params.actorUserId) {
    throw ApiError.forbidden()
  }
  if (report.status === "returned" || report.status === "closed") {
    throw ApiError.conflict("ALREADY_RESOLVED", "This report is already resolved.")
  }

  const updated = await prisma.lostItemReport.update({
    where: { id: report.id },
    data: { status: params.status, resolvedAt: new Date() },
  })

  const otherPartyUserId = params.actorUserId === report.reporterUserId ? report.driverUserId : report.reporterUserId
  emitToUser(otherPartyUserId, "lost_item.resolved", { lostItemReportId: report.id, status: params.status })

  return updated
}
