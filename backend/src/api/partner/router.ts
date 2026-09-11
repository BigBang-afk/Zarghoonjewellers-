import { Router } from "express"
import { z } from "zod"
import { prisma } from "../../utils/prisma.js"
import { ApiError } from "../../utils/apiError.js"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { validateBody } from "../../middleware/validate.js"
import { requirePartnerApiKey } from "../../middleware/partnerAuth.js"
import { partnerApiRateLimit } from "../../middleware/rateLimit.js"
import { mapProvider } from "../../services/maps/HaversineMapProvider.js"
import { computeFare } from "../../services/fareEngine.js"
import { createRideRequest } from "../../services/rideRequestService.js"

/**
 * Phase 5 §20 — scoped partner API platform. Deliberately narrow: a
 * fare estimate, creating a ride request on behalf of an *existing*
 * RIVO passenger (identified by phone — a partner can never create an
 * account via this API, only book for someone who already has one), and
 * checking status on a ride that partner created. No cancellation,
 * negotiation, or account-creation endpoints — those stay app-only.
 */
export const partnerApiRouter = Router()
partnerApiRouter.use(partnerApiRateLimit, requirePartnerApiKey)

const latLng = z.object({
  address: z.string().trim().min(1).max(300),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})

partnerApiRouter.post(
  "/fare-estimate",
  validateBody(
    z.object({
      cityId: z.string().uuid(),
      zoneId: z.string().uuid().optional(),
      vehicleTypeId: z.string().uuid(),
      pickup: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
      destination: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
    }),
  ),
  asyncHandler(async (req, res) => {
    const vehicleType = await prisma.vehicleType.findUnique({ where: { id: req.body.vehicleTypeId } })
    if (!vehicleType) throw ApiError.badRequest("INVALID_VEHICLE_TYPE", "Vehicle type not found.")
    const route = await mapProvider.estimateRoute(req.body.pickup, req.body.destination, vehicleType.code)
    const fare = await computeFare({ ...req.body, distanceKm: route.distanceKm, durationMin: route.durationMin })
    res.json({ route, fare })
  }),
)

partnerApiRouter.post(
  "/rides",
  validateBody(
    z.object({
      passengerPhone: z.string().trim().min(8).max(20),
      cityId: z.string().uuid(),
      vehicleTypeId: z.string().uuid(),
      pickup: latLng,
      destination: latLng,
      paymentMethod: z.enum(["cash", "card", "wallet", "local_provider"]).default("cash"),
    }),
  ),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { phone: req.body.passengerPhone } })
    if (!user || user.role !== "passenger") {
      throw ApiError.notFound("No RIVO passenger account found for this phone number. The partner API only books for existing passengers.")
    }
    const passenger = await prisma.passengerProfile.findUniqueOrThrow({ where: { userId: user.id } })

    const result = await createRideRequest({
      passengerId: passenger.id,
      passengerUserId: user.id,
      cityId: req.body.cityId,
      vehicleTypeId: req.body.vehicleTypeId,
      pickup: req.body.pickup,
      destination: req.body.destination,
      bookingMode: "quick_match",
      paymentMethod: req.body.paymentMethod,
      partnerId: req.partner!.id,
    })

    res.status(201).json({ request: result.request, fare: result.fare, route: result.route, dispatch: result.dispatch })
  }),
)

partnerApiRouter.get(
  "/rides/:id",
  asyncHandler(async (req, res) => {
    const request = await prisma.rideRequest.findUnique({
      where: { id: req.params.id },
      include: { ride: { select: { id: true, status: true, driver: { include: { user: { select: { fullName: true, phone: true } } } } } } },
    })
    if (!request || request.partnerId !== req.partner!.id) throw ApiError.notFound("Ride request not found.")
    res.json({
      id: request.id,
      status: request.status,
      dispatchStage: request.dispatchStage,
      noMatchReason: request.noMatchReason,
      ride: request.ride
        ? { id: request.ride.id, status: request.ride.status, driver: { name: request.ride.driver.user.fullName, phone: request.ride.driver.user.phone } }
        : null,
    })
  }),
)
