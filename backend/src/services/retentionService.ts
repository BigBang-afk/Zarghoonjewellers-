import { randomInt } from "node:crypto"
import { prisma } from "../utils/prisma.js"
import { getSetting } from "../config/settings.js"
import { notifyFromTemplate } from "./notifications/NotificationService.js"
import { logger } from "../utils/logger.js"

/**
 * Customer retention engine (Phase 5 §8) — automated lifecycle
 * notifications: welcome (event-triggered, see sendWelcomeMessage),
 * second-ride nudge, 7-day and 30-day inactivity re-engagement
 * (both sweep-driven, see runRetentionSweep). "No spam" is enforced
 * two ways: (1) NotificationPreference — notifyFromTemplate ultimately
 * calls notify(), which already respects a user's "promo" opt-out,
 * same as every other promotional notification in the system; (2) a
 * resend cooldown per campaign via RetentionNotificationLog, so a
 * still-inactive user gets the 7-day nudge at most once per cooldown
 * window, not every time the sweep runs.
 */

async function alreadySent(userId: string, campaign: string, sinceDaysAgo?: number): Promise<boolean> {
  const latest = await prisma.retentionNotificationLog.findFirst({
    where: { userId, campaign },
    orderBy: { sentAt: "desc" },
  })
  if (!latest) return false
  if (sinceDaysAgo == null) return true // one-time campaign — any prior send counts
  const cutoff = new Date(Date.now() - sinceDaysAgo * 86_400_000)
  return latest.sentAt >= cutoff
}

async function logSent(userId: string, campaign: string): Promise<void> {
  await prisma.retentionNotificationLog.create({ data: { userId, campaign } })
}

/** Called once, right after OTP verification completes a new registration. */
export async function sendWelcomeMessage(userId: string): Promise<void> {
  if (await alreadySent(userId, "welcome")) return
  await notifyFromTemplate({ userId, templateKey: "retention.welcome", type: "promo" })
  await logSent(userId, "welcome")
}

function randomPromoCode(): string {
  return `WELCOME${randomInt(10000, 99999)}`
}

/**
 * Generates a real, single-use win-back Promotion (never just a claim in
 * notification copy) and returns its code + the vars needed to render
 * the notification body.
 */
async function createWinbackPromo(userId: string, cityId: string | null): Promise<{ code: string; pct: number; validDays: number }> {
  const pct = await getSetting("retention.winbackDiscountPct")
  const validDays = await getSetting("retention.winbackDiscountValidDays")
  const code = randomPromoCode()
  await prisma.promotion.create({
    data: {
      code,
      description: `Win-back offer for user ${userId}`,
      campaignType: "retention_winback",
      discountType: "percentage",
      discountValue: pct,
      cityId: cityId ?? undefined,
      newUsersOnly: false,
      usageLimit: 1,
      expiresAt: new Date(Date.now() + validDays * 86_400_000),
      isActive: true,
    },
  })
  return { code, pct, validDays }
}

interface RideStats {
  userId: string
  completedRides: number
  lastRideAt: Date | null
  cityId: string | null
}

/** One row per passenger with completed rides: their count and most recent completion date. */
async function passengerRideStats(): Promise<Map<string, RideStats>> {
  const grouped = await prisma.ride.groupBy({
    by: ["passengerId"],
    where: { status: "ride_completed" },
    _max: { completedAt: true },
    _count: true,
  })
  if (grouped.length === 0) return new Map()

  const passengers = await prisma.passengerProfile.findMany({
    where: { id: { in: grouped.map((g) => g.passengerId) } },
    select: { id: true, userId: true, user: { select: { primaryCityId: true } } },
  })
  const byPassengerId = new Map(passengers.map((p) => [p.id, p]))

  const out = new Map<string, RideStats>()
  for (const g of grouped) {
    const passenger = byPassengerId.get(g.passengerId)
    if (!passenger) continue
    out.set(passenger.userId, {
      userId: passenger.userId,
      completedRides: g._count,
      lastRideAt: g._max.completedAt,
      cityId: passenger.user.primaryCityId,
    })
  }
  return out
}

/**
 * Periodic sweep (registered in jobs/index.ts) — evaluates every
 * passenger with at least one completed ride against the three
 * sweep-driven campaigns. A passenger only ever matches the single
 * most urgent campaign they're eligible for in one run (30d takes
 * priority over 7d over the second-ride nudge) so nobody gets two
 * lifecycle notifications in the same sweep.
 */
export async function runRetentionSweep(): Promise<void> {
  const [secondRideDays, inactive7dDays, inactive30dDays, cooldownDays] = await Promise.all([
    getSetting("retention.secondRideNudgeAfterDays"),
    getSetting("retention.inactive7dAfterDays"),
    getSetting("retention.inactive30dAfterDays"),
    getSetting("retention.resendCooldownDays"),
  ])

  const statsByUser = await passengerRideStats()
  const now = Date.now()
  let sent = { secondRide: 0, inactive7d: 0, inactive30d: 0 }

  for (const stats of statsByUser.values()) {
    if (!stats.lastRideAt) continue
    const daysSince = (now - stats.lastRideAt.getTime()) / 86_400_000

    if (stats.completedRides >= 1 && daysSince >= inactive30dDays) {
      if (await alreadySent(stats.userId, "inactive_30d", cooldownDays)) continue
      const promo = await createWinbackPromo(stats.userId, stats.cityId)
      await notifyFromTemplate({
        userId: stats.userId,
        templateKey: "retention.inactive_30d",
        type: "promo",
        vars: { code: promo.code, pct: promo.pct, validDays: promo.validDays },
      })
      await logSent(stats.userId, "inactive_30d")
      sent.inactive30d++
    } else if (stats.completedRides >= 1 && daysSince >= inactive7dDays) {
      if (await alreadySent(stats.userId, "inactive_7d", cooldownDays)) continue
      await notifyFromTemplate({ userId: stats.userId, templateKey: "retention.inactive_7d", type: "promo" })
      await logSent(stats.userId, "inactive_7d")
      sent.inactive7d++
    } else if (stats.completedRides === 1 && daysSince >= secondRideDays) {
      if (await alreadySent(stats.userId, "second_ride_nudge")) continue
      await notifyFromTemplate({ userId: stats.userId, templateKey: "retention.second_ride_nudge", type: "promo" })
      await logSent(stats.userId, "second_ride_nudge")
      sent.secondRide++
    }
  }

  if (sent.secondRide || sent.inactive7d || sent.inactive30d) {
    logger.info("retention_sweep", sent)
  }
}
