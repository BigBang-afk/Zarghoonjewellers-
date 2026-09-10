import { prisma } from "../utils/prisma.js"
import { notify } from "./notifications/NotificationService.js"
import { addMoney } from "../utils/money.js"

/**
 * Driver incentives (Phase 2 §8) — campaigns, targets, and reward amounts
 * all live in `IncentiveCampaign` rows an admin creates; nothing here is
 * a hard-coded bonus. Called once per completed ride; every active
 * campaign matching the driver's city/vehicle-type gets its progress
 * incremented, and a reward is issued automatically the moment a target
 * is reached.
 */
export async function recordDriverRideForIncentives(driverId: string, cityId: string, vehicleTypeId: string): Promise<void> {
  const now = new Date()
  const campaigns = await prisma.incentiveCampaign.findMany({
    where: {
      status: "active",
      startDate: { lte: now },
      endDate: { gte: now },
      OR: [{ cityId: null }, { cityId }],
      AND: [{ OR: [{ vehicleTypeId: null }, { vehicleTypeId }] }],
    },
  })

  for (const campaign of campaigns) {
    const progress = await prisma.driverIncentiveProgress.upsert({
      where: { driverId_campaignId: { driverId, campaignId: campaign.id } },
      create: { driverId, campaignId: campaign.id, currentCount: 1 },
      update: { currentCount: { increment: 1 } },
    })

    if (progress.status === "in_progress" && progress.currentCount >= campaign.targetRideCount) {
      await awardIncentive(driverId, campaign.id, campaign.rewardAmount)
    }
  }
}

async function awardIncentive(driverId: string, campaignId: string, amount: number): Promise<void> {
  const driver = await prisma.driverProfile.findUniqueOrThrow({ where: { id: driverId }, include: { user: true, city: true } })

  await prisma.$transaction(async (tx) => {
    await tx.driverIncentiveProgress.update({
      where: { driverId_campaignId: { driverId, campaignId } },
      data: { status: "rewarded" },
    })

    const wallet = await tx.wallet.upsert({
      where: { userId: driver.userId },
      create: { userId: driver.userId, balance: 0, currencyCode: driver.city.currencyCode },
      update: {},
    })
    const newBalance = addMoney(wallet.balance, amount, wallet.currencyCode)
    await tx.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } })
    const transaction = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: "incentive_bonus",
        amount,
        balanceAfter: newBalance,
        currencyCode: wallet.currencyCode,
        description: `Incentive campaign reward`,
      },
    })
    await tx.incentiveReward.create({ data: { driverId, campaignId, amount, transactionId: transaction.id } })
  })

  await notify({
    userId: driver.userId,
    type: "promo",
    title: "Incentive bonus earned!",
    body: `You've earned a Rs ${amount} bonus for completing your target rides.`,
    external: true,
    toPhone: driver.user.phone,
  })
}

export async function getDriverIncentiveSummary(driverId: string) {
  const now = new Date()
  const progress = await prisma.driverIncentiveProgress.findMany({
    where: { campaign: { status: "active", startDate: { lte: now }, endDate: { gte: now } } },
    include: { campaign: true },
  })
  const rewards = await prisma.incentiveReward.findMany({ where: { driverId }, orderBy: { awardedAt: "desc" }, take: 20 })
  return { activeProgress: progress.filter((p) => p.driverId === driverId), recentRewards: rewards }
}
