import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"
import { getSetting } from "../config/settings.js"
import { roundMoney } from "../utils/money.js"
import { resolveUserCurrency } from "../shared/currency.js"

/**
 * Phase 5 §19 — partner program. An external referrer (a business or
 * individual, not necessarily a RIVO user) with a tracked code, distinct
 * from the passenger/driver personal ReferralCode system in
 * referralService.ts. Registration tries a personal referral code first;
 * this is the fallback when that lookup misses (see auth/router.ts).
 */
export async function applyPartnerCode(referredUserId: string, code: string): Promise<void> {
  const partner = await prisma.partner.findUnique({ where: { code: code.trim().toUpperCase() } })
  if (!partner) throw ApiError.badRequest("PARTNER_CODE_NOT_FOUND", "This code doesn't exist.")
  if (!partner.isActive) throw ApiError.badRequest("PARTNER_INACTIVE", "This partner code is no longer active.")

  const existingReferral = await prisma.referral.findUnique({ where: { referredUserId } })
  if (existingReferral) throw ApiError.conflict("REFERRAL_ALREADY_APPLIED", "A code was already applied to this account.")
  const existingPartnerReferral = await prisma.partnerReferral.findUnique({ where: { referredUserId } })
  if (existingPartnerReferral) throw ApiError.conflict("REFERRAL_ALREADY_APPLIED", "A code was already applied to this account.")

  await prisma.partnerReferral.create({ data: { partnerId: partner.id, referredUserId, status: "pending" } })
}

/**
 * Qualifies a partner referral on the referred user's first qualifying
 * ride (same trigger point and qualifying-ride threshold as the personal
 * referral program, via rideLifecycleService.ts's post-completion hook).
 * Commission is a flat amount or a percentage of that first qualifying
 * ride's fare — computed once, at qualification, never recomputed later.
 */
export async function qualifyPartnerReferralOnFirstRide(referredUserId: string): Promise<void> {
  const partnerReferral = await prisma.partnerReferral.findUnique({ where: { referredUserId }, include: { partner: true } })
  if (!partnerReferral || partnerReferral.status !== "pending") return

  const [passenger, driver] = await Promise.all([
    prisma.passengerProfile.findUnique({ where: { userId: referredUserId } }),
    prisma.driverProfile.findUnique({ where: { userId: referredUserId } }),
  ])
  const completedRides = passenger?.completedRides ?? driver?.completedRides
  if (completedRides == null) return

  const qualifyingRideCount = await getSetting("referral.qualifyingRideCount")
  if (completedRides < qualifyingRideCount) return

  const partner = partnerReferral.partner
  let commissionEarned = partner.commissionValue

  if (partner.commissionType === "pct_of_fare") {
    const ride = await prisma.ride.findFirst({
      where: passenger ? { passengerId: passenger.id, status: "ride_completed" } : { driverId: driver!.id, status: "ride_completed" },
      orderBy: { completedAt: "asc" },
    })
    const fare = ride ? (ride.finalFare ?? ride.agreedFare) : 0
    const currencyCode = await resolveUserCurrency(referredUserId)
    commissionEarned = roundMoney(fare * (partner.commissionValue / 100), currencyCode)
  }

  // Known limitation: Partner.totalEarned is a single running total with
  // no currency field of its own — for a flat_per_referral partner this
  // is exactly the configured value regardless of the referred user's
  // city, and for pct_of_fare it's whatever currency that ride happened
  // to be in. Fine for a single-currency pilot; a multi-currency partner
  // ledger would need a per-currency balance, not built here.
  await prisma.$transaction([
    prisma.partnerReferral.update({ where: { id: partnerReferral.id }, data: { status: "qualified", qualifiedAt: new Date(), commissionEarned } }),
    prisma.partner.update({ where: { id: partner.id }, data: { totalEarned: { increment: commissionEarned } } }),
  ])
}
