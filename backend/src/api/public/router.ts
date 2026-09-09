import { Router } from "express"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"

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
