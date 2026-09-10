import { prisma } from "../utils/prisma.js"
import { getSetting } from "../config/settings.js"
import { haversineKm } from "../utils/geo.js"
import type { RiskEventType } from "../types/enums.js"

const SEVERITY_WEIGHT: Record<string, number> = { low: 1, medium: 3, high: 7, critical: 15 }

/**
 * Fraud/abuse monitoring (Phase 2 §22). Every signal here only *records*
 * a RiskEvent and nudges a RiskScore — nothing here suspends an account
 * or blocks an action on its own. A human reviews the manual review
 * queue (admin API) before any punitive action is taken.
 */
export async function recordRiskEvent(userId: string, type: RiskEventType, severity: "low" | "medium" | "high" | "critical", details?: Record<string, unknown>) {
  await prisma.riskEvent.create({ data: { userId, type, severity, details: details ? JSON.stringify(details) : null } })
  await recomputeRiskScore(userId)
}

export async function recomputeRiskScore(userId: string): Promise<number> {
  const events = await prisma.riskEvent.findMany({ where: { userId, reviewedAt: null }, orderBy: { createdAt: "desc" }, take: 50 })
  const score = events.reduce((sum, e) => sum + (SEVERITY_WEIGHT[e.severity] ?? 1), 0)
  await prisma.riskScore.upsert({
    where: { userId },
    create: { userId, score },
    update: { score },
  })
  return score
}

/**
 * Unusual cancellation pattern check — only evaluated once a user has a
 * meaningful ride history (configurable minimum), so a single early
 * cancellation never trips a flag.
 */
export async function checkCancellationRiskSignal(userId: string, role: "passenger" | "driver"): Promise<void> {
  const [threshold, minRides] = await Promise.all([
    getSetting("risk.cancellationRateThresholdPct"),
    getSetting("risk.minRidesForCancellationCheck"),
  ])

  const profile =
    role === "passenger"
      ? await prisma.passengerProfile.findUnique({ where: { userId } })
      : await prisma.driverProfile.findUnique({ where: { userId } })
  if (!profile) return

  const totalRides = profile.completedRides + profile.cancelledRides
  if (totalRides < minRides) return

  const cancellationRatePct = (profile.cancelledRides / totalRides) * 100
  if (cancellationRatePct >= threshold) {
    await recordRiskEvent(userId, "unusual_cancellation", "medium", { cancellationRatePct: Math.round(cancellationRatePct), totalRides })
  }
}

/**
 * Impossible-movement check for driver location updates: compares the
 * implied speed between two consecutive pings against a configurable
 * ceiling. A real GPS reading can be noisy near that ceiling, so this
 * flags for review rather than rejecting the update.
 */
export async function checkImpossibleMovement(params: {
  driverUserId: string
  prev: { lat: number; lng: number; at: Date } | null
  next: { lat: number; lng: number; at: Date }
}): Promise<void> {
  if (!params.prev) return
  const elapsedHours = (params.next.at.getTime() - params.prev.at.getTime()) / 3_600_000
  if (elapsedHours <= 0) return

  const distanceKm = haversineKm(params.prev, params.next)
  const impliedSpeedKmh = distanceKm / elapsedHours
  const ceiling = await getSetting("risk.impossibleSpeedKmh")

  if (impliedSpeedKmh > ceiling) {
    await recordRiskEvent(params.driverUserId, "impossible_movement", "high", {
      impliedSpeedKmh: Math.round(impliedSpeedKmh),
      distanceKm: Math.round(distanceKm * 100) / 100,
      elapsedMinutes: Math.round(elapsedHours * 60),
    })
  }
}
