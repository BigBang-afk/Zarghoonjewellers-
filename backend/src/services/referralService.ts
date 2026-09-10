import { randomInt } from "node:crypto"
import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"
import { getSetting } from "../config/settings.js"
import { notify } from "./notifications/NotificationService.js"
import { recordRiskEvent } from "./riskService.js"
import { resolveUserCurrency } from "../shared/currency.js"
import { addMoney, formatMoney } from "../utils/money.js"

function codeFromName(fullName: string): string {
  const base = fullName.replace(/[^a-zA-Z]/g, "").slice(0, 6).toUpperCase() || "RIVO"
  const suffix = randomInt(1000, 9999)
  return `${base}${suffix}`
}

/** Generates a unique referral code for a newly registered user (passenger or driver). */
export async function createReferralCodeForUser(userId: string, fullName: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = codeFromName(fullName)
    const exists = await prisma.referralCode.findUnique({ where: { code } })
    if (!exists) {
      await prisma.referralCode.create({ data: { userId, code } })
      return code
    }
  }
  // Extremely unlikely fallback — fully random code.
  const code = `RIVO${randomInt(100000, 999999)}`
  await prisma.referralCode.create({ data: { userId, code } })
  return code
}

/**
 * Applies a referral code at registration time. Guards against the two
 * abuse patterns Phase 2 §11 calls out: self-referral (same account) and
 * a duplicate referral for the same referred user — the latter enforced
 * by the DB unique constraint on `referredUserId`, not just this check.
 */
export async function applyReferralCode(referredUserId: string, code: string): Promise<void> {
  const referralCode = await prisma.referralCode.findUnique({ where: { code: code.trim().toUpperCase() } })
  if (!referralCode) throw ApiError.badRequest("REFERRAL_CODE_NOT_FOUND", "This referral code doesn't exist.")
  if (referralCode.userId === referredUserId) throw ApiError.badRequest("SELF_REFERRAL", "You can't refer yourself.")

  const referrer = await prisma.user.findUniqueOrThrow({ where: { id: referralCode.userId } })
  const referred = await prisma.user.findUniqueOrThrow({ where: { id: referredUserId } })
  // Same phone/email would mean the same person re-registering — block it
  // as a duplicate-account referral rather than rewarding it.
  if (referrer.phone === referred.phone || (referrer.email && referrer.email === referred.email)) {
    await recordRiskEvent(referredUserId, "shared_identifier", "medium", { referrerUserId: referrer.id, matchedOn: referrer.phone === referred.phone ? "phone" : "email" })
    throw ApiError.badRequest("SELF_REFERRAL", "You can't refer yourself.")
  }

  const existing = await prisma.referral.findUnique({ where: { referredUserId } })
  if (existing) throw ApiError.conflict("REFERRAL_ALREADY_APPLIED", "A referral code was already applied to this account.")

  await prisma.referral.create({
    data: { referrerUserId: referralCode.userId, referredUserId, code: referralCode.code, status: "pending" },
  })
}

/**
 * Called after any ride completes for the *referred* user — a passenger
 * completing a ride they took, or a driver completing a ride they gave.
 * Rewards are only issued once the configurable qualifying action (N
 * completed rides, default 1) is actually met — never at signup. Role-
 * agnostic: applyReferralCode() already works for either a passenger or
 * a driver referring another passenger or driver, so qualification must
 * too, or a driver-referring-driver referral could be created but could
 * never actually pay out.
 */
export async function qualifyReferralOnFirstRide(referredUserId: string): Promise<void> {
  const referral = await prisma.referral.findUnique({ where: { referredUserId } })
  if (!referral || referral.status !== "pending") return

  const [passenger, driver] = await Promise.all([
    prisma.passengerProfile.findUnique({ where: { userId: referredUserId } }),
    prisma.driverProfile.findUnique({ where: { userId: referredUserId } }),
  ])
  const completedRides = passenger?.completedRides ?? driver?.completedRides
  if (completedRides == null) return

  const qualifyingRideCount = await getSetting("referral.qualifyingRideCount")
  if (completedRides < qualifyingRideCount) return

  const [rewardReferrer, rewardReferred] = await Promise.all([
    getSetting("referral.rewardAmountReferrer"),
    getSetting("referral.rewardAmountReferred"),
  ])

  const [referrerUser, referredUser] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: referral.referrerUserId } }),
    prisma.user.findUniqueOrThrow({ where: { id: referredUserId } }),
  ])
  const currencyByUser = new Map([
    [referral.referrerUserId, await resolveUserCurrency(referral.referrerUserId)],
    [referredUserId, await resolveUserCurrency(referredUserId)],
  ])

  await prisma.$transaction(async (tx) => {
    await tx.referral.update({
      where: { id: referral.id },
      data: {
        status: "rewarded",
        qualifyingAction: "first_ride_completed",
        qualifiedAt: new Date(),
        rewardedAt: new Date(),
        rewardAmountReferrer: rewardReferrer,
        rewardAmountReferred: rewardReferred,
      },
    })

    for (const [userId, amount] of [
      [referral.referrerUserId, rewardReferrer],
      [referredUserId, rewardReferred],
    ] as const) {
      const wallet = await tx.wallet.upsert({
        where: { userId },
        create: { userId, balance: 0, currencyCode: currencyByUser.get(userId)! },
        update: {},
      })
      const newBalance = addMoney(wallet.balance, amount, wallet.currencyCode)
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } })
      await tx.transaction.create({
        data: { walletId: wallet.id, type: "referral_reward", amount, balanceAfter: newBalance, currencyCode: wallet.currencyCode, description: "Referral reward" },
      })
    }
  })

  await Promise.all([
    notify({
      userId: referrerUser.id,
      type: "promo",
      title: "Referral reward!",
      body: `${formatMoney(rewardReferrer, currencyByUser.get(referral.referrerUserId)!)} added to your wallet — your referral completed their first ride.`,
    }),
    notify({
      userId: referredUser.id,
      type: "promo",
      title: "Referral bonus!",
      body: `${formatMoney(rewardReferred, currencyByUser.get(referredUserId)!)} added to your wallet for completing your first ride.`,
    }),
  ])
}
