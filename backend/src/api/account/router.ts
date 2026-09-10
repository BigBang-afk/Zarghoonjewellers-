import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAuth } from "../../middleware/auth.js"
import { applyReferralCode } from "../../services/referralService.js"
import { NotificationType } from "../../types/enums.js"
import { ApiError } from "../../utils/apiError.js"

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
