import { Router } from "express"
import { prisma } from "../../utils/prisma.js"
import { asyncHandler } from "../../utils/asyncHandler.js"

export const adminDirectoryRouter = Router()

function pagination(query: Record<string, unknown>) {
  const take = Math.min(100, Number(query.pageSize) || 20)
  const page = Math.max(1, Number(query.page) || 1)
  return { take, skip: (page - 1) * take, page }
}

adminDirectoryRouter.get(
  "/passengers",
  asyncHandler(async (req, res) => {
    const { search, status } = req.query as Record<string, string>
    const { take, skip, page } = pagination(req.query as Record<string, unknown>)
    const where = {
      role: "passenger",
      ...(status ? { status } : {}),
      ...(search
        ? { OR: [{ fullName: { contains: search } }, { phone: { contains: search } }, { email: { contains: search } }] }
        : {}),
    }
    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, include: { passengerProfile: true }, orderBy: { createdAt: "desc" }, take, skip }),
      prisma.user.count({ where }),
    ])
    res.json({ passengers: users, total, page, pageSize: take })
  }),
)

adminDirectoryRouter.get(
  "/drivers",
  asyncHandler(async (req, res) => {
    const { search, status, verificationStatus, cityId } = req.query as Record<string, string>
    const { take, skip, page } = pagination(req.query as Record<string, unknown>)
    const where = {
      role: "driver",
      ...(status ? { status } : {}),
      ...(search
        ? { OR: [{ fullName: { contains: search } }, { phone: { contains: search } }, { email: { contains: search } }] }
        : {}),
      driverProfile: {
        ...(verificationStatus ? { verificationStatus } : {}),
        ...(cityId ? { cityId } : {}),
      },
    }
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: { driverProfile: { include: { vehicles: true, city: true } } },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.user.count({ where }),
    ])
    res.json({ drivers: users, total, page, pageSize: take })
  }),
)

adminDirectoryRouter.get(
  "/vehicles",
  asyncHandler(async (req, res) => {
    const { search, status, vehicleTypeId } = req.query as Record<string, string>
    const { take, skip, page } = pagination(req.query as Record<string, unknown>)
    const where = {
      ...(status ? { status } : {}),
      ...(vehicleTypeId ? { vehicleTypeId } : {}),
      ...(search ? { OR: [{ plateNumber: { contains: search } }, { make: { contains: search } }, { model: { contains: search } }] } : {}),
    }
    const [vehicles, total] = await Promise.all([
      prisma.vehicle.findMany({ where, include: { driver: { include: { user: true } }, vehicleType: true }, orderBy: { createdAt: "desc" }, take, skip }),
      prisma.vehicle.count({ where }),
    ])
    res.json({ vehicles, total, page, pageSize: take })
  }),
)

adminDirectoryRouter.get(
  "/ride-requests",
  asyncHandler(async (req, res) => {
    const { status, cityId, from, to } = req.query as Record<string, string>
    const { take, skip, page } = pagination(req.query as Record<string, unknown>)
    const where = {
      ...(status ? { status } : {}),
      ...(cityId ? { cityId } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
    }
    const [requests, total] = await Promise.all([
      prisma.rideRequest.findMany({
        where,
        include: { passenger: { include: { user: true } }, pickup: true, destination: true, vehicleType: true, city: true },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.rideRequest.count({ where }),
    ])
    res.json({ requests, total, page, pageSize: take })
  }),
)

/** Support/ops visibility into a request's live negotiation state. */
adminDirectoryRouter.get(
  "/ride-requests/:id/offers",
  asyncHandler(async (req, res) => {
    const offers = await prisma.rideOffer.findMany({
      where: { rideRequestId: req.params.id },
      include: { driver: { include: { user: true } }, vehicle: true, counterOffers: true },
      orderBy: { createdAt: "asc" },
    })
    res.json({ offers })
  }),
)

adminDirectoryRouter.get(
  "/rides",
  asyncHandler(async (req, res) => {
    const { status, cityId, from, to, search } = req.query as Record<string, string>
    const { take, skip, page } = pagination(req.query as Record<string, unknown>)
    const where = {
      ...(status ? { status } : {}),
      ...(cityId ? { rideRequest: { cityId } } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
      ...(search
        ? { OR: [{ id: { contains: search } }, { passenger: { user: { fullName: { contains: search } } } }, { driver: { user: { fullName: { contains: search } } } }] }
        : {}),
    }
    const [rides, total] = await Promise.all([
      prisma.ride.findMany({
        where,
        include: { passenger: { include: { user: true } }, driver: { include: { user: true } }, vehicle: true, payment: { include: { commission: true } } },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.ride.count({ where }),
    ])
    res.json({ rides, total, page, pageSize: take })
  }),
)

adminDirectoryRouter.get(
  "/ratings",
  asyncHandler(async (req, res) => {
    const { take, skip, page } = pagination(req.query as Record<string, unknown>)
    const [ratings, total] = await Promise.all([
      prisma.rating.findMany({
        include: { rater: true, ratee: true, review: true, ride: { select: { id: true, agreedFare: true } } },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.rating.count(),
    ])
    res.json({ ratings, total, page, pageSize: take })
  }),
)
