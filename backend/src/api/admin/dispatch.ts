import { Router } from "express"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"

export const adminDispatchRouter = Router()

/**
 * Phase 5 §13 — advanced dispatch observability. Everything here is a
 * live query over RideRequest/RideOffer (never a cached counter that can
 * drift, matching this phase's established analytics pattern):
 *   - stage distribution: which tier (closest_eligible / expand_radius /
 *     expand_pool / none_available) each request's dispatch settled on.
 *   - no-match reason breakdown: for requests that never got a driver.
 *   - drivers-contacted / offers-received per request, averaged.
 *   - time-to-match: Ride.createdAt - RideRequest.createdAt, for every
 *     request that did get matched (its status may have moved on since,
 *     e.g. to "cancelled" after booking — a later cancellation doesn't
 *     undo the fact that dispatch succeeded, so this is judged by
 *     whether a Ride exists, not by the request's current status).
 */
function parseDispatchFilters(query: Record<string, unknown>) {
  const to = query.to ? new Date(String(query.to)) : new Date()
  const from = query.from ? new Date(String(query.from)) : new Date(to.getTime() - 7 * 86_400_000)
  const cityId = (query.cityId as string) || undefined
  return { from, to, cityId }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

adminDispatchRouter.get(
  "/dispatch/analytics",
  asyncHandler(async (req, res) => {
    const { from, to, cityId } = parseDispatchFilters(req.query as Record<string, unknown>)
    const where = { createdAt: { gte: from, lte: to }, ...(cityId ? { cityId } : {}) }

    const [total, stageGroups, noMatchGroups, matchedRequests, offerGroups, responseGroups] = await Promise.all([
      prisma.rideRequest.count({ where }),
      prisma.rideRequest.groupBy({ by: ["dispatchStage"], where, _count: { _all: true } }),
      prisma.rideRequest.groupBy({ by: ["noMatchReason"], where: { ...where, noMatchReason: { not: null } }, _count: { _all: true } }),
      prisma.rideRequest.findMany({
        where: { ...where, ride: { isNot: null } },
        select: { id: true, createdAt: true, ride: { select: { createdAt: true } } },
      }),
      prisma.rideOffer.groupBy({ by: ["rideRequestId"], where: { rideRequest: where }, _count: { _all: true } }),
      prisma.rideOffer.groupBy({
        by: ["rideRequestId"],
        where: { rideRequest: where, status: { in: ["accepted", "declined"] } },
        _count: { _all: true },
      }),
    ])

    const matchedCount = matchedRequests.length
    const timeToMatchSecs = matchedRequests
      .filter((r) => r.ride)
      .map((r) => (r.ride!.createdAt.getTime() - r.createdAt.getTime()) / 1000)
    const avgTimeToMatchSec = timeToMatchSecs.length ? round2(timeToMatchSecs.reduce((a, b) => a + b, 0) / timeToMatchSecs.length) : null

    const driversContactedTotal = offerGroups.reduce((sum, g) => sum + g._count._all, 0)
    const offersReceivedTotal = responseGroups.reduce((sum, g) => sum + g._count._all, 0)

    res.json({
      range: { from, to },
      cityId: cityId ?? null,
      totalRequests: total,
      matchedCount,
      matchRatePct: total ? round2((matchedCount / total) * 100) : 0,
      avgTimeToMatchSec,
      avgDriversContactedPerRequest: total ? round2(driversContactedTotal / total) : 0,
      avgOffersReceivedPerRequest: total ? round2(offersReceivedTotal / total) : 0,
      stageBreakdown: stageGroups.map((g) => ({ stage: g.dispatchStage ?? "pending", count: g._count._all })),
      noMatchReasonBreakdown: noMatchGroups.map((g) => ({ reason: g.noMatchReason, count: g._count._all })),
    })
  }),
)
