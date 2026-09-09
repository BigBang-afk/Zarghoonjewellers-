import { Router } from "express"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"

export const adminDashboardRouter = Router()

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Real database aggregates — no placeholder numbers once seed/live data
 * exists (Phase 2 §17: "Do NOT use fake numbers once database data
 * exists"). Every figure here is a live Prisma count/aggregate.
 */
adminDashboardRouter.get(
  "/dashboard/kpis",
  asyncHandler(async (req, res) => {
    const cityId = req.query.cityId as string | undefined
    const todayFilter = { createdAt: { gte: startOfToday() } }
    const cityFilter = cityId ? { cityId } : {}
    const rideCityFilter = cityId ? { rideRequest: { cityId } } : {}

    const [
      totalPassengers,
      activePassengers,
      totalDrivers,
      onlineDrivers,
      ridesRequestedToday,
      completedToday,
      cancelledToday,
      activeRides,
      gbvAgg,
      commissionAgg,
      driverPayoutAgg,
      fareAgg,
      pendingVerifications,
    ] = await Promise.all([
      prisma.passengerProfile.count(),
      prisma.passengerProfile.count({ where: { user: { status: "active" } } }),
      prisma.driverProfile.count({ where: { deletedAt: null } }),
      prisma.driverProfile.count({ where: { availabilityStatus: "online" } }),
      prisma.rideRequest.count({ where: { ...cityFilter, ...todayFilter } }),
      prisma.ride.count({ where: { status: "ride_completed", ...rideCityFilter, ...todayFilter } }),
      prisma.ride.count({ where: { status: { in: ["cancelled_by_passenger", "cancelled_by_driver"] }, ...rideCityFilter, ...todayFilter } }),
      prisma.ride.count({ where: { status: { notIn: ["ride_completed", "cancelled_by_passenger", "cancelled_by_driver", "expired", "disputed"] }, ...rideCityFilter } }),
      prisma.payment.aggregate({ _sum: { amount: true }, where: { status: "captured" } }),
      prisma.commission.aggregate({ _sum: { amount: true } }),
      prisma.transaction.aggregate({ _sum: { amount: true }, where: { type: "ride_payout" } }),
      prisma.ride.aggregate({ _avg: { finalFare: true, durationMin: true }, where: { status: "ride_completed" } }),
      prisma.driverProfile.count({ where: { verificationStatus: "pending" } }),
    ])

    const [driverCancelled, driverTotal, passengerCancelled, passengerTotal, repeatPassengers] = await Promise.all([
      prisma.ride.count({ where: { status: "cancelled_by_driver" } }),
      prisma.ride.count(),
      prisma.ride.count({ where: { status: "cancelled_by_passenger" } }),
      prisma.ride.count(),
      prisma.passengerProfile.count({ where: { completedRides: { gt: 1 } } }),
    ])

    res.json({
      totalPassengers,
      activePassengers,
      totalDrivers,
      onlineDrivers,
      ridesRequestedToday,
      completedToday,
      cancelledToday,
      activeRides,
      grossBookingValueRs: round2(gbvAgg._sum.amount ?? 0),
      platformRevenueRs: round2(commissionAgg._sum.amount ?? 0),
      driverEarningsRs: round2(driverPayoutAgg._sum.amount ?? 0),
      avgFareRs: round2(fareAgg._avg.finalFare ?? 0),
      avgDurationMin: round2(fareAgg._avg.durationMin ?? 0),
      driverCancellationRatePct: driverTotal ? round2((driverCancelled / driverTotal) * 100) : 0,
      passengerCancellationRatePct: passengerTotal ? round2((passengerCancelled / passengerTotal) * 100) : 0,
      repeatPassengerRatePct: totalPassengers ? round2((repeatPassengers / totalPassengers) * 100) : 0,
      pendingDriverVerifications: pendingVerifications,
    })
  }),
)

adminDashboardRouter.get(
  "/live-map",
  asyncHandler(async (req, res) => {
    const cityId = req.query.cityId as string | undefined
    const [drivers, activeRides, pendingRequests] = await Promise.all([
      prisma.driverProfile.findMany({
        where: { availabilityStatus: { in: ["online", "on_trip"] }, ...(cityId ? { cityId } : {}), lastLat: { not: null } },
        select: { id: true, availabilityStatus: true, lastLat: true, lastLng: true },
      }),
      prisma.ride.findMany({
        where: { status: { notIn: ["ride_completed", "cancelled_by_passenger", "cancelled_by_driver", "expired", "disputed"] } },
        select: { id: true, status: true, pickup: { select: { lat: true, lng: true } }, destination: { select: { lat: true, lng: true } } },
      }),
      prisma.rideRequest.count({ where: { status: { in: ["searching", "offers_open"] }, ...(cityId ? { cityId } : {}) } }),
    ])

    res.json({
      drivers: drivers.map((d) => ({ id: d.id, status: d.availabilityStatus, lat: d.lastLat, lng: d.lastLng })),
      activeRides: activeRides.map((r) => ({ id: r.id, status: r.status, pickup: r.pickup, destination: r.destination })),
      pendingRequestsCount: pendingRequests,
    })
  }),
)

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
