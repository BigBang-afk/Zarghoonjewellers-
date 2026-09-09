import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { ApiError } from "../../utils/apiError.js"
import { writeAuditLog } from "../../shared/audit.js"
import { getAllSettings, setSetting, SETTINGS_DEFAULTS, type PlatformSettingsShape } from "../../config/settings.js"

export const adminConfigRouter = Router()

// ---------------------------------------------------------------------
// Cities & service zones
// ---------------------------------------------------------------------

adminConfigRouter.get(
  "/cities",
  asyncHandler(async (_req, res) => {
    const cities = await prisma.city.findMany({
      include: { country: true, _count: { select: { driverProfiles: true, serviceZones: true } } },
      orderBy: { name: "asc" },
    })
    res.json({ cities })
  }),
)

adminConfigRouter.post(
  "/cities",
  validateBody(
    z.object({
      countryId: z.string().uuid(),
      name: z.string().trim().min(1).max(60),
      status: z.enum(["planned", "launching", "live", "paused"]).default("planned"),
      currencyCode: z.string().length(3),
      timezone: z.string().min(1),
      centerLat: z.number().optional(),
      centerLng: z.number().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const city = await prisma.city.create({ data: req.body })
    await writeAuditLog({ req, action: "city.create", targetTable: "cities", targetId: city.id, after: req.body })
    res.status(201).json({ city })
  }),
)

adminConfigRouter.patch(
  "/cities/:id",
  validateBody(
    z.object({
      status: z.enum(["planned", "launching", "live", "paused"]).optional(),
      name: z.string().trim().min(1).max(60).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const before = await prisma.city.findUnique({ where: { id: req.params.id } })
    if (!before) throw ApiError.notFound("City not found.")
    const city = await prisma.city.update({ where: { id: req.params.id }, data: req.body })
    await writeAuditLog({ req, action: "city.update", targetTable: "cities", targetId: city.id, before, after: req.body })
    res.json({ city })
  }),
)

adminConfigRouter.get(
  "/service-zones",
  asyncHandler(async (req, res) => {
    const cityId = req.query.cityId as string | undefined
    const zones = await prisma.serviceZone.findMany({ where: cityId ? { cityId } : {}, orderBy: { name: "asc" } })
    res.json({ zones })
  }),
)

adminConfigRouter.post(
  "/service-zones",
  validateBody(z.object({ cityId: z.string().uuid(), name: z.string().trim().min(1).max(60), boundaryGeoJson: z.string() })),
  asyncHandler(async (req, res) => {
    const zone = await prisma.serviceZone.create({ data: req.body })
    await writeAuditLog({ req, action: "service_zone.create", targetTable: "service_zones", targetId: zone.id, after: req.body })
    res.status(201).json({ zone })
  }),
)

// ---------------------------------------------------------------------
// Pricing (Fare Engine configuration — Phase 2 §17/§4 enforcement point)
// ---------------------------------------------------------------------

const fareRuleSchema = z.object({
  cityId: z.string().uuid(),
  zoneId: z.string().uuid().optional(),
  vehicleTypeId: z.string().uuid(),
  baseFare: z.number().positive(),
  perKmRate: z.number().positive(),
  perMinRate: z.number().positive(),
  minimumFare: z.number().positive(),
  maximumFare: z.number().positive().optional(),
  commissionRate: z.number().min(0).max(1),
  surgeMinMultiplier: z.number().min(1).default(1),
  surgeMaxMultiplier: z.number().min(1).default(2.5),
})

adminConfigRouter.get(
  "/pricing/fare-rules",
  asyncHandler(async (req, res) => {
    const cityId = req.query.cityId as string | undefined
    const rules = await prisma.fareRule.findMany({
      where: { ...(cityId ? { cityId } : {}), isActive: true },
      include: { city: true, vehicleType: true, zone: true },
      orderBy: [{ cityId: "asc" }, { vehicleTypeId: "asc" }],
    })
    res.json({ fareRules: rules })
  }),
)

adminConfigRouter.post(
  "/pricing/fare-rules",
  validateBody(fareRuleSchema),
  asyncHandler(async (req, res) => {
    const rule = await prisma.fareRule.create({ data: { ...req.body, createdById: req.auth!.userId } })
    await writeAuditLog({ req, action: "fare_rule.create", targetTable: "fare_rules", targetId: rule.id, after: req.body })
    res.status(201).json({ fareRule: rule })
  }),
)

adminConfigRouter.put(
  "/pricing/fare-rules/:id",
  validateBody(fareRuleSchema.partial()),
  asyncHandler(async (req, res) => {
    const before = await prisma.fareRule.findUnique({ where: { id: req.params.id } })
    if (!before) throw ApiError.notFound("Fare rule not found.")
    const rule = await prisma.fareRule.update({ where: { id: req.params.id }, data: req.body })
    await writeAuditLog({ req, action: "fare_rule.update", targetTable: "fare_rules", targetId: rule.id, before, after: req.body })
    res.json({ fareRule: rule })
  }),
)

// ---------------------------------------------------------------------
// Platform settings (matching radius, offer expiry, etc.)
// ---------------------------------------------------------------------

adminConfigRouter.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    const settings = await getAllSettings()
    res.json({ settings, defaults: SETTINGS_DEFAULTS })
  }),
)

adminConfigRouter.put(
  "/settings/:key",
  validateBody(z.object({ value: z.union([z.number(), z.array(z.number())]), description: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const key = req.params.key as keyof PlatformSettingsShape
    if (!(key in SETTINGS_DEFAULTS)) throw ApiError.badRequest("UNKNOWN_SETTING", `Unknown setting key "${key}".`)
    await setSetting(key, req.body.value, req.body.description)
    await writeAuditLog({ req, action: "settings.update", targetTable: "platform_settings", targetId: key, after: req.body })
    const settings = await getAllSettings()
    res.json({ settings })
  }),
)
