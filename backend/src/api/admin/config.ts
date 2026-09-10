import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAdminRole } from "../../middleware/auth.js"
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
  requireAdminRole("super_admin", "ops_manager"),
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
  requireAdminRole("super_admin", "ops_manager"),
  validateBody(
    z.object({
      status: z.enum(["planned", "launching", "live", "paused"]).optional(),
      name: z.string().trim().min(1).max(60).optional(),
      /** JSON-encoded weekly schedule, e.g. {"mon":["00:00","23:59"],...}; omit/null = 24/7 */
      operatingHours: z.string().nullable().optional(),
      /** Admin-configurable per city (Phase 4 §1) — array of allowed payment method codes */
      paymentMethods: z.array(z.enum(["cash", "card", "wallet", "local_provider"])).nullable().optional(),
      /** Admin-configurable per city (Phase 4 §16) — jurisdiction-specific driver requirements, never hard-coded */
      driverRequirements: z
        .object({
          minAge: z.number().int().positive().optional(),
          minLicenseYears: z.number().int().min(0).optional(),
          requiredDocs: z.array(z.string()).optional(),
        })
        .nullable()
        .optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const before = await prisma.city.findUnique({ where: { id: req.params.id } })
    if (!before) throw ApiError.notFound("City not found.")
    const { paymentMethods, driverRequirements, ...rest } = req.body
    const city = await prisma.city.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(paymentMethods !== undefined ? { paymentMethods: paymentMethods ? JSON.stringify(paymentMethods) : null } : {}),
        ...(driverRequirements !== undefined ? { driverRequirements: driverRequirements ? JSON.stringify(driverRequirements) : null } : {}),
      },
    })
    await writeAuditLog({ req, action: "city.update", targetTable: "cities", targetId: city.id, before, after: req.body })
    res.json({ city })
  }),
)

// ---------------------------------------------------------------------
// Vehicle categories — never hard-code one city's vehicle mix; each
// city opts a vehicle type in/out via CityVehicleType.
// ---------------------------------------------------------------------

adminConfigRouter.get(
  "/vehicle-types",
  asyncHandler(async (_req, res) => {
    const vehicleTypes = await prisma.vehicleType.findMany({ orderBy: { sortOrder: "asc" } })
    res.json({ vehicleTypes })
  }),
)

adminConfigRouter.post(
  "/vehicle-types",
  requireAdminRole("super_admin", "ops_manager"),
  validateBody(
    z.object({
      code: z.string().trim().min(1).max(30),
      name: z.string().trim().min(1).max(60),
      capacity: z.number().int().positive().default(4),
      sortOrder: z.number().int().default(0),
    }),
  ),
  asyncHandler(async (req, res) => {
    const existing = await prisma.vehicleType.findUnique({ where: { code: req.body.code } })
    if (existing) throw ApiError.conflict("VEHICLE_TYPE_EXISTS", "A vehicle type with this code already exists.")
    const vehicleType = await prisma.vehicleType.create({ data: req.body })
    await writeAuditLog({ req, action: "vehicle_type.create", targetTable: "vehicle_types", targetId: vehicleType.id, after: req.body })
    res.status(201).json({ vehicleType })
  }),
)

adminConfigRouter.patch(
  "/vehicle-types/:id",
  requireAdminRole("super_admin", "ops_manager"),
  validateBody(
    z.object({
      name: z.string().trim().min(1).max(60).optional(),
      capacity: z.number().int().positive().optional(),
      sortOrder: z.number().int().optional(),
      isActive: z.boolean().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const before = await prisma.vehicleType.findUnique({ where: { id: req.params.id } })
    if (!before) throw ApiError.notFound("Vehicle type not found.")
    const vehicleType = await prisma.vehicleType.update({ where: { id: req.params.id }, data: req.body })
    await writeAuditLog({ req, action: "vehicle_type.update", targetTable: "vehicle_types", targetId: vehicleType.id, before, after: req.body })
    res.json({ vehicleType })
  }),
)

adminConfigRouter.put(
  "/cities/:cityId/vehicle-types/:vehicleTypeId",
  requireAdminRole("super_admin", "ops_manager"),
  validateBody(z.object({ isActive: z.boolean() })),
  asyncHandler(async (req, res) => {
    const link = await prisma.cityVehicleType.upsert({
      where: { cityId_vehicleTypeId: { cityId: req.params.cityId, vehicleTypeId: req.params.vehicleTypeId } },
      create: { cityId: req.params.cityId, vehicleTypeId: req.params.vehicleTypeId, isActive: req.body.isActive },
      update: { isActive: req.body.isActive },
    })
    await writeAuditLog({ req, action: "city_vehicle_type.update", targetTable: "city_vehicle_types", targetId: `${link.cityId}:${link.vehicleTypeId}`, after: req.body })
    res.json({ link })
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
  requireAdminRole("super_admin", "ops_manager"),
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
  requireAdminRole("super_admin", "ops_manager", "finance"),
  validateBody(fareRuleSchema),
  asyncHandler(async (req, res) => {
    const rule = await prisma.fareRule.create({ data: { ...req.body, createdById: req.auth!.userId } })
    await writeAuditLog({ req, action: "fare_rule.create", targetTable: "fare_rules", targetId: rule.id, after: req.body })
    res.status(201).json({ fareRule: rule })
  }),
)

adminConfigRouter.put(
  "/pricing/fare-rules/:id",
  requireAdminRole("super_admin", "ops_manager", "finance"),
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
  requireAdminRole("super_admin"),
  validateBody(
    z.object({
      value: z.union([z.number(), z.array(z.number()), z.boolean(), z.string(), z.array(z.string())]),
      description: z.string().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const key = req.params.key as keyof PlatformSettingsShape
    if (!(key in SETTINGS_DEFAULTS)) throw ApiError.badRequest("UNKNOWN_SETTING", `Unknown setting key "${key}".`)
    await setSetting(key, req.body.value, req.body.description)
    await writeAuditLog({ req, action: "settings.update", targetTable: "platform_settings", targetId: key, after: req.body })
    const settings = await getAllSettings()
    res.json({ settings })
  }),
)

// ---------------------------------------------------------------------
// Promotions (Phase 2 §10) — every rule dimension is admin-set, never
// hard-coded: percentage/flat, max discount, min fare, vehicle type,
// city, new-users-only, usage limit, expiration.
// ---------------------------------------------------------------------

const promotionSchema = z.object({
  code: z.string().trim().min(3).max(20).transform((s) => s.toUpperCase()),
  description: z.string().trim().max(200).optional(),
  campaignType: z
    .enum([
      "new_user",
      "first_ride",
      "weekend",
      "airport",
      "city_launch",
      "referral",
      "driver_acquisition",
      "business_promotion",
    ])
    .optional(),
  discountType: z.enum(["percentage", "flat"]),
  discountValue: z.number().positive(),
  maxDiscount: z.number().positive().optional(),
  minFare: z.number().positive().optional(),
  cityId: z.string().uuid().optional(),
  vehicleTypeId: z.string().uuid().optional(),
  newUsersOnly: z.boolean().default(false),
  usageLimit: z.number().int().positive().optional(),
  startsAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
})

adminConfigRouter.get(
  "/promotions",
  asyncHandler(async (_req, res) => {
    const promotions = await prisma.promotion.findMany({
      include: { city: true, vehicleType: true },
      orderBy: { createdAt: "desc" },
    })
    res.json({ promotions })
  }),
)

adminConfigRouter.post(
  "/promotions",
  requireAdminRole("super_admin", "ops_manager", "finance"),
  validateBody(promotionSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.promotion.findUnique({ where: { code: req.body.code } })
    if (existing) throw ApiError.conflict("PROMO_CODE_EXISTS", "A promotion with this code already exists.")
    const promotion = await prisma.promotion.create({ data: { ...req.body, createdById: req.auth!.userId } })
    await writeAuditLog({ req, action: "promotion.create", targetTable: "promotions", targetId: promotion.id, after: req.body })
    res.status(201).json({ promotion })
  }),
)

adminConfigRouter.put(
  "/promotions/:id",
  requireAdminRole("super_admin", "ops_manager", "finance"),
  validateBody(promotionSchema.partial().extend({ isActive: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const before = await prisma.promotion.findUnique({ where: { id: req.params.id } })
    if (!before) throw ApiError.notFound("Promotion not found.")
    const promotion = await prisma.promotion.update({ where: { id: req.params.id }, data: req.body })
    await writeAuditLog({ req, action: "promotion.update", targetTable: "promotions", targetId: promotion.id, before, after: req.body })
    res.json({ promotion })
  }),
)

// ---------------------------------------------------------------------
// Driver incentive campaigns (Phase 2 §8) — target ride count and reward
// amount are always admin-set, never hard-coded in application code.
// ---------------------------------------------------------------------

const incentiveCampaignSchema = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(300).optional(),
  cityId: z.string().uuid().optional(),
  vehicleTypeId: z.string().uuid().optional(),
  targetRideCount: z.number().int().positive(),
  rewardAmount: z.number().positive(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
})

adminConfigRouter.get(
  "/incentive-campaigns",
  asyncHandler(async (_req, res) => {
    const campaigns = await prisma.incentiveCampaign.findMany({
      include: { city: true, vehicleType: true, _count: { select: { progress: true, rewards: true } } },
      orderBy: { createdAt: "desc" },
    })
    res.json({ campaigns })
  }),
)

adminConfigRouter.post(
  "/incentive-campaigns",
  requireAdminRole("super_admin", "ops_manager", "finance"),
  validateBody(incentiveCampaignSchema),
  asyncHandler(async (req, res) => {
    if (req.body.endDate <= req.body.startDate) throw ApiError.badRequest("INVALID_DATE_RANGE", "endDate must be after startDate.")
    const campaign = await prisma.incentiveCampaign.create({ data: { ...req.body, createdById: req.auth!.userId } })
    await writeAuditLog({ req, action: "incentive_campaign.create", targetTable: "incentive_campaigns", targetId: campaign.id, after: req.body })
    res.status(201).json({ campaign })
  }),
)

adminConfigRouter.put(
  "/incentive-campaigns/:id",
  requireAdminRole("super_admin", "ops_manager", "finance"),
  validateBody(incentiveCampaignSchema.partial().extend({ status: z.enum(["draft", "active", "ended"]).optional() })),
  asyncHandler(async (req, res) => {
    const before = await prisma.incentiveCampaign.findUnique({ where: { id: req.params.id } })
    if (!before) throw ApiError.notFound("Campaign not found.")
    const campaign = await prisma.incentiveCampaign.update({ where: { id: req.params.id }, data: req.body })
    await writeAuditLog({ req, action: "incentive_campaign.update", targetTable: "incentive_campaigns", targetId: campaign.id, before, after: req.body })
    res.json({ campaign })
  }),
)
