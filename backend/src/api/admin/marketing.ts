import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAdminRole } from "../../middleware/auth.js"
import { ApiError } from "../../utils/apiError.js"
import { writeAuditLog } from "../../shared/audit.js"
import { resolveCampaignAudience, sendMarketingCampaign } from "../../services/marketingCampaignService.js"

/**
 * Marketing CMS + waitlist admin endpoints (Phase 4 §18, §38). Content
 * items are read publicly (see api/public/router.ts) — this router is the
 * admin-only write side plus the waitlist roster.
 */
export const adminMarketingRouter = Router()

const CONTENT_TYPES = [
  "homepage_banner",
  "promotion_banner",
  "faq",
  "help_article",
  "announcement",
  "app_message",
  "city_launch_campaign",
] as const

const contentItemSchema = z.object({
  type: z.enum(CONTENT_TYPES),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  cityId: z.string().uuid().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
})

adminMarketingRouter.get(
  "/content",
  asyncHandler(async (req, res) => {
    const type = req.query.type as string | undefined
    const items = await prisma.contentItem.findMany({
      where: type ? { type } : {},
      include: { city: { select: { name: true } } },
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
    })
    res.json({ items })
  }),
)

adminMarketingRouter.post(
  "/content",
  requireAdminRole("super_admin", "marketing", "ops_manager"),
  validateBody(contentItemSchema),
  asyncHandler(async (req, res) => {
    const item = await prisma.contentItem.create({ data: { ...req.body, createdById: req.auth!.userId } })
    await writeAuditLog({ req, action: "content_item.create", targetTable: "content_items", targetId: item.id, after: req.body })
    res.status(201).json({ item })
  }),
)

adminMarketingRouter.put(
  "/content/:id",
  requireAdminRole("super_admin", "marketing", "ops_manager"),
  validateBody(contentItemSchema.partial()),
  asyncHandler(async (req, res) => {
    const before = await prisma.contentItem.findUnique({ where: { id: req.params.id } })
    if (!before) throw ApiError.notFound("Content item not found.")
    const item = await prisma.contentItem.update({ where: { id: req.params.id }, data: req.body })
    await writeAuditLog({ req, action: "content_item.update", targetTable: "content_items", targetId: item.id, before, after: req.body })
    res.json({ item })
  }),
)

adminMarketingRouter.delete(
  "/content/:id",
  requireAdminRole("super_admin", "marketing", "ops_manager"),
  asyncHandler(async (req, res) => {
    const before = await prisma.contentItem.findUnique({ where: { id: req.params.id } })
    if (!before) throw ApiError.notFound("Content item not found.")
    await prisma.contentItem.delete({ where: { id: req.params.id } })
    await writeAuditLog({ req, action: "content_item.delete", targetTable: "content_items", targetId: req.params.id, before })
    res.status(204).send()
  }),
)

// ---------------------------------------------------------------------
// Waitlist roster
// ---------------------------------------------------------------------

adminMarketingRouter.get(
  "/waitlist",
  asyncHandler(async (req, res) => {
    const cityName = req.query.cityName as string | undefined
    const userType = req.query.userType as string | undefined
    const where = { ...(cityName ? { cityName } : {}), ...(userType ? { userType } : {}) }
    const [entries, total] = await Promise.all([
      prisma.waitlistEntry.findMany({ where, orderBy: { createdAt: "desc" }, take: 1000 }),
      prisma.waitlistEntry.count({ where }),
    ])
    res.json({ entries, total })
  }),
)

adminMarketingRouter.get(
  "/waitlist/export",
  requireAdminRole("super_admin", "marketing", "ops_manager"),
  asyncHandler(async (_req, res) => {
    const entries = await prisma.waitlistEntry.findMany({ orderBy: { createdAt: "desc" } })
    const header = "fullName,contact,cityName,userType,marketingConsent,createdAt"
    // These three fields are attacker-controlled (submitted via the public
    // /public/waitlist form) — quote them and neutralize a leading
    // =/+/-/@, which some spreadsheet apps treat as a formula, to prevent
    // CSV/formula injection when an admin opens this export.
    const escape = (v: string) => `"${(/^[=+\-@]/.test(v) ? `\t${v}` : v).replace(/"/g, '""')}"`
    const rows = entries.map((e) =>
      [escape(e.fullName), escape(e.contact), escape(e.cityName), e.userType, e.marketingConsent, e.createdAt.toISOString()].join(","),
    )
    res.setHeader("Content-Type", "text/csv")
    res.setHeader("Content-Disposition", "attachment; filename=waitlist.csv")
    res.send([header, ...rows].join("\n"))
  }),
)

adminMarketingRouter.delete(
  "/waitlist/:id",
  requireAdminRole("super_admin", "marketing", "ops_manager"),
  asyncHandler(async (req, res) => {
    const entry = await prisma.waitlistEntry.findUnique({ where: { id: req.params.id } })
    if (!entry) throw ApiError.notFound("Waitlist entry not found.")
    await prisma.waitlistEntry.delete({ where: { id: req.params.id } })
    await writeAuditLog({ req, action: "waitlist_entry.delete", targetTable: "waitlist_entries", targetId: req.params.id, before: entry })
    res.status(204).send()
  }),
)

// ---------------------------------------------------------------------
// Marketing campaigns (Phase 5 §18)
// ---------------------------------------------------------------------

const campaignSegmentSchema = z.object({
  targetRole: z.enum(["passenger", "driver"]),
  cityId: z.string().uuid().optional(),
  minDaysSinceLastRide: z.number().int().positive().optional(),
  maxCompletedRides: z.number().int().min(0).optional(),
  acquisitionSource: z.string().trim().max(50).optional(),
})

const campaignCreateSchema = campaignSegmentSchema.extend({
  name: z.string().trim().min(2).max(100),
  title: z.string().trim().min(1).max(150),
  body: z.string().trim().min(1).max(1000),
  promoCode: z.string().trim().max(20).optional(),
  scheduledAt: z.coerce.date().optional(),
})

adminMarketingRouter.get(
  "/campaigns",
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined
    const campaigns = await prisma.marketingCampaign.findMany({
      where: status ? { status } : {},
      include: { city: { select: { name: true } }, createdBy: { select: { fullName: true } } },
      orderBy: { createdAt: "desc" },
    })
    res.json({ campaigns })
  }),
)

adminMarketingRouter.post(
  "/campaigns",
  requireAdminRole("super_admin", "marketing", "ops_manager"),
  validateBody(campaignCreateSchema),
  asyncHandler(async (req, res) => {
    const campaign = await prisma.marketingCampaign.create({
      data: {
        ...req.body,
        status: req.body.scheduledAt ? "scheduled" : "draft",
        createdById: req.auth!.userId,
      },
    })
    await writeAuditLog({ req, action: "marketing_campaign.create", targetTable: "marketing_campaigns", targetId: campaign.id, after: req.body })
    res.status(201).json({ campaign })
  }),
)

adminMarketingRouter.post(
  "/campaigns/preview-audience",
  requireAdminRole("super_admin", "marketing", "ops_manager"),
  validateBody(campaignSegmentSchema),
  asyncHandler(async (req, res) => {
    const audience = await resolveCampaignAudience(req.body)
    res.json({ recipientCount: audience.length })
  }),
)

adminMarketingRouter.post(
  "/campaigns/:id/send",
  requireAdminRole("super_admin", "marketing", "ops_manager"),
  asyncHandler(async (req, res) => {
    const result = await sendMarketingCampaign(req.params.id)
    const campaign = await prisma.marketingCampaign.findUniqueOrThrow({ where: { id: req.params.id } })
    await writeAuditLog({ req, action: "marketing_campaign.send", targetTable: "marketing_campaigns", targetId: campaign.id, after: result })
    res.json({ campaign })
  }),
)

adminMarketingRouter.post(
  "/campaigns/:id/cancel",
  requireAdminRole("super_admin", "marketing", "ops_manager"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.marketingCampaign.findUnique({ where: { id: req.params.id } })
    if (!existing) throw ApiError.notFound("Campaign not found.")
    if (existing.status === "sent") throw ApiError.conflict("ALREADY_SENT", "A sent campaign cannot be cancelled.")
    const campaign = await prisma.marketingCampaign.update({ where: { id: req.params.id }, data: { status: "cancelled" } })
    await writeAuditLog({ req, action: "marketing_campaign.cancel", targetTable: "marketing_campaigns", targetId: campaign.id, before: existing })
    res.json({ campaign })
  }),
)
