import { prisma } from "../utils/prisma.js"
import { ApiError } from "../utils/apiError.js"
import { getSetting } from "../config/settings.js"
import { mapProvider } from "./maps/HaversineMapProvider.js"
import { computeFare, assertFareWithinGuardrails } from "./fareEngine.js"
import { findEligibleDrivers } from "./matchingEngine.js"
import { notify } from "./notifications/NotificationService.js"
import { emitToUser } from "../realtime/socket.js"
import type { BookingMode, PaymentMethod } from "../types/enums.js"

export interface CreateRideRequestInput {
  passengerId: string // PassengerProfile.id
  passengerUserId: string // User.id
  cityId: string
  zoneId?: string | null
  vehicleTypeId: string
  pickup: { address: string; lat: number; lng: number }
  destination: { address: string; lat: number; lng: number }
  bookingMode: BookingMode
  proposedFare?: number
  paymentMethod: PaymentMethod
}

export async function createRideRequest(input: CreateRideRequestInput) {
  const [vehicleType, city] = await Promise.all([
    prisma.vehicleType.findUnique({ where: { id: input.vehicleTypeId } }),
    prisma.city.findUnique({ where: { id: input.cityId } }),
  ])
  if (!vehicleType || !vehicleType.isActive) throw ApiError.badRequest("INVALID_VEHICLE_TYPE", "Vehicle type not available.")
  if (!city || city.status !== "live") throw ApiError.badRequest("CITY_NOT_LIVE", "RIVO is not yet live in this city.")

  const route = await mapProvider.estimateRoute(input.pickup, input.destination, vehicleType.code)
  const fare = await computeFare({
    cityId: input.cityId,
    vehicleTypeId: input.vehicleTypeId,
    zoneId: input.zoneId,
    distanceKm: route.distanceKm,
    durationMin: route.durationMin,
  })

  let proposedFare = fare.suggestedFare
  if (input.bookingMode === "competitive_offer" && input.proposedFare != null) {
    assertFareWithinGuardrails(input.proposedFare, fare)
    proposedFare = input.proposedFare
  }

  const [pickup, destination, expiryMinutes, initialRadius] = await Promise.all([
    prisma.location.create({ data: { userId: input.passengerUserId, address: input.pickup.address, lat: input.pickup.lat, lng: input.pickup.lng } }),
    prisma.location.create({ data: { userId: input.passengerUserId, address: input.destination.address, lat: input.destination.lat, lng: input.destination.lng } }),
    getSetting("negotiation.requestExpiryMinutes"),
    getSetting("matching.initialRadiusKm"),
  ])

  const request = await prisma.rideRequest.create({
    data: {
      passengerId: input.passengerId,
      cityId: input.cityId,
      zoneId: input.zoneId,
      vehicleTypeId: input.vehicleTypeId,
      pickupLocationId: pickup.id,
      destinationLocationId: destination.id,
      bookingMode: input.bookingMode,
      suggestedFare: fare.suggestedFare,
      proposedFare,
      distanceKm: route.distanceKm,
      estDurationMin: route.durationMin,
      paymentMethod: input.paymentMethod,
      status: "searching",
      searchRadiusKm: initialRadius,
      expiresAt: new Date(Date.now() + expiryMinutes * 60_000),
    },
  })

  const dispatch =
    input.bookingMode === "quick_match" ? await dispatchQuickMatchNext(request.id) : await dispatchCompetitiveBroadcast(request.id)

  return { request, fare, route, dispatch }
}

/** Driver ids that already have (or had) an offer on this request — never re-dispatch to them. */
async function alreadyContactedDriverIds(rideRequestId: string): Promise<string[]> {
  const offers = await prisma.rideOffer.findMany({ where: { rideRequestId }, select: { driverId: true } })
  return offers.map((o) => o.driverId)
}

/**
 * Quick Match dispatch (docs/01 §2 Mode 1): sequential single-driver
 * offers to the best-scored candidate. On decline/expiry the caller
 * (negotiationEngine) re-invokes this to escalate to the next-best
 * candidate, excluding everyone already contacted.
 */
export async function dispatchQuickMatchNext(rideRequestId: string) {
  const request = await prisma.rideRequest.findUnique({ where: { id: rideRequestId } })
  if (!request || request.status !== "searching") return { status: "skipped" as const }

  const pickup = await prisma.location.findUniqueOrThrow({ where: { id: request.pickupLocationId } })
  const exclude = await alreadyContactedDriverIds(rideRequestId)

  const { candidates } = await findEligibleDrivers({
    cityId: request.cityId,
    vehicleTypeId: request.vehicleTypeId,
    pickup: { lat: pickup.lat, lng: pickup.lng },
    excludeDriverIds: exclude,
    limit: 1,
  })

  if (candidates.length === 0) {
    await expireRequest(rideRequestId, "No drivers were available near your pickup.")
    return { status: "no_drivers" as const }
  }

  const top = candidates[0]
  const dispatchTimeoutSec = await getSetting("matching.quickMatchDispatchTimeoutSec")

  const offer = await prisma.rideOffer.create({
    data: {
      rideRequestId,
      driverId: top.driverId,
      vehicleId: top.vehicleId,
      offerPrice: request.proposedFare,
      etaMin: top.etaMin,
      distanceKm: top.distanceKm,
      status: "pending",
      expiresAt: new Date(Date.now() + dispatchTimeoutSec * 1000),
    },
  })

  await notify({
    userId: top.userId,
    type: "ride_update",
    title: "New ride request",
    body: `Pickup ${pickup.address} — Rs ${request.proposedFare}`,
    data: { rideRequestId, offerId: offer.id },
  })
  emitToUser(top.userId, "ride_request.created", { rideRequestId, offerId: offer.id })

  return { status: "dispatched" as const, driverId: top.driverId, offerId: offer.id }
}

/**
 * Competitive Offer dispatch (docs/01 §2 Mode 2): broadcast to up to N
 * eligible drivers simultaneously; each can accept, counter, or decline
 * independently, and the passenger picks from whatever comes back.
 */
export async function dispatchCompetitiveBroadcast(rideRequestId: string) {
  const request = await prisma.rideRequest.findUnique({ where: { id: rideRequestId } })
  if (!request || request.status !== "searching") return { status: "skipped" as const }

  const pickup = await prisma.location.findUniqueOrThrow({ where: { id: request.pickupLocationId } })
  const [maxDrivers, offerExpirySec] = await Promise.all([
    getSetting("matching.competitiveOfferMaxDrivers"),
    getSetting("negotiation.offerExpirySec"),
  ])

  const { candidates } = await findEligibleDrivers({
    cityId: request.cityId,
    vehicleTypeId: request.vehicleTypeId,
    pickup: { lat: pickup.lat, lng: pickup.lng },
    limit: maxDrivers,
  })

  if (candidates.length === 0) {
    await expireRequest(rideRequestId, "No drivers were available near your pickup.")
    return { status: "no_drivers" as const }
  }

  const expiresAt = new Date(Date.now() + offerExpirySec * 1000)
  await prisma.$transaction(
    candidates.map((c) =>
      prisma.rideOffer.create({
        data: {
          rideRequestId,
          driverId: c.driverId,
          vehicleId: c.vehicleId,
          offerPrice: request.proposedFare,
          etaMin: c.etaMin,
          distanceKm: c.distanceKm,
          status: "pending",
          expiresAt,
        },
      }),
    ),
  )

  await prisma.rideRequest.update({ where: { id: rideRequestId }, data: { status: "offers_open" } })

  for (const c of candidates) {
    await notify({
      userId: c.userId,
      type: "ride_update",
      title: "New competitive ride request",
      body: `Pickup ${pickup.address} — passenger proposed Rs ${request.proposedFare}`,
      data: { rideRequestId },
    })
    emitToUser(c.userId, "ride_request.created", { rideRequestId })
  }

  return { status: "dispatched" as const, driversNotified: candidates.length }
}

export async function expireRequest(rideRequestId: string, reason: string) {
  const request = await prisma.rideRequest.findUnique({ where: { id: rideRequestId } })
  if (!request || !["searching", "offers_open"].includes(request.status)) return

  await prisma.$transaction([
    prisma.rideRequest.update({ where: { id: rideRequestId }, data: { status: "expired" } }),
    prisma.rideOffer.updateMany({ where: { rideRequestId, status: "pending" }, data: { status: "expired" } }),
  ])

  const passenger = await prisma.passengerProfile.findUnique({ where: { id: request.passengerId }, include: { user: true } })
  if (passenger) {
    await notify({ userId: passenger.userId, type: "ride_update", title: "Ride request expired", body: reason, data: { rideRequestId } })
  }
}
