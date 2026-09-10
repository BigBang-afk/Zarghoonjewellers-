import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAdminRole } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"
import { writeAuditLog } from "../../shared/audit.js"
import { computeDriverFunnel } from "../../services/driverAcquisitionService.js"

/**
 * Driver acquisition campaigns + funnel dashboard (Phase 5 §4). Distinct
 * from /admin/incentive-campaigns (existing drivers, ride-volume rewards)
 * — this targets getting new drivers to apply in the first place.
 */
export const adminDriverAcquisitionRouter = Router()

const CAMPAIGN_STATUSES = ["draft", "active", "paused", "completed"] as const

const campaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, "Code may only contain letters, digits, hyphens, and underscores."),
  description: z.string().trim().max(1000).optional(),
  cityId: z.string().uuid().optional(),
  vehicleTypeId: z.string().uuid().optional(),
  targetDriverCount: z.number().int().positive(),
  incentiveAmount: z.number().positive().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  status: z.enum(CAMPAIGN_STATUSES).default("draft"),
})

adminDriverAcquisitionRouter.get(
  "/driver-acquisition/campaigns",
  asyncHandler(async (req, res) => {
    const { status, cityId } = req.query as Record<string, string>
    const campaigns = await prisma.driverAcquisitionCampaign.findMany({
      where: { ...(status ? { status } : {}), ...(cityId ? { cityId } : {}) },
      include: { city: { select: { name: true, currencyCode: true } }, vehicleType: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    })
    res.json({ campaigns })
  }),
)

adminDriverAcquisitionRouter.post(
  "/driver-acquisition/campaigns",
  requireAdminRole("super_admin", "marketing", "ops_manager"),
  validateBody(campaignSchema),
  asyncHandler(async (req, res) => {
    if (req.body.endDate <= req.body.startDate) {
      throw ApiError.badRequest("INVALID_DATE_RANGE", "endDate must be after startDate.")
    }
    const code = req.body.code.toUpperCase()
    const existing = await prisma.driverAcquisitionCampaign.findUnique({ where: { code } })
    if (existing) throw ApiError.conflict("CAMPAIGN_CODE_TAKEN", "A campaign with this code already exists.")

    const campaign = await prisma.driverAcquisitionCampaign.create({
      data: { ...req.body, code, createdById: req.auth!.userId },
    })
    await writeAuditLog({ req, action: "driver_acquisition_campaign.create", targetTable: "driver_acquisition_campaigns", targetId: campaign.id, after: req.body })
    res.status(201).json({ campaign })
  }),
)

adminDriverAcquisitionRouter.patch(
  "/driver-acquisition/campaigns/:id",
  requireAdminRole("super_admin", "marketing", "ops_manager"),
  validateBody(campaignSchema.partial().omit({ code: true })),
  asyncHandler(async (req, res) => {
    const before = await prisma.driverAcquisitionCampaign.findUnique({ where: { id: req.params.id } })
    if (!before) throw ApiError.notFound("Campaign not found.")
    if (req.body.startDate && req.body.endDate && req.body.endDate <= req.body.startDate) {
      throw ApiError.badRequest("INVALID_DATE_RANGE", "endDate must be after startDate.")
    }
    const campaign = await prisma.driverAcquisitionCampaign.update({ where: { id: req.params.id }, data: req.body })
    await writeAuditLog({ req, action: "driver_acquisition_campaign.update", targetTable: "driver_acquisition_campaigns", targetId: campaign.id, before, after: req.body })
    res.json({ campaign })
  }),
)

/** Platform-wide (or single-city) funnel — no campaign attribution filter. */
adminDriverAcquisitionRouter.get(
  "/driver-acquisition/funnel",
  asyncHandler(async (req, res) => {
    const { cityId } = req.query as Record<string, string>
    const stages = await computeDriverFunnel({ cityId })
    res.json({ stages })
  }),
)

/** Funnel scoped to drivers attributed to this specific campaign. */
adminDriverAcquisitionRouter.get(
  "/driver-acquisition/campaigns/:id/funnel",
  asyncHandler(async (req, res) => {
    const campaign = await prisma.driverAcquisitionCampaign.findUnique({ where: { id: req.params.id } })
    if (!campaign) throw ApiError.notFound("Campaign not found.")
    const stages = await computeDriverFunnel({ campaignCode: campaign.code, cityId: campaign.cityId ?? undefined })
    res.json({ campaign, stages })
  }),
)
