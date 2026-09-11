import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"
import { notify } from "./notifications/NotificationService.js"

/**
 * Phase 5 §18 — admin-authored marketing campaigns, distinct from the
 * static Marketing CMS (ContentItem, read-only display copy) and from
 * retentionService.ts's automated lifecycle nudges (triggered by ride
 * events, not admin-composed). A campaign is composed once, targets a
 * segment, and is sent on demand — delivery reuses notify() rather than
 * a parallel send pipeline, and NEVER reaches a user with
 * marketingOptIn=false, enforced here regardless of segment criteria.
 */
export interface CampaignSegment {
  targetRole: "passenger" | "driver"
  cityId?: string | null
  minDaysSinceLastRide?: number | null
  maxCompletedRides?: number | null
  acquisitionSource?: string | null
}

/** Resolves the audience for a segment into userIds — a pure read, safe to call for a dry-run preview before sending. */
export async function resolveCampaignAudience(segment: CampaignSegment): Promise<string[]> {
  const userWhere = {
    marketingOptIn: true,
    status: "active" as const,
    ...(segment.cityId ? { primaryCityId: segment.cityId } : {}),
    ...(segment.acquisitionSource ? { acquisitionSource: segment.acquisitionSource } : {}),
  }

  if (segment.targetRole === "passenger") {
    const passengers = await prisma.passengerProfile.findMany({
      where: {
        ...(segment.maxCompletedRides != null ? { completedRides: { lte: segment.maxCompletedRides } } : {}),
        user: userWhere,
      },
      select: { id: true, userId: true, completedRides: true },
    })
    return filterByInactivity(passengers, "passengerId", segment.minDaysSinceLastRide)
  }

  const drivers = await prisma.driverProfile.findMany({
    where: {
      deletedAt: null,
      ...(segment.maxCompletedRides != null ? { completedRides: { lte: segment.maxCompletedRides } } : {}),
      user: userWhere,
    },
    select: { id: true, userId: true, completedRides: true },
  })
  return filterByInactivity(drivers, "driverId", segment.minDaysSinceLastRide)
}

async function filterByInactivity(
  profiles: { id: string; userId: string; completedRides: number }[],
  rideFkField: "passengerId" | "driverId",
  minDaysSinceLastRide: number | null | undefined,
): Promise<string[]> {
  if (!minDaysSinceLastRide) return profiles.map((p) => p.userId)

  const withRides = profiles.filter((p) => p.completedRides > 0)
  if (withRides.length === 0) return []

  const grouped = await prisma.ride.groupBy({
    by: [rideFkField],
    where: { status: "ride_completed", [rideFkField]: { in: withRides.map((p) => p.id) } },
    _max: { completedAt: true },
  })
  const lastRideByProfileId = new Map(grouped.map((g) => [g[rideFkField] as string, g._max.completedAt]))
  const cutoff = new Date(Date.now() - minDaysSinceLastRide * 86_400_000)

  return withRides.filter((p) => { const last = lastRideByProfileId.get(p.id); return last != null && last <= cutoff }).map((p) => p.userId)
}

/**
 * Sends a draft/scheduled campaign now — resolves the audience fresh
 * (never off a stale preview count) and notifies each recipient. A
 * campaign can only be sent once; re-sending means creating a new one.
 */
export async function sendMarketingCampaign(campaignId: string): Promise<{ recipientCount: number }> {
  const campaign = await prisma.marketingCampaign.findUnique({ where: { id: campaignId } })
  if (!campaign) throw ApiError.notFound("Campaign not found.")
  if (campaign.status === "sent") throw ApiError.conflict("ALREADY_SENT", "This campaign has already been sent.")
  if (campaign.status === "cancelled") throw ApiError.conflict("CAMPAIGN_CANCELLED", "This campaign was cancelled.")

  const recipientUserIds = await resolveCampaignAudience({
    targetRole: campaign.targetRole as "passenger" | "driver",
    cityId: campaign.cityId,
    minDaysSinceLastRide: campaign.minDaysSinceLastRide,
    maxCompletedRides: campaign.maxCompletedRides,
    acquisitionSource: campaign.acquisitionSource,
  })

  for (const userId of recipientUserIds) {
    await notify({
      userId,
      type: "promo",
      title: campaign.title,
      body: campaign.body,
      data: { campaignId: campaign.id, promoCode: campaign.promoCode ?? undefined },
    }).catch(() => {})
  }

  await prisma.marketingCampaign.update({
    where: { id: campaign.id },
    data: { status: "sent", sentAt: new Date(), recipientCount: recipientUserIds.length },
  })

  return { recipientCount: recipientUserIds.length }
}

/** Sweep (registered in jobs/index.ts) — sends any "scheduled" campaign whose scheduledAt has passed. */
export async function dispatchDueMarketingCampaigns(): Promise<void> {
  const due = await prisma.marketingCampaign.findMany({
    where: { status: "scheduled", scheduledAt: { lte: new Date() } },
    select: { id: true },
  })
  for (const campaign of due) {
    await sendMarketingCampaign(campaign.id).catch(() => {})
  }
}
