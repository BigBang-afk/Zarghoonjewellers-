import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAuth } from "../../middleware/auth.js"
import { applyReferralCode } from "../../services/referralService.js"
import { NotificationType } from "../../types/enums.js"
import { ApiError } from "../../utils/apiError.js"
import { referralRateLimit } from "../../middleware/rateLimit.js"

/** Cross-role account endpoints (referrals, notification preferences) — Phase 2 §11 / §20. */
export const accountRouter = Router()
accountRouter.use(requireAuth)

accountRouter.get(
  "/referral",
  asyncHandler(async (req, res) => {
    const referralCode = await prisma.referralCode.findUnique({ where: { userId: req.auth!.userId } })
    const referralsMade = await prisma.referral.findMany({
      where: { referrerUserId: req.auth!.userId },
      include: { referred: { select: { fullName: true, createdAt: true } } },
      orderBy: { createdAt: "desc" },
    })
    const totalRewarded = referralsMade
      .filter((r) => r.status === "rewarded")
      .reduce((sum, r) => sum + (r.rewardAmountReferrer ?? 0), 0)

    res.json({
      code: referralCode?.code ?? null,
      referralsMade: referralsMade.map((r) => ({
        id: r.id,
        referredName: r.referred.fullName,
        status: r.status,
        rewardAmountReferrer: r.rewardAmountReferrer,
        createdAt: r.createdAt,
        rewardedAt: r.rewardedAt,
      })),
      totalRewardedRs: totalRewarded,
    })
  }),
)

accountRouter.post(
  "/referral/apply",
  referralRateLimit,
  validateBody(z.object({ code: z.string().trim().min(1).max(20) })),
  asyncHandler(async (req, res) => {
    await applyReferralCode(req.auth!.userId, req.body.code)
    res.status(201).json({ ok: true })
  }),
)

accountRouter.get(
  "/notification-preferences",
  asyncHandler(async (req, res) => {
    const rows = await prisma.notificationPreference.findMany({ where: { userId: req.auth!.userId } })
    const byType = new Map(rows.map((r) => [r.type, r.enabled]))
    const preferences = NotificationType.map((type) => ({
      type,
      enabled: byType.get(type) ?? true,
      locked: type === "safety" || type === "system",
    }))
    res.json({ preferences })
  }),
)

accountRouter.put(
  "/notification-preferences",
  validateBody(z.object({ type: z.enum(NotificationType), enabled: z.boolean() })),
  asyncHandler(async (req, res) => {
    if (req.body.type === "safety" || req.body.type === "system") {
      throw ApiError.badRequest("PREFERENCE_LOCKED", "Safety and account notifications can't be disabled.")
    }
    const pref = await prisma.notificationPreference.upsert({
      where: { userId_type: { userId: req.auth!.userId, type: req.body.type } },
      create: { userId: req.auth!.userId, type: req.body.type, enabled: req.body.enabled },
      update: { enabled: req.body.enabled },
    })
    res.json({ preference: pref })
  }),
)

// ---------------------------------------------------------------------
// Locale (Phase 4 §2) — "en"/"ur" ship with real translations today;
// any other BCP-47-ish code is accepted so a future language only needs
// dictionary + NotificationTemplate rows, never a backend code change.
// ---------------------------------------------------------------------

accountRouter.patch(
  "/locale",
  validateBody(z.object({ locale: z.string().trim().min(2).max(10) })),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({ where: { id: req.auth!.userId }, data: { locale: req.body.locale } })
    res.json({ locale: user.locale })
  }),
)

// ---------------------------------------------------------------------
// Data privacy (Phase 4 §26) — view account info, manage marketing
// consent, export your own data, request deletion. Nothing here touches
// financial or ride records — those are never deleted, only the User
// row's own PII is anonymized once an admin completes a request.
// ---------------------------------------------------------------------

accountRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.auth!.userId },
      select: {
        id: true, fullName: true, phone: true, email: true, photoUrl: true, role: true, status: true,
        locale: true, marketingOptIn: true, acquisitionSource: true, acquisitionCampaign: true,
        deletionRequestedAt: true, createdAt: true,
        primaryCity: { select: { name: true, currencyCode: true } },
      },
    })
    res.json({ account: user })
  }),
)

accountRouter.patch(
  "/marketing-consent",
  validateBody(z.object({ marketingOptIn: z.boolean() })),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({ where: { id: req.auth!.userId }, data: { marketingOptIn: req.body.marketingOptIn } })
    res.json({ marketingOptIn: user.marketingOptIn })
  }),
)

/**
 * A minimal self-service export of the account's own data — not every
 * table in the system, but the ones a user would reasonably ask for
 * ("what do you have on me"): profile, ride history, wallet activity,
 * ratings, support tickets. Large collections are capped rather than
 * unbounded, consistent with the rest of the API's pagination approach.
 */
accountRouter.get(
  "/export",
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId

    const [user, passenger, driver, wallet, transactions, ratingsGiven, ratingsReceived, supportTickets, notifications] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, fullName: true, phone: true, email: true, role: true, status: true, locale: true, marketingOptIn: true, createdAt: true },
      }),
      prisma.passengerProfile.findUnique({ where: { userId } }),
      prisma.driverProfile.findUnique({ where: { userId } }),
      prisma.wallet.findUnique({ where: { userId } }),
      prisma.transaction.findMany({ where: { wallet: { userId } }, orderBy: { createdAt: "desc" }, take: 500 }),
      prisma.rating.findMany({ where: { raterId: userId }, take: 500 }),
      prisma.rating.findMany({ where: { rateeId: userId }, take: 500 }),
      prisma.supportTicket.findMany({ where: { userId }, take: 200 }),
      prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 200 }),
    ])

    const rides = passenger
      ? await prisma.ride.findMany({ where: { passengerId: passenger.id }, include: { pickup: true, destination: true }, take: 500 })
      : driver
        ? await prisma.ride.findMany({ where: { driverId: driver.id }, include: { pickup: true, destination: true }, take: 500 })
        : []

    res.setHeader("Content-Disposition", "attachment; filename=rivo-account-data.json")
    res.json({
      exportedAt: new Date().toISOString(),
      account: user,
      passengerProfile: passenger,
      driverProfile: driver,
      wallet,
      transactions,
      ratingsGiven,
      ratingsReceived,
      rides,
      supportTickets,
      notifications,
    })
  }),
)

accountRouter.post(
  "/deletion-request",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } })
    if (user.deletedAt) throw ApiError.badRequest("ALREADY_DELETED", "This account has already been deleted.")
    if (user.deletionRequestedAt) throw ApiError.conflict("DELETION_ALREADY_REQUESTED", "A deletion request is already pending review.")
    const updated = await prisma.user.update({ where: { id: user.id }, data: { deletionRequestedAt: new Date() } })
    res.status(201).json({ deletionRequestedAt: updated.deletionRequestedAt })
  }),
)

accountRouter.delete(
  "/deletion-request",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } })
    if (!user.deletionRequestedAt) throw ApiError.notFound("No pending deletion request to cancel.")
    if (user.deletedAt) throw ApiError.badRequest("ALREADY_DELETED", "This account has already been processed for deletion.")
    await prisma.user.update({ where: { id: user.id }, data: { deletionRequestedAt: null } })
    res.status(204).send()
  }),
)
