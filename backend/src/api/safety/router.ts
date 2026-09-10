import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAuth } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"
import { emitToAdmin } from "../../realtime/socket.js"
import { blockUser, unblockUser, listBlocks } from "../../services/safetyService.js"

export const safetyRouter = Router()
/** No auth — a trusted contact opening a shared trip link never has a RIVO account. */
export const publicSafetyRouter = Router()

safetyRouter.use(requireAuth)

/**
 * Phase 2 §21 / §28: this records a real SafetyEvent and pages the admin
 * Safety queue in real time — it does NOT claim to contact emergency
 * services. A production build would integrate a local emergency
 * dispatch API behind this same endpoint; until then the honest
 * behavior is "alert RIVO's safety team", which is what actually
 * happens.
 */
safetyRouter.post(
  "/sos",
  validateBody(z.object({ rideId: z.string().uuid().optional(), lat: z.number(), lng: z.number(), note: z.string().max(300).optional() })),
  asyncHandler(async (req, res) => {
    const event = await prisma.safetyEvent.create({
      data: {
        rideId: req.body.rideId,
        userId: req.auth!.userId,
        type: "sos",
        severity: "critical",
        lat: req.body.lat,
        lng: req.body.lng,
        details: req.body.note ? JSON.stringify({ note: req.body.note }) : null,
      },
    })
    emitToAdmin("safety.sos_triggered", { safetyEventId: event.id, userId: req.auth!.userId, rideId: req.body.rideId })
    res.status(201).json({
      safetyEvent: event,
      message: "RIVO's safety team has been alerted. This does not contact emergency services directly — call local emergency services if you are in immediate danger.",
    })
  }),
)

safetyRouter.post(
  "/report",
  validateBody(
    z.object({
      rideId: z.string().uuid(),
      againstUserId: z.string().uuid(),
      reason: z.string().trim().min(1).max(500),
      evidence: z.array(z.string().trim().max(300)).max(10).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const ride = await prisma.ride.findUnique({ where: { id: req.body.rideId }, include: { passenger: true, driver: true } })
    if (!ride) throw ApiError.notFound("Ride not found.")
    const isParty = ride.passenger.userId === req.auth!.userId || ride.driver.userId === req.auth!.userId
    if (!isParty) throw ApiError.forbidden()

    const [dispute, safetyEvent] = await prisma.$transaction([
      prisma.dispute.create({
        data: {
          rideId: ride.id,
          raisedById: req.auth!.userId,
          againstUserId: req.body.againstUserId,
          reason: req.body.reason,
          evidence: req.body.evidence ? JSON.stringify(req.body.evidence) : null,
        },
      }),
      prisma.safetyEvent.create({
        data: { rideId: ride.id, userId: req.auth!.userId, type: "report_filed", severity: "medium", details: JSON.stringify({ reason: req.body.reason }) },
      }),
    ])

    emitToAdmin("safety.report_filed", { disputeId: dispute.id, safetyEventId: safetyEvent.id })
    res.status(201).json({ dispute, safetyEvent })
  }),
)

// ---------------------------------------------------------------------
// Blocking (Phase 3 §15) — only between two people who shared a ride;
// affects future matching only, never a platform-wide penalty.
// ---------------------------------------------------------------------

safetyRouter.get(
  "/blocks",
  asyncHandler(async (req, res) => {
    const blocks = await listBlocks(req.auth!.userId)
    res.json({ blocks })
  }),
)

safetyRouter.post(
  "/blocks/:userId",
  validateBody(z.object({ reason: z.string().trim().max(300).optional() })),
  asyncHandler(async (req, res) => {
    const block = await blockUser(req.auth!.userId, req.params.userId, req.body.reason)
    res.status(201).json({ block })
  }),
)

safetyRouter.delete(
  "/blocks/:userId",
  asyncHandler(async (req, res) => {
    await unblockUser(req.auth!.userId, req.params.userId)
    res.status(204).send()
  }),
)

safetyRouter.post(
  "/share-trip/:rideId",
  asyncHandler(async (req, res) => {
    const ride = await prisma.ride.findUnique({ where: { id: req.params.rideId }, include: { passenger: true, driver: true } })
    if (!ride) throw ApiError.notFound("Ride not found.")
    const isParty = ride.passenger.userId === req.auth!.userId || ride.driver.userId === req.auth!.userId
    if (!isParty) throw ApiError.forbidden()

    await prisma.safetyEvent.create({ data: { rideId: ride.id, userId: req.auth!.userId, type: "trip_shared", severity: "low" } })
    res.json({ shareToken: ride.shareToken, shareUrl: `/trip/${ride.shareToken}` })
  }),
)

/** Public, read-only, no auth — a trusted contact opening a shared trip link. */
publicSafetyRouter.get(
  "/trip/:shareToken",
  asyncHandler(async (req, res) => {
    const ride = await prisma.ride.findUnique({
      where: { shareToken: req.params.shareToken },
      include: { driver: { include: { user: true, vehicles: true } }, vehicle: true, pickup: true, destination: true },
    })
    if (!ride) throw ApiError.notFound("This trip link is invalid or has expired.")

    res.json({
      status: ride.status,
      pickup: { address: ride.pickup.address, lat: ride.pickup.lat, lng: ride.pickup.lng },
      destination: { address: ride.destination.address, lat: ride.destination.lat, lng: ride.destination.lng },
      driver: { name: ride.driver.user.fullName, vehicle: `${ride.vehicle.color ?? ""} ${ride.vehicle.make} ${ride.vehicle.model}`.trim(), plate: ride.vehicle.plateNumber },
    })
  }),
)
