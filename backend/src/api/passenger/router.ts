import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requireAuth, requireRole } from "../../middleware/auth.js"
import { getPassengerProfileOrThrow } from "../../shared/profileLookup.js"
import { ApiError } from "../../utils/apiError.js"

export const passengerRouter = Router()
passengerRouter.use(requireAuth, requireRole("passenger"))

// ---------------------------------------------------------------------
// Saved places (Home/Work/custom) + recent destinations
// ---------------------------------------------------------------------

passengerRouter.get(
  "/locations/saved",
  asyncHandler(async (req, res) => {
    const locations = await prisma.location.findMany({
      where: { userId: req.auth!.userId, isSaved: true, deletedAt: null },
      orderBy: { createdAt: "asc" },
    })
    res.json({ locations })
  }),
)

passengerRouter.post(
  "/locations/saved",
  validateBody(
    z.object({
      label: z.string().trim().min(1).max(40),
      address: z.string().trim().min(1).max(200),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }),
  ),
  asyncHandler(async (req, res) => {
    const location = await prisma.location.create({
      data: { userId: req.auth!.userId, isSaved: true, ...req.body },
    })
    res.status(201).json({ location })
  }),
)

passengerRouter.delete(
  "/locations/saved/:id",
  asyncHandler(async (req, res) => {
    const location = await prisma.location.findUnique({ where: { id: req.params.id } })
    if (!location || location.userId !== req.auth!.userId) throw ApiError.notFound("Saved place not found.")
    await prisma.location.update({ where: { id: location.id }, data: { deletedAt: new Date() } })
    res.status(204).send()
  }),
)

/** Recent destinations = distinct ride-request destinations, most recent first. */
passengerRouter.get(
  "/locations/recent",
  asyncHandler(async (req, res) => {
    const passenger = await getPassengerProfileOrThrow(req.auth!.userId)
    const requests = await prisma.rideRequest.findMany({
      where: { passengerId: passenger.id },
      include: { destination: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    })
    const seen = new Set<string>()
    const recents = []
    for (const r of requests) {
      const key = r.destination.address
      if (seen.has(key)) continue
      seen.add(key)
      recents.push({ id: r.destination.id, address: r.destination.address, lat: r.destination.lat, lng: r.destination.lng })
      if (recents.length >= 5) break
    }
    res.json({ locations: recents })
  }),
)

// ---------------------------------------------------------------------
// Ride history
// ---------------------------------------------------------------------

passengerRouter.get(
  "/ride-history",
  asyncHandler(async (req, res) => {
    const passenger = await getPassengerProfileOrThrow(req.auth!.userId)
    const rides = await prisma.ride.findMany({
      where: { passengerId: passenger.id, status: { in: ["ride_completed", "cancelled_by_passenger", "cancelled_by_driver"] } },
      include: { driver: { include: { user: true } }, vehicle: true, pickup: true, destination: true, payment: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    })
    res.json({ rides })
  }),
)
