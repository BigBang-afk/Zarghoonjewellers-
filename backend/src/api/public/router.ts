import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { publicFormRateLimit } from "../../middleware/rateLimit.js"

/** No-auth reference data needed before a user has an account (registration, booking screens). */
export const publicRouter = Router()

publicRouter.get(
  "/cities",
  asyncHandler(async (_req, res) => {
    const cities = await prisma.city.findMany({
      where: { status: { in: ["live", "launching"] } },
      select: { id: true, name: true, status: true, currencyCode: true },
      orderBy: { name: "asc" },
    })
    res.json({ cities })
  }),
)

publicRouter.get(
  "/vehicle-types",
  asyncHandler(async (req, res) => {
    const cityId = req.query.cityId as string | undefined
    const vehicleTypes = await prisma.vehicleType.findMany({
      where: {
        isActive: true,
        ...(cityId ? { cityVehicleTypes: { some: { cityId, isActive: true } } } : {}),
      },
      select: { id: true, code: true, name: true, capacity: true },
      orderBy: { sortOrder: "asc" },
    })
    res.json({ vehicleTypes })
  }),
)

// ---------------------------------------------------------------------
// Marketing CMS (Phase 4 §18) — admin-managed homepage banners, promos,
// FAQ/help articles, and announcements, read-only here.
// ---------------------------------------------------------------------

publicRouter.get(
  "/content",
  asyncHandler(async (req, res) => {
    const type = req.query.type as string | undefined
    const cityId = req.query.cityId as string | undefined
    const items = await prisma.contentItem.findMany({
      where: {
        isActive: true,
        ...(type ? { type } : {}),
        ...(cityId ? { OR: [{ cityId }, { cityId: null }] } : {}),
      },
      select: { id: true, type: true, title: true, body: true, cityId: true, sortOrder: true },
      orderBy: { sortOrder: "asc" },
    })
    res.json({ items })
  }),
)

// ---------------------------------------------------------------------
// Waitlist (Phase 4 §38) — landing-page collection ahead of a city launch.
// ---------------------------------------------------------------------

const waitlistSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  contact: z.string().trim().min(5).max(120),
  cityName: z.string().trim().min(2).max(80),
  userType: z.enum(["passenger", "driver"]),
  marketingConsent: z.boolean().default(false),
})

publicRouter.post(
  "/waitlist",
  publicFormRateLimit,
  validateBody(waitlistSchema),
  asyncHandler(async (req, res) => {
    const entry = await prisma.waitlistEntry.create({ data: req.body })
    res.status(201).json({ id: entry.id })
  }),
)
