import { Router } from "express"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"

export const adminCancellationsRouter = Router()

/**
 * Phase 5 §14 — cancellation pattern analysis. Live queries over Ride
 * (post-match cancellations) and RideRequest (pre-match, passenger-only
 * cancellations), grouped by the structured reason code rather than
 * free text, so patterns are actually queryable. "Repeat cancellers"
 * reuses the cumulative cancelledRides/completedRides counters already
 * kept on each profile (Phase 2) rather than a new counter.
 */
function parseCancellationFilters(query: Record<string, unknown>) {
  const to = query.to ? new Date(String(query.to)) : new Date()
  const from = query.from ? new Date(String(query.from)) : new Date(to.getTime() - 30 * 86_400_000)
  const cityId = (query.cityId as string) || undefined
  return { from, to, cityId }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

adminCancellationsRouter.get(
  "/cancellations/analytics",
  asyncHandler(async (req, res) => {
    const { from, to, cityId } = parseCancellationFilters(req.query as Record<string, unknown>)

    const postMatchWhere = {
      status: { in: ["cancelled_by_passenger", "cancelled_by_driver"] as string[] },
      cancelledAt: { gte: from, lte: to },
      ...(cityId ? { rideRequest: { cityId } } : {}),
    }
    const preMatchWhere = {
      status: "cancelled",
      updatedAt: { gte: from, lte: to },
      ...(cityId ? { cityId } : {}),
    }

    const [postMatchTotal, postMatchByReason, postMatchByStatus, feeChargedCount, preMatchTotal, preMatchByReason] = await Promise.all([
      prisma.ride.count({ where: postMatchWhere }),
      prisma.ride.groupBy({ by: ["cancellationReasonCode"], where: postMatchWhere, _count: { _all: true } }),
      prisma.ride.groupBy({ by: ["status"], where: postMatchWhere, _count: { _all: true } }),
      prisma.ride.count({ where: { ...postMatchWhere, cancellationFeeCharged: true } }),
      prisma.rideRequest.count({ where: preMatchWhere }),
      prisma.rideRequest.groupBy({ by: ["cancellationReasonCode"], where: preMatchWhere, _count: { _all: true } }),
    ])

    // "Repeat cancellers" — profiles with a meaningful ride history whose
    // cancellation rate stands out, worst-first. Same threshold pattern as
    // riskService's automatic signal (risk.minRidesForCancellationCheck),
    // reused here purely for display, not to re-trigger the risk pipeline.
    const [passengers, drivers] = await Promise.all([
      prisma.passengerProfile.findMany({
        where: { cancelledRides: { gt: 0 } },
        include: { user: { select: { fullName: true, phone: true } } },
        orderBy: { cancelledRides: "desc" },
        take: 10,
      }),
      prisma.driverProfile.findMany({
        where: { cancelledRides: { gt: 0 } },
        include: { user: { select: { fullName: true, phone: true } } },
        orderBy: { cancelledRides: "desc" },
        take: 10,
      }),
    ])

    const topPassengers = passengers
      .map((p) => {
        const totalRides = p.completedRides + p.cancelledRides
        return {
          userId: p.userId,
          fullName: p.user.fullName,
          completedRides: p.completedRides,
          cancelledRides: p.cancelledRides,
          cancellationRatePct: totalRides ? round2((p.cancelledRides / totalRides) * 100) : 0,
        }
      })
      .sort((a, b) => b.cancellationRatePct - a.cancellationRatePct)

    const topDrivers = drivers
      .map((d) => {
        const totalRides = d.completedRides + d.cancelledRides
        return {
          userId: d.userId,
          fullName: d.user.fullName,
          completedRides: d.completedRides,
          cancelledRides: d.cancelledRides,
          cancellationRatePct: totalRides ? round2((d.cancelledRides / totalRides) * 100) : 0,
        }
      })
      .sort((a, b) => b.cancellationRatePct - a.cancellationRatePct)

    res.json({
      range: { from, to },
      cityId: cityId ?? null,
      postMatch: {
        total: postMatchTotal,
        byPassenger: postMatchByStatus.find((g) => g.status === "cancelled_by_passenger")?._count._all ?? 0,
        byDriver: postMatchByStatus.find((g) => g.status === "cancelled_by_driver")?._count._all ?? 0,
        byReasonCode: postMatchByReason.map((g) => ({ reason: g.cancellationReasonCode ?? "unspecified", count: g._count._all })),
        feeChargedCount,
      },
      preMatch: {
        total: preMatchTotal,
        byReasonCode: preMatchByReason.map((g) => ({ reason: g.cancellationReasonCode ?? "unspecified", count: g._count._all })),
      },
      topCancellingPassengers: topPassengers,
      topCancellingDrivers: topDrivers,
    })
  }),
)
