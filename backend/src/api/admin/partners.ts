import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAdminRole } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"
import { writeAuditLog } from "../../shared/audit.js"
import { generatePartnerApiKey, revokePartnerApiKey } from "../../services/partnerApiKeyService.js"

/**
 * Partner program admin endpoints (Phase 5 §19) — see partnerService.ts
 * for code application and commission qualification, and the Partner/
 * PartnerReferral/PartnerPayout model comments in schema.prisma for the
 * design (external referrer, distinct from personal ReferralCode).
 */
export const adminPartnersRouter = Router()

const partnerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  contactName: z.string().trim().max(100).optional(),
  contactEmail: z.string().trim().email().optional(),
  contactPhone: z.string().trim().max(30).optional(),
  code: z.string().trim().min(3).max(20).transform((s) => s.toUpperCase()),
  type: z.enum(["individual", "business"]).default("individual"),
  commissionType: z.enum(["flat_per_referral", "pct_of_fare"]).default("flat_per_referral"),
  commissionValue: z.number().positive(),
})

adminPartnersRouter.get(
  "/partners",
  asyncHandler(async (req, res) => {
    const isActive = req.query.isActive as string | undefined
    const partners = await prisma.partner.findMany({
      where: isActive != null ? { isActive: isActive === "true" } : {},
      include: { _count: { select: { referrals: true } } },
      orderBy: { createdAt: "desc" },
    })
    res.json({ partners })
  }),
)

adminPartnersRouter.post(
  "/partners",
  requireAdminRole("super_admin", "marketing", "ops_manager"),
  validateBody(partnerSchema),
  asyncHandler(async (req, res) => {
    const partner = await prisma.partner.create({ data: { ...req.body, createdById: req.auth!.userId } })
    await writeAuditLog({ req, action: "partner.create", targetTable: "partners", targetId: partner.id, after: req.body })
    res.status(201).json({ partner })
  }),
)

adminPartnersRouter.patch(
  "/partners/:id",
  requireAdminRole("super_admin", "marketing", "ops_manager"),
  validateBody(
    z.object({
      isActive: z.boolean().optional(),
      commissionType: z.enum(["flat_per_referral", "pct_of_fare"]).optional(),
      commissionValue: z.number().positive().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const existing = await prisma.partner.findUnique({ where: { id: req.params.id } })
    if (!existing) throw ApiError.notFound("Partner not found.")
    const partner = await prisma.partner.update({ where: { id: req.params.id }, data: req.body })
    await writeAuditLog({ req, action: "partner.update", targetTable: "partners", targetId: partner.id, before: existing, after: req.body })
    res.json({ partner })
  }),
)

adminPartnersRouter.get(
  "/partners/:id",
  asyncHandler(async (req, res) => {
    const partner = await prisma.partner.findUnique({
      where: { id: req.params.id },
      include: {
        referrals: { include: { referredUser: { select: { fullName: true, phone: true, createdAt: true } } }, orderBy: { createdAt: "desc" } },
        payouts: { orderBy: { createdAt: "desc" } },
      },
    })
    if (!partner) throw ApiError.notFound("Partner not found.")
    res.json({ partner })
  }),
)

adminPartnersRouter.post(
  "/partners/:id/payouts",
  requireAdminRole("super_admin", "ops_manager", "finance"),
  validateBody(z.object({ amount: z.number().positive(), method: z.string().trim().min(1).max(50), note: z.string().trim().max(300).optional() })),
  asyncHandler(async (req, res) => {
    const partner = await prisma.partner.findUnique({ where: { id: req.params.id } })
    if (!partner) throw ApiError.notFound("Partner not found.")
    const owed = partner.totalEarned - partner.totalPaidOut
    if (req.body.amount > owed) {
      throw ApiError.badRequest("PAYOUT_EXCEEDS_OWED", `This partner is only owed ${owed}.`)
    }

    const [payout] = await prisma.$transaction([
      prisma.partnerPayout.create({ data: { partnerId: partner.id, amount: req.body.amount, method: req.body.method, note: req.body.note, paidById: req.auth!.userId } }),
      prisma.partner.update({ where: { id: partner.id }, data: { totalPaidOut: { increment: req.body.amount } } }),
    ])
    await writeAuditLog({ req, action: "partner.payout", targetTable: "partner_payouts", targetId: payout.id, after: req.body })
    res.status(201).json({ payout })
  }),
)

// ---------------------------------------------------------------------
// Scoped partner API platform (Phase 5 §20) — key lifecycle only; the
// API itself lives at /v1/partner-api (see api/partner/router.ts).
// ---------------------------------------------------------------------

adminPartnersRouter.post(
  "/partners/:id/api-key/generate",
  requireAdminRole("super_admin", "ops_manager"),
  asyncHandler(async (req, res) => {
    const { rawKey } = await generatePartnerApiKey(req.params.id)
    await writeAuditLog({ req, action: "partner.api_key_generate", targetTable: "partners", targetId: req.params.id })
    // The only time this key is ever returned — store it now, it can't be retrieved again.
    res.json({ apiKey: rawKey })
  }),
)

adminPartnersRouter.post(
  "/partners/:id/api-key/revoke",
  requireAdminRole("super_admin", "ops_manager"),
  asyncHandler(async (req, res) => {
    await revokePartnerApiKey(req.params.id)
    await writeAuditLog({ req, action: "partner.api_key_revoke", targetTable: "partners", targetId: req.params.id })
    res.status(204).send()
  }),
)
