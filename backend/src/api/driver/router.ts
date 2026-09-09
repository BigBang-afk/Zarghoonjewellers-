import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAuth, requireRole } from "../../middleware/auth.js"
import { getDriverProfileOrThrow } from "../../shared/profileLookup.js"
import { ApiError } from "../../utils/apiError.js"
import { emitToAdmin } from "../../realtime/socket.js"

export const driverRouter = Router()
driverRouter.use(requireAuth, requireRole("driver"))

// ---------------------------------------------------------------------
// Availability + location
// ---------------------------------------------------------------------

driverRouter.patch(
  "/me/availability",
  validateBody(z.object({ status: z.enum(["online", "offline"]) })),
  asyncHandler(async (req, res) => {
    const driver = await getDriverProfileOrThrow(req.auth!.userId)
    if (driver.availabilityStatus === "on_trip") {
      throw ApiError.conflict("DRIVER_ON_TRIP", "You can't change availability while on an active ride.")
    }
    if (req.body.status === "online" && driver.verificationStatus !== "approved") {
      throw ApiError.forbidden("Your account is still pending verification. You can't go online yet.")
    }
    const updated = await prisma.driverProfile.update({ where: { id: driver.id }, data: { availabilityStatus: req.body.status } })
    emitToAdmin("driver.availability_changed", { driverId: driver.id, status: updated.availabilityStatus })
    res.json({ driverProfile: updated })
  }),
)

driverRouter.patch(
  "/me/location",
  validateBody(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })),
  asyncHandler(async (req, res) => {
    const driver = await getDriverProfileOrThrow(req.auth!.userId)
    await prisma.driverProfile.update({
      where: { id: driver.id },
      data: { lastLat: req.body.lat, lastLng: req.body.lng, lastLocationAt: new Date() },
    })
    res.status(204).send()
  }),
)

driverRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const driver = await prisma.driverProfile.findUnique({
      where: { userId: req.auth!.userId },
      include: { user: true, vehicles: true, city: true },
    })
    if (!driver) throw ApiError.notFound("Driver profile not found.")
    res.json({ driverProfile: driver })
  }),
)

// ---------------------------------------------------------------------
// Incoming requests — polling fallback (docs/09 §6 / Phase 2 §18: the
// primary delivery path is the `ride_request.created` socket event;
// this endpoint exists so a client can resync after a missed/dropped
// connection instead of relying on sockets alone).
// ---------------------------------------------------------------------

driverRouter.get(
  "/me/incoming-requests",
  asyncHandler(async (req, res) => {
    const driver = await getDriverProfileOrThrow(req.auth!.userId)
    const offers = await prisma.rideOffer.findMany({
      where: { driverId: driver.id, status: "pending", expiresAt: { gt: new Date() } },
      include: {
        rideRequest: { include: { pickup: true, destination: true, passenger: { include: { user: true } } } },
      },
      orderBy: { createdAt: "desc" },
    })
    res.json({
      offers: offers.map((o) => ({
        id: o.id,
        rideRequestId: o.rideRequestId,
        bookingMode: o.rideRequest.bookingMode,
        pickup: o.rideRequest.pickup.address,
        destination: o.rideRequest.destination.address,
        distanceKm: o.distanceKm,
        etaMin: o.etaMin,
        offerPrice: o.offerPrice,
        paymentMethod: o.rideRequest.paymentMethod,
        expiresAt: o.expiresAt,
        passenger: { name: o.rideRequest.passenger.user.fullName, rating: o.rideRequest.passenger.ratingAvg },
      })),
    })
  }),
)

// ---------------------------------------------------------------------
// Active ride shortcut
// ---------------------------------------------------------------------

driverRouter.get(
  "/me/active-ride",
  asyncHandler(async (req, res) => {
    const driver = await getDriverProfileOrThrow(req.auth!.userId)
    const ride = await prisma.ride.findFirst({
      where: { driverId: driver.id, status: { notIn: ["ride_completed", "cancelled_by_passenger", "cancelled_by_driver", "expired", "disputed"] } },
      include: { passenger: { include: { user: true } }, vehicle: true, pickup: true, destination: true },
      orderBy: { createdAt: "desc" },
    })
    res.json({ ride })
  }),
)

// ---------------------------------------------------------------------
// Ride history
// ---------------------------------------------------------------------

driverRouter.get(
  "/ride-history",
  asyncHandler(async (req, res) => {
    const driver = await getDriverProfileOrThrow(req.auth!.userId)
    const rides = await prisma.ride.findMany({
      where: { driverId: driver.id, status: { in: ["ride_completed", "cancelled_by_passenger", "cancelled_by_driver"] } },
      include: { passenger: { include: { user: true } }, vehicle: true, pickup: true, destination: true, payment: { include: { commission: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    })
    res.json({ rides })
  }),
)

// ---------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}
function startOfWeek(): Date {
  const d = startOfToday()
  const day = d.getDay()
  d.setDate(d.getDate() - day)
  return d
}
function startOfMonth(): Date {
  const d = startOfToday()
  d.setDate(1)
  return d
}

driverRouter.get(
  "/me/earnings",
  asyncHandler(async (req, res) => {
    const driver = await getDriverProfileOrThrow(req.auth!.userId)
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.auth!.userId } })

    async function summarize(since: Date) {
      const transactions = await prisma.transaction.findMany({
        where: { walletId: wallet?.id ?? "__none__", type: "ride_payout", createdAt: { gte: since } },
      })
      const total = transactions.reduce((sum, t) => sum + t.amount, 0)
      return { totalRs: round2(total), rides: transactions.length, averageFareRs: transactions.length ? round2(total / transactions.length) : 0 }
    }

    const [today, week, month] = await Promise.all([summarize(startOfToday()), summarize(startOfWeek()), summarize(startOfMonth())])

    res.json({
      walletBalanceRs: wallet?.balance ?? 0,
      today,
      week,
      month,
      completedRides: driver.completedRides,
      acceptanceRate: driver.acceptanceRate,
      rating: driver.ratingAvg,
    })
  }),
)

driverRouter.get(
  "/me/transactions",
  asyncHandler(async (req, res) => {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.auth!.userId } })
    if (!wallet) return res.json({ transactions: [] })
    const transactions = await prisma.transaction.findMany({
      where: { walletId: wallet.id },
      include: { payment: { include: { ride: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
    res.json({ transactions })
  }),
)

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
