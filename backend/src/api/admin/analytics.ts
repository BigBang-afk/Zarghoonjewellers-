import { Router } from "express"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"

export const adminAnalyticsRouter = Router()

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ---------------------------------------------------------------------
// Passenger / driver / marketplace analytics (Phase 3 §23)
// ---------------------------------------------------------------------

adminAnalyticsRouter.get(
  "/analytics/passengers",
  asyncHandler(async (req, res) => {
    const cityId = req.query.cityId as string | undefined
    const where = cityId ? { user: { primaryCityId: cityId } } : {}

    const [total, withRides, ratingAgg, walletCount, favoriteUsers, referredCount] = await Promise.all([
      prisma.passengerProfile.count({ where }),
      prisma.passengerProfile.count({ where: { ...where, completedRides: { gt: 0 } } }),
      prisma.passengerProfile.aggregate({ where, _avg: { completedRides: true, ratingAvg: true } }),
      prisma.wallet.count({ where: { balance: { gt: 0 } } }),
      prisma.favoriteDriver.groupBy({ by: ["passengerId"], _count: true }),
      prisma.referral.count({ where: { status: "rewarded" } }),
    ])

    res.json({
      totalPassengers: total,
      passengersWithAtLeastOneRide: withRides,
      activationRatePct: total ? round2((withRides / total) * 100) : 0,
      avgCompletedRidesPerPassenger: round2(ratingAgg._avg.completedRides ?? 0),
      avgRatingGiven: round2(ratingAgg._avg.ratingAvg ?? 0),
      passengersWithWalletBalance: walletCount,
      passengersWithFavoriteDriver: favoriteUsers.length,
      successfulReferrals: referredCount,
    })
  }),
)

adminAnalyticsRouter.get(
  "/analytics/drivers",
  asyncHandler(async (req, res) => {
    const cityId = req.query.cityId as string | undefined
    const where = { deletedAt: null, ...(cityId ? { cityId } : {}) }

    const [total, active, agg, payoutAgg, onlineNow] = await Promise.all([
      prisma.driverProfile.count({ where }),
      prisma.driverProfile.count({ where: { ...where, completedRides: { gt: 0 } } }),
      prisma.driverProfile.aggregate({ where, _avg: { acceptanceRate: true, cancellationRate: true, ratingAvg: true, completedRides: true } }),
      prisma.transaction.aggregate({ _sum: { amount: true }, _count: true, where: { type: "ride_payout" } }),
      prisma.driverProfile.count({ where: { ...where, availabilityStatus: "online" } }),
    ])

    res.json({
      totalDrivers: total,
      driversWithAtLeastOneRide: active,
      activationRatePct: total ? round2((active / total) * 100) : 0,
      onlineNow,
      avgAcceptanceRatePct: round2(agg._avg.acceptanceRate ?? 0),
      avgCancellationRatePct: round2(agg._avg.cancellationRate ?? 0),
      avgRating: round2(agg._avg.ratingAvg ?? 0),
      avgCompletedRides: round2(agg._avg.completedRides ?? 0),
      totalDriverPayoutsRs: round2(payoutAgg._sum.amount ?? 0),
      avgPayoutPerRideRs: payoutAgg._count ? round2((payoutAgg._sum.amount ?? 0) / payoutAgg._count) : 0,
    })
  }),
)

adminAnalyticsRouter.get(
  "/analytics/marketplace",
  asyncHandler(async (req, res) => {
    const cityId = req.query.cityId as string | undefined
    const rideWhere = cityId ? { rideRequest: { cityId } } : {}

    const [gbvAgg, commissionAgg, byMode, byPayment, completedCount, cancelledCount] = await Promise.all([
      prisma.payment.aggregate({ _sum: { amount: true }, where: { status: "captured" } }),
      prisma.commission.aggregate({ _sum: { amount: true } }),
      prisma.rideRequest.groupBy({ by: ["bookingMode"], _count: true, where: cityId ? { cityId } : {} }),
      prisma.ride.groupBy({ by: ["paymentMethod"], _count: true, where: rideWhere }),
      prisma.ride.count({ where: { status: "ride_completed", ...rideWhere } }),
      prisma.ride.count({ where: { status: { in: ["cancelled_by_passenger", "cancelled_by_driver"] }, ...rideWhere } }),
    ])

    const gbv = gbvAgg._sum.amount ?? 0
    const commission = commissionAgg._sum.amount ?? 0

    res.json({
      grossBookingValueRs: round2(gbv),
      platformRevenueRs: round2(commission),
      takeRatePct: gbv ? round2((commission / gbv) * 100) : 0,
      completedRides: completedCount,
      cancelledRides: cancelledCount,
      cancellationRatePct: completedCount + cancelledCount ? round2((cancelledCount / (completedCount + cancelledCount)) * 100) : 0,
      ridesByBookingMode: byMode.map((m) => ({ bookingMode: m.bookingMode, count: m._count })),
      ridesByPaymentMethod: byPayment.map((p) => ({ paymentMethod: p.paymentMethod, count: p._count })),
    })
  }),
)

// ---------------------------------------------------------------------
// Customer acquisition tracking (Phase 4 §17) — grouped by the
// self-reported acquisitionSource/acquisitionCampaign captured at
// registration. CPA needs real ad-spend data we don't store anywhere, so
// rather than fabricate a number, `spendRs` is an optional query param:
// when supplied it's divided by that source's signup count to produce a
// CPA figure computed from an admin-supplied input, not invented data.
// ---------------------------------------------------------------------

adminAnalyticsRouter.get(
  "/analytics/acquisition",
  asyncHandler(async (req, res) => {
    const cityId = req.query.cityId as string | undefined
    const spendRs = req.query.spendRs ? Number(req.query.spendRs) : undefined
    const where = cityId ? { primaryCityId: cityId } : {}

    const users = await prisma.user.findMany({
      where,
      select: { id: true, role: true, acquisitionSource: true, acquisitionCampaign: true, createdAt: true },
    })
    if (users.length === 0) return res.json({ bySource: [], byCampaign: [] })

    const [passengerRides, driverRides] = await Promise.all([
      prisma.ride.findMany({
        where: { status: "ride_completed", passenger: { userId: { in: users.map((u) => u.id) } } },
        select: { createdAt: true, passenger: { select: { userId: true } } },
      }),
      prisma.ride.findMany({
        where: { status: "ride_completed", driver: { userId: { in: users.map((u) => u.id) } } },
        select: { createdAt: true, driver: { select: { userId: true } } },
      }),
    ])

    const ridesByUser = new Map<string, Date[]>()
    for (const r of passengerRides) {
      const userId = r.passenger.userId
      if (!ridesByUser.has(userId)) ridesByUser.set(userId, [])
      ridesByUser.get(userId)!.push(r.createdAt)
    }
    for (const r of driverRides) {
      const userId = r.driver.userId
      if (!ridesByUser.has(userId)) ridesByUser.set(userId, [])
      ridesByUser.get(userId)!.push(r.createdAt)
    }

    type Bucket = { signups: number; firstRide: number; repeatRide: number; retained30d: number }
    function summarize(groupBy: (u: (typeof users)[number]) => string) {
      const buckets = new Map<string, Bucket>()
      for (const u of users) {
        const key = groupBy(u)
        const bucket = buckets.get(key) ?? { signups: 0, firstRide: 0, repeatRide: 0, retained30d: 0 }
        bucket.signups++
        const rides = ridesByUser.get(u.id) ?? []
        if (rides.length >= 1) bucket.firstRide++
        if (rides.length >= 2) bucket.repeatRide++
        // Retained: has a completed ride 7+ days after signup (still riding, not a one-and-done).
        if (rides.some((d) => d.getTime() >= u.createdAt.getTime() + 7 * 86_400_000)) bucket.retained30d++
        buckets.set(key, bucket)
      }
      return [...buckets.entries()]
        .sort((a, b) => b[1].signups - a[1].signups)
        .map(([key, b]) => ({
          key,
          signups: b.signups,
          firstRideRatePct: round2((b.firstRide / b.signups) * 100),
          repeatRideRatePct: round2((b.repeatRide / b.signups) * 100),
          retainedPct: round2((b.retained30d / b.signups) * 100),
          cpaRs: spendRs != null && b.signups > 0 ? round2(spendRs / b.signups) : null,
        }))
    }

    res.json({
      bySource: summarize((u) => u.acquisitionSource ?? "unknown"),
      byCampaign: summarize((u) => u.acquisitionCampaign ?? "(none)"),
      spendRsSupplied: spendRs ?? null,
    })
  }),
)

// ---------------------------------------------------------------------
// Cohort / retention analytics (Phase 3 §24) — weekly registration
// cohorts for both roles. "Returned" is defined as having at least one
// completed ride within the window measured from registration, which is
// the standard activation/retention definition for a marketplace app.
// ---------------------------------------------------------------------

function isoWeekLabel(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`
}

adminAnalyticsRouter.get(
  "/analytics/cohorts",
  asyncHandler(async (req, res) => {
    const role = (req.query.role as string) === "driver" ? "driver" : "passenger"
    const weeksBack = Math.min(26, Math.max(1, Number(req.query.weeks) || 8))
    const since = new Date(Date.now() - weeksBack * 7 * 86_400_000)

    const users = await prisma.user.findMany({
      where: { role, createdAt: { gte: since } },
      select: { id: true, createdAt: true },
    })
    if (users.length === 0) return res.json({ role, cohorts: [] })

    const rides =
      role === "passenger"
        ? await prisma.ride.findMany({
            where: { status: "ride_completed", passenger: { userId: { in: users.map((u) => u.id) } } },
            select: { createdAt: true, passenger: { select: { userId: true } } },
          })
        : await prisma.ride.findMany({
            where: { status: "ride_completed", driver: { userId: { in: users.map((u) => u.id) } } },
            select: { createdAt: true, driver: { select: { userId: true } } },
          })

    const ridesByUser = new Map<string, Date[]>()
    for (const r of rides) {
      const userId = role === "passenger" ? (r as { passenger: { userId: string } }).passenger.userId : (r as { driver: { userId: string } }).driver.userId
      if (!ridesByUser.has(userId)) ridesByUser.set(userId, [])
      ridesByUser.get(userId)!.push(r.createdAt)
    }

    const cohortMap = new Map<string, { registered: number; firstRide: number; returned7d: number; returned30d: number }>()
    for (const u of users) {
      const label = isoWeekLabel(u.createdAt)
      const cohort = cohortMap.get(label) ?? { registered: 0, firstRide: 0, returned7d: 0, returned30d: 0 }
      cohort.registered++
      const userRides = ridesByUser.get(u.id) ?? []
      if (userRides.length > 0) cohort.firstRide++
      const day7 = u.createdAt.getTime() + 7 * 86_400_000
      const day30 = u.createdAt.getTime() + 30 * 86_400_000
      if (userRides.some((d) => d.getTime() <= day7)) cohort.returned7d++
      if (userRides.some((d) => d.getTime() <= day30)) cohort.returned30d++
      cohortMap.set(label, cohort)
    }

    const cohorts = [...cohortMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week, c]) => ({
        week,
        registered: c.registered,
        firstRideRatePct: round2((c.firstRide / c.registered) * 100),
        returned7dPct: round2((c.returned7d / c.registered) * 100),
        returned30dPct: round2((c.returned30d / c.registered) * 100),
      }))

    res.json({ role, cohorts })
  }),
)
