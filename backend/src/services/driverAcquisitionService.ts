import { prisma } from "../utils/prisma.js"
import { notify } from "./notifications/NotificationService.js"
import { addMoney } from "../utils/money.js"

/**
 * Driver acquisition campaigns (Phase 5 §4) — separate from
 * IncentiveCampaign, which rewards existing drivers for ride volume.
 * This targets the top of the driver funnel: getting people to apply.
 * Attribution reuses the acquisitionCampaign free-text field already
 * captured at registration (Phase 4 §22) — a campaign's `code` is what
 * a registration link is expected to pass. Funnel counts are always a
 * live query, never a cached counter that can drift from reality.
 */

export interface FunnelStage {
  stage: "applications" | "verification_pending" | "approved" | "online" | "first_ride" | "active"
  count: number
}

/**
 * "Active" here means completed at least one ride in the last 30 days —
 * distinct from "online" (currently accepting rides right now).
 */
export async function computeDriverFunnel(filter: { campaignCode?: string; cityId?: string }): Promise<FunnelStage[]> {
  const userWhere = {
    role: "driver" as const,
    ...(filter.campaignCode ? { acquisitionCampaign: filter.campaignCode } : {}),
  }
  const profileWhere = {
    ...(filter.cityId ? { cityId: filter.cityId } : {}),
    user: userWhere,
  }
  const activeSince = new Date(Date.now() - 30 * 86_400_000)

  const [applications, verificationPending, approved, online, firstRide, active] = await Promise.all([
    prisma.driverProfile.count({ where: profileWhere }),
    prisma.driverProfile.count({ where: { ...profileWhere, verificationStatus: { in: ["pending", "under_review"] } } }),
    prisma.driverProfile.count({ where: { ...profileWhere, verificationStatus: "approved" } }),
    prisma.driverProfile.count({ where: { ...profileWhere, verificationStatus: "approved", availabilityStatus: { in: ["online", "on_trip"] } } }),
    prisma.driverProfile.count({ where: { ...profileWhere, completedRides: { gt: 0 } } }),
    prisma.driverProfile.count({
      where: { ...profileWhere, rides: { some: { status: "ride_completed", completedAt: { gte: activeSince } } } },
    }),
  ])

  return [
    { stage: "applications", count: applications },
    { stage: "verification_pending", count: verificationPending },
    { stage: "approved", count: approved },
    { stage: "online", count: online },
    { stage: "first_ride", count: firstRide },
    { stage: "active", count: active },
  ]
}

/**
 * Called once a driver's documents are approved (api/admin/verification.ts).
 * Pays the campaign's signup bonus exactly once, guarded by the unique
 * (driverId, campaignId) constraint on DriverAcquisitionReward rather
 * than a check-then-act race.
 */
export async function awardAcquisitionBonusIfEligible(driverId: string): Promise<void> {
  const driver = await prisma.driverProfile.findUnique({ where: { id: driverId }, include: { user: true, city: true } })
  if (!driver || !driver.user.acquisitionCampaign) return

  const campaign = await prisma.driverAcquisitionCampaign.findUnique({ where: { code: driver.user.acquisitionCampaign } })
  if (!campaign || campaign.status !== "active" || campaign.incentiveAmount == null) return
  if (campaign.cityId && campaign.cityId !== driver.cityId) return
  const now = new Date()
  if (campaign.startDate > now || campaign.endDate < now) return

  try {
    await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId: driver.userId },
        create: { userId: driver.userId, balance: 0, currencyCode: driver.city.currencyCode },
        update: {},
      })
      const newBalance = addMoney(wallet.balance, campaign.incentiveAmount!, wallet.currencyCode)
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } })
      const transaction = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: "acquisition_bonus",
          amount: campaign.incentiveAmount!,
          balanceAfter: newBalance,
          currencyCode: wallet.currencyCode,
          description: `Signup bonus: ${campaign.name}`,
        },
      })
      // The unique constraint on (driverId, campaignId) is what actually
      // prevents a double-pay if this is ever called twice — this create
      // throwing on a duplicate is the guard, not a prior findUnique check.
      await tx.driverAcquisitionReward.create({
        data: { driverId, campaignId: campaign.id, amount: campaign.incentiveAmount!, currencyCode: wallet.currencyCode, transactionId: transaction.id },
      })
    })
  } catch (err: unknown) {
    // Unique-constraint violation = already rewarded (e.g. re-verification flow); anything else, surface it.
    const code = (err as { code?: string } | null)?.code
    if (code !== "P2002") throw err
    return
  }

  await notify({
    userId: driver.userId,
    type: "promo",
    title: "Signup bonus earned!",
    body: `You've earned a bonus for joining through the "${campaign.name}" campaign.`,
    external: true,
    toPhone: driver.user.phone,
  })
}
