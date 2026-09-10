import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"
import { recordRiskEvent } from "./riskService.js"
import { multiplyMoney, roundMoney } from "../utils/money.js"

export interface PromoValidationResult {
  promotionId: string
  discountAmount: number
}

/**
 * Validates a promo code against every configured rule (Phase 2 §10) and
 * computes the discount for this specific fare — never applies a promo
 * silently or without the fare it was checked against. Abuse prevention:
 * one redemption per (promotion, user) enforced by a DB unique
 * constraint on `promo_redemptions`, not just this check (so a race
 * between two simultaneous requests can't double-redeem).
 */
export async function validatePromoCode(params: {
  code: string
  userId: string
  passengerCompletedRides: number
  cityId: string
  vehicleTypeId: string
  fareAmount: number
}): Promise<PromoValidationResult> {
  const promo = await prisma.promotion.findUnique({ where: { code: params.code.trim().toUpperCase() } })
  if (!promo) throw ApiError.badRequest("PROMO_NOT_FOUND", "This promo code doesn't exist.")
  if (!promo.isActive) throw ApiError.badRequest("PROMO_INACTIVE", "This promo code is no longer active.")

  const now = new Date()
  if (promo.startsAt > now) throw ApiError.badRequest("PROMO_NOT_STARTED", "This promo code isn't active yet.")
  if (promo.expiresAt && promo.expiresAt < now) throw ApiError.badRequest("PROMO_EXPIRED", "This promo code has expired.")
  if (promo.cityId && promo.cityId !== params.cityId) throw ApiError.badRequest("PROMO_WRONG_CITY", "This promo code isn't valid in your city.")
  if (promo.vehicleTypeId && promo.vehicleTypeId !== params.vehicleTypeId) {
    throw ApiError.badRequest("PROMO_WRONG_VEHICLE", "This promo code doesn't apply to this vehicle type.")
  }
  if (promo.minFare != null && params.fareAmount < promo.minFare) {
    throw ApiError.badRequest("PROMO_MIN_FARE", `This promo code requires a fare of at least Rs ${promo.minFare}.`)
  }
  if (promo.newUsersOnly && params.passengerCompletedRides > 0) {
    throw ApiError.badRequest("PROMO_NEW_USERS_ONLY", "This promo code is only valid for a passenger's first ride.")
  }
  if (promo.usageLimit != null && promo.usageCount >= promo.usageLimit) {
    throw ApiError.badRequest("PROMO_USAGE_LIMIT", "This promo code has reached its usage limit.")
  }

  const alreadyRedeemed = await prisma.promoRedemption.findUnique({
    where: { promotionId_userId: { promotionId: promo.id, userId: params.userId } },
  })
  if (alreadyRedeemed) {
    await recordRiskEvent(params.userId, "promo_abuse", "low", { promoCode: params.code, promotionId: promo.id })
    throw ApiError.conflict("PROMO_ALREADY_USED", "You've already used this promo code.")
  }

  const city = await prisma.city.findUniqueOrThrow({ where: { id: params.cityId }, select: { currencyCode: true } })

  let discountAmount =
    promo.discountType === "percentage"
      ? multiplyMoney(params.fareAmount, promo.discountValue / 100, city.currencyCode)
      : promo.discountValue
  if (promo.maxDiscount != null) discountAmount = Math.min(discountAmount, promo.maxDiscount)
  discountAmount = Math.min(discountAmount, params.fareAmount) // never discount below zero
  discountAmount = roundMoney(discountAmount, city.currencyCode)

  return { promotionId: promo.id, discountAmount }
}

/**
 * Records the redemption (incrementing usageCount) — called once the ride
 * request is actually created, not at validation time, so a passenger who
 * validates but never books doesn't burn their one-time use.
 */
export async function recordPromoRedemption(params: { promotionId: string; userId: string; discountAmount: number }) {
  await prisma.$transaction([
    prisma.promoRedemption.create({
      data: { promotionId: params.promotionId, userId: params.userId, discountAmount: params.discountAmount },
    }),
    prisma.promotion.update({ where: { id: params.promotionId }, data: { usageCount: { increment: 1 } } }),
  ])
}
