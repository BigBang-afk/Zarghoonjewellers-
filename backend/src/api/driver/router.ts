import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAuth, requireRole } from "../../middleware/auth.js"
import { getDriverProfileOrThrow } from "../../shared/profileLookup.js"
import { ApiError } from "../../utils/apiError.js"
import { emitToAdmin } from "../../realtime/socket.js"
import { checkImpossibleMovement } from "../../services/riskService.js"
import { getDriverIncentiveSummary } from "../../services/incentiveService.js"
import { submitDriverDocument } from "../../services/verificationService.js"
import { requestPayout, cancelPayout } from "../../services/payoutService.js"
import { DocType, PaymentMethod } from "../../types/enums.js"
import { getSetting } from "../../config/settings.js"
import { recordFailure } from "../../services/observability.js"
import { paymentRateLimit } from "../../middleware/rateLimit.js"
import { roundMoney } from "../../utils/money.js"
import { computeDemandGrid } from "../../services/demandMapService.js"
import { driverRespondToLostItem, resolveLostItem } from "../../services/lostFoundService.js"

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

    // Online-session log — feeds accurate earnings/hour (Phase 3 §7) and
    // never runs while the driver is offline (Phase 3 §5).
    if (req.body.status === "online") {
      await prisma.driverOnlineSession.create({ data: { driverId: driver.id } })
    } else {
      const openSession = await prisma.driverOnlineSession.findFirst({
        where: { driverId: driver.id, endedAt: null },
        orderBy: { startedAt: "desc" },
      })
      if (openSession) {
        await prisma.driverOnlineSession.update({ where: { id: openSession.id }, data: { endedAt: new Date() } })
      }
    }

    emitToAdmin("driver.availability_changed", { driverId: driver.id, status: updated.availabilityStatus })
    res.json({ driverProfile: updated })
  }),
)

driverRouter.patch(
  "/me/location",
  validateBody(
    z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      /** GPS accuracy radius in meters, when the client's geolocation API reports one (Phase 4 §6). */
      accuracyMeters: z.number().positive().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const driver = await getDriverProfileOrThrow(req.auth!.userId)
    // Only meaningful to broadcast while online or on a trip — an offline
    // driver's position is never tracked (Phase 3 §5).
    if (driver.availabilityStatus === "offline") {
      throw ApiError.conflict("DRIVER_OFFLINE", "Go online before sending location updates.")
    }
    const prev = driver.lastLat != null && driver.lastLng != null && driver.lastLocationAt
      ? { lat: driver.lastLat, lng: driver.lastLng, at: driver.lastLocationAt }
      : null
    const next = { lat: req.body.lat, lng: req.body.lng, at: new Date() }

    await prisma.driverProfile.update({
      where: { id: driver.id },
      data: { lastLat: next.lat, lastLng: next.lng, lastLocationAt: next.at, lastLocationAccuracyM: req.body.accuracyMeters },
    })

    // A poor-accuracy fix is real signal noise, not real movement — skip
    // the impossible-speed check for it rather than risk a false positive.
    const poorAccuracyThreshold = await getSetting("maps.poorAccuracyThresholdM")
    const isPoorAccuracy = req.body.accuracyMeters != null && req.body.accuracyMeters > poorAccuracyThreshold
    if (!isPoorAccuracy) {
      await checkImpossibleMovement({ driverUserId: req.auth!.userId, prev, next }).catch(() => {})
    } else {
      recordFailure("location_failures", { driverId: driver.id, accuracyMeters: req.body.accuracyMeters })
    }
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
// Generalized demand heat map (Phase 5 §12) — reuses the same grid
// computation as the admin demand-map, but scoped to the driver's own
// city only (never an arbitrary cityId a driver could pass in) and
// stripped down to just a coarse status per area. Never exposes raw
// open-request counts or pickup coordinates precise enough to infer an
// individual passenger's location, and never nudges a driver toward a
// specific cell — it's the same read-only visibility the admin
// dashboard gets, not a dispatch instruction.
// ---------------------------------------------------------------------

driverRouter.get(
  "/me/demand-map",
  asyncHandler(async (req, res) => {
    const driver = await getDriverProfileOrThrow(req.auth!.userId)
    const range = (req.query.range as string) || "lastHour"
    const grid = await computeDemandGrid({ cityId: driver.cityId, range, gridSize: 4 })
    res.json({
      range: grid.range,
      cells: grid.cells.map((c) => ({ centerLat: c.centerLat, centerLng: c.centerLng, status: c.status })),
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
    const currencyCode = wallet?.currencyCode ?? "PKR"

    async function summarize(since: Date) {
      const transactions = await prisma.transaction.findMany({
        where: { walletId: wallet?.id ?? "__none__", type: "ride_payout", createdAt: { gte: since } },
      })
      const total = transactions.reduce((sum, t) => sum + t.amount, 0)
      return {
        totalRs: roundMoney(total, currencyCode),
        rides: transactions.length,
        averageFareRs: transactions.length ? roundMoney(total / transactions.length, currencyCode) : 0,
      }
    }

    const [today, week, month, dailySeries, weeklySeries, monthlySeries, earningsPerHour] = await Promise.all([
      summarize(startOfToday()),
      summarize(startOfWeek()),
      summarize(startOfMonth()),
      buildSeries(wallet?.id, currencyCode, "day", 14),
      buildSeries(wallet?.id, currencyCode, "week", 8),
      buildSeries(wallet?.id, currencyCode, "month", 6),
      computeEarningsPerHour(driver.id, wallet?.id, currencyCode),
    ])

    const totalRides = driver.completedRides + driver.cancelledRides

    res.json({
      currencyCode,
      walletBalanceRs: wallet?.balance ?? 0,
      pendingBalanceRs: wallet?.pendingBalance ?? 0,
      paidBalanceRs: wallet?.paidBalance ?? 0,
      today,
      week,
      month,
      charts: { daily: dailySeries, weekly: weeklySeries, monthly: monthlySeries },
      earningsPerHourRs: earningsPerHour,
      completedRides: driver.completedRides,
      cancelledRides: driver.cancelledRides,
      acceptanceRate: driver.acceptanceRate,
      cancellationRate: totalRides ? Math.round((driver.cancelledRides / totalRides) * 10000) / 100 : 0,
      rating: driver.ratingAvg,
    })
  }),
)

/** Buckets ride_payout transactions into `count` trailing periods for chart rendering. */
async function buildSeries(walletId: string | undefined, currencyCode: string, unit: "day" | "week" | "month", count: number) {
  if (!walletId) return []
  const stepMs = unit === "day" ? 86_400_000 : unit === "week" ? 7 * 86_400_000 : 30 * 86_400_000
  const since = new Date(Date.now() - count * stepMs)
  const transactions = await prisma.transaction.findMany({
    where: { walletId, type: "ride_payout", createdAt: { gte: since } },
    select: { amount: true, createdAt: true },
  })

  const buckets: { label: string; totalRs: number; rides: number }[] = []
  for (let i = count - 1; i >= 0; i--) {
    const bucketStart = new Date(Date.now() - (i + 1) * stepMs)
    const bucketEnd = new Date(Date.now() - i * stepMs)
    const inBucket = transactions.filter((t) => t.createdAt >= bucketStart && t.createdAt < bucketEnd)
    buckets.push({
      label: bucketStart.toISOString().slice(0, 10),
      totalRs: roundMoney(inBucket.reduce((sum, t) => sum + t.amount, 0), currencyCode),
      rides: inBucket.length,
    })
  }
  return buckets
}

/** Real elapsed online time from DriverOnlineSession logs, not an approximation. */
async function computeEarningsPerHour(driverId: string, walletId: string | undefined, currencyCode: string): Promise<number> {
  const since = new Date(Date.now() - 30 * 86_400_000)
  const [sessions, payoutAgg] = await Promise.all([
    prisma.driverOnlineSession.findMany({ where: { driverId, startedAt: { gte: since } } }),
    walletId
      ? prisma.transaction.aggregate({ _sum: { amount: true }, where: { walletId, type: "ride_payout", createdAt: { gte: since } } })
      : Promise.resolve({ _sum: { amount: 0 } }),
  ])
  const totalHours = sessions.reduce((sum, s) => sum + ((s.endedAt ?? new Date()).getTime() - s.startedAt.getTime()) / 3_600_000, 0)
  if (totalHours < 0.1) return 0
  return roundMoney((payoutAgg._sum.amount ?? 0) / totalHours, currencyCode)
}

driverRouter.get(
  "/me/transactions",
  asyncHandler(async (req, res) => {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.auth!.userId } })
    if (!wallet) return res.json({ transactions: [], total: 0 })

    const { type, from, to, page = "1", pageSize = "30" } = req.query as Record<string, string>
    const where = {
      walletId: wallet.id,
      ...(type ? { type } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
    }
    const take = Math.min(100, Number(pageSize) || 30)
    const skip = (Math.max(1, Number(page) || 1) - 1) * take

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({ where, include: { payment: { include: { ride: true } } }, orderBy: { createdAt: "desc" }, take, skip }),
      prisma.transaction.count({ where }),
    ])
    res.json({ transactions, total, page: Number(page) || 1, pageSize: take })
  }),
)

// ---------------------------------------------------------------------
// Trust & verification (Phase 3 §16-17)
// ---------------------------------------------------------------------

driverRouter.get(
  "/me/documents",
  asyncHandler(async (req, res) => {
    const driver = await getDriverProfileOrThrow(req.auth!.userId)
    const documents = await prisma.driverDocument.findMany({ where: { driverId: driver.id }, orderBy: { createdAt: "desc" } })
    res.json({ documents })
  }),
)

// ---------------------------------------------------------------------
// Payouts (Phase 4 §5)
// ---------------------------------------------------------------------

driverRouter.get(
  "/me/payouts",
  asyncHandler(async (req, res) => {
    const driver = await getDriverProfileOrThrow(req.auth!.userId)
    const payouts = await prisma.payoutRequest.findMany({ where: { driverId: driver.id }, orderBy: { createdAt: "desc" }, take: 50 })
    res.json({ payouts })
  }),
)

driverRouter.post(
  "/me/payouts",
  paymentRateLimit,
  validateBody(z.object({ amount: z.number().positive(), method: z.enum(PaymentMethod) })),
  asyncHandler(async (req, res) => {
    const driver = await getDriverProfileOrThrow(req.auth!.userId)
    const payout = await requestPayout(req.auth!.userId, driver.id, req.body.amount, req.body.method)
    res.status(201).json({ payout })
  }),
)

driverRouter.post(
  "/me/payouts/:id/cancel",
  asyncHandler(async (req, res) => {
    const driver = await getDriverProfileOrThrow(req.auth!.userId)
    const payout = await cancelPayout(req.params.id, driver.id)
    res.json({ payout })
  }),
)

driverRouter.post(
  "/me/documents",
  validateBody(
    z.object({
      docType: z.enum(DocType),
      fileUrl: z.string().trim().min(1).max(500),
      expiresAt: z.coerce.date().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const driver = await getDriverProfileOrThrow(req.auth!.userId)
    const document = await submitDriverDocument({ driverId: driver.id, ...req.body })
    res.status(201).json({ document })
  }),
)

driverRouter.get(
  "/me/incentives",
  asyncHandler(async (req, res) => {
    const driver = await getDriverProfileOrThrow(req.auth!.userId)
    const summary = await getDriverIncentiveSummary(driver.id)
    res.json(summary)
  }),
)

// ---------------------------------------------------------------------
// Lost & found (Phase 5 §15)
// ---------------------------------------------------------------------

driverRouter.get(
  "/me/lost-item-reports",
  asyncHandler(async (req, res) => {
    const reports = await prisma.lostItemReport.findMany({
      where: { driverUserId: req.auth!.userId },
      include: { reporter: { select: { fullName: true } }, ride: { select: { id: true, completedAt: true } } },
      orderBy: { createdAt: "desc" },
    })
    res.json({ reports })
  }),
)

driverRouter.post(
  "/lost-item-reports/:id/respond",
  validateBody(z.object({ found: z.boolean() })),
  asyncHandler(async (req, res) => {
    const report = await driverRespondToLostItem({ reportId: req.params.id, driverUserId: req.auth!.userId, found: req.body.found })
    res.json({ report })
  }),
)

driverRouter.post(
  "/lost-item-reports/:id/resolve",
  validateBody(z.object({ status: z.enum(["returned", "closed"]) })),
  asyncHandler(async (req, res) => {
    const report = await resolveLostItem({ reportId: req.params.id, actorUserId: req.auth!.userId, status: req.body.status })
    res.json({ report })
  }),
)
