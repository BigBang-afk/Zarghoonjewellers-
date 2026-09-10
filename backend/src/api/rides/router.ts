import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { ApiError } from "../../utils/apiError.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAuth, requireRole } from "../../middleware/auth.js"
import { rideRequestRateLimit, offerActionRateLimit, chatRateLimit } from "../../middleware/rateLimit.js"
import { getPassengerProfileOrThrow, getDriverProfileOrThrow } from "../../shared/profileLookup.js"
import { createRideRequest } from "../../services/rideRequestService.js"
import { computeFare } from "../../services/fareEngine.js"
import { mapProvider } from "../../services/maps/HaversineMapProvider.js"
import {
  driverAcceptOffer,
  driverCounterOffer,
  driverDeclineOffer,
  passengerAcceptCounterOffer,
  passengerRejectCounterOffer,
} from "../../services/negotiationEngine.js"
import { selectOffer } from "../../services/bookingService.js"
import { cancelRideRequest, updateRideStatus } from "../../services/rideLifecycleService.js"
import { submitRating } from "../../services/ratingService.js"
import { notify } from "../../services/notifications/NotificationService.js"
import { emitToRide } from "../../realtime/socket.js"
import { RideStatus } from "../../types/enums.js"

export const ridesRouter = Router()
ridesRouter.use(requireAuth)

const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
const placeSchema = z.object({ address: z.string().trim().min(1).max(200) }).merge(latLng)

// ---------------------------------------------------------------------
// Fare estimate (no request created)
// ---------------------------------------------------------------------

ridesRouter.post(
  "/fare-estimates",
  requireRole("passenger"),
  validateBody(
    z.object({ cityId: z.string().uuid(), zoneId: z.string().uuid().optional(), vehicleTypeId: z.string().uuid(), pickup: latLng, destination: latLng }),
  ),
  asyncHandler(async (req, res) => {
    const vehicleType = await prisma.vehicleType.findUnique({ where: { id: req.body.vehicleTypeId } })
    if (!vehicleType) throw ApiError.badRequest("INVALID_VEHICLE_TYPE", "Vehicle type not found.")
    const route = await mapProvider.estimateRoute(req.body.pickup, req.body.destination, vehicleType.code)
    const fare = await computeFare({ ...req.body, distanceKm: route.distanceKm, durationMin: route.durationMin })
    res.json({ route, fare })
  }),
)

// ---------------------------------------------------------------------
// Ride requests
// ---------------------------------------------------------------------

const createRequestSchema = z.object({
  cityId: z.string().uuid(),
  zoneId: z.string().uuid().optional(),
  vehicleTypeId: z.string().uuid(),
  pickup: placeSchema,
  destination: placeSchema,
  bookingMode: z.enum(["quick_match", "competitive_offer"]),
  proposedFare: z.number().positive().optional(),
  paymentMethod: z.enum(["cash", "card", "wallet", "local_provider"]).default("cash"),
  preferFavoriteDriver: z.boolean().optional(),
  promoCode: z.string().trim().min(1).max(20).optional(),
  businessAccountId: z.string().uuid().optional(),
})

ridesRouter.post(
  "/ride-requests",
  requireRole("passenger"),
  rideRequestRateLimit,
  validateBody(createRequestSchema),
  asyncHandler(async (req, res) => {
    const passenger = await getPassengerProfileOrThrow(req.auth!.userId)

    if (req.body.businessAccountId) {
      const membership = await prisma.businessEmployee.findUnique({
        where: { businessAccountId_userId: { businessAccountId: req.body.businessAccountId, userId: req.auth!.userId } },
      })
      if (!membership) throw ApiError.forbidden("You are not a member of this business account.")
    }

    const result = await createRideRequest({
      passengerId: passenger.id,
      passengerUserId: req.auth!.userId,
      ...req.body,
    })
    res.status(201).json(result)
  }),
)

async function loadRequestForViewer(rideRequestId: string, userId: string, role: string) {
  const request = await prisma.rideRequest.findUnique({
    where: { id: rideRequestId },
    include: { pickup: true, destination: true, vehicleType: true, passenger: true, ride: true },
  })
  if (!request) throw ApiError.notFound("Ride request not found.")
  if (role === "admin") return request
  if (role === "passenger") {
    const passenger = await getPassengerProfileOrThrow(userId)
    if (request.passengerId !== passenger.id) throw ApiError.forbidden()
    return request
  }
  // driver: allowed if they have (or had) an offer on this request
  const driver = await getDriverProfileOrThrow(userId)
  const hasOffer = await prisma.rideOffer.findFirst({ where: { rideRequestId, driverId: driver.id } })
  if (!hasOffer) throw ApiError.forbidden()
  return request
}

ridesRouter.get(
  "/ride-requests/:id",
  asyncHandler(async (req, res) => {
    const request = await loadRequestForViewer(req.params.id, req.auth!.userId, req.auth!.role)
    res.json({ request })
  }),
)

ridesRouter.delete(
  "/ride-requests/:id",
  requireRole("passenger"),
  asyncHandler(async (req, res) => {
    const passenger = await getPassengerProfileOrThrow(req.auth!.userId)
    const result = await cancelRideRequest(req.params.id, passenger.id)
    res.json(result)
  }),
)

ridesRouter.get(
  "/ride-requests/:id/offers",
  requireRole("passenger"),
  asyncHandler(async (req, res) => {
    const passenger = await getPassengerProfileOrThrow(req.auth!.userId)
    const request = await prisma.rideRequest.findUnique({ where: { id: req.params.id } })
    if (!request || request.passengerId !== passenger.id) throw ApiError.notFound("Ride request not found.")

    const offers = await prisma.rideOffer.findMany({
      where: { rideRequestId: req.params.id, status: { in: ["pending", "accepted"] } },
      include: { driver: { include: { user: true } }, vehicle: true, counterOffers: { where: { status: "pending" } } },
      orderBy: { createdAt: "asc" },
    })

    const pendingCount = offers.filter((o) => o.status === "pending").length
    const respondedCount = offers.filter((o) => o.status === "accepted" || o.counterOffers.length > 0).length

    res.json({
      request: { id: request.id, status: request.status, proposedFare: request.proposedFare, suggestedFare: request.suggestedFare },
      // "3 drivers are considering your request" (Phase 3 §2) — pending
      // means dispatched-but-not-yet-responded; responded means an
      // accept or counter has come back.
      statusMessage:
        pendingCount > 0
          ? `${pendingCount} ${pendingCount === 1 ? "driver is" : "drivers are"} considering your request.`
          : respondedCount > 0
            ? "All nearby drivers have responded — compare their offers below."
            : "Waiting for nearby drivers to respond…",
      pendingCount,
      respondedCount,
      offers: offers.map((o) => ({
        id: o.id,
        status: o.status,
        offerPrice: o.offerPrice,
        etaMin: o.etaMin,
        distanceKm: o.distanceKm,
        expiresAt: o.expiresAt,
        driver: {
          id: o.driver.id,
          name: o.driver.user.fullName,
          photoUrl: o.driver.user.photoUrl,
          rating: o.driver.ratingAvg,
          completedRides: o.driver.completedRides,
          cancellationRate: o.driver.cancellationRate,
          verified: o.driver.verificationStatus === "approved",
        },
        vehicle: { model: `${o.vehicle.make} ${o.vehicle.model}`, color: o.vehicle.color, plateNumber: o.vehicle.plateNumber },
        counterOffer: o.counterOffers[0] ? { id: o.counterOffers[0].id, counterPrice: o.counterOffers[0].counterPrice, expiresAt: o.counterOffers[0].expiresAt } : null,
      })),
    })
  }),
)

ridesRouter.post(
  "/ride-requests/:id/select-offer",
  requireRole("passenger"),
  validateBody(z.object({ offerId: z.string().uuid() })),
  asyncHandler(async (req, res) => {
    const passenger = await getPassengerProfileOrThrow(req.auth!.userId)
    const ride = await selectOffer({ rideRequestId: req.params.id, passengerId: passenger.id, offerId: req.body.offerId })
    res.status(201).json({ ride })
  }),
)

// ---------------------------------------------------------------------
// Driver responses to offers
// ---------------------------------------------------------------------

ridesRouter.post(
  "/ride-offers/:id/accept",
  requireRole("driver"),
  offerActionRateLimit,
  asyncHandler(async (req, res) => {
    const driver = await getDriverProfileOrThrow(req.auth!.userId)
    const result = await driverAcceptOffer(req.params.id, driver.id)
    res.json(result)
  }),
)

ridesRouter.post(
  "/ride-offers/:id/counter",
  requireRole("driver"),
  offerActionRateLimit,
  validateBody(z.object({ counterPrice: z.number().positive() })),
  asyncHandler(async (req, res) => {
    const driver = await getDriverProfileOrThrow(req.auth!.userId)
    const counterOffer = await driverCounterOffer(req.params.id, driver.id, req.body.counterPrice)
    res.status(201).json({ counterOffer })
  }),
)

ridesRouter.post(
  "/ride-offers/:id/decline",
  requireRole("driver"),
  offerActionRateLimit,
  asyncHandler(async (req, res) => {
    const driver = await getDriverProfileOrThrow(req.auth!.userId)
    const result = await driverDeclineOffer(req.params.id, driver.id)
    res.json(result)
  }),
)

// ---------------------------------------------------------------------
// Passenger responses to counter-offers
// ---------------------------------------------------------------------

ridesRouter.post(
  "/counter-offers/:id/accept",
  requireRole("passenger"),
  offerActionRateLimit,
  asyncHandler(async (req, res) => {
    const passenger = await getPassengerProfileOrThrow(req.auth!.userId)
    const ride = await passengerAcceptCounterOffer(req.params.id, passenger.id)
    res.status(201).json({ ride })
  }),
)

ridesRouter.post(
  "/counter-offers/:id/reject",
  requireRole("passenger"),
  offerActionRateLimit,
  asyncHandler(async (req, res) => {
    const passenger = await getPassengerProfileOrThrow(req.auth!.userId)
    const result = await passengerRejectCounterOffer(req.params.id, passenger.id)
    res.json(result)
  }),
)

// ---------------------------------------------------------------------
// Rides
// ---------------------------------------------------------------------

async function serializeRide(rideId: string) {
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    include: {
      passenger: { include: { user: true } },
      driver: { include: { user: true } },
      vehicle: true,
      pickup: true,
      destination: true,
      payment: { include: { commission: true } },
      statusHistory: { orderBy: { changedAt: "asc" } },
    },
  })
  if (!ride) throw ApiError.notFound("Ride not found.")
  return ride
}

function assertRideParty(ride: Awaited<ReturnType<typeof serializeRide>>, userId: string, role: string) {
  if (role === "admin") return
  const isParty = ride.passenger.userId === userId || ride.driver.userId === userId
  if (!isParty) throw ApiError.forbidden()
}

ridesRouter.get(
  "/rides",
  asyncHandler(async (req, res) => {
    const { status, from, to, page = "1", pageSize = "20" } = req.query as Record<string, string>
    const where: Record<string, unknown> = {}

    if (req.auth!.role === "passenger") {
      const passenger = await getPassengerProfileOrThrow(req.auth!.userId)
      where.passengerId = passenger.id
    } else if (req.auth!.role === "driver") {
      const driver = await getDriverProfileOrThrow(req.auth!.userId)
      where.driverId = driver.id
    }
    if (status) where.status = status
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      }
    }

    const take = Math.min(100, Number(pageSize) || 20)
    const skip = (Math.max(1, Number(page) || 1) - 1) * take

    const [rides, total] = await Promise.all([
      prisma.ride.findMany({
        where,
        include: { passenger: { include: { user: true } }, driver: { include: { user: true } }, vehicle: true, pickup: true, destination: true },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.ride.count({ where }),
    ])

    res.json({ rides, total, page: Number(page) || 1, pageSize: take })
  }),
)

ridesRouter.get(
  "/rides/:id",
  asyncHandler(async (req, res) => {
    const ride = await serializeRide(req.params.id)
    assertRideParty(ride, req.auth!.userId, req.auth!.role)
    res.json({ ride })
  }),
)

ridesRouter.post(
  "/rides/:id/status",
  validateBody(z.object({ target: z.enum(RideStatus), reason: z.string().trim().max(280).optional() })),
  asyncHandler(async (req, res) => {
    if (req.auth!.role !== "passenger" && req.auth!.role !== "driver") throw ApiError.forbidden()
    const ride = await updateRideStatus({
      rideId: req.params.id,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role as "passenger" | "driver",
      target: req.body.target,
      reason: req.body.reason,
    })
    res.json({ ride })
  }),
)

ridesRouter.post(
  "/rides/:id/disputes",
  requireRole("passenger", "driver"),
  validateBody(
    z.object({
      reason: z.string().trim().min(1).max(500),
      evidence: z.array(z.string().trim().max(300)).max(10).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const ride = await serializeRide(req.params.id)
    assertRideParty(ride, req.auth!.userId, req.auth!.role)
    const againstUserId = ride.passenger.userId === req.auth!.userId ? ride.driver.userId : ride.passenger.userId
    const dispute = await prisma.dispute.create({
      data: {
        rideId: ride.id,
        raisedById: req.auth!.userId,
        againstUserId,
        reason: req.body.reason,
        evidence: req.body.evidence ? JSON.stringify(req.body.evidence) : null,
      },
    })
    emitToRide(ride.id, "dispute.filed", { disputeId: dispute.id })
    res.status(201).json({ dispute })
  }),
)

ridesRouter.get(
  "/rides/:id/disputes",
  asyncHandler(async (req, res) => {
    const ride = await serializeRide(req.params.id)
    assertRideParty(ride, req.auth!.userId, req.auth!.role)
    const disputes = await prisma.dispute.findMany({ where: { rideId: ride.id }, orderBy: { createdAt: "desc" } })
    res.json({ disputes })
  }),
)

ridesRouter.post(
  "/rides/:id/ratings",
  requireRole("passenger", "driver"),
  validateBody(z.object({ score: z.number().int().min(1).max(5), comment: z.string().trim().max(500).optional() })),
  asyncHandler(async (req, res) => {
    const rating = await submitRating({ rideId: req.params.id, raterUserId: req.auth!.userId, score: req.body.score, comment: req.body.comment })
    res.status(201).json({ rating })
  }),
)

// ---------------------------------------------------------------------
// Chat (minimal — full chat UX is a later phase; endpoints are real)
// ---------------------------------------------------------------------

ridesRouter.get(
  "/rides/:id/messages",
  asyncHandler(async (req, res) => {
    const ride = await serializeRide(req.params.id)
    assertRideParty(ride, req.auth!.userId, req.auth!.role)
    const messages = await prisma.message.findMany({ where: { rideId: ride.id }, orderBy: { createdAt: "asc" } })
    res.json({ messages })
  }),
)

ridesRouter.post(
  "/rides/:id/messages",
  chatRateLimit,
  validateBody(z.object({ body: z.string().trim().min(1).max(1000) })),
  asyncHandler(async (req, res) => {
    const ride = await serializeRide(req.params.id)
    assertRideParty(ride, req.auth!.userId, req.auth!.role)
    const message = await prisma.message.create({ data: { rideId: ride.id, senderId: req.auth!.userId, body: req.body.body } })
    emitToRide(ride.id, "chat.message", message)
    const counterpartUserId = ride.passenger.userId === req.auth!.userId ? ride.driver.userId : ride.passenger.userId
    await notify({ userId: counterpartUserId, type: "ride_update", title: "New message", body: req.body.body, data: { rideId: ride.id } })
    res.status(201).json({ message })
  }),
)
