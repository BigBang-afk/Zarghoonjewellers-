import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAuth, requireRole } from "../../middleware/auth.js"
import { getPassengerProfileOrThrow } from "../../shared/profileLookup.js"
import { ApiError } from "../../utils/apiError.js"
import { getPaymentProvider } from "../../services/payments/index.js"
import { validatePromoCode } from "../../services/promoService.js"
import { createScheduledRide, cancelScheduledRide, rescheduleRide } from "../../services/scheduledRideService.js"
import { resolveUserCurrency } from "../../shared/currency.js"
import { roundMoney } from "../../utils/money.js"

export const passengerRouter = Router()
passengerRouter.use(requireAuth, requireRole("passenger"))

// ---------------------------------------------------------------------
// Saved places (Home/Work/custom) + recent destinations
// ---------------------------------------------------------------------

passengerRouter.get(
  "/locations/saved",
  asyncHandler(async (req, res) => {
    const locations = await prisma.location.findMany({
      where: { userId: req.auth!.userId, isSaved: true, deletedAt: null },
      orderBy: { createdAt: "asc" },
    })
    res.json({ locations })
  }),
)

passengerRouter.post(
  "/locations/saved",
  validateBody(
    z.object({
      label: z.string().trim().min(1).max(40),
      address: z.string().trim().min(1).max(200),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }),
  ),
  asyncHandler(async (req, res) => {
    const location = await prisma.location.create({
      data: { userId: req.auth!.userId, isSaved: true, ...req.body },
    })
    res.status(201).json({ location })
  }),
)

passengerRouter.delete(
  "/locations/saved/:id",
  asyncHandler(async (req, res) => {
    const location = await prisma.location.findUnique({ where: { id: req.params.id } })
    if (!location || location.userId !== req.auth!.userId) throw ApiError.notFound("Saved place not found.")
    await prisma.location.update({ where: { id: location.id }, data: { deletedAt: new Date() } })
    res.status(204).send()
  }),
)

/** Recent destinations = distinct ride-request destinations, most recent first. */
passengerRouter.get(
  "/locations/recent",
  asyncHandler(async (req, res) => {
    const passenger = await getPassengerProfileOrThrow(req.auth!.userId)
    const requests = await prisma.rideRequest.findMany({
      where: { passengerId: passenger.id },
      include: { destination: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    })
    const seen = new Set<string>()
    const recents = []
    for (const r of requests) {
      const key = r.destination.address
      if (seen.has(key)) continue
      seen.add(key)
      recents.push({ id: r.destination.id, address: r.destination.address, lat: r.destination.lat, lng: r.destination.lng })
      if (recents.length >= 5) break
    }
    res.json({ locations: recents })
  }),
)

// ---------------------------------------------------------------------
// Ride history
// ---------------------------------------------------------------------

passengerRouter.get(
  "/ride-history",
  asyncHandler(async (req, res) => {
    const passenger = await getPassengerProfileOrThrow(req.auth!.userId)
    const rides = await prisma.ride.findMany({
      where: { passengerId: passenger.id, status: { in: ["ride_completed", "cancelled_by_passenger", "cancelled_by_driver"] } },
      include: { driver: { include: { user: true } }, vehicle: true, pickup: true, destination: true, payment: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    })
    res.json({ rides })
  }),
)

// ---------------------------------------------------------------------
// Wallet (Phase 2 §9) — top-up via a mock/real PaymentProvider adapter,
// balance + history, never storing raw card details.
// ---------------------------------------------------------------------

passengerRouter.get(
  "/wallet",
  asyncHandler(async (req, res) => {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.auth!.userId } })
    const transactions = wallet
      ? await prisma.transaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: "desc" }, take: 50 })
      : []
    res.json({
      balance: wallet?.balance ?? 0,
      pendingBalance: wallet?.pendingBalance ?? 0,
      currencyCode: wallet?.currencyCode ?? (await resolveUserCurrency(req.auth!.userId)),
      transactions,
    })
  }),
)

passengerRouter.post(
  "/wallet/topup",
  validateBody(z.object({ amount: z.number().positive().max(100_000), method: z.enum(["card", "local_provider"]).default("card") })),
  asyncHandler(async (req, res) => {
    const provider = getPaymentProvider(req.body.method)
    const auth = await provider.authorize(req.body.amount, `topup_${req.auth!.userId}_${Date.now()}`)
    const capture = await provider.capture(auth.providerReference)
    if (capture.status !== "captured") throw ApiError.unprocessable("TOPUP_FAILED", "Your top-up could not be processed.")

    const wallet = await prisma.wallet.upsert({
      where: { userId: req.auth!.userId },
      create: { userId: req.auth!.userId, balance: 0, currencyCode: await resolveUserCurrency(req.auth!.userId) },
      update: {},
    })
    const newBalance = roundMoney(wallet.balance + req.body.amount, wallet.currencyCode)
    const [, transaction] = await prisma.$transaction([
      prisma.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } }),
      prisma.transaction.create({
        data: {
          walletId: wallet.id,
          type: "wallet_topup",
          amount: req.body.amount,
          balanceAfter: newBalance,
          description: `Wallet top-up via ${req.body.method}`,
        },
      }),
    ])
    res.status(201).json({ balance: newBalance, transaction })
  }),
)

// ---------------------------------------------------------------------
// Promo code preview (Phase 2 §10) — validated against the same rules
// applied at ride-request time, without recording a redemption.
// ---------------------------------------------------------------------

passengerRouter.post(
  "/promo/validate",
  validateBody(z.object({ code: z.string().trim().min(1).max(20), cityId: z.string().uuid(), vehicleTypeId: z.string().uuid(), fareAmount: z.number().positive() })),
  asyncHandler(async (req, res) => {
    const passenger = await getPassengerProfileOrThrow(req.auth!.userId)
    const result = await validatePromoCode({
      code: req.body.code,
      userId: req.auth!.userId,
      passengerCompletedRides: passenger.completedRides,
      cityId: req.body.cityId,
      vehicleTypeId: req.body.vehicleTypeId,
      fareAmount: req.body.fareAmount,
    })
    res.json(result)
  }),
)

// ---------------------------------------------------------------------
// Favorite drivers (Phase 2 §12) — only drivers the passenger has
// actually completed a ride with can be favorited.
// ---------------------------------------------------------------------

passengerRouter.get(
  "/favorites",
  asyncHandler(async (req, res) => {
    const passenger = await getPassengerProfileOrThrow(req.auth!.userId)
    const favorites = await prisma.favoriteDriver.findMany({
      where: { passengerId: passenger.id },
      include: { driver: { include: { user: true, vehicles: { take: 1 } } } },
      orderBy: { createdAt: "desc" },
    })
    res.json({
      favorites: favorites.map((f) => ({
        id: f.id,
        driverId: f.driverId,
        name: f.driver.user.fullName,
        rating: f.driver.ratingAvg,
        vehicle: f.driver.vehicles[0] ? `${f.driver.vehicles[0].make} ${f.driver.vehicles[0].model}` : null,
        addedAt: f.createdAt,
      })),
    })
  }),
)

passengerRouter.post(
  "/favorites/:driverId",
  asyncHandler(async (req, res) => {
    const passenger = await getPassengerProfileOrThrow(req.auth!.userId)
    const hasCompletedRide = await prisma.ride.findFirst({
      where: { passengerId: passenger.id, driverId: req.params.driverId, status: "ride_completed" },
    })
    if (!hasCompletedRide) throw ApiError.badRequest("NO_COMPLETED_RIDE", "You can only favorite a driver after completing a ride with them.")

    const favorite = await prisma.favoriteDriver.upsert({
      where: { passengerId_driverId: { passengerId: passenger.id, driverId: req.params.driverId } },
      create: { passengerId: passenger.id, driverId: req.params.driverId },
      update: {},
    })
    res.status(201).json({ favorite })
  }),
)

passengerRouter.delete(
  "/favorites/:driverId",
  asyncHandler(async (req, res) => {
    const passenger = await getPassengerProfileOrThrow(req.auth!.userId)
    await prisma.favoriteDriver.deleteMany({ where: { passengerId: passenger.id, driverId: req.params.driverId } })
    res.status(204).send()
  }),
)

// ---------------------------------------------------------------------
// Scheduled rides (Phase 2 §13)
// ---------------------------------------------------------------------

const placeSchema = z.object({ address: z.string().trim().min(1).max(200), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })

passengerRouter.post(
  "/scheduled-rides",
  validateBody(
    z.object({
      cityId: z.string().uuid(),
      zoneId: z.string().uuid().optional(),
      vehicleTypeId: z.string().uuid(),
      pickup: placeSchema,
      destination: placeSchema,
      bookingMode: z.enum(["quick_match", "competitive_offer"]),
      proposedFare: z.number().positive().optional(),
      scheduledFor: z.coerce.date(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const passenger = await getPassengerProfileOrThrow(req.auth!.userId)
    const scheduledRide = await createScheduledRide({ passengerId: passenger.id, passengerUserId: req.auth!.userId, ...req.body })
    res.status(201).json({ scheduledRide })
  }),
)

passengerRouter.get(
  "/scheduled-rides",
  asyncHandler(async (req, res) => {
    const passenger = await getPassengerProfileOrThrow(req.auth!.userId)
    const scheduledRides = await prisma.scheduledRide.findMany({
      where: { passengerId: passenger.id },
      include: { pickup: true, destination: true, vehicleType: true, rideRequest: true },
      orderBy: { scheduledFor: "desc" },
    })
    res.json({ scheduledRides })
  }),
)

passengerRouter.patch(
  "/scheduled-rides/:id",
  validateBody(z.object({ scheduledFor: z.coerce.date() })),
  asyncHandler(async (req, res) => {
    const passenger = await getPassengerProfileOrThrow(req.auth!.userId)
    const scheduledRide = await rescheduleRide(req.params.id, passenger.id, req.body.scheduledFor)
    res.json({ scheduledRide })
  }),
)

passengerRouter.delete(
  "/scheduled-rides/:id",
  asyncHandler(async (req, res) => {
    const passenger = await getPassengerProfileOrThrow(req.auth!.userId)
    const scheduledRide = await cancelScheduledRide(req.params.id, passenger.id)
    res.json({ scheduledRide })
  }),
)
